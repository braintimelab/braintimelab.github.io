import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as model from '../reagents/model.js';
import * as usage from '../reagents/usage.js';
import * as sorting from '../reagents/table-sort.js';
import * as inventoryExports from '../reagents/inventory-export.js';
import {cloudControlsHTML,cloudIndicatorHTML,showCloud1SignIn} from '../mouse-data/cloud-status.js';

// Execute the deployed frontend, with its real models and synthetic DOM/RPCs.
// No private lab data, browser storage, network or account credentials are used.
const appSource=await readFile(new URL('../reagents/app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const clone=value=>JSON.parse(JSON.stringify(value));
const decode=value=>String(value||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const attrs=html=>Object.fromEntries([...html.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,decode(value)]));
const item=(id,name,payload={},kind='item')=>({id,kind,version:1,payload:{name,inventory_classification:kind==='equipment'?'Equipment':'Chemicals',remaining_amount:100,unit:'mL',...payload}});
const inventory=[item('chloroform-a','Chloroform',{brand:'Alpha',catalog_number:'C101',barcode:'A',location:'Shelf A'}),item('chloroform-b','Chloroform',{brand:'Beta',catalog_number:'C102',barcode:'B',location:'Shelf B'}),item('dcm','Dichloromethane'),item('salt','NaCl',{brand:'Salt brand',catalog_number:'S100'}),item('qpcr','qPCR',{unit:'hours'},'equipment'),item('ab','PER2 antibody',{inventory_classification:'Antibody',unit:'µL'})];

function fixture(overrides={}){
 const elements=new Map(),documentListeners=new Map(),windowListeners=new Map(),calls=[],workbooks=[],downloads=[];
 const element=id=>{
  if(elements.has(id))return elements.get(id);
  let html='';const inputs=new Map(),node={id,textContent:'',value:'',hidden:false,disabled:false,open:false,dataset:{},listeners:new Map(),elements:{password:{value:''}},options:[],addEventListener(event,fn){this.listeners.set(event,fn);},showModal(){this.open=true;},close(){this.open=false;},focus(){this.focused=true;},setAttribute(){},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},click(){downloads.push(this.download);},insertAdjacentHTML(_where,value){this.innerHTML+=value;},querySelector(selector){const name=selector.match(/\[name=["']?([^\]"']+)/)?.[1];return inputs.get(name)||null;},querySelectorAll(selector){return selector==='input[type=checkbox]'?[...inputs.values()].filter(input=>input.type==='checkbox'):[];}};
  Object.defineProperty(node,'innerHTML',{get:()=>html,set:value=>{html=value;inputs.clear();for(const match of html.matchAll(/<(input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1>)?/g)){
   const [,tag,source,body='']=match,a=attrs(source);if(!a.name)continue;const input={...a,value:a.value||'',checked:/\bchecked\b/.test(source),disabled:/\bdisabled\b/.test(source),focus(){this.focused=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};
   if(tag==='select'){const options=[...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([,source,label])=>({...attrs(source),textContent:decode(label),selected:/\bselected\b/.test(source)}));input.options=options;input.value=(options.find(option=>option.selected)||options[0])?.value||'';}
   if(tag==='textarea')input.value=decode(body);inputs.set(a.name,input);
  }}});
  elements.set(id,node);return node;
 };
 const config={url:'https://synthetic.supabase.co',colonyId:'synthetic-colony'},status={...config,configured:true,signedIn:true,email:'owner@example.invalid',username:'owner',role:'owner',exportLevel:'max',...overrides.status},permissions={role:status.role,can_write:true,can_import:status.role==='owner',can_manage_safety:true,export_level:'max',history_cutoff:null,...overrides.permissions};
 const store={getCloudStatus:()=>({...status}),listCageManagers:()=>{calls.push({action:'directory'});return overrides.directory?.()||Promise.resolve({managers:[{name:'Jihwan Myung',acronym:'JM'},{name:'Vuong',acronym:'HV'}]});},getMyLabMember:()=>{calls.push({action:'profile'});return overrides.profile?.()||Promise.resolve({eligible:true,member:{name:'Jihwan Myung',acronym:'JM'}});},recordAppAccess:async()=>({recorded:true}),callReagents:async(action,args)=>{
  calls.push({action,args:clone(args)});if(overrides.rpc)return overrides.rpc(action,args);
  if(action==='access')return {permissions:{...permissions},members:[]};
  if(action==='list')return {rows:[],total:0,next_offset:null};
  throw Error('Unexpected RPC '+action);
 }};
 const document={hidden:false,getElementById:element,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>element('download'),addEventListener:(event,fn)=>documentListeners.set(event,fn)};
 const window={addEventListener:(event,fn)=>windowListeners.set(event,fn),print(){}};
 const location=new URL('https://synthetic.invalid/reagents/#usage');
 class TestURL extends URL{}TestURL.createObjectURL=()=> 'blob:synthetic';TestURL.revokeObjectURL=()=>{};
 const context=vm.createContext({cloudControlsHTML,cloudIndicatorHTML,showCloud1SignIn,createCloudMonitor:()=>({dispose(){}}),...model,...usage,...sorting,...inventoryExports,store,PUBLIC_CONFIG:config,document,window,location,console,crypto:webcrypto,TextEncoder,TextDecoder,Blob,URL:TestURL,structuredClone,FormData,setTimeout,clearTimeout,createWorkbookXlsx:workbook=>{workbooks.push(clone(workbook));return new Blob(['synthetic']);},backupViewerLinkHTML:()=>'',createAccessActivity:()=>({observe(){},resume(){},touch(){},suspend(){},reset(){},signOut(){}}),createOrdersUI:()=>({mount:async()=>{},dispose(){}}),renderAccessLogs:()=>()=>{}});
 const expose=`\nglobalThis.app={editRecord,useRecord,selectUsageItem,loadUsagePeople,recordList,exportRows,resetPrivate,render,usageLogger,setFilters:value=>{filters={...filters,...value};},seed:rows=>{member=true;permissions=globalThis.fixturePermissions;items=rows;inventoryLoaded=true;records=new Map(rows.map(row=>[row.id,row]));},submit:values=>editAction(values),invalidate:()=>{generation++;resetPrivate();},state:()=>({generation,viewGeneration,member,usagePeople:usagePeople?{key:usagePeople.key,directory:usagePeople.directory,mine:usagePeople.mine}:null,records:[...records.values()]})};`;
 context.fixturePermissions=permissions;vm.runInContext(appSource.replace(/^import .*;\n/gm,'').replace(/await start\(\);\s*$/,'')+expose,context);context.app.seed(structuredClone(overrides.inventory||inventory));
 const change=(name,value)=>{const fields=element('edit-fields'),input=fields.querySelector(`[name=${name}]`);assert.ok(input,`${name} must be present`);input.value=value;fields.onchange?.({target:input});};
 const search=value=>{const fields=element('edit-fields'),input=fields.querySelector('[name=usage_query]');input.value=value;input.selectionStart=value.length;fields.oninput({target:input});};
 return {app:context.app,element,status,permissions,calls,workbooks,downloads,location,change,search};
}

test('Record use starts with solvent shortcuts and requires an explicit valid item',async()=>{
 const f=fixture();f.app.editRecord(null,'usage');
 assert.equal(f.element('edit-title').textContent,'Record use');assert.equal(f.element('save').textContent,'Next');assert.equal(f.element('save').disabled,true);
 const fields=f.element('edit-fields');assert.equal(fields.querySelector('[name=usage_group]').value,'frequent');
 assert.deepEqual(fields.querySelector('[name=item_id]').options.map(option=>option.value),['','chloroform-a','chloroform-b','dcm']);
 for(const label of ['Frequent use','Chemicals','Equipment','Other'])assert.match(fields.innerHTML,new RegExp(`>${label}</option>`));
 f.change('item_id','chloroform-b');assert.equal(f.element('save').disabled,false);
 f.change('usage_group','chemicals');assert.equal(f.element('save').disabled,true);assert.equal(fields.querySelector('[name=item_id]').value,'');
 assert.deepEqual(fields.querySelector('[name=item_id]').options.map(option=>option.value),['','salt']);
 await assert.rejects(f.app.submit({usage_group:'chemicals',usage_query:'',item_id:'chloroform-b'}),/Choose an item/);
 f.change('item_id','salt');assert.equal(f.element('save').disabled,false);
 f.change('usage_group','equipment');assert.deepEqual(fields.querySelector('[name=item_id]').options.map(option=>option.value),['','qpcr']);assert.equal(f.element('save').disabled,true);
 f.change('usage_group','other');assert.deepEqual(fields.querySelector('[name=item_id]').options.map(option=>option.value),['','ab']);
});

test('search preserves full bottle identity, clears prior choice, and moves to a matching category',async()=>{
 const f=fixture();f.app.selectUsageItem();f.change('item_id','chloroform-a');
 f.search('Beta C102');assert.equal(f.element('save').disabled,true);assert.deepEqual(f.element('edit-fields').querySelector('[name=item_id]').options.map(option=>option.value),['','chloroform-b']);assert.match(f.element('edit-fields').innerHTML,/Chloroform · Beta · C102 · B · mL · Shelf B/);
 f.change('item_id','chloroform-b');await f.app.submit({usage_group:'frequent',usage_query:'Beta C102',item_id:'chloroform-b'});assert.equal(f.element('edit-title').textContent,'Record use · Chloroform');
 // The selection closure must use the exact registered record, not a same-name match.
 assert.equal(f.element('edit-fields').querySelector('[name=unit]').value,'mL');await settle();assert.equal(f.element('edit-fields').querySelector('[name=operator]').value,'JM');
 f.app.selectUsageItem();f.search('Salt brand S100');assert.equal(f.element('edit-fields').querySelector('[name=usage_group]').value,'chemicals');assert.deepEqual(f.element('edit-fields').querySelector('[name=item_id]').options.map(option=>option.value),['','salt']);
 f.search('no such item');assert.equal(f.element('save').disabled,true);assert.match(f.element('edit-fields').innerHTML,/No matching items/);
});

test('a selected same-name bottle sends its exact ID and version to record_usage',async()=>{
 let sent;const chosen={...inventory[1],version:12};const f=fixture({inventory:[inventory[0],chosen],rpc:async(action,args)=>{if(action==='access')return {permissions:f.permissions};if(action==='list')return {rows:[],total:0,next_offset:null};if(action==='record_usage'){sent=clone(args);return {item:chosen,usage:{id:'saved',kind:'usage',payload:{...args.p_event,recorded_by_acronym:'JM'}}};}throw Error(action);}});
 f.app.selectUsageItem();f.change('item_id',chosen.id);await f.app.submit({usage_group:'frequent',usage_query:'',item_id:chosen.id});await f.app.submit({event_date:'2026-01-01',amount:'2',unit:'mL',operator:'HV',apply_balance:true});
 assert.equal(sent.p_id,'chloroform-b');assert.equal(sent.p_expected_version,12);assert.equal(sent.p_event.remaining_amount,98);assert.equal(sent.p_apply_balance,true);assert.equal(sent.p_event.operator,'HV');assert.equal(Object.hasOwn(sent.p_event,'recorded_by_acronym'),false);
});

test('Used by is prefilled only from the signed-in profile and does not overwrite an edited operator',async()=>{
 for(const edited of [false,true]){
  const pending=deferred(),f=fixture({profile:()=>pending.promise});f.app.useRecord(inventory[0]);const operator=f.element('edit-fields').querySelector('[name=operator]');assert.equal(operator.value,'');if(edited)operator.value='HV';
  pending.resolve({eligible:true,member:{name:'Jihwan Myung',acronym:'JM'}});await settle();assert.equal(operator.value,edited?'HV':'JM');
 }
 const f=fixture({profile:async()=>({eligible:false,member:{name:'Not confirmed',acronym:'ZZ'}})});f.app.useRecord(inventory[0]);await settle();assert.equal(f.element('edit-fields').querySelector('[name=operator]').value,'');
});

test('pending profile and directory cannot cross an account or private reset',async()=>{
 for(const invalidation of ['account','reset']){
  const old=deferred(),f=fixture({profile:()=>old.promise,directory:()=>old.promise});f.app.useRecord(inventory[0]);const oldOperator=f.element('edit-fields').querySelector('[name=operator]');
  if(invalidation==='account'){f.status.email='someoneelse@example.invalid';f.status.username='new-user';}else f.app.invalidate();
  old.resolve({eligible:true,member:{name:'Private owner',acronym:'OLD'},managers:[{name:'Private owner',acronym:'OLD'}]});await settle();assert.equal(oldOperator.value,'');assert.equal(f.app.usageLogger({payload:{operator:'Private owner'}}),'—');
  if(invalidation==='reset'){assert.equal(f.app.state().usagePeople,null);assert.equal(f.element('edit-fields').innerHTML,'');}
 }
});

test('a completed account switch reloads usage people instead of borrowing the prior acronym',async()=>{
 let acronym='JM';const f=fixture({profile:async()=>({eligible:true,member:{acronym}})});await f.app.loadUsagePeople();f.app.useRecord(inventory[0]);assert.equal(f.element('edit-fields').querySelector('[name=operator]').value,'JM');
 f.status.email='vuong@example.invalid';f.status.username='vuong';acronym='HV';f.app.useRecord(inventory[0]);assert.equal(f.element('edit-fields').querySelector('[name=operator]').value,'');await settle();assert.equal(f.element('edit-fields').querySelector('[name=operator]').value,'HV');assert.equal(f.calls.filter(call=>call.action==='profile').length,2);
});

test('equipment use never subtracts stock even if a stale form submits apply_balance',async()=>{
 let sent;const equipment=inventory.find(row=>row.kind==='equipment'),f=fixture({rpc:async(action,args)=>{if(action==='record_usage'){sent=clone(args);return {item:equipment,usage:{id:'equipment-use',kind:'usage',payload:args.p_event}};}if(action==='access')return {permissions:f.permissions};if(action==='list')return {rows:[],total:0,next_offset:null};throw Error(action);}});
 f.app.useRecord(equipment);assert.match(f.element('edit-fields').innerHTML,/Time \/ uses/);assert.equal(f.element('edit-fields').querySelector('[name=apply_balance]'),null);
 await f.app.submit({event_date:'2026-01-01',amount:'3',unit:'hours',operator:'HV',apply_balance:true});assert.equal(sent.p_id,'qpcr');assert.equal(sent.p_apply_balance,false);assert.equal(Object.hasOwn(sent.p_event,'remaining_amount'),false);assert.equal(equipment.payload.remaining_amount,100);
});

test('usage table and XLSX show the actual logger stamp independently of Used by',async()=>{
 const rows=[{id:'new',kind:'usage',payload:{name:'Chloroform',event_date:'2026-01-02',amount:2,unit:'mL',operator:'HV',recorded_by_user_id:'owner',recorded_by_acronym:'JM'}},{id:'old',kind:'usage',payload:{name:'Dichloromethane',event_date:'2026-01-01',amount:1,unit:'mL',operator:'Vuong'}}];
 const f=fixture({rpc:async(action)=>action==='access'?{permissions:f.permissions}:{rows,total:rows.length,next_offset:null}});await f.app.render();
 assert.match(f.element('main').innerHTML,/>Logged by <span/);assert.match(f.element('main').innerHTML,/<td title="HV">JM<\/td>/);assert.match(f.element('main').innerHTML,/<td title="Vuong">HV<\/td>/);
 await f.app.exportRows('usage');assert.deepEqual(f.workbooks[0].sheets[0].rows[0],['Period','Reagent','Used','Remaining','Logged by']);assert.deepEqual(f.workbooks[0].sheets[0].rows.map(row=>row.at(-1)),['Logged by','JM','HV']);assert.equal(f.downloads.length,1);
});

test('an open usage editor cannot submit its original item after the account changes',async()=>{
 const f=fixture();f.app.useRecord(inventory[0]);f.status.email='different@example.invalid';f.status.username='different';
 await assert.rejects(f.app.submit({event_date:'2026-01-01',amount:'1',unit:'mL',operator:'JM',apply_balance:false}),/session changed/i);
 assert.equal(f.calls.some(call=>call.action==='record_usage'),false);
});

test('late profile completion cannot modify a replacement editor or a closed form',async()=>{
 for(const replacement of ['selector','closed']){
  const pending=deferred(),f=fixture({profile:()=>pending.promise});f.app.useRecord(inventory[0]);const oldOperator=f.element('edit-fields').querySelector('[name=operator]');
  if(replacement==='selector')f.app.selectUsageItem();else f.element('editor').close();
  pending.resolve({eligible:true,member:{acronym:'JM'}});await settle();assert.equal(oldOperator.value,'');
  if(replacement==='selector'){assert.equal(f.element('edit-title').textContent,'Record use');assert.equal(f.element('edit-fields').querySelector('[name=operator]'),null);assert.equal(f.element('save').textContent,'Next');}
 }
});
