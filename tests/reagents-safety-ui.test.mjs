import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../reagents/model.js';
import * as sorting from '../reagents/table-sort.js';
import * as inventoryExports from '../reagents/inventory-export.js';

// Exercise the production table and sort handlers with authorized synthetic rows.
// The harness has no browser storage, private records, network or credentials.
const appSource=await readFile(new URL('../reagents/app.js',import.meta.url),'utf8');
const item=(id,classification,extra={})=>({id,kind:'item',version:1,payload:{name:`Reagent ${id}`,inventory_classification:'Chemicals',safety:{classification},...extra}});

function fixture(rows,{route='safety'}={}){
 const elements=new Map(),windowListeners=new Map(),workbooks=[],downloads=[],element=id=>{
  if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',dataset:{},value:'',open:false,listeners:new Map(),addEventListener(event,handler){this.listeners.set(event,handler);},setAttribute(){},focus(){},showModal(){this.open=true;},close(){this.open=false;},click(){downloads.push(this.download);}});
  return elements.get(id);
 };
 const status={url:'https://synthetic.supabase.co',colonyId:'synthetic-colony',signedIn:true,email:'member@example.invalid',username:'member',role:'editor',exportLevel:'high'};
 const permissions={role:'editor',can_write:false,can_import:false,can_manage_safety:false,export_level:'high'};
 const location=new URL(`https://synthetic.invalid/reagents/#${route}`);
 const context=vm.createContext({...model,...sorting,...inventoryExports,store:{getCloudStatus:()=>({...status}),callReagents:async(action,args)=>action==='access'?{permissions}:{rows:args?.p_kind==='safety'?[]:rows.filter(row=>row.kind===args?.p_kind),total:args?.p_kind==='safety'?0:rows.filter(row=>row.kind===args?.p_kind).length,next_offset:null}},PUBLIC_CONFIG:{},document:{getElementById:element,createElement:()=>element('download'),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener:(event,handler)=>windowListeners.set(event,handler)},location,console,setTimeout,clearTimeout,URL,Blob,createWorkbookXlsx:book=>{workbooks.push(structuredClone(book));return new Blob(['synthetic']);},createAccessActivity:()=>({observe(){},reset(){},signOut(){}})});
 context.fixtureRows=structuredClone(rows);context.fixturePermissions=permissions;
 const expose='\nmember=true;permissions=globalThis.fixturePermissions;items=globalThis.fixtureRows;records=new Map(items.map(row=>[row.id,row]));globalThis.app={inventoryView,sortTable,toxicityClassifications,filterInventory,toxicityOptions,exportRows,resetPrivate,setFilters:value=>{filters={...filters,...value};},state:()=>({filters:{...filters},offset})};';
 vm.runInContext(appSource.replace(/^import .*;\n/gm,'').replace(/await start\(\);\s*$/,'')+expose,context);
 const renderedRows=()=>{
  const body=element('main').innerHTML.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]||'';
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([,row])=>({id:row.match(/data-action="open" data-id="([^"]+)"/)?.[1],cells:[...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([,cell])=>cell)}));
 };
 const dropdown=()=>element('main').innerHTML.match(/<select id="toxicity"[^>]*>([\s\S]*?)<\/select>/)?.[1]||'';
 return {app:context.app,element,renderedRows,dropdown,workbooks,downloads,location,windowListeners,safetyCell:id=>renderedRows().find(row=>row.id===id)?.cells[5]};
}

test('Dangerous chemicals shows the recorded Irritant classification instead of generic SDS text',()=>{
 const f=fixture([item('bay','Irritant',{name:'Bay K8644'})]);f.app.inventoryView(true);
 assert.match(f.safetyCell('bay'),/>Irritant<\/span>/);assert.doesNotMatch(f.safetyCell('bay'),/Review SDS/);
 assert.match(f.element('main').innerHTML,/Bay K8644/);
 // Ordinary readers receive the same useful label without safety-edit access.
 assert.doesNotMatch(f.element('main').innerHTML,/data-action="safety-edit"/);
});

test('Safety retains Review SDS for flagged unknowns and an em dash when no classification is recorded',()=>{
 const sentinels=['','unknown','unverified','none','N','no','na','n/a','無','未確認','未分類','not recorded'];
 const rows=sentinels.map((classification,index)=>item(`flag-${index}`,classification,{safety:{classification,flagged:true}}));
 rows.push(item('missing',undefined),item('empty',''),item('unknown','unknown'));
 const f=fixture(rows,{route:'inventory'});f.app.inventoryView();
 for(let index=0;index<sentinels.length;index++)assert.match(f.safetyCell(`flag-${index}`),/>Review SDS<\/span>/,sentinels[index]);
 for(const id of ['missing','empty','unknown'])assert.equal(f.safetyCell(id),'<span class="muted">—</span>');
});

