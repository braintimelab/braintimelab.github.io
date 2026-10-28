import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,copyFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {fixture,cid} from './fixtures/current-store-fixture.mjs';

// Load unchanged production dependencies under an explicit ESM boundary so the
// same test runs on the NAS's Node20.9 as well as newer local Node versions.
const sourceRoot=new URL('../mouse-data/',import.meta.url),temp=await mkdtemp(join(tmpdir(),'mouse-warm-read-'));
after(()=>rm(temp,{recursive:true,force:true}));
await writeFile(join(temp,'package.json'),' {"type":"module"}\n');
for(const name of await readdir(sourceRoot))if(name.endsWith('.js'))await copyFile(new URL(name,sourceRoot),join(temp,name));
const storePath=pathToFileURL(join(temp,'data-store.js'));
const {encodeArchive}=await import(pathToFileURL(join(temp,'archive-format.js')));
const source=await readFile(storePath,'utf8');let moduleSequence=0;
// Freeze only the former 5KB reader, rather than a complete old Store or a git
// history dependency. The outer-production hash below preserves the boundary.
const oldIncremental=await readFile(new URL('./fixtures/incremental-managed-before-warm.mjs',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(oldIncremental).digest('hex'),'2bced07c85ba10e054acc6bc77824183ecde84f442daf2ee9ad9581c4586a757');
const incrementalStart=source.indexOf('async function incrementalManaged('),incrementalEnd=source.indexOf('\n// Only the manifest-selected chunks',incrementalStart);
assert.ok(incrementalStart>0&&incrementalEnd>incrementalStart);
const baselineSource=source.slice(0,incrementalStart)+oldIncremental.trimEnd()+source.slice(incrementalEnd);
async function readerModule(input=source){
 const code=input.replace(/from '([^']+)'/g,(_all,path)=>`from '${new URL(path,storePath).href}'`)+
  '\nexport {incrementalManaged as readIncremental}; export function setTestPolicy(value){feeVisibility=value;}\n'+`// fixture ${++moduleSequence}`;
 const mod=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));mod.setTestPolicy({source_archive_allowed:true});return mod;
}
const mouse=(n,{current=n<=295,archived=false}={})=>{
 const id=String(n).padStart(5,'0');return {colony_id:cid,entity_type:'mice',entity_id:id,version:1,archived,payload:{mouse_sid:id,canonical_sid:id,legacy_sids:[id],physical_tag:'Synthetic-'+id,sex:n%2?'Male':'Female',state:current?'Stock':'Ended',...(archived?{app_archived_at:'2026-01-01T00:00:00Z'}:{})}};
};
const rows=Array.from({length:3334},(_,i)=>mouse(i+1,{archived:i===3300}));
const reuseOf=values=>({records:new Map(values.map(r=>['mice:'+r.entity_id,structuredClone(r)])),versions:new Map(values.map(r=>['mice:'+r.entity_id,r.version]))});
const payloadCalls=calls=>calls.filter(c=>c.payload);
function transport(original,{cap=1000,mutate=null}={}){
 const live=new Map(original.map(r=>[r.entity_id,structuredClone(r)])),calls=[];
 const read=async(route,options={})=>{
  assert.equal(options.method,undefined,'unscoped fallback must retain the ordinary GET transport');
  assert(route.startsWith('entity_records?'));const q=new URLSearchParams(route.split('?')[1]),payload=q.get('select').includes('payload'),filter=q.get('entity_id'),requested=Number(q.get('limit'));
  const call={payload,filter,limit:requested};calls.push(call);mutate?.({live,calls,call});
  let page=[...live.values()].sort((a,b)=>a.entity_id<b.entity_id?-1:a.entity_id>b.entity_id?1:0);
  if(filter?.startsWith('gt.'))page=page.filter(r=>r.entity_id>filter.slice(3));
  else if(filter?.startsWith('eq.'))page=page.filter(r=>r.entity_id===filter.slice(3));
  else if(filter?.startsWith('in.(')){const ids=new Set(filter.slice(4,-1).split(','));page=page.filter(r=>ids.has(r.entity_id));}
  page=page.slice(0,Math.min(cap,requested));return structuredClone(page.map(r=>payload?r:(({payload,...rest})=>rest)(r)));
 };
 return {read,calls,live};
}
async function readRows(values,reuse,options={}){const mod=await readerModule(),io=transport(values,options);const result=await mod.readIncremental('mice',{colonyId:cid},()=>{},reuse,false,io.read);return {...io,result};}
async function workspace(){
 const f=await fixture({nas:false,sourcePath:storePath});f.store.setPrimaryCloudPolicy();await f.store.signIn('member@example.test','synthetic-password');
 for(const row of await encodeArchive({tables:{historical_observations:[{observation_id:'synthetic-source-reference',description:'Invented fixture only'}]},schema_version:1}))f.state.records.set(row.entity_type+':'+row.entity_id,{...row,colony_id:cid,version:1});
 for(const row of rows)f.state.records.set('mice:'+row.entity_id,structuredClone(row));return f;
}
const mouseRequests=f=>f.state.calls.filter(call=>{const u=new URL(call.url);return u.pathname==='/rest/v1/entity_records'&&u.searchParams.get('entity_type')==='eq.mice';});
const payloadRequests=f=>mouseRequests(f).filter(call=>new URL(call.url).searchParams.get('select').includes('payload'));

