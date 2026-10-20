import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../reagents/model.js';
import * as sorting from '../reagents/table-sort.js';
import * as inventoryExports from '../reagents/inventory-export.js';
import {createOrdersUI,bindSheetOrderImportDialog} from '../reagents/orders.js';
import {cloudControlsHTML,cloudIndicatorHTML,showCloud1SignIn} from '../mouse-data/cloud-status.js';

const appSource=await readFile(new URL('../reagents/app.js',import.meta.url),'utf8');
const item=(id,date,extra={})=>({id,kind:'item',version:1,payload:{name:`Reagent ${id}`,inventory_classification:'Chemicals',received_date:date,status:'in_stock',...extra}});

function appFixture(rows,{route='inventory',access={},list=async kind=>rows.filter(row=>row.kind===kind),mutate=async()=>({})}={}){
 const elements=new Map(),windowListeners=new Map(),documentListeners=new Map(),workbooks=[],calls=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',dataset:{},value:'',open:false,listeners:new Map(),addEventListener(event,handler){this.listeners.set(event,handler);},setAttribute(){},focus(){},showModal(){this.open=true;},close(){this.open=false;},click(){}});return elements.get(id);};
 const status={url:'https://synthetic.supabase.co',colonyId:'synthetic-colony',signedIn:true,email:'member@example.invalid',username:'member',role:'editor',exportLevel:'high',activeCloud:'cloud1'};
 const permissions={role:'editor',can_write:false,can_import:false,can_manage_safety:false,export_level:'high',...access},location=new URL(`https://synthetic.invalid/reagents/#${route}`);
 let orderConfig;
 const context=vm.createContext({bindSheetOrderImportDialog,createPresence:()=>({refresh(){},clear(){},destroy(){}}),cloudControlsHTML,cloudIndicatorHTML,showCloud1SignIn,createCloudMonitor:()=>({dispose(){}}),createOrdersUI:config=>(orderConfig=config,{dispose(){},refresh(){},async mount(){}}),...model,...sorting,...inventoryExports,
  backupViewerLinkHTML:()=>'',store:{getCloudStatus:()=>({...status}),callReagents:async(action,args)=>{calls.push({action,args});if(action==='access')return {permissions};if(action!=='list')return mutate(action,args);const selected=await list(args?.p_kind);return {rows:selected,total:selected.length,next_offset:null};}},PUBLIC_CONFIG:{},document:{getElementById:element,createElement:()=>element('download'),querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(name,fn)=>documentListeners.set(name,fn)},window:{addEventListener:(event,handler)=>windowListeners.set(event,handler)},location,console,setTimeout,clearTimeout,URL,Blob,
  createWorkbookXlsx:book=>{workbooks.push(structuredClone(book));return new Blob(['synthetic']);},createAccessActivity:()=>({observe(){},resume(){},touch(){},suspend(){},reset(){},signOut(){}})});
 context.fixtureRows=structuredClone(rows);context.fixturePermissions=permissions;
 const expose='\nmember=true;permissions=globalThis.fixturePermissions;items=globalThis.fixtureRows;inventoryLoaded=true;records=new Map(items.map(row=>[row.id,row]));globalThis.app={inventoryView,render,sortTable,exportRows,ensureInventory,ordersView,rpc,detail,editRecord,editInventoryDates,settingsView,submitEditor:values=>editAction(values),setAccess:patch=>Object.assign(permissions,patch),switchActor:rows=>{generation++;member=true;items=rows;records=new Map(rows.map(row=>[row.id,row]));inventoryLoaded=true;},emptyCache:()=>{inventoryLoaded=false;inventoryLoad=null;},state:()=>({loaded:inventoryLoaded,ids:items.map(row=>row.id)}),setFilters:value=>{filters={...filters,...value};}};';
 vm.runInContext(appSource.replace(/^import .*;\n/gm,'').replace(/await start\(\);\s*$/,'')+expose,context);
 const renderedIds=()=>[...element('main').innerHTML.matchAll(/data-action="open" data-id="([^"]+)"/g)].map(match=>match[1]);
 return {app:context.app,element,renderedIds,workbooks,calls,location,documentListeners,windowListeners,get orderConfig(){return orderConfig;}};
}

