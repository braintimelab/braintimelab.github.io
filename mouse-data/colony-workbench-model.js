import {ID_FIELDS,validateDatasetChanges} from './model.js?v=192';
import {resolveMouseSid,formatMouseSid} from './mouse-sid.js?v=188';
import {applyRegistrationOverrides} from './mouse-registration-tags.js?v=190';
import {reconcileGenotypeText} from './genotype-reconciliation.js?v=192';
import {planMouseMove} from './cage-movement.js?v=146';
import {applyCageEntryStartDates,cageStartReadDependencies} from './cage-start.js?v=174';
import {applyCageEntrainmentAdoptions,cageEntrainmentReadDependencies} from './cage-entrainment.js?v=132';
import {MAX_RPC_BYTES,utf8Size} from './archive-format.js?v=174';
import {currentFosterCaregivers} from './colony-care.js?v=192';
import {cageCardObservation,cageSheetAnimals,createCageObservationContext} from './cage-observations.js?v=192';

export const COLONY_WORKBENCH_LIMIT=100;
export const COLONY_WORKBENCH_NEEDS=Object.freeze({tables:Object.freeze(['mice','matings','litters','cages','rooms','racks','locations']),eventTypes:Object.freeze(['mouse_weaning_batch','litter_foster_care','cage_move','cage_assignment','mouse_entrainment','locobox_protocol','locobox_revision','iacuc_protocol','iacuc_assignment','iacuc_usage'])});
const reviewedPlans=new WeakMap();
const clone=value=>structuredClone(value),equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null),rows=(data,type)=>data?.tables?.[type]||[];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),active=row=>row&&!row.app_archived_at&&!row.archived&&!row.history_read_only&&!row.source_historical;
const narrow=new Set(['physical_tag','sex','genotype','ear_mark','comment']),sharedFields=new Set([...narrow,'manager','protocol','status']);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!value.startsWith('0000-')&&!Number.isNaN(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const unique=items=>[...new Map(items.map(item=>[item.type+':'+item.id,item])).values()];
const find=(data,type,id)=>{const found=rows(data,type).filter(row=>String(row[ID_FIELDS[type]])===String(id));if(found.length>1)throw new Error(`Several ${type} records use ${id}. Reload and resolve this identity before continuing.`);return found[0];};
function text(value,field,max=2000){if(value===null||value==='')return null;if(typeof value!=='string'||[...value].length>max||/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value))throw new Error(`${field} must be text of at most ${max} characters, or blank.`);return value.trim()||null;}
function currentDataset(data){
 if(!object(data)||!object(data.tables)||!Array.isArray(data.tables.mice))throw new Error('Load the current mouse records first.');
 if(data.history_projection?.read_only)throw new Error('Historical views are read only. Return to the current colony.');
 const coverage=data.managed_records_deferred;if(coverage&&(COLONY_WORKBENCH_NEEDS.tables.some(type=>!coverage.full_tables?.includes(type))||!coverage.full_tables?.includes('husbandry_events')&&COLONY_WORKBENCH_NEEDS.eventTypes.some(type=>!coverage.event_types?.includes(type))))throw new Error('Load complete mice, litter, mating, housing and care-event records before opening this workbench.');
}
function selectedMice(data,inputs){
 currentDataset(data);if(!Array.isArray(inputs)||inputs.length<1||inputs.length>COLONY_WORKBENCH_LIMIT)throw new Error(`Select between 1 and ${COLONY_WORKBENCH_LIMIT} mice.`);
 const ids=inputs.map(input=>resolveMouseSid(data,input));if(new Set(ids).size!==ids.length)throw new Error('The selection contains the same mouse more than once, possibly through a legacy SID alias.');
 return ids.map(id=>{const row=find(data,'mice',id);if(!active(row)||row._derived)throw new Error(`Mouse ${formatMouseSid(id,data)} is unavailable or historical. Reload before editing.`);return row;});
}
function stampOptions({at=new Date().toISOString(),asOf=day(),operationId}={}){
 if(!date(asOf)||typeof at!=='string'||Number.isNaN(Date.parse(at)))throw new Error('Use a valid operation date and timestamp.');
 if(!uuid(operationId))throw new Error('Reopen this workbench to obtain a stable operation identity.');return {at,asOf,operationId};
}
function allowedFields(value,label){
 if(!object(value))throw new Error(`${label} must contain named values.`);
 for(const key of Object.keys(value))if(!sharedFields.has(key))throw new Error(`${label}: ${key} is fixed here. Use its dedicated workflow.`);
 const result={};for(const[key,raw]of Object.entries(value)){
  if(key==='sex'){if(!['Male','Female','Unknown'].includes(raw))throw new Error('Choose Male, Female or Unknown sex.');result[key]=raw;}
  else result[key]=text(raw,key,{physical_tag:200,ear_mark:160,genotype:2048,manager:160,protocol:200,status:200}[key]||2000);
 }return result;
}
function changedRecords(before,after){
 const changes=[];
 for(const[type,key]of Object.entries(ID_FIELDS)){const index=new Map();for(const row of rows(before,type)){const id=String(row[key]);if(index.has(id))throw new Error(`Several ${type} records use ${id}. Resolve this identity before continuing.`);index.set(id,row);}for(const next of rows(after,type)){
  const prior=index.get(String(next[key]));if(!equal(prior,next))changes.push({type,id:String(next[key]),before:prior?clone(prior):null,after:clone(next),fields:[...new Set([...Object.keys(prior||{}),...Object.keys(next)])].filter(field=>JSON.stringify(prior?.[field])!==JSON.stringify(next[field]))});
 }}return changes;
}
function validateFinal(before,after,changes,warnings){
 const checked=validateDatasetChanges(before,after,changes.map(change=>({type:change.type,id:change.id,originalId:change.before?change.id:null,fields:change.fields})));
 if(checked.errors.length)throw new Error(checked.errors.join('\n'));warnings.push(...checked.warnings);
}
function finish(data,next,{kind,at,operationId,dependencies=[],warnings=[],requiredPermissions=[],mouseIds=[],cageIds=[],litterIds=[]}){
 const changes=changedRecords(data,next);if(!changes.length)throw new Error('No selected values would change. Choose an update before reviewing.');validateFinal(data,next,changes,warnings);
 const readDependencies=unique(dependencies).filter(dep=>find(data,dep.type,dep.id)),pending=new Map(changes.map(change=>[change.type+':'+change.id,change]));
 for(const dep of readDependencies)if(!pending.has(dep.type+':'+dep.id))pending.set(dep.type+':'+dep.id,{type:dep.type,id:dep.id,after:find(data,dep.type,dep.id)});
 if(pending.size>500)throw new Error('This selection and its housing guards exceed one atomic save. Select fewer mice.');
 const request={p_colony_id:'00000000-0000-4000-8000-000000000000',p_changes:[...pending.values()].map(change=>({entity_type:change.type,entity_id:change.id,payload:change.after,archived:Boolean(change.after.app_archived_at),expected_version:2147483647}))};
 const payloadBytes=utf8Size(request);if(payloadBytes>MAX_RPC_BYTES)throw new Error('This selection exceeds one atomic save payload. Select fewer mice.');
 const plan={kind,source:data,nextDataset:next,at,operationId,changes,readDependencies,guarded:readDependencies.map(dep=>({...dep,payload:clone(find(data,dep.type,dep.id))})),created:changes.filter(change=>!change.before).map(({type,id})=>({type,id})),warnings:[...new Set(warnings)],requiredPermissions:[...new Set(requiredPermissions)],mouseIds,cageIds:[...new Set(cageIds)],litterIds:[...new Set(litterIds)],atomicRecordCount:pending.size,payloadBytes};
 reviewedPlans.set(plan,{source:JSON.stringify(data),proposal:proposalSignature(plan)});return plan;
}
function proposalSignature(plan){return JSON.stringify({kind:plan.kind,next:plan.nextDataset,changes:plan.changes,readDependencies:plan.readDependencies,guarded:plan.guarded,created:plan.created,requiredPermissions:plan.requiredPermissions,mouseIds:plan.mouseIds,cageIds:plan.cageIds,litterIds:plan.litterIds,allocations:plan.allocations,occupancyExpectations:plan.occupancyExpectations,warnings:plan.warnings});}

