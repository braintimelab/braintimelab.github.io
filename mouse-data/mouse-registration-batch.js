import {buildMouseBatchDrafts,nextNumericMouseSids,registrationDataset,MOUSE_BATCH_LIMIT} from './mouse-registration.js?v=188';
import {canonicalMouseSidKey,formatMouseSid,resolveMouseSid} from './mouse-sid.js?v=188';
import {createMouseRegistrationValidationContext} from './model.js?v=188';
export {resolveMouseSid} from './mouse-sid.js?v=188';

function resolveParents(dataset,draft) {
 const result=structuredClone(draft);
 for(const field of ['sire_sids','dam_sids'])if(Array.isArray(result[field]))result[field]=result[field].map(value=>resolveMouseSid(dataset,value));
 return result;
}

const countFor=sex=>({Male:sex==='Male'?1:0,Female:sex==='Female'?1:0,Unknown:sex==='Unknown'?1:0});
const validSid=value=>typeof value==='string'&&/^\d{5}$/.test(value)&&BigInt(value)>0n;

/** Prepare either a count-based group or pasted rows for one atomic save.
 * readDependencies are tag identity fences; the caller adds parent and housing
 * dependencies for each draft through mouseRegistrationDependencies. */
export function prepareMouseRegistrationBatch(dataset,sharedDraft,{counts,rows,registration=null,requestId=sharedDraft?.registration_request_id,sids=null,literalTagRows=null,deferTagValidation=false}={}) {
 const base=registrationDataset(dataset,registration),shared=resolveParents(base,sharedDraft);
 if(rows===undefined||rows===null)return buildMouseBatchDrafts(base,shared,counts,{sids,requestId,deferTagValidation});
 if(!Array.isArray(rows)||rows.length<1||rows.length>MOUSE_BATCH_LIMIT)throw new Error(`Paste between 1 and ${MOUSE_BATCH_LIMIT} mouse rows.`);
 if(literalTagRows!==null&&(!Array.isArray(literalTagRows)||literalTagRows.length!==rows.length||literalTagRows.some(value=>typeof value!=='boolean')))throw new Error('The sheet tag ownership changed. Reopen the draft.');
 const explicit=new Set(),occupied=new Set((base.tables?.mice||[]).flatMap(mouse=>[mouse.mouse_sid,mouse.canonical_sid,...(Array.isArray(mouse.legacy_sids)?mouse.legacy_sids:[])]).filter(value=>value!=null).map(canonicalMouseSidKey));
 const proposals=rows.map((row,index)=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error(`Row ${index+1}: a mouse record is required.`);
  const draft={...structuredClone(shared),...structuredClone(row),mouse_sid:row.mouse_sid??null};
  if(row.cage_sid&&String(row.cage_sid)!==String(shared.cage_sid||'')&&!row.cage_tag)draft.cage_tag=(base.tables?.cages||[]).find(cage=>String(cage.cage_sid)===String(row.cage_sid))?.cage_tag||null;
  if(registration&&draft.cage_sid!==registration.prefill.cage_sid)throw new Error(`Row ${index+1}: use the selected cage for this registration. Move the mouse afterward.`);
  if(draft.mouse_sid!==null&&draft.mouse_sid!==''){
   const original=String(draft.mouse_sid),sid=formatMouseSid(original);
   if(!validSid(sid))throw new Error(`Row ${index+1}: SID must be a whole number from 1 to 99999.`);
   const key=canonicalMouseSidKey(sid);
   if(explicit.has(key))throw new Error(`Row ${index+1}: SID ${sid} appears more than once in this batch.`);
   if(occupied.has(key))throw new Error(`Row ${index+1}: SID ${sid} already exists. Open the existing mouse instead.`);
   explicit.add(key);draft.mouse_sid=sid;
   if(original!==sid&&draft.original_sid==null)draft.original_sid=original;
  }
  draft.sex??='Unknown';draft.state??='Stock';
  if(!['Male','Female','Unknown'].includes(draft.sex))throw new Error(`Row ${index+1}: Sex must be Male, Female or Unknown.`);
  return draft;
 });
 const missing=proposals.filter(draft=>!draft.mouse_sid).length;
 let pool=[];
 if(missing){
  const reserved=sids??nextNumericMouseSids(base,proposals.length);
  if(!Array.isArray(reserved)||reserved.length!==proposals.length||reserved.some(sid=>!validSid(sid))||new Set(reserved.map(canonicalMouseSidKey)).size!==reserved.length)throw new Error('The SID reservation does not match these rows. Reopen the draft.');
  pool=reserved.filter(sid=>!explicit.has(canonicalMouseSidKey(sid)));
  if(pool.length<missing)throw new Error('The SID reservation does not cover all blank SIDs. Reopen the draft.');
 }
 const validationContext=createMouseRegistrationValidationContext(base),staged=validationContext.dataset,drafts=[],dependencies=new Map(),warnings=[],automaticTagSids=[];
 let automatic=0;
 for(let index=0;index<proposals.length;index++){
  const proposal=resolveParents(staged,proposals[index]),sid=proposal.mouse_sid||pool[automatic++];
  try{
   const literalTag=literalTagRows?.[index]??(Object.hasOwn(rows[index],'physical_tag')&&Boolean(String(rows[index].physical_tag||'').trim()));
   const result=buildMouseBatchDrafts(staged,proposal,countFor(proposal.sex),{sids:[sid],requestId:requestId?`${requestId}:${index+1}`:undefined,validationContext,literalTag,deferTagValidation});
   automaticTagSids.push(...result.automaticTagSids);
   drafts.push(result.drafts[0]);warnings.push(...result.warnings);
   for(const dependency of result.readDependencies)dependencies.set(dependency.type+':'+dependency.id,dependency);
  }catch(error){throw new Error(`Row ${index+1}: ${error.message}`);}
 }
 return {drafts,automaticTagSids,readDependencies:[...dependencies.values()],warnings:[...new Set(warnings)]};
}
