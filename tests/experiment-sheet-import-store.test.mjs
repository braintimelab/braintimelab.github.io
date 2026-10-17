import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../mouse-data/data-store.js';
class Storage{values=new Map();getItem(key){return this.values.get(key)??null;}setItem(key,value){this.values.set(key,String(value));}removeItem(key){this.values.delete(key);}clear(){this.values.clear();}}
const colony='11111111-1111-4111-8111-111111111111',uid='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const config={url:'https://test.supabase.co',anonKey:'sb_publishable_synthetic',colonyId:colony};
async function fixture(t,role='editor',permissions={}){
 const previous={fetch:globalThis.fetch,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage};t.after(()=>Object.assign(globalThis,previous));
 globalThis.localStorage=new Storage();globalThis.sessionStorage=new Storage();store.configureCloud(config);
 const state={role,permissions,calls:[],wait:null,started:null};
 globalThis.fetch=async(url,init={})=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;state.calls.push({path,body,init});
  if(path==='/auth/v1/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,user:{id:uid,email:'member@example.invalid'}});
  if(path==='/rest/v1/memberships')return Response.json([{role:state.role,permissions:state.permissions,active:state.active!==false,export_level:'low'}]);
  if(path.startsWith('/rest/v1/rpc/')){state.started?.();if(state.wait)await state.wait;return Response.json(path.endsWith('/request_experiment_sheet_import')?{job_id:'J',status:'queued'}:path.endsWith('/get_experiment_sheet_import_status')?{configured:true,enabled:true,status:'ready'}:{conflicts:[],total:0,next_offset:null});}
  throw Error('Unexpected synthetic route '+path);
 };
 await store.signIn('member@example.invalid','synthetic-password');return state;
}
test('Experiment imports use only their dedicated RPCs and recheck active membership for every call',async t=>{
 const state=await fixture(t,'manager',{imports:true,experiments:true});state.calls=[];
 assert.equal((await store.startExperimentSheetImport()).status,'queued');
 assert.equal((await store.getExperimentSheetImportStatus()).status,'ready');
 assert.equal((await store.getExperimentSheetImportConflicts({offset:20,limit:40})).total,0);
 assert.deepEqual(state.calls.map(c=>c.path),[
  '/rest/v1/memberships','/rest/v1/rpc/request_experiment_sheet_import',
  '/rest/v1/memberships','/rest/v1/rpc/get_experiment_sheet_import_status',
  '/rest/v1/memberships','/rest/v1/rpc/get_experiment_sheet_import_conflicts'
 ]);
 assert.deepEqual(state.calls.at(-1).body,{p_colony_id:colony,p_offset:20,p_limit:40});
 for(const call of state.calls.filter(c=>c.path.includes('/rpc/'))){assert.equal(call.init.cache,'no-store');assert.equal(call.init.redirect,'error');}
 assert.doesNotMatch(JSON.stringify(state.calls),/animal_sheet|sync_secret|service_role/);
});
test('denied, removed and partially permitted managers never request Experiment data or imports',async t=>{
 const state=await fixture(t);
 for(const [role,permissions,active]of [['viewer',{},true],['manager',{imports:false,experiments:true},true],['manager',{imports:true,experiments:false},true],['manager',{},true],['owner',{},false]]){
  Object.assign(state,{role,permissions,active});
  for(const action of ['startExperimentSheetImport','getExperimentSheetImportStatus','getExperimentSheetImportConflicts']){state.calls=[];await assert.rejects(store[action]());assert.deepEqual(state.calls.map(c=>c.path),['/rest/v1/memberships']);}
 }
});
test('conflict bounds reject before requesting any source information',async t=>{
 const state=await fixture(t);state.calls=[];
 for(const input of [{offset:-1},{offset:1.5},{limit:0},{limit:201},{limit:Infinity}])await assert.rejects(store.getExperimentSheetImportConflicts(input),/valid conflict page/);
 assert.equal(state.calls.length,0);
});
test('late start, status and conflict responses cannot cross a changed colony or signed-in identity',async t=>{
 for(const action of ['startExperimentSheetImport','getExperimentSheetImportStatus','getExperimentSheetImportConflicts']){
  const state=await fixture(t);let release;const began=new Promise(resolve=>state.started=resolve);state.wait=new Promise(resolve=>release=resolve);
  const pending=store[action]();await began;store.configureCloud({...config,colonyId:other});release();await assert.rejects(pending,/account changed/);
 }
});
