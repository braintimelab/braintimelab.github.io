/* Unconfirmed command recovery only. No credentials or completed-write log. */
const clone=value=>structuredClone(value);
const stable=value=>JSON.stringify(value);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=message=>Object.assign(new Error(message),{code:'LOCAL_DURABILITY'});
const MAX_ENTRIES=50,MAX_BYTES=8*1024*1024;
export function createIntentJournal({database,getScope,timeout=10000}){
 function scope(context){const value=getScope();if(!value||!UUID.test(value.userId||'')||!UUID.test(value.colonyId||'')||typeof value.server!=='string'||typeof value.policyKey!=='string'||!value.policyKey||context.userId!==value.userId||context.colonyId!==value.colonyId)throw fail('Verify current account access before recovering a save.');return clone(value);}
 function key(value){return 'parallel-cloud-intents:v1:'+JSON.stringify([value.server,value.colonyId,value.userId]);}
 async function transaction(context,change){
  const captured=scope(context),db=await database();if(stable(scope(context))!==stable(captured))throw fail('Account access changed while preparing the save.');
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('datasets',change?'readwrite':'readonly'),store=tx.objectStore('datasets'),request=store.get(key(captured));let result,settled=false,error;
   const finish=err=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(result);};
   const timer=setTimeout(()=>{error=fail('The save recovery record could not be stored. No new command was sent.');try{tx.abort();}catch{}finish(error);},timeout);
   request.onsuccess=()=>{try{
    if(stable(scope(context))!==stable(captured))throw fail('Account access changed while preparing the save.');
    const saved=request.result;
    if(saved&&(saved.version!==1||!Array.isArray(saved.entries)||saved.entries.length>MAX_ENTRIES))throw fail('The saved command recovery record is invalid.');
    const entries=clone(saved?.entries||[]);result=change?change(entries,captured):entries.map(entry=>entry.policyKey===captured.policyKey?entry:{id:entry.id,source:entry.source,outcome:entry.outcome,policyKey:captured.policyKey,receiptOnly:true});
    if(change){if(result.length>MAX_ENTRIES||new TextEncoder().encode(JSON.stringify(result)).length>MAX_BYTES)throw fail('Too many saves need verification. Check the pending saves before adding another.');store.put({version:1,entries:result},key(captured));}
   }catch(err){error=err;try{tx.abort();}catch{}finish(err);}};
   tx.oncomplete=()=>{try{if(stable(scope(context))!==stable(captured))throw fail('Account access changed while preparing the save.');finish();}catch(err){finish(err);}};
   tx.onerror=tx.onabort=()=>finish(error||fail('The save recovery record could not be stored. No new command was sent.'));
  });
 }
 return {
  load:context=>transaction(context),
  put:(entry,context)=>transaction(context,(entries,current)=>{const next={...clone(entry),policyKey:current.policyKey},index=entries.findIndex(row=>row.id===entry.id);if(index<0)entries.push(next);else entries[index]=next;return entries;}),
  remove:(id,context)=>transaction(context,entries=>entries.filter(entry=>entry.id!==id))
 };
}
