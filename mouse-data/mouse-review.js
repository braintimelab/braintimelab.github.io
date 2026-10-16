import { cageObservations } from './cage-observations.js?v=96';

const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):'';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const active=row=>row&&!row.app_archived_at&&row.archived!==true;
const historical=row=>row?.history_read_only===true||row?.source_historical===true;
const table=(dataset,name)=>list(dataset?.tables?.[name]);
const day=value=>{const raw=text(value),match=raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T.*)?$/);if(!match)return null;const iso=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;return Number.isFinite(Date.parse(iso+'T00:00:00Z'))&&new Date(iso+'T00:00:00Z').toISOString().slice(0,10)===iso?iso:null;};
const sex=value=>/^(male|m)$/i.test(text(value))?'Male':/^(female|f)$/i.test(text(value))?'Female':null;
const identifier=value=>text(value).replace(/[′’‘]/g,"'").replace(/[‐‑‒–—―−]/g,'-').replace(/^(.*?)(?:\s+|-)([MF]\d+)$/,'$1-$2');
const shorthand=value=>/^[('’′)]*(?:(?:AD|WT|P|B|E|F|V|M|32|96)[('’′)]*)+$/.test(value);
const individual=value=>/^.+(?:-|\s)[MF]\s*\d+[A-Za-z]?$/.test(identifier(value));
const unique=values=>[...new Set(values)];
const safeUrl=value=>{try{const url=new URL(text(value));return url.protocol==='https:'?url.href:null;}catch{return null;}};
const issueId=(tag,dob)=>'animal-sheet:'+encodeURIComponent(JSON.stringify([identifier(tag),dob||null]));
const refKey=ref=>object(ref)?JSON.stringify([ref.kind,ref.record_id,ref.source_cell??null,ref.tag,ref.date_of_birth??null,ref.sex??null]):'';
const reviewedIdentity=mouse=>({physical_tag:text(mouse.physical_tag)||null,date_of_birth:day(mouse.date_of_birth),sex:sex(mouse.sex)});
const sameReviewedIdentity=(reviewed,mouse)=>object(reviewed)&&text(reviewed.physical_tag)===text(mouse.physical_tag)&&day(reviewed.date_of_birth)===day(mouse.date_of_birth)&&sex(reviewed.sex)===sex(mouse.sex);
const sourceOrder=(a,b)=>String(a.date||'').localeCompare(String(b.date||''))||refKey(a.ref).localeCompare(refKey(b.ref));
const editableMice=dataset=>table(dataset,'mice').filter(mouse=>active(mouse)&&!historical(mouse)&&text(mouse.mouse_sid));

// Stable 128-bit, non-secret identifier. The persisted issue ID is checked on
// every read so even a hash collision cannot merge unrelated review items.
function resolutionId(id){
 let a=1779033703,b=3144134277,c=1013904242,d=2773480762;
 for(let i=0;i<id.length;i++){const k=id.charCodeAt(i);a=b^Math.imul(a^k,597399067);b=c^Math.imul(b^k,2869860233);c=d^Math.imul(c^k,951274213);d=a^Math.imul(d^k,2716044179);}
 a=Math.imul(c^(a>>>18),597399067);b=Math.imul(d^(b>>>22),2869860233);c=Math.imul(a^(c>>>17),951274213);d=Math.imul(b^(d>>>19),2716044179);
 return 'mouse-review-'+[a^b^c^d,b^a,c^a,d^a].map(value=>(value>>>0).toString(16).padStart(8,'0')).join('');
}
function validReviewLink(mouse,id,sources){
 const refs=new Set(sources.map(source=>refKey(source.ref))),currentRefs=sources.filter(source=>source.current).map(source=>refKey(source.ref));
 return list(mouse.animal_sheet_review_links).some(link=>{if(!object(link)||link.schema_version!==1||link.issue_id!==id||!sameReviewedIdentity(link.reviewed_mouse,mouse))return false;const saved=new Set(list(link.source_refs).map(refKey));return [...saved].some(key=>refs.has(key))&&currentRefs.every(key=>saved.has(key));});
}

