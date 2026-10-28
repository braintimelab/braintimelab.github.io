/* Deterministic, read-only lineage discovery. A result is not write authority.
 * The apply contract must rederive evidence from current server records/chunks.
 * No free-text, DOB/cage/genotype similarity or breeder membership becomes fact. */
export const LINEAGE_RECOVERY_POLICY='stored_relationship_recovery_v1';
export const LINEAGE_RECOVERY_RULES=Object.freeze({direct:'direct_parent_observation_v1',litter:'linked_litter_parent_v1',mating:'dated_mating_member_v1',historical:'saved_historical_review_v1'});
export const LINEAGE_RECOVERY_SOURCE_TABLES=Object.freeze(['parent_observations','parent_links','litter_mice','mating_litters','mating_members','historical_observations']);
const ROLES=['sire','dam'],MANAGED=['mice','litters','matings','husbandry_events'];
const INFERRED=new Set(['source_reconciliation_inference','cage_parent_candidates','litter_parent_candidates']);
const TERMINAL=new Set(['Harvested','Sacrificed','Found Dead','Euthanized']);
const CANDIDATE_LITTER_ORIGINS=new Set(['mating_export_litter_summary','referenced_in_mouse_export','cage_parent_candidates','litter_parent_candidates']);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const list=x=>Array.isArray(x)?x:[];
const text=x=>typeof x==='string'&&x.length>0&&x.length<=300&&x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x);
const copy=x=>structuredClone(x);
export const canonicalLineageJSON=x=>Array.isArray(x)?'['+x.map(canonicalLineageJSON).join(',')+']':object(x)?'{'+Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonicalLineageJSON(x[k])).join(',')+'}':JSON.stringify(x);
const equal=(a,b)=>canonicalLineageJSON(a)===canonicalLineageJSON(b);
const unique=x=>[...new Set(x)].sort();
const order=(a,b)=>a<b?-1:a>b?1:0;
const dedupe=x=>[...new Map(x.map(v=>[canonicalLineageJSON(v),v])).values()].sort((a,b)=>order(canonicalLineageJSON(a),canonicalLineageJSON(b)));
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const idArray=x=>Array.isArray(x)&&x.every(text)&&new Set(x).size===x.length;
const archived=x=>Boolean(x?.archived===true||x?.app_archived_at||x?.history_read_only===true||x?.source_historical===true);
const originalRole=(m,role)=>Object.hasOwn(m,role+'_sids')?{present:true,value:copy(m[role+'_sids'])}:{present:false};
const rawRole=(m,role)=>Object.hasOwn(m,role+'_sids')?m[role+'_sids']:[];
const inferredRole=(m,role,depth=0)=>{
 const b=m.lineage_basis;if(!object(b))return false;
 if(b.kind==='parentage_recovery_v1'){
  const entry=b.roles?.[role];if(object(entry))return entry.evidence_status==='inferred';
  const original=b.original_parentage?.[role],prior=b.prior_lineage_basis;
  return depth<20&&original?.present===true&&equal(original.value,rawRole(m,role))&&prior?.present===true&&object(prior.value)?inferredRole({...m,lineage_basis:prior.value},role,depth+1):false;
 }
 return INFERRED.has(b.kind)&&(!idArray(b.inferred_roles)||!b.inferred_roles.length||!b.inferred_roles.every(value=>ROLES.includes(value))||b.inferred_roles.includes(role));
};
function storedRoleConfidence(mouse,role,depth=0){
 const b=mouse.lineage_basis;if(!object(b))return null;
 if(b.kind==='parentage_recovery_v1'){
  const entry=b.roles?.[role];if(object(entry))return entry.evidence_status==='inferred'&&['high','moderate'].includes(entry.confidence)?entry.confidence:null;
  const original=b.original_parentage?.[role],prior=b.prior_lineage_basis;
  return depth<20&&original?.present===true&&equal(original.value,rawRole(mouse,role))&&prior?.present===true&&object(prior.value)?storedRoleConfidence({...mouse,lineage_basis:prior.value},role,depth+1):null;
 }
 return inferredRole(mouse,role)&&b.kind==='source_reconciliation_inference'&&['high','moderate'].includes(b.confidence)?b.confidence:null;
}
// A stored inferred/candidate pool is not converted into a literal assertion by
// copying it through a litter field or an archive observation of that field.
function inferredLitterRole(litter,role,depth=0){
 if(CANDIDATE_LITTER_ORIGINS.has(litter.record_origin))return true;
 const b=litter.lineage_basis;if(!object(b))return false;
 if(INFERRED.has(b.kind))return inferredRole(litter,role);
 if(b.kind!=='parentage_recovery_v1')return false;
 const entry=b.roles?.[role];
 if(object(entry))return !(entry.evidence_status==='source_recorded'&&entry.rule===LINEAGE_RECOVERY_RULES.direct&&equal(entry.parent_sids,rawRole(litter,role)));
 const original=b.original_parentage?.[role],prior=b.prior_lineage_basis;
 if(original?.present!==true||!equal(original.value,rawRole(litter,role))||!object(prior)||depth>=20)return true;
 if(prior.present===false)return false;
 return prior.present===true&&object(prior.value)?inferredLitterRole({...litter,lineage_basis:prior.value},role,depth+1):true;
}
const grouped=(rows,key)=>{const map=new Map();for(const row of rows){const k=key(row);if(!map.has(k))map.set(k,[]);map.get(k).push(row);}return map;};
const add=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
const reviewText=(value,limit=1500)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,limit):'';
function boundedReviewRefs(value){
 const refs=[],seen=new Set();let duplicates=false,truncated=false;
 for(const ref of list(value).filter(object)){
  const key=canonicalLineageJSON([reviewText(ref.source_id||ref.source_url||ref.source_filename||ref.source_revision_id,300),reviewText(ref.sheet,300),reviewText(ref.cell||ref.comment_id,100),typeof ref.literal==='string'?ref.literal:'']);
  if(seen.has(key)){duplicates=true;continue;}seen.add(key);
  if(refs.length<20)refs.push(ref);else truncated=true;
  if(typeof ref.literal==='string'&&ref.literal.length>600)truncated=true;
 }
 return {refs,duplicates,truncated};
}
function reviewSourcePresentation(review){
 const table=review.table||'husbandry_events';
 const items=[{label:'Unresolved historical review case',table,entityId:review.eventId,sourceRecordId:review.observationId||'',issueId:review.issueId,summary:review.summary||review.reasonCodes.join(', ')}];
 for(const ref of review.refs){
  const cell=reviewText(ref.cell,100),literal=reviewText(ref.literal,600),comment=reviewText(ref.comment_id,100),revision=reviewText(ref.revision_id||ref.source_revision_id,300);
  items.push({label:'Historical source · uncertain association',table,entityId:review.eventId,issueId:review.issueId,sourceRecordId:reviewText(ref.source_id,300),sheet:reviewText(ref.sheet,300),...(typeof ref.source_filename==='string'?{sourceFilename:reviewText(ref.source_filename,300)}:{}),...(/^[a-f0-9]{64}$/.test(ref.file_sha256||'')?{sha256:ref.file_sha256}:{}),summary:[revision?'Revision '+revision:'',cell?'Cell '+cell:'',comment?'Comment '+comment:'',literal?'Literal: '+literal:''].filter(Boolean).join(' · ')});
 }
 return items;
}

