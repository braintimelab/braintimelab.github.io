import {prepareMouseRegistrationBatch,resolveMouseSid} from './mouse-registration-batch.js?v=188';
import {mouseRegistrationDependencies,MOUSE_BATCH_LIMIT} from './mouse-registration.js?v=188';
import {validateRecord} from './model.js?v=188';

const copy=structuredClone,ids=value=>Array.isArray(value)?[...value]:[];
const keys={mice:'mouse_sid',matings:'mating_sid',litters:'litter_sid',cages:'cage_sid',locations:'location_id',rooms:'room_id',racks:'rack_id'};
const rows=(data,type)=>data?.tables?.[type]||[];
const find=(data,type,id)=>rows(data,type).find(row=>String(row[keys[type]])===String(id));
const available=row=>row&&!row.archived&&!row.app_archived_at&&!row.history_read_only;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const nonempty=value=>typeof value==='string'&&value.trim()?value.trim():null;
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const unique=dependencies=>[...new Map(dependencies.map(row=>[row.type+':'+row.id,row])).values()];
const parentIds=(data,value)=>ids(value).map(id=>resolveMouseSid(data,id));

/** Completion edits existing current records only. A pedigree shadow is never a writable payload; shared
 * parents never establish a recorded litter. Lifecycle state is retained. */
export function isUntaggedCompletionRecord(mouse){
 return Boolean(mouse&&mouse.mouse_sid!=null&&String(mouse.mouse_sid).trim()&&!mouse._derived&&!mouse.history_read_only&&!mouse.source_historical&&!mouse.member_projection&&!mouse.guest_projection&&!/^historical_(?:snapshot|assignment)_projection$/.test(mouse.record_origin||'')&&(mouse.physical_tag==null||typeof mouse.physical_tag==='string'&&!mouse.physical_tag.trim()));
}
export function isUntaggedCompletionMouse(mouse){return isUntaggedCompletionRecord(mouse)&&!mouse.archived&&!mouse.app_archived_at;}
export function untaggedMouseCompletion(dataset,mouseSid){
 const unavailable={mouseSid:null,litterSid:null,siblingIds:[],reason:'This mouse is unavailable or read-only. Open a current full mouse record to complete its details.'};
 if(dataset?.history_projection?.read_only||mouseSid==null||!String(mouseSid).trim())return unavailable;
 const mice=rows(dataset,'mice'),matches=mice.filter(mouse=>String(mouse.mouse_sid)===String(mouseSid));
 if(matches.length!==1||!isUntaggedCompletionRecord(matches[0]))return unavailable;
 const mouse=matches[0],result={mouseSid:String(mouse.mouse_sid),litterSid:null,siblingIds:[],reason:'No recorded litter is available. Complete this mouse individually; shared parents do not establish a litter.'};
 if(mouse.archived||mouse.app_archived_at)return{...result,reason:'This archived mouse can be completed individually. Batch completion uses nonarchived saved litter members.'};
 if(mouse.litter_sid==null||!String(mouse.litter_sid).trim())return result;
 const litters=rows(dataset,'litters').filter(litter=>String(litter.litter_sid)===String(mouse.litter_sid));
 if(litters.length!==1||!available(litters[0])||litters[0]._derived||litters[0].member_projection||litters[0].guest_projection||litters[0].source_historical)return result;
 try{createLitterRegistrationContext(dataset,{litterSid:String(litters[0].litter_sid)});}catch{return result;}
 const siblings=mice.filter(row=>String(row.litter_sid)===String(mouse.litter_sid)&&isUntaggedCompletionMouse(row)),siblingIds=siblings.map(row=>String(row.mouse_sid));
 if(siblingIds.length>MOUSE_BATCH_LIMIT||new Set(siblingIds).size!==siblingIds.length||siblingIds.some(id=>mice.filter(row=>String(row.mouse_sid)===id).length!==1))return{...result,reason:'This litter needs individual review before batch completion. No mice will be created or guessed.'};
 return{...result,litterSid:String(litters[0].litter_sid),siblingIds,reason:''};
}

/** Litter identity follows the selected mating, independently of mouse SIDs.
 * Concurrent attempts choose the same next identity and expected_version=0
 * rejects the second creation; this is not a second mouse-ID allocator. */
