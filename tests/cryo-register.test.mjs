import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {discoverCryoSources} from '../mouse-data/cryo-sources.js';
import {createCryoRegister,verifyCryoRegister,readVerifiedCryoRegister} from '../mouse-data/cryo-register.js';

const sourceDigest='a'.repeat(64),empty={tables:{historical_observations:[]}};
const headers=['案件編號','品系','遺傳背景','基改方式','基因名稱','合子型','來源','麥管批號','冷凍日期','結餘管數','製表人 / 發行人','實驗鼠種原庫服務'];
function fixture(snapshots){
 const sources=[],sheets=[],cells=[];
 snapshots.forEach((snapshot,index)=>{
  sources.push({file_id:'synthetic-'+index,title:'Snapshot '+index,url:'https://example.test/source-'+index,snapshot_date:snapshot.date,snapshot_date_basis:'date_in_title'});
  sheets.push({source_index:index,title:'Cryopreservation',sheet_id:9,grid_row_count:1000,grid_column_count:99});
  const rows={1:['Cryopreservation information'],2:headers,3:['CASE-A','Synthetic line','Background','Knock-in','Uninterpreted genetic text','Raw zygosity','Origin','BATCH-A, BATCH-B','2022-01-01',10,'Preparer','0000123'],5:['Strains to transfer'],6:[1,'Planned line','TAG','M & F'],...snapshot.rows};
  for(const [number,values]of Object.entries(rows))values.forEach((value,column)=>{if(value!==null&&value!==undefined)cells.push([index,String.fromCharCode(65+column)+number,value,value,null,'General','RAW COMMENT THAT MUST DISAPPEAR']);});
 });
 return {sources,sheets,cells};
}
const withoutCells=value=>Array.isArray(value)?value.map(withoutCells):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='raw_cells').map(([key,child])=>[key,withoutCells(child)])):value;
const found=(snapshots=[{date:'2023-01-01'},{date:'2024-01-01'}])=>discoverCryoSources(empty,fixture(snapshots));

