// Evidence validation for an exact, independently reviewed private Owner plan.
// No animal records or private source observations are embedded in this module.
export const HISTORICAL_PARENTAGE_INTENT='owner-authorized-historical-parentage-recovery-2026-10-27';
export const HISTORICAL_PARENTAGE_POLICY='owner_authorized_historical_parentage_recovery';
export const HISTORICAL_PARENTAGE_RULE='full_physical_tag_zero_padding_with_DOB_sex_unique_current_identity';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canon=x=>Array.isArray(x)?'['+x.map(canon).join(',')+']':object(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}':JSON.stringify(x);
const same=(a,b)=>canon(a)===canon(b),copy=x=>structuredClone(x);
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const exactKeys=(x,keys)=>object(x)&&same(Object.keys(x).sort(),[...keys].sort());
const text=(x,n=200)=>typeof x==='string'&&x.length>0&&x.length<=n&&x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const ids=x=>Array.isArray(x)&&x.every(v=>text(v))&&new Set(x).size===x.length;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const stamp=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(x)&&Number.isFinite(Date.parse(x));
const roles=['sire','dam'];
const parentIds=(mouse,role)=>{const field=role+'_sids';if(!Object.hasOwn(mouse,field))return [];assert(ids(mouse[field]),'A parent role has malformed saved IDs.');return mouse[field];};
const originalRoles=mouse=>Object.fromEntries(roles.map(role=>[role,{present:Object.hasOwn(mouse,role+'_sids'),...(Object.hasOwn(mouse,role+'_sids')?{value:copy(mouse[role+'_sids'])}:{})}]));

/** Leading zeros only. The numeric physical-tag component is never an SID. */
export function historicalPhysicalTagTuple(tag){
 if(!text(tag))return null;
 const m=tag.match(/^(.+)-([MF])(\d+)$/);if(!m)return null;
 return [m[1],m[2],m[3].replace(/^0+(?=\d)/,'')];
}
function sameTag(a,b){const left=historicalPhysicalTagTuple(a),right=historicalPhysicalTagTuple(b);return Boolean(left&&right&&same(left,right));}
function checkedCell(cell){
 assert(exactKeys(cell,['requested_cell','source_cell','value','basis',...(cell?.merged_range!==undefined?['merged_range']:[]),...(cell?.raw_value!==undefined?['raw_value']:[])]),'The source cell evidence has unsupported fields.');
 const a1=x=>typeof x==='string'&&/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(x);
 assert(a1(cell.requested_cell)&&a1(cell.source_cell)&&typeof cell.value==='string'&&cell.value.length<=2000&&['literal_cell','actual_merged_range'].includes(cell.basis),'The source cell evidence is invalid.');
 if(cell.basis==='literal_cell')assert(cell.requested_cell===cell.source_cell&&cell.merged_range===undefined,'An unmerged source cell cannot carry values from another row.');
 else {
  assert(typeof cell.merged_range==='string'&&/^[A-Z]{1,3}[1-9]\d{0,5}:[A-Z]{1,3}[1-9]\d{0,5}$/.test(cell.merged_range)&&cell.merged_range.split(':')[0]===cell.source_cell,'The source merge evidence is incomplete.');
  const coord=s=>{const m=s.match(/^([A-Z]+)(\d+)$/);return [Array.from(m[1]).reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),Number(m[2])];},[start,end]=cell.merged_range.split(':').map(coord),at=coord(cell.requested_cell);
  assert(end[0]>=start[0]&&end[1]>=start[1]&&at[0]>=start[0]&&at[0]<=end[0]&&at[1]>=start[1]&&at[1]<=end[1],'The requested source cell is outside the actual merged range.');
 }
 if(cell.raw_value!==undefined)assert(typeof cell.raw_value==='string'&&cell.raw_value.length<=2000,'The original source cell value is invalid.');
}
function checkedIdentity(identity){
 assert(exactKeys(identity,['tag','date_of_birth','sex','name_cell','dob_cell']),'The source identity has unsupported fields.');
 assert(historicalPhysicalTagTuple(identity.tag)&&day(identity.date_of_birth)&&['Male','Female'].includes(identity.sex),'A source identity lacks a full tag, DOB or sex.');
 assert(historicalPhysicalTagTuple(identity.tag)[1]===(identity.sex==='Male'?'M':'F'),'The source sex conflicts with its full tag.');
 checkedCell(identity.name_cell);checkedCell(identity.dob_cell);
 assert(identity.name_cell.value===identity.tag&&identity.dob_cell.value===identity.date_of_birth,'The source identity differs from its literal source cells.');
}
function sourceURL(value,id){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='docs.google.com'&&u.pathname==='/spreadsheets/d/'+id+'/edit'&&!u.username&&!u.password;}catch{return false;}}
function checkedEvidence(evidence,role,before,parent){
 assert(exactKeys(evidence,['schema_version','rule_id','role','source','child','parent','parent_field','parent_literal']),'The historical parentage evidence has unsupported fields.');
 assert(evidence.schema_version===1&&evidence.rule_id===HISTORICAL_PARENTAGE_RULE&&evidence.role===role,'The historical parentage rule or role changed.');
 const s=evidence.source;
 assert(exactKeys(s,['file_id','sha256','sheet','sheet_id','url'])&&text(s.file_id)&&hash(s.sha256)&&text(s.sheet)&&text(s.sheet_id)&&sourceURL(s.url,s.file_id),'The historical source reference is incomplete.');
 checkedIdentity(evidence.child);checkedIdentity(evidence.parent);checkedCell(evidence.parent_field);
 assert(text(evidence.parent_literal)&&evidence.parent_field.value.split(/\r?\n/).some(line=>line.trim()===evidence.parent_literal)&&sameTag(evidence.parent_literal,evidence.parent.tag),'The named parent is not in the recorded Parent field.');
 assert(evidence.child.date_of_birth===before.date_of_birth&&evidence.child.sex===before.sex&&evidence.parent.date_of_birth===parent.date_of_birth&&evidence.parent.sex===parent.sex,'The guarded identities disagree with the source DOB or sex.');
 assert(parent.sex===(role==='sire'?'Male':'Female')&&day(parent.date_of_birth)&&parent.date_of_birth<before.date_of_birth,'A recovered parent lacks valid role or birth chronology.');
 if(parent.state==='Ended'&&['Harvested','Sacrificed','Found Dead'].includes(parent.end_type))assert(day(parent.end_date)&&parent.end_date>=before.date_of_birth,'A recovered parent has a terminal chronology conflict requiring review.');
}

