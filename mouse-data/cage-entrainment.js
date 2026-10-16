/* Cage-card display schedules. Inferred/default LD never becomes exposure evidence. */
import {cageObservations,cageCardObservation,todayTaipei} from './cage-observations.js?v=94';
import {validTimingDate as timingDate} from './experiment-timing.js?v=94';
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():value==null?'':String(value);
const active=row=>row&&!row.app_archived_at&&row.archived!==true;
const historical=row=>row?.history_read_only===true||row?.source_historical===true||/^historical_(?:snapshot|assignment)_projection$/.test(row?.record_origin||'');
const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const validTimingDate=value=>timingDate(value)&&!value.startsWith('0000-');
export const CAGE_ENTRAINMENT_SCHEMES=Object.freeze(['LD','DD','DL','LL','LDLD','SP','SP1','SP2','LP','LP1','LP2','T23','T24','T25']);
export function normalizeCageEntrainmentScheme(value){
 const code=text(value).toUpperCase();if(CAGE_ENTRAINMENT_SCHEMES.includes(code))return code;
 const match=code.match(/^T\s*(\d+(?:\.\d+)?)\s*(?:H|HR|HOURS?)?$/),hours=match&&Number(match[1]);
 return hours>0&&hours<=1000?'T'+hours:null;
}
function validEntries(value){
 return value?.schemaVersion===1&&Array.isArray(value.entries)&&value.entries.length>0&&value.entries.length<=1000&&value.entries.every((entry,index)=>entry&&typeof entry==='object'&&!Array.isArray(entry)&&Object.keys(entry).length===2&&validTimingDate(entry.date)&&normalizeCageEntrainmentScheme(entry.scheme)===entry.scheme&&(index===0||value.entries[index-1].date<entry.date));
}
const metadata=record=>validEntries(record?.cage_entrainment)?record.cage_entrainment:null;
const manual=value=>({schemaVersion:1,entries:structuredClone(value.entries)});
function sourceFingerprint(position){
 const rows=cageObservations(position).animals,dated=rows.filter(row=>validTimingDate(row.dateOfBirth)).sort((a,b)=>a.dateOfBirth.localeCompare(b.dateOfBirth)||text(a.sourceCell).localeCompare(text(b.sourceCell))),anchor=dated[0]||rows[0];
 const value=JSON.stringify([text(position?.location_id),anchor?.sourceCell??null,anchor?.tag??null,anchor?.dateOfBirth??null]);
 if(!validSourceFingerprint(value))throw new Error('This cage card needs a valid animal/date anchor before saving entrainment.');return value;
}
function validSourceFingerprint(value){
 if(typeof value!=='string'||value.length>2048)return false;let row;try{row=JSON.parse(value);}catch{return false;}
 return Array.isArray(row)&&row.length===4&&typeof row[0]==='string'&&row[0].length>0&&row[0].length<=240&&(row[1]===null||typeof row[1]==='string'&&/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(row[1]))&&(row[2]===null||typeof row[2]==='string'&&row[2].length>0&&row[2].length<=240)&&(row[3]===null||validTimingDate(row[3]))&&(row[2]!==null||row[1]===null&&row[3]===null);
}
function matchesSourceFingerprint(position,fingerprint){
 if(!validSourceFingerprint(fingerprint))return false;const anchor=JSON.parse(fingerprint);if(anchor[0]!==text(position?.location_id))return false;
 const rows=cageObservations(position).animals;return anchor[2]===null?rows.length===0:rows.some(row=>row.sourceCell===anchor[1]&&row.tag===anchor[2]&&row.dateOfBirth===anchor[3]);
}
function availablePositionMetadata(dataset,position,cageSid=null){
 const value=metadata(position);if(!value||!matchesSourceFingerprint(position,value.source_fingerprint))return null;
 const claimed=list(dataset?.tables?.cages).some(cage=>active(cage)&&!historical(cage)&&!cage._derived&&text(cage.cage_sid)!==text(cageSid)&&cage.cage_sheet_card?.schemaVersion===1&&text(cage.cage_sheet_card.source_location_id)===text(position?.location_id)&&matchesSourceFingerprint({...position,source_cage_observation:cage.cage_sheet_card.observation},value.source_fingerprint));
 return claimed?null:value;
}
function housing(dataset,item={}){
 const cage=item.cage||null,physical=item.position||list(dataset?.tables?.locations).find(row=>text(row.location_id)===text(cage?.location_id))||null;
 const card=cageCardObservation(dataset,{...item,cage,position:physical||{}}),origin=list(dataset?.tables?.locations).find(row=>text(row.location_id)===text(card.source_location_id))||physical;
 return {cage,physical,origin,card};
}
/** Only explicit metadata travels with a physical cage; inferred schedules stay at their scope. */
export function cageEntrainmentForCard(dataset,item={}){
 const own=metadata(item.cage);if(own)return manual(own);
 const sourceId=text(item.cage?.cage_sheet_card?.source_location_id||item.cage?.cage_sheet_source_location_id||item.position?.location_id||item.cage?.location_id),possible=list(dataset?.tables?.locations).find(row=>text(row.location_id)===sourceId);
 if(!metadata(possible))return null;
 const {cage,origin,card}=housing(dataset,item);if(!origin)return null;
 const value=availablePositionMetadata(dataset,origin,cage?.cage_sid);
 if(!value||!matchesSourceFingerprint({...origin,source_cage_observation:card.observation},value.source_fingerprint))return null;
 return manual(value);
}
const fallback=(contradictory=false)=>({scheme:'LD',date:null,basis:contradictory?'conflict':'default',contradictory,inferred:true,eventIds:[]});
function scope(event,item){
 const cageId=text(item.cageId||item.cage?.cage_sid),locationId=text(item.locationId||item.position?.location_id||item.cage?.location_id),rackId=text(item.rackId||item.position?.rack_id||item.cage?.rack_id),roomId=text(item.roomId||item.position?.room_id||item.cage?.room_id);
 if(text(event.cage_sid))return text(event.cage_sid)===cageId?4:0;
 if(text(event.location_id))return text(event.location_id)===locationId?3:0;
 if(text(event.rack_id))return text(event.rack_id)===rackId&&(!text(event.room_id)||text(event.room_id)===roomId)?2:0;
 return text(event.room_id)&&text(event.room_id)===roomId?1:0;
}
function scheduleCodes(event){
 const raw=text(event.protocol||event.scheme).toUpperCase(),exact=normalizeCageEntrainmentScheme(raw);if(exact)return [exact];
 if(/^(?:LD|DL)\s*\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?$/.test(raw))return [raw.startsWith('DL')?'DL':'LD'];
 if(/^(?:T(?:[ -]?CYCLE)?|CUSTOM)$/.test(raw)){const hours=Number(event.cycle_hours);return Number.isFinite(hours)&&hours>0&&hours<=1000?[raw==='CUSTOM'&&hours===24?'LD':'T'+hours]:[];}
 return [...new Set((raw.match(/\b(?:LDLD|LD|DD|DL|LL|SP[12]?|LP[12]?|T\s*\d+(?:\.\d+)?)\b/g)||[]).map(normalizeCageEntrainmentScheme).filter(Boolean))];
}
function applicable(event,asOf,capturedAt){
 if(!active(event)||/planned|cancelled/i.test(event.evidence_status||'')||!validTimingDate(event.start_date)||event.start_date>asOf)return false;
 if(event.source_type==='locobox_protocol'&&capturedAt&&Number.isFinite(Date.parse(capturedAt))){
  if(!validTimingDate(event.end_date))return false;
  try{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:event.timezone||'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(capturedAt)).map(row=>[row.type,row.value])),local=`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;return local>=event.start_date+'T'+(event.start_time||'00:00')&&local<event.end_date+'T'+(event.end_time||'00:00');}catch{return false;}
 }
 if(!event.end_date)return event.source_type!=='locobox_protocol';
 return validTimingDate(event.end_date)&&(/exclusive|next phase start/i.test(event.interval_semantics||'')?asOf<event.end_date:asOf<=event.end_date);
}
/** `lights` may use the caller's already-built light/Locobox indexes. No history scan is performed. */
export function resolveCageEntrainment(dataset,item={}, {asOf=todayTaipei(),capturedAt=null,lights=item.applicableLights||[]}={}){
 if(!validTimingDate(asOf))return fallback();
 const value=cageEntrainmentForCard(dataset,item),entry=value?.entries.filter(row=>row.date<=asOf).at(-1);
 if(entry)return {scheme:entry.scheme,date:entry.date,basis:'manual',contradictory:false,inferred:false,eventIds:[]};
 const candidates=list(lights).filter(event=>applicable(event,asOf,capturedAt)).map(event=>({event,scope:scope(event,item)})).filter(row=>row.scope),specificity=Math.max(0,...candidates.map(row=>row.scope));
 const selected=candidates.filter(row=>row.scope===specificity),codes=[...new Set(selected.flatMap(row=>scheduleCodes(row.event)))];
 if(codes.length!==1)return fallback(codes.length>1);
 const corroborating=selected.filter(row=>scheduleCodes(row.event).includes(codes[0])).map(row=>row.event),dates=corroborating.map(event=>event.start_date).sort();
 return {scheme:codes[0],date:dates.at(-1)||null,basis:'schedule',contradictory:false,inferred:true,eventIds:[...new Set(corroborating.map(event=>text(event.event_id)).filter(Boolean))]};
}
function currentEditable(dataset,type,id){
 if(dataset?.history_projection?.read_only===true)throw new Error('Historical cages are read only.');
 const key=type==='cages'?'cage_sid':'location_id',rows=list(dataset?.tables?.[type]).filter(row=>text(row[key])===text(id));
 if(rows.length!==1||!active(rows[0])||historical(rows[0])||rows[0]._derived||type==='locations'&&rows[0].source_current===false)throw new Error('Choose a current cage or position.');return rows[0];
}
export function planCageEntrainmentEdit(dataset,{cageSid=null,positionId=null}={},input={}, {at=new Date().toISOString()}={}){
 const date=input.date,scheme=normalizeCageEntrainmentScheme(input.scheme);if(!validTimingDate(date)||!scheme)throw new Error('Choose an entrainment date and light condition.');
 const type=cageSid?'cages':'locations',id=text(cageSid||positionId),record=currentEditable(dataset,type,id),own=metadata(record),inherited=type==='cages'&&!own?cageEntrainmentForCard(dataset,{cage:record}):null,base=own&&(type==='cages'||matchesSourceFingerprint(record,own.source_fingerprint))?own:inherited;
 const entries=[...list(base?.entries).filter(row=>row.date!==date),{date,scheme}].sort((a,b)=>a.date.localeCompare(b.date)),value={schemaVersion:1,entries,...(type==='locations'?{source_fingerprint:sourceFingerprint(record)}:{})};
 if(!Number.isFinite(Date.parse(at)))throw new Error('Choose a valid save time.');
 const origin=inherited?housing(dataset,{cage:record}).origin:null,sourceEntrainment=origin?{locationId:text(origin.location_id),value:structuredClone(origin.cage_entrainment)}:null;
 return {changes:equal(record.cage_entrainment,value)?[]:[{type,id,field:'cage_entrainment',base:record.cage_entrainment??null,value,...(sourceEntrainment?{sourceEntrainment}:{})}],readDependencies:sourceEntrainment?[{type:'locations',id:sourceEntrainment.locationId}]:[],date,scheme};
}
/** Link metadata once; normal moves never adopt a destination's entrainment. */
export function cageEntrainmentLinkChanges(dataset,cage,position){
 if(metadata(cage))return [];const source=availablePositionMetadata(dataset,position,cage?.cage_sid);if(!source)return [];
 const value=manual(source);return [{type:'cages',id:text(cage.cage_sid),field:'cage_entrainment',base:cage.cage_entrainment??null,value,positionEntrainment:{locationId:text(position.location_id),source_fingerprint:source.source_fingerprint,value}}];
}
export function validateCageEntrainmentDrafts(dataset,changes){
 const drafts=Array.from(changes||[]);
 for(const change of drafts.filter(row=>row.field==='cage_entrainment')){
  if(change.cageSlotMove)continue; // The complete whole-card move is re-derived independently.
  if(!['cages','locations'].includes(change.type))throw new Error('Choose cage entrainment.');
  const record=currentEditable(dataset,change.type,change.id),value=change.value,keys=['schemaVersion','entries',...(change.type==='locations'?['source_fingerprint']:[])];
  if(!validEntries(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new Error('The cage entrainment edit is invalid.');
  if(change.type==='locations'&&!matchesSourceFingerprint(record,value.source_fingerprint))throw new Error('The cage card changed. Reload before editing entrainment.');
  if(change.sourceEntrainment){
   const guard=change.sourceEntrainment,original=currentEditable(dataset,'locations',guard.locationId),edits=drafts.filter(row=>row.type==='locations'&&row.id===guard.locationId&&row.field==='cage_entrainment');
   if(edits.length>1||edits.some(row=>!equal(original.cage_entrainment,row.base)&&!equal(original.cage_entrainment,row.value)))throw new Error('The source cage entrainment changed. Reload before saving.');
   const position=edits.length?{...original,cage_entrainment:edits[0].value}:original,source=availablePositionMetadata(dataset,position,record.cage_sid);
   if(change.type!=='cages'||!source||!equal(source,guard.value))throw new Error('The source cage entrainment changed. Reload before saving.');
  }
  if(change.positionEntrainment){
   const guard=change.positionEntrainment,original=currentEditable(dataset,'locations',guard.locationId),edits=drafts.filter(row=>row.type==='locations'&&row.id===guard.locationId&&row.field==='cage_entrainment');
   if(edits.length>1||edits.some(row=>!equal(original.cage_entrainment,row.base)&&!equal(original.cage_entrainment,row.value)))throw new Error('The source cage entrainment changed. Reload before linking its cage.');
   const position=edits.length?{...original,cage_entrainment:edits[0].value}:original,source=availablePositionMetadata(dataset,position,record.cage_sid),expected=source?manual(source):null;
   if(change.type!=='cages'||!source||guard.source_fingerprint!==source.source_fingerprint||!equal(guard.value,expected)||!equal(value,expected)||metadata(record)&&!equal(manual(metadata(record)),expected))throw new Error('The source cage entrainment changed. Reload before linking its cage.');
  }
 }
 return true;
}
/** Preserve source-card edits when adding a mouse first materializes that card. */
export function applyCageEntrainmentAdoptions(before,after){
 const prior=new Set(list(before?.tables?.cages).map(cage=>text(cage.cage_sid))),changed=new Map();
 for(const cage of list(after?.tables?.cages)){
  if(prior.has(text(cage.cage_sid))||!active(cage)||historical(cage)||cage.record_origin!=='app_created'||metadata(cage))continue;
  const position=list(before?.tables?.locations).find(row=>text(row.location_id)===text(cage.cage_sheet_source_location_id||cage.location_id));if(!position)continue;
  const value=cageEntrainmentForCard(before,{position});if(value)changed.set(text(cage.cage_sid),{...cage,cage_entrainment:value});
 }
 return changed.size?{...after,tables:{...after.tables,cages:list(after.tables.cages).map(cage=>changed.get(text(cage.cage_sid))||cage)}}:after;
}
export function cageEntrainmentReadDependencies(before,after,changes=[]){
 const dependencies=new Map();
 for(const change of Array.from(changes||[]).filter(row=>row.type==='cages'&&row.field==='cage_entrainment'))for(const guard of [change.sourceEntrainment,change.positionEntrainment].filter(Boolean)){
  const position=currentEditable(before,'locations',guard.locationId),id=text(position.location_id);dependencies.set(id,{type:'locations',id});
 }
 for(const cage of list(after?.tables?.cages)){
  const value=metadata(cage),previous=list(before?.tables?.cages).find(row=>text(row.cage_sid)===text(cage.cage_sid));if(!value||equal(value,previous?.cage_entrainment))continue;
  const id=text(cage.cage_sheet_source_location_id||cage.location_id),position=list(before?.tables?.locations).find(row=>text(row.location_id)===id),source=position&&availablePositionMetadata(before,position,cage.cage_sid);
  if(source&&equal(manual(source),value))dependencies.set(id,{type:'locations',id});
 }
 return [...dependencies.values()];
}
