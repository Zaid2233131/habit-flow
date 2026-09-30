// Habit Flow v5 views: frequency-aware Habit Command Center.
let habitFilter='All',histMonth=null,detailId=null,histHabit=null,habitGridAutoPositioned=false;
const SYM={done:'✓',missed:'✕',today:'○',skip:'–',na:'—',future:'·',available:'·'};
const SLBL={done:'completed',missed:'missed',today:'not done yet',skip:'skipped',na:'not scheduled / not created',future:'upcoming',available:'available'};
const icon=h=>h.icon||'●';
const createdKey=h=>localKey(new Date(h.createdAt));
const lastKeys=n=>[...Array(n)].map((_,i)=>keyOffset(i-n+1));
const monthKeys=(y,m)=>[...Array(new Date(y,m+1,0).getDate())].map((_,i)=>y+'-'+pad(m+1)+'-'+pad(i+1));
const monthLbl=(y,m)=>new Date(y,m,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});
const shortDate=k=>new Date(k+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});

function frequencyLabel(h){const f=parseHabitFrequency(h.frequency);if(f.type==='specific_days')return (f.days||[]).map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(' · ')||'Specific days';if(f.type==='times_per_week')return `${f.count||1}× per week`;if(f.type==='times_per_month')return `${f.count||1}× per month`;return'Every day';}
function freqType(h){return parseHabitFrequency(h.frequency).type;}
function weekStartKey(k){return habitWeekStartKey(k);}
function weekKeys(k){return habitWeekKeys(k);}
function doneInKeys(h,keys){return habitDoneInKeys(h,keys);}
function isFixedScheduled(h,k){const f=parseHabitFrequency(h.frequency);if(f.type==='specific_days')return (f.days||[]).includes(new Date(k+'T00:00:00').getDay());if(f.type==='daily')return true;return false;}
function monthGoalFor(h,y,m,uptoToday=true){
  const all=monthKeys(y,m),n=now(),current=y===n.getFullYear()&&m===n.getMonth(),keys=(uptoToday&&current?all.filter(k=>k<=todayKey()):all).filter(k=>k>=createdKey(h));
  const f=parseHabitFrequency(h.frequency);
  if(f.type==='times_per_week'){
    const groups=new Set(keys.map(weekStartKey));
    return groups.size*Math.max(1,Number(f.count)||1);
  }
  if(f.type==='times_per_month')return keys.length?Math.max(1,Number(f.count)||1):0;
  return keys.filter(k=>isFixedScheduled(h,k)).length;
}
function weekStats(h,k){
  const keys=weekKeys(k).filter(x=>x>=createdKey(h));
  const f=parseHabitFrequency(h.frequency);
  if(f.type==='times_per_week')return{goal:Math.max(1,Number(f.count)||1),got:doneInKeys(h,keys),label:'This week'};
  if(f.type==='times_per_month'){const d=new Date(k+'T00:00:00'),all=monthKeys(d.getFullYear(),d.getMonth()).filter(x=>x>=createdKey(h));return{goal:Math.max(1,Number(f.count)||1),got:doneInKeys(h,all),label:'This month'};}
  const applicable=keys.filter(x=>isFixedScheduled(h,x));
  return{goal:applicable.length,got:doneInKeys(h,applicable),label:'This week'};
}
function monthStats(h,y,m){const goal=monthGoalFor(h,y,m,true);const all=monthKeys(y,m);const n=now(),current=y===n.getFullYear()&&m===n.getMonth(),keys=(current?all.filter(k=>k<=todayKey()):all).filter(k=>k>=createdKey(h));const got=doneInKeys(h,keys);return{goal,got,p:goal?Math.min(100,Math.round(got/goal*100)):0};}
function cellState(h,k){
  const t=todayKey();if(k>t)return'future';if(k<createdKey(h))return'na';
  const s=h.completions[k];if(s==='done')return'done';if(s==='skip')return'skip';
  const f=parseHabitFrequency(h.frequency);
  if(f.type==='specific_days'&&!isFixedScheduled(h,k))return'na';
  if(f.type==='times_per_week'||f.type==='times_per_month')return k===t?'today':'available';
  return k===t?'today':'missed';
}
function statsFor(h,keys){
  const f=parseHabitFrequency(h.frequency);
  if(f.type==='times_per_week'||f.type==='times_per_month'){
    const goal=f.type==='times_per_week'?new Set(keys.filter(k=>k>=createdKey(h)).map(weekStartKey)).size*Math.max(1,Number(f.count)||1):(keys.filter(k=>k>=createdKey(h)).length?Math.max(1,Number(f.count)||1):0);
    const d=doneInKeys(h,keys);return{d,t:goal,p:goal?Math.min(100,Math.round(d/goal*100)):0};
  }
  let d=0,t=0;keys.forEach(k=>{const s=cellState(h,k);if(s==='done'){d++;t++;}else if(s==='missed'||s==='today'){t++;}});return{d,t,p:t?Math.round(d/t*100):0};
}
function bestStreak(h){let best=0,run=0;const d=new Date(createdKey(h)+'T00:00:00'),end=todayKey();for(;localKey(d)<=end;d.setDate(d.getDate()+1)){const k=localKey(d),s=h.completions[k],f=parseHabitFrequency(h.frequency);if(s==='done'){run++;best=Math.max(best,run);}else if(s==='skip'||(f.type==='specific_days'&&!isFixedScheduled(h,k))){}else if(f.type==='times_per_week'||f.type==='times_per_month'){}else run=0;}return best;}
const totalDone=h=>Object.values(h.completions||{}).filter(v=>v==='done').length;
function dayPct(k){let d=0,t=0;state.habits.forEach(h=>{const f=parseHabitFrequency(h.frequency);if(f.type==='times_per_week'||f.type==='times_per_month')return;const s=cellState(h,k);if(s==='done'){d++;t++;}else if(s==='missed'||s==='today'){t++;}});return{d,t,p:t?Math.round(d/t*100):null};}
const filtered=()=>state.habits.filter(h=>habitFilter==='All'||h.category===habitFilter);
function weeklyProgressRows(H,k){return H.map(h=>{const s=weekStats(h,k);return{h,goal:s.goal,got:s.got,p:s.goal?Math.min(100,Math.round(s.got/s.goal*100)):0};});}

