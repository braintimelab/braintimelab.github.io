import { buildCageManagerChoices, cageManagerShortName, cageManagerValue } from './cage-managers.js?v=100';
import { cageSlotMoveEligibility, planCageSlotMove, planCageMove, planCageRemoval, validateCageMovementOccupancy, planMouseMove, planMouseMoveToPosition, validateMouseMoveDrafts, buildMouseMoveEvent, getMouseMoveReadDependencies } from './cage-movement.js?v=103';
import { sortRooms } from './room-order.js?v=100';
import { projectAnimalSheet } from './animal-sheet-export.js?v=100';
import { mouseManager, validateRecord, buildCageLocationEvent } from './model.js?v=100';
import { resolveCageEntrainment, planCageEntrainmentEdit, planCageEntrainmentRowsEdit, cageEntrainmentRows, loadCageEntrainmentFromLocobox, planCageEntrainmentToLocobox, applyCageEntrainmentLocoboxDrafts, validateCageEntrainmentDrafts, applyCageEntrainmentAdoptions, cageEntrainmentReadDependencies } from './cage-entrainment.js?v=100';
import { locoboxEntrainmentCandidates, validTimingDate } from './experiment-timing.js?v=100';
import { cageObservations, cageCardObservation, cageSheetSourceRows, cageSheetAnimals, createCageObservationContext, ageWeeks, todayTaipei } from './cage-observations.js?v=100';
import { cageBreedingLayout } from './mouse-registration.js?v=100';
import { resolveCageStart, planCageStartDateEdit, validateCageStartDrafts, applyCageEntryStartDates, cageStartReadDependencies } from './cage-start.js?v=100';
import { BADGE_TYPES, WORK_BADGE_STATUSES, badgeLabel, validateWorkBadges, planWorkBadgeEdit, createCageBadgeIndex, cageBadgesForItem, cageNoteBadgesForItem, applyEquipmentBadgeDrafts } from './cage-badges.js?v=103';
import {sourceBadgeRows,applySourceBadgeDrafts,sourceBadgeReadDependencies} from './cage-note-badges.js?v=103';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keys={mice:'mouse_sid',cages:'cage_sid',locations:'location_id',husbandry_events:'event_id'};
const fields={mice:['cage_sid','physical_tag','ear_mark','sex','date_of_birth','genotype','manager','comment','note_color','work_badges'],cages:['cage_tag','manager','cage_type','cage_protocol','location_id','comment','start_date','cage_sheet_card','cage_sheet_source_location_id','cage_start','cage_entrainment','work_badges'],locations:['notes','manager','cage_start','cage_entrainment']};
const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const record=(data,type,id)=>(data?.tables?.[type]||[]).find(r=>String(r[keys[type]])===String(id));
const draftKey=(type,id,field)=>JSON.stringify([type,String(id),field]);
const active=r=>r&&!r.app_archived_at&&!r.archived;
const noteColors=['none','green','red'];
const noteColor=value=>noteColors.includes(value)?value:'green';
const currentOverrides=r=>r?.cage_sheet_overrides&&typeof r.cage_sheet_overrides==='object'&&!Array.isArray(r.cage_sheet_overrides)?r.cage_sheet_overrides:{};
const projectionCages=data=>{const occupied=new Set((data.tables.mice||[]).filter(m=>active(m)&&m.state==='Stock').map(m=>String(m.cage_sid)));return (data.tables.cages||[]).filter(c=>active(c)&&(occupied.has(String(c.cage_sid))||/^(Active|Occupied)$/i.test(c.state||''))).sort((a,b)=>String(a.cage_tag||a.cage_sid).localeCompare(String(b.cage_tag||b.cage_sid),undefined,{numeric:true}));};
function phaseApplies(event,capturedAt){
  if(!validTimingDate(event.start_date)||!validTimingDate(event.end_date))return false;
  try{
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:event.timezone||'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(capturedAt).map(p=>[p.type,p.value]));
    const local=`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    // Locobox ends are exclusive; date-only boundaries never invent a clock.
    return local>=event.start_date+'T'+(event.start_time||'00:00')&&local<event.end_date+'T'+(event.end_time||'00:00');
  }catch{return false;}
}
function locoboxLightIndex(dataset,capturedAt,historicalView){
  const protocols=new Map(),revisions=[];
  for(const event of dataset.tables.husbandry_events||[]){
    if(!active(event))continue;
    if(event.event_type==='locobox_protocol'&&event.locobox_protocol)protocols.set(event.event_id,event);
    else if(historicalView&&event.event_type==='locobox_revision'&&event.locobox_revision)revisions.push(event);
  }
  if(historicalView){
    const at=capturedAt.getTime(),day=todayTaipei(capturedAt);
    for(const event of revisions.sort((a,b)=>String(b.app_created_at||b.event_date).localeCompare(String(a.app_created_at||a.event_date)))){
      const revision=event.locobox_revision,after=Number.isFinite(Date.parse(event.app_created_at))?Date.parse(event.app_created_at)>at:revision.effective_date>day;
      const original=protocols.get(revision.entity_id);
      if(after&&original&&revision.before)protocols.set(revision.entity_id,{...original,locobox_protocol:revision.before});
    }
  }
  const index=new Map();
  for(const event of locoboxEntrainmentCandidates({tables:{husbandry_events:[...protocols.values()]}})){
    if(!phaseApplies(event,capturedAt))continue;
    const id=String(event.cage_sid),rows=index.get(id)||[];rows.push(event);index.set(id,rows);
  }
  return index;
}
function specialLightBadges(entrainment){
  return entrainment.scheme==='LD'?'':`<span class="sheet-condition-label" title="${esc(entrainment.date||entrainment.scheme)}" aria-label="${esc('Lighting: '+entrainment.scheme)}">${esc(entrainment.scheme)}</span>`;
}
const entrainmentSchemes=['LD','DD','DL','LL','LDLD','SP','SP1','SP2','LP','LP1','LP2','T23','T24','T25'];
function mergedCageNotes(note,warnings=[]){
  let value=String(note||'').trim();
  for(const warning of [...new Set(warnings)].filter(Boolean))if(!value.includes(warning))value=[value,warning].filter(Boolean).join('\n');
  return value;
}
let renderSequence=0;
let state={context:null,drafts:new Map(),room:'',rack:'',search:'',saving:false,selectedCage:null,selectedSlot:null,newCageIds:new Map(),rowCounts:new Map(),expandedDetails:new Set(),expandedGroups:new Set(),entrainmentForms:new Map(),message:'',error:false};

export function clearCageSheetDrafts(){clearTimeout(state.searchTimer);state={context:null,drafts:new Map(),room:'',rack:'',search:'',saving:false,selectedCage:null,selectedSlot:null,newCageIds:new Map(),rowCounts:new Map(),expandedDetails:new Set(),expandedGroups:new Set(),entrainmentForms:new Map(),message:'',error:false};}
export function hasCageSheetDrafts(){return state.drafts.size>0||[...state.entrainmentForms.values()].some(form=>form.dirty);}

/** Apply only explicit edits to fresh records. Unrelated remote edits survive. */
export function applyCageSheetDrafts(dataset,drafts,{canEdit=()=>true,at=new Date().toISOString()}={}){
  const changes=Array.from(drafts),conflicts=[],updates=new Map(),observationContext=createCageObservationContext(dataset);
  const beforeIndexes=new Map(Object.entries(keys).map(([type,key])=>{const index=new Map();for(const row of dataset.tables[type]||[]){const id=String(row[key]);if(!index.has(id))index.set(id,row);}return [type,index];}));
  const beforeRecord=(type,id)=>beforeIndexes.get(type)?.get(String(id));
  validateCageStartDrafts(dataset,changes,{at});
  validateCageEntrainmentDrafts(dataset,changes,{at});
  if(changes.some(change=>['cage_start','cage_entrainment'].includes(change.field))&&(!canEdit('cages')||!canEdit('locations')))throw new Error('Housing edit permission is required to edit cage dates and entrainment.');
  if(changes.some(c=>c.type==='mice'&&c.field==='cage_sid')&&(!canEdit('mice')||!canEdit('cages')||!canEdit('locations')))throw new Error('Mouse and housing edit permission is required to move mice.');
  validateMouseMoveDrafts(dataset,changes);
  const created=changes.filter(c=>c.type==='cages'&&c.field==='$create');
  if(created.length&&!canEdit('cages'))throw new Error('Cage edit permission is required to create a cage.');
  const fresh={...dataset,tables:{...dataset.tables,cages:[...(dataset.tables.cages||[])]}};
  const inserted=[];
  for(const change of created){if(!record(fresh,'cages',change.id)){const cage={...change.value,app_created_at:at,app_modified_at:at};fresh.tables.cages.push(cage);inserted.push(cage);}}
  validateCageMovementOccupancy(dataset,changes);
  for(const change of changes){
    const {type,id,field,base,value}=change;
    if(type==='cages'&&field==='$create'||type==='husbandry_events'&&['$locobox','$equipment_badges','$source_badges'].includes(field))continue;
    if(!keys[type]||!fields[type].includes(field))throw new Error('Unsupported Animal Sheet cell.');
    if(type==='cages'&&['cage_sheet_card','cage_sheet_source_location_id'].includes(field)&&!change.cageSlotMove)throw new Error('A retained cage card requires a complete cage move.');
    if(type==='mice'&&field==='note_color'&&!noteColors.includes(value))throw new Error('Choose None, Green or Red for the note light.');
    if(field==='work_badges'){const errors=validateWorkBadges(type,value);if(errors.length)throw new Error(errors.join(' '));}
    if(type==='mice'&&field==='date_of_birth'&&value&&value>todayTaipei(new Date(at)))throw new Error('DOB cannot be in the future.');
    if(!canEdit(type))throw new Error(`You do not have permission to edit ${type}.`);
    const current=record(fresh,type,id);
    if(!active(current))throw new Error(`${type} ${id} is missing or archived. Reload the sheet.`);
    if(change.sourceMatch&&!(field==='cage_sid'&&equal(current[field],value))&&!((change.sourceFill===true||change.wholeCageFill===true)&&equal(current[field],value)&&currentOverrides(current)[field]===true)){
      const match=change.sourceMatch,rows=cageSheetSourceRows(dataset,match.locationId,observationContext);
      if(!rows.some(row=>row.mouseSid===String(id)&&(row.sourceTag||row.tag)===match.tag&&row.sourceCell===match.sourceCell))throw new Error('Animal match changed. Reload the sheet before editing this mouse.');
    }
    if(!equal(current[field],base)&&!equal(current[field],value)){conflicts.push(`${type} ${id}: ${field.replaceAll('_',' ')}`);continue;}
    if(equal(current[field],value)&&!(change.overrideSource===true&&currentOverrides(current)[field]!==true))continue;
    const key=JSON.stringify([type,String(id)]),next=updates.get(key)||{...current};
    next[field]=value;updates.set(key,next);
  }
  if(conflicts.length)throw new Error(`Changed by another editor: ${conflicts.join('; ')}. Your draft is kept. Review or discard it before saving.`);
  const tables={...fresh.tables},date=todayTaipei(new Date(at));
  // Apply housing before mouse assignments so simultaneous moves use the final cage tag.
  const ordered=[...updates].sort(([a],[b])=>(JSON.parse(a)[0]==='mice')-(JSON.parse(b)[0]==='mice'));
  for(const [key,next] of ordered){
    const [type,id]=JSON.parse(key),before=record(fresh,type,id);
    if(type==='cages'&&changes.some(c=>c.type===type&&String(c.id)===id&&c.field==='location_id')){
      const position=record(fresh,'locations',next.location_id);
      if(next.location_id&&!active(position))throw new Error(`Position ${next.location_id} is unavailable.`);
      next.room_id=position?.room_id||null;next.rack_id=position?.rack_id||null;
      next.room=(tables.rooms||[]).find(r=>r.room_id===next.room_id)?.name||null;
      next.rack=(tables.racks||[]).find(r=>r.rack_id===next.rack_id)?.name||null;
      next.location=position?.label||null;
    }
    const assignment=type==='mice'?changes.find(c=>c.type===type&&String(c.id)===id&&c.field==='cage_sid'):null;
    if(assignment){
      const cage=record({tables},'cages',next.cage_sid);
      if(!active(cage))throw new Error(`Cage ${next.cage_sid} is unavailable.`);
      next.cage_tag=cage.cage_tag||null;
    }
    if(type==='mice'){
      const explicit=changes.filter(c=>c.type==='mice'&&String(c.id)===id&&['comment','ear_mark','date_of_birth','cage_sid'].includes(c.field));
      if(explicit.length)next.cage_sheet_overrides={...currentOverrides(before),...Object.fromEntries(explicit.map(c=>[c.field,true]))};
    }
    next.app_modified_at=at;
    const {errors}=validateRecord(type,next,{...fresh,tables},id);
    if(errors.length)throw new Error(`${type} ${id}: ${errors.join(' ')}`);
    tables[type]=tables[type].map(r=>String(r[keys[type]])===id?next:r);
    if(type==='cages'&&!inserted.some(c=>String(c.cage_sid)===id)&&!equal(before?.location_id,next.location_id))tables.husbandry_events=[...(tables.husbandry_events||[]),buildCageLocationEvent(next,before,date,{...fresh,tables},'Moved in Cages.')];
    if(assignment){const event=buildMouseMoveEvent(dataset,{...dataset,tables},assignment,{at});if(event)tables.husbandry_events=[...(tables.husbandry_events||[]),event];}
  }
  for(const cage of inserted){
    const final=record({tables},'cages',cage.cage_sid),{errors}=validateRecord('cages',final,{...fresh,tables},cage.cage_sid);
    if(errors.length)throw new Error(`Cage ${cage.cage_sid}: ${errors.join(' ')}`);
    tables.husbandry_events=[...(tables.husbandry_events||[]),buildCageLocationEvent(final,null,date,{...fresh,tables},'Created for an explicit mouse move in Cages.')];
  }
  // Moved and renamed cages keep resident tags and explicit source overrides consistent.
  const relocated=new Set([...updates].filter(([k,r])=>JSON.parse(k)[0]==='cages'&&!equal(record(fresh,'cages',r.cage_sid)?.location_id,r.location_id)).map(([,r])=>String(r.cage_sid)));
  const renamed=[...updates].filter(([k,r])=>JSON.parse(k)[0]==='cages'&&(!equal(record(fresh,'cages',r.cage_sid)?.cage_tag,r.cage_tag)||relocated.has(String(r.cage_sid)))).map(([,r])=>r);
  if(renamed.length){
    const names=new Map(renamed.map(c=>[String(c.cage_sid),c.cage_tag||null]));
    tables.mice=(tables.mice||[]).map(m=>{
      if(!active(m)||m.state!=='Stock'||!names.has(String(m.cage_sid))||equal(m.cage_tag,names.get(String(m.cage_sid)))&&(!relocated.has(String(m.cage_sid))||currentOverrides(m).cage_sid===true))return m;
      if(!canEdit('mice'))throw new Error('Changing a cage tag also requires permission to update its mouse records.');
      return {...m,cage_tag:names.get(String(m.cage_sid)),...(relocated.has(String(m.cage_sid))?{cage_sheet_overrides:{...currentOverrides(m),cage_sid:true}}:{}),app_modified_at:at};
    });
  }
  // Saving a changed slot also fences concurrent occupancy edits at that slot.
  // Source observations remain intact; an already applied retry changes nothing.
  const finalCages=new Map();for(const cage of tables.cages||[])if(!finalCages.has(String(cage.cage_sid)))finalCages.set(String(cage.cage_sid),cage);
  const affectedPositions=new Set(),rememberPosition=id=>{if(id)affectedPositions.add(String(id));};
  for(const cage of tables.cages||[]){
    const before=beforeRecord('cages',cage.cage_sid);
    if(!before||!equal(before.location_id,cage.location_id)){rememberPosition(before?.location_id);rememberPosition(cage.location_id);}
  }
  for(const mouse of tables.mice||[]){
    const before=beforeRecord('mice',mouse.mouse_sid);
    if(!before||equal(before.cage_sid,mouse.cage_sid))continue;
    rememberPosition(beforeRecord('cages',before.cage_sid)?.location_id);rememberPosition(finalCages.get(String(mouse.cage_sid))?.location_id);
    for(const change of changes)if(change.type==='mice'&&String(change.id)===String(mouse.mouse_sid)&&change.field==='cage_sid')rememberPosition(change.sourceMatch?.locationId);
  }
  if(affectedPositions.size){
    if(!canEdit('locations'))throw new Error('Housing edit permission is required to update cage positions.');
    tables.locations=(tables.locations||[]).map(position=>affectedPositions.has(String(position.location_id))?{...position,app_modified_at:new Date(Math.max(Date.parse(at),Number.isFinite(Date.parse(position.app_modified_at))?Date.parse(position.app_modified_at)+1:0)).toISOString()}:position);
  }
  return applySourceBadgeDrafts(applyEquipmentBadgeDrafts(applyCageEntrainmentLocoboxDrafts(applyCageEntrainmentAdoptions(dataset,applyCageEntryStartDates(dataset,{...dataset,tables},{at})),changes,{canEdit}),changes,{canEdit}),changes,{canEdit});
}

export function renderCageSheet(host,dataset,hooks={}){
  const renderToken=++renderSequence;let importing=false,creatingMouse=false,managers=hooks.managers||[],managersLoading=typeof hooks.loadManagers==='function',managersError=false,noteHints=hooks.noteHints||[],noteHintsLoading=typeof hooks.loadNoteHints==='function';
  hooks={...hooks,readOnly:hooks.readOnly===true||dataset?.history_projection?.read_only===true};
  const accountContext=String(hooks.context||'local');
  const context=accountContext+'|'+(hooks.readOnly?'history:'+String(hooks.selectedDate||'unknown'):'current');
  const capturedAt=hooks.selectedDate?new Date(`${hooks.selectedDate}T12:00:00+08:00`):new Date();
  const captureOptions={capturedAt:capturedAt.toISOString()};
  const statusLabel=hooks.readOnly?`Cages as of ${hooks.selectedDate||'the selected date'} · read only`:'Current cage assignments';
  if(state.context!==context){clearCageSheetDrafts();state.context=context;}
  const canEdit=type=>!hooks.readOnly&&!state.saving&&!importing&&!creatingMouse&&![...state.drafts.values()].some(d=>d.cageSlotMove)&&hooks.canEdit?.(type)===true;
  const canImport=()=>!hooks.readOnly&&hooks.canImport?.()===true&&typeof hooks.importFromSheet==='function';
  const importTitle=()=>state.drafts.size?'Save or discard changes before importing.':'Animal sheet → Mouse Data';
  const canMoveMice=()=>canEdit('mice')&&canEdit('cages')&&canEdit('locations');
  const compact=hooks.layout!=='detailed';
  let cachedPreview=null,cachedDataset=null,cachedDrafts=[];
  function preview(){
    const drafts=[...state.drafts.values()];
    if(!drafts.length)return dataset;
    if(cachedDataset===dataset&&drafts.length===cachedDrafts.length&&drafts.every((draft,i)=>draft===cachedDrafts[i]))return cachedPreview;
    const tables={...dataset.tables},edits=new Map();
    for(const draft of drafts.filter(row=>row.type==='husbandry_events'&&row.field==='$locobox'))tables.husbandry_events=[...(tables.husbandry_events||[]).filter(row=>row.event_id!==draft.id),draft.value,...(draft.locoboxRevisions||[])];
    for(const draft of drafts.filter(row=>row.type==='husbandry_events'&&['$equipment_badges','$source_badges'].includes(row.field)))tables.husbandry_events=[...(tables.husbandry_events||[]).filter(row=>row.event_id!==draft.id),draft.value];
    for(const d of drafts){const key=JSON.stringify([d.type,String(d.id)]),group=edits.get(key)||[];group.push(d);edits.set(key,group);}
    for(const type of ['cages','locations','mice']){
      const source=tables[type]||[],created=drafts.filter(d=>d.type===type&&d.field==='$create'&&!source.some(r=>String(r[keys[type]])===String(d.id)));
      tables[type]=[...source,...created.map(d=>d.value)].map(r=>{
        const changes=(edits.get(JSON.stringify([type,String(r[keys[type]])]))||[]).filter(d=>d.field!=='$create');if(!changes.length)return r;
        const next={...r};for(const d of changes)next[d.field]=d.value;
        if(type==='mice'){
          if(changes.some(d=>d.field==='cage_sid')){next.cage_tag=(tables.cages||[]).find(c=>String(c.cage_sid)===String(next.cage_sid))?.cage_tag||null;next.cage_sheet_overrides={...currentOverrides(next),cage_sid:true};}
          const fields=changes.filter(d=>['comment','ear_mark','date_of_birth'].includes(d.field));if(fields.length)next.cage_sheet_overrides={...currentOverrides(next),...Object.fromEntries(fields.map(d=>[d.field,true]))};
        }
        if(type==='cages'&&changes.some(d=>d.field==='location_id')){const p=(tables.locations||[]).find(p=>p.location_id===next.location_id);next.room_id=p?.room_id||null;next.rack_id=p?.rack_id||null;next.room=null;next.rack=null;next.location=p?.label||null;}
        return next;
      });
    }
    const moved=new Set(drafts.filter(d=>d.type==='cages'&&d.field==='location_id'&&!equal(d.base,d.value)).map(d=>String(d.id))),cages=new Map(tables.cages.map(c=>[String(c.cage_sid),c]));
    if(moved.size)tables.mice=tables.mice.map(m=>active(m)&&m.state==='Stock'&&moved.has(String(m.cage_sid))?{...m,cage_tag:cages.get(String(m.cage_sid))?.cage_tag||null,cage_sheet_overrides:{...currentOverrides(m),cage_sid:true}}:m);
    cachedDataset=dataset;cachedDrafts=drafts;cachedPreview={...dataset,tables};return cachedPreview;
  }
  let viewDataset=preview(),inlineEditor=null,startEditorKey=null,drag=null,suppressMouseClickUntil=0,badgePanelKey=null,badgeForm=null,badgeIndex;
  const dragPlans=new Map();
  let observationContext,viewIndexes,stockCages,movementStockCages,occupantsByPosition,movementIntegrityError,positionOptions,locoboxLights,readDataset=null;
  const historical=r=>r?.history_read_only===true||r?.source_historical===true||/^historical_(?:snapshot|assignment)_projection$/.test(r?.record_origin||'');
  const viewRecord=(type,id)=>viewIndexes?.get(type)?.get(String(id));
  function prepareReadContext(){
    if(readDataset===viewDataset)return false;
    observationContext=createCageObservationContext(viewDataset);viewIndexes=new Map();movementIntegrityError='';
    for(const [type,key] of Object.entries({...keys,rooms:'room_id',racks:'rack_id'})){
      const index=new Map();for(const row of viewDataset.tables[type]||[]){const id=String(row[key]);if(index.has(id)&&type!=='mice')movementIntegrityError=`Duplicate ${key} ${id}; review the database before moving cages.`;if(!index.has(id))index.set(id,row);}viewIndexes.set(type,index);
    }
    stockCages=observationContext.stockCages;
    movementStockCages=new Set((viewDataset.tables.mice||[]).filter(m=>active(m)&&!historical(m)&&!m._derived&&m.state==='Stock'&&m.cage_sid!==null&&m.cage_sid!==undefined&&m.cage_sid!=='').map(m=>String(m.cage_sid)));
    occupantsByPosition=new Map();for(const c of viewDataset.tables.cages||[]){if(!active(c)||/^(Ended|Inactive)$/i.test(c.state||'')&&!movementStockCages.has(String(c.cage_sid)))continue;const id=String(c.location_id||''),rows=occupantsByPosition.get(id)||[];rows.push(c);occupantsByPosition.set(id,rows);}
    positionOptions=[['','Unassigned'],...(dataset.tables.locations||[]).filter(p=>active(p)&&p.source_current!==false).map(p=>[String(p.location_id),`${viewRecord('rooms',p.room_id)?.name||p.room_id||''} / ${viewRecord('racks',p.rack_id)?.name||p.rack_id||''} / ${p.label||p.location_id}`])];
    locoboxLights=locoboxLightIndex(viewDataset,capturedAt,hooks.readOnly);
    badgeIndex=createCageBadgeIndex(viewDataset,{historical:hooks.readOnly,observationContext,noteHints});
    readDataset=viewDataset;return true;
  }
  prepareReadContext();
  const registeredCage=id=>{const cage=viewRecord('cages',id);return active(cage)&&!cage._derived&&!cage.history_read_only&&!cage.source_historical&&(stockCages.has(String(id))||/^(Active|Occupied)$/i.test(cage.state||''))?cage:null;};
  // Presentation checks only housing. Identity/source proofs are revalidated by
  // the movement planner on drag/drop and again against fresh data on Save.
  function housingMoveReason(position,cage){
    if(movementIntegrityError)return movementIntegrityError;
    const id=String(position?.location_id||''),room=viewRecord('rooms',position?.room_id),rack=viewRecord('racks',position?.rack_id);
    if(!active(position))return `Position ${id} is missing or archived.`;
    if(!active(room)||!active(rack)||String(rack.room_id||'')!==String(room.room_id))return `Position ${id} needs an active room and a rack in that room.`;
    if([position,room,rack].some(historical))return 'Historical positions cannot be moved.';
    if(typeof position.label!=='string'||!position.label.trim())return `Position ${id} needs a label before it can name a cage.`;
    const occupants=occupantsByPosition.get(id)||[];if(occupants.length>1)return `Position ${position.label} has multiple current cages.`;
    const occupant=occupants[0];if(occupant&&(historical(occupant)||occupant._derived||! /^(Active|Occupied)$/i.test(occupant.state||'')&&!movementStockCages.has(String(occupant.cage_sid))))return 'Choose a current active cage.';
    if(cage)for(const field of ['room_id','rack_id'])if(cage[field]!==null&&cage[field]!==undefined&&cage[field]!==''&&String(cage[field])!==String(position[field]))return `Cage ${cage.cage_sid} has inconsistent ${field.replace('_',' ')} and position references. Review them before moving it.`;
    return '';
  }
  const animalRows=new Map(),asOf=hooks.selectedDate||todayTaipei();
  function canMoveCage(id){return Boolean(registeredCage(id)&&!state.drafts.has(draftKey('cages',id,'$create')));}
  function verifySlotSource(source){
    if(hasCageSheetDrafts())throw new Error('Save or discard pending changes before moving another whole cage.');
    if(noteHintsLoading&&typeof viewRecord('locations',source)?.source_block_text!=='string')throw new Error('Loading cage badges. Try again.');
    if(!canMoveMice())throw new Error('Mouse and housing edit permission is required.');
    return cageSlotMoveEligibility(viewDataset,source);
  }
  function slotPlan(source,destination){
    verifySlotSource(source);
    const newCageIds={};for(const id of [source,destination]){if(!state.newCageIds.has(id))state.newCageIds.set(id,'CAGE-'+crypto.randomUUID());newCageIds[id]=state.newCageIds.get(id);}
    return planCageSlotMove(viewDataset,source,destination,{newCageIds,noteHints});
  }
  const movableSlots=new Map(),cageRowsCache=new Map(),cageLayoutCache=new Map(),cageStartCache=new Map(),detailTargets=new Map(),entrainmentTargets=new Map(),lazyGroups=new Map(),newMouseTargets=new Map(),startDateTargets=new Map(),emptySlotTargets=new Map(),expandedEmptySlots=new Set();
  const cageRows=item=>{const key=JSON.stringify([item.position?.location_id||item.locationId,item.cageId||item.cage?.cage_sid]);if(!cageRowsCache.has(key))cageRowsCache.set(key,cageSheetAnimals(viewDataset,item,observationContext));return cageRowsCache.get(key);};
  const itemKey=item=>JSON.stringify([item.position?.location_id||item.locationId||'',item.cageId||item.cage?.cage_sid||'']);
  function cageLayout(item){
    const key=itemKey(item);
    if(!cageLayoutCache.has(key)){
      const rows=cageRows(item);
      cageLayoutCache.set(key,hooks.readOnly?{rows,parentCount:0,isBreeding:false}:cageBreedingLayout(viewDataset,item,rows));
    }
    return cageLayoutCache.get(key);
  }
  function mouseEntryTarget(item){
    if(hooks.readOnly||!canEdit('mice')||typeof hooks.newMouse!=='function')return null;
    if(item.cage&&!item.cage._derived)return registeredCage(item.cageId)?{cageSid:String(item.cageId),positionId:item.position?.location_id||null}:null;
    const position=item.position;
    if(!active(position)||!position.location_id||position.source_current===false||position.history_read_only||position.source_historical||!canEdit('cages')||!canEdit('locations'))return null;
    return {cageSid:null,positionId:String(position.location_id)};
  }
  function newMouseButton(item,{newborn=false,empty=false}={}){
    const target=mouseEntryTarget(item),label=newborn?'Add newborn':'Add mouse';
    if(!target)return empty?'<div class="sheet-empty-mouse" aria-hidden="true"></div>':'';
    const key=itemKey(item);newMouseTargets.set(key,item);
    return `<button type="button" class="text-button ${empty?'sheet-empty-mouse':'sheet-add-mouse'}" data-sheet-add-mouse="${esc(key)}" data-sheet-newborn="${newborn?'true':'false'}" aria-label="${esc(label+' to '+item.positionName)}" title="${esc(label)}">${empty?'':newborn?'Newborn':'Add mouse'}</button>`;
  }
  const mouseRowCount=(item,count=cageLayout(item).rows.length)=>Math.max(5,count,state.rowCounts.get(itemKey(item))||5);
  function emptyMouseRows(item,count,{table=false}={}){
    if(hooks.readOnly)return '';
    const newborn=cageLayout(item).isBreeding===true;
    return Array.from({length:Math.max(0,mouseRowCount(item,count)-count)},()=>table?`<tr class="sheet-empty-mouse-row"><td colspan="6">${newMouseButton(item,{newborn,empty:true})}</td></tr>`:newMouseButton(item,{newborn,empty:true})).join('');
  }
  function newMouseActions(item){
    if(hooks.readOnly||!mouseEntryTarget(item))return '';
    const key=itemKey(item),count=cageLayout(item).rows.length;newMouseTargets.set(key,item);
    return `<div class="sheet-add-mouse-actions sheet-row-controls"><button type="button" class="text-button sheet-row-control" data-sheet-rows-add="${esc(key)}" aria-label="Add mouse row to ${esc(item.positionName)}" title="Add row">＋</button><button type="button" class="text-button sheet-row-control" data-sheet-rows-remove="${esc(key)}" aria-label="Remove empty mouse row from ${esc(item.positionName)}" title="Remove empty row"${mouseRowCount(item,count)<=Math.max(5,count)?' disabled':''}>−</button>${cageLayout(item).isBreeding?newMouseButton(item,{newborn:true}):''}${newMouseButton(item)}</div>`;
  }
  function canEditStart(item){
    if(!canEdit('cages')||!canEdit('locations'))return false;
    if(item.cage&&!item.cage._derived)return Boolean(registeredCage(item.cageId));
    const position=item.position;
    return Boolean(active(position)&&position.location_id&&position.source_current!==false&&!position.history_read_only&&!position.source_historical);
  }
  const cageStart=item=>{const key=itemKey(item);if(!cageStartCache.has(key))cageStartCache.set(key,resolveCageStart(viewDataset,item,{asOf}));return cageStartCache.get(key);};
  function startDateControl(item){
    const started=cageStart(item),date=started.date,key=itemKey(item),elapsed=ageWeeks(date,asOf);
    startDateTargets.set(key,item);
    const label=date?`<time datetime="${esc(date)}">${esc(date)}</time>${elapsed!==null?` <span class="sheet-start-age">${elapsed}wk</span>`:''}`:'—/—/—',title=date?`Started ${date}${started.estimated?' (estimated)':''}`:'Start date unknown';
    return canEditStart(item)?`<button type="button" class="text-button sheet-start-date" data-sheet-edit-start="${esc(key)}" aria-label="Edit start date for ${esc(item.positionName)}" title="${esc(title)}">${label}</button>`:`<span class="sheet-start-date" title="${esc(title)}">${label}</span>`;
  }
  function startDateEditor(item){
    const key=itemKey(item);if(!canEditStart(item)||startEditorKey!==key)return '';
    const date=cageStart(item).date;
    return `<div class="sheet-start-editor"><label>Started<input type="date" data-sheet-start-input="${esc(key)}" aria-label="Start date for ${esc(item.positionName)}" max="${esc(todayTaipei())}" value="${esc(date||'')}"></label><button type="button" class="text-button" data-sheet-clear-start="${esc(key)}">Clear</button><button type="button" class="text-button" data-sheet-close-start="${esc(key)}">Done</button></div>`;
  }
  function editStartDate(key,value){
    if(renderToken!==renderSequence||state.context!==context||String(hooks.currentContext?.()??accountContext)!==accountContext)return;
    const item=startDateTargets.get(key);if(!item||!canEditStart(item))return;
    try{const plan=planCageStartDateEdit(viewDataset,{cageSid:item.cage&&!item.cage._derived?String(item.cageId):null,positionId:item.position?.location_id||null},value);startEditorKey=null;stage({...plan,summary:'Start date updated.'});}
    catch(error){state.message=error.message||'Choose a valid start date.';state.error=true;updateDraftControls();}
  }
  function slotStatus(item){
    const positionId=item.position?.location_id;
    if(movableSlots.has(positionId||item.cageId))return movableSlots.get(positionId||item.cageId);
    const cage=item.cage&&!item.cage._derived?item.cage:null,rows=cageRows(item),position=item.position;
    let reason='';
    if(hooks.readOnly)reason='Historical cages are read only.';
    else if(hasCageSheetDrafts())reason='Save or discard pending changes before moving a whole cage.';
    else if(!canMoveMice())reason='Mouse and housing edit permission is required.';
    else if(position&&(position.source_current===false||position.history_read_only||position.source_historical))reason='This is not a current rack position.';
    else if(!positionId&&!canMoveCage(item.cageId))reason='This cage needs a verified current assignment.';
    else if(!cage&&!rows.length)reason='This position is empty.';
    else if(cage&&!registeredCage(item.cageId))reason='Choose a current active cage.';
    else if(positionId)reason=housingMoveReason(position,cage);
    const status={canMove:!reason,reason:reason||'Drag cage or choose Move.'};movableSlots.set(positionId||item.cageId,status);return status;
  }
  const cageChoices=projectionCages(dataset);
  const val=(type,id,field,fallback='')=>{const key=draftKey(type,id,field);return state.drafts.has(key)?state.drafts.get(key).value:(record(dataset,type,id)||state.drafts.get(draftKey(type,id,'$create'))?.value)?.[field]??fallback;};
  let projection=projectAnimalSheet(viewDataset,{entityTypes:[],...captureOptions});
  const rooms=sortRooms([...new Map(projection.groups.filter(g=>g.roomId).map(g=>[g.roomId,{room_id:g.roomId,name:g.roomName}])).values()]).map(r=>[r.room_id,r.name]);
  const racks=[...new Map(projection.groups.filter(g=>g.rackId&&(!state.room||g.roomId===state.room)).map(g=>[g.rackId,g.rackName]))];
  const input=(type,id,field,label,options={})=>{
    const raw=Object.hasOwn(options,'value')?options.value:field==='manager'&&Object.hasOwn(viewRecord(type,id)||{},'manager')?viewRecord(type,id).manager:val(type,id,field,options.fallback),value=options.managerSelect?cageManagerValue(managers,raw):raw,pending=state.drafts.has(draftKey(type,id,field));
    const attrs=`data-sheet-type="${type}" data-sheet-id="${esc(id)}" data-sheet-field="${field}" aria-label="${esc(label)}"${options.managerSelect?` title="${esc(raw||'Unassigned')}"`:''}${canEdit(type)&&(!options.managerSelect||!managersLoading&&!managersError)&&!(type==='cages'&&state.drafts.has(draftKey(type,id,'$create')))?'':' disabled'}${pending||options.managerSelect?` class="${options.managerSelect?'sheet-manager-select ':''}${pending?'sheet-pending':''}"`:''}`;
    if(options.choices)return `<select ${attrs}>${options.choices.map(([v,n,disabled])=>`<option value="${esc(v)}"${String(value)===String(v)?' selected':''}${disabled?' disabled':''}>${esc(n)}</option>`).join('')}</select>`;
    if(options.multiline)return `<textarea ${attrs} rows="2" placeholder="${esc(options.placeholder||'Notes')}">${esc(value)}</textarea>`;
    return `<input ${attrs} type="${options.type||'text'}" value="${esc(value)}" placeholder="${esc(options.placeholder||'—')}"${field==='ear_mark'?' maxlength="160"':''}>`;
  };
  const select=(id,label,items,value)=>`<label class="sr-only" for="${id}">${label}</label><select id="${id}"><option value="">${label}</option>${items.map(([v,n])=>`<option value="${esc(v)}"${v===value?' selected':''}>${esc(n)}</option>`).join('')}</select>`;
  function cageEntrainment(item){
    return resolveCageEntrainment(viewDataset,item,{asOf,capturedAt,lights:[...item.applicableLights,...(locoboxLights.get(item.cageId)||[])]});
  }
  function entrainmentContext(item){return {cageSid:item.cage&&!item.cage._derived?String(item.cageId):null,positionId:item.position?.location_id||null};}
  const exchangePending=()=>[...state.drafts.values()].some(row=>row.field==='$locobox');
  function entrainmentForm(item,value){const key=itemKey(item);if(!state.entrainmentForms.has(key))state.entrainmentForms.set(key,{rows:structuredClone(cageEntrainmentRows(viewDataset,item,value)),dirty:false,error:''});return state.entrainmentForms.get(key);}
  function entrainmentFields(item,value){
    const key=itemKey(item),editable=canEditStart(item)&&!exchangePending(),form=entrainmentForm(item,value),exchangeable=editable&&Boolean(entrainmentContext(item).cageSid),attrs=`data-sheet-entrainment-key="${esc(key)}"`,button=(action,path,title,disabled=false)=>`<button type="button" class="text-button sheet-entrainment-icon" data-sheet-entrainment-action="${action}" ${attrs} title="${esc(title)}" aria-label="${esc(title)}"${disabled?' disabled':''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></button>`;
    return `<div class="sheet-entrainment-fields">${form.rows.map((row,index)=>{const options=[...new Set([...entrainmentSchemes,row.scheme])];return `<div class="sheet-entrainment-row"><input type="date" data-sheet-entrainment="date" data-sheet-entrainment-row="${index}" ${attrs} aria-label="Entrainment date for ${esc(item.positionName)} row ${index+1}" value="${esc(row.date||'')}"${editable?'':' disabled'}><span aria-hidden="true">–</span><select data-sheet-entrainment="scheme" data-sheet-entrainment-row="${index}" ${attrs} aria-label="Entrainment condition for ${esc(item.positionName)} row ${index+1}"${editable?'':' disabled'}>${options.map(scheme=>`<option value="${esc(scheme)}"${scheme===row.scheme?' selected':''}>${esc(scheme)}</option>`).join('')}</select><button type="button" class="text-button sheet-entrainment-remove" data-sheet-entrainment-action="remove" data-sheet-entrainment-row="${index}" ${attrs} aria-label="Remove entrainment row ${index+1}" title="Remove row"${editable&&form.rows.length>1?'':' disabled'}>−</button></div>`;}).join('')}<div class="sheet-entrainment-actions"><button type="button" class="text-button" data-sheet-entrainment-action="add" ${attrs} title="Add entrainment row" aria-label="Add entrainment row"${editable&&form.rows.length<100?'':' disabled'}>＋</button>${button('save','M4 3h13l3 3v15H4z M8 3v6h8V3 M8 21v-7h8v7',exchangeable?'Save schedule → LocoBox':exchangePending()?'Save pending changes to Mouse Data first':'Save schedule → LocoBox (link or register cage first)',!exchangeable)}${button('load','M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',exchangeable?'Load schedule ← LocoBox':exchangePending()?'Save pending changes to Mouse Data first':'Load schedule ← LocoBox (link or register cage first)',!exchangeable)}${!hooks.readOnly?`<button type="button" class="text-button" data-sheet-locobox="${esc(item.cageId)}" data-sheet-position="${esc(item.position?.location_id||'')}">LocoBox ↗</button>`:''}</div></div>`;
  }
  function stageEntrainmentRows(item){const form=entrainmentForm(item,cageEntrainment(item));try{const plan=planCageEntrainmentRowsEdit(viewDataset,entrainmentContext(item),form.rows);form.error='';form.rows=structuredClone(plan.changes[0]?.value.entries||form.rows);stage({...plan,summary:'Entrainment updated.'});}catch(error){form.error=error.message;state.message=error.message;state.error=true;updateDraftControls();}}
  function entrainmentEntry(item,value){
    const key=itemKey(item),opened=state.expandedDetails.has('entrainment:'+key);
    entrainmentTargets.set(key,item);
    return `<details class="sheet-edit-details sheet-entrainment" data-sheet-entrainment-panel="${esc(key)}"${opened?' open':''}><summary>Entrainment <span class="sheet-entrainment-current">${esc(value.scheme)}</span></summary><div data-sheet-entrainment-body data-loaded="${opened?'true':'false'}">${opened?entrainmentFields(item,value):''}</div></details>`;
  }
  function cageNotes(item){
    const cage=item.cage,real=cage&&!cage._derived,type=real?'cages':'locations',id=real?item.cageId:item.position?.location_id,field=real?'comment':'notes';
    const value=mergedCageNotes(id?val(type,id,field):'',item.warnings);
    const control=id?input(type,id,field,(real?'Cage notes ':'Position notes ')+id,{multiline:true,value}):`<p>${esc(value)}</p>`;
    return `<details class="sheet-edit-details sheet-cage-notes"><summary>Notes</summary>${control}</details>`;
  }
  const badgeItems=new Map(),badgeEntries=new Map();
  const badgeStatusLabel=value=>({open:'Open',in_progress:'In progress',done:'Done'}[value]||value);
  function badgeTargets(item,kind){
    if(['pir','led'].includes(kind))return item.position&&active(item.position)&&!historical(item.position)&&item.position.source_current!==false?[{type:'locations',id:String(item.position.location_id),name:'Equipment · '+item.positionName}]:[];
    const targets=[],seen=new Set();
    if(item.cage&&!item.cage._derived&&registeredCage(item.cageId))targets.push({type:'cages',id:String(item.cageId),name:'Whole cage'});
    for(const row of cageRows(item)){const id=String(row.mouseSid||''),mouse=viewRecord('mice',id);if(id&&!seen.has(id)&&active(mouse)&&!historical(mouse)&&!mouse._derived&&['matched','registered'].includes(row.matchStatus)){seen.add(id);targets.push({type:'mice',id,name:row.tag||mouse.physical_tag||id});}}
    for(const row of cageNoteBadgesForItem(badgeIndex,item,cageRows(item),{includeDone:true}).filter(row=>row.type==='source_cards'))if(!targets.some(target=>target.type===row.type&&target.id===row.id))targets.push({type:row.type,id:row.id,name:row.name||'Card note',source:row.source});
    return targets;
  }
  const canEditBadgeTarget=target=>Boolean(target&&(['locations','source_cards'].includes(target.type)?canEdit('cages')&&canEdit('locations'):canEdit(target.type)));
  const badgeTargetKey=target=>JSON.stringify([target.type,target.id]);
  const targetBadges=target=>target.type==='source_cards'?sourceBadgeRows(badgeIndex.sourceBadges,target):target.type==='locations'?badgeIndex.equipmentByLocation.get(target.id)?.equipment_status?.work_badges||[]:viewRecord(target.type,target.id)?.work_badges||[];
  function setBadgeForm(item,{kind='genotyping',type,id,...entry}={}){
    const targets=badgeTargets(item,kind),target=targets.find(row=>row.type===type&&row.id===String(id))||targets[0];
    const current=target?targetBadges(target).find(row=>row.kind===kind):null;
    badgeForm={kind,target:target?badgeTargetKey(target):'',status:'open',note:'',assignee:'',due_date:'',label:'',...(current||{}),...entry};
  }
  function badgeButton(entry,key){
    const entryKey=JSON.stringify([key,entry.type,entry.id,entry.kind]);badgeEntries.set(entryKey,entry);
    const label=entry.displayLabel||entry.label||badgeLabel(entry),title=[label,entry.mouseSids?.length?entry.mouseSids.map(id=>viewRecord('mice',id)?.physical_tag||id).join(', '):'',entry.note,entry.assignee,entry.due_date,badgeStatusLabel(entry.status)].filter(Boolean).join(' · ');
    return `<button type="button" class="sheet-work-badge ${['pir','led'].includes(entry.kind)?'sheet-work-fault':'sheet-work-task'}" data-sheet-badge-edit="${esc(entryKey)}" data-sheet-badge-item="${esc(key)}" title="${esc(title)}" aria-label="${esc(label+' for '+badgeItems.get(key)?.positionName)}">${esc(label)}</button>`;
  }
  function workBadgeStrip(item){
    if(hooks.readOnly)return '';
    const key=itemKey(item);badgeItems.set(key,item);
    const entries=cageBadgesForItem(badgeIndex,item,cageRows(item)).sort((a,b)=>Number(['pir','led'].includes(b.kind))-Number(['pir','led'].includes(a.kind)));
    if(!entries.length)return '';
    const groups=new Map();for(const entry of entries){const groupKey=entry.kind==='other'?entry.kind+':'+entry.label:entry.kind,group=groups.get(groupKey)||[];group.push(entry);groups.set(groupKey,group);}
    const badges=[...groups.values()];
    return `<div class="sheet-work-badges" aria-label="Tasks and equipment faults">${badges.slice(0,2).map(group=>group.length===1?badgeButton(group[0],key):`<button type="button" class="sheet-work-badge sheet-work-task" data-sheet-badges="${esc(key)}" title="${esc(group.map(entry=>[entry.label,...(entry.mouseSids||[]).map(id=>viewRecord('mice',id)?.physical_tag||id),entry.note].filter(Boolean).join(' · ')).join('\n'))}">${esc(group[0].label)} ×${group.length}</button>`).join('')}${badges.length>2?`<button type="button" class="sheet-work-more" data-sheet-badges="${esc(key)}" title="${esc(badges.slice(2).map(group=>group[0].label).join(', '))}">+${badges.length-2}</button>`:''}</div>`;
  }
  function badgeEditor(item){
    const key=itemKey(item);if(badgePanelKey!==key||!badgeForm)return '';
    const targets=badgeTargets(item,badgeForm.kind),target=targets.find(row=>badgeTargetKey(row)===badgeForm.target),editable=canEditBadgeTarget(target);
    const uniqueTargets=new Map(BADGE_TYPES.flatMap(row=>badgeTargets(item,row.kind)).map(target=>[badgeTargetKey(target),target]));
    const existing=[...uniqueTargets.values()].flatMap(target=>targetBadges(target).map(row=>({...row,...target,displayLabel:badgeLabel(row)+' · '+target.name+' · '+badgeStatusLabel(row.status)})));
    const suggestions=cageNoteBadgesForItem(badgeIndex,item,cageRows(item),{includeDone:true}),derived=[...new Map([...suggestions,...cageBadgesForItem(badgeIndex,item,cageRows(item)).filter(row=>row.derived)].filter(row=>!existing.some(saved=>saved.type===row.type&&saved.id===row.id&&saved.kind===row.kind)).map(row=>[JSON.stringify([row.type,row.id,row.kind]),{...row,displayLabel:[row.label,row.name||(row.type==='locations'?'Equipment':row.derived?row.note:''),badgeStatusLabel(row.status)].filter(Boolean).join(' · ')}])).values()];
    const disabled=editable?'':' disabled',attrs='data-sheet-badge-field';
    return `<section class="sheet-badge-editor" aria-label="Badges for ${esc(item.positionName)}"><div class="sheet-badge-editor-head"><strong>Badges</strong><button type="button" class="text-button" data-sheet-badge-close aria-label="Close badges">×</button></div>${existing.length||derived.length?`<div class="sheet-badge-records">${[...existing,...derived].map(entry=>badgeButton(entry,key)).join('')}</div>`:''}<label>Badge<select ${attrs}="kind">${BADGE_TYPES.map(row=>`<option value="${esc(row.kind)}"${row.kind===badgeForm.kind?' selected':''}>${esc(row.label)}</option>`).join('')}</select></label><label>For<select ${attrs}="target"${targets.length?'':' disabled'}>${targets.map(row=>`<option value="${esc(badgeTargetKey(row))}"${badgeTargetKey(row)===badgeForm.target?' selected':''}>${esc(row.name)}</option>`).join('')}</select></label>${!targets.length?'<p>Link a mouse or register the cage first.</p>':''}${badgeForm.kind==='other'?`<label>Label<input ${attrs}="label" maxlength="40" value="${esc(badgeForm.label||'')}"${disabled}></label>`:''}<label>Status<select ${attrs}="status"${disabled}>${WORK_BADGE_STATUSES.map(status=>`<option value="${status}"${status===badgeForm.status?' selected':''}>${badgeStatusLabel(status)}</option>`).join('')}</select></label><label>Who<input ${attrs}="assignee" list="sheet-badge-members" maxlength="160" value="${esc(badgeForm.assignee||'')}"${disabled}></label><datalist id="sheet-badge-members">${managers.map(row=>`<option value="${esc(row.name||row.full_name||'')}"></option>`).join('')}</datalist><label>Due<input ${attrs}="due_date" type="date" value="${esc(badgeForm.due_date||'')}"${disabled}></label><label>Note<textarea ${attrs}="note" maxlength="600" rows="2"${disabled}>${esc(badgeForm.note||'')}</textarea></label>${editable?'<button type="button" class="text-button sheet-badge-apply" data-sheet-badge-apply title="Add badge to pending changes">Apply to changes</button>':''}</section>`;
  }
  function manageBadgeButton(item){const key=itemKey(item);badgeItems.set(key,item);return hooks.readOnly?'':`<button type="button" class="text-button sheet-manage-badges" data-sheet-badges="${esc(key)}" title="Tasks and equipment faults" aria-label="Badges for ${esc(item.positionName)}">⚑ Badges</button>`;}
  function cageDetails(item){
    const cage=item.cage,id=item.cageId,positionId=item.position?.location_id,realCage=cage&&!cage._derived;
    const choices=item.withdrawnPosition?[...positionOptions,[String(item.withdrawnPosition.location_id),`${item.withdrawnPosition.label||item.withdrawnPosition.location_id} (withdrawn)`,true]]:positionOptions;
    return `<div class="sheet-cage-meta">${!hooks.readOnly&&!cage&&positionId?`<label class="sheet-wide">Link cage<select data-sheet-link="${esc(positionId)}" aria-label="Link cage to ${esc(item.positionName)}"${canEdit('cages')?'':' disabled'}><option value="">Choose a registered cage…</option>${cageChoices.map(c=>`<option value="${esc(c.cage_sid)}"${val('cages',c.cage_sid,'location_id')===positionId?' selected':''}>${esc(c.cage_tag||c.cage_sid)} · SID ${esc(c.cage_sid)}</option>`).join('')}</select></label>`:''}${realCage?`<label>Cage${input('cages',id,'cage_tag','Cage tag '+id)}</label><label class="sheet-wide">Position${input('cages',id,'location_id','Cage position '+id,{choices})}</label><label>Type${input('cages',id,'cage_type','Cage type '+id)}</label><label>IACUC${input('cages',id,'cage_protocol','Cage IACUC '+id)}</label>`:''}</div>`;
  }
  function wireLazyPanels(root=host){
    for(const details of root.querySelectorAll?.('[data-sheet-entrainment-panel]')||[])details.ontoggle=()=>{
      const target=details.dataset.sheetEntrainmentPanel,key='entrainment:'+target;if(details.open)state.expandedDetails.add(key);else state.expandedDetails.delete(key);
      const body=details.querySelector?.('[data-sheet-entrainment-body]'),item=entrainmentTargets.get(target);
      if(details.open&&body&&item&&body.dataset.loaded!=='true'){body.innerHTML=entrainmentFields(item,cageEntrainment(item));body.dataset.loaded='true';}
    };
    for(const details of root.querySelectorAll?.('[data-sheet-cage-details]')||[])details.ontoggle=()=>{
      const key=details.dataset.sheetCageDetails;if(details.open)state.expandedDetails.add(key);else state.expandedDetails.delete(key);
      const body=details.querySelector?.('[data-sheet-cage-detail-body]'),item=detailTargets.get(key);
      if(details.open&&body&&item&&body.dataset.loaded!=='true'){body.innerHTML=cageDetails(item);body.dataset.loaded='true';}
    };
    for(const details of root.querySelectorAll?.('[data-sheet-lazy-group]')||[])details.ontoggle=()=>{
      const key=details.dataset.sheetLazyGroup;if(details.open)state.expandedGroups.add(key);else state.expandedGroups.delete(key);
      const body=details.querySelector?.('[data-sheet-group-body]'),group=lazyGroups.get(key);
      if(details.open&&body&&group&&body.dataset.loaded!=='true'){body.innerHTML=rackHTML(group);body.dataset.loaded='true';wireLazyPanels(body);}
    };
  }
  function card(item){
    const cage=item.cage,id=item.cageId,position=item.position,positionId=position?.location_id;
    const rows=cageRows(item),workBadges=workBadgeStrip(item);
    if(rows.length)expandedEmptySlots.delete(positionId);
    const observations=cageCardObservation(viewDataset,item,observationContext).observation;
    const pending=[...state.drafts.values()].some(change=>change.type==='cages'&&String(change.id)===String(id)||change.type==='locations'&&String(change.id)===String(positionId));
    const occupancyWarning=item.warnings.some(message=>!/(?:light records?|light-record)/i.test(message));
    if(compact&&!hooks.readOnly&&positionId&&!rows.length&&!observations.animals.length&&!occupancyWarning&&!pending&&!expandedEmptySlots.has(positionId)){
      emptySlotTargets.set(positionId,item);
      const real=cage&&!cage._derived,editable=canEdit('cages')&&active(position)&&position.source_current!==false&&!historical(position);
      return `<div class="sheet-slot-frame sheet-vacant-frame" data-sheet-slot-frame="${esc(positionId)}" data-sheet-slot-label="${esc(item.positionName)}"><div class="sheet-slot-outline" aria-hidden="true"><span>${esc(item.positionName)}</span></div><article class="sheet-cage sheet-empty-slot" data-cage="${esc(id)}" data-sheet-slot="${esc(positionId)}"${real&&registeredCage(id)?` data-sheet-mouse-destination="${esc(id)}"`:''} aria-label="${esc(item.positionName)} empty position"><span class="sheet-empty-slot-number" aria-hidden="true">${esc(item.positionName)}</span><button type="button" class="sheet-empty-slot-add" data-sheet-activate-empty="${esc(positionId)}" aria-label="Add cage at ${esc(item.positionName)}" title="Add cage"${editable?'':' disabled'}>＋</button>${workBadges}${manageBadgeButton(item)}${badgeEditor(item)}${(state.selectedCage||state.selectedSlot)&&state.selectedSlot!==positionId?`<button type="button" class="text-button sheet-empty-slot-destination" data-sheet-destination="${esc(positionId)}"${canEdit('cages')?'':' disabled'}>↳ Move here</button>`:''}</article></div>`;
    }
    const breeding=cageLayout(item);
    const realCage=cage&&!cage._derived,moveStatus=slotStatus(item),movableCage=moveStatus.canMove;
    const occupied=realCage||cageRows(item).length>0,selected=positionId?state.selectedSlot===positionId:state.selectedCage===id;
    const dragAttrs=movableCage?`${positionId?` data-sheet-drag-slot="${esc(positionId)}"`:''}${realCage?` data-sheet-drag-cage="${esc(id)}"`:''}`:'';
    const printTarget=realCage?`data-sheet-label="${esc(id)}"`:positionId?`data-sheet-position-label="${esc(positionId)}"`:'';
    const printName=realCage?`cage ${cage.cage_tag||id}`:`position ${item.positionName}`;
    const printButton=!hooks.readOnly&&printTarget?`<button type="button" class="sheet-print-label" ${printTarget} title="${esc('Print label for '+printName)}" aria-label="${esc('Print label for '+printName)}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6zM17 12h1"/></svg><span>Label</span></button>`:'';
    const manager=realCage?(Object.hasOwn(cage,'manager')?cage.manager:item.manager?.name):position&&Object.hasOwn(position,'manager')?position.manager:observations.managerName||position?.source_manager_name||position?.source_manager_acronym||item.manager?.name;
    const managerType=realCage?'cages':'locations',managerId=realCage?id:positionId;
    const managerControl=hooks.readOnly||!managerId?`<span class="sheet-manager" title="Manager">${esc(cageManagerShortName(managers,manager))}</span>`:input(managerType,managerId,'manager','Manager for '+item.positionName,{fallback:manager||'',managerSelect:true,choices:buildCageManagerChoices(managers,manager)});
    const lux=observations.intensityLux;
    const entrainment=cageEntrainment(item);
    const summary=[startDateControl(item),lux!==null&&lux!==undefined?`<span class="sheet-light-intensity" title="Light intensity">${esc(lux)} lux</span>`:''].filter(Boolean).join('');
    const detailKey=itemKey(item),detailsOpen=state.expandedDetails.has(detailKey);detailTargets.set(detailKey,item);
    return `<div class="sheet-slot-frame${selected?' sheet-move-origin':''}" data-sheet-slot-frame="${esc(positionId||'')}" data-sheet-slot-label="${esc(item.positionName)}"><div class="sheet-slot-outline" aria-hidden="true"><span>${esc(item.positionName)}</span></div><article class="sheet-cage${breeding.isBreeding?' sheet-breeding':''}${compact?' sheet-compact':''}${realCage?'':' sheet-source'}${selected?' sheet-selected':''}" data-cage="${esc(id)}"${realCage&&registeredCage(id)?` data-sheet-mouse-destination="${esc(id)}"`:""} data-sheet-slot="${esc(positionId||'')}" tabindex="0" aria-label="${esc(item.positionName)}${cage?' cage '+esc(id):' position'}"><header${movableCage?` draggable="true"${dragAttrs} class="sheet-cage-drag-region"`:""} title="${esc(moveStatus.reason)}"><div class="sheet-cage-heading">${movableCage?`<button type="button" class="text-button sheet-cage-handle" draggable="true"${dragAttrs}${positionId?` data-sheet-move-slot="${esc(positionId)}"`:""}${realCage?` data-sheet-move="${esc(id)}"`:""} aria-label="Move cage ${esc(item.positionName)}" title="Drag cage or choose a destination">⠿</button>`:""}<strong>${esc(item.positionName)}</strong>${printButton}<div class="sheet-cage-person"><div class="sheet-cage-badges">${breeding.isBreeding?'<span class="sheet-breeding-label">Breeding</span>':''}${specialLightBadges(entrainment)}</div>${managerControl}</div></div><div class="sheet-cage-summary">${summary}</div></header>
      ${workBadges}${badgeEditor(item)}${startDateEditor(item)}${compact?`<details class="sheet-edit-details" data-sheet-cage-details="${esc(detailKey)}"${detailsOpen?' open':''}><summary>Cage details</summary><div data-sheet-cage-detail-body data-loaded="${detailsOpen?'true':'false'}">${detailsOpen?cageDetails(item):''}</div></details>`:cageDetails(item)}
      ${compact?compactAnimals(item):detailedAnimals(item)}
      ${entrainmentEntry(item,entrainment)}
      ${cageNotes(item)}
      <footer>${manageBadgeButton(item)}${movableCage?`<button type="button" class="text-button" ${positionId?`data-sheet-move-slot="${esc(positionId)}"`:""}${realCage?` data-sheet-move="${esc(id)}"`:""} title="Select cage to move or swap">↔ Move</button>${realCage?`<button type="button" class="text-button" data-sheet-remove="${esc(id)}" title="Remove cage from rack; keep animal records">− Remove</button>`:""}`:canEdit('cages')&&occupied?`<button type="button" class="text-button" disabled title="${esc(moveStatus.reason)}">↔ Move</button>`:canEdit('cages')&&!realCage&&positionId?`<button type="button" class="text-button" data-sheet-new="${esc(positionId)}">＋ New cage</button>`:''}${(state.selectedCage||state.selectedSlot)&&positionId&&!selected?`<button type="button" class="text-button" data-sheet-destination="${esc(positionId)}">${occupied?'⇄ Swap here':'↳ Move here'}</button>`:''}${cage&&!hooks.readOnly?`<button type="button" class="text-button" data-sheet-open-cage="${esc(id)}">Animals ↗</button>`:''}</footer></article></div>`;
  }
  function compactAnimals(item){
    const layout=cageLayout(item),rows=layout.rows;
    return `<div class="sheet-compact-animals">${rows.map((row,index)=>{
      const key=JSON.stringify([item.locationId||item.cageId||'unassigned',row.key||row.mouseSid||row.tag,index]),mouseSid=row.mouseSid?String(row.mouseSid):null;
      const mouse=mouseSid?viewRecord('mice',mouseSid):null;
      const sourceCageSid=mouse?.cage_sid??null;
      const sourcePosition=item.position,sourceMatch=row.matchStatus==='matched'?{locationId:row.locationId,tag:row.sourceTag||row.tag,sourceCell:row.sourceCell}:null;
      let draggable=false;
      if(mouse&&canMoveMice()&&active(mouse)&&mouse.state==='Stock'&&!mouse.history_read_only&&!mouse.source_historical&&['matched','registered'].includes(row.matchStatus)){
        if(sourceMatch&&sourcePosition&&active(sourcePosition)&&sourcePosition.source_current!==false&&!sourcePosition.history_read_only&&!sourcePosition.source_historical)draggable=true;
        else if(item.cage&&!item.cage._derived&&String(item.cageId)===String(sourceCageSid)&&registeredCage(sourceCageSid)&&!historical(mouse)&&!mouse._derived){const p=item.position;draggable=p?!housingMoveReason(p,item.cage):!movementIntegrityError&&(!item.cage.room_id||active(viewRecord('rooms',item.cage.room_id))&&!historical(viewRecord('rooms',item.cage.room_id)))&&(!item.cage.rack_id||active(viewRecord('racks',item.cage.rack_id))&&!historical(viewRecord('racks',item.cage.rack_id))&&String(viewRecord('racks',item.cage.rack_id)?.room_id)===String(item.cage.room_id));}
      }
      animalRows.set(key,{...row,mouseSid,sourceCageSid,sourceMatch,draggable});
      const weeks=ageWeeks(row.dateOfBirth,asOf),editable=mouseSid&&canEdit('mice'),note=String(row.note||'').trim(),color=note?noteColor(mouse?.note_color):'none';
      const noteEditable=editable&&active(mouse)&&!mouse.history_read_only&&!mouse.source_historical&&['matched','registered'].includes(row.matchStatus);
      const unavailable=hooks.readOnly?'Historical view':!mouseSid?(row.matchStatus==='ambiguous'?'Multiple mouse matches; editing unavailable.':'Mouse record not linked; editing unavailable.'):'';
      const attrs=`data-sheet-animal="${esc(key)}"`,openable=mouseSid&&active(mouse)&&!hooks.readOnly&&!mouse.history_read_only&&!mouse.source_historical&&['matched','registered'].includes(row.matchStatus);
      return `${layout.isBreeding&&layout.parentCount>0&&index===layout.parentCount?'<div class="sheet-parent-separator" role="separator" aria-label="Parents and offspring"></div>':''}<div class="sheet-compact-mouse" data-sheet-animal-row="${esc(key)}"><div class="sheet-animal-line"><button type="button" class="sheet-animal-tag sheet-animal-badge" ${attrs}${openable?` data-sheet-open-mouse="${esc(mouseSid)}" aria-label="Open ${esc(row.tag||mouseSid)} in Mice"`:""}${draggable?` draggable="true" data-sheet-drag-mouse="${esc(key)}"`:""} title="${esc([note,unavailable].filter(Boolean).join(' · ')||'Open mouse details')}"${openable?'':' disabled'}>${esc(row.tag||mouseSid||'—')}</button><button type="button" class="sheet-note-light sheet-note-${color}" ${attrs} data-sheet-edit-animal="note" title="${esc(note||'No note')}" aria-label="${noteEditable?'Edit':'View'} note for ${esc(row.tag||mouseSid||'mouse')} · ${color==='none'?'light off':color}"><span aria-hidden="true"></span></button><button type="button" class="sheet-animal-ear text-button" ${attrs} data-sheet-edit-animal="ear" title="${esc(editable?'Edit left / right earmark':unavailable||row.earMark||'Ear mark not recorded')}"${editable?'':' disabled'}>${esc(row.earMark||'—')}</button><button type="button" class="sheet-animal-age text-button" ${attrs} data-sheet-edit-animal="dob" title="${esc(row.dateOfBirth?'DOB '+row.dateOfBirth:'DOB not recorded')}"${editable?'':' disabled'}>${weeks===null?'—':weeks+'wk'}</button></div><div class="sheet-animal-editor" data-sheet-inline-editor="${esc(key)}" hidden></div></div>`;
    }).join('')}${layout.isBreeding&&layout.parentCount>0&&layout.parentCount===rows.length?'<div class="sheet-parent-separator" role="separator" aria-label="Parents and offspring"></div>':''}${emptyMouseRows(item,rows.length)}${hooks.readOnly&&!rows.length?'<div class="sheet-empty">Occupancy unknown</div>':''}${newMouseActions(item)}</div>`;
  }
  function detailedAnimals(item){
    const layout=cageLayout(item),rows=layout.rows;
    const separator='<tr class="sheet-parent-separator"><td colspan="6"><span class="sr-only">Parents and offspring</span></td></tr>';
    return `<div class="table-scroll"><table class="sheet-mice"><thead><tr><th>Animal</th><th>Sex</th><th>Born</th><th>Genotype</th><th>Ear</th><th>User</th></tr></thead><tbody>${rows.map((row,index)=>{
      const m=row.mouseSid?viewRecord('mice',row.mouseSid):null;
      const parentEnd=layout.isBreeding&&layout.parentCount>0&&index===layout.parentCount?separator:'';
      if(!m)return `${parentEnd}<tr><td>${esc(row.tag||'—')}</td><td>${esc(row.sex||'—')}</td><td>${esc(row.dateOfBirth||'—')}</td><td>—</td><td>${esc(row.earMark||'—')}</td><td>—</td></tr>`;
      return `${parentEnd}<tr><td>${hooks.readOnly?`<span>SID ${esc(m.mouse_sid)}</span>`:`<button type="button" class="text-button" data-sheet-open-mouse="${esc(m.mouse_sid)}">${esc(m.mouse_sid)} ↗</button>`}${input('mice',m.mouse_sid,'physical_tag','Animal tag '+m.mouse_sid)}</td><td>${input('mice',m.mouse_sid,'sex','Sex '+m.mouse_sid,{choices:[['Unknown','?'],['Male','♂'],['Female','♀']]})}</td><td>${input('mice',m.mouse_sid,'date_of_birth','Birth date '+m.mouse_sid,{type:'date'})}</td><td>${input('mice',m.mouse_sid,'genotype','Genotype '+m.mouse_sid)}</td><td>${input('mice',m.mouse_sid,'ear_mark','Ear mark '+m.mouse_sid,{placeholder:'L0R1'})}</td><td>${input('mice',m.mouse_sid,'manager','Mouse manager '+m.mouse_sid,{fallback:mouseManager(m).name||''})}</td></tr>`;
    }).join('')}${layout.isBreeding&&layout.parentCount>0&&layout.parentCount===rows.length?separator:''}${emptyMouseRows(item,rows.length,{table:true})}${hooks.readOnly&&!rows.length?'<tr><td colspan="6" class="sheet-empty">No animal assignments recorded</td></tr>':''}</tbody></table></div>${newMouseActions(item)}`;
  }
  function editorNode(key){return [...(host.querySelectorAll?.('[data-sheet-inline-editor]')||[])].find(node=>node.dataset.sheetInlineEditor===key);}
  function updateDraftControls(){
    const syncButton=host.querySelector('#cage-sheet-sync');if(syncButton){syncButton.disabled=state.saving||importing||!hasCageSheetDrafts();syncButton.querySelector('span').textContent=state.saving?'Saving…':`Save to Mouse Data${state.drafts.size?' · '+state.drafts.size:''}`;}
    const discard=host.querySelector('#cage-sheet-discard');if(discard)discard.disabled=state.saving||importing||!hasCageSheetDrafts();
    const importButton=host.querySelector('#cage-sheet-import');if(importButton){importButton.disabled=state.saving||importing||!!hasCageSheetDrafts()||!canImport();importButton.title=importTitle();}
    const status=host.querySelector('#cage-sheet-status');if(status){status.textContent=state.message|| (state.drafts.size?`${state.drafts.size} pending edits · not yet saved`:statusLabel);status.className=state.error?'alert error':'small muted';}
  }
  async function finishInlineEditor(){
    if(!inlineEditor||state.saving)return;
    if(inlineEditor.invalid){state.message=inlineEditor.invalid;state.error=true;updateDraftControls();return;}
    const ending=inlineEditor,node=editorNode(ending.key);inlineEditor=null;
    if(node){node.hidden=true;node.innerHTML='';}
    if(hasCageSheetDrafts()){state.message='Pending changes.';updateDraftControls();}
    return false;
  }
  async function openAnimalEditor(key,mode){
    if(state.saving||(hooks.readOnly&&mode!=='note'))return;
    if(inlineEditor){if(inlineEditor.key===key&&inlineEditor.mode===mode){await finishInlineEditor();return;}const saved=await finishInlineEditor();if(saved||inlineEditor||state.saving)return;}
    const row=animalRows.get(key),node=editorNode(key);if(!row||!node)return;
    const mouse=row.mouseSid?viewRecord('mice',row.mouseSid):null,editable=row.mouseSid&&canEdit('mice')&&active(mouse)&&!mouse.history_read_only&&!mouse.source_historical&&['matched','registered'].includes(row.matchStatus);
    if(!['note','ear','dob'].includes(mode)||(!editable&&mode!=='note'))return;
    inlineEditor={key,mode};
    const baseAttrs=`data-sheet-type="mice" data-sheet-id="${esc(row.mouseSid||'')}"`;
    let content='';
    if(mode==='note'){
      const note=state.drafts.has(draftKey('mice',row.mouseSid,'comment'))?val('mice',row.mouseSid,'comment'):row.note||'',color=noteColor(val('mice',row.mouseSid,'note_color'));
      content=editable?`<label class="sheet-note-editor-label">Note<textarea ${baseAttrs} data-sheet-field="comment" rows="3" aria-label="Note for ${esc(row.tag)}">${esc(note)}</textarea></label><label>Light<select ${baseAttrs} data-sheet-field="note_color" aria-label="Note light for ${esc(row.tag)}">${noteColors.map(value=>`<option value="${value}"${color===value?' selected':''}>${value[0].toUpperCase()+value.slice(1)}</option>`).join('')}</select></label>`:`<p class="sheet-readonly-note">${esc(note||'No note')}</p>`;
    }else if(mode==='ear'){
      const mark=String(state.drafts.has(draftKey('mice',row.mouseSid,'ear_mark'))?val('mice',row.mouseSid,'ear_mark'):row.earMark||''),parsed=mark.match(/^L(\d+)R(\d+)$/i);
      const pending=state.drafts.has(draftKey('mice',row.mouseSid,'ear_mark'));
      content=`${mark&&!parsed?`<p class="small">Current: ${esc(mark)}</p>`:''}<div class="sheet-ear-dials"><label>L<input type="number" inputmode="numeric" min="0" max="99" step="1" data-sheet-ear-side="L" data-sheet-ear-id="${esc(row.mouseSid)}" aria-label="Left ear holes for ${esc(row.tag)}" value="${parsed?esc(parsed[1]):''}"${pending?' class="sheet-pending"':''}></label><label>R<input type="number" inputmode="numeric" min="0" max="99" step="1" data-sheet-ear-side="R" data-sheet-ear-id="${esc(row.mouseSid)}" aria-label="Right ear holes for ${esc(row.tag)}" value="${parsed?esc(parsed[2]):''}"${pending?' class="sheet-pending"':''}></label></div>`;
    }else content=`<label>DOB<input ${baseAttrs} data-sheet-field="date_of_birth" type="date" max="${esc(todayTaipei())}" aria-label="Date of birth for ${esc(row.tag)}" value="${esc(state.drafts.has(draftKey('mice',row.mouseSid,'date_of_birth'))?val('mice',row.mouseSid,'date_of_birth'):row.dateOfBirth||'')}"></label>`;
    node.innerHTML=content+'<button type="button" class="text-button sheet-editor-done" data-sheet-editor-done="true">Done</button>';node.hidden=false;
    node.querySelector?.('textarea,input,select,button')?.focus?.();
  }
  function rackHTML(group){
    if(!compact)return `<div class="sheet-rack">${group.items.map(card).join('')}</div>`;
    const placed=group.items.filter(i=>Number.isFinite(i.row)&&Number.isFinite(i.column)),unplaced=group.items.filter(i=>!Number.isFinite(i.row)||!Number.isFinite(i.column));
    const columns=[...new Set(placed.map(i=>i.column))].sort((a,b)=>a-b),rows=[...new Set(placed.map(i=>i.row))].sort((a,b)=>a-b),slots=new Map();
    for(const item of placed){const key=JSON.stringify([item.row,item.column]);if(!slots.has(key))slots.set(key,[]);slots.get(key).push(item);}
    return `${placed.length?`<div class="sheet-physical-scroll"><div class="sheet-physical-rack" style="grid-template-columns:repeat(${columns.length},174px)">${rows.flatMap(row=>columns.map(column=>{const entries=slots.get(JSON.stringify([row,column]));return entries?`<div class="sheet-physical-slot">${entries.map(card).join('')}</div>`:'<div class="sheet-unregistered" aria-label="No registered position"></div>'})).join('')}</div></div>`:''}${unplaced.length?`<div class="sheet-rack sheet-unpositioned">${unplaced.map(card).join('')}</div>`:''}`;
  }
  function stage(plan){
    for(const change of plan.changes){const key=draftKey(change.type,change.id,change.field),base=state.drafts.has(key)?state.drafts.get(key).base:['$locobox','$equipment_badges','$source_badges'].includes(change.field)?change.base:(record(dataset,change.type,change.id)||state.drafts.get(draftKey(change.type,change.id,'$create'))?.value)?.[change.field]??null;if(equal(base,change.value))state.drafts.delete(key);else{const prior=state.drafts.get(key),original=record(dataset,change.type,change.id);const mouseMove=change.mouseMove?{...change.mouseMove,sourceCageSid:base,identity:prior?.mouseMove?.identity||Object.fromEntries(['physical_tag','sex','date_of_birth'].map(field=>[field,original?.[field]??null]))}:null;state.drafts.set(key,{...change,base,...(mouseMove?{mouseMove}:{}),...(prior?.sourceMatch?{sourceMatch:prior.sourceMatch}:{}),...(prior?.sourceEntrainment?{sourceEntrainment:prior.sourceEntrainment}:{}),...(prior?.locoboxRead?{locoboxRead:prior.locoboxRead}:{})});}}
    for(const [key,draft] of state.drafts)if(draft.sourceFill===true&&!draft.wholeCageFill&&!state.drafts.has(draftKey('mice',draft.id,'cage_sid')))state.drafts.delete(key);
    pruneCreatedCages();state.selectedCage=null;state.selectedSlot=null;state.error=false;state.message=plan.summary+' Pending changes.';paint();
  }
  function pruneCreatedCages(){const view=preview();for(const [key,draft] of state.drafts){if(draft.type!=='cages'||draft.field!=='$create'||draft.sourceCage&&draft.cageSlotMove)continue;if(!(view.tables.mice||[]).some(m=>active(m)&&m.state==='Stock'&&String(m.cage_sid)===String(draft.id)))for(const [otherKey,other] of state.drafts)if(other.type==='cages'&&String(other.id)===String(draft.id))state.drafts.delete(otherKey);}}
  function move(destination,cageSid=state.selectedCage,options={}){try{if(!canMoveCage(cageSid))throw new Error('Assign the remaining animals before moving this whole cage.');if(!canEdit('cages'))throw new Error('Housing edit permission is required.');stage(planCageMove(viewDataset,cageSid,destination,options));}catch(error){state.message=error.message;state.error=true;paint();}}
  function moveSlot(destination,source=state.selectedSlot){try{stage(slotPlan(source,destination));}catch(error){state.message=error.message;state.error=true;paint();}}
  function mousePlan(destination,selection,positionId=null){
    if(!canMoveMice())throw new Error('Mouse and housing edit permission is required to move mice.');
    const options={sourceCageSid:selection.sourceCageSid,...(selection.sourceMatch?{sourceMatch:selection.sourceMatch}:{})};
    if(destination)return planMouseMove(viewDataset,selection.mouseSid,destination,options);
    if(!canEdit('cages'))throw new Error('Cage edit permission is required to use this position.');
    if(!state.newCageIds.has(positionId))state.newCageIds.set(positionId,'CAGE-'+crypto.randomUUID());
    return planMouseMoveToPosition(viewDataset,selection.mouseSid,positionId,{...options,cageSid:state.newCageIds.get(positionId)});
  }
  function moveMouse(destination,selection,positionId=null){
    try{
      if(!canMoveMice()||!selection)throw new Error('Mouse and housing edit permission is required to move mice.');
      const plan=mousePlan(destination,selection,positionId);
      if(selection.sourceMatch)for(const change of plan.changes)if(change.type==='mice')change.sourceMatch=selection.sourceMatch;
      stage(plan);
    }catch(error){state.message=error.message;state.error=true;paint();}
  }
  function paint(){
    inlineEditor=null;dragPlans.clear();animalRows.clear();movableSlots.clear();newMouseTargets.clear();startDateTargets.clear();detailTargets.clear();entrainmentTargets.clear();lazyGroups.clear();emptySlotTargets.clear();badgeItems.clear();badgeEntries.clear();viewDataset=preview();if(prepareReadContext()){cageRowsCache.clear();cageLayoutCache.clear();cageStartCache.clear();projection=projectAnimalSheet(viewDataset,{entityTypes:[],...captureOptions});}
    const query=state.search.toLowerCase().trim();
    const groups=projection.groups.filter(g=>(!state.room||g.roomId===state.room)&&(!state.rack||g.rackId===state.rack)).map(g=>({...g,items:g.items.filter(item=>!query||JSON.stringify([g.roomName,g.rackName,item.positionName,item.cage,item.mice,item.position]).toLowerCase().includes(query))})).filter(g=>g.items.length);
    host.innerHTML=`<style>${styles}</style><section class="cage-sheet${hooks.readOnly?' sheet-historical':''}" aria-label="Animal Sheet cage view"><div class="toolbar sheet-toolbar"><input id="cage-sheet-search" type="search" class="search" aria-label="Find cages or animals" placeholder="Find cage, animal, genotype, manager…" value="${esc(state.search)}"><div class="filters">${select('cage-sheet-room','All rooms',rooms,state.room)}${select('cage-sheet-rack','All racks',racks,state.rack)}</div>${!hooks.readOnly?`<div class="sheet-transfer-actions"><button id="cage-sheet-sync" type="button" class="button primary"${state.saving||importing||!hasCageSheetDrafts()?' disabled':''} title="Cage edits → Mouse Data"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg><span>${state.saving?'Saving…':`Save to Mouse Data${state.drafts.size?' · '+state.drafts.size:''}`}</span></button>${canImport()?`<button id="cage-sheet-import" type="button" class="button secondary"${state.saving||importing||state.drafts.size?' disabled':''} title="${esc(importTitle())}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg><span>${importing?'Opening…':'Import from Animal sheet'}</span></button>`:''}</div><button type="button" class="button secondary" id="cage-sheet-discard"${!hasCageSheetDrafts()||state.saving||importing?' disabled':''}>Discard</button>`:''}${managersError?'<button type="button" class="text-button" id="cage-sheet-managers-retry">Reload manager list</button>':''}<button type="button" class="text-button" id="cage-sheet-help">Help</button></div>${state.selectedCage||state.selectedSlot?`<div class="sheet-move-notice">Moving cage ${esc(state.selectedSlot?viewRecord('locations',state.selectedSlot)?.label||state.selectedSlot:state.selectedCage)} · choose a destination in any room. <button type="button" class="text-button" id="cage-sheet-cancel-move">Cancel move</button></div>`:''}<p id="cage-sheet-status" class="${state.error?'alert error':'small muted'}" role="status">${esc(state.message|| (state.drafts.size?`${state.drafts.size} pending edits · not yet saved`:statusLabel))}</p>${groups.map(g=>{
      const title=`${g.roomName} / ${g.rackName}`;
      if(g.roomId||g.rackId)return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2><span>${g.items.length} cages / positions</span></div>${rackHTML(g)}</section>`;
      const key=JSON.stringify([g.roomId,g.rackId,g.roomName,g.rackName]),open=Boolean(query)||state.expandedGroups.has(key),lazy=g.items.length>12;lazyGroups.set(key,g);
      return `<details class="panel"${lazy?` data-sheet-lazy-group="${esc(key)}"`:''}${open?' open':''}><summary class="panel-head">${esc(title)} · ${g.items.length}</summary>${lazy?`<div data-sheet-group-body data-loaded="${open?'true':'false'}">${open?rackHTML(g):''}</div>`:rackHTML(g)}</details>`;
    }).join('')||'<div class="empty">No cages match.</div>'}</section>`;
    wireLazyPanels();
    if(host.querySelector('#cage-sheet-managers-retry'))host.querySelector('#cage-sheet-managers-retry').onclick=loadManagers;
    if(host.querySelector('#cage-sheet-sync'))host.querySelector('#cage-sheet-sync').onclick=sync;
    if(host.querySelector('#cage-sheet-import'))host.querySelector('#cage-sheet-import').onclick=importFromSheet;
    if(host.querySelector('#cage-sheet-cancel-move'))host.querySelector('#cage-sheet-cancel-move').onclick=()=>{state.selectedCage=null;state.selectedSlot=null;paint();};
    if(host.querySelector('#cage-sheet-discard'))host.querySelector('#cage-sheet-discard').onclick=async()=>{if(await hooks.confirm?.('Discard pending changes?')){state.drafts.clear();state.entrainmentForms.clear();state.selectedCage=null;state.selectedSlot=null;state.newCageIds.clear();state.message='Changes discarded.';state.error=false;paint();}};
    host.querySelector('#cage-sheet-help').onclick=()=>hooks.help?.();
    host.querySelector('#cage-sheet-room').onchange=e=>{state.room=e.target.value;state.rack='';renderCageSheet(host,dataset,hooks);};
    host.querySelector('#cage-sheet-rack').onchange=e=>{state.rack=e.target.value;paint();};
    host.querySelector('#cage-sheet-search').oninput=e=>{state.search=e.target.value;const caret=e.target.selectionStart;clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>{paint();const input=host.querySelector('#cage-sheet-search');input.focus();input.setSelectionRange(caret,caret);},180);};
  }
  async function importFromSheet(){
    if(renderToken!==renderSequence||!canImport()||state.saving||importing||hasCageSheetDrafts())return;
    const token=state.context;
    if(String(hooks.currentContext?.()||accountContext)!==accountContext)return;
    importing=true;paint();
    try{await hooks.importFromSheet();}
    catch(error){if(state.context===token&&renderToken===renderSequence){state.message=error.message||'Import failed.';state.error=true;}}
    finally{importing=false;if(state.context===token&&renderToken===renderSequence)paint();}
  }
  async function sync(){
    if(state.saving||importing||!hasCageSheetDrafts())return;
    const incomplete=[...state.entrainmentForms.values()].find(form=>form.dirty&&form.error);if(incomplete){state.message=incomplete.error;state.error=true;updateDraftControls();return;}
    if(inlineEditor?.invalid){state.message=inlineEditor.invalid;state.error=true;updateDraftControls();return;}
    const pending=[...state.drafts.values()],token=state.context;state.saving=true;state.message='Saving…';state.error=false;paint();
    try{
      const fresh=await hooks.loadFresh();
      if(state.context!==token||String(hooks.currentContext?.()||accountContext)!==accountContext)throw new Error('Account or colony changed. Reload this sheet.');
      if(pending.some(change=>change.field==='manager'&&!change.positionManager&&['cages','locations'].includes(change.type))&&typeof hooks.loadManagers==='function'){
        const latest=await hooks.loadManagers();if(state.context!==token||renderToken!==renderSequence||String(hooks.currentContext?.()||accountContext)!==accountContext)throw new Error('Account or colony changed. Reload this sheet.');managers=Array.isArray(latest)?latest:latest?.managers||[];
        for(const change of pending.filter(change=>change.field==='manager'&&!change.positionManager&&['cages','locations'].includes(change.type)&&change.value))if(!buildCageManagerChoices(managers,'').some(([value,,disabled])=>!disabled&&value===change.value))throw new Error('Selected manager is no longer in the manager list. Choose again.');
      }
      const next=applyCageSheetDrafts(fresh,pending,{canEdit:type=>hooks.canEdit?.(type)===true});
      await hooks.save(next,{readDependencies:[...getMouseMoveReadDependencies(fresh,pending),...cageStartReadDependencies(fresh,next),...cageEntrainmentReadDependencies(fresh,next,pending),...sourceBadgeReadDependencies(fresh,pending)]});
      if(state.context!==token)return;
      dataset=next;state.drafts.clear();state.entrainmentForms.clear();state.message='Changes saved.';state.saving=false;
      if(hooks.saved)hooks.saved(state.message);else paint();
    }catch(error){if(state.context===token){state.message=error.message||'Save failed. Your draft is kept.';state.error=true;state.saving=false;paint();}}
  }
  host.oninput=event=>{
    let t=event.target,{sheetType:type,sheetId:id,sheetField:field}=t.dataset||{},value;
    if(t.dataset?.sheetBadgeField){
      if(renderToken!==renderSequence||state.context!==context||String(hooks.currentContext?.()??accountContext)!==accountContext||!badgeForm)return;
      const name=t.dataset.sheetBadgeField,item=badgeItems.get(badgePanelKey);if(!item)return;
      if(name==='kind'){if(t.value!==badgeForm.kind){setBadgeForm(item,{kind:t.value});paint();}}
      else if(name==='target'){if(t.value!==badgeForm.target){const target=badgeTargets(item,badgeForm.kind).find(row=>badgeTargetKey(row)===t.value);if(target){setBadgeForm(item,{kind:badgeForm.kind,...target});paint();}}}
      else if(['status','note','assignee','due_date','label'].includes(name))badgeForm[name]=t.value;
      return;
    }
    const linking=t.dataset.sheetLink;
    if(linking){if(t.value&&canEdit('cages'))move(linking,t.value,{linkSourcePosition:true});return;}
    if(t.dataset.sheetEarSide){
      id=t.dataset.sheetEarId;type='mice';field='ear_mark';if(!canEdit(type))return;
      const node=inlineEditor&&editorNode(inlineEditor.key),left=node?.querySelector('[data-sheet-ear-side="L"]')?.value,right=node?.querySelector('[data-sheet-ear-side="R"]')?.value;
      if(!/^\d+$/.test(left??'')||!/^\d+$/.test(right??'')||Number(left)>99||Number(right)>99){if(inlineEditor)inlineEditor.invalid='Enter left and right hole counts from 0 to 99.';return;}
      value=`L${Number(left)}R${Number(right)}`;
    }
    if(!field||!canEdit(type)||(type==='cages'&&state.drafts.has(draftKey(type,id,'$create'))))return;
    if(type==='cages'&&field==='location_id'){move(t.value||null,id);return;}
    if(field==='manager'&&['cages','locations'].includes(type)){
      if(managersLoading||managersError)return;
      value=t.value.trim();
      if(value&&!buildCageManagerChoices(managers,'').some(([name,,disabled])=>!disabled&&name===value))return;
    }else value??=t.value.trim()||null;
    if(field==='note_color'&&!noteColors.includes(value)){state.message='Choose None, Green or Red for the note light.';if(inlineEditor)inlineEditor.invalid=state.message;state.error=true;updateDraftControls();return;}
    if(field==='date_of_birth'&&value&&value>todayTaipei()){state.message='DOB cannot be in the future.';if(inlineEditor)inlineEditor.invalid=state.message;state.error=true;updateDraftControls();return;}
    if(inlineEditor)inlineEditor.invalid=null;
    const key=draftKey(type,id,field),original=state.drafts.has(key)?state.drafts.get(key).base:record(dataset,type,id)?.[field];
    const row=inlineEditor?animalRows.get(inlineEditor.key):null,sourceMatch=row?.matchStatus==='matched'?{locationId:row.locationId,tag:row.sourceTag||row.tag,sourceCell:row.sourceCell}:null;
    const overrideSource=Boolean(sourceMatch&&['comment','ear_mark','date_of_birth'].includes(field)&&currentOverrides(record(dataset,type,id))[field]!==true);
    if(equal(original,value)&&!overrideSource)state.drafts.delete(key);else state.drafts.set(key,{type,id,field,base:original??null,value,...(sourceMatch?{sourceMatch}:{}),...(overrideSource?{overrideSource:true}:{})});
    t.classList.toggle('sheet-pending',state.drafts.has(key));state.message='';state.error=false;updateDraftControls();
  };
  host.onchange=event=>{const input=event.target;
    if(input.dataset?.sheetBadgeField){host.oninput(event);return;}
    if(input.dataset?.sheetEntrainment){
      if(renderToken!==renderSequence||state.context!==context||String(hooks.currentContext?.()??accountContext)!==accountContext)return;
      const key=input.dataset.sheetEntrainmentKey,item=entrainmentTargets.get(key);if(!item||!canEditStart(item))return;
      if(exchangePending())return;const form=entrainmentForm(item,cageEntrainment(item)),index=Number(input.dataset.sheetEntrainmentRow||0);if(!form.rows[index])return;form.rows[index][input.dataset.sheetEntrainment]=input.value;form.dirty=true;state.expandedDetails.add('entrainment:'+key);stageEntrainmentRows(item);return;
    }
    if(!input.dataset?.sheetStartInput)return;if(input.validity?.badInput||input.validity?.valid===false){state.message='Choose a valid start date.';state.error=true;updateDraftControls();return;}editStartDate(input.dataset.sheetStartInput,input.value||null);};
  host.onfocusout=event=>{
    if(!inlineEditor)return;
    const node=editorNode(inlineEditor.key);if(!node?.contains?.(event.target)||node.contains(event.relatedTarget))return;
    // Defer until click handlers have opened another control or finished this editor.
    const current=inlineEditor;setTimeout(()=>{if(inlineEditor===current&&!node.contains(globalThis.document?.activeElement))finishInlineEditor();},0);
  };
  host.onclick=async event=>{
    const entrainmentCommand=event.target.closest('[data-sheet-entrainment-action]');
    if(entrainmentCommand){
      if(renderToken!==renderSequence||state.context!==context||String(hooks.currentContext?.()??accountContext)!==accountContext||exchangePending())return;
      const key=entrainmentCommand.dataset.sheetEntrainmentKey,item=entrainmentTargets.get(key);if(!item||!canEditStart(item))return;event.preventDefault?.();
      const form=entrainmentForm(item,cageEntrainment(item)),action=entrainmentCommand.dataset.sheetEntrainmentAction;state.expandedDetails.add('entrainment:'+key);
      try{
        if(action==='add'){if(form.rows.length<100){form.rows.push({date:'',scheme:'LD'});form.dirty=true;form.error='Each entrainment row needs a valid, different date and condition.';paint();}return;}
        if(action==='remove'){if(form.rows.length>1){form.rows.splice(Number(entrainmentCommand.dataset.sheetEntrainmentRow),1);form.dirty=true;stageEntrainmentRows(item);}return;}
        if(!entrainmentContext(item).cageSid)throw new Error('Link or register this cage to exchange with LocoBox.');
        if(action==='load'){
          const plan=loadCageEntrainmentFromLocobox(viewDataset,entrainmentContext(item));if(form.dirty&&!await hooks.confirm?.('Replace the displayed entrainment rows with the LocoBox schedule?'))return;
          form.rows=structuredClone(plan.changes[0]?.value.entries||cageEntrainmentRows(viewDataset,item,cageEntrainment(item)));form.dirty=true;form.error='';stage({...plan,summary:'Loaded from LocoBox.'});return;
        }
        if(action==='save'){
          let plan;try{plan=planCageEntrainmentToLocobox(viewDataset,entrainmentContext(item),form.rows);}catch(error){if(!error.confirmLocoboxReplacement)throw error;if(!await hooks.confirm?.('Replace the LocoBox date-condition schedule with these rows?'))return;plan=planCageEntrainmentToLocobox(viewDataset,entrainmentContext(item),form.rows,{replace:true});}
          if(!plan.changes.length){state.message='LocoBox schedule is up to date.';state.error=false;updateDraftControls();return;}stage({...plan,summary:'Schedule staged for LocoBox.'});return;
        }
      }catch(error){state.message=error.message||'Schedule exchange failed.';state.error=true;updateDraftControls();}return;
    }
    if(event.target.closest('[data-sheet-open-mouse]')&&(drag||Date.now()<suppressMouseClickUntil)){event.preventDefault?.();return;}
    const editButton=event.target.closest('[data-sheet-edit-animal]');
    if(editButton)return openAnimalEditor(editButton.dataset.sheetAnimal,editButton.dataset.sheetEditAnimal);
    if(event.target.closest('[data-sheet-editor-done]')){await finishInlineEditor();if(!inlineEditor)paint();return;}
    if(inlineEditor){const node=editorNode(inlineEditor.key);if(node&&!node.contains(event.target)){const saved=await finishInlineEditor();if(saved||inlineEditor)return;}}
    const badgeCommand=event.target.closest('[data-sheet-badges],[data-sheet-badge-edit],[data-sheet-badge-apply],[data-sheet-badge-close]');
    if(badgeCommand){
      if(renderToken!==renderSequence||state.context!==context||String(hooks.currentContext?.()??accountContext)!==accountContext||hooks.readOnly||state.saving)return;
      event.preventDefault?.();
      if(badgeCommand.hasAttribute('data-sheet-badge-close')){badgePanelKey=null;badgeForm=null;paint();return;}
      if(badgeCommand.hasAttribute('data-sheet-badge-apply')){
        const item=badgeItems.get(badgePanelKey),target=item&&badgeTargets(item,badgeForm?.kind).find(row=>badgeTargetKey(row)===badgeForm?.target);
        if(!canEditBadgeTarget(target))return;
        try{const plan=planWorkBadgeEdit(viewDataset,target,{kind:badgeForm.kind,...(badgeForm.kind==='other'?{label:badgeForm.label}:{}),status:badgeForm.status,note:badgeForm.note,assignee:badgeForm.assignee,due_date:badgeForm.due_date||null});badgePanelKey=null;badgeForm=null;stage(plan);}catch(error){state.message=error.message;state.error=true;updateDraftControls();}
        return;
      }
      const entry=badgeEntries.get(badgeCommand.dataset.sheetBadgeEdit);
      if(entry?.derived){if(hasCageSheetDrafts()){state.message='Save or discard changes before opening the experiment.';state.error=false;updateDraftControls();}else hooks.openExperiment?.(entry.experimentId);return;}
      const key=badgeCommand.dataset.sheetBadges||badgeCommand.dataset.sheetBadgeItem,item=badgeItems.get(key);if(!item)return;
      badgePanelKey=key;setBadgeForm(item,entry||{kind:badgeTargets(item,'genotyping').length?'genotyping':'pir'});paint();return;
    }
    const startCommand=event.target.closest('[data-sheet-edit-start],[data-sheet-clear-start],[data-sheet-close-start]');
    if(startCommand){
      if(renderToken!==renderSequence||state.context!==context||String(hooks.currentContext?.()??accountContext)!==accountContext)return;
      const key=startCommand.dataset.sheetEditStart||startCommand.dataset.sheetClearStart||startCommand.dataset.sheetCloseStart,item=startDateTargets.get(key);if(!item||!canEditStart(item))return;
      if(startCommand.dataset.sheetClearStart)editStartDate(key,null);else{startEditorKey=startCommand.dataset.sheetCloseStart?null:startEditorKey===key?null:key;paint();if(startEditorKey)[...(host.querySelectorAll?.('[data-sheet-start-input]')||[])].find(input=>input.dataset.sheetStartInput===key)?.focus?.();}
      return;
    }
    const emptySlot=event.target.closest('[data-sheet-activate-empty]');
    if(emptySlot){
      event.preventDefault?.();
      if(renderToken!==renderSequence||state.context!==context||String(hooks.currentContext?.()??accountContext)!==accountContext||!canEdit('cages'))return;
      const id=emptySlot.dataset.sheetActivateEmpty,item=emptySlotTargets.get(id);if(!item||!active(item.position)||item.position.source_current===false||historical(item.position))return;
      if(hasCageSheetDrafts()){state.message='Save or discard pending edits before adding a cage.';state.error=false;updateDraftControls();return;}
      expandedEmptySlots.add(id);paint();
      if(!item.cage&&typeof hooks.newCage==='function')hooks.newCage(id);
      return;
    }
    const rowCommand=event.target.closest('[data-sheet-rows-add],[data-sheet-rows-remove]');
    if(rowCommand){
      if(renderToken!==renderSequence||state.context!==context||String(hooks.currentContext?.()??accountContext)!==accountContext)return;
      const key=rowCommand.dataset.sheetRowsAdd||rowCommand.dataset.sheetRowsRemove,item=newMouseTargets.get(key);if(!item||!mouseEntryTarget(item))return;
      const count=cageLayout(item).rows.length,current=mouseRowCount(item,count),next=rowCommand.dataset.sheetRowsAdd?current+1:Math.max(5,count,current-1);
      state.rowCounts.set(key,next);paint();return;
    }
    const addMouse=event.target.closest('[data-sheet-add-mouse]');
    if(addMouse){
      if(renderToken!==renderSequence||state.context!==context||String(hooks.currentContext?.()??accountContext)!==accountContext)return;
      const item=newMouseTargets.get(addMouse.dataset.sheetAddMouse),target=item&&mouseEntryTarget(item);if(!target)return;
      if(hasCageSheetDrafts()){state.message='Save or discard pending edits before adding a mouse.';state.error=false;updateDraftControls();return;}
      const newborn=addMouse.dataset.sheetNewborn==='true'&&cageLayout(item).isBreeding===true;
      creatingMouse=true;
      try{await hooks.newMouse({...target,newborn});}
      catch(error){if(renderToken===renderSequence&&state.context===context){state.message=error?.message||'Could not open mouse registration.';state.error=true;updateDraftControls();}}
      finally{creatingMouse=false;}
      return;
    }
    const command=event.target.closest('[data-sheet-move],[data-sheet-move-slot],[data-sheet-remove],[data-sheet-destination],[data-sheet-new]');
    if(command){if(!canEdit('cages'))return;const d=command.dataset;if(d.sheetMoveSlot){try{verifySlotSource(d.sheetMoveSlot);state.selectedSlot=d.sheetMoveSlot;state.selectedCage=null;paint();}catch(error){state.message=error.message;state.error=true;paint();}}else if(d.sheetMove){if(!canMoveCage(d.sheetMove))return;state.selectedCage=d.sheetMove;state.selectedSlot=null;paint();}else if(d.sheetRemove){try{stage(planCageRemoval(viewDataset,d.sheetRemove));}catch(error){state.message=error.message;state.error=true;paint();}}else if(d.sheetDestination){if(state.selectedSlot)moveSlot(d.sheetDestination);else move(d.sheetDestination);}else if(d.sheetNew){if(hasCageSheetDrafts()){state.message='Save or discard pending edits before creating a cage.';paint();}else hooks.newCage?.(d.sheetNew);}return;}
    if(!event.target.closest('button,input,select,textarea,a,summary,details,.sheet-animal-editor')&&!hooks.readOnly){const cage=event.target.closest('.sheet-cage');if(cage){if((state.selectedCage||state.selectedSlot)&&cage.dataset.sheetSlot){if(state.selectedSlot)moveSlot(cage.dataset.sheetSlot);else move(cage.dataset.sheetSlot);}else if(cage.dataset.sheetSlot){try{verifySlotSource(cage.dataset.sheetSlot);state.selectedSlot=cage.dataset.sheetSlot;state.selectedCage=null;paint();}catch(error){state.message=error.message;state.error=true;updateDraftControls();}}else if(canMoveCage(cage.dataset.cage)&&canEdit('cages')){state.selectedCage=cage.dataset.cage;state.selectedSlot=null;paint();}return;}}
    if(hooks.readOnly)return;
    const t=event.target.closest('[data-sheet-open-cage],[data-sheet-open-mouse],[data-sheet-label],[data-sheet-position-label],[data-sheet-locobox]');if(!t)return;
    if(t.hasAttribute('data-sheet-label')||t.hasAttribute('data-sheet-position-label')){
      if(hasCageSheetDrafts()){state.message='Save or discard pending edits before printing.';state.error=false;paint();return;}
      if(t.hasAttribute('data-sheet-label'))hooks.printLabel?.(t.dataset.sheetLabel);else hooks.printPositionLabel?.(t.dataset.sheetPositionLabel);
    }else if(t.hasAttribute('data-sheet-open-cage'))hooks.openCage?.(t.dataset.sheetOpenCage);else if(t.hasAttribute('data-sheet-open-mouse')){
      if(state.saving||importing)return;
      const mouse=viewRecord('mice',t.dataset.sheetOpenMouse),row=t.dataset.sheetAnimal?animalRows.get(t.dataset.sheetAnimal):null;
      if(!active(mouse)||mouse.history_read_only||mouse.source_historical||(t.dataset.sheetAnimal&&(!row||row.mouseSid!==String(mouse.mouse_sid)||!['matched','registered'].includes(row.matchStatus))))return;
      if(hasCageSheetDrafts()){state.message='Save or discard pending edits before opening the mouse.';state.error=false;updateDraftControls();return;}
      hooks.openMouse?.(String(mouse.mouse_sid));
    }else hooks.openLocobox?.(t.dataset.sheetLocobox||null,t.dataset.sheetPosition||null);};
  const dragSelector='[data-sheet-drag-mouse],[data-sheet-drag-slot],[data-sheet-drag-cage]';
  let pointerDrag=null;
  const dragContextCurrent=()=>renderToken===renderSequence&&state.context===context&&String(hooks.currentContext?.()??accountContext)===accountContext&&!hooks.readOnly&&!state.saving&&!importing&&!creatingMouse;
  function clearDragHighlight(){for(const node of host.querySelectorAll?.('.sheet-drop-target,.sheet-slot-destination')||[]){node.classList.remove('sheet-drop-target','sheet-slot-destination');if(node.dataset)delete node.dataset.sheetDropCue;}}
  function clearDragOrigin(){for(const node of host.querySelectorAll?.('.sheet-dragging,.sheet-drag-origin')||[])node.classList.remove('sheet-dragging','sheet-drag-origin');}
  function dragSelection(origin){
    const target=origin?.closest?.(dragSelector),control=origin?.closest?.('button,input,select,textarea,a,summary,details,.sheet-animal-editor');
    if(!target||!dragContextCurrent()||inlineEditor?.invalid||(control&&!control.dataset?.sheetDragMouse&&!control.dataset?.sheetDragCage&&!control.dataset?.sheetDragSlot))return null;
    if(target.dataset.sheetDragMouse){const row=animalRows.get(target.dataset.sheetDragMouse);return row?.draggable&&canMoveMice()?{kind:'mouse',row:{...row}}:null;}
    if(target.dataset.sheetDragSlot){verifySlotSource(target.dataset.sheetDragSlot);return {kind:'cage',positionId:target.dataset.sheetDragSlot};}
    return canMoveCage(target.dataset.sheetDragCage)&&canEdit('cages')?{kind:'cage',id:target.dataset.sheetDragCage}:null;
  }
  function showDragOrigin(origin,selection){
    if(selection.kind==='cage'){origin.closest('.sheet-cage')?.classList?.add('sheet-dragging');origin.closest('.sheet-slot-frame')?.classList?.add('sheet-drag-origin');}
  }
  function dropPlan(target,selection=drag){
    if(!selection||!dragContextCurrent())return null;
    const cage=target?.closest?.('.sheet-cage');if(!cage)return null;
    if(selection.kind==='mouse'){
      if(!canMoveMice()||(!cage.dataset.sheetMouseDestination&&!cage.dataset.sheetSlot))return null;
      mousePlan(cage.dataset.sheetMouseDestination,selection.row,cage.dataset.sheetSlot);
      return {kind:'mouse',destination:cage.dataset.sheetMouseDestination,positionId:cage.dataset.sheetSlot,cage};
    }
    if(!canEdit('cages')||!cage.dataset.sheetSlot)return null;
    const key=JSON.stringify([selection.id,selection.positionId,cage.dataset.sheetSlot]);
    if(!dragPlans.has(key)){try{dragPlans.set(key,selection.positionId?slotPlan(selection.positionId,cage.dataset.sheetSlot):planCageMove(viewDataset,selection.id,cage.dataset.sheetSlot));}catch(error){dragPlans.set(key,{error});}}
    const plan=dragPlans.get(key);if(plan.error)throw plan.error;
    if(plan.kind==='noop')return null;
    return {kind:'cage',destination:cage.dataset.sheetSlot,cage,cue:plan.kind==='swap'?'Swap':'Move'};
  }
  function highlightDrop(target){
    clearDragHighlight();const plan=dropPlan(target);if(!plan)return null;
    plan.cage.classList?.add('sheet-drop-target');
    if(plan.kind==='cage'){const frame=target.closest('.sheet-slot-frame');frame?.classList?.add('sheet-slot-destination');if(frame?.dataset)frame.dataset.sheetDropCue=plan.cue;}
    return plan;
  }
  function commitDrop(target,selection){
    try{const plan=dropPlan(target,selection);if(!plan)return;if(plan.kind==='mouse')moveMouse(plan.destination,selection.row,plan.positionId);else if(selection.positionId)moveSlot(plan.destination,selection.positionId);else move(plan.destination,selection.id);}
    catch(error){state.message=error.message;state.error=true;paint();}
  }
  function releasePointer(){
    const previous=pointerDrag;pointerDrag=null;
    try{if(previous?.capture?.hasPointerCapture?.(previous.id))previous.capture.releasePointerCapture(previous.id);}catch{}
  }
  function cancelDrag(){releasePointer();drag=null;dragPlans.clear();clearDragHighlight();clearDragOrigin();}
  const pointerStillCurrent=()=>pointerDrag&&dragContextCurrent()&&pointerDrag.capture?.isConnected!==false&&(!host.contains||host.contains(pointerDrag.capture));
  const pointerTarget=event=>{
    const target=host.ownerDocument?.elementFromPoint?.(event.clientX,event.clientY)||globalThis.document?.elementFromPoint?.(event.clientX,event.clientY);
    return target&&(!host.contains||host.contains(target))?target:null;
  };
  host.onpointerdown=event=>{
    if(pointerDrag||event.isPrimary===false||event.button!==undefined&&event.button!==0)return;
    let selection;try{selection=dragSelection(event.target);}catch(error){state.message=error.message;state.error=true;updateDraftControls();return;}
    if(!selection||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;
    cancelDrag();const capture=event.target.closest(dragSelector);
    pointerDrag={id:event.pointerId,capture,origin:event.target,startX:event.clientX,startY:event.clientY,selection,started:false};
    // Capture the badge/header, preserving its normal click when no drag starts.
    try{capture.setPointerCapture?.(event.pointerId);}catch{}
  };
  host.onpointermove=event=>{
    if(!pointerDrag||event.pointerId!==pointerDrag.id)return;
    if(!pointerStillCurrent()){cancelDrag();return;}
    if(!pointerDrag.started){
      if(Math.hypot(event.clientX-pointerDrag.startX,event.clientY-pointerDrag.startY)<6)return;
      let selection;try{selection=dragSelection(pointerDrag.origin);}catch(error){state.message=error.message;state.error=true;updateDraftControls();cancelDrag();return;}
      if(!selection){cancelDrag();return;}
      pointerDrag.started=true;drag=selection;finishInlineEditor();showDragOrigin(pointerDrag.origin,selection);
    }
    event.preventDefault?.();suppressMouseClickUntil=Date.now()+400;
    try{highlightDrop(pointerTarget(event));}catch{clearDragHighlight();}
  };
  host.onpointerup=event=>{
    if(!pointerDrag||event.pointerId!==pointerDrag.id)return;
    const started=pointerDrag.started,selection=drag,target=started&&pointerStillCurrent()?pointerTarget(event):null;
    if(started){event.preventDefault?.();suppressMouseClickUntil=Date.now()+400;}
    cancelDrag();if(started&&target)commitDrop(target,selection);
  };
  host.onpointercancel=event=>{if(pointerDrag&&event.pointerId===pointerDrag.id){if(pointerDrag.started)suppressMouseClickUntil=Date.now()+400;cancelDrag();}};
  host.onlostpointercapture=event=>{if(pointerDrag&&event.pointerId===pointerDrag.id){if(pointerDrag.started)suppressMouseClickUntil=Date.now()+400;cancelDrag();}};
  // Retain native HTML dragging for browsers without Pointer Events.
  host.ondragstart=event=>{
    if(pointerDrag){event.preventDefault();return;}
    drag=null;dragPlans.clear();clearDragOrigin();clearDragHighlight();
    try{drag=dragSelection(event.target);}catch(error){state.message=error.message;state.error=true;updateDraftControls();}
    if(!drag){event.preventDefault();return;}
    suppressMouseClickUntil=Date.now()+400;finishInlineEditor();showDragOrigin(event.target,drag);
    const cage=event.target.closest('.sheet-cage');
    if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-braintime-cage-move',drag.kind);if(drag.kind==='cage'&&cage&&event.dataTransfer.setDragImage)event.dataTransfer.setDragImage(cage,Math.min((cage.getBoundingClientRect?.().width||160)/2,80),20);}
  };
  host.ondragover=event=>{if(pointerDrag)return;try{if(!highlightDrop(event.target))return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';}catch{clearDragHighlight();}};
  host.ondragleave=event=>{if(!pointerDrag&&!host.contains?.(event.relatedTarget))clearDragHighlight();};
  host.ondrop=event=>{
    if(pointerDrag){event.preventDefault();return;}
    const selection=drag;if(selection){suppressMouseClickUntil=Date.now()+400;event.preventDefault();}cancelDrag();if(selection)commitDrop(event.target,selection);
  };
  host.ondragend=()=>{if(pointerDrag)return;suppressMouseClickUntil=Date.now()+400;cancelDrag();};
  const handleClick=host.onclick;
  host.onclick=event=>{if(event.target.closest(dragSelector)&&(drag||Date.now()<suppressMouseClickUntil)){event.preventDefault?.();return;}return handleClick(event);};
  host.onkeydown=event=>{if(event.key==='Escape'&&pointerDrag){event.preventDefault();if(pointerDrag.started)suppressMouseClickUntil=Date.now()+400;cancelDrag();return;}if(['Enter',' '].includes(event.key)&&event.target.matches('.sheet-cage')){event.preventDefault();event.target.click();}};
  async function loadManagers(){
    if(typeof hooks.loadManagers!=='function')return;
    managersLoading=true;managersError=false;paint();
    try{const result=await hooks.loadManagers();if(renderToken!==renderSequence||state.context!==context)return;managers=Array.isArray(result)?result:result?.managers||[];}
    catch{if(renderToken!==renderSequence||state.context!==context)return;managers=[];managersError=true;}
    finally{if(renderToken===renderSequence&&state.context===context){managersLoading=false;paint();}}
  }
  async function loadNoteHints(){
    try{
      const result=await hooks.loadNoteHints();
      if(renderToken!==renderSequence||state.context!==context||String(hooks.currentContext?.()||accountContext)!==accountContext)return;
      noteHints=Array.isArray(result)?result:[];noteHintsLoading=false;readDataset=null;
      // Do not replace fields while the user is typing. The next paint consumes
      // the hints after the inline or badge editor is closed.
      if(!inlineEditor&&!badgePanelKey)paint();
    }catch{noteHintsLoading=false;/* Current row notes and saved badges remain available offline. */}
  }
  paint();
  if(typeof hooks.loadManagers==='function'&&!hooks.readOnly)void loadManagers();
  if(typeof hooks.loadNoteHints==='function'&&!hooks.readOnly)void loadNoteHints();
}

export function cageSheetHelpHTML(){return '<p>Drag a verified mouse tag to a cage, or drag a cage header to move or swap positions. The faint outline and number mark the fixed rack slot. Choose <strong>Move</strong> on a cage to select its destination without dragging.</p><p>Click a mouse badge to open its Mice record and edit the tag or other details. Click the note light to read or edit a note and choose None, Green or Red. Click an earmark or age to edit ear holes or DOB. All edits wait for <strong>Save to Mouse Data</strong>; <strong>Discard</strong> cancels them. <strong>Import from Animal sheet</strong> brings sheet updates into Mouse Data. Individual mouse drags require a linked record. Unresolved entries stay with a moved cage. Historical views are read only. An unlinked destination creates a cage when saved.</p><p><strong>Badges</strong> records tasks for a cage or linked mouse, and PIR/LED faults for the fixed position. Apply to changes, then Save to Mouse Data. Done hides the badge; it can be reopened in Badges. Clear tasks and faults in current Animal Sheet notes appear automatically; saved decisions take precedence. Linked Experiment badges open the experiment. Equipment warnings do not change entrainment.</p><p><strong>Label</strong> opens the three card formats. Original Animal Sheet observations are preserved.</p>';}

const styles=`.sheet-cage-drag-region,[data-sheet-drag-mouse]{touch-action:none;-webkit-user-select:none;user-select:none}.sheet-cage-drag-region input,.sheet-cage-drag-region textarea{-webkit-user-select:text;user-select:text}.sheet-slot-frame{position:relative;min-width:0;height:100%}.sheet-slot-outline{position:absolute;inset:0;border:2px dashed #91a0ac;border-radius:6px;background:#f5f6f1d9;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;z-index:1;color:#697985;font-size:32px;font-weight:700}.sheet-drag-origin>.sheet-slot-outline,.sheet-slot-destination>.sheet-slot-outline,.sheet-move-origin>.sheet-slot-outline{opacity:1}.sheet-move-origin>.sheet-slot-outline{background:#f5f6f19c}.sheet-move-origin>.sheet-cage>header,.sheet-move-origin>.sheet-cage>footer,.sheet-move-origin .sheet-animal-editor{position:relative;z-index:2}.sheet-drag-origin>.sheet-cage{opacity:.15}.sheet-slot-destination>.sheet-slot-outline{border-color:#286ca6;background:#eef6fcbd}.sheet-slot-destination:after{content:attr(data-sheet-drop-cue);position:absolute;right:8px;top:8px;z-index:2;border-radius:4px;background:#286ca6;color:#fff;padding:3px 7px;font-size:11px}.sheet-cage-drag-region{cursor:grab}.sheet-cage-drag-region:active{cursor:grabbing}.sheet-cage-drag-region button,.sheet-cage-drag-region select,.sheet-cage-drag-region input{cursor:pointer}.sheet-cage .sheet-manager-select{width:auto;max-width:100%;flex:0 1 auto;min-width:50px;font-size:11px;font-weight:600;border:1px solid #a9b5bf;background:#fff;padding:2px 4px;min-height:28px}.sheet-compact .sheet-manager-select{font-size:10px;max-width:125px}@media(pointer:coarse){.sheet-cage .sheet-manager-select{min-height:36px}}.sheet-cage-handle{cursor:grab;flex-shrink:0;font-size:16px!important}.sheet-cage-handle:active,[data-sheet-drag-mouse]:active{cursor:grabbing}[data-sheet-drag-mouse]{cursor:grab}.sheet-cage-heading>strong{margin-right:auto}.sheet-drop-target{outline:3px solid #286ca6;outline-offset:-3px;background:#eef6fc}.sheet-dragging{opacity:.6}.sheet-compact .sheet-cage-summary{font-size:10px;gap:3px 6px;justify-content:flex-start}.sheet-cage-summary time{font-size:9px;white-space:nowrap}.sheet-manager{font-weight:600}.sheet-compact .sheet-animal-line{display:grid;grid-template-columns:minmax(0,1fr) 20px auto auto;gap:3px;align-items:center}.sheet-compact .sheet-animal-line>button{font-size:10px;line-height:1.35;padding:3px 0;min-height:24px}.sheet-compact .sheet-note-light{display:flex;align-items:center;justify-content:center;width:20px;min-width:20px;border:0;background:transparent;border-radius:4px;cursor:pointer}.sheet-note-light span{display:block;width:10px;height:10px;border:1px solid #7d8790;border-radius:50%;background:#fff}.sheet-note-green span{border-color:#256b3f;background:#3d9859;box-shadow:0 0 3px #3d985955}.sheet-note-red span{border-color:#923535;background:#ce4545;box-shadow:0 0 3px #ce454555}.sheet-note-light:hover{background:#edf2f6}.sheet-note-light:focus-visible{outline:2px solid #216aa0;outline-offset:1px}@media(pointer:coarse){.sheet-compact .sheet-animal-line>button{min-height:32px}.sheet-compact .sheet-animal-line{grid-template-columns:minmax(0,1fr) 26px auto auto}.sheet-compact .sheet-note-light{width:26px;min-width:26px}}.sheet-animal-editor .sheet-note-editor-label{display:block}.sheet-note-editor-label textarea{display:block;resize:vertical;min-height:60px}.sheet-animal-editor select{background:#fff;border-color:#9db6c8;max-width:100px}.sheet-compact .sheet-animal-tag{text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sheet-compact .sheet-animal-badge{display:block;width:100%;min-width:0;border:1px solid #bed0de;border-radius:4px;background:#eef5fa;color:#194f7a;padding:2px 4px;font:inherit;font-size:10px;font-weight:600;cursor:pointer}.sheet-compact .sheet-animal-badge:hover:not(:disabled){background:#dfeef8;border-color:#7199b7}.sheet-compact .sheet-animal-badge:focus-visible{outline:2px solid #216aa0;outline-offset:1px}.sheet-compact .sheet-animal-badge[draggable=true]{cursor:grab}.sheet-compact .sheet-animal-badge[draggable=true]:active{cursor:grabbing}.sheet-compact .sheet-animal-badge:disabled{background:#f5f5f2;border-color:#ddd;color:#555}.sheet-compact .sheet-animal-ear,.sheet-compact .sheet-animal-age{white-space:nowrap;color:#303b43}.sheet-animal-line>button:disabled{opacity:1;color:inherit;cursor:default}.sheet-animal-editor{border:1px solid #acc3d5;background:#f4f8fb;padding:6px;font-size:11px}.sheet-animal-editor[hidden]{display:none}.sheet-animal-editor p{margin:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}.sheet-animal-editor label{display:flex;gap:5px;align-items:center}.sheet-animal-editor textarea,.sheet-animal-editor input{background:#fff;border-color:#9db6c8}.sheet-animal-editor .sheet-editor-done{display:block;margin:3px 0 0 auto}.sheet-ear-dials{display:flex;gap:10px}.sheet-ear-dials label{flex:1}.sheet-ear-dials input{width:58px}.sheet-animal-editor input[type=date]{max-width:145px}.sheet-animal-editor .text-button{font-size:11px}.sheet-physical-scroll{overflow-x:auto;padding:8px}.sheet-physical-rack{display:grid;gap:6px;align-items:stretch}.sheet-physical-slot{min-width:0}.sheet-unregistered{background:repeating-linear-gradient(45deg,#fafafa,#fafafa 4px,#f4f4f4 4px,#f4f4f4 8px);min-height:60px}.sheet-compact>header{padding:5px;font-size:11px;gap:4px}.sheet-compact>header .text-button{font-size:10px}.sheet-compact .sheet-cage-summary>span{font-size:9px}.sheet-compact-animals{padding:3px}.sheet-compact-mouse{border-bottom:1px solid #d8e0e6;padding:2px 0}.sheet-animal-line{display:flex;min-width:0;align-items:center}.sheet-animal-line select{max-width:37px}.sheet-animal-line .text-button{padding:0 3px}.sheet-compact input,.sheet-compact select{font-size:11px;padding:3px}.sheet-compact-mouse details{font-size:9px;padding:1px 3px}.sheet-compact-mouse details summary{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sheet-compact-mouse details label{display:flex;align-items:center}.sheet-edit-details{font-size:10px;padding:3px 6px}.sheet-compact .sheet-light{font-size:9px;padding:4px;display:block}.sheet-compact .sheet-light .text-button{font-size:9px;padding:2px;display:block}.sheet-compact .sheet-empty{font-size:11px;padding:7px!important}.sheet-compact footer{flex-wrap:wrap;gap:4px}.sheet-compact footer button{font-size:9px!important}.sheet-selected{outline:3px solid #286ca6;outline-offset:0}.sheet-move-notice{position:sticky;top:65px;z-index:3;background:#e1effa;border:1px solid #286ca6;border-radius:5px;padding:10px;margin:6px 0}.sheet-cage[tabindex]:focus{outline:2px solid #286ca6}.sheet-cage{cursor:default}.sheet-cage:has(input:focus){cursor:auto}.sheet-toolbar{position:sticky;top:0;background:var(--bg,#fff);z-index:3;padding:10px 0}.sheet-transfer-actions{display:flex;align-items:center;gap:10px;flex:0 1 auto;width:max-content;max-width:100%;flex-wrap:wrap}.sheet-transfer-actions>.button{flex:0 0 auto}.sheet-toolbar svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;vertical-align:middle}.sheet-rack{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:12px}.sheet-cage{border:1px solid #a9b5bf;border-radius:6px;overflow:hidden;background:#fff;color:#111;min-width:0}.sheet-cage>header{display:flex;gap:10px;align-items:center;justify-content:space-between;background:#e7f0f7;padding:9px 10px;border-bottom:1px solid #a9b5bf;flex-wrap:wrap}.sheet-compact>header{padding:5px;gap:4px}.sheet-source>header{background:#f5f2e9}.sheet-cage-heading,.sheet-cage-summary{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;min-width:0}.sheet-cage-heading>strong{overflow-wrap:anywhere}.sheet-cage-summary{flex-wrap:wrap}.sheet-cage .sheet-print-label{display:inline-flex;align-items:center;justify-content:center;gap:5px;flex-shrink:0;min-height:32px;padding:5px 7px;border:1px solid #7d9bb2;border-radius:5px;background:#fff;color:#194f7a;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}.sheet-cage .sheet-print-label:hover{background:#f2f7fb}.sheet-cage .sheet-print-label:focus-visible{outline:2px solid #216aa0;outline-offset:2px}.sheet-print-label svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.sheet-compact .sheet-print-label{font-size:10px;gap:4px;padding:4px 6px}@media(pointer:coarse){.sheet-cage .sheet-print-label{min-height:44px;min-width:44px}}.sheet-cage-meta{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:7px}.sheet-cage-meta label{display:flex;gap:5px;align-items:center;font-size:11px;font-weight:600}.sheet-wide{grid-column:1/-1}.sheet-cage input,.sheet-cage select,.sheet-cage textarea{min-width:0;width:100%;font:inherit;font-size:12px;border:1px solid transparent;border-radius:2px;padding:5px;background:transparent;color:#111}.sheet-cage input:hover,.sheet-cage select:hover,.sheet-cage textarea:hover{border-color:#a9b5bf}.sheet-cage input:focus,.sheet-cage select:focus,.sheet-cage textarea:focus{border-color:#216aa0;background:#fff;outline:2px solid #c9e2f4}.sheet-cage input:disabled,.sheet-cage select:disabled,.sheet-cage textarea:disabled{opacity:1;-webkit-text-fill-color:#111}.sheet-mice{width:100%;table-layout:fixed;font-size:12px}.sheet-mice th,.sheet-mice td{padding:3px;border:1px solid #ced7df;white-space:normal;vertical-align:top}.sheet-mice th{background:#f2f5f7}.sheet-mice th:first-child{width:19%}.sheet-mice th:nth-child(2){width:8%}.sheet-mice th:nth-child(3){width:22%}.sheet-mice th:nth-child(4){width:23%}.sheet-mice th:nth-child(5){width:12%}.sheet-mice td .text-button{font-size:10px;padding:0 4px}.sheet-pending{background:#fff2b5!important;box-shadow:inset 3px 0 #d2a100}.sheet-light{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:7px;font-size:11px;border-top:1px solid #ced7df}.sheet-light .text-button{font-size:11px}.sheet-cage>footer{display:flex;justify-content:space-between;padding:4px 8px;border-top:1px solid #ced7df}.sheet-cage>footer button{font-size:11px}.sheet-empty{text-align:center;padding:12px!important}.sheet-empty span{display:block}.sheet-source-details{padding:6px 9px;font-size:11px}.sheet-source-details pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto}.sheet-cage>textarea{border-top:1px solid #ced7df}.cage-view-menu{display:flex;align-items:center;gap:10px;justify-content:flex-end;margin-bottom:10px}.cage-view-menu select{width:auto}@media(max-width:1100px){.sheet-rack{grid-template-columns:1fr}}@media(max-width:600px){.sheet-rack{padding:5px}.sheet-toolbar{position:static}.sheet-mice{min-width:560px}.sheet-light{align-items:flex-start;flex-direction:column}}.sheet-physical-rack{gap:3px}.cage-sheet .sheet-rack.sheet-unpositioned{grid-template-columns:repeat(auto-fill,174px);gap:3px}.sheet-cage.sheet-compact>header{grid-template-rows:minmax(48px,auto) 16px;padding:3px;gap:2px}.sheet-cage.sheet-compact .sheet-cage-heading{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:minmax(24px,auto) 22px;height:auto;min-height:48px;gap:2px 3px}.sheet-cage.sheet-compact .sheet-cage-heading>.sheet-cage-handle{grid-column:1;grid-row:1;margin:0;padding:0 1px}.sheet-cage.sheet-compact .sheet-cage-heading>strong{grid-column:2;grid-row:1;min-width:0;margin:0;overflow:visible;white-space:normal;text-overflow:clip;overflow-wrap:anywhere;font-size:11px;line-height:1.2}.sheet-cage.sheet-compact .sheet-print-label{grid-column:3;grid-row:1;min-height:24px;font-size:9px;gap:3px;padding:3px 4px}.sheet-compact .sheet-print-label svg{width:13px;height:13px}.sheet-cage-badges{display:flex;align-items:center;gap:3px;flex-wrap:wrap;min-width:0}.sheet-cage.sheet-compact .sheet-cage-badges{grid-column:1/-1;grid-row:2;min-height:12px}.sheet-cage.sheet-compact .sheet-breeding-label,.sheet-condition-label{flex:0 0 auto;padding:1px 3px;border-radius:3px;font-size:8px;font-weight:600;line-height:1.25;white-space:nowrap}.sheet-condition-label{background:#dce9f4;color:#194f7a;border:1px solid #a8c0d2}.sheet-cage.sheet-compact .sheet-animal-line{gap:2px;grid-template-columns:minmax(0,1fr) 16px auto auto}.sheet-cage.sheet-compact .sheet-note-light{width:16px;min-width:16px}.sheet-cage.sheet-compact .sheet-animal-badge{padding:1px 3px}.sheet-cage.sheet-compact .sheet-animal-ear,.sheet-cage.sheet-compact .sheet-animal-age{font-size:9px}
.sheet-empty-slot{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:150px;height:100%;border:1px dashed #bcc5c8;background:#eef0ea80;box-shadow:inset 0 1px 5px #6f7e8610}.sheet-empty-slot-number{font-size:30px;line-height:1.15;font-weight:600;color:#a8b2b5}.sheet-empty-slot-add{display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:1px solid #bdc9cc;border-radius:50%;font:inherit;font-size:22px;line-height:1;color:#617b88;background:#ffffff8c;cursor:pointer}.sheet-empty-slot-add:hover:not(:disabled){background:#fff;border-color:#6c94ad;color:#194f7a}.sheet-empty-slot-add:focus-visible{outline:2px solid #216aa0;outline-offset:3px}.sheet-empty-slot-add:disabled{opacity:.4;cursor:default}.sheet-empty-slot-destination{font-size:10px}.sheet-vacant-frame{min-height:150px}
.sheet-cage.sheet-compact .sheet-cage-summary{grid-template-rows:16px;gap:0 5px}
.sheet-cage.sheet-compact .sheet-manager-select{min-height:24px;padding:1px 4px}
.sheet-cage.sheet-compact .sheet-start-date{line-height:16px}
.sheet-cage.sheet-compact .sheet-compact-animals{padding:2px 3px}
.sheet-cage.sheet-compact .sheet-compact-mouse{padding:1px 0}
.sheet-cage.sheet-compact .sheet-animal-line>button{min-height:22px;padding-top:1px;padding-bottom:1px}
.sheet-cage.sheet-compact .sheet-empty-mouse{height:25px;min-height:25px}
.sheet-cage.sheet-compact>.sheet-edit-details{padding:2px 5px}
.sheet-cage.sheet-compact>.sheet-source-details{padding:2px 5px}
.sheet-cage.sheet-compact .sheet-add-mouse-actions{padding:2px 0;gap:3px}
.sheet-cage.sheet-compact>.sheet-light{padding:2px 4px}
.sheet-cage.sheet-compact>footer{padding:2px 5px;gap:3px}
.sheet-cage-heading:has(>.sheet-cage-person){flex-wrap:wrap}
.sheet-cage-person{display:flex;align-items:center;gap:4px;min-width:0;width:100%}
.sheet-cage-person .sheet-cage-badges{flex:0 0 auto}
.sheet-cage-person .sheet-cage-badges:empty{display:none}
.sheet-cage.sheet-compact .sheet-cage-person{grid-column:1/-1;grid-row:2}
.sheet-cage.sheet-compact .sheet-cage-person>.sheet-manager-select,.sheet-cage.sheet-compact .sheet-cage-person>.sheet-manager{font-size:9px;font-weight:400;max-width:88px;min-width:0;min-height:22px;line-height:16px;margin-left:auto;padding:1px 3px;flex:1 1 64px}
.sheet-cage.sheet-compact .sheet-cage-summary>.sheet-start-date,.sheet-cage.sheet-compact .sheet-cage-summary>.sheet-light-intensity{grid-row:1}
.sheet-entrainment-current{float:right;font-size:9px;color:#61717a;font-weight:400}
.sheet-entrainment-fields{display:grid;gap:3px;padding:3px 0}
.sheet-entrainment-row{display:grid;grid-template-columns:minmax(0,1.5fr) 5px minmax(0,1fr) 14px;align-items:center;gap:2px;font-size:10px}.sheet-entrainment-row input,.sheet-entrainment-row select{min-width:0;width:100%;box-sizing:border-box}.sheet-entrainment-actions{display:flex;align-items:center;gap:4px}.sheet-entrainment-icon svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7}.sheet-entrainment-actions .text-button{font-size:10px;padding:2px}.sheet-entrainment-remove{padding:1px!important}
.sheet-entrainment-fields input,.sheet-entrainment-fields select{font-size:10px;padding:2px 3px;border:1px solid #c5d3de;background:#fff;min-height:25px}
.sheet-entrainment-fields>.text-button{font-size:10px;text-align:left;padding:2px 0}
.sheet-cage-notes textarea{font-size:10px;line-height:1.4;resize:vertical}
@media(any-pointer:coarse),(max-width:1100px){.sheet-cage.sheet-compact>header{grid-template-rows:minmax(58px,auto) 18px}.sheet-cage.sheet-compact .sheet-cage-heading{grid-template-rows:minmax(32px,auto) 24px;min-height:58px}.sheet-cage.sheet-compact .sheet-print-label{min-height:32px;min-width:32px}.sheet-cage.sheet-compact .sheet-animal-line{grid-template-columns:minmax(0,1fr) 24px auto auto} .sheet-cage.sheet-compact .sheet-note-light{width:24px;min-width:24px}
.sheet-cage.sheet-compact .sheet-cage-summary{grid-template-rows:18px}
.sheet-cage.sheet-compact .sheet-cage-person>.sheet-manager-select{min-height:24px}
.sheet-entrainment-fields input,.sheet-entrainment-fields select{min-height:36px}
.sheet-cage.sheet-compact .sheet-start-date{line-height:18px}
.sheet-cage.sheet-compact .sheet-compact-mouse{padding:0}
.sheet-cage.sheet-compact .sheet-animal-line>button{min-height:32px}
.sheet-cage.sheet-compact .sheet-empty-mouse{height:30px;min-height:30px}
.sheet-cage.sheet-compact .sheet-row-control{min-width:32px;min-height:32px}
}`;
