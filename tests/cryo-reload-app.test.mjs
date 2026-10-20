import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {appAllows,mouseAppFeature} from '../mouse-data/app-access.js';
import {isGuest,guestAllows} from '../mouse-data/guest-access.js';
import {cloudIndicatorHTML} from '../mouse-data/cloud-status.js';
import {managedViewNeeds} from '../mouse-data/managed-view.js';
import {normalizeManagerPermissions,visibleRoleLabel} from '../mouse-data/permissions.js';

const source=await readFile(new URL('../mouse-data/app.js',import.meta.url),'utf8');
function between(start,end){const first=source.indexOf(start),last=source.indexOf(end,first);assert(first>=0&&last>first,`Missing app boundary: ${start}`);return source.slice(first,last);}
function fixture(){
 const elements={main:{innerHTML:'Original cryopreservation form'},'sidebar-account':{innerHTML:'',hidden:false}},calls=[],status={url:'https://example.invalid',colonyId:'synthetic-colony',email:'owner@example.invalid',signedIn:true,passwordRecovery:false,mode:'cloud',role:'owner',readyForEdits:true,permissions:{}};
 const original={tables:{husbandry_events:[]},source_archive_deferred:{loaded_tables:['historical_observations'],tables:{historical_observations:1,unloaded_history:1}}};
 const state={moduleBusy:false,cageDraft:false,cryoDraft:{label:'Keep entered label',notes:'Keep entered notes'},original,shared:{tables:{husbandry_events:[]},source_archive_deferred:{loaded_tables:[],tables:{historical_observations:1,unloaded_history:1}}},confirm:true};
 const context=vm.createContext({JSON,Object,String,Boolean,Error,normalizeManagerPermissions,visibleRoleLabel,appAllows,mouseAppFeature,isGuest,guestAllows,cloudIndicatorHTML,managedViewNeeds,navigator:{onLine:true},
  $:id=>elements[id],esc:value=>String(value??''),state,calls,status,
  hasStrainDrafts:()=>false,hasExperimentDrafts:()=>false,hasCageSheetDrafts:()=>state.cageDraft,hasCryopreservationDraft:()=>Boolean(state.cryoDraft),isCryopreservationBusy:()=>state.moduleBusy,
  sidebarIdentityContext:status=>JSON.stringify([status.email,status.signedIn]),
  labUserDirectoryContext:status=>JSON.stringify([status.email,status.signedIn,status.role,status.permissions]),
  store:{ensureManagedTables:async(data,options)=>{calls.push({managed:options});return data;},getCloudStatus:()=>({...status}),pullFromCloud:async options=>{calls.push({pull:options});await state.onPull?.();if(state.pullError)throw state.pullError;return state.shared;},ensureHistory:async(data,options)=>{calls.push({history:options});await state.onHistory?.();if(state.historyError)throw state.historyError;return {...data,source_archive_deferred:{...data.source_archive_deferred,loaded_tables:['historical_observations']}};}},
  refreshCloud:async()=>{calls.push({refresh:true});vm.runInContext('cloud=store.getCloudStatus()',context);},
  renderStartupLoading:()=>{elements.main.innerHTML='Loading shared records';calls.push({loading:true});},
  startupProgress:()=>{},showToast:(message,error)=>calls.push({message,error}),confirmAction:async()=>{calls.push({confirm:true});return state.confirm;},
  render:()=>{calls.push({render:true});elements.main.innerHTML=state.cryoDraft?'Retained draft: '+state.cryoDraft.notes:'Latest view';},
  navigate:view=>{calls.push({navigate:view});vm.runInContext(`route=${JSON.stringify(view)}`,context);},
  renderCryopreservation:(_container,_dataset,hooks)=>{state.cryoHooks=hooks;},model:{validateRecord:()=>({errors:[],warnings:[]})},historyDraftOpen:()=>Boolean(state.cryoDraft),
  loadHistoryTables:async tables=>{calls.push({sourceTables:tables});if(state.historyError)throw state.historyError;vm.runInContext('dataset=state.shared',context);return state.shared;},
  loadCryoHistory:async()=>{calls.push({sourceIndex:true});if(state.indexError)throw state.indexError;return state.index??null;},
 });
 vm.runInContext('let dataset=state.original,route="cryo",detail={type:"cryo",id:"source-case"},cloud={...status},cloudReady=true,manualPullPending=false,startupLoading=false,cachedPreview=false,editor=null,busy=false,historyLoadState=null,managedLoadState=null,managedLoadFailure=null,cloudLoadError="",startupProgressValue=null,startupMessage="",brainbotReviewPending=false,sidebarProfile=null,sidebarProfileContext="",cryoLinkFocus=null,cryoRenderToken=0,cryoHistoryContext="",cryoHistoryIndex=null,cryoHistoryDataset=null;const historyViewKey=()=>JSON.stringify([route,detail?.type,detail?.id]);',context);
 vm.runInContext(between('const deferredHistoryTables=','const historyViewKey='),context);
 vm.runInContext(between('function canEditRecords(','function canArchiveRecords('),context);
 vm.runInContext(between('function renderSidebarAccount(','function adoptSidebarProfile('),context);
 vm.runInContext(between('async function loadSharedColony(','async function renderPlanner('),context);
 vm.runInContext(between('function cryoSourceContext(){','async function loadCryoHistory(){'),context);
 vm.runInContext(between('function renderCryo(){','function renderExperimentSection('),context);
 const run=code=>vm.runInContext(code,context);
 return {elements,calls,status,state,run,reload:options=>run(`loadSharedColony(${JSON.stringify(options??{})})`)};
}