async function setCompletion(id,k,next){
  const h=state.habits.find(x=>x.id===id);if(!h)return;
  const s=cellState(h,k);if(s==='na'||s==='future')return;
  const prev=h.completions[k];
  if(next===undefined)delete h.completions[k];else h.completions[k]=next;
  // Preserve the user's horizontal position in the monthly tracker when a cell is toggled.
  // render() replaces the tracker DOM, so without this the scroll container resets to the far left.
  const grid=document.getElementById('habitGridScroll');
  const savedScrollLeft=grid ? grid.scrollLeft : null;
  save();render();
  if(savedScrollLeft!==null){
    requestAnimationFrame(()=>{
      const nextGrid=document.getElementById('habitGridScroll');
      if(nextGrid) nextGrid.scrollLeft=savedScrollLeft;
    });
  }
  const ok=await saveHabitCompletionToCloud(h.id,k,next);
  if(!ok){if(prev===undefined)delete h.completions[k];else h.completions[k]=prev;save();render();toast('Could not sync — change reverted');}
}
const toggleHabit=id=>{const h=state.habits.find(x=>x.id===id);if(h)return setCompletion(id,todayKey(),h.completions[todayKey()]==='done'?undefined:'done');};
const histToggle=(id,k)=>{const h=state.habits.find(x=>x.id===id);if(h)setCompletion(id,k,cellState(h,k)==='done'?undefined:'done');};

function askDelHabit(id){
  const h=state.habits.find(x=>x.id===id);if(!h)return;
  modal(`<h2>Delete "${esc(h.name)}"?</h2><p class="meta" style="margin:0 0 16px;font-size:14px">This will permanently remove this habit and its historical completion data.</p><div class="modalfoot"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn danger" onclick="confirmDelHabit('${id}')">Delete</button></div>`);
}
async function confirmDelHabit(id){
  closeModal();const idx=state.habits.findIndex(x=>x.id===id);if(idx<0)return;const habit=state.habits[idx],unlinked=state.schedules.filter(s=>s.habitId===id);
  state.habits.splice(idx,1);unlinked.forEach(s=>s.habitId=null);if(detailId===id)detailId=null;if(histHabit===id)histHabit=null;if(habitFilter!=='All'&&!state.habits.some(x=>x.category===habitFilter))habitFilter='All';save();render();
  if(await deleteHabitFromCloud(id)){toast('Habit deleted');return;}
  state.habits.splice(Math.min(idx,state.habits.length),0,habit);unlinked.forEach(s=>s.habitId=id);save();render();toast('Could not delete habit — it was kept. Check your connection and try again.',4500);if(typeof loadAllFromCloud==='function')loadAllFromCloud();
}
function openHabit(id){detailId=id;showHabitDetail(id);}
function setHabitView(v){if(v==='history')return;render();}
function histShift(d){const c=curMonth(),dt=new Date(c.y,c.m+d,1);histMonth={y:dt.getFullYear(),m:dt.getMonth()};habitGridAutoPositioned=false;render();}
function curMonth(){if(!histMonth){const n=now();histMonth={y:n.getFullYear(),m:n.getMonth()};}return histMonth;}
function goCurrentMonth(){const n=now();histMonth={y:n.getFullYear(),m:n.getMonth()};habitGridAutoPositioned=false;render();}

