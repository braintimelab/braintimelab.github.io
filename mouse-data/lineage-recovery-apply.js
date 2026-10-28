/* A private Owner/Cloud1 controller. Source qualification is re-run on fresh
 * envelopes; server preflight remains the authority for scientific mutation. */
import {projectLineageRecoveryCoverage} from './lineage-recovery.js?v=199';
export const LINEAGE_RECOVERY_POLICY='stored_relationship_recovery_v1';
export const LINEAGE_RECOVERY_KIND='parentage_recovery_v1';
const rules=new Map([['direct_parent_observation_v1','source_recorded'],['linked_litter_parent_v1','inferred']]);
const roles=['sire','dam'],copy=structuredClone;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':object(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const same=(a,b)=>canonical(a)===canonical(b);
const fail=(message)=>{const e=new Error(message);e.lineageRecoveryBlocked=true;throw e;};
const assert=(ok,message)=>{if(!ok)fail(message);};
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=200&&x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x);
const ids=x=>Array.isArray(x)&&x.every(text)&&new Set(x).size===x.length;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const stamp=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(x)&&Number.isFinite(Date.parse(x));
const own=(x,key)=>Object.hasOwn(x,key)?{present:true,value:copy(x[key])}:{present:false};
const key=r=>r.entity_type+':'+r.entity_id;
const utf8=new TextEncoder();
const hex=x=>[...utf8.encode(x)].map(n=>n.toString(16).padStart(2,'0')).join('');
const order=(a,b)=>{const x=utf8.encode(a),y=utf8.encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
export async function lineageRecoveryDigest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function envelopes(rows){
 assert(Array.isArray(rows),'Complete current Mice envelopes are required.');const found=new Map();
 for(const r of rows){assert(object(r)&&text(r.entity_id)&&r.entity_type==='mice'&&Number.isSafeInteger(r.version)&&r.version>0&&typeof r.archived==='boolean'&&object(r.payload)&&r.payload.mouse_sid===r.entity_id&&!found.has(r.entity_id),'The current Mice identities or versions are incomplete.');found.set(r.entity_id,r);}
 return found;
}
export async function lineageRecoveryGraphGuard(rows){
 const map=envelopes(rows),values=[...map.values()].sort((a,b)=>order(a.entity_id,b.entity_id));
 return {count:values.length,sha256:await lineageRecoveryDigest(values.map(r=>hex(r.entity_id)+':'+r.version+':'+(r.archived?'1':'0')+'\n').join(''))};
}
function archiveGuard(snapshot){
 const head=snapshot.archiveManifest,chunks=snapshot.archiveChunks;
 assert(head?.entity_type==='archive'&&head.entity_id==='reconstruction'&&!head.archived&&Number.isSafeInteger(head.version)&&head.version>0&&head.payload?.archive_format==='colony-archive-manifest-v1'&&object(head.payload.archive_tables)&&Array.isArray(chunks),'Complete versioned relationship archives are required.');
 const tables=['parent_links','parent_observations','litter_mice','mating_litters','mating_members',...(Object.hasOwn(head.payload.archive_tables,'lineage_source_observations')?['lineage_source_observations']:[])],wanted=new Set();
 for(const table of tables){const d=head.payload.archive_tables[table];assert(object(d)&&Number.isSafeInteger(d.row_count)&&d.row_count>=0&&d.row_count<=20000&&Array.isArray(d.chunk_ids)&&d.chunk_ids.every(id=>/^chunk:[a-f0-9]{64}$/.test(id))&&new Set(d.chunk_ids).size===d.chunk_ids.length,'A relationship archive descriptor is unavailable or too large.');for(const id of d.chunk_ids)wanted.add(id);}
 assert(wanted.size<=500,'Relationship evidence exceeds the bounded archive limit.');const byId=new Map();for(const r of chunks){assert(!byId.has(r.entity_id),'Duplicate archive envelopes were returned.');byId.set(r.entity_id,r);}
 const versions=[...wanted].sort(order).map(id=>{const r=byId.get(id);assert(r&&!r.archived&&r.entity_type==='archive'&&Number.isSafeInteger(r.version)&&r.version>0&&r.payload?.format==='colony-archive-chunk-v1'&&tables.includes(r.payload.table)&&Array.isArray(r.payload.rows),'A selected relationship archive chunk is missing.');return {chunk_id:id,version:r.version};});
 return {manifest_version:head.version,chunk_versions:versions};
}
function evidenceRefs(candidate,archive,snapshot){
 assert(Array.isArray(candidate.evidenceRefs)&&candidate.evidenceRefs.length>0&&candidate.evidenceRefs.length<=100,'A selected role lacks bounded stored evidence.');
 const byId=new Map(snapshot.archiveChunks.map(r=>[r.entity_id,r])),seen=new Set();
 return candidate.evidenceRefs.map(ref=>{
  assert(object(ref),'A source reference is invalid.');
  if(ref.kind==='archive_row'){
   assert(same(Object.keys(ref).sort(),['chunk_id','kind','row_index','table','version'])&&archive.chunk_versions.some(c=>c.chunk_id===ref.chunk_id&&c.version===ref.version)&&Number.isSafeInteger(ref.row_index)&&ref.row_index>=0,'An archive source reference changed.');
   const r=byId.get(ref.chunk_id);assert(r.payload.table===ref.table&&ref.row_index<r.payload.rows.length,'A source row is outside its selected archive chunk.');
  }else assert(ref.kind==='managed_record'&&same(Object.keys(ref).sort(),['entity_id','entity_type','kind','version'])&&text(ref.entity_id)&&['archive','mice','litters','matings'].includes(ref.entity_type)&&Number.isSafeInteger(ref.version)&&ref.version>0,'A managed source reference is invalid.');
  const serialized=canonical(ref);assert(!seen.has(serialized),'Duplicate evidence references are not independent proof.');seen.add(serialized);return copy(ref);
 });
}
function assertGraph(mice,changes){
 const next=new Map([...mice].map(([id,r])=>[id,r.payload]));for(const [id,p]of changes)next.set(id,p);
 for(const [id,p]of next)for(const role of roles){const list=Object.hasOwn(p,role+'_sids')?p[role+'_sids']:[];assert(ids(list),'Current parent IDs are malformed; review the full graph first.');for(const parent of list)assert(parent!==id&&next.has(parent),'A parent endpoint is missing or self-referential.');}
 const visiting=new Set(),done=new Set();function visit(id){assert(!visiting.has(id),'The final parentage graph contains a cycle.');if(done.has(id))return;visiting.add(id);const p=next.get(id);for(const parent of [...(p.sire_sids||[]),...(p.dam_sids||[])])visit(parent);visiting.delete(id);done.add(id);}for(const id of next.keys())visit(id);
}
export function lineageRecoveryCoverage(rows){
 const counts={total:0,both:0,sire_only:0,dam_only:0,neither:0};for(const r of rows){if(r.archived||r.payload?.state!=='Stock')continue;counts.total++;const s=Array.isArray(r.payload.sire_sids)&&r.payload.sire_sids.length>0,d=Array.isArray(r.payload.dam_sids)&&r.payload.dam_sids.length>0;counts[s?(d?'both':'sire_only'):(d?'dam_only':'neither')]++;}return counts;
}
/** Compile only a fresh report made by the shared engine. This does not confer
 * server authority on a report or make a private source literal trustworthy. */
export async function compileLineageRecovery(snapshot,report,{selectedRoleKeys,operationId,recordedAt}={}){
 assert(uuid(operationId)&&stamp(recordedAt)&&uuid(snapshot?.colonyId),'A current colony and stable operation identity are required.');
 assert(Array.isArray(selectedRoleKeys)&&selectedRoleKeys.length>0&&selectedRoleKeys.length<=100&&new Set(selectedRoleKeys).size===selectedRoleKeys.length,'Select between 1 and 100 distinct supported parent roles.');
 const mice=envelopes(snapshot.mice),archive=archiveGuard(snapshot),available=new Map((report?.roles||[]).map(r=>[r.key,r]));assert(available.size===(report?.roles||[]).length,'The analysis contains duplicate role keys.');
 const eventId='PARENTAGE-RECOVERY-'+operationId,selected=[],drafts=new Map(),original=new Map(),deps=new Map();
 for(const selectedKey of [...selectedRoleKeys].sort(order)){
  const c=available.get(selectedKey);assert(c&&c.disposition==='supported'&&c.applicable===true&&roles.includes(c.role)&&c.key===c.mouseSid+':'+c.role&&rules.has(c.rule)&&ids(c.parentSids)&&c.parentSids.length===1,'A selected role is not currently supported for automatic recovery.');
  const row=mice.get(c.mouseSid),old=row?.payload,field=c.role+'_sids';assert(row&&!row.archived&&!old.app_archived_at&&(old[field]===undefined||ids(old[field])&&old[field].length===0),'A selected parent role is no longer missing.');
  const parent=mice.get(c.parentSids[0]);assert(parent&&!parent.archived&&parent.entity_id!==row.entity_id&&parent.payload.sex===(c.role==='sire'?'Male':'Female')&&date(old.date_of_birth)&&date(parent.payload.date_of_birth)&&parent.payload.date_of_birth<old.date_of_birth,'A selected parent identity, sex or date is incomplete.');
  const refs=evidenceRefs(c,archive,snapshot),status=rules.get(c.rule),role={parent_sids:copy(c.parentSids),evidence_status:status,rule:c.rule,evidence_refs:refs,...(status==='inferred'?{confidence:'moderate'}:{})};
  if(!original.has(row.entity_id))original.set(row.entity_id,{mouse_sid:row.entity_id,original_parentage:Object.fromEntries(roles.map(r=>[r,own(old,r+'_sids')])),prior_lineage_basis:own(old,'lineage_basis')});
  let draft=drafts.get(row.entity_id);if(!draft){draft=copy(old);draft.lineage_basis={kind:LINEAGE_RECOVERY_KIND,schema_version:1,policy:LINEAGE_RECOVERY_POLICY,operation_id:operationId,batch_event_id:eventId,recorded_at:recordedAt,biological_confirmation:false,roles:{},original_parentage:copy(original.get(row.entity_id).original_parentage),prior_lineage_basis:copy(original.get(row.entity_id).prior_lineage_basis)};drafts.set(row.entity_id,draft);}
  draft[field]=copy(c.parentSids);draft.lineage_basis.roles[c.role]=role;draft.app_modified_at=recordedAt;
  selected.push({mouse_sid:row.entity_id,role:c.role,...copy(role)});
  for(const ref of c.dependencyRefs||[]){assert(ref?.kind==='managed_record'&&['mice','litters','matings'].includes(ref.entity_type)&&text(ref.entity_id)&&Number.isSafeInteger(ref.version)&&ref.version>0,'A managed evidence dependency is invalid.');const k=key(ref);assert(!deps.has(k)||same(deps.get(k),ref),'Conflicting evidence versions were returned.');deps.set(k,copy(ref));}
  for(const r of [row,parent]){const ref={kind:'managed_record',entity_type:'mice',entity_id:r.entity_id,version:r.version};assert(!deps.has(key(ref))||same(deps.get(key(ref)),ref),'A parent dependency changed.');deps.set(key(ref),ref);}
 }
 assertGraph(mice,drafts);const graphGuard=await lineageRecoveryGraphGuard(snapshot.mice);
 const audit={event_id:eventId,event_type:'source_reconciliation_batch',schema_version:1,record_origin:'app_created',operation_id:operationId,recorded_at:recordedAt,parentage_policy:LINEAGE_RECOVERY_POLICY,biological_confirmation:false,original_parentage_preserved:true,parentage_recovery:{schema_version:1,graph_guard:graphGuard,archive_guard:archive,managed_dependencies:[...deps.values()].sort((a,b)=>order(key(a),key(b))),selected_roles:selected,original_parentage:[...original.values()].sort((a,b)=>order(a.mouse_sid,b.mouse_sid))}};
 const changes=[...drafts].map(([id,payload])=>({entity_type:'mice',entity_id:id,expected_version:mice.get(id).version,archived:false,payload}));changes.push({entity_type:'husbandry_events',entity_id:eventId,expected_version:0,archived:false,payload:audit});changes.sort((a,b)=>order(key(a),key(b)));
 const operation={operation_id:operationId,request:{route:'rpc/save_records',method:'POST',body:{p_colony_id:snapshot.colonyId,p_changes:changes}}};assert(utf8.encode(JSON.stringify(operation)).length<=1000000,'The selected recovery exceeds the atomic request limit. Select fewer roles.');
 return {operation,bodySha256:await lineageRecoveryDigest(JSON.stringify(operation)),selectedRoles:selected,coverageBefore:projectLineageRecoveryCoverage(report,[]),coverageAfter:projectLineageRecoveryCoverage(report,selectedRoleKeys),graphGuard,originalParentage:[...original.values()]};
}
function confirmed(receipt,entry){
 assert(receipt?.source==='cloud1'&&receipt.status==='applied'&&receipt.operation_id===entry.compiled.operation.operation_id&&Array.isArray(receipt.result),'The original Cloud1 receipt is not yet confirmed.');
 const expected=entry.compiled.operation.request.body.p_changes,found=new Map(receipt.result.map(r=>[key(r),r]));assert(found.size===receipt.result.length&&found.size===expected.length,'The confirmed receipt contains a different record set.');
 for(const c of expected){const r=found.get(key(c));assert(r&&r.version===c.expected_version+1&&r.archived===false&&same(r.payload,c.payload),'The saved recovery does not match its exact reviewed command.');}
}
/** IO must keep journalled uncertain commands across dialog closure. Never pass
 * an AbortSignal to submit/retry and never switch their required Cloud1 source. */
export function createLineageRecoveryApply({io,buildReport,makeOperationId=()=>crypto.randomUUID(),now=()=>new Date().toISOString()}={}){
 assert(io&&typeof buildReport==='function','The recovery capability is unavailable.');let analysis=null,current=null,busy=false,revision=0;
 const locked=async run=>{assert(!busy,'Parent recovery is already running.');busy=true;try{return await run();}finally{busy=false;}};
 const check=(context,signal,token)=>{io.checkContext(context);if(signal?.aborted||token!==undefined&&token!==revision)fail('The parent-recovery analysis was cancelled.');};
 const read=async(context,options,token)=>{const snapshot=await io.readSnapshot(context,options);check(context,options?.signal,token);assert(snapshot?.colonyId===context.colonyId,'The recovery snapshot belongs to a different colony.');return snapshot;};
 const pending=()=>current&&(current.uncertain||current.inflight)?{state:current.state||'uncertain',operationId:current.compiled.operation.operation_id,canRetry:!current.inflight}:null;
 const finish=(entry,receipt)=>{confirmed(receipt,entry);current=null;analysis=null;try{io.invalidate?.();}catch{/* A confirmed save is not made uncertain by cache refresh. */}return {state:'applied',operationId:receipt.operation_id,receipt};};
 return {
  clear(){revision++;analysis=null;if(current&&!current.uncertain&&!current.inflight)current=null;},
  getPendingOutcome:pending,
  restorePending:()=>locked(async()=>{if(pending())return pending();const context=await io.verifyOwner();check(context);const saved=await io.recoverPending?.(context);check(context);if(!saved)return null;const operation=saved.operation,body=operation?.request?.body,audit=body?.p_changes?.find(r=>r.entity_type==='husbandry_events'&&r.payload?.parentage_policy===LINEAGE_RECOVERY_POLICY);assert(uuid(operation?.operation_id)&&operation.request.route==='rpc/save_records'&&operation.request.method==='POST'&&body.p_colony_id===context.colonyId&&audit?.entity_id==='PARENTAGE-RECOVERY-'+operation.operation_id&&audit.payload.operation_id===operation.operation_id&&Array.isArray(audit.payload.parentage_recovery?.selected_roles)&&utf8.encode(JSON.stringify(operation)).length<=1000000,'The original recovery command could not be restored safely.');const entry={context,compiled:{operation:copy(operation),bodySha256:await lineageRecoveryDigest(JSON.stringify(operation))},scope:'all',selectedRoleKeys:audit.payload.parentage_recovery.selected_roles.map(r=>r.mouse_sid+':'+r.role),uncertain:true,inflight:false,state:'uncertain',recovered:true};current=entry;if(saved.receipt?.status==='applied')return finish(entry,saved.receipt);if(['conflict','rejected'].includes(saved.receipt?.status)){current=null;return {state:saved.receipt.status,operationId:operation.operation_id};}return pending();}),
  analyze:options=>locked(async()=>{assert(!pending(),'Verify the original parent-recovery operation before analyzing a new batch.');current=null;analysis=null;const token=++revision,context=await io.verifyOwner();check(context,options?.signal,token);const snapshot=await read(context,options,token),report=await buildReport(snapshot,options);check(context,options?.signal,token);const analysisId=makeOperationId();analysis={analysisId,context,report,scope:options?.scope||'stock'};return {...copy(report),analysisId};}),
  preview:options=>locked(async()=>{assert(!pending()&&analysis?.analysisId===options?.analysisId,'Analyze this cohort before preparing its recovery.');const entry=analysis,token=revision,context=await io.verifyOwner();check(context,options?.signal,token);assert(same(context,entry.context),'The account, cloud or access changed. Analyze again.');const snapshot=await read(context,options,token),report=await buildReport(snapshot,{...options,scope:entry.scope});check(context,options?.signal,token);const previous=new Map((entry.report.roles||[]).map(r=>[r.key,r]));for(const k of options.selectedRoleKeys||[])assert(same(previous.get(k),report.roles?.find(r=>r.key===k)),'A selected evidence proposal changed. Analyze again.');const compiled=await compileLineageRecovery(snapshot,report,{selectedRoleKeys:options.selectedRoleKeys,operationId:makeOperationId(),recordedAt:now()});check(context,options?.signal,token);const previewId=makeOperationId();current={context,compiled,previewId,scope:entry.scope,selectedRoleKeys:copy(options.selectedRoleKeys),uncertain:false,inflight:false};return {state:'preview',previewId,roleKeys:copy(options.selectedRoleKeys).sort(order),operationId:compiled.operation.operation_id,bodySha256:compiled.bodySha256,selectedRoles:copy(compiled.selectedRoles),coverageBefore:copy(compiled.coverageBefore),coverageAfter:copy(compiled.coverageAfter),warnings:[]};}),
  apply:options=>locked(async()=>{
   const entry=current;let context;
   try{
    assert(entry&&!entry.uncertain&&entry.previewId===options?.previewId,'Preview the supported roles before applying.');
    context=await io.verifyOwner();check(context);assert(same(context,entry.context),'The account, cloud or access changed. Analyze again.');
    const snapshot=await read(context,{onProgress:options?.onProgress}),report=await buildReport(snapshot,{scope:entry.scope}),compiled=await compileLineageRecovery(snapshot,report,{selectedRoleKeys:entry.selectedRoleKeys,operationId:entry.compiled.operation.operation_id,recordedAt:entry.compiled.operation.request.body.p_changes.find(r=>r.entity_type==='husbandry_events').payload.recorded_at});
    check(context);assert(current===entry,'This recovery preview was closed before submission.');assert(same(compiled.operation,entry.compiled.operation),'The source or target records changed. Preview a new recovery.');
   }catch(error){if(current===entry)current=null;error.lineageRecoveryBlocked=true;error.lineageRecoveryUncertain=false;throw error;}
   entry.inflight=true;entry.state='uncertain';
   try{
    const receipt=await io.submit(copy(entry.compiled.operation),context);check(context);
    if(['conflict','rejected'].includes(receipt?.status)){current=null;fail('The recovery conflicted or was rejected. Analyze fresh data before applying.');}
    return finish(entry,receipt);
   }catch(error){
    if(error.lineageRecoveryNotSubmitted===true){if(current===entry)current=null;error.lineageRecoveryBlocked=true;error.lineageRecoveryUncertain=false;}
    else if(current===entry){entry.uncertain=true;entry.state='uncertain';error.lineageRecoveryUncertain=true;error.lineageRecoveryBlocked=false;error.operationId=entry.compiled.operation.operation_id;}
    throw error;
   }finally{entry.inflight=false;}
  }),
  verify:()=>locked(async()=>{const entry=current;assert(entry?.uncertain,'There is no uncertain recovery to verify.');const context=await io.verifyOwner();check(context);assert(same(context,entry.context),'Return to the original Owner account and Cloud1 colony to verify this operation.');const receipt=await io.verify(entry.compiled.operation.operation_id,context);check(context);if(receipt?.status==='applied')return finish(entry,receipt);entry.state=['unknown','queued'].includes(receipt?.status)?receipt.status:'uncertain';if(['conflict','rejected'].includes(receipt?.status)){current=null;return {state:receipt.status,operationId:entry.compiled.operation.operation_id};}return pending();}),
  retry:()=>locked(async()=>{const entry=current;assert(entry?.uncertain,'Only the original uncertain recovery can be retried.');const context=await io.verifyOwner();check(context);assert(same(context,entry.context),'Return to the original Owner account and Cloud1 colony.');const receipt=await io.verify(entry.compiled.operation.operation_id,context);check(context);if(receipt?.status==='applied')return finish(entry,receipt);assert(!receipt||receipt.status==='unknown','The original operation cannot be replayed. Verify its outcome.');const snapshot=await read(context,{}),report=await buildReport(snapshot,{scope:entry.scope}),compiled=await compileLineageRecovery(snapshot,report,{selectedRoleKeys:entry.selectedRoleKeys,operationId:entry.compiled.operation.operation_id,recordedAt:entry.compiled.operation.request.body.p_changes.find(r=>r.entity_type==='husbandry_events').payload.recorded_at});check(context);assert(same(compiled.operation,entry.compiled.operation),'The original evidence changed; retain its operation ID for review.');const result=await io.retry(entry.compiled.operation.operation_id,context);check(context);if(result?.status==='applied')return finish(entry,result);entry.state=['unknown','queued'].includes(result?.status)?result.status:'uncertain';return pending();})
 };
}
