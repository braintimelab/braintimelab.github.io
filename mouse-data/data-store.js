import {createSourceReconciliation} from './source-reconciliation.js?v=183';
import {prepareOwnerSourceTagReview} from './source-tag-review.js?v=183';
import {validateSourceReconciliationRecord} from './source-import-validation.js?v=183';
import {APP_PERMISSION_KEYS,validAppPermissions} from './app-access.js?v=175';
import {isGuest,guestAllows,validateGuestPermissions,guestAvailabilityStatus,validateGuestAvailability} from './guest-access.js?v=175';
import {applyAnimalEntrainmentSync} from './entrainment-history.js?v=132';
import {clearHistoryIndex} from './history-index.js?v=100';
import { projectLocoboxExport } from './locobox-export.js?v=100';
import { PUBLIC_CONFIG } from './config.js?v=137';
import { validateManagerPermissions } from './permissions.js?v=100';
import { normalizeDataset, ID_FIELDS } from './model.js?v=174';
import {encodeArchive,decodeArchive,isArchiveChunk,partitionChanges,MAX_RPC_BYTES,utf8Size,ARCHIVE_MANIFEST_FORMAT} from './archive-format.js?v=174';
import {createCloudProvider,createCloud2Adapter,providerFailure,isCloudRead,CLOUD_COMMAND_KINDS,openCloud2SignIn,cloud1RecoveryQuery} from './cloud-provider.js?v=183';
import {createIntentJournal} from './cloud-intents.js?v=137';
import {managedCoverage,checkedManagedCoverage,mergeManagedCoverage,getDeferredManagedTables,getDeferredManagedEventTypes,MANAGED_EVENT_TYPES,currentCacheProjection} from './current-record-scope.js?v=174';
export {getDeferredManagedTables,getDeferredManagedEventTypes};

const CONFIG_KEY='mouse-colony.cloud.v1',SESSION_KEY='mouse-colony.session.v1',MODE_KEY='mouse-colony.mode.v1',DEMO_KEY='mouse-colony.trusted-demo.v1';
const CLOUD_CACHE_KEY='mouse-colony.cloud-cache-context.v1';
const SOURCE_PROJECTION_VERSION=2;
// Keep aligned with colony_private.managed_location_keys(). Raw Sheet blocks
// can include financial cells and must never enter a restricted cache or save.
const MANAGED_LOCATION_KEYS=new Set(['location_id','room_id','rack_id','label','row','column','capacity','locobox_id','active','state','manager','manager_acronym','notes','app_created_at','app_updated_at','app_modified_at','app_archived_at','archived','record_origin','evidence_status','requires_review','source_current','source_last_seen_at','source_snapshot_date','source_label_conflict','source_manager_name','source_manager_acronym','source_manager_status','source_observed_mouse_sids','source_observed_cage_sids','source_candidate_mouse_sids','source_candidate_cage_sids','source_unresolved_explicit_mouse_sids','source_observed_tags','source_cage_observation','cage_start','cage_entrainment']);
const MANAGED=Object.keys(ID_FIELDS);
const clone=value=>structuredClone(value);
let feeVisibility=null,feeVisibilityContext=null;
let authGeneration=0;
const guardedCacheWrites=new Set(),CACHE_WRITE_KEY='current-cloud-write',BASELINE_CACHE_KEY='current-cloud-baseline';
const STARTUP_CACHE_KEY='current-managed-snapshot',STARTUP_CACHE_VERSION=3,RECORD_BLOCK_SIZE=1000;
let startupCacheSnapshot=null;
const openingReads=new Map();
function openingCancelled(){return Object.assign(new Error('Opening paused while this window was in the background.'),{name:'AbortError',code:'STARTUP_CANCELLED'});}
// Only an explicitly supplied opening signal can cancel its read. Manual
// reloads, established edit baselines and writes never join this scope.
async function openingRead(signal,read){
 if(!signal)return read(()=>{},()=>true);
 let cancelled=false,rejectCancelled;
 const check=()=>{if(cancelled||signal.aborted)throw openingCancelled();};
 const canCommit=()=>!cancelled&&!signal.aborted;
 const cancel=()=>{if(cancelled)return;cancelled=true;if(startupCacheSnapshot?.signal===signal)startupCacheSnapshot=null;rejectCancelled(openingCancelled());};
 const paused=new Promise((_,reject)=>{rejectCancelled=reject;});
 const scope={cancel};openingReads.set(signal,scope);signal.addEventListener('abort',cancel,{once:true});
 try{check();return await Promise.race([Promise.resolve().then(()=>read(check,canCommit)),paused]);}
 finally{signal.removeEventListener('abort',cancel);if(openingReads.get(signal)===scope)openingReads.delete(signal);}
}
export function cancelStartupRead({signal}={}){
 if(!signal)return false;
 const scope=openingReads.get(signal);scope?.cancel();
 if(startupCacheSnapshot?.signal===signal)startupCacheSnapshot=null;
 return Boolean(scope);
}
const BASELINE_CACHE_VERSION=1,MAX_BASELINE_RECORDS=250000,MAX_BASELINE_BYTES=32*1024*1024;
let deferredArchiveState=null;
let managedReadCoverage=null;
let operationalProvider=null,operationalConfig=null,cloud2Identity=null,providerSource=null,providerRevision=0,providerSessionEpoch=0;
let primaryCloudPolicy=false,sessionCloudPolicy=false;
const SESSION_CLOUD_KEY='mouse-colony.session-cloud.v1',SESSION_CLOUD_ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
let cloud1SessionSuspended=false;
let verifiedIntentPolicy=null;
let cloud2ConflictPage={rows:[],nextAfter:null,binding:null};
const cloudConnectionListeners=new Set();
let versions=new Map(),baseline=null,baselineIdentity=null,synced=false,refreshPromise=null,statusMessage='',pendingEmail=null,pullGeneration=0;
const memory=new Map();
const activeDatasetSaves=new Set();
const READ_DEPENDENCY_TYPES=new Set(['mice','cages','locations','rooms','racks','husbandry_events','light_events']);
function getStorage(kind,key){try{return globalThis[kind]?.getItem(key)??null;}catch{return memory.get(`${kind}:${key}`)??null;}}
function setStorage(kind,key,value){try{if(!globalThis[kind])throw Error();value===null?globalThis[kind].removeItem(key):globalThis[kind].setItem(key,value);}catch{value===null?memory.delete(`${kind}:${key}`):memory.set(`${kind}:${key}`,value);}}
function readJSON(kind,key){try{return JSON.parse(getStorage(kind,key)||'null');}catch{return null;}}
const configuration=()=>readJSON('localStorage',CONFIG_KEY);
const session=()=>readJSON('sessionStorage',SESSION_KEY);
const hasLabSession=(s=session())=>!!s?.access_token||!!(s?.user?.id&&cloud2Identity?.userId===s.user.id&&Date.parse(cloud2Identity.session_expires_at)>Date.now());
const pendingAccount=s=>s?.role==='pending'||s?.setupRequired===true;
// Keep explicit malformed values visible to restriction checks; only absent maps default.
function appPermissionFields(source={},strict=false){const result={};for(const app of Object.keys(APP_PERMISSION_KEYS)){const camel=app+'Permissions',snake=app+'_permissions',value=Object.hasOwn(source||{},camel)?source[camel]:Object.hasOwn(source||{},snake)?source[snake]:{};if(strict&&!validAppPermissions(app,value))throw new Error('Application permissions could not be verified. Reconnect before opening records.');result[camel]=clone(value);}return result;}
const restrictedMouseMember=()=>{const s=session(),flags=appPermissionFields(s).mousePermissions;return s?.role&&s.role!=='owner'&&!isGuest(s)&&APP_PERMISSION_KEYS.mouse.some(key=>key.endsWith('.read')&&flags?.[key]===false);};

function assertGuestAvailability(member){
 const state=guestAvailabilityStatus(member);
 if(state==='active')return;
 const message=state==='expired'?'Your guest access has expired. Contact the lab manager.':state==='not_started'?'Your guest access has not started yet. Contact the lab manager.':'Guest availability could not be verified. Contact the lab manager.';
 throw Object.assign(new Error(message),{code:'GUEST_ACCESS_'+state.toUpperCase(),status:403,guestAccessUnavailable:true});
}
function guestAvailabilityFields(payload){
 const keys=['guest_access_starts_on','guest_access_ends_on'],changed=keys.some(key=>Object.hasOwn(payload,key));
 if(!changed)return null;
 if(!keys.every(key=>Object.hasOwn(payload,key)&&payload[key]!==undefined))throw new Error('Set both guest availability fields explicitly, using null for no expiry.');
 const errors=validateGuestAvailability(payload);if(errors.length)throw new Error(errors.join(' '));
 return {p_guest_access_starts_on:payload.guest_access_starts_on??null,p_guest_access_ends_on:payload.guest_access_ends_on??null};
}

const setupProfileAllowed=p=>!!p?.member&&(p.eligible===true&&p.setup_required===true||p.eligible!==true&&p.registration_allowed===true);
const setupBlocksAccess=p=>setupProfileAllowed(p)&&p?.setup_blocks_access!==false;
const mode=()=>getStorage('localStorage',MODE_KEY)==='cloud'?'cloud':'local';
function setMode(value){setStorage('localStorage',MODE_KEY,value);}
function invalidate(){synced=false;baseline=null;baselineIdentity=null;versions=new Map();deferredArchiveState=null;managedReadCoverage=null;startupCacheSnapshot=null;}
function saveSession(s){const before=session(),sameUser=Boolean(s?.user?.id&&before?.user?.id===s.user.id);if(!sameUser)setStorage('sessionStorage',SESSION_CLOUD_KEY,null);if(s&&sessionCloudPolicy)s={...s,sessionCloudId:sameUser&&SESSION_CLOUD_ID.test(before?.sessionCloudId||'')?before.sessionCloudId:SESSION_CLOUD_ID.test(s.sessionCloudId||'')?s.sessionCloudId:crypto.randomUUID()};else if(s&&sameUser&&before.sessionCloudId)s={...s,sessionCloudId:before.sessionCloudId};if(before?.user?.id!==s?.user?.id||Boolean(before?.access_token)!==Boolean(s?.access_token)){providerSessionEpoch++;verifiedIntentPolicy=null;cloud1SessionSuspended=false;}setStorage('sessionStorage',SESSION_KEY,s?JSON.stringify(s):null);}
function sessionEpoch(){return String(providerSessionEpoch)+(sessionCloudPolicy?':'+(session()?.sessionCloudId||''):'');}
function savedSessionCloud(){const c=configuration(),s=session(),r=readJSON('sessionStorage',SESSION_CLOUD_KEY);return sessionCloudPolicy&&c&&s?.user?.id&&SESSION_CLOUD_ID.test(s.sessionCloudId||'')&&r?.schemaVersion===1&&r.url===c.url&&r.colonyId===c.colonyId&&r.userId===s.user.id&&r.sessionCloudId===s.sessionCloudId&&['cloud1','cloud2'].includes(r.source)?r.source:null;}
function rememberSessionCloud(source){const c=configuration(),s=session();if(!sessionCloudPolicy||!c||!s?.user?.id||!SESSION_CLOUD_ID.test(s.sessionCloudId||'')||!['cloud1','cloud2'].includes(source))return;setStorage('sessionStorage',SESSION_CLOUD_KEY,JSON.stringify({schemaVersion:1,url:c.url,colonyId:c.colonyId,userId:s.user.id,sessionCloudId:s.sessionCloudId,source}));}

function stable(value){if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')}}`;return JSON.stringify(value);}
function advanceAuthGeneration(){authGeneration++;for(const cancel of guardedCacheWrites)cancel();return authGeneration;}
function beginAuthAction(){const generation=advanceAuthGeneration(),config=stable(configuration());const current=()=>generation===authGeneration&&stable(configuration())===config;return {current,check(){if(!current())throw new Error('The account or cloud configuration changed. Start sign-in again.');}};}
function passiveAuthAction(source=null){const generation=authGeneration,epoch=sessionEpoch(),config=stable(configuration()),userId=session()?.user?.id;const current=()=>generation===authGeneration&&epoch===sessionEpoch()&&stable(configuration())===config&&session()?.user?.id===userId;return {source,current,check(){if(!current())throw Object.assign(new Error('The account or cloud configuration changed. Reopen the shared colony.'),{code:'CONTEXT_CHANGED'});if(source&&(operationalProvider?operationalProvider.getState().active!==source:source!=='cloud1')){const state=operationalProvider?.getState(),failure=state?.sources?.[source]?.state;if(['signed_out','denied','not_enrolled'].includes(failure))throw Object.assign(new Error(failure==='signed_out'?'The cloud session expired. Sign in again.':'Your account no longer has access to this cloud.'),{code:failure==='signed_out'?'UNAUTHORIZED':'FORBIDDEN',status:failure==='signed_out'?401:403});throw Object.assign(new Error('The original cloud is unavailable. Retry when it reconnects.'),{code:failure==='unavailable'?'UNAVAILABLE':'SOURCE_CHANGED'});}}};}

let dbPromise,dbHandle;
function storageTimeout(operation){const error=new Error(`Browser storage stopped responding while ${operation}. Close other Mouse Data tabs, then try again.`);error.storageTimeout=true;return error;}
function closeDatabase(db){try{db.close();}catch{}if(dbHandle===db){dbHandle=null;dbPromise=null;}}
function database(){
  if(!globalThis.indexedDB)return Promise.reject(new Error('Local database storage is unavailable in this browser.'));
  if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
    // Version 2 closes v89 handles so its serializer cannot read deferred v90 caches.
    const request=indexedDB.open('mouse-colony',2);let settled=false;
    const fail=error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);};
    const timer=setTimeout(()=>fail(storageTimeout('opening the saved workspace')),30000);
    request.onupgradeneeded=()=>{if(settled){try{request.transaction?.abort();}catch{}return;}if(!request.result.objectStoreNames.contains('datasets'))request.result.createObjectStore('datasets');};
    request.onerror=()=>fail(new Error('Unable to open the local colony database.'));
    request.onsuccess=()=>{if(settled){try{request.result.close();}catch{}return;}settled=true;clearTimeout(timer);dbHandle=request.result;dbHandle.onversionchange=()=>closeDatabase(request.result);resolve(request.result);};
    request.onblocked=()=>fail(new Error('Close older colony tabs before updating local storage.'));
  }).catch(e=>{dbPromise=null;throw e;});
  return dbPromise;
}
async function discardCloudWrite(id){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('datasets','readwrite'),store=tx.objectStore('datasets'),request=store.get(CACHE_WRITE_KEY);let settled=false;
    const finish=(error=null)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
    const timer=setTimeout(()=>{const error=storageTimeout('checking the cloud cache');try{tx.abort();}catch{}finish(error);closeDatabase(db);},30000);
    request.onsuccess=()=>{if(!settled&&request.result?.id===id){store.delete('current');store.delete(CACHE_WRITE_KEY);store.delete(BASELINE_CACHE_KEY);store.delete(STARTUP_CACHE_KEY);}};
    tx.oncomplete=()=>finish();tx.onerror=tx.onabort=()=>finish(new Error('Unable to clear a cancelled cloud cache write.'));
  });
}
function ownCacheWrite(mark){
  const c=configuration(),s=session();
  return hasLabSession(s)&&mark.url===c?.url&&mark.colony===c?.colonyId&&mark.user===s.user?.id;
}
function startupProjection(data){return currentCacheProjection(data);}
async function local(action,value,{check,cacheWrite,syncBaseline=null,readBaseline=false,managedOnly=false}={}){
  // The opening sidecar carries only current rows and their matching version
  // tuples. Reading a full history baseline here defeated the compact cache.
  const startup=action==='put'&&cacheWrite?await startupCacheValue(value,syncBaseline,cacheWrite.id,check):null;
  const db=await database();check?.();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('datasets',action==='get'?'readonly':'readwrite'),store=tx.objectStore('datasets');
    let request=action==='get'?store.get(managedOnly?STARTUP_CACHE_KEY:'current'):action==='delete'?store.delete('current'):store.put(clone(value),'current');
    if(action!=='get'){
      if(action==='delete'||!cacheWrite)store.delete(STARTUP_CACHE_KEY);
      else store.put(startup,STARTUP_CACHE_KEY);
    }
    // The sidecar and dataset commit atomically. It never enters a dataset/export.
    const markRequest=action==='get'?store.get(CACHE_WRITE_KEY):cacheWrite?store.put(cacheWrite,CACHE_WRITE_KEY):store.delete(CACHE_WRITE_KEY);
    const baselineRequest=action==='get'?(readBaseline&&!managedOnly?store.get(BASELINE_CACHE_KEY):null):syncBaseline?store.put(syncBaseline,BASELINE_CACHE_KEY):store.delete(BASELINE_CACHE_KEY);
    let result,mark,savedBaseline,guardError,settled=false,managedSnapshot=false;
    const cleanup=()=>{clearTimeout(timer);guardedCacheWrites.delete(cancel);};
    const fail=error=>{if(settled)return;settled=true;cleanup();reject(error);};
    const cancel=()=>{if(settled)return;try{check?.();}catch(error){guardError=error;try{tx.abort();}catch{/* A committed write is removed by its own ID below. */}}};
    const timer=setTimeout(()=>{guardError=storageTimeout(action==='get'?'reading the saved workspace':'saving the workspace');try{tx.abort();}catch{}fail(guardError);closeDatabase(db);},30000);
    if(check)guardedCacheWrites.add(cancel);
    const acceptRead=()=>{
      if(settled)return;
      if(action==='get'&&managedOnly&&!request.result&&!managedSnapshot){
        // Old installations have no compact sidecar. Read the legacy cache
        // once; the next verified pull commits the smaller startup snapshot.
        managedOnly=false;request=store.get('current');request.onsuccess=acceptRead;return;
      }
      if(action==='get'&&managedOnly){managedSnapshot=true;const saved=request.result;result=saved?.schema_version===STARTUP_CACHE_VERSION&&typeof saved.write_id==='string'?saved:null;if(readBaseline)savedBaseline=result?.baseline??null;}
      else result=request.result;
      cancel();
    };
    request.onsuccess=acceptRead;
    markRequest.onsuccess=()=>{if(settled)return;if(action==='get')mark=markRequest.result;cancel();};
    if(baselineRequest)baselineRequest.onsuccess=()=>{if(settled)return;if(action==='get')savedBaseline=baselineRequest.result;cancel();};
    tx.oncomplete=()=>{
      if(settled)return;settled=true;cleanup();
      try{
        check?.();if(guardError)throw guardError;
        if(action==='get'&&managedSnapshot){if(!result||result.write_id!==mark?.id)result=null;else result=result.data;}
        if(action==='get'&&mark&&(!ownCacheWrite(mark)||mark.id!==readJSON('localStorage',CLOUD_CACHE_KEY)?.write_id)){
          // A matching but not-yet-published write may still be finishing. Hide it.
          // A previous account's write can be discarded by ID without touching a newer cache.
          if(!ownCacheWrite(mark)&&typeof mark.id==='string')void discardCloudWrite(mark.id).then(()=>resolve(null),()=>resolve(null));
          else resolve(null);
        }else resolve(readBaseline?{data:result??null,baseline:savedBaseline??null,mark:mark??null}:result??null);
      }
      catch(error){if(cacheWrite)void discardCloudWrite(cacheWrite.id).then(()=>reject(error),()=>reject(error));else reject(error);}
    };
    tx.onerror=()=>fail(guardError||new Error('Local database write failed. No save was confirmed.'));
    tx.onabort=()=>fail(guardError||new Error('Local database transaction was cancelled.'));
  });
}
export async function loadDataset(){
 if(session()?.passwordRecovery||pendingAccount(session()))return null;
 const generation=authGeneration;
 if(mode()==='cloud'&&hasLabSession())await membership();
 if(isGuest(session())||restrictedMouseMember())return pullFromCloud({deferHistory:true});
 const d=await local('get');if(!d||generation!==authGeneration||session()?.passwordRecovery||pendingAccount(session()))return null;
 if(mode()==='cloud'||readJSON('localStorage',CLOUD_CACHE_KEY)){
  const c=configuration(),u=session()?.user?.id,previous=readJSON('localStorage',CLOUD_CACHE_KEY);
  if(!u||!c||(previous&&(previous.url!==c.url||previous.colony!==c.colonyId||previous.user!==u))){await local('delete');return null;}
  const policy=await refreshFeeVisibility({notify:false});
  if(!policy.source_archive_allowed&&!currentRestrictedCache(d,previous,policy))return pullFromCloud();
  if(policy.source_archive_allowed&&d.source_archive_restricted)return pullFromCloud();
 }
 if(generation!==authGeneration||session()?.passwordRecovery||pendingAccount(session()))return null;
 return normalizeDataset(d);
}
// An optional startup preview is authorized afresh but never becomes a
// writable cloud baseline. A denied, stale or incompatible cache stays hidden.
export async function loadStartupCache({currentOnly=false,signal}={}){
 return openingRead(signal,(check,canCommit)=>loadStartupCacheOnce({currentOnly,signal,checkOpening:check,canCommit}));
}
async function loadStartupCacheOnce({currentOnly=false,signal,checkOpening=()=>{},canCommit=()=>true}={}){
 checkOpening();
 const initial=session(),c=configuration();
 if(mode()!=='cloud'||!c||!initial?.user?.id||!hasLabSession(initial)||initial.passwordRecovery||pendingAccount(initial))return null;
 const previous=readJSON('localStorage',CLOUD_CACHE_KEY);
 // Without an account-matching cache marker there is no preview to unlock.
 // The following authoritative pull still verifies membership and policy.
 if(!previous||previous.url!==c.url||previous.colony!==c.colonyId||previous.user!==initial.user.id)return null;
 if(currentOnly&&previous.startup_cache_version!==STARTUP_CACHE_VERSION)return null;
 invalidate();
 try{
  await verifyCloudMembership({canCommit});checkOpening();
  const generation=authGeneration,identity=syncIdentity(),context=exportContext();
  const check=()=>{checkOpening();if(generation!==authGeneration||identity!==syncIdentity()||session()?.passwordRecovery||pendingAccount(session()))throw new Error('The account changed while checking the saved workspace.');checkExportContext(context);};
  check();const mark=readJSON('localStorage',CLOUD_CACHE_KEY);
  if(!mark||mark.url!==c.url||mark.colony!==c.colonyId||mark.user!==initial.user.id)return null;
  const snapshot=await local('get',undefined,{check,readBaseline:true,managedOnly:true});check();const data=snapshot?.data;if(!data)return null;
  const policy=await refreshFeeVisibility({notify:false,canCommit});check();
  if(policy.source_archive_allowed?data.source_archive_restricted:!currentRestrictedCache(data,mark,policy))return null;
  // The preview is read-only until the live pull finishes. Do not normalize
  // source history from a previous visit just to paint the opening screen.
  const preview=normalizeDataset(startupProjection(data));check();
  startupCacheSnapshot={snapshot,identity:persistentIdentity(),generation,source:providerSource,revision:providerRevision,writeId:mark.write_id,policy:clone(policy),verifiedAt:Date.now(),signal};
  return preview;
 }catch(error){checkOpening();return null;}
}
export async function clearDataset(){await local('delete');setStorage('localStorage',CLOUD_CACHE_KEY,null);setStorage('localStorage',DEMO_KEY,null);setMode('local');invalidate();statusMessage='Local dataset cleared.';}