function sourceRows(dataset,{includeHistorical=true}={}){
 const output=[],rooms=new Map(table(dataset,'rooms').map(room=>[text(room.room_id),text(room.name||room.label)]));
 function append(position,meta){
  for(const animal of cageObservations(position).animals){
   const ref={kind:meta.kind,record_id:meta.recordId,source_cell:animal.sourceCell||null,tag:animal.tag,date_of_birth:animal.dateOfBirth||null,sex:animal.sex||null};
   output.push({...meta,cell:animal.sourceCell||null,tag:animal.tag,dateOfBirth:animal.dateOfBirth||null,sex:animal.sex||null,note:animal.note||'',earMark:animal.earMark||null,ref});
  }
 }
 for(const position of table(dataset,'locations')){
  if(!active(position)||historical(position)||position.source_current===false||position.active===false||position.source_position_closed===true||!text(position.location_id))continue;
  append(position,{kind:'current_position',recordId:text(position.location_id),current:true,date:day(position.source_snapshot_date||position.source_last_seen_at),dateBasis:text(position.source_snapshot_date_basis)||null,room:rooms.get(text(position.room_id))||text(position.source_room_label)||null,cage:text(position.label||position.source_label)||null,url:safeUrl(position.source_url)});
 }
 if(includeHistorical)for(const event of table(dataset,'husbandry_events')){
  const source=event?.source_cage_snapshot;
  if(!active(event)||event.event_type!=='animal_sheet_cage_snapshot'||!text(event.event_id)||!object(source)||source.schema_version!==1)continue;
  append({location_id:'snapshot:'+text(event.event_id),source_cell:source.source_header_cell,source_block_range:source.source_range,source_cage_observation:source.cage_observation||source.source_cage_observation,source_block_text:source.block_text,source_observed_tags:source.observed_tags},{kind:'cage_snapshot',recordId:text(event.event_id),current:false,date:day(source.snapshot_date),dateBasis:text(source.date_basis)||null,room:text(source.room_label||source.sheet_name)||null,cage:text(source.cage_label)||null,url:safeUrl(source.source_url||event.source_url)});
 }
 // Repeated captures are retained, but identical copies of one observation are not.
 return [...new Map(output.map(source=>[refKey(source.ref),source])).values()];
}

function mouseIndex(mice){
 const index=new Map();
 for(const mouse of mice){
  const tag=text(mouse.physical_tag),sid=text(mouse.mouse_sid),values=[tag,...list(mouse.physical_tag_aliases).filter(value=>typeof value==='string')];
  // SoftMouse explicitly stores its full numeric SID beside the genotype/sex
  // prefix. Do not strip zeros or match a source by its terminal number alone.
  if(/[-\s][MF]$/.test(tag)&&/^\d+$/.test(sid))values.push(tag+sid);
  if(shorthand(tag)&&sex(mouse.sex)&&/^\d+$/.test(sid))values.push(`${tag}-${sex(mouse.sex)[0]}${sid}`);
  for(const key of unique(values.map(identifier).filter(Boolean))){const entries=index.get(key)||[];entries.push(mouse);index.set(key,entries);}
 }
 return index;
}

const labels={
 group_observation:'Group or incomplete tag',
 ambiguous_match:'Multiple possible mice',
 source_sex_conflict:'Source sex differs',
 sex_conflict:'Sex differs from Mice',
 missing_dob:'DOB needs review',
 incomplete_record:'Mouse details incomplete',
 current_status_conflict:'Ended mouse in current sheet',
 current_status_unknown:'Current status needs review',
 dob_conflict:'Different DOB for this tag',
 missing_mouse:'Mouse record missing'
};

/** Runtime-only review, never a new identity or an inferred animal status.
 * A historical exact match to an Ended mouse is complete. Current sheet
 * presence does not itself change that record to Stock. */
