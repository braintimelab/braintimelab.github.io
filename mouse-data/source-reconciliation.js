import {prepareMouseReviewPrefill,attachMouseReviewResolution,createMouseReviewContext,releaseMouseReviewContext} from './mouse-review.js?v=100';
import {cageObservations} from './cage-observations.js?v=100';
import {compareVerifiedSourceLabels,expectedNoteCell,readCurrentLiteralNote} from './animal-sheet-current-observation.js?v=183';

// Bound only after the private source plan and its complete CAS closure pass review.
// This contains no source observations, animal identifiers or private directory.
export const APPROVED_SOURCE_RECONCILIATION=Object.freeze({sha256:'8d4f9e881ae93fd75899dbc38f342e06e13634c2fafb7f799dd712ccb548a1da',intent:'owner-authorized-softmouse-animal-sheet-identity-associations-v2-2026-10-25'});
// Enabled only after the exact fresh private parentage plan passes review.
export const APPROVED_PARENTAGE_RECONCILIATION=Object.freeze({sha256:'6b213f45e390b7b285a830f284cee56328b091da0ac391d414d092c09e31a093',intent:'owner-authorized-parentage-candidate-refinement-2026-10-26'});
const APPROVED_SOURCE_PLANS=Object.freeze([APPROVED_SOURCE_RECONCILIATION,APPROVED_PARENTAGE_RECONCILIATION]);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(value)&&Number.isFinite(Date.parse(value));
const IDS={mice:'mouse_sid',matings:'mating_sid',litters:'litter_sid',cages:'cage_sid',locations:'location_id',rooms:'room_id',racks:'rack_id',husbandry_events:'event_id',light_events:'event_id'};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const canonicalSourceJSON=value=>Array.isArray(value)?'['+value.map(canonicalSourceJSON).join(',')+']':plain(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalSourceJSON(value[key])).join(',')+'}':JSON.stringify(value);
const equal=(a,b)=>canonicalSourceJSON(a)===canonicalSourceJSON(b);
const copy=value=>structuredClone(value);
const key=row=>row.entity_type+':'+row.entity_id;
const bytes=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).byteLength;
const fail=message=>{throw new Error(message);};
const assert=(condition,message)=>{if(!condition)fail(message);};
const text=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const inactive=row=>row?.archived===true||Boolean(row?.app_archived_at)||row?.history_read_only===true||row?.source_historical===true;
const allowedKinds=new Set(['create_softmouse_mouse','associate_current_animal_sheet_mouse','record_owner_confirmed_mouse_end','resolve_current_animal_sheet_mouse','set_ear_mark','narrow_inferred_parentage','record_source_reconciliation_batch']);
const tagKey=value=>typeof value==='string'?value.trim().replace(/[′’‘]/g,"'").replace(/[‐‑‒–—―−]/g,'-').replace(/^(.*?)(?:\s+|-)([MF]\d+)$/,'$1-$2'):'';
const fullTags=mouse=>{const raw=[mouse.physical_tag,...(Array.isArray(mouse.physical_tag_aliases)?mouse.physical_tag_aliases:[])];if(/^\d+$/.test(mouse.mouse_sid||'')&&/[-\s][MF]$/.test(mouse.physical_tag||''))raw.push(mouse.physical_tag+mouse.mouse_sid);return [...new Set(raw.map(tagKey).filter(value=>/^.+(?:-|\s)[MF]\s*\d+[A-Za-z]?$/.test(value)))];};
const uniqueRows=rows=>{const map=new Map();for(const row of rows){assert(plain(row)&&Object.hasOwn(IDS,row.entity_type)&&text(row.entity_id)&&!map.has(key(row)),'The plan contains invalid or repeated record keys.');map.set(key(row),row);}return map;};
const resolutionOf=operation=>operation.association?.resolution??operation.resolution;
const associationPresentation=operation=>operation.association?{identityAssociation:{inferred:true,confidence:operation.association.identityEvidence.confidence,recordedTag:operation.association.identityEvidence.recorded_tag,observedTag:operation.association.identityEvidence.observed_tag,tagNeedsCheck:operation.association.identityEvidence.tag_review?.status==='needs_check'},...(operation.association.identityEvidence.owner_lifecycle_decision?{ownerLifecycleCorrection:copy(operation.association.identityEvidence.owner_lifecycle_decision)}:{})}:{};
export async function sourcePlanDigest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}


const PARENTAGE_POLICY='owner_authorized_parentage_candidate_refinement';
const PARENTAGE_RULE='dam_terminal_end_before_offspring_birth';
const PARENTAGE_INTENT='owner-authorized-parentage-candidate-refinement-2026-10-26';
// These exact source endpoints establish death/removal for this narrow rule.
// Retirement, end of breeding, source absence and sire death are not this rule.
const TERMINAL_PARENT_END_TYPES=new Set(['Harvested','Sacrificed','Found Dead']);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const exactIds=value=>Array.isArray(value)&&value.every(text)&&new Set(value).size===value.length;
const sameSet=(first,second)=>exactIds(first)&&exactIds(second)&&first.length===second.length&&first.every(id=>second.includes(id));
function parentageSource(payload){
 assert(payload?.record_origin==='explicit_export'&&text(payload.source_record_id)&&text(payload.source_filename)&&text(payload.source_sheet)&&Number.isSafeInteger(payload.source_row)&&payload.source_row>0&&HASH.test(payload.source_sha256||''),'Parentage evidence requires exact original export provenance.');
 return Object.fromEntries(['record_origin','source_record_id','source_filename','source_sheet','source_row','source_sha256'].map(field=>[field,copy(payload[field])]));
}

