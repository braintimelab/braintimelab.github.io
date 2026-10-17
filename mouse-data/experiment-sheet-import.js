const mounts=new WeakMap();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>{if(!value)return 'Not yet';const d=new Date(value);return Number.isFinite(d.valueOf())?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(d):'Unknown';};
const sheetUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='docs.google.com'&&!u.port&&!u.username&&!u.password&&/^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(u.pathname)?u.href:null;}catch{return null;}};
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const summaries=[[['observations_added','source_additions'],'Sources added'],[['drafts_created'],'Drafts'],[['manual_records_preserved'],'Existing records kept'],[['observations_read'],'Read'],[['inserted_count'],'Added'],[['updated_count'],'Updated'],[['unchanged_count'],'Unchanged'],[['source_count'],'Sources'],[['source_issue_count'],'To review']];
const errors={worker_timeout:'The import timed out.',queue_unavailable:'The import could not be queued.',source_access_denied:'Experiment Sheet access was denied.',google_auth_failed:'The sheet connection needs attention.',source_read_failed:'The Experiment Sheet could not be read.',source_schema_changed:'The Experiment Sheet layout needs review.',source_too_large:'This import exceeds the current limit.',too_many_source_changes:'Too many sheet changes for one import. Ask the owner to review.',source_plan_too_large:'The sheet changes exceed one import. Ask the owner to review.',source_row_too_large:'A sheet entry is too large to import. Ask the owner to review.',database_response_invalid:'The database could not confirm the import. Refresh before retrying.',not_configured:'Experiment Sheet import is not configured.',source_merge_failed:'The sheet changes need review.',commit_conflict:'Shared data changed. Retry the import.',commit_failed:'The import could not be saved.',import_failed:'The import did not finish.'};
const conflictLabels={source_cell_changed:'Source cell changed; review the earlier record.',managed_source_preserved:'Existing experiment kept'};
const conflictReason=row=>conflictLabels[row.reason]||conflictLabels[row.code]||(typeof row.reason==='string'?row.reason.replace(/_/g,' '):'Changed in the app');
const conflictUrl=(source,row,withheld)=>{if(withheld||row.source_details_withheld)return null;const direct=sheetUrl(row.source_url);if(direct)return direct;const base=sheetUrl(source);if(!base||!Number.isSafeInteger(row.sheet_id)||row.sheet_id<0||typeof row.range!=='string'||!(/^[A-Z]{1,3}[1-9][0-9]{0,6}(?::[A-Z]{1,3}[1-9][0-9]{0,6})?$/).test(row.range))return null;const url=new URL(base);url.hash=new URLSearchParams({gid:String(row.sheet_id),range:row.range}).toString();return url.href;};
const pendingStatus=value=>['queued','running'].includes(value);
const successStatus=value=>['completed','succeeded','success','unchanged','conflicts'].includes(value);

