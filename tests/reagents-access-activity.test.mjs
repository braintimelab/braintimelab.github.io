import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../reagents/model.js';
import {bindSheetOrderImportDialog} from '../reagents/orders.js';
import * as sorting from '../reagents/table-sort.js';
import * as inventoryExports from '../reagents/inventory-export.js';
import {cloudControlsHTML,cloudIndicatorHTML,showCloud1SignIn} from '../mouse-data/cloud-status.js';
import * as usage from '../reagents/usage.js';

// Execute the published Reagents auth/lifecycle handlers with synthetic accounts.
// Shared activity timing and server writes have their own module-level tests.
const source=await readFile(new URL('../reagents/app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture({role='editor',route='orders',hidden=false,access,guestLevel=null,allowedSections=[]}={}){
 const elements=new Map(),documentEvents=new Map(),windowEvents=new Map(),calls=[],activity=[],membershipListeners=new Set();
 const element=id=>{if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',value:'',open:false,hidden:false,disabled:false,dataset:{},elements:{password:{value:''}},addEventListener(){},setAttribute(){},close(){this.open=false;},showModal(){this.open=true;},focus(){},querySelectorAll(){return [];}});return elements.get(id);};
 const config={url:'https://synthetic.supabase.co',colonyId:'synthetic-colony'},status={...config,configured:true,signedIn:true,email:'member@example.invalid',name:'Synthetic Member',role,exportLevel:'high',mode:'local'};
 const permissions={role,can_write:true,can_import:role==='owner',can_manage_safety:false,export_level:'high',history_cutoff:null,...(guestLevel?{guest_level:guestLevel,allowed_sections:allowedSections,can_write:false,can_import:false,can_manage_safety:false,can_export:false}: {})};
 const store={getCloudStatus:()=>({...status}),subscribeVerifiedMembership:fn=>{membershipListeners.add(fn);return()=>membershipListeners.delete(fn);},verifyCloudMembership:async()=>{calls.push('verify');for(const fn of membershipListeners)fn({...status});return {...status};},callReagents:async(action,args)=>{calls.push(action);if(action==='access')return access?access({permissions,status}):{permissions:{...permissions},members:[]};return {rows:[],total:0,next_offset:null};}};
 const document={hidden,getElementById:element,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(name,fn)=>documentEvents.set(name,fn)};
 const location=new URL('https://synthetic.invalid/reagents/#'+route);
 const context=vm.createContext({bindSheetOrderImportDialog,createPresence:()=>({refresh(){},clear(){},destroy(){}}),cloudControlsHTML,cloudIndicatorHTML,showCloud1SignIn,createCloudMonitor:()=>({dispose(){}}),...model,...sorting,...inventoryExports,...usage,store,PUBLIC_CONFIG:config,document,window:{addEventListener:(name,fn)=>windowEvents.set(name,fn)},location,console,setTimeout,clearTimeout,URL,Blob,backupViewerLinkHTML:()=>'',renderAccessLogs:()=>()=>{},createOrdersUI:()=>({mount:async()=>calls.push('orders-mount'),refresh:async()=>calls.push('orders-refresh'),dispose(){}}),createAccessActivity:options=>({observe:page=>{if(options.getContext())activity.push({event:'observe',page});},resume:page=>{if(options.getContext())activity.push({event:'resume',page});},touch:page=>{if(options.getContext())activity.push({event:'touch',page});},suspend:()=>activity.push({event:'suspend'}),reset:()=>{},signOut:()=>{}})});
 vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/await start\(\);\s*$/,'')+'\nglobalThis.app={start,render,returnToApp,setImporting,accessFailure,state:()=>({member,generation,importing}),invalidate:()=>{generation++;resetPrivate();}};',context);
 return {app:context.app,element,calls,activity,status,permissions,document,location,documentEvents,windowEvents,verifyAccess:value=>{for(const fn of membershipListeners)fn(value||{...status});}};
}