/** Exact compact evidence for the one supported, source-backed dam refinement. */
export function parentageEvidenceRefs(before,afterDamSids,dependencyRows,supportingSourceRefs){
 assert(plain(before)&&text(before.mouse_sid)&&day(before.date_of_birth)&&exactIds(before.sire_sids)&&exactIds(before.dam_sids)&&before.dam_sids.length>=2&&exactIds(afterDamSids)&&afterDamSids.length>0&&afterDamSids.length<before.dam_sids.length&&afterDamSids.every(id=>before.dam_sids.includes(id)),'A parentage refinement must retain a strict nonempty subset of existing dam alternatives.');
 assert(before.lineage_basis==null,'An existing lineage basis requires a separate reviewed history policy.');
 const dependencies=uniqueRows(dependencyRows),refs=[{kind:'child_parentage',mouse_sid:before.mouse_sid,date_of_birth:before.date_of_birth,sire_sids:copy(before.sire_sids),dam_sids:copy(before.dam_sids),source:parentageSource(before)}];
 for(const id of before.dam_sids){
  const row=dependencies.get('mice:'+id),parent=row?.payload,excluded=!afterDamSids.includes(id);
  assert(row&&!row.archived&&!parent?.app_archived_at&&parent?.mouse_sid===id&&parent.sex==='Female'&&day(parent.date_of_birth)&&parent.date_of_birth<before.date_of_birth,'A dam candidate lacks its exact valid identity and chronology.');
  if(parent.state==='Ended'&&TERMINAL_PARENT_END_TYPES.has(parent.end_type))assert(day(parent.end_date)&&parent.end_date>=parent.date_of_birth,'The terminal dam endpoint has invalid source chronology.');
  const terminalBefore=parent.state==='Ended'&&TERMINAL_PARENT_END_TYPES.has(parent.end_type)&&day(parent.end_date)&&parent.end_date<before.date_of_birth;
  assert(excluded?terminalBefore:!terminalBefore,'Only an exact terminal dam endpoint before offspring birth supports this exclusion.');
  refs.push({kind:'parent_lifecycle',role:'dam',mouse_sid:id,date_of_birth:parent.date_of_birth,sex:parent.sex,state:parent.state??null,end_date:parent.end_date??null,end_type:parent.end_type??null,outcome:excluded?'excluded_before_birth':'retained_candidate',source:parentageSource(parent)});
 }
 assert(Array.isArray(supportingSourceRefs)&&supportingSourceRefs.length===2&&supportingSourceRefs.every(ref=>plain(ref)&&equal(Object.keys(ref).sort(),['entity_id','entity_type'])&&text(ref.entity_id)),'The refinement requires exact linked litter and mating source references.');
 const litterRef=supportingSourceRefs.find(ref=>ref.entity_type==='litters'),matingRef=supportingSourceRefs.find(ref=>ref.entity_type==='matings');
 assert(litterRef&&matingRef&&litterRef.entity_id===before.litter_sid,'The linked source references do not identify the child litter and mating.');
 const litterRow=dependencies.get(key(litterRef)),matingRow=dependencies.get(key(matingRef)),litter=litterRow?.payload,mating=matingRow?.payload;
 assert(litterRow&&!litterRow.archived&&!litter?.app_archived_at&&matingRow&&!matingRow.archived&&!mating?.app_archived_at&&litter?.litter_sid===litterRef.entity_id&&mating?.mating_sid===matingRef.entity_id&&litter.mating_sid===matingRef.entity_id,'The linked parentage source dependencies are unavailable or inconsistent.');
 assert(litter.date_of_birth===before.date_of_birth&&sameSet(litter.sire_sids,before.sire_sids)&&sameSet(litter.dam_sids,before.dam_sids)&&Array.isArray(litter.listed_pup_sids)&&litter.listed_pup_sids.includes(before.mouse_sid),'The linked litter does not retain the exact original child parentage.');
 assert(exactIds(mating.male_sids)&&exactIds(mating.female_sids)&&before.sire_sids.every(id=>mating.male_sids.includes(id))&&before.dam_sids.every(id=>mating.female_sids.includes(id))&&day(mating.set_up_date)&&mating.set_up_date<before.date_of_birth&&(!mating.disbanded_date||day(mating.disbanded_date)&&mating.disbanded_date>=mating.set_up_date),'The linked mating does not support the original candidates and dated setup.');
 refs.push({kind:'linked_litter',entity_type:'litters',entity_id:litterRef.entity_id,date_of_birth:litter.date_of_birth,mating_sid:litter.mating_sid,sire_sids:copy(litter.sire_sids),dam_sids:copy(litter.dam_sids),child_listed:true,source:parentageSource(litter)});
 refs.push({kind:'linked_mating',entity_type:'matings',entity_id:matingRef.entity_id,set_up_date:mating.set_up_date,disbanded_date:mating.disbanded_date??null,male_sids:copy(mating.male_sids),female_sids:copy(mating.female_sids),source:parentageSource(mating)});
 return refs;
}

/** Privacy-bounded batch audit: references and before/after IDs, no source body. */
export function parentageBatchPayload(plan,operation,eventId){
 return {event_id:eventId,event_type:'source_reconciliation_batch',schema_version:1,operation_id:plan.operation_id,plan_id:plan.plan_id,recorded_at:operation.patch.app_modified_at,parentage_policy:PARENTAGE_POLICY,changed_parentage:[{mouse_sid:operation.entity_id,role:'dam',before_sids:copy(operation.before.dam_sids),after_sids:copy(operation.patch.dam_sids),confidence:'moderate',decision_rule:PARENTAGE_RULE}],original_parentage_preserved:true,biological_confirmation:false};
}
function checkParentageShape(operation,dependencies){
 assert(equal(Object.keys(operation).sort(),['archived','before','entity_id','entity_type','expected_version','kind','parent_role','patch','supporting_source_refs']),'A parentage refinement contains unsupported operation fields.');
 const prior=dependencies.get(key(operation));
 assert(operation.parent_role==='dam'&&Number.isSafeInteger(operation.expected_version)&&operation.expected_version>0&&plain(operation.before)&&operation.before.mouse_sid===operation.entity_id&&prior&&!prior.archived&&prior.version===operation.expected_version&&equal(prior.payload,operation.before),'A parentage refinement lacks its exact original mouse and version.');
 assert(plain(operation.patch)&&equal(Object.keys(operation.patch).sort(),['app_modified_at','dam_sids','lineage_basis'])&&timestamp(operation.patch.app_modified_at),'A parentage refinement may change only dam alternatives, lineage evidence and app modification time.');
 const basis=operation.patch.lineage_basis;
 assert(plain(basis)&&equal(Object.keys(basis).sort(),['confidence','decision_rule','evidence_refs','inferred_roles','kind','original_parentage','policy','recorded_at','schema_version'])&&basis.schema_version===1&&basis.kind==='source_reconciliation_inference'&&basis.policy===PARENTAGE_POLICY&&basis.decision_rule===PARENTAGE_RULE&&basis.confidence==='moderate'&&equal(basis.inferred_roles,['dam'])&&basis.recorded_at===operation.patch.app_modified_at&&equal(basis.original_parentage,{sire_sids:operation.before.sire_sids,dam_sids:operation.before.dam_sids}),'The parentage inference must preserve its exact original alternatives and moderate evidence label.');
 const evidence=parentageEvidenceRefs(operation.before,operation.patch.dam_sids,[...dependencies.values()],operation.supporting_source_refs);
 assert(equal(evidence,basis.evidence_refs),'The parentage evidence differs from exact guarded source facts.');
}
function checkParentageAncestry(operation,scope,mice){
 const pending=[operation.entity_id,...operation.before.sire_sids,...operation.before.dam_sids],seen=new Set();
 while(pending.length){
  const id=pending.pop();if(seen.has(id))continue;seen.add(id);
  const row=mice.get('mice:'+id),dep=scope.dependencies.get('mice:'+id);
  assert(row&&dep&&!row.archived&&!dep.archived&&row.version===dep.version&&equal(row.payload,dep.payload),'A parentage ancestry or candidate identity is missing from the exact current CAS closure.');
  assert(exactIds(row.payload.sire_sids)&&exactIds(row.payload.dam_sids),'A parentage ancestor has malformed parent arrays.');
  pending.push(...row.payload.sire_sids,...row.payload.dam_sids);
 }
}
const parentagePresentation=operation=>operation.kind==='narrow_inferred_parentage'?{parentageRefinement:{role:'dam',before:copy(operation.before.dam_sids),after:copy(operation.patch.dam_sids),confidence:'moderate',decisionRule:PARENTAGE_RULE,originalParentagePreserved:true}}:{};

function applyReviewedFreshComment(expected,operation,proof,sourceRow){
 const policy=operation.evidence?.fresh_comment_policy;if(policy===undefined)return expected;
 const keys=['kind','before','after','source_file_id','source_sheet_id','source_location_id','source_cell','source_range','source_xlsx_sha256','source_core_sha256','source_modified_at','source_capture_at'];
 assert(operation.kind==='resolve_current_animal_sheet_mouse'&&operation.expected_version===0&&plain(policy)&&equal(Object.keys(policy).sort(),keys.sort())&&policy.kind==='fresh_animal_sheet_literal_comment','The fresh comment policy is invalid.');
 const valid=value=>plain(value)&&equal(Object.keys(value).sort(),['present','value'])&&typeof value.present==='boolean'&&(value.present?typeof value.value==='string'&&value.value.length<=2000&&Boolean(value.value.trim()):value.value===null);
 assert(valid(policy.before)&&valid(policy.after),'The literal source comment evidence is invalid.');
 const before={present:Object.hasOwn(expected,'comment'),value:Object.hasOwn(expected,'comment')?expected.comment:null};
 assert(equal(before,policy.before),'The guarded current-card helper comment differs from its reviewed BEFORE evidence.');
 for(const name of ['source_file_id','source_sheet_id','source_location_id','source_cell','source_xlsx_sha256','source_core_sha256','source_modified_at','source_capture_at'])assert(equal(policy[name],proof[name]),'The fresh comment source provenance differs from the exact current source proof.');
 assert(typeof policy.source_range==='string'&&policy.source_range.length<=1000&&policy.source_range===sourceRow.payload.source_block_range,'The fresh comment range differs from the guarded source card.');
 const result={...expected};if(policy.after.present)result.comment=policy.after.value;else delete result.comment;return result;
}

