import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createPortalController} from '../internal/portal.js';
import {guestAllows} from '../mouse-data/guest-access.js';
import {createAccessActivity} from '../mouse-data/access-activity.js';

const config={url:'https://synthetic.example',colonyId:'synthetic-colony',anonKey:'public-test-key'};
const signedOut=()=>({...config,configured:true,signedIn:false,role:null,mode:'local'});
const member=overrides=>({...signedOut(),signedIn:true,role:'editor',email:'member@example.invalid',guestLevel:null,exportLevel:'low',...overrides});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{status=member(),verify,record=()=>({recorded:true}),signedInStatus={}}={}){
 let current=status,visible=true,at=1000,sequence=0;
 const events=[],calls=[],timers=new Map(),navigation=[];
 t.mock.method(Date,'now',()=>at);
 const store={
  getCloudStatus:()=>({...current}),
  configureCloud(){assert.fail('Do not replace the lab configuration');},
  async verifyCloudMembership(){calls.push('verify');return verify?verify():{...current};},
  async signIn(){calls.push('sign-in');current=member(signedInStatus);},
  async signOut(){calls.push('sign-out');current=signedOut();},
  recordAppAccess(payload){calls.push('activity');events.push(payload);return record(payload);}
 };
 const controller=createPortalController({store,config,location:new URL('https://lab.example/internal/'),isVisible:()=>visible,
  timers:{setTimeout(fn,delay){timers.set(++sequence,{fn,delay});return sequence;},clearTimeout(id){timers.delete(id);}},
  navigate:(url,mode)=>navigation.push({url,...mode})});
 return {controller,events,calls,timers,navigation,state:value=>{current=value;},visible:value=>{visible=value;},advance:ms=>{at+=ms;},
  retry(){const [id,job]=timers.entries().next().value||[];assert.ok(job,'retry is scheduled');timers.delete(id);job.fn();return job.delay;}};
}

test('Lab tools records only after successful independent membership verification, without loading Mouse Data',async t=>{
 const waiting=deferred(),f=fixture(t,{status:signedOut(),verify:()=>waiting.promise});
 const login=f.controller.signIn('synthetic.member','synthetic-only-password');
 await settle();assert.deepEqual(f.events,[]);
 waiting.resolve(member());await login;await settle();
 assert.equal(f.events.length,1);assert.equal(f.events[0].app,'lab-tools');assert.equal(f.events[0].page,'tools');assert.equal(f.events[0].event,'session_start');
 assert.deepEqual(Object.keys(f.events[0]).sort(),['app','event','eventId','page','sessionId']);
 assert.doesNotMatch(JSON.stringify(f.events),/password|member@example|synthetic\.example|access_token/);
 await f.controller.checkAccess();await f.controller.checkAccess();await f.controller.openMouseData('cages');
 assert.equal(f.events.length,1,'verification and navigation must not inflate the same foreground visit');
 assert.equal(f.navigation[0].url,'https://lab.example/mouse-data/#cages');
});

test('saved verified members and all guest levels record Lab tools even when no dataset has entered cloud mode',async t=>{
 for(const role of ['owner','manager','editor','viewer']){
  for(const guestLevel of [null,'guest1','guest2','guest3']){
   const f=fixture(t,{status:member({role,guestLevel})});await f.controller.start();await settle();
   assert.equal(f.events.length,1,role+':'+guestLevel);assert.deepEqual(f.calls,['verify','activity']);
  }
 }
});

test('background visits wait for a verified foreground return and brief tab switching is not a new visit',async t=>{
 const f=fixture(t);f.visible(false);await f.controller.start();assert.equal(f.events.length,0);
 f.visible(true);await f.controller.checkAccess();await settle();assert.equal(f.events.length,1);
 f.visible(false);f.controller.suspendActivity();f.advance(5000);f.visible(true);await f.controller.checkAccess();assert.equal(f.events.length,1);
 f.visible(false);f.controller.suspendActivity();f.advance(31000);f.visible(true);await f.controller.checkAccess();await settle();
 assert.equal(f.events.length,2);assert.notEqual(f.events[0].sessionId,f.events[1].sessionId);
});