const pageTop=(t,sub,right)=>`<div class="topbar"><div><h1>${t}</h1><p class="sub">${sub||''}</p></div><div class="topright">${right||''}</div></div>`;
function ring(p,size,sub){const r=size/2-9,c=2*Math.PI*r;return `<div class="ring" style="width:${size}px;height:${size}px" role="img" aria-label="${p}% ${sub}"><svg viewBox="0 0 ${size} ${size}"><circle class="rg-bg" cx="${size/2}" cy="${size/2}" r="${r}"/><circle class="rg-fg" cx="${size/2}" cy="${size/2}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-p/100)}" transform="rotate(-90 ${size/2} ${size/2})"/></svg><div class="ring-c"><b>${p}%</b><span>${sub}</span></div></div>`;}
function stat(v,l){return `<div class="stat"><b>${v}</b><span>${l}</span></div>`;}
function empty(msg,btn){return `<div class="card empty"><p>${msg}</p>${btn||''}</div>`;}
function habitRow(h,canDelete=true){const st=h.completions[todayKey()],nm=esc(h.name);return `<div class="hrow"><button class="hcheck ${st||''}" aria-pressed="${st==='done'}" aria-label="${st==='done'?'Mark '+nm+' not done':'Mark '+nm+' done'}" onclick="toggleHabit('${h.id}')">${SYM[st]||''}</button><button class="hmain" onclick="openHabit('${h.id}')"><span class="hicon">${esc(icon(h))}</span><span class="hname ${st==='done'?'strike':''}">${nm}<small>${esc(h.category)} · ${esc(frequencyLabel(h))}</small></span><span class="flame">🔥 ${streakFor(h)}</span></button>${canDelete?`<button class="rowdel" aria-label="Delete ${nm}" title="Delete habit" onclick="askDelHabit('${h.id}')">🗑</button>`:''}</div>`;}
function bars(rows){return rows.map(r=>`<div class="prow"><span class="pl">${r.l}</span><div class="ptrack"><i style="width:${Math.max(0,Math.min(100,r.p||0))}%"></i></div><b>${r.p}%</b></div>`).join('');}

