// Actual explorer, pedigree model, SVG renderer and scientific helpers.
// The browser viewport port alone is mocked; no app startup/network/storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

const source=fileURLToPath(new URL('../mouse-data/',import.meta.url));
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'family-pedigree-explorer-'));
await fs.writeFile(path.join(temp,'package.json'),'{"type":"module"}\n');
await fs.cp(source,path.join(temp,'web'),{recursive:true});
await fs.copyFile(path.join(temp,'web/family-pedigree-view.js'),path.join(temp,'web/family-pedigree-view-actual.js'));
await fs.writeFile(path.join(temp,'web/family-pedigree-view.js'),`
import {renderPedigreeSVG as actualSVG} from './family-pedigree-view-actual.js';
export const models=[],mounts=[];
export function renderPedigreeSVG(model,options){models.push(model);return actualSVG(model,options);}
export function mountPedigreeViewport(element,model,options){
 const row={element,model,options,initial:options.initial?{...options.initial}:null,calls:[],destroyed:false};mounts.push(row);
 const controller=Object.fromEntries(['zoomIn','zoomOut','fit','center'].map(key=>[key,()=>row.calls.push(key)]));
 controller.destroy=()=>{if(!row.destroyed){row.destroyed=true;row.calls.push('destroy');}};
 row.controller=controller;row.change=value=>options.onChange(value);options.onChange(options.initial||{cx:0,cy:0,scale:1});return controller;
}`);
const {renderFamilyExplorer,familyHelpHTML}=await import(pathToFileURL(path.join(temp,'web/family-explorer.js')).href);
const port=await import(pathToFileURL(path.join(temp,'web/family-pedigree-view.js')).href+'?v=201');
test.after(()=>fs.rm(temp,{recursive:true,force:true}));
const mouse=(id,extra={})=>({mouse_sid:String(id),physical_tag:'Synthetic '+id,sex:'Unknown',state:'Stock',sire_sids:[],dam_sids:[],...extra});
const profile={schema_version:1,loci:[{id:'bmal1',name:'Bmal1',kind:'flox',chromosome:'unknown',alleles:['+','fl']}],calls:{bmal1:{alleles:['fl','fl'],evidence:'confirmed'}}};
const data=records=>({synthetic:true,tables:{mice:records,mouse_genes:[],husbandry_events:[]}});
function basic(){return data([
 mouse('1',{sire_sids:['2'],dam_sids:['3'],lineage_basis:{kind:'source_reconciliation_inference',confidence:'moderate',inferred_roles:['sire']}}),
 mouse('2',{sex:'Male',state:'Ended',sire_sids:['4']}),mouse('3',{sex:'Female'}),
 mouse('4',{sex:'Male',state:'Ended',archived:true,sire_sids:['5'],genetic_profile:profile}),mouse('5',{sex:'Male',state:'Ended',sire_sids:['6']}),mouse('6',{sex:'Male',state:'Ended'}),
 mouse('10',{sire_sids:['1']}),mouse('11',{dam_sids:['10']}),mouse('20',{sire_sids:['2']})
]);}
function harness(dataset=basic(),id='1',extraHooks={}){
 let focus=String(id),context='source-A';const original=JSON.stringify(dataset),messages=[],writes=[];
 const target={},viewport={},section={scrollIntoView(){messages.push(['scroll']);}};
 const container={innerHTML:'',querySelector(selector){return selector==='[data-pedigree-viewport]'?viewport:selector==='[data-family-target]'?target:selector==='.family-pedigree'?section:null;}};
 const hooks={getFocus:()=>focus,setFocus:value=>focus=String(value),getGraphContext:()=>context,openMouse:value=>messages.push(['open',value]),reviewMouse:value=>messages.push(['review',value]),planTarget:value=>messages.push(['target',value]),saveRecord:value=>writes.push(value),...extraHooks};
 let cleanup=renderFamilyExplorer(container,dataset,hooks);
 const element=(action,meta={},tag='button')=>({dataset:{familyAction:action,...meta},tagName:tag,disabled:false});
 return {container,messages,writes,dataset,original,hooks,get focus(){return focus;},get model(){return port.models.at(-1);},get mount(){return port.mounts.at(-1);},get cleanup(){return cleanup;},
  click(action,meta={}){const el=element(action,meta);container.onclick({target:{closest:()=>el}});},
  change(field,value){container.onchange({target:{value,checked:Boolean(value),dataset:{familyField:field}}});},
  input(field,value){container.oninput({target:{value,dataset:{familyField:field}}});},
  enterField(field){let prevented=false;container.onkeydown({key:'Enter',defaultPrevented:false,target:{dataset:{familyField:field}},preventDefault(){prevented=true;}});return prevented;},
  key(key,action,meta={},alreadyHandled=false,tag='g'){let prevented=false;const el=element(action,meta,tag),event={key,defaultPrevented:alreadyHandled,target:{closest:()=>el},preventDefault(){prevented=true;this.defaultPrevented=true;}};container.onkeydown(event);return prevented;},
  context(value){context=value;},
  remount(next=dataset){const old=cleanup;dataset=next;this.dataset=next;cleanup=renderFamilyExplorer(container,next,hooks);return old;},
  dispose(){cleanup();},
 };
}
const node=(h,id)=>h.model.nodes.find(row=>row.id===String(id));
const frontier=(h,direction='ancestors')=>h.model.frontiers.find(row=>row.direction===direction&&row.reason==='depth');

