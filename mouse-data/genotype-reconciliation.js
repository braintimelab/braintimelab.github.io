import {validateGeneticProfile} from './genotype-schema.js?v=100';
import {validAppPermissions} from './app-access.js?v=175';
import {getDeferredManagedTables} from './current-record-scope.js?v=169';

const copy=structuredClone,object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const normalized=value=>typeof value==='string'&&value.trim()?value.trim():null;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&/^\d{4}-\d\d-\d\dT/.test(value)&&new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===value.slice(0,10);

/** Read coverage and field projection are distinct. The host must pass fresh
 * verified store status; a missing genetic_profile property is never proof. */
export function genotypeEvidenceCapability(dataset,status,{trustedLocal=false}={}){
 const deny=reason=>({allowed:false,reason});
 if(!dataset?.tables||dataset.history_projection?.read_only)return deny('Open the current colony with complete genotype evidence.');
 try{if(getDeferredManagedTables(dataset).includes('mice'))return deny('Load the complete mouse table before reviewing genotypes.');}catch{return deny('Mouse read coverage is unavailable. Reload the colony.');}
 if(status?.mode==='local')return trustedLocal===true?{allowed:true,reason:'Trusted complete local genotype workspace.'}:deny('This local workspace has no verified full-genotype evidence capability.');
 if(status?.mode!=='cloud'||status.signedIn!==true||status.readyForEdits!==true||!['cloud1','cloud2'].includes(status.activeCloud))return deny('Reconnect and verify the current shared workspace before changing genotype evidence.');
 if(status.guestLevel!=null||status.guest_level!=null||!['owner','manager','editor','viewer'].includes(status.role))return deny('This account receives a bounded genotype projection.');
 if(status.role!=='owner'){
  const permissions=status.mousePermissions??status.mouse_permissions;
  if(!validAppPermissions('mouse',permissions)||Object.entries(permissions).some(([key,value])=>/^mouse\..+\.read$/.test(key)&&value===false))return deny('Read restrictions can hide existing allele calls. Use an account with complete Mouse read evidence.');
 }
 return {allowed:true,reason:'Complete current mouse coverage and unbounded Mouse field permissions verified.'};
}

/** Specimen dependencies are unchanged compare-and-swap records. The reviewed
 * writer returns editor/owner no-ops before the update ACL trigger; managers
 * still pass their legacy experiments permission before that no-op return. */
export function genotypeSpecimenGuardCapability(status,{trustedLocal=false}={}){
 if(status?.mode==='local')return {allowed:trustedLocal===true,reason:trustedLocal===true?'Trusted complete local specimen workspace.':'Verify the complete local specimen workspace first.'};
 if(status?.mode!=='cloud'||status.signedIn!==true||status.readyForEdits!==true||!['cloud1','cloud2'].includes(status.activeCloud)||status.guestLevel!=null||status.guest_level!=null)return {allowed:false,reason:'Reconnect the current shared workspace before guarding specimen identity.'};
 if(['owner','editor'].includes(status.role))return {allowed:true,reason:'Unchanged specimen identity guards are allowed for this role.'};
 if(status.role==='manager')return {allowed:status.permissions?.experiments===true,reason:status.permissions?.experiments===true?'Manager specimen compare-and-swap permission verified.':'Specimen-linked imports require the manager Experiments permission to guard the recorded specimen identity. Use reviewed mouse SIDs instead, or ask the owner to review your permission.'};
 return {allowed:false,reason:'An active colony write role is required for specimen identity guards.'};
}

export function requiresGenotypeReconciliation(original,nextText){
 return normalized(original?.genotype)!==normalized(nextText)&&original?.genetic_profile!=null;
}

/** A text edit does not parse, replace, or remove reviewed allele calls.
 * Explicit keep_profile records the discrepancy for subsequent displays. */
