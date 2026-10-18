/* Bounded health polling. Never replaces a draft or reloads historical pages. */
export function createCloudMonitor({getState,refresh,verifyPolicy,verifyOperation,onDataChange,canRefresh=()=>true,onError=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,healthyMs=5000,backoffMs=60000,policyMs=300000}){
 let disposed=false,timer=null,running=false,previous=getState(),policyAt=now(),pendingChange=false;
 const signature=state=>JSON.stringify([state?.active,state?.sources?.cloud2?.dataRevision??null]);
 async function tick(){
  if(disposed||running)return;running=true;let delay=healthyMs;
  try{
   if(!canRefresh())return;
   if(now()-policyAt>=policyMs){await verifyPolicy();policyAt=now();}
   const state=await refresh();if(disposed)return;
   if(previous?.active&&signature(previous)!==signature(state))pendingChange=true;
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
