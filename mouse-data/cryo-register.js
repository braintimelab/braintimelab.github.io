/* Compact, verified cryopreservation records. No workbook grids, formulas or
 * raw cell arrays are retained. Historical reports never establish live stock. */
const FORMAT='braintime-cryo-register',VERSION=1;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digestPattern=/^[a-f0-9]{64}$/;
const copy=structuredClone;
const sourceKeys=['title','sheet','cell','url','file_id','archive_sha256','snapshot_date','snapshot_date_basis'];
const observationKeys=['case_id','strain','background','modification_method','gene','zygosity','origin','batch_ids_raw','frozen_date','reported_remaining','reported_remaining_raw','quantity_unit','prepared_by','service_reference','material','storage_location','source','warnings','batch_ids'];
const groupKeys=[...observationKeys.filter(key=>key!=='source'),'id','status','reported_quantity_candidates','reported_quantity_source','source_snapshot_date','source_snapshot_date_basis','source_snapshots','sources'];
const planObservationKeys=['strain','tag_text','sex_text','source_order','source'];
const planKeys=[...planObservationKeys.filter(key=>key!=='source'),'id','status','source_snapshot_date','source_snapshot_date_basis','source_snapshots','sources'];
const coverageKeys=['source_sheet_count','distinct_content_versions','case_observation_count','unique_case_count','group_count','plan_observation_count','unique_plan_count','partial_record_count','full_index_available'];
const verified=new WeakSet();
const error=message=>{throw new Error('Cryopreservation register '+message);};
const exactKeys=(value,keys,extra=[])=>{
 if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)&&!extra.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))error('has an unsupported record shape.');
};
function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 error('contains unsupported values.');
}
async function hash(value){
 if(!globalThis.crypto?.subtle)error('verification requires HTTPS or localhost.');
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));
 return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
const strings=value=>Array.isArray(value)&&value.every(item=>typeof item==='string');
const nonnegative=value=>Number.isSafeInteger(value)&&value>=0;
const planOrder=value=>nonnegative(value)||typeof value==='string'&&/^\d+(?:\.0+)?$/.test(value)&&nonnegative(Number(value));
const quantity=value=>value===null||nonnegative(value);
const date=value=>value===null||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function source(value){
 exactKeys(value,sourceKeys);
 if(sourceKeys.filter(key=>key!=='snapshot_date').some(key=>typeof value[key]!=='string')||!date(value.snapshot_date))error('has invalid source metadata.');
 if(value.url){let url;try{url=new URL(value.url);}catch{error('has an invalid source URL.');}if(!['https:','http:'].includes(url.protocol))error('has an invalid source URL.');}
 return copy(value);
}
function observation(value,{stripRaw=false}={}){
 exactKeys(value,observationKeys,stripRaw?['raw_cells']:[]);
 const result=Object.fromEntries(observationKeys.map(key=>[key,copy(value[key])]));result.source=source(value.source);
 if(observationKeys.filter(key=>!['frozen_date','reported_remaining','reported_remaining_raw','material','storage_location','source','warnings','batch_ids'].includes(key)).some(key=>typeof value[key]!=='string')
  ||!value.case_id||!value.strain||!date(value.frozen_date)||!quantity(value.reported_remaining)||!strings(value.warnings)||!strings(value.batch_ids)||new Set(value.batch_ids).size!==value.batch_ids.length
  ||value.material!==null||value.storage_location!==null)error('has invalid historical case values.');
 // Keep an invalid or missing original count as recorded text/null, never zero.
 if(value.reported_remaining_raw!==null&&!['string','number','boolean'].includes(typeof value.reported_remaining_raw))error('has an invalid recorded count.');
 return result;
}
function group(value,options){
 exactKeys(value,groupKeys);const result=copy(value);
 result.source_snapshots=Array.isArray(value.source_snapshots)?value.source_snapshots.map(row=>observation(row,options)):error('has invalid case snapshots.');
 result.sources=Array.isArray(value.sources)?value.sources.map(source):error('has invalid case sources.');
 result.reported_quantity_source=value.reported_quantity_source===null?null:source(value.reported_quantity_source);
 const id='cryo-source:'+JSON.stringify([value.case_id,[...value.batch_ids].sort()]);
 if(value.id!==id||value.status!=='source_recorded'||!result.source_snapshots.length||!quantity(value.reported_remaining)||!Array.isArray(value.reported_quantity_candidates)||value.reported_quantity_candidates.some(item=>!nonnegative(item))
  ||!date(value.source_snapshot_date)||typeof value.source_snapshot_date_basis!=='string'||value.material!==null||value.storage_location!==null)error('has invalid case identity or stock assumptions.');
 // The grouped fields have the same typed shape as one historical observation.
 observation(Object.fromEntries(observationKeys.map(key=>[key,key==='source'?result.sources.at(-1):result[key]])));
 if(result.source_snapshots.some(row=>row.case_id!==value.case_id||JSON.stringify([...row.batch_ids].sort())!==JSON.stringify([...value.batch_ids].sort())))error('mixes different cases or batch lists.');
 if(result.sources.length!==result.source_snapshots.length)error('has inconsistent case source counts.');
 return result;
}
function planObservation(value){
 exactKeys(value,planObservationKeys);
 if(['strain','tag_text','sex_text'].some(key=>typeof value[key]!=='string')||!value.strain.trim()||!planOrder(value.source_order))error('has invalid transfer-plan values.');
 return {...copy(value),source:source(value.source)};
}
function plan(value){
 exactKeys(value,planKeys);const result=copy(value);
 result.source_snapshots=Array.isArray(value.source_snapshots)?value.source_snapshots.map(planObservation):error('has invalid plan snapshots.');
 result.sources=Array.isArray(value.sources)?value.sources.map(source):error('has invalid plan sources.');
 if(value.id!=='cryo-plan:'+JSON.stringify([value.strain,value.tag_text,value.sex_text])||value.status!=='planned_transfer'||!result.source_snapshots.length||!date(value.source_snapshot_date)||typeof value.source_snapshot_date_basis!=='string')error('has invalid plan identity.');
 planObservation(Object.fromEntries(planObservationKeys.map(key=>[key,key==='source'?result.sources.at(-1):result[key]])));
 if(result.source_snapshots.some(row=>row.strain!==value.strain||row.tag_text!==value.tag_text||row.sex_text!==value.sex_text)||result.sources.length!==result.source_snapshots.length)error('has inconsistent transfer plans.');
 return result;
}
function discovery(value,options={}){
 exactKeys(value,['groups','plans','partials','warnings','coverage']);exactKeys(value.coverage,coverageKeys);
 if(!Array.isArray(value.groups)||!Array.isArray(value.plans)||!Array.isArray(value.partials)||value.partials.length||!strings(value.warnings)||value.coverage.full_index_available!==true||coverageKeys.filter(key=>key!=='full_index_available').some(key=>!nonnegative(value.coverage[key])))error('requires a complete structured source register.');
 const result={groups:value.groups.map(row=>group(row,options)),plans:value.plans.map(plan),partials:[],warnings:copy(value.warnings),coverage:copy(value.coverage)};
 const c=result.coverage,ids=[...result.groups,...result.plans].map(row=>row.id);
 if(!ids.length||new Set(ids).size!==ids.length||c.group_count!==result.groups.length||c.unique_case_count!==new Set(result.groups.map(row=>row.case_id)).size||c.unique_plan_count!==result.plans.length||c.partial_record_count!==0
  ||c.case_observation_count!==result.groups.reduce((sum,row)=>sum+row.source_snapshots.length,0)||c.plan_observation_count!==result.plans.reduce((sum,row)=>sum+row.source_snapshots.length,0))error('has inconsistent coverage.');
 return result;
}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

