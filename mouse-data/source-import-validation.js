import {validateRecord} from './model.js?v=174';
import {cageObservations} from './cage-observations.js?v=100';
import {buildMouseReviewIssues} from './mouse-review.js?v=100';

const MANAGER_ERROR='No manager is recorded. Assign a manager before saving this mouse.';
const PROOF_KEYS=['policy','source_file_id','source_sheet_id','source_location_id','source_cell','source_tag','source_dob','source_sex','source_xlsx_sha256','source_capture_at','source_modified_at','source_core_sha256','expected_source_version','expected_source_payload_md5','current','nonwithdrawn','no_lifecycle_warning'];
const HASH=/^[a-f0-9]{64}$/;
const MD5=/^[a-f0-9]{32}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(value)&&date(value.slice(0,10))&&Number.isFinite(Date.parse(value));
const sheetId=value=>(typeof value==='string'&&/^\d{1,10}$/.test(value)||Number.isSafeInteger(value))&&Number(value)>=0&&Number(value)<=2147483647;
const inactive=value=>value?.archived===true||Boolean(value?.app_archived_at)||value?.history_read_only===true||value?.source_historical===true;
const lifecycle=value=>/\b(?:dead|died|ended|sacrificed|removed|euthanized|transfer(?:red)?)\b/i.test(value);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':plain(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const same=(a,b)=>canonical(a)===canonical(b);
const requireProof=(condition,message)=>{if(!condition)throw new Error(message);};

function verifiedCurrentImport(type,draft,dataset,id,{verifiedSourceImport:proof,sourceRecord}){
 requireProof(type==='mice'&&id===null&&plain(draft)&&text(draft.mouse_sid)&&draft.state==='Stock'&&!inactive(draft),'Only a new current Stock mouse can use this source-import context.');
 requireProof(dataset?.history_projection?.read_only!==true&&(!dataset?.managed_records_deferred||dataset.managed_records_deferred.full_tables?.includes('mice')),'Complete current mouse identities are required.');
 requireProof(plain(proof)&&Object.keys(proof).length===PROOF_KEYS.length&&PROOF_KEYS.every(key=>Object.hasOwn(proof,key)),'The source proof shape is invalid.');
 requireProof(proof.policy==='owner_current_animal_sheet_stock'&&proof.current===true&&proof.nonwithdrawn===true&&proof.no_lifecycle_warning===true,'The current source-import policy is invalid.');
 requireProof(text(proof.source_file_id)&&sheetId(proof.source_sheet_id)&&text(proof.source_location_id)&&/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(proof.source_cell)&&text(proof.source_tag,240)&&date(proof.source_dob)&&['Male','Female'].includes(proof.source_sex),'The source identity metadata is invalid.');
 // These hashes/timestamps remain reviewed, plan-bound provenance. The core
 // compares the exact fresh payload/version to the pinned source dependency;
 // this synchronous validator does not claim to recompute PostgreSQL JSONB MD5
 // or a workbook/core SHA256 from an observation.
 requireProof(HASH.test(proof.source_xlsx_sha256)&&HASH.test(proof.source_core_sha256)&&MD5.test(proof.expected_source_payload_md5)&&timestamp(proof.source_capture_at)&&timestamp(proof.source_modified_at),'The source provenance metadata is invalid.');
 requireProof(Number.isSafeInteger(proof.expected_source_version)&&proof.expected_source_version>0&&plain(sourceRecord)&&sourceRecord.entity_type==='locations'&&sourceRecord.entity_id===proof.source_location_id&&sourceRecord.archived===false&&sourceRecord.version===proof.expected_source_version&&plain(sourceRecord.payload),'The source envelope or version differs from the proof.');
 if(Object.hasOwn(sourceRecord,'payload_md5'))requireProof(MD5.test(sourceRecord.payload_md5)&&sourceRecord.payload_md5===proof.expected_source_payload_md5,'The pinned source payload MD5 differs from the proof.');
 const position=sourceRecord.payload;
 requireProof(position.location_id===proof.source_location_id&&position.source_file_id===proof.source_file_id&&sheetId(position.source_sheet_id)&&String(position.source_sheet_id)===String(proof.source_sheet_id)&&position.source_current===true&&position.active!==false&&position.source_position_closed!==true&&!inactive(position),'The source card is unavailable, withdrawn or historical.');
 const locations=Array.isArray(dataset?.tables?.locations)?dataset.tables.locations:[];
 const matchingLocations=locations.filter(row=>row?.location_id===proof.source_location_id);
 requireProof(matchingLocations.length===1&&same(matchingLocations[0],position),'The source card differs from the validation dataset.');
 const candidates=buildMouseReviewIssues(dataset,{includeHistorical:false}).filter(issue=>issue.reason==='missing_mouse'&&issue.canCreate===true&&issue.current===true&&issue.currentSourceCount===1&&issue.sourceCount===1&&issue.sources.length===1&&issue.tag===proof.source_tag&&issue.dateOfBirth===proof.source_dob&&issue.sex===proof.source_sex);
 const matches=candidates.filter(issue=>{const source=issue.sources[0];return source.current===true&&source.ref.kind==='current_position'&&source.recordId===proof.source_location_id&&source.cell===proof.source_cell&&source.tag===proof.source_tag&&source.dateOfBirth===proof.source_dob&&source.sex===proof.source_sex;});
 requireProof(matches.length===1,'The fresh current source issue is missing, changed or ambiguous.');
 const observations=cageObservations(position).animals.filter(animal=>animal.sourceCell===proof.source_cell);
 requireProof(observations.length===1,'The source cell does not contain exactly one animal observation.');
 const animal=observations[0];
 requireProof(animal.tag===proof.source_tag&&animal.dateOfBirth===proof.source_dob&&animal.sex===proof.source_sex&&animal.requiresReview===false&&!lifecycle(animal.tag+' '+animal.note),'The source observation is incomplete or has a lifecycle warning.');
 const aliases=Array.isArray(draft.physical_tag_aliases)?draft.physical_tag_aliases:[];
 requireProof((draft.physical_tag===animal.tag||aliases.includes(animal.tag))&&draft.date_of_birth===animal.dateOfBirth&&draft.sex===animal.sex,'The draft identity differs from the exact source animal.');
 requireProof((draft.ear_mark??null)===(animal.earMark??null),'The draft ear marking differs from the source observation.');
 return true;
}

/** Only the exact manager error can be waived for a verified current source
 * import. Ordinary callers retain unmodified model validation. Source context
 * is evidence, never authentication or a replacement for transactional CAS. */
export function validateSourceReconciliationRecord(type,draft,dataset,id=null,context={}){
 const result=validateRecord(type,draft,dataset,id);
 if(!Object.hasOwn(context??{},'verifiedSourceImport'))return result;
 try{verifiedCurrentImport(type,draft,dataset,id,context);}
 catch(error){return {errors:[...new Set([...result.errors,'Current Animal Sheet source proof is invalid: '+error.message])],warnings:result.warnings};}
 if(draft.manager!==null||!Object.hasOwn(draft,'manager')||!result.errors.includes(MANAGER_ERROR))return result;
 return {errors:result.errors.filter(error=>error!==MANAGER_ERROR),warnings:[...new Set([...result.warnings,'Manager remains unassigned for this verified current Animal Sheet import.'])]};
}
