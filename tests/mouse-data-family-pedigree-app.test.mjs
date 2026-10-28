import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(process.env.MOUSE_DATA_APP_PATH||new URL('../mouse-data/app.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('let familyPedigreeSnapshot='),source.indexOf('const managedViewKey='));
const family=source.slice(source.indexOf('function renderFamily(){'),source.indexOf('\nfunction cageHousing('));
const gates=source.slice(source.indexOf(' if(dataset&&familyPedigreeRouteGate())return;'),source.indexOf(" if(!detail&&(dataset||route==='brainbot')&&sectionRouteGate())return;"));
const retry=source.match(/if\(name==='family-pedigree-retry'\)\{[^\n]+\}/)?.[0];
assert.ok(block.startsWith('let familyPedigreeSnapshot='));
assert.ok(family.startsWith('function renderFamily(){'));
assert.ok(gates.includes('const familyProjection='));
assert.ok(retry);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const base=()=>freeze({tables:{mice:[{mouse_sid:'3',canonical_sid:'00003',state:'Stock',genotype:'FB',sire_sids:['1'],dam_sids:[],private_source:{note:'full record only'}}],mouse_genes:[{id:'g1',private_assay:'not in projection'}]},source:{privateArchive:true}});
const projected=(records=[{mouse_sid:'3',canonical_sid:'00003',state:'Stock',sire_sids:['1'],dam_sids:[]}],versions=records.map(row=>({entityId:row.mouse_sid,version:4,archived:false})))=>freeze({scope:'family_pedigree_all_dates_v1',readOnly:true,totalRows:records.length,snapshotRevision:'a'.repeat(32),records,versions});

function host(options={}){
 const calls=[],reads=[],nodes=new Map(),original=options.dataset||base();let context='owner:cloud1:colony1:session1',scope='scope:1';
 const element=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:''});return nodes.get(id);};
 const main=element('main');Object.defineProperty(main,'innerHTML',{get(){return this.html||'';},set(value){this.html=value;nodes.delete('family-pedigree-loading');if(value.includes('id="family-pedigree-loading"'))element('family-pedigree-loading');}});
 const sandbox={AbortController,console,Map,Object,Number,JSON,Boolean,String,
  route:'family',detail:null,dataset:original,cloud:{mode:'cloud'},cloudReady:true,startupLoading:false,cachedPreview:false,
  workflowCleanup:()=>calls.push(['cleanup']),familyClassifications:new Map(),familyFocus:'3',plannerMouseId:null,plannerTargetDraft:null,
  workflowContext:()=>context,$:element,count:value=>Number(value||0).toLocaleString(),esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  panel:(title,html)=>`<section><h2>${title}</h2>${html}</section>`,button:(label,action)=>`<button data-action="${action}">${label}</button>`,
  render:()=>calls.push(['render']),navigate:(...args)=>calls.push(['navigate',...args]),showHelp:(...args)=>calls.push(['help',...args]),
  buildFamilyGenotypes:(dataset,options)=>{calls.push(['classify',dataset,options]);return {animals:[{id:'3',classification:'real full record'}]};},
  renderFamilyExplorer:(...args)=>{calls.push(['explorer',...args]);return ()=>calls.push(['dispose-explorer']);},
  canCompleteFamilyMouse:()=>false,canReadGuestRoute:()=>false,openFamilyMouseCompletion:()=>{throw new Error('Unexpected completion in the read-only projection host test');},
  managedRouteGate:()=>{calls.push(['managed']);return false;},historyRouteGate:tables=>{calls.push(['history',tables]);return false;},
  store:{getFamilyPedigreeReadContext:()=>({available:true,source:'cloud1',contextKey:scope}),readFamilyPedigreeSnapshot:parameters=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});reads.push({parameters,resolve,reject});return promise;},
   saveDataset:()=>{throw new Error('Unexpected scientific write');},loadDataset:()=>{throw new Error('Unexpected baseline replacement');},queueCache:()=>{throw new Error('Unexpected projection cache');}},
 };
 vm.createContext(sandbox);vm.runInContext(block+'\n'+family+'\n'+
  'globalThis.api={gate:familyPedigreeRouteGate,sync:syncFamilyPedigreeRead,clear:clearFamilyPedigreeRead,paint:renderFamily,context:familyPedigreeContext,state:()=>({snapshot:familyPedigreeSnapshot,load:familyPedigreeLoad,failure:familyPedigreeFailure}),setSnapshot:value=>familyPedigreeSnapshot={dataset,context:familyPedigreeContext(),value,displayRecords:familyPedigreeDisplayRecords(value)},retry:()=>{const name="family-pedigree-retry";'+retry+'},runGates:()=>{'+gates+'return "continue";}};',sandbox);
 return {sandbox,api:sandbox.api,calls,reads,nodes,main,original,setContext:value=>context=value,setScope:value=>scope=value,render:()=>{sandbox.api.sync();return sandbox.api.gate();}};
}