function sourceManagerMapping(label,directory){
 if(typeof label!=='string'||!label.trim()||/^(guest|unknown|unassigned|n\/?a)$/i.test(label.trim()))return null;
 const match=label.trim().normalize('NFC').toLocaleLowerCase('en-US'),matches=new Map();
 for(const row of directory||[]){if(!plain(row)||row.status!=='current'||!text(row.person_id)||!text(row.name))continue;
  if([row.name,row.acronym,row.nickname].some(value=>typeof value==='string'&&value.trim().normalize('NFC').toLocaleLowerCase('en-US')===match))matches.set(row.person_id,row.name);
 }
 return matches.size===1?{personId:[...matches.keys()][0],name:[...matches.values()][0]}:null;
}
export const resolveSourceManager=(label,directory)=>sourceManagerMapping(label,directory)?.name??null;
const managerAssignments=(plan,directory)=>plan.operations.filter(row=>row.kind==='resolve_current_animal_sheet_mouse').map(row=>{const match=sourceManagerMapping(row.evidence?.sourceManagerLabel,directory);return {id:row.entity_id,manager:match?.name??null,personId:match?.personId??null};});

function planShape(plan,binding){
 assert(plain(plan)&&plan.kind==='mouse-data-source-reconciliation-plan'&&plan.schema_version===1,'Choose the reviewed source reconciliation plan.');
 assert(plan.dispatch_authorized===true&&!(typeof plan.status==='string'&&/DRAFT/i.test(plan.status)),'This draft plan is not authorized for dispatch.');
 assert(UUID.test(plan.colony_id||'')&&UUID.test(plan.operation_id||'')&&text(plan.plan_id),'The plan identity is invalid.');
 assert(equal(plan.intent,binding.intent),'The plan intent differs from the reviewed import.');
 assert(Array.isArray(plan.operations)&&plan.operations.length>0&&plan.operations.length<=250&&Array.isArray(plan.dependencies)&&plan.dependencies.length<=500&&Array.isArray(plan.expectedMissing)&&plan.expectedMissing.length<=500,'The plan record scope is invalid.');
 assert(plain(plan.sourcePins)||Array.isArray(plan.sourcePins),'Source provenance is missing.');
 assert(plain(plan.globalGraphGate),'The reviewed graph provenance is missing.');
 const operations=uniqueRows(plan.operations),dependencies=uniqueRows(plan.dependencies),missing=uniqueRows(plan.expectedMissing);
 for(const row of dependencies.values())assert(Number.isSafeInteger(row.version)&&row.version>0&&typeof row.archived==='boolean'&&plain(row.payload)&&row.payload[IDS[row.entity_type]]===row.entity_id,'A dependency lacks its exact original record and version.');
 const writes=new Map();
 for(const operation of operations.values()){
  assert(allowedKinds.has(operation.kind)&&operation.entity_type===(operation.kind==='record_source_reconciliation_batch'?'husbandry_events':'mice')&&operation.archived===false,'This plan requests an unsupported mutation.');
  if(operation.evidence?.fresh_comment_policy!==undefined)assert(operation.kind==='resolve_current_animal_sheet_mouse','Fresh source comments are limited to new AnimalSheet registrations.');
  if(['associate_current_animal_sheet_mouse','record_owner_confirmed_mouse_end'].includes(operation.kind)){
   const prior=dependencies.get(key(operation));assert(Number.isSafeInteger(operation.expected_version)&&operation.expected_version>0&&plain(operation.before)&&plain(operation.payload)&&operation.before.mouse_sid===operation.entity_id&&operation.payload.mouse_sid===operation.entity_id&&prior&&!prior.archived&&prior.version===operation.expected_version&&equal(prior.payload,operation.before)&&plain(operation.association),'An existing source association lacks its exact original record and version.');
  }else if(operation.kind==='narrow_inferred_parentage'){
   checkParentageShape(operation,dependencies);
  }else if(operation.kind==='set_ear_mark'){
   assert(Number.isSafeInteger(operation.expected_version)&&operation.expected_version>0&&plain(operation.before)&&plain(operation.patch)&&equal(Object.keys(operation.patch).sort(),['ear_mark','reconciliation_evidence']),'An ear correction contains other field changes.');
   assert(dependencies.has(key(operation))&&equal(dependencies.get(key(operation)).payload,operation.before)&&dependencies.get(key(operation)).version===operation.expected_version&&!dependencies.get(key(operation)).archived,'An ear correction lacks its exact original dependency.');
   assert(typeof operation.patch.ear_mark==='string'&&operation.patch.ear_mark.trim()&&operation.patch.ear_mark.length<=160&&operation.before.cage_sheet_overrides?.ear_mark!==true,'An ear correction is invalid or overridden.');
   const prior=operation.before.reconciliation_evidence??[];
   assert(Array.isArray(prior)&&Array.isArray(operation.patch.reconciliation_evidence)&&operation.patch.reconciliation_evidence.length===prior.length+1&&equal(operation.patch.reconciliation_evidence.slice(0,-1),prior),'Ear evidence must append to the original history.');
  }else{
   assert(operation.expected_version===0&&operation.before===null&&plain(operation.payload)&&operation.payload[IDS[operation.entity_type]]===operation.entity_id&&missing.has(key(operation))&&!dependencies.has(key(operation)),'A new record is not guarded by confirmed absence.');
   if(operation.kind==='record_source_reconciliation_batch')assert(operation.payload.event_type==='source_reconciliation_batch','The batch audit record has an unsupported event type.');
  }
  if(operation.kind==='record_owner_confirmed_mouse_end')assert(plain(operation.patch)&&equal(Object.keys(operation.patch).sort(),['end_date','end_type','state'])&&operation.patch.state==='Ended'&&operation.patch.end_type==='Sacrificed'&&/^\d{4}-\d{2}-\d{2}$/.test(operation.patch.end_date||'')&&new Date(operation.patch.end_date+'T00:00:00Z').toISOString().slice(0,10)===operation.patch.end_date,'The owner-confirmed correction is limited to its reviewed day and three lifecycle fields.');
  if(operation.association!==undefined)assert(['create_softmouse_mouse','associate_current_animal_sheet_mouse','record_owner_confirmed_mouse_end'].includes(operation.kind)&&plain(operation.association)&&equal(Object.keys(operation.association).sort(),['helperInput','identityEvidence','reconciliationEvidence','resolution']),'The source association shape is invalid.');
  const resolution=resolutionOf(operation);
  if(operation.kind==='resolve_current_animal_sheet_mouse'||operation.association!==undefined){
   assert(plain(resolution)&&resolution.entity_type==='husbandry_events'&&text(resolution.entity_id)&&resolution.expected_version===0&&resolution.archived===false&&plain(resolution.payload)&&resolution.payload.event_id===resolution.entity_id&&resolution.payload.event_type==='animal_sheet_mouse_review'&&missing.has(key(resolution))&&!dependencies.has(key(resolution)),'A source association lacks its stable resolution guard.');
   assert(!writes.has(key(resolution)),'Two operations share a Review resolution.');writes.set(key(resolution),resolution);
  }
  assert(!writes.has(key(operation)),'The plan repeats a mutation.');writes.set(key(operation),operation);
 }
 const parentage=[...operations.values()].filter(operation=>operation.kind==='narrow_inferred_parentage');
 if(parentage.length){
  assert(parentage.length===1&&plan.intent===PARENTAGE_INTENT&&operations.size===2,'A parentage-only plan must contain one refinement and one batch audit.');
  const audit=[...operations.values()].find(operation=>operation.kind==='record_source_reconciliation_batch');
  assert(audit&&equal(audit.payload,parentageBatchPayload(plan,parentage[0],audit.entity_id)),'The parentage-only audit differs from its exact compact decision.');
 }
 assert([...missing.keys()].every(value=>writes.has(value)),'The plan contains unrelated absence checks.');
 assert(new Set([...writes.keys(),...dependencies.keys()]).size<=500,'This plan exceeds the atomic record limit.');
 return {operations,dependencies,missing};
}

