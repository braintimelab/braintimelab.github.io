import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {managedViewNeeds,managedEditorNeeds,pendingManagedNeeds,hasManagedNeeds} from '../mouse-data/managed-view.js';
import {MANAGED_EVENT_TYPES} from '../mouse-data/current-record-scope.js';

test('Cages, account settings and BB do not hydrate unrelated managed tables',()=>{
 for(const route of ['cages','settings','brainbot','archive'])assert.equal(hasManagedNeeds(managedViewNeeds(route)),false,route);
 assert.equal(hasManagedNeeds(managedViewNeeds('cages',{detail:{id:'current'}})),false);
});
test('ordinary menus use typed events instead of the entire event history',()=>{
 for(const route of ['overview','mice','matings','litters','family','planner','strains','housing','locobox','cryo','experiments','iacuc','fees','review']){
  const needs=managedViewNeeds(route);assert.ok(!needs.tables.includes('husbandry_events'),route);assert.ok(hasManagedNeeds(needs),route);assert.ok(needs.eventTypes.every(type=>MANAGED_EVENT_TYPES.includes(type)),route);
 }
 assert.deepEqual(managedViewNeeds('strains'),{tables:[],eventTypes:['strain_definition']});
 assert.ok(managedViewNeeds('cryo').eventTypes.includes('cryopreservation_lot'));
 assert.ok(managedViewNeeds('experiments').eventTypes.includes('experiment_sample'));
});
test('historical cage dates and detail views require their missing dependencies',()=>{
 assert.ok(managedViewNeeds('cages',{cageDate:'2026-10-01'}).eventTypes.includes('cage_move'));
 assert.ok(managedViewNeeds('mice',{detail:{id:'1'}}).tables.includes('matings'));
 assert.ok(managedEditorNeeds('mice').tables.includes('mice'));
 assert.deepEqual(pendingManagedNeeds(managedViewNeeds('cryo'),{tables:['mice'],eventTypes:['cryopreservation_lot']}),{tables:['mice'],eventTypes:['cryopreservation_lot']});
});