test('saved sessions of every active role record Reagents and revalidated Orders returns resume activity',async()=>{
 for(const role of ['owner','manager','editor','viewer']){
  const f=fixture({role});await f.app.start();assert.deepEqual(f.activity.map(row=>row.event),['resume','observe','observe']);
  const before=f.calls.length;f.document.hidden=true;await f.documentEvents.get('visibilitychange')();assert.equal(f.calls.length,before);assert.equal(f.activity.at(-1).event,'suspend');
  f.document.hidden=false;await f.documentEvents.get('visibilitychange')();assert.deepEqual(f.calls.slice(before),['access','orders-refresh']);assert.deepEqual(f.activity.at(-1),{event:'resume',page:'orders'});
  const verified=f.calls.filter(x=>x==='verify').length;await f.windowEvents.get('focus')();assert.equal(f.calls.filter(x=>x==='verify').length,verified,'Orders return does not replace the shared Auth generation');assert.equal(f.activity.at(-1).event,'resume');
 }
});

test('Inventory focus revalidates and resumes without clearing the current form or reloading inventory',async()=>{
 const f=fixture({route:'inventory'});await f.app.start();f.element('editor').open=true;f.element('edit-fields').innerHTML='UNSAVED FORM';const before=f.calls.length;
 await f.windowEvents.get('focus')();assert.deepEqual(f.calls.slice(before),['access']);assert.equal(f.element('editor').open,true);assert.equal(f.element('edit-fields').innerHTML,'UNSAVED FORM');assert.deepEqual(f.activity.at(-1),{event:'resume',page:'inventory'});
 f.document.hidden=true;const events=f.activity.length;await f.windowEvents.get('focus')();assert.equal(f.activity.length,events);
});

test('initial background loading emits no activity until the page is visible and access is revalidated',async()=>{
 const f=fixture({route:'inventory',hidden:true});await f.app.start();assert.deepEqual(f.activity,[]);
 f.document.hidden=false;await f.documentEvents.get('visibilitychange')();assert.deepEqual(f.activity[0],{event:'resume',page:'inventory'});
});

test('import return verifies access and resumes while preserving the active import',async()=>{
 const f=fixture({route:'inventory'});await f.app.start();f.app.setImporting(true);const before=f.calls.length;
 await f.windowEvents.get('focus')();assert.deepEqual(f.calls.slice(before),['access']);assert.equal(f.app.state().importing,true);assert.deepEqual(f.activity.at(-1),{event:'resume',page:'inventory'});
});

test('failed or stale return access checks cannot emit another member activity event',async()=>{
 let fail=false;const blocked=fixture({access:({permissions})=>{if(fail)throw Error('not an active member');return {permissions,members:[]};}});await blocked.app.start();const count=blocked.activity.length;fail=true;await blocked.windowEvents.get('focus')();assert.equal(blocked.activity.length,count);assert.equal(blocked.app.state().member,false);
 let gate;const changed=fixture({access:({permissions})=>gate?gate.promise:{permissions,members:[]}});await changed.app.start();const prior=changed.activity.length;gate=deferred();const pending=changed.windowEvents.get('focus')();changed.status.email='another@example.invalid';gate.resolve({permissions:changed.permissions,members:[]});await pending;assert.equal(changed.activity.length,prior);assert.equal(changed.app.state().member,false);
});

test('signed-out and setup accounts emit nothing; denied sections retain only verified app entry',async()=>{
 for(const change of [{signedIn:false},{setupRequired:true},{passwordRecovery:true},{role:'pending'}]){
  const f=fixture();Object.assign(f.status,change);await f.app.start();await f.windowEvents.get('focus')();assert.deepEqual(f.activity,[]);
 }
 for(const route of ['history','review']){const f=fixture({route});await f.app.start();await f.windowEvents.get('focus')();assert.deepEqual(f.activity,[{event:'resume',page:route}]);}
});


