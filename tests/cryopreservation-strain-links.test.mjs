import test from 'node:test';
import assert from 'node:assert/strict';
import { cryoStrainLinksHTML, renderCryopreservation } from '../mouse-data/cryopreservation.js';

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
