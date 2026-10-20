import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStartupReadLifecycle} from '../mouse-data/startup-read.js';

const app=await readFile(new URL('../mouse-data/app.js',import.meta.url),'utf8');
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function lifecycleFixture(){
 const calls=[],env={visible:true,online:true};let resumes=0;
 const reads=createStartupReadLifecycle({cancel:signal=>calls.push(signal),isVisible:()=>env.visible,isOnline:()=>env.online,onResume:()=>{resumes++;reads.begin();}});
 return {reads,calls,env,get resumes(){return resumes;}};
}
test('a suspended opening read aborts its exact signal and resumes only once on return',()=>{
 const h=lifecycleFixture(),old=h.reads.begin();h.env.visible=false;assert(h.reads.pause());assert(old.signal.aborted);assert(!old.isCurrent());assert.equal(h.calls[0],old.signal);
 assert(!h.reads.pause());assert(!h.reads.resume());h.env.visible=true;assert(h.reads.resume());assert(!h.reads.resume());assert.equal(h.resumes,1);
});
test('an offline or completed opening read does not start an unrelated request',()=>{
 const h=lifecycleFixture(),done=h.reads.begin();done.finish();assert(!h.reads.pause());assert(!h.reads.resume());
 h.reads.begin();h.reads.pause();h.env.online=false;assert(!h.reads.resume());h.env.online=true;assert(h.reads.resume());
});
test('reset and replacement fence a prior read without resuming after sign-out',()=>{
 const h=lifecycleFixture(),one=h.reads.begin(),two=h.reads.begin();assert(one.signal.aborted);assert(!one.isCurrent());assert(two.isCurrent());h.reads.pause();h.reads.reset();assert(!h.reads.resume());
});
function openingFixture({saved=true,mode='cloud',online=true}={}){
 const pending=[],calls=[],cache={tables:{cages:[{cage_sid:'cached'}]}};
 const status={configured:true,mode,signedIn:mode==='cloud',passwordRecovery:false,role:mode==='cloud'?'editor':null,url:'cloud',colonyId:'colony',email:'member@example.test',readyForEdits:false};
 const nodes=new Map();
 const env={createStartupReadLifecycle,cageSheetContext:state=>JSON.stringify([state.email,state.role]),startupRequest:0,startupPreparing:false,startupPreparationOwner:0,cachedPreview:false,dataset:null,cloud:{...status},cloudLoadError:'',managedLoadFailure:null,startupLoading:false,startupProgressValue:null,startupMessage:'',cloudReady:false,passwordSetupRequired:false,route:'cages',detail:null,document:{hidden:false},navigator:{onLine:online},PUBLIC_CONFIG:{},location:{hash:'#cages'},titles:{cages:'Cages',settings:'Settings'},entity:{cages:{}},$:id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',disabled:false});return nodes.get(id);},esc:String,button:label=>label,backupViewerLinkHTML:()=>'',navigation(){calls.push('navigation');},renderStartupLoading(){calls.push('loading');},renderConnection(){calls.push('connection');},render(){calls.push('render');},refreshSettingsConnection:()=>false,canExportMouseData:()=>false,renderSettingsMetadata(){calls.push('metadata');},queueSidebarProfile(){},queueLabUserDirectory(){},queueShellCache(){calls.push('shell');},showToast(message){calls.push(message);},startupProgress(value){calls.push(value);},refreshCloud:async()=>{env.cloud={...status};},store:{getCloudStatus:()=>({...status}),consumeAuthCallback:async()=>null,loadStartupCache:async options=>{calls.push(['cache',options.signal]);return saved?cache:null;},loadDataset:async()=>cache,pullFromCloud:options=>new Promise((resolve,reject)=>pending.push({options,resolve,reject})),cancelStartupRead({signal}){calls.push(['cancel',signal]);}}};
 const start=app.indexOf('const startupReads=createStartupReadLifecycle('),end=app.indexOf('\nlet shellCacheScheduled=false;',start);
 new Function('env',`with(env){${app.slice(start,end)};env.start=start;env.reads=startupReads;}`)(env);
 return {env,pending,calls,cache,status};
}
test('late pre-suspension payload and progress cannot replace the saved read-only preview',async()=>{
 const h=openingFixture(),run=h.env.start();await settle();assert.equal(h.pending.length,1);assert.equal(h.env.dataset,h.cache);assert(h.env.cachedPreview);assert(!h.env.cloudReady);
 const old=h.pending[0];h.env.document.hidden=true;h.env.reads.pause();assert(old.options.signal.aborted);assert.equal(h.env.dataset,h.cache);
 const count=h.calls.length;old.options.onProgress({phase:'records',recordsLoaded:99});assert.equal(h.calls.length,count);
 old.resolve({tables:{cages:[{cage_sid:'stale'}]}});await run;assert.equal(h.env.dataset,h.cache);assert(h.env.cachedPreview);assert(!h.env.cloudReady);
 h.env.document.hidden=false;assert(h.env.reads.resume());await settle();assert.equal(h.pending.length,2);assert(!h.pending[1].options.signal.aborted);
 const fresh={tables:{cages:[{cage_sid:'fresh'}]}};h.status.readyForEdits=true;h.pending[1].resolve(fresh);await settle();assert.equal(h.env.dataset,fresh);assert(h.env.cloudReady);assert(!h.env.cachedPreview);assert(!h.env.startupLoading);
 assert(!h.calls.some(call=>Array.isArray(call)&&['save','push','write'].includes(call[0])));
});
test('a phone returning before the cache read finishes cannot publish that old cache',async()=>{
 const h=openingFixture();let resolveCache;h.env.store.loadStartupCache=()=>new Promise(resolve=>{resolveCache=resolve;});
 const run=h.env.start();await settle();h.env.document.hidden=true;h.env.reads.pause();resolveCache(h.cache);await run;assert.equal(h.env.dataset,null);assert.equal(h.pending.length,0);assert(!h.env.cloudReady);
});
test('returning with changed account rights removes the old preview before the next read',async()=>{
 const h=openingFixture(),run=h.env.start();await settle();h.env.document.hidden=true;h.env.reads.pause();h.pending[0].resolve({tables:{}});await run;
 let resolveCache;h.env.store.loadStartupCache=()=>new Promise(resolve=>{resolveCache=resolve;});h.status.role='viewer';h.env.document.hidden=false;h.env.reads.resume();await settle();assert.equal(h.env.dataset,null);assert(!h.env.cachedPreview);assert(h.env.startupLoading);
 resolveCache(null);await settle();assert.equal(h.pending.length,2);h.status.readyForEdits=true;h.pending[1].resolve({tables:{cages:[]}});await settle();
});
test('Retry during a one-time authentication callback does not supersede or replay sign-in',async()=>{
 const h=openingFixture();h.status.signedIn=false;h.status.role='pending';let callbacks=0,finishAuth;
 h.env.store.consumeAuthCallback=()=>{callbacks++;return new Promise(resolve=>{finishAuth=()=>{h.status.signedIn=true;h.status.role='editor';resolve({needsPasswordSetup:false});};});};
 const run=h.env.start();await settle();assert(h.env.startupPreparing);const request=h.env.startupRequest;
 // Calls through the Retry action and direct foreground/start dispatch are
 // both coalesced while the sign-in URL is being consumed.
 const actionStart=app.indexOf("if(name==='retry-startup')"),actionEnd=app.indexOf("if(startupLoading&&name!=='settings')",actionStart);
 const retry=new Function('env',`with(env){return async function(){${app.slice(actionStart,actionEnd)}};}`)({...h.env,name:'retry-startup',manualPullPending:false,busy:false,historyLoadState:null,managedLoadState:null,historyDraftOpen:()=>false,start:h.env.start});
 await retry();await h.env.start();assert.equal(callbacks,1);assert.equal(h.env.startupRequest,request);assert(h.env.startupPreparing);
 finishAuth();await settle();assert(!h.env.startupPreparing);assert.equal(h.pending.length,1);assert.equal(callbacks,1);
 h.status.readyForEdits=true;const fresh={tables:{cages:[{cage_sid:'signed-in'}]}};h.pending[0].resolve(fresh);await run;assert(h.env.cloud.signedIn);assert(h.env.cloudReady);assert.equal(h.env.dataset,fresh);assert.equal(h.env.startupRequest,request);
});
test('a replaced read cannot clear a newer authentication preparation guard',async()=>{
 const h=openingFixture(),first=h.env.start();await settle();let finishAuth;h.env.store.consumeAuthCallback=()=>new Promise(resolve=>{finishAuth=()=>resolve(null);});
 const second=h.env.start();await settle();assert(h.env.startupPreparing);assert(h.pending[0].options.signal.aborted);h.pending[0].resolve({tables:{cages:[]}});await first;assert(h.env.startupPreparing);
 finishAuth();await settle();assert(!h.env.startupPreparing);assert.equal(h.pending.length,2);h.status.readyForEdits=true;h.pending[1].resolve(h.cache);await second;assert(h.env.cloudReady);
});
test('ordinary local workspaces still open without an internet connection',async()=>{
 const h=openingFixture({mode:'local',online:false});await h.env.start();assert.equal(h.env.dataset,h.cache);assert.equal(h.pending.length,0);assert(!h.env.startupLoading);
});
test('all lifecycle retries call only the opening read and leave confirmed-write recovery separate',()=>{
 assert.match(app,/cancel:signal=>store\.cancelStartupRead\?\.\(\{signal\}\)/);
 assert.match(app,/currentOnly:true,signal:opening\?\.signal/);
 assert.match(app,/onProgress:progress,deferHistory:true,currentOnly:true,signal:opening\?\.signal/);
 assert.match(app,/window\.addEventListener\('pagehide',\(\)=>\{startupReads\.pause\(\)/);
 const restart=app.slice(app.indexOf("if(name==='retry-startup')"),app.indexOf("if(startupLoading&&name!=='settings')"));
 assert.match(restart,/manualPullPending\|\|busy\|\|historyLoadState\|\|managedLoadState\|\|historyDraftOpen\(\)/);
 assert.doesNotMatch(restart,/retryCloudOperation|pushToCloud|saveDataset/);
});