/** Ordinary field and lifecycle edits for arbitrary existing mice. Identity,
 * pedigree, housing and imported evidence are retained byte for byte. */
export function prepareColonyWorkbench(data,options={}){
 const {at,asOf,operationId}=stampOptions(options),selected=selectedMice(data,options.mouseIds),shared=allowedFields(options.shared||{},'Shared fields'),rawOverrides=options.overrides||{};
 if(!object(rawOverrides))throw new Error('Row overrides must use exact stored SIDs.');const selectedIds=new Set(selected.map(row=>String(row.mouse_sid))),overrides=Object.create(null);
 for(const[id,value]of Object.entries(rawOverrides)){if(!selectedIds.has(id))throw new Error(`Row ${id} is not selected.`);overrides[id]=allowedFields(value,`Mouse ${id}`);}
 const fields=Object.fromEntries(selected.map(row=>[row.mouse_sid,{...shared,...overrides[row.mouse_sid]}])),narrowOverrides=Object.fromEntries(selected.map(row=>[row.mouse_sid,Object.fromEntries(Object.entries(fields[row.mouse_sid]).filter(([key])=>narrow.has(key)))]));
 const genotypeDecisions=Object.fromEntries(selected.map(row=>[row.mouse_sid,options.genotypeDecisions?.[row.mouse_sid]??options.genotypeDecision??null]));
 const tagged=applyRegistrationOverrides(data,selected,{existing:true,overrides:narrowOverrides,tagSequence:options.tagSequence||null,fullGenotypeEvidence:options.fullGenotypeEvidence===true,genotypeDecisions,at}),warnings=[...tagged.warnings],requiredPermissions=['mice'],drafts=tagged.drafts;
 for(const draft of drafts){
  const original=selected.find(row=>row.mouse_sid===draft.mouse_sid);
  if(!equal(draft.genotype,original.genotype)){
   const decision=options.genotypeDecisions?.[draft.mouse_sid]??options.genotypeDecision??null;
   const result=reconcileGenotypeText(original,draft.genotype,{decision,at,fullGenotypeEvidence:options.fullGenotypeEvidence===true});
   if(result.errors?.length||result.needsReview)throw new Error(`Mouse ${formatMouseSid(draft.mouse_sid,data)}: ${(result.errors?.length?result.errors:['Review the structured genotype decision.']).join(' ')}`);
   for(const key of ['genotype','genotype_status','genotype_inference','genetic_profile'])if(Object.hasOwn(result.draft,key))draft[key]=clone(result.draft[key]);else delete draft[key];
   warnings.push(...(result.warnings||[]));requiredPermissions.push('strains');
  }
  for(const[key,value]of Object.entries(fields[draft.mouse_sid]))if(!narrow.has(key))draft[key]=value;
  if(options.end){
   const end=options.end;if(!object(end)||end.confirmed!==true||!date(end.date)||end.date>asOf||!text(end.reason,'End reason',1000))throw new Error('Confirm the actual end date (no later than today) and a recorded end reason.');
   if(original.state==='Ended'||original.end_date)throw new Error(`Mouse ${formatMouseSid(draft.mouse_sid,data)} already has an end record. Correct that record individually.`);
   draft.state='Ended';draft.end_date=end.date;draft.end_reason=text(end.reason,'End reason',1000);
  }
  if(!equal(draft,original))draft.app_modified_at=at;
 }
 const proposed=new Map(drafts.map(row=>[row.mouse_sid,row])),next={...clone(data),tables:{...clone(data.tables),mice:rows(data,'mice').map(row=>proposed.get(row.mouse_sid)||clone(row))}};
 return finish(data,next,{kind:'edit',at,operationId,warnings,requiredPermissions,dependencies:[...tagged.readDependencies,...selected.map(row=>({type:'mice',id:String(row.mouse_sid)}))],mouseIds:[...selectedIds]});
}

