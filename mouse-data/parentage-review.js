import {parentRoleEvidence} from './parentage-evidence.js?v=1';
import {formatMouseSid} from './mouse-sid.js?v=188';

// Read-only review of alternatives already saved on mouse records. Source notes,
// cage membership and blank roles never become inferred parent assignments here.
const mounts=new WeakMap();
let mountNumber=0;
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():'';
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const order=(a,b)=>a.localeCompare(b,'en',{numeric:true});
const parentIds=value=>[...new Set(list(value).filter(id=>typeof id==='string'&&id.trim()).map(id=>id.trim()))].sort(order);
const currentMouse=mouse=>mouse.state==='Stock'&&!mouse.archived&&!mouse.app_archived_at&&!mouse.history_read_only&&!mouse.source_historical;
const PAGE_SIZE=20,VISIBLE_CHILDREN=6;
const option=(value,label,selected)=>`<option value="${value}"${value===selected?' selected':''}>${esc(label)}</option>`;

/** Group only genuine saved alternatives, retaining each role's inference label. */
export function buildParentageReviewGroups(dataset){
 const byId=new Map(),groups=new Map();
 for(const mouse of list(dataset?.tables?.mice)){
  const id=text(mouse?.mouse_sid);if(!id)continue;
  const rows=byId.get(id)||[];rows.push(mouse);byId.set(id,rows);
 }
 for(const [id,rows]of byId){
  // An ambiguous identifier cannot identify one navigable child record.
  if(rows.length!==1)continue;
  const mouse=rows[0],sire=parentIds(mouse.sire_sids),dam=parentIds(mouse.dam_sids);
  if(sire.length<2&&dam.length<2)continue;
  const normalized={...mouse,sire_sids:sire,dam_sids:dam};
  const roles=['sire','dam'].map(role=>parentRoleEvidence(normalized,role)).filter(role=>role.ids.length>1);
  const litterSid=text(mouse.litter_sid),dateOfBirth=text(mouse.date_of_birth);
  const key=JSON.stringify([litterSid,dateOfBirth,sire,dam,roles.map(role=>[role.role,role.inferred,role.confidence,role.origin,role.confirmedInEditor])]);
  let group=groups.get(key);
  if(!group){group={id:'',litterSid,dateOfBirth,roles,children:[]};groups.set(key,group);}
  group.children.push({id,mouse});
 }
 const result=[...groups.values()].sort((a,b)=>order(a.litterSid,b.litterSid)||order(a.dateOfBirth,b.dateOfBirth)||order(a.children[0].id,b.children[0].id));
 result.forEach((group,index)=>{group.id='parentage-'+(index+1);group.children.sort((a,b)=>order(a.id,b.id));});
 return result;
}

const savedEvidence=mouse=>Object.fromEntries(['mouse_sid','physical_tag','date_of_birth','litter_sid','sire_sids','dam_sids','lineage_basis','record_origin','source_record_id','source_filename','source_sheet','source_row','source_sha256'].filter(key=>Object.hasOwn(mouse,key)).map(key=>[key,mouse[key]]));

