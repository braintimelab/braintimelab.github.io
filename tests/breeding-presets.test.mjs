import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {designBreedingStrategy} from '../mouse-data/breeding-strategy.js';
import {defaultBreedingPlans,popularBreedingPresets,presetScenario,presetAssumptions,createBreedingPlanCache} from '../mouse-data/breeding-presets.js';
const compact=result=>{const copy=structuredClone(result),first=copy.idealCrosses[0];copy.idealCrosses=copy.idealCrosses.filter(row=>row.id===first.id||row.id===first.reciprocalId);copy.routes=copy.routes.filter(row=>row.id===copy.fastestRouteId);return copy;};
const catalogue=()=>defaultBreedingPlans().at(-1).input.loci;

test('all three shipped plans equal the current exact model, keep a reciprocal pair, and stay compact',async()=>{
 const plans=defaultBreedingPlans();assert.deepEqual(plans.map(row=>row.family),['pb','fpb','adfpb']);
 for(const plan of plans){assert.deepEqual(plan.result,compact(designBreedingStrategy(plan.input)));assert.equal(plan.result.routes.length,1);assert.equal(plan.result.idealCrosses.length,2);assert.equal(plan.result.idealCrosses[0].reciprocalId,plan.result.idealCrosses[1].id);assert.equal(plan.result.routes[0].prediction.targetProbability,{pb:.25,fpb:.25,adfpb:.0625}[plan.family]);assert.equal(plan.result.routes[0].generations,plan.family==='pb'?1:2);for(const locus of plan.input.loci){assert.equal(plan.input.targets[locus.id].alleles.filter(allele=>allele!=='+').length,1);assert.equal(plan.input.founders.copiesByLocus[locus.id],1);}}
 const source=await readFile(new URL('../mouse-data/breeding-presets.js',import.meta.url),'utf8');assert(Buffer.byteLength(source)<100000);assert.doesNotMatch(source,/localStorage|indexedDB|fetch\(|mouse_sid|jhmyung@|jihwan@/);
});
test('shipped defaults load without calculation and returned objects cannot mutate future reuse',()=>{
 let calculations=0;const cache=createBreedingPlanCache({design:()=>{calculations++;throw new Error('Default was recalculated');}}),plan=defaultBreedingPlans()[1],first=cache.get(plan.input);
 assert.equal(first.cache,'stored');first.result.routes[0].targetBirthDay=-1;first.result.idealCrosses[0].sire.calls['foxj1-cre'].alleles=['+','+'];assert.deepEqual(cache.get(plan.input).result,plan.result);assert.equal(calculations,0);
});
test('model cache includes every modeled assumption and excludes actual parent/source metadata',()=>{
 let calculations=0;const cache=createBreedingPlanCache({design:input=>({marker:++calculations,input})}),base=defaultBreedingPlans()[0].input;
 const first=cache.get(base,{full:true});assert.equal(first.cache,'calculated');assert.equal(cache.get({...structuredClone(base),sire:{id:'PRIVATE-MOUSE'},source_note:'PRIVATE-SOURCE',loci:base.loci.map(l=>({...l,sources:[{title:'PRIVATE-ARCHIVE'}],occurrences:99}))},{full:true}).cache,'memory');assert.doesNotMatch(JSON.stringify(first),/PRIVATE/);
 const mutations=[x=>x.loci[0].stockReference='JAX 999999',x=>x.loci[0].alleles[1]='Different',x=>x.loci[0].chromosome='5',x=>x.loci[0].name='Different',x=>x.loci[0].kind='other',x=>x.targets.bmal1.alleles=['fl','fl'],x=>x.founders.copiesByLocus.bmal1=2,x=>x.founders.wildTypeAvailable=false,x=>x.sex='Female',x=>x.desiredCount=2,x=>x.confidence=.9,x=>x.litterSize=8,x=>x.independentAssortment=true,...Object.keys(base.timing).map(key=>x=>x.timing[key]++),x=>x.loci[0].constraints={allowedCopies:[0,1]},x=>x.guidance={'per2-luc':{chromosome:'4'}}];
 for(const mutate of mutations){const changed=structuredClone(base);mutate(changed);assert.equal(cache.get(changed,{full:true}).cache,'calculated');}
 assert.equal(calculations,mutations.length+1);
});
test('changed references cannot reuse shipped defaults and small memory caches evict old calculations',()=>{
 let calculations=0;const cache=createBreedingPlanCache({design:()=>({sequence:++calculations}),maxEntries:2}),base=defaultBreedingPlans()[0].input,inputs=[1,2,3].map(founderReadyDay=>({...structuredClone(base),timing:{...base.timing,founderReadyDay}}));
 for(const input of inputs)assert.equal(cache.get(input).cache,'calculated');assert.equal(cache.size,2);assert.equal(cache.get(inputs[2]).cache,'memory');assert.equal(cache.get(inputs[0]).cache,'calculated');cache.clear();assert.equal(cache.size,0);
 const changed=structuredClone(base);changed.loci[0].stockReference='JAX 000000';assert.equal(cache.get(changed).cache,'calculated');assert.equal(cache.get(base).cache,'stored');
 const tiny=createBreedingPlanCache({design:()=>({value:'x'.repeat(100)}),maxBytes:10});assert.equal(tiny.get(inputs[0]).cache,'calculated');assert.equal(tiny.size,0);
});
test('preset family availability uses exact current locus definitions and never interprets primes as copies',()=>{
 const available=popularBreedingPresets(catalogue());assert(available.every(row=>!row.missing.length));const last=available.at(-1),scenario=presetScenario(last),assumptions=presetAssumptions(last);
 assert.equal(last.label,"ADFB'P");assert.deepEqual(last.locusIds,['app-ps1','foxj1-cre','per2-luc','bmal1']);for(const locus of scenario.loci){assert.deepEqual(scenario.targets[locus.id].alleles,locus.alleles);assert.equal(assumptions.founderCopies[locus.id],1);assert.deepEqual(scenario.sire.calls[locus.id],{alleles:[],evidence:'unknown'});}assert(!('id' in scenario.sire));
 for(const change of [rows=>rows.filter(row=>row.id!=='app-ps1'),rows=>{rows.find(row=>row.id==='app-ps1').name='Different';return rows;},rows=>{rows.find(row=>row.id==='app-ps1').reviewRequired=true;return rows;},rows=>{rows.find(row=>row.id==='app-ps1').alleles=['+','Other'];return rows;}]){const unavailable=popularBreedingPresets(change(catalogue())).at(-1);assert.deepEqual(unavailable.missing,['APP/PS1']);assert.throws(()=>presetScenario(unavailable),/not available/);}
});
