import test from 'node:test';
import assert from 'node:assert/strict';
import {currentCacheProjection} from '../mouse-data/current-record-scope.js';
const fixture=()=>({tables:{mice:[{mouse_sid:'current-mouse',state:'Stock',cage_sid:'current-cage'},{mouse_sid:'ended-mouse',state:'Ended'}],cages:[{cage_sid:'current-cage',state:'Active',location_id:'current-slot',cage_sheet_card:{schemaVersion:1,source_location_id:'retained-slot'}}],locations:[{location_id:'current-slot',room_id:'room',rack_id:'rack'},{location_id:'retained-slot',source_current:false},{location_id:'old-slot',source_current:false}],light_events:[],husbandry_events:[]}});
const ids=rows=>rows.map(row=>row.event_id).sort();
test('opening cache excludes source snapshots, changes and movement history without modifying their original arrays',()=>{
 const data=fixture();for(const event_type of ['animal_sheet_cage_snapshot','animal_sheet_source_change','source_manager_observation','cage_move','cage_assignment','cage_location_assignment'])for(let i=0;i<100;i++)data.tables.husbandry_events.push({event_id:event_type+i,event_type,notes:'x'.repeat(1000)});
 const before=structuredClone(data),cache=currentCacheProjection(data);assert.equal(cache.tables.husbandry_events.length,0);assert.deepEqual(data,before);assert(!cache.managed_records_deferred.full_tables.includes('husbandry_events'));
});
test('all exact current-cage and current-mouse light intervals remain, while unrelated historical slot copies are omitted',()=>{
 const data=fixture();data.tables.light_events=[{event_id:'explicit-old-cage-phase',source_current:false,cage_sid:'current-cage',start_date:'2025-01-01',end_date:'2025-02-01'},{event_id:'explicit-old-mouse-phase',source_historical:true,mouse_sid:'current-mouse'},{event_id:'old-unlinked-slot',source_current:false,location_id:'current-slot'},{event_id:'old-map',record_origin:'current_google_sheet_map',location_id:'current-slot'},{event_id:'current-phase-1',record_origin:'current_google_sheet_map',source_current:true,location_id:'current-slot',start_date:'2026-08-01'},{event_id:'current-phase-2',record_origin:'current_google_sheet_map',source_current:true,location_id:'current-slot',start_date:'2026-09-01'},{event_id:'manual-phase',location_id:'current-slot'},{event_id:'different-cage',cage_sid:'old-cage',location_id:'current-slot'},{event_id:'room-phase',room_id:'room'}];
 assert.deepEqual(ids(currentCacheProjection(data).tables.light_events),['current-phase-1','current-phase-2','different-cage','explicit-old-cage-phase','explicit-old-mouse-phase','manual-phase','old-map','room-phase']);
});
test('the complete stored entrainment interval sequence follows each current animal, without importing ended animals',()=>{
 const data=fixture();data.tables.husbandry_events=[{event_id:'phase-1',event_type:'mouse_entrainment',mouse_sid:'current-mouse',entrainment:{start_date:'2025-01-01',source_event_id:'source-one'}},{event_id:'phase-2',event_type:'mouse_entrainment',mouse_sid:'current-mouse',entrainment:{start_date:'2026-01-01',source_event_id:'source-two'}},{event_id:'ended-phase',event_type:'mouse_entrainment',mouse_sid:'ended-mouse'}];
 assert.deepEqual(ids(currentCacheProjection(data).tables.husbandry_events),['phase-1','phase-2']);
});
test('all competing source reviews and complete relevant protocols are retained through exact source identity closure',()=>{
 const data=fixture(),protocol=(id,p)=>({event_id:id,event_type:'locobox_protocol',locobox_protocol:p});data.tables.light_events=[{event_id:'source-one',location_id:'current-slot',source_current:true}];
 data.tables.husbandry_events=[protocol('current-protocol',{cage_sid:'current-cage',phases:[{start_date:'2026-08-01'},{start_date:'2026-09-01'}]}),protocol('review-one',{reviewed_source_event_id:'source-one',location_id:'old-slot',phases:[{scheme:'T25'}]}),protocol('review-two',{reviewed_source_event_id:'source-one',location_id:'old-slot',phases:[{scheme:'T22'}]}),protocol('unrelated',{location_id:'old-slot'}),{event_id:'top-level',event_type:'locobox_protocol',location_id:'current-slot',locobox_protocol:{phases:[{scheme:'DD'}]}},protocol('exact-animal',{animal_sids:['current-mouse'],phases:[{scheme:'LD'}]})];
 const rows=currentCacheProjection(data).tables.husbandry_events;assert.deepEqual(ids(rows),['current-protocol','exact-animal','review-one','review-two','top-level']);assert.equal(rows.find(row=>row.event_id==='current-protocol').locobox_protocol.phases.length,2);
});
test('equipment and source-card badges remain with current positions and their retained source cards',()=>{
 const data=fixture();data.tables.husbandry_events=[{event_id:'equipment',event_type:'cage_equipment_status',location_id:'current-slot'},{event_id:'retained-card',event_type:'cage_card_badge_status',location_id:'retained-slot'},{event_id:'nested-equipment',event_type:'cage_equipment_status',equipment_status:{location_id:'current-slot'}},{event_id:'old-card',event_type:'cage_card_badge_status',location_id:'old-slot'},{event_id:'summary',event_type:'cage_summary_options'}];
 assert.deepEqual(ids(currentCacheProjection(data).tables.husbandry_events),['equipment','nested-equipment','retained-card','summary']);
});
test('only a confirmed current mouse receives an opening experiment badge',()=>{
 const data=fixture(),experiment=(id,status,mouse,link)=>({event_id:id,event_type:'experiment',experiment:{status,participants:[{mouse_sid:mouse,link_status:link}]}});data.tables.husbandry_events=[experiment('current-work','in_progress','current-mouse','confirmed'),experiment('planned-work','planned','current-mouse','confirmed'),experiment('unconfirmed','planned','current-mouse','candidate'),experiment('ended-work','planned','ended-mouse','confirmed'),experiment('completed','completed','current-mouse','confirmed')];
 assert.deepEqual(ids(currentCacheProjection(data).tables.husbandry_events),['current-work','planned-work']);
});
