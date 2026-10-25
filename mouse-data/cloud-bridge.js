/* Verified operational-provider selection and write receipts.
 * Adapters own authentication, server authorization and transport. No tokens,
 * URLs, persistent cache, actor claims or cross-origin requests live here.
 * getContext must return the verified userId, colonyId and an authEpoch that
 * changes on logout/reauthentication. Both adapters must map to that identity.
 */
const SOURCES=['cloud1','cloud2'];
const STATES=new Set(['online','unavailable','signed_out','denied','not_enrolled','not_ready']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clone=value=>structuredClone(value);
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')}}`:JSON.stringify(value);
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const recordKeys=operation=>operation.request?new Set(['rpc-command']):new Set(operation.changes.map(change=>JSON.stringify([change.domain,change.entity_type,change.entity_id])));
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const empty=source=>({source,state:'unknown',ready:false,canRead:false,canWrite:false,enrolled:false,pending:null,conflicts:null,lastSyncAt:null,dataRevision:null,capabilities:null,replicationCaughtUp:false});
const problem=(code,message)=>Object.assign(new Error(message),{code});
const failure=error=>['UNAVAILABLE','UNAUTHORIZED','FORBIDDEN','NOT_ENROLLED','NOT_READY'].includes(error?.code)?error.code:'UNKNOWN';
const failureState=error=>({UNAVAILABLE:'unavailable',UNAUTHORIZED:'signed_out',FORBIDDEN:'denied',NOT_ENROLLED:'not_enrolled',NOT_READY:'not_ready'}[failure(error)]||'error');
// Failure of one display/status or read-policy endpoint is not by itself a
// current-record outage. Each exception still requires fresh membership and
// a bounded core read below, and the failed optional action remains rejected.
const OPTIONAL_PRIMARY_READS=new Set(['get_my_lab_member','get_lab_user_directory','get_lab_collaboration_members','list_app_access','list_app_access_filtered','list_lab_members','list_cage_managers','list_cage_note_hints','list_guest_access','get_animal_sheet_import_status','get_animal_sheet_import_conflicts','get_experiment_sheet_import_status','get_experiment_sheet_import_conflicts','get_brainbot_status','get_lac_fee_visibility','get_export_permission','get_local_backup_permission']);
export const optionalPrimaryRead=query=>query?.method==='POST'&&typeof query.route==='string'&&query.route.startsWith('rpc/')&&OPTIONAL_PRIMARY_READS.has(query.route.slice(4));
const CURRENT_PAGE_TYPES=new Set(['mice','matings','litters','cages','rooms','racks','locations','light_events','husbandry_events']);
// Classification only. Membership, scope and field visibility are enforced by
// the server. Keep malformed/arbitrary RPCs out of the page-timeout exception.
export function managedRecordPageQuery(query,colonyId){
 if(query?.method!=='POST'||query.route!=='rpc/get_managed_record_page'||!UUID.test(colonyId||''))return null;
 const body=query.body;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['p_colony_id','p_entity_type','p_scope','p_event_types','p_after','p_limit','p_metadata_only'].includes(key)))return null;
 if(body.p_colony_id!==colonyId||!CURRENT_PAGE_TYPES.has(body.p_entity_type)||!['current','full','event_types','cage_cards'].includes(body.p_scope))return null;
 if(body.p_scope==='cage_cards'&&!['light_events','husbandry_events'].includes(body.p_entity_type))return null;
 if(body.p_event_types!==undefined&&(!Array.isArray(body.p_event_types)||body.p_event_types.length>64||body.p_event_types.some(type=>typeof type!=='string'||!/^[a-z][a-z0-9_]{0,99}$/.test(type))))return null;
 if(body.p_scope==='event_types'&&(body.p_entity_type!=='husbandry_events'||!body.p_event_types?.length))return null;
 if(body.p_scope!=='event_types'&&body.p_event_types?.length)return null;
 if(body.p_after!==undefined&&body.p_after!==null&&(typeof body.p_after!=='string'||!body.p_after.length||body.p_after.length>200||body.p_after.trim()!==body.p_after||/[\x00-\x1f]/.test(body.p_after)))return null;
 if(!Number.isSafeInteger(body.p_limit)||body.p_limit<1||body.p_limit>1000||body.p_metadata_only!==undefined&&typeof body.p_metadata_only!=='boolean')return null;
 return body;
}
function shrinkingPrimaryPage(query,colonyId){
 const managed=managedRecordPageQuery(query,colonyId);if(managed)return managed.p_limit>1;
 if(query?.method!=='GET'||!query.route?.startsWith('entity_records?'))return false;
 const params=new URLSearchParams(query.route.slice('entity_records?'.length)),limit=params.get('limit');
 if([...params.keys()].some(key=>!['select','colony_id','entity_type','order','limit','entity_id'].includes(key)||params.getAll(key).length!==1))return false;
 return /^[1-9]\d{0,3}$/.test(limit||'')&&Number(limit)>1&&Number(limit)<=1000&&params.get('colony_id')===`eq.${colonyId}`&&CURRENT_PAGE_TYPES.has(params.get('entity_type')?.slice(3))&&params.get('entity_type')?.startsWith('eq.')&&['colony_id,entity_type,entity_id,version,archived','colony_id,entity_type,entity_id,payload,version,archived'].includes(params.get('select'));
}
const authDenied=value=>['signed_out','denied'].includes(value?.state);
const authorizationFailure=value=>Object.assign(problem(value.state==='signed_out'?'UNAUTHORIZED':'FORBIDDEN','The cloud account could not be verified.'),{status:value.state==='signed_out'?401:403});
const foreground=canCommit=>{if(!canCommit())throw problem('BACKGROUND_CANCELLED','The background connection check was postponed.');};