function datasetForReview(mice,dependencies){
 const tables=Object.fromEntries(Object.keys(IDS).map(type=>[type,[]]));tables.mice=mice.filter(row=>!row.archived).map(row=>copy(row.payload));
 for(const row of dependencies.values())if(row.entity_type!=='mice'&&!row.archived)tables[row.entity_type].push(copy(row.payload));
 // This is the explicitly reviewed current-source scope. Historical captures
 // stay in the original workspace and are never overwritten by this command.
 tables.husbandry_events=tables.husbandry_events.filter(row=>row.event_type==='animal_sheet_mouse_review');
 return {tables};
}

function checkedSourceObservation(operation,issue,sourceRow){
 const value=operation.sourceObservation,keys=['schema_version','source_location_id','source_cell','source_tag','date_of_birth','sex','ear_mark','note_cell','note_text','source_file_id','source_sheet_id','source_range','source_xlsx_sha256','source_capture_at','source_modified_at','effective_movement_date'];
 assert(plain(value)&&equal(Object.keys(value).sort(),keys.sort())&&value.schema_version===1&&value.effective_movement_date===null,'The compact source observation shape is invalid.');
 const source=issue.sources[0],observations=cageObservations(sourceRow.payload).animals.filter(animal=>animal.sourceCell===value.source_cell);
 assert(observations.length===1&&value.source_location_id===sourceRow.entity_id&&value.source_cell===source.cell&&value.source_tag===source.tag&&value.date_of_birth===source.dateOfBirth&&value.sex===source.sex&&value.ear_mark===(observations[0].earMark??null)&&value.note_text===(observations[0].note||null),'The dated source observation differs from the exact current literal card.');
 assert(/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(value.note_cell||'')&&value.source_file_id===sourceRow.payload.source_file_id&&String(value.source_sheet_id)===String(sourceRow.payload.source_sheet_id)&&value.source_range===sourceRow.payload.source_block_range&&HASH.test(value.source_xlsx_sha256||'')&&timestamp(value.source_capture_at)&&timestamp(value.source_modified_at),'The compact observation source metadata is invalid.');
 const note=readCurrentLiteralNote(sourceRow.payload,value.note_cell);assert(expectedNoteCell(sourceRow.payload,value.source_cell)===value.note_cell&&note.known&&note.value===value.note_text,'The source observation NOTE cell is not an exact current literal.');
 assert(value.note_text===null||typeof value.note_text==='string'&&value.note_text.length<=2000,'The literal source note is too large.');return copy(value);
}