export function buildMouseReviewIssues(dataset,{includeHistorical=true}={}){
 const mice=editableMice(dataset),index=mouseIndex(mice),groups=new Map();
 for(const source of sourceRows(dataset,{includeHistorical})){
  const id=issueId(source.tag,source.dateOfBirth),group=groups.get(id)||{id,tag:source.tag,dateOfBirth:source.dateOfBirth,sources:[]};group.sources.push(source);groups.set(id,group);
 }
 const issues=[];
 for(const group of groups.values()){
  const sources=group.sources.sort(sourceOrder),current=sources.some(source=>source.current),sexes=unique(sources.map(source=>source.sex).filter(Boolean)),observedSex=sexes.length===1?sexes[0]:null;
  const candidates=index.get(identifier(group.tag))||[];
  const linked=mice.filter(mouse=>validReviewLink(mouse,group.id,sources));
  const exact=group.dateOfBirth?candidates.filter(mouse=>day(mouse.date_of_birth)===group.dateOfBirth):[];
  const candidateRecords=[...new Set([...candidates,...linked])],candidateMouseSids=unique(candidateRecords.map(mouse=>text(mouse.mouse_sid))).sort();
  const validIndividual=individual(group.tag)||candidates.some(mouse=>identifier(mouse.physical_tag)===identifier(group.tag)&&individual(mouse.physical_tag));
  let reason=null,matched=null;
  if(linked.length>1)reason='ambiguous_match';
  else if(linked.length===1)matched=linked[0];
  else if(sexes.length>1)reason='source_sex_conflict';
  else if(!validIndividual)reason='group_observation';
  else if(!group.dateOfBirth)reason=candidates.length>1?'ambiguous_match':'missing_dob';
  else if(exact.length>1)reason='ambiguous_match';
  else if(exact.length===1)matched=exact[0];
  else reason=candidates.some(mouse=>!day(mouse.date_of_birth))?'incomplete_record':candidates.length?'dob_conflict':'missing_mouse';
  if(matched){
   if(!linked.length&&observedSex&&sex(matched.sex)&&observedSex!==sex(matched.sex))reason='sex_conflict';
   else if(!linked.length&&observedSex&&!sex(matched.sex))reason='incomplete_record';
   else if(current&&matched.state==='Ended')reason='current_status_conflict';
   else if(current&&matched.state!=='Stock')reason='current_status_unknown';
  }
  if(!reason)continue;
  const recent=(sources.filter(source=>source.current).at(-1)||sources.at(-1)),latest=sources.at(-1);
  const canCreate=validIndividual&&!linked.length&&!exact.length&&!candidates.some(mouse=>!day(mouse.date_of_birth))&&(!candidates.length||Boolean(group.dateOfBirth))&&sexes.length<=1;
  issues.push({...group,sex:observedSex,reason,reasonLabel:labels[reason],current,sourceCount:sources.length,currentSourceCount:sources.filter(source=>source.current).length,historicalSourceCount:sources.filter(source=>!source.current).length,lastSeen:latest?.date||null,lastSeenBasis:latest?.dateBasis||null,room:recent?.room||null,cage:recent?.cage||null,place:[recent?.room,recent?.cage].filter(Boolean).join(' · '),candidateMouseSids,canCreate,sources});
 }
 return issues.sort((a,b)=>Number(b.current)-Number(a.current)||String(b.lastSeen||'').localeCompare(String(a.lastSeen||''))||a.tag.localeCompare(b.tag,undefined,{numeric:true})||a.id.localeCompare(b.id));
}

function requireIssue(dataset,id){const issue=buildMouseReviewIssues(dataset).find(issue=>issue.id===id);if(!issue)throw new Error('This source issue changed or is already resolved. Refresh Review.');return issue;}
function selectedMouse(dataset,id){const found=editableMice(dataset).filter(mouse=>text(mouse.mouse_sid)===text(id));if(found.length!==1)throw new Error('Choose one available mouse SID.');return found[0];}
function retainedSources(issue){
 const ordered=[...issue.sources].sort(sourceOrder);
 const archives=ordered.filter(source=>!source.current);
 const selected=[ordered[0],ordered.at(-1),archives[0],archives.at(-1),...ordered.filter(source=>source.current)].filter(Boolean);
 return {sources:[...new Map(selected.map(source=>[refKey(source.ref),source])).values()]};
}

/** This only prepares an editor. Existing records are never overwritten by
 * source suggestions, and choosing an SID is always an explicit user action. */
export function prepareMouseReviewPrefill(dataset,id,{mouseSid=null}={}){
 if(dataset?.history_projection?.read_only===true)throw new Error('Return to the current database before completing a source review.');
 const issue=requireIssue(dataset,id),sourceRefs=retainedSources(issue).sources.map(source=>structuredClone(source.ref));
 if(mouseSid!==null){const mouse=selectedMouse(dataset,mouseSid);return {issue,mouseSid:text(mouse.mouse_sid),prefill:{},sourceRefs};}
 if(!issue.canCreate)throw new Error('Choose an existing mouse or review the source before creating an animal.');
 const prefill={physical_tag:issue.tag,sex:issue.sex||'Unknown',date_of_birth:issue.dateOfBirth||null,state:'Unknown',manager:null,cage_sid:null,cage_tag:null,sire_sids:[],dam_sids:[]};
 const ears=unique(issue.sources.map(source=>source.earMark).filter(Boolean));if(ears.length===1)prefill.ear_mark=ears[0];
 const noted=issue.sources.filter(source=>source.note),currentNotes=noted.filter(source=>source.current),latest=noted.at(-1)?.date,notes=unique((currentNotes.length?currentNotes:noted.filter(source=>source.date===latest)).map(source=>source.note));if(notes.length===1)prefill.comment=notes[0];
 return {issue,mouseSid:null,prefill,sourceRefs};
}

