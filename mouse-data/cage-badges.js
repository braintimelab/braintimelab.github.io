/* Work follows its recorded cage or animal. Equipment faults belong to the
 * physical position, in one editable husbandry status record, never an import
 * override or an inferred task from an unknown genotype. */
import {listExperiments,experimentMouseSids} from './experiment-model.js?v=132';
import {cageCardObservation,createCageObservationContext} from './cage-observations.js?v=100';
import {inferNoteBadges,noteTextsFromPosition,sourceBadgeTarget,buildSourceBadgeIndex,sourceBadgeRows,planSourceBadgeEdit} from './cage-note-badges.js?v=103';

export const BADGE_TYPES=Object.freeze([
  {kind:'genotyping',label:'Genotyping',types:['mice','cages']},
  {kind:'experiment',label:'Experiment',types:['mice','cages']},
  {kind:'pir',label:'PIR fault',types:['locations']},
  {kind:'led',label:'LED fault',types:['locations']},
  {kind:'other',label:'Other',types:['mice','cages']},
].map(row=>Object.freeze({...row,types:Object.freeze(row.types)})));
export const WORK_BADGE_STATUSES=Object.freeze(['open','in_progress','done']);
const definitions=new Map(BADGE_TYPES.map(row=>[row.kind,row]));
const keys={mice:'mouse_sid',cages:'cage_sid',locations:'location_id'};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):'';
const active=row=>row&&!row.app_archived_at&&row.archived!==true;
const historical=row=>row?.history_read_only===true||row?.source_historical===true||/^historical_(?:snapshot|assignment)_projection$/.test(row?.record_origin||'');
const current=(row,type)=>active(row)&&!historical(row)&&!row._derived&&(type!=='locations'||row.source_current!==false);
const date=value=>typeof value==='string'&&/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(value)&&date(value.slice(0,10))&&Number.isFinite(Date.parse(value));
// Compare stored JSON by content, including unknown fields, independent of key
// insertion order. A concurrent edit must never be hidden by a lossy projection.
function equal(a,b){
  if(a===b)return true;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>equal(value,b[i]));
  if(!object(a)||!object(b))return false;
  const fields=Object.keys(a);return fields.length===Object.keys(b).length&&fields.every(field=>Object.hasOwn(b,field)&&equal(a[field],b[field]));
}
const clone=value=>value===undefined?undefined:structuredClone(value);

export function badgeLabel(row){return row?.kind==='other'?text(row.label)||'Other':definitions.get(row?.kind)?.label||'Unknown badge';}

/** Undefined denotes an absent optional field. Saved values must be arrays. */
export function validateWorkBadges(type,value){
  const errors=[];
  if(!Object.hasOwn(keys,type)){errors.push('Work badges require an animal, cage, or physical position.');return errors;}
  if(value===undefined)return errors;
  if(!Array.isArray(value)){errors.push('Work badges must be an array.');return errors;}
  if(value.length>12)errors.push('Keep at most 12 work badges on one record.');
  const seen=new Set(),allowed=new Set(['kind','label','status','note','assignee','due_date','updated_at']);
  for(const [i,row] of value.entries()){
    const label=`Work badge ${i+1}`;
    if(!object(row)){errors.push(`${label} must be a record.`);continue;}
    const definition=definitions.get(row.kind);
    if(!definition)errors.push(`${label}: choose a supported badge kind.`);
    else if(!definition.types.includes(type))errors.push(`${label}: ${definition.label} belongs to ${definition.types.join(' or ')}.`);
    if(seen.has(row.kind))errors.push(`${label}: record each kind only once.`);seen.add(row.kind);
    if(Object.keys(row).some(key=>!allowed.has(key)))errors.push(`${label} contains unsupported fields.`);
    if(!WORK_BADGE_STATUSES.includes(row.status))errors.push(`${label}: choose open, in progress, or done.`);
    if(row.label!==undefined&&(typeof row.label!=='string'||row.label.length>40))errors.push(`${label}: label must be text of at most 40 characters.`);
    if(row.kind!=='other'&&text(row.label))errors.push(`${label}: only Other uses a custom label.`);
    for(const [field,max] of [['note',600],['assignee',160]])if(row[field]!==undefined&&(typeof row[field]!=='string'||row[field].length>max))errors.push(`${label}: ${field} must be text of at most ${max} characters.`);
    if(row.due_date!==undefined&&row.due_date!==null&&!date(row.due_date))errors.push(`${label}: due date must be YYYY-MM-DD or blank.`);
    if(!timestamp(row.updated_at))errors.push(`${label}: updated time must be an ISO date and time with a UTC offset.`);
  }
  return errors;
}

