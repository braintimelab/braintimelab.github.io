/* Recorded schedules stay with their captured animal card, not today's slot. */
const list=x=>Array.isArray(x)?x:[];
const text=x=>typeof x==='string'?x.trim():x==null?'':String(x);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const instant=x=>typeof x==='string'&&x.length<=40&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(x)&&date(x.slice(0,10))&&Number.isFinite(Date.parse(x));
const active=x=>x&&!x.app_archived_at&&x.archived!==true;
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const taipeiDate=value=>{if(typeof value!=='string'||!value.trim())return '';try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}catch{return '';}};
const contexts=new WeakMap();
function context(dataset){let c=contexts.get(dataset);if(c)return c;const mice=list(dataset.tables?.mice),events=list(dataset.tables?.husbandry_events);c={mice,cages:new Map(list(dataset.tables?.cages).map(r=>[text(r.cage_sid),r])),locations:new Map(list(dataset.tables?.locations).map(r=>[text(r.location_id),r])),lights:list(dataset.tables?.light_events).filter(active),protocols:events.filter(r=>active(r)&&r.event_type==='locobox_protocol'),stored:events.filter(r=>active(r)&&r.event_type==='mouse_entrainment'),timelines:new Map()};contexts.set(dataset,c);return c;}
const codes=new Set(['LD','DD','DL','LL','LDLD','SP','SP1','SP2','LP','LP1','LP2','Custom']);
export function entrainmentScheme(value){const s=text(value),upper=s.toUpperCase();if(!s||['UNKNOWN','—','–','-','END'].includes(upper))return 'unknown';if(upper==='CUSTOM')return 'Custom';if(codes.has(upper))return upper;const m=upper.match(/^T\s*(\d+(?:\.\d+)?)$/);return m&&Number(m[1])>0&&Number(m[1])<=1000?'T'+Number(m[1]):'unknown';}
export function entrainmentConditionLabel(value){const code=entrainmentScheme(value);return code==='unknown'?'—':code==='SP2'?'SP2 · 6:18 L:D':code==='LP2'?'LP2 · 18:6 L:D':code;}
function phase(input,source,index=0){
 const group=entrainmentScheme(source.source_group_condition),literal=entrainmentScheme(input.scheme??input.protocol);
 const scheme=literal==='LD'&&group!=='unknown'?group:literal==='Custom'&&entrainmentScheme(input.label)!=='unknown'?entrainmentScheme(input.label):literal;
 const cycle=Number(input.cycle_hours),light=Number(input.light_hours),period=scheme.startsWith('T')?Number(scheme.slice(1)):Number.isFinite(cycle)&&cycle>0?cycle:['SP2','LP2'].includes(scheme)?24:null;
 const lightHours=input.light_hours!=null&&Number.isFinite(light)?light:scheme==='SP2'?6:scheme==='LP2'?18:null;
 return {id:text(source.event_id)+':'+text(input.phase_id||input.start_date||index),start_date:date(input.start_date)?input.start_date:null,end_date:date(input.end_date)?input.end_date:null,scheme,cycle_hours:period,light_hours:lightHours,lights_on:input.lights_on||null,lights_off:input.lights_off||null,duration_days:Number.isFinite(input.duration_days)?input.duration_days:null,notes:input.notes||input.schedule_details||null,needs_clarification:input.requires_clarification===true||source.requires_clarification===true||scheme==='unknown',source_event_id:source.event_id,source_phase_id:input.phase_id||(input===source&&date(input.start_date)?input.start_date:null),source_record:source,withdrawn:source.source_current===false};
}
const phaseKey=(eventId,phaseId)=>JSON.stringify([text(eventId),phaseId==null?null:text(phaseId)]);
const reviewSignature=row=>JSON.stringify([row.scheme,row.cycle_hours,row.light_hours,row.lights_on,row.lights_off,row.duration_days,row.notes,row.needs_clarification]);
function reviewedGroups(dataset){const ctx=context(dataset);if(ctx.reviewedGroups)return ctx.reviewedGroups;const groups=new Map();for(const event of ctx.protocols){const p=event.locobox_protocol;if(!p?.reviewed_source_event_id||!['active','completed'].includes(p.status)||p.evidence_status!=='recorded'||list(p.phases).length!==1)continue;const key=phaseKey(p.reviewed_source_event_id,p.reviewed_source_phase_id??null),items=groups.get(key)??[];items.push({event,row:phase(p.phases[0],event)});groups.set(key,items);}for(const items of groups.values())items.sort((a,b)=>text(a.event.event_id).localeCompare(text(b.event.event_id)));return ctx.reviewedGroups=groups;}
function sourceLocation(dataset,cageSid,locationId){const cage=context(dataset).cages.get(text(cageSid));return {cage,location:text(cage?.cage_sheet_card?.source_location_id||cage?.cage_sheet_source_location_id||locationId||cage?.location_id)};}
const animalAnchor=animal=>JSON.stringify([tagKey(animal?.tag??animal?.source_tag),text(animal?.dateOfBirth??animal?.source_dob),text(animal?.sourceCell??animal?.source_cell)]);
function sameCohort(captured,observed){const left=list(captured?.animals).map(animalAnchor).sort(),right=list(observed?.animals).map(animalAnchor).sort();return left.length===right.length&&eq(left,right);}
export function cageEntrainmentTimeline(dataset,{cageSid=null,locationId=null}={}){
 const ctx=context(dataset),key=JSON.stringify([cageSid,locationId]);if(ctx.timelines.has(key))return ctx.timelines.get(key);
 const {cage,location}=sourceLocation(dataset,cageSid,locationId),position=ctx.locations.get(location),rows=[];
 const captured=cage?.cage_sheet_card?.observation;
 for(const event of ctx.lights){const historical=event.source_historical===true||event.history_read_only===true,explicitHistorical=historical&&cageSid&&text(event.cage_sid)===text(cageSid);if(historical&&cageSid&&!explicitHistorical)continue;const matches=cageSid&&event.cage_sid?text(event.cage_sid)===text(cageSid):location&&text(event.location_id)===location;if(!matches||captured&&!explicitHistorical&&!sameCohort(captured,event.source_cohort_observation))continue;rows.push(phase(event,event));}
 if(cageSid&&captured)for(const record of ctx.stored){const e=record.entrainment;if(!e||text(e.source_location_id)!==location||!list(captured.animals).some(animal=>animalAnchor(animal)===animalAnchor(e)))continue;const row=phase({...e,phase_id:e.source_phase_id},{...record,event_id:e.source_event_id});row.source_record=record;row.persisted=true;row.managed=e.association_basis==='manual';row.needs_clarification=e.status==='needs_clarification'||e.association_needs_review===true||row.scheme==='unknown';rows.push(row);}
 for(const event of ctx.protocols){
  const p=event.locobox_protocol;if(event.event_type!=='locobox_protocol'||!p)continue;
  if(cageSid&&p.cage_sid?text(p.cage_sid)!==text(cageSid):!location||text(p.location_id)!==location)continue;
  for(const [i,value]of list(p.phases).entries()){const row=phase(value,event,i);row.managed=['active','completed'].includes(p.status)&&p.evidence_status==='recorded'&&(p.link_status==='confirmed'||Boolean(p.reviewed_source_event_id));if(row.managed&&p.reviewed_source_event_id){row.reviewed_source_event_id=text(p.reviewed_source_event_id);row.reviewed_source_phase_id=p.reviewed_source_phase_id??null;}rows.push(row);}
 }
 rows.sort((a,b)=>text(a.start_date).localeCompare(text(b.start_date))||Number(b.managed||false)-Number(a.managed||false)||text(a.id).localeCompare(text(b.id)));
 // Precedence requires an explicit source identity. Date equality does not
 // identify a phase, a cage or a reviewed record.
 const reviewMap=reviewedGroups(dataset);for(const row of rows)if(row.reviewed_source_event_id){const group=reviewMap.get(phaseKey(row.reviewed_source_event_id,row.reviewed_source_phase_id))??[];if(new Set(group.map(item=>reviewSignature(item.row))).size>1)row.needs_clarification=true;}
 const reviewed=new Set(rows.filter(r=>r.reviewed_source_event_id).map(r=>phaseKey(r.reviewed_source_event_id,r.reviewed_source_phase_id)));
 const seen=new Set(),selected=rows.filter(row=>{const key=phaseKey(row.source_event_id,row.source_phase_id);if(reviewed.has(key)&&!row.reviewed_source_event_id||seen.has(key))return false;seen.add(key);return true;});
 const manager=text(cage?.manager||position?.source_manager_name||position?.source_manager_raw)||null;
 const result={rows:selected,issues:selected.filter(r=>r.needs_clarification).map(r=>({id:'ENTRAIN-REVIEW:'+r.source_event_id+':'+(r.source_phase_id||''),location_id:location,scheme:r.scheme,start_date:r.start_date,end_date:r.end_date,manager:manager||text(r.source_record?.clarification_manager_name||r.source_record?.clarification_manager_raw)||cohortManager(dataset,r.source_record)||null,reason:r.scheme==='unknown'?'Condition unspecified':'Confirm schedule details',source_event_id:r.source_event_id})),label:text(position?.label||cage?.cage_tag||location),hasSchedule:selected.length>0};ctx.timelines.set(key,result);return result;
}
const tagKey=x=>text(x).replace(/[’′]/g,"'").replace(/\s+/g,'').toUpperCase();
function identities(dataset){const ctx=context(dataset);if(ctx.identities)return ctx.identities;const index=new Map();for(const mouse of ctx.mice){for(const tag of [mouse.physical_tag,...list(mouse.physical_tag_aliases)]){const key=tagKey(tag);if(!key)continue;const rows=index.get(key)||[];if(!rows.includes(mouse))rows.push(mouse);index.set(key,rows);}}return ctx.identities=index;}
function cohortManager(dataset,source){const found=new Set(),index=identities(dataset);for(const animal of list(source?.source_cohort_observation?.animals)){const rows=(index.get(tagKey(animal.tag))||[]).filter(m=>date(animal.dateOfBirth)&&m.date_of_birth===animal.dateOfBirth);if(rows.length===1){const name=text(rows[0].manager||rows[0].owner);if(name)found.add(name);}}return found.size===1?[...found][0]:null;}
function sourceAssociations(dataset,{includeManaged=true}={}){
 const ctx=context(dataset),cacheKey=includeManaged?'associations':'sourceAssociations';if(ctx[cacheKey])return ctx[cacheKey];
 const index=identities(dataset),results=[],unresolved=[];
 const sources=[...list(dataset.tables?.light_events).filter(r=>active(r)&&r.source_current!==false)];
 const currentMice=ctx.mice.filter(m=>active(m)&&m.state==='Stock');
 if(includeManaged)for(const cage of list(dataset.tables?.cages).filter(active))if(cage.cage_entrainment?.schemaVersion===1){const entries=list(cage.cage_entrainment.entries),observed=cage.app_updated_at||cage.app_modified_at||cage.app_created_at||null,joined=taipeiDate(observed),members=currentMice.filter(m=>text(m.cage_sid)===text(cage.cage_sid));for(const [i,entry]of entries.entries())sources.push({event_id:'cage:'+cage.cage_sid,phase_id:entry.date,protocol:entry.scheme,start_date:entry.date,end_date:entries[i+1]?.date||null,cage_sid:cage.cage_sid,location_id:cage.location_id||null,association_basis:'confirmed_cage_interval',current_cage_save_proof:true,source_cohort_observation:{animals:members.map(m=>({tag:m.physical_tag,dateOfBirth:m.date_of_birth,mouseSid:text(m.mouse_sid),enrollmentDate:joined}))},source_last_seen_at:observed});}
 if(includeManaged)for(const event of ctx.protocols){const p=event.locobox_protocol;if(!p||p.reviewed_source_event_id||!['active','completed'].includes(p.status)||p.link_status!=='confirmed'||p.evidence_status!=='recorded')continue;const enrollment=new Map();for(const a of list(p.animal_associations))if(text(a?.mouse_sid)&&date(a.start_date)){const id=text(a.mouse_sid),prior=enrollment.get(id);enrollment.set(id,prior&&prior!==a.start_date?'ambiguous':a.start_date);}const observed=event.app_updated_at||event.app_created_at||null,fallback=taipeiDate(event.app_created_at||event.app_updated_at);for(const value of list(p.phases))sources.push({...value,event_id:event.event_id,cage_sid:p.cage_sid,location_id:p.location_id,association_basis:'confirmed_cage_interval',source_cohort_observation:{animals:list(p.animal_sids).map(id=>ctx.mice.find(m=>text(m.mouse_sid)===text(id))).filter(Boolean).map(m=>({tag:m.physical_tag,dateOfBirth:m.date_of_birth,mouseSid:text(m.mouse_sid),enrollmentDate:enrollment.get(text(m.mouse_sid))||fallback}))},source_last_seen_at:observed});}
 for(const source of sources){
  if(!date(source.start_date)||!source.source_cohort_observation)continue;
  const cohort=source.source_cohort_observation;
  for(const animal of list(cohort.animals)){
   if(source.association_basis!=='confirmed_cage_interval'&&(!/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(text(animal.sourceCell))||!instant(cohort.observed_at||source.source_last_seen_at||source.source_observed_at||source.source_captured_at))){unresolved.push({source_event_id:source.event_id,location_id:source.location_id,tag:animal.tag,date_of_birth:animal.dateOfBirth||null,reason:'Source cell and capture timestamp need confirmation'});continue;}
   const candidates=source.association_basis==='confirmed_cage_interval'?ctx.mice.filter(m=>text(m.mouse_sid)===animal.mouseSid):(index.get(tagKey(animal.tag))||[]).filter(m=>date(animal.dateOfBirth)&&m.date_of_birth===animal.dateOfBirth);
   if(candidates.length!==1){unresolved.push({source_event_id:source.event_id,location_id:source.location_id,tag:animal.tag,date_of_birth:animal.dateOfBirth||null,reason:candidates.length?'Ambiguous animal identity':'Animal needs an exact tag and DOB match'});continue;}
   const row=phase(source,source),mouse=candidates[0],observed=text(cohort.observed_at||source.source_last_seen_at||source.source_observed_at||source.source_captured_at),observedDate=taipeiDate(observed),confirmed=source.association_basis==='confirmed_cage_interval';
   if(confirmed){
    const prior=ctx.stored.find(r=>text(r.mouse_sid)===text(mouse.mouse_sid)&&phaseKey(r.entrainment?.source_event_id,r.entrainment?.source_phase_id)===phaseKey(source.event_id,row.source_phase_id)),firstObserved=taipeiDate(prior?.entrainment?.association_observed_at),enrolled=source.current_cage_save_proof===true&&prior?.entrainment?.association_basis==='confirmed_cage_interval'&&date(firstObserved)?firstObserved:animal.enrollmentDate;
    if(!date(enrolled)){unresolved.push({source_event_id:source.event_id,location_id:source.location_id,tag:animal.tag,date_of_birth:animal.dateOfBirth||null,reason:'Animal enrollment date needs confirmation'});continue;}
    row.start_date=[row.start_date,enrolled,date(mouse.date_of_birth)?mouse.date_of_birth:''].sort().at(-1);
    if(row.end_date&&row.end_date<=row.start_date||date(mouse.end_date)&&row.start_date>mouse.end_date)continue;
    if(row.start_date!==source.start_date)row.duration_days=null;
   }
   // Keep the card's complete schedule, but do not assert a past exposure from
   // a first observation made later. An explicit reviewed occupancy is separate.
   const lifeConflict=date(mouse.date_of_birth)&&row.start_date<mouse.date_of_birth||date(mouse.end_date)&&row.start_date>mouse.end_date||date(cohort.cage_started_date)&&row.start_date<cohort.cage_started_date||date(mouse.end_date)&&date(observedDate)&&mouse.end_date<observedDate;
   results.push({mouse,source,animal,row,observed:observed||null,associationNeedsReview:confirmed?false:!date(observedDate)||row.start_date<observedDate||Boolean(lifeConflict)});
  }
 }
 return ctx[cacheKey]={results,unresolved};
}
export function planAnimalEntrainmentSync(before,after,{now=new Date().toISOString(),includeReviewed=true,includeManaged=includeReviewed}={}){
 const existing=new Map(context(after).stored.map(r=>[r.event_id,r])),overlayCandidates=[...existing.values()],changes=[];
 const {results,unresolved:sourceUnresolved}=sourceAssociations(after,{includeManaged}),unresolved=[...sourceUnresolved];
 for(const {mouse,source,animal,row,observed,associationNeedsReview}of results){
  const event_id='ENTRAIN:'+text(mouse.mouse_sid)+':'+text(source.event_id)+(row.source_phase_id?':'+row.source_phase_id:''),old=existing.get(event_id);if(event_id.length>200||old?.entrainment?.association_basis==='manual')continue;
  if(old&&source.association_basis!=='confirmed_cage_interval'&&(tagKey(old.entrainment?.source_tag)!==tagKey(animal.tag)||old.entrainment?.source_dob!==animal.dateOfBirth||old.entrainment?.source_cell!==(animal.sourceCell||null))){unresolved.push({source_event_id:source.event_id,location_id:source.location_id,tag:animal.tag,date_of_birth:animal.dateOfBirth||null,reason:'Previously captured animal source evidence changed'});continue;}
  const retainedReview=old?.entrainment?.association_needs_review??associationNeedsReview;
  const e={schema_version:1,start_date:row.start_date,end_date:row.end_date,scheme:row.scheme,cycle_hours:row.cycle_hours,light_hours:row.light_hours,lights_on:row.lights_on,lights_off:row.lights_off,duration_days:row.duration_days,association_basis:source.association_basis||'source_card',association_observed_at:old?.entrainment?.association_observed_at||observed,association_needs_review:retainedReview,source_event_id:source.event_id,source_phase_id:row.source_phase_id,source_location_id:source.location_id||null,source_tag:old?.entrainment?.source_tag??animal.tag,source_dob:old?.entrainment?.source_dob??animal.dateOfBirth,source_cell:old?.entrainment?.source_cell??animal.sourceCell??null,status:row.needs_clarification||retainedReview?'needs_clarification':'recorded',notes:row.notes};
  if(old&&eq(old.entrainment,e))continue;
  const value={...(old||{}),event_id,event_type:'mouse_entrainment',mouse_sid:text(mouse.mouse_sid),event_date:e.start_date,cage_sid:source.cage_sid||null,location_id:source.location_id||null,record_origin:'animal_sheet_entrainment',app_created_at:old?.app_created_at||now,app_updated_at:now,entrainment:e};
  changes.push({id:event_id,previous:old||null,value});existing.set(event_id,value);
 }
 if(includeReviewed)for(const[target,reviews]of reviewedGroups(after)){
  if(new Set(reviews.map(item=>reviewSignature(item.row))).size>1){unresolved.push({source_event_id:reviews[0].event.locobox_protocol.reviewed_source_event_id,source_phase_id:reviews[0].event.locobox_protocol.reviewed_source_phase_id??null,reason:'Conflicting reviewed schedules require one active clarification'});continue;}
  const {row}=reviews[0];
  for(const original of overlayCandidates){
   if(phaseKey(original.entrainment?.source_event_id,original.entrainment?.source_phase_id)!==target)continue;
   const old=existing.get(original.event_id)||original,e={...old.entrainment,scheme:row.scheme,cycle_hours:row.cycle_hours,light_hours:row.light_hours,lights_on:row.lights_on,lights_off:row.lights_off,duration_days:row.duration_days,notes:row.notes,association_basis:'manual'};
   e.status=row.needs_clarification||e.association_needs_review?'needs_clarification':'recorded';
   if(eq(old.entrainment,e))continue;
   const value={...old,app_updated_at:now,entrainment:e};const pending=changes.findIndex(change=>change.id===old.event_id),change={id:old.event_id,previous:original,value};if(pending>=0)changes[pending]=change;else changes.push(change);existing.set(old.event_id,value);
  }
 }
 return {changes,unresolved};
}
export function applyAnimalEntrainmentSync(before,after,options={}){const plan=planAnimalEntrainmentSync(before,after,options);if(!plan.changes.length)return {...plan,dataset:after};const changed=new Map(plan.changes.map(r=>[r.id,r.value]));return {...plan,dataset:{...after,tables:{...after.tables,husbandry_events:[...list(after.tables?.husbandry_events).map(row=>{const value=changed.get(row.event_id);changed.delete(row.event_id);return value||row;}),...changed.values()]}}};}
export function mouseEntrainmentHistory(dataset,mouseSid){
 const stored=context(dataset).stored.filter(r=>text(r.mouse_sid)===text(mouseSid)),rows=stored.map(r=>({...r.entrainment,id:r.event_id,source_record:r,needs_clarification:r.entrainment?.scheme==='unknown'||r.entrainment?.status==='needs_clarification'||r.entrainment?.association_needs_review===true,persisted:true}));
 const present=new Set(rows.map(r=>r.source_event_id+':'+(r.source_phase_id||'')));for(const value of sourceAssociations(dataset).results)if(text(value.mouse.mouse_sid)===text(mouseSid)&&!present.has(value.source.event_id+':'+(value.row.source_phase_id||'')))rows.push({...value.row,association_basis:value.source.association_basis||'source_card',association_observed_at:value.observed,association_needs_review:value.associationNeedsReview,persisted:false});
 return rows.sort((a,b)=>text(a.start_date).localeCompare(text(b.start_date))||text(a.id).localeCompare(text(b.id)));
}
export function entrainmentClarifications(dataset){const issues=[],seen=new Set();for(const p of list(dataset.tables?.locations)){const result=cageEntrainmentTimeline(dataset,{locationId:p.location_id});for(const issue of result.issues)if(!seen.has(issue.id)){seen.add(issue.id);issues.push({...issue,label:result.label});}}return issues;}
export function validateMouseEntrainment(record,dataset={},old=null){
 if(record?.event_type!=='mouse_entrainment')return {errors:[],warnings:[]};const errors=[],e=record.entrainment;
 if(!e||e.schema_version!==1)return {errors:['Entrainment history needs schema version 1.'],warnings:[]};
 if(!text(record.mouse_sid)||!list(dataset.tables?.mice).some(m=>text(m.mouse_sid)===text(record.mouse_sid)))errors.push('Choose an existing mouse.');
 if(!date(e.start_date)||record.event_date!==e.start_date||e.end_date!=null&&(!date(e.end_date)||e.end_date<e.start_date))errors.push('Use a valid, ordered entrainment interval.');
 if(entrainmentScheme(e.scheme)!==e.scheme)errors.push('Choose a supported entrainment condition.');
 if(!['source_card','confirmed_cage_interval','manual'].includes(e.association_basis)||!['recorded','needs_clarification'].includes(e.status)||!text(e.source_event_id))errors.push('Preserve the schedule source and association.');
 for(const key of ['cycle_hours','light_hours','duration_days'])if(e[key]!=null&&(!Number.isFinite(e[key])||e[key]<0||e[key]>(key==='duration_days'?100000:1000)||key==='cycle_hours'&&e[key]===0))errors.push('Invalid '+key.replaceAll('_',' ')+'.');
 if(e.light_hours!=null&&e.cycle_hours!=null&&e.light_hours>e.cycle_hours||e.scheme==='DD'&&e.light_hours!=null&&e.light_hours!==0||e.scheme==='LL'&&e.light_hours!=null&&e.cycle_hours!=null&&e.light_hours!==e.cycle_hours||e.scheme?.startsWith('T')&&e.cycle_hours!=null&&e.cycle_hours!==Number(e.scheme.slice(1)))errors.push('Light duration and cycle must agree with the condition.');
 for(const key of ['lights_on','lights_off'])if(e[key]!=null&&!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(e[key]))errors.push('Use a valid clock time.');
 if(['DD','LL'].includes(e.scheme)&&(e.lights_on!=null||e.lights_off!=null))errors.push('Continuous light or dark cannot have daily on/off clocks.');
 if(e.notes!=null&&(typeof e.notes!=='string'||e.notes.length>2000))errors.push('Notes must be at most 2000 characters.');
 if(e.scheme==='unknown'&&e.status!=='needs_clarification'||e.association_needs_review===true&&e.status!=='needs_clarification')errors.push('Uncertain conditions and associations need clarification.');
 for(const key of ['source_event_id','source_phase_id','source_location_id'])if(e[key]!=null&&(typeof e[key]!=='string'||!e[key].trim()||e[key].length>200))errors.push('Preserve a valid source identity.');
 if(old&&(old.mouse_sid!==record.mouse_sid||['source_event_id','source_phase_id','source_tag','source_dob','source_cell','association_observed_at'].some(key=>!eq(old.entrainment?.[key]??null,e[key]??null))))errors.push('The mouse and original schedule association cannot be changed.');
 return {errors:[...new Set(errors)],warnings:[]};
}
