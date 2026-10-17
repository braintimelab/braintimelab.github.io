import test from 'node:test';import assert from 'node:assert/strict';
import{designBreedingStrategy,BREEDING_STRATEGY_LIMITS}from'../mouse-data/breeding-strategy.js';
const locus=(id,chromosome='1')=>({id,name:id,kind:'flox',chromosome,alleles:['+','f']});
const input=(loci=[locus('B')],copies=1)=>({loci,targets:Object.fromEntries(loci.map(l=>[l.id,{mode:'exact',alleles:['+','f']}])),sex:'Any',desiredCount:1,confidence:.95,litterSize:6,founders:{copiesByLocus:Object.fromEntries(loci.map(l=>[l.id,copies])),wildTypeAvailable:true}});
const copies=(parent,id)=>parent.calls[id].alleles.filter(a=>a!=='+' ).length;
test('ideal heterozygous target gives both reciprocal homozygous × wild-type crosses',()=>{
 const r=designBreedingStrategy(input());assert.deepEqual(r.errors,[]);assert.equal(r.idealCrosses.length,2);for(const c of r.idealCrosses){assert.equal(c.prediction.genotypeTargetProbability,1);assert.equal(c.prediction.livebornProbability,null);assert.deepEqual([copies(c.sire,'B'),copies(c.dam,'B')].sort(),[0,2]);assert(c.reciprocalId);assert(c.sire.hypothetical);assert.equal(c.sire.calls.B.evidence,'inferred');}
});
test('founder heterozygotes and homozygotes are explicit separate assumptions',()=>{
 const h=designBreedingStrategy(input()),hom=designBreedingStrategy(input(undefined,2));assert.equal(h.routes[0].prediction.targetProbability,.5);assert.equal(hom.routes[0].prediction.targetProbability,1);assert.equal(h.routes[0].targetBirthDay,21);assert.equal(h.routes[0].targetWeanDay,42);assert.equal(hom.founderAssumptions.copiesByLocus.B,2);assert(hom.warnings.some(x=>x.includes('homozygous founder')));
});
test('target homozygotes have25% conception probability from heterozygous founders',()=>{
 const c=input();c.targets.B.alleles=['f','f'];const r=designBreedingStrategy(c);assert.equal(r.idealCrosses[0].prediction.targetProbability,1);assert.equal(r.routes[0].prediction.targetProbability,.25);assert.equal(r.routes[0].generations,1);assert.equal(r.routes[0].prediction.expectedConceptions,4);assert.equal(r.routes[0].prediction.confidenceConceptions,11);
});
test('requested sex contributes separate half factor, no viable-offspring count is invented',()=>{
 const c=input();c.sex='Female';const r=designBreedingStrategy(c),p=r.routes[0].prediction;assert.equal(p.genotypeTargetProbability,.5);assert.equal(p.sexProbability,.5);assert.equal(p.targetProbability,.25);assert.equal(p.livebornProbability,null);assert.equal(p.expectedPups,undefined);
});
test('two homozygous single-strain stocks create double heterozygotes in first founder cross',()=>{
 const c=input([locus('A','1'),locus('B','2')],2),r=designBreedingStrategy(c),route=r.routes[0];assert.deepEqual(r.errors,[]);assert.equal(route.generations,1);assert.equal(route.prediction.targetProbability,1);assert.equal(route.steps.length,1);assert.equal(route.steps[0].crossType,'founder_cross');assert(route.steps[0].label.startsWith('G1'));assert(route.pedigree.nodes.every(n=>n.hypothetical));
});
test('parallel four-strain assembly matures both branches before next cross',()=>{
 const c=input([locus('A','1'),locus('B','2'),locus('C','3'),locus('D','4')],2),r=designBreedingStrategy(c),route=r.routes[0];assert.equal(route.generations,2);assert.equal(route.targetBirthDay,98);assert.equal(route.targetWeanDay,119);assert.equal(route.prediction.targetProbability,1/16);assert.equal(route.steps.filter(s=>s.generation===1).length,2);assert.equal(route.steps.at(-1).generation,2);assert(!route.steps.some(s=>s.label.startsWith('F2')));
});
test('mixed target can backcross to founder instead of adding unnecessary full intercross generation',()=>{
 const c=input([locus('A','1'),locus('B','2')],2);c.targets.B.alleles=['f','f'];const r=designBreedingStrategy(c),route=r.routes[0];assert.equal(route.generations,2);assert.equal(route.targetBirthDay,98);assert.equal(route.prediction.targetProbability,.25);assert.equal(route.steps.at(-1).crossType,'backcross');
});
test('known linkage and compound alleles cannot become independent loci',()=>{
 const c=input([locus('A','1'),locus('B','1')]);c.independentAssortment=true;assert(designBreedingStrategy(c).errors.some(x=>x.includes('share chromosome')));
 const m=input([{...locus('R'),alleles:['+','Ai32','Ai96']}]);m.targets.R.alleles=['Ai32','Ai96'];assert(designBreedingStrategy(m).errors.some(x=>x.includes('alternative alleles')));
});
test('known distinct chromosomes model independence while unknown positions require consent',()=>{
 const known=input([locus('A','1'),locus('B','2')]);assert.deepEqual(designBreedingStrategy(known).errors,[]);const unknown=input([locus('A','unknown'),locus('B','2')]);assert(designBreedingStrategy(unknown).errors.some(x=>x.includes('Confirm independent')));unknown.independentAssortment=true;assert.deepEqual(designBreedingStrategy(unknown).errors,[]);assert(designBreedingStrategy(unknown).warnings.some(x=>x.includes('Unknown chromosome')));
});
test('missing/advanced targets and unknown alleles are never filled silently',()=>{
 for(const mode of['any','carrier']){const c=input();c.targets.B={mode,allele:'f'};assert(designBreedingStrategy(c).errors.length);}
 const c=input();delete c.targets.B;assert(designBreedingStrategy(c).errors.length);c.targets.B={mode:'exact',alleles:['?','f']};assert(designBreedingStrategy(c).errors.length);
});
test('timing validates biologically ordered finite whole days and recalculates conditional dates',()=>{
 const c=input([locus('A','1'),locus('B','2'),locus('C','3'),locus('D','4')],2);c.timing={founderReadyDay:3,breedingAgeDays:70,gestationDays:20,weaningAgeDays:25};const r=designBreedingStrategy(c);assert.equal(r.routes[0].targetBirthDay,113);assert.equal(r.routes[0].targetWeanDay,138);
 for(const timing of[{gestationDays:NaN},{breedingAgeDays:20},{weaningAgeDays:55,breedingAgeDays:40},{gestationDays:21.5},{founderReadyDay:-1}])assert(designBreedingStrategy({...c,timing}).errors.length);
});
test('explicit constraints preserve viable breeders, allow terminal conception model and block homozygous founders',()=>{
 const c=input();c.guidance={B:{constraints:{allowedCopies:[0,1,2],sireAllowedCopies:[0,1],damAllowedCopies:[0,1],offspringAllowedCopies:[0,1,2]}}};c.targets.B.alleles=['f','f'];const r=designBreedingStrategy(c);assert.deepEqual(r.errors,[]);assert.equal(r.idealCrosses[0].prediction.targetProbability,.25);assert(r.idealCrosses.every(x=>copies(x.sire,'B')<2&&copies(x.dam,'B')<2));assert.equal(r.routes[0].prediction.targetProbability,.25);c.founders.copiesByLocus.B=2;assert(designBreedingStrategy(c).errors.some(x=>x.includes('founder breeders are excluded')));
});
test('sex-specific constraints prevent unsupported reciprocals rather than applying a generic Cre rule',()=>{
 const c=input();c.guidance={B:{constraints:{sireAllowedCopies:[0,1],damAllowedCopies:[0]}}};const r=designBreedingStrategy(c);assert.deepEqual(r.errors,[]);assert.equal(r.idealCrosses.length,1);assert.equal(copies(r.idealCrosses[0].sire,'B'),1);assert.equal(copies(r.idealCrosses[0].dam,'B'),0);assert.equal(r.idealCrosses[0].reciprocalId,null);
});
test('six loci remain bounded, deterministic, input-preserving and acyclic',()=>{
 const c=input(Array.from({length:6},(_,i)=>locus('L'+i,String(i+1)))),before=structuredClone(c),a=designBreedingStrategy(c),b=designBreedingStrategy(c);assert.deepEqual(a,b);assert.deepEqual(c,before);assert.equal(a.idealCrosses.length,64);assert(a.routes.length<=6);assert(a.limits.statesEvaluated<=BREEDING_STRATEGY_LIMITS.states);
 for(const route of a.routes){const map=new Map(route.pedigree.nodes.map(n=>[n.id,n]));for(const edge of route.pedigree.edges){assert(map.has(edge.from)&&map.has(edge.to));assert(map.get(edge.from).generation<map.get(edge.to).generation);}for(const s of route.steps){assert(s.genotypeProbability>0&&s.genotypeProbability<=1);assert.notEqual(s.sire.id,s.dam.id);}}
});
test('missing wild-type stock is explicit and cannot fabricate a heterozygote from a homozygous single line',()=>{
 const c=input(undefined,2);c.founders.wildTypeAvailable=false;const r=designBreedingStrategy(c);assert.deepEqual(r.errors,[]);assert.equal(r.routes.length,0);assert(r.warnings.some(x=>x.includes('No founder route')));assert.equal(r.idealCrosses.length,2);
});
test('exact Foxj1 catalog target preserves theoretical conception while suppressing a viable-adult timeline',()=>{
 const c=input([{...locus('F','unknown'),kind:'cre',stockReference:'JAX 027012'}]);c.targets.F.alleles=['f','f'];const r=designBreedingStrategy(c);assert.deepEqual(r.errors,[]);assert.equal(r.idealCrosses[0].prediction.genotypeTargetProbability,.25);assert.equal(r.targetAdultViable,false);assert(r.criticalWarnings.some(s=>s.includes('postnatal lethality')));assert.equal(r.routes[0].targetBirthDay,21);assert.equal(r.routes[0].targetWeanDay,null);assert.equal(r.routes[0].steps.at(-1).weanDay,null);assert.equal(r.routes[0].steps.at(-1).breedingReadyDay,null);assert(r.sources.some(s=>s.url==='https://www.jax.org/strain/027012'));
 c.founders.copiesByLocus.F=2;assert(designBreedingStrategy(c).errors.some(s=>s.includes('founder breeders are excluded')));
});
test('known catalog breeder restrictions cannot be relaxed by supplied hypothetical guidance',()=>{
 const c=input([{...locus('F','unknown'),stockReference:'JAX 027012'}]);c.guidance={F:{constraints:{sireAllowedCopies:[0,1,2],damAllowedCopies:[0,1,2]}}};const r=designBreedingStrategy(c);assert(r.idealCrosses.every(row=>copies(row.sire,'F')!==2&&copies(row.dam,'F')!==2));
});
test('heterozygous Foxj1 target prefers equally productive wild-type mating over avoidable lethal homozygotes',()=>{
 const c=input([{...locus('F','unknown'),stockReference:'JAX 027012'}]),r=designBreedingStrategy(c);assert.equal(r.idealCrosses.length,2);for(const row of r.idealCrosses){assert.equal(row.prediction.targetProbability,.5);assert.equal(row.prediction.knownNonviableGenotypeProbability,0);assert.deepEqual([copies(row.sire,'F'),copies(row.dam,'F')].sort(),[0,1]);}assert.equal(r.routes[0].prediction.knownNonviableGenotypeProbability,0);assert.deepEqual([copies(r.routes[0].sire,'F'),copies(r.routes[0].dam,'F')].sort(),[0,1]);
});
test('catalog chromosomes inform assumptions but contradictory configured chromosomes remain a review error',()=>{
 const c=input([{...locus('P','unknown'),stockReference:'JAX 006852'},{...locus('B','unknown'),stockReference:'JAX 007668'}]);assert.deepEqual(designBreedingStrategy(c).errors,[]);assert(!designBreedingStrategy(c).warnings.some(s=>s.includes('Unknown chromosome')));c.loci[0].chromosome='2';assert(designBreedingStrategy(c).errors.some(s=>s.includes('disagrees')));
 const duplicate=input([{...locus('32','unknown'),stockReference:'JAX 012569'},{...locus('96','unknown'),stockReference:'JAX 028866'}]);duplicate.independentAssortment=true;assert(designBreedingStrategy(duplicate).errors.some(s=>s.includes('share chromosome 6')));
});
test('unknown catalog homozygous viability stays unknown and never becomes proof of lethality',()=>{
 const c=input([{...locus('A','unknown'),stockReference:'JAX 023530'}]);c.targets.A.alleles=['f','f'];const r=designBreedingStrategy(c);assert.equal(r.targetAdultViable,null);assert(r.criticalWarnings.some(s=>s.includes('not established')));assert(r.routes[0].targetWeanDay!==null);assert.equal(r.idealCrosses[0].prediction.targetProbability,.25);
});
test('unknown exact-stock homozygous breeders require an explicit conditional founder assumption',()=>{
 for(const stock of['JAX 023530','JAX 028866','JAX 005864']){const c=input([{...locus('A','unknown'),stockReference:stock}]),r=designBreedingStrategy(c);assert(r.idealCrosses.every(row=>copies(row.sire,'A')<2&&copies(row.dam,'A')<2));assert.equal(r.idealCrosses[0].prediction.targetProbability,.5);assert(r.routes.every(route=>route.steps.every(step=>copies(step.sire,'A')<2&&copies(step.dam,'A')<2)));c.founders.copiesByLocus.A=2;const explicit=designBreedingStrategy(c);assert.deepEqual(explicit.errors,[]);assert.equal(explicit.idealCrosses[0].prediction.targetProbability,1);assert(explicit.criticalWarnings.some(s=>s.includes('explicitly assumes homozygous breeders')));assert.equal(explicit.targetAdultViable,null);}
});
