import {canonicalCombinedGenotype} from './strain-registry.js?v=146';
import {buildFamilyGenotypes} from './family-genotypes.js?v=146';
import {formatMouseSid} from './mouse-sid.js?v=188';

/** A label from this animal's recorded genotype, never parents, line names or
 * existing physical tags. Formatting does not create or confirm allele calls. */
export function mouseGenotypeTagPrefix(mouse={}){
 const genotype=typeof mouse.genotype==='string'?mouse.genotype.trim():'';
 if(!genotype&&!mouse.genetic_profile)return '';
 const own={mouse_sid:'auto-tag-preview',state:'Stock',genotype,genetic_profile:mouse.genetic_profile};
 const animal=buildFamilyGenotypes({tables:{mice:[own]}},{scope:'all'}).animals[0];
 const compact=canonicalCombinedGenotype(genotype);
 // Explicit compact calls use the same prime/pending formatter as the registry.
 if(compact&&!mouse.genetic_profile)return compact;
 const traits=animal?.traits||[];
 if(!traits.length||traits.some(trait=>trait.code.startsWith('locus:')||trait.sharedLocusConflict))return '';
 const present=traits.filter(trait=>trait.presence!=='absent');
 return canonicalCombinedGenotype(present.map(({code,presence,dosage,dosageUncertain})=>({code,presence,dosage,dosageUncertain})))||'';
}

/** SID identity stays five digits. Printed tag numbers have at least four
 * digits and expand at 10000; they are never truncated or taken modulo 10000. */
export function automaticSidTagNumber(value){
 const sid=formatMouseSid(value);return /^\d{5}$/.test(sid)&&BigInt(sid)>0n?String(BigInt(sid)).padStart(4,'0'):null;
}
export function automaticMousePhysicalTag(mouse={}){
 const prefix=mouseGenotypeTagPrefix(mouse),sid=formatMouseSid(mouse.canonical_sid||mouse.mouse_sid);
 if(!prefix||!/^\d{5}$/.test(sid)||BigInt(sid)<1n)return null;
 const sex={Male:'M',Female:'F',Unknown:'U'}[mouse.sex];if(!sex)return null;
 return `${prefix}-${sex}${automaticSidTagNumber(sid)}`;
}
