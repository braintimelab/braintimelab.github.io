import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {openApp,mainReady,recoveryReady,destinations} from '../assets/app-entry.mjs';

const now=Date.parse('2026-11-08T00:00:00Z');
const primary={format:'braintime-public-service-status-v2',deploymentId:'61af3893-f1cb-417c-8c7c-2b7cfb0a89fd',cloudId:'cloud1',mode:'primary',generation:'current-primary-generation',captureSha256:'a'.repeat(64),observedAt:new Date(now).toISOString(),service:'ready',authReady:true,dataReady:true,writable:true,acceptances:{identity:'b'.repeat(64),projection:'c'.repeat(64),service:'d'.repeat(64)}};
const backup={...primary,cloudId:'cloud2',mode:'full-backup',service:'degraded',writable:false,coverage:'full',integrityVerified:true,recoveryReady:true,dataCapturedAt:'2026-11-05T00:00:00Z',backupCompletedAt:'2026-11-05T01:00:00Z',policyValidUntil:'2026-11-12T00:00:00Z'};
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function fixture(app='workspace',{search='',hash=''}={}) {
  const events=new Map(),links={main:{},recovery:{},limited:{}},status={textContent:''},replaced=[],requests=[];
  const nav={querySelector(selector){return links[selector.match(/data-(\w+)-entry/)[1]];},addEventListener(name,fn){events.set(name,fn);},removeEventListener(name,fn){if(events.get(name)===fn)events.delete(name);}};
  const doc={body:{dataset:{appEntry:app}},querySelector(){return nav;},getElementById(){return status;}};
  const location={search,hash,replace(url){replaced.push(url);}};
  return {doc,location,status,replaced,requests,events,links};
}
function run(f,{main=primary,recovery=backup,fetcher,timeout=25}={}) {
  return openApp({...f,timeout,now:()=>now,fetchImpl:async(url,options)=>{f.requests.push({url,options});return fetcher?fetcher(url,options):response(url.includes('braintimemain.')?main:recovery);}});
}

