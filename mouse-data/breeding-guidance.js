/* Public reference guidance checked 2026-10-18 against official JAX datasheets
 * (including their public embedded stock records) and MGI allele records.
 * Exact catalog matches annotate hypothetical planning, never animal genotypes,
 * local genetic backgrounds, actual fertility, or treatment/recombination. */
export const BREEDING_GUIDANCE_CHECKED_AT='2026-10-18';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const source=(label,url)=>({label,url,checkedAt:BREEDING_GUIDANCE_CHECKED_AT});
export const BREEDING_GUIDANCE_SOURCES=freeze({
 colonyPlanning:source('JAX: colony planning','https://www.jax.org/jax-mice-and-services/customer-support/technical-support/breeding-and-husbandry-support/colony-planning'),
 creGermline:source('JAX: Cre expression and germline recombination','https://www.jax.org/news-and-insights/jax-blog/2016/may/are-your-cre-lox-mice-deleting-what-you-think-they-are'),
 creBreeding:source('JAX: Cre-lox breeding','https://resources.jax.org/jax-blog/cre-lox-breeding-for-beginners-part-1')
});
export const BREEDING_TIMING_GUIDANCE=freeze({
 checkedAt:BREEDING_GUIDANCE_CHECKED_AT,
 defaults:{founderReadyDay:0,breedingAgeDays:56,gestationDays:21,weaningAgeDays:21},
 referenceRanges:{breedingAgeDays:[42,56],gestationDays:[19,21],weaningAgeDays:[21,28],litterSize:[2,12]},
 notes:[
  'Planning defaults use breeding at 8 weeks, gestation of 21 days and weaning at 21 days. These are assumptions, not predictions for an individual pregnancy.',
  'Mating success, strain, parental condition, genotyping, recovery and obtaining both required sexes can add time. Litter size is strongly strain dependent.'
 ],sources:[BREEDING_GUIDANCE_SOURCES.colonyPlanning]
});
const creWarning='Cre inheritance does not establish deletion or reporter activation. Check parental sex, germline recombination and treatment for the exact Cre line and target allele; there is no universal safe-parent-sex rule.';
const exactScope='Exact catalog reference only. Confirm the local stock and allele before using its breeding constraints; this does not verify any animal or local genetic background.';
const base=(stock,name,chromosome,mgi,details)=>({stock,name,chromosome,checkedAt:BREEDING_GUIDANCE_CHECKED_AT,catalogOnly:true,stockIdentity:exactScope,applicability:'exact_catalog_reference',sameLocusGroup:null,
 constraints:{allowedCopies:[0,1,2],sireAllowedCopies:[0,1,2],damAllowedCopies:[0,1,2],offspringAllowedCopies:[0,1,2]},
 homozygousAdultViable:null,homozygousFertile:null,homozygousTargetWarning:null,parentSexRestriction:null,germlineEvidence:'No stock-specific parent-sex prohibition established by these checked references.',
 sources:[source('JAX '+stock,'https://www.jax.org/strain/'+stock),source('MGI allele '+mgi,'https://www.informatics.jax.org/allele/MGI:'+mgi)],...details});
