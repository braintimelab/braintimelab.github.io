import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const app=await readFile(new URL('../mouse-data/app.js',import.meta.url),'utf8');
const loadSource=app.slice(app.indexOf('function cryoSourceContext(){'),app.indexOf('\nfunction renderCryo(){'));
function harness({rows=[{format:'braintime-cryo-register'}],changeAccount=false,invalid=false,retired=false,verifyGate=null}={}){
 const calls=[],state={context:'owner-a',sessionEpoch:'1',pending:retired?[]:['cryo_source_register','historical_observations'],dataset:{tables:retired?{}:{cryo_source_register:rows}}};
 const context={dataset:state.dataset,labUserDirectoryContext:()=>state.context,
  store:{getCloudStatus:()=>({userId:'owner-a',sessionEpoch:state.sessionEpoch,activeCloud:'cloud1'}),downloadHistoryIndex:()=>{throw Error('raw download forbidden');}},
  deferredHistoryTables:()=>state.pending,loadHistoryTables:async names=>{calls.push(['load',names]);state.pending=state.pending.filter(name=>!names.includes(name));if(changeAccount)state.context='owner-b';return context.dataset;},
  history:{loadHistoryIndex:()=>{throw Error('raw cache read forbidden');},clearHistoryIndex:async({check})=>{check();calls.push(['clear-raw-cache']);}},
  verifyCryoRegister:async(value,options)=>{calls.push(['verify',options.expectedSourceArchiveSha256]);if(verifyGate)await verifyGate();if(invalid)throw Error('checksum mismatch');return Object.freeze({verified:value});}
 };
 vm.createContext(context);vm.runInContext('let cryoHistoryContext,cryoHistoryIndex,cryoHistoryPending,cryoHistoryDataset;\n'+loadSource,context);
 return {load:()=>context.loadCryoHistory(),calls,state,replaceDataset:()=>{context.dataset={tables:{cryo_source_register:rows}};}};
}
test('Cryoprotection hydrates only the compact typed register, then clears the retired raw cache',async()=>{
 const h=harness(),first=await h.load();assert.equal(first.verified.format,'braintime-cryo-register');
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[
  ['load',['cryo_source_register']],['verify','87e0680e7dcde0eecd2752577df3f1cd0492a8918a7f90ead7c7b20f4837aa20'],['clear-raw-cache']]);
 assert.deepEqual(h.state.pending,['historical_observations']);assert.equal(await h.load(),first);assert.equal(h.calls.length,3);
});
test('a changed account cannot expose or cache an in-flight register',async()=>{
 const h=harness({changeAccount:true});await assert.rejects(h.load(),/Account changed/);assert.equal(h.calls.length,1);
});
test('missing, duplicate or corrupt registers never fall back to retaining raw workbooks',async()=>{
 const absent=harness({retired:true});assert.equal(await absent.load(),null);assert.equal(absent.calls.length,0);
 const duplicate=harness({rows:[{},{}]});await assert.rejects(duplicate.load(),/conflicting registers/);assert.equal(duplicate.calls.length,1);
 const corrupt=harness({invalid:true});await assert.rejects(corrupt.load(),/checksum/);assert.equal(corrupt.calls.some(row=>row[0]==='clear-raw-cache'),false);
});
test('retired archive bookmarks explain retention without loading or offering raw file controls',()=>{
 const source=app.slice(app.indexOf('async function renderFullHistory(){'),app.indexOf('\nasync function importHistoryFile'));
 let html='';const context={canViewSourceArchive:()=>true,$:()=>({set innerHTML(value){html=value;}}),panel:(title,body)=>title+body};
 vm.createContext(context);vm.runInContext(source+'\nrenderFullHistory();',context);
 assert.match(html,/Raw workbooks are not retained/);assert.doesNotMatch(html,/button|upload|download|Import/);
});

test('a fresh session must reverify the register even for the same user',async()=>{
 const h=harness();const first=await h.load();h.state.sessionEpoch='2';const next=await h.load();assert.notEqual(first,next);assert.equal(h.calls.filter(row=>row[0]==='verify').length,2);
});
test('same-account dataset replacement during verification cannot adopt stale source records or clear a new cache',async()=>{
 let release,entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const h=harness({verifyGate:async()=>{entered();await gate;}});const loading=h.load();await ready;h.replaceDataset();release();
 await assert.rejects(loading,/Records changed/);assert.equal(h.calls.some(row=>row[0]==='clear-raw-cache'),false);
});

test('retired raw-cache cleanup does not read a workbook or delay startup, even if storage is unavailable',async()=>{
 const source=app.slice(app.indexOf('function retireLocalSourceArchive(){'),app.indexOf('async function start(){'));
 const calls=[];const context={history:{clearHistoryIndex:async()=>{calls.push('clear');throw Error('storage unavailable');}}};
 vm.createContext(context);vm.runInContext(source,context);assert.equal(context.retireLocalSourceArchive(),undefined);
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['clear']);
 assert.match(app,/async function start\(\)\{\s*retireLocalSourceArchive\(\);/);
});
