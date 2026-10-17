import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as store from '../mouse-data/data-store.js';
import {PUBLIC_CONFIG} from '../mouse-data/config.js';

class Storage {
  values=new Map();
  getItem(key){return this.values.get(key)??null;}
  setItem(key,value){this.values.set(key,String(value));}
  removeItem(key){this.values.delete(key);}
}
const owner='7f58cb96-5677-4c78-b94b-c72362ee1fea',other='11111111-1111-4111-8111-111111111111',primary='jhmyung@gmail.com',alias='jihwan@tmu.edu.tw';
async function fixture(t,options={}){
  const previous={fetch:globalThis.fetch,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage};
  globalThis.localStorage=new Storage();globalThis.sessionStorage=new Storage();
  t.after(()=>{Object.assign(globalThis,previous);});
  store.configureCloud(options.config||PUBLIC_CONFIG);
  const state={calls:[],role:'owner',uid:owner,email:primary,resolver:null,...options};
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url),body=init.body?JSON.parse(init.body):null;state.calls.push({url,path:path.pathname,init,body});
    if(path.pathname==='/rest/v1/rpc/resolve_lab_login'){
      if(state.started)state.started();if(state.wait)await state.wait;if(state.failure)throw new TypeError('Offline');
      const result=state.resolver?state.resolver(body):body.p_identifier===alias?{email:primary,user_id:owner,alias:true}:{email:body.p_identifier,user_id:null,alias:false};
      return Response.json(result,{status:state.status??200});
    }
    if(path.pathname==='/auth/v1/token'||path.pathname==='/functions/v1/username-sign-in')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,user:{id:state.uid,email:state.email}});
    if(path.pathname==='/rest/v1/memberships')return Response.json(state.members??[{role:state.role,active:true,export_level:state.role==='owner'?'max':'low'}]);
    if(path.pathname==='/rest/v1/rpc/get_my_lab_member')return Response.json({eligible:true,setup_required:true,registration_allowed:true,member:{person_id:other,email:state.email,status:'current'}});
    throw Error('Unexpected synthetic route '+path.pathname);
  };
  return state;
}

test('owner email alias resolves on the server and authenticates with the one canonical password identity',async t=>{
  const state=await fixture(t);await store.signIn('  JIHWAN@TMU.EDU.TW  ','synthetic-password');
  const [resolve,auth]=state.calls;
  assert.equal(resolve.path,'/rest/v1/rpc/resolve_lab_login');assert.deepEqual(resolve.body,{p_colony_id:PUBLIC_CONFIG.colonyId,p_identifier:alias});assert.equal(resolve.init.cache,'no-store');assert.equal(resolve.init.redirect,'error');assert.equal(resolve.init.headers.apikey,PUBLIC_CONFIG.anonKey);assert.equal(JSON.stringify(resolve.body).includes('synthetic-password'),false);
  assert.equal(auth.path,'/auth/v1/token');assert.deepEqual(auth.body,{email:primary,password:'synthetic-password'});assert.equal(store.getCloudStatus().role,'owner');assert.equal(store.getCloudStatus().email,primary);
  const saved=sessionStorage.getItem('mouse-colony.session.v1');assert.equal(JSON.parse(saved).user.id,owner);assert.equal(saved.includes(alias),false);assert.equal(saved.includes('synthetic-password'),false);
  assert.deepEqual(state.calls.map(call=>call.path),['/rest/v1/rpc/resolve_lab_login','/auth/v1/token','/rest/v1/memberships','/rest/v1/memberships']);
});

test('ordinary emails pass through without owner identity substitution, and pending setup remains restricted',async t=>{
  const state=await fixture(t,{uid:other,email:'member@example.invalid',members:[]});await store.signIn('Member@Example.Invalid','synthetic-password');
  assert.deepEqual(state.calls[0].body,{p_colony_id:PUBLIC_CONFIG.colonyId,p_identifier:'member@example.invalid'});assert.equal(state.calls[1].body.email,'member@example.invalid');assert.equal(store.getCloudStatus().role,'pending');assert.equal(store.getCloudStatus().setupRequired,true);assert.equal(store.getCloudStatus().readyForEdits,false);assert(!state.calls.some(call=>/create|manage|save_lab|complete_lab/.test(call.path)));
});

