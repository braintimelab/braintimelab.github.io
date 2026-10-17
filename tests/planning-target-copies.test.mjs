import test from 'node:test';
import assert from 'node:assert/strict';

let instance=0;
const bmal={id:'bmal1',name:'Bmal1-flox',kind:'flox',chromosome:'unknown',alleles:['+','fl']};
const vgat={...bmal,id:'vgat',name:'Vgat-flox'};
const call=()=>({alleles:['+','fl'],evidence:'confirmed'});
const mouse=(id,sex,genotype='Bmal1(fl/+); Vgat(fl/+)')=>({mouse_sid:id,sex,state:'Stock',genotype,genetic_profile:{schema_version:1,loci:[bmal,vgat],calls:{bmal1:call(),vgat:call()}}});
const saved={event_id:'PLAN',event_type:'breeding_plan',event_date:'2026-01-01',breeding_plan:{schema_version:1,name:'Confirmed parent snapshot',scenario:{loci:[bmal,vgat],sire:{id:'100',sex:'Male',calls:{bmal1:call(),vgat:call()}},dam:{id:'200',sex:'Female',calls:{bmal1:call(),vgat:call()}},targets:{bmal1:{mode:'carrier',allele:'fl'},vgat:{mode:'carrier',allele:'fl'}},sex:'Any',independentAssortment:true,desiredCount:1,confidence:0.95,litterSize:6}}};

