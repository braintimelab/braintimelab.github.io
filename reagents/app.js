import * as store from '../mouse-data/data-store.js?v=134';
import {PUBLIC_CONFIG,backupViewerLinkHTML} from '../mouse-data/config.js?v=95';
import {createWorkbookXlsx} from '../mouse-data/workbook-export.js?v=95';
import {inventoryExportWorkbook,inventoryPrintBodyHTML,inventoryExportFilename} from './inventory-export.js?v=3';
import {sortRows,toggleSort,sortHeader} from './table-sort.js?v=2';
import {renderAccessLogs} from '../mouse-data/access-logs.js?v=113';
import {createAccessActivity} from '../mouse-data/access-activity.js?v=113';
import {createOrdersUI,validateOrderCatalog,importOrderCatalog} from './orders.js?v=4';
import {buildUsageGroups,usageSelectorHTML,resolveUsageSelection,usageLoggedBy} from './usage.js?v=2';
import {SECTIONS,canReviewHistory,canViewHistory,canViewSection,visibleSections,canWriteKind,STATUSES,labels,text,esc,safeURL,hazardous,quantity,itemName,itemClassification,usageSummary,usageInPeriod,filterItems,stockStats,numeric,usageEvent,validateBundle,importChunks,batchID,exportTable,mergeRecordFields,mergeSafety,collectPages,executeImport} from './model.js?v=7';

