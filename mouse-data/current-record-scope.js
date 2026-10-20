// Explicit read coverage. Unloaded records are never deletion candidates.
export const MANAGED_TABLES=Object.freeze(['mice','matings','litters','cages','rooms','racks','locations','light_events','husbandry_events']);
export const CAGE_EVENT_TYPES=Object.freeze(['animal_sheet_cage_snapshot','animal_sheet_source_change','source_manager_observation','cage_move','cage_assignment','cage_location','cage_location_assignment','mouse_cage_move','mouse_location','mouse_move','mouse_entrainment','locobox_protocol','cage_equipment_status','cage_card_badge_status','cage_summary_options']);
export const MANAGED_EVENT_TYPES=Object.freeze([...new Set([...CAGE_EVENT_TYPES,'locobox_revision','experiment','experiment_sample','experiment_revision','cryopreservation','cryopreservation_lot','cryopreservation_event','strain_definition','genetic_profile','genotype_scenario','breeding_plan','breeding_options','iacuc_protocol','iacuc_assignment','iacuc_usage','iacuc_design','lac_fee_month','lac_fee_options','animal_sheet_mouse_review','brainbot_mouse_review_batch','user_acronym'])]);
const sorted=values=>[...new Set(values)].sort();
export function managedCoverage({fullTables=[],eventTypes=[]}={}){
 const full=sorted(fullTables),events=sorted(eventTypes);
 if(full.some(value=>!MANAGED_TABLES.includes(value))||events.some(value=>!MANAGED_EVENT_TYPES.includes(value)))throw new Error('Choose supported record tables and event types.');
 return {schema_version:1,scope:'current-cages',full_tables:full,event_types:full.includes('husbandry_events')?[]:events};
}
export function checkedManagedCoverage(value){
 if(!value||value.schema_version!==1||value.scope!=='current-cages'||Object.keys(value).some(key=>!['schema_version','scope','full_tables','event_types'].includes(key))||!Array.isArray(value.full_tables)||!Array.isArray(value.event_types))throw new Error('The current-record coverage could not be verified. Reload shared data.');
 const checked=managedCoverage({fullTables:value.full_tables,eventTypes:value.event_types});
 if(JSON.stringify(value.full_tables)!==JSON.stringify(checked.full_tables)||JSON.stringify(value.event_types)!==JSON.stringify(checked.event_types))throw new Error('The current-record coverage is invalid. Reload shared data.');
 return checked;
}
export function getDeferredManagedTables(data){const marker=data?.managed_records_deferred;if(!marker)return [];const coverage=checkedManagedCoverage(marker);return MANAGED_TABLES.filter(type=>!coverage.full_tables.includes(type));}
export function getDeferredManagedEventTypes(data,{eventTypes=MANAGED_EVENT_TYPES}={}){
 if(!Array.isArray(eventTypes)||eventTypes.some(type=>!MANAGED_EVENT_TYPES.includes(type)))throw new Error('Choose supported event types.');
 const marker=data?.managed_records_deferred;if(!marker)return [];const coverage=checkedManagedCoverage(marker);
 return coverage.full_tables.includes('husbandry_events')?[]:sorted(eventTypes).filter(type=>!coverage.event_types.includes(type));
}
export function mergeManagedCoverage(before,{fullTables=[],eventTypes=[]}={}){
 const old=checkedManagedCoverage(before);return managedCoverage({fullTables:[...old.full_tables,...fullTables],eventTypes:[...old.event_types,...eventTypes]});
}
const text=value=>typeof value==='string'?value.trim():value==null?'':String(value);
const list=value=>Array.isArray(value)?value:[];
const historical=row=>row?.source_historical===true||row?.history_read_only===true||row?.source_current===false||row?.record_origin==='historical_google_sheet';
// Match the opening cage_cards reader, never a latest-only history summary.
// Exact mouse/cage intervals stay complete. Unlinked historical slot copies
// and source audit snapshots belong to their on-demand history menus.
function cageCardEvents(input,{cages,mouseIds,cageIds}){
 const active=row=>row&&!row.app_archived_at&&row.archived!==true;
 const locations=list(input.locations),locationIds=new Set(locations.filter(row=>active(row)&&row.source_current!==false).map(row=>text(row.location_id)));
 for(const cage of cages)for(const id of [cage.location_id,cage.cage_sheet_source_location_id,cage.cage_sheet_card?.source_location_id])if(text(id))locationIds.add(text(id));
 const positions=locations.filter(row=>locationIds.has(text(row.location_id))),rackIds=new Set(positions.map(row=>text(row.rack_id)).filter(Boolean)),roomIds=new Set(positions.map(row=>text(row.room_id)).filter(Boolean));
 const light_events=list(input.light_events).filter(row=>{
  if(!active(row))return false;
  const mouse=text(row.mouse_sid),cage=text(row.cage_sid),location=text(row.location_id),rack=text(row.rack_id),room=text(row.room_id),exact=mouseIds.has(mouse)||cageIds.has(cage);
  const scoped=exact||locationIds.has(location)||rackIds.has(rack)||roomIds.has(room)||![mouse,cage,location,rack,room].some(Boolean);
  return scoped&&(exact||!historical(row));
 });
 const events=list(input.husbandry_events).filter(active),protocols=events.filter(row=>row.event_type==='locobox_protocol');
 const relevantProtocol=row=>{const p=row.locobox_protocol;return cageIds.has(text(row.cage_sid))||locationIds.has(text(row.location_id))||p&&(cageIds.has(text(p.cage_sid))||locationIds.has(text(p.location_id))||list(p.animal_sids).some(id=>mouseIds.has(text(id))));};
 const selectedProtocols=new Set(protocols.filter(relevantProtocol));
 const sourceIds=new Set(light_events.map(row=>text(row.event_id)));
 for(const row of events)if(row.event_type==='mouse_entrainment'&&mouseIds.has(text(row.mouse_sid))&&text(row.entrainment?.source_event_id))sourceIds.add(text(row.entrainment.source_event_id));
 // Include all competing reviews for an exact source identity; omitting one
 // could turn an unresolved clarification into a falsely certain condition.
 const bySource=new Map();for(const row of protocols)for(const id of new Set([text(row.event_id),text(row.locobox_protocol?.reviewed_source_event_id)].filter(Boolean))){const group=bySource.get(id)||[];group.push(row);bySource.set(id,group);}
 const pending=[...sourceIds],includeSource=id=>{if(id&&!sourceIds.has(id)){sourceIds.add(id);pending.push(id);}};
 for(const row of selectedProtocols)includeSource(text(row.locobox_protocol?.reviewed_source_event_id));
 for(let i=0;i<pending.length;i++)for(const row of bySource.get(pending[i])||[])if(!selectedProtocols.has(row)){selectedProtocols.add(row);includeSource(text(row.locobox_protocol?.reviewed_source_event_id));}
 const husbandry_events=events.filter(row=>{
  if(row.event_type==='locobox_protocol')return selectedProtocols.has(row);
  if(row.event_type==='mouse_entrainment')return mouseIds.has(text(row.mouse_sid));
  if(row.event_type==='cage_equipment_status')return locationIds.has(text(row.location_id))||locationIds.has(text(row.equipment_status?.location_id));
  if(row.event_type==='cage_card_badge_status')return locationIds.has(text(row.location_id));
  if(row.event_type==='cage_summary_options')return true;
  return row.event_type==='experiment'&&['planned','in_progress'].includes(row.experiment?.status)&&list(row.experiment.participants).some(person=>person?.link_status==='confirmed'&&mouseIds.has(text(person.mouse_sid)));
 });
 return {light_events,husbandry_events};
}
/** A small read-only preview; fresh server pages still establish edit coverage. */
export function currentCacheProjection(data){
 const input=data?.tables||{},active=row=>row&&!row.app_archived_at&&!row.archived;
 const mice=(input.mice||[]).filter(row=>active(row)&&['Stock','Unknown'].includes(row.state)),mouseIds=new Set(mice.map(row=>row.mouse_sid)),cageIds=new Set(mice.map(row=>row.cage_sid));
 const cages=(input.cages||[]).filter(row=>active(row)&&(!['ended','inactive'].includes(String(row.state||'').toLowerCase())||cageIds.has(row.cage_sid)));
 const {light_events,husbandry_events}=cageCardEvents(input,{cages,mouseIds,cageIds:new Set(cages.map(row=>text(row.cage_sid)))});
 return {...data,...(data.source_archive_deferred?{source_archive_deferred:{...data.source_archive_deferred,loaded_tables:[]}}:{}),managed_records_deferred:managedCoverage({fullTables:['rooms','racks','locations']}),tables:{mice,cages,matings:(input.matings||[]).filter(row=>active(row)&&String(row.state).toLowerCase()==='active'),litters:[],rooms:input.rooms||[],racks:input.racks||[],locations:input.locations||[],light_events,husbandry_events}};
}