export function createCloudBridge({adapters,getContext,onChange=()=>{},journal=null,primaryPolicy=false,sessionPolicy=false,getSessionCloud=()=>null,onSessionCloud=()=>{}}){
  if(typeof getContext!=='function'||!adapters?.cloud1||!adapters?.cloud2)throw new TypeError('Two cloud adapters and a verified context provider are required.');
  const listeners=new Set([onChange]),controllers=new Set(),operations=new Map();
  let generation=0,contextKey=null,context=null,preferred='cloud1',active=null,refreshing=null,primaryProbe=null,sessionProbe=null,disposed=false;
  let pinnedSession=sessionPolicy===true,sessionCloud=null;
  let fixedPrimary=primaryPolicy===true,fallbackEngaged=false,recoveryVerified=false,recoveryBlocked=false,failedPrimaryRead=null,primaryReadFailure=0,primaryReadFailureState='unavailable';
  let sources={cloud1:empty('cloud1'),cloud2:empty('cloud2')},sourceRevisions={cloud1:0,cloud2:0};
  const verified=()=>context&&UUID.test(context.userId)&&UUID.test(context.colonyId)&&typeof context.authEpoch==='string'&&context.authEpoch.length>0;
  const readable=source=>verified()&&sources[source].state==='online'&&sources[source].ready&&sources[source].canRead&&(source!=='cloud2'||sources[source].enrolled);
  const pendingNAS=()=>[...operations.values()].some(entry=>entry.source==='cloud2'&&(entry.inFlight||['submitting','uncertain','queued','conflict','rejected'].includes(entry.outcome)));
  const caughtUp=()=>sources.cloud2.replicationCaughtUp===true&&!pendingNAS();
  function selectActive(){
    if(pinnedSession&&sessionCloud)return readable(sessionCloud)?sessionCloud:null;
    if(fixedPrimary){
      if(pendingNAS())fallbackEngaged=true;
      if(readable('cloud1')){
        if(fallbackEngaged&&(!caughtUp()||!recoveryVerified))return readable('cloud2')?'cloud2':null;
        fallbackEngaged=false;return 'cloud1';
      }
      if(sources.cloud1.state==='unavailable'&&readable('cloud2')){fallbackEngaged=true;recoveryVerified=false;return 'cloud2';}
      return null;
    }
    if(readable(preferred))return preferred;
    // A denied or expired primary session is not proof of an outage. Explicit
    // independent NAS sign-in/selection remains possible after server checks.
    if(preferred==='cloud1'&&sources.cloud1.state==='unavailable'&&readable('cloud2'))return 'cloud2';
    if(preferred==='cloud2'&&sources.cloud2.state==='unavailable'&&readable('cloud1'))return 'cloud1';
    return null;
  }
  function snapshot(){return {preferred,active,...(pinnedSession?{sessionPolicy:true,sessionCloud}:{}),primaryPolicy:fixedPrimary?'cloud1':null,failbackPending:fixedPrimary&&fallbackEngaged,loading:!!refreshing,sources:clone(sources),operations:[...operations.values()].map(({id,source,outcome,receiptOnly})=>({operationId:id,source,outcome,...(receiptOnly?{retryable:false}:{})}))};}
  function emit(){active=selectActive();if(pinnedSession&&!sessionCloud&&active){sessionCloud=active;onSessionCloud(active);}const value=snapshot();for(const listener of listeners){try{listener(value);}catch{/* Status rendering cannot change a transaction outcome. */}}return value;}
  function reset(nextContext=null){
    generation++;for(const controller of controllers)controller.abort();controllers.clear();operations.clear();
    context=nextContext;contextKey=stable(nextContext);sessionCloud=pinnedSession&&nextContext&&SOURCES.includes(getSessionCloud())?getSessionCloud():null;sources={cloud1:empty('cloud1'),cloud2:empty('cloud2')};preferred='cloud1';active=null;refreshing=null;primaryProbe=null;sessionProbe=null;sourceRevisions={cloud1:0,cloud2:0};fallbackEngaged=false;recoveryVerified=false;recoveryBlocked=false;failedPrimaryRead=null;primaryReadFailure=0;
    return emit();
  }
  function synchronize(){
    if(disposed)throw problem('DISPOSED','The cloud connection view is closed.');
    const value=getContext(),next=value?{userId:value.userId,colonyId:value.colonyId,authEpoch:value.authEpoch,...(value.policyKey?{policyKey:value.policyKey}:{})}:null;
    if(stable(next)!==contextKey){
      const sameIdentity=context&&next&&context.userId===next.userId&&context.colonyId===next.colonyId&&context.authEpoch===next.authEpoch;
      if(sameIdentity){generation++;for(const controller of controllers)controller.abort();controllers.clear();operations.clear();context=next;contextKey=stable(next);refreshing=null;primaryProbe=null;recoveryVerified=false;emit();}
      else reset(next);
    }
  }
  function fence(){synchronize();const epoch=generation,key=contextKey;return ()=>{synchronize();if(epoch!==generation||key!==contextKey)throw problem('CONTEXT_CHANGED','The account or workspace changed. Reopen the cloud connection.');};}
  async function invoke(source,method,args,check){
    check();const fn=adapters[source]?.[method];if(typeof fn!=='function')throw problem('NOT_READY','This cloud operation is not configured.');
    const controller=new AbortController();controllers.add(controller);
    try{const value=await fn({...args,signal:controller.signal});check();return value;}finally{controllers.delete(controller);}
  }
  function status(source,value){
    if(!value||!STATES.has(value.state))return {...empty(source),state:'error'};
    const normalized={...empty(source),state:value.state};
    if(value.state!=='online')return normalized;
    if(!verified()||value.userId!==context.userId||value.colonyId!==context.colonyId)return {...normalized,state:'denied'};
    const enrolled=source==='cloud1'||value.enrolled===true;
    if(!enrolled)return {...normalized,state:'not_enrolled'};
    return {...normalized,enrolled,ready:value.ready===true,canRead:value.canRead===true,canWrite:value.canWrite===true,pending:count(value.pending),conflicts:count(value.conflicts),lastSyncAt:date(value.lastSyncAt),dataRevision:count(value.dataRevision),capabilities:value.capabilities&&typeof value.capabilities==='object'&&!Array.isArray(value.capabilities)?clone(value.capabilities):null,replicationCaughtUp:source==='cloud2'&&value.replicationCaughtUp===true};
  }
  async function recoverPrimary(check,query=failedPrimaryRead,{fromRead=false,canCommit=()=>true}={}){
    if(!fixedPrimary||!fallbackEngaged||!readable('cloud1')||!caughtUp())return;
    recoveryVerified=false;
    if(typeof adapters.cloud1.recover!=='function'){recoveryBlocked=true;return;}
    try{const result=await invoke('cloud1','recover',{query:query?clone(query):null,fromRead},check);foreground(canCommit);recoveryVerified=result?.verified===true;recoveryBlocked=!recoveryVerified;}
    catch(error){check();if(!canCommit()&&!['UNAUTHORIZED','FORBIDDEN'].includes(failure(error)))throw problem('BACKGROUND_CANCELLED','The background connection check was postponed.');recoveryBlocked=false;sources.cloud1={...empty('cloud1'),state:failureState(error)};if(!canCommit())throw error;}
  }
  async function refresh({recover=true,canCommit=()=>true}={}){
    synchronize();if(refreshing)return refreshing;
    const check=fence(),readFailure=primaryReadFailure,revisions={...sourceRevisions},selected=pinnedSession?(sessionCloud||preferred):null;
    const checkedResult=(source,result)=>pinnedSession&&authDenied(result)?result:pinnedSession&&revisions[source]!==sourceRevisions[source]?sources[source]:fixedPrimary&&source==='cloud1'&&readFailure!==primaryReadFailure&&(result.state==='online'||['signed_out','denied'].includes(primaryReadFailureState))?{...empty(source),state:primaryReadFailureState}:result;
    let primaryDone,sessionDone;primaryProbe=new Promise(resolve=>{primaryDone=resolve;});sessionProbe=pinnedSession?new Promise(resolve=>{sessionDone=resolve;}):null;
    const task=(async()=>{
      const results=await Promise.allSettled(SOURCES.map(async source=>{
        try{const value=await invoke(source,'status',{},check),normalized=status(source,value);if(pinnedSession&&source===selected&&(authDenied(normalized)||canCommit())){sources[source]=checkedResult(source,normalized);emit();}if(source==='cloud1'&&fixedPrimary&&(authDenied(normalized)||!fallbackEngaged&&!pendingNAS()&&canCommit())){sources.cloud1=checkedResult(source,normalized);emit();}return value;}
        catch(error){if(pinnedSession&&source===selected&&['UNAUTHORIZED','FORBIDDEN'].includes(failure(error))){sources[source]={...empty(source),state:failureState(error)};sourceRevisions[source]++;emit();}if(source==='cloud1'&&fixedPrimary&&['UNAUTHORIZED','FORBIDDEN'].includes(failure(error))){sources.cloud1={...empty(source),state:failureState(error)};emit();}throw error;}
        finally{if(source==='cloud1')primaryDone();if(source===selected)sessionDone?.();}
      }));
      check();const resolved=SOURCES.map((source,i)=>{const result=results[i];return checkedResult(source,result.status==='fulfilled'?status(source,result.value):{...empty(source),state:failureState(result.reason)});});
      if(!canCommit()){
        const selected=active||(fixedPrimary?'cloud1':preferred);for(let i=0;i<SOURCES.length;i++)if(authDenied(resolved[i]))sources[SOURCES[i]]=resolved[i];
        const denied=sources[selected];emit();if(authDenied(denied))throw authorizationFailure(denied);foreground(canCommit);
      }
      for(let i=0;i<SOURCES.length;i++)sources[SOURCES[i]]=resolved[i];
      if(fixedPrimary&&fallbackEngaged){recoveryVerified=false;if(recover)await recoverPrimary(check,failedPrimaryRead,{canCommit});}
      foreground(canCommit);
      return emit();
    })();
    refreshing=task;emit();
    try{await task;}finally{if(refreshing===task){refreshing=null;emit();}}
    return getState();
  }
  async function refreshForRead(check,{canCommit=()=>true}={}){
    const task=refresh({canCommit});void task.catch(()=>{});
    if(pinnedSession&&sessionProbe){await sessionProbe;check();const selected=sessionCloud||preferred;if(authDenied(sources[selected]))throw authorizationFailure(sources[selected]);foreground(canCommit);if(sessionCloud&&readable(sessionCloud))return;}
    if(fixedPrimary&&primaryProbe){await primaryProbe;check();if(!canCommit()){if(authDenied(sources.cloud1))throw authorizationFailure(sources.cloud1);await task;check();foreground(canCommit);}if(!fallbackEngaged&&!pendingNAS()&&readable('cloud1'))return;}
    await task;check();foreground(canCommit);
  }
  async function prepareRead({canCommit=()=>true}={}){const check=fence();await refreshForRead(check,{canCommit});check();foreground(canCommit);return getState();}
  function getState(){synchronize();return snapshot();}
  function setPrimaryCloudPolicy(){synchronize();fixedPrimary=true;preferred='cloud1';if(active==='cloud2')fallbackEngaged=true;return emit();}
  function setSessionCloudPolicy(){synchronize();pinnedSession=true;const saved=getSessionCloud();if(!sessionCloud&&SOURCES.includes(saved))sessionCloud=saved;return emit();}
  function choose(source){synchronize();if(!SOURCES.includes(source))throw problem('INVALID_SOURCE','Choose Cloud 1 or Cloud 2.');if(pinnedSession&&sessionCloud&&source!==sessionCloud)throw problem('SESSION_CLOUD_PINNED','Sign out before choosing a different cloud for the next session.');if(fixedPrimary&&source!=='cloud1')throw problem('PRIMARY_POLICY','Cloud 1 is the primary source. Cloud 2 is used automatically during an outage.');preferred=source;return emit();}
  async function read(query,{source:requiredSource=null,canCommit=()=>true}={}){
    if(requiredSource!==null&&!SOURCES.includes(requiredSource))throw problem('INVALID_SOURCE','Choose Cloud 1 or Cloud 2.');
    synchronize();const check=fence();if(!active)await refreshForRead(check,{canCommit});check();foreground(canCommit);
    if(pinnedSession&&sessionCloud&&authDenied(sources[sessionCloud]))throw authorizationFailure(sources[sessionCloud]);
    if(pinnedSession&&sessionCloud&&!active)throw Object.assign(problem('UNAVAILABLE','The session cloud is unavailable. Retry without changing clouds.'),{connectionUnavailable:true});
    if(requiredSource!==null&&active!==requiredSource)throw problem('SOURCE_CHANGED','The original cloud is unavailable. Retry when it reconnects.');
    if(requiredSource===null&&fixedPrimary&&fallbackEngaged&&recoveryBlocked){await recoverPrimary(check,query,{fromRead:true,canCommit});check();foreground(canCommit);emit();}
    const source=active;
    if(!source)throw problem('NOT_READY','No verified cloud data source is available.');
    try{const data=await invoke(source,'read',{query:clone(query)},check);foreground(canCommit);if(pinnedSession&&sessionCloud===source&&authDenied(sources[source]))throw authorizationFailure(sources[source]);if(active!==source&&!(pinnedSession&&sessionCloud===source&&!authDenied(sources[source])))throw problem('SOURCE_CHANGED','The active cloud changed while loading. Reload this view.');return {source,data};}
    catch(error){
      check();if(failure(error)!=='UNAVAILABLE'){if(['UNAUTHORIZED','FORBIDDEN'].includes(failure(error))){if(pinnedSession)sourceRevisions[source]++;if(fixedPrimary&&source==='cloud1'){primaryReadFailure++;primaryReadFailureState=failureState(error);}sources[source]={...empty(source),state:failureState(error)};emit();}throw error;}
      if(authDenied(sources[source]))throw authorizationFailure(sources[source]);
      foreground(canCommit);
      if(pinnedSession){sourceRevisions[source]++;sources[source]={...empty(source),state:'unavailable'};emit();throw Object.assign(error,{connectionUnavailable:true});}
      // The server completed authorization and reported this page's exact SQL
      // statement timeout. Let the existing bounded reader halve its page,
      // without invalidating other in-flight tables. A one-row failure keeps
      // the ordinary outage path; network failures never use this exception.
      if(source==='cloud1'&&fixedPrimary&&error.statementTimeout===true&&shrinkingPrimaryPage(query,context.colonyId))throw error;
      // A failed optional profile/directory read is not proof that current
      // colony data is down. Keep the primary only after fresh authorization
      // and a bounded current-record probe both succeed; the optional read
      // still fails and no read or save is retried on another server.
      if(source==='cloud1'&&fixedPrimary&&optionalPrimaryRead(query)&&typeof adapters.cloud1.recover==='function'){
        const priorFailure=primaryReadFailure;let optionalHealthy=false;
        try{
          const verifiedStatus=status('cloud1',await invoke('cloud1','status',{},check));
          if(authDenied(verifiedStatus))throw authorizationFailure(verifiedStatus);
          foreground(canCommit);
          if(verifiedStatus.state==='online'&&verifiedStatus.ready&&verifiedStatus.canRead){const probe=await invoke('cloud1','recover',{query:null,fromRead:true},check);foreground(canCommit);optionalHealthy=probe?.verified===true&&priorFailure===primaryReadFailure&&active==='cloud1'&&readable('cloud1');}
        }catch(probeError){
          check();
          if(['UNAUTHORIZED','FORBIDDEN'].includes(failure(probeError))){sources.cloud1={...empty('cloud1'),state:failureState(probeError)};primaryReadFailure++;primaryReadFailureState=failureState(probeError);emit();throw probeError;}
          foreground(canCommit);
        }
        if(optionalHealthy)throw error;
      }
      if(authDenied(sources[source]))throw authorizationFailure(sources[source]);
      if(fixedPrimary&&source==='cloud1'){failedPrimaryRead=clone(query);primaryReadFailure++;primaryReadFailureState='unavailable';recoveryVerified=false;recoveryBlocked=false;}
      sources[source]={...empty(source),state:'unavailable'};emit();await refresh({recover:false,canCommit});check();foreground(canCommit);
      // A minimal status check can succeed while the requested data endpoint
      // is unavailable. Preserve that verified read failure for this selection,
      // but never replace a new authorization rejection with an outage state.
      if(sources[source].state==='online'){sources[source]={...empty(source),state:'unavailable'};emit();}
      // Retry a read only after verifying a different, enrolled source. Never
      // retry an arbitrary error or silently interpret a permission denial.
      if(requiredSource!==null||!active||active===source)throw error;
      const fallback=active,data=await invoke(fallback,'read',{query:clone(query)},check);foreground(canCommit);if(active!==fallback)throw problem('SOURCE_CHANGED','The active cloud changed while loading. Reload this view.');return {source:fallback,data};
    }
  }
  function validateOperation(operation){
    if(operation?.request){
      const request=operation.request;
      if(Object.keys(operation).some(key=>!['operation_id','request'].includes(key))||!UUID.test(operation.operation_id)||!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!['route','method','body'].includes(key))||request.method!=='POST'||typeof request.route!=='string'||!/^rpc\/[a-z][a-z0-9_]{0,100}$/.test(request.route)||!request.body||typeof request.body!=='object'||Array.isArray(request.body))throw problem('INVALID_OPERATION','Use a verified command and an operation UUID.');
      return clone(operation);
    }
    if(!operation||Object.keys(operation).some(key=>!['operation_id','changes'].includes(key))||!UUID.test(operation.operation_id)||!Array.isArray(operation.changes)||!operation.changes.length||operation.changes.length>50)throw problem('INVALID_OPERATION','Use an operation UUID and between 1 and 50 record changes.');
    // Shape, editable-field and before-value validation belong to the server.
    return clone(operation);
  }
  async function restore(){
    synchronize();if(!journal||!verified())return getState();const check=fence(),saved=await journal.load(context);check();
    if(!Array.isArray(saved)||saved.length>50)throw problem('LOCAL_DURABILITY','Saved command recovery could not be verified.');
    for(const value of saved){
      if(!UUID.test(value?.id||'')||!SOURCES.includes(value.source)||!['submitting','uncertain','queued','conflict','rejected'].includes(value.outcome))throw problem('LOCAL_DURABILITY','Saved command recovery could not be verified.');
      if(operations.has(value.id))continue;
      const operation=value.receiptOnly?null:validateOperation(value.operation);if(operation&&operation.operation_id!==value.id)throw problem('LOCAL_DURABILITY','Saved command recovery could not be verified.');
      operations.set(value.id,{id:value.id,source:value.source,operation,body:operation?stable(operation):null,outcome:value.outcome==='submitting'?'uncertain':value.outcome,inFlight:false,receipt:null,receiptOnly:value.receiptOnly===true});
    }
    return emit();
  }
  async function restoreOperation(operationId,{requiredSource=null}={}){
    if(!UUID.test(operationId||''))throw problem('INVALID_OPERATION','Use an operation UUID.');
    if(requiredSource!==null&&!SOURCES.includes(requiredSource))throw problem('INVALID_SOURCE','Choose Cloud 1 or Cloud 2.');
    const check=fence();if(journal)await restore();check();
    const entry=operations.get(operationId);if(!entry)return null;
    if(requiredSource!==null&&entry.source!==requiredSource)throw problem('SOURCE_CHANGED','This operation belongs to a different cloud. Verify it on its original cloud.');
    return entry.receiptOnly||!entry.operation?null:clone(entry.operation);
  }
  async function persist(entry,check){if(!journal)return;check();await journal.put({id:entry.id,source:entry.source,outcome:entry.outcome,...(entry.receiptOnly?{receiptOnly:true}:{operation:clone(entry.operation)})},context);check();}
  async function applyReceipt(entry,value,check){
    if(value?.operation_id!==entry.id||!['applied','queued','conflict','rejected'].includes(value.status))throw problem('UNCONFIRMED','The write result could not be confirmed.');
    entry.outcome=value.status;entry.receipt=clone(value);
    // The initial intent already makes a failed cleanup recoverable. A receipt
    // must not become an uncertain write because browser cleanup failed.
    if(journal)try{if(value.status==='applied')await journal.remove(entry.id,context);else await journal.put({id:entry.id,source:entry.source,outcome:entry.outcome,receiptOnly:true},context);}catch{}
    check?.();emit();return {source:entry.source,...clone(value)};
  }
  async function send(entry,check){
    if(entry.inFlight)throw problem('BUSY','This operation is already being submitted.');
    entry.inFlight=true;entry.outcome='submitting';emit();
    try{await persist(entry,check);}catch(error){entry.inFlight=false;operations.delete(entry.id);emit();throw error;}
    try{return await applyReceipt(entry,await invoke(entry.source,'submit',{operation:clone(entry.operation)},check),check);}
    catch(error){
      check();entry.outcome='uncertain';emit();
      throw problem('WRITE_UNCERTAIN','The write outcome is unconfirmed. Verify or retry this same operation before submitting it elsewhere.');
    }finally{entry.inFlight=false;}
  }
  async function submit(operation,{requiredSource=null}={}){
    if(requiredSource!==null&&!SOURCES.includes(requiredSource))throw problem('INVALID_SOURCE','Choose Cloud 1 or Cloud 2.');
    synchronize();if(journal)await restore();const value=validateOperation(operation),key=stable(value),prior=operations.get(value.operation_id);
    if(prior){if(requiredSource!==null&&prior.source!==requiredSource)throw problem('SOURCE_CHANGED','This operation belongs to a different cloud. Verify it on its original cloud.');if(prior.body!==key)throw problem('ID_REUSED','This operation ID belongs to different changes.');if(prior.inFlight)throw problem('BUSY','This operation is already being submitted.');if(prior.receipt)return {source:prior.source,...clone(prior.receipt)};throw problem('WRITE_UNCERTAIN','Verify or explicitly retry the unconfirmed operation.');}
    const affected=recordKeys(value);
    for(const entry of operations.values())if((entry.inFlight||entry.outcome==='uncertain')&&(!entry.operation||[...recordKeys(entry.operation)].some(record=>affected.has(record))))throw problem('WRITE_UNCERTAIN','An earlier write to this record needs verification. Keep its operation ID rather than submitting the change again.');
    if(!active){const opening=fence();await refreshForRead(opening);opening();}const check=fence(),source=active;
    if(pinnedSession&&sessionCloud&&authDenied(sources[sessionCloud]))throw authorizationFailure(sources[sessionCloud]);
    if(pinnedSession&&sessionCloud&&!source)throw Object.assign(problem('UNAVAILABLE','The session cloud is unavailable. Your save stays on its original cloud.'),{connectionUnavailable:true});
    if(pinnedSession&&pendingNAS()&&sessionCloud!=='cloud2')throw problem('WRITE_UNCERTAIN','An earlier Cloud 2 save needs verification before new writes.');
    // Restore and refresh may select another cloud. Pin the captured source
    // before persisting or sending this operation; retries retain that source.
    if(requiredSource!==null&&source!==requiredSource)throw problem('SOURCE_CHANGED','The required cloud is unavailable. Retry when it reconnects.');
    if(!source||!sources[source].canWrite)throw problem('READ_ONLY','No verified writable cloud is available.');
    if(adapters[source].idempotentWrites!==true)throw problem('NOT_READY','Idempotent cloud writes are not configured.');
    const entry={id:value.operation_id,source,operation:value,body:key,outcome:'submitting',inFlight:false,receipt:null};operations.set(entry.id,entry);return send(entry,check);
  }
  async function verify(operationId){
    synchronize();if(journal)await restore();const entry=operations.get(operationId);if(!entry)throw problem('UNKNOWN_OPERATION','This account has no recovery record of that operation.');
    if(entry.inFlight)throw problem('BUSY','This operation is still being submitted.');
    if(entry.receipt&&entry.receipt.status!=='queued')return {source:entry.source,...clone(entry.receipt)};
    const check=fence(),result=await invoke(entry.source,'receipt',{operationId},check);
    if(result===null||result?.operation_id===operationId&&result.status==='unknown'){entry.outcome='uncertain';emit();return null;}
    return applyReceipt(entry,result,check);
  }
  async function retry(operationId){
    synchronize();if(journal)await restore();const entry=operations.get(operationId);if(!entry)throw problem('UNKNOWN_OPERATION','This account has no recovery record of that operation.');
    if(entry.inFlight)throw problem('BUSY','This operation is still being submitted.');
    if(entry.receipt)return {source:entry.source,...clone(entry.receipt)};
    if(entry.receiptOnly||!entry.operation)throw problem('POLICY_CHANGED','This save can be checked but cannot be replayed after an access change.');
    await refresh();const check=fence();
    if(!readable(entry.source)||!sources[entry.source].canWrite)throw problem('NOT_READY','The original cloud must be available to retry this operation.');
    return send(entry,check);
  }
  async function discardConfirmed(operationId,source){
    synchronize();if(!UUID.test(operationId||'')||source!=='cloud2')throw problem('INVALID_OPERATION','Choose a verified Cloud 2 operation.');
    const check=fence(),entry=operations.get(operationId);if(entry&&(entry.source!==source||entry.inFlight))throw problem('BUSY','This save cannot be discarded while submitting.');
    if(journal)await journal.remove(operationId,context);check();operations.delete(operationId);return emit();
  }
  function subscribe(listener){synchronize();if(typeof listener!=='function')throw new TypeError('A status listener is required.');listeners.add(listener);try{listener(snapshot());}catch{/* Rendering cannot alter cloud operations. */}return ()=>listeners.delete(listener);}
  function clear(){return reset(null);}
  function dispose(){reset(null);disposed=true;listeners.clear();}
  return {refresh,prepareRead,getState,setPrimaryCloudPolicy,setSessionCloudPolicy,choose,read,submit,verify,retry,restore,restoreOperation,discardConfirmed,subscribe,clear,dispose};
}