export function nextLitterSid(dataset,matingSid){
 if(!nonempty(matingSid)||matingSid.length>180)throw new Error('Choose an existing mating with a valid SID.');
 const prefix=matingSid+'.',used=new Set(rows(dataset,'litters').map(row=>String(row.litter_sid)));let ordinal=BigInt(rows(dataset,'litters').filter(row=>String(row.mating_sid)===matingSid).length)+1n;
 for(const sid of used)if(sid.startsWith(prefix)&&/^[1-9][0-9]*$/.test(sid.slice(prefix.length))){const value=BigInt(sid.slice(prefix.length));if(value>=ordinal)ordinal=value+1n;}
 while(used.has(prefix+ordinal))ordinal++;
 const sid=prefix+ordinal;if(sid.length>200)throw new Error('The next litter SID is too long. Review this mating.');return sid;
}

export function createLitterRegistrationContext(dataset,{matingSid=null,litterSid=null,asOf=new Date().toISOString().slice(0,10)}={}){
 if(dataset?.history_projection?.read_only)throw new Error('Return to the current colony before registering siblings.');
 const litter=litterSid?find(dataset,'litters',litterSid):null;
 if(litterSid&&!available(litter))throw new Error('This litter is unavailable. Reload before registering pups.');
 matingSid=litter?.mating_sid||matingSid||null;
 const mating=matingSid?find(dataset,'matings',matingSid):null;
 if(matingSid&&!available(mating)||!litter&&!mating)throw new Error('Choose an available mating before recording its litter.');
 const matingParents={sire_sids:ids(mating?.sire_sids?.length?mating.sire_sids:mating?.male_sids),dam_sids:ids(mating?.dam_sids?.length?mating.dam_sids:mating?.female_sids)};
 const parents={sire_sids:litter?.sire_sids?.length?ids(litter.sire_sids):matingParents.sire_sids,dam_sids:litter?.dam_sids?.length?ids(litter.dam_sids):matingParents.dam_sids};
 const litterDraft=litter?copy(litter):{record_origin:'app_created',litter_sid:nextLitterSid(dataset,String(mating.mating_sid)),mating_sid:String(mating.mating_sid),date_of_birth:asOf,state:'Unweaned',size_reported:'0',...parents};
 const shared={record_origin:'app_created',sex:'Unknown',state:litter?.state==='Ended'?'Unknown':'Stock',physical_tag:null,genotype:null,
  date_of_birth:litterDraft.date_of_birth||null,litter_sid:litterDraft.litter_sid,...parents,
  mouseline:litter?.mouseline||mating?.litter_mouseline||null,strain:litter?.strain||mating?.litter_strain||null,generation:litter?.generation||mating?.litter_generation||null,status:litter?.status||null,
  manager:litter?.manager||litter?.owner||mating?.manager||mating?.owner||null,protocol:litter?.protocol||mating?.protocol||null,
  wean_date:litter?.wean_date||null,cage_sid:null,cage_tag:null};
 // A weaned litter's historical cage must never become its pups' new housing.
 const cageId=litter?(litter.state==='Unweaned'&&!litter.wean_date?litter.cage_sid:null):mating?.cage_sid;
 const cage=cageId?find(dataset,'cages',cageId):null;
 if(available(cage)&&['Active','Occupied'].includes(cage.state)){shared.cage_sid=String(cage.cage_sid);shared.cage_tag=cage.cage_tag||null;}
 const dependencies=[];
 if(litter)dependencies.push({type:'litters',id:String(litter.litter_sid)});
 if(mating)dependencies.push({type:'matings',id:String(mating.mating_sid)});
 for(const id of [...parents.sire_sids,...parents.dam_sids])if(find(dataset,'mice',id))dependencies.push({type:'mice',id:String(id)});
 if(shared.cage_sid)dependencies.push(...mouseRegistrationDependencies(dataset,{...shared,sire_sids:[],dam_sids:[]}));
 const readDependencies=unique(dependencies),guarded=readDependencies.map(row=>({...row,payload:copy(find(dataset,row.type,row.id))}));
 return {existing:Boolean(litter),litterId:String(litterDraft.litter_sid),matingId:mating?String(mating.mating_sid):null,litterDraft,shared,parentCandidates:copy(parents),readDependencies,guarded,
  siblingIds:rows(dataset,'mice').filter(mouse=>String(mouse.litter_sid)===String(litterDraft.litter_sid)).map(mouse=>String(mouse.mouse_sid))};
}

