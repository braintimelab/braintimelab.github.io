import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAnimalSheetImport,refreshAnimalSheetImportAccess} from '../mouse-data/animal-sheet-import.js';
async function harness(status,can=true,overrides={}){const container={innerHTML:'',isConnected:true};let started=0;const cleanup=await renderAnimalSheetImport(container,{canImport:()=>can,getStatus:async()=>status,start:async()=>{started++;return {job_id:'J',status:'completed'}},...overrides});return {container,cleanup,get started(){return started},async click(action){await container.onclick({preventDefault(){},target:{closest:()=>({dataset:{sheetImport:action}})}})}}}
test('manual readiness is distinct from an active daily schedule',async()=>{for(const [enabled,scheduled,label] of [[false,false,'Import not active'],[true,false,'Manual import ready'],[true,true,'Daily · 02:00 Taipei']]){const h=await harness({configured:true,enabled,schedule_active:scheduled});assert(h.container.innerHTML.includes(label));await h.click('start');assert.equal(h.started,enabled?1:0);h.cleanup();}});
test('permission denial blocks crafted refresh starts, errors and conflicts are escaped',async()=>{const h=await harness({configured:true,enabled:true,conflict_count:1},false,{getConflicts:async()=>({total:1,conflicts:[{entity_type:'<img>',reason:'<script>'}]})});await h.click('start');assert.equal(h.started,0);await h.click('conflicts');assert.match(h.container.innerHTML,/&lt;img&gt;/);assert.doesNotMatch(h.container.innerHTML,/<script>/);h.cleanup();});
test('a completed requested job reloads the shared data once',async()=>{let requested=false,completed=0;const h=await harness({},true,{getStatus:async()=>({configured:true,enabled:true,job:requested?{job_id:'J',status:'conflicts'}:null}),start:async()=>{requested=true;return {job_id:'J',status:'queued'}},onComplete:async()=>completed++});await h.click('start');assert.equal(completed,1);await h.click('refresh');assert.equal(completed,1);h.cleanup();});

test('restricted conflict metadata explains withheld source details',async()=>{const h=await harness({configured:true,enabled:true,conflict_count:1},false,{getConflicts:async()=>({total:1,source_details_withheld:true,conflicts:[{entity_type:'locations',entity_id:'SYN-A1',source_details_withheld:true}]})});await h.click('conflicts');assert.match(h.container.innerHTML,/Source details are restricted/);assert.match(h.container.innerHTML,/SYN-A1/);h.cleanup();});


test('stalled queued and running jobs allow an explicit retry at the server fifteen-minute boundary',async()=>{
 const realNow=Date.now;let now=Date.parse('2026-10-15T04:00:00Z');Date.now=()=>now;
 try{for(const status of ['queued','running']){
  const job={job_id:'old',status,queued_at:'2026-10-15T03:45:00Z'};if(status==='running')job.started_at='2026-10-15T03:45:00Z';
  const h=await harness({configured:true,enabled:true,job});
  assert.match(h.container.innerHTML,/Retry update/);assert.match(h.container.innerHTML,/not finished after 15 minutes/);assert.equal(h.started,0);
  await h.click('start');assert.equal(h.started,1);h.cleanup();
 }}finally{Date.now=realNow;}
});
test('fresh starts, future or missing timestamps stay blocked; expired jobs still require import rights',async()=>{
 const realNow=Date.now;Date.now=()=>Date.parse('2026-10-15T04:00:00Z');
 try{
  for(const timestamps of [{},{queued_at:'invalid'},{queued_at:'2026-10-15T04:01:00Z'},{queued_at:'2026-10-15T03:45:01Z'},{queued_at:'2026-10-15T03:00:00Z',started_at:'2026-10-15T03:59:00Z'},{queued_at:'2026-10-15T03:00:00Z',started_at:'invalid'}]){
   const h=await harness({configured:true,enabled:true,job:{status:'running',...timestamps}});assert.match(h.container.innerHTML,/Update in progress/);await h.click('start');assert.equal(h.started,0);h.cleanup();
  }
  const h=await harness({configured:true,enabled:true,job:{status:'running',queued_at:'2026-10-15T03:00:00Z'}},false);await h.click('start');assert.equal(h.started,0);h.cleanup();
 }finally{Date.now=realNow;}
});

