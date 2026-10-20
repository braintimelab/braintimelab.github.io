import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../mouse-data/app.js',import.meta.url),'utf8');
const body=app.slice(app.indexOf('async function renderPlanner(){'),app.indexOf('async function loadCryoHistory(){'));
assert.ok(body.includes("import('./breeding-planner.js?v="));
function harness(){
 let resolve,reject,loads=0;const rendering=[],history=[],main={innerHTML:''};
 const env={dataset:{tables:{}},plannerRenderToken:0,plannerModule:null,plannerModulePending:null,plannerMouseId:null,plannerTargetDraft:null,route:'planner',cloud:{mode:'cloud'},loadSectionStyle:()=>{},$:()=>main,panel:(name,text)=>name+text,button:label=>label,deferredHistoryTables:()=>['mouse_genes','historical_observations'],navigate(){},showToast(){},canEditRecords(){return true;},model:{validateRecord(){}},loadHistoryTables:async tables=>{history.push(tables);return env.dataset;},store:{},loadPlannerFixture:()=>{loads++;return new Promise((yes,no)=>{resolve=yes;reject=no;});}};
 const run=new Function('env',`with(env){return (${body.replace(/import\('\.\/breeding-planner\.js\?v=\d+'\)/,'loadPlannerFixture()')});}`)(env);
 return{env,main,run,rendering,history,get loads(){return loads;},resolve(){resolve({renderBreedingPlanner:(...args)=>rendering.push(args)});},reject(){reject(new Error('offline'));}};
}
test('Planning loads its module once and does not request source/genotype history until needed',async()=>{
 const h=harness(),first=h.run(),second=h.run();assert.equal(h.loads,1);assert.deepEqual(h.history,[]);h.resolve();await Promise.all([first,second]);assert.equal(h.rendering.length,1);const hooks=h.rendering[0][2];assert.equal(hooks.genotypeHistoryDeferred,true);assert.equal(await hooks.loadGenotypeHistory(),h.env.dataset);assert.deepEqual(h.history,[['mouse_genes']]);await h.run();assert.equal(h.loads,1);
});
test('a delayed Planning module cannot overwrite another menu',async()=>{
 const h=harness(),pending=h.run();h.env.route='cages';h.main.innerHTML='Cages';h.resolve();await pending;assert.equal(h.main.innerHTML,'Cages');assert.equal(h.rendering.length,0);
});
test('failed Planning module loading allows another attempt',async()=>{
 const h=harness(),first=h.run();h.reject();await first;assert.match(h.main.innerHTML,/could not load/);const second=h.run();assert.equal(h.loads,2);h.resolve();await second;assert.equal(h.rendering.length,1);
});
test('the Planning menu has no unconditional archive-history prerequisite',()=>{
 const expression=app.match(/const historyRequired=(\(\{.*?\}\)\[route\]);/)[1];const required=new Function('route','detail',`return ${expression}`);assert.equal(required('planner',null),undefined);assert.deepEqual(required('mice',null),['mouse_genes']);
});