/* ---- HOW TO USE ---- */
function openHowToUse(){
  const sections=[
    ['🚀','Getting Started',`<p>Habit Flow is your personal system for planning your day, building habits, managing your schedule, and tracking consistency.</p><ol><li>Create your important habits.</li><li>Add the activities you want to schedule.</li><li>Allow notifications so Habit Flow can remind you.</li><li>Check <b>Today</b> and follow your plan.</li></ol>`],
    ['📅','Plan Your Schedule',`<p>Use <b>Schedule</b> to decide when important activities happen.</p><div class="guide-example"><b>Example</b><br>🏋️ Workout — 7:00 AM<br>📚 Study — 10:00 AM<br>💻 Work — 2:00 PM</div><p>Giving an activity a specific time turns an intention into something you can actually act on. Keep your schedule realistic and leave room for rest and unexpected work.</p>`],
    ['🔥','Build Habits',`<p>Create the behaviors you want to repeat consistently.</p><div class="guide-list"><span>Every day</span><small>Example: Read every day</small><span>Specific days</span><small>Example: Gardening Tuesday + Thursday</small><span>Times per week</span><small>Example: Workout 4× per week</small><span>Times per month</span><small>Example: Long run 8× per month</small></div><p>Choose the frequency that matches your real routine instead of creating an unrealistic one.</p>`],
    ['✅','Complete Your Habits',`<p>Your tracker uses simple status indicators:</p><div class="guide-status"><span><b>✓</b> Completed</span><span><b>○</b> Scheduled today</span><span><b>✕</b> Missed</span><span><b>—</b> Not scheduled</span></div><p>A habit scheduled only for Tuesday is not treated as missed on Wednesday. Habit Flow follows the frequency you configured.</p>`],
    ['🔔','Use Reminders',`<p>Notifications help you remember what needs to be done when your day gets busy.</p><p>When a reminder appears:</p><div class="guide-flow"><b>See the reminder</b><span>→</span><b>Start the task</b><span>→</span><b>Complete it</b></div><p>The reminder is a trigger to take action — not the goal itself.</p>`],
    ['📊','Check Your Progress',`<p>Use <b>Progress</b> and the habit dashboard to understand your consistency.</p><ul><li>Which habits are going well?</li><li>Which habits are difficult to maintain?</li><li>Are you actually following your schedule?</li><li>Where are you losing time?</li></ul><p>Use the data to improve your routine rather than judging yourself from one bad day.</p>`],
    ['🗓️','Use Today as Your Control Center',`<p><b>Today</b> is the place to start your day.</p><div class="guide-routine"><b>Morning</b><span>Check Today and understand the plan.</span><b>During the day</b><span>Follow your schedule and complete habits.</span><b>Evening</b><span>Review what you completed and what you missed.</span></div><p><b>Plan → Execute → Track → Improve → Repeat</b></p>`],
    ['⏰','Protect Your Time',`<p>Productivity does not mean filling every minute with work.</p><p>Leave space for <b>rest, meals, travel, unexpected work, and personal time</b>.</p><p>A realistic schedule you can follow consistently is more useful than a perfect schedule you abandon after three days.</p>`],
    ['🎯','Start With Fewer, Better Habits',`<p>Don't start with dozens of habits. Begin with the behaviors that have the biggest impact.</p><div class="guide-example"><b>Health:</b> Workout · Sleep on time<br><b>Education:</b> Study · Practice coding<br><b>Personal:</b> Read · Journal<br><b>Spiritual:</b> Prayer · Quran reading</div><p>Once your routine becomes stable, gradually add more.</p>`],
    ['🧠','Build Discipline',`<p>Discipline is not about feeling motivated every day. Some days you will feel motivated and some days you won't.</p><p>Habit Flow helps you follow the system you decided on even when motivation is low.</p><div class="guide-quote">“Is this something I decided was important?”</div><p>If the answer is yes, follow the plan.</p>`],
    ['🔄',"Don't Let One Bad Day Become a Bad Week",`<p>Missing a habit does not mean you failed.</p><div class="guide-restart"><b>Miss one day?</b><span>Return tomorrow.</span><b>Miss a few days?</b><span>Restart with the next action.</span><b>Don't wait</b><span>You don't need to wait for Monday or next month.</span></div><p><b>Consistency isn't perfection. It's the ability to keep returning to your routine.</b></p>`],
    ['🏆','A Simple Habit Flow Routine',`<div class="guide-routine"><b>🌅 Morning</b><span>Open Today and review what matters.</span><b>☀️ During the day</b><span>Follow your schedule, respond to reminders, and mark habits complete.</span><b>🌙 Evening</b><span>Review your progress and prepare for tomorrow.</span></div>`],
    ['💡','The 5 Rules of Habit Flow',`<div class="guide-rules"><b>1. Plan it.</b><span>If something matters, give it a place in your schedule.</span><b>2. Start it.</b><span>Don't wait for perfect motivation.</span><b>3. Track it.</b><span>Use your tracker to see what is actually happening.</span><b>4. Review it.</b><span>Find what is working and what needs to change.</span><b>5. Repeat it.</b><span>Discipline is built through repetition.</span></div>`],
    ['🚀','Remember',`<div class="guide-final"><b>Habit Flow doesn't control your life.</b><p>You control the plan. Habit Flow helps you remember it, follow it, and understand your progress.</p><strong>Plan your time.<br>Build your habits.<br>Do the work.<br>Track your progress.<br>Keep going.</strong><p>Welcome to Habit Flow.</p></div>`]
  ];
  const body=sections.map((x,i)=>`<section class="guide-section"><div class="guide-heading"><span>${x[0]}</span><div><div class="eyebrow">${String(i+1).padStart(2,'0')}</div><h3>${x[1]}</h3></div></div>${x[2]}</section>`).join('');
  modal(`<div class="howto-modal"><div class="modal-head"><div><div class="eyebrow">HABIT FLOW GUIDE</div><h2>How to Use Habit Flow</h2><p class="sub">Build your routine. Protect your time. Stay consistent.</p></div><button class="iconbtn" onclick="closeModal()" aria-label="Close guide">×</button></div><div class="guide-quick"><b>New here? Start with these 5 steps</b><span>1. Create habits</span><span>2. Add your schedule</span><span>3. Enable notifications</span><span>4. Check Today</span><span>5. Track and review</span></div><div class="guide-content">${body}</div><div class="modalfoot"><button class="btn" onclick="closeModal()">Got it</button></div></div>`);
}

