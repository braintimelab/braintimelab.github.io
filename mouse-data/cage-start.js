/* Cage start dates are cage/card metadata. DOB and capture dates never become
 * exact insertion dates, and this module never creates animal identities. */
import {cageObservations,cageCardObservation,cageSheetAnimals,todayTaipei} from './cage-observations.js?v=89';
import {roomOrderRank} from './room-order.js?v=89';
const active=row=>row&&!row.app_archived_at&&row.archived!==true;
const historical=row=>row?.history_read_only===true||row?.source_historical===true||/^historical_(?:snapshot|assignment)_projection$/.test(row?.record_origin||'');
const text=value=>typeof value==='string'?value.trim():value==null?'':String(value);
const list=value=>Array.isArray(value)?value:[];
const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
export const validCageStartDate=value=>typeof value==='string'&&/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const knownDate=(value,asOf)=>validCageStartDate(value)&&value<=asOf?value:null;
const unknown=()=>({date:null,basis:'unknown',estimated:false,evidence:[]});
const metadata=record=>record?.cage_start&&typeof record.cage_start==='object'&&!Array.isArray(record.cage_start)&&record.cage_start.schemaVersion===1?record.cage_start:null;
const sourceFingerprint=position=>{
 const rows=cageObservations(position).animals,dated=rows.filter(row=>validCageStartDate(row.dateOfBirth)).sort((a,b)=>a.dateOfBirth.localeCompare(b.dateOfBirth)||text(a.sourceCell).localeCompare(text(b.sourceCell))),anchor=dated[0]||rows[0];
 const value=JSON.stringify([text(position?.location_id),anchor?.sourceCell??null,anchor?.tag??null,anchor?.dateOfBirth??null]);
 if(!validSourceAnchor(value))throw new Error('This cage card needs a valid animal/date anchor before saving its start date.');return value;
};
function validSourceAnchor(fingerprint){
 if(typeof fingerprint!=='string'||fingerprint.length>2048)return false;let anchor;try{anchor=JSON.parse(fingerprint);}catch{return false;}
 return Array.isArray(anchor)&&anchor.length===4&&typeof anchor[0]==='string'&&anchor[0].length>0&&anchor[0].length<=240&&(anchor[1]===null||typeof anchor[1]==='string'&&/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(anchor[1]))&&(anchor[2]===null||typeof anchor[2]==='string'&&anchor[2].length>0&&anchor[2].length<=240)&&(anchor[3]===null||validCageStartDate(anchor[3]))&&(anchor[2]!==null||anchor[1]===null&&anchor[3]===null);
}
function matchesSourceAnchor(position,fingerprint){
 if(!validSourceAnchor(fingerprint))return false;const anchor=JSON.parse(fingerprint);if(anchor[0]!==text(position?.location_id))return false;
 const rows=cageObservations(position).animals;return anchor[2]===null?rows.length===0:rows.some(row=>row.sourceCell===anchor[1]&&row.tag===anchor[2]&&row.dateOfBirth===anchor[3]);
}

const positionOverride=position=>{const value=metadata(position);return value?.basis==='manual'&&matchesSourceAnchor(position,value.source_fingerprint)?value:null;};
function availablePositionOverride(dataset,position,cageSid=null){
 const value=positionOverride(position);if(!value)return null;
 // Once registered, the date belongs to the moved physical card. Its retained
 // raw source row cannot lend that override to a new cage at the vacated slot.
 const claimed=(dataset?.tables?.cages||[]).some(cage=>active(cage)&&!historical(cage)&&!cage._derived&&text(cage.cage_sid)!==text(cageSid)&&cage.cage_sheet_card?.schemaVersion===1&&text(cage.cage_sheet_card.source_location_id)===text(position?.location_id)&&matchesSourceAnchor({...position,source_cage_observation:cage.cage_sheet_card.observation},value.source_fingerprint));
 return claimed?null:value;
}

