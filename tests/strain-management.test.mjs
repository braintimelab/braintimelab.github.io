import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStrainManagement, hasStrainDrafts, clearStrainManagement } from '../mouse-data/strain-management.js';
import { buildStrainDefinition, getStrainRegistry } from '../mouse-data/strain-registry.js';

const empty=()=>({tables:{mice:[{mouse_sid:'SYNTHETIC-1'}],husbandry_events:[]}});
function harness(overrides={}) {
  const container={innerHTML:''},saves=[],messages=[];let dataset=empty();
  const hooks={canEdit:()=>true,saveDataset:async next=>{saves.push(structuredClone(next));dataset=next},reloadDataset:async()=>dataset,toast:(message,error=false)=>messages.push({message,error}),...overrides};
  renderStrainManagement(container,dataset,hooks);
  return {container,hooks,saves,messages,get dataset(){return dataset},
    field(code,field,value){container.oninput({target:{value,dataset:{strainCode:code,strainField:field}}})},
    async save(code){await container.onclick({target:{closest:()=>({disabled:false,dataset:{strainAction:'save',strainCode:code}})}})},
    render(next=dataset){dataset=next;renderStrainManagement(container,dataset,hooks)}
  };
}

test('edit persists through dataset reload and preserves other colony records',async()=>{
  const h=harness();assert.match(h.container.innerHTML,/Strain registry/);assert.match(h.container.innerHTML,/Save P/);
  h.field('P','insertion_type','unknown');h.field('P','stock_reference','Synthetic recheck');h.field('P','notes','Need confirmation');await h.save('P');
  assert.equal(h.saves.length,1);assert.deepEqual(h.dataset.tables.mice,[{mouse_sid:'SYNTHETIC-1'}]);
  assert.equal(getStrainRegistry(h.dataset)[0].insertionType,'unknown');assert.match(h.container.innerHTML,/P strain definition saved/);
  const reopened={innerHTML:''};renderStrainManagement(reopened,structuredClone(h.dataset),h.hooks);assert.match(reopened.innerHTML,/Synthetic recheck/);assert.match(reopened.innerHTML,/Need confirmation/);
});

test('read-only controls and forged save events cannot change the registry',async()=>{
  const h=harness({canEdit:()=>false});assert.match(h.container.innerHTML,/Read only/);assert.doesNotMatch(h.container.innerHTML,/<textarea|<select|data-strain-field|data-strain-action="save"/);
  h.field('P','notes','Unauthorized');await h.save('P');assert.equal(h.saves.length,0);assert.match(h.container.innerHTML,/Edit access is required/);
});

test('permission revocation during refresh blocks a save',async()=>{
  let editable=true;const h=harness({canEdit:()=>editable,reloadDataset:async()=>{editable=false;return empty()}});
  h.field('P','notes','Draft');await h.save('P');assert.equal(h.saves.length,0);assert.match(h.container.innerHTML,/Edit access is required/);
});

test('concurrent strain edits are rejected, while unrelated new data is retained',async()=>{
  const h=harness();h.field('P','notes','Local draft');
  const concurrent=buildStrainDefinition(empty(),{code:'P',insertion_type:'knock_in',stock_reference:'Concurrent stock',notes:'External edit'}).dataset;
  h.hooks.reloadDataset=async()=>concurrent;await h.save('P');assert.equal(h.saves.length,0);assert.match(h.container.innerHTML,/changed while you were editing/);assert.match(h.container.innerHTML,/Local draft/);
  const other=harness();other.field('P','notes','Safe draft');other.hooks.reloadDataset=async()=>({tables:{mice:[{mouse_sid:'SYNTHETIC-2'}],husbandry_events:[]}});await other.save('P');assert.equal(other.saves.length,1);assert.equal(other.saves[0].tables.mice[0].mouse_sid,'SYNTHETIC-2');
});

test('failed saves preserve drafts and escape untrusted stock and note text',async()=>{
  const h=harness({saveDataset:async()=>{throw new Error('<script>Network failed</script>')}});
  h.field('P','stock_reference','" onfocus="alert(1)');h.field('P','notes','</textarea><script>bad</script>');await h.save('P');
  assert.equal(h.saves.length,0);assert.match(h.container.innerHTML,/&lt;script&gt;Network failed&lt;\/script&gt;/);assert.match(h.container.innerHTML,/&lt;\/textarea&gt;&lt;script&gt;bad&lt;\/script&gt;/);assert.match(h.container.innerHTML,/&quot; onfocus=&quot;alert\(1\)/);assert.doesNotMatch(h.container.innerHTML,/<script>|aria-busy="true"/);
});

