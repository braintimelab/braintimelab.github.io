import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cid} from './current-store-fixture.mjs';
import {encodeArchive} from '../mouse-data/archive-format.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const urlPath=call=>new URL(call.url).pathname;
const memberships=calls=>calls.filter(call=>urlPath(call)==='/rest/v1/memberships'&&new URL(call.url).searchParams.get('select')?.includes('export_level'));
const fees=calls=>calls.filter(call=>urlPath(call)==='/rest/v1/rpc/get_lac_fee_visibility');
const current=(store,options={})=>store.pullFromCloud({currentOnly:true,deferHistory:true,...options});
async function colony({ended=0}={}){
 const f=await fixture({nas:false});f.store.setPrimaryCloudPolicy();await f.store.signIn('member@example.test','synthetic-password');
 for(const row of await encodeArchive({tables:{},schema_version:1}))f.state.records.set(row.entity_type+':'+row.entity_id,{...row,colony_id:cid,version:1});
 const add=(type,id,payload)=>f.state.records.set(type+':'+id,{colony_id:cid,entity_type:type,entity_id:id,version:1,archived:false,payload});
 add('mice','mouse-current',{mouse_sid:'mouse-current',state:'Stock',cage_sid:'cage-current'});
 add('cages','cage-current',{cage_sid:'cage-current',state:'Active'});
 add('rooms','room-one',{room_id:'room-one',name:'Synthetic Room'});
 for(let i=0;i<ended;i++){const id='ended-'+String(i).padStart(6,'0');add('mice',id,{mouse_sid:id,state:'Ended',comment:'Synthetic historical record '+i});}
 f.state.calls=[];return {...f,add};
}

test('current scope omits the contractually empty litter RPC and keeps the table deferred',async()=>{
 const {store,state}=await colony(),data=await current(store);
 assert.equal(state.managedPages.length,8);assert(!state.managedPages.some(page=>page.p_entity_type==='litters'));
 assert(store.getDeferredManagedTables(data).includes('litters'));assert.deepEqual(data.tables.litters,[]);
});

test('a historical visit leaves a compact atomic startup baseline, and warm opening never reads the full baseline',async()=>{
 const {store,state,cache,reload}=await colony({ended:3000});let data=await current(store);data=await store.ensureManagedTables(data,{tables:['mice']});
 const full=cache.get('current-cloud-baseline'),sidecar=cache.get('current-managed-snapshot');
 assert(full.entries.length>3000);assert.equal(sidecar.baseline.entries.length,3);assert.equal(sidecar.baseline.parent_sha256,full.sha256);
 assert(sidecar.baseline.managed_coverage.full_tables.includes('rooms'));assert(!sidecar.baseline.managed_coverage.full_tables.includes('mice'));
 assert(JSON.stringify(sidecar.baseline).length<JSON.stringify(full).length/100);
 state.storageReads=[];const next=await reload();next.setPrimaryCloudPolicy();assert(await next.loadStartupCache({currentOnly:true}));await current(next);
 assert(!state.storageReads.includes('current'));assert(!state.storageReads.includes('current-cloud-baseline'));
 assert.equal(next.getCloudStatus().readyForEdits,true);
});

test('a changed compact baseline falls back to fresh payloads and cannot promote an unchecked cache',async()=>{
 const {store,state,cache,reload}=await colony();await current(store);cache.get('current-managed-snapshot').baseline.entries[0][4]='0'.repeat(64);
 const next=await reload();next.setPrimaryCloudPolicy();const preview=await next.loadStartupCache({currentOnly:true});assert(preview);assert.equal(next.getCloudStatus().readyForEdits,false);
 await assert.rejects(next.saveDataset(preview),/reload|deferred|cloud/i);state.managedPages=[];await current(next);
 assert(state.managedPages.every(page=>page.p_metadata_only===false));assert.equal(next.getCloudStatus().readyForEdits,true);
});

