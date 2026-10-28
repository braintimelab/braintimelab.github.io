import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,copyFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {fixture,cid} from './fixtures/current-store-fixture.mjs';

const sourceRoot=new URL('../mouse-data/',import.meta.url),temp=await mkdtemp(join(tmpdir(),'family-store-'));
after(()=>rm(temp,{recursive:true,force:true}));await writeFile(join(temp,'package.json'),'{"type":"module"}\n');
for(const name of await readdir(sourceRoot))if(name.endsWith('.js'))await copyFile(new URL(name,sourceRoot),join(temp,name));
const storePath=pathToFileURL(join(temp,'data-store.js')),actualSource=await readFile(storePath,'utf8');
// Test-only exports observe identities without replacing production IO/guards.
await writeFile(storePath,actualSource+'\nexport function __familyFixtureState(){return {baseline,versions,synced,baselineIdentity,deferredArchiveState,managedReadCoverage,pullGeneration,startupCacheSnapshot};}\n');
const {encodeArchive}=await import(pathToFileURL(join(temp,'archive-format.js')));
const provider=await import(pathToFileURL(join(temp,'cloud-provider.js')));
const REV='a'.repeat(32),clone=value=>structuredClone(value);
const records=[{colony_id:cid,entity_type:'mice',entity_id:'100000',version:4,archived:false,payload:{mouse_sid:'100000',canonical_sid:'03345',legacy_sids:['100000'],physical_tag:'Synthetic child',state:'Stock',sex:'Male',sire_sids:['00029'],dam_sids:[],genotype:'Source text only'}},{colony_id:cid,entity_type:'mice',entity_id:'00029',version:7,archived:false,payload:{mouse_sid:'00029',canonical_sid:'00029',legacy_sids:['00029'],physical_tag:'Synthetic parent',state:'Ended',sex:'Male',date_of_birth:'2000-01-01',sire_sids:[],dam_sids:[]}}].sort((a,b)=>a.entity_id.localeCompare(b.entity_id));
function patchSession(patch){const s=JSON.parse(sessionStorage.getItem('mouse-colony.session.v1'));sessionStorage.setItem('mouse-colony.session.v1',JSON.stringify({...s,...patch}));}
async function workspace({pull=true}={}){
 const f=await fixture({nas:true,sourcePath:storePath});f.store.setPrimaryCloudPolicy();await f.store.signIn('member@example.test','synthetic-password');
 for(const row of await encodeArchive({schema_version:1,tables:{historical_observations:[{observation_id:'synthetic-only'}]}}))f.state.records.set(row.entity_type+':'+row.entity_id,{...row,colony_id:cid,version:1});
 for(const row of records)f.state.records.set('mice:'+row.entity_id,clone(row));if(pull)await f.store.pullFromCloud({deferHistory:true,currentOnly:true});
 const originalFetch=globalThis.fetch;f.pedigreeCalls=[];f.reply=null;f.onPedigree=null;f.serverCap=250;
 globalThis.fetch=async(url,options={})=>{
  const u=new URL(url);if(u.origin==='https://cloud.example'&&u.pathname==='/rest/v1/rpc/get_family_pedigree_page'){
   const body=JSON.parse(options.body);f.pedigreeCalls.push({body:clone(body),method:options.method});await f.onPedigree?.(body);
   if(f.reply)return f.reply(body);
   const remaining=records.filter(r=>body.p_after===null||r.entity_id>body.p_after),page=remaining.slice(0,Math.min(body.p_limit,f.serverCap)),more=page.length<remaining.length;
   return Response.json({schema_version:1,scope:'family_pedigree_all_dates_v1',snapshot_revision:REV,total_rows:records.length,metadata_only:body.p_metadata_only,next_after:more?page.at(-1).entity_id:null,rows:page.map(r=>body.p_metadata_only?(({payload,...value})=>value)(r):clone(r))});
  }
  return originalFetch(url,options);
 };
 return f;
}
async function role(f,level,extra={}){
 f.state.role=level;f.state.membershipRows=[{role:level,active:true,export_level:'low',permissions:{},guest_level:null,guest_permissions:{},notes_permissions:{},mouse_permissions:{},reagents_permissions:{},updated_at:'2026-01-01',...extra}];await f.store.verifyCloudMembership();
}
const unresolvedWrite=f=>f.state.calls.some(c=>new URL(c.url).pathname.includes('parallel_cloud_command')||c.body?.p_changes||c.body?.operation_id);