test('Family starts one independent read and keeps meaningful progress until completion',async()=>{
 const h=host();assert.equal(h.render(),true);assert.equal(h.reads.length,1);assert.ok(h.reads[0].parameters.signal instanceof AbortSignal);assert.equal(h.render(),true);assert.equal(h.reads.length,1);
 h.reads[0].parameters.onProgress({phase:'metadata',loaded:0,total:null});assert.match(h.nodes.get('family-pedigree-loading').textContent,/Loading pedigree records · 0…/);assert.doesNotMatch(h.nodes.get('family-pedigree-loading').textContent,/of 0/);
 h.reads[0].parameters.onProgress({phase:'records',loaded:250,total:3334});assert.match(h.nodes.get('family-pedigree-loading').textContent,/250 of 3,334/);
 h.reads[0].parameters.onProgress({phase:'verify',loaded:500,total:3334});assert.match(h.nodes.get('family-pedigree-loading').textContent,/Verifying/);
 const value=projected();h.reads[0].resolve(value);await flush();assert.strictEqual(h.api.state().snapshot.value,value);assert.equal(h.api.state().load,null);assert.equal(h.api.gate(),false);assert.equal(h.calls.filter(row=>row[0]==='render').length,1);
});
test('an empty verified snapshot is usable and does not start a fallback read',async()=>{
 const h=host();h.render();const value=projected([]);h.reads[0].resolve(value);await flush();assert.equal(h.api.gate(),false);h.api.paint();const [,container,dataset,hooks]=h.calls.find(row=>row[0]==='explorer');assert.strictEqual(dataset,h.original);assert.equal(hooks.pedigreeMice.length,0);assert.match(hooks.pedigreeStatus,/0 eligible pedigree records/);assert.equal(h.reads.length,1);assert.ok(container);
});
test('snapshot publication and rendering never merge the side projection into editable data',async()=>{
 const h=host(),before=JSON.stringify(h.original),value=projected([{mouse_sid:'old100000',canonical_sid:'03345',state:'Ended',genotype:'plain text',sire_sids:['1'],dam_sids:[]}]);h.render();h.reads[0].resolve(value);await flush();h.api.paint();const [,container,dataset,hooks]=h.calls.find(row=>row[0]==='explorer');assert.strictEqual(dataset,h.original);assert.strictEqual(h.sandbox.dataset,h.original);assert.equal(JSON.stringify(h.original),before);assert.equal(h.sandbox.dataset.tables.mice.length,1);assert.equal(h.sandbox.dataset.tables.mice[0].mouse_sid,'3');assert.equal(hooks.pedigreeMice[0].mouse_sid,'old100000');assert.ok(Object.isFrozen(hooks.pedigreeMice[0]));assert.notStrictEqual(hooks.pedigreeMice[0],value.records[0]);assert.equal(value.records[0].archived,undefined);assert.equal(h.calls.find(row=>row[0]==='classify')[1],h.original);assert.ok(container);
 assert.doesNotMatch(block,/\b(?:saveDataset|loadDataset|localStorage|sessionStorage|queueCache)\b|\bdataset\s*=(?!=)/,'the actual side-snapshot host has no write/cache/baseline-assignment path');
});
test('physical archive versions are projected for presentation without changing payloads or primary flags',()=>{
 const h=host(),value=projected([{mouse_sid:'3',archived:false},{mouse_sid:'4',archived:true},{mouse_sid:'5'}],[{entityId:'3',version:1,archived:true},{entityId:'4',version:1,archived:false},{entityId:'5',version:1,archived:false}]);h.api.setSnapshot(value);h.api.paint();const hooks=h.calls.find(row=>row[0]==='explorer')[3];assert.deepEqual(Array.from(hooks.pedigreeMice,row=>row.archived),[true,true,false]);assert.equal(value.records[0].archived,false);assert.equal(value.records[2].archived,undefined);assert.equal(h.original.tables.mice[0].archived,undefined);
});
test('ordinary Family rerenders retain the exact enriched snapshot array and graph context',async()=>{
 const h=host(),value=projected();h.render();h.reads[0].resolve(value);await flush();h.api.paint();const first=h.calls.filter(row=>row[0]==='explorer').at(-1)[3];h.api.sync();assert.equal(h.api.gate(),false);h.api.paint();const second=h.calls.filter(row=>row[0]==='explorer').at(-1)[3];assert.strictEqual(second.pedigreeMice,first.pedigreeMice,'Explorer must not see a new projection identity and reset the expanded graph on rerender');assert.strictEqual(second.pedigreeMice,h.api.state().snapshot.displayRecords);assert.ok(Object.isFrozen(second.pedigreeMice));assert.equal(second.getGraphContext(),first.getGraphContext());assert.equal(h.reads.length,1);assert.equal(value.records[0].archived,undefined);assert.equal(h.original.tables.mice[0].archived,undefined);
});
test('local mode uses original Family data and performs no all-date cloud read',()=>{
 const h=host();h.sandbox.cloud.mode='local';assert.equal(h.render(),false);assert.equal(h.reads.length,0);h.api.paint();const hooks=h.calls.find(row=>row[0]==='explorer')[3];assert.equal('pedigreeMice' in hooks,false);assert.equal('refreshPedigree' in hooks,false);
});
test('unready startup and cached previews wait without issuing pedigree requests',()=>{
 for(const [key,value] of [['startupLoading',true],['cachedPreview',true],['cloudReady',false]]){const h=host();h.sandbox[key]=value;assert.equal(h.render(),true);assert.equal(h.reads.length,0);assert.match(h.main.innerHTML,/Wait for the colony connection/);h.sandbox[key]=!value;h.render();assert.equal(h.reads.length,1);}
});
test('RPC unavailable is a visible failure with explicit Retry and no baseline fallback',async()=>{
 const h=host();h.render();const error=Object.assign(new Error('Full pedigree service unavailable; no all-date projection.'),{code:'FAMILY_PEDIGREE_UNAVAILABLE'});h.reads[0].reject(error);await flush();h.render();assert.equal(h.api.state().snapshot,null);assert.match(h.main.innerHTML,/role="alert"/);assert.match(h.main.innerHTML,/Full pedigree service unavailable/);assert.match(h.main.innerHTML,/data-action="family-pedigree-retry"/);assert.equal(h.reads.length,1);assert.equal(h.calls.filter(row=>row[0]==='explorer').length,0);assert.strictEqual(h.sandbox.dataset,h.original);
});
test('failure text is escaped rather than inserted as markup',async()=>{
 const h=host();h.render();h.reads[0].reject(new Error('<img src=x onerror=bad()>'));await flush();h.render();assert.match(h.main.innerHTML,/&lt;img src=x onerror=bad\(\)&gt;/);assert.doesNotMatch(h.main.innerHTML,/<img/);
});
test('Retry aborts prior read, clears its result/error and allows exactly one new attempt',async()=>{
 const h=host();h.render();const first=h.reads[0];h.api.retry();assert.equal(first.parameters.signal.aborted,true);assert.equal(h.api.state().load,null);assert.equal(h.api.state().snapshot,null);assert.equal(h.api.state().failure,null);h.render();assert.equal(h.reads.length,2);first.resolve(projected());await flush();assert.equal(h.api.state().snapshot,null);h.reads[1].resolve(projected([]));await flush();assert.equal(h.api.state().snapshot.value.totalRows,0);assert.equal(h.api.state().failure,null);
});
test('explicit refresh clears only the side snapshot and does not reload/edit dataset',()=>{
 const h=host();h.api.setSnapshot(projected());h.api.paint();const hooks=h.calls.find(row=>row[0]==='explorer')[3];hooks.refreshPedigree();assert.equal(h.api.state().snapshot,null);assert.strictEqual(h.sandbox.dataset,h.original);assert.equal(h.calls.filter(row=>row[0]==='render').length,1);assert.equal(h.reads.length,0);
});
test('route/detail/dataset/context changes abort on sync and obsolete success cannot publish',async()=>{
 const changes=[h=>h.sandbox.route='mice',h=>h.sandbox.detail={type:'mice',id:'3'},h=>h.sandbox.dataset=base(),h=>h.sandbox.dataset=null,h=>h.setContext('other-account'),h=>h.setScope('changed-colony-role-date-source')];
 for(const change of changes){const h=host();h.render();const first=h.reads[0];change(h);h.api.sync();assert.equal(first.parameters.signal.aborted,true);assert.equal(h.api.state().load,null);first.resolve(projected());await flush();assert.equal(h.api.state().snapshot,null);assert.equal(h.api.state().failure,null);assert.equal(h.calls.filter(row=>row[0]==='render').length,0);}
});
test('obsolete errors and progress cannot overwrite a replacement request',async()=>{
 const h=host();h.render();const first=h.reads[0];h.setScope('scope2');h.render();const second=h.reads[1];const before=h.nodes.get('family-pedigree-loading').textContent;first.parameters.onProgress({phase:'records',loaded:999,total:1000});assert.equal(h.nodes.get('family-pedigree-loading').textContent,before);first.reject(new Error('Old request failed'));await flush();assert.equal(h.api.state().failure,null);assert.strictEqual(h.api.state().load.controller.signal,second.parameters.signal);second.resolve(projected());await flush();assert.equal(h.api.state().snapshot.context,h.api.context());
});
test('context and route fences also reject late settlements before a render has synchronised state',async()=>{
 for(const change of [h=>h.setContext('new-session'),h=>h.setScope(null),h=>h.sandbox.route='settings',h=>h.sandbox.dataset=base()])for(const outcome of ['resolve','reject']){const h=host();h.render();change(h);if(outcome==='resolve')h.reads[0].resolve(projected());else h.reads[0].reject(new Error('stale'));await flush();assert.equal(h.api.state().snapshot,null);assert.equal(h.api.state().failure,null);assert.equal(h.calls.filter(row=>row[0]==='render').length,0);h.api.sync();assert.equal(h.reads[0].parameters.signal.aborted,true);}
});
test('loaded snapshot and displayed failure are discarded when their scope changes',async()=>{
 for(const settled of ['snapshot','failure']){const h=host();h.render();settled==='snapshot'?h.reads[0].resolve(projected()):h.reads[0].reject(new Error('read failed'));await flush();assert.ok(h.api.state()[settled]);h.setScope('permissions changed');h.api.sync();assert.equal(h.api.state().snapshot,null);assert.equal(h.api.state().failure,null);h.render();assert.equal(h.reads.length,2);}
});
test('real render gates skip editable managed/archive reads for cloud Family only',()=>{
 const h=host();h.api.setSnapshot(projected());assert.equal(h.api.runGates(),'continue');assert.equal(h.calls.filter(row=>['managed','history'].includes(row[0])).length,0);
 const local=host();local.sandbox.cloud.mode='local';assert.equal(local.api.runGates(),'continue');assert.equal(local.calls.filter(row=>row[0]==='managed').length,1);assert.deepEqual(Array.from(local.calls.find(row=>row[0]==='history')[1]),['mouse_genes']);
 const detail=host();detail.sandbox.route='mice';detail.sandbox.detail={type:'mice',id:'3'};detail.api.runGates();assert.deepEqual(Array.from(detail.calls.find(row=>row[0]==='history')[1]),['mouse_genes','mating_members']);
});
test('real render stops at pending Family gate before managed/history/lazy sections',()=>{
 const h=host();assert.equal(h.api.runGates(),undefined);assert.equal(h.reads.length,1);assert.equal(h.calls.filter(row=>['managed','history','explorer'].includes(row[0])).length,0);
 const render=source.slice(source.indexOf('function render() {'),source.indexOf('async function importHistoryFile'));
 assert.ok(render.indexOf('syncFamilyPedigreeRead();')<render.indexOf('if(startupLoading)'));
 assert.ok(render.indexOf('if(!canReadGuestRoute(route))')<render.indexOf('familyPedigreeRouteGate()'));
 assert.ok(render.indexOf('if(cloud.passwordRecovery)')<render.indexOf('familyPedigreeRouteGate()'));
 assert.ok(render.indexOf('familyPedigreeRouteGate()')<render.indexOf('sectionRouteGate()'));
});
test('Family hooks keep raw identities, account/revision graph context and original full-record classifications',()=>{
 const h=host();h.api.setSnapshot(projected([{mouse_sid:'100000',canonical_sid:'03345'}]));h.api.paint();const hooks=h.calls.find(row=>row[0]==='explorer')[3];assert.equal(hooks.canCompleteMouse(),false);assert.equal(hooks.canCompleteArchived(),false);assert.equal(typeof hooks.loadMouse,'function');hooks.openMouse('100000');assert.deepEqual(h.calls.find(row=>row[0]==='navigate'),['navigate','mice','100000']);hooks.setFocus('100000');assert.equal(hooks.getFocus(),'100000');assert.match(hooks.getGraphContext(),/a{32}$/);assert.equal(hooks.getClassification('3').classification,'real full record');assert.equal(hooks.getClassification('100000'),undefined);assert.equal(h.original.tables.mice[0].mouse_sid,'3');
});