export function historicalParentageBasis(before,selectedRoles,evidence,recordedAt){
 return {kind:'source_reconciliation_inference',schema_version:1,policy:HISTORICAL_PARENTAGE_POLICY,confidence:'moderate',recorded_at:recordedAt,decision_rule:HISTORICAL_PARENTAGE_RULE,inferred_roles:copy(selectedRoles),original_parentage:originalRoles(before),prior_lineage_basis:{present:false},evidence_refs:copy(evidence),biological_confirmation:false};
}

export function checkHistoricalParentageOperation(operation,dependencies){
 assert(exactKeys(operation,['kind','entity_type','entity_id','expected_version','archived','before','parent_roles','patch','recovery_evidence']),'A historical parent recovery has unsupported fields.');
 assert(operation.kind==='fill_missing_parentage'&&operation.entity_type==='mice'&&operation.archived===false&&text(operation.entity_id)&&Number.isSafeInteger(operation.expected_version)&&operation.expected_version>0,'The historical recovery target is invalid.');
 const prior=dependencies.get('mice:'+operation.entity_id),before=operation.before;
 assert(prior&&!prior.archived&&prior.version===operation.expected_version&&same(prior.payload,before)&&before?.mouse_sid===operation.entity_id&&!before.app_archived_at,'The historical recovery lacks its complete original mouse and exact version.');
 assert(!Object.hasOwn(before,'lineage_basis'),'An existing lineage basis needs a separate reviewed preservation policy.');
 const selected=operation.parent_roles;
 assert(ids(selected)&&selected.length>0&&selected.length<=2&&selected.every(role=>roles.includes(role)),'Choose the exact missing parent roles.');
 assert(exactKeys(operation.patch,['app_modified_at','lineage_basis',...selected.map(role=>role+'_sids')])&&stamp(operation.patch.app_modified_at),'A historical recovery may change only selected missing parent IDs and their evidence.');
 assert(Array.isArray(operation.recovery_evidence)&&operation.recovery_evidence.length===selected.length,'Each recovered role needs one complete source identity and Parent field.');
 for(const role of selected){
  assert(parentIds(before,role).length===0,'A saved nonempty parent role cannot be replaced by historical recovery.');
  const after=operation.patch[role+'_sids'];assert(ids(after)&&after.length===1&&after[0]!==operation.entity_id,'A recovered role must have one independently identified parent.');
  const parent=dependencies.get('mice:'+after[0]);assert(parent&&!parent.archived&&!parent.payload?.app_archived_at&&parent.payload?.mouse_sid===after[0],'The recovered parent identity is not guarded.');
  const refs=operation.recovery_evidence.filter(ref=>ref.role===role);assert(refs.length===1,'Recovered role evidence is repeated or missing.');checkedEvidence(refs[0],role,before,parent.payload);
 }
 assert(same(operation.patch.lineage_basis,historicalParentageBasis(before,selected,operation.recovery_evidence,operation.patch.app_modified_at)),'The recovered parents must retain their exact original roles and inferred evidence.');
}