test('arrival date uses only a valid recorded received date, never an order or import date',()=>{
 assert.equal(model.inventoryArrivalDate(item('known','2026-10-21')),'2026-10-21');
 assert.equal(model.inventoryArrivalDate(item('leap','2024-02-29')),'2024-02-29');
 for(const received_date of [null,undefined,'','2026-02-30','2026-2-3','2026-10-21T00:00:00Z','Unknown',42])assert.equal(model.inventoryArrivalDate(item('unknown',received_date,{request_date:'2026-10-20',created_at:'2026-10-21T00:00:00Z'})),null,String(received_date));
});

test('Inventory starts with latest arrivals, undated items last, and exposes a compact sortable date column',async()=>{
 const rows=[item('undated',null),item('old','2026-01-01'),item('new','2026-10-21'),item('invalid','2026-02-30')],f=appFixture(rows);f.app.inventoryView();
 assert.deepEqual(f.renderedIds(),['new','old','invalid','undated']);
 assert.match(f.element('main').innerHTML,/aria-sort="descending"[^>]*><button[^>]*data-sort-key="arrival"/);
 assert.match(f.element('main').innerHTML,/class="inventory-arrival">2026-10-21/);assert.doesNotMatch(f.element('main').innerHTML,/2026-02-30/);
 await f.app.sortTable('inventory','arrival');assert.deepEqual(f.renderedIds(),['old','new','invalid','undated']);
 await f.app.sortTable('inventory','arrival');assert.deepEqual(f.renderedIds(),['new','old','invalid','undated']);
 assert.deepEqual(rows.map(row=>row.id),['undated','old','new','invalid']);
});

test('Inventory defaults to Chemicals, keeps newest confirmed arrivals first, and lets the user choose Equipment or all classifications',async()=>{
 const rows=[{...item('equipment','2026-10-21',{inventory_classification:'Equipment'}),kind:'equipment'},item('unknown',null),item('older','2026-01-01'),item('newest','2026-10-20'),item('antibody','2026-10-21',{inventory_classification:'Antibody'})],f=appFixture(rows);f.app.inventoryView();
 assert.deepEqual(f.renderedIds(),['newest','older','unknown']);assert.match(f.element('main').innerHTML,/<option value="Chemicals" selected>Chemicals<\/option>/);
 f.app.setFilters({category:'Equipment'});f.app.inventoryView();assert.deepEqual(f.renderedIds(),['equipment']);
 f.app.setFilters({category:''});f.app.inventoryView();assert.deepEqual(f.renderedIds(),['antibody','equipment','newest','older','unknown']);
 await f.app.sortTable('inventory','name');assert.deepEqual(f.renderedIds(),['antibody','equipment','newest','older','unknown']);
 f.location.hash='safety';f.windowListeners.get('hashchange')();await new Promise(resolve=>setImmediate(resolve));assert.match(f.element('main').innerHTML,/All classifications/);assert.doesNotMatch(f.element('main').innerHTML,/<option value="Chemicals" selected/);
 f.location.hash='inventory';f.windowListeners.get('hashchange')();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.renderedIds(),['newest','older','unknown']);
});

test('an Inventory without Chemicals stays clearly filtered instead of silently displaying Equipment',()=>{
 const f=appFixture([{...item('only-equipment','2026-10-21'),kind:'equipment'}]);f.app.inventoryView();assert.deepEqual(f.renderedIds(),[]);assert.match(f.element('main').innerHTML,/<option value="Chemicals" selected>Chemicals<\/option>/);assert.match(f.element('main').innerHTML,/No matching items/);
});