function editableRecord(dataset,type,id){
  if(dataset?.history_projection?.read_only===true)throw new Error('Historical cages are read only.');
  if(!Object.hasOwn(keys,type)||!text(id))throw new Error('Choose a linked animal, registered cage, or current physical position.');
  const rows=list(dataset?.tables?.[type]).filter(row=>text(row?.[keys[type]])===text(id));
  if(rows.length!==1||!current(rows[0],type))throw new Error('Choose a current linked animal, registered cage, or physical position.');
  return rows[0];
}

/** Long source IDs retain deterministic bounded keys; the payload is checked as
 * well so even a key collision fails closed rather than reassigning a fault. */
export function equipmentBadgeEventId(locationId){
  const id=text(locationId),direct='cage-equipment:'+id;if(direct.length<=200)return direct;
  let hash=0xcbf29ce484222325n;
  for(let i=0;i<id.length;i++){hash^=BigInt(id.charCodeAt(i));hash=BigInt.asUintN(64,hash*0x100000001b3n);}
  return 'cage-equipment:long:'+hash.toString(16).padStart(16,'0');
}
function equipmentRecord(dataset,locationId){
  const id=equipmentBadgeEventId(locationId),rows=list(dataset?.tables?.husbandry_events).filter(row=>row?.event_id===id);
  if(rows.length>1)throw new Error('This position has conflicting equipment status records. Reload before editing.');
  const row=rows[0];
  if(row&&(!current(row,'husbandry_events')||row.event_type!=='cage_equipment_status'||row.location_id!==locationId||row.equipment_status?.schemaVersion!==1||row.equipment_status.location_id!==locationId))throw new Error('This equipment status record is unavailable or belongs to another position.');
  return row||null;
}
const taipeiDay=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));

/** Upsert one kind. Done rows remain available to reopen in the editor. */
export function planWorkBadgeEdit(dataset,target={},badge,{at=new Date().toISOString()}={}){
  if(target.type==='source_cards')return planSourceBadgeEdit(dataset,target,badge,{at});
  const {type}=target;let {id}=target;
  if(!timestamp(at))throw new Error('Choose a valid badge update time.');
  const record=editableRecord(dataset,type,id);id=text(record[keys[type]]);
  const equipment=type==='locations'?equipmentRecord(dataset,id):null;
  const original=type==='locations'?equipment?.equipment_status.work_badges:record.work_badges;
  const existingErrors=validateWorkBadges(type,original);if(existingErrors.length)throw new Error(existingErrors.join(' '));
  if(!object(badge))throw new Error('Choose a work badge.');
  const row={kind:badge.kind,status:badge.status,note:badge.note??'',assignee:badge.assignee??'',due_date:badge.due_date===undefined||badge.due_date===''?null:badge.due_date,updated_at:at,...(badge.kind==='other'?{label:badge.label??''}:{})};
  // Validate supplied fields as well so invalid data is never silently coerced.
  const errors=validateWorkBadges(type,[{...badge,...row}]);if(errors.length)throw new Error(errors.join(' '));
  const rows=clone(original||[]),previous=rows.find(value=>value.kind===row.kind),summary=`${badgeLabel(row)}: ${row.status.replaceAll('_',' ')}`;
  if(previous&&equal({...previous,updated_at:at},row))return {changes:[],summary};
  const offset=rows.findIndex(value=>value.kind===row.kind);if(offset<0)rows.push(row);else rows[offset]=row;
  const checked=validateWorkBadges(type,rows);if(checked.length)throw new Error(checked.join(' '));
  if(type!=='locations')return {changes:[{type,id,field:'work_badges',base:clone(original),value:rows}],summary};
  const latest=rows.reduce((value,badge)=>Date.parse(badge.updated_at)>Date.parse(value)?badge.updated_at:value,at);
  const eventId=equipmentBadgeEventId(id),value={...(equipment?clone(equipment):{event_id:eventId,event_type:'cage_equipment_status',record_origin:'app_created',location_id:id}),event_date:taipeiDay(latest),equipment_status:{...(equipment?clone(equipment.equipment_status):{}),schemaVersion:1,location_id:id,work_badges:rows}};
  return {changes:[{type:'husbandry_events',id:eventId,field:'$equipment_badges',base:clone(equipment),value}],summary};
}