test('sidebar replaces logout with an accessible circular Reload button and retains the connection dot',()=>{
 const f=fixture();f.run('renderSidebarAccount()');const html=f.elements['sidebar-account'].innerHTML;
 assert.match(html,/class="sidebar-reload"[^>]*data-action="reload-shared"[^>]*aria-label="Reload shared data"/);assert.match(html,/<svg[^>]*>[\s\S]*?<path/);assert.match(html,/connection-dot cloud/);assert.doesNotMatch(html,/sign-out|Sign out|sidebar-sign-out/);
 for(const flag of ['manualPullPending','startupLoading','cachedPreview']){f.run(`${flag}=true;renderSidebarAccount()`);assert.match(f.elements['sidebar-account'].innerHTML,/title="Reload shared data" disabled/);f.run(`${flag}=false`);}
 f.run('cloud.signedIn=false;renderSidebarAccount()');assert.equal(f.elements['sidebar-account'].hidden,true);assert.equal(f.elements['sidebar-account'].innerHTML,'');
 assert.match(source,/button\('Sign out','sign-out'\)/);
});

test('cryo editing requires owner or an authorized manager, including when a previously opened save is invoked',async()=>{
 const f=fixture();
 for(const [role,permissions,expected] of [['owner',{},true],['manager',{},true],['manager',{cryo:false},false],['editor',{},false],['viewer',{},false],['pending',{},false]]){f.status.role=role;f.status.permissions=permissions;f.run('cloud=store.getCloudStatus()');assert.equal(f.run('canEditCryopreservation()'),expected,role);}
 f.status.role='owner';f.run('cloud=store.getCloudStatus();renderCryo()');const hooks=f.state.cryoHooks;assert.equal(hooks.canEdit(),true);
 f.run('cloud.role="editor"');await assert.rejects(hooks.save({tables:{}}),/Manager or owner access is required/);
 for(const flag of ['startupLoading','brainbotReviewPending','historyLoadState']){f.run(`cloud.role="owner";${flag}=true`);assert.equal(f.run('canEditCryopreservation()'),false,flag);f.run(`${flag}=false`);}
});

test('shared reload retains cryo route and entered draft without loading unrelated source history',async()=>{
 const f=fixture(),draft=f.state.cryoDraft;await f.reload({preserveView:true,confirm:false,throwOnError:true});
 assert.equal(f.state.cryoDraft,draft);assert.match(f.elements.main.innerHTML,/Keep entered notes/);assert.equal(f.run('route'),'cryo');assert.equal(f.run('detail.id'),'source-case');assert.equal(f.run('cloudReady'),true);assert.equal(f.run('startupLoading'),false);assert.equal(f.run('manualPullPending'),false);
 assert.equal(f.calls.filter(call=>call.pull).length,1);assert.equal(f.calls.find(call=>call.pull).pull.deferHistory,true);assert(!f.calls.some(call=>call.history||call.sourceTables||call.sourceIndex));assert.equal(f.run('dataset.source_archive_deferred.loaded_tables.includes("historical_observations")'),false);
 const scoped=f.calls.find(call=>call.managed)?.managed;assert(scoped);assert(!scoped.tables.includes('husbandry_events'));assert(scoped.eventTypes.includes('cryopreservation_lot'));assert(scoped.eventTypes.includes('cryopreservation_event'));assert.equal(f.calls.find(call=>call.pull).pull.currentOnly,true);
 assert(!f.calls.some(call=>call.confirm||call.navigate));assert(f.calls.some(call=>call.message==='Shared data reloaded.'));
});

test('a failed shared pull keeps the existing draft and supports retry',async()=>{
 const f=fixture(),draft=f.state.cryoDraft;f.state.pullError=new Error('Synthetic pull unavailable');
 await assert.rejects(f.reload({preserveView:true,confirm:false,throwOnError:true}),/unavailable/);
 assert.equal(f.state.cryoDraft,draft);assert.equal(f.run('dataset===state.original'),true);assert.match(f.elements.main.innerHTML,/Keep entered notes/);assert.equal(f.run('route'),'cryo');assert.equal(f.run('cloudReady'),false);assert.equal(f.run('startupLoading'),false);assert.equal(f.run('manualPullPending'),false);assert(!f.calls.some(call=>call.navigate||call.message==='Shared data reloaded.'));
 f.state.pullError=null;await f.reload({preserveView:true,confirm:false,throwOnError:true});assert.equal(f.run('cloudReady'),true);assert.equal(f.state.cryoDraft,draft);assert(!f.calls.some(call=>call.history));
});