test('High and Max inventory edits are available with existing write rights; other tiers and owner restrictions remain enforced',async()=>{
 const row=item('editable','2026-10-21');
 for(const access of [{role:'owner',export_level:'low'},{role:'manager',export_level:'low'},{role:'editor',export_level:'high'},{role:'editor',export_level:'max'}]){
  const f=appFixture([row],{access:{can_write:true,can_edit_inventory:true,...access}});f.app.inventoryView();assert.match(f.element('main').innerHTML,/data-action="new-item"/);await f.app.detail(row.id);assert.match(f.element('main').innerHTML,/data-action="edit"/);
 }
 for(const access of [{role:'editor',export_level:'low'},{role:'editor',export_level:'mid1'},{role:'editor',export_level:'mid2'},{role:'viewer',export_level:'high'},{role:'editor',export_level:'high',guest_level:'guest3'},{role:'editor',export_level:'high',can_write:false},{role:'editor',export_level:'high',can_edit_inventory:false},{role:'editor',export_level:'high',reagents_permissions:{'reagents.inventory.write':false}}]){
  const f=appFixture([row],{access:{can_write:true,can_edit_inventory:true,...access}});f.app.inventoryView();assert.doesNotMatch(f.element('main').innerHTML,/data-action="new-item"/);await f.app.detail(row.id);assert.doesNotMatch(f.element('main').innerHTML,/data-action="edit"/);f.app.editRecord(row);assert.equal(f.element('editor').open,false);assert.equal(f.calls.filter(call=>call.action==='save').length,0);
 }
 const low={role:'editor',export_level:'low',can_write:true};assert.equal(model.canWriteKind(low,'usage'),true);assert.equal(model.canWriteKind(low,'vendor'),true);assert.equal(model.canWriteKind({...low,can_manage_safety:true},'safety'),true);
 const high=appFixture([row],{route:'settings',access:{can_write:true,can_edit_inventory:true}});await high.app.settingsView(0);assert.match(high.element('main').innerHTML,/<dt>Inventory editing<\/dt><dd>Allowed<\/dd>/);
 const blocked=appFixture([row],{route:'settings',access:{can_write:true,can_edit_inventory:false}});await blocked.app.settingsView(0);assert.match(blocked.element('main').innerHTML,/<dt>Inventory editing<\/dt><dd>Read only<\/dd>/);
});

test('explicit source arrivals are available without raw rows and never use ambiguous, future or other source dates',()=>{
 const today='2026-10-21',raw=value=>({...item('source',null),payload:{...item('source',null).payload,original_fields:{'Order Arrival Date':value,'Order Date':'2026-10-20','Expected Arrival Date':'2026-10-20'}}});
 for(const value of ['2024-12-16','2024-12-16T00:00:00','2024-12-16 00:00:00.000','2024-12-16T00:00:00Z'])assert.equal(model.inventoryArrivalDate(raw(value),today),'2024-12-16');
 for(const value of ['0000-01-01','2026-02-30','2026/10/20','10/20/2026','2026-10-20T13:00:00','2099-01-01T00:00:00',45642,null,{},'2026-10-20 planned'])assert.equal(model.inventoryArrivalDate(raw(value),today),null,String(value));
 const projected={...item('safe',null),inventory_source_arrival_date:'2019-08-23'};assert.equal(model.inventoryArrivalDate(projected,today),'2019-08-23');assert.equal(model.inventoryArrivalDate({...projected,inventory_source_arrival_date:'2099-01-01'},today),null);
 for(const header of ['Arrival date / stock date','Date delivered'])assert.equal(model.inventoryArrivalDate({payload:{original_fields:{[header]:'2025-12-10T00:00:00'}}},today),'2025-12-10');
 assert.equal(model.inventoryArrivalDate({payload:{original_fields:{'Date delivered':'2025-12-10','Order Arrival Date':'2024-12-16'}}},today),null);
 assert.equal(model.inventoryArrivalDate({payload:{original_fields:{'Date delivered':'2025-12-10','Arrival date / stock date':'2025-12-10'}}},today),null);
 assert.equal(model.inventoryArrivalDate({payload:{original_fields:{'Date delivered':'2025-12-10','Note (delivery date)':'2026-07-24','Inventory check':'2026-07-24'}}},today),'2025-12-10');
 assert.equal(model.inventoryArrivalDate({...item('not-arrival',null,{request_date:'2026-10-20',opened_date:'2026-10-20',expiry_date:'2026-10-20',source_fields:{'Order Arrival Date':'2026-10-20'}}),record_date:'2026-10-20'},today),null);
});

