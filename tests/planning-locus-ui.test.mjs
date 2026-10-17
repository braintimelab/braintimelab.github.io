import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateRecord} from '../mouse-data/model.js';

let instance=0;
const locus=(id,name,alleles=['+','fl'],kind='flox',chromosome='unknown')=>({id,name,alleles,kind,chromosome});
const bmal=locus('bmal1','Bmal1-flox'),vgat=locus('vgat','Vgat-flox');
const call=(alleles=['+','fl'],evidence='confirmed')=>({alleles,evidence});
const mouse=(id,sex,extra={})=>({mouse_sid:id,sex,state:'Stock',genotype:'Bmal1(fl/+); Vgat(fl/+)',physical_tag:`Tag-${id}`,date_of_birth:'2025-01-01',genetic_profile:{schema_version:1,loci:[bmal,vgat],calls:{bmal1:call(),vgat:call()},notes:'Assay record'},...extra});
const scenario=()=>({loci:[bmal,vgat],sire:{id:'100',sex:'Male',calls:{bmal1:call(),vgat:call()}},dam:{id:'200',sex:'Female',calls:{bmal1:call(),vgat:call()}},targets:{bmal1:{mode:'carrier',allele:'fl'},vgat:{mode:'carrier',allele:'fl'}},sex:'Any',independentAssortment:true,desiredCount:1,confidence:0.95,litterSize:6});
const plan=()=>({event_id:'PLAN-SAVED',event_type:'breeding_plan',event_date:'2026-01-01',breeding_plan:{schema_version:1,name:'Recorded cross',scenario:scenario()}});