test('signed-out, pending, recovery, revoked and foreign sessions create no Lab tools activity',async t=>{
 for(const status of [signedOut(),member({role:'pending',setupRequired:true}),member({passwordRecovery:true})]){
  const f=fixture(t,{status});await f.controller.start();assert.equal(f.events.length,0);
 }
 for(const verify of [async()=>{throw Error('revoked');},async()=>member({url:'https://other.example'}),async()=>member({colonyId:'other-colony'})]){
  const f=fixture(t,{verify});await f.controller.start();assert.equal(f.events.length,0);
 }
});

test('a late member check after sign-out cannot fabricate a visit',async t=>{
 const waiting=deferred(),f=fixture(t,{verify:()=>waiting.promise});const checking=f.controller.start();
 await f.controller.signOut();waiting.resolve(member());await checking;await settle();assert.deepEqual(f.events,[]);
});

test('unconfirmed activity retries the same UUID and never delays or changes access',async t=>{
 let healthy=false;const f=fixture(t,{record:()=>healthy?{recorded:true}:null});
 await f.controller.start();await settle();assert.equal(f.controller.getState().phase,'member');assert.equal(f.events.length,1);
 assert.equal(f.retry(),1000);await settle();assert.equal(f.events.length,2);assert.deepEqual(f.events[0],f.events[1]);
 healthy=true;assert.equal(f.retry(),3000);await settle();assert.equal(f.events.length,3);assert.deepEqual(f.events[0],f.events[2]);assert.equal(f.timers.size,0);
});

test('sign-out activity captures the verified session before credentials clear, and revocation cancels pending retries',async t=>{
 const f=fixture(t);await f.controller.start();await settle();await f.controller.signOut();await settle();
 assert.deepEqual(f.events.map(row=>row.event),['session_start','sign_out']);
 assert.equal(f.events[0].sessionId,f.events[1].sessionId);assert.equal(f.calls.at(-1),'sign-out');
 const failed=fixture(t,{record:()=>null});await failed.controller.start();await settle();assert.equal(failed.timers.size,1);
 failed.state(member({role:'pending',setupRequired:true}));await failed.controller.checkAccess();await settle();
 assert.equal(failed.timers.size,0);assert.equal(failed.events.length,1);
});

test('mounted foreground and online returns revalidate access, while hidden pages suspend without requests',async t=>{
 let at=1000,current=member(),verifications=0;const events=[],elements=new Map(),windowEvents=new Map(),documentEvents=new Map();
 t.mock.method(Date,'now',()=>at);
 const element=id=>{if(!elements.has(id))elements.set(id,{type:id==='login-password'?'password':'',hidden:true,textContent:'',innerHTML:'',dataset:{},setAttribute(){},addEventListener(){}});return elements.get(id);};
 const document={hidden:false,getElementById:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>documentEvents.set(name,fn)};
 const window={location:new URL('https://lab.example/internal/'),addEventListener:(name,fn)=>windowEvents.set(name,fn)};
 const store={getCloudStatus:()=>({...current}),verifyCloudMembership:async()=>{verifications++;return {...current};},recordAppAccess:payload=>{events.push(payload);return {recorded:true};}};
 const source=(await readFile(new URL('../internal/portal.js',import.meta.url),'utf8'))
  .replace(/^import .*;$/gm,'').replace(/^export /gm,'')
  .replace(/const \{PUBLIC_CONFIG, backupViewerLinkHTML\} = await import\('[^']+'\);/,'const PUBLIC_CONFIG=globalThis.testConfig,backupViewerLinkHTML=()=>"";')
  .replace(/const store = await import\('[^']+'\);/,'const store=globalThis.testStore;');
 const context=vm.createContext({createPresence:()=>({refresh(){},clear(){},destroy(){}}),URL,URLSearchParams,guestAllows,createAccessActivity,setTimeout,clearTimeout,testConfig:config,testStore:store});
 vm.runInContext(source,context);await context.mountPortal(document,window);await settle();
 assert.equal(events.length,1);assert.equal(verifications,1);
 document.hidden=true;documentEvents.get('visibilitychange')();windowEvents.get('focus')();windowEvents.get('online')();await settle();
 assert.equal(verifications,1);assert.equal(events.length,1);
 at+=31000;document.hidden=false;documentEvents.get('visibilitychange')();await settle();
 assert.equal(verifications,2);assert.equal(events.length,2);assert.notEqual(events[0].sessionId,events[1].sessionId);
 windowEvents.get('online')();await settle();assert.equal(verifications,3);assert.equal(events.length,2);
 current=member({role:'pending',setupRequired:true});windowEvents.get('focus')();await settle();assert.equal(events.length,2);
});
