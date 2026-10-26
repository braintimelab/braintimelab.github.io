// Browser-only working copies. No account credentials or full source records
// belong here; restoring a draft always requires a fresh review and save.
export const REGISTRATION_MEMORY_VERSION=1;
const ROOT='mouse-colony.registration-memory.v1';
const MAX_BYTES=1024*1024,MAX_ITEMS=20,MAX_AGE=30*24*60*60*1000;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const clone=structuredClone;
const fail=message=>{throw new Error(message);};
const allowedFields=new Set(['manager','cage_sid','protocol','mouseline','strain','generation','status','physical_tag','ear_mark','genotype','comment','sex','state','date_of_birth','wean_date','sire_sids','dam_sids','litter_sid','litter_tag','mating_sid','size_reported','alternate_id','end_date','end_reason']);
const controlIds=new Set(['mouse-entry-mode','mouse-sheet-rows','batch_males','batch_females','batch_unknown','registration-tag-style','registration-tag-start','registration-tag-step','registration-tag-width','cage-change-date','litter-mother-choice','sibling-apply-genotype','sibling-apply-ear','field-sibling-sex']);
const rowFields=new Set(['sex','physical_tag','genotype','ear_mark','comment']);
const presetFields=new Set(['manager','cage_sid','protocol','mouseline','strain','generation','status','physical_tag']);
const kinds=new Set(['mice','litter-new','litter-add','siblings']);
export const registrationMemoryControlAllowed=key=>controlIds.has(key)||key.startsWith('field-')&&allowedFields.has(key.slice(6));
function text(value,label,max=2048){if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail(`Invalid ${label}.`);return value;}
function id(value,label,max=200){text(value,label,max);if(['__proto__','constructor','prototype'].includes(value))fail(`Invalid ${label}.`);return value;}
function boundedJSON(value){const encoded=JSON.stringify(value);if(new TextEncoder().encode(encoded).byteLength>MAX_BYTES)fail('The draft is too large to keep in this browser.');return encoded;}

/** Scope survives session expiry, but can only be opened by the same verified
 * account and colony. Local/demo workspaces are separate from shared records. */