async function harness(tables={},overrides={}){
  const {renderBreedingPlanner}=await import(`../mouse-data/breeding-planner.js?test=${++instance}`);
  const container={innerHTML:'',querySelector(){return null},querySelectorAll(){return []}};
  let dataset={tables:{mice:[mouse('100','Male'),mouse('200','Female')],husbandry_events:[plan()],...tables}};
  const saves=[];
  const hooks={canEdit:()=>true,isCloud:()=>false,validate:validateRecord,save:async next=>{dataset=structuredClone(next);saves.push(dataset);renderBreedingPlanner(container,dataset,hooks)},...overrides};
  renderBreedingPlanner(container,dataset,hooks);
  await container.onclick({target:{closest:()=>({disabled:false,dataset:{plannerAction:'tab',tab:'cross'}})}});
  return {container,saves,hooks,get dataset(){return dataset},
    async click(action,meta={}){await container.onclick({target:{closest:()=>({disabled:false,dataset:{plannerAction:action,...meta}})}})},
    change(field,value,meta={}){container.onchange({target:{value,checked:Boolean(value),dataset:{plannerField:field,...meta}}})},
    input(field,value,meta={}){container.oninput({target:{value,dataset:{plannerField:field,...meta}}})},
    render(next=dataset){dataset=next;renderBreedingPlanner(container,dataset,hooks)},
  };
}
const cards=html=>[...html.matchAll(/<article class="planner-strain-card[\s\S]*?<\/article>/g)].map(match=>match[0]);

test('Target designer and Manual cross show two target allele toggles below each compact strain card',async()=>{
  const h=await harness(),before=structuredClone(h.dataset);
  for(const tab of ['design','cross']){
    await h.click('tab',{tab});
    assert.match(h.container.innerHTML,/planner-strain-grid/);
    assert.ok(cards(h.container.innerHTML).length>=2);
    for(const card of cards(h.container.innerHTML)){
      const buttons=[...card.matchAll(/<button[^>]+data-planner-action="target-copy"[^>]*>[12]<\/button>/g)];
      assert.equal(buttons.length,2);
      assert.ok(card.indexOf('planner-strain-summary')<card.indexOf('data-planner-action="target-copy"'));
    }
    assert.doesNotMatch(h.container.innerHTML,/>Add locus<|>Already added<|data-planner-action="catalogue-locus"/);
  }
  assert.doesNotMatch(h.container.innerHTML,/>Evidence<|source mentions|Strain \/ source labels|planner-source-evidence/);
  await h.click('target-copy',{locus:'bmal1',copy:'0'});
  assert.match(h.container.innerHTML,/>Call status<select/);
  const bmalCard=cards(h.container.innerHTML).find(card=>card.includes('<strong>Bmal1-flox</strong>'));
  assert.match(bmalCard,/aria-label="Bmal1-flox target allele 1"/);
  assert.match(bmalCard,/aria-label="Bmal1-flox target allele 2"/);
  assert.equal((bmalCard.match(/aria-pressed="true"/g)||[]).length,1);
  assert.deepEqual(h.dataset,before);assert.equal(h.saves.length,0);
});

test('Already added removes the locus, both parent calls, target, loaded plan and stale result before save',async()=>{
  const h=await harness(),originalMice=structuredClone(h.dataset.tables.mice);
  await h.click('load-plan',{id:'PLAN-SAVED'});assert.match(h.container.innerHTML,/planner-results/);
  await h.click('catalogue-locus',{locus:'bmal1'});
  assert.doesNotMatch(h.container.innerHTML,/planner-results|Recalculated from saved/);
  assert.equal((h.container.innerHTML.match(/<h3>Locus \d+<\/h3>/g)||[]).length,1);
  const bmalCard=cards(h.container.innerHTML).find(card=>card.includes('<strong>Bmal1-flox</strong>'));
  assert.equal((bmalCard.match(/aria-pressed="false"/g)||[]).length,2);
  h.input('plan-name','Remaining Vgat cross');await h.click('save-plan');
  assert.equal(h.saves.length,1);
  const saved=h.dataset.tables.husbandry_events.at(-1).breeding_plan.scenario;
  assert.deepEqual(saved.loci,[vgat]);assert.equal(saved.targets.bmal1,undefined);
  for(const role of ['sire','dam']){assert.equal(saved[role].calls.bmal1,undefined);assert.equal(saved[role].calls.vgat.evidence,'confirmed');}
  assert.deepEqual(h.dataset.tables.mice,originalMice);
});

test('toggle removal and explicit Remove both invalidate calculations, and re-adding starts unknown',async()=>{
  for(const action of ['catalogue-locus','remove-locus']){
    const h=await harness();await h.click('load-plan',{id:'PLAN-SAVED'});
    await h.click(action,{locus:'bmal1'});await h.click('catalogue-locus',{locus:'bmal1'});
    await h.click('calculate');assert.match(h.container.innerHTML,/Sire, Bmal1-flox: genotype evidence is unknown/);
    assert.match(h.container.innerHTML,/Dam, Bmal1-flox: genotype evidence is unknown/);
    assert.doesNotMatch(h.container.innerHTML,/Target probability/);assert.equal(h.saves.length,0);
  }
});

test('six-locus limit disables new target alleles while existing target toggles remain usable',async()=>{
  const names=['AssayA','AssayB','AssayC','AssayD','AssayE','AssayF','AssayG'];
  const h=await harness({mice:[mouse('100','Male',{genotype:names.map(name=>`${name}(+/-)`).join(';'),genetic_profile:null})]});
  for(const name of names.slice(0,6))await h.click('target-copy',{locus:`locus:${name}`,copy:'0'});
  const beforeCards=cards(h.container.innerHTML);
  assert.equal((beforeCards.find(card=>card.includes('<strong>AssayG</strong>')).match(/ disabled>[12]<\/button>/g)||[]).length,2);
  assert.doesNotMatch(beforeCards.find(card=>card.includes('<strong>AssayA</strong>')),/ disabled/);
  await h.click('target-copy',{locus:'locus:AssayG',copy:'0'});
  assert.match(h.container.innerHTML,/at most six loci/);
  await h.click('target-copy',{locus:'locus:AssayA',copy:'0'});
  assert.equal((h.container.innerHTML.match(/<h3>Locus \d+<\/h3>/g)||[]).length,5);
  assert.doesNotMatch(cards(h.container.innerHTML).find(card=>card.includes('<strong>AssayG</strong>')),/ disabled/);
});

test('Ai32 and Ai96 remain separate choices at one physical Rosa26 locus and can be cancelled',async()=>{
  const h=await harness({mice:[mouse('100','Male',{genotype:'Ai32(+/-)',genetic_profile:null}),mouse('200','Female',{genotype:'Ai96(+/-)',genetic_profile:null})],husbandry_events:[]});
  for(const name of ['Ai32','Ai96'])assert.match(h.container.innerHTML,new RegExp(`<strong>${name}<\\/strong>`));
  await h.click('target-copy',{locus:'rosa26',allele:'Ai32',copy:'0'});
  await h.click('target-copy',{locus:'rosa26',allele:'Ai96',copy:'1'});
  assert.equal((h.container.innerHTML.match(/<h3>Locus \d+<\/h3>/g)||[]).length,1);
  for(const name of ['Ai32','Ai96'])assert.equal((cards(h.container.innerHTML).find(card=>card.includes(`<strong>${name}</strong>`)).match(/aria-pressed="true"/g)||[]).length,1);
  await h.click('target-copy',{locus:'rosa26',allele:'Ai96',copy:'1'});
  assert.equal((h.container.innerHTML.match(/<h3>Locus \d+<\/h3>/g)||[]).length,1);
  assert.equal((cards(h.container.innerHTML).find(card=>card.includes('<strong>Ai32</strong>')).match(/aria-pressed="true"/g)||[]).length,1);
  await h.click('target-copy',{locus:'rosa26',allele:'Ai32',copy:'0'});
  assert.doesNotMatch(h.container.innerHTML,/<h3>Locus \d+<\/h3>/);assert.equal(h.saves.length,0);
});

test('Genotypes retains locus configuration controls without target allele toggles',async()=>{
  const h=await harness();await h.click('tab',{tab:'genotypes'});
  for(const card of cards(h.container.innerHTML))assert.match(card,/<div class="planner-strain-summary">[\s\S]*?<\/div><button[^>]+data-planner-action="catalogue-locus"/);
  assert.doesNotMatch(h.container.innerHTML,/data-planner-action="target-copy"/);
  await h.click('catalogue-locus',{locus:'bmal1'});
  assert.match(cards(h.container.innerHTML).find(card=>card.includes('<strong>Bmal1-flox</strong>')),/aria-pressed="true">Already added<\/button>/);
  await h.click('catalogue-locus',{locus:'bmal1'});
  assert.match(cards(h.container.innerHTML).find(card=>card.includes('<strong>Bmal1-flox</strong>')),/aria-pressed="false">Add locus<\/button>/);
  assert.equal(h.saves.length,0);
});

test('source suggestions stay inferred and genotype saving preserves source provenance',async()=>{
  const original=mouse('100','Male',{genetic_profile:null,source_filename:'Animal sheet.xlsx',source_row:7});
  const h=await harness({mice:[original,mouse('200','Female')],historical_observations:[{observation_id:'OBS1',raw_text:'M100 cage comment',source_title:'Animal sheet',source_sheet:'Ani Beh',source_cell:'A1'}]});
  await h.click('catalogue-locus',{locus:'bmal1'});h.change('parent','100',{role:'sire'});
  assert.doesNotMatch(h.container.innerHTML,/Linked Animal Sheet excerpts|planner-source-evidence/);
  await h.click('source-parent',{role:'sire'});assert.match(h.container.innerHTML,/loaded as inferred/);
  await h.click('calculate');assert.match(h.container.innerHTML,/Dam, Bmal1-flox: genotype evidence is unknown/);
  await h.click('tab',{tab:'genotypes'});h.change('profile-mouse','100');await h.click('source-profile');
  assert.match(h.container.innerHTML,/>Call status<select/);assert.match(h.container.innerHTML,/>Genotype notes<\/label>/);
  await h.click('save-profile');assert.equal(h.saves.length,1);
  const saved=h.dataset.tables.mice[0];assert.equal(saved.genetic_profile.calls.bmal1.evidence,'inferred');assert.equal(saved.genotype,original.genotype);
  assert.equal(saved.source_filename,original.source_filename);assert.equal(saved.source_row,7);
});

test('deferred history loads only on request, blocks edits while loading and ignores a departed view',async()=>{
  let finish,loads=0,current=true;
  const h=await harness({mice:[],husbandry_events:[]},{historyDeferred:true,isCurrent:()=>current,loadSourceHistory:()=>{loads++;return new Promise(resolve=>finish=resolve)}});
  assert.equal(loads,0);assert.match(h.container.innerHTML,/Load source history/);
  const pending=h.click('load-source-history');assert.equal(loads,1);
  assert.match(h.container.innerHTML,/Loading history…/);await h.click('add-locus');
  current=false;finish({tables:{mice:[mouse('100','Male')]}});await pending;
  assert.equal(h.saves.length,0);assert.equal(h.dataset.tables.mice.length,0);
});

test('compact strain layout is responsive and scoped without changing shared app controls',async()=>{
  const css=await readFile(new URL('../mouse-data/planner-layout.css',import.meta.url),'utf8');
  assert.match(css,/\.breeding-planner \.planner-strain-grid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(160px,1fr\)\)/);
  assert.match(css,/@media\(max-width:520px\)/);assert.match(css,/\.planner-strain-card>\.button\{margin-top:auto/);
  assert.doesNotMatch(css,/(?:^|\})\s*(?:button|\.button|\.panel)\s*\{/);
});