export function checkHistoricalParentageCurrent(operation,scope,currentMice){
 const pending=[operation.entity_id,...roles.flatMap(role=>parentIds(operation.before,role)),...operation.parent_roles.flatMap(role=>operation.patch[role+'_sids'])],seen=new Set();
 while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);const row=currentMice.get('mice:'+id),dep=scope.dependencies.get('mice:'+id);assert(row&&dep&&!row.archived&&!dep.archived&&row.version===dep.version&&same(row.payload,dep.payload),'A parentage ancestor or proposed parent is missing from the exact current dependency scope.');pending.push(...roles.flatMap(role=>parentIds(row.payload,role)));}
 const matches=identity=>[...currentMice.values()].filter(row=>!row.archived&&!row.payload?.app_archived_at&&row.payload.date_of_birth===identity.date_of_birth&&row.payload.sex===identity.sex&&[row.payload.physical_tag,...(Array.isArray(row.payload.physical_tag_aliases)?row.payload.physical_tag_aliases:[])].some(tag=>sameTag(tag,identity.tag))).map(row=>row.entity_id);
 for(const evidence of operation.recovery_evidence){assert(same(matches(evidence.child),[operation.entity_id])&&same(matches(evidence.parent),operation.patch[evidence.role+'_sids']),'A complete historical tag, DOB and sex now matches another mouse. Review the current identities.');}
}

export function historicalParentageBatchPayload(plan,eventId,issues=[]){
 const operations=plan.operations.filter(op=>op.kind==='fill_missing_parentage');
 return {event_id:eventId,event_type:'source_reconciliation_batch',schema_version:1,recovery_schema_version:1,operation_id:plan.operation_id,plan_id:plan.plan_id,recorded_at:operations[0]?.patch.app_modified_at,parentage_policy:HISTORICAL_PARENTAGE_POLICY,changed_parentage:operations.flatMap(op=>op.parent_roles.map(role=>({mouse_sid:op.entity_id,role,before_present:Object.hasOwn(op.before,role+'_sids'),before_sids:copy(parentIds(op.before,role)),after_sids:copy(op.patch[role+'_sids']),confidence:'moderate',decision_rule:HISTORICAL_PARENTAGE_RULE}))),original_parentage_preserved:true,biological_confirmation:false,parentage_issues:copy(issues)};
}
export function checkHistoricalParentagePlan(plan,operations){
 const fills=[...operations.values()].filter(op=>op.kind==='fill_missing_parentage');if(!fills.length){assert(plan.intent!==HISTORICAL_PARENTAGE_INTENT,'A historical recovery plan needs a supported missing-role recovery.');return;}
 assert(plan.intent===HISTORICAL_PARENTAGE_INTENT&&operations.size===fills.length+1,'Historical recovery cannot be mixed with unrelated edits.');
 const audit=[...operations.values()].find(op=>op.kind==='record_source_reconciliation_batch'),issues=audit?.payload?.parentage_issues;
 assert(audit&&Array.isArray(issues)&&issues.length<=250&&JSON.stringify(issues).length<=500000,'The historical review list is missing or too large.');
 const issueIds=new Set();for(const issue of issues){assert(object(issue)&&issue.schema_version===1&&issue.status==='needs_review'&&text(issue.issue_id)&&!issueIds.has(issue.issue_id)&&['sire','dam','both'].includes(issue.role)&&issue.confidence==='uncertain'&&ids(issue.mouse_sids)&&issue.mouse_sids.length<=100&&ids(issue.candidate_parent_sids)&&issue.candidate_parent_sids.length<=100&&Array.isArray(issue.candidate_parent_tags)&&issue.candidate_parent_tags.length<=100&&issue.candidate_parent_tags.every(t=>text(t))&&Array.isArray(issue.reason_codes)&&issue.reason_codes.length<=25&&issue.reason_codes.every(t=>text(t))&&text(issue.summary,2000)&&Array.isArray(issue.evidence_refs)&&issue.evidence_refs.length<=10,'A historical review case is invalid or repeated.');issueIds.add(issue.issue_id);}
 assert(fills.every(op=>op.patch.app_modified_at===fills[0].patch.app_modified_at),'The historical batch has inconsistent evidence dates.');
 assert(same(audit.payload,historicalParentageBatchPayload(plan,audit.entity_id,issues)),'The historical batch audit differs from its exact recovered roles and held cases.');
 const pins=Array.isArray(plan.sourcePins)?plan.sourcePins:[];
 for(const op of fills)for(const ref of op.recovery_evidence)assert(pins.some(pin=>pin.sha256===ref.source.sha256),'A recovered role lacks its reviewed source-file fingerprint.');
}
export function historicalParentagePresentation(operation){
 return operation.kind==='fill_missing_parentage'?{parentageRecovery:{confidence:'moderate',roles:operation.parent_roles.map(role=>({role,before:copy(parentIds(operation.before,role)),after:copy(operation.patch[role+'_sids']),evidence:copy(operation.recovery_evidence.find(e=>e.role===role))}))}}:{};
}