function housingGuards(data,cage){
 const out=[];if(!cage)return out;
 if(find(data,'cages',cage.cage_sid))out.push({type:'cages',id:String(cage.cage_sid)});
 const location=cage.location_id?find(data,'locations',cage.location_id):null;
 for(const[type,id]of [['locations',cage.location_id],['racks',cage.rack_id||location?.rack_id],['rooms',cage.room_id||location?.room_id]])if(id&&find(data,type,id))out.push({type,id:String(id)});
 return out;
}
function wholeNumber(value,label,min=1,max=100){const number=Number(value);if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(number)||number<min||number>max)throw new Error(`${label} must be a whole number from ${min} to ${max}.`);return number;}
function sourceHousingRows(data,cage,position,context){
 const item={position:position||{},sourceProofCage:cage},card=cageCardObservation(data,{position:position||{},cage},context);
 if(!card.observation.animals.length&&!card.unresolved_rows.length)return [];
 const observed=cageSheetAnimals(data,item,context);
 for(const marker of card.unresolved_rows)if(!observed.some(row=>row.sourceCell===marker.sourceCell&&(row.sourceTag||row.tag)===marker.tag))observed.push({tag:marker.tag,sourceCell:marker.sourceCell,matchStatus:'unlinked',mouseSid:null});
 return observed;
}
function residentRows(data,cageSid){return rows(data,'mice').filter(row=>active(row)&&!row.end_date&&['Stock','Unknown'].includes(row.state)&&String(row.cage_sid||'')===String(cageSid));}
function assertKnownDestination(data,cage,position,context){
 const residents=new Set(residentRows(data,cage?.cage_sid).map(row=>String(row.mouse_sid))),source=sourceHousingRows(data,cage,position,context);
 if(source.some(row=>!['matched','registered'].includes(row.matchStatus)||!row.mouseSid||!residents.has(String(row.mouseSid))))throw new Error(`Destination ${cage?.cage_tag||position?.label||cage?.cage_sid} has unresolved source-card occupants. Reconcile its current housing before using a capacity plan.`);
}

