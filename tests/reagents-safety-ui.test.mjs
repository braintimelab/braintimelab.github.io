import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../reagents/model.js';
import * as sorting from '../reagents/table-sort.js';

// Exercise the production table and sort handlers with authorized synthetic rows.
// The harness has no browser storage, private records, network or credentials.
const appSource=await readFile(new URL('../reagents/app.js',import.meta.url),'utf8');
const item=(id,classification,extra={})=>({id,kind:'item',version:1,payload:{name:`Reagent ${id}`,inventory_classification:'Chemicals',safety:{classification},...extra}});

function fixture(rows,{route='safety'}={}){
 const elements=new Map(),element=id=>{
  if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',dataset:{},value:'',open:false,addEventListener(){},focus(){}});
  return elements.get(id);
 };
 const status={url:'https://synthetic.supabase.co',colonyId:'synthetic-colony',signedIn:true,email:'member@example.invalid',username:'member',role:'editor',exportLevel:'high'};
 const permissions={role:'editor',can_write:false,can_import:false,can_manage_safety:false,export_level:'high'};
 const context=vm.createContext({...model,...sorting,store:{getCloudStatus:()=>({...status}),callReagents:async()=>({rows:[],total:0,next_offset:null})},PUBLIC_CONFIG:{},document:{getElementById:element,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){}},location:new URL(`https://synthetic.invalid/reagents/#${route}`),console,setTimeout,clearTimeout,createAccessActivity:()=>({observe(){},reset(){},signOut(){}})});
 context.fixtureRows=structuredClone(rows);context.fixturePermissions=permissions;
 const expose='\nmember=true;permissions=globalThis.fixturePermissions;items=globalThis.fixtureRows;records=new Map(items.map(row=>[row.id,row]));globalThis.app={inventoryView,sortTable};';
 vm.runInContext(appSource.replace(/^import .*;\n/gm,'').replace(/await start\(\);\s*$/,'')+expose,context);
 const renderedRows=()=>{
  const body=element('main').innerHTML.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]||'';
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([,row])=>({id:row.match(/data-action="open" data-id="([^"]+)"/)?.[1],cells:[...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([,cell])=>cell)}));
 };
 return {app:context.app,element,renderedRows,safetyCell:id=>renderedRows().find(row=>row.id===id)?.cells[5]};
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