test('unknown fields cannot alter codes or canonical names and invalid insertion type is rejected',async()=>{
  const h=harness();h.field('P','name','Wrong');h.field('P','code','E');h.field('P','insertion_type','bogus');await h.save('P');assert.equal(h.saves.length,0);assert.match(h.container.innerHTML,/Choose Unknown, Transgenic or Knock-in/);
  h.field('P','insertion_type','knock_in');await h.save('P');assert.equal(h.saves.length,1);assert.equal(h.saves[0].tables.husbandry_events[0].strain_definition.name,'PER2::LUC');
});

test('genetic detail editor saves entered fields and escapes all displayed values',async()=>{
  const h=harness();h.field('P','promoter','<script>untrusted</script>');h.field('P','gene_symbol','Symbol');h.field('P','genotyping_notes','</textarea>Protocol');await h.save('P');
  assert.equal(h.saves[0].tables.husbandry_events[0].strain_definition.promoter,'<script>untrusted</script>');
  assert.match(h.container.innerHTML,/&lt;script&gt;untrusted&lt;\/script&gt;/);assert.match(h.container.innerHTML,/&lt;\/textarea&gt;Protocol/);assert.doesNotMatch(h.container.innerHTML,/<script>/);
  assert.match(h.container.innerHTML,/Promoter \/ regulatory sequence/);assert.match(h.container.innerHTML,/Strain details do not change individual mouse genotypes/);assert.equal(hasStrainDrafts(h.container),false);
});

test('strain selection and search keep drafts, and discard clears them without saving',async()=>{
  const h=harness();h.field('P','promoter','Local draft');assert.equal(hasStrainDrafts(h.container),true);
  const click=async(action,code)=>h.container.onclick({target:{closest:()=>({disabled:false,dataset:{strainAction:action,strainCode:code}})}});
  await click('select','F');assert.match(h.container.innerHTML,/FoxJ1-Cre details/);assert.match(h.container.innerHTML,/Save F/);
  await click('select','P');assert.match(h.container.innerHTML,/Local draft/);
  h.container.oninput({target:{value:'APP',dataset:{strainSearch:''}}});assert.match(h.container.innerHTML,/APP\/PS1/);assert.doesNotMatch(h.container.innerHTML,/class="strain-card-name">Vip-Cre/);
  await click('discard','P');assert.equal(hasStrainDrafts(h.container),false);assert.doesNotMatch(h.container.innerHTML,/Local draft/);assert.equal(h.saves.length,0);
});

test('unverified refresh preserves drafts and cannot save a stale dataset',async()=>{
  const h=harness({reloadDataset:async()=>null});h.field('P','promoter','Draft');await h.save('P');
  assert.equal(h.saves.length,0);assert.equal(hasStrainDrafts(h.container),true);assert.match(h.container.innerHTML,/Shared data could not be verified/);assert.match(h.container.innerHTML,/Draft/);
});

test('navigation or account clear during refresh prevents stale saves and paints',async()=>{
  let current=true,finish;
  const h=harness({isCurrent:()=>current,reloadDataset:()=>new Promise(resolve=>{finish=resolve})});
  h.field('P','notes','Draft');const saving=h.save('P');const before=h.container.innerHTML;current=false;finish(empty());await saving;
  assert.equal(h.saves.length,0);assert.equal(h.container.innerHTML,before);
  const other=harness();other.field('P','notes','Private draft');assert.equal(hasStrainDrafts(other.container),true);clearStrainManagement(other.container);assert.equal(hasStrainDrafts(other.container),false);assert.equal(other.container.onclick,null);
});

test('concurrent metadata-only edits are rejected and remain available for review',async()=>{
  const h=harness();h.field('P','promoter','Local promoter');h.hooks.reloadDataset=async()=>buildStrainDefinition(empty(),{code:'P',insertion_type:'knock_in',stock_reference:'',notes:'',promoter:'Other promoter'}).dataset;
  await h.save('P');assert.equal(h.saves.length,0);assert.match(h.container.innerHTML,/changed while you were editing/);assert.match(h.container.innerHTML,/Local promoter/);
});