test('resolver failures, denied aliases and malformed mappings never send the password to Auth',async t=>{
  for(const options of [{failure:true},{status:403,resolver:()=>({code:'42501'})},{status:500,resolver:()=>({code:'PGRST202'})},{status:404,resolver:()=>({code:'PGRST204'})},{resolver:()=>null},{resolver:()=>({email:primary,user_id:owner,alias:false})},{resolver:()=>({email:primary,user_id:null,alias:true})},{resolver:()=>({email:'invalid',user_id:owner,alias:true})},{resolver:()=>({email:primary,user_id:owner,alias:true,role:'owner'})}]){
    const state=await fixture(t,options);await assert.rejects(store.signIn(alias,'synthetic-password'));assert.equal(store.getCloudStatus().signedIn,false);assert.equal(state.calls.length,1);assert.equal(JSON.stringify(state.calls[0].body).includes('synthetic-password'),false);
  }
});

test('production sign-in requires the deployed resolver, including when PostgREST reports a missing function',async t=>{
  for(const identifier of [primary,alias])for(const [status,code]of [[404,'PGRST202'],[400,'42883']]){const state=await fixture(t,{status,resolver:()=>({code})});await assert.rejects(store.signIn(identifier,'synthetic-password'),/temporarily unavailable/);assert.equal(state.calls.length,1);assert.equal(store.getCloudStatus().signedIn,false);}
});

test('an alias must authenticate as the expected existing owner and cannot create a pending or manager session',async t=>{
  for(const options of [{uid:other},{role:'manager'},{members:[]}]){const state=await fixture(t,options);await assert.rejects(store.signIn(alias,'synthetic-password'));assert.equal(store.getCloudStatus().signedIn,false);assert(!state.calls.some(call=>/create|manage|save_lab|complete_lab/.test(call.path)));}
});

test('late alias resolution cannot send a password after the cloud configuration changes',async t=>{
  let release,started;const began=new Promise(resolve=>started=resolve),state=await fixture(t,{started,wait:new Promise(resolve=>release=resolve)}),signing=store.signIn(alias,'synthetic-password');await began;
  store.configureCloud({...PUBLIC_CONFIG,colonyId:other});release();await assert.rejects(signing,/configuration changed/);assert.equal(state.calls.length,1);assert.equal(store.getCloudStatus().signedIn,false);
});

test('username sign-in and unrelated configured projects retain their existing paths',async t=>{
  const username=await fixture(t);await store.signIn('jihwan','synthetic-password');assert.equal(username.calls[0].path,'/functions/v1/username-sign-in');assert.deepEqual(username.calls[0].body,{username:'jihwan',password:'synthetic-password'});assert(!username.calls.some(call=>call.path.endsWith('/resolve_lab_login')));
  const custom=await fixture(t,{config:{url:'https://other.supabase.co',anonKey:'sb_publishable_synthetic',colonyId:other}});await store.signIn('other@example.invalid','synthetic-password');assert.equal(custom.calls[0].path,'/auth/v1/token');assert(!custom.calls.some(call=>call.path.endsWith('/resolve_lab_login')));
});

test('Mouse Data, Reagents and the internal portal share the same sign-in implementation without public email aliases',async()=>{
  const [mouse,reagents,portal,source]=await Promise.all(['../mouse-data/app.js','../reagents/app.js','../internal/portal.js','../mouse-data/data-store.js'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  for(const text of [mouse,reagents,portal])assert.match(text,/data-store\.js/);
  assert(!source.includes(alias));assert(!source.includes(primary));assert(!source.includes(owner));
});