const $=id=>document.getElementById(id), main=$('main'),PAGE=50;
const CLASSIFICATIONS=['Antibody','Chemicals','Equipment','Optics / chamber','Plastic / Mol. bio','Surgical / animal','Consumable','Unclassified'];
const SAFETY_ABSENT=new Set(['','unknown','unverified','none','n','no','na','n/a','無','未確認','未分類','not recorded']);
const TOXICITY_LABELS=new Map(['Irritant','Toxic','Corrosive','Flammable','CMR','Danger','Warning','Hazard','Poison','Inflammable'].map(label=>[label.toLowerCase(),label]));
let generation=0,viewGeneration=0,member=false,permissions={},items=[],records=new Map(),sourceRows=[],selected=null,editAction=null,importing=false,searchTimer=null,listKind=null,accessCheck=null;
const importControls=new Map();
const tableSorts=new Map(),recordSortCache=new Map();
let memberRows=[],memberAccessBaseline=new Map();
let connectionState='checking',reloadPending=false,pendingWrites=0;
const readActions=new Set(['access','list','sources','observations','history','order_search','order_list','order_locations']);
const inventoryScope=()=>section()==='safety'?'dangerous':'inventory';
const inventorySort=()=>tableSorts.get(inventoryScope());
function recordedSafetyClassifications(payload){
 const classification=payload.safety?.classification,values=Array.isArray(classification)?classification:[classification];
 return values.filter(value=>typeof value==='string').map(value=>value.trim()).filter(value=>!SAFETY_ABSENT.has(value.toLocaleLowerCase()));
}
function safetyLabel(payload){return toxicityClassifications(payload).join(' · ')||(hazardous(payload)?'Review SDS':'');}
function toxicityClassifications(payload){
 const labels=new Map();
 const add=token=>{const value=token.trim(),key=value.toLocaleLowerCase();if(value&&!SAFETY_ABSENT.has(key))labels.set(key,TOXICITY_LABELS.get(key)||value);};
 for(const classification of recordedSafetyClassifications(payload)){
  const value=classification.replace(/(?:列管編號|管制編號|許可證字號)[^\r\n]*/g,'');let token='',depth=0;
  for(const char of value){
   if('（('.includes(char))depth++;else if('）)'.includes(char))depth=Math.max(0,depth-1);
   if(!depth&&',;·|\r\n'.includes(char)){add(token);token='';}else token+=char;
  }
  add(token);
 }
 return [...labels.values()];
}
function filterInventory(rows,chosenFilters={},dangerous=false){return filterItems(rows,{...chosenFilters,dangerous}).filter(row=>!dangerous||!chosenFilters.toxicity||(chosenFilters.toxicity==='__unclassified'?toxicityClassifications(row.payload).length===0:toxicityClassifications(row.payload).some(label=>label.toLocaleLowerCase()===chosenFilters.toxicity)));}
function toxicityOptions(rows){
 const labels=new Map();let unclassified=false;
 for(const row of filterItems(rows,{dangerous:true})){const values=toxicityClassifications(row.payload);if(!values.length)unclassified=true;for(const label of values)labels.set(label.toLocaleLowerCase(),label);}
 return [...labels].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label)).concat(unclassified?[{value:'__unclassified',label:'Unclassified'}]:[]);
}
function safetyCell(payload){const classifications=toxicityClassifications(payload);if(!classifications.length&&hazardous(payload))classifications.push('Review SDS');return classifications.length?`<span class="safety-badges">${classifications.map(classification=>`<span class="badge danger safety-label">${esc(classification)}</span>`).join('')}</span>`:'<span class="muted">—</span>';}
function inventoryValue(row,key){const p=row.payload;return ({classification:itemClassification(row),name:[itemName(row),p.cas_number||p.cas_raw,p.catalog_number],location:[p.location,p.storage],quantity:typeof p.remaining_amount==='number'?p.remaining_amount:(p.quantity_text||p.amount),status:label(p.status||'unverified'),safety:safetyLabel(p)||null})[key];}
function recordValue(row,key){if(row.kind==='usage'){const u=usageSummary(row);return ({name:itemName(row),date:u.date||u.period,used:[u.usedUnit,u.usedAmount??u.used],remaining:[u.remainingUnit,u.remainingAmount??u.remaining],logger:usageLogger(row)})[key];}const p=row.payload;return ({name:itemName(row),date:p.event_date||p.date||row.record_date,status:p.status?label(p.status):p.amount,details:text(p.summary||p.purpose||p.notes||p.supplier||'')})[key];}
const headers=(scope,columns)=>columns.map(([key,title])=>sortHeader(scope,key,title,tableSorts.get(scope)||(scope==='records:usage'?{key:'date',direction:'desc'}:null))).join('');
async function sortTable(scope,key){
 if(scope!==inventoryScope()&&scope!==`records:${listKind}`&&scope!=='members')return;
 const allowed=scope==='members'?['name','role','can_write','can_manage_safety']:scope==='records:usage'?['name','date','used','remaining','logger']:scope.startsWith('records:')?['name','date','status','details']:['name','classification','location','quantity','status','safety'];
 if(!allowed.includes(key))return;
 tableSorts.set(scope,toggleSort(tableSorts.get(scope),key));offset=0;
 if(scope==='members'){
  if(section()!=='settings'||!permissions.can_import)return;
  for(const row of document.querySelectorAll('[data-member]')){const m=memberRows.find(m=>m.user_id===row.dataset.member);if(m){m.can_write=row.querySelector('[name=write]').checked;m.can_manage_safety=row.querySelector('[name=safety]').checked;}}
  $('member-table').innerHTML=memberTable();
 }else if(scope.startsWith('records:'))await recordList(++viewGeneration,section(),listKind);
 else {inventoryView(section()==='safety');if(section()==='safety')await safetyRecords(viewGeneration);}
 document.querySelector(`[data-sort-scope="${scope}"][data-sort-key="${key}"]`)?.focus();
}
let filters={query:'',category:'',status:'',location:'',toxicity:''},offset=0,historySource='',historyQuery='',historyOffset=0;
let disposeAccessLogs=null,disposeOrders=null,refreshOrders=null,exportSession=null;
let usagePeople=null;
async function loadUsagePeople(){
 const key=context(),check=fence();if(usagePeople?.key===key)return usagePeople.promise;
 const entry={key,directory:[],mine:null,promise:null};usagePeople=entry;
 entry.promise=Promise.allSettled([store.listCageManagers(),store.getMyLabMember()]).then(([directory,profile])=>{check();if(usagePeople!==entry)return entry;entry.directory=directory.status==='fulfilled'?directory.value.managers||[]:[];entry.mine=profile.status==='fulfilled'&&profile.value?.eligible?profile.value.member:null;return entry;});
 return entry.promise;
}
const usageLogger=row=>usageLoggedBy(row,{directory:usagePeople?.key===context()?usagePeople.directory:[]});
const accessActivity=createAccessActivity({app:'reagents',sections:SECTIONS.map(([route])=>route),record:args=>store.recordAppAccess?.(args),getContext:()=>{const current=store.getCloudStatus();return member&&permissions.role&&!current.setupRequired?{...current,mode:'cloud'}:null;}});
const section=()=>{const key=location.hash.slice(1).split('/')[0];return SECTIONS.some(s=>s[0]===key)?key:'orders';};
function observeAccess(resume=false,touch=false){if(!member||document.hidden)return;const current=section();if(!canViewSection(permissions,current))return;accessActivity[resume?'resume':touch?'touch':'observe'](current);}
const label=s=>labels[s]||text(s).replaceAll('_',' ');
const date=v=>v?text(v).slice(0,10):'Date unknown';
function status(message='',error=false){$('status').textContent=message;$('status').dataset.error=String(error);if($('sheet-import-dialog').open){$('sheet-import-status').textContent=message;$('sheet-import-status').dataset.error=String(error);}}
function badge(value){if(value==='listed_current')value='in_stock';return `<span class="badge ${['depleted','disposed','out_of_stock','historical'].includes(value)?'gray':['unverified','listed_current','low_stock','open'].includes(value)?'warn':''}">${esc(label(value||'unverified'))}</span>`;}
function link(url,title){const safe=safeURL(url);return safe?`<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`:esc(title);}
function raw(value){if(value==null)return '<span class="muted">Not recorded</span>';if(typeof value!=='object')return esc(value);return `<dl class="raw-values">${Object.entries(value).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>`<dt>${esc(k.replaceAll('_',' '))}</dt><dd>${esc(text(v))}</dd>`).join('')}</dl>`;}
function stats(){const s=stockStats(items);return `<div class="stats">${[['Listed items',s.listed],['Need stock check',s.needsCheck],['Safety flagged',s.dangerous],['Past expiry date',s.expired]].map(([k,v])=>`<div class="stat"><span>${k}</span><strong>${v.toLocaleString()}</strong></div>`).join('')}</div>`;}
function options(values,current,blank){return `<option value="">${esc(blank)}</option>`+values.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(label(v))}</option>`).join('');}
function pager(start,total,action='page'){return `<div class="pagination"><span>${total?`${start+1}–${Math.min(start+PAGE,total)} of ${total.toLocaleString()}`:'No records'}</span><div><button data-action="${action}" data-offset="${Math.max(0,start-PAGE)}" ${start===0?'disabled':''}>← Previous</button> <button data-action="${action}" data-offset="${start+PAGE}" ${start+PAGE>=total?'disabled':''}>Next →</button></div></div>`;}
function setImporting(value){
 importing=value;
 if(value){
  for(const control of [$('refresh'),$('sidebar-reload'),$('sheet-import'),$('import-file'),$('import-confirm'),$('order-catalog-file'),$('order-catalog-confirm'),...document.querySelectorAll('[data-section], [data-action="choose-import"], [data-action="open-sheet-import"], [data-action="choose-order-catalog"], [data-action="access-save"]')]){
   if(control&&!importControls.has(control)){importControls.set(control,control.disabled);control.disabled=true;}
  }
 }else{for(const [control,disabled] of importControls)control.disabled=disabled;importControls.clear();}
}
function closeOrders(){disposeOrders?.();disposeOrders=null;refreshOrders=null;}
function closeAccessLogs(){disposeAccessLogs?.();disposeAccessLogs=null;}
function ownerAccessLogs(){return member&&permissions.role==='owner'&&store.getCloudStatus().signedIn&&store.getCloudStatus().role==='owner';}
const historyActions=new Set(['sources','observations','history']);
const sourceHistoryFields=new Set(['source_fields','original_fields','source_ref','source_observation','source_raw_values','raw_values','source_evidence','before_record','after_record']);
function ownerHistoryAccess(){return member&&canViewHistory(permissions)&&store.getCloudStatus().signedIn&&store.getCloudStatus().role==='owner';}
function requireHistoryAccess(){if(ownerHistoryAccess())return;const error=Error('History is available only to the owner.');if(member&&canViewHistory(permissions))accessFailure(error);throw error;}
function withoutSourceHistory(payload){return Object.fromEntries(Object.entries(payload||{}).filter(([key])=>!sourceHistoryFields.has(key)).map(([key,value])=>[key,key==='safety'?withoutSourceHistory(value):value]));}
function connectionIndicator(){
 const label=connectionState==='connected'?'Cloud connected':connectionState==='unavailable'?'Cloud unavailable':'Checking cloud connection';
 return {label,className:`account-connection ${connectionState}`};
}
function updateConnectionIndicator(state){
 connectionState=state;const dot=$('account-connection');if(!dot)return;
 const indicator=connectionIndicator();dot.className=indicator.className;dot.title=indicator.label;dot.setAttribute('aria-label',indicator.label);
}
function showIdentity(account){
 const name=text(account.name).trim()||text(account.username).trim()||'Lab member',parts=name.split(/\s+/).filter(Boolean);
 const initials=text(account.acronym).trim().slice(0,4)||(parts.length>1?parts[0][0]+parts.at(-1)[0]:parts[0]?.slice(0,2)||'BT');
 const role=permissions.role==='owner'?'Owner':permissions.role==='manager'?'Manager':'';
 const connection=connectionIndicator();
 $('identity').innerHTML=`<span class="account-initials" aria-hidden="true">${esc(initials.toUpperCase())}</span><span class="account-details"><a class="account-name" href="../mouse-data/#settings" title="Account settings">${esc(name)}</a><span class="account-status">${role?`<span class="account-role">${role}</span>`:''}<span id="account-connection" class="${connection.className}" role="img" aria-label="${connection.label}" title="${connection.label}"></span></span></span>`;
 $('identity').hidden=false;$('sidebar-account').hidden=false;$('sidebar-reload').hidden=false;
}
function resetPrivate(){
 connectionState='checking';usagePeople=null;
 closeExportPreview();$('sheet-import').hidden=true;$('sheet-import-dialog').close();$('import-preview').innerHTML='';
 closeOrders();closeAccessLogs();if(!store.getCloudStatus().signedIn)accessActivity.reset();
 tableSorts.clear();recordSortCache.clear();memberRows=[];memberAccessBaseline.clear();
 setImporting(false);member=false;permissions={};items=[];records.clear();sourceRows=[];selected=null;editAction=null;importing=false;listKind=null;viewGeneration++;clearTimeout(searchTimer);
 filters={query:'',category:'',status:'',location:'',toxicity:''};offset=0;historySource='';historyQuery='';historyOffset=0;
 $('editor').close();$('edit-fields').innerHTML='';$('edit-title').textContent='';$('edit-error').textContent='';$('import-file').value='';$('order-catalog-file').value='';
 $('navigation').innerHTML='';$('identity').textContent='';$('identity').hidden=true;$('sidebar-account').hidden=!store.getCloudStatus().signedIn;$('sidebar-reload').hidden=!store.getCloudStatus().signedIn;status();main.innerHTML='<div class="empty">Checking lab access…</div>';
}
function context(){const c=store.getCloudStatus();return JSON.stringify([c.url,c.colonyId,c.email,c.username,c.signedIn,c.setupRequired,c.passwordRecovery,c.role,c.exportLevel,c.guestLevel,c.guestPermissions]);}
function fence(){const g=generation,c=context();return ()=>{if(g!==generation||!member||context()!==c)throw Error('Your session changed. Reopen Reagents.');};}
function accessFailure(error){generation++;accessActivity.reset();resetPrivate();signInView(error.message||'Your access changed. Sign in again.');}
async function rpc(action,args={}){
 const g=generation,check=fence(),writing=!readActions.has(action);if(writing)pendingWrites++;
 try{check();if(historyActions.has(action))requireHistoryAccess();const result=await store.callReagents(action,args);check();if(historyActions.has(action))requireHistoryAccess();if(permissions.role&&result?.permissions&&JSON.stringify(permissions)!==JSON.stringify(result.permissions))throw Object.assign(Error('Your access changed. Reopen Reagents.'),{reagentsAccessChanged:true});updateConnectionIndicator('connected');return result;}
 catch(error){if(g===generation){if(error.connectionUnavailable||/network|failed to fetch|load failed|connection (?:unavailable|timed out)/i.test(error.message))updateConnectionIndicator('unavailable');if(error.reagentsAccessChanged||/session changed|account changed|not an active member|session expired|sign.in|permission for this cloud operation/i.test(error.message))accessFailure(error);}throw error;}
 finally{if(writing)pendingWrites--;}
}
async function collect(action,args={}){
 if(historyActions.has(action))requireHistoryAccess();
 const check=fence(),before=(await rpc('access')).permissions;check();
 const rows=await collectPages(page=>rpc(action,page),args,check);
 const after=(await rpc('access')).permissions;check();
 if(JSON.stringify(before)!==JSON.stringify(after)){const error=Error('Your access changed while loading. Refresh Reagents.');accessFailure(error);throw error;}
 permissions=after;return rows;
}
function nav(){$('sheet-import').hidden=!member||!permissions.can_import;$('sheet-import').disabled=importing;const current=section();$('navigation').innerHTML=visibleSections(permissions).filter(([id])=>id!=='history'||ownerHistoryAccess()).map(([id,icon,title])=>`<button class="nav-item" data-section="${id}" ${id===current?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icon}</span>${title}</button>`).join('');$('page-title').textContent=SECTIONS.find(s=>s[0]===current)[2];}
function signInView(message=''){
 main.innerHTML=`<section class="sign-in"><h2>Welcome to Reagents</h2><p>Use your Braintime Lab account.</p><form id="login-form"><label>ID or email<input name="identifier" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Sign in</button></form><p>${link(new URL('../internal/',location.href).href,'Forgot password or first login?')}</p>${backupViewerLinkHTML(PUBLIC_CONFIG)}</section>`;
 $('login-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),pw=f.get('password');e.currentTarget.elements.password.value='';const attempt=++generation;status('Signing in…');try{await store.signIn(text(f.get('identifier')).trim(),pw);if(attempt===generation)await start();}catch(err){if(attempt===generation)status(err.message,true);}});
 status(message,!!message);
}
function hasUnsavedChanges(){
 if($('purchase-form')?.elements?.name?.value?.trim())return true;
 if(memberRows.some(row=>{const saved=memberAccessBaseline.get(row.user_id);return saved&&(saved.can_write!==row.can_write||saved.can_manage_safety!==row.can_manage_safety);}))return true;
 return [...document.querySelectorAll('#main input, #main textarea, #main select, #editor input, #editor textarea, #editor select')].some(control=>{
  if(control.disabled||['submit','button','hidden'].includes(control.type))return false;
  if(['checkbox','radio'].includes(control.type))return control.checked!==control.defaultChecked;
  if(control.tagName==='SELECT'){
   const options=[...control.options],defaults=options.map(option=>option.defaultSelected);if(!control.multiple&&!defaults.some(Boolean)&&options.length)defaults[0]=true;
   return options.some((option,index)=>option.selected!==defaults[index]);
  }
  return control.value!==control.defaultValue;
 });
}
async function reloadShared(){
 if(reloadPending)return;
 if(importing||pendingWrites||$('editor').open&&$('save').disabled){status('Wait for the current save or import to finish.',true);return;}
 if(hasUnsavedChanges()&&!window.confirm('Reload shared data and discard unsaved changes?'))return;
 reloadPending=true;for(const id of ['refresh','sidebar-reload'])$(id).disabled=true;
 try{await start();if(member)status('Shared data reloaded.');}
 finally{reloadPending=false;for(const id of ['refresh','sidebar-reload'])$(id).disabled=importing;}
}
async function signOut(){
 if(importing||pendingWrites||reloadPending){status('Wait for the current save or import to finish.',true);return;}
 if(hasUnsavedChanges()&&!window.confirm('Sign out and discard unsaved changes?'))return;
 accessActivity.signOut(section());const g=++generation;resetPrivate();
 try{await store.signOut();}finally{if(g===generation){signInView();$('sidebar-reload').hidden=true;$('sidebar-account').hidden=true;}}
}
async function start({force=false,resumeActivity=false}={}){
 if(importing&&!force)return;
 const attempt=++generation;resetPrivate();
 try{const c=store.getCloudStatus();if(!c.configured||c.url!==PUBLIC_CONFIG.url||c.colonyId!==PUBLIC_CONFIG.colonyId)store.configureCloud(PUBLIC_CONFIG);
  const current=store.getCloudStatus();if(!current.signedIn){signInView();return;}
  if(current.setupRequired||current.passwordRecovery){main.innerHTML='<div class="empty"><h2>Complete your account</h2><p>Finish account setup or password recovery before opening Reagents.</p><a href="../mouse-data/#settings">Continue in Mouse Data →</a></div>';return;}
  const checked=await store.verifyCloudMembership();if(attempt!==generation)return;if(!checked.signedIn||checked.passwordRecovery||checked.setupRequired||!['owner','manager','editor','viewer'].includes(checked.role)||checked.url!==PUBLIC_CONFIG.url||checked.colonyId!==PUBLIC_CONFIG.colonyId)throw Error('Your lab access could not be verified. Sign in again.');member=true;
  const access=await rpc('access');if(attempt!==generation)return;permissions=access.permissions;if(permissions.guest_level&&!canViewSection(permissions,section()))location.hash=visibleSections(permissions)[0]?.[0]||'settings';observeAccess(resumeActivity);
  showIdentity(checked);
  const loaded=await loadInventory();if(attempt!==generation)return;items=loaded;items.forEach(r=>records.set(r.id,r));status();await render();
 }catch(err){if(attempt!==generation)return;accessActivity.reset();resetPrivate();signInView(err.message);}
}
// Returning to the tab must not advance the shared Auth generation while an
// import RPC is in flight. The access RPC checks live membership and permissions.
async function revalidateImportAccess(){
 if(!importing)return start({resumeActivity:true});
 if(accessCheck?.generation===generation)return accessCheck.promise;
 const g=generation,check=fence();
 const pending=(async()=>{
  try{const access=await rpc('access');check();if(!access?.permissions||JSON.stringify(access.permissions)!==JSON.stringify(permissions))throw Error('Your access changed. Reopen Reagents.');observeAccess(true);}
  catch(error){if(g===generation)accessFailure(error);}
 })();
 accessCheck={generation:g,promise:pending};
 try{await pending;}finally{if(accessCheck?.promise===pending)accessCheck=null;}
}
async function revalidateOrdersAccess(){const g=generation,refresh=refreshOrders;try{await rpc('access');if(g===generation&&refresh===refreshOrders){observeAccess(true);await refresh?.();}}catch(error){if(g===generation&&member)accessFailure(error);}}
function returnToApp(){if(document.hidden){accessActivity.suspend();return;}return importing?revalidateImportAccess():disposeOrders?revalidateOrdersAccess():start({resumeActivity:true});}
async function render(){if(!member)return;closeExportPreview();closeOrders();closeAccessLogs();clearTimeout(searchTimer);listKind=null;nav();observeAccess();const v=++viewGeneration;selected=null;main.innerHTML='<div class="empty">Loading…</div>';try{
 const s=section();if(!canViewSection(permissions,s)){main.innerHTML='<div class="empty">This section is not available to your account.</div>';return;}if(s==='history'&&!ownerHistoryAccess()){main.innerHTML='<div class="empty">History is available only to the owner.</div>';return;}if(s==='review'&&!canReviewHistory(permissions)){main.innerHTML='<div class="empty">Review is available to the owner and managers.</div>';return;}if(s==='orders'){await ordersView(v);return;}if(['inventory','safety'].includes(s)){inventoryView(s==='safety');if(s==='safety')await safetyRecords(v);return;}
 if(s==='history'){await historyView(v);return;}if(s==='settings'){await settingsView(v);return;}await recordList(v,s);
 }catch(err){if(v===viewGeneration){main.innerHTML='<div class="empty">This view could not load. Use Refresh to try again.</div>';status(err.message,true);}}}
async function loadInventory(){const kinds=['item','equipment'].filter(kind=>!permissions.guest_level||(kind==='equipment'?canViewSection(permissions,'equipment'):canViewSection(permissions,'inventory')||canViewSection(permissions,'safety')));if(!kinds.length)return [];const rows=await Promise.all(kinds.map(p_kind=>collect('list',{p_kind})));return [...new Map(rows.flat().map(row=>[row.id,row])).values()];}
async function ordersView(v){const controller=createOrdersUI({main,rpc,getPermissions:()=>permissions,isCurrent:()=>member&&v===viewGeneration&&section()==='orders',notify:status,refreshInventory:async()=>{const loaded=await loadInventory();if(v!==viewGeneration)return;items=loaded;items.forEach(r=>records.set(r.id,r));},openHistory:async()=>{closeOrders();await recordList(++viewGeneration,'orders','order');}});disposeOrders=controller.dispose;refreshOrders=controller.refresh;await controller.mount();}
function inventoryView(dangerous=false){
 const visible=sortRows(filterInventory(items,filters,dangerous),inventorySort(),inventoryValue);if(offset>=visible.length)offset=0;
 const cats=[...new Set(items.map(itemClassification).filter(Boolean))].sort(),locations=[...new Set(items.map(r=>r.payload.location).filter(Boolean))].sort();
 main.innerHTML=stats()+`<div class="toolbar"><input id="search" type="search" aria-label="Search name, CAS, barcode or note" placeholder="Search name, CAS, barcode…" value="${esc(filters.query)}" maxlength="200"><select id="category" aria-label="Classification">${options(cats,filters.category,'All classifications')}</select>${dangerous?`<select id="toxicity" aria-label="Toxicity classification"><option value="">All toxicity classifications</option>${toxicityOptions(items).map(({value,label})=>`<option value="${esc(value)}" ${value===filters.toxicity?'selected':''}>${esc(label)}</option>`).join('')}</select>`:''}<select id="location" aria-label="Location">${options(locations,filters.location,'All locations')}</select><select id="stock-status" aria-label="Stock status">${options(STATUSES,filters.status,'All stock states')}</select>${permissions.can_export!==false?'<button data-action="export-pdf">Export to PDF</button><button data-action="export-items">Export to XLSX</button>':''}${canWriteKind(permissions,'item')?'<button data-action="new-item" class="primary">＋ Item</button>':''}</div>${dangerous?'<div class="notice">Source flags and review records. Check the supplier SDS for handling requirements. An unflagged entry is not confirmation of safety.</div>':''}
 <div class="table-wrap"><table><thead><tr>${headers(inventoryScope(),[['name','Reagent / identifier'],['classification','Classification'],['location','Location'],['quantity','Quantity'],['status','Status'],['safety','Safety']])}<th></th></tr></thead><tbody>${visible.slice(offset,offset+PAGE).map(r=>{const p=r.payload;return `<tr><td><button class="name-button" data-action="open" data-id="${esc(r.id)}">${esc(itemName(r))}</button><span class="secondary-line">${esc([p.category&&p.category!==itemClassification(r)?p.category:'',p.cas_number||p.cas_raw,p.catalog_number].filter(Boolean).join(' · '))}</span></td><td>${esc(itemClassification(r))}</td><td>${esc(p.location||'Not recorded')}<span class="secondary-line">${esc(p.storage||'')}</span></td><td>${esc(quantity(p))}</td><td>${badge(p.status)}</td><td>${safetyCell(p)}</td><td>${canWriteKind(permissions,'usage')&&['item','equipment'].includes(r.kind)?`<button data-action="use" data-id="${esc(r.id)}">Use</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="7">No matching items.</td></tr>'}</tbody></table></div>${pager(offset,visible.length)}${dangerous?'<section id="safety-records" class="panel"><h2>Safety records</h2><p>Loading…</p></section>':''}`;
 const search=$('search'),g=generation,v=viewGeneration;search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(g!==generation||v!==viewGeneration||!member)return;filters.query=search.value;offset=0;inventoryView(dangerous);if(dangerous)void safetyRecords(viewGeneration);$('search').focus();},220);});
 for(const [id,key] of [['category','category'],['location','location'],['stock-status','status'],...(dangerous?[['toxicity','toxicity']]:[])])$(id).addEventListener('change',e=>{filters[key]=e.target.value;offset=0;inventoryView(dangerous);if(dangerous)void safetyRecords(viewGeneration);});
}
async function safetyRecords(v){try{const r=await rpc('list',{p_kind:'safety',p_limit:50});if(v!==viewGeneration||!$('safety-records'))return;r.rows.forEach(x=>records.set(x.id,x));$('safety-records').innerHTML=`<div class="section-head"><h2>Safety records</h2>${permissions.can_manage_safety?'<button data-action="new-safety">＋ Review / inspection</button>':''}</div><p class="small muted">Internal preparation and evidence tracking. Official TMU submissions remain in ${link('https://labsafe.tmu.edu.tw/','LabSafe')}.</p>${r.rows.map(x=>`<div class="source-card"><button class="name-button" data-action="open" data-id="${esc(x.id)}">${esc(itemName(x))}</button><p>${esc(x.payload.summary||x.payload.notes||'')}${x.owner_only?' · Owner only':''}</p></div>`).join('')||'<p class="muted">No safety records yet.</p>'}${r.total>50?'<button data-action="all-safety">View all safety records</button>':''}`;}catch(e){if(v===viewGeneration)status(e.message,true);}}
async function usageList(v){
 listKind='usage';await loadUsagePeople();if(v!==viewGeneration)return;const scope='records:usage',cacheKey=JSON.stringify(['usage',filters.query]);
 let rows=recordSortCache.get(cacheKey);if(!rows){rows=await collect('list',{p_kind:'usage',p_query:filters.query});if(v!==viewGeneration)return;recordSortCache.set(cacheKey,rows);}
 if(v!==viewGeneration)return;rows.forEach(row=>records.set(row.id,row));
 const range={fromDate:filters.fromDate||'',toDate:filters.toDate||''};
 rows=sortRows(usageInPeriod(rows,range),tableSorts.get(scope)||{key:'date',direction:'desc'},recordValue);if(offset>=rows.length)offset=0;
 main.innerHTML=`<div class="toolbar"><form id="record-search" class="usage-filters"><input name="query" type="search" aria-label="Search usage" placeholder="Find reagent…" value="${esc(filters.query)}" maxlength="200"><label>From<input name="fromDate" type="date" value="${esc(range.fromDate)}"></label><label>To<input name="toDate" type="date" value="${esc(range.toDate)}"></label><button>Show</button></form><span class="spacer"></span>${permissions.can_export!==false?'<button data-action="export-records" data-kind="usage">Export to XLSX</button>':''}${canWriteKind(permissions,'usage')?'<button class="primary" data-action="new-record" data-kind="usage">＋ Record use</button>':''}</div><div class="table-wrap"><table class="usage-table"><thead><tr>${headers(scope,[['date','Period'],['name','Reagent'],['used','Used'],['remaining','Remaining'],['logger','Logged by']])}</tr></thead><tbody>${rows.slice(offset,offset+PAGE).map(row=>{const u=usageSummary(row);return `<tr><td>${esc(u.period)}</td><td>${esc(itemName(row))}</td><td>${esc(u.used)}</td><td>${esc(u.remaining)}</td><td title="${esc(u.operator)}">${esc(usageLogger(row))}</td></tr>`;}).join('')||'<tr><td colspan="5">No usage in this period.</td></tr>'}</tbody></table></div>${pager(offset,rows.length)}`;
 $('record-search').addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget),next={fromDate:text(form.get('fromDate')),toDate:text(form.get('toDate'))};try{usageInPeriod([],next);filters={...filters,...next,query:text(form.get('query'))};offset=0;void recordList(++viewGeneration,'usage');}catch(error){status(error.message,true);}});
}
async function recordList(v,s,kindOverride){
 const kind=kindOverride||({orders:'order',vendors:'vendor'}[s]||s);if(kind==='usage')return usageList(v);if(['order','review'].includes(kind)&&!canReviewHistory(permissions))throw Error('This section is available to the owner and managers.');listKind=kind;const scope=`records:${kind}`,sort=tableSorts.get(scope),cacheKey=JSON.stringify([kind,filters.query]);let r;
 if(sort){
  let all=recordSortCache.get(cacheKey);
  if(!all){status('Sorting matching records…');all=await collect('list',{p_kind:kind,p_query:filters.query});if(v!==viewGeneration)return;recordSortCache.set(cacheKey,all);status();}
  const sorted=sortRows(all,sort,recordValue);if(offset>=sorted.length)offset=0;r={rows:sorted.slice(offset,offset+PAGE),total:sorted.length};
 }else r=await rpc('list',{p_kind:kind,p_query:filters.query,p_offset:offset,p_limit:PAGE});
 if(v!==viewGeneration)return;r.rows.forEach(x=>records.set(x.id,x));
 main.innerHTML=`<div class="toolbar"><form id="record-search"><input name="query" aria-label="Search records" placeholder="Search records…" value="${esc(filters.query)}" maxlength="200"> <button>Search</button></form><span class="spacer"></span>${permissions.can_export!==false?`<button data-action="export-records" data-kind="${kind}">↓ XLSX</button>`:''}${canWriteKind(permissions,kind)?`<button class="primary" data-action="new-record" data-kind="${kind}">＋ ${kind==='usage'?'Usage':kind==='review'?'Review':label(kind)}</button>`:''}</div><div class="table-wrap"><table><thead><tr>${headers(scope,[['name','Record'],['date','Date'],['status','Status / quantity'],['details','Details']])}</tr></thead><tbody>${r.rows.map(x=>{const p=x.payload;return `<tr><td><button class="name-button" data-action="open" data-id="${esc(x.id)}">${esc(itemName(x))}</button><span class="secondary-line">${esc(p.category||p.operator||'')}${x.owner_only?' · Owner only':''}</span></td><td>${esc(date(p.event_date||p.date||x.record_date))}</td><td>${p.status?badge(p.status):esc(p.amount!=null?`${p.amount} ${p.unit||''}`:'—')}</td><td>${esc(text(p.summary||p.purpose||p.notes||p.supplier||'').slice(0,180))}</td></tr>`;}).join('')||'<tr><td colspan="4">No matching records.</td></tr>'}</tbody></table></div>${pager(offset,r.total)}`;
 $('record-search').addEventListener('submit',e=>{e.preventDefault();filters.query=new FormData(e.currentTarget).get('query');offset=0;void recordList(++viewGeneration,s,kindOverride);});
}
async function detail(id){if(!member)return;clearTimeout(searchTimer);const r=records.get(id);if(!r)return;if(['order','review'].includes(r.kind)&&!canReviewHistory(permissions))throw Error('This section is available to the owner and managers.');selected=r;const v=++viewGeneration,p=r.payload;const fields=r.kind==='item'?['category','cas_number','cas_raw','brand','catalog_number','barcode','lot_number','supplier','location','storage','owner','received_date','opened_date','expiry_date','remaining_amount','unit','quantity_text','status']:Object.keys(p).filter(k=>!['source_fields','source_ref','original_fields','safety','notes','name','title'].includes(k)&&(ownerHistoryAccess()||!sourceHistoryFields.has(k)));
 main.innerHTML=`<div class="section-head"><div><button data-action="back">← ${esc(SECTIONS.find(x=>x[0]===section())[2])}</button><h2>${esc(itemName(r))}</h2>${badge(p.status)}${r.owner_only?' <span class="badge">Owner only</span>':''}</div><div class="actions">${canWriteKind(permissions,r.kind)?`<button data-action="edit" data-id="${esc(id)}">Edit</button>${canWriteKind(permissions,'usage')&&r.kind==='item'&&itemClassification(r)!=='Equipment'?`<button class="primary" data-action="use" data-id="${esc(id)}">Record use</button>`:''}`:''}</div></div><div class="detail-grid"><section class="panel"><h3>Details</h3><dl class="key-values">${fields.filter(k=>p[k]!=null&&p[k]!=='').map(k=>`<dt>${esc(label(k))}</dt><dd>${esc(text(p[k]))}</dd>`).join('')}</dl>${p.notes?`<h3>Notes</h3><p class="notes">${esc(p.notes)}</p>`:''}</section><section class="panel"><div class="section-head"><h3>Safety</h3>${permissions.can_manage_safety&&r.kind==='item'?`<button data-action="safety-edit" data-id="${esc(id)}">Edit safety</button>`:''}</div>${raw(ownerHistoryAccess()?p.safety||{review_status:'Not reviewed'}:withoutSourceHistory(p.safety||{review_status:'Not reviewed'}))}${p.safety?.sds_url?link(p.safety.sds_url,'Open supplier SDS ↗'):''}</section></div>${ownerHistoryAccess()?`<section class="panel"><h3>Original source fields</h3>${raw(p.source_fields||p.original_fields||p.source_ref||{})}<p class="small muted">Source: ${esc(r.source_id||'Entered in Reagents')} · Record date: ${esc(date(r.record_date))} · Version ${r.version}</p>${r.source_id?`<button data-action="source" data-source="${esc(r.source_id)}">Open source rows</button>`:''}</section><div class="detail-grid"><section class="panel"><h3>Change history</h3><div id="changes">Loading…</div></section><section class="panel"><h3>Linked source observations</h3><div id="observations">Loading…</div></section></div>`:''}`;
 if(!ownerHistoryAccess())return;
 await Promise.all([detailPage(id,'changes',0,v),r.kind==='item'?detailPage(id,'observations',0,v):Promise.resolve().then(()=>{if(v===viewGeneration&&ownerHistoryAccess())$('observations').textContent='No linked item observations.';})]);
}
async function detailPage(id,target,start=0,v=viewGeneration){
 if(!ownerHistoryAccess()){if(member&&canViewHistory(permissions))requireHistoryAccess();return;}
 try{
  const action=target==='changes'?'history':'observations',args=target==='changes'?{p_id:id}:{p_item_id:id};
  const page=await rpc(action,{...args,p_offset:start,p_limit:PAGE});if(v!==viewGeneration||selected?.id!==id||!ownerHistoryAccess())return;
  $(target).innerHTML=page.rows.map(row=>target==='changes'?`<details class="history-entry"><summary>${esc(row.operation)} · ${esc(text(row.occurred_at).replace('T',' ').slice(0,19))} UTC</summary><h4>Before</h4>${raw(row.before_record?.payload)}<h4>After</h4>${raw(row.after_record?.payload||row.after_record)}</details>`:observation(row)).join('')||'<p class="muted">No records within your history access.</p>';
  $(target).insertAdjacentHTML('beforeend',pager(start,page.total,target==='changes'?'changes-page':'observations-page'));
 }catch(error){if(v===viewGeneration&&ownerHistoryAccess()&&$(target))$(target).textContent=error.message;}
}
function observation(o){return `<details class="source-card"><summary>${esc(o.section||'Source row')} · ${esc(o.row_ref)} · ${esc(date(o.snapshot_date))}</summary>${raw(o.payload)}</details>`;}
async function historyView(v){
 requireHistoryAccess();
 const sources=await collect('sources');if(v!==viewGeneration)return;requireHistoryAccess();sourceRows=sources;
 const rows=await rpc('observations',{p_source_id:historySource||null,p_query:historyQuery,p_offset:historyOffset,p_limit:PAGE});if(v!==viewGeneration)return;requireHistoryAccess();
 main.innerHTML=`<p class="small muted">${esc(permissions.export_level?.toUpperCase()||'')} history access${permissions.history_cutoff?` · Since ${esc(permissions.history_cutoff)}`:' · All available dates'}</p><form id="history-search" class="toolbar"><select name="source" aria-label="Source workbook or revision">${options(sourceRows.map(s=>s.source_id),historySource,'All sources').replace(/>[^<]+<\/option>/g,m=>m)}</select><input name="query" type="search" placeholder="Search original rows…" aria-label="Search original rows" maxlength="200" value="${esc(historyQuery)}"><button>Search</button><button type="button" data-action="export-history">↓ History JSON</button></form><p class="small muted">${sourceRows.length} accessible sources · ${rows.total.toLocaleString()} matching rows</p><div class="source-rows">${rows.rows.map(observation).join('')||'<div class="empty">No source rows within your access and filters.</div>'}</div>${pager(historyOffset,rows.total,'history-page')}<details class="panel"><summary>Source register</summary>${sourceRows.map(s=>`<div class="source-card"><h3>${link(s.url,s.title)}</h3><p>${esc(date(s.snapshot_date))} · ${esc(s.kind)}${s.owner_only?' · Owner only':''}${s.is_current?' · Current workbook':''}</p><p>SHA-256: ${esc(s.hash)}</p></div>`).join('')}</details>`;
 const sourceSelect=$('history-search').elements.source;for(const option of sourceSelect.options){const s=sourceRows.find(x=>x.source_id===option.value);if(s)option.textContent=`${date(s.snapshot_date)} · ${s.title}`;}
 $('history-search').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);historySource=f.get('source');historyQuery=f.get('query');historyOffset=0;void historyView(++viewGeneration);});
}
function memberTable(){return `<table class="permissions-table"><thead><tr>${headers('members',[['name','Member'],['role','Role'],['can_write','Edit records'],['can_manage_safety','Edit safety']])}<th></th></tr></thead><tbody>${sortRows(memberRows,tableSorts.get('members'),(m,key)=>key==='name'?(m.name||m.email||m.user_id):m[key]).map(m=>`<tr data-member="${esc(m.user_id)}"><td>${esc(m.name||m.email||m.user_id)}<span class="secondary-line">${esc(m.email||'')}${m.active?'':' · Inactive'}</span></td><td>${esc(m.role)}</td><td><input type="checkbox" aria-label="Edit records for ${esc(m.name||m.email||m.user_id)}" name="write" ${m.can_write?'checked':''} ${m.role==='owner'||!m.active||m.role==='viewer'?'disabled':''}></td><td><input type="checkbox" aria-label="Edit safety for ${esc(m.name||m.email||m.user_id)}" name="safety" ${m.can_manage_safety?'checked':''} ${m.role==='owner'||!m.active||m.role==='viewer'?'disabled':''}></td><td>${m.role!=='owner'&&m.active&&m.role!=='viewer'?`<button data-action="access-save" data-id="${esc(m.user_id)}">Save</button>`:'—'}</td></tr>`).join('')}</tbody></table>`;}
async function settingsView(v){closeAccessLogs();const a=await rpc('access');if(v!==viewGeneration)return;permissions=a.permissions;memberRows=(a.members||[]).map(m=>({...m}));memberAccessBaseline=new Map(memberRows.map(row=>[row.user_id,{...row}]));main.innerHTML=`<section class="panel"><h2>Your access</h2><dl class="key-values"><dt>Role</dt><dd>${esc(label(permissions.role))}</dd><dt>Record editing</dt><dd>${permissions.can_write?'Read & write':'Read only'}</dd><dt>Safety editing</dt><dd>${permissions.can_manage_safety?'Allowed':'Read only'}</dd><dt>History</dt><dd>${esc(permissions.export_level?.toUpperCase())}${permissions.history_cutoff?` · Since ${esc(permissions.history_cutoff)}`:' · All dates'}</dd></dl><div class="settings-account-actions"><a href="../mouse-data/#settings">Account and lab membership →</a><button type="button" data-action="sign-out">Sign out</button></div>${backupViewerLinkHTML(PUBLIC_CONFIG)}</section>${permissions.can_import?`<section class="panel"><h2>Order catalogue</h2><button data-action="choose-order-catalog">Import historical order catalogue</button><div id="order-catalog-preview"></div></section><section class="panel"><h2>Source import</h2><button data-action="open-sheet-import">Import from Reagent sheet</button></section><section class="panel"><h2>Member permissions</h2><p class="small muted">These options restrict Reagents access. Lab membership and history levels are shared with Mouse Data.</p><div class="table-wrap"><div id="member-table">${memberTable()}</div></div></section>`:''}${ownerAccessLogs()?'<div id="access-log-panel"></div>':''}`;
 if(ownerAccessLogs())disposeAccessLogs=renderAccessLogs($('access-log-panel'),{listLogs:store.listAppAccess,getRole:()=>ownerAccessLogs()?'owner':null,getContext:()=>JSON.stringify([generation,viewGeneration,context()]),initialApp:'reagents'});
}