test('linked Cryo details are read-only, escaped, and open the matching managed record',async()=>{
  let opened;const h=harness({openCryo:(id,details)=>{opened={id,details}}});
  const fresh=empty();fresh.tables.husbandry_events.push({event_id:'SYNTHETIC-CRYO',event_type:'cryopreservation_lot',cryopreservation:{case_id:'SYNTHETIC-CASE',strain:'PER2::LUC',gene:'Per2tm1Jt',background:'<script>Recorded background</script>',origin:'Recorded origin',batch_ids:['TEST-BATCH']}});h.render(fresh);
  assert.match(h.container.innerHTML,/Linked cryopreservation/);assert.match(h.container.innerHTML,/SYNTHETIC-CASE/);assert.match(h.container.innerHTML,/&lt;script&gt;Recorded background&lt;\/script&gt;/);assert.doesNotMatch(h.container.innerHTML,/<script>/);
  await h.container.onclick({target:{closest:()=>({disabled:false,dataset:{strainAction:'open-cryo',cryoId:'SYNTHETIC-CRYO'}})}});
  assert.deepEqual(opened,{id:'SYNTHETIC-CRYO',details:{kind:'managed',caseId:'SYNTHETIC-CASE'}});assert.equal(h.saves.length,0);
});

test('Cryo source history loads only on demand and preserves unsaved strain details',async()=>{
  let loads=0;const historyIndex={sources:[{title:'Synthetic archive',file_id:'SYNTHETIC',snapshot_date:'2025-01-01'}],sheets:[{title:'Cryopreservation',source_index:0}],cells:[[0,'A1','Case ID'],[0,'B1','Strain'],[0,'C1','Batch IDs'],[0,'A2','SYNTHETIC-SOURCE'],[0,'B2','PER2::LUC'],[0,'C2','TEST-BATCH']]};
  const h=harness({loadCryoHistory:async()=>{loads++;return {historyIndex,dataset:empty()}}});h.field('P','promoter','Keep my draft');
  assert.equal(loads,0);assert.match(h.container.innerHTML,/Load cryopreservation/);
  await h.container.onclick({target:{closest:()=>({disabled:false,dataset:{strainAction:'load-cryo'}})}});
  assert.equal(loads,1);assert.match(h.container.innerHTML,/SYNTHETIC-SOURCE/);assert.match(h.container.innerHTML,/Keep my draft/);assert.equal(hasStrainDrafts(h.container),true);assert.equal(h.saves.length,0);
});

test('failed Cryo load preserves edits and a stale load never repaints another page',async()=>{
  const h=harness({loadCryoHistory:async()=>{throw new Error('Unavailable')}});h.field('P','notes','Keep draft');await h.container.onclick({target:{closest:()=>({disabled:false,dataset:{strainAction:'load-cryo'}})}});assert.match(h.container.innerHTML,/Unavailable/);assert.match(h.container.innerHTML,/Keep draft/);assert.equal(h.saves.length,0);
  let current=true,finish;const other=harness({isCurrent:()=>current,loadCryoHistory:()=>new Promise(resolve=>{finish=resolve})});
  const loading=other.container.onclick({target:{closest:()=>({disabled:false,dataset:{strainAction:'load-cryo'}})}});const before=other.container.innerHTML;current=false;finish({historyIndex:{sources:[],sheets:[],cells:[]},dataset:empty()});await loading;assert.equal(other.container.innerHTML,before);
});

test('Strains deep links select a known code without replacing drafts on ordinary rerenders',async()=>{
 const h=harness({initialCode:'B'});assert.match(h.container.innerHTML,/Save B/);h.field('B','promoter','Keep linked draft');
 await h.container.onclick({target:{closest:()=>({disabled:false,dataset:{strainAction:'select',strainCode:'F'}})}});assert.match(h.container.innerHTML,/Save F/);h.render();assert.match(h.container.innerHTML,/Save F/);
 h.hooks.initialCode='P';h.render();assert.match(h.container.innerHTML,/Save P/);h.hooks.initialCode='B';h.render();assert.match(h.container.innerHTML,/Save B/);assert.match(h.container.innerHTML,/Keep linked draft/);assert.equal(h.saves.length,0);
 h.hooks.initialCode='__proto__';h.render();assert.match(h.container.innerHTML,/Save B/);
});