const app=await fs.readFile(new URL('../mouse-data/app.js',import.meta.url),'utf8');
const code=app.slice(app.indexOf('const managedViewKey='),app.indexOf('const deferredHistoryTables='));
function fixture({ensure,deferredTables=['mice'],deferredEvents=[]}={}){
 const elements=new Map(),calls=[],initial={tables:{mice:[{mouse_sid:'current'}]}},fresh={tables:{mice:[{mouse_sid:'current'},{mouse_sid:'ended'}]}},status={key:'owner',mode:'cloud',readyForEdits:true};
 const context=vm.createContext({pendingManagedNeeds,hasManagedNeeds,managedViewNeeds,managedEditorNeeds,
  store:{getDeferredManagedTables:()=>deferredTables,getDeferredManagedEventTypes:()=>deferredEvents,getCloudStatus:()=>status,ensureManagedTables:async(...args)=>{calls.push(args);return ensure?ensure(...args):fresh;}},
  initial,fresh,calls,elements,console,renderConnection:()=>{},
  panel:(_title,body)=>body,button:(label,action)=>`<button data-action="${action}">${label}</button>`,esc:value=>String(value),workspaceProgressCounts:()=>'',workspaceProgressBar:()=>'<progress></progress>',titles:{mice:'Mice',cages:'Cages'},
 });
 vm.runInContext(`let dataset=initial,route='mice',detail=null,cageDate='',cachedPreview=false,startupLoading=false,cloud={mode:'cloud'},cloudReady=true,managedLoadState=null,managedLoadFailure=null,historyLoadState=null,draft=false,identity='owner',renders=0;const cageSheetContext=()=>identity,historyDraftOpen=()=>draft,render=()=>renders++,showToast=()=>{},loadSharedColony=async()=>{calls.push({reconnect:true})};const $=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:''});return elements.get(id)};`+code+`;globalThis.api={loadManagedRecords,managedRouteGate,retryManagedRecords,get:()=>({dataset,managedLoadState,managedLoadFailure,cloudReady,renders,html:$('main').innerHTML}),change:(what)=>{if('draft'in what)draft=what.draft;if('identity'in what)identity=what.identity;if('route'in what)route=what.route;if('dataset'in what)dataset=what.dataset;}};`,context);
 return {api:context.api,calls,initial,fresh,status};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('deferred menu paints loading, then adopts only the verified result',async()=>{
 let resolve;const promise=new Promise(done=>{resolve=done;}),f=fixture({ensure:()=>promise});
 assert.equal(f.api.managedRouteGate(),true);assert.match(f.api.get().html,/<progress>/);assert.equal(f.api.get().dataset,f.initial);
 assert.equal(f.calls.length,1);resolve(f.fresh);await flush();assert.equal(f.api.get().dataset,f.fresh);assert.equal(f.api.get().renders,1);
});
test('failed menu exposes Retry and does not launch repeated requests on render',async()=>{
 const f=fixture({ensure:async()=>{throw Error('Read timed out');}});f.api.managedRouteGate();await flush();
 assert.equal(f.calls.length,1);f.api.managedRouteGate();assert.match(f.api.get().html,/managed-retry/);assert.match(f.api.get().html,/Read timed out/);assert.equal(f.calls.length,1);assert.equal(f.api.get().dataset,f.initial);
 await f.api.retryManagedRecords();assert.equal(f.api.get().managedLoadFailure,null);f.api.managedRouteGate();await flush();assert.equal(f.calls.length,2);
});
test('Retry reconnects after failed verification instead of retrying the stale snapshot',async()=>{
 let resolve;const promise=new Promise((_done,reject)=>{resolve=reject;}),f=fixture({ensure:()=>promise});
 const job=f.api.loadManagedRecords(managedViewNeeds('mice'));f.status.readyForEdits=false;resolve(Error('Verification expired'));
 await assert.rejects(job,/Verification expired/);assert.equal(f.api.get().cloudReady,false);
 await f.api.retryManagedRecords();assert.equal(f.calls.filter(call=>call.reconnect).length,1);assert.equal(f.calls.filter(call=>Array.isArray(call)).length,1);
});
test('record loading refuses to discard an open draft',async()=>{
 const f=fixture();f.api.change({draft:true});f.api.managedRouteGate();assert.equal(f.calls.length,0);assert.equal(f.api.get().dataset,f.initial);assert.match(f.api.get().html,/Save or discard/);
 await assert.rejects(f.api.loadManagedRecords(managedViewNeeds('mice')),/Save or discard/);
});
test('late responses cannot replace records after account or dataset changes',async()=>{
 for(const change of [{identity:'other'}, {dataset:{tables:{mice:[{mouse_sid:'new'}]}}}, {draft:true}]){
  let resolve;const promise=new Promise(done=>{resolve=done;}),f=fixture({ensure:()=>promise}),job=f.api.loadManagedRecords(managedViewNeeds('mice'));
  f.api.change(change);resolve(f.fresh);await assert.rejects(job,/account or records changed/);assert.notEqual(f.api.get().dataset,f.fresh);assert.equal(f.api.get().managedLoadState,null);
 }
});
test('an old menu load never reopens the menu after navigation',async()=>{
 let resolve;const promise=new Promise(done=>{resolve=done;}),f=fixture({ensure:()=>promise});f.api.managedRouteGate();f.api.change({route:'settings'});resolve(f.fresh);await flush();assert.equal(f.api.get().renders,0);assert.equal(f.api.get().dataset,f.fresh);
});
test('a queued menu does not start fetching after the user leaves it',async()=>{
 let resolve;const promise=new Promise(done=>{resolve=done;}),f=fixture({ensure:()=>promise});
 const first=f.api.loadManagedRecords(managedViewNeeds('mice'));f.api.change({route:'cryo'});
 const second=f.api.loadManagedRecords(managedViewNeeds('cryo'),{expectedView:JSON.stringify(['cryo',null,null,''])});
 f.api.change({route:'cages'});resolve(f.fresh);await first;await assert.rejects(second,/section changed/);assert.equal(f.calls.length,1);
});
test('ordinary startup and cage refresh explicitly ask for current records',()=>{
 assert.match(app,/store\.pullFromCloud\(\{onProgress:startupProgress,deferHistory:true,currentOnly:true\}\)/);
 assert.match(app,/loadFresh:async\(\)=>\{if\(cloud\.mode==='cloud'\)\{const fresh=await store\.pullFromCloud\(\{deferHistory:true,currentOnly:true\}\)/);
 assert.match(app,/navigate\(cloudLoadError\?'settings':'cages'\)/);
});