/** Input is the existing literal parser result, not a new scientific inference. */
export async function createCryoRegister(found,{sourceArchiveSha256}={}){
 if(!digestPattern.test(sourceArchiveSha256||''))error('needs the verified original archive SHA-256.');
 const body={format:FORMAT,schema_version:VERSION,source_archive_sha256:sourceArchiveSha256,raw_cells_retained:false,discovery:discovery(found,{stripRaw:true})};
 const result={...body,integrity:{algorithm:'SHA-256',value:await hash(body)}};
 return verifyCryoRegister(result,{expectedSourceArchiveSha256:sourceArchiveSha256});
}

/** Verify an immutable archive record before it enters the synchronous UI. */
export async function verifyCryoRegister(value,{expectedSourceArchiveSha256}={}){
 // Capture once before hashing. A caller cannot swap mutable arrays during
 // the asynchronous digest and have different facts reach the verified UI.
 value=copy(value);
 exactKeys(value,['format','schema_version','source_archive_sha256','raw_cells_retained','discovery','integrity']);exactKeys(value.integrity,['algorithm','value']);
 if(value.format!==FORMAT||value.schema_version!==VERSION||value.raw_cells_retained!==false||!digestPattern.test(value.source_archive_sha256||'')||value.integrity.algorithm!=='SHA-256'||!digestPattern.test(value.integrity.value||''))error('has an unsupported format or version.');
 if(expectedSourceArchiveSha256!==undefined&&expectedSourceArchiveSha256!==value.source_archive_sha256)error('belongs to a different source archive.');
 const {integrity,...body}=value;
 if(await hash(body)!==integrity.value)error('checksum does not match its contents.');
 const result=freeze({...copy(body),discovery:discovery(value.discovery),integrity:copy(integrity)});verified.add(result);return result;
}

/** Plain JSON or a hand-written "verified" flag is never enough for rendering. */
export function readVerifiedCryoRegister(value){
 if(!object(value)||!verified.has(value))return null;
 return copy(value.discovery);
}
