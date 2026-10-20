const mounts=new WeakMap();
export function refreshAnimalSheetImportAccess(container){mounts.get(container)?.paint?.();}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>{if(!v)return 'Not yet';const d=new Date(v);return Number.isNaN(d.valueOf())?'Unknown':new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(d)};
export function animalSheetImportHelpHTML(){return '<p>Daily imports run at 02:00 Taipei time. Update from Animal Sheet requests the same import immediately. Only changed source content creates a new snapshot. Source records retain their history; app edits are checked before each update, and conflicts require review. Sheet animal tags do not establish a mouse identity on their own.</p><p>The original Animal Sheet is read only. The separate output workbook continues to reflect the database. A failed or incomplete download does not remove existing records.</p>'}
export async function renderAnimalSheetImport(container,hooks={}){
 const old=mounts.get(container);if(old?.timer)clearTimeout(old.timer);if(old?.expiryTimer)clearTimeout(old.expiryTimer);
 const state={loading:true,busy:false,applying:false,status:null,error:'',conflicts:null,timer:null,expiryTimer:null,pollUntil:0,watched:null,completed:null};mounts.set(container,state);
 const active=()=>mounts.get(container)===state&&container.isConnected!==false;
 const allowed=()=>hooks.canImport?.()===true;
 const isPending=()=>['queued','running'].includes(state.status?.job?.status||state.status?.status);
 const startedAt=()=>{const value=state.status?.job?.started_at||state.status?.job?.queued_at;return typeof value==='string'?Date.parse(value):NaN;};
 const expired=()=>isPending()&&Number.isFinite(startedAt())&&Date.now()-startedAt()>=15*60*1000;
 const pending=()=>isPending()&&!expired();
 const queued=()=>isPending()&&(state.status?.job?.status||state.status?.status)==='queued';
 const monitoring=()=>pending()&&state.watched&&Date.now()<state.pollUntil&&!state.error;
 const stage=()=>state.applying?'Loading updated cages…':queued()?'Waiting for the import worker…':'Update in progress…';
 const progress=label=>`<div class="workspace-progress" aria-busy="true"><progress aria-label="${esc(label)}"></progress></div>`;
 const action=(name,label,disabled=false)=>`<button type="button" class="button secondary" data-sheet-import="${name}"${disabled?' disabled':''}>${label}</button>`;
 function paint(){if(!active())return;if(state.expiryTimer)clearTimeout(state.expiryTimer);state.expiryTimer=null;if(pending()&&Number.isFinite(startedAt()))state.expiryTimer=setTimeout(paint,Math.min(2147483647,Math.max(1,startedAt()+15*60*1000-Date.now()+1)));const s=state.status,j=s?.job,source=s?.source_url&&/^https:\/\/docs\.google\.com\/spreadsheets\//.test(s.source_url)?`<a href="${esc(s.source_url)}" target="_blank" rel="noopener noreferrer">Open Animal Sheet</a>`:'';container.innerHTML=`<section class="panel"><div class="panel-head"><h2>Animal Sheet updates</h2>${action('help','Help')}</div><div class="panel-body">${state.error?`<p class="alert error" role="alert">${esc(state.error)}</p>`:''}${state.loading?'<p role="status">Checking import status…</p>'+progress('Checking import status'):s?`<div class="settings-actions"><span class="badge">${esc(j?.status==='failed'?'Failed':pending()?queued()?'Queued':'Importing':expired()?'Needs retry':s.schedule_active?'Daily · 02:00 Taipei':s.enabled?'Manual import ready':'Import not active')}</span><span class="small muted">Last update: ${esc(date(s.last_success_at))}</span>${source}</div>${isPending()?`<p class="small muted">${queued()?'Queued':'Started'}: ${esc(date(j?.started_at||j?.queued_at))}</p>`:''}${expired()?'<p class="alert warning" role="status">This update has not finished after 15 minutes. You can retry; existing records are preserved.</p>':''}${j?.error?`<p class="alert error">${esc(j.error)}</p>`:''}${j?.summary?.source_issue_count?`<p class="small muted">${esc(j.summary.source_issue_count)} source warnings retained. Repeated labels and uncertain date order need review.</p>`:''}${s.conflict_count?`<p class="badge amber">${esc(s.conflict_count)} conflicts need review</p>`:''}<div class="settings-actions">${action('start',state.applying?'Loading updated cages…':expired()?'Retry update':queued()?'Waiting to start…':pending()?'Update in progress…':'Update from Animal Sheet',state.busy||Boolean(state.refreshing)||pending()||!allowed()||!s.configured||!s.enabled)}${action('refresh',state.refreshing?'Checking…':'Refresh status',state.busy||Boolean(state.refreshing))}${s.conflict_count?action('conflicts','Review conflicts',state.busy):''}</div>${state.applying||monitoring()?`<p class="small muted" role="status">${esc(stage())}</p>${progress(stage())}`:pending()?'<p class="small muted" role="status">Automatic checks paused. Refresh status to check again; you can close this window safely.</p>':''}${!allowed()?'<p class="small muted">Import access is managed by the owner.</p>':''}`:'<p class="small muted">Sign in to the shared colony to view imports.</p>'}${state.conflicts?`<div class="sheet-import-conflicts"><h3>Conflicts (${esc(state.conflicts.total??state.conflicts.conflicts?.length??0)})</h3>${state.conflicts.source_details_withheld||(state.conflicts.conflicts||[]).some(c=>c.source_details_withheld)?'<p class="small muted">Source details are restricted. Ask the owner to review this conflict.</p>':''}${(state.conflicts.conflicts||[]).map(c=>`<details class="compact-details"><summary>${esc(c.entity_type||c.kind||'Record')} · ${esc(c.entity_id||c.record_id||'')} · ${esc(c.reason||'Changed in the app')}</summary><pre class="exp-prewrap">${esc(JSON.stringify(c,null,2))}</pre></details>`).join('')}${state.conflicts.next_offset!=null?'<p class="small muted">Showing the first 100 conflicts.</p>':''}</div>`:''}</div></section>`}
 async function refreshOnce({manual=false}={}){
  if(!active())return;
  if(state.timer)clearTimeout(state.timer);state.timer=null;
  try{
   const status=await hooks.getStatus();if(!active())return;
   if(!status||typeof status!=='object'||Array.isArray(status))throw new Error('Import status is unavailable.');
   state.status=status;state.error='';const j=status.job;
   if(pending()&&j?.job_id){
    if(state.watched!==j.job_id){state.watched=j.job_id;state.completed=null;state.pollUntil=Date.now()+120000;}
    else if(manual)state.pollUntil=Date.now()+120000;
   }
   if(state.watched&&j?.job_id===state.watched&&!pending()&&state.completed!==state.watched&&['completed','succeeded','success','unchanged','conflicts'].includes(j.status)){
    state.applying=true;paint();
    try{await hooks.onComplete?.(status);if(!active())return;state.completed=state.watched;}
    finally{state.applying=false;}
   }
  }catch(e){if(active())state.error=e.message||'Import status is unavailable.';}
  finally{if(active())state.loading=false;}
 }
 async function refresh(options={}){
  if(!active())return;if(state.refreshing)return state.refreshing;
  const request=refreshOnce(options);state.refreshing=request;paint();
  try{return await request;}
  finally{
   if(state.refreshing===request)state.refreshing=null;
   if(active()){paint();if(monitoring())state.timer=setTimeout(()=>{void refresh();},4000);}
  }
 }
 container.onclick=async event=>{const target=event.target.closest?.('[data-sheet-import]');if(!target||!active())return;event.preventDefault?.();const action=target.dataset.sheetImport;if(action==='help'){hooks.help?.();return}if(state.busy||state.refreshing&&action!=='refresh')return;state.error='';if(action==='refresh'){await refresh({manual:true});return}if(action==='start'&&(!allowed()||pending()||!state.status?.configured||!state.status?.enabled))return;state.busy=true;paint();try{if(action==='start'){const job=await hooks.start();if(!active())return;state.watched=job.job_id;state.pollUntil=Date.now()+120000;state.status={...state.status,job};await refresh();}else if(action==='conflicts'){state.conflicts=await hooks.getConflicts({offset:0,limit:100});}}catch(e){if(active())state.error=e.message||'The import request failed.'}finally{if(active()){state.busy=false;paint()}}};
 state.paint=paint;paint();await refresh();return ()=>{if(state.timer)clearTimeout(state.timer);if(state.expiryTimer)clearTimeout(state.expiryTimer);if(mounts.get(container)===state)mounts.delete(container)};
}