/** Navigation and evidence disclosure only; this component has no save capability. */
export function renderParentageReview(container,dataset,hooks={}){
 if(!container)return ()=>{};
 const groups=buildParentageReviewGroups(dataset),mouseIndex=new Map(),litterIndex=new Map();
 for(const mouse of list(dataset?.tables?.mice)){
  const id=text(mouse?.mouse_sid);if(!id)continue;const rows=mouseIndex.get(id)||[];rows.push(mouse);mouseIndex.set(id,rows);
 }
 for(const litter of list(dataset?.tables?.litters)){
  const id=text(litter?.litter_sid);if(!id)continue;const rows=litterIndex.get(id)||[];rows.push(litter);litterIndex.set(id,rows);
 }
 const state={search:'',scope:'all',role:'all',evidence:'all',page:0,expanded:null,error:''},prefix='parentage-review-'+(++mountNumber);
 mounts.set(container,state);
 const current=()=>{try{return mounts.get(container)===state&&container.isConnected!==false&&hooks.isCurrent?.()!==false;}catch{return false;}};
 const available=id=>{const rows=mouseIndex.get(String(id));return rows?.length===1?rows[0]:null;};
 function filtered(){
  const query=state.search.trim().toLocaleLowerCase();
  return groups.flatMap(group=>{
   const children=group.children.filter(child=>state.scope==='all'||(state.scope==='current'?currentMouse(child.mouse):!currentMouse(child.mouse)));
   const roles=group.roles.filter(role=>(state.role==='all'||role.role===state.role)&&(state.evidence==='all'||(state.evidence==='inferred'?role.inferred:!role.inferred)));
   const search=[group.litterSid,group.dateOfBirth,...children.flatMap(child=>[child.id,child.mouse.physical_tag,child.mouse.state,child.mouse.source_record_id,child.mouse.source_filename]),...roles.flatMap(role=>[role.role,role.label,...role.ids.flatMap(id=>[id,available(id)?.physical_tag])])].filter(Boolean).join(' ').toLocaleLowerCase();
   return children.length&&roles.length&&(!query||search.includes(query))?[{...group,children,roles}]:[];
  });
 }
 function familyLink(group,id,label){
  return available(id)&&typeof hooks.openFamily==='function'?`<button type="button" class="text-button" data-parentage-action="family" data-parentage-group="${esc(group.id)}" data-parentage-mouse="${esc(id)}" aria-label="Open Family for ${esc(label)} · SID ${esc(id)}">${esc(label)} · SID ${esc(id)}</button>`:`<span>${esc(label)} · SID ${esc(id)}${available(id)?'':' <span class="small muted">· Record unavailable</span>'}</span>`;
 }
 function childHTML(group,child){return `<div>${familyLink(group,child.id,text(child.mouse.physical_tag)||'Untagged mouse')} <span class="small muted">${esc(child.mouse.state||'Unknown')}${child.mouse.archived||child.mouse.app_archived_at?' · Archived':''}</span></div>`;}
 function childrenHTML(group){
  const visible=group.children.slice(0,VISIBLE_CHILDREN),rest=group.children.slice(VISIBLE_CHILDREN);
  return visible.map(child=>childHTML(group,child)).join('')+(rest.length?`<details><summary>${rest.length} more ${rest.length===1?'child':'children'}</summary>${rest.map(child=>childHTML(group,child)).join('')}</details>`:'');
 }
 function rolesHTML(group){return group.roles.map(role=>`<div><strong>${role.role==='sire'?'Sire':'Dam'}</strong> <span class="badge amber">${esc(role.label)}</span><div>${role.ids.map(id=>familyLink(group,id,text(available(id)?.physical_tag)||'Mouse')).join('<br>')}</div></div>`).join('');}
 function evidenceHTML(group){
  const litterRows=litterIndex.get(group.litterSid),evidence={children:group.children.map(child=>savedEvidence(child.mouse)),...(litterRows?.length===1?{linked_litter:savedEvidence(litterRows[0])}:{})};
  const raw=JSON.stringify(evidence,null,2),limit=12000,shown=raw.length>limit?raw.slice(0,limit)+'\n… More saved evidence is available in each child’s Family view → Open mouse → Source provenance.':raw;
  return `<tr><td colspan="3"><div class="panel-body source-disclosure"><p class="small muted">Saved source references and parent arrays are retained as recorded. Alternative IDs do not identify an individual biological parent.${group.roles.some(role=>role.inferred)?' Inferred alternatives retain their recorded confidence; editor confirmation is not biological confirmation.':''}</p><pre>${esc(shown)}</pre></div></td></tr>`;
 }
 function paint({focusSearch=false,start=null,end=null}={}){
  if(!current())return;
  const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));state.page=Math.max(0,Math.min(state.page,pages-1));
  const visible=rows.slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE),children=rows.reduce((count,group)=>count+group.children.length,0);
  if(!visible.some(group=>group.id===state.expanded))state.expanded=null;
  const totalChildren=groups.reduce((count,group)=>count+group.children.length,0),totalLinks=groups.reduce((count,group)=>count+group.children.length*group.roles.reduce((sum,role)=>sum+role.ids.length,0),0);
  container.innerHTML=`<section class="panel" aria-label="Parentage Review"><div class="panel-head"><h2>Parentage Review</h2></div><div class="panel-body"><p>${totalChildren} ${totalChildren===1?'child has':'children have'} saved parent alternatives · ${totalLinks} candidate links.</p><p class="small muted">Children with the same saved parent sets, litter and birth date are grouped. Alternatives remain unresolved. Blank parent fields alone are not review issues.</p><div class="toolbar"><label class="sr-only" for="${prefix}-search">Search parentage review</label><input id="${prefix}-search" class="search" type="search" data-parentage-field="search" value="${esc(state.search)}" placeholder="Find child, parent, SID or litter…"><div class="filters"><select data-parentage-field="scope" aria-label="Parentage record scope">${[['all','All saved records'],['current','Current living'],['other','Other records']].map(([value,label])=>option(value,label,state.scope)).join('')}</select><select data-parentage-field="role" aria-label="Parent role">${[['all','Sire and dam alternatives'],['sire','Sire alternatives'],['dam','Dam alternatives']].map(([value,label])=>option(value,label,state.role)).join('')}</select><select data-parentage-field="evidence" aria-label="Parentage evidence">${[['all','All alternatives'],['recorded','Recorded alternatives'],['inferred','Inferred alternatives']].map(([value,label])=>option(value,label,state.evidence)).join('')}</select></div></div>${state.error?`<p class="alert error" role="alert">${esc(state.error)}</p>`:''}<div class="resultsbar"><span>${children} ${children===1?'child':'children'} · ${rows.length} ${rows.length===1?'group':'groups'} matching</span></div><div class="table-card"><div class="table-scroll"><table><thead><tr><th>Children</th><th>Parent alternatives</th><th>Evidence</th></tr></thead><tbody>${visible.map(group=>`<tr><td><strong>${group.litterSid?'Litter '+esc(group.litterSid):'Saved parent set'}</strong><div class="small muted">${esc(group.dateOfBirth||'DOB not recorded')} · ${group.children.length} ${group.children.length===1?'child':'children'}</div>${childrenHTML(group)}</td><td>${rolesHTML(group)}</td><td><button type="button" class="text-button" data-parentage-action="evidence" data-parentage-group="${esc(group.id)}" aria-expanded="${state.expanded===group.id}">Saved evidence</button></td></tr>${state.expanded===group.id?evidenceHTML(group):''}`).join('')}</tbody></table></div>${!rows.length?`<div class="empty">${groups.length?'No matching parentage alternatives.':'No multiple-parent alternatives are saved in the available mouse records.'}</div>`:''}<div class="pagination"><span>${rows.length?`${state.page*PAGE_SIZE+1}–${Math.min(rows.length,(state.page+1)*PAGE_SIZE)} of ${rows.length} groups`:'0 groups'}</span><div class="actions"><button type="button" class="button secondary" data-parentage-action="previous"${state.page===0?' disabled':''}>Previous</button><span>${state.page+1} / ${pages}</span><button type="button" class="button secondary" data-parentage-action="next"${state.page+1>=pages?' disabled':''}>Next</button></div></div></div></div></section>`;
  if(focusSearch){const input=container.querySelector?.('#'+prefix+'-search');input?.focus?.();if(start!==null)input?.setSelectionRange?.(start,end??start);}
 }
 container.oninput=event=>{if(!current()||event.target.dataset?.parentageField!=='search')return;state.search=String(event.target.value||'');state.page=0;state.expanded=null;paint({focusSearch:true,start:event.target.selectionStart??null,end:event.target.selectionEnd??null});};
 container.onchange=event=>{if(!current())return;const field=event.target.dataset?.parentageField,value=event.target.value,allowed={scope:['all','current','other'],role:['all','sire','dam'],evidence:['all','recorded','inferred']};if(!allowed[field]?.includes(value))return;state[field]=value;state.page=0;state.expanded=null;state.error='';paint();};
 container.onclick=async event=>{
  if(!current())return;const target=event.target.closest?.('[data-parentage-action]');if(!target||target.disabled)return;
  const action=target.dataset.parentageAction;event.preventDefault?.();
  if(action==='previous'||action==='next'){const pages=Math.max(1,Math.ceil(filtered().length/PAGE_SIZE));state.page=Math.max(0,Math.min(pages-1,state.page+(action==='next'?1:-1)));state.expanded=null;paint();return;}
  const group=filtered().slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE).find(row=>row.id===target.dataset.parentageGroup);if(!group)return;
  if(action==='evidence'){state.expanded=state.expanded===group.id?null:group.id;paint();return;}
  if(action==='family'){
   const id=String(target.dataset.parentageMouse||''),members=new Set([...group.children.map(child=>child.id),...group.roles.flatMap(role=>role.ids)]);
   if(!members.has(id)||!available(id)||typeof hooks.openFamily!=='function')return;
   try{await hooks.openFamily(id);}catch(error){if(current()){state.error=error?.message||'Could not open Family.';paint();}}
  }
 };
 paint();
 return ()=>{if(mounts.get(container)!==state)return;const clear=current();mounts.delete(container);if(clear){container.onclick=container.oninput=container.onchange=null;container.innerHTML='';}};
}