export function assertLitterRegistrationContext(dataset,context){
 if(!context||dataset?.history_projection?.read_only)throw new Error('Reopen the litter from the current colony.');
 for(const guard of context.guarded)if(!same(find(dataset,guard.type,guard.id),guard.payload))throw new Error('The litter, mating, parents or housing changed. Reopen the litter and review again.');
 if(!context.existing&&find(dataset,'litters',context.litterId))throw new Error('This litter SID was already created. Reload the mating before recording another litter.');
}

/** Zero/unknown size creates only a litter. Explicit positive size can supply
 * an unsexed count, but no animal is invented from a missing count. */
export function litterRegistrationCounts(source,{reportedSize=null,existing=false}={}){
 const counts={};let total=0;
 for(const sex of ['Male','Female','Unknown']){const raw=source?.[sex]??0;if(!/^\d+$/.test(String(raw))||!Number.isSafeInteger(Number(raw))||Number(raw)>MOUSE_BATCH_LIMIT)throw new Error(`Enter between 0 and ${MOUSE_BATCH_LIMIT} pups for each sex.`);counts[sex]=Number(raw);total+=counts[sex];}
 const raw=reportedSize===null||reportedSize===''?null:String(reportedSize);
 if(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))throw new Error('Reported litter size must be a whole number, or blank.');
 const reported=raw===null?null:Number(raw);
 if(!existing&&total===0&&reported>0){counts.Unknown=reported;total=reported;}
 if(total>MOUSE_BATCH_LIMIT)throw new Error(`Register at most ${MOUSE_BATCH_LIMIT} pups at a time.`);
 if(existing&&total<1)throw new Error('Enter at least one pup to add to this litter.');
 if(!existing&&reported>0&&total!==reported)throw new Error('Male, female and unsexed counts must add up to the reported litter size.');
 return {counts,total,reportedSize:!existing&&total>0?String(reported||total):raw};
}