test('actual Store cold, compact-warm and full-warm produce identical full3334 snapshots with bounded payload requests',async()=>{
 const cold=await workspace();cold.state.calls=[];const expected=await cold.store.pullFromCloud({deferHistory:true});assert.equal(expected.tables.mice.length,3334);assert.equal(payloadRequests(cold).length,4);
 const warm=await workspace();const compact=await warm.store.pullFromCloud({deferHistory:true,currentOnly:true});assert.equal(compact.tables.mice.length,295);
 const restored=await warm.reload();restored.setPrimaryCloudPolicy();const preview=await restored.loadStartupCache();assert.equal(preview.tables.mice.length,295);
 warm.state.calls=[];const actual=await restored.pullFromCloud({deferHistory:true});assert.deepEqual(actual,expected);assert.equal(payloadRequests(warm).length,5,'four1000-row pages plus explicit empty terminator');
 assert(payloadRequests(warm).every(c=>!new URL(c.url).searchParams.get('entity_id')?.startsWith('in.(')));
 assert.equal(restored.getCloudStatus().readyForEdits,true);warm.state.calls=[];assert.deepEqual(await restored.pullFromCloud({deferHistory:true}),expected);assert.equal(payloadRequests(warm).length,0,'complete warm baseline stays incremental');
 assert(!warm.state.calls.some(c=>c.body?.p_changes||c.body?.p_operation_id),'no biological/source command is sent by reads');
});
test('nearly complete baseline retains one small ID batch and exact versions/archived payloads',async()=>{
 const cached=structuredClone(rows),changed=structuredClone(rows);changed[20].version=2;changed[20].payload.comment='Synthetic change';changed[21].version=2;
 const io=await readRows(changed,reuseOf(cached));assert.deepEqual(Array.from(io.result),changed);assert.equal(io.result.reused,3332);assert.equal(payloadCalls(io.calls).length,1);assert.equal(payloadCalls(io.calls)[0].limit,2);assert.match(payloadCalls(io.calls)[0].filter,/^in\./);
});
test('actual previous reader reproduces152 payload batches; candidate returns identical3334 rows in5 pages',async()=>{
 const baseline=await readerModule(baselineSource),oldIO=transport(rows),before=await baseline.readIncremental('mice',{colonyId:cid},()=>{},reuseOf(rows.slice(0,295)),false,oldIO.read);
 const after=await readRows(rows,reuseOf(rows.slice(0,295)));assert.deepEqual(Array.from(after.result),Array.from(before));assert.equal(payloadCalls(oldIO.calls).length,152);assert.equal(payloadCalls(after.calls).length,5);
});
test('existing scoped RPC pagination has identical results and request trace before/after',async()=>{
 const values=rows.slice(0,203),run=async input=>{const mod=await readerModule(input),calls=[];const read=async(route,{method,cloudSource,body})=>{assert.equal(route,'rpc/get_managed_record_page');assert.equal(method,'POST');assert.equal(cloudSource,'cloud1');calls.push(structuredClone(body));const page=values.filter(r=>body.p_after===null||r.entity_id>body.p_after).slice(0,body.p_limit);return structuredClone(body.p_metadata_only?page.map(({payload,...r})=>r):page);};const result=await mod.readIncremental('mice',{colonyId:cid},()=>{},reuseOf(values.slice(0,101)),false,read,()=>{},'full');return {result:Array.from(result),calls};};
 assert.deepEqual(await run(source),await run(baselineSource));
});
test('new fallback is limited to over100 missing AND more than half the full live index',async()=>{
 const hundred=await readRows(rows.slice(0,200),reuseOf(rows.slice(0,100)));assert(payloadCalls(hundred.calls).every(c=>c.limit<=20));
 const half=await readRows(rows.slice(0,202),reuseOf(rows.slice(0,101)));assert(payloadCalls(half.calls).every(c=>c.limit<=20));
 const majority=await readRows(rows.slice(0,203),reuseOf(rows.slice(0,101)));assert.equal(payloadCalls(majority.calls)[0].limit,1000);assert.equal(majority.result.length,203);
});
test('full pagination preserves archived rows, raw IDs and unusual literal cursor IDs',async()=>{
 const special=[mouse(1),mouse(2),...Array.from({length:105},(_,i)=>({...mouse(i+10),entity_id:'literal '+String(i).padStart(3,'0')+"'α,",payload:{...mouse(i+10).payload,mouse_sid:'literal '+String(i).padStart(3,'0')+"'α,"}}))];
 special[1].archived=true;special[1].payload.app_archived_at='2026-01-01';const io=await readRows(special,reuseOf([]));assert.deepEqual(Array.from(io.result),special);assert.equal(io.result[1].archived,true);
});
test('confirmed timeout halves only the same full payload cursor, retaining smaller limit and final metadata proof',async()=>{
 const mod=await readerModule(),io=transport(rows);let failed=false;
 const read=async(route,options)=>{const q=new URLSearchParams(route.split('?')[1]);if(q.get('select').includes('payload')&&!failed){failed=true;assert.equal(q.get('limit'),'1000');assert.equal(q.get('entity_id'),null);throw Object.assign(new Error('canceling statement due to statement timeout'),{statementTimeout:true});}return io.read(route,options);};
 const result=await mod.readIncremental('mice',{colonyId:cid},()=>{},reuseOf(rows.slice(0,295)),false,read);assert.deepEqual(Array.from(result),rows);assert(payloadCalls(io.calls).every(c=>c.limit===500));assert.equal(payloadCalls(io.calls).length,8);
});
for(const kind of ['version','archive','arrival','removal'])test('final complete index rejects '+kind+' race after fallback payload pages',async()=>{
 let payloadDone=false;const mod=await readerModule(),io=transport(rows,{mutate:({live,call})=>{if(call.payload&&call.filter===`gt.${rows.at(-1).entity_id}`)payloadDone=true;else if(payloadDone&&!call.payload){payloadDone=false;if(kind==='version')live.get('00001').version++;if(kind==='archive')live.get('00001').archived=true;if(kind==='arrival')live.set('09999',mouse(9999));if(kind==='removal')live.delete('00001');}}});
 await assert.rejects(mod.readIncremental('mice',{colonyId:cid},()=>{},reuseOf(rows.slice(0,295)),false,io.read),/changed during loading/);
});
for(const kind of ['missing','duplicate','unexpected','payload_version','payload_archive'])test('fallback refuses '+kind+' payload rather than exposing a partial baseline',async()=>{
 const mod=await readerModule(),io=transport(rows);let changed=false;const read=async(route,options)=>{const page=await io.read(route,options);if(!changed&&new URLSearchParams(route.split('?')[1]).get('select').includes('payload')){changed=true;if(kind==='missing')page.shift();if(kind==='duplicate')page[1]=page[0];if(kind==='unexpected')page[0]=mouse(9999);if(kind==='payload_version')page[0].version++;if(kind==='payload_archive')page[0].archived=true;}return page;};
 await assert.rejects(mod.readIncremental('mice',{colonyId:cid},()=>{},reuseOf(rows.slice(0,295)),false,read),/changed during loading/);
});
test('short nonempty payload pages continue to EMPTY without accepting an incomplete response cap',async()=>{
 const mod=await readerModule(),io=transport(rows);const read=async(route,options)=>{const page=await io.read(route,options);return new URLSearchParams(route.split('?')[1]).get('select').includes('payload')?page.slice(0,137):page;};
 const result=await mod.readIncremental('mice',{colonyId:cid},()=>{},reuseOf(rows.slice(0,295)),false,read);assert.deepEqual(Array.from(result),rows);assert.equal(payloadCalls(io.calls).length,26);
});
test('actual Store keeps archive-head verification and refuses final source-head changes',async()=>{
 const f=await workspace();await f.store.pullFromCloud({deferHistory:true,currentOnly:true});let sawMicePayload=false;
 f.state.onRead=route=>{const q=new URLSearchParams(route.split('?')[1]);if(q.get('entity_type')==='eq.mice'&&q.get('select').includes('payload'))sawMicePayload=true;if(sawMicePayload&&q.get('entity_type')==='eq.archive'&&!q.get('select').includes('payload'))f.state.records.get('archive:reconstruction').version++;};
 await assert.rejects(f.store.pullFromCloud({deferHistory:true}),/manifest changed during loading/);assert.equal(f.store.getCloudStatus().readyForEdits,false);
});
test('warm fallback leaves all preexisting functions outside incrementalManaged unchanged',async()=>{
 const strip=input=>{let s=input.replace("import {appAllows as familyPedigreeAllowed} from './app-access.js?v=175';\n",'').replace("import {readFamilyPedigree} from './family-pedigree-read.js?v=201';\n",'');const a=s.indexOf('// A Family projection is an independent read-only side snapshot.');if(a>=0)s=s.slice(0,a)+s.slice(s.indexOf('async function responseJSON(',a));return s.slice(0,s.indexOf('async function incrementalManaged('))+s.slice(s.indexOf('\n// Only the manifest-selected chunks',s.indexOf('async function incrementalManaged(')));};
 assert.equal(createHash('sha256').update(strip(source)).digest('hex'),'8387b17ee959dcce32c0ab60e22c5abec673e61d6de35eb926bba8b75ad65cf5','all approved preexisting bytes outside the changed reader remain unchanged');
});