// Historical held evidence is separate from the saved parent-alternative view.
// Cases describe a source review and never become current biological links here.
export const HISTORICAL_PARENTAGE_REVIEW_LIMITS=Object.freeze({events:50000,issuesPerEvent:3000,issues:10000,ids:100,tags:100,evidence:25,reasonCodes:30,summary:2000,literal:4000});
const historicalMounts=new WeakMap();
const historicalObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const historicalString=(value,max,{empty=false}={})=>typeof value==='string'&&value.length<=max&&(empty||value.trim())?value:null;
function historicalStrings(value,maxItems,maxLength){
 if(!Array.isArray(value)||value.length>maxItems||value.some(item=>!historicalString(item,maxLength)||/[\u0000-\u001f\u007f]/.test(item)))return null;
 return [...new Set(value.map(item=>item.trim()))];
}
export function safeHistoricalParentageSourceUrl(value){
 if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f]/.test(value))return null;
 try{
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))return null;
  const document=url.hostname==='docs.google.com'&&/^\/(?:spreadsheets|document|presentation)\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname);
  const drive=url.hostname==='drive.google.com'&&/^\/file\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname);
  return document||drive?url.href:null;
 }catch{return null;}
}
function historicalDate(event){
 const value=event.recorded_at??event.parentage_recovery_at??event.recovery_at??event.created_at??event.date;
 if(typeof value!=='string'||value.length>64||!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d))?$/.test(value)||!Number.isFinite(Date.parse(value)))return null;
 const day=value.slice(0,10);
 return new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day?value:null;
}
function historicalRef(ref){
 if(!historicalObject(ref)||!historicalString(ref.source_id,256)||historicalString(ref.literal,HISTORICAL_PARENTAGE_REVIEW_LIMITS.literal,{empty:true})===null)return null;
 const optional={};
 for(const [key,max]of [['sheet',256],['cell',128],['comment_id',256]]){
  const value=ref[key];if(value!=null&&historicalString(value,max,{empty:true})===null)return null;
  optional[key]=value??null;
 }
 if(ref.file_sha256!=null&&(typeof ref.file_sha256!=='string'||!/^[a-fA-F0-9]{64}$/.test(ref.file_sha256)))return null;
 return {source_id:ref.source_id,source_url:safeHistoricalParentageSourceUrl(ref.source_url),source_url_unavailable:Boolean(ref.source_url)&&!safeHistoricalParentageSourceUrl(ref.source_url),file_sha256:ref.file_sha256??null,...optional,literal:ref.literal};
}