test('cryo loads the verified compact register before considering general historical observations',async()=>{
 const f=fixture();f.state.cryoDraft=null;f.state.index={format:'braintime-cryo-register'};f.run('dataset=state.shared;renderCryo()');await f.state.cryoHooks.loadHistory();
 assert.deepEqual(f.calls.filter(call=>call.sourceIndex||call.sourceTables),[{sourceIndex:true}]);assert.equal(f.state.cryoHooks.historyIndex,f.state.index);assert.equal(f.state.cryoHooks.historyDeferred,false);assert.equal(f.run('dataset.source_archive_deferred.loaded_tables.includes("historical_observations")'),false);
 const fallback=fixture();fallback.state.cryoDraft=null;fallback.run('dataset=state.shared;renderCryo()');await fallback.state.cryoHooks.loadHistory();
 assert.deepEqual(JSON.parse(JSON.stringify(fallback.calls.filter(call=>call.sourceIndex||call.sourceTables))),[{sourceIndex:true},{sourceTables:['historical_observations']}]);assert.equal(fallback.state.cryoHooks.historyDeferred,false);
});

test('a verified compact register is scoped to the current dataset and reloaded after replacement',()=>{
 const f=fixture();f.state.index={format:'braintime-cryo-register'};f.run('dataset=state.shared;cryoHistoryContext=cryoSourceContext();cryoHistoryDataset=dataset;cryoHistoryIndex=state.index;renderCryo()');
 assert.equal(f.state.cryoHooks.historyIndex,f.state.index);assert.equal(f.state.cryoHooks.historyDeferred,false);assert(!f.calls.some(call=>call.sourceIndex||call.sourceTables||call.history));
 f.run('dataset={...state.shared};renderCryo()');assert.equal(f.state.cryoHooks.historyIndex,null);assert(!f.calls.some(call=>call.sourceIndex||call.sourceTables||call.history),'replacement invalidates the register without eagerly loading source data');
});

test('reload rejects other open record or cage drafts and concurrent history/module operations',async()=>{
 for(const expression of ['editor={}','busy=true','state.cageDraft=true','historyLoadState={}','managedLoadState={}']){
  const f=fixture();f.run(expression);await assert.rejects(f.reload({preserveView:true,confirm:false}),/Save|Wait|history|loading/i);assert(!f.calls.some(call=>call.pull));assert.equal(f.run('dataset===state.original'),true);
 }
 for(const route of ['cryo','mice']){const f=fixture();f.run(`state.moduleBusy=true;route=${JSON.stringify(route)}`);await assert.rejects(f.reload({preserveView:true,confirm:false}),/Wait|save/i);assert(!f.calls.some(call=>call.pull));}
 const f=fixture();f.state.moduleBusy=true;await f.reload({preserveView:true,confirm:false,fromCryoEditor:true,throwOnError:true});assert.equal(f.calls.filter(call=>call.pull).length,1);
});

test('concurrent reload clicks do not start duplicate pulls or clear the held draft',async()=>{
 const f=fixture();let entered,release;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);f.state.onPull=async()=>{entered();await gate;};
 const pending=f.reload({preserveView:true,confirm:false});await ready;await f.reload({preserveView:true,confirm:false});assert.equal(f.calls.filter(call=>call.pull).length,1);assert.equal(f.run('manualPullPending'),true);assert.equal(f.state.cryoDraft.notes,'Keep entered notes');release();await pending;assert.equal(f.run('manualPullPending'),false);
});

test('account changes during reload cannot reopen the old account dataset or cryo view',async()=>{
 const f=fixture();f.state.onPull=async()=>{f.status.email='different@example.invalid';};await assert.rejects(f.reload({preserveView:true,confirm:false,throwOnError:true}),/Account changed|Access changed/);
 assert.equal(f.run('dataset'),null);assert.equal(f.run('cloudReady'),false);assert.equal(f.run('route'),'settings');assert(!f.calls.some(call=>call.render||call.history));assert(f.calls.some(call=>call.navigate==='settings'));assert.equal(f.run('startupLoading'),false);
});

test('sidebar Reload dispatch preserves the current view without confirmation',async()=>{
 const f=fixture(),dispatch=between("if(name==='reload-shared')","if(name==='cloud-push')");
 f.run('async function dispatchReload(name){'+dispatch+'}');await f.run('dispatchReload("reload-shared")');assert.equal(f.run('route'),'cryo');assert(!f.calls.some(call=>call.confirm||call.navigate));assert.equal(f.calls.filter(call=>call.pull).length,1);
});