export function prepareLitterRegistrationBatch(dataset,context,{litterDraft=context?.litterDraft,sharedDraft=context?.shared,counts,parentsConfirmed=false,sids=null,requestId=null,deferTagValidation=false}={}){
 assertLitterRegistrationContext(dataset,context);
 const litter=context.existing?copy(context.litterDraft):copy(litterDraft);
 const mating=context.matingId?find(dataset,'matings',context.matingId):null;
 if(litter.litter_sid!==context.litterId||String(litter.mating_sid||'')!==String(context.matingId||''))throw new Error('The litter or mating identity changed. Reopen this draft.');
 const parsed=litterRegistrationCounts(counts,{reportedSize:litter.size_reported,existing:context.existing});
 const parents={sire_sids:parentIds(dataset,context.existing?context.parentCandidates.sire_sids:litter.sire_sids),dam_sids:parentIds(dataset,context.existing?context.parentCandidates.dam_sids:litter.dam_sids)};
 if(!context.existing)for(const role of ['sire_sids','dam_sids']){const eligible=new Set(parentIds(dataset,context.parentCandidates[role]));if(parents[role].some(id=>!eligible.has(id)))throw new Error('The selected parents must belong to this mating. Choose the correct mating or retain unknown parent roles.');}
 if((parents.sire_sids.length||parents.dam_sids.length)&&parentsConfirmed!==true)throw new Error('Review and confirm the recorded parent candidates before continuing.');
 if(!context.existing){if(!nonempty(litter.date_of_birth))throw new Error('Enter the litter date of birth.');if(validDate(litter.date_of_birth)&&validDate(mating?.set_up_date)&&litter.date_of_birth<mating.set_up_date)throw new Error('The litter birth date cannot precede this mating\'s setup date. Choose the correct mating or review the birth date.');litter.sire_sids=parents.sire_sids;litter.dam_sids=parents.dam_sids;litter.size_reported=parsed.reportedSize;}
 const shared={record_origin:'app_created',sex:'Unknown',state:'Stock',...copy(sharedDraft),...parents,litter_sid:context.litterId};
 // Existing literal parent arrays, dates, mating and source payloads are never
 // rewritten when previously unregistered siblings are added.
 if(context.existing&&context.litterDraft.date_of_birth){if(shared.date_of_birth&&shared.date_of_birth!==context.litterDraft.date_of_birth)throw new Error('New pups must retain this litter\'s recorded date of birth.');shared.date_of_birth=context.litterDraft.date_of_birth;}
 if(!context.existing)shared.date_of_birth=litter.date_of_birth||null;
 delete shared.canonical_sid;delete shared.legacy_sids;delete shared.mouse_sid;delete shared.genotype_inference;delete shared.genetic_profile;
 shared.lineage_basis={kind:'litter_parent_candidates',litter_sid:context.litterId,mating_sid:context.matingId,inferred_roles:['sire','dam'].filter(role=>parents[role+'_sids'].length),confirmed_in_editor:parentsConfirmed===true,biological_confirmation:false};
 if(!context.existing){
  litter.lineage_basis=copy(shared.lineage_basis);
  // Retain the reviewed family defaults for Add pups later. Genotype is per
  // animal and is deliberately absent from these future-registration defaults.
  for(const field of ['manager','mouseline','strain','generation','status','protocol','cage_sid','cage_tag'])litter[field]=shared[field]??null;
  if(shared.cage_sid)litter.cage_context='Initial cage recorded during sibling registration; review current housing for later pups.';
 }
 const staged=context.existing?dataset:{...dataset,tables:{...dataset.tables,litters:[...rows(dataset,'litters'),litter]}};
 if(!context.existing){const check=validateRecord('litters',litter,dataset,null);if(check.errors.length)throw new Error(check.errors.join(' '));}
 const batch=parsed.total?prepareMouseRegistrationBatch(staged,shared,{counts:parsed.counts,sids,requestId,deferTagValidation}):{drafts:[],readDependencies:[],warnings:[]};
 const dependencies=[...context.readDependencies,...batch.readDependencies];
 if(!context.existing)dependencies.push(...mouseRegistrationDependencies(dataset,shared));
 for(const draft of batch.drafts)dependencies.push(...mouseRegistrationDependencies(dataset,draft));
 const warnings=[...batch.warnings];
 if(!context.existing&&(mating?.state==='Inactive'||validDate(mating?.disbanded_date)&&validDate(litter.date_of_birth)&&mating.disbanded_date<=litter.date_of_birth))warnings.push('This mating is inactive or was disbanded by the recorded birth date. Review the birth date and parent candidates; historical registration is allowed.');
 if(parents.dam_sids.length>1)warnings.push('Several dams remain alternatives; an individual mother has not been established.');
 if(!parsed.total)warnings.push('Only the litter will be saved. No individual pups will be created.');
 if(context.existing&&context.litterDraft.state==='Weaned')warnings.push('This litter is already weaned. Review each new pup\'s weaning and current cage; its historical dam cage is not assigned.');
 return {...batch,litter,context,counts:parsed.counts,total:parsed.total,readDependencies:unique(dependencies),warnings:[...new Set(warnings)]};
}

export function applyLitterRegistrationBatch(dataset,prepared,{at=new Date().toISOString()}={}){
 assertLitterRegistrationContext(dataset,prepared.context);
 const next=copy(dataset);next.tables.mice||=[];next.tables.litters||=[];
 if(!prepared.context.existing)next.tables.litters.push({...copy(prepared.litter),app_created_at:at,app_modified_at:at});
 // App-created zero-count placeholders acquire their registered count. Imported
 // reported sizes stay source facts, even when their registered total differs.
 else if(prepared.total&&prepared.context.litterDraft.record_origin==='app_created'){
  const litter=next.tables.litters.find(row=>String(row.litter_sid)===prepared.context.litterId);
  const oldSize=Number(litter.size_reported),registered=prepared.context.siblingIds.length;
  if(!litter.size_reported||oldSize===0||oldSize===registered){litter.size_reported=String(registered+prepared.total);litter.app_modified_at=at;}
 }
 for(const draft of prepared.drafts){if(rows(dataset,'mice').some(row=>String(row.mouse_sid)===String(draft.mouse_sid)))throw new Error('A sibling SID already exists. Reload before saving.');next.tables.mice.push({...copy(draft),app_created_at:at,app_modified_at:at});}
 return next;
}
