import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeDataset,ID_FIELDS} from '../mouse-data/model.js';
import {encodeArchive} from '../mouse-data/archive-format.js';
import {discoverCryoSources} from '../mouse-data/cryo-sources.js?v=178';
import {createCryoRegister,verifyCryoRegister} from '../mouse-data/cryo-register.js?v=178';
import {cryoSourceLotId} from '../mouse-data/cryopreservation-model.js';

class Storage {
 values=new Map();
 getItem(key){return this.values.get(key)??null;}
 setItem(key,value){this.values.set(key,String(value));}
 removeItem(key){this.values.delete(key);}
}
const colony='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const config={url:'https://test.supabase.co',anonKey:'sb_publishable_synthetic',colonyId:colony};
let sequence=0;
function installDatabase(){
 const saved=new Map(),deleted=Symbol('deleted');
 const db={close(){},objectStoreNames:{contains:()=>true},transaction(){
  const changes=new Map(),tx={};let pending=0,scheduled=false,active=true;
  tx.abort=()=>{active=false;queueMicrotask(()=>tx.onabort?.());};
  function run(fn){const request={};pending++;queueMicrotask(()=>{if(!active)return;request.result=structuredClone(fn());request.onsuccess?.();pending--;finish();});return request;}
  function finish(){if(pending||scheduled||!active)return;scheduled=true;queueMicrotask(()=>{scheduled=false;if(pending||!active)return;for(const [key,value] of changes)value===deleted?saved.delete(key):saved.set(key,value);active=false;tx.oncomplete?.();});}
  tx.objectStore=()=>({get:key=>run(()=>changes.has(key)?changes.get(key)===deleted?undefined:changes.get(key):saved.get(key)),put:(value,key)=>run(()=>{changes.set(key,structuredClone(value));return key;}),delete:key=>run(()=>changes.set(key,deleted))});return tx;
 }};
 globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
 return saved;
}
function sourceIndex(){
 const rows=[['Case ID','Strain','Batch IDs','Remaining quantity'],['CASE-1','Synthetic line','BATCH-1',8]];
 return {sources:[{file_id:'synthetic-sheet',title:'Synthetic Animal Sheet',snapshot_date:'2024-01-01',url:'https://example.invalid/sheet'}],sheets:[{source_index:0,title:'Cryopreservation',sheet_id:1}],cells:rows.flatMap((row,y)=>row.map((value,x)=>[0,`${String.fromCharCode(65+x)}${y+1}`,value,value,null,'General',null]))};
}
async function fixture(){
 globalThis.localStorage=new Storage();globalThis.sessionStorage=new Storage();const saved=installDatabase();
 const store=await import(`../mouse-data/data-store.js?cryo-deferred-${++sequence}`);
 const index=sourceIndex(),indexJSON=JSON.stringify(index),digest=createHash('sha256').update(indexJSON).digest('hex'),path=`${colony}/history/${digest}.json`;
 const register=await createCryoRegister(discoverCryoSources({tables:{historical_observations:[]}},index),{sourceArchiveSha256:digest});
 const original=normalizeDataset({schema_version:'1.0',sources:[],tables:{cryo_source_register:[register],mice:[{mouse_sid:'100001',sex:'Male',state:'Stock'}],historical_observations:[{observation_id:'source-1',raw_text:'Historical cryopreservation record'}],unloaded_history:[{text:'Keep this archive intact'}]}});
 const records=new Map();
 for(const [type,idField] of Object.entries(ID_FIELDS))for(const payload of original.tables[type])records.set(`${type}:${payload[idField]}`,{colony_id:colony,entity_type:type,entity_id:payload[idField],payload,version:1,archived:false});
 for(const row of await encodeArchive(original))records.set(`${row.entity_type}:${row.entity_id}`,{...row,colony_id:colony,version:1});

 const state={records,calls:[],policy:{version:0,owner:true,estimate:true,actual:true,source_archive_allowed:true},role:'owner',permissions:{},saved,index,path};
 globalThis.fetch=async(url,options={})=>{
  const parsed=new URL(url),body=options.body?JSON.parse(options.body):null;state.calls.push({url,options,body});
  if(parsed.pathname==='/auth/v1/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,user:{id:user,email:'owner@example.invalid'}});
  if(parsed.pathname==='/auth/v1/logout')return Response.json({});
  if(parsed.pathname.endsWith('/memberships'))return Response.json([{role:state.role,active:true,export_level:'max',permissions:state.permissions}]);
  if(parsed.pathname.endsWith('/rpc/get_lac_fee_visibility'))return Response.json(state.policy);
  if(parsed.pathname.endsWith('/entity_records')){
   const type=parsed.searchParams.get('entity_type')?.slice(3),filter=parsed.searchParams.get('entity_id'),ids=filter?.startsWith('in.(')?filter.slice(4,-1).split(','):null;
   const rows=[...records.values()].filter(row=>row.entity_type===type&&(!filter||(ids?ids.includes(row.entity_id):filter.startsWith('eq.')?row.entity_id===filter.slice(3):row.entity_id.localeCompare(filter.slice(3))>0))).sort((a,b)=>a.entity_id.localeCompare(b.entity_id)).slice(0,Number(parsed.searchParams.get('limit')??1000));
   return Response.json(parsed.searchParams.get('select')?.includes('payload')?rows:rows.map(({payload,...metadata})=>metadata));
  }
  if(parsed.pathname.endsWith('/rpc/save_records')){
   const changed=[];for(const value of body.p_changes){const key=`${value.entity_type}:${value.entity_id}`,old=records.get(key);if((old?.version??0)!==value.expected_version)return Response.json({code:'40001',message:'stale'},{status:409});const {expected_version,...payload}=value;changed.push({...payload,colony_id:colony,version:(old?.version??0)+1});}
   for(const row of changed)records.set(`${row.entity_type}:${row.entity_id}`,row);return Response.json(changed);
  }
  if(parsed.pathname==='/storage/v1/object/list/colony-history')return Response.json([{name:`${digest}.json`}]);
  if(parsed.pathname===`/storage/v1/object/authenticated/colony-history/${path}`)return new Response(indexJSON);
  throw new Error(`Unexpected mocked route: ${parsed.pathname}`);
 };
 store.configureCloud(config);await store.signIn('owner@example.invalid','synthetic-password');
 const data=await store.pullFromCloud({deferHistory:true});return Object.assign(state,{store,data});
}
const archiveRows=state=>structuredClone([...state.records].filter(([,row])=>row.entity_type==='archive'));
const writes=state=>state.calls.filter(call=>new URL(call.url).pathname.endsWith('/rpc/save_records')).flatMap(call=>call.body.p_changes);
function sourceLot(data,index){
 const source=discoverCryoSources(data,index).groups[0];assert(source);
 return {event_id:cryoSourceLotId(source.id),event_type:'cryopreservation_lot',event_date:'2026-10-17',source_case_key:source.id,source_reported_quantity:source.reported_remaining,source_snapshots:source.source_snapshots,record_origin:'app_created',notes:'Entered details retained',cryopreservation:{schema_version:1,label:'Synthetic source lot',case_id:source.case_id,strain:source.strain,batch_ids:source.batch_ids,material:'unknown',status:'unreviewed',quantity:null,quantity_unit:'straws',quantity_as_of_date:null,activity_revision:0,last_activity_id:null,donor_mouse_sids:[],manager:'Synthetic manager',storage_location:{facility:'Synthetic storage',tank:null,canister:null,position:null}}};
}

test('loading the verified compact register does not invalidate a deferred cryopreservation save',async()=>{
 const state=await fixture(),{store}=state;let data=await store.ensureHistory(state.data,{tables:['historical_observations']});
 const archive=archiveRows(state);data=await store.ensureHistory(data,{tables:['cryo_source_register']});const index=await verifyCryoRegister(data.tables.cryo_source_register[0]);
 const lot=sourceLot(data,index);data.tables.husbandry_events.push(lot);await store.saveDataset(data);
 assert.deepEqual(archiveRows(state),archive);assert.deepEqual(writes(state).map(row=>[row.entity_type,row.entity_id]),[['husbandry_events',lot.event_id]]);
 const saved=await store.loadDataset();assert.equal(saved.tables.husbandry_events[0].notes,'Entered details retained');assert.equal(saved.tables.unloaded_history,undefined);
 saved.tables.husbandry_events[0].notes='Second managed edit';await store.saveDataset(saved);assert.equal((await store.loadDataset()).tables.husbandry_events[0].notes,'Second managed edit');assert.deepEqual(archiveRows(state),archive);
});

test('compact register loading preserves incremental managed cache reuse after a later reload',async()=>{
 const state=await fixture();await state.store.ensureHistory(state.data,{tables:['cryo_source_register']});const start=state.calls.length;
 const data=await state.store.pullFromCloud({deferHistory:true});assert.deepEqual(data.tables.mice,state.data.tables.mice);
 const payloadReads=state.calls.slice(start).filter(call=>{const query=new URL(call.url).searchParams;return query.get('select')?.includes('payload')&&query.get('entity_type')!=='eq.archive';});
 assert.equal(payloadReads.length,0);assert.equal(data.tables.unloaded_history,undefined);
});

test('deferred archive content and manifest guards remain enforced after compact-register verification',async()=>{
 for(const mutate of [data=>data.sources.push({title:'Unverified source'}),data=>data.tables.historical_observations.push({raw_text:'Forged history'}),data=>data.source_archive_deferred.loaded_tables.push('unloaded_history'),data=>delete data.source_archive_deferred]){
  const state=await fixture(),data=await state.store.ensureHistory(state.data,{tables:['historical_observations','cryo_source_register']});await verifyCryoRegister(data.tables.cryo_source_register[0]);mutate(data);
  await assert.rejects(state.store.saveDataset(data),/deferred|Deferred/);assert.equal(writes(state).length,0);
 }
});

test('real cloud connection, member identity and fee visibility changes still reject deferred saves',async()=>{
 for(const field of ['url','anonKey','colonyId','user','permissions','fee-policy','reauthentication']){
  const state=await fixture(),{store}=state,data=await store.ensureHistory(state.data,{tables:['cryo_source_register']});await verifyCryoRegister(data.tables.cryo_source_register[0]);data.tables.mice[0].comment='Should not save';
  if(['url','anonKey','colonyId'].includes(field)){const values=JSON.parse(localStorage.getItem('mouse-colony.cloud.v1'));values[field]=field==='url'?'https://another.supabase.co':field==='colonyId'?'33333333-3333-4333-8333-333333333333':'sb_publishable_changed';localStorage.setItem('mouse-colony.cloud.v1',JSON.stringify(values));}
  else if(field==='user'){const value=JSON.parse(sessionStorage.getItem('mouse-colony.session.v1'));value.user.id='33333333-3333-4333-8333-333333333333';sessionStorage.setItem('mouse-colony.session.v1',JSON.stringify(value));}
  else if(field==='permissions')state.permissions={mice:true};
  else if(field==='fee-policy')state.policy.version++;
  else await store.signIn('owner@example.invalid','synthetic-password');
  await assert.rejects(store.saveDataset(data),/deferred|Deferred|latest cloud|account|visibility/i,field);assert.equal(writes(state).length,0,field);
 }
});

test('retired raw archive helpers reject without a Storage request',async()=>{const state=await fixture(),start=state.calls.length;for(const fn of ['downloadHistoryIndex','uploadHistoryIndex','fetchHistoryArchive','getFullSourceExport'])await assert.rejects(state.store[fn](),/retired/);assert.equal(state.calls.length,start);});
