import {predictCross} from './genetics.js?v=100';
import {getBreedingGuidance,BREEDING_TIMING_GUIDANCE} from './breeding-guidance.js?v=121';

/** Hypothetical, diploid autosomal routes. Nothing here reads colony animals,
 * assigns a biological genotype, or claims that a modeled breeder is available. */
export const BREEDING_STRATEGY_LIMITS=Object.freeze({loci:6,idealCrosses:64,routes:6,states:128});
export const DEFAULT_BREEDING_TIMING=Object.freeze({...BREEDING_TIMING_GUIDANCE.defaults});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const reserved=new Set(['__proto__','prototype','constructor']);
const unique=a=>[...new Set(a)];
const pairKey=copies=>copies.join(',');
const countBits=n=>{let count=0;for(;n;n&=n-1)count++;return count;};
const targetChance=(a,b,target)=>target===2?a*b/4:(a/2)*(1-b/2)+(1-a/2)*(b/2);
const byProbability=(a,b)=>b.probability-a.probability||a.key.localeCompare(b.key);
const noPlan=(errors,warnings=[],extra={})=>({errors:unique(errors),warnings:unique(warnings),criticalWarnings:[],targetAdultViable:null,sources:[],assumptions:[],idealCrosses:[],routes:[],fastestRouteId:null,limits:BREEDING_STRATEGY_LIMITS,...extra});

