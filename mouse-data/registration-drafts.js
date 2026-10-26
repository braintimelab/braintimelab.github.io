import {checkedRegistrationDraft,registrationMemoryControlAllowed} from './registration-memory.js?v=192';

/** A lost save reply must never advance a recovered zero-pup litter to a new
 * ordinal. An existing original identity requires review of the saved litter. */
export function restoreLitterRegistrationIdentity(dataset,context,savedSid){
 if(!context||context.existing||typeof savedSid!=='string'||!savedSid.startsWith(context.matingId+'.')||!/^[1-9][0-9]*$/.test(savedSid.slice(context.matingId.length+1))||savedSid.length>200)throw new Error('The saved litter identity is unavailable. Reopen its mating and review the original draft.');
 if((dataset?.tables?.litters||[]).some(litter=>String(litter.litter_sid)===savedSid))throw new Error('This draft litter has already been created. Open that litter and check its saved pups before starting another registration.');
 return {...context,litterId:savedSid,litterDraft:{...context.litterDraft,litter_sid:savedSid},shared:{...context.shared,litter_sid:savedSid},siblingIds:[]};
}

export function registrationDraftDescriptor(editor){
 const flow=editor?.litterFlow;
 if(flow)return {kind:({new:'litter-new',add:'litter-add',edit:'siblings'})[flow.mode],recordId:flow.mode==='new'?'':String(editor.id??'')};
 if(editor?.type!=='mice'||editor.id||editor.mouseReview)return null;
 const registration=editor.registration;
 return {kind:'mice',recordId:registration?.positionId?'position:'+registration.positionId:registration?.prefill?.cage_sid?'cage:'+registration.prefill.cage_sid:''};
}
export function captureRegistrationDraft(editor,form){
 const descriptor=registrationDraftDescriptor(editor);if(!descriptor)throw new Error('This editor does not contain recoverable registration work.');
 const fields={};for(const node of form.querySelectorAll('input[id],select[id],textarea[id]'))if(registrationMemoryControlAllowed(node.id)&&node.type!=='file')fields[node.id]=node.type==='checkbox'?node.checked:String(node.value??'');
 const registration=editor.registration;
 const tagInference=editor.tagInference&&editor.tagInference.tag===fields['field-physical_tag']&&editor.tagInference.genotype===fields['field-genotype']?editor.tagInference:null;
 return checkedRegistrationDraft({...descriptor,fields,rowOverrides:editor.rowOverrides??{},selected:[...(editor.selectedSiblingIds??[])],requestId:editor.record?.registration_request_id??editor.registrationRequestId??null,reservations:[...(editor.sidReservations??new Map())].map(([count,value])=>({count,requestId:value.requestId,sids:value.sids??null})),tagInference,registration:registration?{cageSid:registration.newCage?null:registration.prefill?.cage_sid??null,positionId:registration.positionId??null,newborn:registration.newborn===true,proposedNewCageSid:registration.newCage?.cage_sid??null}:null});
}

/** Values are form inputs, never trusted stored records. The host reconstructs
 * mating/cage context first, then ordinary preparation validates every value. */
export function restoreRegistrationDraft(editor,form,input){
 const draft=checkedRegistrationDraft(input),descriptor=registrationDraftDescriptor(editor);
 if(!descriptor||descriptor.kind!==draft.kind||descriptor.recordId!==draft.recordId)throw new Error('Open the same registration context before restoring this draft.');
 for(const [key,value]of Object.entries(draft.fields)){
  const node=form.querySelector('#'+key);if(!node||node.type==='file'||node.readOnly||node.disabled)continue;
  if(node.type==='checkbox')node.checked=value===true;else node.value=String(value);
 }
 editor.rowOverrides=structuredClone(draft.rowOverrides);editor.selectedSiblingIds=new Set(draft.selected);editor.sidReservations=new Map(draft.reservations.map(row=>[row.count,{requestId:row.requestId,sids:row.sids}]));
 if(draft.requestId){if(editor.litterFlow)editor.registrationRequestId=draft.requestId;else editor.record.registration_request_id=draft.requestId;}
 editor.tagInference=draft.tagInference?structuredClone(draft.tagInference):null;
 editor.preparedMouseBatch=null;editor.preparedLitterBatch=null;editor.reviewedFingerprint=null;
 for(const name of ['confirm-newborn-parents','confirm-litter-parents','confirm-mouse-review']){const node=form.querySelector('#'+name);if(node)node.checked=false;}
 const entry=form.querySelector('#mouse-entry-mode');if(entry){const sheet=entry.value==='sheet',counts=form.querySelector('#mouse-count-entry'),rows=form.querySelector('#mouse-sheet-entry');if(counts)counts.hidden=sheet;if(rows)rows.hidden=!sheet;}
 return draft;
}
