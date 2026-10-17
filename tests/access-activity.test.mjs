import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccessActivity} from '../mouse-data/access-activity.js';
const context=()=>({signedIn:true,mode:'cloud',role:'editor',url:'https://example.supabase.co',colonyId:'colony',email:'member@example.invalid'});
function fixture(record=()=>({recorded:true})){let state=context(),n=0,timerId=0;const calls=[],timers=new Map(),activity=createAccessActivity({app:'mouse',sections:['mice','settings','cages'],record:payload=>{calls.push(payload);return record(payload,calls.length);},getContext:()=>state,uuid:()=>`id-${++n}`,setTimer:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});return {calls,activity,timers,setState:v=>{state={...state,...v}},runRetry:()=>{const [id,timer]=timers.entries().next().value||[];assert.ok(timer,'a retry is scheduled');timers.delete(id);timer.fn();return timer.delay;}};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function lifecycle(record=()=>({recorded:true})){
 let at=1000,visible=true,state=context(),n=0;const calls=[],timers=new Map();let timerId=0;
 const activity=createAccessActivity({app:'mouse',sections:['mice','cages','settings'],record:p=>{calls.push(p);return record(p,calls.length);},getContext:()=>state,uuid:()=>`event-${++n}`,now:()=>at,isVisible:()=>visible,setTimer:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimer:id=>timers.delete(id)});
 return {activity,calls,timers,advance:ms=>at+=ms,visible:value=>visible=value,state:value=>state={...state,...value},retry:()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();}};
}
test('all member roles record a visible return to the same section after suspension',async()=>{
 for(const role of ['owner','manager','editor','viewer']){
  const f=lifecycle();f.state({role});f.activity.observe('mice');await settle();f.visible(false);f.activity.suspend();f.advance(31000);f.activity.observe('mice');assert.equal(f.calls.length,1);f.visible(true);f.activity.resume('mice');await settle();
  assert.deepEqual(f.calls.map(p=>p.event),['session_start','session_start']);assert.notEqual(f.calls[0].sessionId,f.calls[1].sessionId);
  f.activity.resume('mice');f.activity.observe('mice');assert.equal(f.calls.length,2);
 }
});
test('short tab switches do not inflate visits and active same-section use creates no click log',async()=>{
 const f=lifecycle();f.activity.observe('cages');await settle();f.activity.suspend();f.advance(5000);f.activity.resume('cages');f.activity.touch('cages');f.activity.touch('cages');assert.equal(f.calls.length,1);
});
test('idle use reopens a session but automatic same-page renders do not',async()=>{
 const f=lifecycle();f.activity.observe('mice');await settle();f.advance(301000);f.activity.observe('mice');assert.equal(f.calls.length,1);f.activity.touch('mice');await settle();assert.equal(f.calls.length,2);assert.equal(f.calls[1].event,'session_start');assert.notEqual(f.calls[0].sessionId,f.calls[1].sessionId);
});
test('an exhausted unconfirmed delivery recovers on later use with its original event UUID',async()=>{
 let healthy=false;const f=lifecycle(()=>healthy?{recorded:true}:null);f.activity.observe('cages');await settle();f.retry();await settle();f.retry();await settle();assert.equal(f.calls.length,3);healthy=true;f.advance(16000);f.activity.resume('cages');await settle();assert.equal(f.calls.length,4);assert.deepEqual(f.calls[3],f.calls[0]);assert.equal(f.timers.size,0);f.activity.touch('cages');assert.equal(f.calls.length,4);
});
test('account changes discard unconfirmed old-user activity before a foreground return',async()=>{
 const f=lifecycle(()=>null);f.activity.observe('mice');await settle();f.retry();await settle();f.retry();await settle();f.state({email:'another@example.invalid'});f.advance(16000);f.activity.resume('cages');await settle();assert.equal(f.calls.length,4);assert.equal(f.calls[3].page,'cages');assert.notEqual(f.calls[0].sessionId,f.calls[3].sessionId);f.activity.reset();
});
test('background returns and setup-required accounts are never logged',()=>{
 const f=lifecycle();f.visible(false);f.activity.resume('mice');f.activity.touch('mice');assert.equal(f.calls.length,0);f.visible(true);f.state({setupRequired:true});f.activity.resume('mice');assert.equal(f.calls.length,0);
});
test('failed prior-section events survive an ordinary same-user return and keep their original session',async()=>{
 let healthy=false;const f=lifecycle(()=>healthy?{recorded:true}:null);f.activity.observe('cages');await settle();f.retry();await settle();f.retry();await settle();const original={...f.calls[0]};f.visible(false);f.activity.suspend();f.advance(31000);healthy=true;f.visible(true);f.activity.resume('settings');await settle();assert.deepEqual(f.calls[3],original);assert.equal(f.calls[4].page,'settings');assert.equal(f.calls[4].event,'session_start');assert.notEqual(f.calls[4].sessionId,original.sessionId);assert.equal(f.timers.size,0);
});
test('app session starts once and section navigation omits records, URLs and duplicate renders',()=>{const f=fixture();f.activity.observe('mice');f.activity.observe('mice');f.activity.observe('mice/private-id?token=secret');f.activity.observe('settings');assert.deepEqual(f.calls.map(({app,event,page})=>({app,event,page})),[{app:'mouse',event:'session_start',page:'mice'},{app:'mouse',event:'page_view',page:'settings'}]);assert.equal(f.calls[0].sessionId,f.calls[1].sessionId);assert.notEqual(f.calls[0].eventId,f.calls[1].eventId);assert(!JSON.stringify(f.calls).includes('member@example.invalid'));});
test('signed-out, local/demo, pending and password recovery activity is never recorded',()=>{for(const state of [{signedIn:false},{mode:'local'},{role:'pending'},{passwordRecovery:true},{setupRequired:true},{role:null}]){const f=fixture();f.setState(state);f.activity.observe('mice');f.activity.signOut('settings');assert.equal(f.calls.length,0);}});
test('sign-out requested is captured before reset and a later identity gets a new session',()=>{const f=fixture();f.activity.observe('mice');f.activity.signOut('settings');f.activity.signOut('settings');assert.equal(f.calls.length,2);assert.equal(f.calls[1].event,'sign_out');f.setState({email:'second@example.invalid'});f.activity.observe('cages');assert.notEqual(f.calls[0].sessionId,f.calls[2].sessionId);assert.equal(f.calls[2].event,'session_start');});
test('logging failures, missing random UUID support and sign-out after account change never block use',async()=>{const f=fixture();f.activity.observe('mice');f.setState({email:'second@example.invalid'});f.activity.signOut('settings');assert.equal(f.calls.length,1);for(const record of [()=>{throw Error('offline')},()=>Promise.reject(Error('offline'))]){const activity=createAccessActivity({app:'mouse',sections:['mice'],getContext:context,record,uuid:()=>crypto.randomUUID()});assert.doesNotThrow(()=>activity.observe('mice'));assert.doesNotThrow(()=>activity.signOut('mice'));}const broken=createAccessActivity({app:'mouse',sections:['mice'],getContext:context,record:()=>assert.fail(),uuid:()=>{throw Error('unsupported')}});assert.doesNotThrow(()=>broken.observe('mice'));await new Promise(r=>setImmediate(r));});