test('latest product delivery sorts ahead with a distinct badge while physical arrival and export evidence remain separate',async()=>{
 const older={...item('product',null,{original_fields:{'Order Arrival Date':'2019-08-23T00:00:00'},latest_product_delivery_date:'2026-07-24',lot_number:'Original lot',expiry_date:'2027-01-01'}),inventory_source_arrival_date:'2019-08-23'},f=appFixture([item('other','2026-01-01'),older]);f.app.inventoryView();
 assert.deepEqual(f.renderedIds(),['product','other']);assert.match(f.element('main').innerHTML,/2026-07-24[^]*?Product delivery/);assert.equal(model.inventoryArrivalDate(older),'2019-08-23');assert.deepEqual(model.inventoryDateInfo(older),{date:'2026-07-24',basis:'Latest product delivery',productDelivery:true});
 await f.app.exportRows();const sheet=f.workbooks[0].sheets[0],columns=sheet.rows[0],row=sheet.rows[1];assert.equal(row[columns.indexOf('In-stock date (arrival)')],'2019-08-23');assert.equal(row[columns.indexOf('Latest product delivery')],'2026-07-24');assert.equal(row[columns.indexOf('Inventory date')],'2026-07-24');assert.equal(row[columns.indexOf('Inventory date basis')],'Latest product delivery');assert.equal(row[columns.indexOf('Lot / batch')],'Original lot');
 await f.app.exportRows('item','pdf');const html=f.element('pdf-export-content').innerHTML;assert.match(html,/Arrived:<\/span> 2019-08-23/);assert.match(html,/Latest product delivery:<\/span> 2026-07-24/);
 const same={...older,payload:{...older.payload,received_date:'2026-07-24'}};assert.equal(model.inventoryDateInfo(same).productDelivery,false);
});

test('date-only editing preserves absent fields, source evidence and all unrelated metadata',async()=>{
 const previous={name:'Legacy bottle',original_fields:{'Order Arrival Date':'2019-08-23T00:00:00','Order Date':'2019-06-01'},expiry_date:'2027-01-01',category:'Ab',safety:{classification:['Irritant'],review_status:'pending'},custom:{keep:true}},record={...item('date-only',null),payload:previous,inventory_source_arrival_date:'2019-08-23'},f=appFixture([record],{access:{can_write:true,can_edit_inventory:true},mutate:async(action,args)=>{assert.equal(action,'save');return {...record,payload:args.p_payload,version:2};}});
 f.app.editInventoryDates(record);const fields=f.element('edit-fields').innerHTML;assert.match(fields,/name="received_date"[^>]*value=""/);assert.match(fields,/Source arrival: 2019-08-23 \(read only\)/);assert.match(fields,/Latest product delivery/);assert.doesNotMatch(fields,/name="(?:inventory_classification|expiry_date|category)"/);
 await f.app.submitEditor({received_date:'',latest_product_delivery_date:'2026-07-24'});const saved=f.calls.find(call=>call.action==='save');assert.ok(saved);assert.equal(saved.args.p_expected_version,1);assert.deepEqual(JSON.parse(JSON.stringify(saved.args.p_payload)),{...previous,latest_product_delivery_date:'2026-07-24'});assert.equal(Object.hasOwn(saved.args.p_payload,'received_date'),false);assert.equal(Object.hasOwn(saved.args.p_payload,'inventory_source_arrival_date'),false);assert.deepEqual(previous.original_fields,{'Order Arrival Date':'2019-08-23T00:00:00','Order Date':'2019-06-01'});
});

