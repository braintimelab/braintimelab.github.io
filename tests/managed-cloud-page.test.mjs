import test from 'node:test';
import assert from 'node:assert/strict';
import {managedRecordPageQuery,createCloudBridge} from '../mouse-data/cloud-bridge.js';
import {isCloudRead,cloud1RecoveryQuery,createCloudProvider} from '../mouse-data/cloud-provider.js';
const colonyId='22222222-2222-4222-8222-222222222222';
const context={colonyId,userId:'11111111-1111-4111-8111-111111111111',authEpoch:'one'};
const page=(overrides={})=>({route:'rpc/get_managed_record_page',method:'POST',body:{p_colony_id:colonyId,p_entity_type:'mice',p_scope:'current',p_event_types:[],p_after:null,p_limit:1000,p_metadata_only:false,...overrides}});
const online=()=>({state:'online',...context,ready:true,canRead:true,canWrite:true,enrolled:true,replicationCaughtUp:true});
const timeout=()=>Object.assign(new Error('bounded statement timeout'),{code:'UNAVAILABLE',statementTimeout:true});

test('managed page read is classified as a read and never submitted as a command',async()=>{
 let reads=0,writes=0;
 const adapter={status:async()=>online(),read:async()=>{reads++;return [];},submit:async()=>{writes++;throw Error('unexpected write');}};
 const provider=createCloudProvider({cloud1:adapter,cloud2:{status:async()=>({state:'signed_out'})},getContext:()=>context,primaryPolicy:true});
 assert.equal(isCloudRead('rpc/get_managed_record_page','POST'),true);
 assert.deepEqual(await provider.request(page().route,page()),[]);assert.equal(reads,1);assert.equal(writes,0);provider.dispose();
});

test('scope classification rejects archives, another colony and malformed or broad arguments',()=>{
 assert.ok(managedRecordPageQuery(page(),colonyId));
 for(const body of [{p_entity_type:'archive'},{p_colony_id:context.userId},{p_scope:'anything'},{p_limit:0},{p_limit:1001},{p_limit:'1000'},{p_after:'\n'},{p_metadata_only:'true'},{extra:true},{p_event_types:['experiment']},{p_scope:'event_types'},{p_scope:'event_types',p_event_types:['experiment'],p_entity_type:'mice'},{p_scope:'event_types',p_entity_type:'husbandry_events',p_event_types:['invalid!']}])assert.equal(managedRecordPageQuery(page(body),colonyId),null,JSON.stringify(body));
 assert.equal(managedRecordPageQuery({...page(),method:'GET'},colonyId),null);
 assert.ok(managedRecordPageQuery(page({p_scope:'event_types',p_entity_type:'husbandry_events',p_event_types:['experiment','experiment_revision']}),colonyId));
});

test('recovery probes the same bounded scope as metadata only without mutating the request',()=>{
 const request=page({p_scope:'event_types',p_entity_type:'husbandry_events',p_event_types:['experiment'],p_after:'E10'}),before=structuredClone(request);
 assert.deepEqual(cloud1RecoveryQuery(request,colonyId),{...request,body:{...request.body,p_limit:1,p_metadata_only:true}});
 assert.deepEqual(request,before);
 assert.equal(cloud1RecoveryQuery(page({p_colony_id:context.userId}),colonyId),null);
});

test('a bounded managed page statement timeout keeps Cloud 1 for smaller page retry',async()=>{
 let backup=0;
 const bridge=createCloudBridge({getContext:()=>context,primaryPolicy:true,adapters:{cloud1:{status:async()=>online(),read:async()=>{throw timeout();}},cloud2:{status:async()=>online(),read:async()=>{backup++;return [];}}}});
 await bridge.refresh();await assert.rejects(bridge.read(page(),{source:'cloud1'}),e=>e.statementTimeout===true);
 assert.equal(bridge.getState().active,'cloud1');assert.equal(bridge.getState().sources.cloud1.state,'online');assert.equal(backup,0);bridge.dispose();
});

test('one-row timeout and network failures keep normal source-pinned outage behavior',async()=>{
 for(const issue of [timeout,()=>Object.assign(new Error('network'),{code:'UNAVAILABLE'})]){
  const bridge=createCloudBridge({getContext:()=>context,primaryPolicy:true,adapters:{cloud1:{status:async()=>online(),read:async()=>{throw issue();}},cloud2:{status:async()=>online(),read:async()=>{throw Error('must not replay source-pinned read');}}}});
  await bridge.refresh();await assert.rejects(bridge.read(page({p_limit:1}),{source:'cloud1'}),e=>e.code==='UNAVAILABLE');assert.equal(bridge.getState().sources.cloud1.state,'unavailable');bridge.dispose();
 }
});
