import test from 'node:test';import assert from 'node:assert/strict';
import {predictCross} from '../mouse-data/genetics.js';
import {defaultBreedingPlans,commonFamilyCrosses,familyCrossScenario,familyCrossGuidance,defaultFamilyCrosses,createFamilyCrossCache} from '../mouse-data/breeding-presets.js';
const catalogue=()=>defaultBreedingPlans().at(-1).input.loci;
const withGuidance=scenario=>{const result=predictCross(scenario),advice=familyCrossGuidance(scenario);result.warnings=[...new Set([...result.warnings,...advice.warnings])];return result;};
const reciprocal=scenario=>({...structuredClone(scenario),sire:{...structuredClone(scenario.dam),sex:'Male'},dam:{...structuredClone(scenario.sire),sex:'Female'}});

test('six unordered family crosses store exact full Mendelian outcomes and marginal target probabilities',()=>{
 const rows=defaultFamilyCrosses();assert.deepEqual(rows.map(row=>row.id),['pb-pb','pb-fpb','pb-adfpb','fpb-fpb','fpb-adfpb','adfpb-adfpb']);
 for(const row of rows){assert.deepEqual(row.result,withGuidance(row.scenario));assert.equal(row.result.targetProbability,{'pb-pb':.25,'pb-fpb':.125,'pb-adfpb':.0625,'fpb-fpb':.125,'fpb-adfpb':.0625,'adfpb-adfpb':.0625}[row.id]);assert.equal(row.result.outcomes.reduce((sum,o)=>sum+o.probability,0),1);assert(row.perLocus.every(locus=>locus.probability===.5));for(const role of ['sire','dam']){assert(!row.scenario[role].id);for(const call of Object.values(row.scenario[role].calls)){assert.equal(call.evidence,'inferred');assert(call.alleles.filter(a=>a!=='+').length<=1);}}}
});
test('default and reciprocal materialization need no calculation, preserve conditional cautions and return detached values',()=>{
 const cache=createFamilyCrossCache({predict:()=>{throw new Error('Unexpected default calculation');}});
 for(const row of defaultFamilyCrosses())for(const scenario of [row.scenario,reciprocal(row.scenario)]){const value=cache.get(scenario);assert.equal(value.cache,'stored');assert.deepEqual(value.result,withGuidance(scenario));value.result.outcomes[0].probability=-1;assert.deepEqual(cache.get(scenario).result,withGuidance(scenario));}
 assert.equal(cache.size,0);
});
test('parent-family construction preserves exact catalog scope and explicit editable targets',()=>{
 const crosses=commonFamilyCrosses(catalogue());assert.equal(crosses.length,6);for(const cross of crosses){const scenario=familyCrossScenario(cross),reverse=familyCrossScenario(cross,{reciprocal:true});assert.equal(scenario.independentAssortment,true);for(const locus of scenario.loci){assert.deepEqual(scenario.targets[locus.id].alleles,locus.alleles);assert.deepEqual(scenario.sire.calls[locus.id],reverse.dam.calls[locus.id]);}}
 const unavailable=commonFamilyCrosses(catalogue().filter(l=>l.id!=='app-ps1'));assert.equal(unavailable.filter(row=>!row.missing.length).length,3);assert.throws(()=>familyCrossScenario(unavailable.find(row=>row.id==='pb-adfpb')),/not available/);
});
test('changed parent copies, target copies, evidence, references and count assumptions invalidate stored results',()=>{
 let count=0;const cache=createFamilyCrossCache({predict:input=>({...predictCross(input),count:++count}),maxEntries:2}),base=defaultFamilyCrosses()[2].scenario;
 for(const mutate of [x=>x.sire.calls.bmal1.alleles=['fl','fl'],x=>x.targets.bmal1.alleles=['fl','fl'],x=>x.dam.calls.bmal1.evidence='confirmed',x=>x.loci[0].stockReference='JAX 999999',x=>x.sex='Male',x=>x.litterSize=8,x=>x.confidence=.9,x=>x.desiredCount=2]){const changed=structuredClone(base);mutate(changed);assert.equal(cache.get(changed).cache,'calculated');assert.equal(cache.get(changed).cache,'memory');}
 assert.equal(count,8);assert.equal(cache.size,2);cache.clear();assert.equal(cache.size,0);
 const actual=structuredClone(base);actual.sire.id='PRIVATE-ID';actual.dam.id='PRIVATE-ID';const normal=createFamilyCrossCache(),result=normal.get(actual);assert(result.result.errors.some(error=>error.includes('same animal ID')));assert.equal(normal.size,0);
});
test('Fox homozygous breeders fail while AD homozygous assumptions and conception viability remain visibly uncertain',()=>{
 const base=defaultFamilyCrosses().at(-1).scenario,cache=createFamilyCrossCache(),fox=structuredClone(base);fox.sire.calls['foxj1-cre'].alleles=['FoxJ1-Cre','FoxJ1-Cre'];const invalid=cache.get(fox).result;assert(invalid.errors.some(error=>/sire.*2 variant copies.*excluded/.test(error)));assert.equal(invalid.targetProbability,null);assert.deepEqual(invalid.outcomes,[]);
 const ad=structuredClone(base);ad.dam.calls['app-ps1'].alleles=['APP/PS1','APP/PS1'];assert(familyCrossGuidance(ad).warnings.some(w=>/homozygous dam.*unverified/.test(w)));assert(cache.get(ad).result.warnings.some(w=>/unverified/.test(w)));
 assert(base.sire.calls['foxj1-cre'].alleles.includes('+'));assert(withGuidance(base).warnings.some(w=>/postnatal|die|lethal/i.test(w)));
});
test('editing advanced manual targets remains valid and cached marginal probabilities agree with the outcomes',()=>{
 const base=defaultFamilyCrosses()[0].scenario;base.targets.bmal1={mode:'carrier',allele:'fl'};const result=createFamilyCrossCache().get(base);assert.deepEqual(result.result.errors,[]);assert.equal(result.perLocus.find(row=>row.id==='bmal1').probability,.75);base.targets.bmal1={mode:'exact',alleles:['fl','+']};assert.equal(createFamilyCrossCache().get(base).perLocus.find(row=>row.id==='bmal1').probability,.5);
});