test('Safety shows unique recorded classifications from an array without unknown sentinel labels',()=>{
 const f=fixture([item('multiple',[' unknown ',' Irritant ','Corrosive','Irritant',null,'n/a'])]);f.app.inventoryView(true);
 assert.match(f.safetyCell('multiple'),/>Irritant · Corrosive<\/span>/);
 assert.doesNotMatch(f.safetyCell('multiple'),/unknown|n\/a|Review SDS/);
});

test('Inventory uses the canonical classification and does not expose source-only toxicity fields',()=>{
 const rows=[item('canonical','Toxic',{original_fields:{'Toxicity classification':'PRIVATE ORIGINAL'}}),item('source-only',undefined,{source_fields:{'Toxicity classification':'PRIVATE SOURCE'},original_fields:{'Toxicity classification':'PRIVATE ORIGINAL'}})];
 const f=fixture(rows,{route:'inventory'});f.app.inventoryView();
 assert.match(f.safetyCell('canonical'),/>Toxic<\/span>/);assert.equal(f.safetyCell('source-only'),'<span class="muted">—</span>');
 assert.doesNotMatch(f.element('main').innerHTML,/PRIVATE ORIGINAL|PRIVATE SOURCE/);
});

test('Safety escapes literal source classifications instead of creating HTML or event handlers',()=>{
 const f=fixture([item('unsafe-text','<img src=x onerror="alert(1)"> Irritant & corrosive')]);f.app.inventoryView(true);
 const cell=f.safetyCell('unsafe-text');assert.match(cell,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; Irritant &amp; corrosive/);
 assert.doesNotMatch(cell,/<img|<script| onerror="/);
});

test('Safety sorting uses the displayed classification and leaves missing labels last in both directions',async()=>{
 const rows=[item('toxic','Toxic'),item('irritant','Irritant'),item('corrosive','Corrosive'),item('review','unknown',{safety:{classification:'unknown',flagged:true}}),item('missing',undefined)];
 const f=fixture(rows,{route:'inventory'});f.app.inventoryView();
 await f.app.sortTable('inventory','safety');assert.deepEqual(f.renderedRows().map(row=>row.id),['corrosive','irritant','review','toxic','missing']);
 await f.app.sortTable('inventory','safety');assert.deepEqual(f.renderedRows().map(row=>row.id),['toxic','review','irritant','corrosive','missing']);
});

test('Dangerous chemicals sorts by its Safety labels without including ordinary inventory rows',async()=>{
 const f=fixture([item('toxic','Toxic'),item('irritant','Irritant'),item('ordinary',undefined)]);f.app.inventoryView(true);
 await f.app.sortTable('dangerous','safety');assert.deepEqual(f.renderedRows().map(row=>row.id),['irritant','toxic']);
 await f.app.sortTable('dangerous','safety');assert.deepEqual(f.renderedRows().map(row=>row.id),['toxic','irritant']);
});

test('toxicity components normalize combined strings and arrays without changing recorded hazard meaning',()=>{
 const f=fixture([]),classify=value=>Array.from(f.app.toxicityClassifications({safety:{classification:value}}));
 assert.deepEqual(classify('Danger, CMR, corrosive'),['Danger','CMR','Corrosive']);
 assert.deepEqual(classify([' irritant ','TOXIC; flammable','Irritant','cmr']),['Irritant','Toxic','Flammable','CMR']);
 assert.deepEqual(classify('Danger (Poison); Warning (skin, eye, respiratory irritation)'),['Danger (Poison)','Warning (skin, eye, respiratory irritation)']);
 assert.deepEqual(classify('Inflammable, environment dager'),['Inflammable','environment dager']);
 assert.deepEqual(classify(['unknown','UNVERIFIED','none','N','no','na','n/a','無','未確認','未分類','not recorded',null]),[]);
});

test('toxicity categories omit regulatory identifiers and never fall back to raw source fields',()=>{
 const f=fixture([]),classification='列管編號-序號:054-01\n管制編號:A4504795\n許可證字號:054-63-J0055, \nDanger, CMR';
 assert.deepEqual(Array.from(f.app.toxicityClassifications({safety:{classification}})),['Danger','CMR']);
 assert.deepEqual(Array.from(f.app.toxicityClassifications({safety:{classification:'unknown'},source_fields:{'Toxicity classification':'PRIVATE SOURCE'},original_fields:{'Toxicity classification':'PRIVATE ORIGINAL'}})),[]);
});

test('toxicity filtering matches components and composes with existing inventory filters',()=>{
 const rows=[item('match','Danger, CMR, corrosive',{name:'Alpha reagent',location:'Shelf A',status:'in_stock'}),item('other-location','Corrosive',{name:'Alpha reagent',location:'Shelf B',status:'in_stock'}),item('other-status','Corrosive',{name:'Alpha reagent',location:'Shelf A',status:'depleted'}),item('other-classification','Corrosive',{name:'Alpha reagent',location:'Shelf A',status:'in_stock',inventory_classification:'Antibody'}),item('other-name','Corrosive',{name:'Beta reagent',location:'Shelf A',status:'in_stock'}),item('other-toxicity','Irritant',{name:'Alpha reagent',location:'Shelf A',status:'in_stock'}),{...item('archived','Corrosive'),archived:true}];
 const f=fixture(rows),chosen={toxicity:'corrosive',query:'Alpha',category:'Chemicals',location:'Shelf A',status:'in_stock'};
 assert.deepEqual(Array.from(f.app.filterInventory(rows,chosen,true),row=>row.id),['match']);
 assert.deepEqual(Array.from(f.app.filterInventory(rows,{toxicity:'irritant'},false),row=>row.id).sort(),rows.filter(row=>!row.archived).map(row=>row.id).sort());
 assert.equal(f.app.filterInventory(rows,{toxicity:'toxic'},true).length,0);
});

test('Unclassified includes flagged dangerous items without a known toxicity label only',()=>{
 const rows=[item('flagged','unknown',{safety:{flagged:true,classification:'unknown'}}),item('regulated',undefined,{safety:{regulated:true}}),item('known','Irritant'),item('ordinary',undefined),item('source-only',undefined,{safety:{flagged:true},source_fields:{'Toxicity classification':'PRIVATE SOURCE'}})];
 const f=fixture(rows);assert.deepEqual(Array.from(f.app.filterInventory(rows,{toxicity:'__unclassified'},true),row=>row.id).sort(),['flagged','regulated','source-only']);
 const options=Array.from(f.app.toxicityOptions(rows),option=>({value:option.value,label:option.label}));
 assert.deepEqual(options,[{value:'irritant',label:'Irritant'},{value:'__unclassified',label:'Unclassified'}]);
});

test('Dangerous chemicals alone offers a stable dropdown of current recorded toxicity categories',()=>{
 const rows=[item('irritant','irritant',{location:'Shelf A'}),item('combined','Danger, CMR, corrosive',{location:'Shelf B'}),item('ordinary',undefined),{...item('archived','PRIVATE ARCHIVED'),archived:true},{...item('equipment','PRIVATE EQUIPMENT'),kind:'equipment'}];
 const f=fixture(rows);f.app.inventoryView(true);const before=f.dropdown();
 assert.match(f.element('main').innerHTML,/<select id="toxicity"[^>]*aria-label="Toxicity classification"/);assert.match(before,/>All toxicity classifications<\/option>/);
 for(const label of ['CMR','Corrosive','Danger','Irritant'])assert.match(before,new RegExp(`>${label}</option>`));
 assert.doesNotMatch(before,/PRIVATE ARCHIVED|PRIVATE EQUIPMENT/);
 f.app.setFilters({location:'Shelf A',query:'irritant'});f.app.inventoryView(true);assert.equal(f.dropdown(),before);
 const ordinary=fixture(rows,{route:'inventory'});ordinary.app.inventoryView();assert.equal(ordinary.dropdown(),'');
});

test('toxicity selection updates the table, survives sorting and clears on navigation or private reset',async()=>{
 const rows=[item('z','Irritant',{name:'Zulu'}),item('a','Irritant',{name:'Alpha'}),item('toxic','Toxic')],f=fixture(rows);f.app.inventoryView(true);
 const change=f.element('toxicity').listeners.get('change');assert.equal(typeof change,'function');change({target:{value:'irritant'}});
 assert.equal(f.app.state().filters.toxicity,'irritant');assert.deepEqual(f.renderedRows().map(row=>row.id),['a','z']);
 await f.app.sortTable('dangerous','name');await f.app.sortTable('dangerous','name');assert.deepEqual(f.renderedRows().map(row=>row.id),['z','a']);assert.equal(f.app.state().filters.toxicity,'irritant');
 f.app.resetPrivate();assert.equal(f.app.state().filters.toxicity,'');
 const navigation=fixture(rows);navigation.app.setFilters({toxicity:'toxic'});navigation.location.hash='inventory';navigation.windowListeners.get('hashchange')();assert.equal(navigation.app.state().filters.toxicity,'');
});

test('PDF and XLSX exports use the same toxicity filter as the dangerous table',async()=>{
 const rows=[item('irritant','Irritant',{name:'Included irritant'}),item('combined','Danger, Irritant, CMR',{name:'Included combined'}),item('toxic','Toxic',{name:'Excluded toxic'}),item('ordinary',undefined,{name:'Excluded ordinary'})],f=fixture(rows);
 f.app.setFilters({toxicity:'irritant'});f.app.inventoryView(true);assert.deepEqual(f.renderedRows().map(row=>row.id),['combined','irritant']);
 await f.app.exportRows();const sheet=f.workbooks[0].sheets[0],idColumn=sheet.rows[0].indexOf('Record ID');assert.deepEqual(sheet.rows.slice(1).map(row=>row[idColumn]),['combined','irritant']);
 assert.equal(f.downloads.length,1);assert.match(JSON.stringify(f.workbooks[0].sheets[1]),/toxicity.*irritant/i);
 await f.app.exportRows('item','pdf');assert.match(f.element('pdf-export-content').innerHTML,/Included combined|Included irritant/);assert.doesNotMatch(f.element('pdf-export-content').innerHTML,/Excluded toxic|Excluded ordinary/);
});
