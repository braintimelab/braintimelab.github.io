// Current presence only. No page contents, browser storage or activity history.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPS={mouse:'Mouse Data',reagents:'Reagents','lab-tools':'Lab tools',notes:'Lab Notes',calculator:'Calculator',qpcr:'qPCR'};
const TTL=90000,INTERVAL=30000;

export function cloudPresenceContext(status,{enabled=true}={}){
 if(!enabled||!status?.signedIn||status.passwordRecovery||status.setupRequired||!UUID.test(status.userId||'')||!['owner','manager','editor','viewer'].includes(status.role)||status.guestAvailability&&status.guestAvailability!=='active')return null;
 return {userId:status.userId,owner:status.role==='owner',key:JSON.stringify([status.url,status.colonyId,status.userId,status.role,status.sessionEpoch,status.activeCloud])};
}

// Rebase server expiry times to this browser's clock before combining servers.
export function mergePresenceFeeds(feeds,{now=Date.now()}={}){
 const users=new Map();let available=false;
 for(const feed of feeds||[]){
  if(feed?.available!==true||!Array.isArray(feed.users))continue;
  const server=Date.parse(feed.server_time);if(!Number.isFinite(server))continue;available=true;
  for(const row of feed.users){
   const expiry=Date.parse(row.expires_at),seen=Date.parse(row.last_seen_at),remaining=expiry-server;
   if(!UUID.test(row.user_id||'')||typeof row.name!=='string'||!row.name.trim()||!Number.isFinite(seen)||seen>server+5000||!Number.isFinite(remaining)||remaining<=0||remaining>TTL+5000)continue;
   const apps=Array.isArray(row.apps)?row.apps.filter(app=>Object.hasOwn(APPS,app)):[];if(!apps.length)continue;
   const value={user_id:row.user_id,name:row.name.trim().slice(0,160),acronym:typeof row.acronym==='string'?row.acronym.trim().slice(0,8):null,apps:[...new Set(apps)],last_seen_at:new Date(now-Math.max(0,server-seen)).toISOString(),expires_at:new Date(now+Math.min(TTL,remaining)).toISOString()};
   const prior=users.get(value.user_id);
   if(!prior)users.set(value.user_id,value);
   else{const recent=Date.parse(value.last_seen_at)>Date.parse(prior.last_seen_at)?value:prior;users.set(value.user_id,{...recent,apps:[...new Set([...prior.apps,...apps])],expires_at:new Date(Math.max(Date.parse(value.expires_at),Date.parse(prior.expires_at))).toISOString()});}
  }
 }
 return {available,server_time:new Date(now).toISOString(),expires_after_seconds:90,users:[...users.values()]};
}

export function renderPresence(container,users=[],{available=true}={}){
 if(!container)return;
 const doc=container.ownerDocument||globalThis.document;if(!doc?.createElement)return;
 const open=new Set([...container.querySelectorAll('.presence-person[open]')].map(node=>node.dataset.user));
 container.replaceChildren();container.classList.add('presence-strip');container.hidden=!users.length&&available;
 container.setAttribute('aria-label','Other active lab members, updated within 90 seconds');
 if(!available){const status=doc.createElement('span');status.className='presence-unavailable';status.textContent='Presence unavailable';status.title='Online status could not be verified. Lab data are unaffected.';container.append(status);}
 for(const user of users){
  const detail=doc.createElement('details'),badge=doc.createElement('summary'),label=doc.createElement('span');
  detail.className='presence-person';detail.dataset.user=user.user_id;detail.open=open.has(user.user_id);
  const words=user.name.split(/\s+/).filter(Boolean),initials=words.length>1?words[0][0]+words.at(-1)[0]:words[0]?.slice(0,2)||'?';
  const description=`${user.name} · ${user.apps.map(app=>APPS[app]).join(', ')} · Active within 90 seconds`;
  badge.className='presence-badge';badge.textContent=(user.acronym||initials).toUpperCase();badge.title=description;badge.setAttribute('aria-label',description);
  label.className='presence-detail';label.textContent=`${user.name} · ${user.apps.map(app=>APPS[app]).join(', ')}`;
  detail.append(badge,label);container.append(detail);
 }
}