async function compactReference(operation,resolution,basis,sourceObservation,provided){
 const digest=await sourcePlanDigest(canonicalSourceJSON({association_basis:basis,source_observation:sourceObservation})),reference={schema_version:1,kind:'source_reconciliation_association_ref',event_id:resolution.entity_id,source_issue_id:resolution.payload.review_issue_id,evidence_sha256:digest};
 assert(equal(reference,provided),'The compact source evidence reference differs from its exact full event.');return reference;
}
async function compileIdentityAssociation(operation,data,scope,reviewContext){
 const association=operation.association,input=association.helperInput,basis=association.identityEvidence,existing=operation.expected_version>0,ownerEnd=operation.kind==='record_owner_confirmed_mouse_end',base=copy(existing?operation.before:operation.payload);
 assert(plain(input)&&equal(Object.keys(input).sort(),['confirmed','issue_id','mouse_sid','source_refs'])&&input.confirmed===true&&text(input.issue_id)&&Array.isArray(input.source_refs)&&input.mouse_sid===(existing?operation.entity_id:null),'The inferred source association selection is invalid.');
 assert(!inactive(base)&&['Stock','Unknown'].includes(base.state)&&['Male','Female'].includes(base.sex),'An ended, archived or incomplete identity cannot be automatically associated.');
 const prepared=prepareMouseReviewPrefill(data,input.issue_id,{mouseSid:input.mouse_sid,reviewContext}),issue=prepared.issue;
 assert(issue.reason==='missing_mouse'&&issue.canCreate===true&&issue.candidateMouseSids.length===0&&issue.current===true&&issue.currentSourceCount===1&&issue.sourceCount===1&&issue.sources.length===1&&issue.dateOfBirth===base.date_of_birth&&issue.sex===base.sex&&equal(prepared.sourceRefs,input.source_refs),'The current identity association is changed, incomplete or ambiguous.');
 const basisKeys=['schema_version','kind','confidence','inferred','policy','scope','tag_review','mouse_sid','recorded_tag','observed_tag','date_of_birth','sex','softmouse','animal_sheet','unique_numeric_sid_source_observations','genotype_tag_lifecycle_unchanged','effective_movement_date',...(ownerEnd?['owner_lifecycle_decision']:[])];
 assert(plain(basis)&&equal(Object.keys(basis).sort(),basisKeys.sort())&&basis.schema_version===1&&basis.kind==='explicit_sid_dob_sex_inference'&&basis.confidence==='high'&&basis.inferred===true&&basis.policy==='owner_authorized_current_source_association'&&basis.mouse_sid===base.mouse_sid&&basis.recorded_tag===base.physical_tag&&basis.observed_tag===issue.tag&&basis.date_of_birth===base.date_of_birth&&basis.sex===base.sex&&basis.unique_numeric_sid_source_observations===1&&basis.genotype_tag_lifecycle_unchanged===!ownerEnd&&basis.effective_movement_date===null,'The inferred source association evidence is invalid.');
 if(ownerEnd){const decision=basis.owner_lifecycle_decision;assert(plain(decision)&&equal(Object.keys(decision).sort(),['after','before','date_precision','effective_end_date','evidence_refs','exact_time','kind','recorded_at','schema_version'])&&decision.schema_version===1&&decision.kind==='owner_confirmed_mouse_lifecycle'&&decision.date_precision==='day'&&decision.exact_time===null&&timestamp(decision.recorded_at)&&decision.effective_end_date===operation.patch.end_date&&equal(decision.before,{state:base.state??null,end_date:base.end_date??null,end_type:base.end_type??null})&&equal(decision.after,operation.patch)&&Array.isArray(decision.evidence_refs)&&decision.evidence_refs.length>0&&decision.evidence_refs.length<=100&&decision.evidence_refs.every(plain),'The lifecycle change lacks its exact explicit owner decision.');}
 const tagComparison=compareVerifiedSourceLabels(base.physical_tag,issue.tag,{mouseSid:base.mouse_sid,sex:base.sex});
 assert(basis.scope==='identity_association_only'&&plain(basis.tag_review)&&equal(Object.keys(basis.tag_review).sort(),['date_of_birth','observed_tag','recorded_tag','sex','status'])&&basis.tag_review.recorded_tag===base.physical_tag&&basis.tag_review.observed_tag===issue.tag&&basis.tag_review.date_of_birth===base.date_of_birth&&basis.tag_review.sex===base.sex&&basis.tag_review.status===(tagComparison.classification==='prefix_discrepancy'?'needs_check':'not_required')&&operation.evidence?.tag_comparison===tagComparison.classification,'The tag discrepancy review does not match the exact source labels.');
 assert(plain(basis.softmouse)&&equal(Object.keys(basis.softmouse).sort(),['mouse_sid','source_record_id','source_row','source_sha256','source_sheet']),'The original SoftMouse source identity is missing.');
 for(const field of Object.keys(basis.softmouse))assert(equal(basis.softmouse[field],base[field]),'The original SoftMouse provenance differs from the target record.');
 assert(text(base.source_record_id)&&text(base.source_sheet)&&HASH.test(base.source_sha256||'')&&Number.isSafeInteger(base.source_row)&&base.source_row>0,'The target has no explicit original SoftMouse provenance.');
 const fresh=operation.evidence?.fresh_softmouse;
 assert(plain(fresh)&&equal(Object.keys(fresh).sort(),['date_of_birth','mouse_sid','physical_tag','sex','source_record_id','source_row','source_sha256','source_sheet'])&&fresh.mouse_sid===base.mouse_sid&&fresh.date_of_birth===base.date_of_birth&&fresh.sex===base.sex&&fresh.physical_tag===base.physical_tag&&text(fresh.physical_tag)&&text(fresh.source_record_id)&&text(fresh.source_sheet)&&Number.isSafeInteger(fresh.source_row)&&fresh.source_row>0&&HASH.test(fresh.source_sha256||''),'The fresh explicit SoftMouse identity authority is incomplete.');
 const suffix=issue.tag.match(/^.+[-\s]([MF])(\d+)$/);
 assert(suffix&&suffix[2]===base.mouse_sid&&suffix[1]===(base.sex==='Male'?'M':'F'),'The full AnimalSheet label does not match the explicit source SID and sex.');
 const source=issue.sources[0],meta=basis.animal_sheet,metaKeys=['source_file_id','source_sheet_id','source_location_id','source_cell','source_range','source_xlsx_sha256','source_core_sha256','source_modified_at','source_capture_at'];
 assert(plain(meta)&&equal(Object.keys(meta).sort(),metaKeys.sort()),'The AnimalSheet association source shape is invalid.');
 const row=scope.dependencies.get('locations:'+meta.source_location_id);
 assert(row&&!row.archived&&!inactive(row.payload)&&row.payload.source_current===true&&row.payload.active!==false&&row.payload.source_position_closed!==true&&source.current===true&&source.recordId===row.entity_id&&source.cell===meta.source_cell&&row.payload.source_file_id===meta.source_file_id&&String(row.payload.source_sheet_id)===String(meta.source_sheet_id)&&row.payload.source_block_range===meta.source_range&&HASH.test(meta.source_xlsx_sha256||'')&&HASH.test(meta.source_core_sha256||'')&&timestamp(meta.source_modified_at)&&timestamp(meta.source_capture_at),'The inferred association does not refer to an exact current source card.');
 const sourceObservation=checkedSourceObservation(operation,issue,row);for(const field of ['source_file_id','source_sheet_id','source_location_id','source_cell','source_range','source_xlsx_sha256','source_modified_at','source_capture_at'])assert(equal(sourceObservation[field],meta[field]),'The observation snapshot and identity evidence refer to different captures.');
 const sourceMatches=[];for(const position of data.tables.locations){if(inactive(position)||position.source_current!==true||position.active===false||position.source_position_closed===true||position.source_file_id!==meta.source_file_id)continue;for(const animal of cageObservations(position).animals){const match=animal.tag.match(/^.+[-\s]([MF])(\d+)$/);if(match?.[2]===base.mouse_sid)sourceMatches.push([position.location_id,animal.sourceCell,animal.tag]);}}
 assert(sourceMatches.length===1&&equal(sourceMatches[0],[row.entity_id,meta.source_cell,issue.tag]),'The numeric source SID occurs in multiple current AnimalSheet observations.');
 const otherTargets=data.tables.mice.filter(mouse=>mouse.mouse_sid===base.mouse_sid&&mouse.date_of_birth===base.date_of_birth&&mouse.sex===base.sex);
 assert(otherTargets.length===(existing?1:0),'The selected source identity is missing or duplicated.');
 const attached=attachMouseReviewResolution(data,base,input.issue_id,{confirmed:true,mouseSid:input.mouse_sid,reviewContext});
 for(const guard of attached.guards){const dep=scope.dependencies.get(guard.type+':'+guard.id);assert(dep&&equal(dep.payload,guard.payload),'An inferred association read dependency is missing.');}
 const prior=base.reconciliation_evidence??[];assert(Array.isArray(prior),'Existing reconciliation evidence is not appendable.');
 const reference=await compactReference(operation,association.resolution,basis,sourceObservation,association.reconciliationEvidence);
 const payload={...attached.draft,...(ownerEnd?copy(operation.patch):{}),animal_sheet_review_links:attached.draft.animal_sheet_review_links.map(link=>link.issue_id===input.issue_id?{...link,association_ref:copy(reference)}:link),reconciliation_evidence:[...copy(prior),copy(reference)]};
 const resolution={...attached.resolutionRecord,association_basis:copy(basis),source_observation:copy(sourceObservation),association_sha256:reference.evidence_sha256};
 assert(equal(resolution,association.resolution.payload),'The stable inferred-association resolution differs from the current helper.');
 if(existing)assert(equal(payload,operation.payload),'The existing association changes fields beyond its reviewed metadata.');
 else{assert(!Object.hasOwn(base,'animal_sheet_review_links')&&!Object.hasOwn(base,'reconciliation_evidence'),'Original SoftMouse imports cannot contain app association metadata.');const stripped={...payload};delete stripped.animal_sheet_review_links;delete stripped.reconciliation_evidence;assert(equal(stripped,base),'A composite import changed original SoftMouse fields.');}
 return payload;
}