/* ---- TODAY ---- */
function renderToday(){
  const t=todayKey(),H=state.habits,sx=schedProgress(),doneH=H.filter(h=>h.completions[t]==='done').length,total=H.length+sx.t,done=doneH+sx.d,pct=total?Math.round(done/total*100):0;
  const items=itemsFor(t).sort((a,b)=>slot(a,t).s-slot(b,t).s),n=now(),best=Math.max(0,...H.map(streakFor));
  let html=pageTop(greeting()+', '+esc(state.name),fmtLong(t),bellBtn());
  html+=total?`<div class="card hero"><div class="today-ring">${ring(pct,132,'today')}</div><div class="hero-t"><b>${done} / ${total}</b> completed${best?`<div class="chip">🔥 ${best} day streak</div>`:''}</div></div>`:empty('Nothing planned yet. Build your first habit.',`<button class="btn" onclick="openModal('habit')">+ Create Habit</button>`);
  html+=`<button class="howto-card" onclick="openHowToUse()" aria-label="Open How to Use Habit Flow guide"><span class="howto-icon">📖</span><span class="howto-copy"><b>How to Use Habit Flow</b><small>Learn how to plan, build habits, use reminders, and stay consistent.</small></span><span class="howto-arrow">→</span></button>`;
  html+=`<div class="cols"><div><div class="section-title">Today's habits</div>${H.length?`<div class="card list">${H.map(h=>habitRow(h,true)).join('')}</div>`:empty('No habits yet.')}</div><div><div class="section-title">Today's schedule</div>${items.length?`<div class="card list">${items.slice(0,8).map(it=>{const s=getScheduleStatus(it,t,n);return `<div class="srow"><span class="stime">${fmtT(slot(it,t).s)}</span><span class="hname">${esc(it.title)}</span><span class="tag t-${s}">${STL[s]||s}</span></div>`;}).join('')}<button class="link" onclick="page='schedule';render()">Open schedule →</button></div>`:empty('Plan your day.',`<button class="btn" onclick="openModal('schedule')">+ Add Schedule</button>`)}</div></div>`;
  return html;
}