test('actual vertical SVG preserves parents/genotype and child panels while placing ancestors above and descendants below',()=>{
 const h=harness(),html=h.container.innerHTML;
 assert.equal(node(h,'1').y,0);assert.ok(node(h,'2').y<0);assert.ok(node(h,'4').y<node(h,'2').y);assert.ok(node(h,'10').y>0);
 assert.match(html,/Parents and grandparents above/);assert.match(html,/Full recorded lineage/);assert.doesNotMatch(html,/data-family-field="generations"|Read left to right/);
 assert.equal((html.match(/data-pedigree-viewport/g)||[]).length,1,'Only the actual view wrapper mounts');
 assert.ok(html.indexOf('family-parent-summary')<html.indexOf('pedigree-svg'));assert.ok(html.indexOf('family-child-links')>html.indexOf('pedigree-svg'));
 assert.match(html,/Shared-parent links/);assert.match(html,/Synthetic 20/);assert.match(html,/bmal1|B′|B'/i);
 const sire=h.model.edges.find(edge=>edge.childId==='1'&&edge.role==='sire');assert.equal(sire.evidence.inferred,true);
 assert.equal(h.model.edges.find(edge=>edge.childId==='10').parentId,'1');assert.equal(h.model.edges.find(edge=>edge.childId==='10').evidence.inferred,false,'Child edge does not inherit selected mouse own sire inference');
 assert.equal(JSON.stringify(h.dataset),h.original);h.dispose();
});
test('branch expansion/collapse is path-local, destroys old viewport and retains current pan',()=>{
 const h=harness();assert.equal(node(h,'5'),undefined);const first=frontier(h);assert.ok(first);const old=h.mount;old.change({cx:123,cy:-50,scale:.8});
 h.click('pedigree-expand',{key:first.expansionKey});assert.ok(node(h,'5'));assert.equal(old.destroyed,true);assert.deepEqual(h.mount.initial,{cx:123,cy:-50,scale:.8});
 const active=h.model.activeExpansions.find(row=>row.expansionKey===first.expansionKey);assert.ok(active);h.click('pedigree-collapse',{key:active.expansionKey});assert.equal(node(h,'5'),undefined);old.change({cx:999,cy:999,scale:3});h.change('sex','Male');assert.deepEqual(h.mount.initial,{cx:123,cy:-50,scale:.8});
 h.click('pedigree-expand',{key:'untrusted-key'});assert.equal(node(h,'5'),undefined);assert.equal(JSON.stringify(h.dataset),h.original);h.dispose();
});
test('focus Back and Forward restore exact raw identity, expansions, range and viewport',()=>{
 const h=harness();const first=frontier(h);h.click('pedigree-expand',{key:first.expansionKey});h.mount.change({cx:21,cy:35,scale:1.4});assert.ok(node(h,'5'));
 h.click('focus',{id:'2'});assert.equal(h.focus,'2');assert.equal(h.mount.initial,null);h.click('pedigree-back');assert.equal(h.focus,'1');assert.ok(node(h,'5'));assert.deepEqual(h.mount.initial,{cx:21,cy:35,scale:1.4});
 h.click('pedigree-forward');assert.equal(h.focus,'2');h.dispose();
});
test('zoom/fit/center use viewport controller without repainting or losing focus/branches',()=>{
 const h=harness(),html=h.container.innerHTML,mount=h.mount,models=port.models.length;
 for(const action of ['pedigree-zoom-in','pedigree-zoom-out','pedigree-fit','pedigree-center'])h.click(action);
 assert.deepEqual(mount.calls,['zoomIn','zoomOut','fit','center']);assert.equal(port.models.length,models);assert.equal(h.container.innerHTML,html);assert.equal(h.focus,'1');h.dispose();
});
test('SVG Enter/Space work once while already-handled and native-button keys are not double-activated',()=>{
 const h=harness();assert.equal(h.key('Enter','focus',{id:'2'}),true);assert.equal(h.focus,'2');assert.equal(h.key(' ','focus',{id:'1'}),true);assert.equal(h.focus,'1');
 const models=port.models.length;assert.equal(h.key('Enter','focus',{id:'3'},true),false);assert.equal(h.focus,'1');assert.equal(port.models.length,models);
 assert.equal(h.key('Enter','pedigree-fit',{},false,'button'),false);assert.deepEqual(h.mount.calls,[]);h.dispose();
});
test('historical/archived relatives stay in graph and all-record genotype fallback outside live list',()=>{
 const h=harness();assert.ok(node(h,'4'));assert.match(h.container.innerHTML,/Archived/);assert.match(h.container.innerHTML,/Confirmed profile/);
 h.click('focus',{id:'4'});assert.equal(h.focus,'4');assert.match(h.container.innerHTML,/outside the current filters/);assert.match(h.container.innerHTML,/SID 00004/);
 h.change('sex','Female');assert.ok(node(h,'2'));assert.equal(h.focus,'4');h.click('open-mouse');assert.deepEqual(h.messages.at(-1),['open','4']);h.dispose();
});
test('budget keeps200cards and paginates one remaining-link frontier25at a time',()=>{
 const records=[mouse('1'),...Array.from({length:1000},(_,i)=>mouse(String(i+2),{sire_sids:['1']}))],h=harness(data(records));
 assert.equal(h.model.nodes.length,200);assert.equal((h.container.innerHTML.match(/class="pedigree-node(?:\s|")/g)||[]).length,200);assert.equal((h.container.innerHTML.match(/data-pedigree-remaining/g)||[]).length,25);
 const blocked=h.model.frontiers.find(row=>row.reason==='budget');assert.ok(blocked);assert.ok(blocked.remainingCount>25);const firstPage=h.container.innerHTML.match(/<li data-pedigree-remaining>[\s\S]*?<\/ul>/)?.[0];
 h.click('pedigree-links-next',{key:blocked.key});assert.equal((h.container.innerHTML.match(/data-pedigree-remaining/g)||[]).length,25);assert.notEqual(h.container.innerHTML.match(/<li data-pedigree-remaining>[\s\S]*?<\/ul>/)?.[0],firstPage);
 h.click('focus',{id:blocked.remainingLinks[25].id});assert.equal(h.focus,blocked.remainingLinks[25].id);assert.equal(JSON.stringify(h.dataset),h.original);h.dispose();
});
test('5/10/20/Full ranges go beyond five and preserve historical focus through Back',()=>{
 const records=Array.from({length:31},(_,i)=>mouse(String(i+1),{state:i?'Ended':'Stock',sire_sids:i<30?[String(i+2)]:[]})),h=harness(data(records));
 assert.equal(h.model.nodes.length,3);h.change('pedigree-depth','5');assert.equal(h.model.nodes.length,6);h.change('pedigree-depth','10');assert.equal(h.model.nodes.length,11);h.change('pedigree-depth','20');assert.equal(h.model.nodes.length,21);
 h.change('pedigree-depth','all');assert.equal(h.model.nodes.length,31);assert.equal(h.model.hasMore,false);assert.match(h.container.innerHTML,/Full mode follows the saved links available/);
 h.mount.change({cx:5,cy:10,scale:.4});h.click('focus',{id:'2'});h.change('pedigree-depth','nearby');h.click('pedigree-back');assert.equal(h.focus,'1');assert.equal(h.model.nodes.length,31);assert.deepEqual(h.mount.initial,{cx:5,cy:10,scale:.4});h.dispose();
});
test('dataset/source/link changes clear graph history and rebuild reverse links; old cleanup cannot kill newer mount',()=>{
 const h=harness();h.click('pedigree-expand',{key:frontier(h).key});h.click('focus',{id:'2'});const oldCleanup=h.cleanup,oldMount=h.mount;
 const updated=structuredClone(h.dataset);updated.tables.mice.find(row=>row.mouse_sid==='1').sire_sids=['6'];h.remount(updated);const current=h.mount;oldCleanup();assert.equal(current.destroyed,false);assert.equal(typeof h.container.onclick,'function');
 h.click('pedigree-back');assert.equal(h.focus,'2');oldMount.change({cx:999,cy:999,scale:3});h.click('focus',{id:'1'});assert.ok(node(h,'6'));assert.equal(node(h,'2'),undefined);assert.equal(h.mount.initial,null);
 updated.tables.mice.find(row=>row.mouse_sid==='10').sire_sids=['6'];h.change('sex','Male');assert.equal(node(h,'10'),undefined,'In-place parent edit refreshes inverse children map');
 h.context('source-B');h.change('scope','all');h.click('pedigree-back');assert.equal(h.focus,'1');h.dispose();
});
test('cycles/unavailable/alternative links are explicit and canonical aliases keep raw navigation',()=>{
 const h=harness(data([mouse('100000',{canonical_sid:'03345',legacy_sids:['100000'],sire_sids:['2'],dam_sids:['missing','3']}),mouse('2',{sex:'Male',sire_sids:['100000']}),mouse('3',{sex:'Female'}),mouse('4',{dam_sids:['100000']})]),'100000');
 assert.match(h.container.innerHTML,/saved ancestry cycle/);assert.match(h.container.innerHTML,/Record unavailable/);assert.match(h.container.innerHTML,/Recorded alternatives/);assert.match(h.container.innerHTML,/SID 03345/);assert.match(h.container.innerHTML,/data-id="100000"/);
 assert.equal(h.model.edges.filter(edge=>edge.childId==='100000'&&edge.role==='dam').length,2);h.click('open-mouse');assert.deepEqual(h.messages.at(-1),['open','100000']);assert.equal(JSON.stringify(h.dataset),h.original);h.dispose();
});
test('browsing never derives foster/genotype/parent writes and hostile labels stay escaped',()=>{
 const h=harness(data([mouse('1',{physical_tag:'<img src=x onerror=bad()>',genotype:null}),mouse('2',{foster_dam_sids:['1'],nursing_dam_sids:['1']})]));
 assert.equal(h.model.nodes.length,1);assert.equal(h.model.edges.length,0);assert.doesNotMatch(h.container.innerHTML,/<img src=x/);assert.match(h.container.innerHTML,/&lt;img/);
 h.click('pedigree-fit');h.change('pedigree-depth','all');h.click('focus',{id:'2'});h.click('pedigree-back');assert.deepEqual(h.writes,[]);assert.equal(JSON.stringify(h.dataset),h.original);assert.ok(!h.messages.some(row=>row[0]==='target'));
 assert.match(familyHelpHTML(),/no five-generation limit/);h.dispose();
});
test('separate all-age snapshot owns graph parents, compact evidence and reverse child links without merging into baseline',()=>{
 const d=data([mouse('1',{sire_sids:['2'],genetic_profile:profile}),mouse('2',{sex:'Male'}),mouse('9',{sire_sids:['1']})]);
 const snapshot=[mouse('1',{sire_sids:['10'],lineage_basis:{kind:'source_reconciliation_inference',schema_version:1,inferred_roles:['sire'],confidence:'moderate'}}),mouse('10',{state:'Ended',sex:'Male'}),mouse('11',{state:'Ended',sire_sids:['1']})],original=JSON.stringify(snapshot);
 const h=harness(d,'1',{pedigreeMice:snapshot,pedigreeStatus:'All dates · read-only'});
 assert.ok(node(h,'10'));assert.ok(node(h,'11'));assert.equal(node(h,'2'),undefined);assert.equal(node(h,'9'),undefined);
 assert.equal(h.model.edges.find(row=>row.childId==='1').parentId,'10');assert.equal(h.model.edges.find(row=>row.childId==='1').evidence.inferred,true);
 const pedigree=h.container.innerHTML.split('<section class="panel family-pedigree">')[1];assert.doesNotMatch(pedigree,/Confirmed profile|>Confirmed</);assert.match(pedigree,/assay evidence unavailable/);
 assert.match(h.container.innerHTML,/1 matching mice/);assert.match(h.container.innerHTML,/All dates · read-only/);assert.equal(JSON.stringify(snapshot),original);assert.equal(JSON.stringify(d),h.original);h.dispose();
});
test('shadow-only historical focus retains raw/canonical identities, never infers tag genotypes and refuses all detail/planner handlers',()=>{
 const called=[],snapshot=[mouse('100000',{canonical_sid:'03345',legacy_sids:['100000'],state:'Ended',archived:true,physical_tag:"P′-M1000",sire_sids:['2']}),mouse('2',{state:'Ended',sex:'Male'})];
 const h=harness(data([mouse('1')]),'100000',{pedigreeMice:snapshot,getClassification:id=>{called.push(id);return {confirmed:true,shorthand:'CONFIRMED_SENTINEL',traits:[{code:'P',presence:'present'}]};}});
 assert.equal(h.focus,'100000');assert.ok(node(h,'2'));assert.match(h.container.innerHTML,/SID 03345/);assert.match(h.container.innerHTML,/Read-only pedigree record/);assert.match(h.container.innerHTML,/Genotype unknown; assay evidence unavailable/);assert.doesNotMatch(h.container.innerHTML,/CONFIRMED_SENTINEL/);assert.deepEqual(called,[]);
 for(const action of ['open-mouse','review','target-focus'])assert.match(h.container.innerHTML,new RegExp('data-family-action="'+action+'" disabled'));
 for(const action of ['open-mouse','review','target-focus','open-target'])h.click(action);
 assert.ok(!h.messages.some(row=>['open','review','target'].includes(row[0])));assert.deepEqual(h.writes,[]);assert.equal(JSON.stringify(h.dataset),h.original);h.dispose();
});
test('all-age focus search finds unrelated shadow canonical SID, raw SID, tag and aliases without changing the primary list',()=>{
 const snapshot=[mouse('1'),mouse('100000',{canonical_sid:'03345',legacy_sids:['100000','old-tag-id'],physical_tag:'Historical-only tag',state:'Ended'})];
 const h=harness(data([mouse('1')]),'1',{pedigreeMice:snapshot});
 assert.equal(node(h,'100000'),undefined);h.input('pedigree-search','03345');assert.equal(h.enterField('pedigree-search'),true);assert.match(h.container.innerHTML,/1 matching pedigree records/);assert.match(h.container.innerHTML,/data-id="100000">Historical-only tag/);
 for(const query of ['100000','Historical-only tag','old-tag-id']){h.input('pedigree-search',query);h.click('pedigree-search');assert.match(h.container.innerHTML,/1 matching pedigree records/);}
 h.click('focus',{id:'100000'});assert.equal(h.focus,'100000');assert.equal(h.model.focusId,'100000');h.click('pedigree-back');assert.equal(h.focus,'1');assert.match(h.container.innerHTML,/1 matching mice/);h.dispose();
});
test('explicit empty or malformed side snapshot cannot fall back to primary records or stale viewport focus',()=>{
 for(const supplied of [[],null]){
  const count=port.models.length,h=harness(data([mouse('1',{sire_sids:['2']}),mouse('2')]),'1',{pedigreeMice:supplied});
  assert.equal(port.models.length,count);assert.doesNotMatch(h.container.innerHTML,/class="pedigree-node(?:\s|")/);assert.match(h.container.innerHTML,/0 matching mice/);assert.match(h.container.innerHTML,/0 records available for the graph/);h.click('open-mouse');h.click('review');h.click('focus',{id:'2'});assert.ok(!h.messages.some(row=>['open','review'].includes(row[0])));h.dispose();
 }
});
test('primary assay classification survives only an exact matching record context; shadow genotype text stays unconfirmed',()=>{
 const d=data([mouse('1',{genotype:'B',genetic_profile:profile})]),snapshot=[mouse('1',{genotype:'B'}),mouse('2',{genotype:'P',state:'Ended'})];
 const h=harness(d,'1',{pedigreeMice:snapshot});let pedigree=h.container.innerHTML.split('<section class="panel family-pedigree">')[1];assert.match(pedigree,/Confirmed/);
 h.click('focus',{id:'2'});pedigree=h.container.innerHTML.split('<section class="panel family-pedigree">')[1];assert.match(pedigree,/Read-only genotype text; assay evidence unavailable/);assert.doesNotMatch(pedigree,/Confirmed/);
 h.click('focus',{id:'1'});h.click('open-mouse');assert.deepEqual(h.messages.at(-1),['open','1']);h.dispose();
});
test('snapshot replacement invalidates graph history/search and detaches stale viewport callbacks',()=>{
 const d=data([mouse('1'),mouse('2')]),h=harness(d,'1',{pedigreeMice:[mouse('1',{sire_sids:['2']}),mouse('2',{state:'Ended'})]});
 h.input('pedigree-search','2');h.click('pedigree-search');h.click('focus',{id:'2'});const old=h.mount;old.change({cx:500,cy:500,scale:2});
 h.hooks.pedigreeMice=[mouse('1',{sire_sids:['3']}),mouse('3',{state:'Ended'})];h.remount();assert.equal(h.focus,'1');assert.ok(node(h,'3'));assert.equal(node(h,'2'),undefined);assert.equal(h.mount.initial,null);assert.match(h.container.innerHTML,/data-family-field="pedigree-search" value=""/);
 old.change({cx:999,cy:999,scale:3});h.change('sex','Female');assert.notDeepEqual(h.mount.initial,{cx:999,cy:999,scale:3});h.click('pedigree-back');assert.equal(h.focus,'1');h.dispose();
});
test('refresh hook is optional and explicit, informational status is escaped, search results stay bounded',()=>{
 let refreshes=0;const snapshot=[mouse('1'),...Array.from({length:60},(_,i)=>mouse('historical-'+i,{state:'Ended',physical_tag:'Historical tag '+i}))];
 const h=harness(data([mouse('1')]),'1',{pedigreeMice:snapshot,pedigreeStatus:'<img src=x onerror=bad()>',refreshPedigree:()=>refreshes++});
 assert.doesNotMatch(h.container.innerHTML,/<img src=x/);assert.match(h.container.innerHTML,/&lt;img/);h.click('refresh-pedigree');assert.equal(refreshes,1);assert.equal(JSON.stringify(h.dataset),h.original);
 h.input('pedigree-search','historical');h.click('pedigree-search');assert.match(h.container.innerHTML,/60 matching pedigree records/);assert.match(h.container.innerHTML,/Showing the first 20/);assert.equal((h.container.innerHTML.match(/class="family-relative"><button[^>]+data-id="historical-/g)||[]).length,20);h.dispose();
 const noHook=harness();noHook.click('refresh-pedigree');assert.deepEqual(noHook.writes,[]);noHook.dispose();
});