/** Only terminal zero padding changes. Prefix/prime/sex/punctuation stay exact. */
export function lineagePhysicalTagTuple(tag){
 if(!text(tag))return null;const m=tag.match(/^(.+)-([MF])(\d+)$/);
 return m?[m[1],m[2],m[3].replace(/^0+(?=\d)/,'')]:null;
}
function identityIndex(mice){
 const byId=grouped(mice,m=>m.mouse_sid),sid=new Map(),tags=new Map();
 for(const m of mice){
  for(const value of unique([m.mouse_sid,m.canonical_sid,...list(m.legacy_sids)].filter(text))){if(!sid.has(value))sid.set(value,new Set());sid.get(value).add(m.mouse_sid);}
  for(const value of unique([m.physical_tag,...list(m.physical_tag_aliases)].filter(text))){const tuple=lineagePhysicalTagTuple(value);if(!tuple)continue;const key=canonicalLineageJSON(tuple);if(!tags.has(key))tags.set(key,new Set());tags.get(key).add(m.mouse_sid);}
 }
 return {byId,sid,tags};
}
function resolveSid(index,value){
 if(!text(value))return {ids:[],reason:'invalid_sid_literal'};
 const ids=unique([...(index.sid.get(value)||[])]);
 return {ids,reason:ids.length===1&&index.byId.get(ids[0])?.length===1?null:ids.length?'sid_identity_ambiguous':'sid_identity_unresolved'};
}
/** Typed SID or full physical tag+exact DOB+sex. A tag suffix is never an SID. */
export function resolveLineageIdentity(dataset,identity){
 const index=identityIndex(list(dataset?.tables?.mice));
 if(!object(identity))return {status:'unresolved',mouseSids:[],reasonCodes:['invalid_identity']};
 if(identity.kind==='sid'){
  const result=resolveSid(index,identity.value);return {status:result.reason?'unresolved':'resolved',mouseSids:result.ids,reasonCodes:result.reason?[result.reason]:[],basis:'typed_sid_namespace'};
 }
 const tuple=lineagePhysicalTagTuple(identity.physicalTag);
 if(identity.kind!=='physical_tag'||!tuple||!day(identity.dateOfBirth)||!['Male','Female'].includes(identity.sex)||tuple[1]!==identity.sex[0])return {status:'unresolved',mouseSids:[],reasonCodes:['full_tag_DOB_sex_required']};
 const all=unique([...(index.tags.get(canonicalLineageJSON(tuple))||[])]),ids=all.filter(id=>index.byId.get(id)?.length===1&&index.byId.get(id)[0].date_of_birth===identity.dateOfBirth&&index.byId.get(id)[0].sex===identity.sex);
 return {status:ids.length===1?'resolved':'unresolved',mouseSids:ids,reasonCodes:ids.length===1?[]:[ids.length?'physical_tag_identity_ambiguous':'physical_tag_identity_unresolved'],basis:'full_physical_tag_zero_padding_DOB_sex',inferredIdentity:true};
}
function sourceInfo(dataset,recordId){
 if(!text(recordId))return null;
 const matches=list(dataset.sources).filter(s=>text(s.source_id)&&recordId.startsWith(s.source_id+':')&&/^[a-f0-9]{64}$/.test(s.sha256||''));
 const exact=dedupe(matches.map(s=>({sourceId:s.source_id,sourceFilename:s.source_filename||null,sheet:s.sheet||null,sha256:s.sha256})));
 return exact.length===1?exact[0]:null;
}
function archiveRef(options,table,index){
 const r=options.archiveRowRefs?.[table]?.[index];
 return object(r)&&r.kind==='archive_row'&&r.table===table&&/^chunk:[a-f0-9]{64}$/.test(r.chunk_id||'')&&Number.isSafeInteger(r.version)&&r.version>0&&Number.isSafeInteger(r.row_index)&&r.row_index>=0?copy(r):null;
}
function managedRef(options,type,id){
 const r=options.managedRecordRefs?.[type]?.[id];
 return object(r)&&r.kind==='managed_record'&&r.entity_type===type&&r.entity_id===id&&Number.isSafeInteger(r.version)&&r.version>0?copy(r):null;
}
function manifestRef(options){
 const r=options.archiveManifestRef;
 return object(r)&&r.kind==='managed_record'&&r.entity_type==='archive'&&r.entity_id==='reconstruction'&&Number.isSafeInteger(r.version)&&r.version>0?copy(r):null;
}
function completeness(dataset,options){
 const t=dataset.tables||{},missingTables=[...MANAGED,...LINEAGE_RECOVERY_SOURCE_TABLES].filter(k=>!Array.isArray(t[k])),blockers=[];
 if(options.fullEvidence!==true)blockers.push('full_evidence_unavailable');
 if(dataset.source_archive_restricted)blockers.push('source_archive_restricted');
 if(missingTables.length)blockers.push('required_tables_missing');
 const marker=dataset.source_archive_deferred;
 if(marker&&(!object(marker)||marker.schema_version!==1||!Array.isArray(marker.loaded_tables)||LINEAGE_RECOVERY_SOURCE_TABLES.some(k=>!marker.loaded_tables.includes(k))))blockers.push('required_source_tables_deferred');
 if(dataset.managed_records_deferred)blockers.push('managed_records_deferred');
 if(object(marker?.tables)&&Object.hasOwn(marker.tables,'lineage_source_observations')&&(!Array.isArray(marker.loaded_tables)||!marker.loaded_tables.includes('lineage_source_observations')||!Array.isArray(t.lineage_source_observations)))blockers.push('registered_historical_reviews_unavailable');
 if(Object.hasOwn(t,'lineage_source_observations')&&!Array.isArray(t.lineage_source_observations))blockers.push('registered_historical_reviews_invalid');
 return {complete:blockers.length===0,blockers,requiredTables:[...MANAGED,...LINEAGE_RECOVERY_SOURCE_TABLES],missingTables};
}
function buildContext(dataset,options){
 const t=dataset.tables||{},mice=list(t.mice),index=identityIndex(mice),ctx={dataset,options,t,mice,index,completeness:completeness(dataset,options),obs:new Map(),links:new Map(),children:new Map(),listedChildren:new Map(),matingLinks:new Map(),members:new Map(),reviews:new Map(),sourceCache:new Map(),invalidReview:false};
 ctx.litters=grouped(list(t.litters),r=>r.litter_sid);ctx.matings=grouped(list(t.matings),r=>r.mating_sid);
 for(const [id,rows]of ctx.litters)for(const litter of rows)if(idArray(litter.listed_pup_sids))for(const value of litter.listed_pup_sids){const r=resolveSid(index,value);for(const child of r.ids)add(ctx.listedChildren,child,{id,reason:r.reason});}
 function childRows(table,target,childField,extraKey=()=> ''){
  list(t[table]).forEach((row,i)=>{if(!object(row))return;const r=resolveSid(index,row[childField]);for(const id of r.ids)add(target,id+extraKey(row),{row,index:i,table,identityReason:r.reason});});
 }
 childRows('parent_observations',ctx.obs,'child_sid',r=>':'+r.parent_role);childRows('parent_links',ctx.links,'child_sid',r=>':'+r.parent_role);childRows('litter_mice',ctx.children,'mouse_sid');
 for(const [i,row]of list(t.mating_litters).entries())if(object(row))add(ctx.matingLinks,row.litter_sid,{row,index:i,table:'mating_litters'});
 for(const [i,row]of list(t.mating_members).entries())if(object(row))add(ctx.members,row.mating_sid,{row,index:i,table:'mating_members'});
 function rememberReview(issue,{eventId='',observationId='',table='husbandry_events',rowRef=null}={}){
   if(!object(issue)||issue.schema_version!==1||issue.status!=='needs_review'||!['sire','dam','both'].includes(issue.role)||!idArray(issue.mouse_sids)){ctx.invalidReview=true;return;}
   const validParents=idArray(issue.candidate_parent_sids)&&issue.candidate_parent_sids.length<=1000,validRefs=Array.isArray(issue.evidence_refs),shown=boundedReviewRefs(issue.evidence_refs);
   for(const value of issue.mouse_sids){const r=resolveSid(index,value);for(const id of r.ids)for(const role of issue.role==='both'?ROLES:[issue.role])add(ctx.reviews,id+':'+role,{eventId:reviewText(eventId,300),observationId,table,rowRef,issueId:reviewText(observationId||issue.issue_id,300),parentSids:validParents?copy(issue.candidate_parent_sids):[],parentSidsValid:validParents,issueRole:issue.role,childIdentityReason:r.reason,reasonCodes:list(issue.reason_codes).filter(text).slice(0,50),summary:reviewText(issue.summary),refs:shown.refs,refsValid:validRefs&&issue.evidence_refs.every(object),presentationTruncated:shown.truncated||typeof issue.summary==='string'&&issue.summary.length>1500,repeatedSourceRefs:shown.duplicates});}
 }
 for(const event of list(t.husbandry_events)){
  if(event?.event_type!=='source_reconciliation_batch'||event.parentage_policy!=='owner_authorized_historical_parentage_recovery')continue;
  if(event.recovery_schema_version!==1||!Array.isArray(event.parentage_issues)){ctx.invalidReview=true;continue;}
  for(const issue of event.parentage_issues)rememberReview(issue,{eventId:event.event_id});
 }
 for(const [i,issue]of list(t.lineage_source_observations).entries()){
  if(!object(issue)||issue.schema_version!==1||!text(issue.observation_id)){ctx.invalidReview=true;continue;}
  // Registered literal facts/metadata remain source descriptions. They do not
  // map a child, establish a parent, or bypass an associated held review case.
  if(['literal_birth','literal_dated_slot','literal_breeder_membership','registration_audit'].includes(issue.kind))continue;
  if(issue.kind!=='review_case'){ctx.invalidReview=true;continue;}
  rememberReview(issue,{observationId:issue.observation_id,table:'lineage_source_observations',rowRef:archiveRef(options,'lineage_source_observations',i)});
 }
 if(ctx.invalidReview){ctx.completeness.blockers.push('historical_review_contract_invalid');ctx.completeness.complete=false;}
 if(mice.some(m=>!text(m?.mouse_sid))||[...index.byId.values()].some(v=>v.length!==1)){ctx.completeness.blockers.push('current_mouse_identity_invalid');ctx.completeness.complete=false;}
 return ctx;
}
function evidenceCollector(ctx){
 const refs=[],presentation=[],missing=[];
 return {refs,presentation,missing,archive(entry,label){
  const r=archiveRef(ctx.options,entry.table,entry.index);if(r)refs.push(r);else missing.push('archive_reference_unavailable');
  const recordIds=unique([entry.row.source_record_id,...list(entry.row.source_record_ids)].filter(text));
  if(!recordIds.length)missing.push('source_provenance_unavailable');
  for(const recordId of recordIds){if(!ctx.sourceCache.has(recordId))ctx.sourceCache.set(recordId,sourceInfo(ctx.dataset,recordId));const source=ctx.sourceCache.get(recordId);if(!source)missing.push('source_provenance_unavailable');presentation.push({label,table:entry.table,sourceRecordId:recordId,...(source||{})});}
 },managed(type,id,label){const r=managedRef(ctx.options,type,id);if(r)refs.push(r);else missing.push('managed_reference_unavailable');presentation.push({label,table:type,entityId:id});}};
}
function normalizedSet(ctx,value){
 if(!idArray(value))return {ids:[],reasons:['parent_candidates_malformed']};const ids=[],reasons=[];
 for(const v of value){const r=resolveSid(ctx.index,v);if(r.reason)reasons.push(r.reason);else ids.push(r.ids[0]);}
 if(new Set(ids).size!==ids.length)reasons.push('duplicate_parent_identity');
 return {ids:unique(ids),reasons};
}
function historicalReviewProposal(ctx,review,role,collector){
 const sets=[],reasons=['historical_review_case_unresolved'];let shown=0,truncated=false;
 for(const entry of review){
  if(entry.rowRef)collector.refs.push(entry.rowRef);
  reasons.push(...entry.reasonCodes);if(entry.childIdentityReason)reasons.push('historical_review_child_identity_ambiguous');
  if(!entry.parentSidsValid)reasons.push('historical_review_parent_candidates_malformed');
  if(!entry.refsValid)reasons.push('historical_review_source_refs_malformed');
  if(entry.repeatedSourceRefs)reasons.push('historical_review_repeated_source_refs_deduplicated');
  const ids=[];
  for(const value of entry.parentSids){
   const resolved=resolveSid(ctx.index,value);
   if(resolved.reason){reasons.push('historical_review_'+resolved.reason);continue;}
   const rows=ctx.index.byId.get(resolved.ids[0])||[];
   if(rows.length!==1){reasons.push('historical_review_parent_identity_unresolved');continue;}
   const sex=rows[0].sex,expected=role==='sire'?'Male':'Female';
   if(sex!==expected){if(!['Male','Female'].includes(sex))reasons.push('historical_review_parent_sex_unknown');else if(entry.issueRole!=='both')reasons.push('historical_review_parent_role_sex_conflict');continue;}
   ids.push(resolved.ids[0]);
  }
  sets.push(unique(ids));
  for(const ref of reviewSourcePresentation(entry)){if(shown<20){collector.presentation.push(ref);shown++;}else truncated=true;}
  if(entry.presentationTruncated)truncated=true;
 }
 if(dedupe(sets.filter(ids=>ids.length)).length>1)reasons.push('historical_review_parent_sets_conflict');
 if(truncated)reasons.push('historical_review_source_presentation_truncated');
 return {ids:unique(sets.flat()),reasons};
}
function litterContext(ctx,mouse,collector){
 const refs=ctx.children.get(mouse.mouse_sid)||[],ids=[],reasons=[];
 if(mouse.litter_sid!=null&&mouse.litter_sid!==''){if(text(mouse.litter_sid))ids.push(mouse.litter_sid);else reasons.push('child_litter_id_malformed');}
 for(const entry of refs){
  if(entry.identityReason)reasons.push(entry.identityReason);
  if(entry.row.relationship_basis!=='mouse_export_litter_sid'||!text(entry.row.litter_sid))reasons.push('child_litter_source_unsupported');else {ids.push(entry.row.litter_sid);collector.archive(entry,'Explicit child-to-litter source field');}
 }
 // A literal pup list is another explicit membership source, not a DOB match.
 for(const entry of ctx.listedChildren.get(mouse.mouse_sid)||[]){ids.push(entry.id);if(entry.reason)reasons.push('child_identity_ambiguous');}
 const uniqueIds=unique(ids);if(uniqueIds.length>1)reasons.push('conflicting_child_litter_links');
 if(uniqueIds.length!==1)return {litter:null,reasons,ids:uniqueIds};
 const rows=ctx.litters.get(uniqueIds[0])||[];if(rows.length!==1)return {litter:null,reasons:[...reasons,'litter_identity_unresolved'],ids:uniqueIds};
 const litter=rows[0];collector.managed('mice',mouse.mouse_sid,'Current child and explicit litter field');collector.managed('litters',litter.litter_sid,'Current literal litter record');
 if(Object.hasOwn(litter,'listed_pup_sids')){
  if(!idArray(litter.listed_pup_sids))reasons.push('literal_litter_pup_list_malformed');
  else if(!litter.listed_pup_sids.some(id=>resolveSid(ctx.index,id).ids.includes(mouse.mouse_sid)))reasons.push('child_not_in_literal_litter_pup_list');
 }
 if(!day(mouse.date_of_birth)||!day(litter.date_of_birth)||mouse.date_of_birth!==litter.date_of_birth)reasons.push('child_litter_DOB_mismatch');
 if(archived(litter))reasons.push('litter_archived_requires_review');
 return {litter,reasons,ids:uniqueIds};
}
function directEvidence(ctx,mouse,role,collector){
 const observations=ctx.obs.get(mouse.mouse_sid+':'+role)||[],links=ctx.links.get(mouse.mouse_sid+':'+role)||[],sets=[],reasons=[];
 const independentMouseField=observations.some(entry=>entry.row.basis==='mouse_parent_field'&&!entry.identityReason&&entry.row.source_record_id===mouse.source_record_id&&idArray(entry.row.candidate_sids)&&entry.row.candidate_sids.length===1&&entry.row.candidate_count===1);
 for(const entry of observations){
  if(entry.identityReason)reasons.push(entry.identityReason);
  if(!['mouse_parent_field','litter_parent_field'].includes(entry.row.basis)){reasons.push('non_biological_or_unsupported_parent_source');continue;}
  const set=normalizedSet(ctx,entry.row.candidate_sids);reasons.push(...set.reasons);
  if(!set.ids.length||entry.row.candidate_count!==entry.row.candidate_sids?.length)reasons.push('parent_observation_shape_invalid');
  sets.push(set.ids);collector.archive(entry,'Literal '+entry.row.basis.replace(/_/g,' '));
  if(entry.row.basis==='mouse_parent_field'&&entry.row.source_record_id!==mouse.source_record_id)reasons.push('child_source_identity_not_corroborated');
  if(entry.row.basis==='litter_parent_field'){
   const context=litterContext(ctx,mouse,collector);reasons.push(...context.reasons);
   if(!context.litter||context.litter.source_record_id!==entry.row.source_record_id)reasons.push('litter_source_identity_not_corroborated');
   if(context.litter&&inferredLitterRole(context.litter,role)&&!independentMouseField)reasons.push('inferred_litter_role_requires_review');
  }
 }
 const distinct=dedupe(sets);if(distinct.length>1)reasons.push('conflicting_recorded_parent_sets');
 const ids=unique(sets.flat());
 for(const entry of links){
  const r=resolveSid(ctx.index,entry.row.parent_sid);if(entry.identityReason)reasons.push(entry.identityReason);if(r.reason)reasons.push(r.reason);
  if(!observations.length||!r.ids.every(id=>ids.includes(id)))reasons.push('parent_link_observation_disagreement');
  if(entry.row.relationship_status!=='recorded_single_parent'||entry.row.is_ambiguous!==false||entry.row.candidate_count!==1)reasons.push('recorded_parent_alternatives');
  collector.archive(entry,'Derived parent-link summary; not independent corroboration');
 }
 if(observations.length&&ids.length===1&&!links.some(entry=>resolveSid(ctx.index,entry.row.parent_sid).ids.includes(ids[0])))reasons.push('parent_link_summary_missing');
 return {ids,reasons,independentMouseField,exists:observations.length>0||links.length>0};
}
function matingProposal(ctx,mouse,litter,role,collector){
 if(!litter)return {ids:[],reasons:[]};const ids=[],reasons=['mating_membership_requires_parentage_review'],links=ctx.matingLinks.get(litter.litter_sid)||[];
 if(text(litter.mating_sid))ids.push(litter.mating_sid);
 for(const entry of links){if(entry.row.relationship_basis!=='explicit_mating_export_litter_summary')reasons.push('mating_litter_source_unsupported');else {ids.push(entry.row.mating_sid);collector.archive(entry,'Explicit mating-to-litter summary');}}
 const matingIds=unique(ids.filter(text));if(matingIds.length!==1)return {ids:[],reasons:[...reasons,matingIds.length?'conflicting_litter_mating_links':'mating_link_missing']};
 const rows=ctx.matings.get(matingIds[0])||[];if(rows.length!==1)return {ids:[],reasons:[...reasons,'mating_identity_unresolved']};
 const mating=rows[0];collector.managed('matings',mating.mating_sid,'Current dated mating record');
 if(!day(mating.set_up_date)||!day(mouse.date_of_birth)||mating.set_up_date>=mouse.date_of_birth)reasons.push('mating_setup_chronology_invalid');
 const sourceMembers=(ctx.members.get(mating.mating_sid)||[]).filter(e=>e.row.recorded_role===(role==='sire'?'male_member':'female_member'));
 const current=normalizedSet(ctx,mating[role==='sire'?'male_sids':'female_sids']);reasons.push(...current.reasons);
 const members=[];
 for(const entry of sourceMembers){
  const resolved=resolveSid(ctx.index,entry.row.mouse_sid);if(resolved.reason)reasons.push(resolved.reason);members.push(...resolved.ids);collector.archive(entry,'Dated breeding-group member; not a biological-parent assertion');
  if(entry.row.mate_date_alignment!=='one_date_per_sid'||!day(entry.row.mate_date)||entry.row.mate_date>=mouse.date_of_birth)reasons.push('member_mate_date_unavailable_or_conflicting');
  if(entry.row.retired_date&&(!day(entry.row.retired_date)||entry.row.retired_date<mouse.date_of_birth))reasons.push('member_retirement_requires_conception_context');
 }
 if(!equal(unique(members),current.ids))reasons.push('mating_member_sets_disagree');
 return {ids:unique([...members,...current.ids]),reasons};
}
function parentChecks(ctx,mouse,role,parentIds,collector){
 const reasons=[],blocks=[];if(!day(mouse.date_of_birth))blocks.push('child_DOB_required');
 if(mouse.end_date&&(!day(mouse.end_date)||day(mouse.date_of_birth)&&mouse.end_date<mouse.date_of_birth))blocks.push('child_lifecycle_chronology_invalid');
 for(const id of parentIds){
  const rows=ctx.index.byId.get(id)||[];if(rows.length!==1){blocks.push('parent_identity_unresolved');continue;}
  const parent=rows[0],namespace=resolveSid(ctx.index,id);if(namespace.reason)blocks.push(namespace.reason);
  collector.managed('mice',id,'Current parent identity and lifecycle');
  if(id===mouse.mouse_sid)blocks.push('self_parent');
  if(parent.sex!==(role==='sire'?'Male':'Female'))blocks.push('parent_role_sex_conflict');
  if(!day(parent.date_of_birth))blocks.push('parent_DOB_required');else if(day(mouse.date_of_birth)&&parent.date_of_birth>=mouse.date_of_birth)blocks.push('parent_not_older_than_child');
  if(archived(parent))reasons.push('archived_parent_requires_review');
  if(parent.state==='Ended'&&TERMINAL.has(parent.end_type)){
   if(!day(parent.end_date))reasons.push('parent_terminal_date_missing');
   else if(day(mouse.date_of_birth)&&parent.end_date<mouse.date_of_birth){if(role==='dam')blocks.push('dam_terminal_before_birth');else reasons.push('sire_terminal_before_birth_requires_conception_context');}
  }
 }
 return {reasons,blocks};
}
function roleResult(ctx,mouse,role){
 const key=mouse.mouse_sid+':'+role,original=originalRole(mouse,role),saved=rawRole(mouse,role),collector=evidenceCollector(ctx),direct=directEvidence(ctx,mouse,role,collector),reasons=[...direct.reasons],blocks=[];
 const result={key,mouseSid:mouse.mouse_sid,role,originalParentage:original,existingParentSids:idArray(saved)?copy(saved):[],status:'unknown',disposition:'missing_source',proposedParentSids:[],parentSids:[],rule:null,evidenceStatus:null,confidence:null,evidenceRefs:[],dependencyRefs:[],evidencePresentation:[],reasonCodes:[],applicable:false};
 if(!idArray(saved)){result.disposition='blocked';result.reasonCodes=['saved_parent_role_malformed'];return result;}
 const review=ctx.reviews.get(key)||[];
 if(saved.length){
  result.status=inferredRole(mouse,role)?'inferred':'source_recorded';result.evidenceStatus=result.status;result.confidence=result.status==='inferred'?storedRoleConfidence(mouse,role):null;result.disposition='preserve';
  const known=normalizedSet(ctx,saved);reasons.push(...known.reasons);
  if(direct.exists&&!equal(direct.ids,known.ids))reasons.push('source_disagrees_with_saved_parent_role');
  if(review.length){const held=historicalReviewProposal(ctx,review,role,collector);reasons.push(...held.reasons);}
  result.reasonCodes=unique(reasons);result.evidencePresentation=dedupe(collector.presentation);return result;
 }
 collector.managed('mice',mouse.mouse_sid,'Exact current missing parent role');
 let proposed=direct.ids,rule=direct.exists?LINEAGE_RECOVERY_RULES.direct:null,evidenceStatus=direct.exists?(direct.reasons.includes('inferred_litter_role_requires_review')?'inferred':'source_recorded'):null,context=null;
 // Even a strong direct field must not hide a contradictory current litter field.
 context=litterContext(ctx,mouse,collector);reasons.push(...context.reasons);
 if(context.litter){
  const literal=rawRole(context.litter,role),set=normalizedSet(ctx,literal);reasons.push(...set.reasons);
  if(set.ids.length){
   if(inferredLitterRole(context.litter,role)&&!direct.independentMouseField)reasons.push('inferred_litter_role_requires_review');
   if(direct.exists){if(!equal(set.ids,direct.ids))reasons.push('current_litter_parent_disagrees_with_source');}
   else {proposed=set.ids;rule=LINEAGE_RECOVERY_RULES.litter;evidenceStatus='inferred';}
  }
 }
 if(!direct.exists&&!proposed.length&&context.litter){const mating=matingProposal(ctx,mouse,context.litter,role,collector);if(mating.ids.length){proposed=mating.ids;rule=LINEAGE_RECOVERY_RULES.mating;evidenceStatus='inferred';reasons.push(...mating.reasons);}}
 if(review.length){const held=historicalReviewProposal(ctx,review,role,collector);reasons.push(...held.reasons);if(!proposed.length&&held.ids.length){proposed=held.ids;rule=LINEAGE_RECOVERY_RULES.historical;evidenceStatus='inferred';}else if(proposed.length&&held.ids.length&&!equal(proposed,held.ids))reasons.push('historical_review_parent_candidates_conflict_with_source');}
 if(proposed.length){const checked=parentChecks(ctx,mouse,role,proposed,collector);reasons.push(...checked.reasons);blocks.push(...checked.blocks);}
 if(proposed.length>1)reasons.push('multiple_parent_candidates');
 const namespace=resolveSid(ctx.index,mouse.mouse_sid);if(namespace.reason)blocks.push(namespace.reason);
 if(proposed.length&&mouse.lineage_basis!=null&&!object(mouse.lineage_basis))blocks.push('existing_lineage_basis_malformed');
 const meta=manifestRef(ctx.options);if(proposed.length&&!meta)collector.missing.push('archive_manifest_reference_unavailable');
 if(meta)collector.refs.push(meta);
 const allReasons=unique([...reasons,...blocks,...(proposed.length?collector.missing:[]),...(proposed.length?ctx.completeness.blockers:[])]);
 const supported=proposed.length===1&&allReasons.length===0&&ctx.completeness.complete&&rule!==LINEAGE_RECOVERY_RULES.mating;
 result.proposedParentSids=proposed;result.parentSids=copy(proposed);result.rule=rule;result.evidenceStatus=evidenceStatus;result.confidence=supported&&evidenceStatus==='inferred'?'moderate':null;
 result.status=supported?evidenceStatus:proposed.length?'proposal':direct.exists||review.length||reasons.length?'unresolved':'unknown';
 result.disposition=supported?'supported':blocks.length?'blocked':proposed.length||direct.exists||review.length||reasons.length?'review':'missing_source';
 result.applicable=supported;result.reasonCodes=allReasons.length?allReasons:proposed.length?[]:['no_recorded_lineage_source'];
 result.evidenceRefs=dedupe(collector.refs);result.dependencyRefs=dedupe(collector.refs.filter(r=>r.kind==='managed_record'&&r.entity_type!=='archive'));
 result.evidencePresentation=dedupe(collector.presentation);return result;
}
function reaches(edges,start,target){const todo=[start],seen=new Set();while(todo.length){const id=todo.pop();if(id===target)return true;if(seen.has(id))continue;seen.add(id);todo.push(...(edges.get(id)||[]));}return false;}
function guardGraph(ctx,children){
 const edges=new Map();for(const m of ctx.mice)edges.set(m.mouse_sid,unique(ROLES.flatMap(role=>idArray(rawRole(m,role))?rawRole(m,role).flatMap(id=>resolveSid(ctx.index,id).ids):[])));
 const proposed=children.flatMap(c=>ROLES.map(role=>c.roles[role])).filter(r=>r.applicable);
 for(const r of proposed)edges.set(r.mouseSid,unique([...(edges.get(r.mouseSid)||[]),...r.parentSids]));
 for(const r of proposed){
  const reasons=[];if(reaches(edges,r.parentSids[0],r.mouseSid))reasons.push('prospective_ancestry_cycle');
  // Guard the complete ancestry used by the proposed relationship, not a guessed depth.
  const todo=[r.parentSids[0]],seen=new Set(),deps=[];
  while(todo.length){const id=todo.pop();if(seen.has(id))continue;seen.add(id);const rows=ctx.index.byId.get(id)||[];
   if(rows.length!==1){reasons.push('ancestor_identity_unresolved');continue;}
   const ref=managedRef(ctx.options,'mice',id);if(ref)deps.push(ref);else reasons.push('ancestor_reference_unavailable');
   for(const role of ROLES){const value=rawRole(rows[0],role);if(!idArray(value)){reasons.push('ancestor_parent_role_malformed');continue;}for(const parent of value){const resolved=resolveSid(ctx.index,parent);if(resolved.reason)reasons.push('ancestor_identity_unresolved');else todo.push(resolved.ids[0]);}}
  }
  r.dependencyRefs=dedupe([...r.dependencyRefs,...deps]);
  if(reasons.length){r.applicable=false;r.status='proposal';r.disposition='blocked';r.confidence=null;r.reasonCodes=unique([...r.reasonCodes,...reasons]);}
 }
}
function coverage(children,selected=new Set()){
 const out={population:children.length,withAnyParent:0,withBothRoles:0,sireOnly:0,damOnly:0,withoutParents:0,ambiguousRoles:0,inferredRoles:0,withInferredParents:0};
 for(const c of children){const roles=ROLES.map(role=>{const r=c.roles[role],apply=selected.has(r.key)&&r.applicable;return {ids:apply?r.parentSids:r.existingParentSids,inferred:apply?r.evidenceStatus==='inferred':r.existingParentSids.length>0&&r.status==='inferred'};});
  const s=roles[0].ids.length>0,d=roles[1].ids.length>0;if(s||d)out.withAnyParent++;if(s&&d)out.withBothRoles++;else if(s)out.sireOnly++;else if(d)out.damOnly++;else out.withoutParents++;
  out.ambiguousRoles+=roles.filter(r=>r.ids.length>1).length;out.inferredRoles+=roles.filter(r=>r.inferred).length;if(roles.some(r=>r.inferred))out.withInferredParents++;
 }return out;
}
export function projectLineageRecoveryCoverage(report,selectedKeys=[]){
 if(!Array.isArray(selectedKeys)||selectedKeys.some(k=>typeof k!=='string'))throw new Error('Choose exact lineage role keys.');
 return coverage(report.children||[],new Set(selectedKeys));
}