function publicKey(key){
  if(typeof key!=='string'||!key.trim())throw new Error('A Supabase publishable or anon key is required.');
  if(key.startsWith('sb_secret_'))throw new Error('Secret and service-role keys must never be entered in the app.');
  if(key.startsWith('sb_publishable_'))return key;
  try{
    const part=key.split('.')[1];
    const claims=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));
    if(claims.role!=='anon')throw new Error();
  }catch{throw new Error('Use only the public anon or publishable key, never a service-role key.');}
  return key;
}
export function configureCloud({url,anonKey,colonyId}){
  const u=new URL(url);
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new Error('Supabase URL must use HTTPS.');
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Enter the Supabase project URL without credentials or a path.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(colonyId??''))throw new Error('A valid colony UUID is required.');
  const config={url:u.origin,anonKey:publicKey(anonKey.trim()),colonyId};advanceAuthGeneration();clearOperationalSession();
  setStorage('localStorage',DEMO_KEY,null);setStorage('localStorage',CONFIG_KEY,JSON.stringify(config));saveSession(null);pendingEmail=null;setMode('local');invalidate();statusMessage='Cloud configured. Sign in to connect.';
}
export function getCloudStatus(){
  const c=configuration(),s=session(),connections=operationalProvider?.getState()||null,activeCloud=connections?connections.active:synced?'cloud1':null;
  const connected=activeCloud==='cloud1'?'Cloud 1 connected.':activeCloud==='cloud2'?'Cloud 2 connected.':'No verified cloud data source is available.';
  const message=/^Cloud(?: [12])? connected\./.test(statusMessage)?(synced?statusMessage.replace(/^Cloud(?: [12])? connected\./,connected):'Pull cloud data before editing.'):statusMessage;
  return {configured:Boolean(c),signedIn:hasLabSession(s),userId:s?.user?.id??null,sessionEpoch:sessionEpoch(),passwordRecovery:s?.passwordRecovery===true,passwordRecoveryUpdated:s?.passwordRecovery===true&&s?.passwordRecoveryUpdated===true,email:s?.user?.email??null,name:typeof s?.user?.user_metadata?.full_name==='string'?s.user.user_metadata.full_name:null,pendingEmail,message:message||(mode()==='cloud'&&!synced?'Pull cloud data before editing.':mode()==='cloud'?connected:'Changes are saved on this device.'),mode:mode(),guestAccessStartsOn:s?.guestAccessStartsOn??null,guestAccessEndsOn:s?.guestAccessEndsOn??null,guestAvailability:guestAvailabilityStatus(s),recoverySource:providerSource,readyForEdits:guestAvailabilityStatus(s)==='active'&&s?.passwordRecovery!==true&&!pendingAccount(s)&&(mode()==='local'||synced&&baselineIdentity===syncIdentity()&&(!connections||!!connections.active)&&(activeCloud!=='cloud1'||!cloud1SessionSuspended)),colonyId:c?.colonyId??null,role:s?.role??null,guestLevel:s?.guestLevel??null,guestPermissions:s?.guestPermissions??{},permissions:s?.permissions??{},...appPermissionFields(s),username:s?.username??null,setupRequired:s?.setupRequired===true,exportLevel:s?.role==='owner'?'max':s?.exportLevel??null,url:c?.url??'',anonKey:c?.anonKey??'',historyPath:c?.historyPath??null,activeCloud,cloud2Configured:!!cloud2URL(),cloudConnections:connections};
}
async function responseJSON(response){const text=await response.text();if(!text)return null;try{return JSON.parse(text);}catch{throw new Error('The cloud server returned an unreadable response.');}}
// Bound both headers and body reads. A stalled connection must return control
// to the sign-in/retry screen; it must never silently replay a write.
async function cloudJSON(url,options={},timeoutMs=30000){
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
    const error=new Error('Cloud connection timed out. Retry when the connection is available.');
    error.connectionUnavailable=true;reject(error);controller.abort();
  },timeoutMs);});
  try{return await Promise.race([(async()=>{
    const response=await fetch(url,{...options,signal:controller.signal});
    return {response,result:await responseJSON(response)};
  })(),deadline]);}
  finally{clearTimeout(timer);}
}
function apiError(response,body){
  const message=body?.message||body?.error_description||body?.msg||body?.error||`Cloud request failed (${response.status}).`;
  if(response.status===409||body?.code==='40001')return Object.assign(new Error('This record changed in another session. Pull the latest cloud data and review your edit before trying again.'),{status:response.status});
  if(response.status===401)return Object.assign(new Error('The cloud session expired or sign-in was rejected. Sign in again.'),{status:401});
  if(response.status===403||body?.code==='42501')return Object.assign(new Error('Your account does not have permission for this cloud operation.'),{status:403});
  const error=Object.assign(new Error(String(message)),{status:response.status});
  // A cancelled query is not necessarily a timeout. Retry only this exact,
  // server-confirmed read failure, never network errors or permission failures.
  if(body?.code==='57014'&&message==='canceling statement due to statement timeout')error.statementTimeout=true;
  return error;
}
async function authRequest(route,body,token,timeoutMs=30000){
  const c=configuration();if(!c)throw new Error('Configure the cloud project first.');publicKey(c.anonKey);
  const {response,result}=await cloudJSON(`${c.url}/auth/v1/${route}`,{method:'POST',headers:{apikey:c.anonKey,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined},timeoutMs);
  if(!response.ok){
    const message=result?.message||result?.error_description||result?.msg;
    if(route==='verify'&&message)throw new Error(String(message));
    const error=apiError(response,result);
    if(route==='token?grant_type=refresh_token'&&[400,401,403].includes(response.status))error.sessionRejected=true;
    throw error;
  }
  return result;
}
function normalizeSession(s){if(!s?.access_token||!s?.refresh_token)throw new Error('The server did not return a complete session.');return {...s,expires_at:s.expires_at??Math.floor(Date.now()/1000)+(s.expires_in??3600)};}
async function accessToken(){
  let s=session();if(!s?.access_token)throw new Error('Sign in before using cloud data.');
  if(s.expires_at<=Date.now()/1000+60){
    const generation=authGeneration,config=stable(configuration());const current=()=>generation===authGeneration&&config===stable(configuration())&&session()?.user?.id===s.user?.id;
    // Token renewal is shared by optional and core requests. An optional read's
    // shorter timeout must not shorten the session-wide authentication budget.
    if(!refreshPromise)refreshPromise=authRequest('token?grant_type=refresh_token',{refresh_token:s.refresh_token}).then(result=>{if(!current())throw new Error('The account changed during session refresh.');const next={...normalizeSession(result),passwordRecovery:s.passwordRecovery===true,passwordRecoveryUpdated:s.passwordRecoveryUpdated===true,role:s.role,guestLevel:s.guestLevel,guestPermissions:s.guestPermissions,guestAccessStartsOn:s.guestAccessStartsOn??null,guestAccessEndsOn:s.guestAccessEndsOn??null,permissions:s.permissions,...appPermissionFields(s,true),username:s.username,setupRequired:s.setupRequired,exportLevel:s.exportLevel};saveSession(next);cloud1SessionSuspended=false;return next;}).catch(e=>{
      if(current()){
        // An independent, verified NAS session does not depend on renewing
        // Supabase credentials. This failure still rejects the Cloud 1 action.
        const nas=cloud2Identity,independent=operationalProvider?.getState().active==='cloud2'&&nas?.userId===s.user?.id&&nas?.colonyId===configuration()?.colonyId&&Date.parse(nas.session_expires_at)>Date.now();
        if(independent)statusMessage='Cloud 1 sign-in unavailable. Cloud 2 remains connected.';
        else if(e.sessionRejected===true){invalidate();saveSession(null);}else{cloud1SessionSuspended=true;statusMessage='Cloud 1 connection interrupted. Retrying keeps your current view.';}
      }
      throw e;
    }).finally(()=>{refreshPromise=null;});
    s=await refreshPromise;
  }
  return s.access_token;
}
async function cloud1Request(route,{method='GET',body,timeoutMs=30000}={}){
  if(session()?.passwordRecovery)throw new Error('Finish resetting your password before opening colony data.');
  const c=configuration();if(!c)throw new Error('Configure the cloud project first.');publicKey(c.anonKey);
  const token=await accessToken();
  const {response,result}=await cloudJSON(`${c.url}/rest/v1/${route}`,{method,cache:'no-store',redirect:'error',headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(method==='POST'?{Prefer:'return=representation'}:{})},body:body===undefined?undefined:JSON.stringify(body)},timeoutMs);
  if(!response.ok){const error=apiError(response,result);if(route==='rpc/get_managed_record_page'&&(response.status===404||result?.code==='PGRST202'))error.message='The current-record service is not available. Retry loading.';throw error;}return result;
}
function cloud2URL(){return configuration()?.url===PUBLIC_CONFIG.url&&configuration()?.colonyId===PUBLIC_CONFIG.colonyId?PUBLIC_CONFIG.cloud2Url||'':'';}
function clearOperationalSession(){operationalProvider?.cloud2.clear();operationalProvider?.dispose();operationalProvider=null;operationalConfig=null;cloud2Identity=null;providerSource=null;providerRevision++;cloud2ConflictPage={rows:[],nextAfter:null,binding:null};}
function connectionChanged(state){
 // A transport interruption suspends editing, but is not an identity or data
 // change. Retain its baseline for a live-verified return to the same server.
 // A real denial or a different selected server still invalidates it immediately.
 const denied=providerSource&&['signed_out','denied','not_enrolled'].includes(state.sources?.[providerSource]?.state);
 if(state.active!==providerSource&&(state.active!==null||denied)){if(providerSource!==null){invalidate();feeVisibility=null;feeVisibilityContext=null;}providerSource=state.active;providerRevision++;}
 for(const listener of cloudConnectionListeners)try{listener(clone(state));}catch{/* Status rendering cannot change provider decisions. */}
}
function provider(){
 const url=cloud2URL();if(!url)return null;
 const key=stable({url,colony:configuration()?.colonyId});if(operationalProvider&&key===operationalConfig)return operationalProvider;
 clearOperationalSession();operationalConfig=key;
 const nas=createCloud2Adapter({url,onSession:identity=>{cloud2Identity=identity;}});
 const ownMembership=(query,rows)=>{
  if(query.method!=='GET'||!query.route.startsWith('memberships?'))return rows;
  const params=new URLSearchParams(query.route.slice('memberships?'.length)),c=configuration(),s=session();
  if(params.get('user_id')!==`eq.${s?.user?.id}`||params.get('colony_id')!==`eq.${c?.colonyId}`||params.get('select')!=='role,active,export_level,permissions,guest_level,guest_permissions,guest_access_starts_on,guest_access_ends_on,notes_permissions,mouse_permissions,reagents_permissions,updated_at')return rows;
  if(!Array.isArray(rows)||rows.length!==1||rows[0].active!==true||!['owner','manager','editor','viewer'].includes(rows[0].role))throw Object.assign(new Error('This account is not an active member of the configured colony.'),{status:403,code:'FORBIDDEN'});
  assertGuestAvailability(rows[0]);return rows;
 };
 const nasRead=nas.read;nas.read=async args=>{try{return ownMembership(args.query,await nasRead(args));}catch(error){throw providerFailure(error);}};
 const context=()=>{const s=session(),c=configuration();return hasLabSession(s)&&s?.user?.id?{userId:s.user.id,colonyId:c.colonyId,authEpoch:sessionEpoch(),policyKey:verifiedIntentPolicy?.policyKey}:null;};
 const cloud1={idempotentWrites:true,
  async status(){
   const s=session(),c=configuration();if(!s?.access_token)return {state:'signed_out'};
   for(let attempt=0;attempt<2;attempt++)try{const rows=await cloud1Request(`memberships?select=role,active,guest_level,guest_access_starts_on,guest_access_ends_on&user_id=eq.${encodeURIComponent(s.user.id)}&colony_id=eq.${encodeURIComponent(c.colonyId)}`,{timeoutMs:10000});
    if(!Array.isArray(rows)||rows.length!==1||!rows[0].active||guestAvailabilityStatus(rows[0])!=='active')return {state:'denied'};
    return {state:'online',userId:s.user.id,colonyId:c.colonyId,enrolled:true,ready:true,canRead:true,canWrite:true,pending:0,conflicts:0};
   }catch(error){const failure=providerFailure(error);if(attempt===0&&failure.code==='UNAVAILABLE')continue;throw failure;}
  },
  async read({query}){try{return ownMembership(query,await cloud1Request(query.route,query));}catch(error){throw providerFailure(error);}},
  async recover({query}){
   const c=configuration(),probe=cloud1RecoveryQuery(query,c?.colonyId);if(!probe)return {verified:false};
   try{const result=await cloud1Request(probe.route,{...probe,timeoutMs:10000});
    if(probe.method==='GET'){const type=new URLSearchParams(probe.route.split('?')[1]).get('entity_type').slice(3);if(!Array.isArray(result)||result.length>1)throw new Error('Cloud recovery page could not be verified.');for(const row of result)checkedCloudRecord(row,type,c,false);}
    else if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('Cloud recovery access could not be verified.');
    return {verified:true};
   }catch(error){throw providerFailure(error);}
  },
  async submit({operation}){
   const {route,body}=operation.request,kind=CLOUD_COMMAND_KINDS[route];if(!kind)throw Object.assign(new Error('This action requires Cloud 1 account tools.'),{code:'NOT_READY'});
   const {p_colony_id,...args}=body;
   try{return await cloud1Request('rpc/parallel_cloud_command',{method:'POST',body:{p_colony_id,p_operation_id:operation.operation_id,p_kind:kind,p_args:args,p_anchors:[]}});}catch(error){throw providerFailure(error);}
  },
  receipt:({operationId})=>cloud1Request('rpc/parallel_cloud_receipt',{method:'POST',body:{p_colony_id:configuration().colonyId,p_operation_id:operationId}})
 };
 const journal=createIntentJournal({database,getScope:()=>{const c=configuration(),s=session();return verifiedIntentPolicy&&hasLabSession(s)?{server:c.url,userId:s.user.id,colonyId:c.colonyId,policyKey:verifiedIntentPolicy.policyKey}:null;}});
 operationalProvider=createCloudProvider({cloud1,cloud2:nas,getContext:context,onChange:connectionChanged,journal,primaryPolicy:primaryCloudPolicy,sessionPolicy:sessionCloudPolicy,getSessionCloud:savedSessionCloud,onSessionCloud:rememberSessionCloud});return operationalProvider;
}
// Reagents opts into one cloud per session. Mouse Data retains its primary policy.
export function setSessionCloudPolicy(){sessionCloudPolicy=true;const s=session();if(s?.user?.id&&!SESSION_CLOUD_ID.test(s.sessionCloudId||''))saveSession(s);return provider()?.setSessionCloudPolicy()||null;}
export function setPrimaryCloudPolicy(){primaryCloudPolicy=true;return operationalProvider?.setPrimaryCloudPolicy()||null;}
async function request(route,options={}){
 const availabilityCheck=!route.startsWith('memberships?'),read=isCloudRead(route,options.method||'GET');
 if(availabilityCheck)assertGuestAvailability(session());
 const service=provider();let result;
 if(!service)result=await cloud1Request(route,options);
 else if(!read&&!CLOUD_COMMAND_KINDS[route]){
  if((sessionCloudPolicy?savedSessionCloud():service.getState().active)==='cloud2'||options.cloudSource==='cloud2'||!session()?.access_token)throw new Error('This action requires Cloud 1. Current records and purchases remain available on Cloud 2.');
  result=await cloud1Request(route,options);
 }else result=await service.request(route,options);
 if(availabilityCheck&&read)assertGuestAvailability(session());
 return result;
}
const conflictBinding=()=>stable({user:session()?.user?.id,colony:configuration()?.colonyId,epoch:providerSessionEpoch,policy:verifiedIntentPolicy?.policyKey});
export function getCloudConnections(){const state=provider()?.getState(),s=session();return state?{...state,canResetPassword:!!s?.access_token&&!s.passwordRecovery&&!pendingAccount(s)&&state.sources.cloud1.state==='online',conflictRows:cloud2ConflictPage.binding===conflictBinding()?clone(cloud2ConflictPage.rows):[],conflictNextAfter:cloud2ConflictPage.binding===conflictBinding()?cloud2ConflictPage.nextAfter:null}:null;}
export function subscribeCloudConnections(listener){cloudConnectionListeners.add(listener);listener(getCloudConnections());return ()=>cloudConnectionListeners.delete(listener);}
export async function refreshCloudConnections({canCommit=()=>true}={}){const service=provider();if(!service)return null;const state=await service.refresh({canCommit});if(!canCommit())return getCloudConnections();if(state.sources.cloud2.state==='online'&&state.sources.cloud2.conflicts>0)await refreshCloudConflicts();else if(state.sources.cloud2.conflicts===0)cloud2ConflictPage={rows:[],nextAfter:null,binding:conflictBinding()};return getCloudConnections();}
export async function refreshCloudConflicts({after=null}={}){
 const service=provider();if(!service)throw new Error('Cloud 2 is not configured.');if(!verifiedIntentPolicy)await membership();const binding=conflictBinding(),result=await service.cloud2.conflicts({after});
 if(binding!==conflictBinding())throw new Error('Account access changed. Reopen Clouds.');
 const idPattern=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
 if(!result||!Array.isArray(result.conflicts)||result.conflicts.length>50||result.next_after!=null&&!idPattern.test(result.next_after)||result.conflicts.some(row=>!idPattern.test(row.operation_id||'')||!['conflict','rejected'].includes(row.status)||row.changed_records!==undefined&&(!Array.isArray(row.changed_records)||row.changed_records.length>500||row.changed_records.some(record=>!record||!['mouse','reagents'].includes(record.domain)||typeof record.entity_type!=='string'||record.entity_type.length>100||typeof record.entity_id!=='string'||record.entity_id.length>500))))throw new Error('The pending edit list could not be verified.');
 cloud2ConflictPage={rows:result.conflicts.map(row=>({operation_id:row.operation_id,status:row.status,changed_records:clone(row.changed_records||[])})),nextAfter:result.next_after||null,binding};connectionChanged(service.getState());return getCloudConnections();
}
export async function cancelCloudOperation(id){
 await membership();const service=provider(),binding=conflictBinding();if(!service)throw new Error('Cloud 2 is not configured.');const result=await service.cloud2.cancel({operationId:id,reason:'Discarded by user after conflict review'});
 if(binding!==conflictBinding()||result?.operation_id!==id||result.status!=='cancelled')throw new Error('Discard could not be confirmed. Check the saved edit again.');
 await service.discardConfirmed(id,'cloud2');cloud2ConflictPage={rows:[],nextAfter:null,binding};await refreshCloudConnections();return result;
}
export async function selectCloud(source){if(primaryCloudPolicy&&source!=='cloud1')throw Object.assign(new Error('Cloud 1 is the primary source. Cloud 2 is used automatically during an outage.'),{code:'PRIMARY_POLICY'});const service=provider();if(!service)throw new Error('Parallel clouds are not configured.');await service.refresh();service.choose(source);if(service.getState().active!==source)throw new Error('The selected cloud is not ready for this account.');invalidate();feeVisibility=null;feeVisibilityContext=null;return getCloudStatus();}
export async function verifyCloudOperation(id){if(!verifiedIntentPolicy)await membership();return provider()?.verify(id);}
export async function retryCloudOperation(id){await membership();return provider()?.retry(id);}
// One reviewed, private source plan. No whole-workspace normalizer or automatic
// entrainment synchronizer is used by this path. Its command remains Cloud 1.
let ownerSourceReconciliation=null,sourceReconciliationProgress=null;
function reportSourceReconciliationProgress(progress){try{sourceReconciliationProgress?.(Object.freeze({...progress}));}catch{/* Presentation cannot change validation or persistence. */}}
function sourceReconciliationContext(){
 const c=configuration(),s=session(),state=provider()?.getState();
 if(mode()!=='cloud'||!c||!s?.access_token||!s.user?.id||s.role!=='owner'||isGuest(s)||s.passwordRecovery||pendingAccount(s)||providerSource!=='cloud1'||state?.active!=='cloud1'||!verifiedIntentPolicy?.policyKey)throw new Error('An active Owner session on Cloud 1 is required for source reconciliation.');
 return {colonyId:c.colonyId,userId:s.user.id,url:c.url,generation:authGeneration,epoch:sessionEpoch(),policy:verifiedIntentPolicy.policyKey,context:exportContext()};
}
function checkSourceReconciliationContext(expected){if(stable(sourceReconciliationContext())!==stable(expected))throw new Error('The account, cloud or permissions changed. Reopen the source plan.');}
async function sourceReconciliationOwner(){await verifyCloudMembership({source:'cloud1'});return sourceReconciliationContext();}
async function sourceReconciliationSnapshot(plan,context){
 checkSourceReconciliationContext(context);const c=configuration(),check=()=>checkSourceReconciliationContext(context),read=(route,options={})=>request(route,{...options,cloudSource:'cloud1'});
 // Reuse the existing complete managed-Mice reader, including its final
 // version-index check. No archive rows or unrelated tables are scanned.
 const mice=await incrementalManaged('mice',c,check,{records:new Map(),versions:new Map()},false,read,(completed,total)=>reportSourceReconciliationProgress({phase:'identities',completed,total}),'full');check();
 const wanted=new Map([...plan.dependencies,...plan.expectedMissing].map(row=>[row.entity_type+':'+row.entity_id,row])),groups=new Map();
 for(const row of wanted.values()){const rows=groups.get(row.entity_type)||[];rows.push(row.entity_id);groups.set(row.entity_type,rows);}
 const batches=[];for(const [type,ids]of groups){for(let offset=0;offset<ids.length;){const batch=[ids[offset++]];if(/^[A-Za-z0-9_:-]{1,100}$/.test(batch[0]))while(offset<ids.length&&batch.length<20&&/^[A-Za-z0-9_:-]{1,100}$/.test(ids[offset]))batch.push(ids[offset++]);batches.push({type,ids:batch});}}
 const records=[];let next=0;
 await Promise.all(Array.from({length:Math.min(3,batches.length)},async()=>{while(next<batches.length){check();const batch=batches[next++],query=new URLSearchParams({select:'colony_id,entity_type,entity_id,payload,version,archived',colony_id:`eq.${c.colonyId}`,entity_type:`eq.${batch.type}`,entity_id:batch.ids.length===1?`eq.${batch.ids[0]}`:`in.(${batch.ids.join(',')})`,limit:String(batch.ids.length)});
   const page=await read(`entity_records?${query}`);check();if(!Array.isArray(page)||page.length>batch.ids.length)throw new Error('A source-plan record page was not returned completely.');
   const seen=new Set();for(const value of page){const row=checkedCloudRecord(value,batch.type,c);if(!batch.ids.includes(row.entity_id)||seen.has(row.entity_id))throw new Error('The source-plan read contains unrelated or repeated records.');seen.add(row.entity_id);records.push(row);}
 }}));check();return {colonyId:c.colonyId,mice,records};
}
function sourceReconciliationController(){
 if(!ownerSourceReconciliation)ownerSourceReconciliation=createSourceReconciliation({validate:validateSourceReconciliationRecord,io:{
  verifyOwner:sourceReconciliationOwner,checkContext:checkSourceReconciliationContext,readSnapshot:sourceReconciliationSnapshot,progress:reportSourceReconciliationProgress,
  async recover(id,context){checkSourceReconciliationContext(context);const operation=await provider().restoreOperation(id,{requiredSource:'cloud1'});checkSourceReconciliationContext(context);const value=await cloud1Request('rpc/parallel_cloud_receipt',{method:'POST',body:{p_colony_id:context.colonyId,p_operation_id:id}});checkSourceReconciliationContext(context);if(value!==null&&(!value||value.operation_id!==id||!['unknown','applied','conflict','rejected','queued'].includes(value.status)))throw new Error('The original source-import receipt could not be verified.');const prior=provider().getState().operations.find(row=>row.operationId===id);return {operation,receipt:value?{source:'cloud1',...value}:null,blocked:Boolean(prior&&!operation)};},
  async readManagers(context){checkSourceReconciliationContext(context);const result=await request('rpc/list_cage_managers',{method:'POST',cloudSource:'cloud1',body:{p_colony_id:context.colonyId}});checkSourceReconciliationContext(context);if(!Array.isArray(result?.managers)||result.managers.length>4096)throw new Error('The current manager directory is unavailable.');return result.managers.map(row=>({person_id:row.person_id,name:row.name,acronym:row.acronym??null,nickname:row.nickname??null,status:row.status}));},
  async submit(operation,context){checkSourceReconciliationContext(context);await sourceReconciliationOwner();checkSourceReconciliationContext(context);const result=await provider().submit(operation,{requiredSource:'cloud1'});checkSourceReconciliationContext(context);return result;},
  async verify(id,context){checkSourceReconciliationContext(context);const result=await provider().verify(id);checkSourceReconciliationContext(context);return result;},
  async retry(id,context){checkSourceReconciliationContext(context);await sourceReconciliationOwner();checkSourceReconciliationContext(context);const prior=provider().getState().operations.find(row=>row.operationId===id);if(prior?.source!=='cloud1')throw new Error('The original Cloud 1 command is unavailable. Verify its saved receipt.');const result=await provider().retry(id);checkSourceReconciliationContext(context);return result;},
  invalidate(){invalidate();statusMessage='Source reconciliation requires a fresh cloud pull before editing.';}
 }});return ownerSourceReconciliation;
}
async function withSourceReconciliation(run,onProgress=null){const scope=stable({generation:authGeneration,context:exportContext()});if(activeDatasetSaves.has(scope))throw new Error('Another save or history load is in progress.');activeDatasetSaves.add(scope);sourceReconciliationProgress=typeof onProgress==='function'?onProgress:null;try{return await run(sourceReconciliationController());}finally{sourceReconciliationProgress=null;activeDatasetSaves.delete(scope);}}
export function clearSourceReconciliation(){ownerSourceReconciliation?.clear();sourceReconciliationProgress=null;}
export const previewSourceReconciliation=(raw,{onProgress}={})=>withSourceReconciliation(controller=>controller.preview(raw),onProgress);
export const applySourceReconciliation=({onProgress}={})=>withSourceReconciliation(controller=>controller.apply(),onProgress);
export const verifySourceReconciliation=()=>withSourceReconciliation(controller=>controller.verify());
export const retrySourceReconciliation=({onProgress}={})=>withSourceReconciliation(controller=>controller.retry(),onProgress);
export async function syncCloud2(){const service=provider();if(!service)throw new Error('Cloud 2 is not configured.');await service.cloud2.sync();return service.refresh();}
function adoptCloud2Identity(identity){
 assertGuestAvailability(identity);
 if(identity.colonyId!==configuration()?.colonyId||session()?.user?.id&&session().user.id!==identity.userId)throw new Error('Cloud 2 must use the same lab account.');
 if(!session()?.access_token)saveSession({user:{id:identity.userId,email:identity.email,user_metadata:{full_name:identity.name}},role:identity.role,exportLevel:identity.exportLevel,guestLevel:identity.guestLevel||null,guestPermissions:identity.guestPermissions||{},guestAccessStartsOn:identity.guestAccessStartsOn??null,guestAccessEndsOn:identity.guestAccessEndsOn??null,permissions:identity.permissions||{},...appPermissionFields(identity,true),username:identity.username,setupRequired:false,cloud2Only:true});
}
export async function resumeCloud2Session(){
 const service=provider();if(!service)return false;
 try{const identity=await service.cloud2.status({});if(identity.state!=='online')return false;adoptCloud2Identity(identity);await service.refresh();if(!session()?.access_token&&!primaryCloudPolicy)service.choose('cloud2');setMode('cloud');return hasLabSession();}
 catch(error){if(['UNAUTHORIZED','NOT_READY','UNAVAILABLE'].includes(error.code))return false;throw error;}
}
export async function connectCloud2({reset=false}={}){
 if(reset&&(!session()?.access_token||session()?.passwordRecovery||pendingAccount(session())))throw new Error('Sign in to Cloud 1 before resetting your Cloud 2 password.');
 const service=provider();if(!service)throw new Error('Cloud 2 is not configured.');
 const initialUser=session()?.user?.id,initialCloud1=Boolean(session()?.access_token),preferred=service.getState().preferred,config=stable(configuration());let epoch=providerSessionEpoch;
 const check=()=>{if(epoch!==providerSessionEpoch||config!==stable(configuration()))throw new Error('The account changed. Connect Cloud 2 again.');};
 return openCloud2SignIn({url:cloud2URL(),check,reset,getEnrollmentToken:async()=>{
  if(!session()?.access_token)return null;
  try{const rows=await cloud1Request(`memberships?select=active,guest_level,guest_access_starts_on,guest_access_ends_on&user_id=eq.${encodeURIComponent(initialUser)}&colony_id=eq.${encodeURIComponent(configuration().colonyId)}`);check();if(!Array.isArray(rows)||rows.length!==1||rows[0].active!==true)throw new Error('Current lab membership is required to connect Cloud 2.');assertGuestAvailability(rows[0]);return accessToken();}
  catch(error){check();if(!reset&&providerFailure(error).code==='UNAVAILABLE')return null;throw error;}
 },acceptSession:async token=>{
  check();service.cloud2.setBearer(token);const identity=await service.cloud2.status({});check();
  if(identity.colonyId!==configuration().colonyId||initialUser&&identity.userId!==initialUser){service.cloud2.clear();cloud2Identity=null;throw new Error('Cloud 2 must use the same lab account.');}
  adoptCloud2Identity(identity);epoch=providerSessionEpoch;
  if(preferred)service.choose(preferred);await service.refresh();
  if(!initialCloud1){if(!primaryCloudPolicy)service.choose('cloud2');setMode('cloud');invalidate();}
  statusMessage=primaryCloudPolicy&&service.getState().active!=='cloud2'?'Cloud 2 sign-in verified.':identity.ready===true?'Cloud 2 connected.':'Cloud 2 connected; initial data is not ready.';return getCloudStatus();
 }});
}
async function membership(action){
  const c=configuration(),s=session(),generation=authGeneration,epoch=providerSessionEpoch,config=stable(c);
  if(!s?.user?.id)throw new Error('The signed-in user is unavailable. Sign in again.');
  const checkIdentity=()=>{action?.checkIdentity?.();if(generation!==authGeneration||epoch!==providerSessionEpoch||stable(configuration())!==config||session()?.user?.id!==s.user.id)throw new Error('The account changed while verifying application permissions.');};
  const checkPolicy=()=>{checkIdentity();action?.check();};
  const rows=await request(`memberships?select=role,active,export_level,permissions,guest_level,guest_permissions,guest_access_starts_on,guest_access_ends_on,notes_permissions,mouse_permissions,reagents_permissions,updated_at&user_id=eq.${encodeURIComponent(s.user.id)}&colony_id=eq.${encodeURIComponent(c.colonyId)}`,{cloudSource:action?.source??null,canCommit:action?.canCommit});
  checkIdentity();
  if(!Array.isArray(rows)||rows.length!==1||rows[0].active!==true||!['owner','manager','editor','viewer'].includes(rows[0].role))throw Object.assign(new Error('This account is not an active member of the configured colony.'),{status:403,code:'FORBIDDEN'});
  if(configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==s.user.id)throw new Error('The cloud account or colony changed. Sign in again.');
  assertGuestAvailability(rows[0]);checkPolicy();
  const purgePolicyCache=async()=>{const historyCached=Boolean(baseline||readJSON('localStorage',CLOUD_CACHE_KEY));invalidate();verifiedIntentPolicy=null;feeVisibility=null;feeVisibilityContext=null;await local('delete',undefined,{check:checkPolicy});if(historyCached)await clearHistoryIndex({check:checkPolicy});checkPolicy();};
  let appPermissions;
  try{appPermissions=appPermissionFields(rows[0],true);}catch(error){saveSession({...session(),...appPermissionFields(rows[0])});await purgePolicyCache();throw error;}
  if(stable(appPermissionFields(s))!==stable(appPermissions)||stable({level:s.guestLevel||null,permissions:s.guestPermissions||{},starts:s.guestAccessStartsOn??null,ends:s.guestAccessEndsOn??null})!==stable({level:rows[0].guest_level||null,permissions:rows[0].guest_permissions||{},starts:rows[0].guest_access_starts_on??null,ends:rows[0].guest_access_ends_on??null})){saveSession({...session(),...appPermissions});await purgePolicyCache();}
  saveSession({...session(),role:rows[0].role,guestLevel:rows[0].guest_level||null,guestPermissions:rows[0].guest_permissions||{},guestAccessStartsOn:rows[0].guest_access_starts_on??null,guestAccessEndsOn:rows[0].guest_access_ends_on??null,permissions:rows[0].permissions||{},...appPermissions,setupRequired:false,exportLevel:rows[0].role==='owner'?'max':rows[0].export_level||'low'});
  verifiedIntentPolicy={policyKey:stable({role:rows[0].role,exportLevel:rows[0].export_level||'low',permissions:rows[0].permissions||{},...appPermissions,guestLevel:rows[0].guest_level||null,guestPermissions:rows[0].guest_permissions||{},guestAccessStartsOn:rows[0].guest_access_starts_on??null,guestAccessEndsOn:rows[0].guest_access_ends_on??null,updatedAt:rows[0].updated_at||null})};
  notifyVerifiedMembership();checkPolicy();await provider()?.restore();checkPolicy();return rows[0].role;
}
// A live, data-free access check for the internal tools portal. Cached roles
// alone never unlock the portal; no animal records or roster are requested.
export async function verifyCloudMembership({source=null,canCommit=()=>true}={}){
  if(source!==null&&!['cloud1','cloud2'].includes(source))throw new Error('Choose Cloud 1 or Cloud 2.');
  const initial=session(),c=configuration();
  if(!c||!initial?.user?.id)throw new Error('Sign in to open lab tools.');
  if(initial.passwordRecovery)throw new Error('Finish resetting your password before opening lab tools.');
  if(initial.setupRequired||initial.role==='pending')throw new Error('Finish your account setup before opening lab tools.');
  const passive=passiveAuthAction(source),action={...passive,canCommit,checkIdentity:passive.check,check(){passive.check();if(!canCommit())throw Object.assign(new Error('Background connection check cancelled.'),{code:'BACKGROUND_CANCELLED'});}},service=provider();
  try{
    if(!canCommit())throw Object.assign(new Error('Background connection check cancelled.'),{code:'BACKGROUND_CANCELLED'});
    if(service){await ((primaryCloudPolicy||sessionCloudPolicy)&&typeof service.prepareRead==='function'?service.prepareRead({canCommit}):service.refresh({canCommit}));action.check();if(service.getState().active==='cloud2'){await membership(action);action.check();return getCloudStatus();}}
    const token=await accessToken();action.check();
    const {response,result:user}=await cloudJSON(`${c.url}/auth/v1/user`,{headers:{apikey:publicKey(c.anonKey),Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error'});
    passive.check();
    if(!response.ok)throw apiError(response,user);
    if(user?.id!==initial.user.id||user.is_anonymous||!user.email_confirmed_at)throw Object.assign(new Error('Your sign-in could not be verified. Sign in again.'),{status:401});
    action.check();await membership(action);action.check();cloud1SessionSuspended=false;
    return getCloudStatus();
  }catch(error){if(action.current()&&([401,403].includes(error?.status)||['UNAUTHORIZED','FORBIDDEN'].includes(error?.code)||error?.guestAccessUnavailable)){invalidate();feeVisibility=null;feeVisibilityContext=null;}throw error;}
}
/** Resume a suspended browser connection without reloading history or replaying a save. */
export async function recoverCloudConnection({source=providerSource||'cloud1',canCommit=()=>true,coreOnly=false}={}){
  if(!canCommit())throw Object.assign(new Error('Connection recovery postponed while editing.'),{code:'BACKGROUND_CANCELLED'});
  // Only a routine check of this exact, already verified baseline can omit the
  // unrelated fee read. Initial recovery and changed access still verify fees;
  // every fee, history, export and save operation keeps its own fresh checks.
  const verifiedBaseline=()=>{
    const status=getCloudStatus(),identity=syncIdentity(),context=exportContext();
    if(!coreOnly||!synced||!baseline||baselineIdentity!==identity||status.mode!=='cloud'||status.readyForEdits!==true||status.activeCloud!==source||!verifiedIntentPolicy?.policyKey||!feeVisibility||feeVisibilityContext!==context)return null;
    return {baseline,feeVisibility,key:stable({identity,context,source,user:session()?.user?.id,generation:authGeneration,epoch:providerSessionEpoch,policy:verifiedIntentPolicy.policyKey})};
  };
  const before=verifiedBaseline();
  await verifyCloudMembership({source,canCommit});const action=passiveAuthAction(source);
  const after=verifiedBaseline();
  if(!before||!after||before.baseline!==after.baseline||before.feeVisibility!==after.feeVisibility||before.key!==after.key)await refreshFeeVisibility({cloudSource:source,canCommit});
  action.check();const status=getCloudStatus();
  if(!canCommit())throw Object.assign(new Error('Connection recovery postponed while editing.'),{code:'BACKGROUND_CANCELLED'});
  return {status,dataset:null};
}
// Shared lab-tool transport; authorization and history limits are enforced again by each RPC.
const REAGENT_ACTIONS=new Set(['list','save','history','sources','observations','import','record_usage','access','set_access',
 'order_search','order_list','order_submit','order_transition','order_locations','order_set_location','order_import_offers',
 'sheet_order_preview','sheet_order_commit','sheet_order_list','sheet_order_receive']);
export function isReagentsConnectionError(error){if(error?.reagentsAccessChanged===true||error?.guestAccessUnavailable===true||[401,403].includes(error?.status)||['UNAUTHORIZED','FORBIDDEN','NOT_ENROLLED','CONTEXT_CHANGED'].includes(error?.code))return false;return error?.connectionUnavailable===true||error?.statementTimeout===true||['UNAVAILABLE','SOURCE_CHANGED','BACKGROUND_CANCELLED','NOT_READY','WRITE_UNCERTAIN'].includes(error?.code)||[408,429,500,502,503,504].includes(error?.status)||error?.name==='AbortError'||error instanceof TypeError&&/fetch|network|load failed/i.test(error.message);}
export async function callReagents(action,args={}){
 if(!REAGENT_ACTIONS.has(action)||!args||Array.isArray(args)||typeof args!=='object')throw new Error('Unsupported reagent operation.');
 const generation=authGeneration,epoch=sessionEpoch(),c=configuration(),identity=session()?.user?.id;
 const denied=message=>Object.assign(new Error(message),{reagentsAccessChanged:true});
 if(!c||!identity||session()?.setupRequired||session()?.role==='pending'||session()?.passwordRecovery)throw denied('Sign in and complete your account before opening Reagents.');
 const policy=()=>stable({role:session()?.role??null,exportLevel:session()?.exportLevel??null,guestLevel:session()?.guestLevel??null,guestPermissions:session()?.guestPermissions??{},starts:session()?.guestAccessStartsOn??null,ends:session()?.guestAccessEndsOn??null,permissions:session()?.permissions??{},...appPermissionFields(session())}),beforePolicy=policy();let source=sessionCloudPolicy?savedSessionCloud():null;
 const checkIdentity=()=>{if(generation!==authGeneration||epoch!==sessionEpoch()||configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==identity)throw denied('Your account changed. Reopen Reagents.');};
 const check=()=>{checkIdentity();if(source&&savedSessionCloud()!==source)throw denied('Your session cloud changed. Sign in again.');};
 const accessError=error=>{checkIdentity();if(policy()!==beforePolicy||!isReagentsConnectionError(error))error.reagentsAccessChanged=true;return error;};
 try{const service=provider();if(sessionCloudPolicy&&service&&!source){await service.prepareRead();checkIdentity();source=savedSessionCloud();}await membership({source,check});check();if(policy()!==beforePolicy)throw denied('Your application permissions changed. Reopen Reagents.');}catch(error){throw accessError(error);}
 try{if(action.startsWith('sheet_order_')){const sheetCheck=reagentSheetOwnerFence();sheetCheck();const result=await cloud1Request('rpc/reagents_'+action,{method:'POST',body:{...args,p_colony_id:c.colonyId},timeoutMs:30000});check();sheetCheck();return result;}const result=await request('rpc/reagents_'+action,{method:'POST',body:{...args,p_colony_id:c.colonyId},cloudSource:source});check();return result;}
 catch(error){check();if([401,403].includes(error.status)||['UNAUTHORIZED','FORBIDDEN','NOT_ENROLLED'].includes(error.code)||/session expired|sign.in|permission for this cloud operation/i.test(error.message))error.reagentsAccessChanged=true;throw error;}
}
function reagentSheetOwnerFence(){
 const c=configuration(),s=session(),generation=authGeneration,epoch=providerSessionEpoch;
 const check=()=>{
  if(!c||!s?.access_token||!s.user?.id||s.role!=='owner'||s.passwordRecovery||s.setupRequired)throw new Error('Only the signed-in owner can refresh sheet orders.');
  if(generation!==authGeneration||epoch!==providerSessionEpoch||configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==s.user.id||session()?.role!=='owner'||session()?.setupRequired||session()?.passwordRecovery)throw new Error('Your account changed. Reopen the sheet import.');
  if((sessionCloudPolicy?(operationalProvider?.getState()?.sessionCloud||savedSessionCloud()):(operationalProvider?.getState()?.active??providerSource))==='cloud2')throw new Error('Sheet order updates are available when Cloud 1 reconnects.');
 };check();return check;
}
export async function fetchReagentSheetOrders(){
 const check=reagentSheetOwnerFence(),c=configuration(),s=session();
 const live=await cloud1Request(`memberships?select=role,active&user_id=eq.${encodeURIComponent(s.user.id)}&colony_id=eq.${encodeURIComponent(c.colonyId)}`,{timeoutMs:10000});check();
 if(!Array.isArray(live)||live.length!==1||live[0].active!==true||live[0].role!=='owner')throw new Error('Owner access could not be verified.');
 const token=await accessToken();check();
 const {response,result}=await cloudJSON(`${c.url}/functions/v1/read-reagent-orders`,{method:'POST',cache:'no-store',redirect:'error',headers:{apikey:publicKey(c.anonKey),Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({colony_id:c.colonyId})},30000);check();
 if(!response.ok){
  const labels={source_access_denied:'The sheet reader does not have access to the Reagent sheet. Ask the owner to connect read-only access.',source_timeout:'The Reagent sheet did not respond in time. Retry loading it.',source_layout_changed:'The Reagent sheet layout changed. Review the import mapping before updating orders.',source_too_large:'The order tabs exceed the import limit. Ask the owner to review the source range.',owner_required:'Only the owner can import sheet orders.',sign_in_required:'Sign in again before importing sheet orders.',not_configured:'The Reagent sheet connection is not configured yet.'};
  throw new Error(labels[result?.code]||'The Reagent sheet could not load. Retry without changing existing orders.');
 }
 if(!Array.isArray(result?.rows)||result.rows.length>1500||!Array.isArray(result.warnings)||!result.summary||new TextEncoder().encode(JSON.stringify(result)).byteLength>1000000)throw new Error('The Reagent sheet response could not be verified.');
 return result;
}

async function establishMembershipOrSetup(action){
  const c=configuration(),s=session();
  // Account setup precedes scientific access. Its verified Cloud 1 identity
  // can read only its own membership/profile, without selecting a data source.
  const rows=await cloud1Request(`memberships?select=role,active,export_level,permissions,guest_level,guest_permissions,guest_access_starts_on,guest_access_ends_on,notes_permissions,mouse_permissions,reagents_permissions,updated_at&user_id=eq.${encodeURIComponent(s.user.id)}&colony_id=eq.${encodeURIComponent(c.colonyId)}`);
  action?.check();if(!Array.isArray(rows))throw new Error('Unable to verify colony access.');
  if(rows.length){if(rows.length!==1||rows[0].active!==true||!['owner','manager','editor','viewer'].includes(rows[0].role))throw new Error('This account is not an active member of the configured colony.');await membership(action);await checkRegisteredUsernameSetup(action);return;}
  const profile=await cloud1Request('rpc/get_my_lab_member',{method:'POST',body:{p_colony_id:c.colonyId}});
  action?.check();if(!setupProfileAllowed(profile))throw new Error('This account is not an active member of the configured colony.');
  saveSession({...session(),role:'pending',setupRequired:true});
}
// Check only during an explicit new sign-in, never during cached startup or
// ordinary membership refresh. Existing approved access is unchanged: a real
// unfinished roster claim opens its own setup form, while legacy accounts with
// no roster and temporary profile-read failures keep their verified membership.
async function checkRegisteredUsernameSetup(action){
 const c=configuration(),s=session();if(!s?.user?.id||s.role==='owner')return;
 let profile;try{profile=await cloud1Request('rpc/get_my_lab_member',{method:'POST',body:{p_colony_id:c.colonyId},timeoutMs:5000});profile=await registrationSetupAccess(profile,()=>action?.check());}
 catch{action?.check();return;}
 action?.check();
 const person=profile?.member;
 if(profile?.eligible===true&&profile.setup_required===true&&setupBlocksAccess(profile)&&typeof person?.person_id==='string'&&person.person_id&&person.email===s.user.email?.trim().toLowerCase()&&!person.username){
  saveSession({...session(),role:'pending',setupRequired:true});
 }
}
// This deployment's resolver exposes no directory. Ordinary emails pass through;
// a configured owner alias supplies the exact identity to verify after Auth.
async function resolveLoginEmail(identifier,action){
  const c=configuration(),email=identifier.trim().toLowerCase();
  if(c?.url!==PUBLIC_CONFIG.url||c?.colonyId!==PUBLIC_CONFIG.colonyId)return {email:identifier.trim(),user_id:null,alias:false};
  const {response,result}=await cloudJSON(`${c.url}/rest/v1/rpc/resolve_lab_login`,{method:'POST',cache:'no-store',redirect:'error',headers:{apikey:publicKey(c.anonKey),'Content-Type':'application/json'},body:JSON.stringify({p_colony_id:c.colonyId,p_identifier:email})});
  action.check();
  if(!response.ok){
    throw new Error('Sign-in verification is temporarily unavailable. Try again later.');
  }
  const validEmail=value=>typeof value==='string'&&value.length<=254&&value===value.trim().toLowerCase()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).length!==3||!validEmail(result.email)||!['email','user_id','alias'].every(key=>Object.hasOwn(result,key))||!(result.alias===false&&result.user_id===null&&result.email===email||result.alias===true&&typeof result.user_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.user_id)))throw new Error('Sign-in could not be confirmed. Try again later.');
  return result;
}
async function passwordSignIn(email,password,action){
  let result,identity=null;
  if(email.includes('@')){identity=await resolveLoginEmail(email,action);action.check();result=await authRequest('token?grant_type=password',{email:identity.email,password});}
  else {
    const c=configuration();if(!c)throw new Error('Configure the cloud project first.');
    const defaultGateway=c.url===PUBLIC_CONFIG.url&&c.colonyId===PUBLIC_CONFIG.colonyId?PUBLIC_CONFIG.usernameAnonKey:null;
    const anonKey=publicKey(c.anonKey.startsWith('sb_publishable_')&&defaultGateway?defaultGateway:c.anonKey);
    if(anonKey.startsWith('sb_publishable_'))throw new Error('Username sign-in requires the project’s public legacy anon key. Use your email to sign in, or ask the owner to update the app configuration.');
    const {response,result:reply}=await cloudJSON(`${c.url}/functions/v1/username-sign-in`,{method:'POST',cache:'no-store',redirect:'error',headers:{apikey:anonKey,Authorization:`Bearer ${anonKey}`,'Content-Type':'application/json'},body:JSON.stringify({username:email.trim(),password})});
    result=reply;if(!response.ok)throw new Error(result?.message||'Username sign-in was rejected.');
  }
  action.check();if(identity?.alias&&result?.user?.id!==identity.user_id)throw new Error('Sign-in could not be confirmed. Try again later.');return {candidate:normalizeSession(result),identity};
}
export async function signIn(email,password){
  if(typeof email!=='string'||typeof password!=='string'||!email.trim()||!password)throw new Error('Enter your email or username and password.');
  const action=beginAuthAction();saveSession(null);invalidate();const {candidate,identity}=await passwordSignIn(email,password,action);action.check();saveSession(candidate);invalidate();
  try{await establishMembershipOrSetup(action);action.check();if(identity?.alias&&session()?.role!=='owner')throw new Error('This sign-in is unavailable. Use your registered account.');statusMessage='Signed in.';}catch(e){if(action.current()){saveSession(null);statusMessage=e.message;}throw e;}
  return getCloudStatus();
}
/** Reconnect Cloud 1 without discarding an independently signed-in NAS account. */
export async function connectCloud1(email,password,{signal}={}){
 if(typeof email!=='string'||typeof password!=='string'||!email.trim()||!password)throw new Error('Enter your email or username and password.');
 const initial=session(),c=configuration();
 if(initial?.passwordRecovery||pendingAccount(initial))throw new Error('Complete your account setup before connecting Cloud 1.');
 const action=beginAuthAction(),expectedUser=initial?.user?.id,service=provider(),preferred=service?.getState().preferred;
 const check=()=>{action.check();if(signal?.aborted||session()?.user?.id!==expectedUser)throw new Error('Cloud 1 sign-in was cancelled or the account changed.');};
 check();const {candidate,identity}=await passwordSignIn(email,password,{check});check();
 if(expectedUser&&candidate.user?.id!==expectedUser)throw new Error('Cloud 1 must use the same lab account as Cloud 2.');
 const headers={apikey:publicKey(c?.anonKey),Authorization:`Bearer ${candidate.access_token}`};
 const {response:verified,result:user}=await cloudJSON(`${c.url}/auth/v1/user`,{headers,cache:'no-store',redirect:'error'});check();
 if(!verified.ok||user?.id!==candidate.user?.id||user.is_anonymous||!user.email_confirmed_at)throw new Error('Your Cloud 1 sign-in could not be verified.');
 const {response,result:rows}=await cloudJSON(`${c.url}/rest/v1/memberships?select=role,active,export_level,permissions,guest_level,guest_permissions,guest_access_starts_on,guest_access_ends_on,notes_permissions,mouse_permissions,reagents_permissions,updated_at&user_id=eq.${encodeURIComponent(user.id)}&colony_id=eq.${encodeURIComponent(c.colonyId)}`,{headers,cache:'no-store',redirect:'error'});check();
 if(!response.ok)throw apiError(response,rows);
 if(!Array.isArray(rows)||rows.length!==1||rows[0].active!==true||!['owner','manager','editor','viewer'].includes(rows[0].role))throw new Error('This account is not an active member of the configured colony.');
 const member=rows[0];assertGuestAvailability(member);if(identity?.alias&&member.role!=='owner')throw new Error('This sign-in is unavailable. Use your registered account.');
 check();saveSession({...candidate,user,role:member.role,guestLevel:member.guest_level||null,guestPermissions:member.guest_permissions||{},guestAccessStartsOn:member.guest_access_starts_on??null,guestAccessEndsOn:member.guest_access_ends_on??null,permissions:member.permissions||{},...appPermissionFields(member,true),setupRequired:false,exportLevel:member.role==='owner'?'max':member.export_level||'low'});invalidate();
 // Keep the NAS adapter and its bearer. Changing Cloud 1 credentials is not a
 // request to move an existing workspace to a different data source.
 if(service){if(preferred)service.choose(preferred);await service.refresh();}
 statusMessage='Cloud 1 signed in.';return getCloudStatus();
}
function emailAddress(email){
  if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email.trim()))throw new Error('Enter a valid email address.');
  return email.trim();
}
export async function requestEmailCode(email){
  const address=emailAddress(email),action=beginAuthAction();
  // Supabase's email template must include {{ .Token }} for the code entry flow.
  await authRequest('otp',{email:address,create_user:false});action.check();
  pendingEmail=address;statusMessage='Email code requested. Check your inbox and enter the code.';
  return {email:address,message:statusMessage};
}
function appEmailRedirect(redirectTo){
  const app=globalThis.location;
  let redirect;try{redirect=new URL(redirectTo);}catch{throw new Error('A valid app return URL is required.');}
  const local=['localhost','127.0.0.1','[::1]'].includes(redirect.hostname);
  if(!app?.origin||redirect.origin!==app.origin||redirect.username||redirect.password||redirect.search||redirect.hash||(redirect.protocol!=='https:'&&!(local&&redirect.protocol==='http:')))throw new Error('The sign-in link must return to this app without query parameters or a fragment.');
  return redirect.href;
}
export async function requestEmailLink(email,redirectTo){
  const address=emailAddress(email),redirect=appEmailRedirect(redirectTo),action=beginAuthAction();
  await authRequest(`otp?redirect_to=${encodeURIComponent(redirect)}`,{email:address,create_user:false});action.check();
  pendingEmail=address;statusMessage='Sign-in link requested. Open the link from your email on the device you want to use.';
  return {email:address,message:statusMessage};
}
/** Explicit registration only. Email verification creates no lab membership. */
export async function requestRegistrationEmail(email){
  const address=emailAddress(email),app=globalThis.location;
  const redirect=appEmailRedirect(app?.origin&&app?.pathname?app.origin+app.pathname:''),action=beginAuthAction();
  await authRequest(`otp?redirect_to=${encodeURIComponent(redirect)}`,{email:address,create_user:true});action.check();
  pendingEmail=address;statusMessage='Verification email requested. Open the link to submit your registration.';
  return {email:address,message:statusMessage};
}
export async function consumeAuthCallback(){
  const location=globalThis.location,fragment=new URLSearchParams((location?.hash??'').replace(/^#/,''));
  if(!['access_token','refresh_token','error','error_description','error_code'].some(key=>fragment.has(key)))return null;
  const action=beginAuthAction();
  // Remove credentials from the address and history before doing any asynchronous
  // work. Never place callback tokens in logs, DOM text, or persistent storage.
  try{globalThis.history.replaceState(globalThis.history.state,'',`${location.pathname}${location.search}`);}
  catch{saveSession(null);invalidate();throw new Error('Unable to clear the sign-in callback from the address. Close this tab and request a new link.');}
  saveSession(null);invalidate();
  try{
    if(fragment.has('error')||fragment.has('error_code'))throw new Error('This sign-in link is invalid or has expired. Request a new link.');
    const c=configuration();if(!c)throw new Error('Configure this app’s cloud project, then request a new sign-in link.');
    publicKey(c.anonKey);
    const access=fragment.get('access_token'),refresh=fragment.get('refresh_token'),type=fragment.get('type');
    if(!access||!refresh||(fragment.get('token_type')??'bearer').toLowerCase()!=='bearer'||(type&&!['magiclink','invite','signup','recovery','email'].includes(type)))throw new Error('The sign-in callback is incomplete or unsupported. Request a new link.');
    let claims;
    try{claims=JSON.parse(atob(access.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{throw new Error('The sign-in token is invalid. Request a new link.');}
    if(claims.iss!==`${c.url}/auth/v1`||claims.role!=='authenticated'||!(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes('authenticated')||typeof claims.sub!=='string'||!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000)throw new Error('This sign-in link is expired or belongs to a different cloud project.');
    const headers={apikey:c.anonKey,Authorization:`Bearer ${access}`};
    const {response:verified,result:user}=await cloudJSON(`${c.url}/auth/v1/user`,{headers,cache:'no-store'});
    action.check();if(!verified.ok)throw new Error('The cloud project rejected this sign-in link. Request a new link.');
    action.check();
    if(user?.id!==claims.sub||user.is_anonymous)throw new Error('The cloud project could not verify this account.');
    const {response:membershipResponse,result:rows}=await cloudJSON(`${c.url}/rest/v1/memberships?select=role,active,export_level,permissions,guest_level,guest_permissions,guest_access_starts_on,guest_access_ends_on,notes_permissions,mouse_permissions,reagents_permissions,updated_at&user_id=eq.${encodeURIComponent(user.id)}&colony_id=eq.${encodeURIComponent(c.colonyId)}`,{headers,cache:'no-store'});
    action.check();if(!membershipResponse.ok)throw new Error('Unable to verify colony membership. Sign in again or contact the colony owner.');
    action.check();
    let pendingSetup=false;
    if(Array.isArray(rows)&&rows.length===0){
      const {response:profileResponse,result:profile}=await cloudJSON(`${c.url}/rest/v1/rpc/get_my_lab_member`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({p_colony_id:c.colonyId})});
      action.check();pendingSetup=profileResponse.ok&&setupProfileAllowed(profile);
    }
    if(!pendingSetup&&(!Array.isArray(rows)||rows.length!==1||rows[0].active!==true||!['owner','manager','editor','viewer'].includes(rows[0].role)))throw new Error('This account is not an active member of the configured colony.');
    const member=rows[0]||{role:'pending',permissions:{},export_level:null};assertGuestAvailability(member);
    action.check();
    if(type==='recovery'){await local('delete');await clearHistoryIndex();action.check();setStorage('localStorage',CLOUD_CACHE_KEY,null);}
    // A local JWT decode only checks scope; the current project's Auth endpoint
    // authenticates the token. Persist only after that and membership both pass.
    saveSession({access_token:access,refresh_token:refresh,token_type:'bearer',expires_at:claims.exp,user,role:member.role,guestLevel:member.guest_level||null,guestPermissions:member.guest_permissions||{},guestAccessStartsOn:member.guest_access_starts_on??null,guestAccessEndsOn:member.guest_access_ends_on??null,passwordRecovery:type==='recovery',permissions:type==='recovery'?{}:member.permissions||{},...appPermissionFields(member,true),setupRequired:pendingSetup,exportLevel:pendingSetup?null:member.role==='owner'?'max':member.export_level||'low'});
    if(!pendingSetup&&type!=='recovery')await checkRegisteredUsernameSetup(action);
    pendingEmail=null;statusMessage=type==='recovery'?'Set a new password to finish account recovery.':'Signed in. Pull the shared colony to continue.';
    return {...getCloudStatus(),needsPasswordSetup:session()?.setupRequired===true||type==='invite'||type==='recovery'};
  }catch(error){
    if(!action.current())throw new Error('The account or cloud configuration changed. Start sign-in again.');
    saveSession(null);invalidate();
    statusMessage=error instanceof TypeError?'The sign-in link could not be verified because the cloud is unreachable. Request a new link when connected.':error.message;
    throw new Error(statusMessage);
  }
}
export async function verifyEmailCode(email,token){
  const address=emailAddress(email),code=typeof token==='string'?token.trim():'';
  if(!/^\d{6,10}$/.test(code))throw new Error('Enter the numeric verification code from your email.');
  const action=beginAuthAction();saveSession(null);invalidate();const result=normalizeSession(await authRequest('verify',{email:address,token:code,type:'email'}));
  action.check();saveSession(result);invalidate();
  try{await establishMembershipOrSetup(action);action.check();pendingEmail=null;statusMessage='Signed in. Pull the shared colony to continue.';}
  catch(e){if(action.current()){saveSession(null);invalidate();statusMessage=e.message;}throw e;}
  return getCloudStatus();
}
export async function signOut(){
  advanceAuthGeneration();const s=session(),wasCloud=mode()==='cloud'||Boolean(readJSON('localStorage',CLOUD_CACHE_KEY)),nasLogout=operationalProvider?.cloud2.signOut().catch(()=>{});clearOperationalSession();saveSession(null);pendingEmail=null;setMode('local');invalidate();feeVisibility=null;feeVisibilityContext=null;if(wasCloud){await local('delete');setStorage('localStorage',CLOUD_CACHE_KEY,null);await clearHistoryIndex();}statusMessage=wasCloud?'Signed out. Cached views cleared.':'Signed out. Local data is retained.';
  await nasLogout;
  if(s?.access_token)try{await authRequest('logout',null,s.access_token);}catch{/* Local credentials are already removed even if the server is unreachable. */}
}

export async function updateAccountPassword(password) {return updateAccountPasswordVerified(password);}
async function updateAccountPasswordVerified(password,verifiedSetup=null) {
  const c=configuration(),signedIn=session(),generation=authGeneration;
  if(!c)throw new Error('Configure the cloud project first.');
  if(!signedIn?.access_token||!signedIn.user?.id)throw new Error('Sign in before changing your account password.');
  if(typeof password!=='string'||password.length<12||password.length>128)throw new Error('Use an account password between 12 and 128 characters.');
  if(signedIn.passwordRecovery)throw new Error('Use the password recovery form to finish resetting your password.');
  if(signedIn.role==='pending'){
    const verified=verifiedSetup?.actor===signedIn.user.id&&verifiedSetup.generation===generation&&verifiedSetup.url===c.url&&verifiedSetup.colonyId===c.colonyId;
    if(!verified){const mine=await getMyLabMember();if(!mine?.eligible||!mine.setup_required)throw new Error('Your account is not eligible for first-time setup.');}
  }else await membership();
  const token=await accessToken(),current=configuration();
  if(current?.url!==c.url||current.colonyId!==c.colonyId||session()?.user?.id!==signedIn.user.id)throw new Error('The cloud account or colony changed. Sign in again before changing your password.');
  let response,result;
  try {
    ({response,result}=await cloudJSON(`${c.url}/auth/v1/user`,{method:'PUT',cache:'no-store',redirect:'error',headers:{apikey:publicKey(c.anonKey),Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({password})}));
  }catch(error){const safe=new Error('The account-password update was not confirmed. Check your connection before trying again.');safe.connectionUnavailable=error?.connectionUnavailable===true||error instanceof TypeError;throw safe;}
  if(generation!==authGeneration||configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==signedIn.user.id)throw new Error('The account changed. Sign in again before changing your password.');
  if(!response.ok) {
    if(response.status===401||response.status===403)throw apiError(response,null);
    // Do not echo an Auth error body, which could contain a rejected credential.
    throw new Error('The account-password update was rejected. Use a different password or sign in again if a recent login is required.');
  }
  if(result?.id!==signedIn.user.id)throw new Error('The server did not confirm the account-password update for your signed-in user.');
  // Auth responses are deliberately not persisted; only the existing session remains.
  return {user_id:result.id,message:'Account password updated.'};
}

export async function updateAccountProfile(name) {
  const c=configuration(),signedIn=session();
  if(!c)throw new Error('Configure the cloud project first.');
  if(!signedIn?.access_token||!signedIn.user?.id)throw new Error('Sign in before updating your account profile.');
  if(typeof name!=='string'||!name.trim()||name.trim().length>120)throw new Error('Enter a name between 1 and 120 characters.');
  const fullName=name.trim();
  await membership();
  const token=await accessToken(),current=configuration();
  if(current?.url!==c.url||current.colonyId!==c.colonyId||session()?.user?.id!==signedIn.user.id)throw new Error('The cloud account or colony changed. Sign in again before updating your profile.');
  let response;
  try {
    // GoTrue merges the supplied user metadata; no ownership or access role is sent.
    response=await fetch(`${c.url}/auth/v1/user`,{method:'PUT',cache:'no-store',redirect:'error',headers:{apikey:publicKey(c.anonKey),Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({data:{full_name:fullName}})});
  }catch{throw new Error('The profile update was not confirmed. Check your connection before trying again.');}
  const result=await responseJSON(response);
  if(!response.ok)throw apiError(response,result);
  if(result?.id!==signedIn.user.id||result.user_metadata?.full_name!==fullName)throw new Error('The server did not confirm the new name for your signed-in user.');
  const activeSession=session(),activeConfig=configuration();
  if(activeSession?.user?.id!==signedIn.user.id||activeConfig?.url!==c.url||activeConfig.colonyId!==c.colonyId)throw new Error('Your account changed while saving. Sign in again to load the updated profile.');
  saveSession({...activeSession,user:result});
  return {user_id:result.id,name:fullName,message:'Account profile updated.'};
}
const feeRecord=r=>r?.entity_type==='husbandry_events'&&(/^(lac_fee|fee|fees|billing)_/.test(r.payload?.event_type||'')||['animal_sheet_cage_snapshot','animal_sheet_source_change'].includes(r.payload?.event_type)||['source_cage_snapshot','animal_sheet_change','lac_fee_options','lac_fee_month','fee_options','fee_month','fee_actual','fees','billing','billing_options','billing_month'].some(k=>Object.hasOwn(r.payload||{},k)));
function checkedFeeVisibility(value){
 if(!value||!Number.isInteger(value.version)||value.version<0||typeof value.owner!=='boolean'||typeof value.estimate!=='boolean'||typeof value.actual!=='boolean'||typeof value.source_archive_allowed!=='boolean'||value.source_archive_allowed&&!(value.estimate&&value.actual)||value.history_allowed!==undefined&&(typeof value.history_allowed!=='boolean'||value.history_allowed===false&&(value.source_archive_allowed||typeof value.history_from!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.history_from))))throw new Error('Fee visibility could not be verified. Reconnect before loading financial data.');
 return value;
}
function validCageObservation(value){
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),keys=(v,list)=>object(v)&&Object.keys(v).length===list.length&&list.every(k=>Object.hasOwn(v,k));
 const nullable=(v,fn)=>v===null||fn(v),text=(v,max)=>typeof v==='string'&&v.length<=max,cell=v=>nullable(v,x=>typeof x==='string'&&/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(x));
 const date=v=>nullable(v,x=>{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;const ms=Date.parse(x+'T00:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===x;});
 if(!keys(value,['schemaVersion','animals','startedDate','intensityLux','managerName','managerCell','startedCell','intensityCell'])||value.schemaVersion!==1||!Array.isArray(value.animals)||value.animals.length>100||!date(value.startedDate)||!nullable(value.intensityLux,x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1000000)||!nullable(value.managerName,x=>text(x,160))||!['managerCell','startedCell','intensityCell'].every(k=>cell(value[k])))return false;
 return value.animals.every(a=>keys(a,['key','tag','note','dateOfBirth','earMark','left','right','sex','sourceCell','requiresReview'])&&text(a.key,512)&&a.key.length>0&&text(a.tag,240)&&a.tag.length>0&&text(a.note,2000)&&date(a.dateOfBirth)&&nullable(a.earMark,x=>typeof x==='string'&&/^L\d{1,2}R\d{1,2}$/.test(x))&&['left','right'].every(k=>nullable(a[k],x=>Number.isInteger(x)&&x>=0&&x<=99))&&nullable(a.sex,x=>['Male','Female'].includes(x))&&cell(a.sourceCell)&&typeof a.requiresReview==='boolean'&&(a.earMark===null||a.left===null||a.right===null||a.earMark===`L${a.left}R${a.right}`));
}
function validLocationCageStart(value,locationId){
 const date=v=>v===null||typeof v==='string'&&/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 const text=(v,min,max)=>typeof v==='string'&&v.length>=min&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||!['schemaVersion','basis','date','source_fingerprint'].every(k=>Object.hasOwn(value,k))||value.schemaVersion!==1||value.basis!=='manual'||!date(value.date)||!text(value.source_fingerprint,1,2048))return false;
 let anchor;try{anchor=JSON.parse(value.source_fingerprint);}catch{return false;}
 return Array.isArray(anchor)&&anchor.length===4&&text(anchor[0],1,240)&&anchor[0]===locationId&&(anchor[1]===null||typeof anchor[1]==='string'&&/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(anchor[1]))&&(anchor[2]===null||text(anchor[2],1,240))&&date(anchor[3])&&(anchor[2]!==null||anchor[1]===null&&anchor[3]===null);
}
function validLocationCageEntrainment(value,locationId){
 const date=v=>typeof v==='string'&&/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 const scheme=v=>typeof v==='string'&&(['LD','DD','DL','LL','LDLD','SP','SP1','SP2','LP','LP1','LP2','T23','T24','T25'].includes(v)||/^T\d+(?:\.\d+)?$/.test(v)&&Number(v.slice(1))>0&&Number(v.slice(1))<=1000&&'T'+Number(v.slice(1))===v);
 return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3&&['schemaVersion','entries','source_fingerprint'].every(k=>Object.hasOwn(value,k))&&value.schemaVersion===1&&Array.isArray(value.entries)&&value.entries.length>0&&value.entries.length<=1000&&value.entries.every((row,i)=>row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===2&&Object.hasOwn(row,'date')&&Object.hasOwn(row,'scheme')&&date(row.date)&&scheme(row.scheme)&&(i===0||value.entries[i-1].date<row.date))&&validLocationCageStart({schemaVersion:1,basis:'manual',date:null,source_fingerprint:value.source_fingerprint},locationId);
}
function managedLocationPayload(payload){return payload&&typeof payload==='object'&&!Array.isArray(payload)&&Object.keys(payload).every(key=>MANAGED_LOCATION_KEYS.has(key))&&(!Object.hasOwn(payload,'source_cage_observation')||payload.source_cage_observation===null||validCageObservation(payload.source_cage_observation))&&(!Object.hasOwn(payload,'cage_start')||validLocationCageStart(payload.cage_start,payload.location_id))&&(!Object.hasOwn(payload,'cage_entrainment')||validLocationCageEntrainment(payload.cage_entrainment,payload.location_id));}
function currentRestrictedCache(data,mark,policy){
 return data?.source_archive_restricted===true&&data.source_projection_version===SOURCE_PROJECTION_VERSION&&mark?.source_projection_version===SOURCE_PROJECTION_VERSION&&mark.estimate===policy.estimate&&mark.actual===policy.actual&&mark.fee_history_allowed===policy.history_allowed&&mark.fee_history_from===policy.history_from&&(data.tables?.locations||[]).every(managedLocationPayload);
}
function sameFeeVisibility(a,b){return a.version===b.version&&a.estimate===b.estimate&&a.actual===b.actual&&a.source_archive_allowed===b.source_archive_allowed&&a.history_allowed===b.history_allowed&&a.history_from===b.history_from;}
function checkedManagedLocation(row,colonyId){
 if(row?.entity_type!=='locations'||row.colony_id!==colonyId||typeof row.entity_id!=='string'||!row.entity_id||!Number.isInteger(row.version)||row.version<1||typeof row.archived!=='boolean'||!managedLocationPayload(row.payload)||row.payload.location_id!==row.entity_id||Boolean(row.payload.app_archived_at)!==row.archived)throw new Error('Invalid projected location record. Pull the latest cloud data.');
 return row;
}
async function refreshFeeVisibility({notify=true,cloudSource=null,canCommit=()=>true}={}){
 const checkForeground=()=>{if(!canCommit())throw Object.assign(new Error('Background connection check cancelled.'),{code:'BACKGROUND_CANCELLED'});};checkForeground();
 if(isGuest(session())){const context=exportContext();const visible=guestAllows(session(),'mouse.fees.read')?checkedFeeVisibility(await request('rpc/get_lac_fee_visibility',{method:'POST',body:{p_colony_id:configuration().colonyId},cloudSource,canCommit})):{version:0,owner:false,estimate:false,actual:false};checkExportContext(context);checkForeground();feeVisibility={...visible,owner:false,source_archive_allowed:false,history_allowed:false};feeVisibilityContext=context;return clone(feeVisibility);}
 const generation=authGeneration,context=exportContext(),c=configuration();if(!c||!hasLabSession())throw new Error('Sign in before loading shared fee visibility.');
 const check=()=>{if(generation!==authGeneration)throw new Error('The account or colony changed during loading. Open the shared colony again.');checkExportContext(context);checkForeground();};
 const value=checkedFeeVisibility(await request('rpc/get_lac_fee_visibility',{method:'POST',body:{p_colony_id:c.colonyId},cloudSource,canCommit}));check();
 const previousPolicy=feeVisibility,changed=feeVisibilityContext!==context||!feeVisibility||!sameFeeVisibility(feeVisibility,value);
 feeVisibility=value;feeVisibilityContext=context;
 // A projected baseline cannot become a full replacement when access expands.
 // Reload the previously withheld fields before allowing another cloud edit.
 if(previousPolicy?.source_archive_allowed===false&&value.source_archive_allowed)invalidate();
 if(!value.source_archive_allowed){
  const cached=await local('get',undefined,{check,managedOnly:true});check();const mark=readJSON('localStorage',CLOUD_CACHE_KEY),validCache=currentRestrictedCache(cached,mark,value)&&mark.url===c.url&&mark.colony===c.colonyId&&mark.user===session()?.user?.id;
  if(changed||!validCache){
  check();invalidate();if(!validCache)await local('delete',undefined,{check});check();
  await clearHistoryIndex({check,registerCancel:cancel=>{guardedCacheWrites.add(cancel);return()=>guardedCacheWrites.delete(cancel);}});check();
  if(notify&&globalThis.dispatchEvent&&globalThis.CustomEvent)globalThis.dispatchEvent(new CustomEvent('lac-fee-visibility-changed',{detail:{estimate:value.estimate,actual:value.actual,source_archive_allowed:false}}));
  }
 }
 return clone(value);
}
export async function getLacFeeVisibility(){
 if(mode()==='local'&&(!configuration()||getStorage('localStorage',DEMO_KEY)==='true'))return {version:0,owner:false,estimate:true,actual:true,source_archive_allowed:true,local:true};
 await membership();return refreshFeeVisibility();
}
export async function saveLacFeeVisibility({version,levels}){
 await membership();const context=exportContext(),c=configuration();
 if(session()?.role!=='owner')throw new Error('Only the owner can change fee visibility.');
 const value=checkedFeeVisibility(await request('rpc/save_lac_fee_visibility',{method:'POST',body:{p_colony_id:c.colonyId,p_version:version,p_levels:levels}}));checkExportContext(context);feeVisibility=value;feeVisibilityContext=context;return clone(value);
}
async function readCloudPage(read,limit,check){
  while(true){
    check();
    try{const page=await read(limit);check();return {page,limit};}
    catch(error){
      check();
      if(error.statementTimeout!==true||limit<=1)throw error;
      // Keep the same cursor/offset: the failed query returned no usable records.
      // Retain the smaller page size for the rest of this stream.
      limit=Math.max(1,Math.floor(limit/2));
    }
  }
}
// A verified baseline can save network traffic, never authorize access.
// Membership and visibility are checked anew before any of these rows are reused.
function persistentIdentity(){
 const s=session(),c=configuration();
 // Discovering a verified source-cell index remembers its historyPath locally.
 // Only connection credentials and colony selection identify the cloud; that
 // source locator must not invalidate an otherwise verified edit baseline.
 return stable({configuration:c?{url:c.url,anonKey:c.anonKey,colonyId:c.colonyId}:null,user:s?.user?.id,role:s?.role,permissions:s?.permissions,...appPermissionFields(s),exportLevel:s?.exportLevel,source:providerSource||'cloud1'});
}
function syncIdentity(){return stable({generation:authGeneration,identity:persistentIdentity()});}
async function cacheDigest(value){
  const bytes=new TextEncoder().encode(stable(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
// A pull owns its payload objects from cache verification through the atomic
// cache commit. Reuse a checksum only for that exact object in that one pull;
// a later pull must verify persisted bytes afresh before trusting any row.
async function payloadDigest(payload,digests=null){
 const known=digests?.get(payload);if(known)return known;
 const digest=await cacheDigest(payload);digests?.set(payload,digest);return digest;
}
const SUMMARY_COMPUTED_KEYS=new Set(['counts','mouse_state_counts','mice_without_recorded_genotype','mice_without_recorded_parents','mice_with_multiple_candidate_dams']);
const DEFERRED_HISTORY_ERROR='Deferred history changed or is unverified. Reload shared data before saving.';
function archiveProjection(data){
 const value={...data,tables:Object.fromEntries(Object.entries(data.tables||{}).filter(([type])=>!MANAGED.includes(type)))};
 for(const key of ['source_archive_deferred','managed_records_deferred','_cloud_read_context','fee_visibility','source_archive_restricted'])delete value[key];
 if(value.summary){value.summary=Object.fromEntries(Object.entries(value.summary).filter(([key])=>!SUMMARY_COMPUTED_KEYS.has(key)));if(!Object.keys(value.summary).length)delete value.summary;}
 return value;
}
async function deferredMarker(head,loaded=[]){
 return {schema_version:1,manifest_version:head.version,manifest_sha256:await cacheDigest(head.payload),tables:Object.fromEntries(Object.entries(head.payload.archive_tables||{}).map(([table,value])=>[table,value.row_count])),loaded_tables:[...loaded].sort()};
}
export function getDeferredHistoryTables(data){
 const marker=data?.source_archive_deferred;
 return marker?.schema_version===1&&marker.tables&&Array.isArray(marker.loaded_tables)?Object.keys(marker.tables).filter(table=>!marker.loaded_tables.includes(table)):[];
}
async function deferredStateOf(rows,data){
 if(!data.source_archive_deferred)return null;
 const head=rows.find(row=>row.entity_type==='archive'&&row.entity_id==='reconstruction');
 return {head:clone(head),loadedTables:[...data.source_archive_deferred.loaded_tables],marker:clone(data.source_archive_deferred),projectionHash:await cacheDigest(archiveProjection(data)),managedHash:await cacheDigest(Object.fromEntries(MANAGED.map(type=>[type,data.tables[type]]))),records:new Map(rows.filter(row=>row.entity_type==='archive').map(row=>[recordKey(row),row])),identity:syncIdentity(),policy:clone(feeVisibility)};
}
async function assertDeferredData(data,state){
 if(data.source_archive_restricted||!state||state.identity!==syncIdentity()||!sameFeeVisibility(state.policy,feeVisibility)||stable(data.source_archive_deferred)!==stable(state.marker)||await cacheDigest(archiveProjection(data))!==state.projectionHash)throw new Error(DEFERRED_HISTORY_ERROR);
}
async function restoreDeferredState(snapshot,envelope,check){
 const saved=envelope.deferred_archive;if(!saved||!Array.isArray(saved.loaded_tables)||new Set(saved.loaded_tables).size!==saved.loaded_tables.length||typeof saved.projection_sha256!=='string')throw new Error('The deferred cache descriptor is invalid.');
 const head=checkedCloudRecord(saved.head,'archive',configuration());if(head.entity_id!=='reconstruction'||head.archived||head.payload.archive_format!==ARCHIVE_MANIFEST_FORMAT)throw new Error('The deferred manifest is invalid.');
 await decodeArchive([head],{tables:[]});check();
 if(saved.loaded_tables.some(table=>!Object.hasOwn(head.payload.archive_tables,table))||stable(snapshot.data.source_archive_deferred)!==stable(await deferredMarker(head,saved.loaded_tables))||await cacheDigest(archiveProjection(snapshot.data))!==saved.projection_sha256)throw new Error('The deferred cache does not match its manifest.');
 const encoded=await encodeArchive({tables:Object.fromEntries(saved.loaded_tables.map(table=>[table,snapshot.data.tables?.[table]]))});check();
 const archive=[head,...encoded.filter(isArchiveChunk)];await decodeArchive(archive,{tables:saved.loaded_tables});check();
 return {head:clone(head),loadedTables:[...saved.loaded_tables],marker:clone(snapshot.data.source_archive_deferred),projectionHash:saved.projection_sha256,managedHash:await cacheDigest(Object.fromEntries(MANAGED.map(type=>[type,snapshot.data.tables[type]]))),records:new Map(archive.map(row=>[recordKey(row),row])),identity:syncIdentity(),policy:clone(feeVisibility)};
}
async function readArchiveHead(c,check,read=request){
 const query=new URLSearchParams({select:'colony_id,entity_type,entity_id,payload,version,archived',colony_id:`eq.${c.colonyId}`,entity_type:'eq.archive',entity_id:'eq.reconstruction',limit:'1'}),page=(await readCloudPage(()=>read(`entity_records?${query}`),1,check)).page;
 if(!Array.isArray(page)||page.length!==1)throw new Error('The reconstruction manifest is missing.');
 const head=checkedCloudRecord(page[0],'archive',c);if(head.entity_id!=='reconstruction'||head.archived)throw new Error('The reconstruction manifest is invalid.');await decodeArchive([head],{tables:[]});check();return head;
}
async function verifyArchiveHead(c,head,check,read=request){
 const query=new URLSearchParams({select:'colony_id,entity_type,entity_id,version,archived',colony_id:`eq.${c.colonyId}`,entity_type:'eq.archive',entity_id:'eq.reconstruction',limit:'1'}),page=(await readCloudPage(()=>read(`entity_records?${query}`),1,check)).page;
 if(!Array.isArray(page)||page.length!==1)throw new Error('The reconstruction manifest changed during loading. Pull again.');
 const latest=checkedCloudRecord(page[0],'archive',c,false);if(latest.entity_id!=='reconstruction'||latest.archived||latest.version!==head.version)throw new Error('The reconstruction manifest changed during loading. Pull again.');
}
async function mapBounded(values,fn,check){
  const result=new Array(values.length);let next=0,failure=null;
  async function worker(){try{while(true){check();if(failure)throw failure;const index=next++;if(index>=values.length)return;result[index]=await fn(values[index],index);check();}}catch(error){failure??=error;throw error;}}
  await Promise.all(Array.from({length:Math.min(16,values.length)},()=>worker()));check();return result;
}
const ordinaryManagedRecord=row=>MANAGED.includes(row?.entity_type)&&row.entity_type!=='locations'&&!feeRecord(row);
async function baselineEnvelope(rows,writeId,check,recordVersions=versions,deferredState=deferredArchiveState,payloadDigests=null){
  const policy=clone(feeVisibility),identity=persistentIdentity();
  const coverage=Object.hasOwn(rows,'managed_coverage')?rows.managed_coverage:managedReadCoverage;
  if(!policy.source_archive_allowed)rows=rows.filter(ordinaryManagedRecord);
  if(rows.length>MAX_BASELINE_RECORDS)return null;
  const entries=await mapBounded(rows,async row=>{
    const version=row.version??recordVersions.get(recordKey(row));
    if(!Number.isSafeInteger(version)||version<1)throw new Error('The saved cloud version could not be verified. Pull again.');
    // Archive IDs are already SHA-256 hashes of their canonical payloads.
    return [row.entity_type,row.entity_id,version,row.archived,isArchiveChunk(row)?row.entity_id.slice(6):await payloadDigest(row.payload,payloadDigests)];
  },check);
  const body={schema_version:BASELINE_CACHE_VERSION,projection_version:SOURCE_PROJECTION_VERSION,write_id:writeId,identity,policy,entries,...(coverage?{managed_coverage:checkedManagedCoverage(coverage)}:{}),...(!deferredState&&policy.source_archive_allowed?{archive_complete:true}:{}),...(deferredState?{deferred_archive:{head:clone(deferredState.head),loaded_tables:[...deferredState.loadedTables],projection_sha256:deferredState.projectionHash}}:{})};
  if(utf8Size(body)>MAX_BASELINE_BYTES)return null;
  const sha256=await cacheDigest(body);check();
  if(identity!==persistentIdentity()||stable(policy)!==stable(feeVisibility))throw new Error('Cloud access changed while preparing the saved workspace. Pull again.');
  return {...body,sha256};
}
async function startupCacheValue(value,envelope,writeId,check=()=>{}){
 const data=startupProjection(value),saved={schema_version:STARTUP_CACHE_VERSION,write_id:writeId,data};
 if(!envelope)return saved;
 const ids=new Set(MANAGED.flatMap(type=>(data.tables[type]||[]).map(row=>`${type}:${row[ID_FIELDS[type]]}`)));
 const body={schema_version:BASELINE_CACHE_VERSION,projection_version:SOURCE_PROJECTION_VERSION,write_id:writeId,identity:envelope.identity,policy:clone(envelope.policy),entries:envelope.entries.filter(entry=>ids.has(`${entry[0]}:${entry[1]}`)),managed_coverage:checkedManagedCoverage(data.managed_records_deferred),parent_sha256:envelope.sha256,current_projection:true};
 check?.();saved.baseline={...body,sha256:await cacheDigest(body)};check?.();return saved;
}
async function persistedBaseline(policy,check,{managedOnly=false,payloadDigests=null,startupSnapshot=null}={}){
  // Share only this opening's already-read atomic snapshot. Fresh server
  // membership, policy and per-record version checks still run normally.
  const reusable=startupSnapshot&&startupSnapshot.generation===authGeneration&&startupSnapshot.identity===persistentIdentity()&&startupSnapshot.source===providerSource&&startupSnapshot.revision===providerRevision&&startupSnapshot.writeId===readJSON('localStorage',CLOUD_CACHE_KEY)?.write_id;
  const snapshot=reusable?startupSnapshot.snapshot:await local('get',undefined,{check,readBaseline:true,managedOnly});check();
  const envelope=snapshot?.baseline,mark=readJSON('localStorage',CLOUD_CACHE_KEY);
  if(!snapshot?.data||!envelope||envelope.schema_version!==BASELINE_CACHE_VERSION||envelope.projection_version!==SOURCE_PROJECTION_VERSION||typeof envelope.write_id!=='string'||envelope.write_id!==snapshot.mark?.id||envelope.write_id!==mark?.write_id||(managedOnly?envelope.current_projection!==true||envelope.parent_sha256!==mark?.baseline_sha256:envelope.sha256!==mark?.baseline_sha256)||envelope.identity!==persistentIdentity()||stable(envelope.policy)!==stable(policy)||!Array.isArray(envelope.entries)||envelope.entries.length>MAX_BASELINE_RECORDS)return null;
  if(policy.source_archive_allowed?snapshot.data.source_archive_restricted:!currentRestrictedCache(snapshot.data,mark,policy))return null;
  try{
    const {sha256,...body}=envelope;
    if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||utf8Size(body)>MAX_BASELINE_BYTES||await cacheDigest(body)!==sha256)return null;check();
    const coverage=envelope.managed_coverage?checkedManagedCoverage(envelope.managed_coverage):null;
    if(!managedOnly&&stable(snapshot.data.managed_records_deferred||null)!==stable(coverage))return null;
    if(managedOnly&&snapshot.data.managed_records_deferred)checkedManagedCoverage(snapshot.data.managed_records_deferred);
    const indexed=new Map();
    for(const entry of envelope.entries){
      if(!Array.isArray(entry)||entry.length!==5||![...MANAGED,'archive'].includes(entry[0])||typeof entry[1]!=='string'||!entry[1]||!Number.isSafeInteger(entry[2])||entry[2]<1||typeof entry[3]!=='boolean'||typeof entry[4]!=='string'||!/^[a-f0-9]{64}$/.test(entry[4]))return null;
      if(!policy.source_archive_allowed&&['archive','locations'].includes(entry[0]))return null;
      const key=recordKey({entity_type:entry[0],entity_id:entry[1]});if(indexed.has(key))return null;indexed.set(key,entry);
    }
    // Reconstruct from the same atomically saved workspace. Normalization can
    // legitimately add defaults: mismatched rows are fetched afresh, not guessed.
    // Startup needs the current managed records, not source tables opened in a
    // previous visit. Re-encoding a complete/deferred archive here made one old
    // history visit permanently slow subsequent launches. Its fresh manifest
    // is checked below by allRecords; source chunks remain available on demand.
    const deferredState=!managedOnly&&snapshot.data.source_archive_deferred?await restoreDeferredState(snapshot,envelope,check):null;
    if(!managedOnly&&!deferredState&&envelope.deferred_archive)return null;
    const input=managedOnly?{...snapshot.data,tables:Object.fromEntries(MANAGED.map(type=>[type,snapshot.data.tables?.[type]||[]]))}:snapshot.data;
    const candidates=await entityRecords(input,deferredState,{managedOnly});check();const records=new Map(),knownVersions=new Map();
    await mapBounded(candidates,async row=>{
      if(!policy.source_archive_allowed&&!ordinaryManagedRecord(row))return;
      const key=recordKey(row),entry=indexed.get(key);if(!entry||entry[3]!==row.archived)return;
      const digest=isArchiveChunk(row)?row.entity_id.slice(6):await payloadDigest(row.payload,payloadDigests);if(digest!==entry[4])return;
      records.set(key,row);knownVersions.set(key,entry[2]);
    },check);
    if(deferredState){for(const row of deferredState.records.values()){const key=recordKey(row),entry=indexed.get(key);if(!records.has(key)||!entry)throw new Error('The deferred archive cache is incomplete.');records.get(key).version=entry[2];records.get(key).colony_id=configuration().colonyId;}deferredState.records=new Map([...records].filter(([,row])=>row.entity_type==='archive'));}
    return {records,versions:knownVersions,identity:syncIdentity(),policy:clone(policy),deferredState,managedCoverage:coverage};
  }catch(error){check();return null;}
}
function checkedCloudRecord(row,type,c,payload=true){
  // PostgreSQL btrim(id) excludes only ordinary spaces, not tabs/NBSP.
  if(!row||typeof row.colony_id!=='string'||row.colony_id.toLowerCase()!==c.colonyId.toLowerCase()||row.entity_type!==type||typeof row.entity_id!=='string'||!row.entity_id.length||row.entity_id.startsWith(' ')||row.entity_id.endsWith(' ')||[...row.entity_id].length>200||!Number.isSafeInteger(row.version)||row.version<1||typeof row.archived!=='boolean'||payload&&(!row.payload||typeof row.payload!=='object'||Array.isArray(row.payload)||type!=='archive'&&row.payload[ID_FIELDS[type]]!==row.entity_id))throw new Error('Cloud page contains an invalid or unrelated record.');
  return row;
}
function reusableRecord(reuse,row,c){
  const key=recordKey(row),cached=reuse?.records.get(key);
  if(!cached||reuse.versions.get(key)!==row.version||cached.archived!==row.archived)return null;
  return checkedCloudRecord({...cached,colony_id:c.colonyId,version:row.version},row.entity_type,c);
}
async function managedVersionIndex(type,c,check,read=request,scope=null,eventTypes=[]){
  const index=new Map();let cursor=null,limit=1000;
  while(true){
    const loaded=await readCloudPage(size=>{
      if(scope)return read('rpc/get_managed_record_page',{method:'POST',cloudSource:'cloud1',body:{p_colony_id:c.colonyId,p_entity_type:type,p_scope:scope,p_event_types:eventTypes,p_after:cursor,p_limit:size,p_metadata_only:true}});
      const query=new URLSearchParams({select:'colony_id,entity_type,entity_id,version,archived',colony_id:`eq.${c.colonyId}`,entity_type:`eq.${type}`,order:'entity_id.asc',limit:String(size)});
      if(cursor!==null)query.set('entity_id',`gt.${cursor}`);return read(`entity_records?${query}`);
    },limit,check);const page=loaded.page;limit=loaded.limit;
    if(!Array.isArray(page)||page.length>limit)throw new Error('Cloud records were not returned as a valid page.');
    for(const row of page){checkedCloudRecord(row,type,c,false);if(index.has(row.entity_id))throw new Error('Cloud page cursor did not advance. Pull again.');index.set(row.entity_id,row);}
    if(page.length<limit)break;cursor=page.at(-1).entity_id;
  }
  return index;
}
async function incrementalManaged(type,c,check,reuse,restricted=false,read=request,onVerified=()=>{},scope=null,eventTypes=[]){
  const index=await managedVersionIndex(type,c,check,read,scope,eventTypes),rows=new Map(),pending=[],reused=new Set();
  for(const row of index.values()){const cached=reusableRecord(reuse,row,c);if(cached&&(!restricted||ordinaryManagedRecord(cached))){rows.set(row.entity_id,cached);reused.add(row.entity_id);}else pending.push(row);}
  onVerified(rows.size,index.size);
  // A newly opened feature may contain many uncached rows. Read bounded RPC
  // pages instead of issuing hundreds of twenty-ID payload requests.
  if(scope&&(pending.length>100||pending.length&&!feeVisibility?.source_archive_allowed)){
    const loadedRows=[],seen=new Set();let cursor=null,limit=1000;
    while(true){
      const loaded=await readCloudPage(size=>read('rpc/get_managed_record_page',{method:'POST',cloudSource:'cloud1',body:{p_colony_id:c.colonyId,p_entity_type:type,p_scope:scope,p_event_types:eventTypes,p_after:cursor,p_limit:size,p_metadata_only:false}}),limit,check);
      const page=loaded.page;limit=loaded.limit;if(!Array.isArray(page)||page.length>limit)throw new Error('Cloud records were not returned as a valid page.');
      for(const value of page){const row=checkedCloudRecord(value,type,c),expected=index.get(row.entity_id);if(!expected||row.version!==expected.version||row.archived!==expected.archived||seen.has(row.entity_id))throw new Error('Cloud records changed during loading. Retry this view.');seen.add(row.entity_id);loadedRows.push(row);}
      onVerified(loadedRows.length,index.size);if(page.length<limit)break;cursor=page.at(-1).entity_id;
    }
    const final=await managedVersionIndex(type,c,check,read,scope,eventTypes);
    if(loadedRows.length!==index.size||final.size!==index.size||[...index].some(([id,row])=>final.get(id)?.version!==row.version||final.get(id)?.archived!==row.archived))throw new Error('Cloud records changed during loading. Retry this view.');
    const result=loadedRows.filter(row=>!restricted||ordinaryManagedRecord(row));result.reused=0;return result;
  }
  const batches=[];
  for(let offset=0;offset<pending.length;){
    const batch=[pending[offset++]];
    // Simple literal keys can share a bounded IN request. Arbitrary IDs retain
    // equality parameters so punctuation/Unicode never changes filter syntax.
    if(/^[A-Za-z0-9_:-]{1,100}$/.test(batch[0].entity_id))while(offset<pending.length&&batch.length<20&&/^[A-Za-z0-9_:-]{1,100}$/.test(pending[offset].entity_id))batch.push(pending[offset++]);
    batches.push(batch);
  }
  let next=0,failure=null;
  const active=()=>{check();if(failure)throw failure;};
  async function worker(){try{while(true){active();const batch=batches[next++];if(!batch)return;
    let offset=0,limit=batch.length;
    while(offset<batch.length){
      const wanted=batch.slice(offset,offset+limit),expected=new Map(wanted.map(row=>[row.entity_id,row]));
      const query=new URLSearchParams({select:'colony_id,entity_type,entity_id,payload,version,archived',colony_id:`eq.${c.colonyId}`,entity_type:`eq.${type}`,entity_id:wanted.length===1?`eq.${wanted[0].entity_id}`:`in.(${wanted.map(row=>row.entity_id).join(',')})`,limit:String(wanted.length)});
      const loaded=await readCloudPage(size=>{const selected=batch.slice(offset,offset+size);query.set('entity_id',selected.length===1?`eq.${selected[0].entity_id}`:`in.(${selected.map(row=>row.entity_id).join(',')})`);query.set('limit',String(selected.length));return read(`entity_records?${query}`);},wanted.length,active);
      const page=loaded.page,selected=batch.slice(offset,offset+loaded.limit),selectedIds=new Set(selected.map(row=>row.entity_id));
      if(!Array.isArray(page)||page.length!==selected.length)throw new Error('A changed cloud record is missing. Pull again.');
      for(const value of page){const row=checkedCloudRecord(value,type,c),prior=expected.get(row.entity_id);if(!selectedIds.delete(row.entity_id)||!prior||row.version!==prior.version||row.archived!==prior.archived)throw new Error('A cloud record changed during loading. Pull again.');rows.set(row.entity_id,row);}
      active();onVerified(rows.size,index.size);
      offset+=selected.length;limit=loaded.limit;
    }
  }}catch(error){failure??=error;throw error;}}
  await Promise.all(Array.from({length:Math.min(3,batches.length)},()=>worker()));check();
  // If every live tuple exactly matches the verified atomic cache, retain that
  // existing snapshot. There are no incoming payloads to merge or recheck.
  // A changed payload or missing cached ID still requires the final scan.
  let cachedCount=0;for(const row of reuse.records.values())if(row.entity_type===type)cachedCount++;
  if(pending.length||index.size!==cachedCount){
    const final=await managedVersionIndex(type,c,check,read,scope,eventTypes);
    if(final.size!==index.size||[...index].some(([id,row])=>final.get(id)?.version!==row.version||final.get(id)?.archived!==row.archived))throw new Error('Cloud records changed during loading. Pull again.');
  }
  const result=[...index.keys()].map(id=>rows.get(id)).filter(row=>!restricted||ordinaryManagedRecord(row));result.reused=result.filter(row=>reused.has(row.entity_id)).length;return result;
}
// Only the manifest-selected chunks are needed to reconstruct a workspace.
// Keep a small version index for old immutable chunks so a later archive edit
// can safely reuse a previously staged chunk without blindly recreating it.
async function selectedArchive(c,check,onLoaded,reuse=null,tables=null){
  const fields='colony_id,entity_type,entity_id,payload,version,archived';
  const query=(select,limit,filter)=>new URLSearchParams({select,colony_id:`eq.${c.colonyId}`,entity_type:'eq.archive',order:'entity_id.asc',limit:String(limit),...(filter?{entity_id:filter}:{})});
  const valid=(row,payload=false)=>{
    if(!row||typeof row.colony_id!=='string'||row.colony_id.toLowerCase()!==c.colonyId.toLowerCase()||row.entity_type!=='archive'||typeof row.entity_id!=='string'||!(row.entity_id==='reconstruction'||/^chunk:[a-f0-9]{64}$/.test(row.entity_id))||!Number.isSafeInteger(row.version)||row.version<1||typeof row.archived!=='boolean'||payload&&(!row.payload||typeof row.payload!=='object'||Array.isArray(row.payload)))throw new Error('Cloud page contains an invalid or unrelated archive record.');
    return row;
  };
  let headPage=(await readCloudPage(size=>request(`entity_records?${query(reuse?'colony_id,entity_type,entity_id,version,archived':fields,size,'eq.reconstruction')}`),1,check)).page;
  if(!Array.isArray(headPage)||headPage.length!==1)throw new Error('Cloud import is incomplete: its reconstruction manifest is missing or duplicated. Finish or retry the initial upload before pulling.');
  const headIndex=valid(headPage[0],!reuse);let head=reuse?reusableRecord(reuse,headIndex,c):headIndex;const headReused=Boolean(reuse&&head);
  if(!head){
    headPage=(await readCloudPage(size=>request(`entity_records?${query(fields,size,'eq.reconstruction')}`),1,check)).page;
    if(!Array.isArray(headPage)||headPage.length!==1)throw new Error('The reconstruction manifest changed during loading. Pull again.');
    head=valid(headPage[0],true);if(head.version!==headIndex.version||head.archived!==headIndex.archived)throw new Error('The reconstruction manifest changed during loading. Pull again.');
  }
  if(head.entity_id!=='reconstruction'||head.archived)throw new Error('The reconstruction manifest is invalid or archived.');
  const metadata=head.payload,ids=new Set();
  if(metadata.archive_format&&metadata.archive_format!==ARCHIVE_MANIFEST_FORMAT)throw new Error('This reconstruction archive format is not supported.');
  if(metadata.archive_format===ARCHIVE_MANIFEST_FORMAT){
    if(!metadata.archive_tables||typeof metadata.archive_tables!=='object'||Array.isArray(metadata.archive_tables))throw new Error('The reconstruction chunk manifest is invalid.');
    for(const [table,descriptor] of Object.entries(metadata.archive_tables)){
      if(Object.hasOwn(ID_FIELDS,table)||!descriptor||!Number.isSafeInteger(descriptor.row_count)||descriptor.row_count<0||!Array.isArray(descriptor.chunk_ids))throw new Error(`Invalid archive descriptor for ${table}.`);
      for(const id of descriptor.chunk_ids){if(typeof id!=='string'||!/^chunk:[a-f0-9]{64}$/.test(id))throw new Error(`Invalid archive chunk reference for ${table}.`);if(tables===null||tables.includes(table))ids.add(id);}
    }
  }
  // The manifest gives the exact number of distinct required blocks, including
  // itself. Orphaned archive chunks are not part of this transfer.
  const total=ids.size+1;
  onLoaded(1,{total,reused:Number(headReused)});
  const indexed=new Map();let cursor=null,limit=1000;
  while(true){
    const loaded=await readCloudPage(size=>request(`entity_records?${query('colony_id,entity_type,entity_id,version,archived',size,cursor===null?null:`gt.${cursor}`)}`),limit,check);const page=loaded.page;limit=loaded.limit;
    if(!Array.isArray(page)||page.length>limit)throw new Error('The archive version index is invalid.');
    for(const row of page){valid(row);if(indexed.has(row.entity_id))throw new Error('The archive version cursor did not advance.');indexed.set(row.entity_id,row);}
    if(page.length<limit)break;cursor=page.at(-1).entity_id;
  }
  if(indexed.get('reconstruction')?.version!==head.version)throw new Error('The reconstruction manifest changed during loading. Pull again.');
  for(const id of ids)if(!indexed.has(id)||indexed.get(id).archived)throw new Error(`Missing or invalid archive chunk ${id}; pull was not saved.`);
  const ordered=[...ids].sort(),chunks=new Map(),needed=[];
  for(const id of ordered){const cached=reusableRecord(reuse,indexed.get(id),c);if(cached){chunks.set(id,cached);onLoaded(1,{total,reused:1});}else needed.push(id);}
  const batches=[];for(let i=0;i<needed.length;i+=3)batches.push(needed.slice(i,i+3));
  let nextBatch=0,failure=null;
  const active=()=>{check();if(failure)throw failure;};
  async function worker(){
    try{while(true){active();const batch=batches[nextBatch++];if(!batch)return;let offset=0,size=batch.length;
      while(offset<batch.length){
        const loaded=await readCloudPage(n=>request(`entity_records?${query(fields,n,`in.(${batch.slice(offset,offset+n).join(',')})`)}`),Math.min(size,batch.length-offset),active);size=loaded.limit;
        const wanted=batch.slice(offset,offset+size),page=loaded.page,seen=new Set();
        if(!Array.isArray(page)||page.length!==wanted.length)throw new Error('A referenced archive chunk is missing; pull was not saved.');
        for(const row of page){valid(row,true);if(!wanted.includes(row.entity_id)||seen.has(row.entity_id)||row.archived||row.version!==indexed.get(row.entity_id)?.version)throw new Error('A referenced archive chunk is invalid or changed; pull was not saved.');seen.add(row.entity_id);chunks.set(row.entity_id,row);}
        active();onLoaded(page.length,{total,reused:0});offset+=size;
      }
    }}catch(error){failure??=error;throw error;}
  }
  // Three small requests at a time bound load and memory while avoiding one
  // serial network round trip for every three archive blocks.
  await Promise.all(Array.from({length:Math.min(3,batches.length)},()=>worker()));check();
  const finalPage=(await readCloudPage(size=>request(`entity_records?${query('colony_id,entity_type,entity_id,version,archived',size,'eq.reconstruction')}`),1,check)).page;
  if(!Array.isArray(finalPage)||finalPage.length!==1)throw new Error('The reconstruction manifest changed during loading. Pull again.');
  const finalHead=valid(finalPage[0]);if(finalHead.entity_id!=='reconstruction'||finalHead.archived||finalHead.version!==head.version)throw new Error('The reconstruction manifest changed during loading. Pull again.');
  const result=[head,...ordered.map(id=>chunks.get(id))];result.reused=Number(headReused)+ordered.length-needed.length;result.archive_versions=[...indexed.values()].map(row=>[`archive:${row.entity_id}`,row.version]);return result;
}
async function allRecords(onProgress=null,{referencedArchive=false,reuse=null,allowPersisted=false,checkScope=null,deferHistory=false,payloadDigests=null,startupSnapshot=null,currentOnly=false,retainedCoverage=null,openingPolicy=null,canCommit=()=>true}={}){
  const generation=authGeneration,context=exportContext(),c=configuration(),policy=openingPolicy?clone(openingPolicy):await refreshFeeVisibility({notify:false,canCommit});const result=[];
  const check=()=>{checkScope?.();if(generation!==authGeneration)throw new Error('The account or colony changed during loading. Open the shared colony again.');checkExportContext(context);};
  let reusable=referencedArchive&&reuse?.identity===syncIdentity()&&stable(reuse.policy)===stable(policy)?reuse:null;
  if(currentOnly&&readJSON('localStorage',CLOUD_CACHE_KEY)?.startup_cache_version!==STARTUP_CACHE_VERSION)allowPersisted=false;
  if(!reusable&&referencedArchive&&allowPersisted)reusable=await persistedBaseline(policy,check,{managedOnly:deferHistory,payloadDigests,startupSnapshot});check();
  // Cloud 2 retains its existing source-pinned complete reader. Its broker has
  // no current-record projection RPC; never replay this scoped read there.
  const currentProjection=currentOnly&&providerSource==='cloud1';
  // Progress measures current records, never old source archive blocks. Prior
  // same-account counts are explicitly estimates until live indexes confirm
  // each table. A logical record block contains at most 1,000 current rows.
  let recordsLoaded=0,recordsTotal=null,archiveBlocksLoaded=0,archiveBlocksTotal=null,recordsReused=0,archiveBlocksReused=0;
  // The reviewed current-record contract always excludes litters. Keep that
  // table deferred, rather than spending a request to prove an empty scope.
  const types=currentProjection?MANAGED.filter(type=>type!=='litters'||retainedCoverage?.full_tables.includes(type)):MANAGED.filter(type=>policy.source_archive_allowed||type!=='locations');
  const priorCounts=new Map(types.map(type=>[type,0]));if(reusable)for(const row of reusable.records.values())if(priorCounts.has(row.entity_type))priorCounts.set(row.entity_type,priorCounts.get(row.entity_type)+1);
  const tableProgress=new Map(types.map(type=>[type,{loaded:0,total:reusable&&!currentProjection?priorCounts.get(type):null,known:false,complete:false}]));
  if(!policy.source_archive_allowed&&!currentProjection)for(const type of ['fee_projection','location_projection'])tableProgress.set(type,{loaded:0,total:null,known:false,complete:false});
  const recordProgress=()=>{
    const tables=[...tableProgress.values()],known=tables.every(table=>table.known),counted=tables.every(table=>Number.isInteger(table.total));
    return {recordBlocksLoaded:tables.reduce((n,table)=>n+(table.complete?Math.ceil(table.loaded/RECORD_BLOCK_SIZE):Math.floor(table.loaded/RECORD_BLOCK_SIZE)),0),recordBlocksTotal:counted?tables.reduce((n,table)=>n+Math.ceil(Math.max(table.total,table.loaded)/RECORD_BLOCK_SIZE),0):null,recordBlocksEstimated:!known,recordTablesLoaded:tables.filter(table=>table.complete).length,recordTablesTotal:tables.length,...(counted&&policy.source_archive_allowed?{recordsTotal:tables.reduce((n,table)=>n+Math.max(table.total,table.loaded),0)}:{})};
  };
  const progress=phase=>{check();onProgress?.({phase,recordsLoaded,recordsTotal,recordsReused,archiveBlocksLoaded,archiveBlocksTotal,archiveBlocksReused,...recordProgress()});};
  const observeType=(type,loaded,{total=null,complete=false}={})=>{const table=tableProgress.get(type);recordsLoaded+=loaded-table.loaded;table.loaded=loaded;if(total!==null){table.total=total;table.known=true;}table.complete=complete;progress('records');};
  try{
  // Independent table streams share three request slots, including their
  // changed-record reads. Each stream keeps its own serial keyset cursor.
  const streams=new Array(types.length),waiting=[];
  let nextType=0,inFlight=0,streamFailure=null;
  const active=()=>{check();if(streamFailure)throw streamFailure;};
  const acquire=()=>inFlight<3?(inFlight++,Promise.resolve()):new Promise(resolve=>waiting.push(resolve));
  const release=()=>{const next=waiting.shift();if(next)next();else inFlight--;};
  const readManaged=async(route,options={})=>{active();await acquire();try{active();return await request(route,{...options,canCommit,...(currentProjection?{cloudSource:'cloud1'}:{})});}finally{release();}};
  // The small reconstruction head is needed anyway. Read it alongside the
  // current tables using the same three slots, rather than adding a serial
  // round trip afterward. Its previous counts help a first visit estimate
  // work; they never decide which records exist or authorize a save.
  let openingHead=null;
  const openingHeadJob=policy.source_archive_allowed&&referencedArchive&&deferHistory?(async()=>{
    openingHead=await readArchiveHead(c,active,readManaged);active();
    if(!reusable&&!currentProjection){const counts=openingHead.payload.summary?.counts;if(counts&&typeof counts==='object'){for(const type of types){const table=tableProgress.get(type);if(!table.known&&Number.isSafeInteger(counts[type])&&counts[type]>=0&&counts[type]<=MAX_BASELINE_RECORDS)table.total=counts[type];}progress('records');}}
  })().catch(error=>{streamFailure??=error;}):null;
  async function readType(type,read,guard){
    const managedScope=currentProjection?(retainedCoverage?.full_tables.includes(type)?'full':['light_events','husbandry_events'].includes(type)?'cage_cards':'current'):null;
    // Restricted locations always come from the sanitized projection RPC.
    if(reusable&&type!=='archive'){
      progress('records');let rows=await incrementalManaged(type,c,guard,reusable,!policy.source_archive_allowed&&!currentProjection,read,(loaded,total)=>observeType(type,loaded,{total}),managedScope);
      if(currentProjection&&type==='husbandry_events'&&managedScope!=='full'&&retainedCoverage?.event_types.length){
       const extra=await incrementalManaged(type,c,guard,reusable,false,read,()=>{},'event_types',retainedCoverage.event_types),combined=new Map(rows.map(row=>[recordKey(row),row]));for(const row of extra)combined.set(recordKey(row),row);const reused=new Set([...rows,...extra].filter(row=>reusableRecord(reusable,row,c)).map(recordKey));rows=[...combined.values()];rows.reused=reused.size;
      }
      recordsReused+=rows.reused;observeType(type,rows.length,{total:rows.length,complete:true});return rows;
    }
    let cursor=null,limit=type==='archive'?3:1000;const seen=new Set(),rows=[];
    progress(type==='archive'?'archive':'records');
    while(true){
      // Reduce only confirmed timeout pages. OFFSET rescans earlier rows and
      // can time out even at LIMIT 1; preserve the primary-key cursor instead.
      const loaded=await readCloudPage(size=>{
        if(currentProjection)return read('rpc/get_managed_record_page',{method:'POST',cloudSource:'cloud1',body:{p_colony_id:c.colonyId,p_entity_type:type,p_scope:managedScope,p_event_types:[],p_after:cursor,p_limit:size,p_metadata_only:false}});
        const query=new URLSearchParams({select:'colony_id,entity_type,entity_id,payload,version,archived',colony_id:`eq.${c.colonyId}`,entity_type:`eq.${type}`,order:'entity_id.asc',limit:String(size)});
        // The top-level gt value is literal PostgREST text, including Unicode.
        if(cursor!==null)query.set('entity_id',`gt.${cursor}`);
        return read(`entity_records?${query}`);
      },limit,guard);
      const page=loaded.page;limit=loaded.limit;
      if(!Array.isArray(page)||page.length>limit)throw new Error('Cloud records were not returned as a valid page.');
      for(const row of page){
        checkedCloudRecord(row,type,c);
        if(seen.has(row.entity_id))throw new Error('Cloud page cursor did not advance. Pull again.');
        seen.add(row.entity_id);
      }
      const accepted=policy.source_archive_allowed||currentProjection?page:page.filter(r=>r.entity_type!=='locations'&&!feeRecord(r));
      if(type==='archive')archiveBlocksLoaded+=accepted.length;else observeType(type,rows.length+accepted.length,{...(page.length<limit?{total:rows.length+accepted.length,complete:true}:{})});
      progress(type==='archive'?'archive':'records');
      rows.push(...accepted);if(page.length<limit)break;
      cursor=page.at(-1).entity_id;
    }
    return rows;
  }
  async function worker(){
    try{while(true){active();const index=nextType++;if(index>=types.length)return;streams[index]=await readType(types[index],readManaged,active);}}
    catch(error){streamFailure??=error;throw error;}
  }
  // Drain rejected streams before returning so none can publish late progress
  // or continue reading after a failed pull. Flatten in stable table order.
  await Promise.allSettled(Array.from({length:Math.min(3,types.length)},()=>worker()));
  if(openingHeadJob)await openingHeadJob;
  if(streamFailure)throw streamFailure;check();for(const rows of streams)result.push(...rows);
  progress('verifying');
  if(policy.source_archive_allowed&&!referencedArchive)result.push(...await readType('archive',request,check));
  if(policy.source_archive_allowed)recordsTotal=recordsLoaded;
  if(policy.source_archive_allowed&&referencedArchive&&deferHistory){
    const head=openingHead||await readArchiveHead(c,check,readManaged);await verifyArchiveHead(c,head,check,readManaged);
    if(head.payload.archive_format===ARCHIVE_MANIFEST_FORMAT){
      const previous=reusable?.deferredState,same=previous&&previous.head.version===head.version&&stable(previous.head.payload)===stable(head.payload),ids=[...new Set(Object.values(head.payload.archive_tables).flatMap(value=>value.chunk_ids))],completeReuse=!previous&&reusable&&ids.every(id=>reusable.records.has('archive:'+id)),archive=same?[head,...[...previous.records.values()].filter(isArchiveChunk)]:completeReuse?[head,...ids.map(id=>({...reusable.records.get('archive:'+id),colony_id:c.colonyId,version:reusable.versions.get('archive:'+id)}))]:[head];
      result.push(...archive);if(!completeReuse)result.deferred_archive={loaded_tables:same?[...previous.loadedTables]:[]};result.archive_versions=archive.map(row=>[recordKey(row),row.version]);
    }else result.push(head);
  }else if(policy.source_archive_allowed&&referencedArchive){
    progress('archive');const archive=await selectedArchive(c,check,(count,details)=>{
      archiveBlocksLoaded+=count;archiveBlocksTotal=details.total;archiveBlocksReused+=details.reused;progress('archive');
    },reusable);
    result.push(...archive);result.archive_versions=archive.archive_versions;archiveBlocksReused=archive.reused;
  }
  if(!policy.source_archive_allowed&&!currentProjection){
   let offset=0,limit=250,projectionLoaded=0;while(true){const loaded=await readCloudPage(size=>request('rpc/get_lac_fee_records',{method:'POST',body:{p_colony_id:c.colonyId,p_offset:offset,p_limit:size}}),limit,check);const page=loaded.page;limit=loaded.limit;
    const nextPolicy=checkedFeeVisibility(page?.visibility);if(!sameFeeVisibility(nextPolicy,policy)||!Array.isArray(page.rows))throw new Error('Fee visibility changed while loading. Pull again.');
    if(page.rows.some(r=>!feeRecord(r)||r.colony_id!==c.colonyId))throw new Error('Invalid projected fee records.');result.push(...page.rows);projectionLoaded+=page.rows.length;observeType('fee_projection',projectionLoaded,{...(page.next_offset===null?{total:projectionLoaded,complete:true}:{})});
    if(page.next_offset===null)break;if(!Number.isInteger(page.next_offset)||page.next_offset<=offset)throw new Error('Invalid fee page cursor.');offset=page.next_offset;
   }
   offset=0;limit=250;projectionLoaded=0;while(true){const loaded=await readCloudPage(size=>request('rpc/get_managed_locations',{method:'POST',body:{p_colony_id:c.colonyId,p_offset:offset,p_limit:size}}),limit,check);const page=loaded.page;limit=loaded.limit;
    const nextPolicy=checkedFeeVisibility(page?.visibility);if(!sameFeeVisibility(nextPolicy,policy)||!Array.isArray(page.rows))throw new Error('Fee visibility changed while loading locations. Pull again.');
    for(const row of page.rows)result.push(checkedManagedLocation(row,c.colonyId));
    projectionLoaded+=page.rows.length;observeType('location_projection',projectionLoaded,{...(page.next_offset===null?{total:projectionLoaded,complete:true}:{})});
    if(page.next_offset===null)break;if(!Number.isInteger(page.next_offset)||page.next_offset<=offset)throw new Error('Invalid location page cursor.');offset=page.next_offset;
   }
  }
  recordsTotal=recordsLoaded;archiveBlocksTotal=archiveBlocksLoaded;
  progress('verifying');
  checkExportContext(context);const finalPolicy=await refreshFeeVisibility({notify:false,canCommit});if(!sameFeeVisibility(finalPolicy,policy))throw new Error('Fee visibility changed while loading. Pull again.');
  result.fee_visibility=policy;if(currentProjection)result.managed_coverage=retainedCoverage?checkedManagedCoverage(retainedCoverage):managedCoverage({fullTables:['rooms','racks','locations']});result.sync_summary={recordsDownloaded:result.filter(row=>row.entity_type!=='archive').length-recordsReused,recordsReused,archiveBlocksDownloaded:result.filter(row=>row.entity_type==='archive').length-archiveBlocksReused,archiveBlocksReused};return result;
  }catch(error){
    // An older read must not clear a workspace created by a later sign-in.
    const check=()=>{checkScope?.();if(generation!==authGeneration)throw error;checkExportContext(context);};
    try{check();invalidate();if(!policy.source_archive_allowed)await local('delete',undefined,{check});}catch{/* The newer account owns its cache. */}
    throw error;
  }
}
const recordKey=r=>`${r.entity_type}:${r.entity_id}`;
async function entityRecords(dataset,deferredState=deferredArchiveState,{managedOnly=false}={}){
  const data=normalizeDataset(dataset),records=[],seen=new Set();
  for(const type of MANAGED)for(const value of data.tables[type]){
    const id=value[ID_FIELDS[type]];
    if(typeof id!=='string'||!id.trim())throw new Error(`Every ${type} record requires a text identifier.`);
    const payload=clone(value);delete payload._version;
    const r={entity_type:type,entity_id:id,payload,archived:Boolean(payload.app_archived_at)};
    if(seen.has(recordKey(r)))throw new Error(`Duplicate cloud identifier: ${id}.`);seen.add(recordKey(r));records.push(r);
  }
  if(managedOnly)return records;
  if(data.source_archive_deferred){await assertDeferredData(data,deferredState);records.push(...[...deferredState.records.values()].map(row=>clone(row)));}
  else if(!data.source_archive_restricted){if(data.managed_records_deferred)throw new Error('Load the required record tables before preparing a complete workspace.');const archiveData={...data};delete archiveData._cloud_read_context;delete archiveData.fee_visibility;delete archiveData.source_archive_restricted;delete archiveData.managed_records_deferred;records.push(...await encodeArchive(archiveData));}
  return records;
}
async function assemble(rows){
  const partial=rows.fee_visibility?.source_archive_allowed===false;
  if(!partial&&!rows.some(r=>r.entity_type==='archive'&&r.entity_id==='reconstruction'))throw new Error('Cloud import is incomplete: its reconstruction manifest is missing. Finish or retry the initial upload before pulling.');
  const data=partial?{tables:{},source_archive_restricted:true,source_projection_version:SOURCE_PROJECTION_VERSION}:await decodeArchive(rows,rows.deferred_archive?{tables:rows.deferred_archive.loaded_tables}:{});
  delete data.source_archive_deferred;
  delete data.managed_records_deferred;if(rows.managed_coverage)data.managed_records_deferred=checkedManagedCoverage(rows.managed_coverage);
  if(rows.deferred_archive)data.source_archive_deferred=await deferredMarker(rows.find(row=>row.entity_type==='archive'&&row.entity_id==='reconstruction'),rows.deferred_archive.loaded_tables);
  data.tables??={};for(const type of MANAGED)data.tables[type]=[];
  const seen=new Set();
  for(const r of rows){
    if(!MANAGED.includes(r.entity_type))continue;
    if(seen.has(recordKey(r)))throw new Error('Cloud response contains duplicate record IDs.');seen.add(recordKey(r));
    if(r.payload?.[ID_FIELDS[r.entity_type]]!==r.entity_id)throw new Error(`Cloud payload identifier does not match record ${r.entity_id}.`);
    if(Boolean(r.payload.app_archived_at)!==Boolean(r.archived))throw new Error(`Archive status differs from payload for ${r.entity_id}.`);
    data.tables[r.entity_type].push(clone(r.payload));
  }
  if(partial)data.fee_visibility=rows.fee_visibility;return normalizeDataset(data);
}
function rememberCloudCache(writeId,baselineHash){const c=configuration();setStorage('localStorage',CLOUD_CACHE_KEY,JSON.stringify({url:c.url,colony:c.colonyId,user:session()?.user?.id,estimate:feeVisibility?.estimate,actual:feeVisibility?.actual,fee_history_allowed:feeVisibility?.history_allowed,fee_history_from:feeVisibility?.history_from,source_projection_version:SOURCE_PROJECTION_VERSION,startup_cache_version:STARTUP_CACHE_VERSION,...(writeId?{write_id:writeId}:{}),...(baselineHash?{baseline_sha256:baselineHash}:{})}));}
function remember(rows,deferredState=null){deferredArchiveState=deferredState;managedReadCoverage=rows.managed_coverage?checkedManagedCoverage(rows.managed_coverage):null;versions=new Map([...(rows.archive_versions||[]),...rows.map(r=>[recordKey(r),r.version])]);baseline=new Map(rows.map(r=>[recordKey(r),r]));baselineIdentity=syncIdentity();synced=true;}
export async function pullFromCloud(options={}){
 return openingRead(options.signal,(checkOpening,canCommit)=>pullFromCloudChecked({...options,checkOpening,canCommit}));
}
async function pullFromCloudChecked(options={}){
 const source=providerSource,revision=providerRevision;
 try{return await pullFromCloudOnce(options);}
 catch(error){if(source&&source!==providerSource&&providerRevision!==revision&&operationalProvider?.getState().active&&!['FORBIDDEN','UNAUTHORIZED'].includes(error.code)&&![401,403].includes(error.status))return pullFromCloudOnce(options);throw error;}
}
/** A detached current-record refresh commits only while the view has no draft. */
export async function refreshCurrentRecords({canCommit=()=>true,source=null}={}){
 if(!provider()||!hasLabSession()||mode()!=='cloud')return null;
 const original=baseline,identity=syncIdentity(),generation=authGeneration,pull=pullGeneration,config=stable(configuration());
 const cancelled=()=>Object.assign(new Error('Background refresh postponed while editing.'),{code:'BACKGROUND_CANCELLED'});
 const check=()=>{if(!canCommit())throw cancelled();if(source&&operationalProvider?.getState().active!==source)throw cancelled();if(generation!==authGeneration||pull!==pullGeneration||config!==stable(configuration())||identity!==syncIdentity()||baseline!==original)throw cancelled();};
 check();await membership({check,source});check();
 if(isGuest(session()))return pullGuestRecords({check});
 if(restrictedMouseMember())return pullMemberRecords({check});
 const reuse=synced&&baseline&&baselineIdentity===syncIdentity()?{records:baseline,versions,identity:baselineIdentity,policy:clone(feeVisibility),deferredState:deferredArchiveState}:null;
 const rows=await allRecords(null,{referencedArchive:true,reuse,allowPersisted:false,checkScope:check,deferHistory:true,currentOnly:Boolean(managedReadCoverage),retainedCoverage:managedReadCoverage});check();
 if(original&&rows.length===original.size&&rows.every(row=>{const prior=original.get(recordKey(row));return prior?.version===row.version&&prior.archived===row.archived;}))return null;
 const data=await assemble(rows);check();const deferred=await deferredStateOf(rows,data);check();const c=configuration(),mark={id:crypto.randomUUID(),url:c.url,colony:c.colonyId,user:session().user.id};
 const envelope=await baselineEnvelope(rows,mark.id,check,versions,deferred);check();await local('put',data,{check,cacheWrite:mark,syncBaseline:envelope});check();rememberCloudCache(mark.id,envelope?.sha256);remember(rows,deferred);return clone(data);
}
/** Load only the named managed tables or exact feature event types on demand. */
export async function ensureManagedTables(dataset,{tables=[],eventTypes=[],onProgress}={}){
 if(!Array.isArray(tables)||tables.some(type=>!MANAGED.includes(type))||!Array.isArray(eventTypes)||eventTypes.some(type=>!MANAGED_EVENT_TYPES.includes(type)))throw new Error('Choose supported record tables and event types.');
 if(!dataset?.managed_records_deferred)return clone(dataset);
 const requested=[...new Set(tables)].filter(type=>getDeferredManagedTables(dataset).includes(type)),events=getDeferredManagedEventTypes(dataset,{eventTypes});
 if(!requested.length&&!events.length)return clone(dataset);
 const scope=stable({generation:authGeneration,context:exportContext()});if(activeDatasetSaves.has(scope))throw new Error('Another save or history load is in progress. Try again after it finishes.');
 activeDatasetSaves.add(scope);
 try{
  const before=baseline,identity=syncIdentity(),generation=authGeneration,pull=pullGeneration,context=exportContext(),oldCoverage=managedReadCoverage,oldDeferred=deferredArchiveState,oldVersions=versions,oldPolicy=clone(feeVisibility),c=configuration();
  const check=()=>{checkExportContext(context);if(!synced||baseline!==before||versions!==oldVersions||identity!==syncIdentity()||generation!==authGeneration||pull!==pullGeneration||managedReadCoverage!==oldCoverage)throw new Error('The account or shared data changed. Reload this view before continuing.');};
  check();if(providerSource!=='cloud1')throw new Error('This current-record view belongs to Cloud 1. Reload the workspace before continuing.');
  if(stable(dataset.managed_records_deferred)!==stable(oldCoverage))throw new Error('The current-record coverage changed. Reload shared data.');
  const dataHash=await cacheDigest(Object.fromEntries(MANAGED.map(type=>[type,dataset.tables?.[type]||[]])));check();
  const known=normalizeDataset({tables:Object.fromEntries(MANAGED.map(type=>[type,[...before.values()].filter(row=>row.entity_type===type).map(row=>clone(row.payload))]))});
  if(dataHash!==await cacheDigest(Object.fromEntries(MANAGED.map(type=>[type,known.tables[type]]))))throw new Error('Save or discard your edits before loading more records.');check();
  await membership();check();const policy=await refreshFeeVisibility({notify:false});check();
  if(!sameFeeVisibility(policy,oldPolicy)||oldDeferred&&!sameFeeVisibility(oldDeferred.policy,policy))throw new Error('Record access changed. Reload shared data.');
  const next=new Map([...before].map(([key,row])=>[key,{...row,colony_id:c.colonyId,version:oldVersions.get(key)}])),reuse={records:before,versions:oldVersions};
  let recordsLoaded=0,recordsTotal=0;
  const progress=(loaded,total)=>{check();try{onProgress?.(Object.freeze({phase:'records',recordsLoaded:recordsLoaded+loaded,recordsTotal:recordsTotal+total,recordBlocksLoaded:Math.floor((recordsLoaded+loaded)/RECORD_BLOCK_SIZE),recordBlocksTotal:Math.ceil((recordsTotal+total)/RECORD_BLOCK_SIZE),recordBlocksEstimated:false}));}catch{/* Presentation cannot interrupt a verified read. */}};
  const read=(route,options={})=>request(route,{...options,cloudSource:'cloud1'});
  for(const type of requested){
   const rows=await incrementalManaged(type,c,check,reuse,false,read,progress,'full');check();
   for(const[key,row]of next)if(row.entity_type===type)next.delete(key);for(const row of rows)next.set(recordKey(row),row);recordsLoaded+=rows.length;recordsTotal+=rows.length;
  }
  if(events.length&&!requested.includes('husbandry_events')){
   const rows=await incrementalManaged('husbandry_events',c,check,reuse,false,read,progress,'event_types',events);check();
   for(const[key,row]of next)if(row.entity_type==='husbandry_events'&&events.includes(row.payload?.event_type))next.delete(key);for(const row of rows)next.set(recordKey(row),row);
  }
  const coverage=mergeManagedCoverage(oldCoverage,{fullTables:requested,eventTypes:events}),complete=MANAGED.every(type=>coverage.full_tables.includes(type)),rows=[...next.values()];
  rows.fee_visibility=policy;rows.managed_coverage=complete?null:coverage;
  if(oldDeferred){rows.deferred_archive={loaded_tables:[...oldDeferred.loadedTables]};rows.archive_versions=[...oldVersions].filter(([key])=>key.startsWith('archive:'));}
  const data=await assemble(rows);check();const nextDeferred=await deferredStateOf(rows,data);check();
  const finalPolicy=await refreshFeeVisibility({notify:false});check();if(!sameFeeVisibility(finalPolicy,policy))throw new Error('Record access changed while loading. Retry this view.');
  const cacheWrite={id:crypto.randomUUID(),url:c.url,colony:c.colonyId,user:session().user.id};
  try{
   const syncBaseline=await baselineEnvelope(rows,cacheWrite.id,check,oldVersions,nextDeferred);check();await local('put',data,{check,cacheWrite,syncBaseline});check();rememberCloudCache(cacheWrite.id,syncBaseline?.sha256);remember(rows,nextDeferred);return clone(data);
  }catch(error){const cleanup=discardCloudWrite(cacheWrite.id).catch(()=>{});if(error.storageTimeout!==true)await cleanup;throw error;}
 }finally{activeDatasetSaves.delete(scope);}
}
async function pullFromCloudOnce({onProgress,forceFull=false,deferHistory=false,currentOnly=false,signal,checkOpening=()=>{},canCommit=()=>true}={}){
  checkOpening();
  const payloadDigests=new WeakMap();
  const startupSnapshot=!forceFull&&deferHistory?startupCacheSnapshot:null;
  // Reuse only the immediately preceding live opening check, never a stored
  // role or a lease carried over phone sleep. Final visibility is still live.
  const openingAge=Date.now()-startupSnapshot?.verifiedAt;
  const openingAccess=signal&&startupSnapshot?.signal===signal&&!signal.aborted&&openingAge>=0&&openingAge<=10000&&startupSnapshot.generation===authGeneration&&startupSnapshot.identity===persistentIdentity()&&startupSnapshot.source===providerSource&&startupSnapshot.revision===providerRevision?startupSnapshot:null;
  const reuse=!forceFull&&synced&&baseline&&baselineIdentity===syncIdentity()?{records:baseline,versions,identity:baselineIdentity,policy:clone(feeVisibility),deferredState:deferredArchiveState}:null;
  const pull=++pullGeneration;invalidate();
  const generation=authGeneration,config=stable(configuration());let context=null;
  const check=()=>{checkOpening();if(pull!==pullGeneration||generation!==authGeneration||config!==stable(configuration())||context!==null&&context!==exportContext())throw new Error('The account or colony changed during loading. Open the shared colony again.');};
  const progress=value=>{check();if(typeof onProgress==='function'){try{onProgress(Object.freeze({...value}));}catch{/* Presentation cannot interrupt a verified read. */}}};
  progress({phase:'access',recordsLoaded:0,recordsTotal:null,recordsReused:0,archiveBlocksLoaded:0,archiveBlocksTotal:null,archiveBlocksReused:0});
  if(!openingAccess)await membership({check,canCommit});context=exportContext();check();
  if(isGuest(session()))return pullGuestRecords({check,onProgress:progress,canCommit});
  if(restrictedMouseMember())return pullMemberRecords({check,onProgress:progress,canCommit});
  const rows=await allRecords(progress,{referencedArchive:true,reuse,allowPersisted:!forceFull,checkScope:check,deferHistory:deferHistory&&!forceFull,payloadDigests,startupSnapshot,currentOnly:currentOnly&&!forceFull,openingPolicy:openingAccess?.policy,canCommit});check();if(!rows.length)throw new Error('The cloud colony is empty. Import and upload a dataset first.');
  const data=await assemble(rows);check();const deferredState=await deferredStateOf(rows,data);check();
  const c=configuration(),cacheWrite={id:crypto.randomUUID(),url:c.url,colony:c.colonyId,user:session().user.id};
  try{
    const recordsLoaded=rows.filter(row=>row.entity_type!=='archive').length,archiveBlocksLoaded=rows.filter(row=>row.entity_type==='archive').length;
    const completedCounts={recordsLoaded,recordsTotal:recordsLoaded,recordsReused:rows.sync_summary.recordsReused,archiveBlocksLoaded,archiveBlocksTotal:archiveBlocksLoaded,archiveBlocksReused:rows.sync_summary.archiveBlocksReused};
    progress({phase:'saving',...completedCounts});
    const syncBaseline=await baselineEnvelope(rows,cacheWrite.id,check,versions,deferredState,payloadDigests);check();
    await local('put',data,{check,cacheWrite,syncBaseline});check();
    rememberCloudCache(cacheWrite.id,syncBaseline?.sha256);remember(rows,deferredState);setStorage('localStorage',DEMO_KEY,null);setMode('cloud');feeVisibilityContext=exportContext();const counts=rows.sync_summary;statusMessage=`Cloud ${providerSource==='cloud2'?'2':'1'} connected. Downloaded ${counts.recordsDownloaded} records and ${counts.archiveBlocksDownloaded} history blocks; reused ${counts.recordsReused} records and ${counts.archiveBlocksReused} history blocks.`;return clone(data);
  }catch(error){const cleanup=discardCloudWrite(cacheWrite.id).catch(()=>{});if(error.storageTimeout!==true)await cleanup;throw error;}
}
/** Hydrate only requested source tables; managed rows and the archive head stay authoritative. */
export async function ensureHistory(dataset,{tables=null,onProgress}={}){
 if(!dataset?.source_archive_deferred)return clone(dataset);
 if(tables!==null&&(!Array.isArray(tables)||tables.some(table=>typeof table!=='string'||!table)))throw new Error('Choose named history tables to load.');
 const scope=stable({generation:authGeneration,context:exportContext()}),openingBaseline=baseline,openingIdentity=syncIdentity();
 if(activeDatasetSaves.has(scope))throw new Error('Another save or history load is in progress. Try again after it finishes.');
 activeDatasetSaves.add(scope);
 try{
  const state=deferredArchiveState,previousBaseline=baseline,previousVersions=versions,pull=pullGeneration,generation=authGeneration,identity=syncIdentity(),context=exportContext();
  const check=()=>{checkExportContext(context);if(!synced||!state||deferredArchiveState!==state||baseline!==previousBaseline||versions!==previousVersions||pull!==pullGeneration||generation!==authGeneration||identity!==syncIdentity())throw new Error('The shared data or account changed while loading history. Reload before continuing.');};
  const progress=value=>{check();try{onProgress?.(Object.freeze(value));}catch{/* Presentation cannot interrupt a verified read. */}};
  check();progress({phase:'access'});await assertDeferredData(normalizeDataset(dataset),state);check();
  if(await cacheDigest(Object.fromEntries(MANAGED.map(type=>[type,dataset.tables[type]])))!==state.managedHash)throw new Error('Save or discard record edits before loading history.');check();
  await membership();check();const policy=await refreshFeeVisibility({notify:false});check();if(!policy.source_archive_allowed||!sameFeeVisibility(policy,state.policy))throw new Error('History access changed. Reload shared data.');
  const requested=(tables===null?Object.keys(state.head.payload.archive_tables):[...new Set(tables)]).filter(table=>Object.hasOwn(state.head.payload.archive_tables,table)),needed=requested.filter(table=>!state.loadedTables.includes(table));
  if(!needed.length&&tables!==null)return clone(dataset);
  let archiveBlocksLoaded=0;
  const c=configuration(),archive=await selectedArchive(c,check,(count,details)=>{archiveBlocksLoaded+=count;progress({phase:'archive',archiveBlocksLoaded,archiveBlocksTotal:details.total});},{records:state.records,versions:previousVersions},needed);check();progress({phase:'verifying'});
  const head=archive.find(row=>row.entity_id==='reconstruction');if(head.version!==state.head.version||stable(head.payload)!==stable(state.head.payload))throw new Error('The reconstruction manifest changed. Reload shared data before loading history.');
  const combined=new Map(state.records);for(const row of archive)combined.set(recordKey(row),row);
  const loaded=[...new Set([...state.loadedTables,...requested])].sort(),complete=Object.keys(head.payload.archive_tables).every(table=>loaded.includes(table));
  const rows=[...previousBaseline.values()].filter(row=>MANAGED.includes(row.entity_type)).map(row=>({...row,colony_id:c.colonyId,version:previousVersions.get(recordKey(row))}));rows.push(...combined.values());rows.fee_visibility=policy;rows.archive_versions=archive.archive_versions;
  if(managedReadCoverage)rows.managed_coverage=clone(managedReadCoverage);
  if(!complete||tables!==null||managedReadCoverage)rows.deferred_archive={loaded_tables:loaded};
  const data=await assemble(rows);check();const nextState=await deferredStateOf(rows,data);check();
  const finalPolicy=await refreshFeeVisibility({notify:false});check();if(!sameFeeVisibility(finalPolicy,policy))throw new Error('History access changed while loading. Reload shared data.');
  const cacheWrite={id:crypto.randomUUID(),url:c.url,colony:c.colonyId,user:session().user.id};
  try{progress({phase:'saving'});const syncBaseline=await baselineEnvelope(rows,cacheWrite.id,check,previousVersions,nextState);check();await local('put',data,{check,cacheWrite,syncBaseline});check();rememberCloudCache(cacheWrite.id,syncBaseline?.sha256);remember(rows,nextState);return clone(data);}
  catch(error){const cleanup=discardCloudWrite(cacheWrite.id).catch(()=>{});if(error.storageTimeout!==true)await cleanup;throw error;}
 }catch(error){
  const sameScope=scope===stable({generation:authGeneration,context:exportContext()});
  // Retrying an unchanged unverified snapshot cannot repair it. Tell the read
  // UI to obtain a fresh current-only baseline, never to relax save validation.
  // A newer account, policy identity or concurrent pull owns its own workspace.
  const sameRead=sameScope&&openingIdentity===syncIdentity()&&baseline===openingBaseline;
  if(sameRead&&(error?.message===DEFERRED_HISTORY_ERROR||/reconstruction manifest changed|history access changed/i.test(error?.message||'')||(!synced||!deferredArchiveState)&&mode()==='cloud'&&hasLabSession())){error.historyReloadRequired=true;error.code='HISTORY_RELOAD_REQUIRED';}
  if(sameScope&&baseline===openingBaseline&&([401,403].includes(error?.status)||/not an active member/.test(error?.message||'')||openingIdentity!==syncIdentity()))invalidate();
  throw error;
 }finally{activeDatasetSaves.delete(scope);}
}
async function writeAtomic(pending,{checkScope,requiredSource=null}={}){
  checkScope?.();
  if(!pending.length)return [];
  if(pending.length>500)throw new Error('A cloud edit may change at most 500 records. Split this edit into smaller operations.');
  const c=configuration();
  const body={p_colony_id:c.colonyId,p_changes:pending.map(([r,expected])=>({...r,expected_version:expected}))};
  if(utf8Size(body)>MAX_RPC_BYTES)throw new Error('This atomic edit exceeds the 1MB cloud request limit. Split it into smaller operations.');
  try{
    const rows=await request('rpc/save_records',{method:'POST',body,requiredSource});
    const expected=new Set(pending.map(([r])=>recordKey(r)));
    if(!Array.isArray(rows)||rows.length!==pending.length||rows.some(r=>!expected.delete(recordKey(r))||!Number.isInteger(r.version))||expected.size)throw new Error('The cloud save did not return a verifiable version for every record.');
    checkScope?.();return rows;
  }catch(e){
    // A delayed save must not invalidate a newer verified pull/account.
    try{checkScope?.();}catch{throw e;}
    invalidate();statusMessage=`${e.message} Cloud save was not confirmed; pull the latest data before retrying.`;throw new Error(statusMessage);
  }
}
/** Reserve from the authoritative colony sequence. The caller keeps requestId on retries. */
export async function reserveMouseSids({requestId,count}={}){
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId||'')||!Number.isInteger(count)||count<1||count>100)throw new Error('Choose between 1 and 100 mice.');
 if(mode()==='local')return null;
 const context=exportContext(),generation=authGeneration;
 const check=()=>{if(context!==exportContext()||generation!==authGeneration||pendingAccount(session())||session()?.passwordRecovery)throw new Error('Account changed. Reopen the mouse draft.');};
 await requireEditor();check();
 const result=await request('rpc/reserve_mouse_sids',{method:'POST',body:{p_colony_id:configuration().colonyId,p_request_id:requestId,p_count:count}});check();
 if(result?.request_id!==requestId||!Array.isArray(result.sids)||result.sids.length!==count||result.sids.some(id=>typeof id!=='string'||!/^\d{5}$/.test(id)||Number(id)<1)||new Set(result.sids).size!==count)throw new Error('The SID reservation could not be confirmed. Retry this draft.');
 return result.sids;
}
async function requireEditor(){const role=await membership();if(role==='viewer')throw new Error('Your colony role is viewer; cloud changes require editor or owner access.');}
export async function pushToCloud(dataset){
  if(dataset?.source_archive_deferred||dataset?.managed_records_deferred)throw new Error('Load all records and history before an initial upload.');
  await requireEditor();if(!(await refreshFeeVisibility()).source_archive_allowed||dataset.source_archive_restricted)throw new Error('Full financial visibility and an unredacted dataset are required for an initial upload.');
  const incoming=await entityRecords(dataset),existing=await allRecords(),byId=new Map(existing.map(r=>[recordKey(r),r]));
  for(const r of incoming){const old=byId.get(recordKey(r));if(old&&(stable(old.payload)!==stable(r.payload)||Boolean(old.archived)!==r.archived))throw new Error(`Cloud record ${r.entity_type}/${r.entity_id} already contains different data. Pull and review it; initial upload will not overwrite it.`);}
  const pending=incoming.filter(r=>!byId.has(recordKey(r))).sort((a,b)=>(a.entity_id==='reconstruction'?1:0)-(b.entity_id==='reconstruction'?1:0));
  statusMessage=`Uploading ${pending.length} new cloud records…`;
  let completed=0;
  try{for(const batch of partitionChanges(pending.map(r=>({...r,expected_version:0})))){await writeAtomic(batch.map(({expected_version,...r})=>[r,expected_version]));completed+=batch.length;statusMessage=`Uploaded ${completed} of ${pending.length} records.`;}}
  catch(e){throw new Error(`${e.message} Initial upload confirmed ${completed} records before this batch. Retry upload to skip identical records; no local import was replaced.`);}
  return pullFromCloud();
}
/** One explicit dataset save per account epoch. Never queue a stale whole dataset. */
export async function saveDataset(dataset,options={}){
  if(pendingAccount(session())||session()?.passwordRecovery)throw new Error('Complete your account setup before changing colony data.');
  const scope=stable({generation:authGeneration,context:exportContext()});
  if(activeDatasetSaves.has(scope))throw new Error('Another save is in progress. Wait for it to finish, then review and save your changes again.');
  activeDatasetSaves.add(scope);
  try{return await saveDatasetOnce(dataset,options);}
  finally{activeDatasetSaves.delete(scope);}
}
function sourceTagReviewDataset(){
 if(mode()!=='cloud'||!synced||!baseline||session()?.role!=='owner')throw new Error('Reconnect as the owner and reopen this label check.');
 const tables=Object.fromEntries(MANAGED.map(type=>[type,[]]));
 for(const row of baseline.values())if(Object.hasOwn(tables,row.entity_type)&&row.archived!==true)tables[row.entity_type].push(clone(row.payload));
 return {tables};
}
export function getOwnerSourceTagReviewScope(issueId,mouseSid){return prepareOwnerSourceTagReview(sourceTagReviewDataset(),{issueId,mouseSid}).scope;}
/** Save only the two append-only label-check histories, plus their exact CAS
 * dependencies. No model normalization, inferred genotype or housing updates. */
export async function acknowledgeSourceTagReview({issueId,mouseSid,expectedScope}={}){
 if(pendingAccount(session())||session()?.passwordRecovery)throw new Error('Complete your account setup before changing colony data.');
 const scope=stable({generation:authGeneration,context:exportContext()});
 if(activeDatasetSaves.has(scope))throw new Error('Another save is in progress. Reopen this check after it finishes.');
 activeDatasetSaves.add(scope);
 try{
  if(!expectedScope)throw new Error('Reopen this label check from Review.');
  const opening=baseline,openingVersions=versions,context=exportContext(),generation=authGeneration,pull=pullGeneration,requiredSource=providerSource||'cloud1';
  const check=()=>{if(mode()!=='cloud'||!synced||baseline!==opening||versions!==openingVersions||generation!==authGeneration||pull!==pullGeneration||context!==exportContext()||session()?.role!=='owner')throw new Error('The account or shared data changed. Reopen this label check.');};
  check();await requireEditor();check();const policy=await refreshFeeVisibility();check();
  if(!policy.source_archive_allowed)throw new Error('Source access changed. Reopen this label check.');
  const prepared=prepareOwnerSourceTagReview(sourceTagReviewDataset(),{issueId,mouseSid,expectedScope}),pending=[],keys=new Set();
  for(const change of prepared.changes){
   const key=change.entity_type+':'+change.entity_id,row=opening.get(key),version=openingVersions.get(key);
   if(!row||!Number.isInteger(version)||version<1||stable(row.payload)!==stable(change.before))throw new Error('The checked record changed. Reopen Review.');
   pending.push([{...clone(row),payload:clone(change.payload)},version]);keys.add(key);
  }
  for(const dependency of prepared.readDependencies){
   const key=dependency.type+':'+dependency.id,row=opening.get(key),version=openingVersions.get(key);
   if(!row||!Number.isInteger(version)||version<1)throw new Error('A source dependency is unavailable. Reload Review.');
   if(!keys.has(key)){pending.push([clone(row),version]);keys.add(key);}
  }
  check();const saved=await writeAtomic(pending,{checkScope:check,requiredSource});check();
  const returned=new Map(saved.map(row=>[recordKey(row),row]));
  if(pending.some(([row,version])=>{const result=returned.get(recordKey(row));return !result||stable(result.payload)!==stable(row.payload)||Boolean(result.archived)!==Boolean(row.archived)||result.version!==version+(stable(row.payload)===stable(opening.get(recordKey(row)).payload)?0:1);})){
   invalidate();throw new Error('The save response could not be verified. Pull the latest data before checking again.');
  }
  invalidate();
  try{await pullFromCloud({deferHistory:true,currentOnly:true});}catch(error){throw new Error('The label check was saved. Reload shared data to see it. '+error.message);}
  statusMessage='Source label check saved. Scientific fields were preserved.';
 }finally{activeDatasetSaves.delete(scope);}
}
async function saveDatasetOnce(dataset,{localOnly=false,localKind=null,readDependencies=[],requiredSource=null}={}){
 if(isGuest(session())){if(localOnly)throw new Error('Guest changes must be verified by the shared database.');return saveGuestDataset(dataset,{readDependencies});}
  if(!Array.isArray(readDependencies)||readDependencies.length>500)throw new Error('Invalid save dependencies. Reload and review the changes.');
  const dependencyKeys=new Set();
  for(const dependency of readDependencies){
    if(!dependency||typeof dependency!=='object'||Array.isArray(dependency)||Object.keys(dependency).length!==2||!READ_DEPENDENCY_TYPES.has(dependency.type)||typeof dependency.id!=='string'||!dependency.id||dependency.id.trim()!==dependency.id||dependency.id.length>200)throw new Error('Invalid save dependencies. Reload and review the changes.');
    dependencyKeys.add(`${dependency.type}:${dependency.id}`);
  }
  // Current housing includes every Stock mouse. Manual cage/confirmed LocoBox
  // schedules join those animals by exact mouse ID, so they can propagate now.
  // Raw light-card tag/DOB matching and reviewed-source overlays require the
  // complete identity set; an omitted ended animal must not look nonexistent.
  let synchronized;
  if(dataset.managed_records_deferred){
   const coverage=checkedManagedCoverage(dataset.managed_records_deferred),completeExposures=coverage.full_tables.includes('husbandry_events')||coverage.event_types.includes('mouse_entrainment');
   const exactMice=completeExposures?dataset.tables.mice:(dataset.tables.mice||[]).filter(mouse=>['Stock','Unknown'].includes(mouse.state));
   const exactOnly=applyAnimalEntrainmentSync(null,{...dataset,tables:{...dataset.tables,mice:exactMice,light_events:[]}},{includeReviewed:false,includeManaged:true});
   synchronized={...dataset,tables:{...dataset.tables,husbandry_events:exactOnly.dataset.tables.husbandry_events}};
  }else synchronized=applyAnimalEntrainmentSync(null,dataset).dataset;
  const data=normalizeDataset(synchronized);
  if((data.source_archive_deferred||data.managed_records_deferred)&&(localOnly||mode()==='local'))throw new Error('A deferred workspace cannot replace a complete local dataset. Load all history first.');
  if(localOnly||mode()==='local'){
    const generation=authGeneration,context=exportContext();
    const check=()=>{if(generation!==authGeneration||context!==exportContext()||pendingAccount(session())||session()?.passwordRecovery)throw new Error('The account changed while saving. Review your changes again.');};
    await local('put',data,{check});check();setStorage('localStorage',CLOUD_CACHE_KEY,null);if(localOnly){setStorage('localStorage',DEMO_KEY,localKind==='demo'?'true':null);setMode('local');invalidate();}statusMessage='Saved on this device.';return;
  }
  if(!synced||!baseline)throw new Error('Pull the latest cloud data before editing.');
  if(stable(data.managed_records_deferred||null)!==stable(managedReadCoverage))throw new Error('The current-record coverage changed. Reload shared data before saving.');
  if(deferredArchiveState&&!data.source_archive_deferred)throw new Error('The deferred history marker was removed. Reload shared data before saving.');
  const savingDeferred=deferredArchiveState;
  const context=exportContext(),savePullGeneration=pullGeneration,saveAuthGeneration=authGeneration;
  const ownsSave=()=>savePullGeneration===pullGeneration&&saveAuthGeneration===authGeneration&&context===exportContext();
  const checkSaveEpoch=()=>{if(!ownsSave())throw new Error('The account or shared data changed while saving. Pull again.');};
  await requireEditor();checkSaveEpoch();const policy=await refreshFeeVisibility();checkSaveEpoch();if(!synced||!baseline)throw new Error('Visibility changed. Pull the latest cloud data before editing.');
  if(!policy.source_archive_allowed&&(data.source_archive_restricted!==true||data.source_projection_version!==SOURCE_PROJECTION_VERSION||!data.tables.locations.every(managedLocationPayload)))throw new Error('Source location fields require full financial visibility. Pull the latest cloud data before editing.');
  const incoming=await entityRecords(data),map=new Map(incoming.map(r=>[recordKey(r),r]));
  for(const [k,r] of baseline)if(!map.has(k)&&!isArchiveChunk(r))throw new Error(`Record ${r.entity_id} was removed. Archive records instead of deleting them.`);
  const pending=incoming.filter(r=>{const old=baseline.get(recordKey(r));return !old||stable(old.payload)!==stable(r.payload)||old.archived!==r.archived;}).map(r=>[r,versions.get(recordKey(r))??0]);
  if(managedReadCoverage&&!managedReadCoverage.full_tables.includes('mice')){
   const identityFields=['physical_tag','date_of_birth','sex','sire_sids','dam_sids','litter_sid'];
   if(pending.some(([row])=>row.entity_type==='mice'&&(!baseline.has(recordKey(row))||identityFields.some(key=>stable(row.payload[key]??null)!==stable(baseline.get(recordKey(row)).payload[key]??null)))))throw new Error('Open Mice to load complete identity records before adding an animal or changing its tag, birth date, sex or parents. Your cage edits are still here.');
  }
  // Lock/check unchanged records on which a move was validated, in the same
  // transaction as its mutations. save_record returns exact no-ops unchanged.
  const pendingKeys=new Set(pending.map(([r])=>recordKey(r)));
  for(const key of dependencyKeys){
    const row=baseline.get(key),version=versions.get(key);
    if(!row||!Number.isInteger(version)||version<1)throw new Error('A move dependency is missing from the verified data. Pull again before saving.');
    if(!pendingKeys.has(key))pending.push([row,version]);
  }
  if(!policy.source_archive_allowed&&pending.some(([r])=>r.entity_type==='archive'))throw new Error('Owner access is required to edit source archives.');
  if(!(policy.estimate&&policy.actual&&(policy.source_archive_allowed||policy.history_allowed===true))&&pending.some(([r])=>feeRecord(r)))throw new Error('Both estimate and actual visibility are required to edit fees.');
  const chunks=pending.filter(([r])=>isArchiveChunk(r)),atomic=pending.filter(([r])=>!isArchiveChunk(r));
  if(atomic.length>500||utf8Size({p_colony_id:configuration().colonyId,p_changes:atomic.map(([r,expected_version])=>({...r,expected_version}))})>MAX_RPC_BYTES)throw new Error('This atomic edit is too large. Split it into smaller operations.');
  // Immutable chunks can be staged before committing the manifest. A failed
  // final transaction leaves old data authoritative and new chunks unreferenced.
  const saved=[];
  for(const batch of partitionChanges(chunks.map(([r,expected_version])=>({...r,expected_version}))))saved.push(...await writeAtomic(batch.map(({expected_version,...r})=>[r,expected_version]),{checkScope:checkSaveEpoch}));
  saved.push(...await writeAtomic(atomic,{checkScope:checkSaveEpoch,requiredSource}));
  try{
   checkSaveEpoch();const finalPolicy=await refreshFeeVisibility();checkSaveEpoch();
   if(!sameFeeVisibility(finalPolicy,policy)||!synced)throw new Error('Fee visibility changed during save. Pull the latest cloud data.');
   for(const row of saved){
    if(!policy.source_archive_allowed&&row.entity_type==='locations')checkedManagedLocation(row,configuration().colonyId);
    // Server projections, including returned versions, are authoritative. Never
    // retain an earlier full-access location payload after a restricted save.
    map.set(recordKey(row),row);
    if(row.entity_type==='locations'){const index=data.tables.locations.findIndex(location=>location.location_id===row.entity_id);if(index>=0)data.tables.locations[index]=clone(row.payload);}
   }
  }catch(error){if(ownsSave()){invalidate();if(!policy.source_archive_allowed)await local('delete',undefined,{check:checkSaveEpoch});}throw new Error(`${error.message} Cloud writes may have completed; pull again before editing.`);}
  const generation=authGeneration,identity=syncIdentity(),nextVersions=new Map(versions);
  for(const r of saved)nextVersions.set(recordKey(r),r.version);
  const check=()=>{checkExportContext(context);if(generation!==authGeneration||identity!==syncIdentity()||savePullGeneration!==pullGeneration||!synced)throw new Error('Your account or shared data changed while saving the local copy.');};
  const c=configuration(),cacheWrite={id:crypto.randomUUID(),url:c.url,colony:c.colonyId,user:session().user.id};
  let nextDeferred=null;
  if(savingDeferred){const head=map.get('archive:reconstruction');data.source_archive_deferred=await deferredMarker(head,savingDeferred.loadedTables);nextDeferred={...savingDeferred,head:clone(head),marker:clone(data.source_archive_deferred),records:new Map([...map].filter(([,row])=>row.entity_type==='archive')),managedHash:await cacheDigest(Object.fromEntries(MANAGED.map(type=>[type,data.tables[type]]))),identity:syncIdentity()};}
  try{const syncBaseline=await baselineEnvelope([...map.values()],cacheWrite.id,check,nextVersions,nextDeferred);check();await local('put',data,{check,cacheWrite,syncBaseline});check();rememberCloudCache(cacheWrite.id,syncBaseline?.sha256);}
  catch(e){if(ownsSave())invalidate();const cleanup=discardCloudWrite(cacheWrite.id).catch(()=>{});if(e.storageTimeout!==true)await cleanup;throw new Error(`${e.message} Cloud writes completed; pull again to restore the local copy.`);}
  versions=nextVersions;baseline=map;baselineIdentity=syncIdentity();deferredArchiveState=nextDeferred;statusMessage='Saved to cloud and this device.';
}
const exportDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function checkedExportPermission(value){
  if(!value||!['low','mid','mid1','mid2','high','max'].includes(value.level)||!exportDate(value.as_of_date)||value.full_history!==(value.level==='max')||(value.level==='max'?value.cutoff_date!==null:!exportDate(value.cutoff_date)))throw new Error('Export permission could not be verified. Reload and try again.');
  return value;
}
function exportContext(){const c=configuration();return stable({url:c?.url,colony:c?.colonyId,user:session()?.user?.id,...appPermissionFields(session()),guestLevel:session()?.guestLevel,guestPermissions:session()?.guestPermissions,guestAccessStartsOn:session()?.guestAccessStartsOn??null,guestAccessEndsOn:session()?.guestAccessEndsOn??null,guestAvailability:guestAvailabilityStatus(session()),mode:mode(),demo:getStorage('localStorage',DEMO_KEY),source:providerSource||'cloud1'});}
function checkExportContext(context){if(exportContext()!==context)throw new Error('Your account or colony changed. Reopen Export.');}
async function localExportDataset(){
  // A configured real colony always rechecks server permission, including after
  // sign-out. Do not load or refresh its cached dataset to make this decision.
  if(mode()!=='local'||configuration()&&getStorage('localStorage',DEMO_KEY)!=='true')return null;
  return await loadDataset();
}
function localExportPermission(){return {level:'max',cutoff_date:null,as_of_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),full_history:true,local:true};}
export async function getExportPermission(){
  const context=exportContext(),localData=await localExportDataset();checkExportContext(context);
  if(localData)return localExportPermission();
  const c=configuration();if(!c)throw new Error('Open a workspace before exporting.');
  const value=checkedExportPermission(await request('rpc/get_export_permission',{method:'POST',body:{p_colony_id:c.colonyId}}));
  checkExportContext(context);if(session())saveSession({...session(),exportLevel:value.level});
  return {...value,local:false};
}
export async function assertFullExportPermission(){
  const context=exportContext(),localData=await localExportDataset();checkExportContext(context);
  if(localData)return localExportPermission();
  const c=configuration();if(!c)throw new Error('Open a workspace before exporting.');
  const value=checkedExportPermission(await request('rpc/assert_full_export_permission',{method:'POST',body:{p_colony_id:c.colonyId}}));
  checkExportContext(context);if(value.level!=='max')throw new Error('Full-history permission is required for a full backup or source archive.');
  return {...value,local:false};
}
function exportRecordDate(type,row){
  const keys={mice:['end_date','date_of_birth'],matings:['disbanded_date','set_up_date'],litters:['end_date','wean_date','date_of_birth'],cages:['end_date','set_up_date'],light_events:['end_date','start_date'],husbandry_events:['event_date']}[type]||[];
  if(type==='husbandry_events'&&row.event_type==='cryopreservation_lot')return [row.cryopreservation?.quantity_as_of_date,row.cryopreservation?.frozen_date].find(exportDate)||null;
  return keys.map(key=>row[key]).find(exportDate)||null;
}
// Match the server's bounded experiment report projection. Full preservation
// backups use a different, Max-only path and retain provenance and revisions.
function experimentExportFields(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const result={};
  for(const key of keys){const v=value[key];
    if(typeof v==='string')result[key]=[...v].slice(0,2048).join('');
    else if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))result[key]=v;
    else if(Array.isArray(v))result[key]=v.filter(item=>typeof item==='string').slice(0,100).map(item=>[...item].slice(0,200).join(''));
  }
  return result;
}
function experimentExportRows(value,keys){
  const rows=Array.isArray(value)?value:[],items=rows.filter(item=>item&&typeof item==='object'&&!Array.isArray(item)).slice(0,100).map(item=>experimentExportFields(item,keys));
  if(keys.includes('candidate_sids'))for(const [i,item] of rows.filter(item=>item&&typeof item==='object'&&!Array.isArray(item)).slice(0,100).entries()){const candidates=Array.isArray(item.candidate_sids)?item.candidate_sids:[];items[i].candidate_count=candidates.length;items[i].candidates_truncated=(items[i].candidate_sids||[]).length<candidates.length;}
  return {items,total:rows.length,truncated:items.length<rows.length};
}
const IACUC_EXPORT_FIELDS={"inputs":["design","variance","mean1","mean2","effect","sd","sd1","sd2","sdDifference","correlation","alpha","power","allocationRatio","experimentalUnit","animalsPerUnit","technicalReplicates","attrition","maxUnitsPerGroup","n1","n2","target","genotypeProbability","sexProbability","survivalProbability","confidence","maxOffspring","litterSize","littersPerPair"],"results":["status","method","approximate","n1","n2","achieved_power","previous_power","df","critical","noncentrality","standard_error","alpha","target_power","effect","sd_difference","power","sidedness","usable_probability","expected_offspring","expected_offspring_rounded","confidence_offspring","achieved_probability","previous_probability","expected_litters","confidence_litters","expected_pairs","confidence_pairs","expected_unusable_at_confidence_count","breeder_animals","errors","warnings","assumptions"],"cluster":["animalsPerCage","icc","cages_per_group","approximate","power_recomputed","attrition_basis","whole_cage_loss_modeled"],"allocation":["rule","requested_ratio","actual_ratio"],"adjustment":["analyzed_units_per_group","independent_equivalent_units_per_group","experimental_unit","recruited_units_per_group","animals_per_group","total_animals","animals_per_unit","technical_replicates","measurement_count","attrition","attrition_basis","design_effect"],"maximum_checked":["n1","n2","power","offspring","probability"],"protocol":["schema_version","protocol_id","number","aliases","title","title_en","pi","status","start_date","end_date","approved_animals"],"assignment":["schema_version","protocol_id","entity_type","entity_id","purpose","valid_from","valid_to","evidence_status"],"usage":["schema_version","protocol_id","category","mouse_sids","unregistered_count","event_date","experiment_id","litter_sid","evidence_status"],"design":["schema_version","protocol_id","label","title","method","calculated_at"],"allocations":["id","species","strain","approved","portal_used","portal_pending","portal_remaining"]};
function iacucNumericArrays(value,keys){const result={};for(const key of keys)if(Array.isArray(value?.[key]))result[key]=value[key].filter(v=>typeof v==='number'&&Number.isFinite(v)).slice(0,100);return result;}
function iacucDesignPart(value,part){const result=experimentExportFields(value,IACUC_EXPORT_FIELDS[part]);if(!value||typeof value!=='object')return result;
 if(part==='inputs'){if(value.cluster&&typeof value.cluster==='object'&&!Array.isArray(value.cluster))result.cluster=experimentExportFields(value.cluster,IACUC_EXPORT_FIELDS.cluster);}
 else{for(const key of ['allocation','maximum_checked'])if(value[key]&&typeof value[key]==='object'&&!Array.isArray(value[key]))result[key]=experimentExportFields(value[key],IACUC_EXPORT_FIELDS[key]);
  if(value.adjustment&&typeof value.adjustment==='object'&&!Array.isArray(value.adjustment)){result.adjustment={...experimentExportFields(value.adjustment,IACUC_EXPORT_FIELDS.adjustment),...iacucNumericArrays(value.adjustment,['analyzed_units_per_group','independent_equivalent_units_per_group','recruited_units_per_group','animals_per_group','cages_per_group'])};if(value.adjustment.cluster&&typeof value.adjustment.cluster==='object'&&!Array.isArray(value.adjustment.cluster))result.adjustment.cluster={...experimentExportFields(value.adjustment.cluster,IACUC_EXPORT_FIELDS.cluster),...iacucNumericArrays(value.adjustment.cluster,['cages_per_group'])};}
 }return result;
}
function projectIacucExport(row){const type=row.event_type,key=type.slice(6),p=row[type]||{},result=experimentExportFields(row,['event_id','event_type','event_date']),nested=experimentExportFields(p,IACUC_EXPORT_FIELDS[key]||[]);result[type]=nested;
 if(key==='protocol'){const rows=experimentExportRows(p.allocations,IACUC_EXPORT_FIELDS.allocations);Object.assign(nested,{allocations:rows.items,allocation_count:rows.total,allocations_truncated:rows.truncated});}
 if(key==='usage'){nested.mouse_count=Array.isArray(p.mouse_sids)?p.mouse_sids.length:0;nested.mouse_sids_truncated=nested.mouse_count>(nested.mouse_sids||[]).length;}
 if(key==='design')for(const [target,part]of [['breeding_inputs','inputs'],['breeding_results','results']])if(p[target]&&typeof p[target]==='object'&&!Array.isArray(p[target]))nested[target]=iacucDesignPart(p[target],part);
 if(key==='design')for(const part of ['inputs','results']){nested[part]=iacucDesignPart(p[part],part);for(const section of ['sample_size','breeding'])if(p[part]?.[section]&&typeof p[part][section]==='object'&&!Array.isArray(p[part][section]))nested[part][section]=iacucDesignPart(p[part][section],part);}
 return result;
}
function projectExperimentExport(row){
  if(['iacuc_protocol','iacuc_assignment','iacuc_usage','iacuc_design'].includes(row.event_type))return projectIacucExport(row);
  if(['lac_fee_options','lac_fee_month'].includes(row.event_type)){
    const type=row.event_type,p=row[type]||{},result=experimentExportFields(row,['event_id','event_type','event_date']);
    const keys=type==='lac_fee_options'?['schema_version','effective_from','currency','target_percent','maximum_percent','excluded_room_ids','revision']:['schema_version','month','currency','actual_total','actual_date','actual_basis','paid_date','invoice_reference','revision'];
    const field=type==='lac_fee_options'?'groups':'lines',rows=experimentExportRows(p[field],type==='lac_fee_options'?['key','label','unit','room_ids','rack_ids','rate','rate_period','rate_reference']:['group_key','quantity','quantity_unit','evidence_kind','evidence_start','evidence_end','evidence_reference','quantity_basis','quantity_note','snapshot_count','actual_amount']);
    result[type]={...experimentExportFields(p,keys),[field]:rows.items,[field+'_count']:rows.total,[field+'_truncated']:rows.truncated};return result;
  }
  if(!['experiment','experiment_sample','experiment_revision'].includes(row.event_type))return clone(row);
  const result=experimentExportFields(row,['event_id','event_type','event_date']);
  const entrainmentFields=['scheme','light_event_id','reference_at','reference_phase','phase_basis','phase_scale','period_hours','timezone','start_date','end_date','duration_days','duration_basis'];
  const referenceFields=['mouse_sid','raw_identifier','link_status','candidate_sids','role'];
  if(row.event_type==='experiment'){
    const p=row.experiment||{},participants=experimentExportRows(p.participants,referenceFields),usages=experimentExportRows(p.sample_usages,['sample_id','purpose','amount','unit','disposition']);
    result.experiment={...experimentExportFields(p,['schema_version','title','assays','status','project','operator','protocol','started_at','ended_at','timezone','circadian_time','time_basis','circadian_time_source','decapitation_at','decapitation_circadian_time','decapitation_time_basis','decapitation_circadian_time_source','sampling_at','sampling_circadian_time','sampling_time_basis','sampling_circadian_time_source','result_urls']),entrainment:experimentExportFields(p.entrainment,entrainmentFields),participants:participants.items,participant_count:participants.total,participants_truncated:participants.truncated,sample_usages:usages.items,sample_usage_count:usages.total,sample_usages_truncated:usages.truncated};
    result.experiment.result_urls=(Array.isArray(p.result_urls)?p.result_urls:[]).filter(url=>typeof url==='string').slice(0,30).map(url=>[...url].slice(0,2048).join(''));
  }else if(row.event_type==='experiment_sample'){
    const p=row.experiment_sample||{},donors=experimentExportRows(p.donors,referenceFields);
    result.experiment_sample={...experimentExportFields(p,['schema_version','label','experiment_id','parent_sample_ids','pooled','tissue','material','collection_at','timezone','circadian_time','time_basis','circadian_time_source','decapitation_at','decapitation_circadian_time','decapitation_time_basis','decapitation_circadian_time_source','status','quantity','quantity_unit','quantity_as_of_date','operator','project','protocol']),entrainment:experimentExportFields(p.entrainment,entrainmentFields),donors:donors.items,donor_count:donors.total,donors_truncated:donors.truncated,parent_sample_count:Array.isArray(p.parent_sample_ids)?p.parent_sample_ids.length:0,parent_samples_truncated:Array.isArray(p.parent_sample_ids)&&p.parent_sample_ids.length>(experimentExportFields(p,['parent_sample_ids']).parent_sample_ids||[]).length,storage:experimentExportFields(p.storage,['temperature_c','facility','freezer','rack','box','position'])};
  }
  return result;
}
function currentExportRecord(type,row,data){
  const present=r=>!r.app_archived_at&&r.archived!==true;
  if(!present(row))return false;
  if(type==='mice')return row.state==='Stock';
  if(['rooms','racks','locations'].includes(type))return true;
  if(type==='cages')return ['active','occupied'].includes(String(row.state).toLowerCase())||data.tables.mice.some(r=>present(r)&&r.state==='Stock'&&r.cage_sid===row.cage_sid)||data.tables.locations.some(r=>present(r)&&row.location_id&&r.location_id===row.location_id);
  if(type==='light_events'){
    let today;try{today=new Intl.DateTimeFormat('en-CA',{timeZone:row.timezone||'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}catch{today=localExportPermission().as_of_date;}
    return exportDate(row.start_date)&&row.start_date<=today&&(row.end_date==null||exportDate(row.end_date)&&(/next phase start|exclusive/i.test(row.interval_semantics||'')?row.end_date>today:row.end_date>=today));
  }
  return false;
}
export async function getExportRecords(options={}){return readExportRecords(options,'export_records');}
async function readExportRecords({scope='current_housing',fromDate=null,toDate=null,entityTypes=null}={},rpcName,boundary=null){
  if(!['current_housing','history'].includes(scope))throw new Error('Choose current housing or historical records.');
  if(entityTypes!==null&&(!Array.isArray(entityTypes)||!entityTypes.length||entityTypes.some(type=>!MANAGED.includes(type))))throw new Error('Choose supported record types to export.');
  for(const value of [fromDate,toDate])if(value!==null&&!exportDate(value))throw new Error('Choose valid export dates.');
  const context=exportContext(),permission=await getExportPermission();checkExportContext(context);
  const end=toDate||permission.as_of_date,start=fromDate||permission.cutoff_date;
  if(end>permission.as_of_date||start&&start>end)throw new Error('The export date range is invalid.');
  if(scope==='history'&&permission.cutoff_date&&start<permission.cutoff_date)throw new Error('This date range exceeds your export level.');
  const localData=permission.local?await localExportDataset():null;
  checkExportContext(context);
  if(permission.local){
    if(!localData)throw new Error('The workspace changed. Reopen Export.');
    const data=normalizeDataset({tables:{}});let excluded=0;
    for(const type of MANAGED){data.tables[type]=(entityTypes&&!entityTypes.includes(type)?[]:localData.tables[type]||[]).filter(row=>{
      if(scope!=='history')return currentExportRecord(type,row,localData);
      if(type==='husbandry_events'&&row.event_type==='locobox_revision')return false;
      if(type==='husbandry_events'&&row.event_type==='locobox_protocol')return Boolean(projectLocoboxExport(row,{fromDate:start,toDate:end,includeUndated:!start}));
      const date=exportRecordDate(type,row);
      if(!date){if(start){excluded++;return false}return true}
      return (!start||date>=start)&&date<=end;
    }).map(row=>type==='husbandry_events'?(row.event_type==='locobox_protocol'?projectLocoboxExport(row,{fromDate:start,toDate:end,includeUndated:!start}):projectExperimentExport(row)):clone(row));}
    return {dataset:data,metadata:{...permission,export_level:permission.level,scope,from_date:scope==='history'?start:null,to_date:scope==='history'?end:null,excluded_undated:excluded,snapshot_revision:'local',captured_at:new Date().toISOString()}};
  }
  const c=configuration(),rows=[],seen=new Set();let offset=0,metadata=null;
  while(true){
    const page=await request('rpc/'+rpcName,{method:'POST',body:{p_colony_id:c.colonyId,p_scope:scope,p_from_date:scope==='history'?start:null,p_to_date:scope==='history'?end:null,p_entity_types:entityTypes,p_offset:offset,p_limit:250,...(boundary?{p_expected_revision:boundary.snapshot_revision}:{})}});
    if(!page||!Array.isArray(page.rows)||page.rows.length>250||!['low','mid','mid1','mid2','high','max'].includes(page.export_level)||!exportDate(page.as_of_date)||typeof page.snapshot_revision!=='string')throw new Error('The server returned an unverifiable export page.');
    if(page.export_level!==permission.level||page.cutoff_date!==permission.cutoff_date||page.as_of_date!==permission.as_of_date)throw new Error('Your export permission changed. Reopen Export and try again.');
    if(page.fee_visibility){checkedFeeVisibility(page.fee_visibility);if(metadata?.fee_visibility&&stable(page.fee_visibility)!==stable(metadata.fee_visibility))throw new Error('Fee visibility changed while exporting. Reopen Export.');}
    if(boundary&&(page.snapshot_revision!==boundary.snapshot_revision||!sameFeeVisibility(checkedFeeVisibility(page.fee_visibility),boundary.fee_visibility)))throw new Error('Data or fee visibility changed while backing up. Try again.');
    if(metadata&&page.snapshot_revision!==metadata.snapshot_revision)throw new Error('Colony data changed while exporting. Try again for a consistent snapshot.');
    checkExportContext(context);
    metadata??={...page,rows:undefined,local:false,scope};
    for(const row of page.rows){
      const key=recordKey(row);
      if(!MANAGED.includes(row.entity_type)||typeof row.entity_id!=='string'||!row.payload||row.payload[ID_FIELDS[row.entity_type]]!==row.entity_id||seen.has(key))throw new Error('The export contains an invalid or duplicate record.');
      seen.add(key);rows.push(row);
    }
    const consumed=page.source_rows_consumed===undefined?page.rows.length:page.source_rows_consumed;
    if(!Number.isSafeInteger(consumed)||consumed<page.rows.length||consumed>250||consumed!==page.rows.length&&page.fee_visibility?.history_allowed!==false)throw new Error('Export pagination could not be verified. Narrow the selected records.');
    if(page.next_offset===null)break;
    if(!Number.isSafeInteger(page.next_offset)||page.next_offset!==offset+consumed||page.next_offset<=offset||page.next_offset>100000)throw new Error('Export pagination could not be verified. Narrow the selected records.');
    offset=page.next_offset;
  }
  const final=await getExportPermission();checkExportContext(context);
  if(final.local||final.level!==permission.level||final.cutoff_date!==permission.cutoff_date||final.as_of_date!==permission.as_of_date)throw new Error('Your export permission changed. Reopen Export and try again.');
  if(metadata?.fee_visibility){const finalFee=await refreshFeeVisibility();checkExportContext(context);if(stable(finalFee)!==stable(metadata.fee_visibility))throw new Error('Fee visibility changed while exporting. Reopen Export.');}
  const data=normalizeDataset({tables:{}});for(const row of rows)data.tables[row.entity_type].push({...clone(row.payload),export_record_date:row.record_date??null});
  return {dataset:data,metadata:{...metadata,row_count:rows.length}};
}
export async function getLocalBackup(){
  const context=exportContext(),generation=authGeneration;
  const check=()=>{checkExportContext(context);if(generation!==authGeneration)throw new Error('Your account changed. Reopen Export.');};
  const authorize=async()=>{
    const localData=await localExportDataset();check();
    if(localData)return localExportPermission();
    const c=configuration();if(!c)throw new Error('Open a workspace before backing up.');
    const grant=checkedExportPermission(await request('rpc/get_local_backup_permission',{method:'POST',body:{p_colony_id:c.colonyId}}));
    check();if(!['high','max'].includes(grant.level))throw new Error('Local backup is unavailable for this account.');
    return {...grant,local:false};
  };
  const permission=await authorize(),sections={},revisions={};
  // A one-row projected read supplies the colony-wide audit revision and policy;
  // its row is discarded. Bracket all full/raw or bounded reads with this fence.
  const readBoundary=async expected=>{
    const c=configuration(),page=await request('rpc/export_local_backup_records',{method:'POST',body:{p_colony_id:c.colonyId,p_scope:'current_housing',p_entity_types:['rooms'],p_offset:0,p_limit:1,p_expected_revision:expected?.snapshot_revision??null}});check();
    if(!page||!Array.isArray(page.rows)||page.rows.length>1||typeof page.snapshot_revision!=='string'||!/^\d{1,100}$/.test(page.snapshot_revision))throw new Error('Backup snapshot could not be verified.');
    if(page.export_level!==permission.level||page.cutoff_date!==permission.cutoff_date||page.as_of_date!==permission.as_of_date)throw new Error('Backup permission changed. No file was prepared.');
    const result={snapshot_revision:page.snapshot_revision,fee_visibility:checkedFeeVisibility(page.fee_visibility)};
    if(expected&&(result.snapshot_revision!==expected.snapshot_revision||!sameFeeVisibility(result.fee_visibility,expected.fee_visibility)))throw new Error('Data or fee visibility changed while backing up. Try again.');
    return result;
  };
  const boundary=permission.local?null:await readBoundary();
  if(permission.level==='max'&&boundary&&!boundary.fee_visibility.source_archive_allowed)throw new Error('Full workspace backup requires access to source and fee data.');
  if(permission.level==='max'){sections.workspace=await getFullExportBackup();if(sections.workspace.source_archive_restricted)throw new Error('Full workspace backup requires access to source and fee data.');}
  else{
    for(const scope of ['current_housing','history']){
      const result=await readExportRecords({scope,fromDate:scope==='history'?permission.cutoff_date:null,toDate:scope==='history'?permission.as_of_date:null},'export_local_backup_records',boundary);
      check();
      if(result.metadata.export_level!==permission.level||result.metadata.cutoff_date!==permission.cutoff_date||result.metadata.as_of_date!==permission.as_of_date)throw new Error('Backup permission changed. Try again.');
      sections[scope]={metadata:result.metadata,tables:result.dataset.tables};revisions[scope]=result.metadata.snapshot_revision;
    }
    if(!revisions.current_housing||revisions.current_housing!==revisions.history)throw new Error('Data changed while backing up. Try again for a consistent backup.');
  }
  const final=await authorize();check();
  for(const key of ['level','cutoff_date','as_of_date','local'])if(final[key]!==permission[key])throw new Error('Backup permission changed. No file was prepared.');
  if(boundary)await readBoundary(boundary);
  const payload={kind:'braintime-local-backup',schema_version:1,application:'mouse-data',created_at:new Date().toISOString(),full_workspace:permission.level==='max',restore_mode:permission.level==='max'?'workspace':'reviewed_merge_only',permission:{level:permission.level,cutoff_date:permission.cutoff_date,as_of_date:permission.as_of_date},sections};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
  check();return {...payload,integrity:{algorithm:'SHA-256',encoding:'JSON.stringify of envelope without integrity',value:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}};
}
export async function getFullExportBackup(){
  const context=exportContext(),permission=await assertFullExportPermission();checkExportContext(context);
  let data;
  if(permission.local)data=await localExportDataset();
  else {const rows=await allRecords();checkExportContext(context);data=await assemble(rows);}
  checkExportContext(context);if(!data)throw new Error('No workspace is available to back up.');
  const final=await assertFullExportPermission();checkExportContext(context);
  if(final.local!==permission.local)throw new Error('The workspace changed. Reopen Export.');
  return {...data,app_backup_at:new Date().toISOString(),export_permission:{level:permission.level,as_of_date:permission.as_of_date}};
}
export async function getFullSourceExport(){throw new Error('Raw source archive storage and export have been retired.');}

/** User administration is authenticated here and independently authorized by the Edge function. */
export async function manageColonyUsers(action,payload={}) {
  const c=configuration(),signedIn=session(),generation=authGeneration,epoch=providerSessionEpoch;
  const sameOwnerSession=()=>generation===authGeneration&&epoch===providerSessionEpoch&&configuration()?.url===c?.url&&configuration()?.colonyId===c?.colonyId&&session()?.user?.id===signedIn?.user?.id;
  if(!c)throw new Error('Configure the cloud project first.');
  if(signedIn?.user?.id&&!signedIn.access_token&&hasLabSession(signedIn))throw new Error('User management requires Cloud 1. Connect Cloud 1 and refresh.');
  if(!signedIn?.access_token||!signedIn.user?.id)throw new Error('Sign in before managing colony users.');
  if(action==='list'?!['owner','manager'].includes(signedIn.role):signedIn.role!=='owner')throw new Error(action==='list'?'Only an active colony owner or manager can view users.':'Only an active colony owner can manage users.');
  const allowed={list:[],invite:['email','role','export_level','permissions'],invite_preregistered:['person_id','version'],create_preregistered_link:['person_id','version'],update_access:['user_id','role','active','export_level','permissions']};
  if(!Object.hasOwn(allowed,action))throw new Error('Unsupported user-management action.');
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!allowed[action].includes(k)))throw new Error('Unexpected user-management fields. Colony and invitation return URLs are configured by the app and server.');
  const fields={};
  if(action==='invite_preregistered'||action==='create_preregistered_link') {
    if(typeof payload.person_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.person_id)||!Number.isSafeInteger(payload.version)||payload.version<1)throw new Error('Refresh Members and choose a saved preregistered member.');
    fields.person_id=payload.person_id;fields.version=payload.version;
  }
  if(action==='invite')fields.email=emailAddress(payload.email);
  if(action==='invite'||action==='update_access') {
    if(!['viewer','editor','manager'].includes(payload.role))throw new Error('Choose viewer or editor access. Owner accounts cannot be changed here.');
    fields.role=payload.role;
    if(payload.permissions!==undefined){const errors=validateManagerPermissions(payload.permissions);if(errors.length)throw new Error(errors.join(' '));fields.permissions=payload.permissions;}
    if(payload.export_level!==undefined){if(!['low','mid','mid1','mid2','high','max'].includes(payload.export_level))throw new Error('Choose Low, Mid1, Mid2, High or Max access.');fields.export_level=payload.export_level;}
  }
  if(action==='update_access') {
    if(typeof payload.user_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.user_id))throw new Error('Choose a valid colony user.');
    if(payload.user_id===signedIn.user.id)throw new Error('You cannot change your own access here.');
    if(typeof payload.active!=='boolean')throw new Error('User access must be explicitly enabled or disabled.');
    fields.user_id=payload.user_id;fields.active=payload.active;
  }
  // Account administration belongs to Cloud 1 even while scientific records
  // use Cloud 2. Prove its live membership without replacing the active NAS
  // session, provider choice or pending-edit policy with another source.
  const members=await cloud1Request(`memberships?select=role,active,guest_level,guest_access_starts_on,guest_access_ends_on&user_id=eq.${encodeURIComponent(signedIn.user.id)}&colony_id=eq.${encodeURIComponent(c.colonyId)}`);
  if(!Array.isArray(members)||members.length!==1||members[0].active!==true||!['owner','manager','editor','viewer'].includes(members[0].role))throw new Error('This account is not an active member of the configured colony.');
  const verifiedRole=members[0].role;
  if(action==='list'?!['owner','manager'].includes(verifiedRole):verifiedRole!=='owner')throw new Error(action==='list'?'Only an active colony owner or manager can view users.':'Only an active colony owner can manage users.');
  const token=await accessToken(),current=configuration();
  if(!sameOwnerSession())throw new Error('The cloud account or colony changed. Reload the user list before continuing.');
  let response;
  try {
    response=await fetch(`${c.url}/functions/v1/manage-colony-users`,{method:'POST',cache:'no-store',redirect:'error',headers:{apikey:publicKey(c.anonKey),Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...fields,action,colony_id:c.colonyId})});
  }catch{throw new Error('The user-management request was not confirmed. Reload the user list before retrying.');}
  const result=await responseJSON(response);
  if(!sameOwnerSession())throw new Error('The cloud account or colony changed while the request was running. Its result is uncertain; refresh Members before continuing.');
  if(!response.ok) {
    const partialMessage=result?.invitation_sent===true&&typeof result.message==='string';
    const error=!partialMessage&&(response.status===401||response.status===403)?apiError(response,result):new Error(typeof result?.message==='string'?result.message:`User management failed (${response.status}).`);
    if(typeof result?.code==='string')error.code=result.code;
    if(result?.invitation_sent===true)error.invitationSent=true;
    throw error;
  }
  if(action==='create_preregistered_link') {
    if(!result||result.person_id!==fields.person_id||result.email_sent!==false||result.delivery_status!=='not_sent'||result.link_kind!=='invitation'||result.expires_at!==null)throw new Error('The invitation link could not be verified. Refresh Members.');
    let link;
    try{link=new URL(result.invitation_link);}catch{throw new Error('The invitation link could not be verified. Refresh Members.');}
    const expectedOrigin=new URL(c.url).origin,keys=[...link.searchParams.keys()];
    const redirect=link.searchParams.get('redirect_to');
    if(link.protocol!=='https:'||link.origin!==expectedOrigin||link.username||link.password||link.hash||link.pathname!=='/auth/v1/verify'||keys.length!==3||new Set(keys).size!==3||keys.some(k=>!['token','type','redirect_to'].includes(k))||!/^[a-zA-Z0-9_-]{20,256}$/.test(link.searchParams.get('token')||'')||link.searchParams.get('type')!=='invite'||redirect!=='https://braintimelab.github.io/mouse-data/')throw new Error('The invitation link could not be verified. Refresh Members.');
    return {person_id:fields.person_id,invitation_link:link.href,link_kind:result.link_kind,expires_at:null,email_sent:false,delivery_status:'not_sent'};
  }
  if(!result||typeof result!=='object'||(action==='list'?!Array.isArray(result.users):action==='invite_preregistered'?result.person_id!==fields.person_id||result.email_sent!==true:!result.user||typeof result.user!=='object'))throw new Error('The server did not return a verifiable user-management result. Reload the user list before retrying.');
  if(action==='list'){
   if(result.viewer?.user_id!==signedIn.user.id||result.viewer?.role!==verifiedRole||result.colony_id&&result.colony_id!==c.colonyId)throw new Error('User list access could not be verified. Refresh and try again.');
   if(verifiedRole==='manager')result.users=result.users.filter(user=>user.role!=='owner'&&user.user_id!==signedIn.user.id);
   else {
    const profiles=await cloud1Request('rpc/list_guest_access',{method:'POST',body:{p_colony_id:c.colonyId}});
    if(!sameOwnerSession())throw new Error('The cloud account or colony changed while loading users. Refresh Members before continuing.');
    if(!profiles||!Array.isArray(profiles.users))throw new Error('User access details could not be verified. Refresh and try again.');
    for(const user of result.users){const profile=profiles.users.find(p=>p.user_id===user.user_id);if(profile)Object.assign(user,profile);}
    // Load permission maps only while the owner opens Settings. The identity
    // directory remains on the existing Edge endpoint; no startup query is added.
    const accessRows=await cloud1Request(`memberships?select=user_id,role,active,export_level,guest_level,notes_permissions,mouse_permissions,reagents_permissions,updated_at&colony_id=eq.${encodeURIComponent(c.colonyId)}`);
    const liveOwner=await cloud1Request(`memberships?select=role,active&user_id=eq.${encodeURIComponent(signedIn.user.id)}&colony_id=eq.${encodeURIComponent(c.colonyId)}`);
    if(!sameOwnerSession())throw new Error('The cloud account or colony changed while loading users. Refresh Members before continuing.');
    if(!Array.isArray(liveOwner)||liveOwner.length!==1||liveOwner[0].active!==true||liveOwner[0].role!=='owner')throw Object.assign(new Error('Only an active colony owner can view permission settings.'),{status:403});
    if(!Array.isArray(accessRows))throw new Error('Application permissions could not be verified. Refresh the user list.');
    const byUser=new Map();for(const row of accessRows){if(typeof row?.user_id!=='string'||byUser.has(row.user_id))throw new Error('Application permissions could not be verified. Refresh the user list.');byUser.set(row.user_id,row);}
    for(const user of result.users){const row=byUser.get(user.user_id);user.app_permissions_verified=false;if(!row)continue;for(const key of ['role','active','export_level','guest_level','updated_at'])if(Object.hasOwn(row,key))user[key]=row[key];for(const app of Object.keys(APP_PERMISSION_KEYS))user[app+'_permissions']=Object.hasOwn(row,app+'_permissions')?row[app+'_permissions']:{};user.app_permissions_verified=Object.keys(APP_PERMISSION_KEYS).every(app=>validAppPermissions(app,user[app+'_permissions']))&&validPermissionTimestamp(user.updated_at);}
   }
  }
  return result;
}

function validPermissionTimestamp(value){return typeof value==='string'&&value.length<=64&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));}
export async function setUserAppPermissions(payload){
 const fields=['user_id','notes_permissions','mouse_permissions','reagents_permissions','expected_updated_at'],c=configuration(),s=session(),generation=authGeneration,epoch=providerSessionEpoch;
 if(!c||!s?.access_token||!s?.user?.id||s.passwordRecovery||pendingAccount(s)||s.role!=='owner')throw new Error('Only an active Cloud 1 owner can change application permissions.');
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==fields.length||fields.some(key=>!Object.hasOwn(payload,key))||Object.keys(payload).some(key=>!fields.includes(key)))throw new Error('Save only application permission maps and the reviewed member version.');
 if(typeof payload.user_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.user_id)||payload.user_id===s.user.id||!validPermissionTimestamp(payload.expected_updated_at)||!Object.keys(APP_PERMISSION_KEYS).every(app=>validAppPermissions(app,payload[app+'_permissions'])))throw new Error('Refresh the user list and choose valid application permissions.');
 const target=payload.user_id,expectedUpdatedAt=payload.expected_updated_at,maps=Object.fromEntries(Object.keys(APP_PERMISSION_KEYS).map(app=>[app+'_permissions',clone(payload[app+'_permissions'])]));
 const check=()=>{if(generation!==authGeneration||epoch!==providerSessionEpoch||stable(c)!==stable(configuration())||session()?.user?.id!==s.user.id||session()?.role!=='owner')throw new Error('The owner account changed. Refresh the user list before continuing.');};
 const owner=await cloud1Request(`memberships?select=role,active&user_id=eq.${encodeURIComponent(s.user.id)}&colony_id=eq.${encodeURIComponent(c.colonyId)}`);check();
 if(!Array.isArray(owner)||owner.length!==1||owner[0].active!==true||owner[0].role!=='owner')throw Object.assign(new Error('Only an active colony owner can change application permissions.'),{status:403});
 const result=await cloud1Request('rpc/set_member_app_permissions',{method:'POST',body:{p_colony_id:c.colonyId,p_user_id:target,p_notes_permissions:maps.notes_permissions,p_mouse_permissions:maps.mouse_permissions,p_reagents_permissions:maps.reagents_permissions,p_expected_updated_at:expectedUpdatedAt}});check();
 if(!result||result.user_id!==target||result.colony_id!==c.colonyId||!['viewer','editor','manager'].includes(result.role)||result.guest_level!=null||typeof result.active!=='boolean'||!validPermissionTimestamp(result.updated_at)||!Object.keys(APP_PERMISSION_KEYS).every(app=>validAppPermissions(app,result[app+'_permissions'])&&stable(result[app+'_permissions'])===stable(maps[app+'_permissions'])))throw new Error('The permission update could not be verified. Refresh the user list before retrying.');
 return result;
}

