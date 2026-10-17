import { getStrainRegistry, buildStrainDefinition, INSERTION_TYPES, STRAIN_DETAIL_FIELDS, strainNamingHelpHTML } from './strain-registry.js?v=115';
import { getStrainCryoLinks } from './strain-cryo-links.js?v=115';

const mounts=new WeakMap();
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const editableFields=new Set(['insertion_type','stock_reference','notes',...STRAIN_DETAIL_FIELDS.map(field=>field.key)]);
const values=row=>({code:row.key,insertion_type:row.insertionType,stock_reference:row.stockReference||'',notes:row.notes||'',...Object.fromEntries(STRAIN_DETAIL_FIELDS.map(field=>[field.key,row[field.key]||'']))});
const signature=row=>JSON.stringify({values:values(row),eventId:row.eventId||'',modifiedAt:row.modifiedAt||''});
const typeLabel=value=>INSERTION_TYPES.find(row=>row.value===value)?.label||'Unknown';
const detailFields=[
  STRAIN_DETAIL_FIELDS.find(field=>field.key==='formal_name'),
  {key:'insertion_type',label:'Modification'},
  ...STRAIN_DETAIL_FIELDS.filter(field=>!['formal_name','references','genotyping_notes','strain_source'].includes(field.key)),
  STRAIN_DETAIL_FIELDS.find(field=>field.key==='strain_source'),
  {key:'stock_reference',label:'Stock / catalog reference',limit:500},
  ...STRAIN_DETAIL_FIELDS.filter(field=>['references','genotyping_notes'].includes(field.key)),
  {key:'notes',label:'Notes',limit:2000,multiline:true}
];

export function hasStrainDrafts(container){return Boolean(mounts.get(container)?.drafts.size)}
export function clearStrainManagement(container){const state=mounts.get(container);if(state)state.cancelled=true;mounts.delete(container);if(container){container.oninput=null;container.onchange=null;container.onclick=null}}

