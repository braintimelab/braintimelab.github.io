import {evaluateBrainbotMouseReview,prepareBrainbotMouseReviewAction,buildBrainbotMouseReviewAudit,hasBrainbotReviewRelationships} from './brainbot-review.js?v=97';
import {buildMouseReviewIssues} from './mouse-review.js?v=97';
import {validateRecord} from './model.js?v=97';

const keys={mice:'mouse_sid',locations:'location_id',husbandry_events:'event_id'};
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():'';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const rows=(data,type)=>list(data?.tables?.[type]);
const record=(data,type,id)=>{const found=rows(data,type).filter(row=>text(row[keys[type]])===id);if(found.length!==1)throw new Error('Animal or source data changed.');return found[0];};
const put=(data,type,id,value)=>{const index=data.tables[type].findIndex(row=>text(row[keys[type]])===id);if(index<0)data.tables[type].push(structuredClone(value));else data.tables[type][index]=structuredClone(value);};
const atomicKey=(type,id)=>type+':'+id;
const MAX_RECORDS=500,MAX_BYTES=800000;

function atomicFits(data,result,audit){
 const records=new Map(result.guards.map(guard=>[atomicKey(guard.type,guard.id),{entity_type:guard.type,entity_id:guard.id,payload:guard.payload,archived:Boolean(guard.payload.app_archived_at||guard.payload.archived),expected_version:Number.MAX_SAFE_INTEGER}]));
 for(const [type,id,payload] of [['mice',result.mouseSid,result.draft],['husbandry_events',result.resolutionRecord.event_id,result.resolutionRecord],['husbandry_events',audit.event_id,audit]])records.set(atomicKey(type,id),{entity_type:type,entity_id:id,payload,archived:Boolean(payload.app_archived_at||payload.archived),expected_version:Number.MAX_SAFE_INTEGER});
 if(records.size>MAX_RECORDS)return false;
 return new TextEncoder().encode(JSON.stringify({p_colony_id:'00000000-0000-0000-0000-000000000000',p_changes:[...records.values()]})).length<=MAX_BYTES;
}

function verified(data,result,audit){
 const mouse=record(data,'mice',result.mouseSid),resolution=record(data,'husbandry_events',result.resolutionRecord.event_id),savedAudit=record(data,'husbandry_events',audit.event_id);
 if(mouse.sex!==result.fields.sex||mouse.physical_tag!==result.draft.physical_tag||mouse.date_of_birth!==result.draft.date_of_birth)throw new Error('The animal update could not be verified.');
 if(!same(resolution,result.resolutionRecord)||!same(mouse.animal_sheet_review_links,result.draft.animal_sheet_review_links))throw new Error('The animal review could not be verified.');
 for(const field of ['event_type','schema_version','policy','evaluated','approved','manual','conflicts'])if(savedAudit[field]!==audit[field])throw new Error('The batch record could not be verified.');
 // The new automatic review link must not hide a newly conflicting source or
 // duplicate identity. Recheck the original exact-match rule without using
 // that link as a human override; the saved links themselves remain intact.
 const automaticCheck={...data,tables:{...data.tables,mice:rows(data,'mice').map(row=>({...row,animal_sheet_review_links:list(row.animal_sheet_review_links).filter(link=>link?.issue_id!==result.issueId)}))}};
 if(buildMouseReviewIssues(automaticCheck).some(issue=>issue.id===result.issueId)||hasBrainbotReviewRelationships(data,result.mouseSid))throw new Error('This animal still needs review.');
}

/** One click reviews animal consistency only. One animal, its existing
 * resolution and one stable per-click audit are committed atomically at a
 * time. Unknown saves stop the run; they are never retried automatically. */
export async function runBrainbotMouseReview({scope='current',loadFresh,save,checkAccess,at=new Date().toISOString(),batchId=crypto.randomUUID()}={}){
 if(!['current','all','historical'].includes(scope)||typeof loadFresh!=='function'||typeof save!=='function'||typeof checkAccess!=='function')throw new Error('Braintime Bot review is unavailable.');
 const seed=buildBrainbotMouseReviewAudit({batchId,at,evaluated:0,approved:0,manual:0,conflicts:0});
 let dataset=null,checked=0,approved=0,saveAttempted=false,lastAudit=null,accessValid=false;
 const access=async()=>{accessValid=false;if(await checkAccess()===false)throw new Error('Access changed.');accessValid=true;};
 const load=async()=>{await access();const fresh=await loadFresh();await access();if(!fresh?.tables||fresh.history_projection?.read_only===true)throw new Error('The current database is unavailable.');return fresh;};
 try{
  dataset=await load();
  const initial=evaluateBrainbotMouseReview(dataset,{scope,maxActions:100});checked=initial.evaluated;
  for(const proposal of initial.actions){
   dataset=await load();
   const fresh=evaluateBrainbotMouseReview(dataset,{scope,maxActions:100}).actions.find(action=>action.issueId===proposal.issueId);
   if(!fresh||fresh.mouseSid!==proposal.mouseSid||!same(fresh.fields,proposal.fields))continue;
   let result;
   try{result=prepareBrainbotMouseReviewAction(dataset,fresh);}catch{continue;}
   const auditRows=rows(dataset,'husbandry_events').filter(row=>row.event_id===seed.event_id),prior=auditRows[0]||null;
   if(auditRows.length>1||(!lastAudit&&prior)||lastAudit&&(!prior||!same(prior,lastAudit)))throw new Error('The batch record changed.');
   const audit={...(prior||{}),...buildBrainbotMouseReviewAudit({batchId,at,evaluated:checked,approved:approved+1,manual:checked-approved-1,conflicts:0})};
   if(!atomicFits(dataset,result,audit))continue;
   const auditValidation=validateRecord('husbandry_events',audit,dataset,prior?seed.event_id:null);
   if(auditValidation.errors.length)throw new Error('The batch record is invalid.');
   const next=structuredClone(dataset);next.tables.husbandry_events??=[];
   put(next,'mice',result.mouseSid,result.draft);put(next,'husbandry_events',result.resolutionRecord.event_id,result.resolutionRecord);put(next,'husbandry_events',audit.event_id,audit);
   const dependencies=[...new Map([...result.readDependencies,...(prior?[{type:'husbandry_events',id:seed.event_id}]:[])].map(value=>[atomicKey(value.type,value.id),value])).values()];
   await access();saveAttempted=true;
   await save(next,{readDependencies:dependencies});
   await access();
   dataset=await load();verified(dataset,result,audit);await access();
   approved++;saveAttempted=false;lastAudit=structuredClone(record(dataset,'husbandry_events',seed.event_id));
  }
  await access();
  return {checked,approved,manual:checked-approved,dataset};
 }catch(cause){
  try{await access();}catch{/* Do not return private data after a context or access change. */}
  const error=new Error(`Braintime Bot stopped after ${approved} confirmed approval${approved===1?'':'s'}.${saveAttempted?' The last save could not be confirmed.':''}`,{cause});
  error.confirmedApproved=approved;error.checked=checked;error.manual=checked-approved;error.unknownSave=saveAttempted;
  if(accessValid&&dataset)error.dataset=dataset;
  throw error;
 }
}
