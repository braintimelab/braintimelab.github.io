import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAccessFeed} from '../mouse-data/access-logs.js';
const uid='11111111-1111-4111-8111-111111111111';
const row=(app,id,time='2026-10-19T01:00:00Z',event='session_start')=>({app,access_id:id,user_id:uid,name:'Member',event,page:app==='notes'?'home':'tools',occurred_at:time});
const reply=(events,extra={})=>({events,users:[{user_id:uid,name:'Member',last_sign_in_at:'2026-10-18T01:00:00Z',is_owner:false}],has_more:false,next_before:null,logging_started_at:'2026-10-15T01:00:00Z',...extra});
const nas=(events,extra={})=>reply(events,{source:'nas',available:true,loggingAvailable:true,...extra});
const filters={app:null,userId:null,excludeOwner:true,event:null,from:null,to:null,before:null,limit:50};
test('federation preserves colliding source IDs and orders actual timestamps without fabricating sign-ins',async()=>{
 const result=await loadAccessFeed({listLogs:async()=>reply([row('lab-tools','10')]),listNasLogs:async()=>nas([row('notes','10','2026-10-19T02:00:00Z','sign_in')])},filters);
 assert.equal(result.events.length,2);assert.deepEqual(result.events.map(r=>[r.app,r.log_origin]),[['notes','nas'],['lab-tools','cloud1']]);assert.equal(result.events[0].event,'sign_in');assert.equal(result.events[1].event,'session_start');assert.equal(result.users[0].last_sign_in_at,'2026-10-18T01:00:00Z');
});
test('sources page independently and never replay an exhausted source',async()=>{
 const calls=[];const hooks={listLogs:async f=>{calls.push(['cloud',f]);return reply([row('mouse','50')]);},listNasLogs:async f=>{calls.push(['nas',f]);return nas([row('notes','30')],f.before?{}:{has_more:true,next_before:'30'});}};
 const first=await loadAccessFeed(hooks,filters);assert.deepEqual(first.next_before,{cloud1:null,nas:'30'});const second=await loadAccessFeed(hooks,{...filters,before:first.next_before});assert.equal(calls[2][1].limit,1);assert.equal(calls[3][1].before,'30');assert.deepEqual(second.events.map(r=>r.app),['notes']);assert.equal(second.has_more,false);
});
test('a NAS outage leaves verified cloud rows visible and retries the missing source from its beginning',async()=>{
 let fail=true;const calls=[];const hooks={listLogs:async()=>reply([row('mouse','10')]),listNasLogs:async f=>{calls.push(f);if(fail)throw Error('offline');return nas([row('notes','1')]);}};
 const first=await loadAccessFeed(hooks,filters);assert.equal(first.events.length,1);assert.match(first.warnings.join(' '),/BraintimeDisk.*unavailable/);assert.equal(first.next_before.nas,'start');fail=false;const next=await loadAccessFeed(hooks,{...filters,before:first.next_before});assert.equal(calls[1].before,null);assert.equal(next.events[0].app,'notes');
});
test('NAS filters and actual sign-in events do not send unsupported labels into the cloud RPC',async()=>{
 const calls=[];await loadAccessFeed({listLogs:async f=>{calls.push(f);return reply([]);},listNasLogs:async()=>nas([row('notes','1',undefined,'sign_in')])},{...filters,app:'notes',event:'sign_in'});
 assert.equal(calls[0].app,null);assert.equal(calls[0].event,null);assert.equal(calls[0].limit,1);
});
test('failed and malformed sources never become an empty success',async()=>{
 await assert.rejects(loadAccessFeed({listLogs:async()=>{throw Error('offline');},listNasLogs:async()=>{throw Error('offline');}},filters),/unavailable/);
 const result=await loadAccessFeed({listLogs:async()=>reply([]),listNasLogs:async()=>nas([row('notes','not-id')])},filters);assert.match(result.warnings.join(' '),/could not be verified/);assert.equal(result.events.length,0);
 for(const before of [{cloud1:'1'}, {cloud1:'1',nas:'bad'}, '1'])await assert.rejects(loadAccessFeed({}, {...filters,before}),/cursor/);
});
test('the latest verified sign-in wins while Cloud 1 identity and owner flags remain canonical',async()=>{
 const cloudPerson={user_id:uid,name:'Canonical member',email:'canonical@example.invalid',acronym:'CM',role:'owner',is_owner:true,active:false,last_sign_in_at:null};
 const nasPerson={...cloudPerson,name:'NAS alias',email:'nas@example.invalid',acronym:'NA',role:'viewer',is_owner:false,active:true,last_sign_in_at:'2026-10-19T02:00:00Z'};
 for(const [cloudTime,nasTime,expected] of [
  [null,nasPerson.last_sign_in_at,nasPerson.last_sign_in_at],
  ['2026-10-19T01:00:00Z',nasPerson.last_sign_in_at,nasPerson.last_sign_in_at],
  ['2026-10-19T03:00:00Z',nasPerson.last_sign_in_at,'2026-10-19T03:00:00Z'],
  [nasPerson.last_sign_in_at,nasPerson.last_sign_in_at,nasPerson.last_sign_in_at],
  [nasPerson.last_sign_in_at,null,nasPerson.last_sign_in_at],
  [null,null,null]
 ]){
  const cloud={...cloudPerson,last_sign_in_at:cloudTime},disk={...nasPerson,last_sign_in_at:nasTime};
  const value=await loadAccessFeed({listLogs:async()=>reply([],{users:[cloud]}),listNasLogs:async()=>nas([],{users:[disk]})},filters);
  assert.deepEqual(value.users,[{...cloud,last_sign_in_at:expected}]);assert.equal(value.events.length,0,'directory sign-ins never fabricate app activity');
  assert.equal(cloud.last_sign_in_at,cloudTime);assert.equal(disk.last_sign_in_at,nasTime,'source replies are not mutated');
 }
});
test('NAS-only identities survive and malformed NAS timestamps cannot replace verified Cloud 1 facts',async()=>{
 const other='22222222-2222-4222-8222-222222222222',person={user_id:other,name:'NAS member',is_owner:false,last_sign_in_at:'2026-10-19T02:00:00Z'};
 let value=await loadAccessFeed({listLogs:async()=>reply([]),listNasLogs:async()=>nas([],{users:[person]})},filters);assert.deepEqual(value.users[1],person);
 value=await loadAccessFeed({listLogs:async()=>reply([]),listNasLogs:async()=>nas([],{users:[{...person,user_id:uid,last_sign_in_at:'invalid'}]})},filters);
 assert.equal(value.users[0].last_sign_in_at,'2026-10-18T01:00:00Z');assert.match(value.warnings.join(' '),/could not be verified/);
});
