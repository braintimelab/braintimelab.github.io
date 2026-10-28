import {createCloudBridge,optionalPrimaryRead,managedRecordPageQuery} from './cloud-bridge.js?v=183';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const READ_RPCS=new Set(['get_family_pedigree_page','get_managed_record_page','get_lac_fee_visibility','get_lac_fee_records','get_managed_locations','get_export_permission','assert_full_export_permission','export_records','export_locobox_records','get_local_backup_permission','export_local_backup_records','list_app_access','list_app_access_filtered','list_lab_members','list_cage_managers','list_cage_note_hints','get_my_lab_member','get_lab_user_directory','get_lab_collaboration_members','get_animal_sheet_import_status','get_animal_sheet_import_conflicts','get_experiment_sheet_import_status','get_experiment_sheet_import_conflicts','get_brainbot_status','get_guest_mouse_records','get_member_mouse_records','list_guest_access','reagents_list','reagents_history','reagents_sources','reagents_observations','reagents_access','reagents_order_search','reagents_order_list','reagents_order_locations']);
export const CLOUD_COMMAND_KINDS=Object.freeze(Object.fromEntries(['save_records','save_guest_mouse_records'].map(name=>['rpc/'+name,'mouse.'+name]).concat(['save','record_usage','order_submit','order_transition','order_set_location'].map(name=>['rpc/reagents_'+name,'reagents.'+name]))));
const clone=value=>structuredClone(value);
const problem=(code,message,details={})=>Object.assign(new Error(message),{code,...details});
const CURRENT_TYPES=new Set(['mice','matings','litters','cages','rooms','racks','locations','light_events','husbandry_events']);

/** Recovery never replays an export or loads archive payloads on a status poll. */
export function cloud1RecoveryQuery(query,colonyId){
 if(!UUID.test(colonyId||''))return null;
 if(query===null)return {route:'entity_records?'+new URLSearchParams({select:'colony_id,entity_type,entity_id,version,archived',colony_id:`eq.${colonyId}`,entity_type:'eq.mice',limit:'1'}),method:'GET'};
 // A metadata endpoint may stay unavailable after current records recover.
 // Failback verifies the core data path without replaying that optional read.
 if(optionalPrimaryRead(query)&&query.body?.p_colony_id===colonyId)return cloud1RecoveryQuery(null,colonyId);
 const managed=managedRecordPageQuery(query,colonyId);
 if(managed)return {route:query.route,method:'POST',body:{...clone(managed),p_limit:1,p_metadata_only:true}};
 if(query?.method!=='GET'||!query.route?.startsWith('entity_records?'))return null;
 const params=new URLSearchParams(query.route.slice('entity_records?'.length)),type=params.get('entity_type')?.slice(3);
 if(params.get('colony_id')!==`eq.${colonyId}`||params.get('entity_type')!==`eq.${type}`||!CURRENT_TYPES.has(type))return null;
 // Use the same record endpoint and filters, but a single metadata row. The
 // normal current-record pull still verifies and adopts the actual payload.
 params.set('select','colony_id,entity_type,entity_id,version,archived');params.set('limit','1');
 return {route:'entity_records?'+params,method:'GET'};
}

/** POST is also used for read RPCs. Unknown RPCs are always treated as writes. */
export function isCloudRead(route,method='GET'){
 if(method==='GET')return true;
 return method==='POST'&&route.startsWith('rpc/')&&READ_RPCS.has(route.slice(4));
}
export function cloudUnavailable(error){return error?.code==='UNAVAILABLE'||error?.connectionUnavailable===true||error?.statementTimeout===true||error?.name==='AbortError'||error instanceof TypeError&&/fetch|network|load failed/i.test(error.message);}
export function providerFailure(error){
 if(error?.code&&['UNAVAILABLE','UNAUTHORIZED','FORBIDDEN','NOT_ENROLLED','NOT_READY'].includes(error.code))return error;
 if([401,403].includes(error?.status))return problem(error.status===401?'UNAUTHORIZED':'FORBIDDEN',error.message,{status:error.status});
 if(cloudUnavailable(error)||[502,503,504].includes(error?.status))return problem('UNAVAILABLE',error.message||'Cloud connection unavailable.',{connectionUnavailable:true,status:error.status,statementTimeout:error.statementTimeout===true});
 return error;
}