export async function inviteLabMember(payload){return manageColonyUsers('invite_preregistered',payload);}
export async function createLabMemberInvitationLink(payload){return manageColonyUsers('create_preregistered_link',payload);}

const ACCESS_PAGES={'lab-tools':['tools'],mouse:['overview','mice','strains','review','matings','litters','cages','family','planner','experiments','iacuc','housing','locobox','cryo','fees','archive','brainbot','settings'],reagents:['inventory','safety','usage','orders','vendors','equipment','history','review','settings']};
const verifiedMembershipListeners=new Set(),appAccessListeners=new Set(),appAccessReceipts=new Map();let appAccessReceiptContext='';
// This signal comes only from the existing fresh membership read. It carries no
// token and cannot delay authorization or the following dataset load.
export function subscribeVerifiedMembership(listener){if(typeof listener!=='function'||verifiedMembershipListeners.size>=8)return()=>{};verifiedMembershipListeners.add(listener);return()=>verifiedMembershipListeners.delete(listener);}
function notifyVerifiedMembership(){const generation=authGeneration,epoch=providerSessionEpoch,current=session(),config=stable(configuration()),status=Object.freeze(getCloudStatus());for(const listener of [...verifiedMembershipListeners]){if(generation!==authGeneration||epoch!==providerSessionEpoch||session()?.user?.id!==current?.user?.id||stable(configuration())!==config)break;try{Promise.resolve(listener(status)).catch(()=>{});}catch{/* Reporting cannot change access. */}}}
const appAccessContext=()=>{const c=configuration(),s=session();return c&&s?.user?.id&&hasLabSession(s)&&!s.passwordRecovery&&!pendingAccount(s)?JSON.stringify([c.url,c.colonyId,s.user.id,s.role,providerSessionEpoch]):'';};
function accessReceiptContext(){const current=appAccessContext();if(current!==appAccessReceiptContext){appAccessReceiptContext=current;appAccessReceipts.clear();}return current;}
function accessReceipt(app,context,state){if(!context||accessReceiptContext()!==context)return;const previous=appAccessReceipts.get(app)||{attempts:0,last_attempt_at:null,last_confirmed_at:null};appAccessReceipts.set(app,{state,attempts:Math.min(999,previous.attempts+(state==='pending'?1:0)),last_attempt_at:state==='pending'?new Date().toISOString():previous.last_attempt_at,last_confirmed_at:['confirmed','rate_limited'].includes(state)?new Date().toISOString():previous.last_confirmed_at});for(const listener of [...appAccessListeners])try{listener();}catch{/* Diagnostic rendering is optional. */}}
export function getAppAccessStatus(app='mouse'){accessReceiptContext();return {...(appAccessReceipts.get(app)||{state:'idle',attempts:0,last_attempt_at:null,last_confirmed_at:null})};}
export function subscribeAppAccessStatus(listener){if(typeof listener!=='function'||appAccessListeners.size>=8)return()=>{};appAccessListeners.add(listener);return()=>appAccessListeners.delete(listener);}
// Authenticated app activity is best effort and contains only allowlisted labels.
// Capture the current token before sign-out clears it; never delay sign-out for logging.
export function recordAppAccess(payload){
 const c=configuration(),s=session(),generation=authGeneration,idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!c||!hasLabSession(s)||!s.user?.id||s.passwordRecovery||s.setupRequired||!['owner','manager','editor','viewer'].includes(s.role)||!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!['app','event','page','sessionId','eventId'].includes(k))||!['mouse','reagents','lab-tools'].includes(payload.app)||!['session_start','page_view','sign_out'].includes(payload.event)||!ACCESS_PAGES[payload.app]?.includes(payload.page)||!idPattern.test(payload.sessionId||'')||!idPattern.test(payload.eventId||''))return Promise.resolve(null);
 const body={p_colony_id:c.colonyId,p_app:payload.app,p_event:payload.event,p_page:payload.page,p_session_id:payload.sessionId,p_event_id:payload.eventId};
 const receiptContext=accessReceiptContext();accessReceipt(payload.app,receiptContext,'pending');
 const settled=result=>{const confirmed=result&&typeof result.recorded==='boolean'&&['recorded','duplicate','debounced','rate_limited'].includes(result.reason)&&result.recorded===(result.reason==='recorded')&&result.event_id===payload.eventId;accessReceipt(payload.app,receiptContext,confirmed?(result.reason==='rate_limited'?'rate_limited':'confirmed'):'unconfirmed');return confirmed?result:null;};
 const service=provider();if(service&&service.getState().active==='cloud2')return service.cloud2.activity(body).then(reply=>settled(reply?.result),()=>settled(null));
 if(!s.access_token)return Promise.resolve(settled(null));
 const send=token=>Promise.resolve(fetch(`${c.url}/rest/v1/rpc/record_app_access`,{method:'POST',cache:'no-store',redirect:'error',keepalive:true,headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),...(typeof globalThis.AbortSignal?.timeout==='function'?{signal:globalThis.AbortSignal.timeout(5000)}:{})})).then(async response=>settled(response.ok?await responseJSON(response):null)).catch(()=>settled(null));
 // Local section navigation may not make any other authenticated request for hours.
 // Refresh ordinary activity tokens; sign-out still captures its token immediately.
 try{
  if(payload.event!=='sign_out'&&s.expires_at<=Date.now()/1000+60)return accessToken().then(token=>{const current=session();if(generation!==authGeneration||configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||current?.user?.id!==s.user.id||current?.role!==s.role||current.passwordRecovery||current.setupRequired)return settled(null);return send(token);}).catch(()=>settled(null));
  return send(s.access_token);
 }catch{return Promise.resolve(settled(null));}
}