export function renderStrainManagement(container,dataset,hooks) {
  let state=mounts.get(container);
  if(!state){state={drafts:new Map(),selected:'P',query:'',busy:false,error:'',notice:''};mounts.set(container,state)}
  state.context={dataset,hooks};
  const requestedCode=typeof hooks.initialCode==='string'?hooks.initialCode:'';
  if(requestedCode!==state.initialCode){
    if(getStrainRegistry(dataset).some(row=>row.key===requestedCode)){state.selected=requestedCode;state.query='';}
    state.initialCode=requestedCode;
  }
  const data=()=>state.context.dataset;
  const api=()=>state.context.hooks;
  const canEdit=()=>api().canEdit?.()===true;
  const current=()=>mounts.get(container)===state&&!state.cancelled&&api().isCurrent?.()!==false;
  const historyIndex=()=>api().historyIndex||state.loadedHistoryIndex||null;

  function cryoLinks(){
    const index=historyIndex();
    if(state.cryoCache?.dataset!==data()||state.cryoCache?.index!==index)state.cryoCache={dataset:data(),index,...getStrainCryoLinks(data(),{historyIndex:index})};
    return state.cryoCache;
  }

  function cryoHTML(code){
    const projection=cryoLinks(),rows=projection.links.filter(row=>row.codes.includes(code));
    const canLoad=!projection.sourceIndexAvailable&&typeof api().loadCryoHistory==='function';
    return `<section class="strain-cryo" aria-label="Linked cryopreservation"><div class="strain-cryo-heading"><h4>Cryopreservation</h4><span class="badge">${rows.length}</span>${canLoad?`<button type="button" class="button secondary" data-strain-action="load-cryo"${state.busy?' disabled':''}>${state.cryoLoading?'Loading…':'Load cryopreservation'}</button>`:''}</div>${rows.length?`<div class="strain-cryo-cases">${rows.map(row=>`<details class="strain-cryo-case"><summary>${esc(row.caseId||row.label)}${row.batchIds.length?` <small>${esc(row.batchIds.join(', '))}</small>`:''}</summary><div class="strain-cryo-case-body"><dl>${[['Strain',row.strain],['Gene / genotype (recorded)',row.gene],['Background (recorded)',row.background],['Modification (recorded)',row.modificationMethod],['Zygosity (recorded)',row.zygosity],['Origin (recorded)',row.origin]].filter(([,value])=>value).map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>${typeof api().openCryo==='function'?`<button type="button" class="button secondary" data-strain-action="open-cryo" data-cryo-id="${esc(row.id)}"${state.busy?' disabled':''}>Open cryopreservation</button>`:''}</div></details>`).join('')}</div>`:`<p class="subtle strain-cryo-empty">${projection.sourceIndexAvailable?'No linked cases.':'No linked cases in loaded records.'}</p>`}</section>`;
  }

  function fieldHTML(field,value,code,editable,disabled){
    const text=value[field.key]||'',meta=`data-strain-field="${field.key}" data-strain-code="${esc(code)}"`,classes=`strain-detail-field${field.multiline?' strain-detail-wide':''}`;
    if(!editable)return `<div class="${classes}"><dt>${esc(field.label)}</dt><dd>${esc(field.key==='insertion_type'?typeLabel(text):text||'–')}</dd></div>`;
    const attributes=`${meta} aria-label="${esc(field.label)} for ${esc(code)}"${disabled}`;
    const control=field.key==='insertion_type'?`<select ${attributes}>${INSERTION_TYPES.map(row=>`<option value="${row.value}"${row.value===text?' selected':''}>${esc(row.label)}</option>`).join('')}</select>`:field.multiline?`<textarea ${attributes} maxlength="${field.limit}" rows="2">${esc(text)}</textarea>`:`<input ${attributes} value="${esc(text)}" maxlength="${field.limit}">`;
    return `<label class="${classes}"><span>${esc(field.label)}</span>${control}</label>`;
  }

  function paint() {
    if(!current())return;
    const editable=canEdit(),disabled=state.busy?' disabled':'',rows=getStrainRegistry(data()),needle=state.query.trim().toLocaleLowerCase();
    const filtered=rows.filter(row=>[row.key,row.name,row.stockReference,...STRAIN_DETAIL_FIELDS.map(field=>row[field.key])].join(' ').toLocaleLowerCase().includes(needle));
    const selected=rows.find(row=>row.key===state.selected)||rows[0];
    const draft=state.drafts.get(selected.key),value=draft?.values||values(selected);
    container.innerHTML=`<section class="panel strain-management" aria-labelledby="strain-management-title"${state.busy?' aria-busy="true"':''}>
      <div class="panel-head"><h2 id="strain-management-title">Strain registry</h2>${editable?'':'<span class="badge">Read only</span>'}</div>
      ${state.error?`<p class="alert error" role="alert">${esc(state.error)}</p>`:''}${state.notice?`<p class="banner" role="status">${esc(state.notice)}</p>`:''}
      <div class="strain-library">
        <div class="strain-directory"><label class="sr-only" for="strain-search">Search strains</label><input id="strain-search" type="search" data-strain-search value="${esc(state.query)}" placeholder="Search strains"${disabled}>
          <div class="strain-card-list" aria-label="Strains">${filtered.length?filtered.map(row=>`<button type="button" class="strain-card${row.key===selected.key?' selected':''}" data-strain-action="select" data-strain-code="${esc(row.key)}" aria-pressed="${row.key===selected.key}"${disabled}><span class="strain-card-code">${esc(row.key)}</span><span class="strain-card-name">${esc(row.name)}</span><small>${esc(typeLabel(row.insertionType))}${state.drafts.has(row.key)?' · Unsaved':''}</small></button>`).join(''):'<p class="subtle strain-no-match">No matching strains.</p>'}</div>
        </div>
        <section class="strain-detail" aria-label="${esc(selected.name)} details"><div class="strain-detail-heading"><h3>${esc(selected.name)}</h3><span class="badge">${esc(selected.key)}</span>${draft?'<small class="subtle">Unsaved</small>':''}${selected.jaxReference?`<a class="strain-jax-link" href="${esc(selected.jaxReference.url)}" target="_blank" rel="noopener noreferrer">JAX ${esc(selected.jaxReference.stock)} ↗</a>`:''}</div>
          <${editable?'div':'dl'} class="strain-detail-grid">${detailFields.map(field=>fieldHTML(field,value,selected.key,editable,disabled)).join('')}</${editable?'div':'dl'}>
          ${editable?`<div class="strain-detail-actions"><button type="button" class="button" data-strain-action="save" data-strain-code="${esc(selected.key)}"${disabled}>Save ${esc(selected.key)}</button><button type="button" class="button secondary" data-strain-action="discard" data-strain-code="${esc(selected.key)}"${disabled}>Discard changes</button></div>`:''}
          <p class="subtle strain-detail-note">Strain details do not change individual mouse genotypes.</p>
          ${cryoHTML(selected.key)}
        </section>
      </div>
      <details class="compact-details panel-body strain-naming-guide"><summary>Naming guide</summary>${strainNamingHelpHTML()}<p>Transgenic: random insertion. Knock-in: a targeted change at a defined locus, including floxed alleles. Leave unverified stock details blank.</p></details>
    </section>`;
  }

  function update(target) {
    if(!current()||state.busy)return;
    if(target.dataset?.strainSearch!==undefined){
      const position=target.selectionStart;state.query=target.value;paint();
      const search=container.querySelector?.('[data-strain-search]');search?.focus();if(typeof position==='number')search?.setSelectionRange?.(position,position);return;
    }
    if(!canEdit())return;
    const code=target.dataset?.strainCode,field=target.dataset?.strainField;
    if(!editableFields.has(field))return;
    const row=getStrainRegistry(data()).find(row=>row.key===code);if(!row)return;
    let draft=state.drafts.get(code);
    if(!draft){draft={values:values(row),baseline:signature(row)};state.drafts.set(code,draft)}
    draft.values[field]=target.value;state.error='';state.notice='';
    if(JSON.stringify(draft.values)===JSON.stringify(values(row)))state.drafts.delete(code);
  }

  container.oninput=event=>update(event.target);
  container.onchange=event=>update(event.target);
  container.onclick=async event=>{
    const target=event.target.closest('[data-strain-action]');if(!target||target.disabled||state.busy||!current())return;
    const code=target.dataset.strainCode,action=target.dataset.strainAction;
    if(action==='open-cryo'){
      const row=cryoLinks().links.find(row=>row.id===target.dataset.cryoId);if(row&&typeof api().openCryo==='function')api().openCryo(row.id,{kind:row.kind,caseId:row.caseId});return;
    }
    if(action==='load-cryo'){
      if(typeof api().loadCryoHistory!=='function')return;
      state.error='';state.notice='';state.busy=true;state.cryoLoading=true;paint();
      try{
        const loaded=await api().loadCryoHistory();if(!current())return;
        if(loaded?.dataset?.tables)state.context.dataset=loaded.dataset;
        if(loaded?.historyIndex)state.loadedHistoryIndex=loaded.historyIndex;
        if(!cryoLinks().sourceIndexAvailable)throw new Error('Cryopreservation history could not be loaded. Your changes are kept.');
      }catch(error){if(current())state.error=error?.message||'Cryopreservation could not be loaded.'}
      finally{state.busy=false;state.cryoLoading=false;paint()}
      return;
    }
    if(action==='select'){if(getStrainRegistry(data()).some(row=>row.key===code)){state.selected=code;state.error='';state.notice='';paint()}return}
    if(action==='discard'){state.drafts.delete(code);state.error='';state.notice='';paint();return}
    if(action!=='save')return;
    state.error='';state.notice='';
    try {
      if(!canEdit())throw new Error('Edit access is required.');
      const row=getStrainRegistry(data()).find(row=>row.key===code);
      if(!row)throw new Error('Choose a strain from the registry.');
      const draft=state.drafts.get(code)||{values:values(row),baseline:signature(row)};
      state.selected=code;state.busy=true;paint();
      if(typeof api().reloadDataset!=='function')throw new Error('Shared data must be reloaded before saving.');
      const refreshed=await api().reloadDataset();
      if(!current())return;
      if(!refreshed?.tables)throw new Error('Shared data could not be verified. Your changes are kept.');
      state.context.dataset=refreshed;
      if(!canEdit())throw new Error('Edit access is required.');
      const latest=getStrainRegistry(data()).find(row=>row.key===code);
      if(signature(latest)!==draft.baseline)throw new Error('This strain changed while you were editing. Discard changes to load its latest details.');
      const built=buildStrainDefinition(data(),draft.values);
      if(typeof api().saveDataset!=='function')throw new Error('Saving is unavailable. Reopen the strain registry.');
      await api().saveDataset(built.dataset);
      if(!current())return;
      state.context.dataset=built.dataset;state.drafts.delete(code);
      state.notice=`${code} strain definition saved.`;api().toast?.(state.notice);
    }catch(error){if(current()){state.error=error?.message||'The strain definition could not be saved.';api().toast?.(state.error,true)}}
    finally{state.busy=false;paint()}
  };
  paint();
}
