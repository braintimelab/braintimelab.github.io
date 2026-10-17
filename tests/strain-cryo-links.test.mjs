import test from 'node:test';
import assert from 'node:assert/strict';
import { strainCodesForCryo, getStrainCryoLinks } from '../mouse-data/strain-cryo-links.js';
import { discoverCryoSources } from '../mouse-data/cryo-sources.js';

const lot=(id,strain,extra={})=>({event_id:id,event_type:'cryopreservation_lot',cryopreservation:{case_id:'SYNTHETIC-'+id,strain,background:'Recorded background',gene:'',origin:'Recorded origin',batch_ids:['TEST-BATCH'],...extra}});
const dataset=rows=>({tables:{husbandry_events:rows,mice:[{mouse_sid:'SYNTHETIC-MOUSE',physical_tag:'Unchanged'}]}});
const index=()=>({sources:[{file_id:'SYNTHETIC-SHEET',title:'Synthetic archive',url:'https://example.org/synthetic',snapshot_date:'2025-01-01'}],sheets:[{source_index:0,title:'Cryopreservation',sheet_id:0}],cells:[
 ['Case ID','Strain','Background','Modification method','Gene','Zygosity','Origin','Batch IDs','Remaining quantity'],
 ['SYNTHETIC-CASE','PER2::LUC','Raw cross background','Recorded method','Per2tm1Jt;Arntltm1Weit','heterozygous','Recorded origin','TEST-BATCH',2]
 ].flatMap((row,r)=>row.map((value,c)=>[0,String.fromCharCode(65+c)+(r+1),value]))});

test('complete confirmed line names and allele tokens link exactly',()=>{
 for(const [value,expected] of [
  ['Per2tm1Jt',['P']],['PER2::LUC',['P']],['B6.129S6-Per2tm1Jt/J',['P']],
  ['Arntltm1Weit',['B']],['Bmal1tm1Weit',['B']],['Bmal1-flox',['B']],
  ['Viptm1(cre)Zjh/J',['V']],['Vip-Cre',['V']],['Gt(ROSA)26Sortm96(CAG-GCaMP6s)Hze',['96']],
  ['Ai96',['96']],['Ai32',['32']],['Gad67-tTA',['Gt']],['Vgat flox',['Vg']],['FoxJ1-Cre',['F']],['FoxJ-Cre',['F']],
  ['Bmal1-ELuc',['E']],['B6.AD;',['AD']],['APP/PS1',['AD']]
 ])assert.deepEqual(strainCodesForCryo(value),expected,value);
});

test('composites may link multiple stocks but no single-letter or shared-gene match is guessed',()=>{
 assert.deepEqual(strainCodesForCryo({strain:'Composite cross',gene:'Per2tm1Jt;Arntltm1Weit'}),['P','B']);
 assert.deepEqual(strainCodesForCryo('PER2::LUC x Bmal1-flox x FoxJ1-Cre'),['P','B','F']);
 for(const value of ['P','PB','FB','V','Bmal1','Vip','Gt(ROSA)26Sor','FoxJ1-CreERT2','Vip-CreERT2','Ai960','NotAi96','Vgat-Cre'])assert.deepEqual(strainCodesForCryo(value),[],value);
 assert.deepEqual(strainCodesForCryo({strain:'Unknown',gene:'Unknown',origin:'PER2::LUC',notes:'Ai96'}),[]);
});

test('managed Cryo links preserve recorded details without changing stock or animal data',()=>{
 const original=dataset([lot('SYNTHETIC-LOT','PER2::LUC',{gene:'Per2tm1Jt',zygosity:'Raw zygosity'})]),before=structuredClone(original);
 const result=getStrainCryoLinks(original);
 assert.equal(result.sourceIndexAvailable,false);assert.equal(result.links.length,1);assert.equal(result.links[0].kind,'managed');assert.equal(result.links[0].background,'Recorded background');assert.equal(result.links[0].gene,'Per2tm1Jt');assert.equal(result.links[0].zygosity,'Raw zygosity');assert.deepEqual(result.links[0].codes,['P']);assert.deepEqual(original,before);
 assert.equal(original.tables.husbandry_events.some(row=>row.event_type==='strain_definition'),false);
});

test('source cases link by source identity, and a matching managed lot covers only its exact case group',()=>{
 const historyIndex=index(),source=discoverCryoSources(dataset([]),historyIndex).groups[0],managed={...lot('SYNTHETIC-MANAGED','PER2::LUC'),source_case_key:source.id};
 const sourceOnly=getStrainCryoLinks(dataset([]),{historyIndex});assert.equal(sourceOnly.sourceIndexAvailable,true);assert.equal(sourceOnly.links.length,1);assert.equal(sourceOnly.links[0].kind,'source');assert.deepEqual(sourceOnly.links[0].codes,['P','B']);assert.equal(sourceOnly.links[0].background,'Raw cross background');assert.match(sourceOnly.links[0].sourceUrls[0],/^https:\/\/example.org/);
 const covered=getStrainCryoLinks(dataset([managed]),{historyIndex});assert.equal(covered.links.length,1);assert.equal(covered.links[0].kind,'managed');
 const unrelated={...lot('SYNTHETIC-OTHER','PER2::LUC'),source_case_key:'other-source-case'};const both=getStrainCryoLinks(dataset([unrelated]),{historyIndex});assert.equal(both.links.length,2);
});

test('archived lots, transfer plans, partial excerpts and invalid records do not establish stock links',()=>{
 const input=dataset([{...lot('ARCHIVED','PER2::LUC'),app_archived_at:'2025-01-01'},{...lot('ARCHIVED-2','PER2::LUC'),archived:true},{event_type:'cryopreservation_lot',cryopreservation:{strain:'PER2::LUC'}},{event_id:'PLAN',event_type:'cryopreservation_plan',strain:'PER2::LUC'},{event_id:'PARTIAL',event_type:'historical',raw_text:'Ai96'}]);
 assert.deepEqual(getStrainCryoLinks(input).links,[]);assert.equal(getStrainCryoLinks(input,{historyIndex:{}}).sourceIndexAvailable,false);
});