async function compile(plan,scope,snapshot,directory,validate,{check=()=>{},progress=()=>{}}={}){
 const yieldProgress=async(phase,completed,total)=>{check();try{progress({phase,completed,total});}catch{/* Presentation cannot authorize or alter a command. */}await new Promise(resolve=>setTimeout(resolve,0));check();};
 const actual=uniqueRows(snapshot.records),mice=uniqueRows(snapshot.mice);
 assert(snapshot.colonyId===plan.colony_id,'The plan belongs to another colony.');
 for(const [id,row]of scope.dependencies){const found=actual.get(id);assert(found&&found.version===row.version&&found.archived===row.archived&&equal(found.payload,row.payload),'A source or target record changed. Obtain a fresh reviewed plan.');}
 for(const id of scope.missing.keys())assert(!actual.has(id)&&!mice.has(id),'A planned new record already exists. Check the original operation before continuing.');
 const data=datasetForReview([...mice.values()],scope.dependencies),changes=new Map(),managerMap=[],warnings=[],validated=[];
 for(const operation of scope.operations.values())if(operation.kind==='narrow_inferred_parentage')checkParentageAncestry(operation,scope,mice);
 // A fresh full identity scan includes alternate full tags. Conservative
 // conflicts are held for a new review rather than creating another animal.
 const tagOwners=new Map();for(const {payload:mouse}of mice.values())for(const tag of fullTags(mouse)){const ids=tagOwners.get(tag)||new Set();ids.add(mouse.mouse_sid);tagOwners.set(tag,ids);}
 for(const operation of scope.operations.values())if(operation.kind==='create_softmouse_mouse'){
  const target=operation.payload;
  for(const {payload:mouse}of mice.values())if(mouse.mouse_sid!==target.mouse_sid&&mouse.date_of_birth===target.date_of_birth&&mouse.sex===target.sex){
   const candidates=[mouse.physical_tag,...(Array.isArray(mouse.physical_tag_aliases)?mouse.physical_tag_aliases:[])];
   assert(!candidates.some(tag=>{const match=typeof tag==='string'?tag.match(/^.+[-\s]([MF])(\d+)$/):null;return match&&match[2]===target.mouse_sid&&match[1]===(target.sex==='Male'?'M':target.sex==='Female'?'F':null);}), 'An existing AnimalSheet or custom record has this exact source SID, DOB and sex. Review the possible duplicate before importing.');
  }
 }
 for(const operation of scope.operations.values())if(operation.entity_type==='mice'&&operation.expected_version===0){for(const tag of fullTags(operation.payload)){assert(!tagOwners.has(tag),'A planned full tag now matches another mouse. Review the current identities.');tagOwners.set(tag,new Set([operation.entity_id]));}}
 const reviewState=createMouseReviewContext(data),reviewData=reviewState.snapshot,reviewContext=reviewState.context;
 try{
 let preparedCount=0;for(const operation of scope.operations.values()){
  await yieldProgress('preparing',preparedCount++,scope.operations.size);
  if(operation.kind==='record_source_reconciliation_batch'){const result=validate('husbandry_events',operation.payload,data,null);assert(result?.errors?.length===0,'The batch audit record failed validation.');changes.set(key(operation),{entity_type:operation.entity_type,entity_id:operation.entity_id,payload:copy(operation.payload),archived:false,expected_version:0});continue;}
  let payload;
  if(['set_ear_mark','narrow_inferred_parentage'].includes(operation.kind))payload={...copy(operation.before),...copy(operation.patch)};
  else if(['create_softmouse_mouse','associate_current_animal_sheet_mouse','record_owner_confirmed_mouse_end'].includes(operation.kind)){
   payload=operation.association?await compileIdentityAssociation(operation,reviewData,scope,reviewContext):copy(operation.payload);
   if(operation.association){const resolution=operation.association.resolution;changes.set(key(resolution),{entity_type:resolution.entity_type,entity_id:resolution.entity_id,payload:copy(resolution.payload),archived:false,expected_version:0});}
  }
  else{
   const input=operation.helperInput,proof=operation.verifiedSourceImport;
   assert(plain(input)&&input.confirmed===true&&text(input.issue_id)&&Array.isArray(input.source_refs),'The Review confirmation is missing.');
   const prepared=prepareMouseReviewPrefill(reviewData,input.issue_id,{reviewContext}),issue=prepared.issue;
   assert(issue.reason==='missing_mouse'&&issue.canCreate===true&&issue.current===true&&issue.currentSourceCount===1&&issue.sourceCount===1&&issue.dateOfBirth&&['Male','Female'].includes(issue.sex)&&equal(prepared.sourceRefs,input.source_refs),'The current source identity is missing, changed or ambiguous.');
   assert(plain(proof)&&proof.policy==='owner_current_animal_sheet_stock'&&proof.current===true&&proof.nonwithdrawn===true&&proof.no_lifecycle_warning===true&&HASH.test(proof.source_xlsx_sha256||'')&&HASH.test(proof.source_core_sha256||''),'The verified current source evidence is incomplete.');
   const source=issue.sources[0],sourceRow=scope.dependencies.get('locations:'+proof.source_location_id);
   assert(source.current===true&&source.ref.kind==='current_position'&&source.recordId===proof.source_location_id&&source.cell===proof.source_cell&&source.tag===proof.source_tag&&source.dateOfBirth===proof.source_dob&&source.sex===proof.source_sex&&sourceRow&&!sourceRow.archived&&sourceRow.version===proof.expected_source_version&&sourceRow.payload.source_current===true&&sourceRow.payload.source_file_id===proof.source_file_id&&String(sourceRow.payload.source_sheet_id)===String(proof.source_sheet_id)&&sourceRow.payload.active!==false&&!inactive(sourceRow.payload)&&sourceRow.payload.source_position_closed!==true,'The source proof does not match the exact active current card.');
   const sourceSid=issue.tag.match(/^.+[-\s]([MF])(\d+)$/)?.[2];
   assert(sourceSid&&![...mice.values()].some(row=>row.entity_id===sourceSid)&&!plan.operations.some(row=>row.kind==='create_softmouse_mouse'&&row.entity_id===sourceSid),'This source number has an existing or newly imported SoftMouse identity; cohort separation needs review before creating another mouse.');
   const base={mouse_sid:operation.entity_id,record_origin:'app_created',genotype:null,genotype_status:'not_recorded',...prepared.prefill};
   const attached=attachMouseReviewResolution(reviewData,base,input.issue_id,{confirmed:true,mouseSid:null,reviewContext});
   const expected=applyReviewedFreshComment({...attached.draft,state:'Stock',manager:null},operation,proof,sourceRow);
   const sourceObservation=checkedSourceObservation(operation,issue,sourceRow),reference=await compactReference(operation,operation.resolution,null,sourceObservation,operation.reconciliationEvidence);expected.animal_sheet_review_links=expected.animal_sheet_review_links.map(link=>link.issue_id===input.issue_id?{...link,association_ref:copy(reference)}:link);expected.reconciliation_evidence=[copy(reference)];
   assert(equal(expected,operation.payload)&&equal({...attached.resolutionRecord,association_basis:null,source_observation:copy(sourceObservation),association_sha256:reference.evidence_sha256},operation.resolution.payload),'The registration differs from the current Review helper.');
   for(const guard of attached.guards){const row=scope.dependencies.get(guard.type+':'+guard.id);assert(row&&equal(row.payload,guard.payload),'A Review source dependency is missing.');}
   const sourceManagerLabel=cageObservations(sourceRow.payload).managerName||sourceRow.payload.source_manager_raw||null;
   assert(operation.evidence?.sourceManagerLabel===sourceManagerLabel,'The current source manager label changed.');
   const mapping=sourceManagerMapping(sourceManagerLabel,directory),manager=mapping?.name??null;managerMap.push({id:operation.entity_id,manager,personId:mapping?.personId??null});
   payload={...expected,manager};if(!manager)warnings.push('Unassigned manager');
   // Only this exact guarded source registration can use the missing-manager
   // exception. Ordinary editor validation receives no import context.
   validated.push({operation,payload,context:{verifiedSourceImport:proof,issue,sourceRecord:sourceRow}});
   changes.set(key(operation.resolution),{entity_type:'husbandry_events',entity_id:operation.resolution.entity_id,payload:copy(operation.resolution.payload),archived:false,expected_version:0});
  }
  if(operation.kind!=='resolve_current_animal_sheet_mouse')validated.push({operation,payload});
  changes.set(key(operation),{entity_type:'mice',entity_id:operation.entity_id,payload,archived:false,expected_version:operation.expected_version});
 }
 await yieldProgress('preparing',scope.operations.size,scope.operations.size);
 // Validate the prospective graph, while keeping each new identifier absent
 // from its own validation baseline. No source or record is normalized for save.
 const prospective=new Map(data.tables.mice.map(mouse=>[mouse.mouse_sid,mouse]));for(const row of validated)prospective.set(row.operation.entity_id,row.payload);
 let validatedCount=0;for(const row of validated){await yieldProgress('validating',validatedCount++,validated.length);const {operation,payload,context}=row,base={...data,tables:{...data.tables,mice:[...prospective.values()].filter(mouse=>operation.expected_version!==0||mouse.mouse_sid!==operation.entity_id)}};if(operation.expected_version>0)base.tables.mice=base.tables.mice.map(mouse=>mouse.mouse_sid===operation.entity_id?copy(operation.before):mouse);
  const result=validate('mice',payload,base,operation.expected_version?operation.entity_id:null,context);
  assert(result&&Array.isArray(result.errors)&&result.errors.length===0,'A mouse failed scientific validation. '+(result?.errors||[]).join(' '));warnings.push(...(result.warnings||[]));
 }
 await yieldProgress('validating',validated.length,validated.length);
 for(const [id,row]of scope.dependencies)if(!changes.has(id))changes.set(id,{entity_type:row.entity_type,entity_id:row.entity_id,payload:copy(row.payload),archived:row.archived,expected_version:row.version});
 const body={p_colony_id:plan.colony_id,p_changes:[...changes.values()].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0)};
 assert(body.p_changes.length<=500&&bytes(body)<=1000000,'The reviewed command exceeds the atomic request limit.');
 const review=plan.operations.filter(operation=>operation.entity_type==='mice').map(operation=>{const payload=changes.get(key(operation)).payload;return {kind:operation.kind,mouseSid:operation.entity_id,tag:payload.physical_tag||'',dob:payload.date_of_birth||'',sex:payload.sex||'',state:payload.state||'',manager:payload.manager||null,...(operation.kind==='set_ear_mark'?{beforeEar:operation.before.ear_mark??null,afterEar:payload.ear_mark}:{}),sourceVerifiedStock:operation.kind==='resolve_current_animal_sheet_mouse',...associationPresentation(operation),...parentagePresentation(operation),...(operation.evidence?.fresh_comment_policy?{freshComment:copy({before:operation.evidence.fresh_comment_policy.before,after:operation.evidence.fresh_comment_policy.after})}:{})};});
 return {body,review,managerMap,warnings:[...new Set(warnings)],counts:{softmouse:plan.operations.filter(row=>row.kind==='create_softmouse_mouse').length,associations:plan.operations.filter(row=>row.association).length,lifecycleCorrections:plan.operations.filter(row=>row.kind==='record_owner_confirmed_mouse_end').length,review:plan.operations.filter(row=>row.kind==='resolve_current_animal_sheet_mouse').length,ears:plan.operations.filter(row=>row.kind==='set_ear_mark').length,unassignedManagers:managerMap.filter(row=>row.manager===null).length,guardedRecords:body.p_changes.length,freshComments:plan.operations.filter(row=>row.evidence?.fresh_comment_policy).length,parentageRefinements:plan.operations.filter(row=>row.kind==='narrow_inferred_parentage').length}};
 }finally{releaseMouseReviewContext(reviewContext);}
}

