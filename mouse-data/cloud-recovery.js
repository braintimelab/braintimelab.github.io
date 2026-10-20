// Foreground checks are bounded, coalesced and read-only. A recovered network
// never replays an edit or changes the server selected for that edit.
export function createCloudRecovery({getContext,recover,canRun=()=>true,isVisible=()=>true,isOnline=()=>true,onChecking=()=>{},onRecovered=()=>{},onError=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,healthyMs=60000,retryDelays=[1200,4000]}={}){
 let generation=0,timer=null,pending=null,queued=false,lastVerified=-Infinity,verifiedKey=null,attempt=0,disposed=false;
 const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
 const available=()=>!disposed&&isVisible()&&isOnline()&&canRun();
 const same=(context,epoch)=>!disposed&&isVisible()&&isOnline()&&generation===epoch&&getContext()?.key===context.key;
 function pause(){generation++;queued=false;attempt=0;lastVerified=-Infinity;clear();}
 function schedule(delay){clear();if(!disposed){timer=setTimer(()=>{timer=null;void request({force:true});},delay);timer?.unref?.();}}
 function request({force=false}={}){
  if(!available())return Promise.resolve(false);
  const context=getContext();if(!context?.key)return Promise.resolve(false);
  if(pending){queued=true;return pending;}
  if(!force&&context.key===verifiedKey&&now()-lastVerified<healthyMs)return Promise.resolve(false);
  clear();const epoch=generation;
  const current=()=>same(context,epoch);
  const run=Promise.resolve().then(async()=>{
   if(!current())return false;
   onChecking();
   try{
    const result=await recover(context,{isCurrent:current});
    if(!current())return false;
    if(result?.recovered!==true)return false;
    verifiedKey=context.key;lastVerified=now();attempt=0;queued=false;
    await onRecovered(result);return true;
   }catch(error){
    if(!current())return false;
    const denied=[401,403].includes(error?.status)||['UNAUTHORIZED','FORBIDDEN'].includes(error?.code);
    const cancelled=error?.code==='BACKGROUND_CANCELLED';
    const delay=!denied&&!cancelled?retryDelays[attempt++]:undefined;
    queued=false;
    if(!cancelled)onError(error,{denied,final:delay===undefined});
    if(delay!==undefined)schedule(delay);
    return false;
   }
  }).finally(()=>{if(pending===run){pending=null;if(queued){queued=false;schedule(0);}}});
  pending=run;return run;
 }
 return {request,pause,dispose(){pause();disposed=true;}};
}
