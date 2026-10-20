import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {datasetFromLocalBackup} from '../mouse-data/local-backup.js';
import {normalizeDataset} from '../mouse-data/model.js';

const app=await readFile(new URL('../mouse-data/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function importDataset(file){'),app.indexOf('\nfunction downloadExport'));
function backup(workspace){
 const envelope={kind:'braintime-local-backup',schema_version:1,application:'mouse-data',full_workspace:true,restore_mode:'workspace',permission:{level:'max',cutoff_date:null,as_of_date:'2026-10-20'},sections:{workspace}};
 return {...envelope,integrity:{algorithm:'SHA-256',encoding:'JSON.stringify of envelope without integrity',value:createHash('sha256').update(JSON.stringify(envelope)).digest('hex')}};
}
function harness({confirm=true}={}){
 const calls={normalize:0,confirm:0,save:[],load:0,refresh:0,navigate:[],network:0,messages:[]},input={value:'selected.json'};let saved;
 const context={cachedPreview:false,startupLoading:false,historyLoadState:null,managedLoadState:null,dataset:null,cageDate:'before',cloudReady:false,
  datasetFromLocalBackup,model:{normalizeDataset:value=>{calls.normalize++;return normalizeDataset(value);}},
  confirmAction:async()=>{calls.confirm++;return confirm;},
  store:{saveDataset:async(data,options)=>{saved=structuredClone(data);calls.save.push({data:structuredClone(data),options});},loadDataset:async()=>{calls.load++;return structuredClone(saved);}},
  showToast:(message,error=false)=>calls.messages.push({message,error}),clearCageSheetDrafts:()=>{},refreshCloud:async()=>{calls.refresh++;},navigate:route=>calls.navigate.push(route),
  fetch:async()=>{calls.network++;throw Error('Network access is forbidden in the import fixture');},
  $:id=>{assert.equal(id,'import-file');return input;},editableTypes:['mice','cages'],titles:{mice:'Mice',cages:'Cages'},esc:String,kv:()=>''
 };
 vm.createContext(context);vm.runInContext(source,context);
 return {calls,input,context,import:async value=>{const encoded=JSON.stringify(value);await context.importDataset({name:'selected.json',size:Buffer.byteLength(encoded),text:async()=>encoded});}};
}
const typed={tables:{mice:[{mouse_sid:'M1',physical_tag:'TAG-1',state:'Stock',source_cell:'B8',notes:'Preserve this mouse note'}],cages:[{cage_sid:'C1',state:'Active',notes:'Preserve this cage note'}],historical_observations:[{source_cell:'F9',raw_text:'Retained scientific observation'}]},sources:[{title:'Source reference',url:'https://example.test/original'}]};

test('raw-cell indexes and native workbooks never reach normalization, confirmation, local storage or network',async()=>{
 const index={sources:[],sheets:[],cells:[[0,'A1','RAW SOURCE CELL']]},native={spreadsheetId:'SYNTHETIC_SOURCE',sheets:[{data:[{rowData:[{values:[{effectiveValue:{stringValue:'RAW SOURCE CELL'}}]}]}]}]};
 // Bare source files already fail the existing reconstructed-dataset contract;
 // mixed files and verified full backups reach the new post-unwrapping guard.
 const mixedIndex={...index,tables:{mice:[]}},mixedNative={...native,tables:{mice:[]}};
 for(const value of [index,native,mixedIndex,mixedNative,backup(mixedIndex),backup(mixedNative)]){
  const h=harness();await h.import(value);
  assert.equal(h.calls.normalize,0);assert.equal(h.calls.confirm,0);assert.equal(h.calls.save.length,0);assert.equal(h.calls.load,0);assert.equal(h.calls.refresh,0);assert.equal(h.calls.network,0);assert.deepEqual(h.calls.navigate,[]);assert.equal(h.input.value,'');assert(h.calls.messages.some(row=>row.error));
  if(Object.hasOwn(value,'tables')||value.kind==='braintime-local-backup')assert(h.calls.messages.some(row=>row.message.includes('Raw workbook imports have been retired')));
 }
});
test('registered records and ordinary source metadata remain unchanged through direct and verified-backup imports',async()=>{
 for(const value of [typed,backup(typed)]){
  const before=structuredClone(value),h=harness();await h.import(value);
  assert.deepEqual(value,before);assert.equal(h.calls.normalize,1);assert.equal(h.calls.confirm,1);assert.equal(h.calls.save.length,1);assert.deepEqual(h.calls.save[0].data,normalizeDataset(typed));assert.equal(h.calls.save[0].options.localOnly,true);assert.equal(Object.keys(h.calls.save[0].options).length,1);assert.equal(h.calls.load,1);assert.equal(h.calls.refresh,1);assert.equal(h.calls.network,0);assert.deepEqual(h.calls.navigate,['overview']);assert.equal(h.context.cloudReady,true);assert.equal(h.input.value,'');assert(!h.calls.messages.some(row=>row.error));
 }
});
test('normal imports still require confirmation and cancellation never changes storage',async()=>{
 const h=harness({confirm:false});await h.import(typed);assert.equal(h.calls.normalize,1);assert.equal(h.calls.confirm,1);assert.equal(h.calls.save.length,0);assert.equal(h.calls.load,0);assert.equal(h.calls.refresh,0);assert.equal(h.calls.network,0);assert.deepEqual(h.calls.navigate,[]);assert.equal(h.input.value,'');
});
