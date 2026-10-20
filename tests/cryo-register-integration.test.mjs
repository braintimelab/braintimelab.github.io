import test from 'node:test';
import assert from 'node:assert/strict';
// These are the exact URLs shared by the v178 app and discovery renderer.
import {createCryoRegister,verifyCryoRegister,readVerifiedCryoRegister} from '../mouse-data/cryo-register.js?v=178';
import {verifyCryoRegister as verifyUnversioned} from '../mouse-data/cryo-register.js';
import {discoverCryoSources} from '../mouse-data/cryo-sources.js?v=178';

const archiveDigest='a'.repeat(64),dataset={tables:{historical_observations:[]}};
const headings=['案件編號','品系','遺傳背景','基改方式','基因名稱','合子型','來源','麥管批號','冷凍日期','結餘管數','製表人 / 發行人','實驗鼠種原庫服務'];
function fixture(){
 const sources=[],sheets=[],cells=[],snapshots=[{date:'2023-01-01',count:10},{date:'2024-01-01',count:7},{date:'2024-01-01',count:8}];
 snapshots.forEach((snapshot,index)=>{
  sources.push({file_id:'synthetic-file-'+index,title:'Synthetic snapshot '+index,url:'https://example.test/archive-'+index,snapshot_date:snapshot.date,snapshot_date_basis:'date_in_title'});
  sheets.push({source_index:index,title:'Cryopreservation',sheet_id:9,grid_row_count:1000,grid_column_count:99});
  const rows={1:['Cryopreservation information'],2:headings,
   3:['CASE-A','Line (M1/M2)','Exact background','Knock-in','Uninterpreted heterozygous gene text','Original homozygote text','Source laboratory','BATCH-A, BATCH-B','2022-01-01',snapshot.count,'Named preparer','0000123'],
   4:['0000456','Zero-count line',null,null,'Raw gene',null,null,'BATCH-Z','2021-06-01',0,null,'0000789'],
   5:['CASE-U','Unknown-count line',null,null,null,null,null,'BATCH-U','2020-01-01',false],
   7:['Strains to transfer'],8:['1','Planned line','TAG-PLANNED','M & F']};
  for(const [number,values]of Object.entries(rows))values.forEach((value,column)=>{if(value!==null&&value!==undefined)cells.push([index,String.fromCharCode(65+column)+number,value,value,null,'General','RAW COMMENT MUST NOT SURVIVE']);});
 });return {sources,sheets,cells};
}
const stripRaw=value=>Array.isArray(value)?value.map(stripRaw):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='raw_cells').map(([key,child])=>[key,stripRaw(child)])):value;

test('the versioned app helper and discovery renderer share verified register identity and preserve all typed meanings',async()=>{
 const parsed=discoverCryoSources(dataset,fixture()),register=await createCryoRegister(parsed,{sourceArchiveSha256:archiveDigest});
 const found=discoverCryoSources(dataset,register);assert.deepEqual(found,stripRaw(parsed));assert.deepEqual(found,readVerifiedCryoRegister(register));
 assert.deepEqual(found.groups.map(group=>group.id),parsed.groups.map(group=>group.id));assert.deepEqual(found.plans.map(plan=>plan.id),parsed.plans.map(plan=>plan.id));
 const disputed=found.groups.find(group=>group.case_id==='CASE-A'),zero=found.groups.find(group=>group.case_id==='0000456'),unknown=found.groups.find(group=>group.case_id==='CASE-U');
 assert.equal(disputed.id,'cryo-source:'+JSON.stringify(['CASE-A',['BATCH-A','BATCH-B']]));assert.deepEqual(disputed.batch_ids,['BATCH-A','BATCH-B']);assert.equal(disputed.reported_remaining,null);assert.deepEqual(disputed.reported_quantity_candidates,[7,8]);assert.equal(disputed.reported_quantity_source,null);assert(disputed.warnings.some(warning=>warning.includes('Equally dated sources')));
 assert.equal(disputed.frozen_date,'2022-01-01');assert.equal(disputed.source_snapshot_date,'2024-01-01');assert.deepEqual(disputed.source_snapshots.map(row=>row.source.snapshot_date),['2023-01-01','2024-01-01','2024-01-01']);assert.equal(disputed.gene,'Uninterpreted heterozygous gene text');assert.equal(disputed.zygosity,'Original homozygote text');assert.equal(disputed.service_reference,'0000123');
 assert.equal(zero.reported_remaining,0);assert.equal(zero.case_id,'0000456');assert.equal(zero.service_reference,'0000789');assert.equal(unknown.reported_remaining,null);assert.equal(unknown.reported_remaining_raw,false);
 for(const group of found.groups){assert.equal(group.material,null);assert.equal(group.storage_location,null);assert.equal(group.status,'source_recorded');assert.equal(group.current_quantity,undefined);assert.equal(group.donor_mouse_sids,undefined);}
 assert.equal(found.plans[0].status,'planned_transfer');assert.equal(found.plans[0].source_order,'1');assert.equal(found.plans[0].tag_text,'TAG-PLANNED');
 const serialized=JSON.stringify(register);for(const forbidden of ['"raw_cells"','"cached_value"','"number_format"','"formula"','grid_row_count','grid_column_count','RAW COMMENT MUST NOT SURVIVE'])assert(!serialized.includes(forbidden));for(const key of ['sources','sheets','cells'])assert(!Object.hasOwn(register,key));
});
test('plain JSON and a handwritten verified flag cannot bypass the actual versioned renderer boundary',async()=>{
 const built=await createCryoRegister(discoverCryoSources(dataset,fixture()),{sourceArchiveSha256:archiveDigest}),json=JSON.parse(JSON.stringify(built));
 for(const value of [json,{...json,verified:true}]){assert.equal(readVerifiedCryoRegister(value),null);assert.throws(()=>discoverCryoSources(dataset,value),/Verify the cryopreservation register/);}
 const verified=await verifyCryoRegister(json,{expectedSourceArchiveSha256:archiveDigest});assert.deepEqual(discoverCryoSources(dataset,verified),stripRaw(discoverCryoSources(dataset,fixture())));
});
test('an unversioned helper instance cannot confer trust on the versioned UI without explicit verification there',async()=>{
 const built=await createCryoRegister(discoverCryoSources(dataset,fixture()),{sourceArchiveSha256:archiveDigest}),otherInstance=await verifyUnversioned(JSON.parse(JSON.stringify(built)),{expectedSourceArchiveSha256:archiveDigest});
 assert.equal(readVerifiedCryoRegister(otherInstance),null);assert.throws(()=>discoverCryoSources(dataset,otherInstance),/Verify the cryopreservation register/);
 const sameInstance=await verifyCryoRegister(otherInstance,{expectedSourceArchiveSha256:archiveDigest});assert.deepEqual(discoverCryoSources(dataset,sameInstance),readVerifiedCryoRegister(sameInstance));
 const copy=readVerifiedCryoRegister(sameInstance);copy.groups[0].case_id='MUTATED';assert.notEqual(discoverCryoSources(dataset,sameInstance).groups[0].case_id,'MUTATED');
});
