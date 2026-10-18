import { buildMouseReviewIssues, attachMouseReviewResolution } from './mouse-review.js?v=100';
import { cageObservations } from './cage-observations.js?v=100';
import { validateRecord } from './model.js?v=132';

export const BRAINBOT_REVIEW_POLICY='animal-consistency-v1';
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():'';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const table=(data,name)=>list(data?.tables?.[name]);
const active=row=>row&&!row.app_archived_at&&row.archived!==true&&!row.history_read_only&&!row.source_historical;
const keys={mice:'mouse_sid',locations:'location_id',husbandry_events:'event_id'};
const day=value=>{const raw=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;return Number.isFinite(Date.parse(raw+'T00:00:00Z'))&&new Date(raw+'T00:00:00Z').toISOString().slice(0,10)===raw?raw:null;};
const sex=value=>/^(?:male|m)$/i.test(text(value))?'Male':/^(?:female|f)$/i.test(text(value))?'Female':null;
const identifier=value=>text(value).replace(/[′’‘]/g,"'").replace(/[‐‑‒–—―−]/g,'-').replace(/^(.*?)(?:\s+|-)([MF]\d+)$/,'$1-$2');
const tagSex=value=>{const match=identifier(value).match(/^.+-[MF]\d+[A-Za-z]?$/);return match?(match[0].match(/-([MF])\d+[A-Za-z]?$/)[1]==='M'?'Male':'Female'):null;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const unique=values=>[...new Set(values)];
const rejected=(issue,reason)=>({issueId:issue.id,tag:issue.tag,reason});
const references=value=>Array.isArray(value)?value:typeof value==='string'?value.split(/[\n,]/).map(text).filter(Boolean):[];

/** Sex transcription never acts on a recorded parent or breeder. This avoids
 * treating a source tag as authority over an existing relationship role. */
export function hasBrainbotReviewRelationships(data,id){
 for(const type of ['mice','matings','litters'])for(const row of table(data,type))for(const field of type==='matings'?['male_sids','female_sids','sire_sids','dam_sids']:['sire_sids','dam_sids'])if(references(row[field]).includes(id))return true;
 return table(data,'mating_members').some(row=>text(row.mouse_sid)===id);
}

function readContext(data){
 const indexes=new Map(),observations=new WeakMap();
 return {
  rows(type,id){if(!indexes.has(type)){const index=new Map();for(const row of table(data,type)){const key=text(row[keys[type]]),rows=index.get(key)||[];rows.push(row);index.set(key,rows);}indexes.set(type,index);}return indexes.get(type).get(id)||[];},
  observations
 };
}

function sourceAnimals(data,source,context){
 const type=source.kind==='current_position'?'locations':source.kind==='cage_snapshot'?'husbandry_events':null;
 if(!type)return null;
 const rows=context.rows(type,source.recordId);
 if(rows.length!==1||!active(rows[0]))return null;
 const record=rows[0];
 if(context.observations.has(record))return context.observations.get(record);
 if(type==='locations'){const animals=cageObservations(record).animals;context.observations.set(record,animals);return animals;}
 if(record.event_type!=='animal_sheet_cage_snapshot'||record.source_cage_snapshot?.schema_version!==1)return null;
 const saved=record.source_cage_snapshot;
 const animals=cageObservations({location_id:'snapshot:'+source.recordId,source_cell:saved.source_header_cell,source_block_range:saved.source_range,source_cage_observation:saved.cage_observation||saved.source_cage_observation,source_block_text:saved.block_text,source_observed_tags:saved.observed_tags}).animals;
 context.observations.set(record,animals);return animals;
}

function decide(data,issue,context){
 // This allowlist cannot consume member, account, invitation or general bot
 // findings. Only the animal issues freshly built by mouse-review enter here.
 if(issue.reason!=='incomplete_record')return rejected(issue,issue.reason);
 if(!day(issue.dateOfBirth)||!tagSex(issue.tag)||!['Male','Female'].includes(issue.sex))return rejected(issue,'identity_incomplete');
 const candidates=table(data,'mice').filter(row=>active(row)&&list(issue.candidateMouseSids).includes(text(row.mouse_sid)));
 const exact=candidates.filter(row=>day(row.date_of_birth)===issue.dateOfBirth);
 if(exact.length!==1)return rejected(issue,'identity_ambiguous');
 const mouse=exact[0],id=text(mouse.mouse_sid);
 if(!id||context.rows('mice',id).length!==1)return rejected(issue,'identity_ambiguous');
 if(hasBrainbotReviewRelationships(data,id))return rejected(issue,'relationship_review');
 if(list(mouse.animal_sheet_review_links).some(link=>link?.issue_id===issue.id)||table(data,'husbandry_events').some(row=>row.event_type==='animal_sheet_mouse_review'&&row.review_issue_id===issue.id))return rejected(issue,'previous_review');
 // An explicit full physical tag or an explicitly recorded full alias is
 // required. A numeric suffix, shared genotype, prefix or previous link is not.
 const aliases=[mouse.physical_tag,...list(mouse.physical_tag_aliases)];
 if(!aliases.some(value=>tagSex(value)&&identifier(value)===identifier(issue.tag)))return rejected(issue,'identity_incomplete');
 if(text(mouse.sex)&&mouse.sex!=='Unknown'||sex(mouse.sex))return rejected(issue,'sex_recorded');
 if(issue.current&&mouse.state!=='Stock')return rejected(issue,'status_unconfirmed');
 if(tagSex(issue.tag)!==issue.sex||tagSex(mouse.physical_tag)&&tagSex(mouse.physical_tag)!==issue.sex)return rejected(issue,'sex_conflict');
 if(!list(issue.sources).length)return rejected(issue,'source_unavailable');
 for(const source of issue.sources){
  if(!day(source.date)||source.date<issue.dateOfBirth||source.dateOfBirth!==issue.dateOfBirth||source.sex!==issue.sex||tagSex(source.tag)!==issue.sex)return rejected(issue,'source_incomplete');
  const animals=sourceAnimals(data,source,context);
  const matches=list(animals).filter(animal=>animal.sourceCell===(source.cell||null)&&animal.tag===source.tag&&animal.dateOfBirth===source.dateOfBirth&&animal.sex===source.sex);
  if(!animals||matches.length!==1)return rejected(issue,'source_ambiguous');
  if(matches[0].requiresReview)return rejected(issue,'source_flagged');
 }
 const dependencies=[...issue.sources.map(source=>({type:source.kind==='current_position'?'locations':'husbandry_events',id:source.recordId})),...candidates.map(row=>({type:'mice',id:text(row.mouse_sid)}))];
 const readDependencies=[...new Map(dependencies.map(value=>[value.type+':'+value.id,value])).values()];
 // Reserve space for the changed mouse, resolution and per-batch audit.
 if(readDependencies.length>497)return rejected(issue,'too_many_sources');
 const guards=[];
 for(const dependency of readDependencies){
  const rows=context.rows(dependency.type,dependency.id);
  if(rows.length!==1)return rejected(issue,'source_ambiguous');
  guards.push({...dependency,payload:structuredClone(rows[0])});
 }
 return {policy:BRAINBOT_REVIEW_POLICY,issueId:issue.id,mouseSid:id,tag:issue.tag,fields:{sex:issue.sex},readDependencies,guards};
}

/** Pure eligibility evaluation. No new SID, DOB, lifecycle, genotype,
 * parentage, housing or user decision can be approved by this policy. */
export function evaluateBrainbotMouseReview(data,{includeHistorical=true,scope='all',maxActions=100}={}){
 if(data?.history_projection?.read_only===true)throw new Error('Return to the current database before running Braintime Bot.');
 if(!Number.isInteger(maxActions)||maxActions<1||maxActions>100)throw new Error('Invalid Braintime Bot batch size.');
 if(!['current','all','historical'].includes(scope))throw new Error('Invalid Braintime Bot review period.');
 const issues=buildMouseReviewIssues(data,{includeHistorical}).filter(issue=>scope==='all'||(scope==='current'?issue.current:!issue.current)),actions=[],skipped=[],context=readContext(data);
 for(const issue of issues){
  const decision=decide(data,issue,context);
  if(!decision.policy){skipped.push(decision);continue;}
  if(actions.length>=maxActions){skipped.push(rejected(issue,'batch_limit'));continue;}
  actions.push(decision);
 }
 const reasons=Object.fromEntries(unique(skipped.map(row=>row.reason)).sort().map(reason=>[reason,skipped.filter(row=>row.reason===reason).length]));
 return {policy:BRAINBOT_REVIEW_POLICY,evaluated:issues.length,actions,skipped,counts:{eligible:actions.length,manual:skipped.length,reasons}};
}

/** Recheck an evaluated action against a fresh dataset before one guarded
 * transaction. All source captures used by this decision are read guards.
 * The caller must re-evaluate after save; record guards do not fence the
 * insertion of an unrelated new record by another client. */
export function prepareBrainbotMouseReviewAction(data,proposal){
 if(data?.history_projection?.read_only===true)throw new Error('Return to the current database before running Braintime Bot.');
 if(!object(proposal)||proposal.policy!==BRAINBOT_REVIEW_POLICY||!text(proposal.issueId)||!text(proposal.mouseSid)||!object(proposal.fields)||Object.keys(proposal.fields).length!==1||!['Male','Female'].includes(proposal.fields.sex))throw new Error('Invalid Braintime Bot action.');
 if(!Array.isArray(proposal.guards)||!proposal.guards.length||proposal.guards.length>497)throw new Error('Invalid Braintime Bot source guards.');
 const context=readContext(data);
 for(const guard of proposal.guards){
  if(!object(guard)||!Object.hasOwn(keys,guard.type)||!text(guard.id))throw new Error('Invalid Braintime Bot source guard.');
  const rows=context.rows(guard.type,guard.id);
  if(rows.length!==1||!same(rows[0],guard.payload))throw new Error('Animal or source data changed. Run Braintime Bot again.');
 }
 const issue=buildMouseReviewIssues(data).find(row=>row.id===proposal.issueId);
 if(!issue)throw new Error('This animal review is already resolved or changed.');
 const checked=decide(data,issue,context);
 if(!checked.policy||checked.mouseSid!==proposal.mouseSid||!same(checked.fields,proposal.fields)||!same(checked.guards,proposal.guards))throw new Error('This animal needs manual review.');
 const mouse=table(data,'mice').find(row=>text(row.mouse_sid)===proposal.mouseSid);
 const result=attachMouseReviewResolution(data,{...structuredClone(mouse),sex:checked.fields.sex},issue.id,{confirmed:true,mouseSid:proposal.mouseSid});
 // A source transcription does not assert an identity override. Keep the
 // automatic evidence in the stable review record, so future duplicate tags
 // or contradictory sources remain visible in Review.
 const automaticLink=result.draft.animal_sheet_review_links.find(link=>link.issue_id===issue.id);
 result.resolutionRecord={...result.resolutionRecord,review_method:'deterministic_transcription',review_policy:BRAINBOT_REVIEW_POLICY,changed_fields:['sex'],source_refs:structuredClone(automaticLink.source_refs)};
 if(Object.hasOwn(mouse,'animal_sheet_review_links'))result.draft.animal_sheet_review_links=structuredClone(mouse.animal_sheet_review_links);else delete result.draft.animal_sheet_review_links;
 const dependencies=[...new Map([...checked.readDependencies,...result.readDependencies].map(value=>[value.type+':'+value.id,value])).values()];
 if(dependencies.length>497)throw new Error('This animal has too many source records for a batch review.');
 const guards=dependencies.map(dependency=>{const rows=context.rows(dependency.type,dependency.id);if(rows.length!==1)throw new Error('Animal or source data changed.');return {...dependency,payload:structuredClone(rows[0])};});
 const validation=validateRecord('mice',result.draft,data,proposal.mouseSid);
 if(validation.errors.length)throw new Error('This animal needs manual review: '+validation.errors.join(' '));
 const oldResolution=table(data,'husbandry_events').find(row=>row.event_id===result.resolutionRecord.event_id);
 const resolutionValidation=validateRecord('husbandry_events',result.resolutionRecord,data,oldResolution?.event_id||null);
 if(resolutionValidation.errors.length)throw new Error('This animal review could not be recorded.');
 return {...result,policy:BRAINBOT_REVIEW_POLICY,issueId:issue.id,mouseSid:proposal.mouseSid,fields:checked.fields,readDependencies:dependencies,guards};
}

/** Compact activity record; individual changes retain the existing stable
 * animal-review resolution record and its source references. */
export function buildBrainbotMouseReviewAudit({batchId,at,evaluated=0,approved=0,manual=0,conflicts=0}={}){
 if(!/^[A-Za-z0-9-]{1,100}$/.test(text(batchId))||!Number.isFinite(Date.parse(at)))throw new Error('A batch ID and timestamp are required.');
 if([evaluated,approved,manual,conflicts].some(value=>!Number.isInteger(value)||value<0)||approved+manual+conflicts!==evaluated)throw new Error('Invalid Braintime Bot batch totals.');
 return {event_id:'BB-REVIEW-'+batchId,event_type:'brainbot_mouse_review_batch',schema_version:1,policy:BRAINBOT_REVIEW_POLICY,event_date:new Date(at).toISOString().slice(0,10),app_created_at:new Date(at).toISOString(),evaluated,approved,manual,conflicts};
}