test('all six direct links use their exact Main path and preserve ordinary menu fragments',async()=>{
  const paths={workspace:'/workspace/',boards:'/', 'mouse-data':'/mouse-data/',reagents:'/reagents/',primers:'/primers/',calculator:'/calculator/'};
  for(const [app,path] of Object.entries(paths)){
    const f=fixture(app,{hash:'#cages'});await run(f);
    assert.deepEqual(f.replaced,['https://braintimemain.tail933238.ts.net:10000'+path+'#cages']);
    assert.equal(f.links.recovery.href,'https://braintimedisk.tail933238.ts.net:10000'+path+'#cages');
  }
});
test('Main has priority even when Recovery responds first',async()=>{
  const f=fixture();await run(f,{fetcher:async url=>{if(url.includes('braintimemain.'))await new Promise(resolve=>setTimeout(resolve,5));return response(url.includes('braintimemain.')?primary:backup);}});
  assert.equal(f.replaced[0],destinations('workspace').main);
});
test('Main failure automatically opens the verified read-only Recovery app',async()=>{
  const f=fixture('mouse-data');await run(f,{fetcher:async url=>{if(url.includes('braintimemain.'))throw Error('unavailable');return response(backup);}});
  assert.deepEqual(f.replaced,[destinations('mouse-data').recovery]);
});
test('a Main timeout cannot hang navigation, even if fetch ignores cancellation',async()=>{
  const f=fixture('boards');await run(f,{timeout:10,fetcher:url=>url.includes('braintimemain.')?new Promise(()=>{}):response(backup)});
  assert.deepEqual(f.replaced,[destinations('boards').recovery]);
});
test('two failures open the independent Limited Workspace without pretending an app is ready',async()=>{
  const f=fixture('calculator');await run(f,{fetcher:async()=>{throw Error('offline');}});
  assert.deepEqual(f.replaced,['/internal/limited/']);
});
test('an invalid/expired backup cannot be accepted for fallback',async()=>{
  const variants=[{writable:true},{policyValidUntil:'2026-11-07T00:00:00Z'},{integrityVerified:false},{authReady:false},{recoveryReady:false},{coverage:'partial'},{deploymentId:'other'},{observedAt:'2026-11-07T00:00:00Z'},{acceptances:{}},{backupCompletedAt:'invalid'},{dataCapturedAt:'2026-11-09T00:00:00Z'}];
  for(const patch of variants){const f=fixture();await run(f,{main:{},recovery:{...backup,...patch}});assert.deepEqual(f.replaced,['/internal/limited/'],JSON.stringify(patch));}
});
test('Main requires fresh accepted identity, data and service readiness',()=>{
  assert(mainReady(primary,now));assert(recoveryReady(backup,now));
  for(const patch of [{authReady:false},{dataReady:false},{service:'not-ready'},{writable:false},{captureSha256:''},{observedAt:'bad'},{deploymentId:'unrecognized'},{generation:''}])assert(!mainReady({...primary,...patch},now));
});
test('bad HTTP, content types, large bodies and redirects do not qualify',async()=>{
  const variants=[()=>new Response('{}',{status:503}),()=>new Response(JSON.stringify(primary)),()=>new Response(' '.repeat(8200),{headers:{'Content-Type':'application/json'}}),()=>{const r=response(primary);Object.defineProperty(r,'redirected',{value:true});return r;}];
  for(const make of variants){const f=fixture();await run(f,{fetcher:async()=>make()});assert.deepEqual(f.replaced,['/internal/limited/']);}
});
test('manual choice or keyboard focus cancels automatic navigation',async()=>{
  for(const event of ['click','focusin']){
    const f=fixture();let resolveMain;
    const done=run(f,{fetcher:url=>url.includes('braintimemain.')?new Promise(resolve=>{resolveMain=resolve;}):response(backup)});
    f.events.get(event)();resolveMain(response(primary));await done;assert.deepEqual(f.replaced,[]);
  }
});
test('explicit server selection and chooser do not depend on availability',async()=>{
  for(const server of ['main','recovery','limited']){const f=fixture('reagents',{search:'?server='+server});await run(f);assert.deepEqual(f.replaced,[destinations('reagents')[server]]);assert.equal(f.requests.length,0);}
  const f=fixture('primers',{search:'?choose'});await run(f);assert.deepEqual(f.replaced,[]);assert.equal(f.requests.length,0);assert(f.links.main.href);
});
test('query strings, untrusted routes, setup links and tokens cannot leak to another server',async()=>{
  for(const hash of ['#access_token=secret','#setup/secret','#https://example.test','#cages?code=secret']){
    const f=fixture('mouse-data',{hash,search:'?next=https://example.test&password=secret'});await run(f);assert.equal(f.replaced[0],destinations('mouse-data').main);
  }
  assert.equal(destinations('https://example.test').main,destinations('workspace').main);
});
test('health probes omit sessions, follow no redirects and use only fixed origins',async()=>{
  const f=fixture();await run(f);
  assert.deepEqual(f.requests.map(r=>r.url),['https://braintimemain.tail933238.ts.net:10000/workspace/status','https://braintimedisk.tail933238.ts.net:10000/workspace/status']);
  for(const {options} of f.requests){assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');}
});
test('public entry pages have usable manual links and no legacy app startup or authentication',async()=>{
  for(const app of ['workspace','boards','mouse-data','reagents','primers','calculator']){
    const html=await readFile(new URL('../'+app+'/index.html',import.meta.url),'utf8');
    assert(html.includes('data-app-entry="'+app+'"'));assert.match(html,/data-main-entry>Main/);assert.match(html,/data-recovery-entry>Recovery/);assert.match(html,/data-limited-entry>Limited/);
    assert(!html.includes('app.js?'));assert(!/<input|<form/.test(html));assert.match(html,/assets\/app-entry.mjs\?v=2/);
  }
  for(const app of ['mouse-data','reagents'])assert.match(await readFile(new URL('../'+app+'/legacy.html',import.meta.url),'utf8'),/app.js\?v=/);
});

test('the already-installed legacy Mouse worker fetches the new gateway before a saved HTML shell',async()=>{
  const worker=await readFile(new URL('../mouse-data/sw.js',import.meta.url),'utf8');
  const gateway=await readFile(new URL('../mouse-data/index.html',import.meta.url),'utf8');
  const listeners=new Map();let pending,background,requested=0;
  const scope='https://braintimelab.github.io/mouse-data/';
  const response=new Response(gateway);Object.defineProperty(response,'type',{value:'basic'});
  vm.runInNewContext(worker,{URL,Response,self:{registration:{scope},addEventListener(name,fn){listeners.set(name,fn);}},fetch:async()=>{requested++;return response;},caches:{async open(){return{async match(){return new Response('old app shell');},async put(){}};}}});
  listeners.get('fetch')({request:{method:'GET',url:scope},respondWith(value){pending=value;},waitUntil(value){background=value;}});
  const actual=await pending;await background;
  assert.equal(requested,1);assert.match(await actual.text(),/data-app-entry="mouse-data"/);
});