export async function listAppAccess(filters={}){
 const c=configuration(),s=session(),generation=authGeneration;
 const denied=()=>Object.assign(new Error('Only the database owner can read access logs.'),{code:'42501'});
 if(!c||!s?.user?.id||s.passwordRecovery||s.role!=='owner')throw denied();
 if(!filters||typeof filters!=='object'||Array.isArray(filters)||Object.keys(filters).some(k=>!['app','userId','excludeOwner','event','from','to','before','limit'].includes(k)))throw new Error('Unsupported access log filters.');
 const value={app:null,userId:null,excludeOwner:false,event:null,from:null,to:null,before:null,limit:50,...filters};
 const time=v=>v===null||typeof v==='string'&&v.length<=40&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
 if(typeof value.excludeOwner!=='boolean'||value.excludeOwner&&value.userId!==null||value.app!==null&&!['mouse','reagents','lab-tools'].includes(value.app)||value.userId!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.userId)||value.event!==null&&!['session_start','page_view','sign_out'].includes(value.event)||!time(value.from)||!time(value.to)||value.from&&value.to&&Date.parse(value.from)>=Date.parse(value.to)||value.before!==null&&!(typeof value.before==='string'&&/^[1-9]\d*$/.test(value.before)&&value.before.length<=19)||!Number.isInteger(value.limit)||value.limit<1||value.limit>50)throw new Error('Choose valid access log filters.');
 const check=()=>{if(generation!==authGeneration||configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==s.user.id)throw new Error('The account changed. Reopen Access logs.');if(session()?.role!=='owner')throw denied();};
 if(await membership({check})!=='owner')throw denied();check();
 const result=await request(value.excludeOwner?'rpc/list_app_access_filtered':'rpc/list_app_access',{method:'POST',body:{...(value.excludeOwner?{p_exclude_owner:true}:{}),p_colony_id:c.colonyId,p_app:value.app,p_user_id:value.userId,p_event:value.event,p_from:value.from,p_to:value.to,p_before:value.before,p_limit:value.limit}});
 check();if(!result||!Array.isArray(result.events)||result.events.length>value.limit||typeof result.has_more!=='boolean')throw new Error('Access logs could not be verified.');return result;
}