const equipmentDrafts=changes=>Array.from(changes||[]).filter(row=>row?.field==='$equipment_badges');

/** Recheck equipment drafts against a fresh dataset before applying any. */
export function validateEquipmentBadgeDrafts(dataset,changes,{canEdit=()=>true}={}){
  const errors=[],drafts=equipmentDrafts(changes),seen=new Set();
  if(!drafts.length)return errors;
  if(dataset?.history_projection?.read_only===true)errors.push('Historical cages are read only.');
  if(!canEdit('cages')||!canEdit('locations'))errors.push('Housing edit permission is required to save equipment faults.');
  for(const draft of drafts){
    const value=draft.value,payload=value?.equipment_status,locationId=text(payload?.location_id);
    if(draft.type!=='husbandry_events'||!object(value)||value.event_id!==draft.id||value.event_type!=='cage_equipment_status'||!object(payload)||payload.schemaVersion!==1||!locationId||payload.location_id!==locationId||value.location_id!==locationId||draft.id!==equipmentBadgeEventId(locationId)||!date(value.event_date)||!current(value,'husbandry_events')){errors.push('Invalid equipment badge draft.');continue;}
    if(seen.has(draft.id)){errors.push('Save each equipment status record only once.');continue;}seen.add(draft.id);
    try{
      editableRecord(dataset,'locations',locationId);
      const existing=equipmentRecord(dataset,locationId);
      if(!equal(existing,value)&&!equal(existing,draft.base))errors.push('The equipment status changed. Review the draft before saving.');
      if(existing&&!equal({...existing,event_date:value.event_date,equipment_status:value.equipment_status},value)||existing&&!equal({...existing.equipment_status,work_badges:payload.work_badges},payload)||!existing&&(value.record_origin!=='app_created'||Object.keys(value).some(key=>!['event_id','event_type','event_date','record_origin','location_id','equipment_status'].includes(key)))||!existing&&Object.keys(payload).some(key=>!['schemaVersion','location_id','work_badges'].includes(key)))errors.push('An equipment badge draft cannot change unrelated record metadata.');
      if(!Array.isArray(payload.work_badges))errors.push('Equipment work badges must be an array.');
      else errors.push(...validateWorkBadges('locations',payload.work_badges));
      const latest=list(payload.work_badges).map(row=>row.updated_at).filter(timestamp).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
      if(latest&&value.event_date!==taipeiDay(latest))errors.push('Equipment status date must match its latest badge update.');
    }catch(error){errors.push(error.message);}
  }
  return [...new Set(errors)];
}

export function applyEquipmentBadgeDrafts(dataset,changes,{canEdit=()=>true}={}){
  const drafts=equipmentDrafts(changes),errors=validateEquipmentBadgeDrafts(dataset,drafts,{canEdit});
  if(errors.length)throw new Error(errors.join(' '));
  if(!drafts.length)return dataset;
  const replacements=new Map(drafts.map(row=>[row.id,clone(row.value)])),events=list(dataset?.tables?.husbandry_events).map(row=>{const value=replacements.get(row.event_id);if(!value)return row;replacements.delete(row.event_id);return value;});
  return {...dataset,tables:{...dataset?.tables,husbandry_events:[...events,...replacements.values()]}};
}

function recordMap(rows,type){
  const grouped=new Map();
  for(const row of list(rows)){const id=text(row?.[keys[type]]);if(!id)continue;const group=grouped.get(id)||[];group.push(row);grouped.set(id,group);}
  return new Map([...grouped].filter(([,group])=>group.length===1&&current(group[0],type)).map(([id,group])=>[id,group[0]]));
}
const visibleRows=(type,rows)=>list(rows).filter(row=>validateWorkBadges(type,[row]).length===0&&row.status!=='done');
const descriptor=(type,id,row)=>({kind:row.kind,label:badgeLabel(row),status:row.status,note:row.note||'',assignee:row.assignee||'',due_date:row.due_date??null,type,id});