export const REFERENCE_BREEDING_GUIDANCE=freeze({
 '006852':base('006852','PER2::LUC','1','3040876',{
  homozygousAdultViable:true,homozygousFertile:true,
  evidence:'JAX reports viable, fertile homozygous Per2tm1Jt reporter mice.',
  warnings:['PER2::LUC reference homozygotes are documented as viable and fertile. Crossed local backgrounds and compound genotypes still need verification.']
 }),
 '007668':base('007668','Bmal1-flox','7','3720808',{
  homozygousAdultViable:true,homozygousFertile:true,
  evidence:'JAX reports viable, fertile homozygotes for the unrecombined exon-8 floxed Bmal1 allele.',
  warnings:['Bmal1-flox homozygous fertility applies to the unrecombined conditional allele. Cre-mediated deletion, a null allele, and other Bmal1 constructs are separate cases.']
 }),
 '010908':base('010908','Vip-IRES-Cre','10','4431361',{
  homozygousAdultViable:true,homozygousFertile:true,
  evidence:'JAX permits homozygous colony maintenance and reports viable, fertile homozygotes, while noting reduced Vip expression.',
  warnings:['Vip-IRES-Cre can reduce endogenous Vip expression. JAX recommends considering heterozygotes and wild-type littermate controls for studies, even though homozygotes can be bred.',creWarning],
  sources:[source('JAX 010908','https://www.jax.org/strain/010908'),source('MGI allele 4431361','https://www.informatics.jax.org/allele/MGI:4431361'),BREEDING_GUIDANCE_SOURCES.creGermline]
 }),
 '027012':base('027012','Foxj1-CreERT2::GFP','11','5585638',{
  constraints:{allowedCopies:[0,1,2],sireAllowedCopies:[0,1],damAllowedCopies:[0,1],offspringAllowedCopies:[0,1,2]},
  homozygousAdultViable:false,homozygousFertile:null,
  evidence:'JAX reports postnatal lethality, hydrocephalus and cilia defects in homozygotes; heterozygotes are viable and fertile.',
  homozygousTargetWarning:'Foxj1 JAX 027012 homozygotes have a severe null-like phenotype and postnatal lethality. A conception probability is not a viable adult or breeder yield.',
  germlineEvidence:'JAX describes tamoxifen-induced recombination in spermatocytes and spermatozoa. This is activity evidence, not a measured inherited-recombination rate or a blanket parent-sex rule.',
  warnings:['Foxj1 JAX 027012 breeders must retain a wild-type Foxj1 allele; homozygotes are not modeled as breeding adults.',
   'Tamoxifen-induced activity includes male germ cells. Validate treatment history and inherited recombination before using treated breeders.',creWarning],
  sources:[source('JAX 027012','https://www.jax.org/strain/027012'),source('MGI allele 5585638','https://www.informatics.jax.org/allele/MGI:5585638'),BREEDING_GUIDANCE_SOURCES.creGermline]
 }),
 '023530':base('023530','AVP-IRES2-Cre-D','2','5522761',{
  evidence:'JAX documents viable, fertile heterozygotes; its donor description did not characterize homozygotes. Reduced Avp expression is reported.',
  homozygousTargetWarning:'Homozygous AVP-IRES2-Cre-D viability and fertility are not established by the checked JAX description. A homozygous route is hypothetical and requires verification.',
  warnings:['AVP-IRES2-Cre-D can reduce endogenous Avp expression. JAX recommends considering heterozygotes and wild-type littermate controls for studies.',
   'Homozygous AVP-IRES2-Cre-D is uncharacterized in the checked donor description, not documented as sterile or lethal.',creWarning],
  sources:[source('JAX 023530','https://www.jax.org/strain/023530'),source('MGI allele 5522761','https://www.informatics.jax.org/allele/MGI:5522761'),BREEDING_GUIDANCE_SOURCES.creGermline]
 }),
 '028866':base('028866','Ai96 (C57BL/6J)','6','5558094',{
  sameLocusGroup:'rosa26',
  evidence:'The JAX description reports viable, fertile heterozygotes and uncharacterized homozygotes; its original phenotype characterization used a mixed background.',
  homozygousTargetWarning:'Ai96 homozygous viability and fertility are not established by the checked JAX description. Verify before treating homozygous animals as viable breeders or an adult target.',
  warnings:['Ai96 homozygous viability and fertility are uncharacterized in the checked donor description; this is not proof of lethality.',
   'JAX 028866 is the C57BL/6J-congenic reference; the original phenotype description concerns a mixed background and may differ locally.',
   'Ai96 and Ai32 are alternative alleles at the same Rosa26 locus, not two independently assorting loci.']
 }),
 '012569':base('012569','Ai32','6','5013789',{
  sameLocusGroup:'rosa26',homozygousAdultViable:true,homozygousFertile:true,
  evidence:'JAX reports viable, fertile homozygotes for the conditional Ai32 reporter allele.',
  warnings:['Ai32 homozygous viability and fertility concern the conditional reference allele. Cre activation and compound genotypes need separate validation.',
   'Ai32 and Ai96 are alternative alleles at the same Rosa26 locus, not two independently assorting loci.']
 }),
 '005864':base('005864','APP/PS1','9','3524957',{
  evidence:'JAX documents APPswe and PSEN1dE9 co-integration at one chromosome-9 locus and maintenance as a hemizygous line. Homozygous fertility is not established here.',
  copyInterpretation:'Copies in this diploid model count insertion-bearing homologs, not the number of tandem molecular transgene copies.',
  homozygousTargetWarning:'APP/PS1 homozygous viability and fertility are not established by the checked reference. Do not treat a two-copy model as a validated colony-maintenance scheme.',
  warnings:['APPswe and PSEN1dE9 are inherited as one co-integrated insertion locus for this stock, not two independent loci.',
   'APP/PS1 molecular transgene copy number is not the diploid insertion-allele count used here. Homozygous viability and fertility remain unverified.',
   'The JAX description reports seizures and premature mortality in hemizygotes on the C57BL/6J-congenic background; survival is not a Mendelian probability.']
 })
});

// Gene aliases, display names, first-name codes and arbitrary six-digit numbers
// in notes are deliberately insufficient to establish a specific stock.
function explicitStock(value){
 if(typeof value!=='string')return null;const s=value.trim();if(!s)return null;
 let match=s.match(/^(?:JAX\s*[:#-]?\s*)?(\d{6})$/i);if(match)return match[1];
 try{const u=new URL(s);if(u.protocol==='https:'&&['www.jax.org','jax.org'].includes(u.hostname)&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&(match=u.pathname.match(/^\/strain\/(\d{6})\/?$/)))return match[1];}catch{}
 const refs=[...s.matchAll(/\bJAX(?:\s+(?:stock|strain))?\s*[:#-]?\s*(\d{6})\b/gi)].map(m=>m[1]);const unique=[...new Set(refs)];return unique.length===1?unique[0]:null;
}
export function getBreedingGuidance(locusOrStock){
 const raw=typeof locusOrStock==='string'?[locusOrStock]:locusOrStock&&typeof locusOrStock==='object'&&!Array.isArray(locusOrStock)?['stockReference','stock_reference','stockNumber','referenceStock','stock'].map(k=>locusOrStock[k]).filter(v=>typeof v==='string'&&v.trim()):[];
 const supplied=raw.map(explicitStock),stocks=[...new Set(supplied.filter(Boolean))];
 if(stocks.length!==1||supplied.some(v=>v===null)||!Object.hasOwn(REFERENCE_BREEDING_GUIDANCE,stocks[0]))return null;
 return structuredClone({...REFERENCE_BREEDING_GUIDANCE[stocks[0]],matchedBy:'explicit_stock_reference'});
}