const result=(date,basis,evidence=[])=>({date,basis,estimated:basis==='resident_history',evidence});
// Observation joins need current physical cards, not every retired SoftMouse
// cage. Keep the exact current-card predicate, but build its Stock lookup once
// for this read so each position does not rescan every mouse for every old cage.
function observationDataset(dataset){
 const identity=value=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):'';
 const tables=dataset?.tables||{},stock=new Set(list(tables.mice).filter(mouse=>active(mouse)&&mouse.state==='Stock').map(mouse=>identity(mouse.cage_sid)));
 const cages=list(tables.cages).filter(cage=>active(cage)&&!historical(cage)&&!cage._derived&&(!/^(Ended|Inactive)$/i.test(cage.state||'')||stock.has(identity(cage.cage_sid))));
 return {...dataset,tables:{...tables,cages}};
}
function housingItem(dataset,item={}){
 const t=dataset?.tables||{},cage=item.cage||null,physical=item.position||(t.locations||[]).find(p=>text(p.location_id)===text(cage?.location_id))||null;
 const card=cageCardObservation(dataset,{...item,cage,position:physical||{}}),origin=(t.locations||[]).find(p=>text(p.location_id)===text(card.source_location_id))||physical;
 const mice=item.mice||(t.mice||[]).filter(m=>active(m)&&!historical(m)&&m.state==='Stock'&&cage&&text(m.cage_sid)===text(cage.cage_sid));
 return {cage,position:physical,origin,card,mice};
}
function roomKey(dataset,position,source={}){
 const id=text(source.source_room_id||position?.room_id),room=(dataset?.tables?.rooms||[]).find(r=>text(r.room_id)===id),name=text(source.room_label||position?.source_room_label||room?.name||source.sheet_name||position?.source_sheet),rank=roomOrderRank({room_id:id,name});
 return rank<4?'room:'+rank:name?'name:'+name.toLowerCase().replace(/\s+/g,' '):null;
}
const sourceKey=(dataset,position,source={})=>{const room=roomKey(dataset,position,source),label=text(source.cage_label||position?.source_label||position?.label).replace(/\s+/g,'').toUpperCase();return room&&label?room+'|'+label:null;};
const historyCache=new WeakMap();
function historySources(dataset){
 const events=dataset?.tables?.husbandry_events||[],cached=historyCache.get(dataset);if(cached?.events===events)return cached.rows;
 const rows=[];
 const add=(position,date,source,eventId)=>{if(!position||!validCageStartDate(date)||['hidden','veryHidden'].includes(source.sheet_state||position.source_sheet_state))return;const key=sourceKey(dataset,position,source);if(!key)return;rows.push({position,date,key,eventId,workbookId:text(source.workbook_id||position.source_file_id),dateBasis:text(source.date_basis||position.source_snapshot_date_basis)||'source_capture',sourceUrl:text(source.source_url||position.source_url)||null,observation:cageObservations(position)});};
 for(const event of events.filter(active)){
  if(event.event_type==='animal_sheet_cage_snapshot'){
   const s=event.source_cage_snapshot;if(s?.schema_version!==1||!text(s.workbook_id)||!text(s.cage_label))continue;
   const lines=list(s.body).flatMap(cell=>[text(cell.cell)+': '+text(cell.raw),...list(cell.same_row_dates).map(d=>text(d.cell)+': '+text(d.value))]);
   add({location_id:'start-history:'+text(event.event_id),source_cell:s.source_header_cell,source_block_range:s.source_range,source_block_text:typeof s.block_text==='string'?s.block_text:lines.join('\n'),source_cage_observation:s.cage_observation||s.source_cage_observation,source_observed_tags:s.observed_tags},s.snapshot_date,s,event.event_id);
  }else if(event.event_type==='animal_sheet_source_change'){
   const change=event.animal_sheet_change;if(change?.schema_version!==1||change.entity_type!=='locations'||change.action==='conflict')continue;
   for(const side of ['before','after']){const p=change[side];if(!p||p.location_id!==change.entity_id||p.source_file_id!==event.source_file_id||p.source_current===false||side==='after'&&change.action==='withdrawn')continue;add(p,p.source_snapshot_date,{},event.event_id);}
  }
 }
 historyCache.set(dataset,{events,rows});return rows;
}
const identifier=value=>text(value).replace(/^(.*?)(?:\s+|-)([MF]\d+)$/,'$1-$2');
function inferResidentStart(dataset,item,asOf,housing,observationsDataset){
 const {cage,position,origin,card,mice}=housing;if(!origin)return unknown();
 const key=sourceKey(dataset,origin);if(!key)return unknown();
 const samePositions=(dataset?.tables?.locations||[]).filter(p=>active(p)&&!historical(p)&&p.source_current!==false&&sourceKey(dataset,p)===key);if(samePositions.length>1)return unknown();
 const rows=cageSheetAnimals(observationsDataset,{cage,position:position||origin,mice});
 if(!rows.length||rows.some(row=>!knownDate(row.dateOfBirth,asOf)))return unknown();
 const oldest=rows.reduce((date,row)=>row.dateOfBirth<date?row.dateOfBirth:date,rows[0].dateOfBirth),candidates=rows.filter(row=>row.dateOfBirth===oldest&&text(row.sourceTag||row.tag)&&rows.filter(other=>identifier(other.sourceTag||other.tag)===identifier(row.sourceTag||row.tag)&&other.dateOfBirth===row.dateOfBirth).length===1);
 if(!candidates.length)return unknown();
 // Evaluate effective cards once per resolution, rather than once for every
 // oldest animal. This remains a local index, so staged edits cannot reuse it.
 const sightings=new Map();
 for(const other of (dataset?.tables?.locations||[]).filter(p=>active(p)&&!historical(p)&&p.source_current!==false)){
  for(const animal of cageCardObservation(observationsDataset,{position:other}).observation.animals){
   const identity=JSON.stringify([identifier(animal.tag),animal.dateOfBirth]),positions=sightings.get(identity)||new Set();positions.add(text(other.location_id));sightings.set(identity,positions);
  }
 }
 const evidence=[];
 for(const row of candidates){
  const mouse=row.mouseSid?(dataset?.tables?.mice||[]).find(m=>text(m.mouse_sid)===text(row.mouseSid)):null;if(mouse&&(!active(mouse)||historical(mouse)||mouse.state!=='Stock'))continue;
  const literal=identifier(row.sourceTag||row.tag),duplicatePosition=[...(sightings.get(JSON.stringify([literal,row.dateOfBirth]))||[])].some(id=>id!==text(position?.location_id));if(duplicatePosition)continue;
  const identifiers=new Set([row.sourceTag,row.tag,...list(mouse?.physical_tag_aliases)].filter(Boolean).map(identifier)),entries=historySources(dataset).filter(entry=>entry.key===key&&entry.date>=oldest&&entry.date<=asOf).map(entry=>{
   const matches=entry.observation.animals.filter(animal=>identifiers.has(identifier(animal.tag))&&animal.dateOfBirth===oldest&&!animal.requiresReview);
   return {...entry,present:matches.length===1,ambiguous:matches.length>1,animal:matches[0]};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  const byDay=new Map();for(const entry of entries){const group=byDay.get(entry.date)||[];group.push(entry);byDay.set(entry.date,group);}
  let first=null,conflict=false;
  for(const group of byDay.values()){
   if(group.some(entry=>entry.ambiguous)||new Set(group.map(entry=>entry.present)).size>1){first=null;conflict=true;continue;}
   if(!group[0].present){first=null;conflict=false;continue;}
   if(!first){first=group[0];conflict=false;}
  }
  if(!first||conflict)continue;
  const explicit=knownDate(first.observation.startedDate,first.date),date=explicit||first.date;
  evidence.push({date,basis:explicit?'sheet':'resident_history',mouse_sid:text(row.mouseSid)||null,event_id:text(first.eventId)||null,snapshot_date:first.date,date_basis:first.dateBasis,workbook_id:first.workbookId||null,source_url:first.sourceUrl,source_cell:first.animal?.sourceCell||null,source_location_id:card.source_location_id});
 }
 if(!evidence.length)return unknown();const earliest=evidence.sort((a,b)=>a.date.localeCompare(b.date)||String(a.mouse_sid).localeCompare(String(b.mouse_sid)))[0];
 return result(earliest.date,earliest.basis,[earliest]);
}
/** Effective cage/card date; explicit manual clearing always wins over imports. */
export function resolveCageStart(dataset,item={}, {asOf=todayTaipei()}={}){
 if(!validCageStartDate(asOf))return unknown();
 const cage=item.cage||null,own=metadata(cage);
 if(own?.basis==='manual')return result(knownDate(own.date,asOf),'manual');
 const recorded=knownDate(cage?.start_date,asOf);if(recorded)return result(recorded,['entry','resident_history','sheet','recorded'].includes(own?.basis)?own.basis:'recorded',list(own?.evidence));
 // A nonblank invalid recorded date is an unresolved edit, never an import fallback.
 if(text(cage?.start_date))return unknown();
 const observationsDataset=observationDataset(dataset),housing=housingItem(observationsDataset,item),{position,origin,card}=housing;
 const inherited=origin&&availablePositionOverride(observationsDataset,origin,cage?.cage_sid);
 if(inherited&&!cage)return result(knownDate(inherited.date,asOf),'manual');
 const setup=knownDate(cage?.set_up_date,asOf);if(setup)return result(setup,'recorded');
 const sheet=knownDate(card.observation.startedDate,asOf);if(sheet)return result(sheet,'sheet',[{source_location_id:card.source_location_id}]);
 return inferResidentStart(dataset,{...item,cage,position},asOf,housing,observationsDataset);
}
function currentEditable(dataset,type,id){
 if(dataset?.history_projection?.read_only===true)throw new Error('Historical cages are read only.');
 const key=type==='cages'?'cage_sid':'location_id',rows=(dataset?.tables?.[type]||[]).filter(row=>text(row[key])===text(id));
 if(rows.length!==1||!active(rows[0])||historical(rows[0])||rows[0]._derived||type==='locations'&&rows[0].source_current===false)throw new Error('Choose a current cage or position.');return rows[0];
}
/** Stage a date or an intentional blank; raw Animal Sheet observations stay intact. */
export function planCageStartDateEdit(dataset,{cageSid=null,positionId=null}={},value,{at=new Date().toISOString()}={}){
 const date=value===''||value===null?null:value,today=todayTaipei(new Date(at));if(date!==null&&(!validCageStartDate(date)||date>today))throw new Error('Choose a valid cage start date no later than today.');
 const type=cageSid?'cages':'locations',id=text(cageSid||positionId),record=currentEditable(dataset,type,id),meta={schemaVersion:1,basis:'manual',date,...(type==='locations'?{source_fingerprint:sourceFingerprint(record)}:{})};
 const cells=[...(type==='cages'?[{type,id,field:'start_date',base:record.start_date??null,value:date}]:[]),{type,id,field:'cage_start',base:record.cage_start??null,value:meta}];
 return {changes:cells.filter(change=>!equal(change.base,change.value)),readDependencies:[],date};
}
/** A deliberate source-card link carries a manual date only into a cage with no own start. */
export function cageStartLinkChanges(dataset,cage,position){
 const source=availablePositionOverride(dataset,position,cage?.cage_sid);if(!source||metadata(cage)||text(cage?.start_date)||text(cage?.set_up_date))return [];
 const id=text(cage.cage_sid),value={schemaVersion:1,basis:'manual',date:source.date},positionStart={locationId:text(position.location_id),source_fingerprint:source.source_fingerprint,date:source.date};
 return [{type:'cages',id,field:'start_date',base:cage.start_date??null,value:source.date,positionStart},{type:'cages',id,field:'cage_start',base:cage.cage_start??null,value,positionStart}].filter(change=>!equal(change.base,change.value));
}
/** Revalidate first-class date edits on the same fresh records as other cage cells. */
export function validateCageStartDrafts(dataset,changes,{at=new Date().toISOString()}={}){
 const drafts=Array.from(changes||[]),today=todayTaipei(new Date(at));
 for(const change of drafts.filter(change=>change.field==='cage_start')){
  if(change.cageSlotMove)continue; // Re-derived by the complete movement validator.
  if(!['cages','locations'].includes(change.type))throw new Error('Choose a cage start date.');const record=currentEditable(dataset,change.type,change.id),meta=change.value;
  const keys=['schemaVersion','basis','date',...(change.type==='locations'?['source_fingerprint']:[])];
  if(!meta||typeof meta!=='object'||Array.isArray(meta)||Object.keys(meta).length!==keys.length||keys.some(key=>!Object.hasOwn(meta,key))||meta.schemaVersion!==1||meta.basis!=='manual'||meta.date!==null&&(!validCageStartDate(meta.date)||meta.date>today))throw new Error('The cage start date edit is invalid.');
  if(change.type==='locations'&&!matchesSourceAnchor(record,meta.source_fingerprint))throw new Error('The cage card changed. Reload before editing its start date.');
  if(change.positionStart){
   const guard=change.positionStart,original=currentEditable(dataset,'locations',guard.locationId),sourceEdit=drafts.filter(cell=>cell.type==='locations'&&cell.id===guard.locationId&&cell.field==='cage_start');
   if(sourceEdit.length>1||sourceEdit.some(cell=>!equal(original.cage_start,cell.base)&&!equal(original.cage_start,cell.value)))throw new Error('The source cage date changed. Reload before linking its cage.');
   const position=sourceEdit.length?{...original,cage_start:sourceEdit[0].value}:original,source=availablePositionOverride(dataset,position,record.cage_sid),expected=source?{schemaVersion:1,basis:'manual',date:source.date}:null;
   if(change.type!=='cages'||!source||guard.source_fingerprint!==source.source_fingerprint||!equal(guard.date,source.date)||!equal(meta,expected)||metadata(record)&&!equal(metadata(record),expected)||text(record.start_date)&&!equal(record.start_date,source.date)||text(record.set_up_date))throw new Error('The source cage date changed. Reload before linking its cage.');
  }
  if(change.type==='cages'&&!drafts.some(cell=>cell.type==='cages'&&cell.id===change.id&&cell.field==='start_date'&&equal(cell.value,meta.date))&&!equal(record.start_date,meta.date))throw new Error('Save the cage date and its override together.');
 }
 return true;
}
/** Add the Taipei save date only for a never-used app cage's first real entry. */
export function applyCageEntryStartDates(before,after,{at=new Date().toISOString(),entryDate=null}={}){
 const savedDate=todayTaipei(new Date(at)),date=entryDate??savedDate;if(!validCageStartDate(date)||date>savedDate)throw new Error('Choose a valid cage entry date no later than today.');const t=after?.tables||{},old=before?.tables||{},changed=[];
 const resident=(tables,id)=>list(tables.mice).some(m=>active(m)&&!historical(m)&&m.state==='Stock'&&text(m.cage_sid)===id);
 for(const cage of list(t.cages)){
  const id=text(cage.cage_sid),prior=list(old.cages).find(c=>text(c.cage_sid)===id);if(!active(cage)||historical(cage)||cage.record_origin!=='app_created'||!resident(t,id)||resident(old,id)||metadata(cage)||text(cage.start_date)||text(cage.set_up_date))continue;
  if(list(old.mice).some(m=>text(m.cage_sid)===id)||list(old.husbandry_events).some(e=>active(e)&&text(e.cage_sid)===id&&['cage_move','cage_assignment'].includes(e.event_type)))continue;
  const position=list(old.locations).find(p=>text(p.location_id)===text(prior?.location_id||cage.cage_sheet_source_location_id||cage.location_id));
  const manual=availablePositionOverride(before,position,id);
  if(manual){const start={schemaVersion:1,basis:'manual',date:manual.date};changed.push({...cage,start_date:manual.date,cage_start:start,app_modified_at:at});continue;}
  const source=position?resolveCageStart(before,{position},{asOf:savedDate}):unknown();
  if(source.date&&['sheet','resident_history'].includes(source.basis)){const start={schemaVersion:1,basis:source.basis,date:source.date,...(source.evidence.length?{evidence:structuredClone(source.evidence)}:{})};changed.push({...cage,start_date:source.date,cage_start:start,app_modified_at:at});continue;}
  if(list(cage.cage_sheet_card?.observation?.animals).length||position&&cageCardObservation(before,{position}).observation.animals.length)continue;
  const start={schemaVersion:1,basis:'entry',date};changed.push({...cage,start_date:date,cage_start:start,app_modified_at:at});
 }
 if(!changed.length)return after;const byId=new Map(changed.map(cage=>[text(cage.cage_sid),cage]));return {...after,tables:{...t,cages:list(t.cages).map(cage=>byId.get(text(cage.cage_sid))||cage)}};
}

/** Keep adopted historical evidence in the same atomic save as its cage date. */
export function cageStartReadDependencies(before,after){
 const previous=before?.tables||{},next=after?.tables||{},dependencies=new Map();
 const add=(type,id)=>dependencies.set(type+':'+id,{type,id});
 for(const cage of list(next.cages)){
  const id=text(cage.cage_sid),old=list(previous.cages).find(row=>text(row.cage_sid)===id),start=metadata(cage);
  if(!start||equal(start,metadata(old)))continue;
  for(const evidence of list(start.evidence)){
   if(!evidence?.event_id)continue;const eventId=text(evidence.event_id),matches=list(previous.husbandry_events).filter(event=>text(event.event_id)===eventId);
   if(!eventId||eventId.length>200||matches.length!==1||!active(matches[0]))throw new Error('Cage start history changed. Reload before saving.');add('husbandry_events',eventId);
  }
  // Literal source dates have no history event. Retain their position as a
  // guard, including bulk mouse moves that otherwise only update Mice records.
  if(['manual','sheet','resident_history','entry'].includes(start.basis)){
   const positionId=text(old?.location_id||cage.cage_sheet_source_location_id||cage.location_id);
   if(positionId&&list(previous.locations).some(position=>text(position.location_id)===positionId))add('locations',positionId);
  }
 }
 return [...dependencies.values()];
}
