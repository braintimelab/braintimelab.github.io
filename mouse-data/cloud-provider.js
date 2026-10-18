import {createCloudBridge} from './cloud-bridge.js?v=137';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const READ_RPCS=new Set(['get_lac_fee_visibility','get_lac_fee_records','get_managed_locations','get_export_permission','assert_full_export_permission','export_records','export_locobox_records','get_local_backup_permission','export_local_backup_records','list_app_access','list_app_access_filtered','list_lab_members','list_cage_managers','list_cage_note_hints','get_my_lab_member','get_lab_user_directory','get_lab_collaboration_members','get_animal_sheet_import_status','get_animal_sheet_import_conflicts','get_experiment_sheet_import_status','get_experiment_sheet_import_conflicts','get_brainbot_status','get_guest_mouse_records','list_guest_access','reagents_list','reagents_history','reagents_sources','reagents_observations','reagents_access','reagents_order_search','reagents_order_list','reagents_order_locations']);
export const CLOUD_COMMAND_KINDS=Object.freeze(Object.fromEntries(['save_records','save_guest_mouse_records'].map(name=>['rpc/'+name,'mouse.'+name]).concat(['save','record_usage','order_submit','order_transition','order_set_location'].map(name=>['rpc/reagents_'+name,'reagents.'+name]))));
const clone=value=>structuredClone(value);
const problem=(code,message,details={})=>Object.assign(new Error(message),{code,...details});

/** POST is also used for read RPCs. Unknown RPCs are always treated as writes. */
export function isCloudRead(route,method='GET'){
 if(method==='GET')return true;
 return method==='POST'&&route.startsWith('rpc/')&&READ_RPCS.has(route.slice(4));
}
export function cloudUnavailable(error){return error?.code==='UNAVAILABLE'||error?.connectionUnavailable===true||error?.statementTimeout===true||error instanceof TypeError&&/fetch|network|load failed/i.test(error.message);}
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