export async function renderExperimentSheetImport(container,hooks={}){
 mounts.get(container)?.dispose();
 const state={status:null,loading:true,busy:false,error:'',conflicts:null,timer:null,expiryTimer:null,refreshing:null,watched:null,completed:null,pollUntil:0,closed:false};
 const active=()=>!state.closed&&mounts.get(container)===state&&container.isConnected!==false&&hooks.isCurrent?.()!==false;
 const allowed=()=>active()&&hooks.canImport?.()===true;
 const job=()=>state.status?.job;
 const isPending=()=>pendingStatus(job()?.status||state.status?.status);
 const startedAt=()=>{const value=job()?.started_at??job()?.queued_at;return typeof value==='string'?Date.parse(value):NaN;};
 const expired=()=>isPending()&&Number.isFinite(startedAt())&&Date.now()-startedAt()>=15*60*1000;
 const pending=()=>isPending()&&!expired();
 const button=(action,label,disabled=false)=>`<button type="button" class="button secondary" data-experiment-import="${action}"${disabled?' disabled':''}>${esc(label)}</button>`;
 const stop=()=>{if(state.timer)clearTimeout(state.timer);state.timer=null;};
 const dispose=()=>{state.closed=true;stop();if(state.expiryTimer)clearTimeout(state.expiryTimer);state.expiryTimer=null;if(mounts.get(container)===state){mounts.delete(container);container.onclick=null;}};
 mounts.set(container,state);state.dispose=dispose;
 function paint(){
  if(!active())return;
  if(state.expiryTimer)clearTimeout(state.expiryTimer);state.expiryTimer=null;
  if(pending()&&Number.isFinite(startedAt()))state.expiryTimer=setTimeout(paint,Math.min(2147483647,Math.max(1,startedAt()+15*60*1000-Date.now()+1)));
  const s=state.status,j=job(),url=sheetUrl(s?.source_url),summary=j?.summary;
  const counts=summaries.map(([keys,label])=>[keys.find(key=>count(summary?.[key])!==null),label]).filter(([key])=>key).map(([key,label])=>`${esc(label)} ${count(summary[key]).toLocaleString()}`);
  const conflicts=state.conflicts,rows=conflicts?.conflicts||[];
  container.innerHTML=`<section class="panel"><div class="panel-body">${state.error?`<p class="alert error" role="alert">${esc(state.error)}</p>`:''}${state.loading?'<p role="status">Checking import status…</p>':s?`<div class="settings-actions"><span class="badge">${esc(pending()?j?.status||s.status:expired()?'Needs retry':!s.configured?'Not configured':s.enabled?'Manual import ready':'Import not active')}</span><span class="small muted">Last update: ${esc(date(s.last_success_at))}</span>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open Experiment Sheet</a>`:''}</div>${expired()?'<p class="small muted" role="status">Import has not finished after 15 minutes.</p>':''}${j?.error?`<p class="alert error">${esc(errors[j.error]||errors.import_failed)}</p>`:''}${counts.length?`<p class="small muted">${counts.join(' · ')}${summary?.unchanged===true?' · No changes':''}</p>`:''}${count(s.conflict_count)>0?`<p class="badge amber">${s.conflict_count.toLocaleString()} to review</p>`:''}<div class="settings-actions">${button('start',pending()?'Import in progress…':expired()?'Retry import':'Import/update',state.busy||Boolean(state.refreshing)||pending()||!allowed()||!s.configured||!s.enabled)}${button('refresh','Refresh',state.busy||Boolean(state.refreshing))}${count(s.conflict_count)>0?button('conflicts','Review conflicts',state.busy||Boolean(state.refreshing)):''}</div>${pending()&&state.watched&&Date.now()>=state.pollUntil?'<p class="small muted" role="status">Still pending. Use Refresh to check again.</p>':''}${!allowed()?'<p class="small muted">Experiment and import access are required.</p>':''}`:''}${conflicts?`<div class="sheet-import-conflicts"><h3>Review (${count(conflicts.total)??rows.length})</h3>${conflicts.source_details_withheld?'<p class="small muted">Source details are restricted.</p>':''}${rows.map(row=>{const link=conflictUrl(s?.source_url,row,conflicts.source_details_withheld),fields=Array.isArray(row.changed_fields)?row.changed_fields.filter(value=>typeof value==='string').slice(0,12):[];return `<div class="line-item"><div><strong>${esc(row.title||row.entity_id||row.record_id||row.source_id||'Experiment record')}</strong><div class="small muted">${esc(conflictReason(row))}${fields.length?` · ${esc(fields.join(', '))}`:''}${row.source_details_withheld?' · Source details restricted':''}</div></div>${link?`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Sheet</a>`:''}</div>`;}).join('')||'<p class="small muted">No pending conflicts.</p>'}${conflicts.next_offset!=null?'<p class="small muted">Showing the first 100 entries.</p>':''}</div>`:''}</div></section>`;
 }
 async function refreshOnce({manual=false}={}){
  if(!active())return;
  stop();
  try{
   const value=await hooks.getStatus();if(!active())return;
   if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Import status is unavailable.');
   state.status=value;state.error='';const j=job();
   if(pending()&&typeof j?.job_id==='string'&&j.job_id){if(state.watched!==j.job_id){state.watched=j.job_id;state.completed=null;state.pollUntil=Date.now()+120000;}else if(manual)state.pollUntil=Date.now()+120000;}
   if(state.watched&&j?.job_id===state.watched&&!pending()&&state.completed!==state.watched&&successStatus(j.status)){
    if(!allowed())throw new Error('Access changed. Reopen the import controls.');
    await hooks.onComplete?.(value);if(!active())return;state.completed=state.watched;
   }
  }catch(error){if(active())state.error=error.message||'Import status is unavailable.';}
  finally{if(active()){state.loading=false;}}
 }
 async function refresh(options={}){
  if(!active())return;if(state.refreshing)return state.refreshing;
  const request=refreshOnce(options);state.refreshing=request;paint();
  try{await request;}finally{if(state.refreshing===request)state.refreshing=null;if(active()){paint();if(!state.error&&pending()&&state.watched&&Date.now()<state.pollUntil)state.timer=setTimeout(()=>{void refresh();},4000);}}
 }
 container.onclick=async event=>{
  const target=event.target.closest?.('[data-experiment-import]');if(!target||!active())return;event.preventDefault?.();
  const action=target.dataset.experimentImport;if(state.busy)return;
  if(action==='refresh'){await refresh({manual:true});return;}
  if(state.refreshing||!allowed())return;
  if(action==='start'&&(pending()||!state.status?.configured||!state.status?.enabled))return;
  state.busy=true;state.error='';paint();
  try{
   if(action==='start'){
    const result=await hooks.start();if(!active())return;
    if(!result||typeof result.job_id!=='string'||!result.job_id)throw new Error('The import request could not be confirmed. Use Refresh before retrying.');
    state.watched=result.job_id;state.completed=null;state.pollUntil=Date.now()+120000;state.status={...state.status,job:result};state.conflicts=null;
    await refresh();
   }else if(action==='conflicts'){
    const result=await hooks.getConflicts({offset:0,limit:100});if(!active())return;
    if(!result||!Array.isArray(result.conflicts))throw new Error('Conflicts could not load.');
    state.conflicts={...result,conflicts:result.conflicts.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).slice(0,100)};
   }
  }catch(error){if(active())state.error=error.message||'The import request failed.';}
  finally{if(active()){state.busy=false;paint();}}
 };
 paint();await refresh();return dispose;
}
