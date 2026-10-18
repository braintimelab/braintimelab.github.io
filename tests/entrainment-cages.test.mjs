import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {normalizeDataset,validateRecord} from '../mouse-data/model.js';
import {cageEntrainmentRows,resolveCageEntrainment,loadCageEntrainmentFromLocobox,planCageEntrainmentRowsEdit} from '../mouse-data/cage-entrainment.js';
import {planCageSlotMove} from '../mouse-data/cage-movement.js';
import {applyCageSheetDrafts} from '../mouse-data/cage-sheet.js';

globalThis.crypto??=webcrypto;
const at='2026-10-18T04:00:00.000Z';
const observation={schemaVersion:1,startedDate:'2026-08-28',animals:[{tag:'P-M0001',dateOfBirth:'2026-07-01',sex:'Male',sourceCell:'A2',left:0,right:1}]};
function fixture(){return normalizeDataset({tables:{
 rooms:[{room_id:'R1',name:'Ani Beh'}],racks:[{rack_id:'K1',room_id:'R1',name:'LocoBoxes'}],
 locations:[{location_id:'P1',label:'L7',room_id:'R1',rack_id:'K1',source_current:true,source_cage_observation:structuredClone(observation)},{location_id:'P2',label:'L8',room_id:'R1',rack_id:'K1',source_current:true}],
 cages:[{cage_sid:'C1',cage_tag:'L7',state:'Active',room_id:'R1',rack_id:'K1',location_id:'P1'}],
 mice:[{mouse_sid:'00001',physical_tag:'P-M0001',sex:'Male',date_of_birth:'2026-07-01',state:'Stock',cage_sid:'C1'}],
 light_events:[{event_id:'LD-1',location_id:'P1',protocol:'LD',start_date:'2026-08-28',end_date:'2026-09-04',source_current:true},{event_id:'BLANK-2',location_id:'P1',protocol:'unknown',start_date:'2026-09-04',end_date:'2026-10-04',source_current:true}],husbandry_events:[]
}});}
const card=data=>({cage:data.tables.cages.find(row=>row.cage_sid==='C1'),position:data.tables.locations.find(row=>row.location_id===data.tables.cages[0].location_id)});
const apply=(data,plan)=>applyCageSheetDrafts(data,plan.changes,{at});

test('dated blank source phases remain selectable cage rows and current unknown is not relabeled LD or DD',()=>{
 const data=fixture(),before=structuredClone(data);
 assert.deepEqual(cageEntrainmentRows(data,card(data)),[{date:'2026-08-28',scheme:'LD'},{date:'2026-09-04',scheme:'unknown'}]);
 assert.equal(resolveCageEntrainment(data,card(data),{asOf:'2026-09-15'}).scheme,'unknown');
 assert.deepEqual(data,before,'reading imported schedules does not materialize or rewrite cage metadata');
});

test('SP2 and LP2 source conditions drive current cage badges instead of literal LD template labels',()=>{
 for(const scheme of ['SP2','LP2']){
  const data=fixture();data.tables.light_events=[{event_id:scheme,location_id:'P1',protocol:'LD',source_group_condition:scheme,start_date:'2026-10-01',end_date:'2026-11-01',source_current:true}];
  const resolved=resolveCageEntrainment(data,card(data),{asOf:'2026-10-18'});
  assert.equal(resolved.scheme,scheme);assert.equal(resolved.basis,'schedule');
  assert.deepEqual(cageEntrainmentRows(data,card(data)),[{date:'2026-10-01',scheme}]);
 }
});

test('a saved whole-cage move keeps the source card schedule and does not adopt destination lighting',()=>{
 const data=fixture();data.tables.light_events=[{event_id:'ORIGIN',location_id:'P1',protocol:'SP2',start_date:'2026-10-01',end_date:'2026-11-01',source_current:true,source_cohort_observation:{basis:'current_card_at_capture_not_phase_cohort',animals:structuredClone(observation.animals)}},{event_id:'DESTINATION',location_id:'P2',protocol:'LP2',start_date:'2026-10-01',end_date:'2026-11-01',source_current:true}];
 const oldMice=structuredClone(data.tables.mice),before=structuredClone(data),move=planCageSlotMove(data,'P1','P2');
 assert.deepEqual(data,before,'drafting a move changes no source records');
 const saved=apply(data,move),moved=card(saved);
 assert.equal(moved.cage.location_id,'P2');assert.equal(moved.cage.cage_sheet_card.source_location_id,'P1');
 assert.equal(resolveCageEntrainment(saved,moved,{asOf:'2026-10-18'}).scheme,'SP2');
 assert.deepEqual(cageEntrainmentRows(saved,moved),[{date:'2026-10-01',scheme:'SP2'}]);
 assert.equal(saved.tables.mice[0].cage_sid,oldMice[0].cage_sid,'the physical cage keeps its animal identity');
 assert.deepEqual(saved.tables.light_events,data.tables.light_events,'position observations are not rewritten by a move');
});

test('Load imports a source-context schedule for a registered cage without an exact managed protocol',()=>{
 const data=fixture(),before=structuredClone(data),plan=loadCageEntrainmentFromLocobox(data,{cageSid:'C1'});
 const saved=apply(data,plan),cage=saved.tables.cages.find(row=>row.cage_sid==='C1');
 assert.deepEqual(cage.cage_entrainment,{schemaVersion:1,entries:[{date:'2026-08-28',scheme:'LD'},{date:'2026-09-04',scheme:'unknown'}]});
 assert.deepEqual(validateRecord('cages',cage,saved,'C1').errors,[]);
 assert.deepEqual(saved.tables.husbandry_events,[],'loading a card does not invent an exposure protocol');
 assert.deepEqual(saved.tables.mice,before.tables.mice);assert.deepEqual(data,before);
});

test('unknown remains a valid saved editable condition and an explicit correction updates the badge',()=>{
 const data=fixture(),plan=planCageEntrainmentRowsEdit(data,{cageSid:'C1'},[{date:'2026-10-01',scheme:'unknown'}]);
 const saved=apply(data,plan);assert.equal(resolveCageEntrainment(saved,card(saved),{asOf:'2026-10-18'}).scheme,'unknown');
 const correction=planCageEntrainmentRowsEdit(saved,{cageSid:'C1'},[{date:'2026-10-01',scheme:'SP2'}]);
 const corrected=apply(saved,correction);
 assert.equal(resolveCageEntrainment(corrected,card(corrected),{asOf:'2026-10-18'}).scheme,'SP2');
 assert.deepEqual(corrected.tables.light_events,data.tables.light_events,'manual corrections preserve source observations');
});

test('a source-context Load draft refuses a changed source schedule before saving',()=>{
 const data=fixture();data.tables.light_events[1].protocol='SP2';
 const plan=loadCageEntrainmentFromLocobox(data,{cageSid:'C1'}),fresh=structuredClone(data);
 fresh.tables.light_events[1].protocol='DD';
 assert.throws(()=>apply(fresh,plan),/source|schedule|entrainment|changed|reload/i);
});
