// Synthetic transport/storage fixture; every identity, token and endpoint below is invented.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const cid='11111111-1111-4111-8111-111111111111',uid='22222222-2222-4222-8222-222222222222';
const configuration={url:'https://cloud.example',anonKey:'sb_publishable_synthetic',usernameAnonKey:'e30.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.synthetic',colonyId:cid,cloud2Url:'https://nas.example/cloud2/api/'};
class Storage{values=new Map();getItem(k){return this.values.get(k)??null;}setItem(k,v){this.values.set(k,String(v));}removeItem(k){this.values.delete(k);}}
let sequence=0;
async function fixture({nas=true,cloud=true,sourcePath=new URL(process.env.SESSION_STORE_TEST_URL||'../../mouse-data/data-store.js',import.meta.url)}={}){
 globalThis.localStorage=new Storage();globalThis.sessionStorage=new Storage();globalThis.location=new URL('https://nas.example/mouse-data/');
 const cache=new Map();globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},objectStoreNames:{contains:()=>true},transaction(){const tx={},updates=new Map();let pending=0;const run=fn=>{const r={};pending++;queueMicrotask(()=>{r.result=structuredClone(fn());r.onsuccess?.();if(--pending===0)queueMicrotask(()=>{for(const [k,v] of updates)v===undefined?cache.delete(k):cache.set(k,v);tx.oncomplete?.();});});return r;};tx.objectStore=()=>({get:k=>run(()=>{state.storageReads?.push(k);return updates.has(k)?updates.get(k):cache.get(k);}),put:(v,k)=>run(()=>updates.set(k,structuredClone(v))),delete:k=>run(()=>updates.set(k,undefined))});tx.abort=()=>queueMicrotask(()=>tx.onabort?.());return tx;}};request.onsuccess?.();});return request;}};
 const state={nas,cloud,userId:uid,role:'owner',calls:[],records:new Map(),receipts:new Map(),conflicts:[],loseWrite:false,loseBeforeWrite:false,denyNAS:false};
 const member=()=>({role:state.role,active:true,export_level:state.role==='owner'?'max':'low',permissions:{},guest_level:null,guest_permissions:{},updated_at:'2026-10-18T00:00:00Z'});
 const identity=()=>({state:'online',userId:state.userId,colonyId:cid,enrolled:true,ready:state.nasReady!==false,canRead:state.nasReady!==false,canWrite:state.nasReady!==false,role:state.role,exportLevel:state.role==='owner'?'max':'low',email:'member@example.test',name:'Synthetic Member',username:'synthetic',permissions:{},notes_permissions:state.notesPermissions??{},mousePermissions:state.mousePermissions??{},reagents_permissions:state.reagentsPermissions??{},guestLevel:null,guestPermissions:{},pending:state.receipts.size,conflicts:0,replicationCaughtUp:state.caughtUp===true,csrf_token:'c'.repeat(48),session_expires_at:new Date(Date.now()+(state.nasTTL??30*60_000)).toISOString()});
 function read(route,body={}){
  state.onRead?.(route);
  if(route==='rpc/resolve_lab_login')return state.resolver?state.resolver(body):{email:body.p_identifier,user_id:null,alias:false};
  if(route==='rpc/record_app_access')return {recorded:true,reason:'recorded',event_id:body.p_event_id,queued:true};
  if(route.startsWith('memberships?')){if(new URLSearchParams(route.split('?')[1]).get('select')?.startsWith('user_id,'))return [{user_id:uid,...member(),notes_permissions:{},mouse_permissions:{},reagents_permissions:{}}];return state.membershipRows??[member()];}
  if(route==='rpc/get_my_lab_member')return state.profile??{eligible:false};
  if(route==='rpc/list_guest_access')return state.guestAccess??{users:[]};
  if(route==='rpc/get_managed_record_page'){
   state.managedPages??=[];state.managedPages.push(structuredClone(body));state.onManaged?.(body);
   let rows=[...state.records.values()].filter(r=>r.entity_type===body.p_entity_type);
   if(body.p_scope==='event_types')rows=rows.filter(r=>body.p_event_types.includes(r.payload.event_type));
   if(['current','cage_cards'].includes(body.p_scope)){
    const currentMice=[...state.records.values()].filter(r=>r.entity_type==='mice'&&['Stock','Unknown'].includes(r.payload.state));
    const cages=new Set(currentMice.map(r=>r.payload.cage_sid));
    if(body.p_entity_type==='mice')rows=rows.filter(r=>['Stock','Unknown'].includes(r.payload.state));
    if(body.p_entity_type==='cages')rows=rows.filter(r=>!['Inactive','Ended'].includes(r.payload.state)||cages.has(r.entity_id));
    if(body.p_entity_type==='husbandry_events')rows=rows.filter(r=>r.payload.event_type!=='mouse_entrainment'||currentMice.some(m=>m.entity_id===r.payload.mouse_sid));
    if(body.p_entity_type==='matings')rows=rows.filter(r=>r.payload.state==='Active');
    if(body.p_entity_type==='litters')rows=[];
    if(body.p_entity_type==='husbandry_events')rows=rows.filter(r=>!['experiment','strain_definition','cryopreservation_lot','experiment_revision'].includes(r.payload.event_type)||r.payload.event_type==='experiment'&&['planned','in_progress'].includes(r.payload.experiment?.status));
   }
   if(body.p_scope==='cage_cards'&&body.p_entity_type==='husbandry_events')rows=rows.filter(r=>['locobox_protocol','mouse_entrainment','cage_equipment_status','cage_card_badge_status','cage_summary_options','experiment'].includes(r.payload.event_type));
   if(body.p_scope==='cage_cards'&&body.p_entity_type==='light_events')rows=rows.filter(r=>r.payload.source_current!==false&&r.payload.source_historical!==true&&r.payload.history_read_only!==true&&r.payload.record_origin!=='historical_google_sheet'||r.payload.cage_sid&&[...state.records.values()].some(m=>m.entity_type==='cages'&&m.entity_id===r.payload.cage_sid&&m.payload.state==='Active'));
   rows=rows.sort((a,b)=>a.entity_id<b.entity_id?-1:a.entity_id>b.entity_id?1:0).filter(r=>body.p_after===null||r.entity_id>body.p_after).slice(0,body.p_limit);
   return body.p_metadata_only?rows.map(({payload,...r})=>r):rows;
  }
  if(route.startsWith('entity_records?')){const q=new URLSearchParams(route.split('?')[1]),type=q.get('entity_type')?.slice(3),filter=q.get('entity_id'),limit=Number(q.get('limit')||1000);let rows=[...state.records.values()].filter(row=>!type||row.entity_type===type).sort((a,b)=>a.entity_id.localeCompare(b.entity_id));if(filter?.startsWith('eq.'))rows=rows.filter(r=>r.entity_id===filter.slice(3));if(filter?.startsWith('gt.'))rows=rows.filter(r=>r.entity_id>filter.slice(3));if(filter?.startsWith('in.(')){const selected=new Set(filter.slice(4,-1).split(','));rows=rows.filter(r=>selected.has(r.entity_id));}rows=rows.slice(0,limit);return q.get('select')?.includes('payload')?rows:rows.map(({payload,...row})=>row);}
  if(route==='rpc/get_lac_fee_visibility')return state.feePolicy??{version:0,owner:state.role==='owner',estimate:true,actual:true,source_archive_allowed:true};
  if(route==='rpc/reagents_access')return {permissions:{...member(),can_write:true,can_manage_safety:true,can_import:state.role==='owner',export_level:'max'},members:[]};
  if(route==='rpc/reagents_order_locations')return {locations:['Freezer A']};
  if(route.startsWith('rpc/reagents_'))return {rows:[],total:0,next_offset:null};
  throw Error('Unexpected read '+route);
 }
 function write(route,body){
  if(route==='rpc/save_records'){return body.p_changes.map(({expected_version,...row})=>{const next={...row,colony_id:cid,version:expected_version+1};state.records.set(row.entity_type+':'+row.entity_id,next);return next;});}
  if(route==='rpc/reagents_record_usage')return {item:{id:body.p_id,kind:'item',version:body.p_expected_version+1,payload:{name:'Synthetic reagent',remaining_amount:8}},usage:{id:body.p_event.id,kind:'usage',version:1,payload:body.p_event}};
  if(route.startsWith('rpc/reagents_order_'))return {request:{id:body.p_id||'position',version:(body.p_expected_version||0)+1,status:body.p_action==='approve'?'approved':'pending',...body.p_details,notifications:{approval:{status:'queued'}}}};
  if(route==='rpc/reagents_save')return {id:body.p_id,version:body.p_expected_version+1,payload:body.p_payload};
  throw Error('Unexpected write '+route);
 }
 globalThis.fetch=async(url,options={})=>{
  const u=new URL(url),body=options.body?JSON.parse(options.body):undefined;state.calls.push({url,options,body});await state.beforeFetch?.(u,body);
  if(u.origin==='https://nas.example'){
   if(!state.nas)return Response.json({error:'NAS unavailable'},{status:503});
   if(state.denyNAS)return Response.json({error:'Denied'},{status:403});
   if(u.pathname==='/cloud2/api/session/status')return state.nasSignedOut?Response.json({error:'Sign in to Cloud 2.'},{status:401}):Response.json(identity());
   if(u.pathname==='/cloud2/api/request'){
    if(body.operation_id){const result=write(body.route,body.body),receipt={operation_id:body.operation_id,status:'queued',result};state.receipts.set(body.operation_id,receipt);return Response.json(receipt);}
    return Response.json({result:read(body.route,body.body)});
   }
   if(u.pathname==='/cloud2/api/receipt')return Response.json(state.receipts.get(u.searchParams.get('operation_id'))||null);
   if(u.pathname==='/cloud2/api/conflicts')return Response.json({conflicts:state.conflicts,next_after:null});
   if(u.pathname==='/cloud2/api/cancel'){state.conflicts=state.conflicts.filter(row=>row.operation_id!==body.operation_id);return Response.json({operation_id:body.operation_id,status:'cancelled'});}
   throw Error('Unexpected NAS endpoint '+url);
  }
  if(u.origin!=='https://cloud.example')throw Error('Untrusted origin '+url);
  if(!state.cloud)throw new TypeError('Network unavailable');
  if(state.dataUnavailable&&u.pathname==='/rest/v1/entity_records'&&u.searchParams.get('entity_type')==='eq.mice')return Response.json({error:'Data unavailable'},{status:503});
  if(u.pathname==='/auth/v1/token'||u.pathname==='/functions/v1/username-sign-in')return Response.json({access_token:'CLOUD1-TOKEN',refresh_token:'CLOUD1-REFRESH',expires_in:3600,user:{id:state.cloudUserId||state.userId,email:'member@example.test',email_confirmed_at:'2026-01-01'}});
  if(u.pathname==='/auth/v1/user')return Response.json({id:state.cloudUserId||state.userId,email:'member@example.test',email_confirmed_at:'2026-01-01',is_anonymous:false,...state.authUser});
  if(u.pathname==='/functions/v1/manage-colony-users')return Response.json(state.managementReply??{viewer:{user_id:state.userId,role:state.role},colony_id:cid,users:[]});
  if(u.pathname==='/rest/v1/rpc/complete_lab_member_setup'){state.membershipRows=[member()];state.profile={...state.profile,setup_required:false,member:{...state.profile.member,username:body.p_username}};return Response.json(state.profile);}
  if(u.pathname==='/rest/v1/rpc/parallel_cloud_command'){
   assert([...cache.values()].some(value=>value?.entries?.some(entry=>entry.id===body.p_operation_id)),'command intent must commit before network mutation');
   if(state.loseBeforeWrite){state.loseBeforeWrite=false;throw TypeError('Network unavailable');}
   const route=body.p_kind.startsWith('mouse.')?'rpc/'+body.p_kind.slice(6):'rpc/reagents_'+body.p_kind.slice(9),result=write(route,{...body.p_args,p_colony_id:cid}),receipt={operation_id:body.p_operation_id,status:'applied',result};state.receipts.set(body.p_operation_id,receipt);if(state.loseWrite){state.loseWrite=false;throw TypeError('Network unavailable');}return Response.json(receipt);
  }
  if(u.pathname==='/rest/v1/rpc/parallel_cloud_receipt')return Response.json(state.receipts.get(body.p_operation_id)||null);
  if(u.pathname==='/rest/v1/rpc/get_managed_record_page'&&state.managedError)return Response.json({code:'PGRST202',message:'The managed record reader is not installed.'},{status:404});
  if(u.pathname.startsWith('/rest/v1/'))return Response.json(read(u.pathname.slice(9)+u.search,body));
  throw Error('Unexpected Cloud1 endpoint '+url);
 };
 let source=await readFile(sourcePath,'utf8');
 source=source.replace(/import \{ PUBLIC_CONFIG \} from '[^']+';/,`const PUBLIC_CONFIG=Object.freeze(${JSON.stringify(configuration)});`);
 source=source.replace(/from '([^']+)'/g,(_all,path)=>`from '${new URL(path,sourcePath).href}'`);
 const reload=()=>import('data:text/javascript;base64,'+Buffer.from(source+`\n//# sourceURL=parallel-store-fixture-${++sequence}.mjs`).toString('base64'));
 const store=await reload();store.configureCloud(configuration);return {store,state,cache,reload};
}


export {fixture,cid,uid};
