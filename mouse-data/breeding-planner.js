import { predictCross, validateScenario, rankPairs } from './genetics.js?v=100';
import { discoverGenotypes, sourceProfile, catalogueStrains } from './genotype-catalog.js?v=146';
import {canonicalLocusName,strainNamingWarning,legacyVgatCreName,getStrainRegistry,targetGenotypeLabel} from './strain-registry.js?v=146';
import { validateFamilyTargetDraft } from './family-targets.js?v=146';
import {popularBreedingPresets,presetScenario,presetAssumptions,storedBreedingPlan,calculateBreedingPlan,commonFamilyCrosses,familyCrossScenario,familyCrossGuidance,storedFamilyCross} from './breeding-presets.js?v=146';

const mounts=new WeakMap();
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const archived=record=>Boolean(record?.app_archived_at)||record?.archived===true;
const unknown=()=>({alleles:[],evidence:'unknown'});
const locusFields=locus=>({id:locus.id,name:canonicalLocusName(locus),kind:locus.kind,chromosome:locus.chromosome,alleles:[...locus.alleles]});
const localDate=()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`};
const pct=value=>value==null?'Unavailable':`${new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value*100)}%`;
const number=value=>value==null?'Unavailable':new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value);
const weeks=value=>value==null?'Not estimated':`~${Math.round(value/7)} weeks`;
const list=(items,kind='amber')=>items?.length?`<div class="alert ${kind}"${kind==='error'?' role="alert"':''}><ul>${[...new Set(items)].map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>`:'';
const option=(value,label,selected)=>`<option value="${esc(value)}"${String(value)===String(selected)?' selected':''}>${esc(label)}</option>`;
const button=(action,label,data='',style='secondary')=>`<button type="button" class="button ${style}" data-planner-action="${action}" ${data}>${label}</button>`;
const ids=record=>[...(Array.isArray(record?.sire_sids)?record.sire_sids:[]),...(Array.isArray(record?.dam_sids)?record.dam_sids:[])];

function reviewedCall(record,locus) {
  const profile=record?.genetic_profile;
  if(profile&&profile.schema_version!==1)return {call:unknown(),reason:`${locus.name}: unsupported genotype profile version; review before reuse.`};
  const definition=Array.isArray(profile?.loci)?profile.loci.find(row=>row?.id===locus.id):null;
  const value=object(profile?.calls)?profile.calls[locus.id]:null;
  const sameDefinition=definition&&canonicalLocusName(definition)===canonicalLocusName(locus)&&['kind','chromosome'].every(key=>definition[key]===locus[key])&&Array.isArray(definition.alleles)&&definition.alleles.length===locus.alleles.length&&definition.alleles.every(allele=>locus.alleles.includes(allele));
  if(definition?.kind==='cre'&&legacyVgatCreName(definition.name))return {call:unknown(),reason:strainNamingWarning(definition)};
  if(!value)return {call:unknown(),reason:`${locus.name}: no structured call.`};
  if(!sameDefinition)return {call:unknown(),reason:`${locus.name}: saved locus definition differs or is missing; review it before reuse.`};
  if(!object(value)||!['confirmed','inferred','unknown'].includes(value.evidence)||!Array.isArray(value.alleles)||value.alleles.length!==2||value.alleles.some(allele=>typeof allele!=='string'||!locus.alleles.includes(allele)))return {call:unknown(),reason:`${locus.name}: no usable reviewed allele pair.`};
  return {call:clone(value),reason:''};
}

function namingErrors(scenario){return (scenario.loci||[]).filter(locus=>locus.kind==='cre'&&legacyVgatCreName(locus.name)).map(strainNamingWarning)}
function checkedPrediction(scenario){const errors=namingErrors(scenario);if(errors.length)throw new Error(errors.join(' '));return predictCross(scenario)}

function exampleScenario() {
  const loci=[{id:'example-cre',name:'Example Cre',kind:'cre',chromosome:'unknown',alleles:['+','Cre']},{id:'example-flox',name:'Example floxed locus',kind:'flox',chromosome:'unknown',alleles:['+','fl']},{id:'example-reporter',name:'Example reporter',kind:'reporter',chromosome:'unknown',alleles:['+','reporter']}];
  const calls=Object.fromEntries(loci.map(locus=>[locus.id,{alleles:[...locus.alleles],evidence:'inferred'}]));
  return {loci,sire:{sex:'Male',calls:clone(calls)},dam:{sex:'Female',calls:clone(calls)},targets:Object.fromEntries(loci.map(locus=>[locus.id,{mode:'carrier',allele:locus.alleles[1]}])),sex:'Any',independentAssortment:false,desiredCount:1,confidence:0.95,litterSize:6};
}

/** UI-only drafting. A calculation never creates a mating, litter or animal. */
export function renderBreedingPlanner(container,dataset,hooks) {
  let state=mounts.get(container);
  const freshMount=!state;
  if(!state){state={tab:'design',scenario:exampleScenario(),illustrative:true,result:null,strategy:null,strategyRoute:'',founderCopies:{},wildTypeAvailable:true,timing:{founderReadyDay:0,breedingAgeDays:56,gestationDays:21,weaningAgeDays:21},ranking:null,profileId:'',profileCalls:{},profileNotes:'',planName:'',loadedPlan:'',error:'',notice:'',sourceWarnings:[],busy:false,candidateSearch:'',catalogue:[],catalogueDataset:null,sourceCache:new Map(),catalogueOpen:false,quickPlansOpen:false};mounts.set(container,state)}
  const datasetChanged=state.catalogueDataset!==null&&state.catalogueDataset!==dataset;
  state.context={container,dataset,hooks};
  const data=()=>state.context.dataset;
  const api=()=>state.context.hooks;
  const repaintCurrent=()=>{if(mounts.get(container)===state&&api().isCurrent?.()!==false)state.repaint?.();};
  const mice=()=>data().tables?.mice||[];
  const mouse=id=>mice().find(row=>row.mouse_sid===id);
  const canEdit=()=>!state.historyLoading&&api().canEdit?.()===true;
  const historyDeferred=()=>api().historyDeferred===true;
  const genotypeDeferred=()=>api().genotypeHistoryDeferred===true;
  async function loadGenotypeHistory(){
    if(!genotypeDeferred())return true;
    if(state.busy||state.historyLoading)throw new Error('Wait for the current operation.');
    const snapshot=data(),hooks=api();if(typeof hooks.loadGenotypeHistory!=='function')throw new Error('Genotype history is not loaded.');
    state.historyLoading=true;state.genotypeLoading=true;
    try{paint();const fresh=await hooks.loadGenotypeHistory();if(hooks.isCurrent?.()===false||api()!==hooks||data()!==snapshot)return false;if(!fresh?.tables)throw new Error('Genotype history could not be verified.');state.context={...state.context,dataset:fresh,hooks:{...hooks,genotypeHistoryDeferred:false}};state.catalogue=discoverGenotypes(fresh,hooks.historyIndex||null);state.catalogueDataset=fresh;state.sourceCache.clear();if(state.profileId)loadProfile(state.profileId);return true;}
    finally{state.historyLoading=false;state.genotypeLoading=false;repaintCurrent();}
  }
  const genotypeGate=()=>`<section class="panel"><div class="panel-body">${button('load-genotypes',state.historyLoading?'Loading genotypes…':'Load genotype history',state.historyLoading?'disabled':'')}</div></section>`;
  async function designRoute(input,options){
    if(input.loci.length>5)throw new Error('Target design supports up to 5 loci. Use Manual cross for larger crosses.');
    const snapshot=data(),hooks=api();state.busy=true;
    try{paint();const result=await calculateBreedingPlan(input,options);return hooks.isCurrent?.()===false||api()!==hooks||data()!==snapshot?null:result;}
    finally{state.busy=false;if(api()!==hooks||data()!==snapshot)repaintCurrent();}
  }
  async function loadSourceHistory(){
    if(state.historyLoading)return;
    if(state.busy||state.profileId)throw new Error('Close the genotype editor before loading history.');
    if(typeof api().loadSourceHistory!=='function')throw new Error('Source history is not loaded.');
    const snapshot=data(),hooks=api();state.historyLoading=true;
    try{const pending=hooks.loadSourceHistory();paint();const fresh=await pending;if(hooks.isCurrent?.()===false||api()!==hooks||data()!==snapshot)return;state.context={...state.context,dataset:fresh,hooks:{...hooks,historyDeferred:false}};state.catalogue=discoverGenotypes(fresh);state.catalogueDataset=fresh;state.sourceCache.clear();}
    finally{state.historyLoading=false;repaintCurrent();}
  }
  const disabled=()=>state.busy||state.historyLoading?' disabled':'';
  const currentCalls=(record,locus)=>reviewedCall(record,locus).call;
  const call=(owner,id)=>owner.calls[id]||(owner.calls[id]=unknown());
  const invalidate=()=>{state.result=null;state.strategy=null;state.strategyRoute='';state.quickPlanId='';state.ranking=null;state.error='';state.notice='';state.loadedPlan='';container.querySelector?.('.planner-results')?.remove();container.querySelector?.('.planner-strategy-results')?.remove();container.querySelector?.('[data-planner-ranking]')?.remove()};
  if(state.catalogueDataset!==dataset||state.catalogueHistory!==(hooks.historyIndex||null)){state.catalogue=discoverGenotypes(dataset,hooks.historyIndex||null);state.catalogueDataset=dataset;state.catalogueHistory=hooks.historyIndex||null;state.sourceCache.clear()}
  if(freshMount&&state.illustrative)state.scenario.targets=Object.fromEntries(state.scenario.loci.map(locus=>[locus.id,{mode:'exact',alleles:['+',locus.alleles[1]]}]));
  if(freshMount&&state.catalogue.length&&!dataset.synthetic&&!dataset.demo&&!dataset.is_demo){state.scenario.loci=[];state.scenario.targets={};state.scenario.sire.calls={};state.scenario.dam.calls={};state.illustrative=false;state.catalogueOpen=true}
  if(datasetChanged){
    state.strategy=null;state.strategyRoute='';
    state.ranking=null;
    if(!state.loadedPlan){state.result=null;for(const role of ['sire','dam'])if(state.scenario[role].id){
      const record=mouse(state.scenario[role].id),valid=record&&!archived(record)&&record.sex===(role==='sire'?'Male':'Female');
      if(!valid){delete state.scenario[role].id;state.notice=`The selected ${role} is no longer eligible for that role. Choose a parent again.`}
      for(const locus of state.scenario.loci)state.scenario[role].calls[locus.id]=currentCalls(valid?record:null,locus);
    }}
    if(state.profileId){loadProfile(state.profileId);if(!state.busy)state.notice='Genotype editor refreshed from the current dataset. Review before saving.'}
  }

  function loadProfile(id) {
    state.profileId=id;const record=mouse(id);
    state.profileCalls=object(record?.genetic_profile?.calls)?clone(record.genetic_profile.calls):{};state.profileNotes=typeof record?.genetic_profile?.notes==='string'?record.genetic_profile.notes:'';state.sourceWarnings=[];
    for(const locus of state.scenario.loci){const checked=reviewedCall(record,locus);state.profileCalls[locus.id]=checked.call;if(record?.genetic_profile&&checked.reason)state.sourceWarnings.push(checked.reason)}
  }
  if(hooks.initialTargetDraft!==undefined&&hooks.initialTargetDraft!==null){
    const draft=hooks.initialTargetDraft,errors=validateFamilyTargetDraft(draft);
    if(errors.length)state.error='Family tree target needs review: '+errors.join(' ');
    else{
      invalidate();
      state.scenario={loci:clone(draft.loci),targets:clone(draft.targets),sire:{sex:'Male',calls:{}},dam:{sex:'Female',calls:{}},sex:'Any',independentAssortment:false,desiredCount:1,confidence:0.95,litterSize:6};
      for(const role of ['sire','dam'])state.scenario[role].calls=Object.fromEntries(state.scenario.loci.map(locus=>[locus.id,unknown()]));
      state.tab='design';state.illustrative=false;state.catalogueOpen=false;state.sourceWarnings=[];state.planName='';state.profileId='';state.profileCalls={};state.profileNotes='';state.candidateSearch='';
      state.notice=typeof draft.notice==='string'&&draft.notice.trim()?draft.notice:'Target from Family tree. Review the genotype, then design a breeding route.';
    }
  } else if(hooks.initialMouseId){
    const profile=mouse(hooks.initialMouseId)?.genetic_profile;
    const loci=profile?.schema_version===1&&Array.isArray(profile.loci)?profile.loci.filter(locus=>object(locus)&&typeof locus.id==='string'&&typeof locus.name==='string'&&['cre','flox','reporter','other'].includes(locus.kind)&&typeof locus.chromosome==='string'&&/^(?:unknown|[1-9]|1[0-9])$/.test(locus.chromosome)&&Array.isArray(locus.alleles)&&locus.alleles.length>0&&locus.alleles.length<=6&&locus.alleles.every(allele=>typeof allele==='string'&&allele.trim()===allele&&allele)):[];
    state.scenario.loci=clone(loci.slice(0,6));state.scenario.targets=Object.fromEntries(state.scenario.loci.map(locus=>[locus.id,{mode:'any'}]));for(const role of ['sire','dam'])state.scenario[role]={sex:role==='sire'?'Male':'Female',calls:Object.fromEntries(state.scenario.loci.map(locus=>[locus.id,unknown()]))};state.illustrative=false;state.catalogueOpen=!loci.length;invalidate();
    state.tab='genotypes';loadProfile(hooks.initialMouseId);
  }

  function sourceFor(record) {
    const key=JSON.stringify([record?.mouse_sid,state.scenario.loci]);
    if(!state.sourceCache.has(key))state.sourceCache.set(key,sourceProfile(record,state.scenario.loci,data()));
    return state.sourceCache.get(key);
  }
  function parentSelect(role) {
    const selected=state.scenario[role].id||'',sex=role==='sire'?'Male':'Female',record=mouse(selected);
    const choices=mice().filter(row=>row.sex===sex&&!archived(row));
    const missing=selected&&!choices.some(row=>row.mouse_sid===selected)?option(selected,`${selected} · saved parent`,selected):'';
    return `<div class="planner-parent panel"><div class="panel-body"><div class="field"><label for="planner-${role}">${role==='sire'?'Sire':'Dam'} · ${sex}</label><select id="planner-${role}" data-planner-field="parent" data-role="${role}">${option('','Hypothetical parent',selected)}${missing}${choices.map(row=>option(row.mouse_sid,`${row.mouse_sid}${(row.physical_tag||row.mouse_tag)?' · '+(row.physical_tag||row.mouse_tag):''} · ${row.state||'State unknown'}`,selected)).join('')}</select></div>${record?`<p class="small"><strong>Source genotype:</strong> ${esc(record.genotype||'Unknown')}</p><div class="settings-actions">${button('source-parent','Use source suggestions',`data-role="${role}"`)}${button('open-mouse','View mouse',`data-id="${esc(selected)}"`)}</div>`:'<p class="small muted">Hypothetical calls remain part of this scenario.</p>'}</div></div>`;
  }

  function alleleSelect(locus,value,attributes,label) {
    const extra=value&&!locus.alleles.includes(value)?option(value,`${value} (outside configured alleles)`,value):'';
    return `<select aria-label="${esc(label)}" ${attributes}>${option('','Unknown',value)}${extra}${locus.alleles.map(allele=>option(allele,allele,value)).join('')}</select>`;
  }
  function callEditor(locus,owner,mode='cross',locked=false) {
    const value=mode==='profile'?(state.profileCalls[locus.id]||unknown()):call(state.scenario[owner],locus.id),label=mode==='profile'?'Genotype':owner==='sire'?'Sire':'Dam';
    const attributes=`data-planner-field="call" data-mode="${mode}" data-role="${owner}" data-locus="${esc(locus.id)}"${locked?' disabled':''}`;
    return `<fieldset class="planner-call"><legend>${esc(label)}</legend><div class="planner-call-alleles">${[0,1].map(index=>alleleSelect(locus,value.alleles?.[index]||'',`${attributes} data-index="${index}"`,`${locus.name}, ${label}, allele ${index+1}`)).join('')}</div><label>Call status<select ${attributes} data-index="evidence" aria-label="${esc(locus.name+', '+label+', call status')}">${['unknown','inferred','confirmed'].map(evidence=>option(evidence,{unknown:'Unknown',inferred:'Inferred / hypothetical',confirmed:'Confirmed'}[evidence],value.evidence)).join('')}</select></label></fieldset>`;
  }
  function targetEditor(locus) {
    const target=state.scenario.targets[locus.id]||{mode:'any'},attributes=`data-planner-field="target" data-locus="${esc(locus.id)}"`;
    return `<fieldset class="planner-call"><legend>Desired offspring</legend><select aria-label="${esc(locus.name+' target mode')}" ${attributes} data-key="mode">${[['any','Any genotype'],['carrier','Carries allele'],['exact','Exact genotype']].map(([value,label])=>option(value,label,target.mode)).join('')}</select>${target.mode==='carrier'?alleleSelect(locus,target.allele||'',`${attributes} data-key="allele"`,`${locus.name} target allele`):target.mode==='exact'?`<div class="planner-call-alleles">${[0,1].map(index=>alleleSelect(locus,target.alleles?.[index]||'',`${attributes} data-key="alleles" data-index="${index}"`,`${locus.name} target allele ${index+1}`)).join('')}</div>`:''}</fieldset>`;
  }
  function locusEditor(locus,index) {
    return `<section class="panel planner-locus"><div class="panel-head"><h3>Locus ${index+1}</h3>${button('remove-locus','Remove',`data-locus="${esc(locus.id)}"`)}</div><div class="panel-body">${list(strainNamingWarning(locus)?[strainNamingWarning(locus)]:[])}<div class="form-grid"><div class="field"><label for="planner-name-${index}">Name</label><input id="planner-name-${index}" value="${esc(canonicalLocusName(locus))}" maxlength="120" data-planner-field="locus" data-locus="${esc(locus.id)}" data-key="name"></div><div class="field"><label>Available alleles, separated by commas<input value="${esc(locus.alleles.join(', '))}" data-planner-field="locus" data-locus="${esc(locus.id)}" data-key="alleles" aria-label="${esc(locus.name+' available alleles')}"></label></div><div class="field"><label>Type<select data-planner-field="locus" data-locus="${esc(locus.id)}" data-key="kind">${['cre','flox','reporter','other'].map(kind=>option(kind,{cre:'Cre',flox:'Floxed allele',reporter:'Reporter',other:'Other autosomal locus'}[kind],locus.kind)).join('')}</select></label></div><div class="field"><label>Chromosome<select data-planner-field="locus" data-locus="${esc(locus.id)}" data-key="chromosome">${option('unknown','Unknown',locus.chromosome)}${Array.from({length:19},(_,i)=>option(String(i+1),String(i+1),locus.chromosome)).join('')}</select></label></div></div><div class="planner-parent-grid">${callEditor(locus,'sire')}${callEditor(locus,'dam')}${targetEditor(locus)}</div>${locus.kind==='cre'&&locus.alleles.includes('+')?button('negative-control','Set Cre-negative control target',`data-locus="${esc(locus.id)}"`):''}</div></section>`;
  }
  function planningInputs() {
    return `<section class="panel"><div class="panel-body"><div class="form-grid"><div class="field"><label>Target sex<select data-planner-field="config" data-key="sex">${['Any','Male','Female'].map(value=>option(value,value,state.scenario.sex)).join('')}</select></label></div><div class="field"><label>Desired offspring count<input type="number" min="1" max="100" step="1" value="${esc(state.scenario.desiredCount)}" data-planner-field="config" data-key="desiredCount"></label></div><div class="field"><label>Planning confidence<select data-planner-field="config" data-key="confidence">${[0.8,0.9,0.95,0.99].map(value=>option(value,pct(value),state.scenario.confidence)).join('')}</select></label></div><div class="field"><label>Nominal litter size<input type="number" min="1" max="20" step="0.5" value="${esc(state.scenario.litterSize)}" data-planner-field="config" data-key="litterSize"></label></div></div><label class="check"><input type="checkbox" data-planner-field="independent"${state.scenario.independentAssortment?' checked':''}> I explicitly assume these loci assort independently.</label></div></section>`;
  }
  function catalogueAdded(entry) {
    if(!state.scenario.loci.some(row=>row.id===entry.id))return false;
    if(!entry.allele)return true;
    const target=state.scenario.targets[entry.id];
    return target?.mode==='carrier'&&target.allele===entry.allele||target?.mode==='exact'&&target.alleles?.includes(entry.allele);
  }
  function targetPair(locus){const target=state.scenario.targets[locus.id];return target?.mode==='exact'&&target.alleles?.length===2&&target.alleles.every(allele=>locus.alleles.includes(allele))?[...target.alleles]:['+','+'];}
  function targetCopyButtons(entry){
    const locus=state.scenario.loci.find(row=>row.id===entry.id)||entry,variant=entry.allele||targetVariant(locus),pair=targetPair(locus),present=state.scenario.loci.some(row=>row.id===entry.id),name=canonicalLocusName(entry);
    return `<div class="planner-copy-toggles" role="group" aria-label="${esc(name)} target alleles">${[0,1].map(copy=>{const active=pair[copy]===variant,disabled=!active&&(entry.reviewRequired||!locus.alleles.includes('+')||!variant||!locus.alleles.includes(variant)||(!present&&state.scenario.loci.length>=6));return button('target-copy',String(copy+1),`data-locus="${esc(entry.id)}"${entry.allele?` data-allele="${esc(entry.allele)}"`:''} data-copy="${copy}" aria-label="${esc(name)} target allele ${copy+1}" aria-pressed="${active}"${disabled?' disabled':''}`);}).join('')}</div>`;
  }
  function catalogue() {
    const entries=catalogueStrains(state.catalogue),targetSelection=state.tab==='design'||state.tab==='cross';
    return `<details class="panel planner-catalog" data-planner-catalogue${state.catalogueOpen?' open':''}><summary>Strains <span class="badge">${entries.length}</span></summary><div class="panel-body"><p class="small muted">${targetSelection?'Target copies: one selected = heterozygous · both = homozygous.':'Choose a strain, then review its allele calls.'}</p><div class="settings-actions">${historyDeferred()?button('load-source-history',state.historyLoading?'Loading history…':state.historyReloadRequired?'Reload page':'Load source history',state.historyLoading?'disabled':''):''}${button('clear-loci','Start with an empty cross')}${button('example','Load illustrative example')}<a class="button secondary" href="#strains">Strain details</a></div>${entries.length?`<div class="planner-strain-grid">${entries.map(entry=>{
      const added=catalogueAdded(entry),locusPresent=state.scenario.loci.some(row=>row.id===entry.id),disabled=!added&&(entry.reviewRequired||(!locusPresent&&state.scenario.loci.length>=6));
      return `<article class="planner-strain-card${added?' is-added':''}"><div class="planner-strain-summary"><strong>${esc(canonicalLocusName(entry))}</strong>${entry.locusName?'<span class="small muted">Shared Rosa26 locus</span>':''}${entry.reviewWarning?`<p class="small amber">${esc(entry.reviewWarning)}</p>`:''}</div>${targetSelection?targetCopyButtons(entry):button('catalogue-locus',added?'Already added':entry.reviewRequired?'Review needed':'Add locus',`data-locus="${esc(entry.id)}"${entry.allele?` data-allele="${esc(entry.allele)}"`:''} aria-label="${esc((added?'Remove ':'Add ')+canonicalLocusName(entry)+(added?' from cross':' to cross'))}" aria-pressed="${added}"${disabled?' disabled':''}`)}</article>`;
    }).join('')}</div>`:historyDeferred()?'<p class="muted">Historical catalogue is not loaded.</p>':'<p class="muted">No recognizable strain labels in this dataset. Add a custom locus.</p>'}</div></details>`;
  }

  function targetVariant(locus,scenario=state.scenario){const target=scenario.targets[locus.id];return target?.mode==='carrier'?target.allele:target?.mode==='exact'?target.alleles?.find(allele=>allele!=='+')||locus.alleles.find(allele=>allele!=='+'):locus.alleles.find(allele=>allele!=='+');}
  function targetCopies(locus,scenario=state.scenario){const target=scenario.targets[locus.id],variant=targetVariant(locus,scenario);if(target?.mode!=='exact'||!variant||target.alleles?.length!==2||target.alleles.some(allele=>allele!=='+'&&allele!==variant))return 'advanced';const copies=target.alleles.filter(allele=>allele===variant).length;return copies===1?'heterozygous':copies===2?'homozygous':'advanced';}
  function designLocusName(locus){const allele=targetVariant(locus);return canonicalLocusName(catalogueStrains(state.catalogue).find(entry=>entry.id===locus.id&&entry.allele===allele)||locus);}
  function setDesignTarget(locus,variant,copies){if(!locus.alleles.includes('+')||!variant||!locus.alleles.includes(variant)||variant==='+')throw new Error('Choose a declared variant allele.');state.scenario.targets[locus.id]={mode:'exact',alleles:copies==='homozygous'?[variant,variant]:['+',variant]};invalidate();state.illustrative=false;}
  function targetBoard(){
    const acronym=targetGenotypeLabel(state.scenario),rows=state.scenario.loci.map(locus=>{const variant=targetVariant(locus),copies=targetCopies(locus),variants=locus.alleles.filter(allele=>allele!=='+');return `<div class="planner-target-row"><strong>${esc(designLocusName(locus))}</strong>${variants.length>1?`<select data-planner-field="design-allele" data-locus="${esc(locus.id)}" aria-label="${esc(locus.name+' target allele')}">${variants.map(allele=>option(allele,allele,variant)).join('')}</select>`:`<span class="small muted">${esc(variant||'Choose allele in Manual cross')}</span>`}<select data-planner-field="design-copies" data-locus="${esc(locus.id)}" aria-label="${esc(locus.name+' target copies')}">${copies==='advanced'?option('advanced','Advanced target',copies):''}${option('heterozygous','Heterozygous',copies)}${option('homozygous','Homozygous',copies)}</select><span class="planner-target-pair">${esc(state.scenario.targets[locus.id]?.mode==='exact'?state.scenario.targets[locus.id].alleles.join(' / '):state.scenario.targets[locus.id]?.mode==='carrier'?`Carries ${variant}`:'Any genotype')}</span>${button('remove-locus','×',`data-locus="${esc(locus.id)}" aria-label="${esc('Remove '+designLocusName(locus))}"`)}</div>`;});
    return `<section class="panel planner-target-board"><div class="panel-head"><h2>Target genotype${acronym?': '+esc(acronym):''}</h2><span class="small muted">Virtual breeding design</span></div><div class="panel-body">${rows.length?rows.join(''):'<p class="small muted">Select strains below.</p>'}</div></section>`;
  }
  function designAssumptions(){return `<details class="panel planner-design-assumptions"><summary>Starting stocks &amp; timing</summary><div class="panel-body"><p class="small muted">Hypothetical single-strain stocks, both sexes. Review availability before starting.</p><label class="check"><input type="checkbox" data-planner-field="founder-wildtype"${state.wildTypeAvailable?' checked':''}> Include a hypothetical wild-type stock</label><div class="planner-founder-grid">${state.scenario.loci.map(locus=>`<label>${esc(designLocusName(locus))}<select data-planner-field="founder-copies" data-locus="${esc(locus.id)}" aria-label="${esc(locus.name+' starting stock')}">${option('1','Heterozygous',String(state.founderCopies[locus.id]??1))}${option('2','Homozygous',String(state.founderCopies[locus.id]??1))}</select></label>`).join('')}</div><div class="planner-timing-grid">${[['founderReadyDay','Stock ready, day'],['breedingAgeDays','Breeding age, days'],['gestationDays','Gestation, days'],['weaningAgeDays','Weaning age, days']].map(([key,label])=>`<label>${label}<input type="number" min="0" max="365" value="${esc(state.timing[key])}" data-planner-field="design-timing" data-key="${key}"></label>`).join('')}</div></div></details>`;}
  function referencedLocus(locus,variant=locus.alleles.find(allele=>allele!=='+')){const catalog=state.catalogue.find(entry=>entry.id===locus.id),sameDefinition=catalog&&canonicalLocusName(catalog)===canonicalLocusName(locus)&&['kind','chromosome'].every(key=>catalog[key]===locus[key])&&catalog.alleles.length===locus.alleles.length&&catalog.alleles.every(allele=>locus.alleles.includes(allele)),selected=sameDefinition?catalogueStrains([catalog]).find(entry=>!entry.allele||entry.allele===variant):null,reference=selected?getStrainRegistry(data()).find(row=>canonicalLocusName(row)===canonicalLocusName(selected)):null;return {...locus,...(reference?.stockReference?{stockReference:reference.stockReference}:{})};}
  const referencedScenario=(scenario=state.scenario)=>({...scenario,loci:scenario.loci.map(locus=>referencedLocus(locus))});
  const manualPrediction=()=>{const errors=namingErrors(state.scenario);if(errors.length)throw new Error(errors.join(' '));return state.commonFamilyCross?storedFamilyCross(referencedScenario()).result:checkedPrediction(state.scenario);};
  function strategyInput(scenario=state.scenario,founderCopies=state.founderCopies,wildTypeAvailable=state.wildTypeAvailable,timing=state.timing){
    const loci=scenario.loci.map(locus=>{if(targetCopies(locus,scenario)==='advanced')throw new Error('Choose heterozygous or homozygous for each target. Advanced allele combinations remain available in Manual cross.');const variant=targetVariant(locus,scenario);if(!locus.alleles.includes('+')||!variant)throw new Error('Target design needs a wild-type (+) and one variant allele at each locus. Use Manual cross for other alleles.');return {...referencedLocus(locus,variant),alleles:['+',variant]};});
    return {loci,targets:clone(scenario.targets),sex:scenario.sex,desiredCount:scenario.desiredCount,confidence:scenario.confidence,litterSize:scenario.litterSize,independentAssortment:scenario.independentAssortment,founders:{copiesByLocus:Object.fromEntries(loci.map(locus=>[locus.id,founderCopies[locus.id]??1])),wildTypeAvailable},timing:clone(timing)};
  }
  function quickPlan(preset,{calculate=false}={}){const scenario=presetScenario(preset),assumptions=presetAssumptions(preset),input=strategyInput(scenario,assumptions.founderCopies,assumptions.wildTypeAvailable,assumptions.timing);return {scenario,assumptions,input,...storedBreedingPlan(input,{calculate})};}
  function quickCopies(parent,preset){return preset.locusIds.map((id,index)=>{const call=parent?.calls?.[id],alleles=Array.isArray(call)?call:call?.alleles;return `${preset.codes[index]}${Array.isArray(alleles)?alleles.filter(allele=>allele!=='+').length:'?'}`;}).join(' ');}
  function quickPlansHTML(){
    const rows=popularBreedingPresets(state.catalogue).map(preset=>{
      const active=state.quickPlanId===preset.id,load=button('quick-plan',esc(preset.label),`data-preset="${preset.id}" aria-label="${active?'Deselect '+esc(preset.label)+' quick plan':'Load '+esc(preset.label)+' heterozygous default plan'}" aria-pressed="${active}"${preset.missing.length?' disabled':''}`);
      if(preset.missing.length)return `<tr><td>${load}</td><td colspan="5" class="muted">Requires ${esc(preset.missing.join(', '))}</td></tr>`;
      const {result}=quickPlan(preset),route=result?.routes?.find(row=>row.id===result.fastestRouteId)||result?.routes?.[0],final=route?.steps?.at(-1);
      return `<tr><td>${load}</td><td>${esc(preset.codes.map(code=>code+'1').join(' '))}</td><td>${final?`${esc(quickCopies(final.sire,preset))}<span class="muted"> × </span>${esc(quickCopies(final.dam,preset))}`:'Review assumptions'}</td><td>${route?pct(route.prediction?.targetProbability):'–'}</td><td>${route?esc(route.generations):'–'}</td><td>${route?.targetBirthDay==null?'–':weeks(route.targetBirthDay)}</td></tr>`;
    });
    return `<details class="panel planner-quick-plans" data-planner-quick-plans${state.quickPlansOpen?' open':''}><summary>Quick plans</summary><div class="table-scroll"><table><thead><tr><th>Family</th><th>Target copies</th><th>Virtual sire × dam</th><th>Final cross</th><th>Generations</th><th>Born</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><p class="small muted planner-quick-note">0 wild type · 1 heterozygous · 2 homozygous. Starting stocks: 1 copy. Targets and timing are editable. Conditional probabilities are per conception.</p></details>`;
  }
  function familyCrossesHTML(){const rows=commonFamilyCrosses(state.catalogue).map(cross=>{const title=esc(cross.sire.label+' × '+cross.dam.label);if(cross.missing.length)return `<tr><td>${title}</td><td colspan="4" class="muted">Requires ${esc(cross.missing.join(', '))}</td></tr>`;const {result,perLocus}=storedFamilyCross(referencedScenario(familyCrossScenario(cross)),{summary:true});return `<tr><td>${title}</td><td>${esc(cross.target.label)}</td><td>${perLocus.map((row,index)=>`${esc(cross.target.codes[index])} ${pct(row.probability)}`).join(' · ')}</td><td>${pct(result.targetProbability)}</td><td><div class="settings-actions">${button('family-cross','Load',`data-cross="${cross.id}" aria-label="Load ${title} in Manual cross"`)}${cross.sire.id!==cross.dam.id?button('family-cross','⇄',`data-cross="${cross.id}" data-reciprocal="true" aria-label="Load reciprocal ${esc(cross.dam.label+' × '+cross.sire.label)}"`):''}</div></td></tr>`;});return `<details class="panel planner-family-crosses"><summary>Common family crosses <span class="badge">6</span></summary><div class="table-scroll"><table><thead><tr><th>Virtual sire × dam</th><th>Target</th><th>Per-locus target</th><th>Conception</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div><p class="small muted planner-quick-note">Virtual parents: P/B/F heterozygous, AD hemizygous; target 1 variant copy. Independent assortment. Parent and target copies are editable in Manual cross.</p></details>`;}
  function virtualGenotype(parent){const calls=parent?.calls||{};return state.scenario.loci.map(locus=>{const value=calls[locus.id],alleles=Array.isArray(value)?value:value?.alleles;return `<span><b>${esc(designLocusName(locus))}</b> ${esc(alleles?.join(' / ')||'Unknown')}</span>`;}).join('');}
  function strategySources(sources){return Array.isArray(sources)?`<ul class="planner-source-links">${sources.flatMap(source=>{try{const url=new URL(source.url);return url.protocol==='https:'&&!url.username&&!url.password?[`<li><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(source.label||'Source')}</a></li>`]:[];}catch{return [];}}).join('')}</ul>`:'';}
  function lineageChart(route){
    const rows=(route.pedigree?.nodes||[]).filter(node=>node&&typeof node.id==='string').slice(0,64),groups=new Map(),positions=new Map(),boxWidth=216,gap=72,margin=18,top=35,lineHeight=14,boxHeight=43+state.scenario.loci.length*lineHeight;
    for(const node of rows){const generation=Number.isSafeInteger(node.generation)&&node.generation>=0&&node.generation<=12?node.generation:0;if(!groups.has(generation))groups.set(generation,[]);groups.get(generation).push(node);}
    const generations=[...groups.keys()].sort((a,b)=>a-b),maxRows=Math.max(1,...[...groups.values()].map(nodes=>nodes.length)),width=margin*2+generations.length*boxWidth+Math.max(0,generations.length-1)*gap,height=top+maxRows*(boxHeight+18),suffix=String(route.id).replace(/[^a-z0-9_-]/gi,'');
    for(const [column,generation]of generations.entries())for(const [row,node]of groups.get(generation).entries())positions.set(node.id,{x:margin+column*(boxWidth+gap),y:top+row*(boxHeight+18),node});
    const short=(value,max=29)=>{const text=String(value??'');return text.length>max?text.slice(0,max-1)+'…':text;};
    const edges=(route.pedigree?.edges||[]).filter(edge=>positions.has(edge.from)&&positions.has(edge.to)&&['sire','dam'].includes(edge.role)).map(edge=>{const a=positions.get(edge.from),b=positions.get(edge.to),offset=edge.role==='sire'?-7:7,x1=a.x+boxWidth,y1=a.y+boxHeight/2+offset,x2=b.x,y2=b.y+boxHeight/2+offset,mid=(x1+x2)/2;return `<path class="planner-lineage-edge is-${edge.role}" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" marker-end="url(#planner-lineage-${edge.role}-${suffix})"><title>${esc(edge.role==='sire'?'Sire selection':'Dam selection')}: ${esc(edge.from)} → ${esc(edge.to)}</title></path>`;}).join('');
    const nodes=[...positions.values()].map(({x,y,node})=>`<g class="planner-lineage-node" data-lineage-node="${esc(node.id)}"><title>${esc(node.label||node.id)} · Hypothetical genotype cohort</title><rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="7"/><text x="${x+10}" y="${y+17}" class="planner-lineage-label">${esc(short(node.label||node.id))}</text>${state.scenario.loci.map((locus,index)=>{const value=node.calls?.[locus.id],alleles=Array.isArray(value)?value:value?.alleles;return `<text x="${x+10}" y="${y+35+index*lineHeight}" class="planner-lineage-call"><title>${esc(designLocusName(locus))}: ${esc(alleles?.join(' / ')||'Unknown')}</title>${esc(short(designLocusName(locus),18))}: ${esc(short(alleles?.join(' / ')||'Unknown',16))}</text>`;}).join('')}</g>`).join('');
    return `<details class="planner-virtual-pedigree" open><summary>Virtual pedigree</summary><p class="small muted">Each box is a hypothetical genotype cohort. Sire and dam selections are distinct animals.</p><div class="planner-lineage-legend"><span class="is-sire">Sire</span><span class="is-dam">Dam</span></div><div class="planner-lineage-scroll"><svg class="planner-lineage-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Virtual breeding lineage, hypothetical genotype cohorts"><defs>${['sire','dam'].map(role=>`<marker id="planner-lineage-${role}-${suffix}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="planner-lineage-arrow is-${role}"/></marker>`).join('')}</defs>${generations.map((generation,column)=>`<text x="${margin+column*(boxWidth+gap)}" y="18" class="planner-lineage-generation">${generation===0?'Starting stocks':`G${generation}`}</text>`).join('')}${edges}${nodes}</svg></div></details>`;
  }
  function strategyHTML(){
    const strategy=state.strategy;if(!strategy)return '';if(strategy.errors?.length)return `<div class="planner-strategy-results">${list(strategy.criticalWarnings)}${list(strategy.errors,'error')}${strategySources(strategy.sources)}</div>`;
    const routes=strategy.routes||[],route=routes.find(item=>item.id===state.strategyRoute)||routes.find(item=>item.id===strategy.fastestRouteId)||routes[0],ideal=strategy.idealCrosses||[],chosen=ideal[Math.max(0,Math.min(ideal.length-1,state.idealIndex||0))],reciprocal=ideal.find(cross=>cross.id===chosen?.reciprocalId),visibleIdeal=[chosen,...(reciprocal&&reciprocal!==chosen?[reciprocal]:[])].filter(Boolean);
    return `<section class="planner-strategy-results" aria-live="polite">${list(strategy.criticalWarnings)}${strategy.warnings?.length?`<p class="small muted">${esc(strategy.warnings[0])}</p>`:''}<section class="panel"><div class="panel-head"><h3>Virtual parent pairs</h3>${ideal.length>1?`<select data-planner-field="strategy-ideal" aria-label="Virtual parent pair">${ideal.map((cross,index)=>option(String(index),`Pair ${index+1}${cross.reciprocalId?' · reciprocal available':''}`,String(state.idealIndex||0))).join('')}</select>`:'<span class="small muted">Suggested genotypes</span>'}</div><div class="panel-body planner-ideal-grid">${visibleIdeal.map(cross=>{const prediction=cross.prediction||{};return `<article class="planner-ideal-pair"><div><strong>Virtual sire</strong><div class="planner-virtual-genotype">${virtualGenotype(cross.sire)}</div></div><div><strong>Virtual dam</strong><div class="planner-virtual-genotype">${virtualGenotype(cross.dam)}</div></div><div class="planner-ideal-summary"><b>${pct(prediction.targetProbability)}</b> target · ${number(prediction.expectedConceptions??prediction.expectedPups)} conceptions, mean</div>${button('use-ideal','Load in Manual cross',`data-index="${ideal.indexOf(cross)}"`)}</article>`;}).join('')}</div></section>${route?`<section class="panel"><div class="panel-head"><h3>Breeding route</h3>${routes.length>1?`<select data-planner-field="strategy-route" aria-label="Breeding route">${routes.map(item=>option(item.id,item.label||item.id,route.id)).join('')}</select>`:''}</div><div class="panel-body"><div class="planner-strategy-stats"><div><span>Generations</span><strong>${esc(route.generations)}</strong></div><div><span>Modeled birth</span><strong>${route.targetBirthDay==null?'Not estimated':weeks(route.targetBirthDay)}</strong></div><div><span>Modeled weaning</span><strong>${strategy.targetAdultViable===false?'No viable adult route':route.targetWeanDay==null?'Not estimated':weeks(route.targetWeanDay)}</strong></div><div><span>Final cross target</span><strong>${pct(route.prediction?.targetProbability)}</strong></div></div><div class="table-scroll"><table class="planner-route-table"><thead><tr><th>Generation</th><th>Virtual sire</th><th>Virtual dam</th><th>Select offspring</th><th>Probability</th><th>Born / weaned</th></tr></thead><tbody>${(route.steps||[]).map(step=>`<tr><td>${esc(step.label||`G${step.generation}`)}${step.crossType?`<div class="small muted">${esc({founder_cross:'Founder cross',backcross:'Backcross',intercross:'Intercross',intermediate_cross:'Intermediate cross'}[step.crossType]||'')}</div>`:''}</td><td><span class="small muted">${esc(step.sireId)}</span><div class="planner-virtual-genotype">${virtualGenotype(step.sire)}</div></td><td><span class="small muted">${esc(step.damId)}</span><div class="planner-virtual-genotype">${virtualGenotype(step.dam)}</div></td><td><span class="small muted">${esc(step.id)}</span><div class="planner-virtual-genotype">${virtualGenotype(step.offspring)}</div></td><td>${pct(step.genotypeProbability??step.probability)}</td><td>${weeks(step.birthDay)} / ${weeks(step.weanDay)}</td></tr>`).join('')}</tbody></table></div>${route.generations>1&&route.pedigree?lineageChart(route):''}<p class="small muted">Conditional timing if viable. Genotyping, fertility and breeder availability can add time. Conception genotypes do not predict liveborn yield.</p></div></section>`:''}<details class="compact-details"><summary>Assumptions &amp; sources</summary>${list(strategy.assumptions,'')} ${strategy.warnings?.length>1?list(strategy.warnings.slice(1)):''}${strategySources(strategy.sources)}</details></section>`;
  }
  function designHTML(){return `${quickPlansHTML()}${familyCrossesHTML()}${targetBoard()}${catalogue()}${planningInputs()}${designAssumptions()}<div class="settings-actions">${button('design',state.busy?'Preparing route…':'Design breeding route','', 'primary')}${button('manual','Manual cross')}</div>${strategyHTML()}`;}

  function resultHTML() {
    const result=state.result;if(!result)return '';
    if(result.errors.length)return list(result.errors,'error');
    const visible=result.outcomes.slice(0,64),guarded=state.commonFamilyCross?referencedScenario():null,canUse=(outcome,role)=>!guarded||!familyCrossGuidance({...guarded,[role]:{sex:role==='sire'?'Male':'Female',calls:Object.fromEntries(Object.entries(outcome.calls).map(([id,alleles])=>[id,{alleles,evidence:'inferred'}]))}}).errors.length;
    return `<section class="planner-results" aria-live="polite"><div class="planner-stats">${[['Target probability',pct(result.targetProbability)],['Expected pups, mean',number(result.expectedPups)],[`${pct(state.scenario.confidence)} confidence pups`,number(result.confidencePups)],['Nominal litters, mean / confidence',`${number(result.expectedLitters)} / ${number(result.confidenceLitters)}`]].map(([label,value])=>`<div class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div><p class="small muted">Counts are planning estimates. Litter estimates use the nominal size above. ${state.scenario.sex!=='Any'?`Total target probability includes a 1/2 ${esc(state.scenario.sex.toLowerCase())} factor.`:''}</p>${result.warnings.length?`<p class="small muted">Conditional estimate; review unconfirmed calls and assumptions.</p><details class="compact-details"><summary>Review assumptions (${result.warnings.length})</summary>${list(result.warnings)}</details>`:''}<section class="panel"><div class="panel-head"><h3>Genotype outcomes</h3><span class="small muted">Showing ${visible.length} of ${result.outcomeCount}</span></div><div class="table-scroll"><table><thead><tr>${state.scenario.loci.map(locus=>`<th>${esc(canonicalLocusName(locus))}</th>`).join('')}<th>Probability</th><th>Genotype target</th><th>Next cross</th></tr></thead><tbody>${visible.map((outcome,index)=>`<tr data-outcome-row>${state.scenario.loci.map(locus=>`<td>${esc(outcome.calls[locus.id].join(' / '))}</td>`).join('')}<td>${pct(outcome.probability)}</td><td>${outcome.meetsTarget?'<span class="badge">Matches</span>':'Other'}</td><td><div class="settings-actions">${button('offspring','Use as sire',`data-role="sire" data-index="${index}"${canUse(outcome,'sire')?'':' disabled title="Excluded by the exact-stock breeder restriction"'}`)}${button('offspring','Use as dam',`data-role="dam" data-index="${index}"${canUse(outcome,'dam')?'':' disabled title="Excluded by the exact-stock breeder restriction"'}`)}</div></td></tr>`).join('')}</tbody></table></div></section><details class="compact-details"><summary>Calculation assumptions</summary>${list(result.assumptions)}</details></section>`;
  }
  function savePlanHTML() {
    return canEdit()?`<section class="panel"><div class="panel-body"><div class="field"><label for="planner-plan-name">Plan name</label><input id="planner-plan-name" maxlength="160" value="${esc(state.planName)}" data-planner-field="plan-name" placeholder="Name this cross"></div><div class="settings-actions">${button('save-plan',api().isCloud?.()?'Save plan to colony':'Save plan locally','', 'primary')}</div></div></section>`:'';
  }
  function crossHTML() {
    const advice=state.commonFamilyCross?familyCrossGuidance(referencedScenario()):{errors:[],warnings:[]};
    return `${state.loadedPlan?`<p class="banner">Recalculated from saved parent-genotype snapshots: ${esc(state.loadedPlan)}. Reselect parents to use their current reviewed profiles.</p>`:''}${catalogue()}${list(advice.warnings)}${!state.result?list(advice.errors,'error'):''}<div class="planner-parent-grid">${parentSelect('sire')}${parentSelect('dam')}</div><div class="planner-loci">${state.scenario.loci.map(locusEditor).join('')}</div><div class="settings-actions">${button('add-locus','Add custom locus',state.scenario.loci.length>=6?'disabled':'')}</div>${planningInputs()}<div class="settings-actions">${button('calculate','Calculate cross','', 'primary')}</div>${resultHTML()}${savePlanHTML()}`;
  }
  function animalSummary(id,sex) {
    const record=mouse(id);if(!record)return esc(id);
    const dob=record.date_of_birth,now=new Date(),born=dob?new Date(`${String(dob).slice(0,10)}T00:00:00`):null;
    const age=born&&Number.isFinite(+born)&&now>=born?`${Math.floor((now-born)/604800000)} weeks`:null;
    const matings=(data().tables?.matings||[]).filter(row=>!archived(row)&&String(row.state||row.status).toLowerCase()==='active'&&[...(row.male_sids||[]),...(row.female_sids||[])].includes(id));
    return `${button('open-mouse',esc((record.physical_tag||record.mouse_tag)?`${id} · ${record.physical_tag||record.mouse_tag}`:id),`data-id="${esc(id)}"`)}<div class="small">${esc(sex)} · DOB ${esc(dob||'unknown')}${age?' · '+age:''}</div><div class="small muted">${matings.length?'Active mating: '+esc(matings.map(row=>row.mating_sid).join(', ')):'No active mating recorded'}</div>`;
  }
  function relationship(sireId,damId) {
    const sire=mouse(sireId),dam=mouse(damId),sireParents=ids(sire),damParents=ids(dam),shared=sireParents.filter(id=>damParents.includes(id));
    const direct=sireParents.includes(damId)||damParents.includes(sireId),uncertain=[sire,dam].some(record=>(record?.sire_sids?.length||0)>1||(record?.dam_sids?.length||0)>1);
    const descriptions=[];if(direct)descriptions.push('Recorded parent–offspring relationship');if(shared.length)descriptions.push(`Shared recorded parent: ${shared.join(', ')}`);
    if(uncertain)descriptions.push('Parent fields contain alternatives; relationship may be uncertain');
    const coverage=[sire,dam].every(record=>Array.isArray(record?.sire_sids)&&record.sire_sids.length&&Array.isArray(record?.dam_sids)&&record.dam_sids.length);
    return descriptions.length?`<span class="badge amber">Pedigree review</span><div class="small">${esc(descriptions.join('. '))}</div>`:`<span class="small muted">${coverage?'No direct/shared parent link found':'Parentage incomplete; relatedness unknown'}</span>`;
  }
  function candidatesHTML() {
    if(genotypeDeferred())return genotypeGate();
    const ranking=state.ranking,stock=mice().filter(row=>row.state==='Stock'&&!archived(row));
    return `<section class="panel"><div class="panel-body"><h2>Colony candidates</h2><p class="small muted">${stock.length} active Stock animals. Only confirmed calls at every configured locus enter the ranking. Targets and assumptions come from Cross planner.</p><div class="field"><label for="planner-candidate-search">Narrow candidates by ID, tag, line or source genotype</label><input id="planner-candidate-search" data-planner-field="candidate-search" value="${esc(state.candidateSearch)}" placeholder="Optional search"></div><div class="settings-actions">${button('rank','Compare candidate pairs','', 'primary')}</div></div></section>${ranking?`<div data-planner-ranking>${list(ranking.errors,'error')}${list(ranking.warnings)}<section class="panel"><div class="panel-head"><h3>Highest expected target frequency</h3><span class="small muted">${ranking.pairs.length} eligible pairs</span></div><p class="small muted panel-body">Review age, pedigree, active matings and strain-specific constraints before choosing breeders.</p><div class="table-scroll"><table><thead><tr><th>Sire</th><th>Dam</th><th>Target / confidence pups</th><th>Pedigree</th><th></th></tr></thead><tbody>${ranking.pairs.slice(0,100).map(pair=>`<tr><td>${animalSummary(pair.sireId,'Male')}</td><td>${animalSummary(pair.damId,'Female')}</td><td>${pct(pair.targetProbability)}<div class="small muted">${number(pair.confidencePups)} pups at ${pct(state.scenario.confidence)}</div></td><td>${relationship(pair.sireId,pair.damId)}</td><td>${button('use-pair','Plan this pair',`data-sire="${esc(pair.sireId)}" data-dam="${esc(pair.damId)}"`)}</td></tr>`).join('')||'<tr><td colspan="5">No eligible pairs.</td></tr>'}</tbody></table></div>${ranking.pairs.length>100?'<p class="small muted panel-body">Showing the first 100 pairs. Narrow the search to compare fewer animals.</p>':''}</section><details class="panel"><summary>Excluded candidates (${ranking.excluded.length})</summary><div class="table-scroll"><table><thead><tr><th>Animal</th><th>Reason</th></tr></thead><tbody>${ranking.excluded.slice(0,100).map(row=>`<tr><td>${button('open-mouse',esc(row.id),`data-id="${esc(row.id)}"`)}</td><td>${esc(row.reason)}</td></tr>`).join('')}</tbody></table></div>${ranking.excluded.length>100?'<p class="small muted panel-body">First 100 exclusions shown.</p>':''}</details></div>`:''}`;
  }
  function plansHTML() {
    const plans=(data().tables?.husbandry_events||[]).filter(row=>!archived(row)&&row.event_type==='breeding_plan'&&row.breeding_plan).sort((a,b)=>String(b.event_date).localeCompare(String(a.event_date)));
    return `<section class="panel"><div class="panel-head"><h2>Saved plans</h2><span class="badge">${plans.length}</span></div><p class="small muted panel-body">Loading recalculates recorded parent-genotype snapshots, which may differ from current profiles. Reselect parents deliberately to refresh their calls. Plans do not create matings or offspring.</p><div class="table-scroll"><table><thead><tr><th>Plan</th><th>Saved</th><th>Parents</th><th></th></tr></thead><tbody>${plans.map(row=>`<tr><td>${esc(row.breeding_plan.name||row.notes)}</td><td>${esc(row.event_date)}</td><td>${esc(row.breeding_plan.scenario?.sire?.id||'Hypothetical sire')} × ${esc(row.breeding_plan.scenario?.dam?.id||'Hypothetical dam')}</td><td>${button('load-plan','Load and recalculate',`data-id="${esc(row.event_id)}"`)}</td></tr>`).join('')||'<tr><td colspan="4">No saved plans.</td></tr>'}</tbody></table></div></section>`;
  }
  function genotypesHTML() {
    if(genotypeDeferred())return genotypeGate();
    const record=mouse(state.profileId),locked=!canEdit()||archived(record);
    return `${catalogue()}<section class="panel"><div class="panel-body"><div class="field"><label for="planner-profile-mouse">Mouse</label><select id="planner-profile-mouse" data-planner-field="profile-mouse">${option('','Choose a mouse',state.profileId)}${mice().map(row=>option(row.mouse_sid,`${row.mouse_sid}${(row.physical_tag||row.mouse_tag)?' · '+(row.physical_tag||row.mouse_tag):''} · ${row.sex||'Unknown'}`,state.profileId)).join('')}</select></div>${record?`<p><strong>Source genotype:</strong> ${esc(record.genotype||'Unknown')}</p><p class="small muted">Review the loci configured in Cross planner. Missing calls stay unknown. The source genotype text is preserved.</p><div class="settings-actions">${!locked?button('source-profile','Use source suggestions'):''}${button('open-mouse','View mouse',`data-id="${esc(record.mouse_sid)}"`)}</div>${state.scenario.loci.length?`<div class="planner-loci">${state.scenario.loci.map(locus=>`<section class="planner-locus"><h3>${esc(canonicalLocusName(locus))}</h3>${callEditor(locus,'profile','profile',locked)}</section>`).join('')}</div>`:'<p class="muted">Add loci in Cross planner before reviewing calls.</p>'}<div class="field"><label for="planner-profile-notes">Genotype notes</label><textarea id="planner-profile-notes" data-planner-field="profile-notes"${locked?' readonly':''}>${esc(state.profileNotes)}</textarea></div>${!locked?`<div class="settings-actions">${button('save-profile',api().isCloud?.()?'Save reviewed genotypes to colony':'Save reviewed genotypes locally','', 'primary')}</div>`:'<p class="small muted">Read only</p>'}`:'<p class="muted">Choose an existing animal to review its structured allele calls.</p>'}</div></section>`;
  }
  function helpHTML() {
    return `<details class="panel planner-help"><summary>Planner help and scientific limits</summary><div class="panel-body"><p>This tool models diploid autosomal Mendelian segregation. Multiple loci require an explicit independent-assortment assumption; linked loci, sex-linked inheritance, copy number and recombination phase are not modeled. Keep alternative alleles at the same insertion locus together.</p><p>Source suggestions and hypothetical offspring remain inferred until reviewed. Genotype does not establish Cre recombination, reporter expression, viability, fertility or experimental suitability. Expected pups are a mean; confidence counts use a binomial model. Litter estimates use a nominal size and do not predict pregnancies or timing.</p><p>Calculating and loading plans changes no animals. Saving reviewed genotypes updates only the structured profile; saving a plan creates a planning record.</p><p><a href="https://resources.jax.org/husbandry/strategies-for-creating-complex-breeding-schemes" target="_blank" rel="noopener noreferrer">JAX: complex breeding schemes</a> · <a href="https://www.jax.org/news-and-insights/jax-blog/2012/november/breeding-strategies-for-tissue-specific-knockout-mice" target="_blank" rel="noopener noreferrer">JAX: Cre-lox breeding considerations</a></p></div></details>`;
  }
  function paint() {
    const previousQuickPlans=container.querySelector?.('[data-planner-quick-plans]');if(previousQuickPlans)state.quickPlansOpen=previousQuickPlans.open;
    const tabs=[['design','Target designer'],['cross','Manual cross'],['candidates','Colony candidates'],['plans','Saved plans'],['genotypes','Genotypes']];
    container.innerHTML=`<div class="breeding-planner"${state.busy||state.historyLoading?' aria-busy="true"':''}><div class="planner-tabs archive-tabs" role="tablist" aria-label="Planning">${tabs.map(([value,label])=>`<button type="button" role="tab" aria-selected="${state.tab===value}" class="${state.tab===value?'active':''}" data-planner-action="tab" data-tab="${value}">${label}</button>`).join('')}</div>${list(state.error?[state.error]:[],'error')}${state.notice?`<p class="banner" role="status">${esc(state.notice)}</p>`:''}${list(state.sourceWarnings)}${state.genotypeLoading?'<p class="small muted" role="status">Loading genotypes…</p>':''}${state.illustrative?'<p class="banner">Illustrative example · no colony parents assumed. Choose colony loci before recording real genotype calls.</p>':''}<div role="tabpanel">${({design:designHTML,cross:crossHTML,candidates:candidatesHTML,plans:plansHTML,genotypes:genotypesHTML}[state.tab]||designHTML)()}</div>${helpHTML()}</div>`;
    const quickPlansElement=container.querySelector?.('[data-planner-quick-plans]');if(quickPlansElement)quickPlansElement.ontoggle=event=>{if(container.querySelector?.('[data-planner-quick-plans]')===quickPlansElement)state.quickPlansOpen=event.target.open};
    const catalogueElement=container.querySelector?.('[data-planner-catalogue]');if(catalogueElement)catalogueElement.ontoggle=event=>{state.catalogueOpen=event.target.open};
    if(state.busy||state.historyLoading)container.querySelectorAll?.('button,input,select,textarea').forEach(node=>node.disabled=true);
  }
  function selectParent(role,id) {
    const record=mouse(id),parent={sex:role==='sire'?'Male':'Female',calls:{}};
    if(id)parent.id=id;
    for(const locus of state.scenario.loci)parent.calls[locus.id]=currentCalls(record,locus);
    state.scenario[role]=parent;state.illustrative=false;invalidate();
  }
  function addLocus(locus) {
    if(state.scenario.loci.length>=6)throw new Error('A cross supports at most six loci. Remove a locus first.');
    if(state.scenario.loci.some(row=>row.id===locus.id))throw new Error('That locus is already in this cross.');
    state.scenario.loci.push(locusFields(locus));const variant=locus.alleles.find(allele=>allele!=='+');state.scenario.targets[locus.id]=state.tab==='design'&&locus.alleles.includes('+')&&variant?{mode:'exact',alleles:['+',variant]}:{mode:'any'};
    for(const role of ['sire','dam'])state.scenario[role].calls[locus.id]=unknown();
    state.illustrative=false;invalidate();
  }
  function removeLocus(id) {
    state.scenario.loci=state.scenario.loci.filter(row=>row.id!==id);
    for(const role of ['sire','dam'])delete state.scenario[role].calls[id];
    delete state.scenario.targets[id];delete state.founderCopies[id];state.sourceWarnings=[];invalidate();
  }
  function applySuggestions(id,targetCalls) {
    const record=mouse(id);if(!record)throw new Error('Choose a mouse first.');
    const suggestion=sourceFor(record);
    let count=0;
    for(const locus of state.scenario.loci){const proposed=suggestion.calls?.[locus.id];if(proposed?.evidence==='inferred'&&targetCalls[locus.id]?.evidence!=='confirmed'){targetCalls[locus.id]={alleles:[...(proposed.alleles||[])],evidence:'inferred'};count++}}
    state.sourceWarnings=suggestion.warnings||[];state.notice=count?`${count} source suggestion(s) loaded as inferred. Review before saving; confirmed calls were retained.`:'No new explicit allele suggestions. Missing calls remain unknown.';
  }
  function review(type,record,id) {
    const check=api().validate(type,record,data(),id);if(check.errors?.length)throw new Error(check.errors.join(' '));return check;
  }
  async function persist(next,message) {
    state.busy=true;paint();
    try{const previous=data();await api().save(next);if(data()===previous)state.context.dataset=next;state.notice=message;api().toast?.(message);state.ranking=null}
    finally{state.busy=false}
  }
  async function saveProfile() {
    if(!canEdit())throw new Error('Edit access is required to save genotypes.');
    const original=mouse(state.profileId);if(!original||archived(original))throw new Error('Choose an active mouse record.');
    if(!state.scenario.loci.length)throw new Error('Add a locus before saving reviewed genotypes.');
    const record=clone(original),old=object(record.genetic_profile)?record.genetic_profile:{},loci=new Map((Array.isArray(old.loci)?old.loci:[]).filter(locus=>object(locus)&&typeof locus.id==='string').map(locus=>[locus.id,clone(locus)])),calls=object(old.calls)?clone(old.calls):{};
    for(const locus of state.scenario.loci){loci.set(locus.id,locusFields(locus));const value=clone(state.profileCalls[locus.id]||unknown());calls[locus.id]=value.evidence==='unknown'?{...value,alleles:value.alleles?.length===2&&value.alleles.every(Boolean)?value.alleles:[]}:value}
    const now=new Date().toISOString();record.genetic_profile={...old,schema_version:1,loci:[...loci.values()],calls,recorded_at:now,notes:state.profileNotes};record.app_modified_at=now;
    review('mice',record,record.mouse_sid);const next=clone(data());next.tables.mice[next.tables.mice.findIndex(row=>row.mouse_sid===record.mouse_sid)]=record;
    await persist(next,'Reviewed genotype profile saved.');
  }
  async function savePlan() {
    if(!canEdit())throw new Error('Edit access is required to save plans.');
    const checked=validateScenario(state.scenario);checked.errors.push(...namingErrors(state.scenario));if(checked.errors.length)throw new Error(checked.errors.join(' '));
    const name=state.planName.trim();if(!name||name.length>160)throw new Error('Enter a plan name of 1–160 characters.');
    const now=new Date().toISOString(),record={event_id:'PLAN-'+crypto.randomUUID(),event_type:'breeding_plan',event_date:localDate(),record_origin:'app_created',notes:name,app_created_at:now,app_modified_at:now,breeding_plan:{schema_version:1,name,scenario:clone(state.scenario),created_at:now}};
    review('husbandry_events',record,null);const next=clone(data());next.tables.husbandry_events??=[];next.tables.husbandry_events.push(record);await persist(next,'Breeding plan saved.');
  }
  function update(target,repaint) {
    const field=target.dataset?.plannerField;if(!field)return;
    const meta=target.dataset,value=target.value;
    if(field==='plan-name'){state.planName=value;return}
    if(field==='strategy-route'){state.strategyRoute=value;if(repaint)paint();return}
    if(field==='strategy-ideal'){state.idealIndex=Number(value);if(repaint)paint();return}
    if(field==='profile-notes'){if(canEdit())state.profileNotes=value;return}
    if(field==='candidate-search'){state.candidateSearch=value;state.ranking=null;container.querySelector?.('[data-planner-ranking]')?.remove();if(repaint)paint();return}
    if(field==='design-copies'){const locus=state.scenario.loci.find(row=>row.id===meta.locus);if(locus&&['heterozygous','homozygous'].includes(value))setDesignTarget(locus,targetVariant(locus),value)}
    else if(field==='design-allele'){const locus=state.scenario.loci.find(row=>row.id===meta.locus);if(locus)setDesignTarget(locus,value,targetCopies(locus)==='homozygous'?'homozygous':'heterozygous')}
    else if(field==='founder-wildtype'){state.wildTypeAvailable=Boolean(target.checked);invalidate()}
    else if(field==='founder-copies'){state.founderCopies[meta.locus]=Number(value);invalidate()}
    else if(field==='design-timing'){state.timing[meta.key]=Number(value);invalidate()}
    else if(field==='parent'){selectParent(meta.role,value);state.sourceWarnings=[]}
    else if(field==='profile-mouse'){loadProfile(value);state.error='';state.notice=''}
    else if(field==='independent'){state.scenario.independentAssortment=Boolean(target.checked);invalidate()}
    else if(field==='config'){state.scenario[meta.key]=meta.key==='sex'?value:Number(value);invalidate()}
    else if(field==='locus'){
      const locus=state.scenario.loci.find(row=>row.id===meta.locus);if(!locus)return;
      const next=meta.key==='alleles'?value.split(',').map(allele=>allele.trim()).filter(Boolean):value;
      if(JSON.stringify(locus[meta.key])!==JSON.stringify(next)){
        locus[meta.key]=next;for(const role of ['sire','dam']){state.scenario[role].calls[locus.id]=unknown();delete state.scenario[role].id}state.profileCalls[locus.id]=unknown();
        state.illustrative=false;invalidate();state.notice='Locus definition changed. Review its parent calls and genotype evidence again.';
      }
    } else if(field==='call'){
      if(meta.mode==='profile'&&!canEdit())return;
      const calls=meta.mode==='profile'?state.profileCalls:state.scenario[meta.role].calls,current=calls[meta.locus]||(calls[meta.locus]=unknown());
      if(meta.index==='evidence')current.evidence=value;else{const alleles=[current.alleles?.[0]||'',current.alleles?.[1]||''];if(alleles[Number(meta.index)]!==value&&current.evidence==='confirmed')current.evidence='inferred';alleles[Number(meta.index)]=value;current.alleles=alleles}
      if(meta.mode!=='profile'){const selectedId=state.scenario[meta.role].id;delete state.scenario[meta.role].id;invalidate();state.illustrative=false;if(selectedId)state.notice=`Edited calls are now a hypothetical ${meta.role}; ${selectedId}'s stored genotype is unchanged.`}else{state.error='';state.notice=''}
    } else if(field==='target'){
      const current=state.scenario.targets[meta.locus]||(state.scenario.targets[meta.locus]={mode:'any'});
      if(meta.key==='mode')state.scenario.targets[meta.locus]=value==='carrier'?{mode:value,allele:''}:value==='exact'?{mode:value,alleles:['','']}:{mode:'any'};
      else if(meta.key==='alleles'){current.alleles??=['',''];current.alleles[Number(meta.index)]=value}else current.allele=value;
      invalidate();
    }
    if(repaint)paint();
  }
  container.oninput=event=>{if(state.busy||state.historyLoading)return;const field=event.target.dataset?.plannerField,key=event.target.dataset?.key;if(['parent','profile-mouse','independent','call','target','design-copies','design-allele','founder-copies','founder-wildtype','strategy-route','strategy-ideal'].includes(field)||(field==='config'&&['sex','confidence'].includes(key))||(field==='locus'&&['kind','chromosome'].includes(key)))return;update(event.target,false)};
  container.onchange=async event=>{if(state.busy||state.historyLoading)return;const hooks=api();try{const field=event.target.dataset?.plannerField;if(['parent','profile-mouse'].includes(field)&&event.target.value&&genotypeDeferred()&&!await loadGenotypeHistory())return;if(hooks.isCurrent?.()===false)return;update(event.target,true);}catch(error){if(hooks.isCurrent?.()===false)return;state.error=error?.message||'Review the selected target.';paint();}};
  container.onclick=async event=>{
    const target=event.target.closest('[data-planner-action]');if(!target||target.disabled||state.busy||state.historyLoading)return;
    const meta=target.dataset,action=meta.plannerAction,actionHooks=api();state.error='';state.notice='';
    try{
      if(['rank','source-parent','source-profile','save-profile','use-pair'].includes(action)&&genotypeDeferred()&&!await loadGenotypeHistory())return;
      if(action==='reload-history'){api().reloadPage?.();return;}
      else if(action==='load-source-history'){if(state.historyReloadRequired){api().reloadPage?.();return;}await loadSourceHistory();return;}
      else if(action==='tab'){if(['candidates','genotypes'].includes(meta.tab)&&genotypeDeferred()&&!await loadGenotypeHistory())return;state.tab=meta.tab;state.sourceWarnings=[]}
      else if(action==='load-genotypes'){await loadGenotypeHistory();return;}
      else if(action==='open-mouse'){api().openMouse?.(meta.id);return}
      else if(action==='calculate')state.result=manualPrediction();
      else if(action==='manual')state.tab='cross';
      else if(action==='family-cross'){const cross=commonFamilyCrosses(state.catalogue).find(row=>row.id===meta.cross);if(!cross||cross.missing.length)throw new Error('The required strains are not available in the current catalogue.');const scenario=familyCrossScenario(cross,{reciprocal:meta.reciprocal==='true'}),prediction=storedFamilyCross(referencedScenario(scenario)).result;invalidate();state.scenario=scenario;state.commonFamilyCross=true;state.result=prediction;state.tab='cross';state.illustrative=false;state.catalogueOpen=false;state.sourceWarnings=[];}
      else if(action==='quick-plan'){
        if(state.quickPlanId===meta.preset){invalidate();state.commonFamilyCross=false;state.catalogueOpen=true;state.sourceWarnings=[];}
        else{const preset=popularBreedingPresets(state.catalogue).find(row=>row.id===meta.preset);if(!preset||preset.missing.length)throw new Error('The required strains are not available in the current catalogue.');const plan=quickPlan(preset);if(!plan.result){plan.result=await designRoute(plan.input,{full:false});if(!plan.result)return;}invalidate();state.scenario=plan.scenario;state.commonFamilyCross=false;Object.assign(state,plan.assumptions);state.strategy=plan.result;state.strategyRoute=plan.result.fastestRouteId||'';state.idealIndex=0;state.quickPlanId=preset.id;state.tab='design';state.illustrative=false;state.catalogueOpen=false;state.sourceWarnings=[];}
      }
      else if(action==='design'){if(namingErrors(state.scenario).length)throw new Error(namingErrors(state.scenario).join(' '));const result=await designRoute(strategyInput(),{full:false});if(!result)return;state.strategy=result;state.idealIndex=0;state.strategyRoute=state.strategy.fastestRouteId||'';}
      else if(action==='use-ideal'){const cross=state.strategy?.idealCrosses?.[Number(meta.index)];if(!cross)throw new Error('Design the breeding route again.');const parents=Object.fromEntries(['sire','dam'].map(role=>[role,{sex:role==='sire'?'Male':'Female',calls:clone(cross[role].calls)}]));invalidate();Object.assign(state.scenario,parents);if(state.scenario.loci.length>1)state.scenario.independentAssortment=true;state.tab='cross';state.illustrative=false;state.commonFamilyCross=false;state.result=checkedPrediction(state.scenario);state.notice='Virtual parent genotypes loaded. No colony animal was selected or changed.';}
      else if(action==='add-locus')addLocus({id:'locus-'+crypto.randomUUID(),name:'New locus',kind:'other',chromosome:'unknown',alleles:['+','variant']});
      else if(action==='target-copy'){
        if(!['design','cross'].includes(state.tab)||!['0','1'].includes(meta.copy))throw new Error('Choose a target allele.');
        const source=state.catalogue.find(row=>row.id===meta.locus),entry=source&&(meta.allele?catalogueStrains([source]).find(row=>row.allele===meta.allele):source);
        if(!entry)throw new Error('Choose a strain present in the source catalogue.');
        const current=state.scenario.loci.find(row=>row.id===source.id),locus=current||source,variant=entry.allele||targetVariant(locus),pair=targetPair(locus),copy=Number(meta.copy),active=pair[copy]===variant;
        if(!active&&entry.reviewRequired)throw new Error(entry.reviewWarning||'Review the strain definition first.');
        if(!locus.alleles.includes('+')||!variant||variant==='+'||!locus.alleles.includes(variant))throw new Error('Review the declared target alleles in Manual cross.');
        pair[copy]=active?'+':variant;
        if(pair.every(allele=>allele==='+'))removeLocus(locus.id);
        else{if(!current)addLocus(source);state.scenario.targets[locus.id]={mode:'exact',alleles:pair};state.illustrative=false;invalidate();}
        state.commonFamilyCross=false;
      }
      else if(action==='catalogue-locus'){
        const locus=state.catalogue.find(row=>row.id===meta.locus);
        if(locus){
          const entry=meta.allele?catalogueStrains([locus]).find(row=>row.allele===meta.allele):locus;
          if(!entry)throw new Error('Choose a strain present in the source catalogue.');
          if(catalogueAdded(entry))removeLocus(locus.id);
          else{
            if(locus.reviewRequired)throw new Error(locus.reviewWarning);
            if(!state.scenario.loci.some(row=>row.id===locus.id))addLocus(locus);
            if(meta.allele){const selected=state.scenario.loci.find(row=>row.id===locus.id);if(!selected?.alleles.includes(meta.allele))throw new Error('Review the saved Rosa26 allele definition before selecting this strain.');state.scenario.targets[locus.id]=state.tab==='design'?{mode:'exact',alleles:['+',meta.allele]}:{mode:'carrier',allele:meta.allele};invalidate();state.notice=state.tab==='design'?`${meta.allele} selected.`:`${meta.allele} selected. Ai32 and Ai96 are separate strains at one Rosa26 locus. To target both, choose Exact genotype: Ai32 / Ai96.`;}
          }
        }
      }
      else if(action==='remove-locus')removeLocus(meta.locus);
      else if(action==='clear-loci'){state.scenario.loci=[];state.scenario.targets={};for(const role of ['sire','dam'])state.scenario[role].calls={};state.illustrative=false;invalidate()}
      else if(action==='example'){state.scenario=exampleScenario();if(state.tab==='design')state.scenario.targets=Object.fromEntries(state.scenario.loci.map(locus=>[locus.id,{mode:'exact',alleles:['+',locus.alleles[1]]}]));state.illustrative=true;state.sourceWarnings=[];invalidate()}
      else if(action==='negative-control'){const locus=state.scenario.loci.find(row=>row.id===meta.locus);if(locus?.kind==='cre'&&locus.alleles.includes('+')){state.scenario.targets[locus.id]={mode:'exact',alleles:['+','+']};invalidate()}}
      else if(action==='source-parent'){invalidate();applySuggestions(state.scenario[meta.role].id,state.scenario[meta.role].calls)}
      else if(action==='source-profile'){if(!canEdit())throw new Error('Edit access is required to review genotypes.');applySuggestions(state.profileId,state.profileCalls)}
      else if(action==='save-profile')await saveProfile();
      else if(action==='save-plan')await savePlan();
      else if(action==='load-plan'){
        const plan=(data().tables?.husbandry_events||[]).find(row=>row.event_id===meta.id&&!archived(row))?.breeding_plan;if(!plan)throw new Error('Saved plan is unavailable.');
        const checked=validateScenario(plan.scenario);if(checked.errors.length)throw new Error('Saved scenario needs review: '+checked.errors.join(' '));
        state.scenario=clone(plan.scenario);state.planName=plan.name;state.loadedPlan=plan.name;state.illustrative=false;state.result=null;state.ranking=null;state.tab='cross';state.sourceWarnings=[];state.result=checkedPrediction(state.scenario);
      } else if(action==='rank'){
        if(namingErrors(state.scenario).length)throw new Error(namingErrors(state.scenario).join(' '));
        const query=state.candidateSearch.trim().toLowerCase(),candidates=mice().filter(row=>row.state==='Stock'&&!archived(row)&&(!query||[row.mouse_sid,row.mouse_tag,row.physical_tag,row.mouseline,row.line,row.genotype].some(value=>String(value||'').toLowerCase().includes(query))));
        const reasons=new Map();state.ranking=rankPairs(state.scenario,candidates.map(row=>{const calls={};for(const locus of state.scenario.loci){const checked=reviewedCall(row,locus);calls[locus.id]=checked.call;if(checked.reason)reasons.set(row.mouse_sid,[...(reasons.get(row.mouse_sid)||[]),checked.reason])}return {id:row.mouse_sid,sex:row.sex,calls,record:row}}));
        for(const excluded of state.ranking.excluded)if(reasons.has(excluded.id))excluded.reason=reasons.get(excluded.id).join(' ')+ ' '+excluded.reason;
      } else if(action==='use-pair'){if(!state.ranking?.pairs.some(pair=>pair.sireId===meta.sire&&pair.damId===meta.dam))throw new Error('Compare candidates again before selecting this pair.');selectParent('sire',meta.sire);selectParent('dam',meta.dam);state.tab='cross';state.result=checkedPrediction(state.scenario)}
      else if(action==='offspring'){
        const outcome=state.result?.outcomes[Number(meta.index)];if(!outcome)return;
        const parent={sex:meta.role==='sire'?'Male':'Female',calls:Object.fromEntries(Object.entries(outcome.calls).map(([id,alleles])=>[id,{alleles:[...alleles],evidence:'inferred'}]))};if(state.commonFamilyCross){const advice=familyCrossGuidance({...referencedScenario(),[meta.role]:parent});if(advice.errors.length)throw new Error(advice.errors.join(' '));}
        state.scenario[meta.role]=parent;
        invalidate();state.illustrative=false;state.notice=`Hypothetical offspring loaded as ${meta.role}. Calls remain inferred; no animal was created.`;
      }
    }catch(error){if(actionHooks.isCurrent?.()===false)return;state.historyReloadRequired=error.historyReloadRequired===true;state.error=state.historyReloadRequired?'Source history changed. Reload page.':error?.message||'The action could not be completed.';api().toast?.(state.error,true)}
    if(actionHooks.isCurrent?.()!==false)paint();
  };
  state.repaint=paint;
  paint();
}
