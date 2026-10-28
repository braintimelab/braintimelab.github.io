import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';

const load=async name=>import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('../mouse-data/'+name,import.meta.url),'utf8')).toString('base64'));
const {readFamilyPedigree,FAMILY_PEDIGREE_READ_SCOPE:SCOPE}=await load('family-pedigree-read.js');
const COLONY='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',REV='a'.repeat(32),NEXT_REV='b'.repeat(32);
const clone=value=>structuredClone(value);
const row=(id,extra={})=>({colony_id:COLONY,entity_type:'mice',entity_id:String(id),version:1,archived:false,payload:{mouse_sid:String(id),sire_sids:[],dam_sids:[],physical_tag:'TAG-'+id,sex:'Unknown',state:'Ended',date_of_birth:'2000-01-01',...extra}});
const sortIds=(a,b)=>Buffer.compare(Buffer.from(a.entity_id),Buffer.from(b.entity_id));
function fixture({records=[row('1'),row('2'),row('3')],serverCap=250,mutate,requestHook,context='owner:colony:cloud1:family-read'}={}){
 const ordered=[...records].sort(sortIds),calls=[],progress=[];let currentContext=context,seenPayload=false;
 const request=async params=>{
  assert.deepEqual(Object.keys(params),['p_colony_id','p_after','p_limit','p_metadata_only']);assert.equal(params.p_colony_id,COLONY);assert.ok(Object.isFrozen(params));calls.push(clone(params));
  const phase=params.p_metadata_only?(seenPayload?'verify':'metadata'):'records';if(!params.p_metadata_only)seenPayload=true;
  const candidates=ordered.filter(r=>params.p_after===null||Buffer.compare(Buffer.from(r.entity_id),Buffer.from(params.p_after))>0),selected=candidates.slice(0,Math.min(params.p_limit,serverCap));
  const rows=selected.map(r=>{const value=clone(r);if(params.p_metadata_only)delete value.payload;return value;});
  const page={schema_version:1,scope:SCOPE,snapshot_revision:REV,total_rows:ordered.length,next_after:candidates.length>selected.length?selected.at(-1)?.entity_id??null:null,metadata_only:params.p_metadata_only,rows};
  if(mutate)mutate({page,phase,params,calls});if(requestHook)await requestHook({page,phase,params,calls,setContext:value=>currentContext=value});return page;
 };
 const read=options=>readFamilyPedigree({colonyId:COLONY,request,getContext:()=>currentContext,onProgress:value=>progress.push(value),...options});
 return {ordered,calls,progress,request,read,setContext:value=>currentContext=value,getContext:()=>currentContext};
}
const invalid=error=>['FAMILY_PEDIGREE_INVALID_RESPONSE','FAMILY_PEDIGREE_CHANGED'].includes(error.code);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('complete initial metadata, payload and final metadata produce only a deeply frozen side snapshot',async()=>{
 const f=fixture(),snapshot=await f.read({pageSize:2});assert.equal(snapshot.scope,SCOPE);assert.equal(snapshot.snapshotRevision,REV);assert.equal(snapshot.totalRows,3);assert.equal(snapshot.readOnly,true);assert.equal(snapshot.colonyId,COLONY);assert.equal(snapshot.tables,undefined);assert.deepEqual(snapshot.records.map(r=>r.mouse_sid),['1','2','3']);assert.deepEqual(f.calls.map(c=>c.p_metadata_only),[true,true,false,false,true,true]);assert.deepEqual(f.calls.map(c=>c.p_after),[null,'2',null,'2',null,'2']);assert.deepEqual(snapshot.versions,[{entityId:'1',version:1,archived:false},{entityId:'2',version:1,archived:false},{entityId:'3',version:1,archived:false}]);
 assert.ok(Object.isFrozen(snapshot)&&Object.isFrozen(snapshot.records)&&Object.isFrozen(snapshot.records[0])&&Object.isFrozen(snapshot.records[0].sire_sids)&&Object.isFrozen(snapshot.versions[0]));assert.throws(()=>snapshot.records[0].sire_sids.push('99'),TypeError);assert.ok(f.progress.every(p=>Object.isFrozen(p)));assert.deepEqual([...new Set(f.progress.map(p=>p.phase))],['metadata','records','verify']);assert.deepEqual(f.progress.at(-1),{phase:'verify',loaded:3,total:3});
});
test('nonempty short pages follow next_after in all three scans instead of falsely completing',async()=>{
 const f=fixture({records:Array.from({length:7},(_,i)=>row(String(i+1))),serverCap:2}),snapshot=await f.read({pageSize:250});assert.equal(snapshot.records.length,7);assert.equal(f.calls.length,12);for(let i=0;i<3;i++)assert.deepEqual(f.calls.slice(i*4,i*4+4).map(c=>c.p_after),[null,'2','4','6']);assert.ok(f.calls.every(c=>c.p_limit===250));
});
test('zero rows still verify a payload scan and final metadata scan',async()=>{
 const f=fixture({records:[]}),snapshot=await f.read();assert.equal(snapshot.totalRows,0);assert.deepEqual(snapshot.records,[]);assert.deepEqual(snapshot.versions,[]);assert.deepEqual(f.calls.map(c=>c.p_metadata_only),[true,false,true]);assert.deepEqual(f.progress.at(-1),{phase:'verify',loaded:0,total:0});
});
test('reader does not use the200card layout budget to truncate a complete501record snapshot',async()=>{
 const f=fixture({records:Array.from({length:501},(_,i)=>row(String(i+1).padStart(5,'0')))}),snapshot=await f.read();assert.equal(snapshot.totalRows,501);assert.equal(snapshot.records.length,501);assert.equal(snapshot.versions.length,501);assert.equal(f.calls.length,9);
});
test('raw100000/canonical03345, literal tags, duplicates and saved parent order are preserved exactly',async()=>{
 const source=row('100000',{canonical_sid:'03345',legacy_sids:['100000','03345','100000'],sire_sids:['00029','29','00029'],dam_sids:['3016','3011'],physical_tag:"FB'-M3385",genotype:'Unconfirmed source text',app_archived_at:'2020-01-01T00:00:00Z',archived:true});source.archived=true;const before=clone(source),f=fixture({records:[source]}),snapshot=await f.read();assert.deepEqual(snapshot.records[0],source.payload);assert.equal(snapshot.records[0].mouse_sid,'100000');assert.equal(snapshot.records[0].canonical_sid,'03345');assert.deepEqual(snapshot.records[0].sire_sids,['00029','29','00029']);assert.deepEqual(snapshot.versions,[{entityId:'100000',version:1,archived:true}]);assert.deepEqual(source,before);assert.equal(Object.isFrozen(source),false);
});
test('UTF8 cursor ordering and codepoint bounds preserve exact nonASCII identities',async()=>{
 const astral='𐀀',bmp='',name='😀'.repeat(200),f=fixture({records:[row(astral),row(bmp),row(name,{legacy_sids:['😀'.repeat(200)],genotype:'😀'.repeat(2048)})],serverCap:1}),snapshot=await f.read();assert.deepEqual(snapshot.records.map(r=>r.mouse_sid),[bmp,astral,name].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))));assert.ok(snapshot.records.find(r=>r.mouse_sid===name));
});
test('legacy compact inference summaries retain only aligned display roles and qualitative confidence',async()=>{
 for(const kind of ['source_reconciliation_inference','cage_parent_candidates','litter_parent_candidates']){
  const payload={sire_sids:['1'],dam_sids:['2','3'],lineage_basis:{kind,schema_version:1,inferred_roles:['sire','dam'],confidence:'high'}},f=fixture({records:[row('4',payload)]}),snapshot=await f.read();assert.deepEqual(snapshot.records[0].lineage_basis,payload.lineage_basis);assert.ok(Object.isFrozen(snapshot.records[0].lineage_basis.inferred_roles));
 }
});
test('new compact recovery projection accepts recorded/source-recorded/inferred/uncertain roles without raw basis',async()=>{
 for(const status of ['recorded','source_recorded','inferred','uncertain']){
  const basis={kind:'parentage_recovery_v1',schema_version:1,projection_only:true,roles:{sire:{evidence_status:status,parent_sids:['1'],...(status==='inferred'?{confidence:'moderate'}:{})}}},f=fixture({records:[row('4',{sire_sids:['1'],lineage_basis:basis})]}),snapshot=await f.read();assert.deepEqual(snapshot.records[0].lineage_basis,basis);assert.ok(Object.isFrozen(snapshot.records[0].lineage_basis.roles.sire.parent_sids));
 }
});
test('unexpected personal/scientific/source fields never enter returned projection',async()=>{
 for(const [field,value] of [['email','PRIVATE'],['manager','PRIVATE'],['comment','PRIVATE'],['notes','PRIVATE'],['source_record_id','PRIVATE'],['cage_sid','PRIVATE'],['genetic_profile',{calls:{secret:'PRIVATE'}}],['original_parentage',{sire:['PRIVATE']}],['prior_lineage_basis',{private:'PRIVATE'}],['password','PRIVATE']]){
  const f=fixture({records:[row('1',{[field]:value})]});await assert.rejects(f.read(),invalid);assert.equal(f.calls.length,2,field+' rejected at payload, before final verification');
 }
});
test('raw lineage basis, nested provenance/rules/contacts, false confidence and misaligned roles are refused',async()=>{
 const valid={kind:'parentage_recovery_v1',schema_version:1,projection_only:true,roles:{sire:{evidence_status:'inferred',parent_sids:['1'],confidence:'moderate'}}};
 const cases=[{kind:'user_parentage_correction',schema_version:1},{kind:'source_reconciliation_inference',schema_version:1,inferred_roles:['sire'],evidence_refs:[{literal:'PRIVATE'}]},{kind:'cage_parent_candidates',schema_version:1,inferred_roles:['sire'],confidence:'certain'},{kind:'source_reconciliation_inference',schema_version:1,inferred_roles:['dam']},{kind:'source_reconciliation_inference',schema_version:1,inferred_roles:['sire','sire']},{...valid,projection_only:false},{...valid,original_parentage:{sire:['PRIVATE']}},{...valid,roles:{sire:{...valid.roles.sire,rule:'PRIVATE'}}},{...valid,roles:{sire:{evidence_status:'source_recorded',parent_sids:['1'],confidence:'high'}}},{...valid,roles:{sire:{evidence_status:'biologically_confirmed',parent_sids:['1']}}},{...valid,roles:{sire:{...valid.roles.sire,parent_sids:['2']}}},{...valid,roles:{other:valid.roles.sire}},{...valid,roles:{}}];
 for(const lineage_basis of cases){const f=fixture({records:[row('4',{sire_sids:['1'],lineage_basis})]});await assert.rejects(f.read(),invalid);}
});
test('projection array/scalar/identity bounds fail without trimming, dropping or interpreting values',async()=>{
 const cases=[{sire_sids:'1'},{sire_sids:null},{legacy_sids:[1]},{dam_sids:[' 1']},{sire_sids:['1\n']},{legacy_sids:['x'.repeat(201)]},{sire_sids:Array(1001).fill('1')},{physical_tag:'x'.repeat(2049)},{sex:null},{genotype:{confirmed:true}},{canonical_sid:''},{canonical_sid:' x '},{archived:'true'}];
 for(const payload of cases){const f=fixture({records:[row('4',payload)]});await assert.rejects(f.read(),invalid);}
 const f=fixture({records:[row('4',{sire_sids:Array(1000).fill('1'),physical_tag:'x'.repeat(2048),sex:'Literal source sex',date_of_birth:'literal unknown date'})]});assert.equal((await f.read()).records[0].sire_sids.length,1000);
});
test('metadata never accepts payload or extra envelope fields, and projected envelope keys are exact',async()=>{
 for(const target of ['metadata','records'])for(const extra of ['payload','email','updated_by']){
  const f=fixture({mutate:({page,phase})=>{if(phase!==target)return;if(extra==='payload'&&target==='records'){page.rows[0].payload.mouse_sid='different';return;}page.rows[0][extra]=extra==='payload'?null:'PRIVATE';}});await assert.rejects(f.read(),invalid);
 }
});
test('wrong colony/type/ID/version/archive and malformed page headers are refused',async()=>{
 for(const change of [r=>r.colony_id=OTHER,r=>r.entity_type='archive',r=>r.entity_id='',r=>r.version=true,r=>r.version=0,r=>r.version=1.5,r=>r.version=Number.MAX_SAFE_INTEGER+1,r=>r.archived='false']){
  const f=fixture({mutate:({page})=>change(page.rows[0])});await assert.rejects(f.read(),invalid);assert.equal(f.calls.length,1);
 }
 for(const change of [p=>p.schema_version=true,p=>p.scope='full_export',p=>p.metadata_only=false,p=>p.snapshot_revision='A'.repeat(32),p=>p.snapshot_revision='a'.repeat(31),p=>p.total_rows='3',p=>p.total_rows=-1,p=>p.total_rows=100001,p=>p.secret='PRIVATE',p=>delete p.next_after]){
  const f=fixture({mutate:({page})=>change(page)});await assert.rejects(f.read(),invalid);assert.equal(f.calls.length,1);
 }
});
test('duplicates/nonadvancing/missing/phantom/count/cursor mistakes cannot complete any scan',async()=>{
 const mutations=[({page})=>page.rows.push(clone(page.rows[0])),({page})=>page.rows.reverse(),({page})=>page.rows.pop(),({page})=>page.next_after='not-last',({page})=>page.next_after=page.rows.at(-1).entity_id,({page})=>{page.rows=[];page.next_after='3';},({page})=>page.total_rows=2];
 for(const mutate of mutations){const f=fixture({mutate});await assert.rejects(f.read(),invalid);}
 const early=fixture({serverCap:1,mutate:({page})=>page.next_after=null});await assert.rejects(early.read(),invalid);
});
test('payload and final metadata must match every initial tuple, total and opaque revision',async()=>{
 for(const target of ['records','verify'])for(const mutate of [p=>p.snapshot_revision=NEXT_REV,p=>p.total_rows=4,p=>p.rows[0].version++,p=>p.rows[0].archived=true,p=>p.rows[0].entity_id='unexpected']){
  const f=fixture({mutate:({page,phase})=>{if(phase===target)mutate(page);}});await assert.rejects(f.read(),invalid);
 }
 const late=fixture({serverCap:1,mutate:({page,phase,params})=>{if(phase==='verify'&&params.p_after==='1')page.rows[0].version++;}});await assert.rejects(late.read(),invalid);
});
test('revision or total changes within initial pagination fail before payload loading',async()=>{
 const f=fixture({serverCap:1,mutate:({page,params})=>{if(params.p_after==='1')page.snapshot_revision=NEXT_REV;}});await assert.rejects(f.read(),error=>error.code==='FAMILY_PEDIGREE_CHANGED');assert.ok(f.calls.every(c=>c.p_metadata_only));
});
test('account/colony/role/provider/permission context changes after any IO prevent snapshot return',async()=>{
 for(const changed of ['other-account','other-colony','other-role','cloud2','family-denied','guest-window-expired']){
  const f=fixture({requestHook:({setContext})=>setContext(changed)});await assert.rejects(f.read(),error=>error.code==='FAMILY_PEDIGREE_CONTEXT_CHANGED');assert.equal(f.calls.length,1);
 }
 const f=fixture();await assert.rejects(f.read({onProgress:value=>{if(value.phase==='records')f.setContext('new-role');}}),error=>error.code==='FAMILY_PEDIGREE_CONTEXT_CHANGED');assert.equal(f.calls.length,1,'context changed before payload IO');
});
test('cancel before IO or during a pending read rejects immediately and never consumes a late result',async()=>{
 const before=new AbortController(),f=fixture();before.abort();await assert.rejects(f.read({signal:before.signal}),error=>error.name==='AbortError');assert.equal(f.calls.length,0);
 let resolve,called=0;const pending=new Promise(done=>resolve=done),controller=new AbortController(),result=readFamilyPedigree({colonyId:COLONY,request:()=>{called++;return pending;},getContext:()=> 'same',signal:controller.signal});controller.abort();await assert.rejects(result,error=>error.name==='AbortError');resolve({payload:'PRIVATE_LATE'});await setImmediate();assert.equal(called,1);
});
test('original transport failures propagate without retries or fallback; context changes still supersede them',async()=>{
 const error=Object.assign(new Error('Synthetic transport unavailable'),{code:'UNAVAILABLE'});let calls=0;await assert.rejects(readFamilyPedigree({colonyId:COLONY,request:()=>{calls++;throw error;},getContext:()=> 'same'}),e=>e===error);assert.equal(calls,1);
 let context='before';await assert.rejects(readFamilyPedigree({colonyId:COLONY,request:()=>{context='after';throw error;},getContext:()=>context}),e=>e.code==='FAMILY_PEDIGREE_CONTEXT_CHANGED');
});
test('row/page/read limits are strict and a JSON byte-clamped short page may still continue',async()=>{
 const f=fixture({records:[row('1'),row('2'),row('3')]});await assert.rejects(f.read({maxRows:2}),invalid);assert.equal(f.calls.length,1);
 const oversized=fixture({records:[row('4',{legacy_sids:Array(1000).fill('x'.repeat(200)),sire_sids:Array(1000).fill('y'.repeat(200)),dam_sids:Array(1000).fill('z'.repeat(200))}),row('5',{legacy_sids:Array(1000).fill('x'.repeat(200)),sire_sids:Array(1000).fill('y'.repeat(200)),dam_sids:Array(1000).fill('z'.repeat(200))})]});await assert.rejects(oversized.read(),invalid);
 const tooMany=fixture({records:Array.from({length:251},(_,i)=>row(String(i).padStart(3,'0'))),mutate:({page,phase})=>{if(phase==='metadata'&&page.rows.length===250)page.rows.push({...page.rows[249],entity_id:'251'});}});await assert.rejects(tooMany.read(),invalid);
 for(const options of [{pageSize:0},{pageSize:251},{maxRows:0},{maxRows:100001},{colonyId:'not-a-uuid'},{getContext:()=>null},{signal:{aborted:false}}])await assert.rejects(f.read(options),error=>['FAMILY_PEDIGREE_INVALID_ARGUMENT','FAMILY_PEDIGREE_CONTEXT_CHANGED'].includes(error.code));
});
test('new payload copies stay isolated from transport objects and progress callbacks cannot rewrite returned records',async()=>{
 const original=freeze([row('1',{sire_sids:['2'],lineage_basis:{kind:'source_reconciliation_inference',schema_version:1,inferred_roles:['sire'],confidence:'moderate'}})]),f=fixture({records:original}),before=JSON.stringify(original),snapshot=await f.read({onProgress:()=>{throw Error('Ignored presentation failure');}});assert.equal(JSON.stringify(original),before);assert.notEqual(snapshot.records[0],original[0].payload);assert.notEqual(snapshot.records[0].sire_sids,original[0].payload.sire_sids);assert.deepEqual(snapshot.records[0],original[0].payload);
});
