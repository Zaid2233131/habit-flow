// Habit Flow v3 views: Today, Habits (Today / History / Detail), Progress, Settings.
// Loaded after index.html's main script and before auth.js. Data model is unchanged:
//   habit.completions[YYYY-MM-DD] = 'done' | 'skip' | (absent)   -- absent = missed (past) / pending (today)
// Supabase remains the source of truth; every write goes through setCompletion() -> saveHabitCompletionToCloud().
let habitFilter='All',histMonth=null,detailId=null,histHabit=null;
const SYM={done:'✓',missed:'✕',today:'○',skip:'–',na:'',future:''};
const SLBL={done:'completed',missed:'missed',today:'not done yet',skip:'skipped',na:'habit did not exist yet',future:'upcoming'};
const icon=h=>h.icon||'●';
const createdKey=h=>localKey(new Date(h.createdAt));
const lastKeys=n=>[...Array(n)].map((_,i)=>keyOffset(i-n+1));
const monthKeys=(y,m)=>[...Array(new Date(y,m+1,0).getDate())].map((_,i)=>y+'-'+pad(m+1)+'-'+pad(i+1));
const monthLbl=(y,m)=>new Date(y,m,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});
const shortDate=k=>new Date(k+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});

/* ---- data helpers (single definition of every state; all stats derive from cellState) ---- */
function cellState(h,k){const t=todayKey();if(k>t)return'future';if(k<createdKey(h))return'na';
  const s=h.completions[k];if(s==='done')return'done';if(s==='skip')return'skip';return k===t?'today':'missed';}
function statsFor(h,keys){let d=0,t=0;keys.forEach(k=>{const s=cellState(h,k);if(s==='done'){d++;t++;}else if(s==='missed'||s==='today')t++;});return{d,t,p:t?Math.round(d/t*100):0};}
function bestStreak(h){let best=0,run=0;const d=new Date(createdKey(h)+'T00:00:00'),end=todayKey();
  for(;localKey(d)<=end;d.setDate(d.getDate()+1)){const s=h.completions[localKey(d)];if(s==='done'){run++;best=Math.max(best,run);}else if(s!=='skip')run=0;}return best;}
const totalDone=h=>Object.values(h.completions).filter(v=>v==='done').length;
function dayPct(k){let d=0,t=0;state.habits.forEach(h=>{const s=cellState(h,k);if(s==='done'){d++;t++;}else if(s==='missed'||s==='today')t++;});return{d,t,p:t?Math.round(d/t*100):null};}
const filtered=()=>state.habits.filter(h=>habitFilter==='All'||h.category===habitFilter);

/* ---- completion: optimistic, reverted (with a message) if the cloud write fails ---- */
async function setCompletion(id,k,next){
  const h=state.habits.find(x=>x.id===id);if(!h)return;
  const s=cellState(h,k);if(s==='na'||s==='future')return;
  const prev=h.completions[k];
  if(next===undefined)delete h.completions[k];else h.completions[k]=next;
  save();render();
  const ok=await saveHabitCompletionToCloud(h.id,k,next);
  if(!ok){if(prev===undefined)delete h.completions[k];else h.completions[k]=prev;save();render();toast('Could not sync — change reverted');}
}
const toggleHabit=id=>{const h=state.habits.find(x=>x.id===id);if(h)return setCompletion(id,todayKey(),h.completions[todayKey()]==='done'?undefined:'done');};
const histToggle=(id,k)=>{const h=state.habits.find(x=>x.id===id);if(h)setCompletion(id,k,cellState(h,k)==='done'?undefined:'done');};
async function delHabit(id){
  const h=state.habits.find(x=>x.id===id);if(!h||!confirm('Delete "'+h.name+'" and its history?'))return;
  if(!await deleteHabitFromCloud(id)){toast('Could not delete — check your connection');return;}
  state.habits=state.habits.filter(x=>x.id!==id);save();habitView='today';render();
}
const openHabit=id=>{detailId=id;habitView='detail';histMonth=null;render();window.scrollTo(0,0);};
const setHabitView=v=>{habitView=v;histMonth=null;render();};
function histShift(d){const c=curMonth(),dt=new Date(c.y,c.m+d,1);histMonth={y:dt.getFullYear(),m:dt.getMonth()};render();}
function curMonth(){if(!histMonth){const n=now();histMonth={y:n.getFullYear(),m:n.getMonth()};}return histMonth;}

