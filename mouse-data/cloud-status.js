/* Reusable presentation only. The bridge supplies verified, memory-only state. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={cloud1:'Cloud 1',cloud2:'Cloud 2'};
const services={cloud1:'Supabase',cloud2:'BraintimeDisk'};
const labels={online:'Online',unknown:'Not checked',unavailable:'Unavailable',signed_out:'Sign in required',denied:'Access unavailable',not_enrolled:'Enrollment required',not_ready:'Not ready',error:'Could not verify'};
const safeCount=value=>Number.isSafeInteger(value)&&value>=0?value:null;
function timestamp(value){try{return value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' Taipei':'';}catch{return '';}}

export function cloudDataIndicator(state,{mode='cloud',checking=false,offline=false,legacyConnected=false}={}){
 if(offline)return {label:'Offline',title:'Data connection unavailable',connected:false,state:'offline'};
 if(mode!=='cloud')return {label:'Local',title:'Local workspace',connected:false,state:'local'};
 if(checking)return {label:'Checking',title:'Checking the data connection',connected:false,state:'checking'};
 const source=state?.active,value=state?.sources?.[source];
 if(Object.hasOwn(names,source)&&value?.state==='online'&&value.ready===true&&value.canRead===true&&(source!=='cloud2'||value.enrolled===true))return {label:names[source],title:services[source],connected:true,state:'connected',source};
 if(!state&&legacyConnected)return {label:names.cloud1,title:services.cloud1,connected:true,state:'connected',source:'cloud1'};
 if(state?.loading)return {label:'Checking',title:'Checking the data connection',connected:false,state:'checking'};
 const unavailable=Object.values(state?.sources||{}).some(value=>value?.state==='unavailable');
 return {label:unavailable?'Offline':'Not connected',title:unavailable?'Data connection unavailable':'No verified data source',connected:false,state:unavailable?'offline':'unavailable'};
}

export function cloudIndicatorHTML(state,options={}){
 const value=cloudDataIndicator(state,options);
 return `<button type="button" class="cloud-data-indicator" data-action="open-cloud-settings" data-cloud-state="${value.state}" title="${esc(value.title)}" aria-label="${esc(value.label+', '+value.title+'. Open cloud settings.')}"><span class="connection-dot${value.connected?' cloud':''}" aria-hidden="true"></span><span>${esc(value.label)}</span></button>`;
}

export function cloudStatusHTML(state){
  const active=cloudDataIndicator(state).connected?names[state.active]:null;
  const rows=Object.entries(names).map(([source,name])=>{
    const data=state?.sources?.[source]||{},ready=data.state==='online'&&data.ready===true&&data.canRead===true&&(source!=='cloud2'||data.enrolled===true);
    const pending=safeCount(data.pending),conflicts=safeCount(data.conflicts),sync=timestamp(data.lastSyncAt);
    return `<li data-cloud-source="${source}"><strong>${name} · ${services[source]}</strong> <span>${esc(labels[data.state]||'Not checked')}${data.state==='online'&&!ready?' · Not ready':''}</span>${ready&&state?.active===source?' <span>· In use</span>':''}${ready&&!data.canWrite?' <span>· Read only</span>':''}${pending!==null?` <span>· ${pending} pending</span>`:''}${conflicts!==null?` <span>· ${conflicts} to review</span>`:''}${sync?`<div class="small muted">Last sync ${esc(sync)}</div>`:''}</li>`;
  }).join('');
  const uncertain=(state?.operations||[]).filter(entry=>entry.outcome==='uncertain').length,queued=(state?.operations||[]).filter(entry=>entry.outcome==='queued').length;
  return `<section class="cloud-status" aria-label="Cloud connections"${state?.loading?' aria-busy="true"':''}><ul style="list-style:none;padding:0;margin:0">${rows}</ul><p class="small" role="status">${active?`${active} in use.`:state?.loading?'Checking connections…':'No verified data source.'}${queued?` ${queued} saved on Cloud 2, awaiting sync.`:''}${uncertain?` ${uncertain} write ${uncertain===1?'needs':'need'} verification.`:''}</p></section>`;
}

export function cloudControlsHTML(state){
 const choices=Object.entries(names).map(([source,label])=>{const value=state?.sources?.[source],ready=value?.state==='online'&&value.ready&&value.canRead&&(source!=='cloud2'||value.enrolled);return `<button type="button" class="button secondary" data-action="cloud-select" data-source="${source}" title="${services[source]}" aria-pressed="${state?.active===source}"${!ready||state?.loading?' disabled':''}>Use ${label}</button>`;}).join('');
 const pending=(state?.operations||[]).filter(item=>['uncertain','queued','conflict','rejected'].includes(item.outcome)).map(item=>`<li>${esc(names[item.source])}: ${esc({uncertain:'Unconfirmed save',queued:'Sync pending',conflict:'Changed elsewhere',rejected:'Not accepted'}[item.outcome])} <button type="button" data-action="cloud-verify" data-operation="${esc(item.operationId)}">Check</button>${item.outcome==='uncertain'&&item.retryable!==false?` <button type="button" data-action="cloud-retry" data-operation="${esc(item.operationId)}">Retry same save</button>`:''}</li>`).join('');
 const conflicts=(state?.conflictRows||[]).map(row=>`<li><strong>${esc(row.status==='conflict'?'Changed elsewhere':'Not accepted')}</strong>${(row.changed_records||[]).length?` <span>${row.changed_records.map(record=>esc(`${record.entity_type}: ${record.entity_id}`)).join(', ')}</span>`:''} <button type="button" data-action="cloud-cancel" data-operation="${esc(row.operation_id)}">Discard pending edit</button></li>`).join('');
 return `${cloudStatusHTML(state)}<div class="settings-actions cloud-controls">${state?.sources?.cloud1?.state!=='online'?'<button type="button" class="button secondary" data-action="open-cloud1-signin" title="Supabase">Sign in to Cloud 1</button>':''}<button type="button" class="button secondary" data-action="cloud-connect">Connect Cloud 2</button><button type="button" class="button secondary" data-action="cloud-refresh">Check clouds</button>${state?.canResetPassword?'<button type="button" class="button secondary" data-action="cloud-reset-password">Reset Cloud 2 password</button>':''}${choices}${state?.sources?.cloud2?.state==='online'?'<button type="button" class="button secondary" data-action="cloud-sync">Sync now</button>':''}</div>${pending?`<ul class="small cloud-operation-list">${pending}</ul>`:''}${conflicts||state?.conflictNextAfter?`<div class="small"><strong>Your pending edits</strong><ul class="cloud-operation-list">${conflicts}</ul>${state.conflictNextAfter?`<button type="button" data-action="cloud-conflicts-next" data-after="${esc(state.conflictNextAfter)}">Next</button>`:''}</div>`:''}`;
}

/** Ephemeral credential form. The caller owns authentication and draft guards. */
export function showCloud1SignIn({connect,onComplete=()=>{},onError=()=>{},document:doc=globalThis.document}={}){
 if(typeof connect!=='function')throw new Error('Cloud 1 sign-in is not configured.');
 if(doc.getElementById('cloud1-signin-dialog'))return;
 const dialog=doc.createElement('dialog'),cancel=new AbortController();dialog.id='cloud1-signin-dialog';dialog.className='cloud-signin-dialog';dialog.setAttribute('aria-labelledby','cloud1-signin-title');
 dialog.innerHTML='<form><h2 id="cloud1-signin-title">Sign in to Cloud 1</h2><p class="small muted">Supabase</p><label>ID or email<input name="identifier" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><p class="small" role="status"></p><div class="actions"><button type="button" data-cancel>Cancel</button><button type="submit">Sign in</button></div></form>';
 const form=dialog.querySelector('form'),submit=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');let working=false;
 const clear=()=>{form.reset();cancel.abort();};
 dialog.addEventListener('close',()=>{clear();dialog.remove();},{once:true});
 dialog.querySelector('[data-cancel]').addEventListener('click',()=>dialog.close());
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(working)return;
  const identifier=form.elements.identifier.value.trim(),password=form.elements.password.value;form.elements.password.value='';
  working=true;submit.disabled=true;status.textContent='Signing in…';
  try{await connect(identifier,password,{signal:cancel.signal});if(cancel.signal.aborted)return;dialog.close();await onComplete();}
  catch(error){if(!cancel.signal.aborted){status.textContent=error.message||'Cloud 1 sign-in could not be verified.';form.elements.password.value='';}else onError(error);}
  finally{working=false;submit.disabled=false;}
 });
 doc.body.append(dialog);dialog.showModal();form.elements.identifier.focus();return dialog;
}

export function renderCloudStatus(host,bridge){
  let disposed=false;
  const unsubscribe=bridge.subscribe(state=>{if(!disposed)host.innerHTML=cloudStatusHTML(state);});
  return ()=>{if(disposed)return;disposed=true;unsubscribe();host.innerHTML='';};
}
