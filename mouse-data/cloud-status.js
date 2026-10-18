/* Reusable presentation only. The bridge supplies verified, memory-only state. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={cloud1:'Cloud 1',cloud2:'Cloud 2'};
const labels={online:'Online',unknown:'Not checked',unavailable:'Unavailable',signed_out:'Sign in required',denied:'Access unavailable',not_enrolled:'Enrollment required',not_ready:'Not ready',error:'Could not verify'};
const safeCount=value=>Number.isSafeInteger(value)&&value>=0?value:null;
function timestamp(value){try{return value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' Taipei':'';}catch{return '';}}

export function cloudStatusHTML(state){
  const active=names[state?.active]||null;
  const rows=Object.entries(names).map(([source,name])=>{
    const data=state?.sources?.[source]||{},ready=data.state==='online'&&data.ready===true&&data.canRead===true&&(source!=='cloud2'||data.enrolled===true);
    const pending=safeCount(data.pending),conflicts=safeCount(data.conflicts),sync=timestamp(data.lastSyncAt);
    return `<li data-cloud-source="${source}"><strong>${name}</strong> <span>${esc(labels[data.state]||'Not checked')}${data.state==='online'&&!ready?' · Not ready':''}</span>${state?.active===source?' <span>· In use</span>':''}${ready&&!data.canWrite?' <span>· Read only</span>':''}${pending!==null?` <span>· ${pending} pending</span>`:''}${conflicts!==null?` <span>· ${conflicts} to review</span>`:''}${sync?`<div class="small muted">Last sync ${esc(sync)}</div>`:''}</li>`;
  }).join('');
  const uncertain=(state?.operations||[]).filter(entry=>entry.outcome==='uncertain').length,queued=(state?.operations||[]).filter(entry=>entry.outcome==='queued').length;
  return `<section class="cloud-status" aria-label="Cloud connections"${state?.loading?' aria-busy="true"':''}><ul style="list-style:none;padding:0;margin:0">${rows}</ul><p class="small" role="status">${active?`${active} in use.`:state?.loading?'Checking connections…':'No verified data source.'}${queued?` ${queued} saved on Cloud 2, awaiting sync.`:''}${uncertain?` ${uncertain} write ${uncertain===1?'needs':'need'} verification.`:''}</p></section>`;
}

export function cloudControlsHTML(state){
 const choices=Object.entries(names).map(([source,label])=>{const value=state?.sources?.[source],ready=value?.state==='online'&&value.ready&&value.canRead&&(source!=='cloud2'||value.enrolled);return `<button type="button" class="button secondary" data-action="cloud-select" data-source="${source}" aria-pressed="${state?.active===source}"${!ready||state?.loading?' disabled':''}>Use ${label}</button>`;}).join('');
 const pending=(state?.operations||[]).filter(item=>['uncertain','queued','conflict','rejected'].includes(item.outcome)).map(item=>`<li>${esc(names[item.source])}: ${esc({uncertain:'Unconfirmed save',queued:'Sync pending',conflict:'Changed elsewhere',rejected:'Not accepted'}[item.outcome])} <button type="button" data-action="cloud-verify" data-operation="${esc(item.operationId)}">Check</button>${item.outcome==='uncertain'&&item.retryable!==false?` <button type="button" data-action="cloud-retry" data-operation="${esc(item.operationId)}">Retry same save</button>`:''}</li>`).join('');
 const conflicts=(state?.conflictRows||[]).map(row=>`<li><strong>${esc(row.status==='conflict'?'Changed elsewhere':'Not accepted')}</strong>${(row.changed_records||[]).length?` <span>${row.changed_records.map(record=>esc(`${record.entity_type}: ${record.entity_id}`)).join(', ')}</span>`:''} <button type="button" data-action="cloud-cancel" data-operation="${esc(row.operation_id)}">Discard pending edit</button></li>`).join('');
 return `${cloudStatusHTML(state)}<div class="settings-actions cloud-controls"><button type="button" class="button secondary" data-action="cloud-connect">Connect Cloud 2</button><button type="button" class="button secondary" data-action="cloud-refresh">Check clouds</button>${state?.canResetPassword?'<button type="button" class="button secondary" data-action="cloud-reset-password">Reset Cloud 2 password</button>':''}${choices}${state?.sources?.cloud2?.state==='online'?'<button type="button" class="button secondary" data-action="cloud-sync">Sync now</button>':''}</div>${pending?`<ul class="small cloud-operation-list">${pending}</ul>`:''}${conflicts||state?.conflictNextAfter?`<div class="small"><strong>Your pending edits</strong><ul class="cloud-operation-list">${conflicts}</ul>${state.conflictNextAfter?`<button type="button" data-action="cloud-conflicts-next" data-after="${esc(state.conflictNextAfter)}">Next</button>`:''}</div>`:''}`;
}

export function renderCloudStatus(host,bridge){
  let disposed=false;
  const unsubscribe=bridge.subscribe(state=>{if(!disposed)host.innerHTML=cloudStatusHTML(state);});
  return ()=>{if(disposed)return;disposed=true;unsubscribe();host.innerHTML='';};
}