test('materialization preserves exact case and plan meanings and coverage while dropping every raw cell',async()=>{
 const source=found(),before=structuredClone(source),register=await createCryoRegister(source,{sourceArchiveSha256:sourceDigest});
 assert.deepEqual(source,before);assert.equal(register.source_archive_sha256,sourceDigest);assert.equal(register.raw_cells_retained,false);
 assert.deepEqual(readVerifiedCryoRegister(register),withoutCells(source));
 const encoded=JSON.stringify(register);for(const unwanted of ['raw_cells','RAW COMMENT','grid_row_count','grid_column_count','number_format','cached_value','formula'])assert(!encoded.includes('"'+unwanted+'"')&&!encoded.includes('RAW COMMENT'));
 assert(!Object.hasOwn(register,'sources'));assert(!Object.hasOwn(register,'sheets'));assert(!Object.hasOwn(register,'cells'));
 assert.equal(register.discovery.groups[0].service_reference,'0000123');assert.equal(register.discovery.groups[0].reported_remaining,10);assert.deepEqual(register.discovery.groups[0].batch_ids,['BATCH-A','BATCH-B']);assert.equal(register.discovery.groups[0].material,null);assert.equal(register.discovery.groups[0].storage_location,null);
 assert.equal(register.discovery.plans[0].status,'planned_transfer');assert.equal(register.discovery.groups[0].status,'source_recorded');
});
test('invalid dates, zero, unknown counts, conflicting quantities and genotype text remain unchanged',async()=>{
 const scenarios=[
  [{date:'2024-01-01',rows:{3:['CASE-A','Line (M1/M2)',null,null,'Heterozygous text','homozygote',null,null,'2023-02-30',-1]}}],
  [{date:'2024-01-01',rows:{3:['CASE-A','Line',null,null,null,null,null,'A','2023-01-01',null],4:['CASE-B','Other line',null,null,null,null,null,'B','2023-01-01',0]}}],
  [{date:'2024-01-01'},{date:'2024-01-01',rows:{3:['CASE-A','Line',null,null,null,null,null,'BATCH-A, BATCH-B','2022-01-01',7]}}],
  [{date:'2023-01-01'},{date:'2024-01-01',rows:{3:['CASE-A','Line',null,null,null,null,null,'BATCH-A, BATCH-B','2022-01-01',null]}}]
 ];
 for(const rows of scenarios){const source=found(rows),register=await createCryoRegister(source,{sourceArchiveSha256:sourceDigest});assert.deepEqual(register.discovery,withoutCells(source));}
});
test('integrity verification is mandatory before synchronous rendering and copies cannot mutate verified data',async()=>{
 const built=await createCryoRegister(found(),{sourceArchiveSha256:sourceDigest}),unverified=JSON.parse(JSON.stringify(built));
 assert.equal(readVerifiedCryoRegister(unverified),null);assert.equal(readVerifiedCryoRegister({...unverified,verified:true}),null);
 const verified=await verifyCryoRegister(unverified,{expectedSourceArchiveSha256:sourceDigest});assert(Object.isFrozen(verified));assert(Object.isFrozen(verified.discovery.groups[0]));
 const result=readVerifiedCryoRegister(verified);result.groups[0].reported_remaining=999;assert.equal(readVerifiedCryoRegister(verified).groups[0].reported_remaining,10);
 await assert.rejects(()=>verifyCryoRegister(unverified,{expectedSourceArchiveSha256:'b'.repeat(64)}),/different source archive/);
 const mutable=structuredClone(unverified),pending=verifyCryoRegister(mutable);mutable.discovery.groups[0].reported_remaining=999;assert.equal(readVerifiedCryoRegister(await pending).groups[0].reported_remaining,10);
});
test('wrong versions, schemas, raw payloads and changed typed content are rejected',async()=>{
 const original=await createCryoRegister(found(),{sourceArchiveSha256:sourceDigest});
 const mutations=[r=>{r.schema_version=2;},r=>{r.format='other';},r=>{r.raw_cells_retained=true;},r=>{r.extra='unknown';},r=>{r.source_archive_sha256='bad';},r=>{r.integrity.algorithm='other';},r=>{r.discovery.groups[0].reported_remaining=999;},r=>{r.discovery.groups[0].source_snapshots[0].raw_cells=[];},r=>{r.discovery.coverage.case_observation_count++;}];
 for(const mutate of mutations){const bad=structuredClone(original);mutate(bad);await assert.rejects(()=>verifyCryoRegister(bad),/Cryopreservation register/);assert.equal(readVerifiedCryoRegister(bad),null);}
});
test('builder rejects partial excerpts and invented current stock, case identities or batch groupings',async()=>{
 const original=found();
 const mutations=[s=>{s.coverage.full_index_available=false;},s=>{s.partials.push({text:'incomplete'});},s=>{s.groups[0].material='sperm';},s=>{s.groups[0].storage_location={facility:'guessed'};},s=>{s.groups[0].id='arbitrary';},s=>{s.groups[0].source_snapshots[0].batch_ids=['OTHER'];},s=>{s.groups[0].sources[0].url='javascript:alert(1)';},s=>{s.groups[0].current_quantity=10;},s=>{s.coverage.case_observation_count++;}];
 for(const mutate of mutations){const bad=structuredClone(original);mutate(bad);await assert.rejects(()=>createCryoRegister(bad,{sourceArchiveSha256:sourceDigest}),/Cryopreservation register/);}
 await assert.rejects(()=>createCryoRegister(original),/verified original archive SHA-256/);
});
test('cached formula results survive as typed facts without retaining formula text',async()=>{
 const index=fixture([{date:'2024-01-01',rows:{6:['1','Planned line','TAG','M & F']}}]),count=index.cells.find(row=>row[1]==='J3');count[2]='=SUM(X1:X9)';count[3]=6;count[4]='=SUM(X1:X9)';
 const source=discoverCryoSources(empty,index),register=await createCryoRegister(source,{sourceArchiveSha256:sourceDigest});assert.equal(register.discovery.groups[0].reported_remaining,6);assert.equal(register.discovery.plans[0].source_order,'1');assert(!JSON.stringify(register).includes('SUM('));assert.deepEqual(register.discovery,withoutCells(source));
});
test('exact private archive materializes all seven cases and six plans without retaining the 21 MB source',async context=>{
 let bytes,dataset;try{[bytes,dataset]=await Promise.all([readFile(new URL('../../outputs/reconstruction_2026-10-14/history_cells.json',import.meta.url)),readFile(new URL('../../outputs/reconstruction_2026-10-14/dataset_augmented.json',import.meta.url),'utf8').then(JSON.parse)]);}catch(error){if(error.code!=='ENOENT')throw error;context.skip('Private source fixtures are not published.');return;}
 const digest=createHash('sha256').update(bytes).digest('hex');assert.equal(digest,'87e0680e7dcde0eecd2752577df3f1cd0492a8918a7f90ead7c7b20f4837aa20');assert.equal(bytes.length,20987621);
 const source=discoverCryoSources(dataset,JSON.parse(bytes)),register=await createCryoRegister(source,{sourceArchiveSha256:digest});assert.deepEqual(register.discovery,withoutCells(source));assert.equal(register.discovery.groups.length,7);assert.equal(register.discovery.plans.length,6);assert.equal(register.discovery.coverage.case_observation_count,41);assert.equal(register.discovery.coverage.plan_observation_count,42);assert(Buffer.byteLength(JSON.stringify(register))<120000);assert(!JSON.stringify(register).includes('"raw_cells"'));
});