function confirmedReceipt(receipt,entry){
 assert(receipt?.source==='cloud1'&&receipt.operation_id===entry.operation.operation_id&&receipt.status==='applied'&&Array.isArray(receipt.result),'The source import was not confirmed as applied. Check the same operation.');
 const result=uniqueRows(receipt.result),changes=entry.operation.request.body.p_changes;
 assert(result.size===changes.length,'The saved receipt does not cover the exact reviewed command.');
 for(const change of changes){const row=result.get(key(change)),before=entry.scope.dependencies.get(key(change)),unchanged=before&&before.archived===change.archived&&equal(before.payload,change.payload),expectedVersion=change.expected_version===0?1:change.expected_version+(unchanged?0:1);assert(row&&row.colony_id===entry.plan.colony_id&&row.archived===change.archived&&equal(row.payload,change.payload)&&row.version===expectedVersion,'The saved result differs from the exact reviewed command.');}
}

function frozenCompilation(operation,plan,scope){
 assert(plain(operation)&&operation.operation_id===plan.operation_id&&equal(Object.keys(operation).sort(),['operation_id','request'])&&plain(operation.request)&&equal(Object.keys(operation.request).sort(),['body','method','route'])&&operation.request.route==='rpc/save_records'&&operation.request.method==='POST'&&plain(operation.request.body)&&equal(Object.keys(operation.request.body).sort(),['p_changes','p_colony_id'])&&operation.request.body.p_colony_id===plan.colony_id&&Array.isArray(operation.request.body.p_changes)&&bytes(operation)<=1000000,'The saved command is not the exact source import intent.');
 const rows=uniqueRows(operation.request.body.p_changes),expected=new Map(),review=[],managerMap=[];
 for(const row of scope.operations.values()){
  let payload=['set_ear_mark','narrow_inferred_parentage'].includes(row.kind)?{...copy(row.before),...copy(row.patch)}:copy(row.payload);
  if(row.association){const association=row.association,resolution=association.resolution;
   if(row.kind==='create_softmouse_mouse'){assert(!Object.hasOwn(payload,'animal_sheet_review_links')&&!Object.hasOwn(payload,'reconciliation_evidence'),'Original SoftMouse fields contain app metadata.');payload={...payload,animal_sheet_review_links:[{schema_version:1,issue_id:association.helperInput.issue_id,reviewed_mouse:copy(resolution.payload.reviewed_mouse),source_refs:copy(association.helperInput.source_refs),association_ref:copy(association.reconciliationEvidence)}],reconciliation_evidence:[copy(association.reconciliationEvidence)]};}
   expected.set(key(resolution),{...resolution,payload:copy(resolution.payload)});
  }
  if(row.kind==='resolve_current_animal_sheet_mouse'){
   const manager=rows.get(key(row))?.payload?.manager;
   assert(manager===null||text(manager),'The saved manager assignment is invalid.');payload={...payload,manager};managerMap.push({id:row.entity_id,manager});
   expected.set(key(row.resolution),{...row.resolution,payload:copy(row.resolution.payload)});
  }
  expected.set(key(row),{...row,payload});
  if(row.entity_type==='mice')review.push({kind:row.kind,mouseSid:row.entity_id,tag:payload.physical_tag||'',dob:payload.date_of_birth||'',sex:payload.sex||'',state:payload.state||'',manager:payload.manager||null,...(row.kind==='set_ear_mark'?{beforeEar:row.before.ear_mark??null,afterEar:payload.ear_mark}:{}),sourceVerifiedStock:row.kind==='resolve_current_animal_sheet_mouse',...associationPresentation(row),...parentagePresentation(row),...(row.evidence?.fresh_comment_policy?{freshComment:copy({before:row.evidence.fresh_comment_policy.before,after:row.evidence.fresh_comment_policy.after})}:{})});
 }
 for(const [id,row]of scope.dependencies)if(!expected.has(id))expected.set(id,{...row,expected_version:row.version});
 assert(rows.size===expected.size&&rows.size<=500,'The saved command has missing or unrelated records.');
 for(const [id,row]of expected){const actual=rows.get(id);assert(actual&&equal(Object.keys(actual).sort(),['archived','entity_id','entity_type','expected_version','payload'])&&actual.expected_version===row.expected_version&&actual.archived===row.archived&&equal(actual.payload,row.payload),'The saved command differs from the reviewed source plan.');}
 return {body:copy(operation.request.body),review,managerMap,warnings:['Recovered the original command. A retry retains its exact operation ID and field values.'],counts:{softmouse:plan.operations.filter(row=>row.kind==='create_softmouse_mouse').length,associations:plan.operations.filter(row=>row.association).length,lifecycleCorrections:plan.operations.filter(row=>row.kind==='record_owner_confirmed_mouse_end').length,review:plan.operations.filter(row=>row.kind==='resolve_current_animal_sheet_mouse').length,ears:plan.operations.filter(row=>row.kind==='set_ear_mark').length,unassignedManagers:managerMap.filter(row=>row.manager===null).length,guardedRecords:rows.size,freshComments:plan.operations.filter(row=>row.evidence?.fresh_comment_policy).length,parentageRefinements:plan.operations.filter(row=>row.kind==='narrow_inferred_parentage').length}};
}

