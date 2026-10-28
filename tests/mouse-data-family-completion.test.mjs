import {loadMouseData,appSource} from './mouse-data-family-completion-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {isUntaggedCompletionRecord,isUntaggedCompletionMouse,untaggedMouseCompletion}=await loadMouseData('litter-registration.js');
const {renderFamilyExplorer}=await loadMouseData('family-explorer.js');
const {buildFamilyPedigree}=await loadMouseData('family-pedigree.js');
const {renderPedigreeSVG}=await loadMouseData('family-pedigree-view.js');
const mouse=(id,extra={})=>({mouse_sid:id,physical_tag:null,sex:'Unknown',state:'Stock',sire_sids:[],dam_sids:[],...extra});
const data=()=>({synthetic:true,tables:{mice:[mouse('100000',{canonical_sid:'03345',legacy_sids:['100000'],litter_sid:'L1',sire_sids:['P1']}),mouse('00002',{litter_sid:'L1',physical_tag:'  '}),mouse('00003',{litter_sid:'L1',physical_tag:'KEEP'}),mouse('00004',{litter_sid:'L2',sire_sids:['P1']})],litters:[{litter_sid:'L1',state:'Unweaned'},{litter_sid:'L2',state:'Unweaned'}],mouse_genes:[],husbandry_events:[]}});
test('completion resolves exact existing raw SID and only untagged saved litter members without mutation',()=>{
 const d=data(),before=JSON.stringify(d);assert.deepEqual(untaggedMouseCompletion(d,'100000'),{mouseSid:'100000',litterSid:'L1',siblingIds:['100000','00002'],reason:''});assert.equal(untaggedMouseCompletion(d,'03345').mouseSid,null);assert.equal(JSON.stringify(d),before);
});
test('missing litter, same-parent relatives, cage or DOB never create batch membership',()=>{
 const d=data();delete d.tables.mice[0].litter_sid;Object.assign(d.tables.mice[0],{cage_sid:'C1',date_of_birth:'2026-01-01'});Object.assign(d.tables.mice[3],{cage_sid:'C1',date_of_birth:'2026-01-01'});const plan=untaggedMouseCompletion(d,'100000');assert.equal(plan.mouseSid,'100000');assert.equal(plan.litterSid,null);assert.deepEqual(plan.siblingIds,[]);assert.match(plan.reason,/shared parents do not establish a litter/);
});
test('tagged, derived, historical and projected payloads cannot enter completion',()=>{
 for(const patch of [{physical_tag:'KEEP'},{physical_tag:0},{_derived:true},{history_read_only:true},{source_historical:true},{member_projection:true},{guest_projection:true},{record_origin:'historical_snapshot_projection'}]){const d=data();Object.assign(d.tables.mice[0],patch);assert.equal(isUntaggedCompletionMouse(d.tables.mice[0]),false);assert.equal(untaggedMouseCompletion(d,'100000').mouseSid,null);}
 const d=data();d.history_projection={read_only:true};assert.equal(untaggedMouseCompletion(d,'100000').mouseSid,null);
});
test('unavailable/ambiguous litter or mouse identity leaves ordinary individual completion only',()=>{
 for(const patch of [{archived:true},{history_read_only:true},{source_historical:true},{member_projection:true},{mating_sid:'missing'}]){const d=data();Object.assign(d.tables.litters[0],patch);assert.equal(untaggedMouseCompletion(d,'100000').mouseSid,'100000');assert.equal(untaggedMouseCompletion(d,'100000').litterSid,null);}
 const d=data();d.tables.litters.push({...d.tables.litters[0]});assert.equal(untaggedMouseCompletion(d,'100000').litterSid,null);d.tables.mice.push({...d.tables.mice[0]});assert.equal(untaggedMouseCompletion(d,'100000').mouseSid,null);
});
function harness(d=data(),extra={}){
 let focus='100000',allowed=true;const calls=[],container={innerHTML:'',querySelector:()=>null};
 const hooks={getFocus:()=>focus,setFocus:id=>{focus=String(id);calls.push(['focus',id]);},canCompleteMouse:()=>allowed,canCompleteArchived:()=>true,completeMouse:id=>calls.push(['complete',id]),completeSiblings:id=>calls.push(['siblings',id]),...extra};const dispose=renderFamilyExplorer(container,d,hooks);
 return{container,calls,dispose,deny(){allowed=false;},click(action,id='100000'){container.onclick({target:{closest:()=>({dataset:{familyAction:action,id},disabled:false})}});},key(action,id='100000'){let count=0;container.onkeydown({key:'Enter',defaultPrevented:false,preventDefault(){count++;},target:{closest:()=>({dataset:{familyAction:action,id},tagName:'text',disabled:false})}});return count;}};
}
test('untagged labels and explicit actions open completion; independent Show family still refocuses',()=>{
 const d=data(),before=JSON.stringify(d),h=harness(d);assert.match(h.container.innerHTML,/data-family-action="complete-mouse" data-id="100000"[^>]*>Untagged mouse/);assert.match(h.container.innerHTML,/Complete mouse details/);assert.match(h.container.innerHTML,/Complete untagged siblings/);assert.match(h.container.innerHTML,/2 untagged existing mice in recorded litter L1/);assert.match(h.container.innerHTML,/Show family/);
 h.click('complete-mouse');assert.deepEqual(h.calls.at(-1),['complete','100000']);h.click('complete-siblings');assert.deepEqual(h.calls.at(-1),['siblings','100000']);h.click('focus','00002');assert.deepEqual(h.calls.at(-1),['focus','00002']);assert.equal(JSON.stringify(d),before);h.dispose();
});
test('no litter explanation retains individual action, no siblings action or invented relation',()=>{
 const d=data();delete d.tables.mice[0].litter_sid;const h=harness(d);assert.match(h.container.innerHTML,/Complete mouse details/);assert.doesNotMatch(h.container.innerHTML,/data-family-action="complete-siblings"/);assert.match(h.container.innerHTML,/No recorded litter is available/);h.click('complete-siblings');assert.equal(h.calls.length,0);h.dispose();
});
test('sidecar-only, unavailable, tagged and live permission loss cannot dispatch completion',()=>{
 const d=data(),shadow=[...d.tables.mice,mouse('shadow',{sire_sids:['missing']})],h=harness(d,{pedigreeMice:shadow});
 h.click('complete-mouse','shadow');h.click('complete-mouse','missing');h.click('complete-mouse','00003');assert.equal(h.calls.length,0);h.deny();h.click('complete-mouse');assert.equal(h.calls.length,0);h.dispose();
});
test('eligible SVG label has its own keyboard action and SID refocus, with no nested button role',()=>{
 const m=mouse('1'),graph=buildFamilyPedigree('1',{getMouse:()=>m,getParents:()=>[],getChildren:()=>[]});
 const html=renderPedigreeSVG(graph,{presentationFor:()=>({tag:'Untagged mouse',sid:'00001',completeMouse:true})});assert.match(html,/<g class="pedigree-node is-focus" role="group" data-family-action="focus"/);assert.match(html,/class="pedigree-node-tag" role="button" tabindex="0" data-family-action="complete-mouse" data-id="1"/);assert.match(html,/class="pedigree-node-id" role="button" tabindex="0" data-family-action="focus"/);
 const h=harness();assert.equal(h.key('complete-mouse'),1);assert.deepEqual(h.calls,[['complete','100000']]);h.dispose();
});
test('hostile identifiers/labels are escaped and disposal blocks stale action handlers',()=>{
 const d=data();d.tables.litters[0].litter_sid='<unsafe>';d.tables.mice[0].litter_sid='<unsafe>';const h=harness(d);assert.match(h.container.innerHTML,/&lt;unsafe&gt;/);assert.doesNotMatch(h.container.innerHTML,/<unsafe>/);const old=h.container.onclick;h.dispose();old({target:{closest:()=>({dataset:{familyAction:'complete-mouse',id:'100000'}})}});assert.equal(h.calls.length,0);
});
test('current Ended lifecycle remains individually and recorded-litter batch editable; archive stays individual-only',()=>{
 const d=data(),row=d.tables.mice[0];Object.assign(row,{state:'Ended',end_date:'2026-02-01'});d.tables.litters[0].state='Ended';const before=JSON.stringify(d);
 assert.equal(isUntaggedCompletionRecord(row),true);assert.equal(isUntaggedCompletionMouse(row),true);assert.deepEqual(untaggedMouseCompletion(d,'100000').siblingIds,['100000','00002']);assert.equal(JSON.stringify(d),before);
 row.app_archived_at='2026-03-01T00:00:00Z';assert.equal(isUntaggedCompletionRecord(row),true);assert.equal(isUntaggedCompletionMouse(row),false);const plan=untaggedMouseCompletion(d,'100000');assert.equal(plan.mouseSid,'100000');assert.equal(plan.litterSid,null);assert.match(plan.reason,/archived mouse.*individually/);
});
test('visible untagged sidecar labels offer an authorized full-load action with separate focus',()=>{
 const d=data(),shadow=Object.freeze(mouse('shadow',{state:'Ended'})),calls=[],h=harness(d,{pedigreeMice:[...d.tables.mice,shadow],canLoadMouse:()=>true,loadMouse:id=>calls.push(['load',id])});h.click('focus','shadow');assert.match(h.container.innerHTML,/Load full record to complete/);assert.match(h.container.innerHTML,/data-family-action="load-mouse" data-id="shadow"/);h.click('load-mouse','shadow');assert.deepEqual(calls,[['load','shadow']]);assert.equal(d.tables.mice.some(row=>row.mouse_sid==='shadow'),false);assert.equal(shadow.state,'Ended');h.dispose();
});
test('a full Ended untagged label opens ordinary completion and retains lifecycle in presentation',()=>{
 const d=data();d.tables.mice[0].state='Ended';d.tables.mice[0].end_date='2026-02-01';const h=harness(d);assert.match(h.container.innerHTML,/Complete mouse details/);assert.match(h.container.innerHTML,/Ended/);h.click('complete-mouse');assert.deepEqual(h.calls.at(-1),['complete','100000']);assert.equal(d.tables.mice[0].state,'Ended');h.dispose();
});
test('archive read permission still gates archived individual and shadow affordances',()=>{
 const d=data();d.tables.mice[0].app_archived_at='2026-02-01T00:00:00Z';const calls=[],h=harness(d,{canCompleteArchived:()=>false,pedigreeMice:[...d.tables.mice,mouse('shadow',{archived:true})],canLoadMouse:()=>true,loadMouse:id=>calls.push(id)});h.click('complete-mouse');h.click('load-mouse','shadow');assert.equal(h.calls.length,0);assert.deepEqual(calls,[]);h.dispose();
});