/** Bounded, read-only projection. No current-parent comparison resolves a case. */
export function buildHistoricalParentageIssues(dataset){
 const limits=HISTORICAL_PARENTAGE_REVIEW_LIMITS,events=list(dataset?.tables?.husbandry_events),issues=[],seen=new Set();
 let unavailable=0,relevantBatches=0,omitted=0;
 for(let eventIndex=0;eventIndex<Math.min(events.length,limits.events);eventIndex++){
  const event=events[eventIndex];
  if(!historicalObject(event)||event.event_type!=='source_reconciliation_batch'||event.parentage_policy!=='owner_authorized_historical_parentage_recovery')continue;
  relevantBatches++;
  if(event.recovery_schema_version!==1||!historicalString(event.event_id,256)||!Array.isArray(event.parentage_issues)||event.parentage_issues.length>limits.issuesPerEvent){unavailable++;continue;}
  for(let issueIndex=0;issueIndex<event.parentage_issues.length;issueIndex++){
   const issue=event.parentage_issues[issueIndex];
   if(issues.length>=limits.issues){omitted+=event.parentage_issues.length-issueIndex;break;}
   if(!historicalObject(issue)||issue.schema_version!==1||issue.status!=='needs_review'||issue.confidence!=='uncertain'||!['sire','dam','both'].includes(issue.role)||!historicalString(issue.issue_id,256)||!historicalString(issue.summary,limits.summary)){unavailable++;continue;}
   const mouseSids=historicalStrings(issue.mouse_sids,limits.ids,200),parentSids=historicalStrings(issue.candidate_parent_sids,limits.ids,200),tags=historicalStrings(issue.candidate_parent_tags,limits.tags,256),reasons=historicalStrings(issue.reason_codes,limits.reasonCodes,128);
   if(!mouseSids||!parentSids||!tags||!reasons||!Array.isArray(issue.evidence_refs)||issue.evidence_refs.length>limits.evidence){unavailable++;continue;}
   const evidence=issue.evidence_refs.map(historicalRef);if(evidence.some(ref=>ref===null)){unavailable++;continue;}
   const normalized={issueId:issue.issue_id,status:'needs_review',confidence:'uncertain',role:issue.role,mouseSids,parentSids,candidateParentTags:tags,reasonCodes:reasons,summary:issue.summary,evidenceRefs:evidence,batchId:event.event_id,recordedAt:historicalDate(event)};
   const duplicateKey=JSON.stringify(normalized);if(seen.has(duplicateKey))continue;seen.add(duplicateKey);
   issues.push({...normalized,key:'historical-case-'+eventIndex+'-'+issueIndex});
  }
 }
 return {issues,relevantBatches,unavailable,omitted,eventScanLimited:events.length>limits.events};
}