test('trusted interactions update only the current allowlisted section and never field contents',async()=>{
 const f=fixture({route:'inventory'});await f.app.start();const before=f.calls.length;
 for(const name of ['pointerdown','keydown'])await f.documentEvents.get(name)({isTrusted:true,key:'PRIVATE INPUT',target:{value:'PRIVATE REAGENT'}});
 assert.deepEqual(f.activity.slice(-2),[{event:'touch',page:'inventory'},{event:'touch',page:'inventory'}]);assert.equal(f.calls.length,before,'local interaction does not refetch or reset the app');assert.doesNotMatch(JSON.stringify(f.activity),/PRIVATE/);
 const events=f.activity.length;await f.documentEvents.get('pointerdown')({isTrusted:false});f.document.hidden=true;await f.documentEvents.get('keydown')({isTrusted:true});assert.equal(f.activity.length,events);
 f.document.hidden=false;f.location.hash='#history';await f.documentEvents.get('pointerdown')({isTrusted:true});assert.equal(f.activity.length,events);
 f.location.hash='#inventory';f.app.invalidate();await f.documentEvents.get('keydown')({isTrusted:true});assert.equal(f.activity.length,events);
});


test('an explicitly restricted Guest-1 cannot visit blocked Orders or scientific views',async()=>{
 const f=fixture({role:'viewer',guestLevel:'guest1',allowedSections:['settings']});await f.app.start();
 assert.equal(f.calls.filter(action=>action==='list').length,0);assert.ok(!f.calls.includes('orders-mount'));
 assert.doesNotMatch(f.element('navigation').innerHTML,/data-section="(?:inventory|orders|history|review)"/);
 f.location.hash='#inventory';await f.app.render();assert.match(f.element('main').innerHTML,/not available/);assert.equal(f.calls.filter(action=>action==='list').length,0);
});
test('Guest-1 and Guest-2 load only the order interface and never preload inventory',async()=>{
 for(const guestLevel of ['guest1','guest2']){
 const f=fixture({role:'viewer',guestLevel,allowedSections:['settings','orders']});await f.app.start();
 assert.ok(f.calls.includes('orders-mount'));assert.equal(f.calls.filter(action=>action==='list').length,0);
 assert.doesNotMatch(f.element('navigation').innerHTML,/data-section="(?:inventory|safety|usage|history|review)"/);
 f.location.hash='#usage';await f.app.render();assert.match(f.element('main').innerHTML,/not available/);
 }
});
test('Guest-3 current-data sections remain read only and omit export controls',async()=>{
 const f=fixture({role:'viewer',route:'inventory',guestLevel:'guest3',allowedSections:['settings','orders','inventory','safety','usage','vendors','equipment']});await f.app.start();
 assert.equal(f.calls.filter(action=>action==='list').length,2);assert.match(f.element('navigation').innerHTML,/data-section="inventory"/);
 assert.doesNotMatch(f.element('main').innerHTML,/data-action="(?:export-pdf|export-items|new-item)"/);
});


test('verified entry survives an access or data-load stall without claiming a data read',async()=>{
 for(const role of ['owner','manager','editor','viewer']){
  const gate=deferred(),f=fixture({role,route:'inventory',access:()=>gate.promise}),opening=f.app.start();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.activity,[{event:'resume',page:'inventory'}]);assert.equal(f.calls.at(-1),'access');assert(!f.calls.includes('list'));gate.resolve({permissions:f.permissions,members:[]});await opening;assert.equal(f.activity.filter(row=>row.event==='resume').length,1);
 }
});
test('stalled background entry records once on visible return and rejects a stale identity signal',async()=>{
 const gate=deferred(),f=fixture({hidden:true,route:'inventory',access:()=>gate.promise}),opening=f.app.start();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.activity,[]);f.document.hidden=false;void f.windowEvents.get('focus')();assert.deepEqual(f.activity,[{event:'resume',page:'inventory'}]);const prior={...f.status};f.status.email='another@example.invalid';f.verifyAccess(prior);assert.equal(f.activity.length,1);gate.resolve({permissions:f.permissions,members:[]});await opening;
});