test('reopening a running job resumes watching and retries a failed data reload without another import',async()=>{
 let job={job_id:'existing',status:'running',started_at:new Date().toISOString()},loads=0;
 const h=await harness(null,true,{getStatus:async()=>({configured:true,enabled:true,job}),onComplete:async()=>{loads++;if(loads===1)throw new Error('Connection interrupted');}});
 try{assert.match(h.container.innerHTML,/Update in progress/);assert.equal(h.started,0);
  job={...job,status:'completed'};await h.click('refresh');assert.match(h.container.innerHTML,/Connection interrupted/);assert.equal(loads,1);
  await h.click('refresh');assert.equal(loads,2);assert.doesNotMatch(h.container.innerHTML,/Connection interrupted/);
  await h.click('refresh');assert.equal(loads,2);assert.equal(h.started,0);
 }finally{h.cleanup();}
});

 test('concurrent refreshes share one completion reload',async()=>{
  let job={job_id:'one-job',status:'running',started_at:new Date().toISOString()},release,loads=0;
  const h=await harness(null,true,{getStatus:async()=>({configured:true,enabled:true,job}),onComplete:async()=>{loads++;await new Promise(resolve=>release=resolve);}});
  try{job={...job,status:'completed'};const first=h.click('refresh'),second=h.click('refresh');await new Promise(resolve=>setImmediate(resolve));assert.equal(loads,1);release();await Promise.all([first,second]);await h.click('refresh');assert.equal(loads,1);}finally{h.cleanup();}
 });

test('a status refresh blocks an overlapping new import request',async()=>{
 let release,hold=false;
 const ready={configured:true,enabled:true,job:null};
 const h=await harness(ready,true,{getStatus:async()=>hold?new Promise(resolve=>release=resolve):ready});
 try{hold=true;const refreshing=h.click('refresh');await h.click('start');assert.equal(h.started,0);release(ready);await refreshing;hold=false;await h.click('start');assert.equal(h.started,1);}finally{h.cleanup();}
});

test('connection verification repaints import rights without reloading status or losing conflicts and handlers',async()=>{
 let allowed=false,reads=0;
 const h=await harness(null,false,{canImport:()=>allowed,getStatus:async()=>{reads++;return {configured:true,enabled:true,conflict_count:1};},getConflicts:async()=>({total:1,conflicts:[{entity_id:'saved-conflict',reason:'existing mismatch'}]})});
 try{
  await h.click('conflicts');const handler=h.container.onclick;assert.match(h.container.innerHTML,/Import access is managed by the owner/);
  allowed=true;refreshAnimalSheetImportAccess(h.container);
  assert.equal(reads,1);assert.equal(h.container.onclick,handler);assert.match(h.container.innerHTML,/saved-conflict/);assert.doesNotMatch(h.container.innerHTML,/Import access is managed by the owner/);assert.match(h.container.innerHTML,/data-sheet-import="start">Update from Animal Sheet/);
 }finally{h.cleanup();}
});

test('access repaint keeps a running update blocked and ignores an unmounted panel',async()=>{
 let allowed=false,reads=0;
 const h=await harness(null,false,{canImport:()=>allowed,getStatus:async()=>{reads++;return {configured:true,enabled:true,job:{job_id:'ongoing',status:'running',started_at:new Date().toISOString()}};}});
 try{allowed=true;refreshAnimalSheetImportAccess(h.container);assert.equal(reads,1);assert.match(h.container.innerHTML,/data-sheet-import="start" disabled>Update in progress/);assert.equal(h.started,0);}
 finally{h.cleanup();}
 const html=h.container.innerHTML;allowed=false;refreshAnimalSheetImportAccess(h.container);assert.equal(h.container.innerHTML,html);
});

test('queued updates show waiting and their queue time, without claiming the worker has started',async()=>{
 const h=await harness({configured:true,enabled:true,job:{job_id:'queued-job',status:'queued',queued_at:new Date().toISOString()}});
 try{assert.match(h.container.innerHTML,/>Queued</);assert.match(h.container.innerHTML,/Waiting to start/);assert.match(h.container.innerHTML,/Waiting for the import worker/);assert.match(h.container.innerHTML,/Queued:/);assert.match(h.container.innerHTML,/<progress aria-label=/);assert.doesNotMatch(h.container.innerHTML,/value="\d+"/);await h.click('start');assert.equal(h.started,0);}finally{h.cleanup();}
});