const historicalReasons=Object.freeze({
 child_identity_ambiguous:'More than one mouse matches the source child.',
 ambiguous_child_identity:'More than one mouse matches the source child.',
 child_identity_unresolved:'The source child is not identified.',
 child_unmatched:'The source child has no exact record match.',
 parent_identity_ambiguous:'More than one possible parent matches.',
 ambiguous_parent_identity:'More than one possible parent matches.',
 parent_dob_missing:'The parent identity needs a corroborating birth date.',
 parent_independent_dob_missing:'The parent identity needs a corroborating birth date.',
 source_conflict:'Historical sources disagree.',
 conflicting_sources:'Historical sources disagree.',
 conflicting_recorded_role:'The candidate differs from a saved parent role.',
 grouped_dam_candidates:'Several dams are listed; maternity is unresolved.',
 unidentified_child:'The source does not identify an individual child.'
});

/** Separate accessible review section. Only exact existing raw keys can navigate. */
export function renderHistoricalParentageReview(container,dataset,hooks={}){
 if(!container)return ()=>{};
 const model=buildHistoricalParentageIssues(dataset),byId=new Map();
 for(const mouse of list(dataset?.tables?.mice)){
  const id=text(mouse?.mouse_sid);if(!id)continue;const rows=byId.get(id)||[];rows.push(mouse);byId.set(id,rows);
 }
 const state={query:'',role:'all',page:0,error:''},prefix='historical-parentage-'+(++mountNumber);
 historicalMounts.set(container,state);
 const current=()=>{try{return historicalMounts.get(container)===state&&container.isConnected!==false&&hooks.isCurrent?.()!==false;}catch{return false;}};
 const available=id=>byId.get(id)?.length===1?byId.get(id)[0]:null;
 const shownSid=id=>formatMouseSid(id,dataset);
 const labels=id=>[id,shownSid(id),available(id)?.physical_tag,available(id)?.date_of_birth].filter(Boolean);
 function filtered(){
  const query=state.query.trim().toLocaleLowerCase();
  return model.issues.filter(issue=>(state.role==='all'||issue.role===state.role||issue.role==='both')&&(!query||[issue.issueId,issue.summary,issue.role,...issue.reasonCodes,...issue.candidateParentTags,...issue.mouseSids.flatMap(labels),...issue.parentSids.flatMap(labels),...issue.evidenceRefs.flatMap(ref=>[ref.source_id,ref.sheet,ref.cell,ref.comment_id,ref.literal])].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)));
 }
 function recordHTML(issue,id){
  const mouse=available(id),label=(text(mouse?.physical_tag)||'Mouse')+' · SID '+shownSid(id),dob=text(mouse?.date_of_birth),info=dob?' · Current record DOB '+dob:' · Current record DOB not recorded';
  const button=mouse&&typeof hooks.openMouse==='function'?'<button type="button" class="text-button" data-historical-parentage-action="mouse" data-historical-parentage-case="'+esc(issue.key)+'" data-historical-parentage-mouse="'+esc(id)+'">'+esc(label)+'</button>':'<span>'+esc(label)+(mouse?'':' · Record unavailable')+'</span>';
  return '<div>'+button+'<span class="small muted">'+esc(info)+'</span></div>';
 }
 function evidenceHTML(issue){
  let html='<details><summary>Source evidence ('+issue.evidenceRefs.length+')</summary><p class="small muted">Literal historical notes are retained as evidence. Candidate identities and parentage remain unconfirmed.</p>';
  for(const ref of issue.evidenceRefs){
   html+='<div class="source-disclosure"><p class="small">'+esc(ref.source_id)+(ref.sheet?' · Sheet '+esc(ref.sheet):'')+(ref.cell?' · Cell '+esc(ref.cell):'')+(ref.comment_id?' · Comment '+esc(ref.comment_id):'')+'</p>';
   if(ref.source_url)html+='<a href="'+esc(ref.source_url)+'" target="_blank" rel="noopener noreferrer">Open source document</a>';
   else if(ref.source_url_unavailable)html+='<p class="small muted">A safe source-document link is unavailable.</p>';
   if(ref.file_sha256)html+='<p class="small muted">File SHA-256: <code>'+esc(ref.file_sha256)+'</code></p>';
   html+='<pre>'+esc(ref.literal)+'</pre></div>';
  }
  if(!issue.evidenceRefs.length)html+='<p class="small muted">No literal source reference was included in this saved case.</p>';
  return html+'</details>';
 }
 function issueHTML(issue){
  const role=issue.role==='both'?'Sire and dam':issue.role==='sire'?'Sire':'Dam';
  let html='<article class="panel" aria-label="'+esc(role)+' historical parentage case"><div class="panel-body"><p><span class="badge amber">Uncertain · Needs review</span> <span class="badge amber">Inferred candidates</span></p><h3>'+esc(role)+' evidence to review</h3><p>'+esc(issue.summary)+'</p>';
  html+='<p class="small muted">Review batch recorded: '+esc(issue.recordedAt||'Date not recorded')+'. This historical case remains visible if current parent fields change; field agreement does not resolve it.</p>';
  html+='<div><strong>Current child record reference'+(issue.mouseSids.length===1?'':'s')+'</strong>';
  html+=issue.mouseSids.length?issue.mouseSids.map(id=>recordHTML(issue,id)).join(''):'<p>Individual child identity is unresolved. No mouse record has been assigned to this evidence.</p>';
  html+='</div><div><strong>Source parent candidates · unconfirmed</strong>'+issue.parentSids.map(id=>recordHTML(issue,id)).join('');
  if(issue.candidateParentTags.length)html+='<p>Unresolved literal parent tags: '+issue.candidateParentTags.map(tag=>'<code>'+esc(tag)+'</code>').join(', ')+'</p>';
  if(!issue.parentSids.length&&!issue.candidateParentTags.length)html+='<p>No individually identified parent is available.</p>';
  html+='</div>';
  if(issue.reasonCodes.length)html+='<div><strong>Why this is held</strong><ul>'+issue.reasonCodes.map(code=>'<li>'+esc(historicalReasons[code]||code.replace(/_/g,' '))+'</li>').join('')+'</ul></div>';
  html+=evidenceHTML(issue)+'<p class="small muted">Historical case: '+esc(issue.issueId)+' · Batch: '+esc(issue.batchId)+'</p></div></article>';
  return html;
 }
 function paint({focusSearch=false,start=null,end=null}={}){
  if(!current())return;
  const all=filtered(),pages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));state.page=Math.max(0,Math.min(state.page,pages-1));const visible=all.slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE);
  let html='<section class="panel" aria-label="Historical parentage evidence to review"><div class="panel-head"><h2>Historical parentage evidence to review</h2></div><div class="panel-body"><p>'+model.issues.length+' saved '+(model.issues.length===1?'case':'cases')+' available for review. These are uncertain historical candidates, not confirmed biological parents.</p>';
  html+='<p class="small muted">Original source identity, conflicting notes and unidentified animals stay visible. This section only opens records and source evidence.</p>';
  if(model.unavailable||model.omitted||model.eventScanLimited)html+='<p class="alert" role="status">Some historical evidence is unavailable in this view ('+model.unavailable+' invalid or unsupported entries'+(model.omitted?', '+model.omitted+' entries beyond the display bound':'')+(model.eventScanLimited?'; source scan limit reached':'')+'). The available count does not represent all saved cases.</p>';
  html+='<div class="toolbar"><label class="sr-only" for="'+prefix+'-search">Search historical parentage evidence</label><input id="'+prefix+'-search" type="search" class="search" data-historical-parentage-field="query" value="'+esc(state.query)+'" placeholder="Find a mouse, tag, source or reason…"><label class="sr-only" for="'+prefix+'-role">Historical parent role</label><select id="'+prefix+'-role" data-historical-parentage-field="role" aria-label="Historical parent role">'+[['all','All historical cases'],['sire','Sire cases'],['dam','Dam cases'],['both','Cases involving both roles']].map(([value,label])=>option(value,label,state.role)).join('')+'</select></div>';
  if(state.error)html+='<p class="alert error" role="alert">'+esc(state.error)+'</p>';
  html+='<p class="small" role="status">'+all.length+' matching '+(all.length===1?'case':'cases')+'</p>'+visible.map(issueHTML).join('');
  if(!visible.length)html+='<p class="empty">'+(model.issues.length?'No historical cases match these filters.':'No historical parentage cases are available in the loaded records.')+'</p>';
  html+='<div class="pagination"><span>'+(all.length?(state.page*PAGE_SIZE+1)+'–'+Math.min(all.length,(state.page+1)*PAGE_SIZE)+' of '+all.length:'0 cases')+'</span><div class="actions"><button type="button" class="button secondary" data-historical-parentage-action="previous"'+(state.page===0?' disabled':'')+'>Previous</button><span>'+(state.page+1)+' / '+pages+'</span><button type="button" class="button secondary" data-historical-parentage-action="next"'+(state.page+1>=pages?' disabled':'')+'>Next</button></div></div></div></section>';
  container.innerHTML=html;
  if(focusSearch){const input=container.querySelector?.('#'+prefix+'-search');input?.focus?.();if(start!==null)input?.setSelectionRange?.(start,end??start);}
 }
 container.oninput=event=>{if(!current()||event.target.dataset?.historicalParentageField!=='query')return;state.query=String(event.target.value??'').slice(0,500);state.page=0;state.error='';paint({focusSearch:true,start:event.target.selectionStart??null,end:event.target.selectionEnd??null});};
 container.onchange=event=>{if(!current()||event.target.dataset?.historicalParentageField!=='role'||!['all','sire','dam','both'].includes(event.target.value))return;state.role=event.target.value;state.page=0;state.error='';paint();};
 container.onclick=async event=>{
  if(!current())return;const target=event.target.closest?.('[data-historical-parentage-action]');if(!target||target.disabled)return;const action=target.dataset.historicalParentageAction;
  if(action==='previous'||action==='next'){event.preventDefault?.();const pages=Math.max(1,Math.ceil(filtered().length/PAGE_SIZE));state.page=Math.max(0,Math.min(pages-1,state.page+(action==='next'?1:-1)));paint();return;}
  if(action!=='mouse')return;event.preventDefault?.();
  const issue=filtered().slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE).find(row=>row.key===target.dataset.historicalParentageCase),id=String(target.dataset.historicalParentageMouse??'');
  if(!issue||![...issue.mouseSids,...issue.parentSids].includes(id)||!available(id)||typeof hooks.openMouse!=='function')return;
  try{await hooks.openMouse(id);}catch(error){if(current()){state.error=error?.message||'Could not open the mouse record.';paint();}}
 };
 paint();
 return ()=>{if(historicalMounts.get(container)!==state)return;historicalMounts.delete(container);container.oninput=container.onchange=container.onclick=null;container.innerHTML='';};
}
