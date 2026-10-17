import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {normalizeManagerPermissions} from '../mouse-data/permissions.js';
const source=await readFile(new URL('../mouse-data/app.js',import.meta.url),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function fixture(){
 const calls=[],state={status:{email:'owner@example.invalid',role:'owner',signedIn:true,permissions:{genetics:true},mode:'cloud'},fresh:{tables:{husbandry_events:[]}}};
 const c=vm.createContext({state,calls,Error,normalizeManagerPermissions,location:{hash:'#strains'},$:id=>({id}),labUserDirectoryContext:s=>JSON.stringify(s),renderStrainManagement:(container,data,hooks)=>{state.hooks=hooks;},showToast:()=>{},deferredHistoryTables:()=>[],store:{getCloudStatus:()=>state.status,loadDataset:async()=>{await state.onLoad?.();return state.fresh;},saveDataset:async next=>{calls.push(next);await state.onSave?.();}},refreshCloud:async()=>{state.refreshes=(state.refreshes||0)+1;}});
 vm.runInContext('let route="strains",pageRenderGeneration=1,cryoHistoryContext="",cryoHistoryIndex=null,dataset={tables:{}},cloud=state.status,brainbotReviewPending=false,startupLoading=false,historyLoadState=null,cloudReady=true;',c);
 vm.runInContext(between('function canEditRecords(','function canEditCryopreservation('),c);
 vm.runInContext(between('function renderStrains(){','function mouseSummaryHTML('),c);
 const run=x=>vm.runInContext(x,c);run('renderStrains()');return{state,calls,run};
}
test('Strains is a navigable workspace menu, and the old Mice shortcut opens it',()=>{
 assert.match(source,/mice:'Mice',strains:'Strains'/);
 assert.match(source,/if\(route==='strains'\)\{renderStrains\(\);return\}/);
 assert.match(source,/function openStrains\(\)\{navigate\('strains'\);\}/);
 // Use the existing genetics audit section while its server vocabulary remains fixed.
 assert.match(source,/route==='strains'\?'planner':route/);
});
test('strain writes follow existing genetics permissions',()=>{
 const f=fixture();assert.equal(f.state.hooks.canEdit(),true);
 for(const [role,genetics,expected] of [['viewer',true,false],['manager',false,false],['manager',true,true],['editor',true,true]]){
  f.state.status.role=role;f.state.status.permissions.genetics=genetics;f.run('cloud=state.status;renderStrains()');assert.equal(f.state.hooks.canEdit(),expected,role);
 }
});
test('reload and save update shared data without replacing the strain editor',async()=>{
 const f=fixture(),draft={tables:{husbandry_events:[{event_id:'STRAIN-P'}]}};
 assert.equal(await f.state.hooks.reloadDataset(),f.state.fresh);
 await f.state.hooks.saveDataset(draft);assert.deepEqual(f.calls,[draft]);assert.equal(f.run('dataset'),f.state.fresh);assert.equal(f.state.refreshes,1);
});
test('stale view and changed account reject writes and reload adoption',async()=>{
 for(const change of [f=>f.run('route="mice"'),f=>f.run('pageRenderGeneration++'),f=>{f.state.status={...f.state.status,email:'other@example.invalid'};}]){
  const f=fixture();change(f);assert.equal(f.state.hooks.canEdit(),false);await assert.rejects(f.state.hooks.saveDataset({}),/changed/);assert.equal(f.calls.length,0);
 }
 const f=fixture();f.state.onLoad=async()=>f.run('route="mice"');await assert.rejects(f.state.hooks.reloadDataset(),/changed/);assert.notEqual(f.run('dataset'),f.state.fresh);
});
test('unsaved strain edits use the existing unload protection and clear on account change',()=>{
 assert.match(source,/hasCageSheetDrafts\(\)\|\|hasStrainDrafts\(\$\('main'\)\)/);
 assert.match(source,/clearLabMembersView\(\);clearAccountSetup\(\$\('account-setup'\)\);clearStrainManagement\(\$\('main'\)\)/);
});