// Read only: the existing Cloud 1 owner session verifies access to NAS activity.
// No NAS credentials, cookies, note contents or browser caches are involved.
export async function listNasAppAccess(filters={}){
 const c=configuration(),s=session(),generation=authGeneration;
 const denied=()=>new Error('Sign in as the owner to view Lab Boards access logs.');
 if(!c||!s?.user?.id||s.role!=='owner'||s.passwordRecovery||s.setupRequired)throw denied();
 if(c.url!==PUBLIC_CONFIG.url||c.colonyId!==PUBLIC_CONFIG.colonyId)throw new Error('Lab Boards access logs are unavailable for this workspace.');
 if(!filters||typeof filters!=='object'||Array.isArray(filters)||Object.keys(filters).some(k=>!['app','userId','excludeOwner','event','from','to','before','limit'].includes(k)))throw new Error('Unsupported access log filters.');
 const value={app:null,userId:null,excludeOwner:false,event:null,from:null,to:null,before:null,limit:50,...filters};
 const time=v=>v===null||typeof v==='string'&&v.length<=40&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
 if(typeof value.excludeOwner!=='boolean'||value.excludeOwner&&value.userId!==null||value.app!==null&&!['notes','calculator'].includes(value.app)||value.userId!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.userId)||value.event!==null&&!['sign_in','session_start','page_view','sign_out'].includes(value.event)||!time(value.from)||!time(value.to)||value.from&&value.to&&Date.parse(value.from)>=Date.parse(value.to)||value.before!==null&&!(typeof value.before==='string'&&/^[1-9]\d{0,11}$/.test(value.before))||!Number.isInteger(value.limit)||value.limit<1||value.limit>50)throw new Error('Choose valid access log filters.');
 const check=()=>{if(generation!==authGeneration||configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==s.user.id)throw new Error('The account changed. Reopen Access logs.');if(session()?.role!=='owner'||session()?.passwordRecovery||session()?.setupRequired)throw denied();};
 const endpoint=new URL('/api/owner/access-logs',PUBLIC_CONFIG.cloud2Url),query=new URLSearchParams({limit:String(value.limit),exclude_owner:String(value.excludeOwner)});
 for(const[key,v]of Object.entries({app:value.app,user_id:value.userId,event:value.event,from:value.from,to:value.to,before:value.before}))if(v!==null)query.set(key,v);
 const token=await accessToken();check();
 const {response,result}=await cloudJSON(endpoint.href+'?'+query,{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',redirect:'error'},10000);check();
 if(!response.ok)throw apiError(response,result);
 if(result?.source!=='nas'||!Array.isArray(result.events)||result.events.length>value.limit||typeof result.has_more!=='boolean')throw new Error('Lab Boards access logs could not be verified.');
 return result;
}


// Presence is ephemeral and independent of audit history, data synchronization
// and source selection. A hidden tab removes only its own per-app client row.
const PRESENCE_UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PRESENCE_APPS=['lab-tools','mouse','reagents'];
function presenceEnvelope(result,source){
 const apps=source==='nas'?['notes','calculator','qpcr']:PRESENCE_APPS;
 const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 if(!result||result.source!==source||result.available!==true||!time(result.server_time)||result.expires_after_seconds!==90||!Array.isArray(result.users)||result.users.length>1000)throw new Error('Online members could not be verified.');
 const ids=new Set(),serverTime=Date.parse(result.server_time);
 const users=result.users.map(row=>{
  if(!row||!PRESENCE_UUID.test(row.user_id||'')||ids.has(row.user_id)||typeof row.name!=='string'||row.name.length>200||!(row.acronym===null||typeof row.acronym==='string'&&row.acronym.length<=20)||!Array.isArray(row.apps)||!row.apps.length||row.apps.length>apps.length||new Set(row.apps).size!==row.apps.length||row.apps.some(app=>!apps.includes(app))||!time(row.last_seen_at)||!time(row.expires_at)||Date.parse(row.last_seen_at)>serverTime+5000||Date.parse(row.expires_at)<=serverTime||Date.parse(row.expires_at)-Date.parse(row.last_seen_at)!==90000)throw new Error('An online member could not be verified.');
  ids.add(row.user_id);return {user_id:row.user_id,name:row.name,acronym:row.acronym,apps:[...row.apps],last_seen_at:row.last_seen_at,expires_at:row.expires_at};
 });
 return {source,available:true,server_time:result.server_time,expires_after_seconds:90,users};
}
export function recordAppPresence(payload){
 const c=configuration(),s=session(),generation=authGeneration,epoch=providerSessionEpoch;
 if(!c||!hasLabSession(s)||!PRESENCE_UUID.test(s?.user?.id||'')||s.passwordRecovery||s.setupRequired||!['owner','manager','editor','viewer'].includes(s.role)||!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!['app','clientId','present'].includes(k))||!PRESENCE_APPS.includes(payload.app)||!PRESENCE_UUID.test(payload.clientId||'')||typeof payload.present!=='boolean')return Promise.resolve(null);
 const unchanged=()=>generation===authGeneration&&epoch===providerSessionEpoch&&configuration()?.url===c.url&&configuration()?.colonyId===c.colonyId&&session()?.user?.id===s.user.id&&session()?.role===s.role&&!session()?.passwordRecovery&&!session()?.setupRequired;
 const body={p_colony_id:c.colonyId,p_app:payload.app,p_client_id:payload.clientId,p_present:payload.present};
 const checked=result=>unchanged()&&typeof result?.recorded==='boolean'&&typeof result.server_time==='string'&&Number.isFinite(Date.parse(result.server_time))&&(payload.present?typeof result.expires_at==='string'&&Number.isFinite(Date.parse(result.expires_at)):result.expires_at===null)?{recorded:result.recorded,server_time:result.server_time,expires_at:result.expires_at}:null;
 const service=provider();
 if(service?.getState().active==='cloud2')return Promise.reject(Object.assign(new Error('Online presence is unavailable on Cloud 2.'),{code:'PRESENCE_UNAVAILABLE'}));
 if(!s.access_token)return Promise.resolve(null);
 const send=token=>Promise.resolve(fetch(`${c.url}/rest/v1/rpc/record_app_presence`,{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',keepalive:true,headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),...(typeof globalThis.AbortSignal?.timeout==='function'?{signal:globalThis.AbortSignal.timeout(5000)}:{})})).then(async response=>response.ok?checked(await responseJSON(response)):null).catch(()=>null);
 try{if(payload.present&&s.expires_at<=Date.now()/1000+60)return accessToken().then(token=>unchanged()?send(token):null).catch(()=>null);return send(s.access_token);}catch{return Promise.resolve(null);}
}
function ownerPresenceContext(){
 const c=configuration(),s=session(),generation=authGeneration,epoch=providerSessionEpoch;
 const denied=()=>new Error('Only the owner can view online members.');
 if(!c||!hasLabSession(s)||!PRESENCE_UUID.test(s?.user?.id||'')||s.role!=='owner'||s.passwordRecovery||s.setupRequired)throw denied();
 const check=()=>{if(generation!==authGeneration||epoch!==providerSessionEpoch||configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==s.user.id)throw new Error('The account changed. Reopen online members.');if(session()?.role!=='owner'||session()?.passwordRecovery||session()?.setupRequired)throw denied();};
 return {c,check};
}
export async function listAppPresence(){
 const {c,check}=ownerPresenceContext(),service=provider();
 if(service?.getState().active==='cloud2')throw Object.assign(new Error('Online presence is unavailable on Cloud 2.'),{code:'PRESENCE_UNAVAILABLE'});
 // A narrow owner-authorized RPC is sufficient; no scientific data pull or
 // provider health check is needed for a status indicator.
 const result=await cloud1Request('rpc/list_app_presence',{method:'POST',body:{p_colony_id:c.colonyId},timeoutMs:10000});check();return presenceEnvelope(result,'cloud1');
}
export async function listNasPresence(){
 const {c,check}=ownerPresenceContext();
 if(provider()?.getState().active==='cloud2')throw Object.assign(new Error('Online presence is unavailable on Cloud 2.'),{code:'PRESENCE_UNAVAILABLE'});
 if(c.url!==PUBLIC_CONFIG.url||c.colonyId!==PUBLIC_CONFIG.colonyId)throw new Error('BraintimeDisk online members are unavailable for this workspace.');
 const token=await accessToken();check();const endpoint=new URL('/api/owner/presence',PUBLIC_CONFIG.cloud2Url);
 const {response,result}=await cloudJSON(endpoint.href,{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',redirect:'error'},10000);check();if(!response.ok)throw apiError(response,result);return presenceEnvelope(result,'nas');
}

// Compatibility errors prevent old controls from retaining a raw workbook again.
const rawArchiveRetired=()=>{throw new Error('Raw source archive storage and export have been retired.');};
export async function fetchHistoryArchive(){return rawArchiveRetired();}
export async function uploadHistoryIndex(){return rawArchiveRetired();}
export async function downloadHistoryIndex(){return rawArchiveRetired();}

// Private roster never enters the colony dataset, IndexedDB, backups or exports.
export async function listLabMembers(){
 if(await membership()!=='owner')throw new Error('Only the owner can view lab-member records.');
 return request('rpc/list_lab_members',{method:'POST',body:{p_colony_id:configuration().colonyId}});
}
export async function listCageManagers(){
 if(isGuest(session())){const value=await request('rpc/get_lab_collaboration_members',{method:'POST',body:{p_colony_id:configuration().colonyId}});return {managers:(value.members||[]).map(m=>({person_id:m.id,name:m.name,acronym:m.acronym,status:'current'}))};}
 const config=configuration(),actor=session()?.user?.id;
 if(!config||!actor)throw new Error('Sign in to load cage managers.');
 const result=await request('rpc/list_cage_managers',{method:'POST',body:{p_colony_id:config.colonyId}});
 if(configuration()?.url!==config.url||configuration()?.colonyId!==config.colonyId||session()?.user?.id!==actor)throw new Error('Account changed. Reload cage managers.');
 if(!Array.isArray(result?.managers))throw new Error('Cage manager list is unavailable.');
 // Keep the contact-free directory in memory only, never in colony records/cache.
 return {managers:result.managers.filter(row=>row&&typeof row.person_id==='string'&&typeof row.name==='string'&&['current','historical'].includes(row.status)).map(row=>({person_id:row.person_id,name:row.name,acronym:typeof row.acronym==='string'?row.acronym:null,nickname:typeof row.nickname==='string'?row.nickname:null,status:row.status}))};
}
// Fixed phrases only. Keep aligned with sql/cage-note-hints.sql; raw Sheet
// blocks and arbitrary cell text must never enter this member-facing response.
const CAGE_NOTE_HINTS=new Set(['Genotyping','Genotyping done','no genotyping needed','Experiment','Experiment done','no experiment planned','PIR!','PIR not good but usable','PIR not good','PIR fixed','PIR normal','no PIR problem','LED!','LED not good but usable','LED not good','LED fixed','LED normal','no LED problem']);
export async function listCageNoteHints(){
 const c=configuration(),s=session(),actor=s?.user?.id,generation=authGeneration,config=stable(c);
 if(!c||!hasLabSession(s)||!actor||s.passwordRecovery||pendingAccount(s))throw new Error('Sign in to load cage note badges.');
 const check=()=>{const current=session();if(generation!==authGeneration||config!==stable(configuration())||current?.user?.id!==actor||!hasLabSession(current)||current.passwordRecovery||pendingAccount(current))throw new Error('The account or colony changed. Reload cage note badges.');};
 let result;try{result=await request('rpc/list_cage_note_hints',{method:'POST',body:{p_colony_id:c.colonyId}});}catch(error){check();throw error;}
 check();
 if(!Array.isArray(result)||result.length>4096)throw new Error('Cage note badges are unavailable.');
 const seen=new Set(),hints=[];
 for(const row of result){
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==2||!Object.hasOwn(row,'location_id')||!Object.hasOwn(row,'notes')||typeof row.location_id!=='string'||!row.location_id||row.location_id!==row.location_id.trim()||row.location_id.length>256||/[\u0000-\u001f\u007f]/.test(row.location_id)||seen.has(row.location_id)||!Array.isArray(row.notes)||!row.notes.length||row.notes.length>CAGE_NOTE_HINTS.size||new Set(row.notes).size!==row.notes.length||row.notes.some(note=>!CAGE_NOTE_HINTS.has(note)))throw new Error('Cage note badges are unavailable.');
  seen.add(row.location_id);hints.push({location_id:row.location_id,notes:[...row.notes]});
 }
 // Used by the live cage view only, never merged into records, exports or cache.
 return hints;
}
export async function saveLabMember(person){
 if(await membership()!=='owner')throw new Error('Only the owner can edit lab-member records.');
 const {guest_level,guest_permissions,guest_access_starts_on,guest_access_ends_on,...profile}=person;
 const hasGuest=Object.hasOwn(person,'guest_level'),availability=guestAvailabilityFields(person);
 if(availability&&!hasGuest)throw new Error('Choose the guest profile before changing guest availability.');
 return request(availability?'rpc/save_guest_lab_member_window':hasGuest?'rpc/save_guest_lab_member':'rpc/save_lab_member',{method:'POST',body:hasGuest?{p_colony_id:configuration().colonyId,p_person:profile,p_guest_level:guest_level||null,p_guest_permissions:guest_permissions||{},...availability}:{p_colony_id:configuration().colonyId,p_person:profile}});
}
export async function approveLabMemberEmail(payload){
 const keys=['request_person_id','request_version','target_person_id','target_version'];
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==keys.length||Object.keys(payload).some(key=>!keys.includes(key)))throw new Error('Select the registered email and existing member before approving.');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(typeof payload.request_person_id!=='string'||typeof payload.target_person_id!=='string'||!uuid.test(payload.request_person_id)||!uuid.test(payload.target_person_id)||payload.request_person_id===payload.target_person_id||!Number.isSafeInteger(payload.request_version)||payload.request_version<1||!Number.isSafeInteger(payload.target_version)||payload.target_version<1)throw new Error('Refresh Members and select the current records.');
 const c=configuration(),actor=session()?.user?.id,generation=authGeneration;
 const check=()=>{if(generation!==authGeneration||configuration()?.url!==c?.url||configuration()?.colonyId!==c?.colonyId||session()?.user?.id!==actor)throw new Error('The account or colony changed. Refresh Members before continuing.');};
 if(!c||!actor)throw new Error('Sign in as the owner before approving an email.');
 if(await membership({check})!=='owner')throw Object.assign(new Error('Only the owner can approve a member email.'),{status:403});
 check();
 let result;
 try{result=await request('rpc/approve_lab_member_email',{method:'POST',body:{p_colony_id:c.colonyId,p_request_person_id:payload.request_person_id,p_request_version:payload.request_version,p_target_person_id:payload.target_person_id,p_target_version:payload.target_version}});}
 catch(error){check();if(error.status===409)error.code='40001';throw error;}
 check();
 const member=result?.member,merged=result?.merged_request,email=result?.approved_email;
 const validEmail=typeof email==='string'&&email===email.trim().toLowerCase()&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
 const loginApproval=result?.approval_kind==='login_email'&&result.setup_required===true&&member?.linked_user_id===null&&member?.username===null&&member?.email===email;
 const contactApproval=result?.approval_kind==='secondary_contact'&&result.setup_required===false&&typeof member?.linked_user_id==='string'&&uuid.test(member.linked_user_id)&&typeof member?.username==='string'&&/^[a-z][a-z0-9_.-]{2,31}$/.test(member.username)&&member.membership_active===true&&member.email!==email&&member.secondary_emails?.includes(email);
 if(member?.person_id!==payload.target_person_id||member.status!=='current'||member.archived!==false||!Number.isSafeInteger(member.version)||member.version<=payload.target_version||!Array.isArray(member.secondary_emails)||!validEmail||!(loginApproval||contactApproval)||merged?.person_id!==payload.request_person_id||merged.archived!==true||!Number.isSafeInteger(merged.version)||merged.version<=payload.request_version)throw new Error('The email approval result could not be confirmed. Refresh Members before trying again.');
 return result;
}
function applyMyLabProfile(result){
 const active=session();if(active)saveSession({...active,username:result?.member?.username||null,setupRequired:setupBlocksAccess(result)});
}
async function registrationSetupAccess(profile,check=()=>{}){
 if(profile?.eligible!==true||profile.setup_required!==true)return profile;
 // Only this fresh own-user result can make username setup optional. Missing,
 // unsupported or failed verification preserves the existing setup gate.
 const result={...profile};delete result.setup_blocks_access;
 try{
  const access=await cloud1Request('rpc/get_my_registration_setup_access',{method:'POST',body:{p_colony_id:configuration().colonyId},timeoutMs:3000});check();
  if(access&&typeof access==='object'&&!Array.isArray(access)&&Object.keys(access).length===1&&access.setup_blocks_access===false)result.setup_blocks_access=false;
 }catch{check();}
 return result;
}
export async function getMyLabMember(){
 const c=configuration(),actor=session()?.user?.id,generation=authGeneration;
 if(!c||!actor)throw new Error('Sign in before loading your registered profile.');
 const check=()=>{if(generation!==authGeneration||configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==actor)throw new Error('The account changed. Sign in again.');};
 let result=await (pendingAccount(session())?cloud1Request:request)('rpc/get_my_lab_member',{method:'POST',body:{p_colony_id:c.colonyId}});check();
 result=await registrationSetupAccess(result,check);check();
 if(result?.setup_blocks_access===false&&pendingAccount(session())){await membership({check});check();}
 applyMyLabProfile(result);return result;
}
export async function saveMyLabProfile(fields,version){
 const c=configuration(),actor=session()?.user?.id,generation=authGeneration;
 if(!c||!actor||session()?.passwordRecovery)throw new Error('Sign in before saving your profile.');
 if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(key=>!['name','phone','acronym','category'].includes(key)))throw new Error('Only your name, phone, acronym and category can be changed here.');
 if(!Number.isSafeInteger(version)||version<0)throw new Error('Reload your current profile before saving.');
 const profile={};
 for(const [key,value] of Object.entries(fields)){
  if(value!==null&&typeof value!=='string')throw new Error('Enter valid profile details.');
  profile[key]=typeof value==='string'?value.trim():null;
 }
 if(typeof profile.name!=='string'||!profile.name||profile.name.length>200)throw new Error('Enter your name (up to 200 characters).');
 if(profile.phone!=null&&profile.phone.length>80)throw new Error('Use a phone number up to 80 characters.');
 if(profile.acronym){profile.acronym=profile.acronym.toUpperCase();if(!/^[A-Z][A-Z0-9_-]{0,11}$/.test(profile.acronym))throw new Error('Use an acronym beginning with a letter, up to 12 letters, numbers, underscores or hyphens.');}
 if(profile.category!==undefined&&!['undergraduate','masters','phd','postdoc','visiting_student','visiting_faculty','principal_investigator','other','unknown'].includes(profile.category))throw new Error('Choose a valid member category.');
 let result=await request('rpc/submit_my_lab_profile',{method:'POST',body:{p_colony_id:c.colonyId,p_profile:profile,p_expected_version:version}});
 if(generation!==authGeneration||configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==actor)throw new Error('The account changed. Reload your profile.');
 if(!result?.member||result.member.name!==profile.name||!Number.isSafeInteger(result.member.version)||result.member.version<1||result.member.version<version)throw new Error('Your profile save was not confirmed. Reload your profile.');
 result=await registrationSetupAccess(result,()=>{if(generation!==authGeneration||configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==actor)throw new Error('The account changed. Reload your profile.');});
 applyMyLabProfile(result);return result;
}
export async function getLabUserDirectory(){if(isGuest(session()))return {users:[]};return request('rpc/get_lab_user_directory',{method:'POST',body:{p_colony_id:configuration().colonyId}});}
export async function updateMyLabAcronym({acronym,version}={}){
 const c=configuration(),actor=session()?.user?.id,code=typeof acronym==='string'?acronym.trim().toUpperCase():'';
 if(!c||!actor)throw new Error('Sign in before changing your acronym.');
 if(!/^[A-Z][A-Z0-9_-]{0,11}$/.test(code))throw new Error('Use 1–12 letters, numbers, underscores or hyphens, beginning with a letter.');
 if(!Number.isSafeInteger(version)||version<1)throw new Error('Reload your current profile before changing your acronym.');
 const result=await request('rpc/update_my_lab_acronym',{method:'POST',body:{p_colony_id:c.colonyId,p_acronym:code,p_expected_version:version}});
 if(configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==actor)throw new Error('The account changed. Reload your current profile.');
 if(result?.eligible!==true||result.member?.acronym!==code||!Number.isSafeInteger(result.member?.version)||result.member.version<version)throw new Error('Your acronym change was not confirmed. Reload your profile.');
 return result;
}
export async function completeAccountSetup(username,password){
 const id=typeof username==='string'?username.trim().toLowerCase():'';
 if(!/^[a-z][a-z0-9_.-]{2,31}$/.test(id))throw new Error('Use 3–32 characters: start with a letter, then letters, numbers, dots, underscores or hyphens.');
  const c=configuration(),actor=session()?.user?.id,generation=authGeneration;
  const check=()=>{if(generation!==authGeneration||configuration()?.url!==c?.url||configuration()?.colonyId!==c?.colonyId||session()?.user?.id!==actor)throw new Error('The account changed. Sign in again.');};
  const complete=result=>result?.eligible===true&&result.setup_required===false&&result.member?.username===id;
  let mine;try{mine=await getMyLabMember();}catch(error){check();const safe=new Error('Account profile check failed. '+error.message);safe.setupStage='profile';if(error.status===401||error.status===403)safe.status=error.status;throw safe;}
  check();if(!mine?.eligible)throw new Error('Ask the owner to register your verified email first.');
  let result=mine;
  if(mine.setup_required===false){
    if(!complete(mine))throw new Error('Account setup is already complete. Sign in with your registered username.');
    // A previous claim may have committed even if its response or final
    // verification timed out. Recovery must not change the password again.
  }else{
    if(password!==undefined){
      try{await updateAccountPasswordVerified(password,{actor,generation,url:c.url,colonyId:c.colonyId});}
      catch(error){check();error.setupStage='password';throw error;}
    }
    else if(!mine.has_password)throw new Error('Set your own account password first.');
    check();
    try{result=await request('rpc/complete_lab_member_setup',{method:'POST',body:{p_colony_id:c.colonyId,p_username:id}});}
    catch(error){
      check();let reconciled=null;
      // Read-only reconciliation, never replay the password or claim write.
      try{reconciled=await getMyLabMember();}catch{/* Keep the original failure. */}
      check();
      if(complete(reconciled))result=reconciled;
      else{const safe=new Error((password!==undefined?'Your password was saved. ':'')+'Username setup was not confirmed: '+error.message);safe.setupStage='username';safe.passwordSaved=password!==undefined;if(error.status===401||error.status===403)safe.status=error.status;throw safe;}
    }
  }
  check();if(!complete(result))throw new Error('Account setup was not confirmed. Reload Settings.');
  try{await membership();}catch(error){check();const safe=new Error('Account saved. Sign-in verification failed: '+error.message+' Retry verification.');safe.setupStage='verification';safe.accountSaved=true;safe.passwordSaved=true;if(error.status===401||error.status===403)safe.status=error.status;throw safe;}
  check();
 saveSession({...session(),username:id,setupRequired:false});return result;
}

/** Inbound Animal Sheet refresh is queued server-side, never with a browser secret. */
export async function startAnimalSheetImport(){
 const c=configuration(),actor=session()?.user?.id;if(!c||!actor)throw new Error('Sign in before refreshing from Animal Sheet.');
 await membership();const current=session();
 if(current.role==='viewer'||current.role==='manager'&&(current.permissions?.imports===false||current.permissions?.housing===false))throw new Error('Import and housing permissions are required.');
 if(configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==actor)throw new Error('The account changed. Reopen Settings.');
 const result=await request('rpc/request_animal_sheet_import',{method:'POST',body:{p_colony_id:c.colonyId}});
 if(configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==actor)throw new Error('The account changed. Reopen Settings to check the refresh status.');
 return result;
}
export async function getAnimalSheetImportStatus(){
 const c=configuration(),actor=session()?.user?.id;if(!c||!actor)throw new Error('Sign in to view Animal Sheet refresh status.');
 const result=await request('rpc/get_animal_sheet_import_status',{method:'POST',body:{p_colony_id:c.colonyId}});
 if(configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==actor)throw new Error('The account changed. Reopen Settings.');return result;
}
export async function getAnimalSheetImportConflicts({offset=0,limit=100}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error('Choose a valid conflict page.');
 const c=configuration(),actor=session()?.user?.id;if(!c||!actor)throw new Error('Sign in to review Animal Sheet differences.');
 const result=await request('rpc/get_animal_sheet_import_conflicts',{method:'POST',body:{p_colony_id:c.colonyId,p_offset:offset,p_limit:limit}});
 if(configuration()?.url!==c.url||configuration()?.colonyId!==c.colonyId||session()?.user?.id!==actor)throw new Error('The account changed. Reopen Settings.');return result;
}

async function experimentSheetImportRequest(name,args={}){
 const c=configuration(),actor=session()?.user?.id,generation=authGeneration,config=stable(c);
 if(!c||!actor)throw new Error('Sign in to use Experiment Sheet imports.');
 const check=()=>{if(generation!==authGeneration||stable(configuration())!==config||session()?.user?.id!==actor||session()?.passwordRecovery||pendingAccount(session()))throw new Error('The account changed. Reopen Experiment Sheet imports.');};
 check();await membership({check});check();
 const current=session(),permitted=['owner','editor'].includes(current.role)||current.role==='manager'&&current.permissions?.imports===true&&current.permissions?.experiments===true;
 if(!permitted)throw new Error('Experiment and import permissions are required.');
 const result=await request('rpc/'+name,{method:'POST',body:{p_colony_id:c.colonyId,...args}});check();return result;
}
export function startExperimentSheetImport(){return experimentSheetImportRequest('request_experiment_sheet_import');}
export function getExperimentSheetImportStatus(){return experimentSheetImportRequest('get_experiment_sheet_import_status');}
export function getExperimentSheetImportConflicts({offset=0,limit=100}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)return Promise.reject(new Error('Choose a valid conflict page.'));
 return experimentSheetImportRequest('get_experiment_sheet_import_conflicts',{p_offset:offset,p_limit:limit});
}


// Monitoring is readable from High upward; all bot mutations remain owner-only.
async function brainbotRequest(name,body={}){
 const context=exportContext(),c=configuration();
 if(!c||!session()?.user?.id)throw new Error('Sign in before opening Braintime Bot.');
 const role=await membership(),monitoring=name==='get_brainbot_status';
 if(monitoring?!(['owner','manager'].includes(role)||['high','max'].includes(session()?.exportLevel)):role!=='owner')throw new Error(monitoring?'Braintime Bot monitoring is unavailable for this account.':'Only the owner can manage Braintime Bot.');
 checkExportContext(context);
 const result=await request('rpc/'+name,{method:'POST',body:{p_colony_id:c.colonyId,...body}});
 checkExportContext(context);
 if(!result||!Number.isSafeInteger(result.settings?.version)||result.settings.version<0||!Array.isArray(result.runs)||!Array.isArray(result.issues)||result.principal?.role!=='manager')throw new Error('Braintime Bot status was not confirmed. Reload the monitoring page.');
 return result;
}
export function getBrainbotStatus(){return brainbotRequest('get_brainbot_status');}
export function saveBrainbotSettings(settings){return brainbotRequest('save_brainbot_settings',{p_settings:settings});}
export async function runBrainbot(){const result=await brainbotRequest('run_brainbot');if(result.last_run?.fixed_count>0)invalidate();return result;}
export function reviewBrainbotIssue({issue_id,version,status,note=null}){return brainbotRequest('review_brainbot_issue',{p_issue_id:issue_id,p_version:version,p_status:status,p_note:note});}


export async function requestPasswordReset(identifier){
 const c=configuration();if(!c)throw new Error('Configure the cloud project first.');
 const value=typeof identifier==='string'?identifier.trim():'';
 if(value.length>254||!(/^[a-z][a-z0-9_.-]{2,31}$/i.test(value)||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))throw new Error('Enter a valid username or email.');
 const action=beginAuthAction(),gateway=c.url===PUBLIC_CONFIG.url&&c.colonyId===PUBLIC_CONFIG.colonyId?PUBLIC_CONFIG.usernameAnonKey:null;
 const anonKey=publicKey(c.anonKey.startsWith('sb_publishable_')&&gateway?gateway:c.anonKey);
 if(anonKey.startsWith('sb_publishable_'))throw new Error('Password recovery requires this project’s public legacy anon gateway key. Ask the owner to update the app configuration.');
 const response=await fetch(`${c.url}/functions/v1/username-sign-in`,{method:'POST',cache:'no-store',redirect:'error',headers:{apikey:anonKey,Authorization:`Bearer ${anonKey}`,'Content-Type':'application/json'},body:JSON.stringify({action:'recover',identifier:value})});
 const result=await responseJSON(response);action.check();
 if(!response.ok)throw new Error(response.status===429?'Too many recovery requests. Wait one hour before trying again.':'Password recovery is temporarily unavailable. Try again later or contact the owner.');
 if(result?.accepted!==true)throw new Error('The recovery request was not confirmed. Try again later.');
 return {accepted:true,message:'If this account is eligible, check its registered email and spam folder for a password reset link.'};
}
export async function completePasswordRecovery(password){
 const c=configuration(),signedIn=session();if(!c||!signedIn?.passwordRecovery||!signedIn.user?.id)throw new Error('Open a valid password reset link first.');
 if(typeof password!=='string'||password.length<12||password.length>128)throw new Error('Use a password between 12 and 128 characters.');
 const action=beginAuthAction(),context=exportContext();
 const check=()=>{action.check();checkExportContext(context);if(!session()?.passwordRecovery)throw new Error('Password recovery changed. Sign in again.');};
 const email=signedIn.user.email;
 if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email))throw new Error('The reset account could not be verified. Request a new reset link.');
 if(!signedIn.passwordRecoveryUpdated){
  const token=await accessToken();check();
  let response;try{response=await fetch(`${c.url}/auth/v1/user`,{method:'PUT',cache:'no-store',redirect:'error',headers:{apikey:publicKey(c.anonKey),Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({password})});}catch{check();throw new Error('The password update was not confirmed. Check your connection before trying again.');}
  const result=await responseJSON(response);check();
  if(!response.ok||result?.id!==signedIn.user.id)throw new Error('The password update was not confirmed. Use a different password or request a new reset link.');
  // A nonsecret marker makes verification retries safe, including after reload.
  // Never store the password or send another password update for a retry.
  saveSession({...session(),passwordRecoveryUpdated:true});
 }
 try{
  // Authenticate normally with the password just entered. The recovery token
  // remains restricted until a new session and current membership both pass.
  const response=await fetch(`${c.url}/auth/v1/token?grant_type=password`,{method:'POST',cache:'no-store',redirect:'error',headers:{apikey:publicKey(c.anonKey),'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const result=await responseJSON(response);check();
  if(!response.ok||result?.user?.id!==signedIn.user.id||result.user.is_anonymous||!result.user.email_confirmed_at)throw new Error('verification');
  const next=normalizeSession(result),headers={apikey:publicKey(c.anonKey),Authorization:`Bearer ${next.access_token}`};
  const memberResponse=await fetch(`${c.url}/rest/v1/memberships?select=role,active,export_level,permissions,guest_level,guest_permissions,guest_access_starts_on,guest_access_ends_on,notes_permissions,mouse_permissions,reagents_permissions,updated_at&user_id=eq.${encodeURIComponent(signedIn.user.id)}&colony_id=eq.${encodeURIComponent(c.colonyId)}`,{headers,cache:'no-store',redirect:'error'});
  const rows=await responseJSON(memberResponse);check();
  if(!memberResponse.ok||!Array.isArray(rows))throw new Error('membership');
  let pendingSetup=false;
  if(rows.length===0){
   const profileResponse=await fetch(`${c.url}/rest/v1/rpc/get_my_lab_member`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},cache:'no-store',redirect:'error',body:JSON.stringify({p_colony_id:c.colonyId})});
   const profile=await responseJSON(profileResponse);check();pendingSetup=profileResponse.ok&&setupProfileAllowed(profile);
  }
  if(!pendingSetup&&(rows.length!==1||rows[0].active!==true||!['owner','manager','editor','viewer'].includes(rows[0].role)))throw new Error('membership');
  const member=rows[0]||{role:'pending',permissions:{},export_level:null};assertGuestAvailability(member);check();
  saveSession({...next,passwordRecovery:false,passwordRecoveryUpdated:false,role:member.role,guestLevel:member.guest_level||null,guestPermissions:member.guest_permissions||{},guestAccessStartsOn:member.guest_access_starts_on??null,guestAccessEndsOn:member.guest_access_ends_on??null,permissions:pendingSetup?{}:member.permissions||{},...appPermissionFields(member,true),setupRequired:pendingSetup,exportLevel:pendingSetup?null:member.role==='owner'?'max':member.export_level||'low'});
  pendingEmail=null;invalidate();statusMessage='Password saved and sign-in verified.';
  // Do not call global logout here: it would revoke the newly verified session.
  return {updated:true,signedIn:true,message:statusMessage};
 }catch(error){
  check();
  throw new Error('Your password was saved, but sign-in could not be verified. Re-enter the password you just saved to retry, or return to sign in and request a new reset link.');
 }
}

async function pullGuestRecords({check=()=>{},onProgress=()=>{},canCommit=()=>true}={}){
 const c=configuration(),rows=[];let offset=0;const expected=stable({level:session()?.guestLevel,permissions:session()?.guestPermissions});
 while(true){check();const page=await request('rpc/get_guest_mouse_records',{method:'POST',body:{p_colony_id:c.colonyId,p_offset:offset,p_limit:250},canCommit});check();
  if(!page||!Array.isArray(page.rows)||page.rows.length>250||stable({level:page.guest_level,permissions:page.guest_permissions})!==expected)throw new Error('Guest access changed. Reconnect before opening records.');
  for(const row of page.rows){if(row.colony_id!==c.colonyId||!MANAGED.includes(row.entity_type)||row.entity_type==='archive'||row.archived||!Number.isInteger(row.version)||row.version<1||row.payload?.[ID_FIELDS[row.entity_type]]!==row.entity_id)throw new Error('Unverified guest record projection.');rows.push(row);}
  onProgress({phase:'records',recordsLoaded:rows.length,archiveBlocksLoaded:0});if(page.next_offset===null)break;if(!Number.isInteger(page.next_offset)||page.next_offset!==offset+250)throw new Error('Invalid guest page cursor.');offset=page.next_offset;
 }
 rows.fee_visibility=await refreshFeeVisibility({canCommit});const data=await assemble(rows);check();data.guest_projection=true;
 const cacheWrite={id:crypto.randomUUID(),url:c.url,colony:c.colonyId,user:session().user.id};await local('put',data,{check,cacheWrite});check();rememberCloudCache(cacheWrite.id);remember(rows);deferredArchiveState=null;setMode('cloud');statusMessage=`Cloud ${providerSource==='cloud2'?'2':'1'} connected.`;return clone(data);
}
async function pullMemberRecords({check=()=>{},onProgress=()=>{},canCommit=()=>true}={}){
 const c=configuration(),rows=[],expected=stable(appPermissionFields(session(),true).mousePermissions);let offset=0;
 while(true){check();const page=await request('rpc/get_member_mouse_records',{method:'POST',body:{p_colony_id:c.colonyId,p_offset:offset,p_limit:250},canCommit});check();
  if(!page||!Array.isArray(page.rows)||page.rows.length>250||!validAppPermissions('mouse',page.mouse_permissions)||stable(page.mouse_permissions)!==expected)throw new Error('Application permissions changed. Reload the current records.');
  for(const row of page.rows){if(row.colony_id!==c.colonyId||!MANAGED.includes(row.entity_type)||row.archived!==false||!Number.isInteger(row.version)||row.version<1||row.payload?.[ID_FIELDS[row.entity_type]]!==row.entity_id)throw new Error('Unverified member record projection.');rows.push(row);}
  if(rows.length>MAX_BASELINE_RECORDS)throw new Error('The current record projection is too large. Contact the lab manager.');
  onProgress({phase:'records',recordsLoaded:rows.length,archiveBlocksLoaded:0});if(page.next_offset===null)break;if(!Number.isInteger(page.next_offset)||page.next_offset!==offset+250)throw new Error('Invalid member page cursor.');offset=page.next_offset;
 }
 rows.fee_visibility=await refreshFeeVisibility({canCommit});check();if(rows.fee_visibility.source_archive_allowed!==false)throw new Error('The projected record policy could not be verified. Reload shared data.');
 const data=await assemble(rows);check();data.member_projection=true;
 const cacheWrite={id:crypto.randomUUID(),url:c.url,colony:c.colonyId,user:session().user.id};onProgress({phase:'saving',recordsLoaded:rows.length,archiveBlocksLoaded:0});await local('put',data,{check,cacheWrite});check();rememberCloudCache(cacheWrite.id);remember(rows);deferredArchiveState=null;setStorage('localStorage',DEMO_KEY,null);onProgress({phase:'complete',recordsLoaded:rows.length,archiveBlocksLoaded:0});setMode('cloud');feeVisibilityContext=exportContext();statusMessage=`Cloud ${providerSource==='cloud2'?'2':'1'} connected.`;return clone(data);
}
async function saveGuestDataset(dataset,{readDependencies=[]}={}){
 await membership();if(!isGuest(session())||!guestAllows(session(),'mouse.cages.write'))throw new Error('Cage editing is not allowed for this account.');
 if(!synced||!baseline||!dataset?.guest_projection)throw new Error('Reload the current cages before saving.');
 const context=exportContext(),generation=authGeneration;const check=()=>{if(generation!==authGeneration||context!==exportContext())throw new Error('The account or guest access changed. Reload before saving.');};
 const data=normalizeDataset(dataset),incoming=await entityRecords(data),byId=new Map(incoming.map(r=>[recordKey(r),r]));check();
 for(const [key,row] of baseline)if(!byId.has(key))throw new Error('Guest edits cannot delete records.');
 const pending=incoming.filter(row=>{const old=baseline.get(recordKey(row));return !old||stable(old.payload)!==stable(row.payload)||old.archived!==row.archived;}).map(row=>({...row,expected_version:versions.get(recordKey(row))||0}));
 for(const dep of readDependencies){const key=dep?.type+':'+dep?.id;if(!pending.some(row=>recordKey(row)===key)){const row=baseline.get(key);if(!row)throw new Error('A move dependency is unavailable. Reload before saving.');pending.push({...row,expected_version:versions.get(key)});}}
 if(!pending.length)return;if(pending.length>500||utf8Size(pending)>MAX_RPC_BYTES)throw new Error('Split this cage edit into smaller changes.');
 await request('rpc/save_guest_mouse_records',{method:'POST',body:{p_colony_id:configuration().colonyId,p_changes:pending}});check();await pullFromCloud({deferHistory:true});
}
export async function setGuestAccess(payload={}){
 const {user_id,guest_level,guest_permissions={},expected_updated_at}=payload,availability=guestAvailabilityFields(payload);
 if(await membership()!=='owner')throw new Error('Only the owner can change guest access.');
 if(guest_level!==null&&!['guest1','guest2','guest3'].includes(guest_level)||validateGuestPermissions(guest_permissions).length)throw new Error('Choose a valid guest level and permissions.');
 return request(availability?'rpc/set_guest_access_window':'rpc/set_guest_access',{method:'POST',body:{p_colony_id:configuration().colonyId,p_user_id:user_id,p_guest_level:guest_level,p_guest_permissions:guest_permissions,p_expected_updated_at:expected_updated_at,...availability}});
}
export async function setPreregisteredGuestAccess(payload={}){
 const {person_id,guest_level,guest_permissions={},expected_version}=payload,availability=guestAvailabilityFields(payload);
 if(await membership()!=='owner')throw new Error('Only the owner can change guest access.');
 if(guest_level!==null&&!['guest1','guest2','guest3'].includes(guest_level)||validateGuestPermissions(guest_permissions).length)throw new Error('Choose a valid guest level and permissions.');
 return request(availability?'rpc/set_preregistered_guest_access_window':'rpc/set_preregistered_guest_access',{method:'POST',body:{p_colony_id:configuration().colonyId,p_person_id:person_id,p_guest_level:guest_level,p_guest_permissions:guest_permissions,p_expected_version:expected_version,...availability}});
}
