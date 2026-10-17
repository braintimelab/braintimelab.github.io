import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalStrainName,strainNameAliases,FOXJ1_STRAIN_NAME,FOXJ1_STRAIN_ALIASES} from '../mouse-data/strain-registry.js';
import {discoverGenotypes,sourceProfile} from '../mouse-data/genotype-catalog.js';
import {familyTargetDraft} from '../mouse-data/family-targets.js';
import {buildFamilyGenotypes} from '../mouse-data/family-genotypes.js';
import {mouseLineAssignments,summarizeMice} from '../mouse-data/mouse-summary.js';
import {isMouseGenotyped} from '../mouse-data/breeding-summary.js';
import {inferMouseTag} from '../mouse-data/mouse-registration.js';
import {renderBreedingPlanner} from '../mouse-data/breeding-planner.js';
import {validateRecord} from '../mouse-data/model.js';

const id='foxj1-cre',oldName='FoxJ1-Cre',oldLocus={id,name:oldName,kind:'cre',chromosome:'unknown',alleles:['+',oldName]};
const animal=(sid,sex,extra={})=>({mouse_sid:sid,sex,state:'Stock',physical_tag:'F-'+sex[0]+sid,genotype:oldName+'(+/-)',genetic_profile:{schema_version:1,loci:[oldLocus],calls:{[id]:{alleles:[oldName,'+'],evidence:'confirmed'}}},...extra});

test('JAX F display aliases resolve to the inducible strain while keeping unrelated Foxj variants distinct',()=>{
 assert.equal(FOXJ1_STRAIN_NAME,'FoxJ1-CreERT2');
 for(const name of FOXJ1_STRAIN_ALIASES){assert.equal(canonicalStrainName(name),FOXJ1_STRAIN_NAME);assert.ok(strainNameAliases(name).includes('FoxJ1-ERT-Cre'));}
 assert.equal(canonicalStrainName('FoxJ1-ERT-CRE'),FOXJ1_STRAIN_NAME);
 for(const other of ['FoxJ1-CreERT3','FoxJ1-CreER','FoxJ2-Cre','FoxJ1-CreERT2B'])assert.equal(canonicalStrainName(other),other);
});

test('new and legacy F labels discover one stable locus and retain the established allele token',()=>{
 const data={tables:{mice:FOXJ1_STRAIN_ALIASES.map((name,i)=>animal(String(i),'Male',{genotype:name+'(+/-)',genetic_profile:null}))}};
 const before=structuredClone(data),catalogue=discoverGenotypes(data);
 assert.equal(catalogue.length,1);assert.equal(catalogue[0].id,id);assert.equal(catalogue[0].name,FOXJ1_STRAIN_NAME);assert.equal(catalogue[0].kind,'cre');assert.deepEqual(catalogue[0].alleles,['+',oldName]);
 for(const mouse of data.tables.mice){const value=sourceProfile(mouse,catalogue,data);assert.deepEqual(value.calls[id],{alleles:[oldName,'+'],evidence:'inferred'});}
 assert.deepEqual(data,before);
});

test('unknown F calls remain unknown while combined tags and descriptive classifications retain F',()=>{
 for(const name of FOXJ1_STRAIN_ALIASES){
  const mouse=animal('10000','Male',{genotype:name+' (undetermined)',physical_tag:'FB-M0034',genetic_profile:null}),data={tables:{mice:[mouse]}};
  const catalogue=discoverGenotypes(data);assert.equal(catalogue.length,1);assert.equal(sourceProfile(mouse,catalogue,data).calls[id],undefined);assert.equal(isMouseGenotyped(mouse),false);
  assert.ok(Object.hasOwn(mouseLineAssignments(mouse),'F'));assert.equal(summarizeMice(data).totalLines.F,1);
 }
 const inferred=inferMouseTag('FB-M0034');assert.equal(inferred.sex,'Male');assert.equal(inferred.tagNumber,'0034');assert.match(inferred.genotype,/FoxJ1-CreERT2/);assert.equal(inferred.prefix,'FB');
});