export function reconcileGenotypeText(original,nextText,{decision=null,at=new Date().toISOString(),fullGenotypeEvidence=false}={}){
 const draft=object(original)?copy(original):original,errors=[],warnings=[];
 if(!object(original)||typeof original.mouse_sid!=='string')return {draft,errors:['Choose an existing mouse record.'],warnings,needsReview:false};
 if(nextText!==null&&typeof nextText!=='string'||typeof nextText==='string'&&(nextText.length>2048||/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(nextText)))return {draft,errors:['Genotype text must be at most 2,048 characters, or blank.'],warnings,needsReview:false};
 const text=normalized(nextText),changed=normalized(original.genotype)!==text;
 if(!changed)return {draft,errors,warnings,needsReview:false};
 if(fullGenotypeEvidence!==true)return {draft,errors:['Complete genotype evidence is required: a restricted view may hide reviewed allele calls.'],warnings,needsReview:true};
 if(!timestamp(at))return {draft,errors:['A valid review timestamp is required.'],warnings,needsReview:true};
 const needsReview=requiresGenotypeReconciliation(original,text);
 if(needsReview){
  const invalid=validateGeneticProfile(original.genetic_profile);
  if(invalid.length)return {draft,errors:['The existing structured genotype needs review before changing its display text. '+invalid.join(' ')],warnings,needsReview:true};
  if(decision!=='keep_profile')return {draft,errors:['Review the existing allele calls and explicitly keep them, or cancel and update the allele calls instead.'],warnings:['Changing genotype text does not change reviewed allele calls.'],needsReview:true};
  draft.genetic_profile=copy(original.genetic_profile);
  draft.genetic_profile.text_reconciliation={schema_version:1,status:'profile_retained_after_text_edit',before_text:normalized(original.genotype),display_text:text,reviewed_at:at,decision:'keep_profile'};
  warnings.push('Display text changed; existing reviewed allele calls were explicitly retained. Planning continues to use those allele calls.');
 }
 draft.genotype=text;draft.genotype_status=text===null?'not_recorded':'user_entered';delete draft.genotype_inference;
 return {draft,errors,warnings,needsReview:false};
}

/** Display this beside genotype text and allele calls in mouse/family/planner
 * views. It is deliberately persistent rather than a one-time toast. */
export function genotypeReconciliationWarnings(mouse){
 const record=mouse?.genetic_profile?.text_reconciliation;
 if(record?.status==='display_text_retained_after_results')return ['Allele calls were recorded while the existing genotype text was explicitly retained. Planning uses the allele calls; review the display text before reusing it.'];
 if(record?.status!=='profile_retained_after_text_edit')return [];
 return ['Genotype text and structured allele calls were reviewed separately. The allele calls were retained; Planning uses those calls. Review them before treating the display text as a replacement result.'];
}

/** Batch text editors may add a review notice, but cannot use that permission
 * to replace allele evidence or alter any other structured-profile property. */
export function validateGenotypeTextReconciliation(original,draft){
 if(same(original?.genetic_profile,draft?.genetic_profile))return [];
 const before=original?.genetic_profile,after=draft?.genetic_profile;
 if(!object(before)||!object(after))return ['A genotype text review cannot create or remove a structured profile.'];
 const errors=[...validateGeneticProfile(before),...validateGeneticProfile(after)];
 const strip=profile=>Object.fromEntries(Object.entries(profile).filter(([key])=>key!=='text_reconciliation'));
 if(!same(strip(before),strip(after)))errors.push('A genotype text review must retain every existing allele call, locus and evidence field unchanged.');
 const note=after.text_reconciliation,allowed=['schema_version','status','before_text','display_text','reviewed_at','decision'];
 if(!object(note)||Object.keys(note).length!==allowed.length||Object.keys(note).some(key=>!allowed.includes(key))||note.schema_version!==1||note.status!=='profile_retained_after_text_edit'||note.decision!=='keep_profile'||!timestamp(note.reviewed_at)||note.before_text!==normalized(original.genotype)||note.display_text!==normalized(draft.genotype)||normalized(original.genotype)===normalized(draft.genotype))errors.push('Record an explicit, current keep-profile decision for the changed genotype text.');
 return [...new Set(errors)];
}

/** A deliberate structured-profile review preserves unchanged assay records.
 * Changed calls get fresh review attribution; old assay metadata stays only
 * with its original call in the append-only review history. */