/** The I/O capability remains private to the authenticated data store. */
export function createSourceReconciliation({binding=APPROVED_SOURCE_PLANS,io,validate}={}){
 let current=null,busy=false,revision=0;
 const bindings=()=>Array.isArray(binding)?binding:[binding];
 const ready=()=>assert(bindings().some(value=>HASH.test(value?.sha256||'')&&value.intent!=null),'The reviewed source plan is not enabled in this release.');
 const locked=async run=>{assert(!busy,'A source reconciliation is already in progress.');busy=true;try{return await run();}finally{busy=false;}};
 const check=entry=>{assert(current===entry,'This preview is no longer available.');io.checkContext(entry.context);};
 return {
  clear(){revision++;current=null;},
  preview:raw=>locked(async()=>{
   current=null;const token=++revision,checkPreview=()=>assert(token===revision,'This source preview was closed.');ready();assert(typeof raw==='string'&&bytes(raw)<=4000000,'Choose the bounded reviewed JSON plan.');
   const context=await io.verifyOwner();checkPreview();const digest=await sourcePlanDigest(raw);checkPreview();io.checkContext(context);const reviewedBinding=bindings().find(value=>value?.sha256===digest&&value.intent!=null);assert(reviewedBinding,'The file differs from the independently reviewed plan.');
   let plan;try{plan=JSON.parse(raw);}catch{fail('The source plan is not valid JSON.');}const scope=planShape(plan,reviewedBinding);
   assert(plan.colony_id===context.colonyId,'The source plan belongs to another colony.');
   const recovered=await io.recover?.(plan.operation_id,context);checkPreview();io.checkContext(context);
   assert(!recovered?.blocked||recovered?.receipt?.status==='applied','The saved command permits receipt checking only. Keep its original operation ID for review.');
   if(recovered?.operation||recovered?.receipt?.status==='applied'){
    let operation=recovered.operation;
    if(!operation){assert(Array.isArray(recovered.receipt.result),'The prior receipt does not contain its saved records.');const versions=new Map([...scope.dependencies].map(([id,row])=>[id,row.version]));for(const row of scope.operations.values()){versions.set(key(row),row.expected_version);if(resolutionOf(row))versions.set(key(resolutionOf(row)),0);}operation={operation_id:plan.operation_id,request:{route:'rpc/save_records',method:'POST',body:{p_colony_id:plan.colony_id,p_changes:recovered.receipt.result.map(row=>({entity_type:row.entity_type,entity_id:row.entity_id,payload:copy(row.payload),archived:row.archived,expected_version:versions.get(key(row))}))}}};}
    const compiled=frozenCompilation(operation,plan,scope),bodySha256=await sourcePlanDigest(JSON.stringify(operation));checkPreview();io.checkContext(context);const entry={context,plan,scope,compiled,operation,bodySha256,uncertain:true,recovered:true};
    if(recovered.receipt?.status==='applied'){confirmedReceipt(recovered.receipt,entry);io.invalidate();return {state:'applied',operationId:plan.operation_id,receipt:recovered.receipt};}
    current=entry;return {state:'uncertain',planId:plan.plan_id,operationId:plan.operation_id,planSha256:digest,bodySha256,counts:copy(compiled.counts),warnings:copy(compiled.warnings),review:copy(compiled.review)};
   }
   assert(!recovered?.receipt||recovered.receipt.status==='unknown','The original operation was rejected or conflicted. Obtain a new reviewed plan.');
   const snapshot=await io.readSnapshot(plan,context);checkPreview();io.checkContext(context);const directory=await io.readManagers(context);checkPreview();io.checkContext(context);
   const compiled=await compile(plan,scope,snapshot,directory,validate,{progress:io.progress,check(){checkPreview();io.checkContext(context);}}),operation={operation_id:plan.operation_id,request:{route:'rpc/save_records',method:'POST',body:compiled.body}};
   const finalDirectory=await io.readManagers(context);checkPreview();io.checkContext(context);assert(equal(managerAssignments(plan,finalDirectory),compiled.managerMap),'The manager directory changed during preparation. Preview the plan again.');
   const bodySha256=await sourcePlanDigest(JSON.stringify(operation));checkPreview();io.checkContext(context);
   current={context,plan,scope,compiled,operation,bodySha256,uncertain:false};
   assert(bytes(operation)<=1000000,'The reviewed command exceeds the cloud request limit.');
   return {planId:plan.plan_id,operationId:plan.operation_id,planSha256:digest,bodySha256,counts:copy(compiled.counts),warnings:copy(compiled.warnings),review:copy(compiled.review),state:'preview'};
  }),
  apply:()=>locked(async()=>{
   const entry=current;assert(entry&&!entry.uncertain,'Preview the reviewed plan or verify its uncertain operation first.');check(entry);
   const context=await io.verifyOwner();check(entry);assert(equal(context,entry.context),'Owner access changed. Preview the plan again.');
   const snapshot=await io.readSnapshot(entry.plan,context);check(entry);const directory=await io.readManagers(context);check(entry);
   const compiled=await compile(entry.plan,entry.scope,snapshot,directory,validate,{progress:io.progress,check:()=>check(entry)});check(entry);
   const finalDirectory=await io.readManagers(context);check(entry);assert(equal(managerAssignments(entry.plan,finalDirectory),compiled.managerMap),'The manager directory changed during validation. Preview again before applying.');
   assert(equal(compiled.body,entry.compiled.body)&&equal(compiled.managerMap,entry.compiled.managerMap),'Current source records or manager mapping changed. Preview again before applying.');
   try{const receipt=await io.submit(copy(entry.operation),entry.context);check(entry);if(['conflict','rejected'].includes(receipt?.status)){const error=new Error('The reviewed command was rejected or conflicted. Obtain a new reviewed plan.');error.sourceReconciliationBlocked=true;throw error;}confirmedReceipt(receipt,entry);current=null;io.invalidate();return {state:'applied',operationId:receipt.operation_id,receipt};}
   catch(error){if(error.sourceReconciliationBlocked)current=null;else{entry.uncertain=true;error.sourceReconciliationUncertain=true;}io.invalidate();throw error;}
  }),
  verify:()=>locked(async()=>{
   const entry=current;assert(entry&&entry.uncertain,'There is no uncertain import in this preview.');check(entry);await io.verifyOwner();check(entry);
   const receipt=await io.verify(entry.operation.operation_id,entry.context);check(entry);
   if(receipt?.status==='applied'){confirmedReceipt(receipt,entry);current=null;io.invalidate();return {state:'applied',operationId:receipt.operation_id,receipt};}
   return {state:receipt?.status||'uncertain',operationId:entry.operation.operation_id};
  }),
  retry:()=>locked(async()=>{
   const entry=current;assert(entry?.uncertain,'Only an uncertain original command can be retried.');check(entry);await io.verifyOwner();check(entry);
   const existing=await io.verify(entry.operation.operation_id,entry.context);check(entry);
   if(existing?.status==='applied'){confirmedReceipt(existing,entry);current=null;io.invalidate();return {state:'applied',operationId:existing.operation_id,receipt:existing};}
   assert(!existing||existing.status==='unknown','The original command was rejected or conflicted; it cannot be replayed.');
   const snapshot=await io.readSnapshot(entry.plan,entry.context);check(entry);const directory=await io.readManagers(entry.context);check(entry);const compiled=await compile(entry.plan,entry.scope,snapshot,directory,validate,{progress:io.progress,check:()=>check(entry)});
   const finalDirectory=await io.readManagers(entry.context);check(entry);assert(equal(managerAssignments(entry.plan,finalDirectory),compiled.managerMap),'The manager directory changed during validation. Keep the original command for review.');
   assert(equal(compiled.body,entry.compiled.body),'Source records or the original manager assignment changed. Keep the operation ID and obtain a fresh review.');
   if(!entry.recovered)assert(equal(compiled.managerMap,entry.compiled.managerMap),'The original manager mapping changed.');
   const receipt=await io.retry(entry.operation.operation_id,entry.context);check(entry);
   if(receipt?.status==='applied'){confirmedReceipt(receipt,entry);current=null;io.invalidate();return {state:'applied',operationId:receipt.operation_id,receipt};}
   return {state:receipt?.status||'uncertain',operationId:entry.operation.operation_id};
  })
 };
}
