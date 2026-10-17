import test from'node:test';import assert from'node:assert/strict';
import{getBreedingGuidance,REFERENCE_BREEDING_GUIDANCE,BREEDING_TIMING_GUIDANCE}from'../mouse-data/breeding-guidance.js';

test('only explicit unambiguous catalog references activate stock guidance',()=>{
 for(const input of ['027012','JAX 027012','https://www.jax.org/strain/027012',{name:'FoxJ1-Cre',stockReference:'JAX 027012'},{stock_reference:'JAX 005864; MMRRC 034832-JAX'}])assert(getBreedingGuidance(input));
 for(const input of ['F','FoxJ1-Cre','Vip-Cre','Meis1-flox','Vgat-flox','notes027012',{},null,{name:'FoxJ1-Cre'},{stockReference:'JAX 027012 / JAX 010908'},{stockNumber:'027012',stock_reference:'JAX 028866'},{stockReference:'unverified',stock:'027012'},'031628'])assert.equal(getBreedingGuidance(input),null);
});
test('Foxj1 severe homozygous outcome excludes breeders, not Mendelian conception',()=>{
 const g=getBreedingGuidance('027012');assert.deepEqual(g.constraints.sireAllowedCopies,[0,1]);assert.deepEqual(g.constraints.damAllowedCopies,[0,1]);assert.deepEqual(g.constraints.offspringAllowedCopies,[0,1,2]);assert.equal(g.homozygousAdultViable,false);assert.equal(g.homozygousFertile,null);assert.match(g.homozygousTargetWarning,/postnatal lethality/);assert.match(g.germlineEvidence,/spermatocytes and spermatozoa/);assert.equal(g.parentSexRestriction,null);
});
test('uncharacterized homozygotes remain unknown, never invented as lethal or sterile',()=>{
 for(const stock of ['023530','028866','005864']){const g=getBreedingGuidance(stock);assert.equal(g.homozygousAdultViable,null);assert.equal(g.homozygousFertile,null);assert.deepEqual(g.constraints.sireAllowedCopies,[0,1,2]);assert.deepEqual(g.constraints.damAllowedCopies,[0,1,2]);assert.match(g.homozygousTargetWarning,/not established/);}
 for(const stock of ['006852','007668','010908','012569']){const g=getBreedingGuidance(stock);assert.equal(g.homozygousAdultViable,true);assert.equal(g.homozygousFertile,true);}
});
test('chromosomes and same-locus reporter relationship are catalog annotations only',()=>{
 assert.deepEqual(Object.fromEntries(Object.entries(REFERENCE_BREEDING_GUIDANCE).map(([k,g])=>[k,g.chromosome])),{'006852':'1','007668':'7','010908':'10','027012':'11','023530':'2','028866':'6','012569':'6','005864':'9'});
 assert.equal(getBreedingGuidance('028866').sameLocusGroup,getBreedingGuidance('012569').sameLocusGroup);
 const input={stockReference:'JAX 027012',chromosome:'unknown',calls:{F:['+','F']},genetic_background:'Local cross'},copy=structuredClone(input);const g=getBreedingGuidance(input);assert.deepEqual(input,copy);assert.equal(g.catalogOnly,true);assert.match(g.stockIdentity,/local stock/);assert.equal(g.genetic_background,undefined);
});
test('all sources are official JAX/MGI HTTPS and Cre sex is never universally constrained',()=>{
 for(const g of Object.values(REFERENCE_BREEDING_GUIDANCE)){assert.equal(g.checkedAt,'2026-10-18');assert(g.sources.length>=2);for(const s of g.sources){const u=new URL(s.url);assert.equal(u.protocol,'https:');assert(['www.jax.org','www.informatics.jax.org'].includes(u.hostname));}assert.equal(g.parentSexRestriction,null);}
 for(const stock of ['010908','027012','023530'])assert(getBreedingGuidance(stock).warnings.some(x=>x.includes('no universal safe-parent-sex rule')));
});
test('timing stays a stated range-based assumption and source records cannot be mutated',()=>{
 assert.deepEqual(BREEDING_TIMING_GUIDANCE.defaults,{founderReadyDay:0,breedingAgeDays:56,gestationDays:21,weaningAgeDays:21});assert.deepEqual(BREEDING_TIMING_GUIDANCE.referenceRanges.gestationDays,[19,21]);assert.match(BREEDING_TIMING_GUIDANCE.notes.join(' '),/not predictions/);
 const a=getBreedingGuidance('027012');a.constraints.sireAllowedCopies.push(2);a.warnings.length=0;assert.deepEqual(getBreedingGuidance('027012').constraints.sireAllowedCopies,[0,1]);assert.throws(()=>REFERENCE_BREEDING_GUIDANCE['027012'].constraints.sireAllowedCopies.push(2),TypeError);
});