test('old sidecars remain read-only previews and do not load the large baseline as a compatibility fallback',async()=>{
 const {store,state,cache,reload}=await colony();await current(store);delete cache.get('current-managed-snapshot').baseline;state.storageReads=[];
 const next=await reload();next.setPrimaryCloudPolicy();assert(await next.loadStartupCache({currentOnly:true}));assert.equal(next.getCloudStatus().readyForEdits,false);state.managedPages=[];await current(next);
 assert(state.managedPages.every(page=>page.p_metadata_only===false));assert(!state.storageReads.includes('current-cloud-baseline'));assert(cache.get('current-managed-snapshot').baseline);
});

test('the same immediate opening reuses its live access check but still checks live versions and final visibility',async()=>{
 const {store,state,reload}=await colony();await current(store);const next=await reload();next.setPrimaryCloudPolicy();const controller=new AbortController();
 assert(await next.loadStartupCache({currentOnly:true,signal:controller.signal}));state.calls=[];state.managedPages=[];await current(next,{signal:controller.signal});
 assert.equal(memberships(state.calls).length,0);assert.equal(fees(state.calls).length,1);assert.equal(state.managedPages.length,8);assert(state.managedPages.every(page=>page.p_metadata_only));
 const another=new AbortController();state.calls=[];await current(next,{signal:another.signal});assert.equal(memberships(state.calls).length,1);assert.equal(fees(state.calls).length,2);
});

test('an expired opening check is not carried across phone sleep',async()=>{
 const {store,state,reload}=await colony();await current(store);const next=await reload();next.setPrimaryCloudPolicy();const controller=new AbortController();
 assert(await next.loadStartupCache({currentOnly:true,signal:controller.signal}));const realNow=Date.now;const now=realNow();Date.now=()=>now+11000;
 try{state.calls=[];await current(next,{signal:controller.signal});assert.equal(memberships(state.calls).length,1);assert.equal(fees(state.calls).length,2);}finally{Date.now=realNow;}
});

test('a final visibility change rejects the opening lease before a writable baseline is published',async()=>{
 const {store,state,reload}=await colony();await current(store);const next=await reload();next.setPrimaryCloudPolicy();const controller=new AbortController();assert(await next.loadStartupCache({currentOnly:true,signal:controller.signal}));
 state.feePolicy={version:1,owner:true,estimate:true,actual:true,source_archive_allowed:true};
 await assert.rejects(current(next,{signal:controller.signal}),/visibility changed/);assert.equal(next.getCloudStatus().readyForEdits,false);
});

test('backgrounding aborts just the opening and late success cannot cache records or create a baseline',async()=>{
 const {store,state,cache}=await colony();await current(store);state.calls=[];let release,entered;const started=new Promise(resolve=>entered=resolve);const blocked=new Promise(resolve=>release=resolve);
 state.beforeFetch=async u=>{if(u.pathname==='/rest/v1/rpc/get_managed_record_page'){entered();await blocked;}};
 const controller=new AbortController(),opening=current(store,{signal:controller.signal});await started;const before=structuredClone([...cache]);controller.abort();
 await assert.rejects(opening,error=>error.name==='AbortError'&&error.code==='STARTUP_CANCELLED');assert.equal(store.getCloudStatus().readyForEdits,false);
 release();await tick();await tick();assert.deepEqual([...cache],before);assert.equal(store.getCloudStatus().activeCloud,'cloud1');assert(!state.calls.some(call=>urlPath(call).endsWith('/parallel_cloud_command')));
 state.beforeFetch=null;await current(store,{signal:new AbortController().signal});assert.equal(store.getCloudStatus().readyForEdits,true);
});