/* ---- shared UI pieces ---- */
const pageTop=(t,sub,right)=>`<div class="topbar"><div><h1>${t}</h1><p class="sub">${sub||''}</p></div><div class="topright">${right||''}</div></div>`;
function ring(p,size,sub){const r=size/2-9,c=2*Math.PI*r;
  return `<div class="ring" style="width:${size}px;height:${size}px" role="img" aria-label="${p}% ${sub}"><svg viewBox="0 0 ${size} ${size}"><circle class="rg-bg" cx="${size/2}" cy="${size/2}" r="${r}"/><circle class="rg-fg" cx="${size/2}" cy="${size/2}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-p/100)}" transform="rotate(-90 ${size/2} ${size/2})"/></svg><div class="ring-c"><b>${p}%</b><span>${sub}</span></div></div>`;}
function habitRow(h){const st=h.completions[todayKey()],nm=esc(h.name);
  return `<div class="hrow"><button class="hcheck ${st||''}" aria-pressed="${st==='done'}" aria-label="${st==='done'?'Mark '+nm+' not done':'Mark '+nm+' done'}" onclick="toggleHabit('${h.id}')">${SYM[st]||''}</button>
  <button class="hmain" onclick="openHabit('${h.id}')"><span class="hicon">${esc(icon(h))}</span><span class="hname ${st==='done'?'strike':''}">${nm}<small>${esc(h.category)}</small></span><span class="flame">🔥 ${streakFor(h)}</span></button></div>`;}
const bars=rows=>rows.map(r=>`<div class="prow"><span class="pl">${r.l}</span><div class="ptrack"><i style="width:${r.p}%"></i></div><b>${r.p}%</b></div>`).join('');
const stat=(v,l)=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`;
const empty=(msg,btn)=>`<div class="card empty"><p>${msg}</p>${btn||''}</div>`;

/* ---- TODAY ---- */
function renderToday(){
  const t=todayKey(),H=state.habits,sx=schedProgress(),doneH=H.filter(h=>h.completions[t]==='done').length;
  const total=H.length+sx.t,done=doneH+sx.d,pct=total?Math.round(done/total*100):0;
  const items=itemsFor(t).sort((a,b)=>slot(a,t).s-slot(b,t).s),n=now(),best=Math.max(0,...H.map(streakFor));
  let html=pageTop(greeting()+', '+esc(state.name),fmtLong(t),bellBtn());
  html+=total?`<div class="card hero">${ring(pct,150,'today')}<div class="hero-t"><b>${done} / ${total}</b> completed${best?`<div class="chip">🔥 ${best} day streak</div>`:''}</div></div>`
    :empty('Nothing planned yet. Build your first habit.',`<button class="btn" onclick="openModal('habit')">+ Create Habit</button>`);
  html+=`<div class="cols"><div><div class="section-title">Today's habits</div>${H.length?`<div class="card list">${H.map(habitRow).join('')}</div>`:empty('No habits yet.')}</div>
  <div><div class="section-title">Today's schedule</div>${items.length?`<div class="card list">${items.slice(0,8).map(it=>{const s=getScheduleStatus(it,t,n);
    return `<div class="srow"><span class="stime">${fmtT(slot(it,t).s)}</span><span class="hname">${esc(it.title)}</span><span class="tag t-${s}">${STL[s]||s}</span></div>`;}).join('')}<button class="link" onclick="page='schedule';render()">Open schedule →</button></div>`
    :empty('Plan your day.',`<button class="btn" onclick="openModal('schedule')">+ Add Schedule</button>`)}</div></div>`;
  return html;
}

