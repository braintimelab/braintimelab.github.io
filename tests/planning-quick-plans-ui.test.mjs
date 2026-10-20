import test from 'node:test';import assert from 'node:assert/strict';
let serial=0;
async function harness({genotype='PER2::LUC; Bmal1(fl/+); FoxJ1-CreERT2(+/-); APP/PS1',canEdit=false}={}){
 const {renderBreedingPlanner}=await import(`../mouse-data/breeding-planner.js?quick-test=${++serial}`);let markup='',quickDetails=null;const container={get innerHTML(){return markup;},set innerHTML(value){markup=value;const details=value.match(/<details\b[^>]*data-planner-quick-plans([^>]*)>/);quickDetails=details?{open:/\bopen\b/.test(details[1])}:null;},querySelector(selector){return selector==='[data-planner-quick-plans]'?quickDetails:null;},querySelectorAll(){return[];}};const dataset={tables:{mice:[{mouse_sid:'PRIVATE123',sex:'Male',state:'Stock',genotype}],husbandry_events:[]}};let saves=0;const hooks={canEdit:()=>canEdit,isCurrent:()=>true,validate:()=>({errors:[]}),save:async()=>{saves++;}};renderBreedingPlanner(container,dataset,hooks);
 return {container,dataset,get saves(){return saves;},get quickDetails(){return quickDetails;},async click(action,meta={}){await container.onclick({target:{closest:()=>({disabled:false,dataset:{plannerAction:action,...meta}})}});},change(field,value,meta={}){container.onchange({target:{value,checked:Boolean(value),dataset:{plannerField:field,...meta}}});}};
}
test('Quick plans show three consistent stored founder-route tables before the editable target board',async()=>{
 const h=await harness();assert(h.container.innerHTML.indexOf('Quick plans')<h.container.innerHTML.indexOf('Target genotype'));for(const [id,label,probability]of [['pb','B&#39;P','25%'],['fpb','FB&#39;P','25%'],['adfpb','ADFB&#39;P','6.25%']]){assert.match(h.container.innerHTML,new RegExp(`data-preset="${id}"`));assert.match(h.container.innerHTML,new RegExp(label));assert.match(h.container.innerHTML,new RegExp(probability.replace('.','\\.')));}assert.match(h.container.innerHTML,/1 heterozygous/);assert.match(h.container.innerHTML,/Starting stocks: 1 copy/);assert.match(h.container.innerHTML,/Conditional probabilities are per conception/);assert.equal(h.saves,0);
});
test('every preset immediately loads a virtual route and remains editable without writing animals or plans',async()=>{
 const h=await harness(),before=structuredClone(h.dataset);for(const id of ['pb','fpb','adfpb']){await h.click('quick-plan',{preset:id});assert.match(h.container.innerHTML,/planner-strategy-results/);assert.match(h.container.innerHTML,/Virtual parent pairs/);assert.match(h.container.innerHTML,new RegExp(`data-preset="${id}"[^>]+aria-pressed="true"`));assert.match(h.container.innerHTML,/value="heterozygous" selected/);assert.doesNotMatch(h.container.innerHTML,/<option value="PRIVATE123" selected/);}
 h.change('design-copies','homozygous',{locus:'bmal1'});assert.match(h.container.innerHTML,/fl \/ fl/);assert.doesNotMatch(h.container.innerHTML,/planner-strategy-results/);await h.click('design');assert.match(h.container.innerHTML,/planner-strategy-results/);assert.deepEqual(h.dataset,before);assert.equal(h.saves,0);
});
test('quick-plan reset is explicit heterozygous default and existing manual calculation still works',async()=>{
 const h=await harness();await h.click('quick-plan',{preset:'fpb'});h.change('design-copies','homozygous',{locus:'bmal1'});await h.click('quick-plan',{preset:'fpb'});assert.match(h.container.innerHTML,/\+ \/ fl/);assert.doesNotMatch(h.container.innerHTML.match(/<section class="panel planner-target-board">[\s\S]*?<\/section>/)[0],/fl \/ fl/);await h.click('design');await h.click('use-ideal',{index:'0'});assert.match(h.container.innerHTML,/aria-selected="true"[^>]+data-tab="cross"/);await h.click('calculate');assert.match(h.container.innerHTML,/Target probability/);assert.doesNotMatch(h.container.innerHTML,/genotype evidence is unknown/);assert.equal(h.saves,0);
});
test('an active quick family toggles off, reopening manual target selection without changing colony data',async()=>{
 const h=await harness(),before=structuredClone(h.dataset);
 for(const preset of ['pb','fpb','adfpb']){
  await h.click('quick-plan',{preset});assert.match(h.container.innerHTML,new RegExp(`aria-label="Deselect [^"]+ quick plan" aria-pressed="true"`));
  await h.click('quick-plan',{preset});assert.doesNotMatch(h.container.innerHTML,/data-preset="[^"]+"[^>]+aria-pressed="true"/);assert.doesNotMatch(h.container.innerHTML,/planner-strategy-results/);assert.match(h.container.innerHTML,/data-planner-catalogue open/);
 }
 h.change('design-copies','homozygous',{locus:'bmal1'});assert.match(h.container.innerHTML,/fl \/ fl/);await h.click('design');assert.match(h.container.innerHTML,/planner-strategy-results/);assert.doesNotMatch(h.container.innerHTML,/data-preset="[^"]+"[^>]+aria-pressed="true"/);
 await h.click('quick-plan',{preset:'pb'});assert.match(h.container.innerHTML,/data-preset="pb"[^>]+aria-pressed="true"/);await h.click('quick-plan',{preset:'fpb'});assert.match(h.container.innerHTML,/data-preset="fpb"[^>]+aria-pressed="true"/);assert.doesNotMatch(h.container.innerHTML,/data-preset="pb"[^>]+aria-pressed="true"/);
 assert.deepEqual(h.dataset,before);assert.equal(h.saves,0);
});
test('missing strains disable only affected families and cannot be manufactured by an action',async()=>{
 const h=await harness({genotype:'PER2::LUC; Bmal1(fl/+)'}),before=structuredClone(h.dataset);assert.match(h.container.innerHTML,/data-preset="pb"[^>]*>/);assert.match(h.container.innerHTML,/data-preset="fpb"[^>]+disabled/);assert.match(h.container.innerHTML,/data-preset="adfpb"[^>]+disabled/);await h.click('quick-plan',{preset:'adfpb'});assert.match(h.container.innerHTML,/required strains are not available/);assert.doesNotMatch(h.container.innerHTML,/planner-strategy-results/);assert.deepEqual(h.dataset,before);assert.equal(h.saves,0);
});
test('Quick plans start collapsed and preserve disclosure state through selections, edits and tab changes',async()=>{
 const h=await harness(),before=structuredClone(h.dataset);
 assert.equal(h.quickDetails.open,false);
 assert.match(h.container.innerHTML,/<details class="panel planner-quick-plans" data-planner-quick-plans><summary>Quick plans/);
 h.quickDetails.open=true;
 await h.click('quick-plan',{preset:'pb'});
 assert.equal(h.quickDetails.open,true,'captures native state even before its queued toggle event');
 assert.match(h.container.innerHTML,/data-planner-quick-plans open>/);
 const stale=h.quickDetails;
 await h.click('quick-plan',{preset:'pb'});
 assert.equal(h.quickDetails.open,true,'deselection keeps Quick plans expanded');
 h.quickDetails.open=false;h.quickDetails.ontoggle({target:h.quickDetails});
 stale.open=true;stale.ontoggle({target:stale});
 await h.click('tab',{tab:'cross'});await h.click('tab',{tab:'design'});
 assert.equal(h.quickDetails.open,false,'detached toggle events do not reopen the disclosure');
 h.quickDetails.open=true;h.quickDetails.ontoggle({target:h.quickDetails});
 h.change('design-copies','homozygous',{locus:'bmal1'});
 assert.equal(h.quickDetails.open,true,'target editing preserves the open state');
 await h.click('tab',{tab:'cross'});await h.click('tab',{tab:'design'});
 assert.equal(h.quickDetails.open,true,'leaving and returning preserves the chosen state');
 assert.deepEqual(h.dataset,before);assert.equal(h.saves,0);
});