function checked(input){
 const errors=[],warnings=[],criticalWarnings=[],sources=[...BREEDING_TIMING_GUIDANCE.sources];let targetAdultViable=null;
 if(!object(input)||!Array.isArray(input.loci)||input.loci.length<1||input.loci.length>6)return {errors:['Choose between 1 and 6 autosomal loci.'],warnings};
 const loci=[],seen=new Set(),chromosomes=new Map();
 for(const raw of input.loci){
  if(!object(raw)||typeof raw.id!=='string'||!raw.id.trim()||raw.id.length>160||reserved.has(raw.id)||seen.has(raw.id)){errors.push('Locus IDs must be distinct nonempty text without reserved names.');continue;}seen.add(raw.id);
  const name=typeof raw.name==='string'&&raw.name.trim()?raw.name:raw.id,alleles=raw.alleles;
  if(!Array.isArray(alleles)||alleles.length!==2||new Set(alleles).size!==2||alleles.some(a=>typeof a!=='string'||!a.trim()||a!==a.trim()||a.length>160||/^(?:\?|unknown|undetermined|untested|not tested)$/i.test(a))){errors.push(`${name}: target-first planning requires two known alleles. Use Manual cross for alternative alleles at one locus.`);continue;}
  const wildType=raw.wildTypeAllele??(alleles.includes('+')?'+':null);if(!alleles.includes(wildType)){errors.push(`${name}: explicitly identify the wild-type allele.`);continue;}const variant=alleles.find(a=>a!==wildType);
  const target=input.targets?.[raw.id];if(!object(target)||target.mode!=='exact'||!Array.isArray(target.alleles)||target.alleles.length!==2||target.alleles.some(a=>!alleles.includes(a))){errors.push(`${name}: choose an exact heterozygous or homozygous target. Advanced targets remain available in Manual cross.`);continue;}
  const targetCopies=target.alleles.filter(a=>a===variant).length;if(!targetCopies){errors.push(`${name}: choose a heterozygous or homozygous variant target.`);continue;}
  const suppliedGuide=object(input.guidance?.[raw.id])?input.guidance[raw.id]:object(raw.guidance)?raw.guidance:{},catalog=getBreedingGuidance(raw),guide=catalog??suppliedGuide,chromosome=catalog?.chromosome??raw.chromosome;
  if(catalog&&raw.chromosome!=='unknown'&&raw.chromosome!==undefined&&raw.chromosome!==chromosome)errors.push(`${name}: configured chromosome disagrees with the exact catalog reference. Review the locus before modeling.`);
  if(typeof chromosome!=='string'||!(/^(?:[1-9]|1[0-9])$/.test(chromosome)||chromosome==='unknown'))errors.push(`${name}: only autosomes 1–19 or unknown are supported.`);
  else if(chromosome!=='unknown'){if(chromosomes.has(chromosome))errors.push(`${name} and ${chromosomes.get(chromosome)} share chromosome ${chromosome}. Linkage and haplotype phase require a different model.`);else chromosomes.set(chromosome,name);}
  const constraints=guide.constraints??raw.constraints??{},explicitHomozygousFounder=object(input.founders?.copiesByLocus)&&Object.hasOwn(input.founders.copiesByLocus,raw.id)&&input.founders.copiesByLocus[raw.id]===2,unverifiedHomozygousBreeder=Boolean(catalog&&(catalog.homozygousAdultViable===null||catalog.homozygousFertile===null)&&catalog.homozygousAdultViable!==false&&catalog.homozygousFertile!==false);
  if(!object(constraints)){errors.push(`${name}: breeding constraints must be an object.`);continue;}
  const allowed=(key,fallback)=>{const a=constraints[key]??fallback;if(!Array.isArray(a)||!a.length||a.some(n=>![0,1,2].includes(n))||new Set(a).size!==a.length){errors.push(`${name}: ${key} must list distinct copy counts 0, 1 or 2.`);return [];}return a;};
  const copies=allowed('allowedCopies',[0,1,2]);let sire=allowed('sireAllowedCopies',copies),dam=allowed('damAllowedCopies',copies);
  if(unverifiedHomozygousBreeder&&!explicitHomozygousFounder){sire=sire.filter(n=>n!==2);dam=dam.filter(n=>n!==2);warnings.push(`${name}: unverified homozygous breeders are excluded from automatic suggestions. Declare a hypothetical homozygous founder explicitly to model them conditionally.`);}
  if(unverifiedHomozygousBreeder&&explicitHomozygousFounder)criticalWarnings.push(`${name}: this route explicitly assumes homozygous breeders whose viability or fertility is not established by the catalog reference. Verify before breeding.`);
  const offspring=allowed('offspringAllowedCopies',[0,1,2]);if(!offspring.includes(targetCopies))errors.push(`${name}: the requested target is excluded by the supplied strain constraint.`);
  if(Array.isArray(guide.warnings))warnings.push(...guide.warnings.filter(v=>typeof v==='string'&&v.length<=2000));
  if(targetCopies===2&&typeof guide.homozygousTargetWarning==='string'){criticalWarnings.push(guide.homozygousTargetWarning);if(guide.homozygousAdultViable===false)targetAdultViable=false;}
  if(Array.isArray(guide.sources))sources.push(...guide.sources.filter(s=>object(s)&&typeof s.label==='string'&&typeof s.url==='string'));
  if(Array.isArray(constraints.notes))warnings.push(...constraints.notes.filter(v=>typeof v==='string'&&v.length<=2000));
  loci.push({...raw,name,chromosome,wildType,variant,targetCopies,knownAdultNonviableHomozygote:guide.homozygousAdultViable===false,allowed:{sire,dam,offspring}});
 }
 if(loci.length>1&&loci.some(l=>l.chromosome==='unknown')&&input.independentAssortment!==true)errors.push('Confirm independent assortment for loci whose chromosome locations are unknown.');
 if(loci.length>1&&loci.some(l=>l.chromosome==='unknown'))warnings.push('Unknown chromosome locations: joint probabilities depend on the explicit independent-assortment assumption.');
 const timing={...DEFAULT_BREEDING_TIMING,...(object(input.timing)?input.timing:{})};
 for(const [key,min,max]of [['founderReadyDay',0,365],['breedingAgeDays',21,365],['gestationDays',15,40],['weaningAgeDays',7,60]])if(!Number.isInteger(timing[key])||timing[key]<min||timing[key]>max)errors.push(`${key} must be a whole number from ${min} to ${max}.`);
 if(timing.breedingAgeDays<timing.weaningAgeDays)errors.push('Breeding age cannot precede weaning age.');
 const founders=object(input.founders)?input.founders:{},copiesByLocus=founders.copiesByLocus??{};if(!object(copiesByLocus))errors.push('Founder copy counts must be keyed by locus ID.');
 if(founders.wildTypeAvailable!==undefined&&typeof founders.wildTypeAvailable!=='boolean')errors.push('Wild-type founder availability must be an explicit boolean.');
 const founderCopies=loci.map(l=>object(copiesByLocus)&&Object.hasOwn(copiesByLocus,l.id)?copiesByLocus[l.id]:1);
 for(let i=0;i<loci.length;i++){if(![1,2].includes(founderCopies[i]))errors.push(`${loci[i].name}: a single-strain founder stock must have 1 or 2 variant copies.`);if(founderCopies[i]===2){if(!loci[i].allowed.sire.includes(2)&&!loci[i].allowed.dam.includes(2))errors.push(`${loci[i].name}: homozygous founder breeders are excluded by the supplied strain constraint.`);else warnings.push(`${loci[i].name}: homozygous founder stock is a stated modeling assumption; verify stock genotype, viability and fertility.`);}}
 const config={...input,loci:loci.map(({allowed,wildType,variant,targetCopies,...l})=>l),independentAssortment:true,sex:input.sex??'Any',desiredCount:input.desiredCount??1,confidence:input.confidence??0.95,litterSize:input.litterSize??6};
 if(!errors.length){const calls=Object.fromEntries(loci.map(l=>[l.id,{alleles:[l.wildType,l.wildType],evidence:'inferred'}]));errors.push(...predictCross({...config,sire:{id:'validation-sire',sex:'Male',calls},dam:{id:'validation-dam',sex:'Female',calls}}).errors);}
 return {errors,warnings,criticalWarnings,targetAdultViable,sources:[...new Map(sources.map(s=>[s.url,{label:s.label,url:s.url}])).values()],loci,timing,founderCopies,wildTypeAvailable:founders.wildTypeAvailable!==false,config};
}