function field(key,title,value='',{type='text',wide=false,required=false,values,help='',disabled=false}={}){const common=`name="${esc(key)}" ${required?'required':''} ${disabled?'disabled':''}`;return `<label class="field ${wide?'wide':''} ${type==='checkbox'?'check':''}">${type==='checkbox'?`<input type="checkbox" ${common} ${value?'checked':''}>${esc(title)}`:`${esc(title)}${values?`<select ${common}>${values.map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(label(v))}</option>`).join('')}</select>`:type==='textarea'?`<textarea ${common}>${esc(value)}</textarea>`:`<input type="${type}" ${common} value="${esc(value)}" ${type==='number'?'step="any" min="0"':''}>`}`}${help?`<small>${esc(help)}</small>`:''}</label>`;}
function openEditor(title,html,action){$('edit-fields').oninput=null;$('edit-fields').onchange=null;$('save').textContent='Save';$('edit-title').textContent=title;$('edit-fields').innerHTML=html;$('edit-error').textContent='';$('save').disabled=false;editAction=action;$('editor').showModal();}
function editRecord(record=null,kind='item'){
 if(!member)return;const p=record?.payload||{};kind=record?.kind||kind;if(!canWriteKind(permissions,kind))return;if(['order','review'].includes(kind)&&!canReviewHistory(permissions))return;if(kind==='safety'&&!permissions.can_manage_safety)return;const recordID=record?.id||'manual-'+crypto.randomUUID();
 if(kind==='usage'&&!record){selectUsageItem();return;}
 const fields=kind==='item'?[['name','Name'],['inventory_classification','Classification'],['category','Category'],['cas_number','CAS number'],['brand','Brand'],['catalog_number','Catalogue number'],['barcode','Barcode / container ID'],['lot_number','Lot / batch'],['supplier','Supplier'],['location','Physical location'],['storage','Storage conditions'],['owner','Responsible person'],['remaining_amount','Remaining amount','number'],['unit','Unit'],['quantity_text','Original quantity text'],['received_date','Received','date'],['opened_date','Opened','date'],['expiry_date','Expires','date']]:[['name','Name / title'],['category','Category'],['date','Date','date'],['operator','Operator / lab ID'],['amount','Amount','number'],['unit','Unit'],['supplier','Supplier'],['location','Location']];
 if(kind==='equipment')fields.splice(1,0,['inventory_classification','Classification']);
 const states=['item','equipment'].includes(kind)?STATUSES:['open','pending','complete','resolved'];
 openEditor(record?'Edit '+itemName(record):'New '+kind,fields.map(([k,t,type])=>field(k,t,k==='inventory_classification'?itemClassification(record||{kind,payload:p}):p[k]??'',{type,values:k==='inventory_classification'?CLASSIFICATIONS:undefined,required:k==='name',disabled:(k==='inventory_classification'&&kind==='equipment')||(k==='storage'&&!permissions.can_manage_safety)||(p.balance_applied===true&&['amount','unit'].includes(k))||(p[k]!==null&&typeof p[k]==='object')})).join('')+field('status','Status',p.status||states[0],{values:[...new Set([p.status,...states].filter(Boolean))]})+field('notes','Notes',p.notes||'',{type:'textarea',wide:true,disabled:p.notes!==null&&typeof p.notes==='object'})+(record?field('archived','Archive record (retains history)',record.archived,{type:'checkbox',wide:true}):''),async values=>{
 const payload=mergeRecordFields(p,values,fields.filter(([key])=>kind!=='equipment'||key!=='inventory_classification'),{canManageSafety:permissions.can_manage_safety});
 const saved=await rpc('save',{p_id:recordID,p_kind:!record&&kind==='item'&&payload.inventory_classification==='Equipment'?'equipment':kind,p_payload:payload,p_expected_version:record?.version||0,p_archived:values.archived===true});replaceRecord(saved);$('editor').close();status('Saved to the shared database.');if(record)await detail(saved.id);else await render();});
}
function editSafety(r){if(!permissions.can_manage_safety)return;const p=r.payload.safety||{};openEditor('Safety · '+itemName(r),field('flagged','Flag for chemical safety review',hazardous(r.payload),{type:'checkbox',wide:true})+[['classification','Classification'],['hazard_codes','Hazard / GHS codes'],['regulatory_list','Regulatory list'],['signal_word','Signal word'],['sds_url','Supplier SDS URL'],['sds_version','SDS version'],['sds_document_date','SDS date','date'],['sds_review_date','SDS reviewed','date'],['sds_reviewer','SDS reviewer'],['sds_next_review_date','Next review','date'],['review_status','Review status']].map(([k,t,type])=>field(k,t,Array.isArray(p[k])?p[k].join(', '):p[k]||'',{type})).join('')+field('notes','Safety notes',p.notes||'',{type:'textarea',wide:true}),async values=>{const safety=mergeSafety(p,values);const saved=await rpc('save',{p_id:r.id,p_kind:r.kind,p_payload:{...r.payload,safety},p_expected_version:r.version,p_archived:r.archived});replaceRecord(saved);$('editor').close();status('Safety record saved.');await detail(r.id);});}
function selectUsageItem(){
 let selection={group:'frequent',query:'',selectedId:''};const check=fence();
 const paint=()=>{const view=usageSelectorHTML(items,selection);selection={...selection,group:view.group,selectedId:view.selectedId};$('edit-fields').innerHTML=view.html;$('save').textContent='Next';$('save').disabled=!view.selectedItem;};
 openEditor('Record use','',async values=>{check();const chosen=resolveUsageSelection(items,{group:values.usage_group,query:values.usage_query,selectedId:values.item_id});if(!chosen)throw Error('Choose an item from this category.');const current=records.get(chosen.id);if(!current||current.archived||!['item','equipment'].includes(current.kind))throw Error('This item changed. Refresh before recording use.');$('editor').close();useRecord(current);});
 $('edit-fields').onchange=event=>{const input=event.target;if(input.name==='usage_group'){selection={...selection,group:input.value,selectedId:''};paint();}else if(input.name==='item_id'){selection.selectedId=input.value;$('save').disabled=!resolveUsageSelection(items,selection);}};
 $('edit-fields').oninput=event=>{const input=event.target;if(input.name!=='usage_query')return;const cursor=input.selectionStart;selection={...selection,query:input.value,selectedId:''};const groups=buildUsageGroups(items,{query:selection.query});if(!groups.find(group=>group.id===selection.group)?.rows.length)selection.group=groups.find(group=>group.rows.length)?.id||selection.group;paint();const query=$('edit-fields').querySelector('[name=usage_query]');query.focus();query.setSelectionRange?.(cursor,cursor);};
 paint();
}
function useRecord(r){
 if(!member||!canWriteKind(permissions,'usage')||!['item','equipment'].includes(r?.kind)||r.archived)return;
 const check=fence();
 const usageID='use-'+crypto.randomUUID(),now=new Date(),today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}),time=now.toLocaleTimeString('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}),equipment=itemClassification(r)==='Equipment',code=usagePeople?.key===context()?usagePeople.mine?.acronym||'':'';
 openEditor('Record use · '+itemName(r),field('event_date','Usage date',today,{type:'date',required:true})+field('local_time','Time',time,{type:'time'})+field('amount',equipment?'Time / uses':'Amount used','',{type:'number',required:true})+field('unit','Unit',equipment?r.payload.usage_unit||'hours':r.payload.unit||'',{required:true})+field('operator','Used by',code)+field('purpose','Purpose / experiment','')+(equipment?'':field('apply_balance',`Subtract from recorded stock (${quantity(r.payload)})`,false,{type:'checkbox',wide:true,help:'Requires a known numeric balance and exactly the same unit.'}))+field('notes','Notes','',{type:'textarea',wide:true}),async values=>{check();const event=usageEvent({...values,apply_balance:equipment?false:values.apply_balance},r.payload,usageID);const result=await rpc('record_usage',{p_id:r.id,p_expected_version:r.version,p_event:event,p_apply_balance:!equipment&&values.apply_balance===true});replaceRecord(result.item);records.set(result.usage.id,result.usage);$('editor').close();status('Usage recorded'+(values.apply_balance?' and stock updated.':'.'));if(selected?.id===r.id)await detail(r.id);else await render();});
 const action=editAction;void loadUsagePeople().then(people=>{check();if(editAction!==action||!$('editor').open)return;const operator=$('edit-fields').querySelector('[name=operator]');if(operator&&operator.value===code)operator.value=people.mine?.acronym||'';}).catch(()=>{});
}
function replaceRecord(r){recordSortCache.clear();records.set(r.id,r);if(['item','equipment'].includes(r.kind)){const i=items.findIndex(x=>x.id===r.id);if(i<0)items.push(r);else items[i]=r;}}
function closeExportPreview(){exportSession=null;$('pdf-export').close();$('pdf-export-content').innerHTML='';}
async function exportRows(kind='item',format='xlsx'){
 if(permissions.can_export===false)throw Error('Exports are not available to your account.');
 if(historyActions.has(kind))requireHistoryAccess();
 if(['order','review'].includes(kind)&&!canReviewHistory(permissions))throw Error('Review and historical orders are available to the owner and managers.');
 if(!['xlsx','pdf'].includes(format)||format==='pdf'&&kind!=='item')throw Error('Choose a supported export format.');
 const checkSession=fence(),v=viewGeneration,route=section(),chosenFilters={...filters},filterKey=JSON.stringify(filters),sortKey=JSON.stringify([...tableSorts]);
 const check=()=>{checkSession();if(v!==viewGeneration||route!==section()||filterKey!==JSON.stringify(filters)||sortKey!==JSON.stringify([...tableSorts]))throw Error('The view changed. Export again from the current view.');};
 const sortScope=kind==='item'?inventoryScope():`records:${kind}`,chosenSort=tableSorts.get(sortScope)||(kind==='usage'?{key:'date',direction:'desc'}:null);
 status('Preparing export…');
 const fresh=kind==='item'?await loadInventory():await collect('list',{p_kind:kind,p_query:chosenFilters.query});check();
 const dangerous=route==='safety',rows=sortRows(kind==='item'?filterInventory(fresh,chosenFilters,dangerous):kind==='usage'?usageInPeriod(fresh,{fromDate:chosenFilters.fromDate||'',toDate:chosenFilters.toDate||''}):fresh,chosenSort,kind==='item'?inventoryValue:recordValue);
 if(!rows.length)throw Error('There are no matching records to export.');
 const options={dangerous,capturedAt:new Date().toISOString(),filterSummary:Object.entries(chosenFilters).filter(([,value])=>value).map(([key,value])=>`${key==='toxicity'?'Toxicity':label(key)}: ${key==='toxicity'?(toxicityOptions(fresh).find(option=>option.value===value)?.label||value):value}`).join(' · ')};
 if(format==='pdf'){
  closeExportPreview();$('pdf-export-content').innerHTML=inventoryPrintBodyHTML(rows,options);exportSession={check,permissions:JSON.stringify(permissions)};$('pdf-export').showModal();status(`PDF preview · ${rows.length.toLocaleString()} matching items`);return;
 }
 const workbook=kind==='item'?inventoryExportWorkbook(rows,options):{title:'Braintime Reagents',sheets:[{name:label(kind),rows:kind==='usage'?[['Period','Reagent','Used','Remaining','Logged by'],...rows.map(row=>{const u=usageSummary(row);return [u.period,itemName(row),u.used,u.remaining,usageLogger(row)];})]:exportTable(ownerHistoryAccess()?rows:rows.map(row=>({...row,payload:withoutSourceHistory(row.payload)})))}]};
 download(createWorkbookXlsx(workbook),kind==='item'?inventoryExportFilename(options,'xlsx'):`Braintime-Reagents-${kind}-${new Date().toISOString().slice(0,10)}.xlsx`);
 status(`Exported ${rows.length.toLocaleString()} records within your access.`);
}
async function printExportPreview(){
 const session=exportSession;if(!session)return;
 try{session.check();await rpc('access');session.check();if(exportSession!==session||JSON.stringify(permissions)!==session.permissions)throw Error('Your access changed. Create a new preview.');window.print();}
 catch(error){closeExportPreview();throw error;}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function openSheetImport(){
 if(!member||!permissions.can_import||importing)return;
 $('sheet-import-status').textContent='';$('sheet-import-dialog').showModal();
}
async function chooseImport(file){
 if(!file||importing||!member||!permissions.can_import)return;const check=fence(),v=viewGeneration;
 if(file.size>150*1024*1024)throw Error('Import package exceeds 150 MB. Split the reviewed package first.');
 const contents=await file.text();check();if(v!==viewGeneration)return;const bundle=JSON.parse(contents),counts=validateBundle(bundle);
 $('import-preview').innerHTML=`<div class="upload-preview"><p><strong>${esc(file.name)}</strong></p><p>${counts.sources} sources · ${counts.items} inventory items · ${counts.records} total records · ${counts.observations.toLocaleString()} source rows</p><p>${counts.privateSources} owner-only sources. Existing edited records will be kept and reported as conflicts.</p><button class="primary" id="import-confirm">Import reviewed package</button></div>`;
 $('import-confirm').addEventListener('click',()=>{try{check();if(v!==viewGeneration)return;void runImport(bundle);}catch{}});
}
async function chooseOrderCatalog(file){
 if(!file||importing||!member||permissions.role!=='owner')return;const check=fence(),v=viewGeneration;if(file.size>30*1024*1024)throw Error('The catalogue exceeds 30 MB.');const bundle=JSON.parse(await file.text());check();if(v!==viewGeneration)return;const counts=validateOrderCatalog(bundle);
 $('order-catalog-preview').innerHTML=`<div class="upload-preview"><p>${esc(file.name)} · ${counts.offers.toLocaleString()} historical options</p><p class="small muted">${Number(counts.source_order_tables)||0} order tables · ${Number(counts.source_price_tables)||0} price tables</p><button class="primary" id="order-catalog-confirm">Import catalogue</button></div>`;
 $('order-catalog-confirm').addEventListener('click',()=>{try{check();if(v===viewGeneration)void runOrderCatalogImport(bundle);}catch{}});
}
async function runOrderCatalogImport(bundle){
 if(importing||!member||permissions.role!=='owner')return;const check=fence(),g=generation,v=viewGeneration;setImporting(true);
 try{const report=await importOrderCatalog(bundle,{call:args=>rpc('order_import_offers',args),check,onProgress:(i,n)=>status(`Importing order catalogue ${i} of ${n}…`)});check();if(v===viewGeneration)$('order-catalog-preview').textContent=`Catalogue imported: ${report.offers_imported.toLocaleString()} options; ${report.replayed_batches} batches already applied.`;status('Order catalogue is ready for search.');}
 catch(error){if(g===generation&&member)status(`Catalogue import stopped. Retry the same file to resume safely. ${error.message}`,true);}
 finally{if(g===generation)setImporting(false);}
}
async function runImport(bundle){
 if(importing||!member||!permissions.can_import)return;const check=fence(),g=generation,v=viewGeneration;setImporting(true);
 let report;
 try{
  report=await executeImport(bundle,{call:args=>rpc('import',args),check,onProgress:(i,n)=>status(`Importing ${i} of ${n} batches…`)});check();
  download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'Braintime-Reagents-import-report.json');
  const loaded=await loadInventory();check();items=loaded;recordSortCache.clear();records.clear();items.forEach(r=>records.set(r.id,r));
  if(v===viewGeneration&&$('import-preview'))$('import-preview').textContent=`Import complete: ${report.sources} new sources, ${report.records} new records, ${report.observations.toLocaleString()} new source rows; ${report.replayed_batches} batches already applied. ${report.conflicts.length} conflicts retained in the report.`;
  status(report.conflicts.length?'Import complete with conflicts. Review the downloaded report.':'Import complete.');
 }catch(error){
  if(g!==generation||!member)return;
  report=error.importReport||report;
  if(report){download(new Blob([JSON.stringify({...report,error:error.message},null,2)],{type:'application/json'}),'Braintime-Reagents-partial-import-report.json');status(`Import stopped after ${report.completed_batches} of ${report.total_batches} confirmed batches. Completed batches remain saved. Retry the same package to resume safely. ${error.message}`,true);}
  else status(error.message,true);
 }finally{if(g===generation)setImporting(false);}
}

$('edit-form').addEventListener('submit',async e=>{e.preventDefault();if(!member||!editAction||$('save').disabled)return;const g=generation,action=editAction;$('save').disabled=true;$('edit-error').textContent='';const values=Object.fromEntries(new FormData(e.currentTarget));for(const check of e.currentTarget.querySelectorAll('input[type=checkbox]'))values[check.name]=check.checked;try{await action(values);}catch(err){if(g===generation)$('edit-error').textContent=err.message;}finally{if(g===generation)$('save').disabled=false;}});
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.hasAttribute('data-close')){if(importing&&b.closest('dialog')?.id==='sheet-import-dialog')return;b.closest('dialog').close();return;}if(b.dataset.section){if(importing)return;location.hash=b.dataset.section;return;}const a=b.dataset.action;if(!a||!member||importing)return;const g=generation;try{
 const r=records.get(b.dataset.id);switch(a){case'sign-out':await signOut();break;case'sort':await sortTable(b.dataset.sortScope,b.dataset.sortKey);break;case'open':await detail(b.dataset.id);break;case'back':await render();break;case'edit':editRecord(r);break;case'use':if(r)useRecord(r);break;case'safety-edit':if(r)editSafety(r);break;case'new-item':editRecord();break;case'new-record':editRecord(null,b.dataset.kind);break;case'new-safety':editRecord(null,'safety');break;case'all-safety':offset=0;await recordList(++viewGeneration,'safety','safety');break;case'page':offset=Number(b.dataset.offset);if(listKind)await recordList(++viewGeneration,section(),listKind);else await render();break;case'changes-page':if(selected)await detailPage(selected.id,'changes',Number(b.dataset.offset));break;case'observations-page':if(selected)await detailPage(selected.id,'observations',Number(b.dataset.offset));break;case'history-page':requireHistoryAccess();historyOffset=Number(b.dataset.offset);await historyView(++viewGeneration);break;case'source':requireHistoryAccess();historySource=b.dataset.source;historyQuery='';historyOffset=0;location.hash='history';if(section()==='history')await historyView(++viewGeneration);break;case'export-items':await exportRows();break;case'export-pdf':await exportRows('item','pdf');break;case'print-export':await printExportPreview();break;case'close-export':closeExportPreview();break;case'export-records':await exportRows(b.dataset.kind);break;case'export-history':{requireHistoryAccess();const check=fence();status('Preparing permitted history…');const access=(await rpc('access')).permissions;const sources=await collect('sources'),rows=await collect('observations',{p_source_id:historySource||null,p_query:historyQuery});check();if(JSON.stringify(access)!==JSON.stringify(permissions)){const error=Error('Your history access changed. Refresh before exporting.');accessFailure(error);throw error;}requireHistoryAccess();download(new Blob([JSON.stringify({exported_at:new Date().toISOString(),access:permissions,sources,observations:rows},null,2)],{type:'application/json'}),'Braintime-Reagents-history.json');status(`Exported ${rows.length.toLocaleString()} permitted source rows.`);break;}case'open-sheet-import':openSheetImport();break;case'choose-import':if(permissions.can_import)$('import-file').click();break;case'choose-order-catalog':if(permissions.role==='owner')$('order-catalog-file').click();break;case'access-save':{const row=b.closest('tr');await rpc('set_access',{p_user_id:b.dataset.id,p_can_write:row.querySelector('[name=write]').checked,p_can_manage_safety:row.querySelector('[name=safety]').checked});status('Reagents permissions saved.');await settingsView(++viewGeneration);break;}}
 }catch(err){if(g===generation)status(err.message,true);}});
$('pdf-export').addEventListener('cancel',closeExportPreview);
$('sheet-import').addEventListener('click',openSheetImport);
$('sheet-import-dialog').addEventListener('cancel',event=>{if(importing)event.preventDefault();});
$('sheet-import-dialog').addEventListener('close',()=>{$('import-preview').innerHTML='';$('sheet-import-status').textContent='';if(member&&!importing)void render();});
$('help').addEventListener('click',()=>$('help-dialog').showModal());for(const id of ['refresh','sidebar-reload'])$(id).addEventListener('click',()=>void reloadShared());
$('import-file').addEventListener('change',e=>{const g=generation;void chooseImport(e.target.files[0]).catch(err=>{if(g===generation)status(err.message,true);});e.target.value='';});
$('order-catalog-file').addEventListener('change',e=>{const g=generation;void chooseOrderCatalog(e.target.files[0]).catch(err=>{if(g===generation)status(err.message,true);});e.target.value='';});
window.addEventListener('hashchange',()=>{if(importing)return;offset=0;filters={query:'',category:'',status:'',location:'',toxicity:''};void render();});
window.addEventListener('storage',e=>{if(e.key===null||['mouse-colony.cloud.v1','mouse-colony.config.v1','mouse-colony.session.v1'].includes(e.key))void start({force:true});});
window.addEventListener('offline',()=>updateConnectionIndicator('unavailable'));
// Revalidate on return from another tab. Never keep private content after an access failure.
document.addEventListener('visibilitychange',returnToApp);
// Interaction refreshes activity without recording keys, field values or item IDs.
for(const eventName of ['pointerdown','keydown'])document.addEventListener(eventName,event=>{if(event.isTrusted!==false)observeAccess(false,true);});
window.addEventListener('focus',()=>{if(document.hidden)return;if(importing||disposeOrders)return returnToApp();if(member)return revalidateOrdersAccess();});
window.addEventListener('pageshow',e=>{if(e.persisted)return returnToApp();});
await start();