test('date-only Save blocks future, invalid and stale access; clearing a manual arrival preserves source fallback',async()=>{
 const previous={name:'Recorded stock',received_date:'2026-01-01',original_fields:{'Order Arrival Date':'2019-08-23T00:00:00'}};
 const corrected={payload:{received_date:'2025-12-09',original_fields:{'Date delivered':'2025-12-10'}}};assert.equal(model.inventoryArrivalDate(corrected,'2026-10-21'),'2025-12-09');assert.equal(model.inventoryDateInfo(corrected,'2026-10-21').basis,'Arrival');assert.equal(corrected.payload.original_fields['Date delivered'],'2025-12-10');
 const sameDate={payload:{received_date:'2025-12-10',original_fields:{'Date delivered':'2025-12-10'}}};assert.equal(model.inventoryDateInfo(sameDate,'2026-10-21').basis,'Arrival');
 const cleared=model.mergeInventoryDates(previous,{received_date:'',latest_product_delivery_date:''},'2026-10-21');assert.equal(cleared.received_date,'');assert.equal(Object.hasOwn(cleared,'latest_product_delivery_date'),false);assert.equal(model.inventoryArrivalDate({payload:cleared},'2026-10-21'),'2019-08-23');
 for(const value of ['2099-01-01','2026-02-30','2026-10-20T00:00:00'])assert.throws(()=>model.mergeInventoryDates(previous,{latest_product_delivery_date:value},'2026-10-21'),/valid date no later than today/);
 const record={...item('restricted','2026-01-01'),payload:previous},f=appFixture([record],{access:{can_write:true,can_edit_inventory:true}});f.app.editInventoryDates(record);await assert.rejects(f.app.submitEditor({received_date:'2026-01-01',latest_product_delivery_date:'2099-01-01'}),/valid date no later than today/);assert.equal(f.calls.filter(call=>call.action==='save').length,0);f.app.setAccess({can_edit_inventory:false});await assert.rejects(f.app.submitEditor({received_date:'2026-01-01',latest_product_delivery_date:'2026-07-24'}),/access changed/);assert.equal(f.calls.filter(call=>call.action==='save').length,0);
});

test('an unreviewed arrival has a neutral safety marker without being treated as hazardous',()=>{
 const pending=item('pending','2026-10-21',{safety:{classification:'unknown',review_status:'pending'}}),f=appFixture([pending,item('legacy',null,{safety:{classification:'unknown'}})]);f.app.inventoryView();assert.match(f.element('main').innerHTML,/class="badge safety-review-pending">Not reviewed/);assert.equal(model.hazardous(pending.payload),false);assert.doesNotMatch(f.element('main').innerHTML,/\bSafe\b|No hazards|Non-hazardous/);
});

test('date sorting also works for Dangerous chemicals without admitting ordinary rows',async()=>{
 const rows=[item('old','2026-01-01',{safety:{flagged:true}}),item('new','2026-10-21',{safety:{classification:'Toxic'}}),item('ordinary','2026-10-22')],f=appFixture(rows,{route:'safety'});f.app.inventoryView(true);
 assert.deepEqual(f.renderedIds(),['new','old']);await f.app.sortTable('dangerous','arrival');assert.deepEqual(f.renderedIds(),['old','new']);
});

test('XLSX and PDF preserve the current arrival-date sort and do not invent dates',async()=>{
 const rows=[item('unknown',null,{request_date:'2020-01-01'}),item('old','2026-01-01'),item('new','2026-10-21')],f=appFixture(rows);f.app.inventoryView();await f.app.exportRows();
 const sheet=f.workbooks[0].sheets[0],id=sheet.rows[0].indexOf('Record ID'),arrival=sheet.rows[0].indexOf('In-stock date (arrival)');assert.ok(arrival>=0);assert.deepEqual(sheet.rows.slice(1).map(row=>[row[id],row[arrival]]),[['new','2026-10-21'],['old','2026-01-01'],['unknown','']]);
 await f.app.sortTable('inventory','arrival');await f.app.exportRows('item','pdf');const html=f.element('pdf-export-content').innerHTML;assert.ok(html.indexOf('Reagent old')<html.indexOf('Reagent new'));assert.match(html,/Arrived:<\/span> 2026-01-01/);assert.doesNotMatch(html,/2020-01-01/);
});