export function cloud2Endpoint(value,{origin=globalThis.location?.origin}={}){
 if(!value)return null;
 let url;try{url=new URL(value,origin);}catch{throw new Error('Use a valid Cloud 2 HTTPS address.');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!/^\/(?:[a-z0-9_-]+\/)*cloud2\/api\/?$/i.test(url.pathname))throw new Error('Use the Cloud 2 HTTPS API address without credentials or query parameters.');
 url.pathname=url.pathname.replace(/\/?$/,'/');return url;
}

/** NAS sessions restore only after a fresh server identity check. */
export function createCloud2Adapter({url,fetch:fetcher=globalThis.fetch,origin=globalThis.location?.origin,timeout=30000,onSession=()=>{},colonyId=null,getUserId=()=>null,now=()=>Date.now(),storage,sessionStorage:tabStorage,eventTarget=globalThis.window}={}){
 const base=cloud2Endpoint(url,{origin}),IDLE_MS=90*60000;let bearer=null,csrf=null,verified=null,epoch=0,rememberChoice=false,rememberDeadline=null,normalDeadline=null,restoredUser=null,lastActivityAttempt=-Infinity,activityPending=false,lastTrustedInput=-Infinity;
 if(storage===undefined)try{storage=globalThis.localStorage;}catch{storage=null;}
 if(tabStorage===undefined)try{tabStorage=globalThis.sessionStorage;}catch{tabStorage=null;}
 const scope=base&&UUID.test(colonyId||'')?encodeURIComponent(base.href)+':'+colonyId:null,storageKey=scope?'braintime.cloud2.remembered.v1:'+scope:null,normalPrefix=scope?'braintime.cloud2.session.v1:'+scope+':':null,normalIndex=normalPrefix&&normalPrefix+'active';
 const state=()=>verified?clone(verified):null;
 const sameOrigin=base&&base.origin===origin,opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
 const expectedUser=()=>{try{return getUserId()||null;}catch{return 'unavailable';}};
 const removeRemembered=()=>{try{if(storageKey)storage?.removeItem(storageKey);}catch{}};
 const removeNormal=()=>{try{if(!normalPrefix)return;const indexed=tabStorage?.getItem(normalIndex),user=restoredUser||expectedUser()||indexed;if(UUID.test(user||''))tabStorage?.removeItem(normalPrefix+user);if(!indexed||indexed===user)tabStorage?.removeItem(normalIndex);}catch{}};
 const readSaved=remembered=>{
  let key;try{
   const user=expectedUser(),indexed=!remembered&&normalIndex&&tabStorage?.getItem(normalIndex);key=remembered?storageKey:normalPrefix&&normalPrefix+(user||indexed||'');
   if(!remembered&&!UUID.test(user||indexed||''))return null;
   const text=key&&(remembered?storage:tabStorage)?.getItem(key);if(!text)return null;if(text.length>2048)throw Error();
   const row=JSON.parse(text),deadline=Date.parse(row?.expiresAt);
   if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='colonyId,expiresAt,schemaVersion,token,url,userId'||row.schemaVersion!==1||row.url!==base.href||row.colonyId!==colonyId||!UUID.test(row.userId||'')||user&&user!==row.userId||!remembered&&key!==normalPrefix+row.userId||!opaque(row.token)||!Number.isFinite(deadline)||deadline<=now()||deadline>now()+(remembered?7*86400000:IDLE_MS)+60000)throw Error();return row;
  }catch{try{if(key)(remembered?storage:tabStorage)?.removeItem(key);if(!remembered&&normalIndex)tabStorage?.removeItem(normalIndex);}catch{}return null;}
 };
 function reset({forget=true}={}){if(forget){removeRemembered();removeNormal();}epoch++;bearer=null;csrf=null;verified=null;rememberChoice=false;rememberDeadline=null;normalDeadline=null;restoredUser=null;lastActivityAttempt=-Infinity;activityPending=false;lastTrustedInput=-Infinity;onSession(null);}
 function persistIdentity(result,{allowIdleExtension=false}={}){
  if(!bearer)return;
  const absolute=Date.parse(result.session_absolute_expires_at),expires=Date.parse(result.session_expires_at),user=result.userId||result.user?.id,remembered=result.session_remembered===true;
  let deadline=Math.min(absolute,expires);
  if(rememberChoice)deadline=Math.min(rememberDeadline,deadline);
  else if(!allowIdleExtension&&normalDeadline!==null)deadline=Math.min(normalDeadline,deadline);
  if(remembered!==rememberChoice||!Number.isFinite(deadline)||deadline<=now()||deadline>now()+(rememberChoice?7*86400000:IDLE_MS)+60000||!UUID.test(user||'')||restoredUser&&restoredUser!==user||expectedUser()&&expectedUser()!==user){reset();throw problem('UNAUTHORIZED','Cloud 2 sign-in could not be verified.');}
  restoredUser=user;result.session_expires_at=new Date(deadline).toISOString();
  if(rememberChoice){rememberDeadline=deadline;result.session_absolute_expires_at=new Date(deadline).toISOString();}
  else normalDeadline=deadline;
  const key=rememberChoice?storageKey:normalPrefix&&normalPrefix+user,target=rememberChoice?storage:tabStorage;if(!key)return;
  try{target?.setItem(key,JSON.stringify({schemaVersion:1,url:base.href,colonyId,userId:user,token:bearer,expiresAt:new Date(deadline).toISOString()}));if(!rememberChoice)tabStorage?.setItem(normalIndex,user);}catch{if(rememberChoice)removeRemembered();else removeNormal();}
 }
 const savedRemembered=readSaved(true),saved=savedRemembered||readSaved(false);if(saved){bearer=saved.token;rememberChoice=Boolean(savedRemembered);if(rememberChoice)rememberDeadline=Date.parse(saved.expiresAt);else normalDeadline=Date.parse(saved.expiresAt);restoredUser=saved.userId;}
 const storageChanged=event=>{if(!storageKey||event.key!==null&&event.key!==storageKey||!rememberChoice)return;const row=readSaved(true);if(!row||row.token!==bearer||restoredUser&&row.userId!==restoredUser){reset({forget:false});return;}rememberDeadline=Math.min(rememberDeadline,Date.parse(row.expiresAt));};
 eventTarget?.addEventListener?.('storage',storageChanged);
 async function transport(path,{method='GET',body,signal}={}){
  if(!base)throw problem('NOT_READY','Cloud 2 is not configured.');
  const deadline=rememberChoice?rememberDeadline:normalDeadline;
  if(deadline!==null&&deadline<=now()||restoredUser&&expectedUser()&&restoredUser!==expectedUser()){reset();throw problem('UNAUTHORIZED','Sign in to Cloud 2 again.');}
  const requestEpoch=epoch,controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const response=await fetcher(new URL(path,base).href,{method,mode:sameOrigin?'same-origin':'cors',credentials:sameOrigin?'same-origin':'omit',cache:'no-store',redirect:'error',signal:controller.signal,headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(bearer?{Authorization:`Bearer ${bearer}`}:{}) ,...(method!=='GET'&&csrf?{'X-CSRF-Token':csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   let result;try{result=await response.json();}catch{throw problem('UNCONFIRMED','Cloud 2 returned an unreadable response.');}
   if(requestEpoch!==epoch)throw problem('CONTEXT_CHANGED','The Cloud 2 account changed. Reopen the connection.');
   if(!response.ok){
    const codes={401:'UNAUTHORIZED',403:'FORBIDDEN',502:'UNAVAILABLE',503:'UNAVAILABLE',504:'UNAVAILABLE'};
    const code=result?.code==='not_enrolled'?'NOT_ENROLLED':result?.code==='not_ready'?'NOT_READY':codes[response.status]||'REQUEST_FAILED';
    if(response.status===401||response.status===403&&['NOT_ENROLLED','POLICY_REFRESH_REQUIRED','GUEST_ACCESS_EXPIRED','GUEST_ACCESS_NOT_STARTED','OFFLINE_GRANT_EXPIRED'].includes(result?.code))reset();
    throw problem(code,result?.error||'Cloud 2 request failed.',{status:response.status,remoteCode:result?.code,connectionUnavailable:code==='UNAVAILABLE'});
   }
   return result;
  }catch(error){
   if(controller.signal.aborted&&!signal?.aborted)throw problem('UNAVAILABLE','Cloud 2 connection timed out.',{connectionUnavailable:true});
   throw providerFailure(error);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async function userActivity(){
  if(!verified||rememberChoice||verified.session_remembered===true||activityPending||now()-lastActivityAttempt<60000)return;
  const currentEpoch=epoch,user=verified.userId;lastActivityAttempt=now();activityPending=true;
  try{
   const result=await transport('session/activity',{method:'POST',body:{}});
   if(currentEpoch!==epoch)throw problem('CONTEXT_CHANGED','The Cloud 2 account changed.');
   if(result?.user?.id!==user||result.session_remembered!==false||!Number.isFinite(Date.parse(result.session_expires_at))||Date.parse(result.session_expires_at)<=now())throw problem('UNAUTHORIZED','Cloud 2 sign-in could not be verified.');
   persistIdentity(result,{allowIdleExtension:true});csrf=result.csrf_token;verified={...verified,csrf_token:csrf,session_expires_at:result.session_expires_at,session_absolute_expires_at:result.session_absolute_expires_at,session_remembered:false};onSession(state());
  }finally{if(currentEpoch===epoch)activityPending=false;}
 }
 const trustedInput=event=>{if(event?.isTrusted!==true)return;if(event.type==='scroll'){if(now()-lastTrustedInput>1500)return;}else lastTrustedInput=now();void userActivity().catch(()=>{});};
 const activityEvents=['pointerdown','keydown','wheel','touchstart','touchmove','scroll'];
 for(const type of activityEvents)eventTarget?.addEventListener?.(type,trustedInput,{capture:true,passive:true});
 async function status({signal}={}){
  if(!base)return {state:'not_ready'};
  // Cross-origin cookies are omitted. A saved bearer remains untrusted until
  // this fresh status check confirms its current identity and remaining time.
  if(!sameOrigin&&!bearer)return {state:'signed_out'};
  const currentEpoch=epoch;
  const probe=new AbortController(),abort=()=>probe.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)probe.abort();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{probe.abort();reject(problem('UNAVAILABLE','Cloud 2 status check timed out.',{connectionUnavailable:true}));},Math.min(timeout,5000));});
  try{
   const result=await Promise.race([(async()=>{const value=await transport('session/status',{signal:probe.signal});if(probe.signal.aborted)throw problem('UNAVAILABLE','Cloud 2 status check timed out.',{connectionUnavailable:true});return value;})(),deadline]);
   if(currentEpoch!==epoch)throw problem('CONTEXT_CHANGED','The Cloud 2 account changed.');
   if(result?.state!=='online'){verified=null;csrf=null;onSession(null);return result;}
   if(!UUID.test(result.userId||'')||!UUID.test(result.colonyId||'')||colonyId&&result.colonyId!==colonyId||expectedUser()&&result.userId!==expectedUser()||result.enrolled!==true||!['owner','manager','editor','viewer'].includes(result.role)||!Number.isFinite(Date.parse(result.session_expires_at))||Date.parse(result.session_expires_at)<=now())throw problem('FORBIDDEN','Cloud 2 identity could not be verified.');
   if(!bearer&&(!sameOrigin||typeof result.csrf_token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(result.csrf_token)))throw problem('UNAUTHORIZED','Sign in to Cloud 2 in this app.');
   persistIdentity(result);csrf=result.csrf_token||null;verified=clone(result);onSession(state());return result;
  }catch(error){if(currentEpoch===epoch){if(['UNAUTHORIZED','FORBIDDEN'].includes(error.code))reset();else{verified=null;csrf=null;onSession(null);}}throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 function setBearer(value,{rememberDevice=false,expiresAt=null}={}){
  if(value!==null&&(typeof value!=='string'||value.length<32||value.length>8192||/[\s\x00-\x1f]/.test(value)))throw new Error('Invalid Cloud 2 session.');
  const deadline=Date.parse(expiresAt);if(typeof rememberDevice!=='boolean'||rememberDevice&&(!opaque(value)||!Number.isFinite(deadline)||deadline<=now()||deadline>now()+7*86400000+60000)||!rememberDevice&&expiresAt!==null&&(!Number.isFinite(deadline)||deadline<=now()||deadline>now()+IDLE_MS+60000))throw new Error('Invalid Cloud 2 sign-in duration.');
  reset();bearer=value;rememberChoice=rememberDevice;rememberDeadline=rememberDevice?deadline:null;normalDeadline=!rememberDevice&&expiresAt!==null?deadline:null;
 }
 const request=(query,signal)=>transport('request',{method:'POST',body:query,signal});
 return {idempotentWrites:true,status,getSession:state,setBearer,clear:reset,dispose(){eventTarget?.removeEventListener?.('storage',storageChanged);for(const type of activityEvents)eventTarget?.removeEventListener?.(type,trustedInput,{capture:true});reset({forget:false});},
  async read({query,signal}){const value=await request(query,signal);if(!value||!Object.hasOwn(value,'result'))throw problem('UNCONFIRMED','Cloud 2 read could not be confirmed.');return value.result;},
  submit:({operation,signal})=>request({operation_id:operation.operation_id,...operation.request},signal),
  async receipt({operationId,signal}){try{return await transport('receipt?'+new URLSearchParams({operation_id:operationId}),{signal});}catch(error){if(error.status===404&&error.remoteCode==='UNKNOWN_OPERATION')return null;throw error;}},
  conflicts:({signal,after}={})=>transport('conflicts'+(after?'?'+new URLSearchParams({after}):''),{signal}),
  cancel:({operationId,reason,signal})=>transport('cancel',{method:'POST',body:{operation_id:operationId,reason},signal}),
  activity:body=>transport('request',{method:'POST',body:{route:'rpc/record_app_access',method:'POST',body}}),
  sync:({signal}={})=>transport('sync',{method:'POST',body:{},signal}),
  async signOut(){const currentEpoch=epoch;try{if(verified||bearer)await transport('session/logout',{method:'POST',body:{}});}finally{if(currentEpoch===epoch)reset();}}};
}

export function createCloudProvider({cloud1,cloud2,getContext,onChange=()=>{},journal=null,uuid=()=>crypto.randomUUID(),primaryPolicy=false,sessionPolicy=false,getSessionCloud=()=>null,onSessionCloud=()=>{}}={}){
 const bridge=createCloudBridge({adapters:{cloud1,cloud2},getContext,onChange,journal,primaryPolicy,sessionPolicy,getSessionCloud,onSessionCloud});
  async function request(route,{method='GET',body,cloudSource=null,canCommit=()=>true,requiredSource=null}={}){
  const query={route,method,...(body===undefined?{}:{body:clone(body)})};
  if(isCloudRead(route,method))return (await bridge.read(query,{source:cloudSource,canCommit})).data;
  const state=bridge.getState();if(cloudSource&&state.sessionPolicy&&state.sessionCloud!==cloudSource)throw problem('SOURCE_CHANGED','The original session cloud must be used for this save.');
  const receipt=await bridge.submit({operation_id:uuid(),request:query},{requiredSource});
  if(receipt.access_changed)throw problem('FORBIDDEN','Account access changed. Verify current access before continuing.',{status:403,reagentsAccessChanged:true});
  if(receipt.status==='conflict')throw problem('CONFLICT','This record changed. Reload and review your edit.',{status:409,receipt});
  if(receipt.status==='rejected')throw problem('REJECTED',receipt.reason||'The cloud did not accept this change.',{receipt});
  if(!Object.hasOwn(receipt,'result'))throw problem('WRITE_UNCERTAIN','This write has no verified result. Check its operation before retrying.',{receipt});
  return receipt.result;
 }
 return {...bridge,request,cloud2,dispose(){cloud2.dispose?.();bridge.dispose();}};
}

/** A clicked Connect action opens the NAS as a first-party login surface. */
export function openCloud2SignIn({url,window:browser=globalThis.window,crypto:cryptoAPI=globalThis.crypto,origin=globalThis.location?.origin,getEnrollmentToken=async()=>null,acceptSession,check=()=>{},reset=false,timeout=5*60*1000}={}){
 const base=cloud2Endpoint(url,{origin});if(!base||typeof acceptSession!=='function')return Promise.reject(new Error('Cloud 2 sign-in is not configured.'));
 const bytes=cryptoAPI.getRandomValues(new Uint8Array(32)),state=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
 const auth=new URL('../auth/start',base);auth.searchParams.set('return_origin',origin);auth.searchParams.set('state',state);
 const popup=browser.open(auth.href,'braintime-cloud2-auth','popup,width=520,height=720');if(!popup)return Promise.reject(new Error('Allow the Cloud 2 sign-in window, then try again.'));
 return new Promise((resolve,reject)=>{
  let finished=false,enrolling=false,resetAuthorized=false;
  const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);browser.removeEventListener('message',receive);try{popup.close();}catch{}error?reject(error):resolve(result);};
  const receive=async event=>{
   const value=event.data;if(event.source!==popup||event.origin!==base.origin||!value||typeof value!=='object'||Array.isArray(value)||value.state!==state)return;
   try{
    check();
    if(value.type==='braintime-cloud2-auth-ready'&&Object.keys(value).length===2&&!enrolling){enrolling=true;const token=await getEnrollmentToken();check();if(reset&&!token)throw new Error('Sign in to Cloud 1 before resetting your Cloud 2 password.');if(token&&!finished){resetAuthorized=reset;popup.postMessage({type:'braintime-cloud2-enroll',state,cloud1Token:token,...(reset?{reset:true}:{})},base.origin);}}
    else if(value.type==='braintime-cloud2-session'&&[3,5].includes(Object.keys(value).length)&&Object.keys(value).every(key=>['type','state','token','rememberDevice','expiresAt'].includes(key))&&typeof value.token==='string'){
     const remembered=Object.keys(value).length===5;if(remembered&&(typeof value.rememberDevice!=='boolean'||value.rememberDevice===true&&(!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now()||Date.parse(value.expiresAt)>Date.now()+7*86400000+60000)||value.rememberDevice===false&&value.expiresAt!==null&&(!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now()||Date.parse(value.expiresAt)>Date.now()+90*60000+60000)))throw new Error('Invalid Cloud 2 remembered sign-in.');
     if(finished)return;if(reset&&!resetAuthorized)throw new Error('Verify Cloud 1 before resetting your Cloud 2 password.');const result=await acceptSession(value.token,{rememberDevice:remembered&&value.rememberDevice===true,expiresAt:remembered?value.expiresAt:null});check();finish(null,result);
    }
   }catch(error){finish(error);}
  };
  const timer=setTimeout(()=>finish(new Error('Cloud 2 sign-in expired. Try connecting again.')),timeout);browser.addEventListener('message',receive);
 });
}