test('all active member roles retry temporary failure with the original event and session UUIDs',async()=>{
 for(const role of ['owner','manager','editor','viewer']){
  const f=fixture((payload,count)=>count===1?null:{recorded:true});f.setState({role});f.activity.observe('mice');await settle();
  f.activity.observe('mice');f.activity.observe('mice');assert.equal(f.calls.length,1);assert.equal(f.timers.size,1);
  assert.equal(f.runRetry(),1000);await settle();assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1],f.calls[0]);assert.equal(f.timers.size,0);
  f.activity.observe('mice');assert.equal(f.calls.length,2);
 }
});

test('synchronous failures and rejected writes stop after three attempts with bounded backoff',async()=>{
 for(const fail of [()=>{throw Error('offline');},()=>Promise.reject(Error('offline')),()=>null]){
  const f=fixture(fail);f.activity.observe('mice');await settle();assert.equal(f.runRetry(),1000);await settle();assert.equal(f.runRetry(),3000);await settle();
  assert.equal(f.calls.length,3);assert.equal(new Set(f.calls.map(row=>row.eventId)).size,1);assert.equal(f.timers.size,0);
  f.activity.observe('mice');await settle();assert.equal(f.calls.length,3);
 }
});

test('confirmed duplicate, debounced and rate-limited events are not retried',async()=>{
 for(const reason of ['duplicate','debounced','rate_limited']){const f=fixture(()=>({recorded:false,reason}));f.activity.observe('mice');await settle();assert.equal(f.timers.size,0);assert.equal(f.calls.length,1);}
});

test('distinct section returns are retained even when an earlier visit is still unconfirmed',async()=>{
 const f=fixture(payload=>payload.event==='session_start'?{recorded:true}:null);f.activity.observe('mice');await settle();f.activity.observe('settings');await settle();f.activity.observe('cages');f.activity.observe('settings');await settle();
 assert.equal(f.calls.filter(row=>row.page==='settings').length,2);assert.equal(f.timers.size,3);f.activity.reset();assert.equal(f.timers.size,0);
});

test('retry never sends old activity after identity, verified access or role changes',async()=>{
 for(const change of [{email:'second@example.invalid'},{url:'https://second.supabase.co'},{colonyId:'second-colony'},{role:'manager'},{role:'pending'},{signedIn:false},{mode:'local'},{setupRequired:true},{passwordRecovery:true}]){
  const f=fixture(()=>null);f.activity.observe('mice');await settle();f.setState(change);f.runRetry();await settle();assert.equal(f.calls.length,1,JSON.stringify(change));assert.equal(f.timers.size,0);
 }
});

test('reset and sign-out cancel retries without delaying logout or replaying its event',async()=>{
 for(const action of ['reset','signOut']){
  const f=fixture(()=>null);f.activity.observe('mice');await settle();assert.equal(f.timers.size,1);f.activity[action]('mice');assert.equal(f.timers.size,0);await settle();
  assert.equal(f.calls.length,action==='signOut'?2:1);assert.equal(f.timers.size,0);f.setState({signedIn:false});await settle();assert.equal(f.timers.size,0);
 }
});

test('a late failed request cannot schedule a retry after switching account or signing out',async()=>{
 for(const change of ['switch','signOut','reset']){
  let reject;const f=fixture((payload,count)=>count===1?new Promise((resolve,no)=>{reject=no;}):({recorded:true}));f.activity.observe('mice');
  if(change==='switch'){f.setState({email:'second@example.invalid'});f.activity.observe('mice');}else f.activity[change]('mice');
  reject(Error('offline'));await settle();assert.equal(f.timers.size,0);assert.equal(f.calls.length,change==='reset'?1:2);
  if(change==='switch')assert.notEqual(f.calls[0].sessionId,f.calls[1].sessionId);
 }
});