export function registrationMemoryScope(status={},dataset={}){
 if(status.mode==='cloud'){
  if(!status.signedIn||!status.userId||!status.colonyId||!status.url)return null;
  return JSON.stringify(['cloud',id(status.url,'project URL',500),id(status.colonyId,'colony'),id(status.userId,'account')]);
 }
 if(status.mode!=='local')return null;
 return JSON.stringify(['local',dataset.synthetic===true?'synthetic-demo':'private-browser']);
}
export function registrationDraftKey(draft){
 if(!plain(draft)||!kinds.has(draft.kind))fail('Choose a registration draft type.');
 return draft.kind+':'+id(draft.recordId??'','draft record');
}
function checkedSequence(value){
 if(value==null)return null;
 if(!plain(value)||Object.keys(value).some(key=>!['style','prefix','start','step','padWidth'].includes(key)))fail('Invalid saved tag sequence.');
 const style=value.style??'auto';if(!['auto','sid','none','plain','sex'].includes(style))fail('Invalid saved tag numbering.');
 const result={style};if(value.prefix!=null)result.prefix=text(value.prefix,'tag prefix',160);
 for(const [field,min,max]of [['start',0,Number.MAX_SAFE_INTEGER],['step',1,1000000],['padWidth',0,16]])if(value[field]!=null){const number=Number(value[field]);if(!/^\d+$/.test(String(value[field]))||!Number.isSafeInteger(number)||number<min||number>max)fail('Invalid saved tag numbering.');result[field]=number;}
 return result;
}
export function checkedRegistrationDraft(input){
 registrationDraftKey(input);const result={kind:input.kind,recordId:id(input.recordId??'','draft record'),fields:{},rowOverrides:{},selected:[],reservations:[],registration:null,requestId:null,tagInference:null};
 if(!plain(input.fields??{})||!plain(input.rowOverrides??{}))fail('Invalid saved registration fields.');
 for(const [key,value]of Object.entries(input.fields??{})){
  const field=key.startsWith('field-')?key.slice(6):null;
  if(!controlIds.has(key)&&!allowedFields.has(field))fail('The draft contains an unsupported form field.');
  if(typeof value!=='boolean'&&typeof value!=='string')fail('Invalid saved form value.');
  result.fields[key]=typeof value==='string'?text(value,'form value',key==='mouse-sheet-rows'?256000:4096):value;
 }
 const entries=Object.entries(input.rowOverrides??{});if(entries.length>100)fail('Recover at most 100 mice per draft.');
 for(const [sid,values]of entries){id(sid,'mouse key');if(!plain(values)||Object.keys(values).some(key=>!rowFields.has(key)))fail('Invalid saved mouse exception.');result.rowOverrides[sid]={};for(const [key,value]of Object.entries(values)){if(value!==null)text(value,'mouse exception',key==='comment'?2000:key==='genotype'?2048:200);result.rowOverrides[sid][key]=value;}}
 if(!Array.isArray(input.selected??[])||(input.selected??[]).length>100)fail('Invalid saved row selection.');result.selected=[...new Set((input.selected??[]).map(value=>id(value,'selected mouse')))];
 if(input.requestId!=null){if(!UUID.test(input.requestId))fail('Invalid saved registration request.');result.requestId=input.requestId;}
 if(!Array.isArray(input.reservations??[])||(input.reservations??[]).length>100)fail('Invalid saved SID reservations.');
 const counts=new Set();for(const reservation of input.reservations??[]){if(!plain(reservation)||!Number.isInteger(reservation.count)||reservation.count<1||reservation.count>100||counts.has(reservation.count)||!UUID.test(reservation.requestId))fail('Invalid saved SID reservation.');counts.add(reservation.count);let sids=null;if(reservation.sids!==null){if(!Array.isArray(reservation.sids)||reservation.sids.length!==reservation.count||new Set(reservation.sids).size!==reservation.count||reservation.sids.some(sid=>typeof sid!=='string'||!/^\d{5}$/.test(sid)||Number(sid)<1))fail('Invalid saved reserved SIDs.');sids=[...reservation.sids];}result.reservations.push({count:reservation.count,requestId:reservation.requestId,sids});}
 if(input.registration!=null){const value=input.registration;if(!plain(value)||Object.keys(value).some(key=>!['cageSid','positionId','newborn','proposedNewCageSid'].includes(key))||typeof value.newborn!=='boolean')fail('Invalid saved cage registration.');result.registration={cageSid:value.cageSid==null?null:id(value.cageSid,'cage'),positionId:value.positionId==null?null:id(value.positionId,'position'),newborn:value.newborn,proposedNewCageSid:value.proposedNewCageSid==null?null:id(value.proposedNewCageSid,'proposed cage')};}
 if(input.tagInference!=null){const value=input.tagInference;if(!plain(value)||Object.keys(value).length!==2||typeof value.tag!=='string'||typeof value.genotype!=='string')fail('Invalid saved tag suggestion.');result.tagInference={tag:text(value.tag,'tag suggestion',200),genotype:text(value.genotype,'genotype suggestion',2048)};if(result.fields['field-physical_tag']!==value.tag||result.fields['field-genotype']!==value.genotype)fail('The saved tag suggestion no longer matches the form.');}
 boundedJSON(result);return result;
}
export function checkedRegistrationPreset(input){
 if(!plain(input)||!plain(input.fields??{})||Object.keys(input.fields??{}).some(key=>!presetFields.has(key)))fail('A preset can contain shared registration defaults only.');
 const name=text(input.name,'preset name',80).trim();if(!name)fail('Enter a name for this preset.');
 const fields={};for(const [key,value]of Object.entries(input.fields??{}))fields[key]=text(value,'preset default',key==='physical_tag'?160:500);
 return {name,fields,tagSequence:checkedSequence(input.tagSequence)};
}