/** Attach an explicit resolution to the mouse payload. The caller must save
 * this mouse and the stable resolution record in one guarded transaction.
 * A new resolution record requires expected_version=0, preventing two clients
 * with different historical snapshots from creating separate mouse records. */
export function attachMouseReviewResolution(dataset,draft,id,{confirmed=false,mouseSid=null}={}){
 if(confirmed!==true)throw new Error('Confirm the source animal and selected mouse before saving.');
 if(!object(draft)||!text(draft.mouse_sid))throw new Error('A mouse SID is required.');
 const prepared=prepareMouseReviewPrefill(dataset,id,{mouseSid}),issue=prepared.issue;
 if(mouseSid!==null&&text(draft.mouse_sid)!==text(mouseSid))throw new Error('The selected mouse SID changed. Reopen Review.');
 if(mouseSid===null&&table(dataset,'mice').some(mouse=>text(mouse.mouse_sid)===text(draft.mouse_sid)))throw new Error('This mouse SID already exists. Choose it explicitly in Review.');
 const retained=retainedSources(issue),eventId=resolutionId(id),existing=table(dataset,'husbandry_events').filter(row=>text(row.event_id)===eventId);
 if(!retained.sources.length)throw new Error('The source record is unavailable.');
 if(existing.length>1||existing.some(row=>row.event_type!=='animal_sheet_mouse_review'||row.review_issue_id!==id))throw new Error('The review resolution record conflicts with another record. Refresh Review.');
 const previous=existing[0]||null,priorMice=previous?table(dataset,'mice').filter(row=>text(row.mouse_sid)===text(previous.mouse_sid)):[];
 if(priorMice.length>1)throw new Error('The prior reviewed mouse is ambiguous. Refresh Review.');
 const prior=priorMice[0],validPrior=prior&&active(prior)&&!historical(prior)&&sameReviewedIdentity(previous.reviewed_mouse,prior)&&validReviewLink(prior,id,issue.sources);
 if(validPrior&&text(prior.mouse_sid)!==text(draft.mouse_sid))throw new Error('This source animal is already linked to another reviewed mouse. Refresh Review.');
 const dependencies=[...retained.sources.map(row=>({type:row.kind==='current_position'?'locations':'husbandry_events',id:row.recordId})),...issue.candidateMouseSids.map(sid=>({type:'mice',id:sid})),...(mouseSid!==null?[{type:'mice',id:text(mouseSid)}]:[]),...(previous?[{type:'husbandry_events',id:eventId}]:[]),...(prior?[{type:'mice',id:text(prior.mouse_sid)}]:[])];
 const readDependencies=[...new Map(dependencies.map(value=>[value.type+':'+value.id,value])).values()];
 if(readDependencies.length>500)throw new Error('This issue has too many conflicting source records. Narrow the source review before saving.');
 const keys={mice:'mouse_sid',locations:'location_id',husbandry_events:'event_id'};
 const guards=readDependencies.map(dependency=>{const records=table(dataset,dependency.type).filter(row=>text(row[keys[dependency.type]])===dependency.id);if(records.length!==1)throw new Error('A source or mouse record is ambiguous. Refresh Review.');return {...dependency,payload:structuredClone(records[0])};});
 const result=structuredClone(draft),links=list(result.animal_sheet_review_links).filter(link=>!object(link)||link.issue_id!==id);
 result.animal_sheet_review_links=[...links,{schema_version:1,issue_id:id,reviewed_mouse:reviewedIdentity(result),source_refs:prepared.sourceRefs}];
 const resolutionRecord={event_id:eventId,event_type:'animal_sheet_mouse_review',schema_version:1,review_issue_id:id,mouse_sid:text(result.mouse_sid),reviewed_mouse:reviewedIdentity(result)};
 return {draft:result,readDependencies,guards,resolutionRecord};
}
