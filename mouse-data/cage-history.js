/* Read-only cage history. Snapshot labels are observations, never inferred cage identities. */
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():value==null?'':String(value);
const active=row=>row&&!row.app_archived_at&&row.archived!==true;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const token=value=>encodeURIComponent(text(value));
const unique=values=>[...new Set(values.filter(Boolean))];
const table=(data,name)=>list(data?.tables?.[name]);
const calendarToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const coordinate=value=>{const match=/^([A-Z]+)(\d+)$/i.exec(text(value));if(!match)return {};let column=0;for(const c of match[1].toUpperCase())column=column*26+c.charCodeAt(0)-64;return {row:Number(match[2]),column};};
const hiddenSource=source=>['hidden','veryHidden'].includes(source.sheet_state);
const sourceKey=source=>[source.workbook_id,source.snapshot_date].join('|');
const sheetKey=source=>text(source.sheet_id)||/[?#&]gid=(\d+)/.exec(text(source.source_url))?.[1]||text(source.sheet_name);
const positionKey=source=>[source.workbook_id,sheetKey(source),source.source_header_cell||source.source_range||source.cage_label].join('|');
const blockKey=source=>[source.snapshot_date,positionKey(source)].join('|');
const sourceRoomNames={room_sheet_beh:'Ani Beh',room_sheet_rat:'SHLAC Rat room',room_sheet_conventional:'SHLAC Conventional',room_sheet_spf:'SHLAC SPF'};
function roomName(source){
 const explicit=text(source.room_label),known=sourceRoomNames[source.source_room_id];
 if(known)return known;
 const name=explicit||text(source.sheet_name)||'(untitled)';
 if(/^(?:SHH?\s+)?(?:ani(?:mal)?\s*beh(?:aviou?r)?)$/i.test(name))return 'Ani Beh';
 if(/^(?:SH\s*LAC[- ,]*)?(?:Rat Room)(?:\s*\(LocoBoxes\), Rat room 6)?$/i.test(name))return 'SHLAC Rat room';
 if(/^(?:SH\s*LAC[- ,]*)?(?:Conventional(?: area)?)(?:, Mouse Room #2)?$/i.test(name))return 'SHLAC Conventional';
 if(/^(?:SH\s*LAC[- ,]*)?SPF(?:, Room 6)?$/i.test(name))return 'SHLAC SPF';
 return name;
}


function sourcePosition(p,{event_id,kind='position_capture',priority=4,conflict_reason=null}={}){
 if(!p||!date(p.source_snapshot_date)||!text(p.source_file_id)||!text(p.source_label||p.label)||typeof p.source_block_text!=='string')return null;
 const m=p.manager_source||{},managerDate=m.observed_on||m.snapshot_date;
 return {snapshot_date:p.source_snapshot_date,date_basis:p.source_snapshot_date_basis||'source_position_capture',workbook_id:p.source_file_id,title:p.source_title,sheet_id:p.source_sheet_id,sheet_name:p.source_sheet,source_url:p.source_url,source_header_cell:p.source_cell,source_range:p.source_block_range,cage_label:p.source_label||p.label,block_text:p.source_block_text,observed_tags:list(p.source_observed_tags),
  manager_name:Object.hasOwn(p,'source_manager_name')?p.source_manager_name:managerDate===p.source_snapshot_date?(m.name||m.manager_name):null,
  manager_acronym:Object.hasOwn(p,'source_manager_acronym')?p.source_manager_acronym:managerDate===p.source_snapshot_date?m.acronym:null,
  room_label:p.source_room_label||null,rack_label:p.source_rack_label||null,source_room_id:p.room_id||null,source_rack_id:p.rack_id||null,source_is_current_map:p.record_origin==='current_google_sheet_map',sheet_state:p.source_sheet_state||null,cage_observation:p.source_cage_observation||null,source_position_closed:p.source_position_closed===true,source_closed_cells:list(p.source_closed_cells),review_flags:list(p.source_review_flags),manager_literal:p.source_manager_raw||null,capture_at:p.source_capture_at||p.source_last_seen_at||null,event_id:event_id||p.location_id,kind,complete:false,priority,conflict_reason};
}
function captureTime(source){const stamp=Date.parse(source.capture_at);return Number.isFinite(stamp)?stamp:null;}
const taipeiDate=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
function revisionMetadata(source){
 if(!text(source.revision_series_id)&&!text(source.revision_position_key))return null;
 const stamp=Date.parse(source.source_revision_modified_at),column=coordinate(source.source_header_cell).column,room=roomName(source),label=text(source.cage_label).replace(/\s/g,'').toUpperCase();
 if(!Number.isFinite(stamp)||taipeiDate(stamp)!==source.snapshot_date||!column||!text(source.source_revision_id)||!text(source.revision_base_id)||!['baseline','change'].includes(source.revision_observation_kind))return false;
 if(source.revision_series_id!==[source.workbook_id,sheetKey(source),room].join('|')||source.revision_position_key!==[sheetKey(source),room,label,column].join('|'))return false;
 if(source.revision_observation_kind==='baseline'&&source.revision_base_id!==source.source_revision_id)return false;
 if(source.snapshot_at&&Date.parse(source.snapshot_at)!==stamp)return false;
 return {capture_at:new Date(stamp).toISOString(),revision_valid:true};
}
function latestSource(a,b){
 if(a.snapshot_date!==b.snapshot_date)return a.snapshot_date>b.snapshot_date?a:b;
 const at=captureTime(a),bt=captureTime(b),rank=s=>s.priority*1000+(Number.isSafeInteger(s.parser_revision)&&s.parser_revision>=0&&s.parser_revision<1000?s.parser_revision:0);
 if(at!==null&&bt!==null&&at!==bt)return at>bt?a:b;
 // An exact Drive revision time outranks an undated compact copy on that day.
 if(a.revision_valid&&at!==null&&bt===null)return a;
 if(b.revision_valid&&bt!==null&&at===null)return b;
 return rank(a)>rank(b)?a:b;
}


function snapshotSources(data){
 const sources=[];
 for(const event of table(data,'husbandry_events').filter(active)){
  if(event.event_type==='animal_sheet_cage_snapshot'){
   const s=event.source_cage_snapshot;
   if(!s||s.schema_version!==1||!date(s.snapshot_date)||!text(s.workbook_id)||!text(s.cage_label))continue;
   const revision=revisionMetadata(s);if(revision===false)continue;
   sources.push({...s,...revision,event_id:event.event_id,kind:'cage_snapshot',archive_baseline_date:s.layout_complete===true||s.coverage_complete===true?s.snapshot_date:null,complete:s.coverage_complete===true,priority:3});
  }else if(event.event_type==='source_manager_observation'){
   const e=event.source_evidence||{},d=e.snapshot_date||event.event_date;
   if(!date(d)||!text(e.workbook_id)||!text(event.source_cage_label))continue;
   sources.push({snapshot_date:d,date_basis:e.snapshot_date_basis||event.source_date_basis||'unknown',workbook_id:e.workbook_id,title:e.workbook_title,sheet_id:e.sheet_id,sheet_name:e.sheet_name,source_url:e.source_url,source_header_cell:e.source_header_cell,source_range:e.source_range,cage_label:event.source_cage_label,body:list(event.source_body),manager_name:event.manager,manager_acronym:event.manager_acronym,event_id:event.event_id,kind:'manager_observation',complete:false,priority:1});
 }else if(event.event_type==='animal_sheet_source_change'){
   const change=event.animal_sheet_change;
   if(!change||change.schema_version!==1||change.entity_type!=='locations'||!text(change.entity_id))continue;
   // A successful withdrawal is a dated observation of a missing source slot,
   // not a claim that its former cage became empty or moved on that date.
   const observed=change.observation_date,stamp=Date.parse(event.source_capture_at),before=change.before;
   if(change.action==='withdrawn'&&before?.location_id===change.entity_id&&before.source_file_id===event.source_file_id&&before.record_origin==='current_google_sheet_map'&&date(observed)&&Number.isFinite(stamp)&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp))===observed){
    const source=sourcePosition(before,{event_id:event.event_id,kind:'import_withdrawal',priority:6});
    if(source&&source.snapshot_date<=observed)sources.push({...source,snapshot_date:observed,date_basis:'source_withdrawal_capture',capture_at:event.source_capture_at,withdrawn:true});
   }
   for(const side of ['before','after']){
    const p=change[side];
    // Snapshot dates belong to the source payload, not the import or effective date.
    // A withdrawn after-state is absence, not a newly observed occupied/empty position.
    if(!p||p.location_id!==change.entity_id||p.source_file_id!==event.source_file_id||p.record_origin!=='current_google_sheet_map'||side==='after'&&(change.action==='withdrawn'||p.source_current===false))continue;
    const source=sourcePosition(p,{event_id:event.event_id,kind:'import_change_'+side,priority:side==='after'?5:2,conflict_reason:side==='after'&&change.action==='conflict'?(change.conflict_reason||'Import conflict'):null});
    if(source)sources.push(source);
   }
  }
 }
 // A currently loaded source position is usable only at its own recorded capture date.
 // Editable manager/notes and current room names are deliberately not copied into the past.
 for(const p of table(data,'locations')){const source=sourcePosition(p);if(source)sources.push(source);}
 const dedup=new Map();
 for(const s of sources){
  // Keep revision baselines and every timestamped delta until the series is
  // composed. Daily coordinate dedup would otherwise discard a baseline when
  // a later revision changed that same grid on the same calendar day.
  const key=s.revision_valid?['revision',s.workbook_id,s.source_revision_id,s.revision_position_key].join('|'):blockKey(s),old=dedup.get(key);if(!old){dedup.set(key,s);continue;}
  // Never inherit a blank manager from an earlier observation of this position.
  const chosen=latestSource(s,old);
  dedup.set(key,{...chosen,archive_baseline_date:s.archive_baseline_date||old.archive_baseline_date||null});
 }
 return [...dedup.values()];
}

function managedEvents(data){return table(data,'husbandry_events').filter(e=>active(e)&&date(e.event_date)&&['cage_move','cage_assignment','cage_location_assignment'].includes(e.event_type));}

/** Dates with actual source snapshots or recorded assignment events, not invented daily states. */
export function getCageHistoryDates(dataset,{includeHiddenSources=false}={}){return unique([...snapshotSources(dataset).filter(s=>includeHiddenSources||!hiddenSource(s)).map(s=>s.snapshot_date),...managedEvents(dataset).map(e=>e.event_date)]).sort();}

function bodyText(source){
 if(text(source.block_text))return text(source.block_text);
 return list(source.body).map(cell=>{const rowDates=list(cell.same_row_dates).map(d=>`${text(d.cell)}: ${text(d.value)}`).join('; ');return `${text(cell.cell)||'?'}: ${text(cell.raw)}${rowDates?`\nSource row dates (${text(cell.cell)||'?'}): ${rowDates}`:''}`;}).join('\n');
}
function observedLabels(source){
 if(list(source.observed_tags).length)return unique(source.observed_tags.map(text));
 return unique(list(source.body).map(cell=>text(cell.raw)).filter(raw=>/\b[MF]\s*\d+\b/i.test(raw)||/[MF]\d+/i.test(raw)));
}
// Daily imports retain only changed positions. Select a source workbook cohort,
// then overlay its dated position captures on the latest archived layout. A later
// workbook copy starts a separate cohort; matching slot labels never bridge eras.
function selectedSnapshotSources(sources){
 if(!sources.length)return [];
 const latest=sources.reduce((at,s)=>s.snapshot_date>at?s.snapshot_date:at,''),latestRows=sources.filter(s=>s.snapshot_date===latest),current=latestRows.filter(s=>s.source_is_current_map===true),workbooks=new Set((current.length?current:latestRows).map(s=>s.workbook_id)),selected=[];
 for(const workbook of workbooks){
  const rows=sources.filter(s=>s.workbook_id===workbook),baselines=new Map(),positions=new Map(),revisionBaselines=new Map();
  for(const s of rows){
   if(s.archive_baseline_date>(baselines.get(sheetKey(s))||''))baselines.set(sheetKey(s),s.archive_baseline_date);
   if(s.revision_valid&&s.revision_observation_kind==='baseline'){const prior=revisionBaselines.get(s.revision_series_id);if(!prior||captureTime(s)>captureTime(prior))revisionBaselines.set(s.revision_series_id,s);}
  }
  const candidates=rows.filter(s=>{
   const baseline=revisionBaselines.get(s.revision_series_id);
   return (!baselines.has(sheetKey(s))||s.snapshot_date>=baselines.get(sheetKey(s)))&&(!s.revision_valid||baseline?.revision_base_id===s.revision_base_id&&captureTime(s)>=captureTime(baseline));
  });
  const revisionKeys=new Set(candidates.filter(s=>s.revision_valid).map(s=>s.revision_position_key)),nativeKeys=new Map();
  const signature=s=>[sheetKey(s),roomName(s),text(s.cage_label).replace(/\s/g,'').toUpperCase(),coordinate(s.source_header_cell).column||''].join('|');
  for(const s of candidates.filter(s=>!s.revision_valid)){const key=s.snapshot_date+'|'+signature(s),anchors=nativeKeys.get(key)||new Set();anchors.add(s.source_header_cell);nativeKeys.set(key,anchors);}
  for(const s of candidates){
   const physical=signature(s),join=s.revision_valid||revisionKeys.has(physical)&&nativeKeys.get(s.snapshot_date+'|'+physical)?.size===1;
   const key=join?workbook+'|revision-position|'+physical:positionKey(s),old=positions.get(key);positions.set(key,old?latestSource(s,old):s);
  }
  selected.push(...positions.values());
 }
 return selected;
}
function snapshotProjection(sources){
 const rooms=new Map(),racks=new Map(),locations=[],roomSheets=new Map();
 for(const s of sources){const key=s.workbook_id+'|'+roomName(s),sheets=roomSheets.get(key)||new Set();sheets.add(sheetKey(s));roomSheets.set(key,sheets);}
 for(const s of sources){
  const roomLabel=roomName(s);
  const room_id='history-room:'+token([s.workbook_id,roomLabel].join('|'));
  const multipleSheets=roomSheets.get(s.workbook_id+'|'+roomLabel).size>1,baseRack=text(s.rack_label)||'Positions',sheetLabel=text(s.sheet_name)||'(untitled)';
  const rackLabel=baseRack+(multipleSheets?' · '+sheetLabel:'')+(hiddenSource(s)?' (archived)':''),rack_id='history-rack:'+token([room_id,sheetKey(s),baseRack].join('|'));
  rooms.set(room_id,{room_id,name:roomLabel,history_read_only:true,record_origin:'historical_snapshot_projection'});
  racks.set(rack_id,{rack_id,room_id,name:rackLabel,history_read_only:true,record_origin:'historical_snapshot_projection'});
  const location_id='history-position:'+token(blockKey(s));
  locations.push({location_id,room_id,rack_id,label:text(s.cage_label),...coordinate(s.source_header_cell),
   source_label:text(s.cage_label),source_cage_observation:s.cage_observation||s.source_cage_observation||null,source_block_text:[bodyText(s),text(s.manager_literal)?`Source manager label (literal): ${text(s.manager_literal)}`:null,s.conflict_reason?`Unverified incoming source observation; import conflict (${text(s.conflict_reason)}). Not applied as a cage or animal assignment.`:null,s.formula_cells_omitted?`${s.formula_cells_omitted} formula cells omitted from this compact view; see the original source.`:null].filter(Boolean).join('\n'),source_block_range:s.source_range||null,source_observed_tags:observedLabels(s),
   source_file_id:s.workbook_id,source_title:s.title||null,source_sheet:s.sheet_name||null,source_sheet_id:s.sheet_id??null,source_sheet_state:s.sheet_state||null,source_position_closed:s.source_position_closed===true,source_closed_cells:list(s.source_closed_cells),source_review_flags:list(s.review_flags),source_room_label:roomLabel,source_rack_label:rackLabel,source_cell:s.source_header_cell||null,source_url:s.source_url||null,
   source_revision_id:s.source_revision_id||null,source_revision_modified_at:s.source_revision_modified_at||null,source_revision_series_id:s.revision_series_id||null,source_revision_position_key:s.revision_position_key||null,source_snapshot_date:s.snapshot_date,source_snapshot_date_basis:s.date_basis||'unknown',source_capture_at:s.capture_at||null,source_import_conflict:s.conflict_reason||null,source_current:true,source_historical:true,
   source_manager_name:s.manager_name||null,source_manager_acronym:s.manager_acronym||null,source_manager_raw:s.manager_literal||null,source_event_id:s.event_id||null,
   history_evidence_kind:'source_snapshot',history_read_only:true,record_origin:'historical_snapshot_projection',requires_review:true,
   notes:'Source labels at the snapshot date; cage and animal identities are not assigned from these labels.'});
 }
 return {rooms:[...rooms.values()],racks:[...racks.values()],locations};
}

function latestBy(events,field,at,signature,warnings,label){
 const groups=new Map();
 for(const e of events){const id=text(e[field]);if(!id||e.event_date>at)continue;const group=groups.get(id);if(!group||e.event_date>group[0].event_date)groups.set(id,[e]);else if(e.event_date===group[0].event_date)group.push(e);}
 const selected=new Map();
 for(const [id,rows]of groups){
  if(new Set(rows.map(signature)).size>1){warnings.push(`${label} ${id}: contradictory assignments on ${rows[0].event_date}; no within-day order is recorded.`);continue;}
  selected.set(id,rows[0]);
 }
 return selected;
}
function endedAt(row,at){return date(row?.end_date)&&row.end_date<=at;}
function managedProjection(data,at,warnings){
 const events=managedEvents(data),mouseRows=new Map(table(data,'mice').map(m=>[text(m.mouse_sid),m])),cageRows=new Map(table(data,'cages').map(c=>[text(c.cage_sid),c]));
 const mouseMoves=latestBy(events.filter(e=>e.event_type!=='cage_location_assignment'),'mouse_sid',at,e=>text(e.cage_sid),warnings,'Mouse');
 const cageMoves=latestBy(events.filter(e=>e.event_type==='cage_location_assignment'),'cage_sid',at,e=>JSON.stringify([e.room_id||null,e.rack_id||null,e.location_id||null,e.room_label||null,e.rack_label||null,e.position_label||null]),warnings,'Cage');
 const mice=[],cages=new Map(),rooms=new Map(),racks=new Map(),locations=new Map(),usedEvents=[];
 function cage(sid,event){
  const old=cageRows.get(sid);
  if(endedAt(old,at)||date(old?.set_up_date)&&old.set_up_date>at)return null;
  if(!cages.has(sid))cages.set(sid,{cage_sid:sid,cage_tag:null,state:'History recorded',record_origin:'historical_assignment_projection',history_read_only:true,history_evidence_kind:'last_recorded_assignment',manager:null});
  const result=cages.get(sid);if(text(event?.cage_tag))result.cage_tag=text(event.cage_tag);return result;
 }
 for(const [sid,e]of cageMoves){
  const c=cage(sid,e);if(!c)continue;
  const room_id=text(e.room_id),rack_id=text(e.rack_id),location_id=text(e.location_id);
  Object.assign(c,{room_id:room_id||null,rack_id:rack_id||null,location_id:location_id||null,room:e.room_label||null,rack:e.rack_label||null,location:e.position_label||e.location_label||null,history_assignment_date:e.event_date,history_event_id:e.event_id});
  if(room_id)rooms.set(room_id,{room_id,name:e.room_label||room_id,history_read_only:true});
  if(rack_id)racks.set(rack_id,{rack_id,room_id:room_id||null,name:e.rack_label||rack_id,history_read_only:true});
  if(location_id)locations.set(location_id,{location_id,room_id:room_id||null,rack_id:rack_id||null,label:e.position_label||location_id,record_origin:'app_created',history_read_only:true});
  usedEvents.push(e);
 }
 for(const [sid,e]of mouseMoves){
  const original=mouseRows.get(sid),cageSid=text(e.cage_sid);
  if(!original){warnings.push(`Mouse ${sid}: a dated assignment refers to a missing mouse record.`);continue;}
  if(endedAt(original,at)||date(original.date_of_birth)&&original.date_of_birth>at)continue;
  // Null explicitly means unassigned. The latest later move is never used backward.
  const c=cageSid?cage(cageSid,e):null;if(cageSid&&!c)continue;
  mice.push({mouse_sid:sid,physical_tag:e.mouse_tag||e.physical_tag||null,sex:original.sex||'Unknown',date_of_birth:original.date_of_birth||null,
   cage_sid:cageSid||null,cage_tag:c?.cage_tag||null,state:'Stock',manager:null,genotype:null,ear_mark:null,record_origin:'historical_assignment_projection',
   history_read_only:true,history_evidence_kind:'last_recorded_assignment',history_assignment_date:e.event_date,history_event_id:e.event_id,
   history_identity_note:'Sex and birth date use the identity record; mutable present-day tags, genotypes, managers and ear marks are omitted.'});
  usedEvents.push(e);
 }
 // A recorded physical assignment without observed residents remains an occupancy-unknown cage.
 for(const c of cages.values())if(!mice.some(m=>m.cage_sid===c.cage_sid))c.history_occupancy_unknown=true;
 const cageIds=new Set(cages.keys()),locationIds=new Set(locations.keys()),roomIds=new Set(rooms.keys()),rackIds=new Set(racks.keys());
 const lights=table(data,'light_events').filter(e=>active(e)&&date(e.start_date)&&e.start_date<=at&&(!e.end_date||date(e.end_date)&&(/exclusive|next phase start/i.test(e.interval_semantics||'')?at<e.end_date:at<=e.end_date))&&
  (e.cage_sid?cageIds.has(text(e.cage_sid)):e.location_id?locationIds.has(text(e.location_id)):e.rack_id?rackIds.has(text(e.rack_id)):e.room_id&&roomIds.has(text(e.room_id)))).map(e=>({...e,history_read_only:true}));
 return {mice,cages:[...cages.values()],rooms:[...rooms.values()],racks:[...racks.values()],locations:[...locations.values()],light_events:lights,events:usedEvents};
}

/** A read-only view of dated evidence, not a complete census reconstructed from today's records.
 * Nearest earlier snapshots retain their actual snapshot date. Missing cages/animals stay unknown.
 * Export permissions are separate: this function receives only the dataset the caller may view.
 */
export function projectCageHistory(dataset,selectedDate,{today=calendarToday(),includeHiddenSources=false}={}){
 if(!date(today))throw new Error('A valid current date is required.');
 if(!selectedDate||selectedDate==='current')return {dataset,selectedDate:null,snapshotDate:null,basis:'current',readOnly:false,warnings:[],sources:[],coverage:null,availableDates:getCageHistoryDates(dataset,{includeHiddenSources})};
 if(!date(selectedDate)||selectedDate>today)throw new Error('Choose a valid historical date no later than today.');
 const warnings=[],allSources=snapshotSources(dataset),visibleSources=allSources.filter(s=>includeHiddenSources||!hiddenSource(s)),eligible=visibleSources.filter(s=>s.snapshot_date<=selectedDate),hiddenSourceCount=selectedSnapshotSources(allSources.filter(s=>s.snapshot_date<=selectedDate)).filter(hiddenSource).length;
 if(dataset?.source_archive_restricted===true&&table(dataset,'husbandry_events').some(e=>e.event_type==='animal_sheet_cage_snapshot'&&!e.source_cage_snapshot||e.event_type==='animal_sheet_source_change'&&!e.animal_sheet_change))warnings.push('Source snapshot details are withheld by the current data-visibility settings. Available dated assignments are still shown.');
 const snapshotDate=eligible.reduce((latest,s)=>!latest||s.snapshot_date>latest?s.snapshot_date:latest,null);
 const selectedSources=selectedSnapshotSources(eligible),closedSourceCount=selectedSources.filter(s=>!s.withdrawn&&s.source_position_closed===true).length,sourceRows=selectedSources.filter(s=>!s.withdrawn&&(includeHiddenSources||s.source_position_closed!==true));
 if(closedSourceCount&&!includeHiddenSources)warnings.push('Closed source grids are omitted; they remain available with archived layouts.');
 if(selectedSources.some(s=>s.withdrawn))warnings.push('Withdrawn source slots are omitted from their recorded removal date; no cage movement is inferred.');
 const snapshots=snapshotProjection(sourceRows),managed=managedProjection(dataset,selectedDate,warnings);
 if(snapshotDate&&snapshotDate!==selectedDate)warnings.push(`Nearest earlier source snapshot: ${snapshotDate}. Changes between that snapshot and ${selectedDate} are unknown.`);
 if(new Set(sourceRows.map(s=>s.snapshot_date)).size>1)warnings.push('Unchanged positions retain their last recorded snapshot date; later daily imports update only observed positions.');
 if(sourceRows.some(s=>/title/i.test(s.date_basis||'')))warnings.push('Some snapshot dates come from workbook titles, not a verified capture time.');
 if(sourceRows.some(s=>s.kind.startsWith('import_change_')))warnings.push('Daily import changes are partial source observations; unchanged positions may be absent. Capture dates are not effective movement dates.');
 if(sourceRows.some(s=>s.conflict_reason))warnings.push('Incoming observations with import conflicts are unverified and were not applied as cage or animal assignments.');
 if(sourceRows.length&&!sourceRows.every(s=>s.complete))warnings.push('Recovered source blocks may not cover every cage or room in that snapshot.');
 if(sourceRows.length)warnings.push('Source labels are unverified cage/animal observations, separate from confirmed dated assignments.');
 if(managed.events.length)warnings.push('Managed assignments show the last recorded change on or before the selected date. Missing moves or inventory records prevent a complete historical census.');
 if(managed.mice.length)warnings.push('Mouse sex and birth date come from identity records; mutable current genotypes, ear marks and managers are not projected backward.');
 if(!sourceRows.length&&!managed.events.length)warnings.push('No dated cage snapshot or assignment is available on or before this date. Current cages have not been projected backward.');
 const sourceCatalog=new Map();for(const s of sourceRows){const key=sourceKey(s);if(!sourceCatalog.has(key))sourceCatalog.set(key,{workbook_id:s.workbook_id,title:s.title||null,snapshot_date:s.snapshot_date,date_basis:s.date_basis||'unknown',source_url:s.source_url||null,blocks:0});sourceCatalog.get(key).blocks++;}
 const tables={...dataset?.tables,mice:managed.mice,cages:managed.cages,rooms:[...snapshots.rooms,...managed.rooms],racks:[...snapshots.racks,...managed.racks],locations:[...snapshots.locations,...managed.locations],light_events:managed.light_events};
 const basis=sourceRows.length?(managed.events.length?'snapshot_and_dated_assignments':'source_snapshot'):managed.events.length?'dated_assignments':'unavailable';
 const history={selected_date:selectedDate,snapshot_date:snapshotDate,basis,read_only:true,complete_census:false};
 return {dataset:{...dataset,tables,as_of_local_date:selectedDate,history_projection:history},selectedDate,snapshotDate,basis,readOnly:true,warnings:unique(warnings),sources:[...sourceCatalog.values()],
  hiddenSourceCount,closedSourceCount,includeHiddenSources,coverage:{sourceBlocks:sourceRows.length,assignmentEvents:managed.events.length,identifiedMice:managed.mice.length,identifiedCages:managed.cages.length,completeCensus:false},availableDates:unique([...visibleSources.map(s=>s.snapshot_date),...managedEvents(dataset).map(e=>e.event_date)]).sort()};
}
