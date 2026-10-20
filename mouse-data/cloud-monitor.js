/* Bounded health polling. Never replaces a draft or reloads historical pages. */
export function createCloudMonitor({getState,refresh,verifyPolicy,verifyOperation,onDataChange,canRefresh=()=>true,onError=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,healthyMs=15000,backoffMs=60000,policyMs=300000}){
 const nasRevision=state=>{const nas=state?.sources?.cloud2;return nas?.state==='online'&&nas.ready===true&&nas.canRead===true&&nas.enrolled===true?nas.dataRevision??null:null;};
 let disposed=false,paused=false,generation=0,timer=null,running=false,previous=getState(),lastNASRevision=nasRevision(previous),lastSource=previous?.active||null,policyAt=now(),pendingChange=false;
 // Backup replication does not change the current Cloud 1 view. Only the
 // selected server may invalidate current records; a source change still does.
 const signature=state=>{const source=state?.active||lastSource&&!['signed_out','denied','not_enrolled'].includes(state?.sources?.[lastSource]?.state)&&lastSource||null;return JSON.stringify([source,source==='cloud2'?(nasRevision(state)??lastNASRevision):null]);};
 const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
 const schedule=delay=>{clear();if(!disposed&&!paused){timer=setTimer(()=>{timer=null;void tick();},delay);timer?.unref?.();}};
 async function tick(){
  if(disposed||paused||running)return;running=true;let delay=healthyMs;const epoch=generation;
  const canCommit=()=>!disposed&&!paused&&epoch===generation&&canRefresh();
  try{
   if(!canCommit())return;
   if(now()-policyAt>=policyMs){await verifyPolicy({canCommit});if(!canCommit())return;policyAt=now();}
   const state=await refresh({canCommit});
   if(!canCommit()){
    if(!disposed&&['signed_out','denied'].includes(state?.sources?.[lastSource]?.state)){await onDataChange();previous=getState();}
    return;
   }
   if((lastSource||state?.active)&&signature(previous)!==signature(state))pendingChange=true;
   lastNASRevision=nasRevision(state)??lastNASRevision;
   if(state?.active)lastSource=state.active;
   for(const entry of (state?.operations||[]).filter(row=>['queued','uncertain'].includes(row.outcome)).slice(0,10)){
    const receipt=await verifyOperation(entry.operationId);if(receipt?.status==='applied')pendingChange=true;
   }
   previous=getState();delay=previous?.active?healthyMs:backoffMs;
   if(pendingChange&&canCommit()){await onDataChange();pendingChange=false;previous=getState();}
  }catch(error){const denied=[401,403].includes(error?.status)||['UNAUTHORIZED','FORBIDDEN'].includes(error?.code);delay=error?.code==='BACKGROUND_CANCELLED'?healthyMs:backoffMs;if(error?.code!=='BACKGROUND_CANCELLED'&&(canCommit()||denied))try{onError(error);}catch{}}
  finally{running=false;schedule(delay);}
 }
 const pause=()=>{generation++;paused=true;clear();};
 schedule(healthyMs);
 return {tick,pause,resume(){if(disposed||!paused)return;paused=false;schedule(healthyMs);},dispose(){pause();disposed=true;}};
}