/** Build once per rendered dataset, never scan all animals/events per cage. */
export function createCageBadgeIndex(dataset,{historical:historicalView=false,observationContext=null,noteHints=[]}={}){
  const tables=dataset?.tables||{},index={historical:historicalView||dataset?.history_projection?.read_only===true,mice:recordMap(tables.mice,'mice'),cages:recordMap(tables.cages,'cages'),locations:recordMap(tables.locations,'locations'),miceByCage:new Map(),equipmentByLocation:new Map(),experimentsByMouse:new Map(),sourceBadges:buildSourceBadgeIndex(dataset),noteContext:observationContext||createCageObservationContext(dataset),noteTexts:new Map(),noteCache:new Map()};
  if(index.historical)return index;
  const hints=new Map(noteHints.map(row=>[row.location_id,row.notes]));
  for(const [id,position]of index.locations)index.noteTexts.set(id,typeof position.source_block_text==='string'?noteTextsFromPosition(position):hints.get(id)||[]);
  for(const [sid,mouse]of index.mice){if(mouse.state!=='Stock')continue;const cageId=text(mouse.cage_sid);if(!cageId)continue;const group=index.miceByCage.get(cageId)||[];group.push(sid);index.miceByCage.set(cageId,group);}
  const equipmentGroups=new Map();
  for(const event of list(tables.husbandry_events))if(event?.event_type==='cage_equipment_status'){
    const payload=event.equipment_status,id=text(payload?.location_id);
    if(!current(event,'husbandry_events')||payload?.schemaVersion!==1||!index.locations.has(id)||event.location_id!==id||event.event_id!==equipmentBadgeEventId(id))continue;
    const group=equipmentGroups.get(id)||[];group.push(event);equipmentGroups.set(id,group);
  }
  for(const [id,group]of equipmentGroups)if(group.length===1)index.equipmentByLocation.set(id,group[0]);
  for(const event of listExperiments(dataset)){
    const experiment=event.experiment;if(!current(event,'husbandry_events')||!['planned','in_progress'].includes(experiment?.status))continue;
    const direct=new Set(list(experiment.participants).filter(row=>row?.link_status==='confirmed').map(row=>text(row.mouse_sid)));
    for(const sid of experimentMouseSids(event,dataset)){
      if(!direct.has(sid)||!index.mice.has(sid))continue;
      const badges=index.experimentsByMouse.get(sid)||[];
      badges.push({...descriptor('husbandry_events',event.event_id,{kind:'experiment',status:experiment.status==='planned'?'open':'in_progress',note:text(experiment.title),assignee:text(experiment.operator)}),derived:true,experimentId:event.event_id,mouseSids:[sid]});
      index.experimentsByMouse.set(sid,badges);
    }
  }
  return index;
}

/** Current literal notes supply suggestions. A saved decision, including Done,
 * wins over the same kind of suggestion without rewriting its source text. */
