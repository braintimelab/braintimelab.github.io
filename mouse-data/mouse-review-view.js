import { buildMouseReviewIssues } from './mouse-review.js?v=95';

const mounts=new WeakMap();
let mountNumber=0;
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const text=value=>typeof value==='string'?value.trim():'';
const list=value=>Array.isArray(value)?value:[];
const safeUrl=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}};
const sexLabel=value=>value==='Male'?'M':value==='Female'?'F':'?';
const pageSize=25;

/** Local review of retained Animal Sheet observations. Choosing an identity
 * opens the main editor; this view never creates, links, or saves a mouse. */
export function renderMouseReview(container,dataset,hooks={}){
 const issues=buildMouseReviewIssues(dataset,{includeHistorical:true});
 const byId=new Map(issues.map(issue=>[String(issue.id),issue]));
 const mice=list(dataset?.tables?.mice),mouseIndex=new Map();
 for(const mouse of mice){const id=String(mouse.mouse_sid??'');if(!id)continue;const matches=mouseIndex.get(id)||[];matches.push(mouse);mouseIndex.set(id,matches);}
 const availableMouse=id=>{const rows=mouseIndex.get(String(id))||[];return rows.length===1?rows[0]:null;};
 const selectableMouse=id=>{const mouse=availableMouse(id);return mouse&&!mouse.archived&&!mouse.app_archived_at&&!mouse.history_read_only&&!mouse.source_historical?mouse:null;};
 const prefix=`mouse-review-${++mountNumber}`;
 const state={search:'',scope:'current',page:0,expanded:null,completing:false,choice:'',otherSid:'',busy:false,error:''};
 mounts.set(container,state);
 const attached=()=>mounts.get(container)===state&&container.isConnected!==false;
 const current=()=>{try{return attached()&&hooks.isCurrent?.()!==false;}catch{return false;}};
 const editable=()=>{try{return current()&&hooks.canEdit?.()===true&&typeof hooks.completeMouse==='function';}catch{return false;}};
 const allowed=()=>current();
 const candidateLabel=id=>{const m=availableMouse(id);return m?[text(m.physical_tag)||'Mouse',`SID ${id}`,text(m.date_of_birth)].filter(Boolean).join(' · '):`SID ${id}`;};
 const counts={current:issues.filter(issue=>issue.current).length,historical:issues.filter(issue=>!issue.current).length,all:issues.length};
 const searchText=new Map(issues.map(issue=>[String(issue.id),[issue.tag,issue.dateOfBirth,issue.sex,issue.reasonLabel,issue.place,issue.room,issue.cage,...list(issue.candidateMouseSids),...list(issue.sources).flatMap(source=>[source.cell,source.room,source.cage,source.note])].filter(Boolean).join(' ').toLocaleLowerCase()]));
 function filtered(){const query=state.search.trim().toLocaleLowerCase();return issues.filter(issue=>(state.scope==='all'||(state.scope==='current'?issue.current:!issue.current))&&(!query||searchText.get(String(issue.id)).includes(query)));}
 function clearSelection(){state.expanded=null;state.completing=false;state.choice='';state.otherSid='';state.error='';}
 function sourceHTML(source){
  const label=[source.kind==='historical'?'Historical':null,source.date,source.room,source.cage,source.cell].filter(Boolean).join(' · ')||source.recordId||'Source record';
  const url=safeUrl(source.url);
  return `<li>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:esc(label)}${source.note?`<div class="small muted">${esc(source.note)}</div>`:''}</li>`;
 }
 function detailHTML(issue){
  const candidates=list(issue.candidateMouseSids).map(String);
  const candidateHTML=candidates.length?`<div class="chips">${candidates.map(id=>availableMouse(id)&&typeof hooks.openMouse==='function'?`<button type="button" class="text-button" data-review-action="open-mouse" data-review-mouse="${esc(id)}">${esc(candidateLabel(id))} ↗</button>`:`<span>${esc(candidateLabel(id))}</span>`).join('')}</div>`:'<span class="small muted">No matching mouse</span>';
  const form=state.completing&&editable()?`<form data-review-completion="${esc(issue.id)}" class="form-grid"><div class="field"><label for="${prefix}-choice">Mouse record</label><select id="${prefix}-choice" data-review-choice${state.busy?' disabled':''}><option value="">Choose a mouse</option>${candidates.filter(selectableMouse).map(id=>`<option value="mouse:${esc(id)}"${state.choice===`mouse:${id}`?' selected':''}>${esc(candidateLabel(id))}</option>`).join('')}<option value="other"${state.choice==='other'?' selected':''}>Other mouse</option>${issue.canCreate?`<option value="new"${state.choice==='new'?' selected':''}>New mouse</option>`:''}</select></div>${state.choice==='other'?`<div class="field"><label for="${prefix}-sid">Mouse SID</label><input id="${prefix}-sid" data-review-other-sid list="${prefix}-mice" value="${esc(state.otherSid)}" autocomplete="off"${state.busy?' disabled':''}><datalist id="${prefix}-mice">${[...mouseIndex.keys()].filter(selectableMouse).map(id=>`<option value="${esc(id)}">${esc(candidateLabel(id))}</option>`).join('')}</datalist></div>`:''}<div class="settings-actions"><button type="submit" class="button primary"${state.busy||!state.choice||state.choice==='other'&&!selectableMouse(state.otherSid.trim())?' disabled':''}>${state.busy?'Opening…':'Open in Mice'}</button><button type="button" class="text-button" data-review-action="cancel-complete"${state.busy?' disabled':''}>Cancel</button></div></form>`:'';
  return `<tr class="mouse-review-detail"><td colspan="5"><div class="panel-body"><p class="small muted">${esc(issue.tag)}${issue.dateOfBirth?' · DOB '+esc(issue.dateOfBirth):''}</p>${candidateHTML}${form}${state.error?`<p class="alert error" role="alert">${esc(state.error)}</p>`:''}<details class="source-disclosure"><summary>Sources (${esc(issue.sourceCount??list(issue.sources).length)})</summary><ul>${list(issue.sources).map(sourceHTML).join('')}</ul></details></div></td></tr>`;
 }
 function paint({focusSearch=false,selectionStart=null,selectionEnd=null}={}){
  if(!allowed())return;
  const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/pageSize));state.page=Math.min(Math.max(0,state.page),pages-1);
  const visible=rows.slice(state.page*pageSize,(state.page+1)*pageSize);
  if(state.expanded&&!visible.some(issue=>String(issue.id)===state.expanded))clearSelection();
  const canEdit=editable();
  container.innerHTML=`<section class="mouse-review" aria-label="Animal Sheet review"><div class="toolbar"><input id="${prefix}-search" class="search" type="search" data-review-search aria-label="Search animal review" placeholder="Find animal, SID, cage…" value="${esc(state.search)}"${state.busy?' disabled':''}><div class="filters"><select data-review-scope aria-label="Review period"${state.busy?' disabled':''}>${[['current','Current'],['all','All'],['historical','Historical']].map(([value,label])=>`<option value="${value}"${state.scope===value?' selected':''}>${label} (${counts[value]})</option>`).join('')}</select></div></div><div class="resultsbar"><span>${rows.length} unresolved${state.scope==='all'?' · '+counts.current+' current':''}</span></div><div class="table-card"><div class="table-scroll"><table><thead><tr><th>Animal</th><th>Cage / room</th><th>Review</th><th>Last seen</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${visible.map(issue=>`<tr><td><strong>${esc(issue.tag||'—')}</strong><div class="small muted">${esc([sexLabel(issue.sex),issue.dateOfBirth||'DOB unknown',!issue.current?'Historical':null].filter(Boolean).join(' · '))}</div></td><td>${esc(issue.place||[issue.room,issue.cage].filter(Boolean).join(' · ')||'—')}</td><td>${esc(issue.reasonLabel||issue.reason||'Review required')}</td><td>${esc(issue.lastSeen||'—')}</td><td><div class="actions"><button type="button" class="text-button" data-review-action="details" data-review-id="${esc(issue.id)}" aria-expanded="${state.expanded===String(issue.id)}"${state.busy?' disabled':''}>Details</button>${canEdit?`<button type="button" class="button secondary" data-review-action="complete" data-review-id="${esc(issue.id)}"${state.busy?' disabled':''}>Complete in Mice</button>`:''}</div></td></tr>${state.expanded===String(issue.id)?detailHTML(issue):''}`).join('')}</tbody></table></div>${!rows.length?`<div class="empty">${state.search?'No matching entries.':state.scope==='current'?'No current entries to review.':'No entries to review.'}${state.scope==='current'&&counts.historical?` <button type="button" class="text-button" data-review-action="historical">Historical (${counts.historical})</button>`:''}</div>`:''}<div class="pagination"><span>${rows.length?`${state.page*pageSize+1}–${Math.min(rows.length,(state.page+1)*pageSize)} of ${rows.length}`:'0 entries'}</span><div class="actions"><button type="button" class="button secondary" data-review-action="previous"${state.busy||state.page===0?' disabled':''}>Previous</button><span>${state.page+1} / ${pages}</span><button type="button" class="button secondary" data-review-action="next"${state.busy||state.page+1>=pages?' disabled':''}>Next</button></div></div></div></section>`;
  if(focusSearch){const input=container.querySelector?.(`#${prefix}-search`);input?.focus?.();if(selectionStart!==null)input?.setSelectionRange?.(selectionStart,selectionEnd??selectionStart);}
 }
 function setScope(scope){if(!['current','all','historical'].includes(scope))return;state.scope=scope;state.page=0;clearSelection();paint();}
 container.oninput=event=>{
  if(!allowed()||state.busy)return;const target=event.target;
  if(target.hasAttribute?.('data-review-search')){state.search=String(target.value||'');state.page=0;clearSelection();paint({focusSearch:true,selectionStart:target.selectionStart,selectionEnd:target.selectionEnd});}
  else if(target.hasAttribute?.('data-review-other-sid')&&editable()){
   state.otherSid=String(target.value||'');state.error='';const submit=container.querySelector?.('[data-review-completion] button[type="submit"]');if(submit)submit.disabled=!selectableMouse(state.otherSid.trim());
  }
 };
 container.onchange=event=>{
  if(!allowed()||state.busy)return;const target=event.target;
  if(target.hasAttribute?.('data-review-scope'))setScope(target.value);
  else if(target.hasAttribute?.('data-review-choice')&&editable()){
   const issue=byId.get(state.expanded);if(!issue)return;const value=String(target.value||'');
   if(value&&!['other',...(issue.canCreate?['new']:[]),...list(issue.candidateMouseSids).map(id=>`mouse:${id}`)].includes(value))return;
   state.choice=value;state.otherSid='';state.error='';paint();
  }
 };
 container.onclick=async event=>{
  if(!allowed()||state.busy)return;const target=event.target.closest?.('[data-review-action]');if(!target||target.disabled)return;
  event.preventDefault?.();const action=target.dataset.reviewAction;
  if(action==='historical'){state.search='';setScope('historical');return;}
  if(action==='previous'||action==='next'){const pages=Math.max(1,Math.ceil(filtered().length/pageSize));state.page=Math.max(0,Math.min(pages-1,state.page+(action==='next'?1:-1)));clearSelection();paint();return;}
  if(action==='cancel-complete'){state.completing=false;state.choice='';state.otherSid='';state.error='';paint();return;}
  if(action==='open-mouse'){
   const issue=byId.get(state.expanded),id=String(target.dataset.reviewMouse||'');
   if(!issue||!list(issue.candidateMouseSids).map(String).includes(id)||!availableMouse(id)||typeof hooks.openMouse!=='function')return;
   try{await hooks.openMouse(id);}catch(error){if(current()){state.error=error?.message||'Could not open Mice.';paint();}}return;
  }
  const id=String(target.dataset.reviewId||''),issue=byId.get(id);
  if(!issue||!filtered().slice(state.page*pageSize,(state.page+1)*pageSize).includes(issue))return;
  if(action==='details'){const wasOpen=state.expanded===id;clearSelection();if(!wasOpen)state.expanded=id;paint();}
  else if(action==='complete'&&editable()){clearSelection();state.expanded=id;state.completing=true;paint();}
 };
 container.onsubmit=async event=>{
  const form=event.target;if(!form.hasAttribute?.('data-review-completion'))return;event.preventDefault?.();event.stopPropagation?.();
  if(!allowed()||!editable()||state.busy||!state.completing)return;
  const issue=byId.get(state.expanded);if(!issue||String(form.dataset.reviewCompletion)!==state.expanded)return;
  let selected=null;
  if(state.choice==='new'){if(!issue.canCreate)return;}
  else if(state.choice==='other')selected=state.otherSid.trim();
  else if(state.choice.startsWith('mouse:')){selected=state.choice.slice(6);if(!list(issue.candidateMouseSids).map(String).includes(selected))return;}
  else {state.error='Choose an existing or new mouse.';paint();return;}
  if(state.choice!=='new'&&!selectableMouse(selected)){state.error='Choose an existing mouse SID.';paint();return;}
  state.busy=true;state.error='';paint();
  try{if(!editable())return;await hooks.completeMouse(String(issue.id),selected);}
  catch(error){if(current())state.error=error?.message||'Could not open Mice.';}
  finally{state.busy=false;if(current())paint();}
 };
 paint();
 return ()=>{if(mounts.get(container)!==state)return;const clear=current();mounts.delete(container);if(clear){container.onclick=container.oninput=container.onchange=container.onsubmit=null;container.innerHTML='';}};
}