test('an order Inventory link opens only its authorized item and Back returns to the list',async()=>{
 const f=appFixture([item('purchase:one','2026-10-21')],{route:'inventory/purchase%3Aone'});await f.app.render();assert.match(f.element('main').innerHTML,/<h2>Reagent purchase:one<\/h2>/);
 const button={disabled:false,dataset:{action:'back'},hasAttribute:()=>false};await f.documentListeners.get('click')({target:{closest:()=>button}});assert.equal(f.location.hash,'#inventory');
 const denied=appFixture([item('purchase:one','2026-10-21')],{route:'inventory/purchase%3Aone',access:{reagents_permissions:{'reagents.inventory.read':false}}});await denied.app.render();assert.doesNotMatch(denied.element('main').innerHTML,/Reagent purchase:one/);assert.match(denied.element('main').innerHTML,/not available/);
});

test('a fresh Inventory cannot reopen removed or archived cached items through an old order link',async()=>{
 const f=appFixture([item('removed','2026-01-01')],{route:'inventory/removed',list:async()=>[]});f.app.emptyCache();await f.app.render();assert.doesNotMatch(f.element('main').innerHTML,/<h2>Reagent removed<\/h2>/);assert.match(f.element('main').innerHTML,/No matching items/);
 const archived=appFixture([{...item('archived','2026-01-01'),archived:true}],{route:'inventory/archived'});await archived.app.render();assert.doesNotMatch(archived.element('main').innerHTML,/<h2>Reagent archived<\/h2>/);assert.match(archived.element('main').innerHTML,/No matching items/);
});

test('saving an arrival invalidates Inventory without eagerly loading it on Orders',async()=>{
 const fresh=item('received','2026-10-21'),f=appFixture([item('old','2026-01-01')],{route:'orders',list:async kind=>kind==='item'?[fresh]:[]});await f.app.ordersView(0);await f.orderConfig.refreshInventory();assert.equal(f.app.state().loaded,false);assert.equal(f.calls.length,0);
 const result=await f.app.ensureInventory();assert.deepEqual(Array.from(result,row=>row.id),['received']);assert.deepEqual(f.calls.map(call=>call.action),['access','list','list','access']);
});

test('an Inventory load started before receipt confirmation cannot restore stale stock',async()=>{
 let release,first=true;const pending=new Promise(resolve=>release=resolve),fresh=item('received','2026-10-21');const f=appFixture([],{route:'orders',list:async kind=>{if(kind!=='item')return [];if(first){first=false;return pending;}return [fresh];}});await f.app.ordersView(0);f.app.emptyCache();const loading=f.app.ensureInventory();await new Promise(resolve=>setImmediate(resolve));await f.orderConfig.refreshInventory();release([item('stale','2026-01-01')]);const result=await loading;assert.deepEqual(Array.from(result,row=>row.id),['received']);assert.deepEqual(Array.from(f.app.state().ids),['received']);
});

test('a receipt completed after navigating away from Orders refreshes the current Inventory',async()=>{
 let release,first=true;const waiting=new Promise(resolve=>release=resolve),fresh=item('arrived','2026-10-21');const f=appFixture([item('old','2026-01-01')],{route:'orders',list:async kind=>kind==='item'?[fresh]:[],mutate:async()=>waiting});
 const saving=f.app.rpc('order_transition',{p_action:'receive'});f.location.hash='inventory';release({status:'received',inventory_id:'arrived'});await saving;await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.renderedIds(),['arrived']);assert.equal(f.app.state().loaded,true);
});

test('an uncertain receipt invalidates cached stock, but an old actor response cannot invalidate a new actor cache',async()=>{
 const unknown=appFixture([item('old','2026-01-01')],{route:'orders',mutate:async()=>{throw Error('Connection lost');}});await assert.rejects(unknown.app.rpc('sheet_order_receive',{}),/Connection lost/);assert.equal(unknown.app.state().loaded,false);assert.equal(unknown.calls.filter(call=>call.action==='list').length,0);
 let release;const waiting=new Promise(resolve=>release=resolve),f=appFixture([item('old','2026-01-01')],{route:'orders',mutate:async()=>waiting});const saving=f.app.rpc('order_transition',{p_action:'receive'});f.app.switchActor([item('new-actor','2026-10-21')]);release({status:'received'});await assert.rejects(saving,/session changed/);assert.equal(f.app.state().loaded,true);assert.deepEqual(Array.from(f.app.state().ids),['new-actor']);
});

