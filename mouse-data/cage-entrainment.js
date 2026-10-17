/* Cage-card display schedules. Inferred/default LD never becomes exposure evidence. */
import {cageObservations,cageCardObservation,todayTaipei} from './cage-observations.js?v=98';
import {validTimingDate as timingDate} from './experiment-timing.js?v=98';
import {blankLocoboxProtocol,blankLocoboxPhase,buildLocoboxProtocol,validateLocoboxRecord} from './locobox-model.js?v=98';
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
/** Replace the visible date-condition rows, including deliberate row removals. */
export function planCageEntrainmentRowsEdit(dataset,context={},rows=[],options={}){
 if(!Array.isArray(rows)||rows.length<1||rows.length>100)throw new Error('Keep between 1 and 100 entrainment rows.');
 const entries=rows.map(row=>({date:row.date,scheme:normalizeCageEntrainmentScheme(row.scheme)}));
 if(entries.some(row=>!validTimingDate(row.date)||!row.scheme)||new Set(entries.map(row=>row.date)).size!==entries.length)throw new Error('Each entrainment row needs a valid, different date and condition.');
 entries.sort((a,b)=>a.date.localeCompare(b.date));const plan=planCageEntrainmentEdit(dataset,context,entries[0],options),type=context.cageSid?'cages':'locations',id=text(context.cageSid||context.positionId),record=currentEditable(dataset,type,id),value={schemaVersion:1,entries,...(type==='locations'?{source_fingerprint:sourceFingerprint(record)}:{})};
 const change=plan.changes[0]||{type,id,field:'cage_entrainment',base:record.cage_entrainment??null};return {...plan,changes:equal(record.cage_entrainment,value)?[]:[{...change,value}]};
}
export function cageEntrainmentRows(dataset,item={},fallbackValue=null){return cageEntrainmentForCard(dataset,item)?.entries||[{date:fallbackValue?.date||'',scheme:fallbackValue?.scheme||'LD'}];}
function exactLocobox(dataset,cageSid){
 currentEditable(dataset,'cages',cageSid);const rows=list(dataset?.tables?.husbandry_events).filter(row=>active(row)&&row.event_type==='locobox_protocol'&&row.locobox_protocol?.status!=='source'&&text(row.locobox_protocol?.cage_sid)===text(cageSid)&&row.locobox_protocol?.link_status==='confirmed'),activeRows=rows.filter(row=>row.locobox_protocol.status==='active'),selected=activeRows.length?activeRows:rows;
 if(selected.length>1)throw new Error('Several LocoBox timelines match this cage. Open LocoBox to choose one.');return selected[0]||null;
}
const locoboxPhaseCode=phase=>{const exact=normalizeCageEntrainmentScheme(phase.scheme);if(exact)return exact;if(phase.scheme!=='Custom')return null;const label=normalizeCageEntrainmentScheme(phase.label),cycle=scheduleCodes({protocol:phase.scheme,cycle_hours:phase.cycle_hours})[0],period=normalizeCageEntrainmentScheme('T'+phase.cycle_hours);return label&&label.startsWith('T')&&period&&label!==period?null:label||cycle||null;};
export function loadCageEntrainmentFromLocobox(dataset,context={}){
 if(!context.cageSid)throw new Error('Link or register this cage to exchange with LocoBox.');const record=exactLocobox(dataset,context.cageSid);if(!record)throw new Error('No LocoBox timeline is linked to this cage.');
 const rows=list(record.locobox_protocol.phases).map(phase=>({date:phase.start_date,scheme:locoboxPhaseCode(phase)}));
 if(!rows.length||rows.some(row=>!validTimingDate(row.date)||!row.scheme))throw new Error('The LocoBox timeline has unknown dates or conditions. Review it in LocoBox.');
 const plan=planCageEntrainmentRowsEdit(dataset,context,rows);for(const change of plan.changes)change.locoboxRead={eventId:record.event_id,value:structuredClone(record)};
 return {...plan,readDependencies:[...plan.readDependencies,{type:'husbandry_events',id:record.event_id}]};
}
export function planCageEntrainmentToLocobox(dataset,context={},rows=[],{replace=false,at=new Date().toISOString()}={}){
 if(!context.cageSid)throw new Error('Link or register this cage to exchange with LocoBox.');const schedule=planCageEntrainmentRowsEdit(dataset,context,rows,{at}),entries=schedule.changes[0]?.value.entries||metadata(currentEditable(dataset,'cages',context.cageSid)).entries,previous=exactLocobox(dataset,context.cageSid),oldRows=list(previous?.locobox_protocol?.phases).map(phase=>({date:phase.start_date,scheme:locoboxPhaseCode(phase)}));
 if(previous&&!equal(oldRows,entries)&&!replace){const error=new Error('Replace the LocoBox date-condition schedule?');error.confirmLocoboxReplacement=true;throw error;}
 if(previous&&!equal(oldRows,entries)&&previous.locobox_protocol.phases.some((phase,index)=>list(phase.treatments).length||phase.timezone&&phase.timezone!=='Asia/Taipei'||phase.end_date&&phase.end_date!==previous.locobox_protocol.phases[index+1]?.start_date||['start_time','end_time','lights_on','lights_off','light_hours','intensity_lux','transition_minutes','duration_days','schedule_details','notes'].some(key=>phase[key]!==null&&phase[key]!==undefined&&phase[key]!=='' )||phase.duration_basis&&phase.duration_basis!=='unknown'||Object.entries(phase.measured_phase||{}).some(([key,value])=>value!==null&&value!==''&&value!==undefined&&!(key==='basis'&&value==='unknown'))))throw new Error('This LocoBox timeline contains timing or treatment details. Edit it in LocoBox.');
 if(previous&&equal(oldRows,entries))return {changes:[],readDependencies:[{type:'husbandry_events',id:previous.event_id}]};
 const cage=currentEditable(dataset,'cages',context.cageSid),input={...blankLocoboxProtocol(),...structuredClone(previous?.locobox_protocol||{}),title:previous?.locobox_protocol?.title||'Cage '+text(cage.cage_tag||cage.cage_sid),status:'active',evidence_status:'recorded',cage_sid:text(cage.cage_sid),location_id:cage.location_id||null,link_status:'confirmed',phases:entries.map((entry,index)=>({...blankLocoboxPhase(),...structuredClone(previous?.locobox_protocol?.phases.find(phase=>phase.start_date===entry.date)||{}),scheme:['LD','DD','LL','LP1','LP2'].includes(entry.scheme)?entry.scheme:'Custom',label:entry.scheme,start_date:entry.date,end_date:entries[index+1]?.date||null,cycle_hours:entry.scheme.startsWith('T')?Number(entry.scheme.slice(1)):null}))};
 const eventId='CAGE-LOCO:'+text(cage.cage_sid);if(eventId.length>200&&!previous)throw new Error('Open LocoBox to create a timeline for this cage.');
 const built=buildLocoboxProtocol(input,dataset,previous,{eventId,now:at}),extras=built.dataset.tables.husbandry_events.filter(row=>row.event_type==='locobox_revision'&&!list(dataset.tables?.husbandry_events).some(old=>old.event_id===row.event_id));
 return {changes:[{type:'husbandry_events',id:built.record.event_id,field:'$locobox',base:previous?structuredClone(previous):null,value:built.record,locoboxRevisions:extras,locoboxCage:{id:text(cage.cage_sid),location_id:cage.location_id??null,room_id:cage.room_id??null,rack_id:cage.rack_id??null}}],readDependencies:[{type:'cages',id:text(cage.cage_sid)},...(previous?[{type:'husbandry_events',id:previous.event_id}]:[])]};
}
export function applyCageEntrainmentLocoboxDrafts(dataset,changes,{canEdit=()=>true}={}){
 const drafts=Array.from(changes||[]),exchanges=drafts.filter(row=>row.type==='husbandry_events'&&row.field==='$locobox');let rows=list(dataset.tables?.husbandry_events);
 for(const change of drafts.filter(row=>row.locoboxRead)){const current=rows.find(row=>row.event_id===change.locoboxRead.eventId),selected=exactLocobox(dataset,change.locoboxRead.value?.locobox_protocol?.cage_sid);if(!equal(current,change.locoboxRead.value)||selected?.event_id!==current?.event_id)throw new Error('The LocoBox timeline changed. Load it again before saving.');}
 if(exchanges.length&&!canEdit('cages'))throw new Error('Housing edit permission is required to save to LocoBox.');
 for(const change of exchanges){
  const current=rows.find(row=>row.event_id===change.id);if(equal(current,change.value))continue;if(!equal(current,change.base))throw new Error('The LocoBox timeline changed. Review the draft before saving.');
  if(change.value?.event_id!==change.id||change.value?.event_type!=='locobox_protocol'||change.value.locobox_protocol?.link_status!=='confirmed')throw new Error('Invalid LocoBox schedule draft.');
  const cage=currentEditable(dataset,'cages',change.value.locobox_protocol.cage_sid),guard=change.locoboxCage,selected=exactLocobox(dataset,cage.cage_sid);if(!equal(selected?.event_id,change.base?.event_id))throw new Error('The LocoBox timeline selection changed. Review it before saving.');if(!guard||guard.id!==text(cage.cage_sid)||['location_id','room_id','rack_id'].some(key=>!equal(cage[key],guard[key])))throw new Error('The cage location changed. Review the LocoBox schedule before saving.');const checked=validateLocoboxRecord(change.value,dataset,current||null);if(checked.errors.length)throw new Error(checked.errors.join(' '));
  for(const revision of list(change.locoboxRevisions)){if(revision.event_type!=='locobox_revision'||revision.locobox_revision?.entity_id!==change.id||validateLocoboxRecord(revision,dataset).errors.length||rows.some(row=>row.event_id===revision.event_id))throw new Error('Invalid LocoBox revision draft.');}
  rows=[...rows.filter(row=>row.event_id!==change.id),structuredClone(change.value),...structuredClone(list(change.locoboxRevisions))];
 }
 return exchanges.length?{...dataset,tables:{...dataset.tables,husbandry_events:rows}}:dataset;
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
 for(const change of Array.from(changes||[]))if(change.locoboxCage){const cage=currentEditable(before,'cages',change.locoboxCage.id);dependencies.set('cage:'+cage.cage_sid,{type:'cages',id:text(cage.cage_sid)});}
 for(const change of Array.from(changes||[]))if(change.locoboxRead)dependencies.set('event:'+change.locoboxRead.eventId,{type:'husbandry_events',id:change.locoboxRead.eventId});else if(change.type==='husbandry_events'&&change.field==='$locobox'&&change.base)dependencies.set('event:'+change.id,{type:'husbandry_events',id:change.id});
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
