const canceled=()=>Object.assign(new Error('Parentage analysis canceled.'),{name:'AbortError'});

/** A fresh worker per analysis prevents source data or late messages from
 * crossing account, cloud or route changes. No data is written or cached. */
export function runLineageRecoveryAnalysis(dataset,options={}, {signal,onProgress,isCurrent=()=>true}={}){
 if(signal?.aborted)return Promise.reject(canceled());
 if(!isCurrent())return Promise.reject(new Error('The account or data source changed. Reopen parent recovery.'));
 if(typeof Worker!=='function')return Promise.reject(new Error('This browser cannot run parent recovery. Open Mouse Data in a current Safari, Chrome or Edge browser.'));
 return new Promise((resolve,reject)=>{
  let worker,settled=false;
  const requestId=crypto.randomUUID();
  const cleanup=()=>{signal?.removeEventListener('abort',abort);if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();worker=null;}};
  const finish=(error,result)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve(result);};
  const abort=()=>finish(canceled());
  const check=()=>{if(signal?.aborted){abort();return false;}if(!isCurrent()){finish(new Error('The account or data source changed. Reopen parent recovery.'));return false;}return true;};
  try{
   worker=new Worker(new URL('./lineage-recovery-worker.js?v=199',import.meta.url),{type:'module',name:'Mouse Data parent recovery'});
   signal?.addEventListener('abort',abort,{once:true});
   worker.onmessage=event=>{
    if(settled||!check())return;
    const value=event.data;if(value?.requestId!==requestId)return;
    if(value.type==='progress'){try{onProgress?.(value.progress);}catch{/* Presentation cannot change the analysis. */}}
    else if(value.type==='result')finish(null,value.report);
    else if(value.type==='error')finish(new Error(typeof value.message==='string'?value.message.slice(0,1000):'Parentage analysis could not finish.'));
   };
   worker.onerror=()=>finish(new Error('The parentage engine could not load. Update or reload Mouse Data and try again.'));
   worker.onmessageerror=()=>finish(new Error('The parentage result could not be read. Run the analysis again.'));
   if(check())worker.postMessage({type:'analyze',requestId,dataset,options:{scope:options.scope,mouseSids:options.mouseSids,fullEvidence:options.fullEvidence,archiveManifestRef:options.archiveManifestRef,archiveRowRefs:options.archiveRowRefs,managedRecordRefs:options.managedRecordRefs}});
  }catch(error){finish(error);}
 });
}
