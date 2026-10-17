import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {tableHistoryConfig,tableHistoryView,compareTableRecency,tableHistoryPage} from '../mouse-data/table-history.js';

const source=await readFile(new URL('../mouse-data/app.js',import.meta.url),'utf8');
function between(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function fixture(tables){
 const elements={main:{innerHTML:''}},dataset={tables},summaries=[];
 const context=vm.createContext({dataset,tableHistoryConfig,tableHistoryView,compareTableRecency,tableHistoryPage,JSON,Math,Number,String,Object,Set,
  $:id=>elements[id],esc:value=>String(value??''),count:value=>Number(value||0).toLocaleString(),localDate:()=> '2026-10-17',archived:r=>Boolean(r.app_archived_at),columnValue:(r,key)=>r[key],mouseStrains:()=>({}),
  demoBanner:()=>'',cageViewMenuHTML:()=>'',mouseSummaryHTML:()=>{summaries.push(dataset.tables.mice.length);return '<section>Mouse summary</section>';},breedingSummaryHTML:()=>'',litterSummaryHTML:()=>'',cageSummaryHTML:()=>'',strainCodeFilter:()=>'',
  selectFilter:()=>'',tableCell:(r,key)=>String(r[key]??''),button:(label,action,primary=false,attributes='')=>'<button data-action="'+action+'" '+attributes+'>'+label+'</button>',
  canEditRecords:()=>false,showToast:()=>{},setSidebarMenuOpen:()=>{},location:{hash:''},cloud:{role:'editor',signedIn:false},
 });
 vm.runInContext("let route='mice',detail=null,query='',filters={},page=0,sortKey='',sortDesc=false,currentRows=[],tableWindowIndex=0,tableUndated=false,tableWindowAnchor=localDate(),tableWindow=null;const pageSize=50;let selectedMice=new Set(),brainbotReviewPending=false,sidebarMenuOpen=false;const titles={mice:'Mice',matings:'Breeding',litters:'Litters'};",context);
 vm.runInContext(between('const entity =','const fieldDefs ='),context);
 vm.runInContext(between('function records(','function findRecord('),context);
 vm.runInContext(between('function resetTableWindow()','let treeZoom'),context);
 vm.runInContext(between('function filteredRecords()','function selectFilter('),context);
 vm.runInContext(between('function renderTable()','async function refreshCageTableManagers('),context);
 vm.runInContext("function render(){if(!detail)renderTable();}",context);
 vm.runInContext(between('function navigate(','function render()'),context);
 const action=between("if(name==='previous'||name==='next')","if(name==='view-mice')");
 vm.runInContext('function changePage(name){'+action+'}',context);
 return {elements,dataset,summaries,run:value=>vm.runInContext(value,context),rows:()=>JSON.parse(vm.runInContext('JSON.stringify(currentRows)',context))};
}

const mouse=(id,date,extra={})=>({mouse_sid:id,date_of_birth:date,...extra});
test('actual app renders newest dates by default and does not backfill sparse Mice, Breeding, or Litters',()=>{
 const tables={mice:[mouse('old','2021-01-01'),mouse('new','2026-10-01'),mouse('recent','2025-01-01')],matings:[{mating_sid:'old',set_up_date:'2020-01-01'},{mating_sid:'new',set_up_date:'2026-09-01'}],litters:[{litter_sid:'old',date_of_birth:'2020-01-01'},{litter_sid:'new',date_of_birth:'2026-09-01'}]};
 const f=fixture(tables);
 for(const [type,field] of [['mice','date_of_birth'],['matings','set_up_date'],['litters','date_of_birth']]){
  f.run('navigate('+JSON.stringify(type)+')');
  assert.equal(f.rows()[0][tableHistoryConfig(type).id],'new');assert.ok(f.rows().every(row=>row[field]>='2023-10-17'));
  assert.match(f.elements.main.innerHTML,/Since 2023-10-17/);assert.match(f.elements.main.innerHTML,/aria-sort="descending"><button data-sort="(?:date_of_birth|set_up_date)"/);
  assert.match(f.elements.main.innerHTML,/<button data-action="next" >Next/);
 }
 assert.ok(f.summaries.includes(3));assert.equal(f.dataset.tables.mice.length,3);
});

test('actual Next and Previous preserve within-window pagination and show older rows only on explicit Next',()=>{
 const mice=[...Array.from({length:51},(_,i)=>mouse(String(i),'2026-10-01')),mouse('old','2021-01-01')],f=fixture({mice});
 f.run('navigate("mice")');assert.equal(f.rows().length,51);assert.match(f.elements.main.innerHTML,/1–50 of 51/);
 f.run('changePage("next")');assert.match(f.elements.main.innerHTML,/51–51 of 51/);assert.equal(f.run('tableWindowIndex'),0);
 f.run('changePage("next")');assert.equal(f.run('tableWindowIndex'),1);assert.deepEqual(f.rows().map(row=>row.mouse_sid),['old']);assert.match(f.elements.main.innerHTML,/<button data-action="next" disabled/);
 f.run('changePage("previous")');assert.equal(f.run('tableWindowIndex'),0);assert.equal(f.run('page'),1);assert.match(f.elements.main.innerHTML,/51–51 of 51/);
 f.run('navigate("mice")');assert.equal(f.run('page'),0);assert.equal(f.run('tableWindowIndex'),0);
});

test('search and archive filters constrain historical navigation without widening the recent window',()=>{
 const f=fixture({mice:[mouse('old','2021-01-01',{physical_tag:'Elsewhere'}),mouse('archived','2010-01-01',{app_archived_at:'2026-10-01'}),mouse('new','2026-01-01',{physical_tag:'Found'})]});
 f.run('query="Found";renderTable()');assert.equal(f.rows().length,1);assert.match(f.elements.main.innerHTML,/<button data-action="next" disabled/);
 f.run('query="Elsewhere";renderTable()');assert.equal(f.rows().length,0);assert.match(f.elements.main.innerHTML,/<button data-action="next" >Next/);
 f.run('changePage("next")');assert.deepEqual(f.rows().map(row=>row.mouse_sid),['old']);assert.equal(f.run('tableWindow.hasOlder'),false);
 f.run('query="";renderTable()');assert.equal(f.run('tableWindow.hasOlder'),false);
 f.run('filters.archived=true;renderTable()');assert.equal(f.run('tableWindow.hasOlder'),true);
});

test('unknown dates remain accessible and column sorting keeps the current three-year window',()=>{
 const f=fixture({mice:[mouse('old','2020-01-01'),mouse('10','2026-10-01'),mouse('2','2025-01-01'),mouse('unknown',null)]});
 f.run('navigate("mice")');assert.match(f.elements.main.innerHTML,/Undated \(1\)/);
 f.run('sortKey="mouse_sid";sortDesc=false;renderTable()');assert.deepEqual(f.rows().map(row=>row.mouse_sid),['2','10']);assert.equal(f.run('tableWindowIndex'),0);
 f.run('tableUndated=true;page=0;renderTable()');assert.deepEqual(f.rows().map(row=>row.mouse_sid),['unknown']);assert.match(f.elements.main.innerHTML,/<button data-action="next" disabled/);
 f.run('navigate("mice","old")');assert.equal(f.run('detail.id'),'old');assert.equal(f.dataset.tables.mice.find(row=>row.mouse_sid==='old').date_of_birth,'2020-01-01');
});