test('exact and legacy F labels agree in current counts, genotyping and family target resolution',()=>{
 const data={tables:{mice:[animal('10000','Male'),animal('20000','Female',{genotype:'FoxJ1-ERT-CRE(+/-)'}),animal('30000','Female',{genotype:'FoxJ1-CreERT2(+/-)',genetic_profile:null})]}};
 const before=structuredClone(data);assert.equal(summarizeMice(data).lines.F,3);
 for(const mouse of data.tables.mice)assert.equal(isMouseGenotyped(mouse),true);
 const target=familyTargetDraft([{code:'F',mode:'carrier'}],data);assert.deepEqual(target.errors,[]);assert.equal(target.loci.length,1);assert.equal(target.loci[0].id,id);assert.equal(target.loci[0].name,FOXJ1_STRAIN_NAME);assert.deepEqual(target.loci[0].alleles,['+',oldName]);assert.equal(target.targets[id].allele,oldName);
 const family=buildFamilyGenotypes(data);assert.equal(family.animals.length,3);
 for(const mouse of family.animals){const fox=mouse.traits.find(row=>row.code==='F');assert.ok(fox);assert.equal(fox.presence,'present');assert.equal(fox.name,FOXJ1_STRAIN_NAME);}
 assert.deepEqual(data,before);
});

test('Planning reuses confirmed historical F profiles without rewriting source, locus IDs or genotype calls',async()=>{
 let data={tables:{mice:[animal('10000','Male'),animal('20000','Female',{genotype:'FoxJ1-CreERT2(+/-)'})],husbandry_events:[]}},writes=0;
 const before=structuredClone(data.tables.mice),container={innerHTML:'',querySelector(){return null},querySelectorAll(){return []}};
 const hooks={canEdit:()=>true,isCloud:()=>false,validate:validateRecord,save:async next=>{writes++;data=next;renderBreedingPlanner(container,data,hooks)}};
 const click=async(action,meta={})=>container.onclick({target:{closest:()=>({disabled:false,dataset:{plannerAction:action,...meta}})}});
 const change=(field,value,meta={})=>container.onchange({target:{value,dataset:{plannerField:field,...meta}}});
 renderBreedingPlanner(container,data,hooks);await click('tab',{tab:'cross'});await click('catalogue-locus',{locus:id});change('parent','10000',{role:'sire'});change('parent','20000',{role:'dam'});await click('calculate');
 assert.match(container.innerHTML,/Target probability/);assert.doesNotMatch(container.innerHTML,/saved locus definition differs|genotype evidence is unknown/);assert.equal((container.innerHTML.match(/<h3>Locus \d+<\/h3>/g)||[]).length,1);
 container.oninput({target:{value:'Inducible F cross',dataset:{plannerField:'plan-name'}}});await click('save-plan');assert.equal(writes,1);
 const saved=data.tables.husbandry_events.at(-1).breeding_plan.scenario;assert.equal(saved.loci[0].id,id);assert.equal(saved.loci[0].name,FOXJ1_STRAIN_NAME);assert.deepEqual(saved.loci[0].alleles,['+',oldName]);
 for(const role of ['sire','dam'])assert.deepEqual(saved[role].calls[id],{alleles:[oldName,'+'],evidence:'confirmed'});
 assert.deepEqual(data.tables.mice,before);
});

test('historical custom Foxj locus IDs and allele vocabularies are retained rather than silently migrated',()=>{
 const custom={id:'locus:FoxJ-CreERT2',name:'FoxJ-CreERT2',kind:'cre',chromosome:'unknown',alleles:['+','FoxJ-CreERT2']};
 const data={tables:{mice:[animal('10000','Male',{genotype:'FoxJ-CreERT2(+/-)',genetic_profile:{schema_version:1,loci:[custom],calls:{[custom.id]:{alleles:['FoxJ-CreERT2','+'],evidence:'confirmed'}}}})]}},before=structuredClone(data);
 const draft=familyTargetDraft([{code:'F',mode:'carrier'}],data);assert.deepEqual(draft.errors,[]);assert.equal(draft.loci.length,1);assert.equal(draft.loci[0].id,custom.id);assert.equal(draft.loci[0].name,FOXJ1_STRAIN_NAME);assert.deepEqual(draft.loci[0].alleles,custom.alleles);assert.equal(draft.targets[custom.id].allele,'FoxJ-CreERT2');
 assert.deepEqual(data,before);assert.equal(data.tables.mice[0].genetic_profile.calls[id],undefined);
});
