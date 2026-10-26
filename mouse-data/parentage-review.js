import {parentRoleEvidence} from './parentage-evidence.js?v=1';

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