test('actual wrapper returns a frozen full read side snapshot without touching baseline/cache/versions/coverage',async()=>{
 const f=await workspace(),state=f.store.__familyFixtureState(),cache=clone([...f.cache]),modeBefore=f.store.getCloudStatus(),progress=[];f.serverCap=1;
 const context=f.store.getFamilyPedigreeReadContext();assert.equal(context.available,true);assert.equal(context.source,'cloud1');assert.equal(Object.isFrozen(context),true);
 const result=await f.store.readFamilyPedigreeSnapshot({onProgress:value=>progress.push(value)});
 assert.equal(result.readOnly,true);assert.equal(result.totalRows,2);assert.deepEqual(result.records,records.map(r=>r.payload));assert(Object.isFrozen(result.records[0]));assert.equal(f.pedigreeCalls.length,6);
 assert.deepEqual(f.store.__familyFixtureState(),state);assert.equal(f.store.__familyFixtureState().baseline,state.baseline);assert.equal(f.store.__familyFixtureState().versions,state.versions);assert.deepEqual([...f.cache],cache);
 assert.equal(f.store.getCloudStatus().readyForEdits,modeBefore.readyForEdits);assert.equal(f.store.getFamilyPedigreeReadContext().contextKey,context.contextKey);assert(!unresolvedWrite(f));
 assert.deepEqual([...new Set(progress.map(r=>r.phase))],['metadata','records','verify']);assert(f.pedigreeCalls.every(c=>c.method==='POST'));
});
test('ordinary viewer with Family permission may read even when full editable Mice access is restricted',async()=>{
 const f=await workspace();await role(f,'viewer',{mouse_permissions:{'mouse.mice.read':false}});assert.equal(f.store.getCloudStatus().role,'viewer');assert.equal(f.store.getFamilyPedigreeReadContext().available,true);const result=await f.store.readFamilyPedigreeSnapshot();assert.equal(result.records[0].date_of_birth,'2000-01-01');assert(!unresolvedWrite(f));
});
test('active Guest3 Family reader is accepted without Owner/Max/editable-baseline authority',async()=>{
 const f=await workspace();await role(f,'viewer',{guest_level:'guest3',guest_permissions:{},guest_access_starts_on:null,guest_access_ends_on:null});assert.equal(f.store.getFamilyPedigreeReadContext().available,true);assert.equal((await f.store.readFamilyPedigreeSnapshot()).totalRows,2);assert(!unresolvedWrite(f));
});
for(const [name,patch]of [['family denied',{role:'viewer',mousePermissions:{'mouse.family.read':false}}],['malformed permissions',{role:'viewer',mousePermissions:'unknown'}],['unknown Guest',{role:'viewer',guestLevel:'unexpected'}],['expired Guest',{role:'viewer',guestLevel:'guest3',guestAccessEndsOn:'2000-01-01'}],['pending registration',{setupRequired:true}],['password recovery',{passwordRecovery:true}],['no Cloud1 session',{access_token:null}],['no user',{user:null}]])test('wrapper refuses '+name+' before any pedigree request',async()=>{
 const f=await workspace();patchSession(patch);assert.equal(f.store.getFamilyPedigreeReadContext().available,false);await assert.rejects(f.store.readFamilyPedigreeSnapshot(),e=>e.code==='FAMILY_PEDIGREE_UNAVAILABLE');assert.equal(f.pedigreeCalls.length,0);assert(!unresolvedWrite(f));
});
test('local/demo mode is unavailable and never probes the RPC',async()=>{
 const f=await workspace({pull:false});assert.equal(f.store.getFamilyPedigreeReadContext().available,false);await assert.rejects(f.store.readFamilyPedigreeSnapshot(),/Sign in/);assert.equal(f.pedigreeCalls.length,0);
});
test('Cloud2 selection reports honest unavailable and never sends this RPC to the NAS broker',async()=>{
 const f=await workspace();await f.store.resumeCloud2Session();f.state.cloud=false;await f.store.refreshCloudConnections();assert.equal(f.store.getCloudConnections().active,'cloud2');assert.match(f.store.getFamilyPedigreeReadContext().reason,/Cloud 1/);const calls=f.state.calls.length;await assert.rejects(f.store.readFamilyPedigreeSnapshot(),e=>e.familyPedigreeUnavailable===true);assert.equal(f.pedigreeCalls.length,0);assert.equal(f.state.calls.length,calls);
});
for(const [name,patch]of [['role',{role:'viewer'}],['Family permission', {mousePermissions:{'mouse.family.read':false},role:'viewer'}],['session epoch',{sessionCloudId:'11111111-1111-4111-8111-111111111111',user:{id:'33333333-3333-4333-8333-333333333333',email:'synthetic-other@example.test'}}],['Guest deadline',{guestLevel:'guest3',guestAccessEndsOn:'2000-01-01'}]])test('mid-read '+name+' change discards pages without a new request',async()=>{
 const f=await workspace();f.onPedigree=()=>{patchSession(patch);};await assert.rejects(f.store.readFamilyPedigreeSnapshot(),e=>e.code==='FAMILY_PEDIGREE_CONTEXT_CHANGED');assert.equal(f.pedigreeCalls.length,1);assert(!unresolvedWrite(f));
});
test('source/config change fences the active read and cannot merge its late result',async()=>{
 const f=await workspace();f.onPedigree=()=>{const c=JSON.parse(localStorage.getItem('mouse-colony.cloud.v1'));localStorage.setItem('mouse-colony.cloud.v1',JSON.stringify({...c,colonyId:'44444444-4444-4444-8444-444444444444'}));};await assert.rejects(f.store.readFamilyPedigreeSnapshot(),e=>e.code==='FAMILY_PEDIGREE_CONTEXT_CHANGED');assert.equal(f.pedigreeCalls.length,1);assert(!unresolvedWrite(f));
});
test('same-user auth generation change also invalidates the cache/context token',async()=>{
 const f=await workspace(),before=f.store.getFamilyPedigreeReadContext().contextKey;await f.store.signIn('member@example.test','synthetic-password');assert.notEqual(f.store.getFamilyPedigreeReadContext().contextKey,before);
});
test('same-user reauthentication during a page invalidates the original read epoch',async()=>{
 const f=await workspace();f.onPedigree=()=>f.store.signIn('member@example.test','synthetic-password');await assert.rejects(f.store.readFamilyPedigreeSnapshot(),e=>e.code==='FAMILY_PEDIGREE_CONTEXT_CHANGED');assert.equal(f.pedigreeCalls.length,1);assert(!unresolvedWrite(f));
});
test('cancellation before and during IO stops page adoption without a mutation',async()=>{
 const f=await workspace(),cancel=new AbortController();cancel.abort();await assert.rejects(f.store.readFamilyPedigreeSnapshot({signal:cancel.signal}),e=>e.name==='AbortError');assert.equal(f.pedigreeCalls.length,0);
 const during=new AbortController();f.onPedigree=()=>during.abort();await assert.rejects(f.store.readFamilyPedigreeSnapshot({signal:during.signal}),e=>e.name==='AbortError');assert.equal(f.pedigreeCalls.length,1);assert(!unresolvedWrite(f));
});
test('missing service returns explicit unavailable without pretending the cached view is full',async()=>{
 const f=await workspace(),state=f.store.__familyFixtureState();f.reply=()=>Response.json({code:'PGRST202',message:'The RPC is not installed.'},{status:404});await assert.rejects(f.store.readFamilyPedigreeSnapshot(),e=>e.code==='FAMILY_PEDIGREE_UNAVAILABLE'&&/not available/.test(e.message));assert.equal(f.pedigreeCalls.length,1);assert.equal(f.store.__familyFixtureState().baseline,state.baseline);assert(!unresolvedWrite(f));
});
test('changed server revision and forbidden response fields fail without cache/baseline adoption',async()=>{
 const f=await workspace(),state=f.store.__familyFixtureState();f.reply=body=>Response.json({schema_version:1,scope:'family_pedigree_all_dates_v1',snapshot_revision:body.p_metadata_only?REV:'b'.repeat(32),total_rows:0,metadata_only:body.p_metadata_only,next_after:null,rows:[]});await assert.rejects(f.store.readFamilyPedigreeSnapshot(),/changed during loading/);assert.equal(f.store.__familyFixtureState().baseline,state.baseline);assert(!unresolvedWrite(f));
 f.reply=body=>Response.json({schema_version:1,scope:'family_pedigree_all_dates_v1',snapshot_revision:REV,total_rows:records.length,metadata_only:body.p_metadata_only,next_after:null,rows:records.map(r=>body.p_metadata_only?(({payload,...value})=>value)(r):{...r,payload:{...r.payload,comment:'Forbidden source note'}})});await assert.rejects(f.store.readFamilyPedigreeSnapshot(),/unexpected fields/);assert.equal(f.store.__familyFixtureState().baseline,state.baseline);assert(!unresolvedWrite(f));
});
test('Store source is exactly the frozen warm-performance source plus the two imports and isolated wrapper block',()=>{
 let restored=actualSource.replace("import {appAllows as familyPedigreeAllowed} from './app-access.js?v=175';\n",'').replace("import {readFamilyPedigree} from './family-pedigree-read.js?v=201';\n",'');
 const start=restored.indexOf('// A Family projection is an independent read-only side snapshot.'),end=restored.indexOf('async function responseJSON(',start);assert(start>0&&end>start);restored=restored.slice(0,start)+restored.slice(end);
 assert.equal(createHash('sha256').update(restored).digest('hex'),'e171655b7a022dce640498b51097e1372c2ca3a33c96fd423da568e5b45fc987');
});
test('only the exact new POST RPC is classified as read; command kinds and all existing provider bytes remain unchanged',async()=>{
 assert.equal(provider.isCloudRead('rpc/get_family_pedigree_page','POST'),true);for(const route of ['rpc/get_family_pedigree_page_extra','rpc/save_records','rpc/unknown'])assert.equal(provider.isCloudRead(route,'POST'),false);assert.equal(provider.CLOUD_COMMAND_KINDS['rpc/get_family_pedigree_page'],undefined);
 const code=await readFile(new URL('../mouse-data/cloud-provider.js',import.meta.url),'utf8');assert.equal(createHash('sha256').update(code.replace("'get_family_pedigree_page',",'')).digest('hex'),'bc94219cdc6eb37a6a09e2116fa26a060bc16f1bc094cbaface529322705b26b');
});
