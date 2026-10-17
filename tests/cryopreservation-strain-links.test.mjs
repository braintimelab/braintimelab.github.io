import test from 'node:test';
import assert from 'node:assert/strict';
import { cryoStrainLinksHTML, renderCryopreservation } from '../mouse-data/cryopreservation.js';
import { discoverCryoSources } from '../mouse-data/cryo-sources.js';

const lot=()=>({event_id:'SYNTHETIC-CRYO',event_type:'cryopreservation_lot',cryopreservation:{label:'Synthetic lot',case_id:'SYNTHETIC-CASE',strain:'Composite cross',gene:'Per2tm1Jt;Arntltm1Weit',background:'Unchanged background',batch_ids:['TEST-BATCH'],status:'unreviewed',material:'unknown',quantity:null,quantity_unit:'straws',storage_location:{},donor_mouse_sids:[]}});
const sourceIndex=()=>({sources:[{title:'Synthetic archive',file_id:'SYNTHETIC',snapshot_date:'2025-01-01'}],sheets:[{title:'Cryopreservation',source_index:0}],cells:[[0,'A1','Case ID'],[0,'B1','Strain'],[0,'C1','Batch IDs'],[0,'A2','SYNTHETIC-SOURCE'],[0,'B2','Ai96'],[0,'C2','TEST-BATCH-2']]});

test('compact strain links use explicit genetics and accessible canonical labels',()=>{
 const html=cryoStrainLinksHTML({strain:'Composite cross',gene:'Per2tm1Jt;Arntltm1Weit'});
 assert.match(html,/href="#strains\/P" aria-label="Open PER2::LUC in Strains">P<\/a>/);assert.match(html,/href="#strains\/B" aria-label="Open Bmal1-flox in Strains">B<\/a>/);assert.match(html,/aria-hidden="true">·/);
 for(const record of [{strain:'PB'}, {strain:'Unknown',origin:'PER2::LUC'}, {strain:'Gt(ROSA)26Sor'}, {strain:'<script>untrusted</script>'}])assert.equal(cryoStrainLinksHTML(record),'');
 assert.doesNotMatch(html,/<script>|data-cryo-action/);
});

test('managed, source and detail views link to Strains without altering permissions or data',async()=>{
 const container={innerHTML:'',querySelectorAll:()=>[]},dataset={tables:{husbandry_events:[lot()],mice:[]}},before=structuredClone(dataset);let saves=0;
 renderCryopreservation(container,dataset,{historyIndex:sourceIndex(),canEdit:()=>false,save:async()=>{saves++}});
 assert.match(container.innerHTML,/href="#strains\/P"/);assert.match(container.innerHTML,/href="#strains\/B"/);assert.match(container.innerHTML,/href="#strains\/96"/);assert.doesNotMatch(container.innerHTML,/data-cryo-action="edit"|data-cryo-action="edit-source"/);
 await container.onclick({target:{closest:()=>({disabled:false,dataset:{cryoAction:'view',id:'SYNTHETIC-CRYO'}})}});
 assert.match(container.innerHTML,/<dd>Composite cross<div class="small cryo-strain-links"/);assert.deepEqual(dataset,before);assert.equal(saves,0);
});

const container=()=>({innerHTML:'',querySelectorAll:()=>[]});
const data=()=>({tables:{husbandry_events:[lot()],mice:[]}});
const click=async(node,action,id)=>node.onclick({target:{closest:()=>({disabled:false,dataset:{cryoAction:action,id}})}});

test('initial Cryo focus opens only the requested existing detail and consumes each request key once',async()=>{
 const node=container(),dataset=data(),hooks={canEdit:()=>false,historyDeferred:true,initialFocus:{id:'SYNTHETIC-CRYO',key:1}};
 renderCryopreservation(node,dataset,hooks);assert.match(node.innerHTML,/class="panel cryo-detail"/);assert.match(node.innerHTML,/<h2>Synthetic lot<\/h2>/);assert.doesNotMatch(node.innerHTML,/class="panel cryo-editor"/);
 await click(node,'close-detail');assert.doesNotMatch(node.innerHTML,/class="panel cryo-detail"/);renderCryopreservation(node,dataset,hooks);assert.doesNotMatch(node.innerHTML,/class="panel cryo-detail"/);
 hooks.initialFocus={id:'SYNTHETIC-CRYO',key:2};renderCryopreservation(node,dataset,hooks);assert.match(node.innerHTML,/class="panel cryo-detail"/);
});

test('invalid focus never selects another Cryo record or opens an editor',()=>{
 for(const initialFocus of [{id:'MISSING',key:'missing'},{id:'SYNTHETIC-CRYO'},{id:'SYNTHETIC-CRYO',key:''},{id:'SYNTHETIC-CRYO',key:NaN},{id:42,key:'invalid-id'}]){
  const node=container();renderCryopreservation(node,data(),{canEdit:()=>true,historyDeferred:true,initialFocus});assert.doesNotMatch(node.innerHTML,/class="panel cryo-detail"|class="panel cryo-editor"/);
 }
});

test('deferred source focus resolves after its exact source group becomes available',()=>{
 const node=container(),dataset=data(),historyIndex=sourceIndex();
 // Obtain the source-derived identifier from discovery, never by case-name guessing.
 const sourceId=discoverCryoSources(dataset,historyIndex).groups[0].id;
 const hooks={canEdit:()=>false,historyDeferred:true,initialFocus:{id:sourceId,key:'source-request'}};
 renderCryopreservation(node,dataset,hooks);assert.doesNotMatch(node.innerHTML,/class="panel cryo-detail"/);
 renderCryopreservation(node,dataset,{...hooks,historyDeferred:false,historyIndex});assert.match(node.innerHTML,/class="panel cryo-detail"/);assert.match(node.innerHTML,/<h2>SYNTHETIC-SOURCE<\/h2>/);
});

test('initial focus does not clear an existing unsaved Cryo editor',async()=>{
 const node=container(),dataset=data(),hooks={canEdit:()=>true,historyDeferred:true,draftContext:'same-account'};renderCryopreservation(node,dataset,hooks);await click(node,'edit','SYNTHETIC-CRYO');
 node.oninput({target:{tagName:'INPUT',value:'Unsent private note',dataset:{cryoField:'editor',key:'notes'}}});
 renderCryopreservation(node,dataset,{...hooks,initialFocus:{id:'SYNTHETIC-CRYO',key:'keep-draft'}});assert.match(node.innerHTML,/class="panel cryo-detail"/);assert.match(node.innerHTML,/class="panel cryo-editor"/);assert.match(node.innerHTML,/Unsent private note/);
});