function orderFixture({role='owner',cloud='cloud1',rpc=async()=>({rows:[],total:0,next_offset:null}),refreshInventory=async()=>{}}={}){
 const nodes=new Map(),calls=[],notices=[];let current=true,permissions={role,can_order:false},currentCloud=cloud;
 const makeNode=id=>({id,innerHTML:'',textContent:'',disabled:false,value:'',listeners:{},elements:[],addEventListener(type,handler){this.listeners[type]=handler;},removeEventListener(type){delete this.listeners[type];},querySelector(){return null;},scrollIntoView(){}});
 const node=id=>{if(nodes.has(id))return nodes.get(id);const n=makeNode(id);nodes.set(id,n);return n;};node('order-search').elements.query={value:'',addEventListener(){}};
 const form={...makeNode('receipt-form'),elements:[{name:'acceptance_date',value:'2026-10-20'},{name:'storage_location',value:'Shelf A'}]},save=makeNode('save'),error=makeNode('error'),slot=makeNode('slot'),card=makeNode('card');form.querySelector=()=>save;slot.querySelector=()=>form;card.querySelector=selector=>selector==='.order-action-form'?slot:error;node('sheet-receipt-editor').querySelector=()=>card;
 class FormDataFake{constructor(form){this.values=form.elements.filter(field=>field.name&&!field.disabled).map(field=>[field.name,field.value]);}[Symbol.iterator](){return this.values[Symbol.iterator]();}}
 const controller=createOrdersUI({main:node('main'),document:{getElementById:node},FormData:FormDataFake,getPermissions:()=>permissions,getCloudStatus:()=>({activeCloud:currentCloud}),isCurrent:()=>current,uuid:()=> 'synthetic-request',notify:(...args)=>notices.push(args),refreshInventory,rpc:async(action,args)=>{calls.push({action,args});return rpc(action,args);}});
 const click=(action,extra={})=>node('main').listeners.click({target:{closest:()=>({disabled:false,dataset:{orderAction:action,...extra}})}});
 return {node,form,save,error,slot,card,controller,calls,notices,click,submit:()=>form.listeners.submit({preventDefault(){}}),setRole:role=>permissions={...permissions,role},setCloud:value=>currentCloud=value,revoke(){current=false;controller.dispose();}};
}
const sheetRow=(id,extra={})=>({id,version:3,payload:{name:`Sheet reagent ${id}`,status:'arrived',request_date:'2026-09-01'},allowed_actions:['receive'],...extra});

test('sheet rows require server arrival eligibility and do not duplicate stock already recorded in the sheet',async()=>{
 const rows=[sheetRow('new'),sheetRow('ordered',{allowed_actions:[],payload:{name:'Not arrived',status:'ordered'}}),sheetRow('known',{allowed_actions:[],inventory_recorded_in_sheet:true}),sheetRow('linked',{allowed_actions:[],inventory_id:'sheet-receipt:linked',inventory_received_date:'2026-10-20'})],f=orderFixture({rpc:async action=>({rows:action==='sheet_order_list'?rows:[],total:action==='sheet_order_list'?rows.length:0,next_offset:null})});await f.controller.mount();await f.click('sheet-refresh');const html=f.node('sheet-orders-rows').innerHTML;
 assert.equal((html.match(/data-order-action="sheet-receipt"/g)||[]).length,1);assert.match(html,/data-sheet-id="new"/);assert.match(html,/Inventory recorded in sheet/);assert.match(html,/href="#inventory\/sheet-receipt%3Alinked"/);assert.match(html,/Arrived 2026-10-20/);
 await f.click('sheet-receipt',{sheetId:'ordered'});assert.equal(f.calls.filter(call=>call.action==='order_locations').length,0);
});