export function prepareReviewedGenotypeProfile(original,{loci,calls,notes='',at=new Date().toISOString(),reviewId,fullGenotypeEvidence=false}={}){
 const draft=object(original)?copy(original):original,errors=[],warnings=[];
 const output={draft,errors,warnings};
 if(!object(original)||typeof original.mouse_sid!=='string'||fullGenotypeEvidence!==true){errors.push('Complete genotype evidence is required before replacing reviewed allele calls.');return output;}
 if(!timestamp(at)||typeof reviewId!=='string'||!reviewId.trim()||reviewId.length>100||!Array.isArray(loci)||!object(calls)){errors.push('Use a valid profile review identity, timestamp and explicit allele calls.');return output;}
 const old=original.genetic_profile==null?{}:original.genetic_profile;
 if(original.genetic_profile!=null&&validateGeneticProfile(old).length){errors.push('Review the malformed existing profile before replacing allele evidence.');return output;}
 if(old.result_history!=null&&!Array.isArray(old.result_history)){errors.push('The existing genotype result history needs review.');return output;}
 const profile=copy(old),definitions=new Map((old.loci||[]).map(locus=>[locus.id,copy(locus)]));profile.calls=copy(old.calls||{});
 const shape=locus=>locus?{id:locus.id,name:locus.name,kind:locus.kind,chromosome:locus.chromosome,alleles:locus.alleles}:null;
 const seen=new Set(),updates=[];
 for(const locus of loci){
  if(!object(locus)||typeof locus.id!=='string'||seen.has(locus.id)){errors.push('Review each locus once.');continue;}seen.add(locus.id);
  const supplied=calls[locus.id],next={alleles:Array.isArray(supplied?.alleles)?copy(supplied.alleles):[],evidence:supplied?.evidence??'unknown'};
  const priorDefinition=definitions.get(locus.id),prior=profile.calls[locus.id];
  if(same(shape(priorDefinition),shape(locus))&&prior&&same(prior.alleles,next.alleles)&&prior.evidence===next.evidence)continue;
  const after={...next,recorded_at:at,result_source:{kind:'manual_profile_review',review_id:reviewId}};
  updates.push({schema_version:1,kind:'planner_profile_review',review_id:reviewId,locus_id:locus.id,recorded_at:at,before_definition:priorDefinition?copy(priorDefinition):null,after_definition:copy(locus),before:prior?copy(prior):null,after:copy(after),reviewed_replacement:true,...(old.text_reconciliation?{before_text_reconciliation:copy(old.text_reconciliation)}:{})});
  definitions.set(locus.id,copy(locus));profile.calls[locus.id]=after;
 }
 if(errors.length)return output;
 if((profile.result_history?.length||0)+updates.length>1000){errors.push('Result history is full. Review archival handling before adding more results.');return output;}
 profile.schema_version=1;profile.loci=[...definitions.values()];profile.recorded_at=at;profile.notes=notes;
 if(updates.length){profile.result_history=[...(profile.result_history||[]),...updates];profile.text_reconciliation={schema_version:1,status:'display_text_retained_after_results',display_text:normalized(original.genotype),reviewed_at:at,decision:'retain_text'};}
 errors.push(...validateGeneticProfile(profile));if(errors.length)return output;
 draft.genetic_profile=profile;draft.app_modified_at=at;assertGenotypeProfilesPreserved(original,draft);warnings.push(...genotypeReconciliationWarnings(draft));return output;
}

export function assertGenotypeProfilesPreserved(original,draft){
 if(!object(original)||!object(draft)||original.mouse_sid!==draft.mouse_sid)throw new Error('Keep the exact existing mouse identity.');
 for(const field of ['canonical_sid','legacy_sids','sire_sids','dam_sids','litter_sid','date_of_birth'])if(!same(original[field],draft[field]))throw new Error('Genotype review cannot change identity, pedigree or birth date.');
 for(const field of Object.keys(original))if(field.startsWith('source_')&&!same(original[field],draft[field]))throw new Error('Genotype review cannot change source evidence.');
 return true;
}