function callsFor(copies,loci){return Object.fromEntries(loci.map((l,i)=>[l.id,{alleles:copies[i]===0?[l.wildType,l.wildType]:copies[i]===1?[l.wildType,l.variant]:[l.variant,l.variant],evidence:'inferred'}]));}
const parentFor=(copies,loci,sex,id)=>({id,sex,calls:callsFor(copies,loci),hypothetical:true});
function probability(a,b,loci){return loci.reduce((p,l,i)=>p*targetChance(a[i],b[i],l.targetCopies),1);}
function knownNonviableChance(a,b,loci){return 1-loci.reduce((p,l,i)=>p*(l.knownAdultNonviableHomozygote?1-a[i]*b[i]/4:1),1);}
function canParent(copies,loci,sex){return loci.every((l,i)=>l.allowed[sex==='Male'?'sire':'dam'].includes(copies[i]));}
function canOffspring(copies,loci){return loci.every((l,i)=>l.allowed.offspring.includes(copies[i]));}
function predictionFor(a,b,loci,config){
 const r=predictCross({...config,sire:parentFor(a,loci,'Male','virtual-sire'),dam:parentFor(b,loci,'Female','virtual-dam')});
 return {genotypeTargetProbability:r.genotypeTargetProbability,targetProbability:r.targetProbability,sexProbability:r.sexProbability,expectedConceptions:r.expectedPups,confidenceConceptions:r.confidencePups,nominalExpectedLitters:r.expectedLitters,nominalConfidenceLitters:r.confidenceLitters,knownNonviableGenotypeProbability:knownNonviableChance(a,b,loci),livebornProbability:null,probabilityBasis:'conception_genotype'};
}
function idealParents(loci,config){
 let combos=[{sire:[],dam:[],probability:1,key:''}];
 for(const l of loci){const options=[];for(const sire of l.allowed.sire)for(const dam of l.allowed.dam){const p=targetChance(sire,dam,l.targetCopies);if(p>0)options.push({sire,dam,p,risk:l.knownAdultNonviableHomozygote?sire*dam/4:0});}const best=Math.max(0,...options.map(o=>o.p));if(!best)return [];const leastRisk=Math.min(...options.filter(o=>o.p===best).map(o=>o.risk));
  combos=combos.flatMap(c=>options.filter(o=>o.p===best&&o.risk===leastRisk).map(o=>({sire:[...c.sire,o.sire],dam:[...c.dam,o.dam],probability:c.probability*o.p,key:c.key+o.sire+o.dam}))).sort(byProbability).slice(0,64);
 }
 const rows=combos.map((c,i)=>({id:'ideal-'+(i+1),reciprocalId:null,type:'ideal-ready-parents',sire:parentFor(c.sire,loci,'Male','ideal-'+(i+1)+'-sire'),dam:parentFor(c.dam,loci,'Female','ideal-'+(i+1)+'-dam'),prediction:predictionFor(c.sire,c.dam,loci,config),_sire:c.sire,_dam:c.dam}));
 for(const row of rows){const reciprocal=rows.find(r=>pairKey(r._sire)===pairKey(row._dam)&&pairKey(r._dam)===pairKey(row._sire));row.reciprocalId=reciprocal&&reciprocal!==row?reciprocal.id:null;}for(const row of rows){delete row._sire;delete row._dam;}return rows;
}

