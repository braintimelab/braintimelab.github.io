import {loadMouseData,appSource} from './mouse-data-family-completion-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const {untaggedMouseCompletion}=await loadMouseData('litter-registration.js');
const {managedEditorNeeds}=await loadMouseData('managed-view.js');
const source=appSource;
const functions=source.slice(source.indexOf('function canCompleteFamilyMouse('),source.indexOf('function assertFamilyCompletion('));
const initial=()=>({tables:{mice:[{mouse_sid:'100000',canonical_sid:'03345',legacy_sids:['100000'],physical_tag:null,sex:'Unknown',state:'Stock',litter_sid:'L1',sire_sids:['P1'],genetic_profile:{calls:{}}},{mouse_sid:'2',litter_sid:'L1',physical_tag:null,state:'Stock'}],litters:[{litter_sid:'L1',state:'Unweaned'}]}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{resolve,promise};};
function harness(loader=null){
 const calls=[],notices=[],loads=[];const status={mode:'cloud',signedIn:true,readyForEdits:true,role:'owner',activeCloud:'cloud1',userId:'synthetic-A',sessionEpoch:1};
 const c={dataset:initial(),familyCompletionRequest:0,familyFocus:'100000',familyPedigreeSnapshot:null,route:'family',detail:null,cachedPreview:false,cloud:status,pageRenderGeneration:1,permission:true,archiveRead:true,dirty:false,currentStatus:status,untaggedMouseCompletion,managedEditorNeeds,JSON,String,Boolean,Error,showToast:message=>notices.push(message),historyDraftOpen:()=>c.dirty,canReadGuestRoute:section=>section==='archive'?c.archiveRead:section==='mice'&&c.permission,canEditRecords:section=>section==='mice'&&c.permission,cageSheetContext:(value=c.cloud)=>JSON.stringify(value),workflowContext:()=>JSON.stringify(c.currentStatus),familyPedigreeContext:()=>JSON.stringify(c.currentStatus),managedViewKey:()=>JSON.stringify([c.route,c.detail]),store:{getCloudStatus:()=>c.currentStatus},openEditor:(type,id)=>calls.push(['edit',type,id]),openLitterRegistration:options=>calls.push(['siblings',structuredClone(options)]),loadManagedRecords:async(requirements,options)=>{loads.push({requirements,options});return loader?loader(c):c.dataset;}};
 vm.createContext(c);vm.runInContext(functions,c);return{c,calls,notices,loads};
}
test('existing completion hydrates ordinary mouse requirements, then opens exact existing raw SID with no prefill',async()=>{
 const h=harness(),before=JSON.stringify(h.c.dataset);await h.c.openFamilyMouseCompletion('100000');assert.deepEqual(h.calls,[['edit','mice','100000']]);assert.deepEqual(h.loads[0].requirements,managedEditorNeeds('mice'));assert.equal(h.loads[0].options.expectedView,JSON.stringify(['family',null]));assert.equal(JSON.stringify(h.c.dataset),before);
});
test('batch hook uses only the selected full mouse saved litter and existing edit mode',async()=>{
 const h=harness();await h.c.openFamilyMouseCompletion('100000',{siblings:true});assert.deepEqual(h.calls,[['siblings',{litterSid:'L1',edit:true,completeUntaggedFor:'100000'}]]);
});
test('missing/side-only/raw alias, denied access and an existing draft never hydrate or open',async()=>{
 for(const alter of [h=>{h.c.dataset.tables.mice=[];},h=>{h.c.permission=false;},h=>{h.c.dirty=true;},h=>{h.c.cachedPreview=true;},h=>{h.c.currentStatus={...h.c.currentStatus,userId:'synthetic-B'};}]){const h=harness();alter(h);await h.c.openFamilyMouseCompletion('100000');assert.equal(h.loads.length,0);assert.equal(h.calls.length,0);}
 const h=harness();await h.c.openFamilyMouseCompletion('03345');assert.equal(h.loads.length,0);assert.equal(h.calls.length,0);
});
test('route/account/permission/generation or new draft during hydration prevents stale editor',async()=>{
 for(const mutate of [c=>{c.route='mice';},c=>{c.currentStatus={...c.currentStatus,sessionEpoch:2};},c=>{c.permission=false;},c=>{c.pageRenderGeneration++;},c=>{c.familyFocus='another-focus';},c=>{c.dirty=true;},c=>{c.dataset=structuredClone(c.dataset);}]){
  const gate=deferred(),h=harness(async c=>{const original=c.dataset;await gate.promise;return original;});const pending=h.c.openFamilyMouseCompletion('100000');mutate(h.c);gate.resolve();await pending;assert.equal(h.calls.length,0);
 }
});
test('a disappeared/newly tagged/read-only row after hydration never falls through to new mouse editor',async()=>{
 for(const mutate of [d=>{d.tables.mice.shift();},d=>{d.tables.mice[0].physical_tag='TAGGED';},d=>{d.tables.mice[0].history_read_only=true;}]){const h=harness(async c=>{const fresh=structuredClone(c.dataset);mutate(fresh);c.dataset=fresh;return fresh;});await h.c.openFamilyMouseCompletion('100000');assert.equal(h.calls.length,0);assert(h.notices.length);}
});
test('successive requests keep only newest action; a loading failure never opens or creates anything',async()=>{
 const gate=deferred();let count=0;const h=harness(async c=>{if(++count===1)await gate.promise;return c.dataset;});const first=h.c.openFamilyMouseCompletion('100000');await h.c.openFamilyMouseCompletion('2');gate.resolve();await first;assert.deepEqual(h.calls,[['edit','mice','2']]);
 const failed=harness(async()=>{throw Error('Synthetic read failed');});await failed.c.openFamilyMouseCompletion('100000');assert.equal(failed.calls.length,0);assert.match(failed.notices[0],/Synthetic read failed/);
});
test('no recorded litter offers no guessed batch while individual editor stays available',async()=>{
 const h=harness();delete h.c.dataset.tables.mice[0].litter_sid;await h.c.openFamilyMouseCompletion('100000',{siblings:true});assert.equal(h.calls.length,0);assert.match(h.notices[0],/No recorded litter/);await h.c.openFamilyMouseCompletion('100000');assert.deepEqual(h.calls,[['edit','mice','100000']]);
});
function sidecar(h,row={mouse_sid:'100000',physical_tag:null,state:'Ended'}){
 h.c.dataset.tables.mice=h.c.dataset.tables.mice.filter(mouse=>mouse.mouse_sid!==row.mouse_sid);const shadow=Object.freeze({...row});h.c.familyPedigreeSnapshot={dataset:h.c.dataset,context:h.c.familyPedigreeContext(),displayRecords:Object.freeze([shadow])};return shadow;
}
test('authorized full managed hydration can resolve an unhydrated Ended SID without copying sidecar fields',async()=>{
 for(const role of ['owner','editor','manager']){
  const h=harness(async c=>{const fresh=initial();Object.assign(fresh.tables.mice[0],{state:'Ended',end_date:'2026-02-01',comment:'Full primary payload'});c.dataset=fresh;return fresh;});h.c.cloud.role=role;const shadow=sidecar(h,{mouse_sid:'100000',physical_tag:null,state:'Ended',genotype:'SHADOW_SENTINEL'}),before=JSON.stringify(shadow);
  await h.c.openFamilyMouseCompletion('100000');assert.deepEqual(h.calls,[['edit','mice','100000']]);assert.equal(h.c.dataset.tables.mice[0].comment,'Full primary payload');assert.notEqual(h.c.dataset.tables.mice[0].genotype,'SHADOW_SENTINEL');assert.equal(JSON.stringify(shadow),before);
 }
});
test('a visible shadow never creates a mouse when full managed data is absent, immutable or denied',async()=>{
 for(const next of ['absent','immutable','projection','denied']){
  const h=harness(async c=>{if(next==='denied')throw Error('Normal managed read denied');const fresh=initial();if(next==='absent')fresh.tables.mice=[];if(next==='immutable')fresh.tables.mice[0].history_read_only=true;if(next==='projection')fresh.tables.mice[0].member_projection=true;c.dataset=fresh;return fresh;});sidecar(h);await h.c.openFamilyMouseCompletion('100000');assert.equal(h.calls.length,0);assert.match(h.notices.at(-1),/read-only|denied/);
 }
});
test('shadow raw identity must be visible, unique, untagged and bound to current dataset/account context',async()=>{
 for(const alter of [h=>{h.c.familyPedigreeSnapshot.context='stale';},h=>{h.c.familyPedigreeSnapshot.dataset={};},h=>{h.c.familyPedigreeSnapshot.displayRecords=[{mouse_sid:'other',physical_tag:null}];},h=>{h.c.familyPedigreeSnapshot.displayRecords=[{mouse_sid:'100000',physical_tag:'TAGGED'}];},h=>{h.c.familyPedigreeSnapshot.displayRecords=[{mouse_sid:'100000',physical_tag:null},{mouse_sid:'100000',physical_tag:null}];}]){const h=harness();sidecar(h);alter(h);await h.c.openFamilyMouseCompletion('100000');assert.equal(h.loads.length,0);assert.equal(h.calls.length,0);}
});
test('existing Ended and authorized archived primary records keep the ordinary exact-SID path',async()=>{
 for(const patch of [{state:'Ended',end_date:'2026-02-01'},{state:'Ended',app_archived_at:'2026-03-01T00:00:00Z'}]){const h=harness();Object.assign(h.c.dataset.tables.mice[0],patch);const before=JSON.stringify(h.c.dataset);await h.c.openFamilyMouseCompletion('100000');assert.deepEqual(h.calls,[['edit','mice','100000']]);assert.equal(JSON.stringify(h.c.dataset),before);}
 const h=harness();h.c.dataset.tables.mice[0].app_archived_at='2026-03-01T00:00:00Z';h.c.archiveRead=false;await h.c.openFamilyMouseCompletion('100000');assert.equal(h.loads.length,0);assert.equal(h.calls.length,0);
});
