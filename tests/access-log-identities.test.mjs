import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAccessLogs,loadAccessFeed} from '../mouse-data/access-logs.js';
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const row=(extra={})=>({access_id:'10',user_id:user,name:'old@example.invalid',email:'old@example.invalid',occurred_at:'2026-10-20T06:40:00Z',app:'notes',event:'page_view',page:'experiments',...extra});
const reply=(events=[],users=[],extra={})=>({events,users,has_more:false,next_before:null,logging_started_at:'2026-10-15T00:00:00Z',...extra});
const nas=(events=[],users=[],extra={})=>reply(events,users,{source:'nas',available:true,loggingAvailable:true,...extra});
const profile=(extra={})=>({user_id:user,name:'Current Scientist',acronym:'YA',email:'current@example.invalid',last_sign_in_at:null,is_owner:false,...extra});
const filters={app:null,userId:null,excludeOwner:true,event:null,from:null,to:null,before:null,limit:50};
function fixture(hooks={}){
 const container={innerHTML:'',isConnected:true};let role='owner',context='initial';
 const dispose=renderAccessLogs(container,{getRole:()=>role,getContext:()=>context,listLogs:async()=>reply(),listNasLogs:async()=>nas(),...hooks});
 return {container,dispose,setRole:v=>role=v,setContext:v=>context=v,click:action=>container.onclick?.({target:{closest:()=>({dataset:{accessAction:action}})},preventDefault(){}})};
}
const activity=html=>[...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].at(-1)?.[1]||'';
test('both sources display current verified UUID name and acronym without changing historical event fields',async()=>{
 const cloud=reply([row({app:'mouse',name:'Former Scientist',acronym:'FS'})],[profile()]),disk=nas([row({access_id:'9'})],[profile({name:'NAS email alias',acronym:null,email:'nas@example.invalid'})]),before=structuredClone({cloud,disk});
 const hooks={listLogs:async()=>cloud,listNasLogs:async()=>disk},feed=await loadAccessFeed(hooks,filters);
 assert.equal(feed.events.find(r=>r.log_origin==='nas').name,'old@example.invalid');assert.equal(feed.events.find(r=>r.log_origin==='cloud1').name,'Former Scientist');
 const f=fixture(hooks);await f.click('open');const text=activity(f.container.innerHTML);assert.equal(text.match(/Current Scientist \(YA\)/g)?.length,2);assert.doesNotMatch(text,/Former Scientist|old@example.invalid|NAS email alias/);assert.equal(text.match(/current@example.invalid/g)?.length,2);assert.deepEqual({cloud,disk},before);f.dispose();
});
test('same email with different UUIDs never joins identities and an email change never breaks exact-ID enrichment',async()=>{
 const known=profile({email:'shared@example.invalid'}),anonymous=row({user_id:other,access_id:'9',name:'shared@example.invalid',email:'shared@example.invalid'});
 const f=fixture({listLogs:async()=>reply([],[known]),listNasLogs:async()=>nas([row({email:'different@example.invalid'}),anonymous])});await f.click('open');const text=activity(f.container.innerHTML);assert.equal(text.match(/Current Scientist \(YA\)/g)?.length,1);assert.equal(text.match(/shared@example.invalid/g)?.length,2);assert.doesNotMatch(text,/different@example.invalid/);f.dispose();
});
test('unavailable Cloud1 keeps NAS rows and honest recorded identity without inferring a directory match',async()=>{
 const f=fixture({listLogs:async()=>{throw Error('offline');},listNasLogs:async()=>nas([row({name:'Recorded Scientist'})])});await f.click('open');const text=activity(f.container.innerHTML);assert.match(text,/Recorded Scientist/);assert.match(text,/old@example.invalid/);assert.doesNotMatch(text,/Current Scientist|\(YA\)/);assert.match(f.container.innerHTML,/Cloud 1 access records unavailable/);f.dispose();
});
test('previous pages re-resolve by UUID when a later verified directory becomes available',async()=>{
 let cloudCalls=0,nasCalls=0;const f=fixture({listLogs:async()=>reply([],++cloudCalls===1?[]:[profile()]),listNasLogs:async()=>++nasCalls===1?nas([row()],[],{has_more:true,next_before:'10'}):nas()});
 await f.click('open');assert.match(activity(f.container.innerHTML),/old@example.invalid/);assert.doesNotMatch(activity(f.container.innerHTML),/Current Scientist/);await f.click('more');assert.match(activity(f.container.innerHTML),/Current Scientist \(YA\)/);assert.doesNotMatch(activity(f.container.innerHTML),/old@example.invalid/);f.dispose();
});
test('missing, blank, malformed, or email-only directory names retain a genuine recorded name',async()=>{
 for(const name of [undefined,null,'   ',{unexpected:'name'},'alias@example.invalid']){
  const f=fixture({listLogs:async()=>reply([],[profile({name,acronym:null,email:null})]),listNasLogs:async()=>nas([row({name:'Recorded Scientist',acronym:'RS'})])});await f.click('open');assert.match(activity(f.container.innerHTML),/Recorded Scientist \(RS\)/);assert.doesNotMatch(activity(f.container.innerHTML),/\[object Object\]|undefined|null/);f.dispose();
 }
});
test('enrichment performs no browser persistence and clears private directory labels on close or authorization change',async()=>{
 const descriptors=Object.fromEntries(['localStorage','sessionStorage','indexedDB'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let touches=0;
 for(const key of Object.keys(descriptors))Object.defineProperty(globalThis,key,{configurable:true,get(){touches++;throw Error('Persistence is prohibited');}});
 try{for(const change of ['close','role','context']){const f=fixture({listLogs:async()=>reply([],[profile()]),listNasLogs:async()=>nas([row()])});await f.click('open');assert.match(activity(f.container.innerHTML),/Current Scientist/);if(change==='close')await f.click('close');else{change==='role'?f.setRole('manager'):f.setContext('other-owner-session');await f.click('refresh');}assert.doesNotMatch(f.container.innerHTML,/Current Scientist|current@example.invalid|\(YA\)/);f.dispose();}assert.equal(touches,0);}
 finally{for(const[key,descriptor]of Object.entries(descriptors))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});
