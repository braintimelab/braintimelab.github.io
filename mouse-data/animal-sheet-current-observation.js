import {createCageObservationContext,cageSheetSourceRows} from './cage-observations.js?v=100';

const list=value=>Array.isArray(value)?value:[];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):'';
const active=row=>row&&!row.app_archived_at&&row.archived!==true&&row.history_read_only!==true&&row.source_historical!==true;
const sex=value=>/^(?:male|m)$/i.test(text(value))?'Male':/^(?:female|f)$/i.test(text(value))?'Female':null;
const day=value=>{const raw=text(value),m=raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T.*)?$/);if(!m)return null;const iso=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;return Number.isFinite(Date.parse(iso+'T00:00:00Z'))&&new Date(iso+'T00:00:00Z').toISOString().slice(0,10)===iso?iso:null;};
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const refKey=(location,cell,tag,dob,gender)=>JSON.stringify([text(location),text(cell),text(tag),day(dob),sex(gender)]);
const suffix=tag=>text(tag).match(/(?:-|\s)([MF])\s*(\d+[A-Za-z]?)$/)?.slice(1)??null;
const notice='Your version of Excel allows you to read this threaded comment; however, any edits to it will get removed if the file is opened in a newer version of Excel. Learn more: https://go.microsoft.com/fwlink/?linkid=870924';
const annotationBody=value=>text(value).split(/\r?\n/).filter(line=>line.trim()!=='[Threaded comment]'&&line.trim()!==notice).join('\n');
const lifecycle=value=>/\b(?:dead|died|ended|sacrificed|removed|euthanized|transfer(?:red)?)\b|死亡|已犧牲|犧牲|處死/i.test(annotationBody(value));
const https=value=>{try{const u=new URL(text(value));return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const index=(rows,key)=>{const out=new Map();for(const row of rows){const id=text(row?.[key]);if(id&&!out.has(id))out.set(id,row);}return out;};
const add=(map,key,value)=>{const rows=map.get(key)||[];rows.push(value);map.set(key,rows);};
const captured=position=>{for(const key of ['source_capture_at','source_captured_at','source_snapshot_date','source_last_seen_at'])if(text(position[key]))return {at:text(position[key]),basis:key};return {at:null,basis:null};};
const threadedNote=value=>/\[Threaded comment\]|(?:^|\n)\s*(?:Comment|Reply):/i.test(value);
// Call only after the explicit SID, DOB and sex have been qualified. This
// removes a verified display suffix, never normalizes biological spelling.
export function stripVerifiedDisplaySuffix(label,{mouseSid,sex:verifiedSex}={}){
 if(typeof label!=='string'||typeof mouseSid!=='string'||!mouseSid)return label;
 const marker=verifiedSex==='Male'||verifiedSex==='M'?'M':verifiedSex==='Female'||verifiedSex==='F'?'F':null;
 if(!marker)return label;
 for(const ending of ['-'+marker+mouseSid,'-'+marker])if(label.endsWith(ending))return label.slice(0,-ending.length);
 return label;
}
export function compareVerifiedSourceLabels(recordedTag,observedTag,qualified={}){
 const recordedPrefix=stripVerifiedDisplaySuffix(recordedTag,qualified),observedPrefix=stripVerifiedDisplaySuffix(observedTag,qualified);
 return {classification:recordedPrefix===observedPrefix?'normal_display_equivalent':'prefix_discrepancy',recordedPrefix,observedPrefix};
}
const cell=value=>typeof value==='string'?value.match(/^([A-Z]{1,3})([1-9]\d{0,5})$/):null;
const column=value=>[...value].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0);
const coordinate=(row,col)=>{let out='';for(let n=col;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out+row;};
/** The retained six/eight-column grid puts NOTE before DOB, left, right,
 * weeks. Unsupported layouts do not establish a NOTE-cell mapping. */
export function expectedNoteCell(position,sourceCell){
 const range=typeof position?.source_block_range==='string'?position.source_block_range.match(/^([A-Z]{1,3})([1-9]\d{0,5}):([A-Z]{1,3})([1-9]\d{0,5})$/):null,source=cell(sourceCell);
 if(!range||!source)return null;
 const start=column(range[1]),width=column(range[3])-start+1,row=Number(source[2]),first=Number(range[2]),last=Number(range[4]),anchor=cell(position.source_cell);
 if(![6,7,8].includes(width)||last-first<6||last-first>8||column(source[1])!==start||row<=first||row>=last)return null;
 if(anchor&&(column(anchor[1])!==start||Number(anchor[2])<first||Number(anchor[2])>first+1||row<=Number(anchor[2])))return null;
 return coordinate(row,start+width-5);
}
/** Read only the current retained NOTE cell. Parsed animal.note may combine
 * tag annotations and is deliberately never a fallback. Multiline/ambiguous
 * serialization remains unknown rather than discarding human text. */
export function readCurrentLiteralNote(position,noteCell){
 const target=cell(noteCell),range=typeof position?.source_block_range==='string'?position.source_block_range.match(/^([A-Z]{1,3})([1-9]\d{0,5}):([A-Z]{1,3})([1-9]\d{0,5})$/):null;
 if(!target||!range||typeof position.source_block_text!=='string')return {known:false,value:null};
 const sourceCell=range[1]+target[2];if(expectedNoteCell(position,sourceCell)!==noteCell)return {known:false,value:null};
 let found=false,value=null,headers=0;
 for(const line of position.source_block_text.split(/\r?\n/)){
  if(!line)continue;
  const match=line.match(/^([A-Z]{1,3}[1-9]\d{0,5})( comment)?: ?(.*)$/);
  if(!match)return {known:false,value:null};
  headers++;
  if(!match[2]&&match[1]===noteCell){if(found)return {known:false,value:null};found=true;value=match[3]||null;}
 }
 return headers?{known:true,value}:{known:false,value:null};
}
/** A compact reference is resolved only against its loaded, exact stable event
 * and current source cohort. The hash scalar binds the reviewed event; its
 * canonical content hash is checked by the command compiler, not recomputed by
 * this synchronous presentation projection. */
export function resolveAnimalSheetAssociation(dataset,mouse,link){
 const ref=link?.association_ref,keys=['schema_version','kind','event_id','source_issue_id','evidence_sha256'],sameIdentity=value=>object(value)&&value.physical_tag===mouse?.physical_tag&&day(value.date_of_birth)===day(mouse?.date_of_birth)&&sex(value.sex)===sex(mouse?.sex);
 if(!object(mouse)||typeof mouse.mouse_sid!=='string'||!mouse.mouse_sid||!sex(mouse.sex)||!object(ref)||JSON.stringify(Object.keys(ref).sort())!==JSON.stringify(keys.sort())||ref.schema_version!==1||ref.kind!=='source_reconciliation_association_ref'||typeof ref.event_id!=='string'||!ref.event_id||ref.source_issue_id!==link.issue_id||!/^[a-f0-9]{64}$/.test(ref.evidence_sha256||'')||!sameIdentity(link.reviewed_mouse))return null;
 const events=list(dataset?.tables?.husbandry_events).filter(event=>event?.event_id===ref.event_id&&active(event));if(events.length!==1)return null;
 const event=events[0],basis=event.association_basis,observation=event.source_observation,observationKeys=['schema_version','source_location_id','source_cell','source_tag','date_of_birth','sex','ear_mark','note_cell','note_text','source_file_id','source_sheet_id','source_range','source_xlsx_sha256','source_capture_at','source_modified_at','effective_movement_date'];
 if(event.event_type!=='animal_sheet_mouse_review'||event.schema_version!==1||event.review_issue_id!==link.issue_id||event.mouse_sid!==mouse.mouse_sid||!sameIdentity(event.reviewed_mouse)||event.association_sha256!==ref.evidence_sha256||!object(observation)||JSON.stringify(Object.keys(observation).sort())!==JSON.stringify(observationKeys.sort())||observation.schema_version!==1||observation.effective_movement_date!==null||!day(observation.date_of_birth)||day(observation.date_of_birth)!==day(mouse.date_of_birth)||sex(observation.sex)!==sex(mouse.sex)||!(observation.note_text===null||typeof observation.note_text==='string'&&observation.note_text.length<=2000)||!(observation.ear_mark===null||typeof observation.ear_mark==='string')||typeof observation.source_file_id!=='string'||!observation.source_file_id||!timestamp(observation.source_capture_at)||!timestamp(observation.source_modified_at)||!/^[a-f0-9]{64}$/.test(observation.source_xlsx_sha256||''))return null;
 const refs=list(link.source_refs).filter(value=>value?.kind==='current_position');if(refs.length!==1)return null;
 const source=refs[0];if(source.record_id!==observation.source_location_id||source.source_cell!==observation.source_cell||source.tag!==observation.source_tag||day(source.date_of_birth)!==day(observation.date_of_birth)||sex(source.sex)!==sex(observation.sex))return null;
 const positions=list(dataset?.tables?.locations).filter(p=>p?.location_id===source.record_id&&active(p)&&p.source_current===true&&p.active!==false&&p.source_position_closed!==true);if(positions.length!==1)return null;
 const position=positions[0],animals=list(position.source_cage_observation?.animals).length?list(position.source_cage_observation.animals):createCageObservationContext(dataset).observation(position).animals;
 const current=animals.filter(animal=>animal.sourceCell===source.source_cell),currentTag=current[0]?.tag,marker=sex(mouse.sex)==='Male'?'M':'F',sameSourceIdentity=typeof currentTag==='string'&&(currentTag===source.tag||basis!==null&&currentTag.length>('-'+marker+mouse.mouse_sid).length&&currentTag.endsWith('-'+marker+mouse.mouse_sid));
 if(current.length!==1||!sameSourceIdentity||day(current[0].dateOfBirth)!==day(source.date_of_birth)||sex(current[0].sex)!==sex(source.sex)||position.source_file_id!==observation.source_file_id||String(position.source_sheet_id)!==String(observation.source_sheet_id)||position.source_block_range!==observation.source_range||expectedNoteCell(position,source.source_cell)!==observation.note_cell)return null;
 if(!list(mouse.reconciliation_evidence).some(value=>object(value)&&keys.every(key=>value[key]===ref[key])&&Object.keys(value).length===keys.length))return null;
 if(basis!==null){
  const basisKeys=['schema_version','kind','confidence','inferred','policy','scope','tag_review','mouse_sid','recorded_tag','observed_tag','date_of_birth','sex','softmouse','animal_sheet','unique_numeric_sid_source_observations','genotype_tag_lifecycle_unchanged','effective_movement_date',...(object(basis)&&Object.hasOwn(basis,'owner_lifecycle_decision')?['owner_lifecycle_decision']:[])];
  if(!object(basis)||JSON.stringify(Object.keys(basis).sort())!==JSON.stringify(basisKeys.sort())||basis.inferred!==true||basis.policy!=='owner_authorized_current_source_association'||basis.unique_numeric_sid_source_observations!==1||basis.effective_movement_date!==null||!/^\d+$/.test(mouse.mouse_sid))return null;
  const provenance=basis.softmouse,provenanceKeys=['mouse_sid','source_record_id','source_row','source_sha256','source_sheet'];
  if(!object(provenance)||JSON.stringify(Object.keys(provenance).sort())!==JSON.stringify(provenanceKeys.sort())||!provenanceKeys.every(key=>provenance[key]===mouse[key])||typeof provenance.source_record_id!=='string'||!provenance.source_record_id||typeof provenance.source_sheet!=='string'||!provenance.source_sheet||!Number.isSafeInteger(provenance.source_row)||provenance.source_row<1||!/^[a-f0-9]{64}$/.test(provenance.source_sha256||''))return null;
  const meta=basis.animal_sheet,metaKeys=['source_file_id','source_sheet_id','source_location_id','source_cell','source_range','source_xlsx_sha256','source_core_sha256','source_modified_at','source_capture_at'];
  if(!object(meta)||JSON.stringify(Object.keys(meta).sort())!==JSON.stringify(metaKeys.sort())||!metaKeys.filter(key=>key!=='source_core_sha256').every(key=>meta[key]===observation[key])||!/^[a-f0-9]{64}$/.test(meta.source_core_sha256||''))return null;
  const marker=sex(mouse.sex)==='Male'?'M':'F',tagReview=basis?.tag_review,comparison=compareVerifiedSourceLabels(mouse.physical_tag,source.tag,{mouseSid:mouse.mouse_sid,sex:sex(mouse.sex)}),status=comparison.classification==='prefix_discrepancy'?'needs_check':'not_required';
  if(basis.schema_version!==1||basis.kind!=='explicit_sid_dob_sex_inference'||basis.scope!=='identity_association_only'||!['high','moderate'].includes(basis.confidence)||basis.mouse_sid!==mouse.mouse_sid||basis.recorded_tag!==mouse.physical_tag||basis.observed_tag!==source.tag||basis.date_of_birth!==mouse.date_of_birth||basis.sex!==mouse.sex||!source.tag.endsWith('-'+marker+mouse.mouse_sid)||!object(tagReview)||JSON.stringify(Object.keys(tagReview).sort())!==JSON.stringify(['status','recorded_tag','observed_tag','date_of_birth','sex'].sort())||tagReview.status!==status||tagReview.recorded_tag!==mouse.physical_tag||tagReview.observed_tag!==source.tag||tagReview.date_of_birth!==mouse.date_of_birth||tagReview.sex!==mouse.sex)return null;
  const decision=basis.owner_lifecycle_decision;
  if(basis.genotype_tag_lifecycle_unchanged===true){if(Object.hasOwn(basis,'owner_lifecycle_decision'))return null;}
  else{
   const decisionKeys=['schema_version','kind','recorded_at','effective_end_date','before','after','date_precision','exact_time','evidence_refs'],stateKeys=['state','end_date','end_type'];
   if(basis.genotype_tag_lifecycle_unchanged!==false||!object(decision)||JSON.stringify(Object.keys(decision).sort())!==JSON.stringify(decisionKeys.sort())||decision.schema_version!==1||decision.kind!=='owner_confirmed_mouse_lifecycle'||!timestamp(decision.recorded_at)||typeof decision.effective_end_date!=='string'||decision.effective_end_date!==day(decision.effective_end_date)||decision.date_precision!=='day'||decision.exact_time!==null||!list(decision.evidence_refs).length||!list(decision.evidence_refs).every(object)||!object(decision.before)||!object(decision.after)||JSON.stringify(Object.keys(decision.before).sort())!==JSON.stringify(stateKeys.sort())||JSON.stringify(Object.keys(decision.after).sort())!==JSON.stringify(stateKeys.sort())||!['Stock','Unknown'].includes(decision.before.state)||!(decision.before.end_date===null||typeof decision.before.end_date==='string'&&decision.before.end_date===day(decision.before.end_date))||!(decision.before.end_type===null||typeof decision.before.end_type==='string')||decision.after.state!=='Ended'||decision.after.end_type!=='Sacrificed'||decision.after.end_date!==decision.effective_end_date||mouse.state!==decision.after.state||mouse.end_date!==decision.after.end_date||mouse.end_type!==decision.after.end_type)return null;
  }
 }
 const currentSourceRef={kind:'current_position',record_id:source.record_id,source_cell:source.source_cell,tag:currentTag,date_of_birth:day(current[0].dateOfBirth),sex:sex(current[0].sex)};
 return {reference:structuredClone(ref),event,basis,sourceObservation:observation,currentSourceRef,evidenceSha256:ref.evidence_sha256,identityKind:basis?'inferred':'reviewed',confidence:basis?.confidence??null};
}
export const observationLocationLabel=row=>[row?.sourceRoomLabel||row?.sourceRoomId,row?.sourceRackLabel||row?.sourceRackId,row?.sourcePositionLabel||row?.sourceLocationId].map(text).filter(Boolean).join(' / ');
function sourceNeedsReview(position,animal){
 const raw=position.source_cage_observation?.schemaVersion===1?list(position.source_cage_observation.animals).find(row=>text(row?.sourceCell)===text(animal.sourceCell)&&text(row?.tag)===text(animal.tag)):null;
 const biological=lifecycle(animal.tag+'\n'+animal.note),explicit=raw?.requiresReview===true;
 // The old source resolver also notices the word "removed" inside Excel's
 // exact compatibility notice. Keep that literal note, without turning the
 // technical sentence into a biological finding or clearing an explicit flag.
 const compatibilityOnly=raw&&!explicit&&!biological&&text(raw.note).split(/\r?\n/).some(line=>line.trim()===notice);
 return explicit||biological||animal.requiresReview===true&&!compatibilityOnly||position.requires_review===true;
}

function reviewLinks(dataset,mice){
 const result=new Map();
 for(const mouse of mice){
  const snapshotMatches=checked=>object(checked)&&text(checked.physical_tag)===text(mouse.physical_tag)&&day(checked.date_of_birth)===day(mouse.date_of_birth)&&sex(checked.sex)===sex(mouse.sex);
  for(const link of list(mouse.animal_sheet_review_links)){
   if(!object(link)||link.schema_version!==1||!snapshotMatches(link.reviewed_mouse))continue;
   const present=Object.hasOwn(link,'association_ref')||Object.hasOwn(link,'association_basis'),resolved=present?resolveAnimalSheetAssociation(dataset,mouse,link):null,basis=resolved?.basis;
   const inferred=resolved?.identityKind==='inferred';
   for(const ref of list(link.source_refs))if(object(ref)&&ref.kind==='current_position'&&text(ref.record_id)&&text(ref.source_cell)){
    const value={mouse,link,resolved,identityKind:resolved?.identityKind||(present?'inferred':'reviewed'),confidence:inferred?basis.confidence:null,valid:!present||Boolean(resolved)};
    if(inferred){const tail=suffix(ref.tag);value.valid=Boolean(tail&&tail[1]===text(mouse.mouse_sid)&&tail[0]===sex(mouse.sex)?.[0]&&day(ref.date_of_birth)&&day(ref.date_of_birth)===day(mouse.date_of_birth)&&sex(ref.sex)===sex(mouse.sex));}
    const lookup=resolved?.currentSourceRef??ref;add(result,refKey(lookup.record_id,lookup.source_cell,lookup.tag,lookup.date_of_birth,lookup.sex),value);
   }
  }
 }
 return result;
}

/** Current source observations are a read-only projection. A linked SID does not
 * assign a cage or change biology, lifecycle, protocols or effective move dates.
 * Consumers counting current placement must require placementStatus=observed;
 * byMouse deliberately retains held candidates so detail views can show risks. */
export function projectCurrentAnimalSheetObservations(dataset){
 const observations=[],byMouse=new Map(),byLocation=new Map(),warnings=[];
 if(dataset?.history_projection?.read_only===true)return {observations,byMouse,byLocation,warnings};
 const tables=dataset?.tables||{},mice=list(tables.mice).filter(active),context=createCageObservationContext(dataset),links=reviewLinks(dataset,mice);
 const rooms=index(list(tables.rooms),'room_id'),racks=index(list(tables.racks),'rack_id'),cages=index(list(tables.cages).filter(active),'cage_sid'),mouseById=index(mice,'mouse_sid');
 const positions=list(tables.locations).filter(p=>active(p)&&p.source_current===true&&p.active!==false&&p.source_position_closed!==true&&text(p.location_id));
 const locationCounts=new Map(),mouseCounts=new Map();for(const p of positions)locationCounts.set(text(p.location_id),(locationCounts.get(text(p.location_id))||0)+1);for(const m of mice)mouseCounts.set(text(m.mouse_sid),(mouseCounts.get(text(m.mouse_sid))||0)+1);
 const warn=(row,code,message,{hold=true,block=false}={})=>{if(row.warnings.some(w=>w.code===code))return;row.warnings.push({code,message});warnings.push({key:row.key,sourceLocationId:row.sourceLocationId,sourceCell:row.sourceCell,mouseSid:row.mouseSid,code,message});if(hold)row.placementStatus='held';if(block)row.associationStatus='blocked';};
 for(const position of positions){
  const locationId=text(position.location_id),room=rooms.get(text(position.room_id)),rack=racks.get(text(position.rack_id)),capture=captured(position),animals=context.observation(position).animals;
  // Resolve through existing moved-card/manual-override rules, never infer a
  // physical placement merely because a link references this raw source ID.
  const resolved=cageSheetSourceRows(dataset,locationId,context);
  const movedClaims=(context.claims.get(locationId)||[]).filter(cage=>text(cage.location_id)!==locationId);
  for(let i=0;i<animals.length;i++){
   const animal=animals[i],key=refKey(locationId,animal.sourceCell,animal.tag,animal.dateOfBirth,animal.sex),matchingLinks=links.get(key)||[];
   const literal=resolved.filter(r=>text(r.sourceCell)===text(animal.sourceCell)&&text(r.sourceTag||r.tag)===text(animal.tag)&&day(r.dateOfBirth)===day(animal.dateOfBirth));
   const candidateIds=[...new Set([...matchingLinks.map(r=>text(r.mouse.mouse_sid)),...literal.filter(r=>r.matchStatus==='matched'&&r.mouseSid).map(r=>text(r.mouseSid))])].filter(Boolean);
   const mouse=candidateIds.length===1?mouseById.get(candidateIds[0]):null,cage=mouse?cages.get(text(mouse.cage_sid)):null;
   const chosen=mouse?matchingLinks.find(r=>r.mouse===mouse&&r.valid):null,invalid=matchingLinks.some(r=>!r.valid);
   const identityKind=chosen?.identityKind||(!matchingLinks.length&&mouse&&literal.some(r=>r.matchStatus==='matched'&&text(r.mouseSid)===text(mouse.mouse_sid))?'recorded':'unlinked');
   // The legacy note may merge a NOTE-cell literal with old threaded replies.
   // Keep the available text as source provenance, not a current animal note;
   // do not heuristically strip human content or claim this parsed text is the
   // complete original workbook annotation.
   const noteCell=chosen?.resolved?.sourceObservation?.note_cell??expectedNoteCell(position,animal.sourceCell),literalNote=readCurrentLiteralNote(position,noteCell),mixedThread=threadedNote(animal.note||''),annotation=animal.note&&(mixedThread||!literalNote.known||animal.note!==(literalNote.value||''))?animal.note:null;
   const row={key:`${locationId}:${text(animal.sourceCell)||'row-'+i}:${observations.length}`,sourceLocationId:locationId,sourceCell:animal.sourceCell||null,sourceTag:animal.tag,sourceDob:animal.dateOfBirth||null,sourceSex:animal.sex||null,sourceEarMark:animal.earMark||null,sourceNote:literalNote.known?literalNote.value:null,sourceNoteCell:noteCell??null,sourceNoteKnown:literalNote.known,sourceAnnotation:annotation,sourceAnnotationScope:annotation?'parsed_source_text':null,sourceObservation:chosen?.resolved?.sourceObservation?structuredClone(chosen.resolved.sourceObservation):null,sourceRoomId:text(position.room_id)||null,sourceRoomLabel:text(position.source_room_label)||text(room?.name||room?.label)||text(position.room_id)||null,sourceRackId:text(position.rack_id)||null,sourceRackLabel:text(position.source_rack_label)||text(rack?.name||rack?.label)||text(position.rack_id)||null,sourcePositionLabel:text(position.label||position.source_label)||locationId,sourceCaptureAt:capture.at,sourceCaptureBasis:capture.basis,sourceUrl:https(position.source_url),sourceFileId:text(position.source_file_id)||null,sourceSheetId:position.source_sheet_id??null,mouseSid:mouse?text(mouse.mouse_sid):null,candidateMouseSids:candidateIds,recordedTag:mouse?text(mouse.physical_tag)||null:null,recordedEarMark:mouse?text(mouse.ear_mark)||null:null,recordedNote:mouse?text(mouse.comment):null,recordedCageSid:mouse?text(mouse.cage_sid)||null:null,recordedCageTag:mouse?text(cage?.cage_tag||mouse.cage_tag)||null:null,recordedLocationId:mouse?text(cage?.location_id)||null:null,recordedState:mouse?.state??null,identityKind,identityLabel:identityKind==='inferred'?'Inferred source association':identityKind==='reviewed'?'Reviewed source association':identityKind==='recorded'?'Recorded identity match':'Unlinked source observation',confidence:chosen?.confidence??null,associationStatus:mouse&&identityKind!=='unlinked'?'linked':candidateIds.length>1?'ambiguous':'unlinked',placementStatus:mouse&&identityKind!=='unlinked'?'observed':'unlinked',effectiveMoveDate:null,warnings:[]};
   if(candidateIds.length>1){row.associationStatus='ambiguous';warn(row,'ambiguous-identity','More than one recorded mouse is associated with this source observation.');}
   if(invalid)warn(row,'invalid-association-basis','The source association has an unsupported or inconsistent inference basis.',{block:true});
   if(locationCounts.get(locationId)>1)warn(row,'duplicate-source-location','This source location is duplicated in the dataset.',{block:true});
   if(mouseCounts.get(row.mouseSid)>1)warn(row,'duplicate-mouse-id','The recorded mouse identifier is duplicated.',{block:true});
   if(!animal.sourceCell)warn(row,'missing-source-cell','The source observation lacks a retained cell coordinate.',{block:true});
   if(mixedThread)warn(row,'source-note-unclassified-thread','Threaded source annotation is retained separately; it is not classified as a current animal note.',{hold:false});
   if(!literalNote.known)warn(row,'source-note-unavailable','The current literal NOTE cell cannot be recovered unambiguously. The saved dated observation does not replace it.',{hold:false});
   if(sourceNeedsReview(position,animal))warn(row,'source-annotation-review','The source observation or its annotations require review. Identity association does not clear this warning.');
   if(literal.some(r=>r.matchStatus==='ambiguous'||r.matchStatus==='conflict'))warn(row,'source-identity-conflict','The existing source resolver reports an ambiguous or conflicting observation.');
   if((mouse&&animal.dateOfBirth&&day(mouse.date_of_birth)!==day(animal.dateOfBirth))||(mouse&&animal.sex&&sex(mouse.sex)!==sex(animal.sex)))warn(row,'source-identity-conflict','The observed DOB or sex conflicts with the recorded mouse.');
   if(mouse&&mouse.state!=='Stock')warn(row,'recorded-status-review','The recorded mouse is not Stock. Source presence does not change its status.');
   if(mouse?.cage_sheet_overrides?.cage_sid===true)warn(row,'manual-placement-override','A deliberate recorded cage assignment takes precedence over source placement.');
   if(movedClaims.length)warn(row,'moved-card-claim','A moved physical card claims this source observation; the raw source reference does not establish current placement.');
   if(mouse&&row.recordedLocationId&&row.recordedLocationId!==locationId)warn(row,'recorded-placement-differs','The observed source position differs from the recorded cage position.',{hold:false});
   observations.push(row);add(byLocation,locationId,row);for(const id of candidateIds)add(byMouse,id,row);
  }
 }
 // This detects conflicting observations only. It never uses a numeric suffix
 // to assign an unlinked row to a mouse. Inferred links explicitly claim that
 // their full terminal SID belongs to the SoftMouse SID namespace.
 const currentCellsByMouse=new Map(),currentCellsBySid=new Map();
 for(const row of observations){if(row.mouseSid)add(currentCellsByMouse,row.mouseSid,row);const tail=suffix(row.sourceTag);if(tail)add(currentCellsBySid,tail[1],row);}
 for(const rows of currentCellsByMouse.values())if(new Set(rows.map(r=>r.sourceLocationId+':'+r.sourceCell)).size>1)for(const row of rows){row.associationStatus='ambiguous';warn(row,'multiple-current-cells','One recorded mouse is linked to multiple current source cells.');}
 for(const row of observations)if(row.identityKind==='inferred'&&row.mouseSid){const rows=currentCellsBySid.get(row.mouseSid)||[];if(new Set(rows.map(r=>r.sourceLocationId+':'+r.sourceCell)).size>1){row.associationStatus='ambiguous';warn(row,'shared-source-sid','The inferred SoftMouse SID occurs in more than one current source cell or cohort.');}}
 return {observations,byMouse,byLocation,warnings};
}
