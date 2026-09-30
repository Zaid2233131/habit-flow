import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
webpush.setVapidDetails("mailto:habitflow@zaid2233131.github.io", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function parts(timeZone:string) {
  const p = new Intl.DateTimeFormat("en-CA", {timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23"}).formatToParts(new Date());
  const get=(type:string)=>p.find(x=>x.type===type)?.value || "00";
  return { date:`${get("year")}-${get("month")}-${get("day")}`, minute:Number(get("hour"))*60+Number(get("minute")) };
}
function toMin(v:string|undefined, fallback:number) { if(!v) return fallback; const [h,m]=String(v).slice(0,5).split(":").map(Number); return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:fallback; }
function quiet(min:number, enabled:boolean, start:string, end:string) {
  if(!enabled) return false; const a=toMin(start,1380), b=toMin(end,360); return a>b ? (min>=a || min<b) : (min>=a && min<b);
}
function makeSlots(start:number,end:number,count:number) {
  if(end<=start) end=1439; const span=end-start; if(span<30) return [];
  const n=Math.min(count, Math.max(1, Math.floor(span/60))); const gap=Math.max(45,Math.floor(span/(n+1))); const out:number[]=[];
  for(let i=0;i<n;i++){ const lo=start+i*gap+10; const hi=Math.min(end-10,start+(i+1)*gap-10); const m=hi>lo?lo+Math.floor(Math.random()*(hi-lo+1)):Math.min(end-1,lo); out.push(m); }
  return out.sort((a,b)=>a-b);
}
async function ensurePlan(row:any, date:string) {
  if(row.plan_date===date && Array.isArray(row.slots) && row.slots.length) return row;
  const slots=makeSlots(toMin(row.start_time,540),toMin(row.end_time,1320),Math.max(1,Math.min(10,Number(row.max_reminders)||6)));
  const {data,error}=await admin.from("habit_reminder_plans").update({plan_date:date,slots,sent_slots:{},last_habit_id:null,updated_at:new Date().toISOString()}).eq("user_id",row.user_id).select("*").single();
  if(error) throw error; return data;
}
async function sendForUser(row:any) {
  if(!row.enabled) return {sent:0};
  const tz=row.timezone || "UTC"; const now=parts(tz); if(quiet(now.minute,row.quiet_enabled,row.quiet_start,row.quiet_end)) return {sent:0,quiet:true};
  row=await ensurePlan(row,now.date);
  const slots=Array.isArray(row.slots)?row.slots:[];
  const due=slots.map((m:number,i:number)=>({m,i})).filter(x=>x.m<=now.minute && !(row.sent_slots||{})[String(x.i)]);
  if(!due.length) return {sent:0};
  const {data:habits,error:hErr}=await admin.from("habits").select("id,name,created_at").eq("user_id",row.user_id).order("created_at",{ascending:true});
  if(hErr) throw hErr;
  const eligible=(habits||[]).filter((h:any)=>String(h.created_at).slice(0,10)<=now.date);
  if(!eligible.length) return {sent:0};
  const {data:comps,error:cErr}=await admin.from("habit_completions").select("habit_id,value").eq("user_id",row.user_id).eq("completion_date",now.date);
  if(cErr) throw cErr;
  const done=new Set((comps||[]).filter((c:any)=>c.value===1).map((c:any)=>c.habit_id));
  const skipped=new Set((comps||[]).filter((c:any)=>c.value===0).map((c:any)=>c.habit_id));
  const pool=eligible.filter((h:any)=>!done.has(h.id)&&!skipped.has(h.id)); if(!pool.length) return {sent:0};
  const dueSlot=due[due.length-1];
  const claimed=await admin.rpc("claim_habit_reminder_slot",{p_user_id:row.user_id,p_slot_index:dueSlot.i,p_plan_date:now.date});
  if(claimed.error) throw claimed.error; if(!claimed.data) return {sent:0,claimed:false};
  const last=row.last_habit_id; const candidates=pool.length>1?pool.filter((h:any)=>h.id!==last):pool; const habit=(candidates.length?candidates:pool)[Math.floor(Math.random()*(candidates.length?candidates:pool).length)];
  const {data:subs,error:sErr}=await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id",row.user_id); if(sErr) throw sErr;
  const payload=JSON.stringify({title:"Habit Flow",body:`You haven't completed “${habit.name}” yet. Take a moment to do it now.`,icon:"https://zaid2233131.github.io/habit-flow/icon-192.png",badge:"https://zaid2233131.github.io/habit-flow/icon-192.png",tag:`habit-reminder-${now.date}-${habit.id}`,url:"https://zaid2233131.github.io/habit-flow/"});
  let success=0;
  for(const sub of subs||[]){try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},payload,{TTL:300,urgency:"high"});success++;}catch(e){const t=String(e); if(t.includes("404")||t.includes("410")) await admin.from("push_subscriptions").delete().eq("id",sub.id);}}
  if(success===0){await admin.rpc("release_habit_reminder_slot",{p_user_id:row.user_id,p_slot_index:dueSlot.i,p_plan_date:now.date});return {sent:0,noSubscriptions:true};}
  await admin.from("habit_reminder_plans").update({last_habit_id:habit.id,updated_at:new Date().toISOString()}).eq("user_id",row.user_id);
  return {sent:success,habit:habit.name,slot:dueSlot.i};
}

Deno.serve(async (req)=>{
  if(req.method!=="POST") return new Response(JSON.stringify({error:"POST required"}),{status:405,headers:{"Content-Type":"application/json"}});
  try{
    const {data:rows,error}=await admin.from("habit_reminder_plans").select("*").eq("enabled",true); if(error) throw error;
    const results=[]; for(const row of rows||[]){try{results.push({user_id:row.user_id,...await sendForUser(row)});}catch(e){results.push({user_id:row.user_id,error:String(e)});}}
    return new Response(JSON.stringify({ok:true,results}),{status:200,headers:{"Content-Type":"application/json"}});
  }catch(e){console.error(e);return new Response(JSON.stringify({ok:false,error:String(e)}),{status:500,headers:{"Content-Type":"application/json"}});}
});