test('manual refresh resumes bounded monitoring after it pauses without submitting another import',async()=>{
 const realNow=Date.now,realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;
 let now=Date.parse('2026-10-20T02:00:00Z'),sequence=0,reads=0;const timers=new Map();
 Date.now=()=>now;globalThis.setTimeout=(run,delay)=>{const id=++sequence;timers.set(id,{run,delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 let h;
 try{
  const job={job_id:'one-job',status:'queued',queued_at:new Date(now).toISOString()};
  h=await harness(null,true,{getStatus:async()=>{reads++;return {configured:true,enabled:true,job};}});
  assert.equal(reads,1);assert.equal([...timers.values()].filter(timer=>timer.delay===4000).length,1);
  now+=120000;const [pollId,poll]=[...timers.entries()].find(([,timer])=>timer.delay===4000);timers.delete(pollId);poll.run();await new Promise(setImmediate);
  assert.equal(reads,2);assert.match(h.container.innerHTML,/Automatic checks paused/);assert.doesNotMatch(h.container.innerHTML,/<progress/);assert.equal([...timers.values()].filter(timer=>timer.delay===4000).length,0);
  await h.click('refresh');assert.equal(reads,3);assert.doesNotMatch(h.container.innerHTML,/Automatic checks paused/);assert.match(h.container.innerHTML,/<progress/);assert.equal([...timers.values()].filter(timer=>timer.delay===4000).length,1);assert.equal(h.started,0);
 }finally{h?.cleanup();Date.now=realNow;globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;}
});

test('loading updated cages stays visible until the completion reload finishes',async()=>{
 let job={job_id:'job',status:'running',started_at:new Date().toISOString()},finish;
 const h=await harness(null,true,{getStatus:async()=>({configured:true,enabled:true,job}),onComplete:()=>new Promise(resolve=>finish=resolve)});
 try{
  job={...job,status:'completed'};const refresh=h.click('refresh');await new Promise(setImmediate);
  assert.match(h.container.innerHTML,/Loading updated cages/);assert.match(h.container.innerHTML,/<progress/);assert.match(h.container.innerHTML,/data-sheet-import="start" disabled/);assert.equal(h.started,0);
  finish();await refresh;assert.doesNotMatch(h.container.innerHTML,/Loading updated cages|<progress/);
 }finally{h.cleanup();}
});

test('a failed status check stops animation while preserving the pending-job retry guard',async()=>{
 let fail=false;
 const h=await harness(null,true,{getStatus:async()=>{if(fail)throw Error('Connection timed out');return {configured:true,enabled:true,job:{job_id:'job',status:'queued',queued_at:new Date().toISOString()}};}});
 try{fail=true;await h.click('refresh');assert.match(h.container.innerHTML,/Connection timed out/);assert.doesNotMatch(h.container.innerHTML,/<progress/);await h.click('start');assert.equal(h.started,0);}finally{h.cleanup();}
});

test('unreadable status never clears a verified active job or starts a replacement',async()=>{
 let status={configured:true,enabled:true,job:{job_id:'active',status:'queued',queued_at:new Date().toISOString()}};
 const h=await harness(null,true,{getStatus:async()=>status});
 try{status=null;await h.click('refresh');assert.match(h.container.innerHTML,/Import status is unavailable/);assert.match(h.container.innerHTML,/Waiting to start/);await h.click('start');assert.equal(h.started,0);}finally{h.cleanup();}
});

test('a failed job is labelled Failed rather than daily-ready or manual-ready',async()=>{
 for(const schedule_active of [false,true]){
  const h=await harness({configured:true,enabled:true,schedule_active,job:{job_id:'failed',status:'failed',error:'worker_timeout'}});
  try{assert.match(h.container.innerHTML,/>Failed</);assert.doesNotMatch(h.container.innerHTML,/Daily · 02:00 Taipei|Manual import ready|<progress/);assert.match(h.container.innerHTML,/Update from Animal Sheet/);}finally{h.cleanup();}
 }
});
