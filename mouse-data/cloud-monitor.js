/* Bounded health polling. Never replaces a draft or reloads historical pages. */
export function createCloudMonitor({getState,refresh,verifyPolicy,verifyOperation,onDataChange,canRefresh=()=>true,onError=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,healthyMs=15000,backoffMs=60000,policyMs=300000}){
 const nasRevision=state=>{const nas=state?.sources?.cloud2;return nas?.state==='online'&&nas.ready===true&&nas.canRead===true&&nas.enrolled===true?nas.dataRevision??null:null;};
 let disposed=false,timer=null,running=false,previous=getState(),lastNASRevision=nasRevision(previous),policyAt=now(),pendingChange=false;
 // Backup replication does not change the current Cloud 1 view. Only the
 // selected server may invalidate current records; a source change still does.
 const signature=state=>JSON.stringify([state?.active,state?.active==='cloud2'?(nasRevision(state)??lastNASRevision):null]);
 async function tick(){
  if(disposed||running)return;running=true;let delay=healthyMs;
  try{
   if(!canRefresh())return;
   if(now()-policyAt>=policyMs){await verifyPolicy();policyAt=now();}
   const state=await refresh();if(disposed)return;
   if((previous?.active||state?.active)&&signature(previous)!==signature(state))pendingChange=true;
   lastNASRevision=nasRevision(state)??lastNASRevision;
   for(const entry of (state?.operations||[]).filter(row=>['queued','uncertain'].includes(row.outcome)).slice(0,10)){
    const receipt=await verifyOperation(entry.operationId);if(receipt?.status==='applied')pendingChange=true;
   }
   previous=getState();delay=previous?.active?healthyMs:backoffMs;
   if(pendingChange&&canRefresh()){await onDataChange();pendingChange=false;previous=getState();}
  }catch(error){delay=error?.code==='BACKGROUND_CANCELLED'?healthyMs:backoffMs;if(error?.code!=='BACKGROUND_CANCELLED')try{onError(error);}catch{}}
  finally{running=false;if(!disposed){timer=setTimer(tick,delay);timer?.unref?.();}}
 }
 timer=setTimer(tick,healthyMs);timer?.unref?.();
 return {tick,dispose(){disposed=true;if(timer!==null)clearTimer(timer);}};
}
