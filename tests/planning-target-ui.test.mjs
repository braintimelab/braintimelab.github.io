import test from 'node:test';
import assert from 'node:assert/strict';
let serial=0;
const locus={id:'bmal1',name:'Bmal1-flox',kind:'flox',chromosome:'7',alleles:['+','fl']};
const mouse=(id,sex)=>({mouse_sid:id,sex,state:'Stock',physical_tag:`B-${sex==='Male'?'M':'F'}${id}`,genotype:'Bmal1(fl/+)',genetic_profile:{schema_version:1,loci:[locus],calls:{bmal1:{alleles:['+','fl'],evidence:'confirmed'}}}});
async function harness(extra={}){
 const {renderBreedingPlanner}=await import(`../mouse-data/breeding-planner.js?target-test=${++serial}`),container={innerHTML:'',querySelector(){return null;},querySelectorAll(){return [];}};
 let dataset={tables:{mice:[mouse('100','Male'),mouse('200','Female')],husbandry_events:[],...extra}},saves=0;
 const hooks={canEdit:()=>true,isCurrent:()=>true,validate:()=>({errors:[]}),save:async next=>{saves++;dataset=structuredClone(next);renderBreedingPlanner(container,dataset,hooks);}};
 renderBreedingPlanner(container,dataset,hooks);
 return {container,hooks,get dataset(){return dataset;},get saves(){return saves;},async click(action,meta={}){await container.onclick({target:{closest:()=>({disabled:false,dataset:{plannerAction:action,...meta}})}});},change(field,value,meta={}){container.onchange({target:{value,checked:Boolean(value),dataset:{plannerField:field,...meta}}});},input(field,value,meta={}){container.oninput({target:{value,dataset:{plannerField:field,...meta}}});}};
}
test('Planning opens on a target-first board and selecting a strain sets an explicit heterozygous target',async()=>{
 const h=await harness(),before=structuredClone(h.dataset);
 assert.match(h.container.innerHTML,/aria-selected="true"[^>]+data-tab="design"/);
 assert(h.container.innerHTML.indexOf('Target genotype')<h.container.innerHTML.indexOf('planner-strain-grid'));
 await h.click('catalogue-locus',{locus:'bmal1'});
 assert.match(h.container.innerHTML,/data-planner-field="design-copies"/);assert.match(h.container.innerHTML,/value="heterozygous" selected/);assert.match(h.container.innerHTML,/\+ \/ fl/);
 assert.match(h.container.innerHTML,/Design breeding route/);assert.doesNotMatch(h.container.innerHTML,/>Call status<select/);
 assert.deepEqual(h.dataset,before);assert.equal(h.saves,0);
});
test('target design calculates virtual parents with unknown colony calls and writes no scientific records',async()=>{
 const h=await harness(),before=structuredClone(h.dataset);await h.click('catalogue-locus',{locus:'bmal1'});await h.click('design');
 assert.match(h.container.innerHTML,/Virtual parent pairs/);assert.match(h.container.innerHTML,/Virtual sire/);assert.match(h.container.innerHTML,/Virtual dam/);assert.match(h.container.innerHTML,/conceptions, mean/);assert.match(h.container.innerHTML,/Modeled birth/);assert.match(h.container.innerHTML,/Born \/ weaned/);
 assert.doesNotMatch(h.container.innerHTML,/genotype evidence is unknown|100% survival/);assert.equal(h.saves,0);assert.deepEqual(h.dataset,before);
});
test('homozygous choice updates target and invalidates previous strategy without altering mice',async()=>{
 const h=await harness(),before=structuredClone(h.dataset);await h.click('catalogue-locus',{locus:'bmal1'});await h.click('design');assert.match(h.container.innerHTML,/planner-strategy-results/);
 h.change('design-copies','homozygous',{locus:'bmal1'});assert.match(h.container.innerHTML,/fl \/ fl/);assert.doesNotMatch(h.container.innerHTML,/planner-strategy-results/);await h.click('design');assert.match(h.container.innerHTML,/Breeding route/);assert.equal(h.saves,0);assert.deepEqual(h.dataset,before);
});
test('virtual suggested pair can be loaded into manual calculator without assigning an existing animal',async()=>{
 const h=await harness(),before=structuredClone(h.dataset);await h.click('catalogue-locus',{locus:'bmal1'});await h.click('design');await h.click('use-ideal',{index:'0'});
 assert.match(h.container.innerHTML,/aria-selected="true"[^>]+data-tab="cross"/);assert.match(h.container.innerHTML,/Virtual parent genotypes loaded/);assert.match(h.container.innerHTML,/planner-results/);assert.doesNotMatch(h.container.innerHTML,/<option value="100" selected|<option value="200" selected/);
 await h.click('calculate');assert.match(h.container.innerHTML,/Target probability/);assert.equal(h.saves,0);assert.deepEqual(h.dataset,before);
});
test('advanced targets remain explicit and must be changed deliberately before route design',async()=>{
 const h=await harness();await h.click('catalogue-locus',{locus:'bmal1'});await h.click('manual');h.change('target','carrier',{locus:'bmal1',key:'mode'});h.change('target','fl',{locus:'bmal1',key:'allele'});await h.click('tab',{tab:'design'});
 assert.match(h.container.innerHTML,/Advanced target/);assert.match(h.container.innerHTML,/Carries fl/);await h.click('design');assert.match(h.container.innerHTML,/Choose heterozygous or homozygous/);assert.equal(h.saves,0);
 h.change('design-copies','heterozygous',{locus:'bmal1'});await h.click('design');assert.match(h.container.innerHTML,/Virtual parent pairs/);
});
test('editing route assumptions invalidates estimates and repeated calculations never change membership or genotype profiles',async()=>{
 const h=await harness(),before=structuredClone(h.dataset);await h.click('catalogue-locus',{locus:'bmal1'});await h.click('design');h.change('founder-copies','2',{locus:'bmal1'});assert.doesNotMatch(h.container.innerHTML,/planner-strategy-results/);h.change('design-timing','28',{key:'gestationDays'});await h.click('design');assert.match(h.container.innerHTML,/Day 28/);assert.equal(h.saves,0);assert.deepEqual(h.dataset,before);
});
test('multi-strain design retains explicit independent assortment and shows multi-generation virtual lineage',async()=>{
 const vg={id:'vgat',name:'Vgat-flox',kind:'flox',chromosome:'unknown',alleles:['+','fl']},extra=mouse('300','Female');extra.genotype+='; Vgat(fl/+)';extra.genetic_profile.loci.push(vg);extra.genetic_profile.calls.vgat={alleles:['+','fl'],evidence:'inferred'};
 const h=await harness({mice:[mouse('100','Male'),extra]}),before=structuredClone(h.dataset);await h.click('catalogue-locus',{locus:'bmal1'});await h.click('catalogue-locus',{locus:'vgat'});await h.click('design');assert.match(h.container.innerHTML,/independent assortment|assort independently/i);assert.doesNotMatch(h.container.innerHTML,/Virtual parent pairs/);
 h.change('independent',true);h.change('design-copies','homozygous',{locus:'bmal1'});h.change('design-copies','homozygous',{locus:'vgat'});await h.click('design');assert.match(h.container.innerHTML,/Virtual parent pairs/);assert.match(h.container.innerHTML,/Virtual pedigree/);assert.match(h.container.innerHTML,/G2|F2|BC1/);assert.match(h.container.innerHTML,/<svg class="planner-lineage-svg"/);assert.match(h.container.innerHTML,/planner-lineage-edge is-sire/);assert.match(h.container.innerHTML,/planner-lineage-edge is-dam/);assert.match(h.container.innerHTML,/hypothetical genotype cohort/);assert.match(h.container.innerHTML,/Sire and dam selections are distinct animals/);assert.equal(h.saves,0);assert.deepEqual(h.dataset,before);
});
test('inferred actual animals remain excluded from confirmed candidate ranking',async()=>{
 const m=mouse('100','Male');m.genetic_profile.calls.bmal1.evidence='inferred';const h=await harness({mice:[m,mouse('200','Female')]});await h.click('catalogue-locus',{locus:'bmal1'});await h.click('tab',{tab:'candidates'});await h.click('rank');assert.match(h.container.innerHTML,/No eligible pairs/);assert.match(h.container.innerHTML,/confirmed|inferred calls are excluded/);assert.equal(h.saves,0);
});
const foxLocus={id:'foxj1-cre',name:'FoxJ1-CreERT2',kind:'cre',chromosome:'unknown',alleles:['+','Cre']};
const foxMouse=()=>({mouse_sid:'300',sex:'Male',state:'Stock',genotype:'FoxJ1-CreERT2(+/-)',genetic_profile:{schema_version:1,loci:[foxLocus],calls:{'foxj1-cre':{alleles:['+','Cre'],evidence:'confirmed'}}}});
test('exact FoxJ1 stock homozygous target retains conception probability but clearly warns against an adult route',async()=>{
 const h=await harness({mice:[foxMouse()]});await h.click('catalogue-locus',{locus:'foxj1-cre'});h.change('design-copies','homozygous',{locus:'foxj1-cre'});await h.click('design');assert.match(h.container.innerHTML,/postnatal|lethal|die/i);assert.match(h.container.innerHTML,/No viable adult route/);assert.match(h.container.innerHTML,/25%/);assert.match(h.container.innerHTML,/https:\/\/www.jax.org\/strain\/027012/);assert.equal(h.saves,0);
 h.change('founder-copies','2',{locus:'foxj1-cre'});await h.click('design');assert.match(h.container.innerHTML,/postnatal|lethal|die/i);assert.match(h.container.innerHTML,/founder|stock/i);assert.doesNotMatch(h.container.innerHTML,/planner-ideal-pair/);
});
test('editing a recognized locus definition removes old exact-stock guidance instead of imposing it on a custom allele',async()=>{
 const h=await harness({mice:[foxMouse()]});await h.click('catalogue-locus',{locus:'foxj1-cre'});await h.click('manual');h.change('locus','Custom driver',{locus:'foxj1-cre',key:'name'});h.change('locus','other',{locus:'foxj1-cre',key:'kind'});await h.click('tab',{tab:'design'});h.change('design-copies','homozygous',{locus:'foxj1-cre'});await h.click('design');assert.match(h.container.innerHTML,/Virtual parent pairs/);assert.doesNotMatch(h.container.innerHTML,/No viable adult route|027012|Foxj1.*postnatal/i);assert.equal(h.saves,0);
});

test('exact distinct-autosome references design a cross without an unknown-linkage assumption',async()=>{
 const h=await harness({mice:[mouse('100','Male'),foxMouse()]}),before=structuredClone(h.dataset);await h.click('catalogue-locus',{locus:'bmal1'});await h.click('catalogue-locus',{locus:'foxj1-cre'});h.change('design-copies','homozygous',{locus:'bmal1'});await h.click('design');assert.match(h.container.innerHTML,/Virtual parent pairs/);assert.match(h.container.innerHTML,/Virtual pedigree/);assert.match(h.container.innerHTML,/Day 98/);await h.click('use-ideal',{index:'0'});assert.match(h.container.innerHTML,/Target probability/);assert.doesNotMatch(h.container.innerHTML,/Confirm independent assortment|genotype evidence is unknown/);await h.click('calculate');assert.match(h.container.innerHTML,/Target probability/);assert.equal(h.saves,0);assert.deepEqual(h.dataset,before);
});
