import {createMouseRegistrationValidationContext,validateRecord,validateMouseBatchEdits} from './model.js?v=188';
import {separateReusedMouseTag,MOUSE_BATCH_LIMIT} from './mouse-registration.js?v=188';
import {canonicalMouseSidKey} from './mouse-sid.js?v=188';

const clone=structuredClone;
const editable=new Set(['sex','physical_tag','genotype','ear_mark','comment']);
const sequenceFields=new Set(['style','prefix','start','step','padWidth']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const textLimits={physical_tag:200,genotype:2048,ear_mark:160,comment:2000};
const fail=message=>{throw new Error(message);};
function integer(value,label,{minimum=0,maximum=Number.MAX_SAFE_INTEGER}={}){
 if(typeof value!=='number'&&typeof value!=='string'||!/^\d+$/.test(String(value)))fail(`${label} must be a whole number.`);
 const number=Number(value);if(!Number.isSafeInteger(number)||number<minimum||number>maximum)fail(`${label} must be between ${minimum} and ${maximum}.`);return number;
}
function checkedText(value,field){
 if(value===null)return null;
 if(typeof value!=='string'||[...value].length>textLimits[field]||/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value))fail(`${field} must be text of at most ${textLimits[field]} characters, or blank.`);
 if(field==='physical_tag'&&/[\r\n\t]/.test(value))fail('A physical tag must be on one line.');
 return value.trim()===''?null:value;
}
function checkedSequence(input,count){
 if(input===null||input===undefined)return null;
 if(!plain(input)||Object.keys(input).some(key=>!sequenceFields.has(key)))fail('Choose only tag style, prefix, starting number, step and padding width.');
 const style=input.style??'plain';if(!['none','plain','sex'].includes(style))fail('Choose omitted, plain or sex-letter physical tags.');
 if(style==='none'){
  if(Object.keys(input).some(key=>key!=='style'))fail('Omitted physical tags do not use a prefix or numbering options.');
  return {style};
 }
 const prefix=input.prefix??'';
 if(typeof prefix!=='string'||[...prefix].length>160||/[\x00-\x1F\x7F]/.test(prefix)||prefix.trim()!==prefix)fail('Enter a tag prefix of at most 160 characters without surrounding whitespace.');
 const start=integer(input.start??1,'Starting physical tag number'),step=integer(input.step??1,'Physical tag step',{minimum:1,maximum:1000000}),padWidth=integer(input.padWidth??0,'Physical tag padding width',{maximum:16});
 if(!Number.isSafeInteger(start+(count-1)*step))fail('The physical tag sequence exceeds the whole-number range.');
 return {style,prefix,start,step,padWidth};
}
function checkField(field,value){
 if(field==='sex'){if(!['Male','Female','Unknown'].includes(value))fail('Sex must be Male, Female or Unknown.');return value;}
 return checkedText(value,field);
}

/** Physical numbering is independent of SID. Null keeps the caller's default;
 * none omits tags; plain uses prefix+number; sex adds M/F/U before the number.
 * Per-SID row exceptions apply last. No parent/litter key or genotype inference
 * is invented or rewritten. Existing mode requires complete existing records.
 */