export function cageNoteBadgesForItem(index,item={},rows,{includeDone=false}={}){
  if(!index||index.historical||historical(item.cage)||historical(item.position))return [];
  const key=JSON.stringify([item.position?.location_id||item.locationId||'',item.cageId||item.cage?.cage_sid||'']);
  const cached=index.noteCache.get(key);
  if(cached&&cached.rows===rows)return cached.entries.filter(row=>includeDone||row.status!=='done');
  const cageId=text(item.cageId||item.cage?.cage_sid),cage=index.cages.get(cageId),positionId=text(item.position?.location_id||item.locationId||cage?.location_id),position=index.locations.get(positionId),result=[];
  const context=index.noteContext,card=cageCardObservation(context.dataset,item,context),observation=card.observation,sourceId=text(card.source_location_id),sourcePosition=index.locations.get(sourceId);
  const suggest=(target,sourceTarget,notes)=>{
    if(!target)return;
    const saved=target.type==='cages'?index.cages.get(target.id)?.work_badges:target.type==='mice'?index.mice.get(target.id)?.work_badges:[];
    const sourceSaved=sourceTarget?sourceBadgeRows(index.sourceBadges,sourceTarget):[],primary=new Set(list(saved).map(row=>row.kind));
    for(const row of sourceSaved)if(!primary.has(row.kind))result.push({...descriptor('source_cards',sourceTarget.id,row),name:sourceTarget.name,source:sourceTarget.source,inferred:false});
    const suppressed=new Set([...primary,...sourceSaved.map(row=>row.kind)]);
    for(const row of inferNoteBadges(notes).filter(row=>['genotyping','experiment'].includes(row.kind)))if(!suppressed.has(row.kind)){
      result.push({...descriptor(target.type,target.id,{...row,status:'open'}),name:target.name,source:target.source,inferred:true,...(target.type==='mice'?{mouseSids:[target.id]}:{})});
    }
  };
  const literalRows=Array.isArray(rows)?rows:observation.animals;
  for(const animal of observation.animals){
    const row=literalRows.find(row=>row.sourceCell===animal.sourceCell&&(row.sourceTag||row.tag)===animal.tag);if(!row)continue;
    const sourceTarget=sourceBadgeTarget(sourceId,observation,animal),mouse=row.mouseSid&&index.mice.get(String(row.mouseSid)),target=mouse?{type:'mice',id:String(row.mouseSid),name:row.tag}:sourceTarget;
    suggest(target,sourceTarget,animal.note);
  }
  const sourceTarget=sourceBadgeTarget(sourceId,observation),sameObservation=sourceTarget&&sourcePosition&&sourceBadgeTarget(sourceId,context.observation(sourcePosition))?.id===sourceTarget.id;
  const excluded=new Set(observation.animals.flatMap(row=>text(row.note).split(/\r?\n/)).map(text).filter(Boolean));
  const retainedNotes=item.cage?.cage_sheet_card?.task_notes;
  const taskNotes=Array.isArray(retainedNotes)?retainedNotes.filter(note=>typeof note==='string').slice(0,200):sameObservation?(index.noteTexts.get(sourceId)||[]).filter(note=>!excluded.has(text(note))):[];
  if(observation.animals.length||sourceBadgeRows(index.sourceBadges,sourceTarget).length)suggest(cage?{type:'cages',id:cageId,name:'Whole cage'}:sourceTarget,sourceTarget,taskNotes.join('\n'));
  if(position){
    const saved=index.equipmentByLocation.get(positionId)?.equipment_status.work_badges||[],suppressed=new Set(saved.map(row=>row.kind));
    for(const row of inferNoteBadges((index.noteTexts.get(positionId)||[]).join('\n')).filter(row=>['pir','led'].includes(row.kind)))if(!suppressed.has(row.kind))result.push({...descriptor('locations',positionId,{...row,status:'open'}),inferred:true});
  }
  index.noteCache.set(key,{rows,entries:result});return result.filter(row=>includeDone||row.status!=='done');
}

/** Source tags never establish identity. Only linked row SIDs can lend a task
 * to a source card. A position fault is independent of animal occupancy. */
export function cageBadgesForItem(index,item={},rows){
  if(!index||index.historical||historical(item)||historical(item.cage)||historical(item.position))return [];
  const cageId=text(item.cageId||item.cage?.cage_sid),cage=index.cages.get(cageId),locationId=text(item.locationId||item.position?.location_id||cage?.location_id),position=index.locations.get(locationId),result=[];
  if(cage)for(const row of visibleRows('cages',cage.work_badges))result.push(descriptor('cages',cageId,row));
  const mouseSids=new Set(Array.isArray(rows)?rows.map(row=>text(row?.mouseSid)).filter(Boolean):list(index.miceByCage.get(cageId))),experiments=new Map();
  for(const sid of mouseSids){
    const mouse=index.mice.get(sid);if(!mouse)continue;
    for(const row of visibleRows('mice',mouse.work_badges))result.push({...descriptor('mice',sid,row),mouseSids:[sid]});
    for(const badge of index.experimentsByMouse.get(sid)||[]){const entry=experiments.get(badge.experimentId);if(entry)entry.mouseSids.push(sid);else experiments.set(badge.experimentId,{...badge,mouseSids:[sid]});}
  }
  result.push(...experiments.values());
  if(position)for(const row of visibleRows('locations',index.equipmentByLocation.get(locationId)?.equipment_status.work_badges))result.push(descriptor('locations',locationId,row));
  result.push(...cageNoteBadgesForItem(index,item,rows));
  return result;
}