/** The NAS session stays in memory. Supabase tokens never enter this adapter. */
export function createCloud2Adapter({url,fetch:fetcher=globalThis.fetch,origin=globalThis.location?.origin,timeout=30000,onSession=()=>{}}={}){
 const base=cloud2Endpoint(url,{origin});let bearer=null,csrf=null,verified=null,refreshing=null,epoch=0;
 const state=()=>verified?clone(verified):null;
 const sameOrigin=base&&base.origin===origin;
 async function transport(path,{method='GET',body,signal}={}){
  if(!base)throw problem('NOT_READY','Cloud 2 is not configured.');
  const requestEpoch=epoch,controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const response=await fetcher(new URL(path,base).href,{method,mode:sameOrigin?'same-origin':'cors',credentials:sameOrigin?'same-origin':'omit',cache:'no-store',redirect:'error',signal:controller.signal,headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(bearer?{Authorization:`Bearer ${bearer}`}:{}) ,...(method!=='GET'&&csrf?{'X-CSRF-Token':csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   let result;try{result=await response.json();}catch{throw problem('UNCONFIRMED','Cloud 2 returned an unreadable response.');}
   if(requestEpoch!==epoch)throw problem('CONTEXT_CHANGED','The Cloud 2 account changed. Reopen the connection.');
   if(!response.ok){
    const codes={401:'UNAUTHORIZED',403:'FORBIDDEN',502:'UNAVAILABLE',503:'UNAVAILABLE',504:'UNAVAILABLE'};
    const code=result?.code==='not_enrolled'?'NOT_ENROLLED':result?.code==='not_ready'?'NOT_READY':codes[response.status]||'REQUEST_FAILED';
    throw problem(code,result?.error||'Cloud 2 request failed.',{status:response.status,remoteCode:result?.code,connectionUnavailable:code==='UNAVAILABLE'});
   }
   return result;
  }catch(error){
   if(controller.signal.aborted&&!signal?.aborted)throw problem('UNAVAILABLE','Cloud 2 connection timed out.',{connectionUnavailable:true});
   throw providerFailure(error);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async function refreshSession(signal){
  if(!verified||Date.parse(verified.session_expires_at)>Date.now()+60000)return;
  if(!refreshing){const currentEpoch=epoch,task=(async()=>{const result=await transport('session/refresh',{method:'POST',body:{},signal});if(currentEpoch!==epoch)throw problem('CONTEXT_CHANGED','The Cloud 2 account changed.');if(!result?.user||result.user.id!==verified?.userId||!Number.isFinite(Date.parse(result.session_expires_at))||Date.parse(result.session_expires_at)<=Date.now())throw problem('UNAUTHORIZED','Cloud 2 sign-in could not be renewed.');csrf=result.csrf_token;verified={...verified,csrf_token:csrf,session_expires_at:result.session_expires_at};onSession(state());})();refreshing=task;void task.finally(()=>{if(refreshing===task)refreshing=null;}).catch(()=>{});}
  return refreshing;
 }
 async function status({signal}={}){
  if(!base)return {state:'not_ready'};
  // Cross-origin cookies are omitted. Only an explicit Connect action can
  // supply the in-memory bearer required to make this a usable source.
  if(!sameOrigin&&!bearer)return {state:'signed_out'};
  const currentEpoch=epoch;
  const probe=new AbortController(),abort=()=>probe.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)probe.abort();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{probe.abort();reject(problem('UNAVAILABLE','Cloud 2 status check timed out.',{connectionUnavailable:true}));},Math.min(timeout,5000));});
  try{
   const result=await Promise.race([(async()=>{await refreshSession(probe.signal);const value=await transport('session/status',{signal:probe.signal});if(probe.signal.aborted)throw problem('UNAVAILABLE','Cloud 2 status check timed out.',{connectionUnavailable:true});return value;})(),deadline]);
   if(currentEpoch!==epoch)throw problem('CONTEXT_CHANGED','The Cloud 2 account changed.');
   if(result?.state!=='online'){verified=null;csrf=null;onSession(null);return result;}
   if(!UUID.test(result.userId||'')||!UUID.test(result.colonyId||'')||result.enrolled!==true||!['owner','manager','editor','viewer'].includes(result.role)||!Number.isFinite(Date.parse(result.session_expires_at))||Date.parse(result.session_expires_at)<=Date.now())throw problem('FORBIDDEN','Cloud 2 identity could not be verified.');
   if(!bearer&&(!sameOrigin||typeof result.csrf_token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(result.csrf_token)))throw problem('UNAUTHORIZED','Sign in to Cloud 2 in this app.');
   csrf=result.csrf_token||null;verified=clone(result);onSession(state());return result;
  }catch(error){if(currentEpoch===epoch){verified=null;csrf=null;onSession(null);}throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 function setBearer(value){
  if(value!==null&&(typeof value!=='string'||value.length<32||value.length>8192||/[\s\x00-\x1f]/.test(value)))throw new Error('Invalid Cloud 2 session.');
  epoch++;bearer=value;csrf=null;verified=null;refreshing=null;onSession(null);
 }
 async function request(query,signal){await refreshSession(signal);return transport('request',{method:'POST',body:query,signal});}
 return {idempotentWrites:true,status,getSession:state,setBearer,clear(){epoch++;bearer=null;csrf=null;verified=null;refreshing=null;onSession(null);},
  async read({query,signal}){const value=await request(query,signal);if(!value||!Object.hasOwn(value,'result'))throw problem('UNCONFIRMED','Cloud 2 read could not be confirmed.');return value.result;},
  submit:({operation,signal})=>request({operation_id:operation.operation_id,...operation.request},signal),
  async receipt({operationId,signal}){await refreshSession(signal);try{return await transport('receipt?'+new URLSearchParams({operation_id:operationId}),{signal});}catch(error){if(error.status===404&&error.remoteCode==='UNKNOWN_OPERATION')return null;throw error;}},
  async conflicts({signal,after}={}){await refreshSession(signal);return transport('conflicts'+(after?'?'+new URLSearchParams({after}):''),{signal});},
  async cancel({operationId,reason,signal}){await refreshSession(signal);return transport('cancel',{method:'POST',body:{operation_id:operationId,reason},signal});},
  activity:body=>transport('request',{method:'POST',body:{route:'rpc/record_app_access',method:'POST',body}}),
  async sync({signal}={}){await refreshSession(signal);return transport('sync',{method:'POST',body:{},signal});},
  async signOut(){const currentEpoch=epoch;try{if(verified||bearer)await transport('session/logout',{method:'POST',body:{}});}finally{if(currentEpoch===epoch){epoch++;bearer=null;csrf=null;verified=null;refreshing=null;onSession(null);}}}};
}

export function createCloudProvider({cloud1,cloud2,getContext,onChange=()=>{},journal=null,uuid=()=>crypto.randomUUID()}={}){
 const bridge=createCloudBridge({adapters:{cloud1,cloud2},getContext,onChange,journal});
 async function request(route,{method='GET',body}={}){
  const query={route,method,...(body===undefined?{}:{body:clone(body)})};
  if(isCloudRead(route,method))return (await bridge.read(query)).data;
  const receipt=await bridge.submit({operation_id:uuid(),request:query});
  if(receipt.access_changed)throw problem('FORBIDDEN','Account access changed. Verify current access before continuing.',{status:403,reagentsAccessChanged:true});
  if(receipt.status==='conflict')throw problem('CONFLICT','This record changed. Reload and review your edit.',{status:409,receipt});
  if(receipt.status==='rejected')throw problem('REJECTED',receipt.reason||'The cloud did not accept this change.',{receipt});
  if(!Object.hasOwn(receipt,'result'))throw problem('WRITE_UNCERTAIN','This write has no verified result. Check its operation before retrying.',{receipt});
  return receipt.result;
 }
 return {...bridge,request,cloud2};
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
    else if(value.type==='braintime-cloud2-session'&&Object.keys(value).length===3&&typeof value.token==='string'){
     if(finished)return;if(reset&&!resetAuthorized)throw new Error('Verify Cloud 1 before resetting your Cloud 2 password.');const result=await acceptSession(value.token);check();finish(null,result);
    }
   }catch(error){finish(error);}
  };
  const timer=setTimeout(()=>finish(new Error('Cloud 2 sign-in expired. Try connecting again.')),timeout);browser.addEventListener('message',receive);
 });
}