export function createPresence({app,getContext,record,list,container,isVisible,documentTarget=globalThis.document,windowTarget=globalThis.window,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,randomUUID=()=>globalThis.crypto.randomUUID(),render=(users,options)=>renderPresence(container,users,options)}={}){
 if(!Object.hasOwn(APPS,app)||typeof getContext!=='function'||typeof record!=='function')throw new Error('Choose a supported presence service.');
 const clientId=randomUUID();if(!UUID.test(clientId))throw new Error('Presence requires a unique client ID.');
 const visible=isVisible||(()=>!documentTarget?.hidden);
 let identity=null,generation=0,pollTimer=null,expiryTimer=null,pending=null,users=[],destroyed=false,lastAttempt=-Infinity,available=true;
 const current=()=>{const context=getContext();return context&&UUID.test(context.userId||'')&&typeof context.key==='string'&&context.key?context:null;};
 const matches=(context,epoch)=>{const next=current();return !destroyed&&generation===epoch&&visible()&&next?.key===context.key&&next.owner===context.owner;};
 const stopTimers=()=>{clearTimer(pollTimer);clearTimer(expiryTimer);pollTimer=expiryTimer=null;};
 function display(){
  clearTimer(expiryTimer);expiryTimer=null;
  const context=current();
  if(!identity||!context?.owner||context.key!==identity.key||!visible()){users=[];render([]);return;}
  users=users.filter(user=>user.user_id!==context.userId&&Date.parse(user.expires_at)>now());render(users,{available});
  if(users.length)expiryTimer=setTimer(display,Math.max(1,Math.min(...users.map(user=>Date.parse(user.expires_at)))-now()));
 }
 function clear({release=true}={}){
  const previous=identity;generation++;identity=null;pending=null;lastAttempt=-Infinity;available=true;stopTimers();users=[];render([]);
  // A stale tab must never release a new account's presence.
  const epoch=generation;
  if(release&&previous&&current()?.key===previous.key)void Promise.resolve().then(()=>generation===epoch&&current()?.key===previous.key?record({app,clientId,present:false}):null).catch(()=>{});
 }
 function schedule(){clearTimer(pollTimer);if(identity&&!destroyed&&visible())pollTimer=setTimer(()=>void refresh(),Math.max(1,INTERVAL-(now()-lastAttempt)));}
 function refresh(){
  if(destroyed)return Promise.resolve();
  const context=current();
  if(!context||!visible()){clear();return Promise.resolve();}
  if(identity?.key!==context.key){clear({release:false});identity=context;}else identity=context;
  display();
  if(pending)return pending;
  if(now()-lastAttempt<INTERVAL){if(!pollTimer)schedule();return Promise.resolve();}
  lastAttempt=now();
  const epoch=generation;
  const request=Promise.allSettled([
   Promise.resolve().then(()=>matches(context,epoch)?record({app,clientId,present:true}):null),
   context.owner&&typeof list==='function'?Promise.resolve().then(()=>matches(context,epoch)?list():null):Promise.resolve(null)
  ]).then(results=>{
   if(!matches(context,epoch))return;
   if(context.owner){const result=results[1],feed=result.status==='fulfilled'?mergePresenceFeeds([result.value],{now:now()}):null;available=feed?.available===true;users=feed?.users||[];display();}
  }).finally(()=>{if(pending===request){pending=null;schedule();}});
  pending=request;return request;
 }
 const change=()=>void refresh(),hide=()=>clear();
 documentTarget?.addEventListener('visibilitychange',change);
 windowTarget?.addEventListener('pagehide',hide);windowTarget?.addEventListener('pageshow',change);windowTarget?.addEventListener('online',change);
 render([]);
 return {refresh,clear,destroy(){clear();destroyed=true;documentTarget?.removeEventListener('visibilitychange',change);windowTarget?.removeEventListener('pagehide',hide);windowTarget?.removeEventListener('pageshow',change);windowTarget?.removeEventListener('online',change);}};
}