export function createRegistrationMemory({storage,scope,now=()=>Date.now()}={}){
 if(typeof scope!=='string'||!scope||scope.length>1500)fail('Verify the account and colony before opening saved registration work.');
 if(storage===undefined)try{storage=globalThis.localStorage;}catch{storage=null;}
 const key=ROOT+':'+encodeURIComponent(scope);
 function read(){
  if(!storage?.getItem)return {drafts:[],presets:[]};
  try{const raw=storage.getItem(key);if(raw==null)return {drafts:[],presets:[]};if(new TextEncoder().encode(raw).byteLength>MAX_BYTES)return {drafts:[],presets:[]};const value=JSON.parse(raw);if(value?.version!==1||value.scope!==scope||!Array.isArray(value.drafts)||!Array.isArray(value.presets))return {drafts:[],presets:[]};const drafts=value.drafts.slice(0,MAX_ITEMS).flatMap(row=>{try{if(!Number.isFinite(row.updatedAt)||row.updatedAt>now()+60000||now()-row.updatedAt>MAX_AGE)return [];return [{...checkedRegistrationDraft(row),updatedAt:row.updatedAt}];}catch{return [];}}),presets=value.presets.slice(0,MAX_ITEMS).flatMap(row=>{try{return [checkedRegistrationPreset(row)];}catch{return [];}});return {drafts,presets};}catch{return {drafts:[],presets:[]};}
 }
 function write(value){if(!storage?.setItem)fail('Browser draft storage is unavailable. Keep this editor open until it saves.');try{storage.setItem(key,boundedJSON({version:1,scope,...value}));}catch(error){if(error.message?.includes('too large'))throw error;fail('Browser draft storage is unavailable. Keep this editor open until it saves.');}}
 return Object.freeze({
  listDrafts:()=>read().drafts.map(value=>clone(value)),listPresets:()=>read().presets.map(value=>clone(value)),
  getDraft:descriptor=>{const wanted=registrationDraftKey(descriptor);return clone(read().drafts.find(row=>registrationDraftKey(row)===wanted)??null);},
  saveDraft:input=>{const draft={...checkedRegistrationDraft(input),updatedAt:now()},value=read(),wanted=registrationDraftKey(draft);value.drafts=[draft,...value.drafts.filter(row=>registrationDraftKey(row)!==wanted)].slice(0,MAX_ITEMS);write(value);return clone(draft);},
  removeDraft:descriptor=>{const wanted=registrationDraftKey(descriptor),value=read();value.drafts=value.drafts.filter(row=>registrationDraftKey(row)!==wanted);write(value);},
  savePreset:input=>{const preset=checkedRegistrationPreset(input),value=read();value.presets=[preset,...value.presets.filter(row=>row.name!==preset.name)].slice(0,MAX_ITEMS);write(value);return clone(preset);},
  removePreset:name=>{text(name,'preset name',80);const value=read();value.presets=value.presets.filter(row=>row.name!==name);write(value);},
 });
}

/** Find the next physical number from already recorded tags, independently of
 * SID. Literal prefix matching prevents punctuation from becoming a regex. */
export function nextPhysicalTagNumber(dataset,sequence){
 const checked=checkedSequence(sequence);if(!checked||!['plain','sex'].includes(checked.style))return null;
 const prefix=checked.prefix??'',step=checked.step??1;let highest=null;
 for(const mouse of dataset?.tables?.mice??[]){const tag=mouse.physical_tag;if(typeof tag!=='string'||!tag.startsWith(prefix))continue;let suffix=tag.slice(prefix.length);if(checked.style==='sex'){if(!/^[MFU]/.test(suffix))continue;suffix=suffix.slice(1);}if(!/^\d+$/.test(suffix))continue;const number=Number(suffix);if(!Number.isSafeInteger(number))fail('An existing physical tag number is too large. Choose the next number explicitly.');highest=highest===null?number:Math.max(highest,number);}
 const next=highest===null?(checked.start??1):highest+step;if(!Number.isSafeInteger(next))fail('The physical tag number exceeds the whole-number range.');return next;
}
