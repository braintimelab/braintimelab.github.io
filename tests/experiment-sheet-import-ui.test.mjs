import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderExperimentSheetImport} from '../mouse-data/experiment-sheet-import.js';
const ready={configured:true,enabled:true,source_url:'https://docs.google.com/spreadsheets/d/SYNTHETIC/edit',conflict_count:0};
async function harness(overrides={}){
 const container={innerHTML:'',isConnected:true},state={status:ready,starts:0,loads:0,allowed:true,current:true};
 const cleanup=await renderExperimentSheetImport(container,{canImport:()=>state.allowed,isCurrent:()=>state.current,getStatus:async()=>state.status,start:async()=>{state.starts++;state.status={...ready,job:{job_id:'J',status:'queued'}};return state.status.job;},getConflicts:async()=>({conflicts:[],total:0}),onComplete:async()=>state.loads++,...overrides});
 return {container,state,cleanup,click:async action=>container.onclick?.({preventDefault(){},target:{closest:()=>({dataset:{experimentImport:action}})}})};
}
test('opening checks status without starting; unconfigured and inactive imports stay disabled',async()=>{
 for(const status of [ready,{...ready,configured:false},{...ready,enabled:false}]){const h=await harness({getStatus:async()=>status});try{assert.equal(h.state.starts,0);assert.match(h.container.innerHTML,/Open Experiment Sheet/);assert.doesNotMatch(h.container.innerHTML,/Animal|Daily|02:00/);await h.click('start');assert.equal(h.state.starts,status.configured&&status.enabled?1:0);}finally{h.cleanup();}}
});
test('permission revocation blocks crafted actions, and source links require exact Google Sheets HTTPS origin',async()=>{
 for(const url of ['https://docs.google.com.evil.invalid/spreadsheets/d/X','http://docs.google.com/spreadsheets/d/X','https://docs.google.com:444/spreadsheets/d/X','javascript:alert(1)']){const h=await harness({getStatus:async()=>({...ready,source_url:url})});try{assert.doesNotMatch(h.container.innerHTML,/Open Experiment Sheet/);h.state.allowed=false;await h.click('start');await h.click('conflicts');assert.equal(h.state.starts,0);}finally{h.cleanup();}}
});
test('a completed watched job refreshes current data only once and does not start another import',async()=>{
 const h=await harness();try{await h.click('start');assert.equal(h.state.starts,1);h.state.status={...ready,job:{job_id:'J',status:'completed',summary:{inserted_count:3,updated_count:2}}};await h.click('refresh');await h.click('refresh');assert.equal(h.state.loads,1);assert.equal(h.state.starts,1);assert.match(h.container.innerHTML,/Added 3 · Updated 2/);}finally{h.cleanup();}
});
test('an old completed job does not silently refresh on opening, while a pending job can resume',async()=>{
 const h=await harness({getStatus:async()=>({...ready,job:{job_id:'old',status:'completed'}})});try{assert.equal(h.state.loads,0);assert.equal(h.state.starts,0);}finally{h.cleanup();}
});
test('failed current-data refresh retains the job and can retry without another import',async()=>{
 let loads=0;const h=await harness({onComplete:async()=>{loads++;if(loads===1)throw Error('Connection interrupted');}});try{await h.click('start');h.state.status={...ready,job:{job_id:'J',status:'conflicts'}};await h.click('refresh');assert.match(h.container.innerHTML,/Connection interrupted/);await h.click('refresh');assert.equal(loads,2);assert.equal(h.state.starts,1);assert.doesNotMatch(h.container.innerHTML,/Connection interrupted/);}finally{h.cleanup();}
});
test('conflicts render concise escaped fields without raw records or debug JSON',async()=>{
 const h=await harness({getStatus:async()=>({...ready,conflict_count:1}),getConflicts:async()=>({total:1,source_details_withheld:true,conflicts:[{entity_id:'EXP-1',reason:'<script>changed</script>',changed_fields:['operator','event_date'],before_record:{secret:'DO_NOT_RENDER'},raw_values:{private:'DO_NOT_RENDER'}}]})});try{await h.click('conflicts');assert.match(h.container.innerHTML,/EXP-1/);assert.match(h.container.innerHTML,/operator, event_date/);assert.match(h.container.innerHTML,/Source details are restricted/);assert.match(h.container.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(h.container.innerHTML,/<script>|DO_NOT_RENDER|<pre|before_record|raw_values/);}finally{h.cleanup();}
});
test('actual import summary and preserved-record conflicts use compact readable labels',async()=>{
 const h=await harness({getStatus:async()=>({...ready,conflict_count:1,job:{job_id:'done',status:'conflicts',summary:{observations_added:4,drafts_created:3,manual_records_preserved:1,archive_blocks_added:2}}}),getConflicts:async()=>({total:1,conflicts:[{event_id:'EXP-1',code:'managed_source_preserved'}]})});try{assert.match(h.container.innerHTML,/Sources added 4 · Drafts 3 · Existing records kept 1/);await h.click('conflicts');assert.match(h.container.innerHTML,/Existing experiment kept/);assert.doesNotMatch(h.container.innerHTML,/managed_source_preserved|archive_blocks_added/);}finally{h.cleanup();}
});
test('worker summaries avoid duplicate addition counts and changed-cell links point to the configured sheet',async()=>{
 const h=await harness({getStatus:async()=>({...ready,conflict_count:1,job:{job_id:'done',status:'conflicts',summary:{observations_read:15,observations_added:4,source_additions:4,drafts_created:3}}}),getConflicts:async()=>({total:1,conflicts:[{entity_id:'EXP-1',reason:'source_cell_changed',sheet_id:123,range:'A2:F2'}]})});try{assert.equal((h.container.innerHTML.match(/Sources added 4/g)||[]).length,1);assert.match(h.container.innerHTML,/Read 15/);await h.click('conflicts');assert.match(h.container.innerHTML,/Source cell changed; review the earlier record/);assert.match(h.container.innerHTML,/https:\/\/docs.google.com\/spreadsheets\/d\/SYNTHETIC\/edit#gid=123&amp;range=A2%3AF2/);assert.doesNotMatch(h.container.innerHTML,/source_cell_changed/);}finally{h.cleanup();}
});
test('withheld source details never produce a derived cell link',async()=>{
 const h=await harness({getStatus:async()=>({...ready,conflict_count:1}),getConflicts:async()=>({total:1,source_details_withheld:true,conflicts:[{entity_id:'EXP-1',reason:'source_cell_changed',source_url:'https://docs.google.com/spreadsheets/d/OTHER/edit',sheet_id:123,range:'A2:F2'}]})});try{await h.click('conflicts');assert.doesNotMatch(h.container.innerHTML,/>Sheet<|\/OTHER\/|#gid=/);}finally{h.cleanup();}
});
test('worker error codes use plain messages and unknown internal codes never appear',async()=>{
 for(const code of ['too_many_source_changes','source_plan_too_large','source_row_too_large','database_response_invalid','not_configured','INTERNAL_DEBUG_CODE']){const h=await harness({getStatus:async()=>({...ready,job:{job_id:'failed',status:'failed',error:code}})});try{assert.doesNotMatch(h.container.innerHTML,new RegExp(code));assert.match(h.container.innerHTML,/class="alert error"/);}finally{h.cleanup();}}
});
test('overlapping refreshes share one request and block a concurrent import',async()=>{
 let hold=false,release,calls=0;const h=await harness({getStatus:async()=>{calls++;if(hold)await new Promise(resolve=>release=resolve);return ready;}});try{hold=true;const one=h.click('refresh'),two=h.click('refresh');await h.click('start');assert.equal(calls,2);assert.equal(h.state.starts,0);release();await Promise.all([one,two]);}finally{h.cleanup();}
});
test('closed or changed-account dialogs ignore late status responses and cannot load current data',async()=>{
 for(const close of [true,false]){let hold=false,release;const h=await harness({getStatus:async()=>{if(hold)await new Promise(resolve=>release=resolve);return {...ready,job:{job_id:'J',status:'completed'}};}});hold=true;const pending=h.click('refresh'),html=h.container.innerHTML;if(close)h.cleanup();else h.state.current=false;release();await pending;assert.equal(h.state.loads,0);assert.equal(h.container.innerHTML,html);h.cleanup();}
});
test('polling checks only queued jobs every four seconds and stops after two minutes or disposal',async()=>{
 const previous={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,now:Date.now};let now=1000,id=0;const timers=new Map();
 globalThis.setTimeout=(run,delay)=>{const key=++id;timers.set(key,{run,delay});return key;};globalThis.clearTimeout=key=>timers.delete(key);Date.now=()=>now;
 try{let checks=0;const h=await harness({getStatus:async()=>{checks++;return {...ready,job:{job_id:'Q',status:'queued'}};}});try{assert.equal(checks,1);assert.equal(timers.size,1);const [key,timer]=[...timers][0];assert.equal(timer.delay,4000);timers.delete(key);now+=120000;await timer.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(checks,2);assert.equal(timers.size,0);assert.match(h.container.innerHTML,/Still pending/);assert.equal(h.state.starts,0);await h.click('refresh');assert.equal(timers.size,1);}finally{h.cleanup();assert.equal(timers.size,0);}}finally{globalThis.setTimeout=previous.setTimeout;globalThis.clearTimeout=previous.clearTimeout;Date.now=previous.now;}
});
test('stale queued or running imports permit an explicit retry at fifteen minutes, without an automatic run',async()=>{
 const realNow=Date.now;Date.now=()=>Date.parse('2026-10-18T03:00:00Z');
 try{for(const job of [{job_id:'old',status:'queued',queued_at:'2026-10-18T02:45:00Z'},{job_id:'old',status:'running',queued_at:'2026-10-18T02:00:00Z',started_at:'2026-10-18T02:45:00Z'}]){
  const h=await harness({getStatus:async()=>({...ready,job})});try{assert.equal(h.state.starts,0);assert.match(h.container.innerHTML,/Retry import/);assert.match(h.container.innerHTML,/15 minutes/);await h.click('start');assert.equal(h.state.starts,1);}finally{h.cleanup();}
 }}finally{Date.now=realNow;}
});
test('unknown, future and recently started jobs stay blocked, and expired jobs still require import access',async()=>{
 const realNow=Date.now;Date.now=()=>Date.parse('2026-10-18T03:00:00Z');
 try{
  for(const timing of [{},{queued_at:'invalid'},{queued_at:'2026-10-18T03:01:00Z'},{queued_at:'2026-10-18T02:45:01Z'},{queued_at:'2026-10-18T02:00:00Z',started_at:'2026-10-18T02:59:00Z'},{queued_at:'2026-10-18T02:00:00Z',started_at:'invalid'}]){
   const h=await harness({getStatus:async()=>({...ready,job:{job_id:'old',status:'running',...timing}})});try{await h.click('start');assert.equal(h.state.starts,0);assert.match(h.container.innerHTML,/Import in progress/);}finally{h.cleanup();}
  }
  const h=await harness({getStatus:async()=>({...ready,job:{job_id:'old',status:'queued',queued_at:'2026-10-18T02:00:00Z'}})});try{h.state.allowed=false;await h.click('start');assert.equal(h.state.starts,0);}finally{h.cleanup();}
 }finally{Date.now=realNow;}
});
test('application wiring guards drafts and permissions and refreshes current records without full archive loading',async()=>{
 const app=await readFile(new URL('../mouse-data/app.js',import.meta.url),'utf8'),start=app.indexOf('async function openExperimentSheetImport()'),end=app.indexOf('function canImportAnimalsSheet()',start),dialog=app.slice(start,end);
 assert.match(app,/function canImportExperimentSheet\(\).*canEditRecords\('imports'\).*canEditRecords\('experiments'\).*canWriteCloud\(\)/);
 assert.match(dialog,/historyDraftOpen\(\)/);assert.match(dialog,/route==='experiments'/);assert.match(dialog,/labUserDirectoryContext\(store.getCloudStatus\(\)\)/);assert.match(dialog,/dataset!==snapshot/);assert.match(dialog,/pullFromCloud\(\{deferHistory:true,currentOnly:true\}\)/);assert.match(dialog,/resetExperimentSourceView/);assert.doesNotMatch(dialog,/getAnimalSheet|startAnimalSheet|loadSourceHistory|loadHistoryTables/);
});
test('queued, running and rolled-back imports describe proposals rather than committed source or draft writes',async()=>{
 for(const status of ['queued','running','failed']){const h=await harness({getStatus:async()=>({...ready,job:{job_id:'staged',status,error:status==='failed'?'commit_failed':null,summary:{source_additions:396,drafts_created:0,observations_read:15672,inserted_count:2,updated_count:1}}})});try{assert.match(h.container.innerHTML,/Source changes 396 · Draft candidates 0/);assert.match(h.container.innerHTML,/Read 15,672/);assert.match(h.container.innerHTML,/Proposed additions 2 · Proposed updates 1/);assert.doesNotMatch(h.container.innerHTML,/Sources added| · Drafts | · Added | · Updated /);assert.equal(h.state.loads,0);assert.equal(h.state.starts,0);}finally{h.cleanup();}}
 for(const status of ['completed','conflicts']){const h=await harness({getStatus:async()=>({...ready,job:{job_id:'committed',status,summary:{observations_added:396,drafts_created:2}}})});try{assert.match(h.container.innerHTML,/Sources added 396 · Drafts 2/);assert.doesNotMatch(h.container.innerHTML,/Source changes|Draft candidates/);}finally{h.cleanup();}}
});
