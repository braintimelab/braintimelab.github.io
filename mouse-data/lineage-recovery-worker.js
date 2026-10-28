import {buildLineageRecovery} from './lineage-recovery.js?v=199';

// Source records stay in this dedicated worker's memory. Cancel terminates the
// worker rather than pretending an AbortSignal can interrupt synchronous work.
self.addEventListener('message',event=>{
 const input=event.data;
 if(input?.type!=='analyze'||typeof input.requestId!=='string')return;
 const requestId=input.requestId;
 try{
  const report=buildLineageRecovery(input.dataset,{...input.options,onProgress:progress=>self.postMessage({type:'progress',requestId,progress})});
  self.postMessage({type:'result',requestId,report});
 }catch(error){self.postMessage({type:'error',requestId,message:String(error?.message||'Parentage analysis could not finish.').slice(0,1000)});}
});