/** Dynamic programming over disjoint founder subsets, with carrier and fixed
 * stock states. The ranking is limited to these declared assembly templates. */
function founderRoutes(loci,config,timing,founderCopies,wildTypeAvailable){
 const n=loci.length,all=(1<<n)-1,states=new Map(),options=new Map(),zeros=Array(n).fill(0),allowed=(a,b)=>canParent(a.copies,loci,'Male')&&canParent(b.copies,loci,'Female');
 const stock=(id,mask,copies,label)=>({id,mask,copies,label,generation:0,birthDay:null,weanDay:null,readyDay:timing.founderReadyDay,cross:null,source:'assumed_founder_stock'});
 let wt=null;if(wildTypeAvailable){wt=stock('founder-wild-type',0,zeros,'Assumed wild-type stock');states.set(wt.id,wt);options.set(0,[wt]);}
 const add=s=>{states.set(s.id,s);const list=options.get(s.mask)??[];if(!list.some(x=>pairKey(x.copies)===pairKey(s.copies)))list.push(s);else {const i=list.findIndex(x=>pairKey(x.copies)===pairKey(s.copies));if(s.readyDay<list[i].readyDay)list[i]=s;}options.set(s.mask,list);};
 const cross=(id,mask,copies,a,b,label)=>{
  if(!canOffspring(copies,loci))return null;let sire=a,dam=b;if(!allowed(sire,dam)){sire=b;dam=a;if(!allowed(sire,dam))return null;}
  let p=1;for(let i=0;i<n;i++){const pa=sire.copies[i]/2,pb=dam.copies[i]/2;p*=copies[i]===0?(1-pa)*(1-pb):copies[i]===1?pa*(1-pb)+(1-pa)*pb:pa*pb;}if(!p)return null;
  const birthDay=Math.max(a.readyDay,b.readyDay)+timing.gestationDays;return {id,mask,copies,label,generation:Math.max(a.generation,b.generation)+1,birthDay,weanDay:birthDay+timing.weaningAgeDays,readyDay:birthDay+Math.max(timing.breedingAgeDays,timing.weaningAgeDays),cross:{sire,dam,probability:p},source:'selected_virtual_offspring'};
 };
 const better=(a,b)=>!b||a.readyDay<b.readyDay||a.readyDay===b.readyDay&&(a.cross?.probability??1)>(b.cross?.probability??1)||a.readyDay===b.readyDay&&(a.cross?.probability??1)===(b.cross?.probability??1)&&a.id<b.id;
 for(let i=0;i<n;i++){const mask=1<<i,copies=zeros.map((_,j)=>j===i?founderCopies[i]:0),s=stock('founder-'+(i+1),mask,copies,'Assumed '+loci[i].name+' stock');add(s);if(founderCopies[i]===2&&wt){const carrier=cross('assembly-'+mask+'-carrier',mask,copies.map(c=>c?1:0),s,wt,'Selected '+loci[i].name+' heterozygote');if(carrier)add(carrier);}if(founderCopies[i]===1){const fixed=cross('assembly-'+mask+'-fixed',mask,copies.map(c=>c?2:0),s,s,'Selected '+loci[i].name+' homozygote');if(fixed)add(fixed);}}
 for(let width=2;width<=n;width++)for(let mask=1;mask<=all;mask++){if(countBits(mask)!==width)continue;let best=null;const copies=zeros.map((_,i)=>(mask&(1<<i))?1:0);
  for(let a=(mask-1)&mask;a;a=(a-1)&mask){const b=mask^a;if(!b||a>b)continue;for(const sire of options.get(a)??[])for(const dam of options.get(b)??[]){const s=cross('assembly-'+mask+'-carrier',mask,copies,sire,dam,'Selected combined heterozygotes');if(s&&better(s,best))best=s;}}
  if(best){add(best);const fixed=cross('assembly-'+mask+'-fixed',mask,copies.map(c=>c?2:0),best,best,'Selected combined homozygotes');if(fixed)add(fixed);}
 }
 const candidates=[];for(let a=0;a<=all;a++)for(let b=0;b<=all;b++){if((a|b)!==all)continue;for(const sire of options.get(a)??[])for(const dam of options.get(b)??[]){if(!allowed(sire,dam))continue;const p=probability(sire.copies,dam.copies,loci);if(!p)continue;candidates.push({sire,dam,probability:p,knownNonviableRisk:knownNonviableChance(sire.copies,dam.copies,loci),birthDay:Math.max(sire.readyDay,dam.readyDay)+timing.gestationDays,key:sire.id+'|'+dam.id});}}
 candidates.sort((a,b)=>a.birthDay-b.birthDay||b.probability-a.probability||a.knownNonviableRisk-b.knownNonviableRisk||a.key.localeCompare(b.key));
 const selected=[],groups=new Set();for(const c of candidates){const group=[c.sire.id,c.dam.id].sort().join('|');if(groups.has(group))continue;groups.add(group);selected.push(c);const reciprocal=candidates.find(r=>r.sire.id===c.dam.id&&r.dam.id===c.sire.id);if(reciprocal&&reciprocal!==c)selected.push(reciprocal);if(selected.length>=6)break;}
 const routes=selected.slice(0,6).map((c,index)=>{
  const routeId='route-'+(index+1),target=zeros.map((_,i)=>loci[i].targetCopies),final=cross(routeId+'-target',all,target,c.sire,c.dam,'Requested target');if(!final)return null;
  // Preserve the already validated final parent orientation, not a hidden swap.
  final.cross.sire=c.sire;final.cross.dam=c.dam;
  const nodes=new Map(),steps=[];const visit=s=>{if(nodes.has(s.id))return;if(s.cross){visit(s.cross.sire);visit(s.cross.dam);}const calls=callsFor(s.copies,loci);nodes.set(s.id,{id:s.id,label:s.label,calls,generation:s.generation,birthDay:s.birthDay,weanDay:s.weanDay,breedingReadyDay:s.readyDay,source:s.source,hypothetical:true});if(s.cross){const a=s.cross.sire,b=s.cross.dam,founder=a.generation===0?a:b.generation===0?b:null,other=founder===a?b:a,crossType=a.generation===0&&b.generation===0?'founder_cross':a.id===b.id?'intercross':founder&&(founder.mask&other.mask)===founder.mask?'backcross':'intermediate_cross';steps.push({id:s.id,label:'G'+s.generation+' · '+s.label,crossType,generation:s.generation,sireId:s.cross.sire.id,damId:s.cross.dam.id,sire:parentFor(s.cross.sire.copies,loci,'Male',s.cross.sire.id+'-selected-sire'),dam:parentFor(s.cross.dam.copies,loci,'Female',s.cross.dam.id+'-selected-dam'),offspring:{calls,hypothetical:true},genotypeProbability:s.cross.probability,targetProbability:s===final?s.cross.probability*(config.sex==='Any'?1:0.5):null,birthDay:s.birthDay,weanDay:s.weanDay,breedingReadyDay:s.readyDay});}};visit(final);
  const edges=steps.flatMap(s=>[{from:s.sireId,to:s.id,role:'sire'},{from:s.damId,to:s.id,role:'dam'}]);return {id:routeId,reciprocalId:null,label:index===0?'Fastest modeled founder route':'Alternative modeled founder route',type:'single-strain-founder-assembly',generations:final.generation,steps,pedigree:{nodes:[...nodes.values()],edges},sire:parentFor(c.sire.copies,loci,'Male',c.sire.id+'-selected-sire'),dam:parentFor(c.dam.copies,loci,'Female',c.dam.id+'-selected-dam'),prediction:predictionFor(c.sire.copies,c.dam.copies,loci,config),targetBirthDay:final.birthDay,targetWeanDay:final.weanDay,_sire:c.sire.id,_dam:c.dam.id};
 }).filter(Boolean);
 for(const route of routes){const reciprocal=routes.find(r=>r._sire===route._dam&&r._dam===route._sire);route.reciprocalId=reciprocal&&reciprocal!==route?reciprocal.id:null;}for(const r of routes){delete r._sire;delete r._dam;}
 return {routes,modeledCandidates:candidates.length,states:states.size};
}