/* ---- HABITS ---- */
function renderHabits(){
  if(habitView==='detail')return renderHabitDetail();
  const cats=[...new Set(state.habits.map(h=>h.category))];
  let html=pageTop('Habits',state.habits.length+' active',`<button class="btn" onclick="openModal('habit')">+ New</button>`);
  html+=`<div class="tabs"><button class="${habitView==='today'?'on':''}" onclick="setHabitView('today')">Today</button><button class="${habitView==='history'?'on':''}" onclick="setHabitView('history')">History</button></div>`;
  if(!state.habits.length)return html+empty('Build your first habit.',`<button class="btn" onclick="openModal('habit')">+ Create Habit</button>`);
  if(cats.length>1)html+=`<div class="chips">${['All',...cats].map(c=>`<button class="${habitFilter===c?'on':''}" onclick="habitFilter='${c}';render()">${esc(c)}</button>`).join('')}</div>`;
  if(habitFilter!=='All'&&!cats.includes(habitFilter))habitFilter='All';
  const L=filtered();
  if(habitView==='today'){const d=L.filter(h=>h.completions[todayKey()]==='done').length,p=L.length?Math.round(d/L.length*100):0;
    return html+`<div class="card hero">${ring(p,150,'done')}<div class="hero-t"><b>${d} / ${L.length}</b> habits done</div></div><div class="card list">${L.map(habitRow).join('')}</div>`;}
  return html+renderHistory(L);
}
function renderHistory(L){
  const{y,m}=curMonth(),ks=monthKeys(y,m);
  const nav=`<div class="mnav"><button class="iconbtn" aria-label="Previous month" onclick="histShift(-1)">←</button><h2>${monthLbl(y,m)}</h2><button class="iconbtn" aria-label="Next month" onclick="histShift(1)">→</button></div>`;
  if(!L.length)return nav+empty('Your habit history will appear here as you complete habits.');
  if(!L.find(h=>h.id===histHabit))histHabit=L[0].id;
  const desk=`<div class="card hist-desk"><div class="scroll"><table class="mx"><thead><tr><th>Habit</th>${ks.map((k,i)=>`<th class="${k===todayKey()?'tdy':''}">${i+1}</th>`).join('')}</tr></thead><tbody>${L.map(h=>`<tr><td><button class="link" onclick="openHabit('${h.id}')">${esc(icon(h))} ${esc(h.name)}</button></td>${ks.map(k=>{const s=cellState(h,k),dis=s==='na'||s==='future';
    return `<td><button class="cell ${s}" ${dis?'disabled':''} onclick="histToggle('${h.id}','${k}')" aria-label="${esc(h.name)}, ${shortDate(k)}: ${SLBL[s]}">${SYM[s]||(s==='na'?'—':'')}</button></td>`;}).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  const sel=L.find(h=>h.id===histHabit);
  const mob=`<div class="hist-mob"><div class="chips">${L.map(h=>`<button class="${h.id===histHabit?'on':''}" onclick="histHabit='${h.id}';render()">${esc(icon(h))} ${esc(h.name)}</button>`).join('')}</div><div class="card">${calendar(sel)}</div></div>`;
  return nav+desk+mob+`<p class="legend">✓ completed · ✕ missed · ○ today · – skipped · — not created yet. Tap a day to change it.</p>`;
}
function calendar(h){const{y,m}=curMonth(),lead=new Date(y,m,1).getDay();
  return `<div class="cal">${[...'SMTWTFS'].map(d=>`<i class="cal-h">${d}</i>`).join('')}${'<i></i>'.repeat(lead)}${monthKeys(y,m).map((k,i)=>{const s=cellState(h,k),dis=s==='na'||s==='future';
    return `<button class="cal-d ${s}" ${dis?'disabled':''} onclick="histToggle('${h.id}','${k}')" aria-label="${esc(h.name)}, ${shortDate(k)}: ${SLBL[s]}">${i+1}<em>${SYM[s]}</em></button>`;}).join('')}</div>`;}
function renderHabitDetail(){
  const h=state.habits.find(x=>x.id===detailId);if(!h){habitView='today';return renderHabits();}
  const st=h.completions[todayKey()],r=statsFor(h,lastKeys(30)),{y,m}=curMonth();
  const recent=lastKeys(7).reverse().filter(k=>cellState(h,k)!=='na');
  return `<button class="link back" onclick="setHabitView('today')">← Habits</button>`+pageTop(esc(icon(h))+' '+esc(h.name),esc(h.category)+' · 🔥 '+streakFor(h)+' day streak',`<button class="btn ghost sm" onclick="delHabit('${h.id}')">Delete</button>`)
  +`<div class="card"><button class="bigcheck ${st||''}" onclick="toggleHabit('${h.id}')" aria-pressed="${st==='done'}">${st==='done'?'✓ Completed today':st==='skip'?'– Skipped today':'○ Mark today done'}</button></div>
  <div class="stats">${stat(r.p+'%','Completion (30 days)')}${stat(streakFor(h),'Current streak')}${stat(bestStreak(h),'Best streak')}${stat(totalDone(h),'Total completed')}</div>
  <div class="cols"><div><div class="section-title">Recent activity</div><div class="card list">${recent.map(k=>`<div class="srow"><span class="stime">${shortDate(k)}</span><span class="hname">${SYM[cellState(h,k)]||'○'} ${SLBL[cellState(h,k)]}</span></div>`).join('')}</div></div>
  <div><div class="mnav"><button class="iconbtn" aria-label="Previous month" onclick="histShift(-1)">←</button><h2>${monthLbl(y,m)}</h2><button class="iconbtn" aria-label="Next month" onclick="histShift(1)">→</button></div><div class="card">${calendar(h)}</div></div></div>`;
}

/* ---- PROGRESS (everything computed from real completions) ---- */
function trendSvg(v){const W=600,H=170,L=30,B=22,n=v.length,x=i=>L+(W-L-8)*i/(n-1||1),y=p=>8+(H-8-B)*(1-p/100);
  const pts=v.map((p,i)=>p==null?null:[x(i),y(p)]).filter(Boolean),d=pts.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join('');
  const lab=[0,Math.floor(n/2),n-1].map(i=>`<text x="${x(i)}" y="${H-4}" text-anchor="middle">${shortDate(lastKeys(n)[i])}</text>`).join('');
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily completion, last ${n} days">${[0,50,100].map(g=>`<line x1="${L}" x2="${W-8}" y1="${y(g)}" y2="${y(g)}"/><text x="${L-6}" y="${y(g)+4}" text-anchor="end">${g}</text>`).join('')}${pts.length>1?`<path class="tl" d="${d}"/>`:''}${pts.map(q=>`<circle cx="${q[0]}" cy="${q[1]}" r="3"/>`).join('')}${lab}</svg>`;}
function renderProgress(){
  const H=state.habits,head=pageTop('Progress','Personal performance');
  if(!H.length)return head+empty('Add habits to see your progress here.',`<button class="btn" onclick="openModal('habit')">+ Create Habit</button>`);
  const n=now(),y=n.getFullYear(),m=n.getMonth(),mk=monthKeys(y,m).filter(k=>k<=todayKey());
  let d=0,t=0;H.forEach(h=>{const s=statsFor(h,mk);d+=s.d;t+=s.t;});const mp=t?Math.round(d/t*100):0;
  if(!H.some(h=>totalDone(h)))return head+empty('Complete a habit and your charts will appear here.');
  const wd=[0,0,0,0,0,0,0].map(()=>({d:0,t:0}));
  lastKeys(84).forEach(k=>{const s=dayPct(k),i=new Date(k+'T00:00:00').getDay();wd[i].d+=s.d;wd[i].t+=s.t;});
  const order=[1,2,3,4,5,6,0],dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months=[5,4,3,2,1,0].map(o=>{const dt=new Date(y,m-o,1),ks=monthKeys(dt.getFullYear(),dt.getMonth()).filter(k=>k<=todayKey());let a=0,b=0;H.forEach(h=>{const s=statsFor(h,ks);a+=s.d;b+=s.t;});return{l:dt.toLocaleDateString(undefined,{month:'short'}),p:b?Math.round(a/b*100):0};});
  const perf=H.map(h=>({l:esc(icon(h))+' '+esc(h.name),p:statsFor(h,lastKeys(30)).p})).sort((a,b)=>b.p-a.p);
  return head+`<div class="card hero">${ring(mp,150,'this month')}<div class="hero-t"><b>${d} / ${t}</b> habit-days completed</div></div>
  <div class="stats">${stat(Math.max(0,...H.map(streakFor)),'Current streak')}${stat(Math.max(0,...H.map(bestStreak)),'Best streak')}${stat(H.reduce((a,h)=>a+totalDone(h),0),'Total completed')}${stat(H.length,'Active habits')}</div>
  <div class="card"><h2>Completion trend · 30 days</h2>${trendSvg(lastKeys(30).map(k=>dayPct(k).p))}</div>
  <div class="cols"><div class="card"><h2>Habit performance · 30 days</h2>${bars(perf)}</div>
  <div class="card"><h2>Weekly pattern · 12 weeks</h2>${bars(order.map(i=>({l:dn[i],p:wd[i].t?Math.round(wd[i].d/wd[i].t*100):0})))}</div></div>
  <div class="cols"><div class="card"><h2>Monthly performance</h2>${bars(months)}</div>
  <div class="card"><h2>Goal vs actual · ${monthLbl(y,m)}</h2>${H.map(h=>{const all=monthKeys(y,m).filter(k=>cellState(h,k)!=='na'),got=all.filter(k=>h.completions[k]==='done').length;
    return `<div class="goal"><span>${esc(icon(h))} ${esc(h.name)}</span><span>${got} / ${all.length} days</span><b>${all.length?Math.round(got/all.length*100):0}%</b></div>`;}).join('')}</div></div>`;
}

/* ---- SETTINGS ---- */
async function signOut(){await supabaseClient.auth.signOut();location.reload();}
function renderSettings(){
  const u=window.habitFlowUser;
  return pageTop('Settings','')+`<div class="card"><h2>Account</h2><div class="field"><label for="setName">Your name</label><input id="setName" value="${esc(state.name)}"></div>${u&&u.email?`<p class="meta" style="margin:0 0 12px">${esc(u.email)}</p>`:''}
  <div class="field"><label for="setTheme">Appearance</label><select id="setTheme">${['system','light','dark'].map(x=>`<option value="${x}" ${state.theme===x?'selected':''}>${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div>
  <div class="modalfoot"><button class="btn" onclick="saveSettings()">Save</button><button class="btn ghost" onclick="signOut()">Sign out</button></div></div>
  ${notifSettings()}
  <div class="card"><h2>Data</h2><p class="meta" style="margin-bottom:12px">Habits, history and schedules sync with your account. This only clears the copy stored on this device.</p><button class="btn ghost" onclick="resetAll()">Clear data on this device</button></div>`;
}

render(); // first paint (auth.js re-renders after cloud data loads)