/** Observer receives phase snapshots only; cancellation belongs to the Worker host. */
export function buildLineageRecovery(dataset,options={}){
 if(!object(dataset)||!object(dataset.tables))throw new Error('A complete named-table dataset is required.');
 const scope=options.scope??'stock';if(!['stock','all'].includes(scope))throw new Error('Choose Stock or all records.');
 if(options.mouseSids!==undefined&&(!idArray(options.mouseSids)||options.mouseSids.length>10000))throw new Error('Choose exact mouse IDs.');
 const notify=phase=>{if(typeof options.onProgress==='function')options.onProgress(Object.freeze({phase}));};
 notify('indexing');const ctx=buildContext(dataset,options),selected=options.mouseSids?new Set(options.mouseSids):null;
 const mice=ctx.mice.filter(m=>text(m?.mouse_sid)&&(!selected||selected.has(m.mouse_sid))&&!archived(m)&&(scope==='all'||m.state==='Stock')).sort((a,b)=>order(a.mouse_sid,b.mouse_sid));
 notify('evaluating');const children=mice.map(m=>({mouseSid:m.mouse_sid,canonicalSid:m.canonical_sid??null,physicalTag:m.physical_tag??null,dateOfBirth:m.date_of_birth??null,sex:m.sex??null,state:m.state??null,receivedDate:m.received_date??null,roles:Object.fromEntries(ROLES.map(role=>[role,roleResult(ctx,m,role)]))}));
 notify('graph');guardGraph(ctx,children);
 const roles=children.flatMap(c=>ROLES.map(role=>c.roles[role]));for(const role of roles)role.presentation=copy(role.evidencePresentation);
 const candidates=roles.filter(r=>r.proposedParentSids.length),bucketMap=new Map();
 const unresolvedKeys=child=>ROLES.map(role=>child.roles[role]).filter(r=>!r.existingParentSids.length&&!r.applicable&&['missing_source','review','blocked'].includes(r.disposition)).map(r=>r.key);
 for(const child of children)if(unresolvedKeys(child).length){const key=child.dateOfBirth??'DOB not recorded';add(bucketMap,key,child);}
 const searchBuckets=[...bucketMap].sort(([a],[b])=>order(a,b)).map(([date,members])=>({key:'date:'+date,dateOfBirth:date==='DOB not recorded'?null:date,mouseSids:members.map(m=>m.mouseSid),unresolvedRoleKeys:members.flatMap(unresolvedKeys),mouseCount:members.length,receivedDateRecorded:members.filter(m=>m.receivedDate).length,isIdentifiedLitter:false,sourceQuestion:'Confirm local birth versus received/source-colony origin, then find explicit child/litter records. Shared DOB does not establish siblings; current cage is not birth evidence.'}));
 const report={schemaVersion:1,policy:LINEAGE_RECOVERY_POLICY,scope,children,roles,candidates,completeness:ctx.completeness,coverageBefore:coverage(children),coverageIfSelected:coverage(children),coverageIfAllSupported:coverage(children,new Set(candidates.filter(r=>r.applicable).map(r=>r.key))),searchBuckets,limits:{automaticRules:[LINEAGE_RECOVERY_RULES.direct,LINEAGE_RECOVERY_RULES.litter],matingChainRequiresReview:true,sourceScope:'Current structured relationships and saved historical review cases; arbitrary historical text is not independently parsed or promoted.',writeAuthority:false,biologicalConfirmation:false}};
 notify('complete');return report;
}
export function evaluateLineageRecoveryRole(dataset,{mouseSid,role},options={}){
 if(!text(mouseSid)||!ROLES.includes(role))throw new Error('Choose an exact mouse and parent role.');
 const report=buildLineageRecovery(dataset,{...options,scope:'all',mouseSids:[mouseSid]});
 return report.children.find(c=>c.mouseSid===mouseSid)?.roles[role]??null;
}
