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
/** A small read-only preview; fresh server pages still establish edit coverage. */
export function currentCacheProjection(data){
 const input=data?.tables||{},active=row=>row&&!row.app_archived_at&&!row.archived;
 const mice=(input.mice||[]).filter(row=>active(row)&&['Stock','Unknown'].includes(row.state)),mouseIds=new Set(mice.map(row=>row.mouse_sid)),cageIds=new Set(mice.map(row=>row.cage_sid));
 const cages=(input.cages||[]).filter(row=>active(row)&&(!['ended','inactive'].includes(String(row.state||'').toLowerCase())||cageIds.has(row.cage_sid)));
 const events=(input.husbandry_events||[]).filter(row=>active(row)&&(CAGE_EVENT_TYPES.includes(row.event_type)&&(row.event_type!=='mouse_entrainment'||mouseIds.has(row.mouse_sid))||row.event_type==='experiment'&&['planned','in_progress'].includes(row.experiment?.status)));
 return {...data,...(data.source_archive_deferred?{source_archive_deferred:{...data.source_archive_deferred,loaded_tables:[]}}:{}),managed_records_deferred:managedCoverage({fullTables:['rooms','racks','locations']}),tables:{mice,cages,matings:(input.matings||[]).filter(row=>active(row)&&String(row.state).toLowerCase()==='active'),litters:[],rooms:input.rooms||[],racks:input.racks||[],locations:input.locations||[],light_events:input.light_events||[],husbandry_events:events}};
}