test('cancelStartupRead requires the exact opening handle and cannot cancel a different read',async()=>{
 const {store,state}=await colony();await current(store);state.calls=[];let release,entered;const started=new Promise(resolve=>entered=resolve),blocked=new Promise(resolve=>release=resolve);
 state.beforeFetch=async u=>{if(u.pathname==='/rest/v1/rpc/get_managed_record_page'){entered();await blocked;}};
 const controller=new AbortController(),opening=current(store,{signal:controller.signal});await started;
 assert.equal(store.cancelStartupRead(),false);assert.equal(store.cancelStartupRead({signal:new AbortController().signal}),false);assert.equal(store.cancelStartupRead({signal:controller.signal}),true);
 await assert.rejects(opening,error=>error.code==='STARTUP_CANCELLED');release();await tick();assert.equal(store.getCloudStatus().activeCloud,'cloud1');assert.equal(store.getCloudStatus().readyForEdits,false);
});

test('a failed read returned after background cancellation does not mark Cloud 1 unavailable or send writes',async()=>{
 const {store,state}=await colony();let reject,entered;const started=new Promise(resolve=>entered=resolve);const blocked=new Promise((_,r)=>reject=r);
 state.beforeFetch=async u=>{if(u.pathname==='/rest/v1/rpc/get_managed_record_page'){entered();await blocked;}};
 const controller=new AbortController(),opening=current(store,{signal:controller.signal});await started;controller.abort();await assert.rejects(opening,error=>error.name==='AbortError');reject(new TypeError('Background request lost'));await tick();await tick();
 assert.equal(store.getCloudStatus().activeCloud,'cloud1');assert.equal(store.getCloudConnections().sources.cloud1.state,'online');assert(!state.calls.some(call=>urlPath(call).endsWith('/parallel_cloud_command')));
});

test('cage-card opening defers bulky source history, preserves it on saves and retrieves it only when its menu asks',async()=>{
 const {store,state,cache,add}=await colony();
 for(let i=0;i<660;i++){const id='snapshot-'+i;add('husbandry_events',id,{event_id:id,event_type:'animal_sheet_cage_snapshot',source_cage_snapshot:{schema_version:1,block_text:'x'.repeat(3000)}});}
 add('husbandry_events','source-change',{event_id:'source-change',event_type:'animal_sheet_source_change',animal_sheet_change:{schema_version:1}});
 let data=await current(store);assert(!data.tables.husbandry_events.length);assert(!store.getDeferredManagedTables(data).includes('rooms'));assert(store.getDeferredManagedTables(data).includes('light_events'));
 assert.deepEqual(store.getDeferredManagedEventTypes(data,{eventTypes:['animal_sheet_cage_snapshot','animal_sheet_source_change']}),['animal_sheet_cage_snapshot','animal_sheet_source_change']);
 assert(state.managedPages.filter(page=>['light_events','husbandry_events'].includes(page.p_entity_type)).every(page=>page.p_scope==='cage_cards'));
 data.tables.cages[0].comment='A small current note';await store.saveDataset(data);assert.equal(state.records.get('husbandry_events:snapshot-0').version,1);assert.equal(state.records.get('husbandry_events:source-change').version,1);
 state.managedPages=[];data=await store.ensureManagedTables(data,{eventTypes:['animal_sheet_cage_snapshot','animal_sheet_source_change']});assert.equal(data.tables.husbandry_events.length,661);assert(state.managedPages.every(page=>page.p_scope==='event_types'));
 assert.equal(cache.get('current-managed-snapshot').schema_version,3);assert.equal(cache.get('current-managed-snapshot').data.tables.husbandry_events.length,0);
});

test('Cloud 2 fallback retains its existing supported complete reader and never receives the Cloud 1 cage-card RPC',async()=>{
 const {store,state}=await colony();state.nas=true;state.cloud=false;await store.refreshCloudConnections();assert.equal(store.getCloudStatus().activeCloud,'cloud2');state.calls=[];
 const data=await current(store);assert(data.tables.mice.some(row=>row.mouse_sid==='mouse-current'));assert.equal(store.getCloudStatus().activeCloud,'cloud2');assert(!data.managed_records_deferred);
 assert(!state.calls.some(call=>call.body?.route==='rpc/get_managed_record_page'));assert(!state.calls.some(call=>urlPath(call)==='/rest/v1/rpc/get_managed_record_page'));assert(state.calls.some(call=>call.body?.route?.startsWith('entity_records?')));
});