test('sheet receipt asks for the actual arrival date and uses a single explicit owner mutation',async()=>{
 let invalidations=0;const row=sheetRow('new'),linked={...row,inventory_id:'sheet-receipt:new',allowed_actions:[]};const f=orderFixture({refreshInventory:async()=>invalidations++,rpc:async action=>action==='sheet_order_list'?{rows:[row],total:1,next_offset:null}:action==='order_locations'?{locations:['Shelf A']}:action==='sheet_order_receive'?{order:linked,inventory:{id:linked.inventory_id,kind:'item',payload:{received_date:'2026-10-20',location:'Shelf A',source_order_id:'new',source_receipt_date:'2026-10-20',source_receipt_location:'Shelf A'}},replayed:false}:{rows:[],total:0,next_offset:null}});await f.controller.mount();await f.click('sheet-refresh');await f.click('sheet-receipt',{sheetId:'new'});
 assert.match(f.slot.innerHTML,/name="acceptance_date"[^>]*value=""/);assert.match(f.slot.innerHTML,/not already in Inventory/);assert.match(f.slot.innerHTML,/>Add to Inventory<\/button>/);assert.equal(f.calls.filter(call=>call.action==='sheet_order_receive').length,0);await f.submit();
 assert.equal(invalidations,1);assert.deepEqual(f.calls.find(call=>call.action==='sheet_order_receive').args,{p_id:'new',p_expected_version:3,p_acceptance_date:'2026-10-20',p_storage_location:'Shelf A'});assert.match(f.notices[0][0],/^Arrival and storage saved to Inventory/);assert.equal(f.calls.filter(call=>call.action==='order_transition').length,0);
});

test('uncertain sheet receipt retries the same date, location and expected version without reading edited fields',async()=>{
 let writes=0;const row=sheetRow('retry'),f=orderFixture({rpc:async action=>{if(action==='sheet_order_list')return {rows:[row],total:1,next_offset:null};if(action==='order_locations')return {locations:['Shelf A']};if(action==='sheet_order_receive'){writes++;if(writes===1)throw Error('Connection lost');return {order:{...row,inventory_id:'sheet-receipt:retry'},inventory:{id:'sheet-receipt:retry',kind:'item',payload:{source_order_id:'retry',source_receipt_date:'2026-10-20',source_receipt_location:'Shelf A'}},replayed:true};}return {rows:[],total:0,next_offset:null};}});await f.controller.mount();await f.click('sheet-refresh');await f.click('sheet-receipt',{sheetId:'retry'});await f.submit();assert.equal(f.save.disabled,false);assert.equal(f.save.textContent,'Retry same arrival');assert.equal(f.form.elements[0].disabled,true);f.form.elements[0].value='2026-10-21';f.form.elements[1].value='Changed';await f.submit();const calls=f.calls.filter(call=>call.action==='sheet_order_receive');assert.deepEqual(calls[0].args,calls[1].args);assert.equal(writes,2);
});

test('sheet receipt never runs on Cloud 2 or after role/account loss',async()=>{
 for(const change of ['cloud2','role','account']){const row=sheetRow('blocked'),f=orderFixture({rpc:async action=>action==='sheet_order_list'?{rows:[row],total:1,next_offset:null}:action==='order_locations'?{locations:['Shelf A']}:{rows:[],total:0,next_offset:null}});await f.controller.mount();await f.click('sheet-refresh');await f.click('sheet-receipt',{sheetId:'blocked'});if(change==='cloud2')f.setCloud('cloud2');else if(change==='role')f.setRole('editor');else f.revoke();await f.submit();assert.equal(f.calls.filter(call=>call.action==='sheet_order_receive').length,0,change);}
 const cloud2=orderFixture({cloud:'cloud2',rpc:async action=>({rows:action==='sheet_order_list'?[sheetRow('cloud2')]:[],total:1,next_offset:null})});await cloud2.controller.mount();await cloud2.click('sheet-refresh');assert.doesNotMatch(cloud2.node('sheet-orders-rows').innerHTML,/data-order-action="sheet-receipt"/);await cloud2.click('sheet-receipt',{sheetId:'cloud2'});assert.equal(cloud2.calls.filter(call=>call.action==='order_locations').length,0);
});
