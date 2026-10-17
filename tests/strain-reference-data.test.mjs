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
 assert.match(getStrainRegistry(original).find(row=>row.key==='F').formal_name,/Foxj1tm1\.1\(cre\/ERT2\/GFP\)Htg/);assert.equal(getStrainRegistry(original).find(row=>row.key==='Vg').promoter,'');
});

test('F and A exact acquisition stocks provide official construct and assay details without assuming local background',()=>{
 const f=JAX_STRAIN_REFERENCES.F,a=JAX_STRAIN_REFERENCES.A;
 assert.equal(f.stock,'027012');assert.equal(f.fields.formal_name,'STOCK Foxj1tm1.1(cre/ERT2/GFP)Htg/J');assert.equal(f.fields.gene_symbol,'Foxj1');assert.equal(f.fields.promoter,'Endogenous Foxj1 regulatory sequences');
 assert.match(f.fields.construct,/exon 2.*FRT.*removed with Flp/);assert.equal(f.fields.reporter,'GFP');assert.equal(f.fields.recombinase,'Tamoxifen-inducible CreERT2');assert.match(f.fields.genotyping_notes,/17668.*294 bp.*472 bp/);assert.match(f.fields.references,/MGI:5585638/);
 assert.equal(a.stock,'023530');assert.equal(a.fields.formal_name,'B6.Cg-Avptm1.1(cre)Hze/J');assert.equal(a.fields.promoter,'Endogenous Avp regulatory sequences');assert.match(a.fields.construct,/IRES2-Cre.*exon 3.*PhiC31/);assert.equal(a.fields.recombinase,'Cre');assert.equal(a.fields.reporter,undefined);assert.match(a.fields.genotyping_notes,/26345.*243 bp.*247 bp/);assert.match(a.fields.references,/MGI:5522761/);
 for(const row of [f,a]){assert.equal(row.fields.genetic_background,undefined);assert.equal(row.fields.zygosity,undefined);}
 const before=empty(),after=getStrainRegistry(before);assert.deepEqual(before,empty());assert.equal(after.find(row=>row.key==='F').name,'FoxJ1-CreERT2');assert.equal(after.find(row=>row.key==='A').insertionType,'knock_in');
});