/* ---- HABIT COMMAND CENTER ---- */
function monthGoalKeys(h,y,m){return monthKeys(y,m).filter(k=>k<=todayKey()||y<now().getFullYear()||(y===now().getFullYear()&&m<now().getMonth())).filter(k=>k>=createdKey(h));}
function habitMonthStats(h,keys){return statsFor(h,keys);}
function monthSummary(H,ks){let done=0,total=0;H.forEach(h=>{const s=habitMonthStats(h,ks);done+=Math.min(s.d,s.t);total+=s.t;});return{done,total,p:total?Math.round(done/total*100):0};}
function weekGroups(ks){const groups=[];let current=null;const firstDay=ks.length?new Date(ks[0]+'T00:00:00').getDay():0;ks.forEach((k,i)=>{const week=Math.floor((firstDay+i)/7);if(current!==week){current=week;groups.push([]);}groups[groups.length-1].push(k);});return groups;}
function monthGrid(H,ks){
  const groups=weekGroups(ks);
  let top=`<div class="habit-grid-scroll" id="habitGridScroll"><table class="habit-grid"><thead><tr><th class="habit-sticky" rowspan="2">My Habits</th>${groups.map((g,i)=>`<th class="week-head" colspan="${g.length}">Week ${i+1}</th>`).join('')}</tr><tr>${groups.flat().map(k=>{const d=new Date(k+'T00:00:00');return `<th class="day-head ${k===todayKey()?'is-today':''}" data-date="${k}" onclick="openDayDetail('${k}')"><span>${['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()]}</span><b>${d.getDate()}</b></th>`;}).join('')}</tr></thead><tbody>`;
  H.forEach(h=>{top+=`<tr><td class="habit-sticky habit-name-cell"><button class="habit-name-link" onclick="openHabit('${h.id}')"><span>${esc(icon(h))}</span><span>${esc(h.name)}<small>${esc(h.category)}</small></span></button></td>${ks.map(k=>{const s=cellState(h,k),disabled=s==='na'||s==='future';return `<td class="habit-cell-wrap"><button class="habit-cell ${s}" ${disabled?'disabled':''} onclick="histToggle('${h.id}','${k}')" aria-label="${esc(h.name)}, ${shortDate(k)}: ${SLBL[s]}">${SYM[s]||''}</button></td>`;}).join('')}</tr>`;});
  top+='</tbody><tfoot>';
  const daily=ks.map(k=>dayPct(k));
  top+=`<tr class="summary-row progress-row"><td class="habit-sticky">Progress</td>${daily.map(x=>`<td><span>${x.p===null?'—':x.p+'%'}</span></td>`).join('')}</tr>`;
  top+=`<tr class="summary-row"><td class="habit-sticky">Done</td>${daily.map(x=>`<td>${x.d||0}</td>`).join('')}</tr>`;
  top+=`<tr class="summary-row"><td class="habit-sticky">Not Done</td>${daily.map(x=>`<td>${Math.max(0,(x.t||0)-(x.d||0))}</td>`).join('')}</tr>`;
  top+='</tfoot></table></div>';
  return top;
}
function monthTrendSvg(ks){
  const vals=ks.map(k=>dayPct(k).p),W=900,H=220,L=40,R=18,T=18,B=32,n=vals.length||1,x=i=>L+(W-L-R)*(i/(n-1||1)),y=p=>T+(H-T-B)*(1-(p||0)/100);
  const pts=vals.map((p,i)=>p===null?null:[x(i),y(p)]).filter(Boolean),d=pts.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join('');
  const area=pts.length>1?`${d} L ${pts[pts.length-1][0].toFixed(1)} ${H-B} L ${pts[0][0].toFixed(1)} ${H-B} Z`:'';
  return `<svg class="month-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily habit completion for ${monthLbl(curMonth().y,curMonth().m)}">${[0,25,50,75,100].map(g=>`<line x1="${L}" x2="${W-R}" y1="${y(g)}" y2="${y(g)}"/><text x="${L-8}" y="${y(g)+4}" text-anchor="end">${g}%</text>`).join('')}${area?`<path class="trend-area" d="${area}"/>`:''}${pts.length?`<path class="trend-line" d="${d}"/>`:''}${pts.map(q=>`<circle cx="${q[0]}" cy="${q[1]}" r="3.2"/>`).join('')}${[0,Math.floor((n-1)/2),n-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>`<text class="xlab" x="${x(i)}" y="${H-8}" text-anchor="middle">${new Date(ks[i]+'T00:00:00').getDate()}</text>`).join('')}</svg>`;
}
function goalRows(H,y,m){return H.map(h=>{const s=monthStats(h,y,m);return{h,goal:s.goal,got:s.got,p:s.p};}).sort((a,b)=>b.p-a.p);}
function openDayDetail(k){
  const rows=state.habits.map(h=>({h,s:cellState(h,k)})).filter(x=>x.s!=='na'&&x.s!=='future');
  const d=dayPct(k),title=fmtLong(k);
  modal(`<div class="detail-modal"><div class="modal-head"><div><div class="eyebrow">DAY DETAIL</div><h2>${title}</h2></div><button class="iconbtn" onclick="closeModal()">×</button></div><div class="day-score"><b>${d.p===null?'—':d.p+'%'}</b><span>${d.d} / ${d.t} completed</span></div><div class="detail-list">${rows.length?rows.map(x=>`<div class="detail-item"><span class="mini-state ${x.s}">${SYM[x.s]}</span><button onclick="closeModal();openHabit('${x.h.id}')">${esc(icon(x.h))} ${esc(x.h.name)}</button><span class="meta">${SLBL[x.s]}</span></div>`).join(''):'<div class="meta">No habits were active on this date.</div>'}</div></div>`);
}
function showHabitDetail(id){
  const h=state.habits.find(x=>x.id===id);if(!h)return;const c=curMonth(),keys=monthGoalKeys(h,c.y,c.m),s=monthStats(h,c.y,c.m),wk=weekStats(h,todayKey()),recent=lastKeys(7).reverse().filter(k=>cellState(h,k)!=='na'),st=streakFor(h),best=bestStreak(h);
  modal(`<div class="detail-modal"><div class="modal-head"><div><div class="eyebrow">HABIT DETAIL</div><h2>${esc(icon(h))} ${esc(h.name)}</h2><p class="sub">${esc(h.category)} · ${esc(frequencyLabel(h))}</p></div><button class="iconbtn" onclick="closeModal()">×</button></div><div class="habit-detail-stats">${stat(s.p+'%',monthLbl(c.y,c.m))}${stat(wk.got+' / '+wk.goal,'This week')}${stat(st+' days','Current streak')}${stat(best+' days','Best streak')}</div><div class="goal-detail"><div><span>Monthly goal</span><b>${s.goal||0}</b></div><div><span>Actual</span><b>${s.got}</b></div><div><span>Progress</span><b>${s.p}%</b></div></div><div class="detail-section"><div class="section-title">Recent activity</div><div class="detail-list">${recent.map(k=>`<div class="detail-item"><span class="mini-state ${cellState(h,k)}">${SYM[cellState(h,k)]}</span><span>${shortDate(k)}</span><span class="meta">${SLBL[cellState(h,k)]}</span></div>`).join('')}</div></div><div class="modalfoot"><button class="btn ghost" onclick="closeModal()">Close</button><button class="btn danger" onclick="closeModal();askDelHabit('${id}')">Delete habit</button></div></div>`);
}
function renderHabits(){
  const c=curMonth(),allKeys=monthKeys(c.y,c.m),pastKeys=allKeys.filter(k=>k<=todayKey()),H=filtered();
  let html=pageTop('Habits','Monthly habit command center',`<button class="btn" onclick="openModal('habit')">+ New habit</button>`);
  if(!state.habits.length)return html+empty('Build your first habit and track the month in one place.',`<button class="btn" onclick="openModal('habit')">+ Create Habit</button>`);
  const cats=[...new Set(state.habits.map(h=>h.category))];
  html+=`<div class="month-toolbar"><button class="iconbtn" onclick="histShift(-1)" aria-label="Previous month">←</button><div class="month-title"><h2>${monthLbl(c.y,c.m)}</h2>${c.y===now().getFullYear()&&c.m===now().getMonth()?'':`<button class="link" onclick="goCurrentMonth()">Back to current month</button>`}</div><button class="iconbtn" onclick="histShift(1)" aria-label="Next month">→</button></div>`;
  if(cats.length>1)html+=`<div class="chips habit-filters">${['All',...cats].map(x=>`<button class="${habitFilter===x?'on':''}" onclick="habitFilter='${esc(x)}';render()">${esc(x)}</button>`).join('')}</div>`;
  const summary=monthSummary(H,pastKeys),best=Math.max(0,...H.map(streakFor)),completed=summary.done;
  html+=`<div class="month-summary"><div class="summary-stat"><b>${H.length}</b><span>Active habits</span></div><div class="summary-stat"><b>${completed}</b><span>Completed check-ins</span></div><div class="summary-stat"><b>${summary.p}%</b><span>Goal completion</span></div><div class="summary-stat"><b>🔥 ${best}</b><span>Best current streak</span></div><div class="summary-progress"><div><span>Monthly goal completion</span><b>${summary.p}%</b></div><div class="track"><div class="fill" style="width:${summary.p}%"></div></div></div></div>`;
  html+=`<section class="dashboard-section"><div class="section-heading"><div><div class="eyebrow">MONTHLY TRACKER</div><h2>My Habits</h2></div><span class="meta">Tap any cell to update it</span></div><div class="card grid-card">${monthGrid(H,allKeys)}</div><p class="legend">✓ completed · ✕ missed · ○ today · · available · – skipped · — not scheduled / not created yet · tap a date for its daily breakdown</p></section>`;
  const weekly=weeklyProgressRows(H,todayKey());
  html+=`<section class="card weekly-card"><div class="section-heading"><div><div class="eyebrow">THIS WEEK</div><h2>Weekly progress</h2></div><span class="meta">Flexible habits use their configured quota</span></div>${weekly.map(r=>`<div class="weekly-row"><div class="weekly-name"><span>${esc(icon(r.h))}</span><div><b>${esc(r.h.name)}</b><small>${esc(frequencyLabel(r.h))}</small></div></div><div class="analysis-bar"><div class="ptrack"><i style="width:${r.p}%"></i></div><small>${r.got} / ${r.goal}</small></div><strong>${r.p}%</strong></div>`).join('')}</section>`;
  html+=`<div class="dashboard-two"><section class="card analysis-card"><div class="section-heading"><div><div class="eyebrow">ANALYSIS</div><h2>Goal vs Actual</h2></div></div>${goalRows(H,c.y,c.m).map(r=>`<div class="analysis-row"><div class="analysis-name"><span>${esc(icon(r.h))}</span><b>${esc(r.h.name)}</b><small>${esc(frequencyLabel(r.h))}</small></div><div class="analysis-bar"><div class="ptrack"><i style="width:${r.p}%"></i></div><small>${r.got} / ${r.goal}</small></div><strong>${r.p}%</strong></div>`).join('')}</section><section class="card top-card"><div class="section-heading"><div><div class="eyebrow">TOP HABITS</div><h2>Best this month</h2></div></div>${goalRows(H,c.y,c.m).slice(0,5).map((r,i)=>`<div class="top-row"><span class="rank">${i<3?['🥇','🥈','🥉'][i]:String(i+1).padStart(2,'0')}</span><span>${esc(icon(r.h))} ${esc(r.h.name)}</span><b>${r.p}%</b></div>`).join('')}</section></div>`;
  html+=`<section class="card chart-card"><div class="section-heading"><div><div class="eyebrow">CONSISTENCY</div><h2>Daily completion</h2></div><span class="meta">Scheduled daily/specific-day habits</span></div>${monthTrendSvg(allKeys)}</section>`;
  return html;
}

/* ---- PROGRESS ---- */
function trendSvg(v){const W=600,H=170,L=30,B=22,n=v.length,x=i=>L+(W-L-8)*i/(n-1||1),y=p=>8+(H-8-B)*(1-p/100);const pts=v.map((p,i)=>p==null?null:[x(i),y(p)]).filter(Boolean),d=pts.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join('');const lab=[0,Math.floor(n/2),n-1].map(i=>`<text x="${x(i)}" y="${H-4}" text-anchor="middle">${shortDate(lastKeys(n)[i])}</text>`).join('');return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily completion, last ${n} days">${[0,50,100].map(g=>`<line x1="${L}" x2="${W-8}" y1="${y(g)}" y2="${y(g)}"/><text x="${L-6}" y="${y(g)+4}" text-anchor="end">${g}</text>`).join('')}${pts.length>1?`<path class="tl" d="${d}"/>`:''}${pts.map(q=>`<circle cx="${q[0]}" cy="${q[1]}" r="3"/>`).join('')}${lab}</svg>`;}
function renderProgress(){
  const H=state.habits,head=pageTop('Progress','Long-term performance');if(!H.length)return head+empty('Add habits to see your long-term progress.',`<button class="btn" onclick="openModal('habit')">+ Create Habit</button>`);
  const n=now(),y=n.getFullYear(),m=n.getMonth(),mk=monthKeys(y,m).filter(k=>k<=todayKey());let d=0,t=0;H.forEach(h=>{const s=statsFor(h,mk);d+=s.d;t+=s.t;});const mp=t?Math.round(d/t*100):0;
  const wd=[0,0,0,0,0,0,0].map(()=>({d:0,t:0}));lastKeys(84).forEach(k=>{const s=dayPct(k),i=new Date(k+'T00:00:00').getDay();wd[i].d+=s.d;wd[i].t+=s.t;});const order=[1,2,3,4,5,6,0],dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months=[5,4,3,2,1,0].map(o=>{const dt=new Date(y,m-o,1),ks=monthKeys(dt.getFullYear(),dt.getMonth()).filter(k=>k<=todayKey());let a=0,b=0;H.forEach(h=>{const s=statsFor(h,ks);a+=s.d;b+=s.t;});return{l:dt.toLocaleDateString(undefined,{month:'short'}),p:b?Math.round(a/b*100):0};});
  const perf=H.map(h=>({l:esc(icon(h))+' '+esc(h.name),p:statsFor(h,lastKeys(30)).p})).sort((a,b)=>b.p-a.p);
  return head+`<div class="card hero"><div class="today-ring">${ring(mp,132,'this month')}</div><div class="hero-t"><b>${d} / ${t}</b> habit-days completed</div></div><div class="stats">${stat(Math.max(0,...H.map(streakFor)),'Current streak')}${stat(Math.max(0,...H.map(bestStreak)),'Best streak')}${stat(H.reduce((a,h)=>a+totalDone(h),0),'Total completed')}${stat(H.length,'Active habits')}</div><div class="card"><h2>Completion trend · 30 days</h2>${trendSvg(lastKeys(30).map(k=>dayPct(k).p))}</div><div class="cols"><div class="card"><h2>Habit performance · 30 days</h2>${bars(perf)}</div><div class="card"><h2>Weekly pattern · 12 weeks</h2>${bars(order.map(i=>({l:dn[i],p:wd[i].t?Math.round(wd[i].d/wd[i].t*100):0})))}</div></div><div class="cols"><div class="card"><h2>Monthly performance</h2>${bars(months)}</div><div class="card"><h2>Goal vs actual · ${monthLbl(y,m)}</h2>${goalRows(H,y,m).map(r=>`<div class="goal"><span>${esc(icon(r.h))} ${esc(r.h.name)}</span><span>${r.got} / ${r.goal} days</span><b>${r.p}%</b></div>`).join('')}</div></div>`;
}

/* ---- SETTINGS ---- */
async function signOut(){await supabaseClient.auth.signOut();location.reload();}
function renderSettings(){const u=window.habitFlowUser;return pageTop('Settings','')+`<div class="card"><h2>Account</h2><div class="field"><label for="setName">Your name</label><input id="setName" value="${esc(state.name)}"></div>${u&&u.email?`<p class="meta" style="margin:0 0 12px">${esc(u.email)}</p>`:''}<div class="field"><label for="setTheme">Appearance</label><select id="setTheme">${['system','light','dark'].map(x=>`<option value="${x}" ${state.theme===x?'selected':''}>${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div><div class="modalfoot"><button class="btn" onclick="saveSettings()">Save</button><button class="btn ghost" onclick="signOut()">Sign out</button></div></div>${notifSettings()}<div class="card"><h2>Data</h2><p class="meta" style="margin-bottom:12px">Habits, history and schedules sync with your account. This only clears the copy stored on this device.</p><button class="btn ghost" onclick="resetAll()">Clear data on this device</button></div>`;}

render();
