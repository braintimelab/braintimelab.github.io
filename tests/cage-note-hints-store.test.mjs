import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as store from '../mouse-data/data-store.js';

class Storage {
 values=new Map();writes=0;
 getItem(key){return this.values.get(key)??null;}
 setItem(key,value){this.writes++;this.values.set(key,String(value));}
 removeItem(key){this.writes++;this.values.delete(key);}
 clear(){this.values.clear();this.writes=0;}
}
globalThis.localStorage=new Storage();globalThis.sessionStorage=new Storage();
const colony='11111111-1111-4111-8111-111111111111',uid='22222222-2222-4222-8222-222222222222';
const config={url:'https://test.supabase.co',anonKey:'sb_publishable_synthetic',colonyId:colony};
const sessionKey='mouse-colony.session.v1';
const hints=()=>[{location_id:'sheet-position-L10',notes:['Genotyping','PIR not good but usable']},{location_id:'sheet-position-R21',notes:['Experiment','PIR!']}];
async function fixture(options={}){
 localStorage.clear();sessionStorage.clear();store.configureCloud(config);
 const state={calls:[],role:'viewer',result:hints(),...options};
 globalThis.fetch=async(url,init={})=>{
  const path=new URL(url).pathname;state.calls.push({path,init,body:init.body?JSON.parse(init.body):null});
  if(path==='/auth/v1/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,user:{id:uid,email:'member@example.invalid'}});
  if(path==='/rest/v1/memberships')return Response.json([{role:state.role,active:true,export_level:'low'}]);
  if(path==='/rest/v1/rpc/list_cage_note_hints'){
   state.started?.();if(state.wait)await state.wait;
   if(state.error)throw state.error;
   return Response.json(state.result,{status:state.status??200});
  }
  if(path==='/auth/v1/logout')return Response.json({});
  throw Error('Unexpected mocked route '+path);
 };
 await store.signIn('member@example.invalid','synthetic-password');return state;
}
function changeSession(changes){sessionStorage.setItem(sessionKey,JSON.stringify({...JSON.parse(sessionStorage.getItem(sessionKey)),...changes}));}

test('viewers fetch only fixed cage hints from their colony, without persisting or mutating records',async()=>{
 const state=await fixture(),before=[localStorage.writes,sessionStorage.writes],result=await store.listCageNoteHints();
 assert.deepEqual(result,hints());assert.deepEqual([localStorage.writes,sessionStorage.writes],before);
 const calls=state.calls.filter(call=>call.path.endsWith('/list_cage_note_hints'));
 assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{p_colony_id:colony});
 assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers.Authorization,'Bearer synthetic-access');
 assert.equal(calls[0].init.cache,'no-store');assert.equal(calls[0].init.redirect,'error');
 assert(!JSON.stringify([...localStorage.values,...sessionStorage.values]).includes('PIR not good'));
 assert(!state.calls.some(call=>/entity_records|apply_|archive|storage/.test(call.path)));
});

test('all SQL canonical phrases are accepted, including resolved and negated phrases',async()=>{
 const sql=await readFile(new URL('../sql/cage-note-hints.sql',import.meta.url),'utf8');
 const notes=[...sql.matchAll(/then '([^']+)'/g)].map(match=>match[1]);
 assert.equal(notes.length,18);
 const state=await fixture({result:[{location_id:'slot',notes}]});
 assert.deepEqual(await store.listCageNoteHints(),state.result);
 state.result=[];assert.deepEqual(await store.listCageNoteHints(),[]);
});

test('raw source text, extra fields, malformed shapes and unbounded hint payloads fail closed',async()=>{
 const state=await fixture();
 const invalid=[null,{}, {hints:hints()},[null],[[]],[{}],
  [{location_id:'slot',notes:['PIR!'],source_block_text:'private source block'}],
  [{location_id:'slot',notes:['PIR!','unknown raw note with a price']}],
  [{location_id:'slot',notes:['pir!']}],
  [{location_id:'slot',notes:[]}],
  [{location_id:'slot',notes:['PIR!','PIR!']}],
  [{location_id:'slot',notes:'PIR!'}],
  [{location_id:'',notes:['PIR!']}],
  [{location_id:' slot ',notes:['PIR!']}],
  [{location_id:'slot\nA1: confidential',notes:['PIR!']}],
  [{location_id:'s'.repeat(257),notes:['PIR!']}],
  [{location_id:7,notes:['PIR!']}],
  [{location_id:'slot',notes:['PIR!']},{location_id:'slot',notes:['LED!']}],
  Array.from({length:4097},(_,i)=>({location_id:'slot'+i,notes:['PIR!']})),
 ];
 for(const value of invalid){state.result=value;await assert.rejects(store.listCageNoteHints(),/unavailable/);}
});

test('signed-out, pending and password recovery accounts never request cage hints',async()=>{
 for(const changes of [{access_token:null},{role:'pending'},{setupRequired:true},{passwordRecovery:true}]){
  const state=await fixture();changeSession(changes);
  await assert.rejects(store.listCageNoteHints(),/Sign in/);
  assert(!state.calls.some(call=>call.path.endsWith('/list_cage_note_hints')));
 }
 await fixture();await store.signOut();await assert.rejects(store.listCageNoteHints(),/Sign in/);
});

test('late responses cannot cross sign-out, account, project, or same-user reauthentication boundaries',async()=>{
 for(const action of ['signout','actor','project','same-user','config-key','pending','recovery']){
  let started,release;const began=new Promise(resolve=>started=resolve),state=await fixture({started});
  state.wait=new Promise(resolve=>release=resolve);
  const pending=store.listCageNoteHints();await began;
  if(action==='signout')await store.signOut();
  else if(action==='actor')changeSession({user:{id:'33333333-3333-4333-8333-333333333333',email:'other@example.invalid'}});
  else if(action==='project')store.configureCloud({...config,url:'https://another.supabase.co'});
  else if(action==='same-user')await store.signIn('member@example.invalid','synthetic-password');
  else if(action==='config-key')localStorage.setItem('mouse-colony.cloud.v1',JSON.stringify({...config,anonKey:'sb_publishable_other'}));
  else if(action==='pending')changeSession({setupRequired:true});
  else changeSession({passwordRecovery:true});
  release();await assert.rejects(pending,/account or colony changed/i);
 }
});

test('permission and connection errors do not become an empty badge list or retry',async()=>{
 for(const options of [{status:403,result:{code:'42501',message:'denied'}},{error:new TypeError('offline')}]){
  const state=await fixture(options);await assert.rejects(store.listCageNoteHints());
  assert.equal(state.calls.filter(call=>call.path.endsWith('/list_cage_note_hints')).length,1);
 }
});
