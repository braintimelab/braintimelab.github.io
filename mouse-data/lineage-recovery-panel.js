import {formatMouseSid} from './mouse-sid.js?v=188';
import {projectLineageRecoveryCoverage} from './lineage-recovery.js?v=199';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():'—';
const statuses={preserve:'Already saved',supported:'Supported proposal',review:'Needs review',blocked:'Conflicting evidence',missing_source:'Source evidence needed'};
const PAGE_SIZE=20,MAX_SELECTED_ROLES=100,MAX_SOURCE_FILE_BYTES=25*1024*1024;
const SOURCE_TABLES=['lineage_source_revisions','lineage_source_cells','lineage_source_observations','lineage_identity_bridges'];
const COVERAGE_FIELDS=['population','withAnyParent','withBothRoles','sireOnly','damOnly','withoutParents','ambiguousRoles','inferredRoles','withInferredParents'];
const sameCoverage=(a,b)=>object(a)&&object(b)&&COVERAGE_FIELDS.every(key=>Number.isSafeInteger(a[key])&&a[key]>=0&&a[key]===b[key]);
let instance=0;

/** Reviewed suggestions only. The host owns fresh evidence, worker cancellation,
 * exact server validation and the immutable operation/receipt journal. */
export function renderLineageRecoveryPanel(host,hooks={}){
 if(!host)return {dispose(){},isBusy:()=>false,hasDraft:()=>false};
 const id='lineage-recovery-'+(++instance),initialContext=hooks.getContext?.();
 let alive=true,revision=0,abort=null,report=null,rows=[],preview=null,selected=new Set();
 let phase='idle',scope='stock',filter='needed',search='',page=0,bucketPage=0,reviewed=false,error='',notice='',progress=null,outcome=null;
 let sourcePhase='idle',sourcePreview=null,sourceReviewed=false,sourceOutcome=null,sourceFilename='';
 const sourceBusy=()=>['reading','preparing','applying','verifying','retrying','refreshing'].includes(sourcePhase);
 const sourceWriteBusy=()=>['applying','retrying','refreshing'].includes(sourcePhase);
 const busy=()=>sourceBusy()||['analyzing','preparing','applying','verifying','retrying','refreshing'].includes(phase);
 const parentUncertain=()=>phase==='uncertain';
 const uncertain=()=>parentUncertain()||sourcePhase==='uncertain';
 const capability=()=>{const v=hooks.getCapability?.();return object(v)?v:{canAnalyze:false,canApply:false,reason:'Reconnect an Owner workspace before recovering parents.'};};
 const current=()=>alive&&host.isConnected!==false&&hooks.isCurrent?.()!==false&&hooks.getContext?.()===initialContext;
 const sid=value=>formatMouseSid(String(value),hooks.getDataset?.());
 function invalidate(){revision++;abort?.abort();abort=null;report=null;rows=[];preview=null;selected.clear();reviewed=false;sourcePreview=null;sourceReviewed=false;sourceOutcome=null;sourceFilename='';sourcePhase='invalid';phase='invalid';progress=null;error='The account, colony or data source changed. Close this panel and reopen it.';paint();}
 function check(){if(!current()){invalidate();throw new Error('The account, colony or data source changed.');}}
 const complete=()=>report?.completeness?.complete===true&&report?.limits?.bounded!==true;
 const supported=row=>row.value.disposition==='supported'&&row.value.applicable===true&&!list(row.value.existingParentSids).length&&list(row.value.proposedParentSids).length===1;
 const eligible=row=>supported(row)&&complete()&&capability().canApply===true;
 const selectable=row=>eligible(row)&&(selected.has(row.key)||selected.size<MAX_SELECTED_ROLES);
 function resetPreview(){preview=null;reviewed=false;if(phase==='prepared')phase='analyzed';}
 function roleRows(value){
  if(!object(value)||value.schemaVersion!==1||value.scope!==scope||!Array.isArray(value.children)||!object(value.coverageBefore)||!object(value.completeness))throw new Error('The parentage analysis was not returned completely. Run it again.');
  const result=[],keys=new Set();
  for(const child of value.children){
   if(!object(child)||typeof child.mouseSid!=='string'||!child.mouseSid||!object(child.roles))throw new Error('The analysis contains an invalid mouse identity.');
   for(const role of ['sire','dam']){
    const v=child.roles[role];
    if(!object(v)||v.role!==role||typeof v.key!=='string'||!v.key||keys.has(v.key)||!Object.hasOwn(statuses,v.disposition)||!Array.isArray(v.existingParentSids)||!Array.isArray(v.proposedParentSids))throw new Error('The analysis contains an invalid or repeated parent role.');
    keys.add(v.key);result.push({child,role,value:v,key:v.key});
   }
  }
  return result;
 }
 function projected(){
  if(!report)return null;
  const project=hooks.projectCoverage||projectLineageRecoveryCoverage;
  return project(report,[...selected]);
 }
 function mouseButton(raw,label){return `<button type="button" class="record-link" data-lr-open="${esc(raw)}">${esc(label||sid(raw))}</button>`;}
 function parentLabel(raw){
  const m=list(hooks.getDataset?.()?.tables?.mice).find(row=>String(row.mouse_sid)===String(raw));
  return mouseButton(raw,`${m?.physical_tag?m.physical_tag+' · ':''}SID ${sid(raw)}`);
 }
 function coverageHTML(before,after,label='After selected proposals'){
  if(!before)return '';
  const fields=[['withAnyParent','Mice with at least one parent'],['withBothRoles','Mice with both parent roles'],['withoutParents','Mice without parent links'],['ambiguousRoles','Parent roles with alternatives'],['inferredRoles','Inferred parent roles']];
  return `<section aria-label="Parentage coverage"><h3>Coverage · ${count(before.population)} ${scope==='stock'?'Current Stock mice':'mice in all records'}</h3><div class="table-scroll"><table class="compact-table"><thead><tr><th>Coverage</th><th>Before</th><th>${esc(label)}</th></tr></thead><tbody>${fields.map(([key,text])=>`<tr><th scope="row">${text}</th><td>${count(before[key])}</td><td>${count(after?.[key])}</td></tr>`).join('')}</tbody></table></div><p class="small muted">A saved role can contain alternatives. Inferred links remain inferred; source records do not establish biological confirmation.</p></section>`;
 }
 function evidenceHTML(row){
  const v=row.value,shown=list(v.evidencePresentation||v.presentation).slice(0,20);
  const reasons=list(v.reasonCodes).map(reason=>`<li>${esc(String(reason).replace(/_/g,' '))}</li>`).join('');
  return `${reasons?`<ul class="small">${reasons}</ul>`:''}<details class="source-disclosure"><summary>Evidence and conflicts (${shown.length})</summary>${shown.length?shown.map(ref=>`<div><strong>${esc(ref.label||ref.table||'Saved source evidence')}</strong><p class="small">${esc([ref.sourceFilename,ref.sheet,ref.row!=null?'Row '+ref.row:null,ref.sourceRecordId||ref.entityId].filter(Boolean).join(' · '))}</p>${ref.summary?`<p>${esc(ref.summary)}</p>`:''}${ref.sha256?`<p class="small">File SHA-256: <code>${esc(ref.sha256)}</code></p>`:''}</div>`).join(''):'<p class="small muted">No complete source reference is available for this role.</p>'}</details>`;
 }
 function resultRows(){
  const needle=search.trim().toLowerCase();
  return rows.filter(row=>(filter==='all'||filter==='needed'&&row.value.disposition!=='preserve'||row.value.disposition===filter)&&(!needle||[row.child.mouseSid,row.child.canonicalSid,row.child.physicalTag,row.child.dateOfBirth,row.role,...row.value.existingParentSids,...row.value.proposedParentSids,...list(row.value.reasonCodes)].some(value=>String(value??'').toLowerCase().includes(needle))));
 }
 function rowHTML(row){
  const v=row.value,m=row.child,chosen=selected.has(row.key),allowed=selectable(row),evidenceStatus=v.evidenceStatus||v.evidence_status||v.status;
  const evidenceLabel=evidenceStatus==='source_recorded'?'Source-recorded parent evidence':evidenceStatus==='inferred'?(v.applicable!==true&&v.disposition!=='preserve'?'Inferred candidate · needs review':'Inferred'+(v.confidence==='moderate'?' · moderate confidence':'')):'';
  return `<article class="panel"><div class="panel-body"><div class="settings-actions"><label><input type="checkbox" data-lr-select="${esc(row.key)}"${chosen?' checked':''}${!allowed||busy()||uncertain()?' disabled':''}> ${row.role==='sire'?'Sire':'Dam'} · ${esc(statuses[v.disposition])}</label>${mouseButton(m.mouseSid,`${m.physicalTag?m.physicalTag+' · ':''}SID ${m.canonicalSid||sid(m.mouseSid)}`)}</div><p class="small muted">Born ${esc(m.dateOfBirth||'not recorded')} · ${esc(m.sex||'Unknown sex')} · ${esc(m.state||'Unknown state')}</p><p><strong>Saved:</strong> ${v.existingParentSids.length?v.existingParentSids.map(parentLabel).join(', '):'Not recorded'}</p>${v.proposedParentSids.length?`<p><strong>${v.disposition==='supported'?'Proposed':'Candidate'}:</strong> ${v.proposedParentSids.map(parentLabel).join(', ')}</p>`:''}${evidenceLabel?`<p class="small">${esc(evidenceLabel)}</p>`:''}${evidenceHTML(row)}</div></article>`;
 }
 function bucketsHTML(){
  const buckets=list(report?.searchBuckets),start=bucketPage*10,visible=buckets.slice(start,start+10);
  if(!buckets.length)return '';
  return `<section class="panel"><div class="panel-body"><h3>Missing-source search groups (${count(buckets.length)})</h3><p>These groups help locate birth or breeding notes. A shared date of birth does not establish a litter, siblings or parents.</p><details><summary>Show source questions</summary>${visible.map(bucket=>`<div><h4>${esc(bucket.dateOfBirth||'Date of birth not recorded')} · ${count(bucket.mouseCount??list(bucket.mouseSids).length)} mice</h4><p>${esc(bucket.sourceQuestion||'Find an individually identified birth record and dated breeder evidence.')}</p><p>${list(bucket.mouseSids).map(raw=>mouseButton(raw,'SID '+sid(raw))).join(' · ')}</p></div>`).join('')}<div class="actions"><button type="button" class="button secondary" data-lr-action="buckets-previous"${bucketPage===0?' disabled':''}>Previous groups</button><span>${count(start+1)}–${count(Math.min(start+10,buckets.length))} of ${count(buckets.length)}</span><button type="button" class="button secondary" data-lr-action="buckets-next"${start+10>=buckets.length?' disabled':''}>Next groups</button></div></details></div></section>`;
 }
 function resultsHTML(){
  if(!report)return '';
  const proposals=rows.filter(supported).length,held=rows.filter(r=>r.value.disposition==='review').length,blocked=rows.filter(r=>r.value.disposition==='blocked').length,missing=rows.filter(r=>r.value.disposition==='missing_source').length,filtered=resultRows();
  page=Math.min(page,Math.max(0,Math.ceil(filtered.length/PAGE_SIZE)-1));const start=page*PAGE_SIZE;
  const sourceQuestionNotice=missing||held||blocked||list(report.searchBuckets).length?' The source questions and evidence show what still needs review.':'';
  return `${!complete()?`<p class="alert error" role="alert">Complete evidence is unavailable. Applying is disabled. ${esc([...list(report.completeness.blockers),...list(report.completeness.missingTables)].join('; '))}</p>`:''}<p><strong>${count(proposals)} supported parent proposals</strong> · ${count(held)} roles need review · ${count(blocked)} conflicting roles · ${count(missing)} roles need source evidence.</p>${report.limits?.sourceScope?`<p class="small muted">Evidence searched: ${esc(report.limits.sourceScope)}</p>`:''}${!proposals?'<p class="alert info">No supported missing parent roles were found in the available evidence. No parents will be added.'+sourceQuestionNotice+'</p>':''}${coverageHTML(report.coverageBefore,projected())}<div class="toolbar"><label>Status <select data-lr-field="filter">${[['needed','Missing roles and proposals'],['supported','Supported proposals'],['review','Needs review'],['blocked','Conflicts'],['missing_source','Source evidence needed'],['preserve','Already saved'],['all','All parent roles']].map(([v,label])=>`<option value="${v}"${filter===v?' selected':''}>${label}</option>`).join('')}</select></label><label>Find a mouse <input id="${id}-search" type="search" data-lr-field="search" value="${esc(search)}" placeholder="SID, tag, date or reason"></label></div><div class="actions"><button type="button" class="button secondary" data-lr-action="select-supported"${!complete()||!capability().canApply||busy()||uncertain()||!proposals?' disabled':''}>${proposals>MAX_SELECTED_ROLES?'Select up to 100 supported':'Select all supported'}</button><button type="button" class="button secondary" data-lr-action="clear-selection"${!selected.size||busy()||uncertain()?' disabled':''}>Clear selection</button><span>${count(selected.size)} parent roles selected</span></div>${proposals>MAX_SELECTED_ROLES?'<p class="small muted">Review up to 100 parent roles in each atomic save. After saving, analyze again to review any remaining supported roles.</p>':''}${selected.size===MAX_SELECTED_ROLES?'<p class="small muted" role="status">100 parent roles are selected. Uncheck a selected role before choosing another.</p>':''}${filtered.slice(start,start+PAGE_SIZE).map(rowHTML).join('')}${!filtered.length?'<p class="empty">No roles match these filters.</p>':''}<div class="actions"><button type="button" class="button secondary" data-lr-action="previous"${page===0?' disabled':''}>Previous</button><span>${filtered.length?count(start+1)+'–'+count(Math.min(start+PAGE_SIZE,filtered.length)):'0'} of ${count(filtered.length)} roles</span><button type="button" class="button secondary" data-lr-action="next"${start+PAGE_SIZE>=filtered.length?' disabled':''}>Next</button></div>${bucketsHTML()}`;
 }
 function previewHTML(){
  if(!preview)return '';
  return `<section class="panel" aria-label="Review selected parent proposals"><div class="panel-body"><h3>Review ${count(selected.size)} selected parent roles</h3>${coverageHTML(preview.coverageBefore,preview.coverageAfter,'After this reviewed selection')}${list(preview.warnings).map(w=>`<p class="small muted">${esc(w)}</p>`).join('')}<label><input type="checkbox" data-lr-field="reviewed"${reviewed?' checked':''}${busy()||uncertain()?' disabled':''}> I reviewed the selected links and their evidence. Inferred links remain inferred.</label></div></section>`;
 }
 function historicalSourceHTML(){
  const cap=capability(),available=cap.canRegisterHistoricalSources===true&&typeof hooks.previewHistoricalSourceRegistration==='function',blocked=busy()||uncertain()||phase==='invalid';
  const labels={lineage_source_revisions:'Source revisions',lineage_source_cells:'Source cells',lineage_source_observations:'Source observations and held review cases',lineage_identity_bridges:'Identity evidence bridges'};
  const pending=sourcePhase==='uncertain';
  return `<section class="panel" aria-label="Load historical lineage evidence"><div class="panel-body"><h3>Load historical evidence</h3><p>Register a reviewed historical-source JSON file so its evidence can be searched. This action adds source evidence and uncertain review cases; it does not add or change mouse parents.</p><label>Historical evidence file <input type="file" accept=".json,application/json" data-lr-field="source-file"${!available||blocked?' disabled':''}></label><p class="small muted">Private JSON file · up to 25 MiB. Evidence remains uncertain until a separate parent review supports it.</p>${!available?`<p class="small muted">${esc(cap.registrationReason||'An Owner workspace on Cloud 1 with the historical-source registration service is required.')}</p>`:''}${sourceFilename?`<p class="small">Selected file: ${esc(sourceFilename)}</p>`:''}${sourcePreview?`<h4>${sourcePreview.state==='unchanged'?'Evidence already registered':'Review source-only additions'}</h4><dl>${SOURCE_TABLES.map(table=>`<dt>${labels[table]}</dt><dd>${count(sourcePreview.counts[table])}</dd>`).join('')}<dt>New source chunks</dt><dd>${count(sourcePreview.totalChunks)}</dd></dl><p>No mouse, litter, mating, housing or biological parent record will change.</p>${sourcePreview.state==='prepared'?`<label><input type="checkbox" data-lr-field="source-reviewed"${sourceReviewed?' checked':''}${blocked?' disabled':''}> I reviewed these source-only additions. Registering them does not confirm parentage.</label><div class="actions"><button type="button" class="button secondary" data-lr-action="source-register"${!sourceReviewed||!available||blocked?' disabled':''}>Register historical evidence</button><button type="button" class="button secondary" data-lr-action="source-clear"${blocked?' disabled':''}>Discard source preview</button></div>`:'<p class="small">No source records need to be added. Analyze the registered evidence to review parentage.</p>'}`:''}${pending?`<div class="alert info"><p>The original source registration is not confirmed. Check it before loading another file or analyzing parents. A confirmed staged chunk is not a published source archive.</p>${sourceOutcome?.registrationId?`<details><summary>Original registration reference</summary><code>${esc(sourceOutcome.registrationId)}</code></details>`:''}<div class="actions"><button type="button" class="button secondary" data-lr-action="source-verify">Check source registration</button><button type="button" class="button secondary" data-lr-action="source-retry"${!available||sourceOutcome?.canRetry===false?' disabled':''}>Check and continue original registration</button></div></div>`:''}${sourceWriteBusy()?'<p class="small muted">Keep this panel open while source chunks are staged and the reviewed archive is published. Do not start another registration.</p>':''}</div></section>`;
 }
 function sourceProgressText(){
  const label=sourcePhase==='reading'?'Reading the selected private evidence file':sourcePhase==='preparing'?'Verifying source-only additions':sourcePhase==='verifying'?'Checking the original source registration':sourcePhase==='retrying'?'Continuing the original source registration':sourcePhase==='refreshing'?'Reloading confirmed historical evidence':progress?.phase==='staging'?'Staging source-only archive chunks':progress?.phase==='publishing'?'Publishing the reviewed source archive':'Verifying historical source evidence';
  return label+(Number.isSafeInteger(progress?.completed)&&Number.isSafeInteger(progress?.total)?` · ${count(progress.completed)} of ${count(progress.total)}`:'');
 }
 function progressText(){
  const labels={access:'Verifying access',identities:'Loading complete mouse identities',sources:'Loading saved source evidence',indexing:'Indexing recorded identities and relationships',evaluating:'Checking recorded parent evidence',graph:'Checking the complete parent graph',complete:'Finishing the source analysis',matching:'Matching individual animals',analyzing:'Checking parent evidence',validating:'Checking selected parent links',preparing:'Preparing the selected review',saving:'Saving the reviewed parent links'};
  const label=labels[progress?.phase]||({analyzing:'Analyzing available parent evidence',preparing:'Rechecking selected evidence',applying:'Applying the reviewed selection',verifying:'Checking the original outcome',retrying:'Checking and retrying the original command',refreshing:'Refreshing confirmed records'})[phase];
  return label+(Number.isSafeInteger(progress?.completed)&&Number.isSafeInteger(progress?.total)?` · ${count(progress.completed)} of ${count(progress.total)}`:'');
 }
 function paint({focusSearch=false,selectionStart=null}={}){
  if(!alive)return;
  const cap=capability(),readBusy=['analyzing','preparing'].includes(phase)||['reading','preparing'].includes(sourcePhase),writeBusy=['applying','retrying','refreshing'].includes(phase)||sourceWriteBusy();
  host.innerHTML=`<section class="lineage-recovery-panel" aria-labelledby="${id}-title"><div class="panel-head"><h2 id="${id}-title">Recover parents</h2><button type="button" class="button secondary" data-lr-action="close"${writeBusy?' disabled':''}>Close</button></div><div class="panel-body"><p>Find missing sire and dam links from recorded source evidence, then review supported proposals together. Existing parent links are preserved.</p><label>Analyze <select data-lr-field="scope"${busy()||uncertain()?' disabled':''}><option value="stock"${scope==='stock'?' selected':''}>Current Stock mice</option><option value="all"${scope==='all'?' selected':''}>All unarchived mice, including historical records</option></select></label><p class="small muted">Current Stock excludes Unknown and Ended mice. A source-recorded link and an inferred link retain their own evidence status; neither confirms biological parentage.</p>${!cap.canAnalyze||!cap.canApply?`<p class="small muted">${esc(cap.reason||'An Owner workspace on Cloud 1 is required to apply parent links.')}</p>`:''}<div class="actions"><button type="button" class="button secondary" data-lr-action="analyze"${!cap.canAnalyze||busy()||uncertain()?' disabled':''}>${report?'Analyze again':'Analyze parents'}</button>${readBusy?'<button type="button" class="button secondary" data-lr-action="cancel">Cancel analysis</button>':''}</div>${busy()?`<p role="status" aria-live="polite">${esc(sourceBusy()?sourceProgressText():progressText())}…</p><progress aria-label="${sourceBusy()?'Historical source registration in progress':'Parentage analysis in progress'}"></progress>`:''}${error?`<p class="alert error" role="alert">${esc(error)}</p>`:''}${notice?`<p role="status" aria-live="polite">${esc(notice)}</p>`:''}${historicalSourceHTML()}${resultsHTML()}${previewHTML()}${report?`<div class="actions"><button type="button" class="button secondary" data-lr-action="preview"${!selected.size||!complete()||!cap.canApply||busy()||uncertain()?' disabled':''}>Review selected proposals</button><button type="button" class="button primary" data-lr-action="apply"${!preview||!reviewed||!cap.canApply||busy()||uncertain()?' disabled':''}>Apply ${count(selected.size)} reviewed parent roles</button></div>`:''}${parentUncertain()?`<div class="alert info"><p>The original save is not confirmed. Check its outcome before another analysis or apply. Retrying uses the same reviewed command and operation.</p>${outcome?.operationId?`<details><summary>Operation reference</summary><code>${esc(outcome.operationId)}</code></details>`:''}<div class="actions"><button type="button" class="button secondary" data-lr-action="verify">Check outcome</button><button type="button" class="button secondary" data-lr-action="retry"${!cap.canApply||outcome?.canRetry===false?' disabled':''}>Check and retry original command</button></div></div>`:''}</div></section>`;
  if(focusSearch){const input=host.querySelector?.('[data-lr-field="search"]');input?.focus?.();if(selectionStart!==null)input?.setSelectionRange?.(selectionStart,selectionStart);}
 }
 function cancel(){
  if(['reading','preparing'].includes(sourcePhase)){revision++;abort?.abort();abort=null;try{hooks.clearHistoricalSourceRegistration?.();}catch{}progress=null;sourcePhase='idle';sourcePreview=null;sourceReviewed=false;sourceFilename='';notice='Source preview canceled. No source archive or parent records were changed.';error='';paint();return;}
  if(!['analyzing','preparing'].includes(phase))return;revision++;abort?.abort();abort=null;progress=null;phase=report?'analyzed':'idle';resetPreview();notice='Analysis canceled. This analysis did not change parent records.';error='';paint();
 }
 async function loadSource(file){
  if(busy()||uncertain()||!file)return;check();
  const cap=capability();if(cap.canRegisterHistoricalSources!==true||typeof hooks.previewHistoricalSourceRegistration!=='function')throw new Error(cap.registrationReason||'Historical-source registration is unavailable.');
  if(!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_SOURCE_FILE_BYTES||typeof file.text!=='function')throw new Error('Choose a private JSON evidence file no larger than 25 MiB.');
  const token=++revision;abort?.abort();abort=new AbortController();const signal=abort.signal;
  report=null;rows=[];preview=null;selected.clear();reviewed=false;phase='idle';sourcePreview=null;sourceOutcome=null;sourceReviewed=false;sourceFilename=String(file.name||'Selected JSON file').slice(0,300);sourcePhase='reading';progress=null;notice=error='';paint();
  try{
   const raw=await file.text();if(token!==revision||signal.aborted)return;check();
   if(new TextEncoder().encode(raw).byteLength>MAX_SOURCE_FILE_BYTES)throw new Error('The evidence file exceeds 25 MiB.');
   let capsule;try{capsule=JSON.parse(raw);}catch{throw new Error('The selected file is not valid JSON.');}
   if(!object(capsule)||capsule.schema_version!==1||!object(capsule.tables))throw new Error('Choose a version 1 historical-source evidence file.');
   sourcePhase='preparing';paint();
   const result=await hooks.previewHistoricalSourceRegistration({capsule,signal,onProgress:value=>{if(token===revision&&current()&&!signal.aborted){progress=value;paint();}}});
   if(token!==revision||signal.aborted)return;check();
   if(!object(result)||result.scientificRecordsChanged!==false||result.automaticParentageAuthority!==false||!['prepared','unchanged'].includes(result.state)||typeof result.registrationId!=='string'||!result.registrationId||!object(result.counts)||Object.keys(result.counts).length!==SOURCE_TABLES.length||Object.keys(result.counts).some(table=>!SOURCE_TABLES.includes(table))||SOURCE_TABLES.some(table=>!Number.isSafeInteger(result.counts[table])||result.counts[table]<0)||result.state==='prepared'&&(typeof result.previewId!=='string'||!result.previewId)||!Number.isSafeInteger(result.totalChunks??0)||(result.totalChunks??0)<0)throw new Error('The complete source-only preview was not returned. Select and review the evidence again.');
   sourcePreview={...result,totalChunks:result.totalChunks??0};sourcePhase='prepared';notice=result.state==='unchanged'?'This evidence is already registered. No source records were changed.':'Source-only additions are ready for review. No source archive or parent records have changed.';
  }catch(e){if(token!==revision||signal.aborted)return;if(!current()){invalidate();return;}sourcePreview=null;const pending=hooks.getPendingHistoricalSourceRegistration?.();sourcePhase=pending?'uncertain':'idle';sourceOutcome=pending||null;error=e.message||'The evidence file could not be reviewed.';}
  finally{if(token===revision&&alive){abort=null;progress=null;paint();}}
 }
 async function confirmedSource(result){
  sourcePhase='refreshing';sourceOutcome=result;sourcePreview=null;sourceReviewed=false;report=null;rows=[];preview=null;selected.clear();reviewed=false;phase='idle';notice='Historical evidence was registered. Reloading the confirmed source archive…';error='';paint();
  try{if(typeof hooks.onHistoricalSourcesRegistered!=='function')throw new Error('Reload the verified source archive before analyzing parents.');await hooks.onHistoricalSourcesRegistered(result);if(!current())return;sourcePhase='applied';notice='Historical evidence was registered and reloaded. Analyze parents again to review it. No parent links were changed by registration.';}
  catch(e){if(!current())return;sourcePhase='applied';notice='Historical evidence was registered. Reload shared records before analyzing it. No parent links were changed by registration.';error=e.message||'';}
  finally{if(current())paint();}
 }
 async function writeSource(action){
  if(busy())return;check();const cap=capability();
  if(action==='register'&&(sourcePhase!=='prepared'||sourcePreview?.state!=='prepared'||!sourceReviewed||cap.canRegisterHistoricalSources!==true))return;
  if(action!=='register'&&sourcePhase!=='uncertain')return;
  if(action==='retry'&&(cap.canRegisterHistoricalSources!==true||sourceOutcome?.canRetry===false))return;
  const fn=action==='register'?hooks.applyHistoricalSourceRegistration:action==='verify'?hooks.verifyHistoricalSourceRegistration:hooks.retryHistoricalSourceRegistration;
  if(typeof fn!=='function')throw new Error('Use Clouds to check the original source registration before continuing.');
  sourcePhase=action==='register'?'applying':action==='verify'?'verifying':'retrying';notice=error='';paint();
  try{
   const input={...(action==='register'?{previewId:sourcePreview.previewId}:{}),onProgress:value=>{if(current()){progress=value;paint();}}};
   const result=await fn(input);if(!current()){invalidate();return;}
   if(result?.state==='applied'&&result.scientificRecordsChanged===false){await confirmedSource(result);return;}
   if(result?.state==='none'){sourcePhase='idle';sourceOutcome=null;sourcePreview=null;sourceReviewed=false;notice='No original source registration is pending. Review the evidence file again before registering.';}
   else if(result?.state==='staged'&&result.reopenFile===true){sourcePhase='idle';sourceOutcome=null;sourcePreview=null;sourceReviewed=false;notice='The original source chunk is confirmed, but the archive is not published. Reopen the same evidence file to review and finish the remaining registration.';}
   else {sourcePhase='uncertain';sourceOutcome=result||hooks.getPendingHistoricalSourceRegistration?.()||sourceOutcome||{state:'uncertain'};notice=result?.state==='staged'?'The original staged source chunk is confirmed. The archive is not yet published; continue the original registration to finish.':'The original source registration remains unconfirmed. No new registration will be started.';}
  }catch(e){if(!current()){invalidate();return;}if(e.historicalSourceBlocked===true&&!e.historicalSourceUncertain){sourcePhase='blocked';sourcePreview=null;sourceReviewed=false;error=e.message||'The source archive changed. Review the file against fresh records again.';}else{sourcePhase='uncertain';sourceOutcome=hooks.getPendingHistoricalSourceRegistration?.()||sourceOutcome||{state:'uncertain'};error=e.message||'The original source registration could not be confirmed.';}}
  finally{if(current()){progress=null;paint();}}
 }
 async function analyze(){
  if(busy()||uncertain())return;check();if(!capability().canAnalyze)throw new Error(capability().reason||'Parentage analysis is not available.');
  const token=++revision;abort?.abort();abort=new AbortController();const signal=abort.signal;
  report=null;rows=[];selected.clear();preview=null;reviewed=false;page=bucketPage=0;error=notice='';phase='analyzing';progress=null;paint();
  try{const result=await hooks.analyze({scope,signal,onProgress:value=>{if(token===revision&&current()&&!signal.aborted){progress=value;paint();}}});if(token!==revision||signal.aborted)return;check();rows=roleRows(result);report=result;phase='analyzed';notice='Analysis complete. Select supported missing roles to review; no records have changed.';}
  catch(e){if(token!==revision||signal.aborted)return;if(!current()){invalidate();return;}phase='idle';error=e.message||'Analysis could not finish.';}
  finally{if(token===revision&&alive){abort=null;progress=null;paint();}}
 }
 async function prepare(){
  if(busy()||uncertain()||!selected.size||!complete())return;check();if(!capability().canApply)throw new Error(capability().reason||'Applying is unavailable.');
  const keys=[...selected].sort(),token=++revision;abort=new AbortController();const signal=abort.signal;phase='preparing';preview=null;reviewed=false;notice=error='';paint();
   try{const result=await hooks.preview({report,selectedRoleKeys:keys,signal,onProgress:value=>{if(token===revision&&current()&&!signal.aborted){progress=value;paint();}}});if(token!==revision||signal.aborted)return;check();if(!object(result)||typeof result.previewId!=='string'||!result.previewId||!Array.isArray(result.roleKeys)||JSON.stringify([...result.roleKeys].sort())!==JSON.stringify(keys)||!sameCoverage(result.coverageBefore,report.coverageBefore)||!sameCoverage(result.coverageAfter,projected()))throw new Error('The verified selection changed. Analyze and review it again.');preview=result;phase='prepared';notice='The selected evidence was rechecked. Review this selection before applying.';}
  catch(e){if(token!==revision||signal.aborted)return;if(!current()){invalidate();return;}phase='analyzed';error=e.message||'The selection could not be prepared.';}
  finally{if(token===revision&&alive){abort=null;progress=null;paint();}}
 }
 async function confirmed(result){
  phase='refreshing';notice='The reviewed parent links were saved. Refreshing current records…';error='';outcome=result;preview=null;selected.clear();report=null;rows=[];reviewed=false;paint();
  try{await hooks.onApplied?.(result);if(!current())return;phase='applied';notice='The reviewed parent links were saved and current records were refreshed.';}
  catch(e){if(!current())return;phase='applied';notice='The parent links were saved. Current records could not refresh. Reload current records before another analysis.';error=e.message||'';}
  finally{if(current())paint();}
 }
 async function write(action){
  if(busy())return;check();if(action==='apply'&&(phase!=='prepared'||!preview||!reviewed||!selected.size||!complete()||!capability().canApply))return;
  if(action!=='apply'&&!parentUncertain())return;
  if(action==='retry'&&(!capability().canApply||outcome?.canRetry===false))return;
  phase=action==='apply'?'applying':action==='verify'?'verifying':'retrying';notice=error='';paint();
  try{const result=await hooks[action](action==='apply'?{previewId:preview.previewId,onProgress:value=>{if(current()){progress=value;paint();}}}:{});if(!current()){invalidate();return;}if(result?.state==='applied'){await confirmed(result);return;}if(['rejected','conflict','blocked'].includes(result?.state)){phase='blocked';preview=null;reviewed=false;error='The reviewed selection was rejected or changed. Reload and analyze current records again.';}else{phase='uncertain';outcome=result||{state:'uncertain'};notice='The original save remains unconfirmed. No new command will be started.';}}
  catch(e){if(!current()){invalidate();return;}if(e.lineageRecoveryBlocked===true||e.lineageRecoveryUncertain===false){phase=report?'analyzed':'blocked';preview=null;reviewed=false;error=e.message||'The selection changed. Analyze again.';}else{phase='uncertain';outcome=hooks.getPendingOutcome?.()||outcome||{state:'uncertain'};error=e.message||'The save outcome could not be confirmed.';}}
  finally{if(current()){progress=null;paint();}}
 }
 host.onclick=async event=>{
  const el=event.target.closest?.('[data-lr-action],[data-lr-open]');if(!el||el.disabled)return;event.preventDefault?.();
  try{check();if(el.dataset.lrOpen!==undefined){if(!busy())hooks.openMouse?.(el.dataset.lrOpen);return;}
   const action=el.dataset.lrAction;
   if(action==='close'){if(['applying','retrying','refreshing'].includes(phase)||sourceWriteBusy())return;cancel();hooks.close?.();return;}
   if(action==='cancel'){cancel();return;}if(action==='analyze'){await analyze();return;}
   if(action==='source-register'){await writeSource('register');return;}if(action==='source-verify'){await writeSource('verify');return;}if(action==='source-retry'){await writeSource('retry');return;}
   if(action==='source-clear'){if(busy()||uncertain())return;hooks.clearHistoricalSourceRegistration?.();sourcePhase='idle';sourcePreview=null;sourceReviewed=false;sourceFilename='';notice='Source preview discarded. No source archive or parent records were changed.';error='';paint();return;}
   if(action==='preview'){await prepare();return;}if(['apply','verify','retry'].includes(action)){await write(action);return;}
   if(busy()||uncertain()||!report)return;
   if(action==='select-supported'){selected=new Set(rows.filter(eligible).slice(0,MAX_SELECTED_ROLES).map(row=>row.key));resetPreview();}
   if(action==='clear-selection'){selected.clear();resetPreview();}
   if(action==='previous')page=Math.max(0,page-1);if(action==='next')page++;
   if(action==='buckets-previous')bucketPage=Math.max(0,bucketPage-1);if(action==='buckets-next')bucketPage++;
   paint();
  }catch(e){if(current()){error=e.message||'The action is unavailable.';paint();}}
 };
 host.onchange=event=>{
  const el=event.target;try{check();if(busy()||uncertain())return;
   if(el.dataset.lrField==='source-file'){return loadSource(el.files?.[0]).catch(e=>{if(current()){error=e.message||'The evidence file could not be opened.';paint();}});}
   if(el.dataset.lrField==='source-reviewed'){sourceReviewed=sourcePhase==='prepared'&&sourcePreview?.state==='prepared'&&el.checked===true;paint();return;}
   if(el.dataset.lrSelect!==undefined){const row=rows.find(r=>r.key===el.dataset.lrSelect);if(!row||!selectable(row))return;if(el.checked)selected.add(row.key);else selected.delete(row.key);resetPreview();paint();return;}
   const field=el.dataset.lrField;if(field==='reviewed'){reviewed=el.checked===true;paint();return;}
   if(field==='scope'&&['stock','all'].includes(el.value)){scope=el.value;report=null;rows=[];selected.clear();resetPreview();phase='idle';void analyze();return;}
   if(field==='filter'){filter=el.value;page=0;paint();}
  }catch(e){if(current()){error=e.message;paint();}}
 };
 host.oninput=event=>{const el=event.target;if(el.dataset.lrField!=='search'||busy()||uncertain())return;try{check();search=el.value;page=0;paint({focusSearch:true,selectionStart:el.selectionStart??null});}catch{}};
 const dispose=()=>{if(!alive)return;alive=false;revision++;abort?.abort();abort=null;host.onclick=host.onchange=host.oninput=null;host.innerHTML='';report=null;rows=[];preview=null;sourcePreview=null;sourceOutcome=null;sourceFilename='';selected.clear();};
 const pending=hooks.getPendingOutcome?.();if(pending&&['uncertain','unknown','queued'].includes(pending.state)){outcome=pending;phase='uncertain';notice='A previous parent recovery command is not yet confirmed. Check its original outcome.';}
 const sourcePending=hooks.getPendingHistoricalSourceRegistration?.();if(sourcePending&&['uncertain','unknown','queued','staged'].includes(sourcePending.state)){sourceOutcome=sourcePending;sourcePhase='uncertain';notice='A previous source registration is not yet confirmed. Check its original outcome before loading or analyzing evidence.';}
 paint();
 if(phase==='idle'&&!uncertain())queueMicrotask(()=>{if(current()&&capability().canAnalyze&&!busy()&&!uncertain())void analyze();});
 return {dispose,isBusy:busy,canClose:()=>!['applying','retrying','refreshing'].includes(phase)&&!sourceWriteBusy(),cancelAnalysis:cancel,hasDraft:()=>Boolean(selected.size||preview||sourcePreview||uncertain()),getState:()=>({phase,scope,sourcePhase,selectedRoleKeys:[...selected],previewId:preview?.previewId??null,operationId:outcome?.operationId??null,sourcePreviewId:sourcePreview?.previewId??null,sourceRegistrationId:sourceOutcome?.registrationId||sourcePreview?.registrationId||null})};
}
