import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdtemp,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {webcrypto} from 'node:crypto';

// Exercise the actual candidate with its unchanged production dependencies.
const baseline=new URL('../mouse-data/',import.meta.url);
const runtime=await mkdtemp(join(tmpdir(),'braintime-mobile-cages-'));
for(const name of await readdir(baseline))if(name.endsWith('.js'))await copyFile(new URL(name,baseline),join(runtime,name));
await copyFile(new URL('../mouse-data/cage-sheet.js',import.meta.url),join(runtime,'cage-sheet.js'));
const sheet=await import(pathToFileURL(join(runtime,'cage-sheet.js')));
const {normalizeDataset}=await import(pathToFileURL(join(runtime,'model.js')));
const {projectAnimalSheet}=await import(pathToFileURL(join(runtime,'animal-sheet-export.js')));
after(()=>rm(runtime,{recursive:true,force:true}));
globalThis.crypto??=webcrypto;

const decode=value=>String(value??'').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
const attrs=source=>Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,decode(value)]));
function eventWindow(){
 const listeners=new Map();
 return {addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},dispatch(name){for(const fn of [...listeners.get(name)||[]])fn();},count(name){return listeners.get(name)?.size||0;}};
}
function hostFor(window=eventWindow()){
 let html='',groups=[],controls=new Map();
 const host={ownerDocument:{defaultView:window},get innerHTML(){let result=html;for(const group of groups)if(group.body.changed)result=result.replace(group.original,group.prefix+group.body.innerHTML+'</div></details>');return result;},set innerHTML(value){
  html=value;groups=[];controls=new Map([...value.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,{disabled:false,textContent:'',focus(){},setSelectionRange(){},querySelector(){return {textContent:''};}}]));
  const starts=[...value.matchAll(/<details\b([^>]*data-sheet-lazy-group[^>]*)>/g)];
  for(const start of starts){
   const tag=/<\/?details\b[^>]*>/g;tag.lastIndex=start.index;let depth=0,end;
   for(let match;(match=tag.exec(value));){depth+=match[0].startsWith('</')?-1:1;if(depth===0){end=tag.lastIndex;break;}}
   const original=value.slice(start.index,end),bodyTag=original.match(/<div data-sheet-group-body data-loaded="([^"]*)">/);
   const prefix=original.slice(0,bodyTag.index+bodyTag[0].length),bodyContent=original.slice(prefix.length,original.lastIndexOf('</div>'));
   const attributes=attrs(start[1]);let content=bodyContent;
   const body={dataset:{loaded:bodyTag[1]},changed:false,get innerHTML(){return content;},set innerHTML(next){content=next;body.changed=true;},querySelectorAll(){return [];}};
   const group={original,prefix,body,open:/\sopen(?:\s|$)/.test(start[1]),dataset:{sheetLazyGroup:attributes['data-sheet-lazy-group'],sheetGroupForced:attributes['data-sheet-group-forced']},querySelector(selector){return selector==='[data-sheet-group-body]'?body:null;}};
   groups.push(group);
  }
 },querySelector(selector){if(selector==='.cage-sheet')return /class="cage-sheet/.test(html)?{}:null;return controls.get(selector.slice(1))||null;},querySelectorAll(selector){return selector==='[data-sheet-lazy-group]'?groups:[];},groups(){return groups;},window};
 return host;
}
function sample({racks=3,cagesPerRack=2}={}){
 const tables={mice:[],cages:[],rooms:[{room_id:'R',name:'Culture room'}],racks:[],locations:[]};
 for(let rack=1;rack<=racks;rack++){
  tables.racks.push({rack_id:'K'+rack,room_id:'R',name:'Rack '+rack});
  for(let cage=1;cage<=cagesPerRack;cage++){
   const id=`${rack}${cage}`;
   tables.locations.push({location_id:'P'+id,room_id:'R',rack_id:'K'+rack,label:'Position '+id});
   tables.cages.push({cage_sid:'C'+id,cage_tag:'Cage '+id,room_id:'R',rack_id:'K'+rack,location_id:'P'+id,state:'Active',manager:'JM'});
   tables.mice.push({mouse_sid:'M'+id,physical_tag:'TAG-'+id,sex:'Female',state:'Stock',cage_sid:'C'+id,cage_tag:'Cage '+id,manager:'JM'});
  }
 }
 return normalizeDataset({tables});
}
function render(data=sample(),options={}){
 sheet.clearCageSheetDrafts();const host=hostFor(),saved=[];
 const hooks={context:'mobile-cages',currentContext:()=> 'mobile-cages',canEdit:()=>true,loadFresh:async()=>data,save:async next=>saved.push(next),mobileGroups:true,...options};
 sheet.renderCageSheet(host,data,hooks);return {host,data,hooks,saved};
}
const cards=html=>(html.match(/<article\b/g)||[]).length;
const group=(ui,rack)=>ui.host.groups().find(row=>JSON.parse(row.dataset.sheetLazyGroup)[1]==='K'+rack);
function toggle(node,open){node.open=open;node.ontoggle();}
function repaint(ui){ui.host.querySelector('#cage-sheet-rack').onchange({target:{value:''}});}
async function search(ui,value){ui.host.querySelector('#cage-sheet-search').oninput({target:{value,selectionStart:value.length}});await new Promise(resolve=>setTimeout(resolve,210));}