/** Record actual weaning and a reviewed sex/capacity allocation together. A
 * partial selection never silently marks every pup in a litter as weaned. */
export function prepareColonyWeaning(data,options={}){
 const {at,asOf,operationId}=stampOptions(options),selected=selectedMice(data,options.mouseIds),actualDate=options.actualDate,maxPerCage=wholeNumber(options.maxPerCage,'Maximum mice per destination cage'),warnings=[],dependencies=selected.map(row=>({type:'mice',id:String(row.mouse_sid)}));
 if(!date(actualDate)||actualDate>asOf)throw new Error('Enter the actual weaning date, no later than today.');
 const sexOverrides=options.sexOverrides||{};if(!object(sexOverrides)||Object.keys(sexOverrides).some(id=>!selected.some(row=>String(row.mouse_sid)===id)))throw new Error('Sex observations must refer only to selected mice.');
 const drafts=selected.map(original=>{
  if(original.state!=='Stock'||original.end_date)throw new Error(`Mouse ${formatMouseSid(original.mouse_sid,data)} is not current Stock. Review its lifecycle first.`);
  if(original.wean_date&&original.wean_date!==actualDate)throw new Error(`Mouse ${formatMouseSid(original.mouse_sid,data)} already has weaning date ${original.wean_date}. Correct that record individually.`);
  if(original.date_of_birth&&(!date(original.date_of_birth)||actualDate<original.date_of_birth))throw new Error(`Mouse ${formatMouseSid(original.mouse_sid,data)} needs a valid birth date no later than its weaning date.`);
  if(!original.date_of_birth)warnings.push(`Mouse ${formatMouseSid(original.mouse_sid,data)} has no birth date; its age is unverified.`);
  const sex=sexOverrides[original.mouse_sid]??original.sex;if(!['Male','Female','Unknown'].includes(sex))throw new Error('Record Male, Female or Unknown for each selected mouse.');
  return {...clone(original),sex,wean_date:actualDate};
 });
 const selectedIds=new Set(selected.map(row=>String(row.mouse_sid))),groups=Object.fromEntries(['Male','Female','Unknown'].map(sex=>[sex,drafts.filter(row=>row.sex===sex)])),existing=options.existingCages||{},usedCages=new Set(),newCages=[],allocations=[],newPositions=options.newCagePositions||[],usedPositions=new Set(),sourceContext=createCageObservationContext(data);let positionIndex=0;
 for(const cageSid of new Set(selected.map(row=>row.cage_sid).filter(Boolean))){const cage=find(data,'cages',cageSid),position=cage?.location_id?find(data,'locations',cage.location_id):null;if(cage&&sourceHousingRows(data,cage,position,sourceContext).some(row=>!row.mouseSid||!['matched','registered'].includes(row.matchStatus)))warnings.push(`Source cage ${cage.cage_tag||cageSid} has unresolved source-card occupants. Only the selected registered mice move; reconcile the remaining observations separately.`);}
 if(!object(existing)||Object.keys(existing).some(sex=>!Object.hasOwn(groups,sex))||!Array.isArray(newPositions)||new Set(newPositions).size!==newPositions.length)throw new Error('Choose distinct destination cages and new-cage positions.');
 const prefix=text(options.newCagePrefix||'Weaned','New cage prefix',120),assignedManager=options.newCageManager===undefined?undefined:text(options.newCageManager,'New cage manager',160),usedTags=new Set(rows(data,'cages').map(row=>String(row.cage_tag||'').toLowerCase()));
 for(const sex of ['Male','Female','Unknown']){
  const pending=[...groups[sex]],destinations=existing[sex]||[];if(!Array.isArray(destinations))throw new Error('Choose destination cages by sex.');
  for(const id of destinations){
   if(typeof id!=='string'||usedCages.has(id))throw new Error('Use each destination cage for only one sex group.');usedCages.add(id);
   const cage=find(data,'cages',id);if(!active(cage)||cage._derived||!['Active','Occupied'].includes(cage.state))throw new Error(`Destination cage ${id} is unavailable.`);
   assertKnownDestination(data,cage,cage.location_id?find(data,'locations',cage.location_id):null,sourceContext);
   const residents=residentRows(data,id).filter(row=>!selectedIds.has(String(row.mouse_sid)));
   if(residents.some(row=>row.sex!==sex))throw new Error(`Cage ${cage.cage_tag||id} contains another or unrecorded sex. Choose a separate cage.`);
   const capacity=cage.capacity===undefined||cage.capacity===null||cage.capacity===''?maxPerCage:Math.min(maxPerCage,wholeNumber(cage.capacity,`Capacity of ${cage.cage_tag||id}`,1,10000));
   dependencies.push(...housingGuards(data,cage),...residents.map(row=>({type:'mice',id:String(row.mouse_sid)})));
   const taking=pending.splice(0,Math.max(0,capacity-residents.length));if(taking.length)allocations.push({sex,cageSid:id,cageTag:cage.cage_tag||id,mouseIds:taking.map(row=>row.mouse_sid),capacity,residents:residents.length,created:false});
  }
  let ordinal=0;
  while(pending.length){
   if(options.createCages!==true)throw new Error(`The ${sex.toLowerCase()} destinations have no room for ${pending.length} selected mice. Choose more cages or enable new cages.`);
   ordinal++;const letter={Male:'M',Female:'F',Unknown:'U'}[sex],id=`WEAN-${operationId}-${letter}-${ordinal}`;
   if(find(data,'cages',id))throw new Error('This operation may already have created its cages. Reload and verify the previous save before retrying.');
   let position=null;if(newPositions[positionIndex]){
    const positionId=newPositions[positionIndex++];position=find(data,'locations',positionId);if(!active(position)||position.source_current===false)throw new Error(`Position ${positionId} is unavailable.`);
    if(rows(data,'cages').some(cage=>active(cage)&&['Active','Occupied'].includes(cage.state)&&String(cage.location_id||'')===positionId))throw new Error(`Position ${position.label||positionId} is occupied.`);
    assertKnownDestination(data,null,position,sourceContext);
    if(usedPositions.has(positionId))throw new Error('Each new cage needs its own selected position.');usedPositions.add(positionId);
   }
   let cageTag=position?.label||`${prefix}-${letter}${ordinal}`;while(!position&&usedTags.has(cageTag.toLowerCase())){ordinal++;cageTag=`${prefix}-${letter}${ordinal}`;}usedTags.add(cageTag.toLowerCase());
   const cage={cage_sid:id,cage_tag:cageTag,state:'Active',record_origin:'app_created',capacity:maxPerCage,app_created_at:at,app_modified_at:at,...(assignedManager===undefined?{}:{manager:assignedManager}),...(position?{location_id:position.location_id,room_id:position.room_id||null,rack_id:position.rack_id||null}:{})};
   if(!position)warnings.push(`New cage ${cageTag} has no rack position assigned. Assign its actual position in Housing.`);
   newCages.push(cage);dependencies.push(...housingGuards(data,cage));const taking=pending.splice(0,maxPerCage);allocations.push({sex,cageSid:id,cageTag,mouseIds:taking.map(row=>row.mouse_sid),capacity:maxPerCage,residents:0,created:true});
  }
 }
 if(!allocations.length)throw new Error('No selected pups have a destination.');
 const foster=currentFosterCaregivers(data,[...selectedIds],{day:actualDate});
 for(const care of foster){dependencies.push({type:'mice',id:String(care.nursingDamSid)},{type:'husbandry_events',id:String(care.startEventId)});for(const event of rows(data,'husbandry_events'))if(active(event)&&event.event_type==='litter_foster_care'&&event.litter_foster_care?.start_event_id===care.startEventId)dependencies.push({type:'husbandry_events',id:String(event.event_id)});warnings.push(`Mouse ${formatMouseSid(care.mouseSid,data)} has a recorded foster caregiver. This operation records separation without altering the care interval or birth parents.`);}
 const staged={...data,tables:{...data.tables,cages:[...rows(data,'cages'),...newCages]}},draftById=new Map(drafts.map(row=>[row.mouse_sid,row])),events=[],litterIds=new Set();let eventOrdinal=0;
 for(const allocation of allocations)for(const id of allocation.mouseIds){
  const original=selected.find(row=>row.mouse_sid===id),draft=draftById.get(id),cage=find(staged,'cages',allocation.cageSid);
  for(const parentId of Array.isArray(original.dam_sids)?original.dam_sids:[]){const dam=find(data,'mice',parentId);if(dam){dependencies.push({type:'mice',id:String(dam.mouse_sid)});if(active(dam)&&dam.state==='Stock'&&String(dam.cage_sid||'')===allocation.cageSid)throw new Error(`Mouse ${formatMouseSid(id,data)} would remain with a recorded dam. Choose a separate destination cage.`);}else warnings.push(`Mouse ${formatMouseSid(id,data)} has an unavailable dam record; confirm physical separation when carrying out this plan.`);}
  if(foster.some(care=>String(care.mouseSid)===String(id)&&String(care.cageSid||'')===allocation.cageSid))throw new Error(`Mouse ${formatMouseSid(id,data)} would remain with its recorded foster caregiver. Choose a separate destination cage.`);
  if(!original.dam_sids?.length)warnings.push(`Mouse ${formatMouseSid(id,data)} has no recorded dam; confirm physical separation when carrying out this plan.`);
  const move=planMouseMove(staged,id,allocation.cageSid,{effectiveDate:actualDate});dependencies.push(...move.readDependencies.filter(dep=>!(dep.type==='cages'&&newCages.some(row=>row.cage_sid===dep.id))));
  draft.cage_sid=allocation.cageSid;draft.cage_tag=cage.cage_tag||null;if(!equal(draft,original))draft.app_modified_at=at;if(original.litter_sid){const litter=find(data,'litters',original.litter_sid);if(!active(litter))throw new Error(`Litter ${original.litter_sid} is unavailable.`);litterIds.add(String(litter.litter_sid));dependencies.push({type:'litters',id:String(litter.litter_sid)});}
  if(String(original.cage_sid||'')!==allocation.cageSid){
   const eventId=`WEAN-MOVE-${operationId}-${++eventOrdinal}`;if(find(data,'husbandry_events',eventId))throw new Error('This operation may already be saved. Reload its housing history before retrying.');
   events.push({event_id:eventId,record_origin:'app_created',mouse_sid:String(id),old_cage_sid:original.cage_sid||null,cage_sid:allocation.cageSid,location_id:cage.location_id||null,event_date:actualDate,event_type:original.cage_sid?'cage_move':'cage_assignment',notes:'Recorded actual weaning and reviewed sex-separated cage allocation.',app_created_at:at,app_modified_at:at});
  }
 }
 let next=clone(data);next.tables.cages=[...rows(next,'cages'),...clone(newCages)];next.tables.mice=rows(data,'mice').map(row=>draftById.get(row.mouse_sid)||clone(row));next.tables.husbandry_events=[...rows(next,'husbandry_events'),...events];
 if(options.markLittersWeaned){
  if(options.confirmWholeLitters!==true)throw new Error('Confirm that all pups in each selected litter are represented before marking whole litters weaned.');
  for(const id of litterIds){const litter=find(data,'litters',id),pups=rows(data,'mice').filter(row=>active(row)&&String(row.litter_sid||'')===id),living=pups.filter(row=>row.state!=='Ended'&&!row.end_date);
   if(living.some(row=>!selectedIds.has(String(row.mouse_sid))&&(!date(row.wean_date)||row.wean_date>actualDate)))throw new Error(`Litter ${id} still has unselected pups without a recorded weaning date. Wean selected pups only or select the remaining pups.`);
   if(litter.size_reported&&Number(litter.size_reported)>pups.length)throw new Error(`Litter ${id} reports more pups than are registered. Register or review those pups before marking the whole litter weaned.`);
   if(litter.wean_date&&litter.wean_date!==actualDate)throw new Error(`Litter ${id} already has weaning date ${litter.wean_date}. Correct it individually.`);
   const target=find(next,'litters',id);if(target.state!=='Weaned'||target.wean_date!==actualDate){target.state='Weaned';target.wean_date=actualDate;target.app_modified_at=at;}dependencies.push(...pups.map(row=>({type:'mice',id:String(row.mouse_sid)})));
  }
 }else if(litterIds.size)warnings.push('Only selected mice receive a weaning date; whole-litter state and dates remain as recorded.');
 const occupancyExpectations=allocations.map(allocation=>{const cage=find(staged,'cages',allocation.cageSid),capacity=cage.capacity===undefined||cage.capacity===null||cage.capacity===''?null:wholeNumber(cage.capacity,`Capacity of ${cage.cage_tag||cage.cage_sid}`,1,10000);return {cage_sid:allocation.cageSid,mouse_sids:residentRows(data,allocation.cageSid).map(row=>String(row.mouse_sid)).sort(),capacity,allocation_capacity:allocation.capacity};}),batchEventId=`WEAN-BATCH-${operationId}`;
 if(find(data,'husbandry_events',batchEventId))throw new Error('This weaning batch may already be saved. Reload and verify it before retrying.');
 next.tables.husbandry_events.push({event_id:batchEventId,event_type:'mouse_weaning_batch',event_date:actualDate,record_origin:'app_created',mouse_weaning_batch:{schema_version:1,operation_id:operationId,actual_date:actualDate,mouse_sids:[...selectedIds],assignments:allocations.flatMap(allocation=>allocation.mouseIds.map(id=>({mouse_sid:String(id),cage_sid:allocation.cageSid,sex:allocation.sex}))),expected_residents:occupancyExpectations,litter_sids:[...litterIds],mark_litters_weaned:options.markLittersWeaned===true},app_created_at:at,app_modified_at:at});
 next=applyCageEntrainmentAdoptions(data,applyCageEntryStartDates(data,next,{at,entryDate:actualDate}));dependencies.push(...cageStartReadDependencies(data,next),...cageEntrainmentReadDependencies(data,next));
 const plan=finish(data,next,{kind:'wean',at,operationId,dependencies,warnings,requiredPermissions:['mice','litters','cages','housing'],mouseIds:[...selectedIds],cageIds:allocations.map(row=>row.cageSid),litterIds:[...litterIds]});Object.assign(plan,{allocations,occupancyExpectations,actualDate,maxPerCage});reviewedPlans.get(plan).proposal=proposalSignature(plan);return plan;
}

export function assertColonyWorkbenchPlan(dataset,plan){
 const reviewed=reviewedPlans.get(plan);if(!reviewed||dataset!==plan.source||reviewed.source!==JSON.stringify(dataset))throw new Error('Records changed. Reload and review this workbench again.');
 if(reviewed.proposal!==proposalSignature(plan))throw new Error('The reviewed proposal changed. Review this workbench again.');
 for(const guard of plan.guarded)if(!equal(find(dataset,guard.type,guard.id),guard.payload))throw new Error('A selected mouse, litter or housing dependency changed. Review again.');
 for(const created of plan.created)if(find(dataset,created.type,created.id))throw new Error('A record from this operation already exists. Reload to verify whether the save completed.');return true;
}