export function designBreedingStrategy(input){
 const checkedInput=checked(input),{errors,warnings,loci,timing,founderCopies,wildTypeAvailable,config,criticalWarnings=[],targetAdultViable=null,sources=[]}=checkedInput;if(errors.length)return noPlan(errors,warnings,{criticalWarnings,targetAdultViable,sources});
 const idealCrosses=idealParents(loci,config);if(!idealCrosses.length)return noPlan(['No permitted autosomal parent combination can produce this target.'],warnings,{criticalWarnings,targetAdultViable,sources});
 const modeled=founderRoutes(loci,config,timing,founderCopies,wildTypeAvailable);
 if(!modeled.routes.length)warnings.push('No founder route is reachable under the stated stock, wild-type and parent constraints. Ideal ready-parent crosses do not establish stock availability.');
 if(targetAdultViable===false)for(const route of modeled.routes){route.nominalTargetWeanDay=route.targetWeanDay;route.targetWeanDay=null;const final=route.steps.at(-1);if(final){final.nominalWeanDay=final.weanDay;final.weanDay=null;final.breedingReadyDay=null;const node=route.pedigree.nodes.find(n=>n.id===final.id);if(node){node.nominalWeanDay=node.weanDay;node.weanDay=null;node.breedingReadyDay=null;}}}
 return {errors:[],warnings:unique(warnings),criticalWarnings:unique(criticalWarnings),targetAdultViable,sources,assumptions:[
  'All founders and intermediate breeders are hypothetical genotype stocks, not available colony animals. Single-strain founders have only their declared variant; other configured loci are wild type.',
  'Founder stocks are assumed to provide the required male and female breeders. Intermediate genotypes and both required sexes must be obtained and verified; sibling cohorts are not one animal.',
  ...(wildTypeAvailable?['An unrelated hypothetical wild-type stock is included.']:['No wild-type founder stock is included.']),
  'Probabilities concern conception genotypes under autosomal Mendelian transmission. Survival, fertility, penetrance, recombination, treatment and liveborn target yield are not established.',
  ...(loci.length>1?['Configured loci are modeled as independently assorting. Sex contributes a separate 1/2 factor when requested.']:[]),
  'Fastest means the earliest birth among modeled disjoint-founder assembly and carrier/fixed-stock routes. It is not a global breeding optimum.',
  'When timing and target probability tie, routes avoid documented nonviable homozygous genotypes where possible. This does not estimate overall survival.',
  'Time is conditional on obtaining the selected offspring at the first modeled birth, with no extra mating, genotyping or recovery delay. Rare genotypes, small litters, failure or unequal sex ratios can delay it.',
  'Count estimates describe independent conceptions. Nominal litter estimates use the supplied litter size and do not predict liveborn or weaned animal counts.'
 ],idealCrosses,routes:modeled.routes,fastestRouteId:modeled.routes[0]?.id??null,timing:{...timing},founderAssumptions:{copiesByLocus:Object.fromEntries(loci.map((l,i)=>[l.id,founderCopies[i]])),wildTypeAvailable,bothSexesAssumed:true},limits:{...BREEDING_STRATEGY_LIMITS,modeledCandidates:modeled.modeledCandidates,statesEvaluated:modeled.states}};
}
