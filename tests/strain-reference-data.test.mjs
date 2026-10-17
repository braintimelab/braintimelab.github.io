import test from 'node:test';
import assert from 'node:assert/strict';
import {JAX_STRAIN_REFERENCES} from '../mouse-data/strain-reference-data.js';
import {getStrainRegistry,buildStrainDefinition} from '../mouse-data/strain-registry.js';
const empty=()=>({tables:{mice:[{mouse_sid:'10000',genotype:'Local call'}],husbandry_events:[]}});
test('JAX identities distinguish the recorded Ai96 stock and Vip reference backgrounds',()=>{
 assert.equal(JAX_STRAIN_REFERENCES['96'].stock,'028866');assert.match(JAX_STRAIN_REFERENCES['96'].fields.formal_name,/MwarJ$/);assert.match(JAX_STRAIN_REFERENCES['96'].fields.catalog_background,/distinct from.*024106/);
 assert.equal(JAX_STRAIN_REFERENCES.V.stock,'010908');assert.match(JAX_STRAIN_REFERENCES.V.fields.formal_name,/^STOCK /);assert.match(JAX_STRAIN_REFERENCES['32'].fields.references,/MGI:5013789/);
 for(const [code,reference] of Object.entries(JAX_STRAIN_REFERENCES)){
  assert.equal(reference.url,`https://www.jax.org/strain/${reference.stock}`);assert.match(reference.fields.references,/informatics.jax.org\/allele\/MGI:/);assert.equal(reference.fields.genetic_background,undefined,code);assert.equal(reference.fields.zygosity,undefined,code);
 }
});
test('reference metadata fills only missing optional fields; saved local details and deliberate blanks win',()=>{
 const original=empty(),defaults=getStrainRegistry(original).find(row=>row.key==='V');assert.equal(defaults.promoter,'Endogenous Vip promoter and enhancers');assert.equal(defaults.genetic_background,'');
 const built=buildStrainDefinition(original,{code:'V',insertion_type:'knock_in',stock_reference:'Local validated stock',notes:'Keep',promoter:'',genetic_background:'Local background supplied by keeper'});
 const saved=getStrainRegistry(built.dataset).find(row=>row.key==='V');assert.equal(saved.stockReference,'Local validated stock');assert.equal(saved.promoter,'');assert.equal(saved.genetic_background,'Local background supplied by keeper');assert.deepEqual(original.tables.mice,built.dataset.tables.mice);
 assert.equal(getStrainRegistry(original).find(row=>row.key==='F').formal_name,'');assert.equal(getStrainRegistry(original).find(row=>row.key==='Vg').promoter,'');
});