export function applyRegistrationOverrides(dataset,drafts,{tagSequence=null,overrides={},existing=false}={}){
 if(!dataset||!plain(dataset)||!plain(dataset.tables)||!Array.isArray(dataset.tables.mice))fail('Load the mouse records before reviewing physical tags.');
 if(!Array.isArray(drafts)||drafts.length<1||drafts.length>MOUSE_BATCH_LIMIT)fail(`Review between 1 and ${MOUSE_BATCH_LIMIT} mice per batch.`);
 if(typeof existing!=='boolean'||!plain(overrides))fail('Use a per-SID row override object.');
 const source=dataset.tables.mice,originals=new Map(source.map(row=>[String(row.mouse_sid),row])),seen=new Set(),numeric=new Set();
 const result=drafts.map((draft,index)=>{
  if(!plain(draft)||typeof draft.mouse_sid!=='string'||!draft.mouse_sid.trim()||draft.mouse_sid!==draft.mouse_sid.trim())fail(`Mouse ${index+1}: keep the exact assigned SID.`);
  const sid=draft.mouse_sid;
  if(seen.has(sid))fail(`SID ${sid} appears more than once in this batch.`);seen.add(sid);
  if(existing){
   const before=originals.get(sid);if(!before)fail(`SID ${sid} is not an existing mouse. Reload before editing.`);
   for(const field of new Set([...Object.keys(before),...Object.keys(draft)]))if(!editable.has(field)&&!same(before[field],draft[field]))fail(`SID ${sid}: existing ${field} must remain unchanged.`);
  }else{
   if(!/^\d{5}$/.test(sid)||BigInt(sid)<1n)fail(`SID ${sid}: keep the reserved five-digit SID.`);
   const key=canonicalMouseSidKey(sid);if(numeric.has(key))fail(`SID ${sid} appears more than once in this batch.`);numeric.add(key);
  }
  return clone(draft);
 });
 if(!existing){
  const occupied=new Set(source.flatMap(mouse=>[mouse.mouse_sid,mouse.canonical_sid,...(Array.isArray(mouse.legacy_sids)?mouse.legacy_sids:[])]).filter(value=>value!=null).map(canonicalMouseSidKey));
  for(const row of result)if(occupied.has(canonicalMouseSidKey(row.mouse_sid)))fail(`SID ${row.mouse_sid} already exists. Open that mouse instead.`);
 }
 for(const[sid,fields]of Object.entries(overrides)){
  if(!seen.has(sid))fail(`SID ${sid} is not in this preview.`);
  if(!plain(fields)||Object.keys(fields).some(field=>!editable.has(field)))fail(`SID ${sid}: edit only sex, physical tag, genotype, ear mark or comment.`);
  for(const[field,value]of Object.entries(fields))checkField(field,value);
 }
 const sequence=checkedSequence(tagSequence,result.length);
 const metadataWarnings=[];
 for(const[index,row]of result.entries()){
  const fields=Object.hasOwn(overrides,row.mouse_sid)?overrides[row.mouse_sid]:{};
  if(Object.hasOwn(fields,'sex'))row.sex=fields.sex;
  if(!['Male','Female','Unknown'].includes(row.sex))fail(`SID ${row.mouse_sid}: Sex must be Male, Female or Unknown.`);
  if(sequence?.style==='none')row.physical_tag=null;
  else if(sequence){
   const number=String(sequence.start+index*sequence.step).padStart(sequence.padWidth,'0'),letter=sequence.style==='sex'?({Male:'M',Female:'F',Unknown:'U'}[row.sex]):'';
   row.physical_tag=checkedText(sequence.prefix+letter+number,'physical_tag');
  }
  for(const[field,value]of Object.entries(fields))row[field]=checkField(field,value);
  // These two fields are app-derived metadata, not immutable source evidence.
  // A manual call must not retain an earlier tag-derived genotype assertion.
  const before=existing?originals.get(row.mouse_sid):drafts[index],manualGenotypeChanged=!same(before.genotype,row.genotype);
  const oldTagInference=before.genotype_status==='inferred_from_physical_tag'||before.genotype_inference?.basis==='physical_tag';
  if(manualGenotypeChanged){row.genotype_status=row.genotype==null||String(row.genotype).trim()===''?'not_recorded':'user_entered';delete row.genotype_inference;}
  else if(!same(before.physical_tag,row.physical_tag)&&oldTagInference){
   row.genotype=null;row.genotype_status='not_recorded';delete row.genotype_inference;
   metadataWarnings.push(`SID ${row.mouse_sid}: the old tag-based genotype was cleared after the physical tag changed. Enter a genotype only from reviewed evidence.`);
  }
 }
 // Check the final tag set, including later rows, before saving any proposal.
 const finalRows=existing?source.map(row=>result.find(next=>next.mouse_sid===String(row.mouse_sid))??row):[...source,...result];
 const finalDataset={...dataset,tables:{...dataset.tables,mice:finalRows}},dependencies=new Map(),warnings=[...metadataWarnings];
 for(const[index,row]of result.entries()){
  if(existing)dependencies.set(row.mouse_sid,{type:'mice',id:row.mouse_sid});
  const old=existing?originals.get(row.mouse_sid):null;
  if(!existing||!same(old.physical_tag,row.physical_tag)){
   const identity=separateReusedMouseTag(finalDataset,row);
   for(const dependency of identity.readDependencies)dependencies.set(dependency.id,dependency);
   if(identity.error)fail(`Mouse ${index+1} (SID ${row.mouse_sid}): ${identity.error}`);
   if(!same(identity.draft.physical_tag,row.physical_tag))fail(`Mouse ${index+1} (SID ${row.mouse_sid}): this physical tag is already in use; choose an explicit distinct tag.`);
  }
 }
 if(existing){
  const checked=validateMouseBatchEdits(result,dataset);
  if(checked.errors.length)fail(checked.errors.join(' '));warnings.push(...checked.warnings);
 }else{
  const context=createMouseRegistrationValidationContext(dataset),staged=context.dataset;
  for(const row of result){const checked=validateRecord('mice',row,staged,null,context);if(checked.errors.length)fail(`SID ${row.mouse_sid}: ${checked.errors.join(' ')}`);warnings.push(...checked.warnings);staged.tables.mice.push(clone(row));}
 }
 return {drafts:result,readDependencies:[...dependencies.values()],warnings:[...new Set(warnings)]};
}
