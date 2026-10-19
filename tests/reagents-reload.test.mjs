import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../reagents/model.js';
import * as sorting from '../reagents/table-sort.js';
import * as inventoryExports from '../reagents/inventory-export.js';
import * as usage from '../reagents/usage.js';
import {cloudControlsHTML,cloudIndicatorHTML,showCloud1SignIn} from '../mouse-data/cloud-status.js';

const source=await readFile(new URL('../reagents/app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value)};};
function fixture(){
 const elements=new Map(),events=new Map(),calls=[],controls=[],prompts=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',value:'',defaultValue:'',open:false,hidden:false,disabled:false,dataset:{},elements:{},addEventListener:(name,fn)=>events.set(`${id}:${name}`,fn),setAttribute(){},close(){this.open=false;},showModal(){this.open=true;},querySelectorAll:()=>[]});return elements.get(id);};
 const permissions={role:'owner',can_write:true,can_import:true,can_manage_safety:true,export_level:'max'},config={url:'https://synthetic.supabase.co',colonyId:'synthetic-colony'},state={...config,configured:true,signedIn:true,email:'owner@example.invalid',name:'Synthetic Owner',role:'owner',exportLevel:'max'},gates={};
 const store={getCloudStatus:()=>({...state}),verifyCloudMembership:async()=>{calls.push('verify');await gates.verify?.promise;return {...state};},callReagents:async action=>{calls.push(action);await gates[action]?.promise;return action==='access'?{permissions,members:[]}:{rows:[],total:0,next_offset:null};},signOut:async()=>{calls.push('sign-out');state.signedIn=false;}};
 const location=new URL('https://synthetic.invalid/reagents/#inventory');
 const context=vm.createContext({createPresence:()=>({refresh(){},clear(){},destroy(){}}),...model,...sorting,...inventoryExports,...usage,store,PUBLIC_CONFIG:config,cloudControlsHTML,cloudIndicatorHTML,showCloud1SignIn,createCloudMonitor:()=>({dispose(){}}),document:{hidden:false,getElementById:element,querySelector:()=>null,querySelectorAll:selector=>selector.startsWith('#main input')?controls:[],addEventListener:(name,fn)=>events.set(`document:${name}`,fn)},window:{addEventListener(){},confirm:message=>{prompts.push(message);return gates.confirm===true;}},location,setTimeout,clearTimeout,URL,Blob,backupViewerLinkHTML:()=>'',renderAccessLogs:()=>()=>{},createAccessActivity:()=>({observe(){},reset(){},signOut(){calls.push('activity-sign-out');}})});
 vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/await start\(\);\s*$/,'')+'\nglobalThis.app={start,reloadShared,signOut,rpc,setImporting,hasUnsavedChanges,state:()=>({member,reloadPending,pendingWrites})};',context);
 return {app:context.app,element,events,calls,controls,prompts,gates,location,state};
}

test('both Reload controls reload shared data on the current route without signing out',async()=>{
 const f=fixture();await f.app.start();const before=f.calls.length;await f.app.reloadShared();
 assert(f.calls.slice(before).includes('verify'));assert(f.calls.slice(before).includes('list'));
 assert.equal(f.location.hash,'#inventory');assert.equal(f.state.signedIn,true);assert(!f.calls.includes('sign-out'));assert.equal(f.prompts.length,0);
 assert.equal(f.element('status').textContent,'Shared data reloaded.');assert(f.events.has('sidebar-reload:click'));assert(f.events.has('refresh:click'));
});

test('cancelling reload keeps entered text, checkbox and select drafts intact',async()=>{
 for(const control of [{type:'text',value:'new note',defaultValue:'saved note'},{type:'checkbox',checked:true,defaultChecked:false},{tagName:'SELECT',options:[{selected:false,defaultSelected:true},{selected:true,defaultSelected:false}]}]){
  const f=fixture();await f.app.start();f.controls.push(control);f.element('editor').open=true;f.element('edit-fields').innerHTML='UNSAVED';const before=f.calls.length;
  await f.app.reloadShared();assert.equal(f.calls.length,before);assert.equal(f.prompts.length,1);assert.equal(f.element('edit-fields').innerHTML,'UNSAVED');assert.equal(f.element('editor').open,true);
 }
});

test('a selected historical purchase offer is a draft even before fields are edited',async()=>{
 const f=fixture();await f.app.start();f.element('purchase-form').elements.name={value:'Chosen reagent'};const before=f.calls.length;
 await f.app.reloadShared();assert.equal(f.calls.length,before);assert.equal(f.prompts.length,1);
});

test('confirmed reload discards the draft only after confirmation',async()=>{
 const f=fixture();await f.app.start();f.controls.push({type:'textarea',value:'unsaved',defaultValue:''});f.element('editor').open=true;f.gates.confirm=true;const before=f.calls.length;
 await f.app.reloadShared();assert.equal(f.prompts.length,1);assert(f.calls.length>before);assert.equal(f.element('editor').open,false);
});

test('imports and in-flight writes block reload without discarding data',async()=>{
 const f=fixture();await f.app.start();f.element('edit-fields').innerHTML='KEEP';f.app.setImporting(true);let before=f.calls.length;await f.app.reloadShared();assert.equal(f.calls.length,before);assert.equal(f.element('edit-fields').innerHTML,'KEEP');
 f.app.setImporting(false);f.gates.save=deferred();const write=f.app.rpc('save');await Promise.resolve();before=f.calls.length;await f.app.reloadShared();assert.equal(f.calls.length,before);assert.equal(f.app.state().pendingWrites,1);f.gates.save.resolve();await write;assert.equal(f.app.state().pendingWrites,0);
});

test('repeated Reload clicks share one active reload and recover their buttons',async()=>{
 const f=fixture();await f.app.start();f.gates.verify=deferred();const before=f.calls.filter(call=>call==='verify').length,pending=f.app.reloadShared();await Promise.resolve();await f.app.reloadShared();
 assert.equal(f.calls.filter(call=>call==='verify').length,before+1);assert.equal(f.element('sidebar-reload').disabled,true);f.gates.verify.resolve();await pending;assert.equal(f.element('sidebar-reload').disabled,false);assert.equal(f.element('refresh').disabled,false);
});

test('Settings retains Sign out while the sidebar uses a fixed SVG circular arrow',async()=>{
 const html=await readFile(new URL('../reagents/index.html',import.meta.url),'utf8'),css=await readFile(new URL('../reagents/styles.css',import.meta.url),'utf8');
 assert.match(html,/id="sidebar-reload"[^>]*aria-label="Reload shared data"[^>]*><svg[^>]*width="20"[^>]*height="20"[^>]*fill="none"[^>]*stroke="currentColor"[^>]*>[\s\S]*?<path d="M20 8V3l-3 3a8 8 0 1 0 2.3 10M20 8h-5"/);assert.doesNotMatch(html,/id="sign-out"|sign-out-icon/);assert.match(css,/\.reload-icon svg\{[^}]*fill:none;stroke:currentColor/);
 const f=fixture();f.location.hash='#settings';await f.app.start();assert.match(f.element('main').innerHTML,/data-action="sign-out">Sign out/);await f.app.signOut();assert(f.calls.includes('sign-out'));assert.equal(f.element('sidebar-account').hidden,true);
});
