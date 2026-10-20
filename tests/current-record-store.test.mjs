import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cid} from './current-store-fixture.mjs';
import {encodeArchive} from '../mouse-data/archive-format.js';
import {managedCoverage,checkedManagedCoverage,getDeferredManagedEventTypes} from '../mouse-data/current-record-scope.js';
async function colony(){
 const f=await fixture({nas:false});f.store.setPrimaryCloudPolicy();await f.store.signIn('member@example.test','synthetic-password');
 for(const row of await encodeArchive({tables:{},schema_version:1}))f.state.records.set(row.entity_type+':'+row.entity_id,{...row,colony_id:cid,version:1});
 const add=(type,id,payload)=>f.state.records.set(type+':'+id,{colony_id:cid,entity_type:type,entity_id:id,version:1,archived:false,payload});
 add('mice','mouse-current',{mouse_sid:'mouse-current',state:'Stock',physical_tag:'same-tag',date_of_birth:'2026-01-01',cage_sid:'cage-current'});
 add('mice','mouse-ended',{mouse_sid:'mouse-ended',state:'Ended',physical_tag:'same-tag',date_of_birth:'2026-01-01',cage_sid:'cage-ended'});
 add('cages','cage-current',{cage_sid:'cage-current',state:'Active',cage_tag:'C1',location_id:'slot-one'});
 add('cages','cage-ended',{cage_sid:'cage-ended',state:'Inactive',cage_tag:'Old'});
 add('rooms','room-one',{room_id:'room-one',name:'Room'});add('racks','rack-one',{rack_id:'rack-one',room_id:'room-one',name:'Rack'});
 add('locations','slot-one',{location_id:'slot-one',room_id:'room-one',rack_id:'rack-one',label:'Slot'});
 add('husbandry_events','strain-one',{event_id:'strain-one',event_type:'strain_definition',strain_definition:{name:'Synthetic strain'}});
 add('husbandry_events','experiment-draft',{event_id:'experiment-draft',event_type:'experiment',experiment:{status:'unreviewed',title:'Unused imported draft'}});
 add('husbandry_events','experiment-current',{event_id:'experiment-current',event_type:'experiment',experiment:{status:'planned',title:'Current work',participants:[{link_status:'confirmed',mouse_sid:'mouse-current'}]}});
 add('husbandry_events','badge-current',{event_id:'badge-current',event_type:'cage_equipment_status',location_id:'slot-one'});
 return {...f,add};
}
const current=store=>store.pullFromCloud({currentOnly:true,deferHistory:true});
test('current startup requests bounded current pages and leaves ended animals, inactive cages and imported drafts unloaded',async()=>{
 const {store,state}=await colony(),data=await current(store);
 assert.deepEqual(data.tables.mice.map(r=>r.mouse_sid),['mouse-current']);assert.deepEqual(data.tables.cages.map(r=>r.cage_sid),['cage-current']);
 assert(!data.tables.husbandry_events.some(r=>r.event_id==='experiment-draft'));assert(!data.tables.husbandry_events.some(r=>r.event_id==='strain-one'));
 assert(data.tables.husbandry_events.some(r=>r.event_id==='experiment-current'));
 assert(state.managedPages.length>=8);assert(state.managedPages.every(p=>p.p_scope===(['light_events','husbandry_events'].includes(p.p_entity_type)?'cage_cards':'current')&&p.p_limit<=1000));
 assert(store.getDeferredManagedTables(data).includes('mice'));assert(store.getDeferredManagedEventTypes(data,{eventTypes:['strain_definition']}).includes('strain_definition'));
 const scans=state.calls.filter(c=>new URL(c.url).pathname==='/rest/v1/entity_records'&&Number(new URL(c.url).searchParams.get('limit'))>1);assert.equal(scans.length,0);
});
test('opening Mice and Strains hydrates only requested scopes and retains unloaded experiment data server-side',async()=>{
 const {store,state}=await colony();let data=await current(store);state.managedPages=[];
 data=await store.ensureManagedTables(data,{tables:['mice'],eventTypes:['strain_definition']});
 assert.equal(data.tables.mice.length,2);assert(data.tables.husbandry_events.some(r=>r.event_id==='strain-one'));assert(!data.tables.husbandry_events.some(r=>r.event_id==='experiment-draft'));
 assert(!store.getDeferredManagedTables(data).includes('mice'));assert.deepEqual(store.getDeferredManagedEventTypes(data,{eventTypes:['strain_definition']}),[]);
 assert(state.managedPages.some(p=>p.p_scope==='full'&&p.p_entity_type==='mice'));assert(state.managedPages.some(p=>p.p_scope==='event_types'&&p.p_event_types.join(',')==='strain_definition'));
 assert(!state.managedPages.some(p=>p.p_scope==='full'&&p.p_entity_type==='husbandry_events'));
 data.tables.cages[0].comment='A small cage note';await store.saveDataset(data);
 assert.equal(state.records.get('cages:cage-current').payload.comment,'A small cage note');assert(state.records.has('mice:mouse-ended'));assert(state.records.has('husbandry_events:experiment-draft'));
});
test('partial identity edits and forged coverage do not send a write or erase the draft',async()=>{
 const {store,state}=await colony(),data=await current(store);data.tables.mice[0].physical_tag='new-tag';
 await assert.rejects(store.saveDataset(data),/Open Mice/);assert.equal(data.tables.mice[0].physical_tag,'new-tag');assert.equal(state.records.get('mice:mouse-current').payload.physical_tag,'same-tag');
 data.tables.mice[0].physical_tag='same-tag';data.tables.cages[0].comment='Keep this draft';delete data.managed_records_deferred;
 await assert.rejects(store.saveDataset(data),/coverage changed/);assert.equal(data.tables.cages[0].comment,'Keep this draft');assert(!state.calls.some(c=>new URL(c.url).pathname.endsWith('/parallel_cloud_command')));
});
test('warm startup reuses an atomic current cache but still verifies current scope and never scans all events',async()=>{
 const {store,state,reload}=await colony();await current(store);state.managedPages=[];state.calls=[];
 const next=await reload();next.setPrimaryCloudPolicy();const preview=await next.loadStartupCache();assert(preview?.managed_records_deferred);const data=await current(next);
 assert.equal(data.tables.mice.length,1);assert(state.managedPages.every(p=>p.p_metadata_only));assert(state.managedPages.every(p=>p.p_scope===(['light_events','husbandry_events'].includes(p.p_entity_type)?'cage_cards':'current')));assert.equal(next.getCloudStatus().activeCloud,'cloud1');
 assert(state.calls.filter(c=>new URL(c.url).pathname.endsWith('/rpc/get_managed_record_page')).every(c=>new URL(c.url).origin==='https://cloud.example'));
 assert(!state.calls.some(c=>new URL(c.url).pathname==='/rest/v1/entity_records'&&new URL(c.url).searchParams.get('entity_type')==='eq.husbandry_events'));
});
test('background refresh preserves already opened scopes without silently loading all events',async()=>{
 const {store,state}=await colony();let data=await current(store);data=await store.ensureManagedTables(data,{tables:['mice'],eventTypes:['strain_definition']});state.managedPages=[];
 await store.refreshCurrentRecords({source:'cloud1'});
 assert(state.managedPages.some(p=>p.p_entity_type==='mice'&&p.p_scope==='full'));assert(state.managedPages.some(p=>p.p_entity_type==='husbandry_events'&&p.p_scope==='event_types'&&p.p_event_types.includes('strain_definition')));
 assert(!state.managedPages.some(p=>p.p_entity_type==='husbandry_events'&&p.p_scope==='full'));
});
test('missing current-read RPC fails visibly without falling back to the full historical table scan',async()=>{
 const {store,state}=await colony();state.managedError=true;state.calls=[];await assert.rejects(current(store),/current-record service is not available\. Retry loading/);
 assert(!state.calls.some(c=>new URL(c.url).pathname==='/rest/v1/entity_records'&&Number(new URL(c.url).searchParams.get('limit'))>1));
});
test('manual cage entrainment propagates by exact mouse ID while raw source-card tag matching stays disabled',async()=>{
 const {store,state,add}=await colony();
 add('light_events','source-ambiguous',{event_id:'source-ambiguous',location_id:'slot-one',start_date:'2026-10-20',protocol:'DD',source_current:true,source_last_seen_at:'2026-10-20T00:00:00Z',source_cohort_observation:{observed_at:'2026-10-20T00:00:00Z',animals:[{tag:'same-tag',dateOfBirth:'2026-01-01',sourceCell:'A1'}]}});
 const data=await current(store);data.tables.cages[0].cage_entrainment={schemaVersion:1,entries:[{date:'2026-10-20',scheme:'DD'}]};data.tables.cages[0].app_updated_at='2026-10-20T00:00:00Z';
 await store.saveDataset(data);
 const exposures=[...state.records.values()].filter(row=>row.payload.event_type==='mouse_entrainment');assert(exposures.some(row=>row.payload.mouse_sid==='mouse-current'&&row.payload.entrainment.source_event_id==='cage:cage-current'));
 assert(!exposures.some(row=>row.payload.entrainment.source_event_id==='source-ambiguous'));assert.equal(state.records.get('light_events:source-ambiguous').payload.protocol,'DD');
});
test('coverage markers reject unknown fields and never promote a partial typed event set to the whole event table',()=>{
 const marker=managedCoverage({fullTables:['rooms'],eventTypes:['strain_definition']});assert.deepEqual(getDeferredManagedEventTypes({managed_records_deferred:marker},{eventTypes:['strain_definition','experiment']}),['experiment']);
 assert.throws(()=>checkedManagedCoverage({...marker,all_history:true}),/coverage/);assert.throws(()=>managedCoverage({eventTypes:['arbitrary_unreviewed_type']}),/supported/);
});
test('opening ended mouse identities does not synthesize an unloaded ended-animal entrainment record during an unrelated save',async()=>{
 const {store,state,add}=await colony();
 add('husbandry_events','locobox-ended',{event_id:'locobox-ended',event_type:'locobox_protocol',app_created_at:'2026-10-20T00:00:00Z',locobox_protocol:{status:'completed',link_status:'confirmed',evidence_status:'recorded',animal_sids:['mouse-ended'],phases:[{phase_id:'phase-one',start_date:'2026-10-20',scheme:'DD'}]}});
 const id='ENTRAIN:mouse-ended:locobox-ended:phase-one';add('husbandry_events',id,{event_id:id,event_type:'mouse_entrainment',mouse_sid:'mouse-ended',entrainment:{source_event_id:'locobox-ended',source_phase_id:'phase-one'}});
 let data=await current(store);assert(!data.tables.husbandry_events.some(row=>row.event_id===id));data=await store.ensureManagedTables(data,{tables:['mice']});data.tables.cages[0].comment='Unrelated cage note';state.calls=[];await store.saveDataset(data);
 assert.equal(state.records.get('husbandry_events:'+id).version,1);assert(!state.calls.filter(c=>new URL(c.url).pathname.endsWith('/parallel_cloud_command')).some(c=>c.body.p_args.p_changes.some(row=>row.entity_id===id)));
});
test('a changed feature record between version verification and its payload read is rejected without replacing the current view',async()=>{
 const {store,state}=await colony(),data=await current(store);let changed=false;
 state.onRead=route=>{if(!changed&&route.startsWith('entity_records?')&&route.includes('strain-one')){changed=true;const row=state.records.get('husbandry_events:strain-one');row.version++;row.payload.note='Concurrent server change';}};
 await assert.rejects(store.ensureManagedTables(data,{eventTypes:['strain_definition']}),/changed during loading/);assert.equal(data.tables.mice.length,1);assert(!data.tables.husbandry_events.some(row=>row.event_id==='strain-one'));
 state.onRead=null;const retried=await store.ensureManagedTables(data,{eventTypes:['strain_definition']});assert.equal(retried.tables.husbandry_events.find(row=>row.event_id==='strain-one').note,'Concurrent server change');
});
test('logging out during an on-demand read prevents a late response from becoming a cache or editable baseline',async()=>{
 const {store,state}=await colony(),data=await current(store);let logout;
 state.onManaged=body=>{if(body.p_scope==='event_types'&&!logout)logout=store.signOut();};
 await assert.rejects(store.ensureManagedTables(data,{eventTypes:['strain_definition']}),/account|workspace|access|shared data/i);await logout;assert.equal(store.getCloudStatus().signedIn,false);assert.notEqual(store.getCloudStatus().activeCloud,'cloud1');await assert.rejects(store.saveDataset(data),/deferred workspace/i);
});
test('legacy full-cache startup skips reading and hashing its large dataset, then replaces only the verified cache after current loading',async()=>{
 const {store,state,cache,reload}=await colony();await store.pullFromCloud({deferHistory:true});
 const key='mouse-colony.cloud-cache-context.v1',mark=JSON.parse(localStorage.getItem(key));delete mark.startup_cache_version;localStorage.setItem(key,JSON.stringify(mark));
 const old=structuredClone(cache.get('current'));state.storageReads=[];state.managedPages=[];const next=await reload();next.setPrimaryCloudPolicy();assert.equal(await next.loadStartupCache({currentOnly:true}),null);assert.equal(state.storageReads.length,0);assert.deepEqual(cache.get('current'),old);
 const data=await current(next);assert.equal(data.tables.mice.length,1);assert(state.managedPages.every(p=>p.p_scope===(['light_events','husbandry_events'].includes(p.p_entity_type)?'cage_cards':'current')&&!p.p_metadata_only));assert(!state.storageReads.includes('current'));assert(!state.storageReads.includes('current-managed-snapshot'));
});
test('opening historical identities and imported experiments does not enlarge the next startup sidecar or promote preview coverage',async()=>{
 const {store,state,cache,reload}=await colony();let data=await current(store);data=await store.ensureManagedTables(data,{tables:['mice'],eventTypes:['experiment','strain_definition']});
 assert.equal(data.tables.mice.length,2);assert(data.tables.husbandry_events.some(row=>row.event_id==='experiment-draft'));
 const sidecar=cache.get('current-managed-snapshot');assert.equal(sidecar.schema_version,3);assert.equal(sidecar.data.tables.mice.length,1);assert(!sidecar.data.tables.husbandry_events.some(row=>row.event_id==='experiment-draft'));
 const next=await reload();next.setPrimaryCloudPolicy();const preview=await next.loadStartupCache({currentOnly:true});assert(preview.managed_records_deferred);assert(next.getDeferredManagedTables(preview).includes('mice'));state.managedPages=[];const fresh=await current(next);assert.equal(fresh.tables.mice.length,1);assert(state.managedPages.every(p=>p.p_scope===(['light_events','husbandry_events'].includes(p.p_entity_type)?'cage_cards':'current')&&p.p_metadata_only));
});
test('sanitized member cache keeps its coverage before financial filtering and reuses verified current records',async()=>{
 const {store,state,cache,reload}=await colony();await store.signOut();state.role='editor';state.feePolicy={version:0,owner:false,estimate:false,actual:false,source_archive_allowed:false};await store.signIn('member@example.test','synthetic-password');
 let data=await current(store);assert(data.source_archive_restricted);assert.deepEqual(cache.get('current-cloud-baseline').managed_coverage,data.managed_records_deferred);
 data=await store.ensureManagedTables(data,{eventTypes:['strain_definition']});assert(cache.get('current-cloud-baseline').managed_coverage.event_types.includes('strain_definition'));
 const next=await reload();next.setPrimaryCloudPolicy();assert(await next.loadStartupCache({currentOnly:true}));state.managedPages=[];state.calls=[];const fresh=await current(next);assert(fresh.source_archive_restricted);assert(state.managedPages.some(page=>page.p_metadata_only));
 assert(!state.calls.some(call=>/rpc\/(get_lac_fee_records|get_managed_locations)$/.test(new URL(call.url).pathname)));
});
test('a previous source-history visit does not re-encode or claim those archive tables in the next startup preview',async()=>{
 const {store,state,cache,reload}=await colony();for(const row of await encodeArchive({tables:{parent_links:[{child:'synthetic-child',parent:'synthetic-parent'}]},schema_version:1}))state.records.set(row.entity_type+':'+row.entity_id,{...row,colony_id:cid,version:1});
 let data=await current(store);data=await store.ensureHistory(data,{tables:['parent_links']});assert.equal(data.tables.parent_links.length,1);assert(data.source_archive_deferred.loaded_tables.includes('parent_links'));
 const sidecar=cache.get('current-managed-snapshot');assert(!Object.hasOwn(sidecar.data.tables,'parent_links'));assert.deepEqual(sidecar.data.source_archive_deferred.loaded_tables,[]);
 const next=await reload();next.setPrimaryCloudPolicy();const preview=await next.loadStartupCache({currentOnly:true});assert.deepEqual(preview.source_archive_deferred.loaded_tables,[]);state.managedPages=[];state.calls=[];const fresh=await current(next);assert.equal(fresh.tables.parent_links.length,0);assert(state.managedPages.every(page=>page.p_metadata_only));assert(!state.calls.some(call=>new URL(call.url).pathname==='/rest/v1/entity_records'&&new URL(call.url).searchParams.get('entity_id')?.includes('chunk:')));
});
