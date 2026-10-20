import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCageStart,planCageStartDateEdit,validateCageStartDrafts,applyCageEntryStartDates,cageStartReadDependencies} from '../mouse-data/cage-start.js';
import {managedCoverage} from '../../../reagent-sheet-orders-2026-10-20/publication/mouse-data/current-record-scope.js';
const at='2026-10-20T04:00:00Z',asOf='2026-10-20';
const observation={schemaVersion:1,animals:[{tag:'P-M0001',dateOfBirth:'2026-05-01',sourceCell:'T10'}]};
function fixture({empty=false}={}){
 const position={location_id:'POS',room_id:'room_sheet_conventional',rack_id:'RACK',label:'A1',source_label:'A1',source_file_id:'CURRENT',source_sheet:'Conventional',source_cage_observation:empty?{schemaVersion:1,animals:[]}:structuredClone(observation)};
 return {managed_records_deferred:managedCoverage({fullTables:['rooms','racks','locations']}),tables:{rooms:[{room_id:'room_sheet_conventional',name:'SHLAC Conventional'}],racks:[],locations:[position],cages:[],mice:[],husbandry_events:empty?[]:[{event_id:'FIRST',event_type:'animal_sheet_cage_snapshot',source_cage_snapshot:{schema_version:1,snapshot_date:'2026-06-03',workbook_id:'BACKUP',sheet_name:'Conventional',room_label:'SHLAC Conventional',cage_label:'A1',source_header_cell:'T7',cage_observation:structuredClone(observation)}}],light_events:[]}};
}
const item=d=>({position:d.tables.locations[0],cage:d.tables.cages[0]||null});
test('current cards do not infer a cage start from incompletely loaded source history',()=>{
 for(const eventTypes of [[],['animal_sheet_cage_snapshot'],['animal_sheet_source_change']]){const d=fixture();d.managed_records_deferred=managedCoverage({eventTypes});const original=structuredClone(d);assert.equal(resolveCageStart(d,item(d),{asOf}).date,null);assert.deepEqual(d,original);}
});
test('both verified source-history scopes or a full event table permit historical inference',()=>{
 for(const coverage of [managedCoverage({eventTypes:['animal_sheet_cage_snapshot','animal_sheet_source_change']}),managedCoverage({fullTables:['husbandry_events']})]){const d=fixture();d.managed_records_deferred=coverage;const start=resolveCageStart(d,item(d),{asOf});assert.equal(start.date,'2026-06-03');assert.equal(start.basis,'resident_history');assert.equal(start.evidence[0].event_id,'FIRST');}
 const complete=fixture();delete complete.managed_records_deferred;assert.equal(resolveCageStart(complete,item(complete),{asOf}).date,'2026-06-03');
});
test('explicit manual, saved, setup and current sheet dates remain available in the compact read',()=>{
 for(const [fields,basis] of [[{start_date:'2026-06-05'},'recorded'],[{set_up_date:'2026-06-05'},'recorded'],[{cage_start:{schemaVersion:1,basis:'manual',date:'2026-06-05'}},'manual']]){const d=fixture();d.tables.cages=[{cage_sid:'CAGE',location_id:'POS',...fields}];const start=resolveCageStart(d,item(d),{asOf});assert.equal(start.date,'2026-06-05');assert.equal(start.basis,basis);}
 const literal=fixture();literal.tables.locations[0].source_cage_observation.startedDate='2026-06-05';assert.equal(resolveCageStart(literal,item(literal),{asOf}).date,'2026-06-05');
 const blank=fixture();blank.tables.cages=[{cage_sid:'CAGE',location_id:'POS',cage_start:{schemaVersion:1,basis:'manual',date:null}}];assert.equal(resolveCageStart(blank,item(blank),{asOf}).basis,'manual');assert.equal(resolveCageStart(blank,item(blank),{asOf}).date,null);
});
function firstEntry(coverage){const before=fixture({empty:true});before.managed_records_deferred=coverage;before.tables.cages=[{cage_sid:'CAGE',record_origin:'app_created',state:'Active',location_id:'POS'}];const after=structuredClone(before);after.tables.mice=[{mouse_sid:'NEW',state:'Stock',cage_sid:'CAGE'}];return {before,after};}
test('first-entry inference requires all mice and both population-movement event scopes',()=>{
 for(const coverage of [managedCoverage(),managedCoverage({eventTypes:['cage_move','cage_assignment']}),managedCoverage({fullTables:['mice'],eventTypes:['cage_move']}),managedCoverage({fullTables:['mice'],eventTypes:['cage_assignment']}),managedCoverage({fullTables:['husbandry_events']})]){const {before,after}=firstEntry(coverage);const original=structuredClone(after);assert.equal(applyCageEntryStartDates(before,after,{at}),after);assert.deepEqual(after,original);}
 for(const coverage of [managedCoverage({fullTables:['mice'],eventTypes:['cage_move','cage_assignment']}),managedCoverage({fullTables:['mice','husbandry_events']})]){const {before,after}=firstEntry(coverage),saved=applyCageEntryStartDates(before,after,{at});assert.equal(saved.tables.cages[0].start_date,asOf);assert.equal(saved.tables.cages[0].cage_start.basis,'entry');}
});
test('partial source-history evidence cannot be adopted during an otherwise complete mouse edit',()=>{
 const before=fixture();before.managed_records_deferred=managedCoverage({fullTables:['mice'],eventTypes:['cage_move','cage_assignment']});const after=structuredClone(before);after.tables.cages=[{cage_sid:'NEW',record_origin:'app_created',state:'Active',location_id:'POS'}];after.tables.mice=[{mouse_sid:'NEW',state:'Stock',cage_sid:'NEW'}];assert.equal(applyCageEntryStartDates(before,after,{at}),after);assert.equal(after.tables.cages[0].start_date,undefined);
});
test('invalid coverage fails closed and existing start edits remain intact',()=>{
 for(const marker of [{}, {schema_version:1,scope:'current-cages',full_tables:['mice','husbandry_events'],event_types:[]}, {schema_version:1,scope:'current-cages',full_tables:['husbandry_events'],event_types:['animal_sheet_cage_snapshot']}]){const d=fixture();d.managed_records_deferred=marker;assert.equal(resolveCageStart(d,item(d),{asOf}).date,null);const {before,after}=firstEntry(marker);after.tables.cages[0].start_date='2026-06-05';assert.equal(applyCageEntryStartDates(before,after,{at}),after);assert.equal(after.tables.cages[0].start_date,'2026-06-05');}
 const {before,after}=firstEntry(managedCoverage());const edits=planCageStartDateEdit(before,{cageSid:'CAGE'},'2026-06-05',{at});assert(validateCageStartDrafts(before,edits.changes,{at}));Object.assign(after.tables.cages[0],{start_date:'2026-06-05',cage_start:{schemaVersion:1,basis:'manual',date:'2026-06-05'}});assert.equal(applyCageEntryStartDates(before,after,{at}),after);assert.deepEqual(cageStartReadDependencies(before,after),[{type:'locations',id:'POS'}]);
});
