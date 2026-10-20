import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudBridge,managedRecordPageQuery} from '../mouse-data/cloud-bridge.js';
const identity={userId:'11111111-1111-4111-8111-111111111111',colonyId:'22222222-2222-4222-8222-222222222222',authEpoch:'synthetic'};
const page=(type='husbandry_events',limit=1000)=>({method:'POST',route:'rpc/get_managed_record_page',body:{p_colony_id:identity.colonyId,p_entity_type:type,p_scope:'cage_cards',p_event_types:[],p_after:null,p_limit:limit,p_metadata_only:false}});
const error=(code,extras={})=>Object.assign(new Error('Synthetic request'),{code,...extras});
const online=()=>({...identity,state:'online',ready:true,canRead:true,canWrite:true,enrolled:true});
test('cage-card timeout classification accepts only the two reviewed event types and no arbitrary feature or parameters',()=>{
 for(const type of ['husbandry_events','light_events'])assert(managedRecordPageQuery(page(type),identity.colonyId));
 for(const type of ['mice','cages','locations','archive'])assert.equal(managedRecordPageQuery(page(type),identity.colonyId),null);
 for(const overrides of [{p_event_types:['experiment']},{p_unknown:true},{p_limit:1001},{p_colony_id:identity.userId}])assert.equal(managedRecordPageQuery({...page(),body:{...page().body,...overrides}},identity.colonyId),null);
});
async function fixture(fail){
 let backupReads=0;const adapters={cloud1:{idempotentWrites:true,status:async()=>online(),read:fail},cloud2:{idempotentWrites:true,status:async()=>online(),read:async()=>{backupReads++;return [];}}};
 const bridge=createCloudBridge({adapters,getContext:()=>identity,primaryPolicy:true});await bridge.refresh();return {bridge,backupReads:()=>backupReads};
}
test('a confirmed cage-card SQL timeout shrinks pages on the same primary without marking it offline',async()=>{
 const limits=[],f=await fixture(async({query})=>{limits.push(query.body.p_limit);if(query.body.p_limit>250)throw error('UNAVAILABLE',{statementTimeout:true});return ['verified'];});
 for(const type of ['light_events','husbandry_events']){let limit=1000;for(;;)try{assert.equal((await f.bridge.read(page(type,limit),{source:'cloud1'})).source,'cloud1');break;}catch(failure){if(!failure.statementTimeout||limit<=1)throw failure;limit=Math.floor(limit/2);}}
 assert.deepEqual(limits,[1000,500,250,1000,500,250]);assert.equal(f.bridge.getState().sources.cloud1.state,'online');assert.equal(f.backupReads(),0);f.bridge.dispose();
});
test('a real cage-card denial remains a denial rather than a smaller-page or fallback retry',async()=>{
 const f=await fixture(async()=>{throw error('FORBIDDEN',{statementTimeout:true});});await assert.rejects(f.bridge.read(page(),{source:'cloud1'}),failure=>failure.code==='FORBIDDEN');assert.equal(f.bridge.getState().active,null);assert.equal(f.backupReads(),0);f.bridge.dispose();
});
