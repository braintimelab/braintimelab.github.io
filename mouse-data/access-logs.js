/* Owner-only, transient log view. No access log data is persisted in this browser. */
const mounts=new WeakMap();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const apps={'lab-tools':'Lab tools',mouse:'Mouse Data',reagents:'Reagents',notes:'Lab Notes',calculator:'Braintime Calculator'},events={sign_in:'Account signed in',session_start:'App session opened',page_view:'Section opened',sign_out:'Sign-out requested'};
const sections={tools:'Lab tools',home:'Home',announcements:'Announcements',calendar:'Lab calendar',bookings:'Bookings',personal:'Personal space',board:'Boards',duties:'Lab duties','lab-meetings':'Lab Meeting','journal-club':'Journal Club',resources:'Resources',page:'Shared page',notes:'Shared pages',pages:'Shared pages',inbox:'In-Note',calculator:'Calculator',overview:'Overview',mice:'Mice',strains:'Strains',matings:'Breeding',litters:'Litters',cages:'Cages',family:'Family tree',planner:'Planning',experiments:'Experiments',iacuc:'IACUC',housing:'Housing & light',locobox:'Locobox',cryo:'Cryopreservation',fees:'LAC fees',archive:'Source archive',brainbot:'Braintime Bot (BB)',settings:'Settings',inventory:'Inventory',safety:'Chemical safety',usage:'Usage',orders:'Orders',vendors:'Vendors',equipment:'Equipment',history:'History',review:'Review'};
const EXCLUDE_OWNER='all_except_owner';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decimal=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
const feedCursor=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&Object.hasOwn(value,'cloud1')&&Object.hasOwn(value,'nas')&&[value.cloud1,value.nas].every(v=>v===null||v==='start'||decimal(v));
/** Independent cursors retain overlapping ID sequences and isolate source outages. */
export async function loadAccessFeed(hooks,filters){
 const before=filters.before;if(before!==null&&!feedCursor(before))throw new Error('Access log cursor is invalid.');
 const cloudApp=!filters.app||['mouse','reagents','lab-tools'].includes(filters.app),nasApp=!filters.app||['notes','calculator'].includes(filters.app),cloudEvents=filters.event!=='sign_in';
 const cloudActive=cloudApp&&cloudEvents&&(!before||before.cloud1!==null),nasActive=nasApp&&(!before||before.nas!==null);
 const cloudFilters=cloudActive?{...filters,before:before?.cloud1==='start'?null:before?.cloud1??null}:{...filters,app:null,event:null,before:null,limit:1};
 const requests=[Promise.resolve().then(()=>hooks.listLogs(cloudFilters)),nasActive?Promise.resolve().then(()=>hooks.listNasLogs({...filters,before:before?.nas==='start'?null:before?.nas??null})):Promise.resolve(null)];
 const replies=await Promise.allSettled(requests),names=['Cloud 1','BraintimeDisk'],warnings=[],rows=[],users=new Map(),next={cloud1:null,nas:null},starts=[];let readable=0;
 for(let i=0;i<replies.length;i++){
  const reply=replies[i];if(reply.status==='rejected'){warnings.push(names[i]+' access records unavailable. Other records remain visible.');if((i===0&&cloudActive)||(i===1&&nasActive))next[i===0?'cloud1':'nas']=before?.[i===0?'cloud1':'nas']??'start';continue;}
  if(reply.value===null)continue;
  try{const value=verify(reply.value);if(i===1&&(value.source!=='nas'||value.available!==true||value.loggingAvailable!==true))throw Error();readable++;
   for(const person of value.users||[]){const old=users.get(person.user_id);if(!old){users.set(person.user_id,{...person});continue;}
    // Cloud 1 supplies the canonical identity and owner flags. Sign-in facts
    // may be newer on BraintimeDisk without representing a Cloud 1 login.
    const latest=person.last_sign_in_at&&(!old.last_sign_in_at||Date.parse(person.last_sign_in_at)>Date.parse(old.last_sign_in_at))?person.last_sign_in_at:old.last_sign_in_at;
    users.set(person.user_id,{...old,last_sign_in_at:latest});
   }
   const active=i===0?cloudActive:nasActive;if(active){rows.push(...value.events.map(row=>({...row,log_origin:i===0?'cloud1':'nas'})));if(value.has_more)next[i===0?'cloud1':'nas']=value.next_before;starts.push(value.logging_started_at);}
  }catch{warnings.push(names[i]+' access records could not be verified.');if((i===0&&cloudActive)||(i===1&&nasActive))next[i===0?'cloud1':'nas']=before?.[i===0?'cloud1':'nas']??'start';}
 }
 if(!readable)throw new Error('Access records are unavailable. Refresh to try again.');
 rows.sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at));const more=next.cloud1!==null||next.nas!==null;
 return {events:rows,users:[...users.values()],has_more:more,next_before:more?next:null,logging_started_at:starts.sort((a,b)=>Date.parse(a)-Date.parse(b))[0]||new Date().toISOString(),warnings};
}
const stamp=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date):'Not recorded';};
// Resolve display labels only from this owner's current verified UUID directory.
// Historical event fields remain unchanged, and email addresses are never keys.
const identityText=value=>typeof value==='string'?value.trim():'';
const personalName=value=>{const text=identityText(value);return text&&!text.includes('@')&&!uuid.test(text)?text:'';};
function displayPerson(row,directory){
 const person=directory.get(row.user_id);if(!person)return row;
 return {...row,name:personalName(person.name)||personalName(row.name)||identityText(person.name)||identityText(row.name),acronym:identityText(person.acronym)||identityText(row.acronym),email:identityText(person.email)||identityText(row.email)};
}
const identity=row=>[identityText(row.name),identityText(row.acronym)?`(${identityText(row.acronym)})`:null].filter(Boolean).join(' ')||identityText(row.email)||row.user_id;
export function accessDateRange(from,to){
 const parse=value=>{if(!value)return null;const date=new Date(`${value}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new Error('Choose valid dates.');return value;};
 const start=parse(from),end=parse(to);if(start&&end&&start>end)throw new Error('From must be on or before To.');
 return {from:start?`${start}T00:00:00+08:00`:null,to:end?new Date(Date.parse(`${end}T00:00:00+08:00`)+86400000).toISOString():null};
}
function verify(result,{federated=false}={}){
 if(!result||!Array.isArray(result.events)||result.events.length>(federated?100:50)||typeof result.has_more!=='boolean'||(result.next_before!==null&&!(federated?feedCursor(result.next_before):decimal(result.next_before)))||!Number.isFinite(Date.parse(result.logging_started_at))||result.has_more&&!result.next_before)throw new Error('Access logs could not be verified. Refresh to try again.');
 for(const row of result.events)if(!row||!decimal(row.access_id)||!uuid.test(row.user_id||'')||!Object.hasOwn(apps,row.app)||!Object.hasOwn(events,row.event)||typeof row.page!=='string'||row.page.length>64||!Number.isFinite(Date.parse(row.occurred_at)))throw new Error('An access log entry could not be verified.');
 if(result.users!==undefined){
  if(!Array.isArray(result.users))throw new Error('Account sign-ins could not be verified.');
  const seen=new Set();
  for(const person of result.users){
   if(!person||!uuid.test(person.user_id||'')||seen.has(person.user_id)||person.last_sign_in_at!=null&&!Number.isFinite(Date.parse(person.last_sign_in_at))||person.is_owner!==undefined&&typeof person.is_owner!=='boolean')throw new Error('An account sign-in could not be verified.');
   seen.add(person.user_id);
  }
 }
 return result;
}
export function renderAccessLogs(container,hooks={}){
 const context=String(hooks.getContext?.()||''),state={open:false,loading:false,dirty:false,warnings:[],rows:[],users:new Map(),directory:new Map(),accounts:null,appliedUserId:'',before:null,hasMore:false,started:null,updatedAt:null,error:'',filters:{app:Object.hasOwn(apps,hooks.initialApp)?hooks.initialApp:'',userId:EXCLUDE_OWNER,event:'',from:'',to:''}};let requestVersion=0;mounts.set(container,state);
 const attached=()=>mounts.get(container)===state&&container.isConnected!==false;
 const authorized=()=>hooks.getRole?.()==='owner'&&String(hooks.getContext?.()||'')===context;
 const clear=()=>{state.warnings=[];state.rows=[];state.users.clear();state.directory.clear();state.accounts=null;state.appliedUserId='';state.before=null;state.hasMore=false;state.started=null;state.updatedAt=null;};
 const signIns=()=>state.accounts===null?'':`<details class="source-disclosure" open><summary>Account sign-ins</summary><p class="small muted">Latest authentication across lab tools; separate from visits below.</p><div class="table-scroll"><table><thead><tr><th>User</th><th>Last sign-in (Taipei)</th></tr></thead><tbody>${state.accounts.filter(person=>state.appliedUserId===EXCLUDE_OWNER?!person.is_owner:!state.appliedUserId||person.user_id===state.appliedUserId).map(person=>`<tr><td>${esc(identity(person))}${person.email?`<div class="small muted">${esc(person.email)}</div>`:''}</td><td>${person.last_sign_in_at?esc(stamp(person.last_sign_in_at)):'—'}</td></tr>`).join('')}</tbody></table></div></details><h3>App activity</h3>`;
 const button=(action,label)=>`<button type="button" class="button secondary" data-access-action="${action}"${state.loading||action==='more'&&state.dirty?' disabled':''}>${esc(label)}</button>`;
 const select=(key,label,options)=>`<div class="field"><label for="access-log-${key}">${label}</label><select id="access-log-${key}" data-access-filter="${key}"${state.loading?' disabled':''}>${Object.entries(options).map(([keyValue,text])=>`<option value="${esc(keyValue)}"${state.filters[key]===keyValue?' selected':''}>${esc(text)}</option>`).join('')}</select></div>`;
 function paint(){if(!attached())return;if(!authorized()){clear();container.innerHTML='';return;}const users=Object.fromEntries([['','All users'],[EXCLUDE_OWNER,'All except for owner'],...state.users]);if(uuid.test(state.filters.userId)&&!Object.hasOwn(users,state.filters.userId))users[state.filters.userId]='Selected user';container.innerHTML=`<section class="panel access-logs" aria-labelledby="access-log-title"><div class="panel-head"><h2 id="access-log-title">Access logs</h2><div class="actions"><span class="badge">Owner only</span>${button(state.open?'close':'open',state.open?'Close':'View logs')}</div></div>${state.open?`<div class="panel-body"${state.loading?' aria-busy="true"':''}>${signIns()}<form data-access-filter-form class="form-grid">${select('app','App',{'':'All apps',...apps})}${select('userId','User',users)}${select('event','Activity',{'':'All activities',...events})}<div class="field"><label for="access-log-from">From (Taipei)</label><input type="date" id="access-log-from" data-access-filter="from" value="${esc(state.filters.from)}"${state.loading?' disabled':''}></div><div class="field"><label for="access-log-to">To (Taipei)</label><input type="date" id="access-log-to" data-access-filter="to" value="${esc(state.filters.to)}"${state.loading?' disabled':''}></div><div class="settings-actions"><button type="submit" class="button primary"${state.loading?' disabled':''}>Apply</button>${button('refresh','Refresh')}</div></form>${state.error?`<p role="alert" class="alert error">${esc(state.error)}</p>`:''}${state.warnings.map(w=>`<p role="status" class="small muted">${esc(w)}</p>`).join('')}${state.loading?'<p role="status">Loading access logs…</p>':''}${state.updatedAt?`<p class="small muted" data-access-updated>Updated ${esc(stamp(state.updatedAt))} (Taipei).</p>`:''}${state.started?`<p class="small muted">Recorded since ${esc(stamp(state.started))} (Taipei).</p>`:''}<div class="table-scroll"><table><thead><tr><th>Time (Taipei)</th><th>User</th><th>App</th><th>Activity</th><th>Section</th></tr></thead><tbody>${state.rows.map(row=>{const person=displayPerson(row,state.directory);return `<tr><td>${esc(stamp(row.occurred_at))}</td><td>${esc(identity(person))}${person.email&&person.email!==identity(person)?`<div class="small muted">${esc(person.email)}</div>`:''}</td><td>${esc(apps[row.app])}</td><td>${esc(events[row.event])}</td><td>${esc(sections[row.page]||row.page)}</td></tr>`;}).join('')}</tbody></table></div>${!state.loading&&!state.error&&!state.rows.length?'<p class="empty">No recorded activity matches these filters.</p>':''}${state.hasMore?`<div class="settings-actions">${button('more','Load more')}</div>`:''}<details class="source-disclosure"><summary>Help</summary><p class="small muted">Recorded visits, not a list of people currently online. Authenticated app activity reported after logging was enabled. App session opened records verified app entry, even if later loading fails; section names do not prove that individual records were read. These records do not include failed sign-ins or every database read. Sign-out requested records the button action. Account sign-ins do not identify which app was opened. Lab Notes and Calculator are read from BraintimeDisk; older unrecorded visits cannot be reconstructed. Logs are visible only to the owner.</p></details></div>`:''}</section>`;}
 function requireOwner(){if(!attached())return false;if(!authorized()){requestVersion++;state.loading=false;state.open=false;clear();paint();return false;}return true;}
 function hidePrivate(){if(!attached())return;requestVersion++;state.loading=false;state.open=false;state.error='';state.dirty=false;clear();paint();}
 async function load(more=false){
  if(!requireOwner()||state.loading||more&&state.dirty)return;let range;try{range=accessDateRange(state.filters.from,state.filters.to);}catch(error){state.error=error.message;paint();return;}
  const version=++requestVersion;state.loading=true;state.error='';state.dirty=false;if(!more){state.rows=[];state.before=null;state.hasMore=false;state.started=null;}paint();
  try{
   if(typeof hooks.listLogs!=='function')throw new Error('Access logs are unavailable.');
   const filters={app:state.filters.app||null,userId:state.filters.userId===EXCLUDE_OWNER?null:state.filters.userId||null,excludeOwner:state.filters.userId===EXCLUDE_OWNER,event:state.filters.event||null,...range,before:more?state.before:null,limit:50},federated=typeof hooks.listNasLogs==='function';const result=verify(await(federated?loadAccessFeed(hooks,filters):hooks.listLogs(filters)),{federated});
   if(!attached()||version!==requestVersion)return;if(!requireOwner())return;
   state.appliedUserId=state.filters.userId;state.warnings=result.warnings||[];
   if(result.users){state.accounts=result.users;state.directory=new Map(result.users.map(person=>[person.user_id,person]));state.users=new Map(result.users.map(person=>[person.user_id,identity(person)]));}
   const rowKey=row=>(row.log_origin||'cloud1')+':'+row.access_id,prior=new Set(state.rows.map(rowKey));state.rows.push(...result.events.filter(row=>!prior.has(rowKey(row))));if(federated)state.rows.sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)||rowKey(b).localeCompare(rowKey(a)));for(const row of result.events)if(!state.users.has(row.user_id))state.users.set(row.user_id,identity(row));state.before=result.next_before;state.hasMore=result.has_more;state.started=result.logging_started_at;state.updatedAt=new Date().toISOString();
  }catch(error){if(attached()&&version===requestVersion){clear();state.error=error?.message||'Access logs could not be loaded.';}}
  finally{if(attached()&&version===requestVersion){state.loading=false;paint();}}
 }
 container.onchange=event=>{if(!requireOwner()||state.loading)return;const key=event.target.dataset?.accessFilter;if(Object.hasOwn(state.filters,key)){state.filters[key]=event.target.value;state.dirty=true;paint();}};
 container.onclick=async event=>{if(!requireOwner())return;const target=event.target.closest('[data-access-action]');if(!target||state.loading)return;event.preventDefault?.();const action=target.dataset.accessAction;if(action==='open'){state.open=true;await load();}else if(action==='close')hidePrivate();else if(action==='refresh')await load();else if(action==='more'&&state.hasMore)await load(true);};
 container.onsubmit=async event=>{if(!event.target.hasAttribute?.('data-access-filter-form'))return;event.preventDefault();event.stopPropagation?.();if(requireOwner())await load();};
 const listeners=[],win=globalThis.window,doc=globalThis.document;
 const listen=(target,type,listener)=>{if(typeof target?.addEventListener==='function'){target.addEventListener(type,listener);listeners.push(()=>target.removeEventListener?.(type,listener));}};
 listen(win,'pagehide',hidePrivate);
 listen(win,'pageshow',event=>{if(event.persisted)hidePrivate();});
 listen(win,'storage',hidePrivate);
 listen(doc,'visibilitychange',()=>{if(doc.visibilityState==='hidden'||doc.hidden===true)hidePrivate();});
 paint();return ()=>{requestVersion++;for(const unlisten of listeners)unlisten();clear();if(mounts.get(container)===state){mounts.delete(container);container.onclick=container.onchange=container.onsubmit=null;container.innerHTML='';}};

}
