/* Best-effort app activity only. Identity and timestamps are assigned by the server. */
export function createAccessActivity({app,sections,record,getContext,uuid=()=>globalThis.crypto.randomUUID(),now=()=>Date.now(),isVisible=()=>true,setTimer=(fn,delay)=>setTimeout(fn,delay),clearTimer=timer=>clearTimeout(timer)}={}){
 const allowed=new Set(sections||[]),pending=new Map(),retryDelays=[1000,3000],idleMs=5*60*1000,returnMs=30*1000,recoveryMs=15*1000;let identity='',sessionId=null,lastPage=null,lastAction=0,hiddenAt=null;
 const context=()=>{try{const value=getContext?.();return value?.signedIn&&value.mode==='cloud'&&!value.passwordRecovery&&!value.setupRequired&&value.role!=='pending'&&['owner','manager','editor','viewer'].includes(value.role)&&value.url&&value.colonyId&&value.email?JSON.stringify([value.url,value.colonyId,value.email,value.role]):'';}catch{return '';}};
 const current=job=>{if(pending.get(job.key)!==job||identity!==job.identity)return false;if(context()!==job.identity){reset();return false;}return true;};
 const finish=job=>{if(job.timer!==null)clearTimer(job.timer);if(pending.get(job.key)===job)pending.delete(job.key);};
 function attempt(job){
  if(!current(job)){finish(job);return;}job.timer=null;job.attempts++;job.lastAttempt=now();job.exhausted=false;
  const settled=result=>{
   // Retry only an unconfirmed delivery, using the same server-idempotent UUID.
   // Debouncing and rate limiting are deliberate server decisions, not failures.
   if(!current(job)||result?.recorded===true||['duplicate','debounced','rate_limited'].includes(result?.reason)){finish(job);return;}
   // Keep a bounded unconfirmed event in memory so a later online/foreground
   // return can recover it with the same UUID instead of losing that visit.
   if(job.attempts>retryDelays.length){job.exhausted=true;return;}
   try{job.timer=setTimer(()=>attempt(job),retryDelays[job.attempts-1]);}catch{finish(job);}
  };
  try{Promise.resolve(record(job.payload)).then(settled,()=>settled(null));}catch{settled(null);}
 }
 function send(event,page){
  if(typeof record!=='function')return;
  try{const eventId=uuid(),key=`${sessionId}:${eventId}`;if(pending.size>=20)finish(pending.values().next().value);const job={key,identity,payload:{app,event,page,sessionId,eventId},attempts:0,timer:null,exhausted:false,lastAttempt:0};pending.set(key,job);attempt(job);}catch{/* Activity cannot block normal use. */}
 }
 function reset(){for(const job of pending.values())finish(job);identity='';sessionId=null;lastPage=null;lastAction=0;hiddenAt=null;}
 function recover(){for(const job of pending.values())if(job.exhausted&&now()-job.lastAttempt>=recoveryMs){job.attempts=0;attempt(job);}}
 function observe(page,{returned=false,touched=false}={}){const actor=context();if(!actor){reset();return;}if(!allowed.has(page)||!isVisible())return;const at=now(),active=returned||touched||page!==lastPage,reopened=active&&hiddenAt!==null&&at-hiddenAt>=returnMs,idle=active&&sessionId&&at-lastAction>=idleMs;
  if(actor!==identity||reopened||idle){let next;try{next=uuid();}catch{return;}if(actor!==identity)reset();identity=actor;sessionId=next;lastPage=page;lastAction=at;hiddenAt=null;recover();send('session_start',page);return;}
  if(active)hiddenAt=null;recover();if(page!==lastPage){lastPage=page;lastAction=at;send('page_view',page);}else if(touched||returned)lastAction=at;
 }
 function suspend(){if(hiddenAt===null)hiddenAt=now();}
 function resume(page){observe(page,{returned:true});}
 function touch(page){observe(page,{touched:true});}
 function signOut(page){if(context()&&context()===identity&&sessionId)send('sign_out',allowed.has(page)?page:lastPage);reset();}
 return {observe,resume,suspend,touch,signOut,reset};
}