async function harness(tables={}){
  const {renderBreedingPlanner}=await import(`../mouse-data/breeding-planner.js?target-copies=${++instance}`);
  const container={innerHTML:'',querySelector(){return null;},querySelectorAll(){return [];}};
  const dataset={tables:{mice:[mouse('100','Male'),mouse('200','Female')],husbandry_events:[saved],...tables}};
  let saves=0;
  renderBreedingPlanner(container,dataset,{canEdit:()=>true,isCurrent:()=>true,validate:()=>({errors:[]}),save:async()=>{saves++;}});
  return {container,dataset,get saves(){return saves;},async click(action,meta={}){await container.onclick({target:{closest:()=>({disabled:false,dataset:{plannerAction:action,...meta}})}});},async toggle(locus,copy,allele){await this.click('target-copy',{locus,copy:String(copy),...(allele?{allele}:{})});},change(field,value,meta={}){container.onchange({target:{value,checked:Boolean(value),dataset:{plannerField:field,...meta}}});}};
}
const cards=html=>[...html.matchAll(/<article class="planner-strain-card[\s\S]*?<\/article>/g)].map(match=>match[0]);
function states(h,name){const card=cards(h.container.innerHTML).find(card=>card.includes(`<strong>${name}</strong>`));assert.ok(card,`${name} card is present`);const buttons=[...card.matchAll(/<button[^>]*data-planner-action="target-copy"[^>]*>[12]<\/button>/g)].map(match=>match[0]);assert.equal(buttons.length,2);return buttons.map(button=>button.includes('aria-pressed="true"'));}
function selected(h,label){const select=h.container.innerHTML.match(new RegExp(`<select[^>]* aria-label="${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"[^>]*>([\\s\\S]*?)<\\/select>`));assert.ok(select,`${label} select is present`);return select[1].match(/<option value="([^"]*)" selected/)?.[1];}
function assertUnchanged(h,before){assert.deepEqual(h.dataset,before);assert.equal(h.saves,0);}

test('either allele slot can start a heterozygous target and the last active slot removes the locus',async()=>{
  for(const tab of ['design','cross'])for(const first of [0,1]){
    const h=await harness(),before=structuredClone(h.dataset);await h.click('tab',{tab});
    assert.deepEqual(states(h,'Bmal1-flox'),[false,false]);
    await h.toggle('bmal1',first);assert.deepEqual(states(h,'Bmal1-flox'),first===0?[true,false]:[false,true]);
    await h.toggle('bmal1',1-first);assert.deepEqual(states(h,'Bmal1-flox'),[true,true]);
    await h.toggle('bmal1',first);assert.deepEqual(states(h,'Bmal1-flox'),first===0?[false,true]:[true,false]);
    await h.toggle('bmal1',1-first);assert.deepEqual(states(h,'Bmal1-flox'),[false,false]);
    assert.doesNotMatch(h.container.innerHTML,/data-planner-field="(?:design-copies|target)" data-locus="bmal1"/);
    assertUnchanged(h,before);
  }
});

test('different loci can independently target homozygous and heterozygous offspring in one design',async()=>{
  const h=await harness(),before=structuredClone(h.dataset);
  await h.toggle('bmal1',0);await h.toggle('bmal1',1);await h.toggle('vgat',1);
  assert.deepEqual(states(h,'Bmal1-flox'),[true,true]);assert.deepEqual(states(h,'Vgat-flox'),[false,true]);
  assert.match(h.container.innerHTML,/fl \/ fl/);assert.match(h.container.innerHTML,/\+ \/ fl/);
  await h.click('manual');
  assert.equal(selected(h,'Bmal1-flox target allele 1'),'fl');assert.equal(selected(h,'Bmal1-flox target allele 2'),'fl');
  assert.equal(selected(h,'Vgat-flox target allele 1'),'+');assert.equal(selected(h,'Vgat-flox target allele 2'),'fl');
  assertUnchanged(h,before);
});

test('manual target toggles preserve selected parents and confirmed calls and invalidate stale predictions',async()=>{
  const h=await harness(),before=structuredClone(h.dataset);await h.click('load-plan',{id:'PLAN'});assert.match(h.container.innerHTML,/planner-results/);
  await h.toggle('bmal1',0);await h.toggle('bmal1',1);await h.toggle('vgat',0);
  assert.doesNotMatch(h.container.innerHTML,/planner-results|Recalculated from saved/);
  assert.match(h.container.innerHTML,/<option value="100" selected/);assert.match(h.container.innerHTML,/<option value="200" selected/);
  for(const name of ['Bmal1-flox','Vgat-flox'])for(const role of ['Sire','Dam']){
    assert.equal(selected(h,`${name}, ${role}, allele 1`),'+');assert.equal(selected(h,`${name}, ${role}, allele 2`),'fl');
    assert.equal(selected(h,`${name}, ${role}, call status`),'confirmed');
  }
  await h.click('calculate');assert.match(h.container.innerHTML,/Target probability<\/span><strong>12\.5%/);
  assertUnchanged(h,before);
});

test('Ai32 and Ai96 share two exact target slots and same-slot replacement never creates a third allele',async()=>{
  const h=await harness({mice:[mouse('100','Male','Ai32(+/-)'),mouse('200','Female','Ai96(+/-)')],husbandry_events:[]}),before=structuredClone(h.dataset);
  await h.click('manual');await h.toggle('rosa26',0,'Ai32');await h.toggle('rosa26',1,'Ai96');
  assert.deepEqual(states(h,'Ai32'),[true,false]);assert.deepEqual(states(h,'Ai96'),[false,true]);
  assert.equal(selected(h,'Gt(ROSA)26Sor target allele 1'),'Ai32');assert.equal(selected(h,'Gt(ROSA)26Sor target allele 2'),'Ai96');
  assert.equal((h.container.innerHTML.match(/<h3>Locus \d+<\/h3>/g)||[]).length,1);
  await h.toggle('rosa26',0,'Ai96');
  assert.deepEqual(states(h,'Ai32'),[false,false]);assert.deepEqual(states(h,'Ai96'),[true,true]);
  assert.equal(selected(h,'Gt(ROSA)26Sor target allele 1'),'Ai96');assert.equal(selected(h,'Gt(ROSA)26Sor target allele 2'),'Ai96');
  await h.toggle('rosa26',1,'Ai96');assert.deepEqual(states(h,'Ai96'),[true,false]);
  assert.equal((h.container.innerHTML.match(/<h3>Locus \d+<\/h3>/g)||[]).length,1);
  await h.toggle('rosa26',0,'Ai96');assert.deepEqual(states(h,'Ai96'),[false,false]);
  assert.doesNotMatch(h.container.innerHTML,/<h3>Locus \d+<\/h3>/);assertUnchanged(h,before);
});

test('target controls reject undeclared variants and retain saved-locus naming review before calculation',async()=>{
  const h=await harness(),before=structuredClone(h.dataset);await h.toggle('bmal1',0,'UNDECLARED');
  assert.deepEqual(states(h,'Bmal1-flox'),[false,false]);assert.doesNotMatch(h.container.innerHTML,/planner-target-row/);
  await h.toggle('bmal1',0);await h.click('manual');h.change('locus','Vgat-Cre',{locus:'bmal1',key:'name'});h.change('locus','cre',{locus:'bmal1',key:'kind'});
  await h.toggle('bmal1',1);await h.click('calculate');
  assert.match(h.container.innerHTML,/Saved Vgat Cre model needs review/);assert.doesNotMatch(h.container.innerHTML,/Target probability/);
  assertUnchanged(h,before);
});