test('small touchscreens initially build only the first rack, with all rack headings available',()=>{
 const ui=render();assert.equal(ui.host.groups().length,3);assert.equal(group(ui,1).open,true);assert.equal(group(ui,2).open,false);assert.equal(group(ui,3).open,false);
 assert.equal(cards(ui.host.innerHTML),2);assert.match(ui.host.innerHTML,/TAG-11/);assert.doesNotMatch(ui.host.innerHTML,/TAG-21|TAG-31/);
});
test('opening a deferred rack renders its real cards once, and repaints preserve its open state',()=>{
 const ui=render(),third=group(ui,3);assert.equal(third.body.dataset.loaded,'false');toggle(third,true);assert.equal(third.body.dataset.loaded,'true');assert.equal(cards(third.body.innerHTML),2);assert.match(third.body.innerHTML,/TAG-31/);
 const content=third.body.innerHTML;toggle(third,true);assert.equal(third.body.innerHTML,content);repaint(ui);assert.equal(group(ui,3).open,true);assert.equal(cards(ui.host.innerHTML),4);
});
test('explicitly closing the first rack remains closed after an unrelated repaint',()=>{
 const ui=render();toggle(group(ui,1),false);repaint(ui);assert.equal(group(ui,1).open,false);assert.equal(cards(ui.host.innerHTML),0);
});
test('search finds a mouse in a deferred rack and temporary expansion preserves collapse choices',async()=>{
 const ui=render();toggle(group(ui,1),false);await search(ui,'TAG-31');assert.equal(ui.host.groups().length,1);assert.equal(group(ui,3).open,true);assert.match(ui.host.innerHTML,/TAG-31/);
 // Browser toggle events for the search expansion must not persist it as a user choice.
 toggle(group(ui,3),true);await search(ui,'');assert.equal(group(ui,1).open,false);assert.equal(group(ui,3).open,false);
});
test('rack and room filters can reach every deferred rack without losing choices',()=>{
 const ui=render();ui.host.querySelector('#cage-sheet-rack').onchange({target:{value:'K3'}});assert.equal(ui.host.groups().length,1);assert.equal(group(ui,3).open,true);assert.match(ui.host.innerHTML,/TAG-31/);
 ui.host.querySelector('#cage-sheet-room').onchange({target:{value:'R'}});assert.equal(ui.host.groups().length,3);assert.equal(group(ui,1).open,true);
});
test('pending edits in a deferred rack survive collapsing and reopening, then save normally',async()=>{
 const ui=render();toggle(group(ui,3),true);ui.host.oninput({target:{dataset:{sheetType:'mice',sheetId:'M31',sheetField:'genotype'},value:'P',classList:{toggle(){}}}});
 assert.equal(sheet.hasCageSheetDrafts(),true);assert.equal(ui.data.tables.mice.find(row=>row.mouse_sid==='M31').genotype,undefined);
 toggle(group(ui,3),false);repaint(ui);assert.equal(group(ui,3).open,false);assert.equal(sheet.hasCageSheetDrafts(),true);toggle(group(ui,3),true);assert.match(group(ui,3).body.innerHTML,/P/);
 await ui.host.querySelector('#cage-sheet-sync').onclick();assert.equal(ui.saved.length,1);assert.equal(ui.saved[0].tables.mice.find(row=>row.mouse_sid==='M31').genotype,'P');assert.equal(sheet.hasCageSheetDrafts(),false);
});
test('desktop remains the existing unfolded presentation',()=>{
 const ui=render(sample(),{mobileGroups:false});assert.equal(ui.host.groups().length,0);assert.equal(cards(ui.host.innerHTML),6);assert.match(ui.host.innerHTML,/TAG-31/);assert.equal(ui.host.window.count('beforeprint'),0);
});
test('coarse and narrow detection is used only when an explicit override is absent',()=>{
 const original=globalThis.matchMedia,queries=[];
 try{globalThis.matchMedia=query=>{queries.push(query);return {matches:true};};const ui=render(sample(),{mobileGroups:undefined});assert.equal(cards(ui.host.innerHTML),2);assert.deepEqual(queries,['(pointer: coarse) and (max-width: 900px)']);}
 finally{globalThis.matchMedia=original;}
});
test('printing expands every visible rack and restores user collapse choices afterward',()=>{
 const ui=render();toggle(group(ui,1),false);toggle(group(ui,3),true);ui.host.window.dispatch('beforeprint');assert.equal(cards(ui.host.innerHTML),6);assert(ui.host.groups().every(node=>node.open));
 for(const node of ui.host.groups())toggle(node,true);ui.host.window.dispatch('afterprint');assert.equal(group(ui,1).open,false);assert.equal(group(ui,2).open,false);assert.equal(group(ui,3).open,true);assert.equal(cards(ui.host.innerHTML),2);
});
test('repeated render replaces print handlers and navigation away prevents stale printing',()=>{
 const ui=render();sheet.renderCageSheet(ui.host,ui.data,ui.hooks);assert.equal(ui.host.window.count('beforeprint'),1);assert.equal(ui.host.window.count('afterprint'),1);
 ui.host.innerHTML='<p>Different section</p>';ui.host.window.dispatch('beforeprint');assert.equal(ui.host.innerHTML,'<p>Different section</p>');
});
test('folded DOM never removes cages or mice from print and workbook projections',()=>{
 const data=sample(),before=structuredClone(data),ui=render(data),projection=projectAnimalSheet(data);
 assert.equal(cards(ui.host.innerHTML),2);assert.equal(projection.counts.cages,6);assert.equal(projection.counts.mice,6);assert.equal(projection.groups.length,3);assert.equal(projection.rows.length,6);assert.deepEqual(data,before);
});
test('a larger phone workspace creates one rack of cards rather than all assigned racks',()=>{
 const data=sample({racks:8,cagesPerRack:10}),ui=render(data);assert.equal(ui.host.groups().length,8);assert.equal(cards(ui.host.innerHTML),10);
 const desktop=render(data,{mobileGroups:false});assert.equal(cards(desktop.host.innerHTML),80);assert(ui.host.innerHTML.length<desktop.host.innerHTML.length/3);
});
