import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {openApp,mainReady,mainValidUntil,recoveryReady,destinations,probeMain} from '../assets/app-entry.mjs';
import {enhanceEntryLinks,FRESH,PATIENCE} from '../assets/entry-links.mjs';

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

const MAIN_ORIGIN='https://braintimemain.tail933238.ts.net:10000';
test('probeMain is the entry pages\' own Main check: fixed URL, no session, the same validation',async()=>{
  const requests=[];const fetchImpl=async(url,options)=>{requests.push({url,options});return response(primary);};
  assert.deepEqual(await probeMain({fetchImpl,now:()=>now}),primary);
  assert.deepEqual(requests.map(r=>r.url),[MAIN_ORIGIN+'/workspace/status']);
  for(const key of ['credentials','cache','redirect','referrerPolicy'])assert.equal(requests[0].options[key],{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'}[key]);
  for(const patch of [{writable:false},{cloudId:'cloud2'},{observedAt:'2026-11-07T00:00:00Z'}])assert.equal(await probeMain({fetchImpl:async()=>response({...primary,...patch}),now:()=>now}),null);
  assert.equal(await probeMain({fetchImpl:async()=>{throw Error('offline');},now:()=>now}),null);
  assert.equal(await probeMain({fetchImpl:()=>new Promise(()=>{}),timeout:10,now:()=>now}),null);
  const controller=new AbortController(),pending=probeMain({fetchImpl:()=>new Promise(()=>{}),signal:controller.signal,now:()=>now});controller.abort();assert.equal(await pending,null);
});
test('mainValidUntil is the moment mainReady stops accepting a status, also with a skewed clock',()=>{
  for(const offset of [0,-40_000,30_000]){
    const status={...primary,observedAt:new Date(now+offset).toISOString()},until=mainValidUntil(status);
    assert.equal(until,now+offset+60_000);assert(mainReady(status,until));assert(!mainReady(status,until+1));
  }
  assert(Number.isNaN(mainValidUntil({...primary,observedAt:'bad'})));
});
test('destinations never resolve inherited names to a path',()=>{
  for(const app of ['__proto__','constructor','toString','hasOwnProperty','valueOf'])assert.deepEqual(destinations(app,'#cages'),destinations('workspace','#cages'),app);
});
test('importing app-entry on a page that is not an entry page starts no routing',async()=>{
  const seen=[];globalThis.document={body:{dataset:{}},querySelector:()=>{seen.push('query');return null;},getElementById:()=>{seen.push('status');return null;}};
  globalThis.window={location:{search:'',hash:'',replace:()=>seen.push('replace')},fetch:()=>seen.push('fetch')};
  try{const module=await import('../assets/app-entry.mjs?page-without-entry');assert.equal(typeof module.probeMain,'function');}
  finally{delete globalThis.document;delete globalThis.window;}
  assert.deepEqual(seen,[]);
});

// Public pages: links to the entry pages go straight to Main while a shared probe has just verified it.
const settle=async()=>{for(let i=0;i<25;i++)await new Promise(resolve=>setImmediate(resolve));};
function events(){
  const listeners=new Map();
  return {listeners,addEventListener(type,fn,options){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push({fn,options});},
    removeEventListener(type,fn){const list=listeners.get(type)||[],at=list.findIndex(entry=>entry.fn===fn);if(at>=0)list.splice(at,1);},
    dispatch(type,event){for(const {fn} of [...(listeners.get(type)||[])])fn(event);},types(){return [...listeners].filter(([,list])=>list.length).map(([type])=>type).sort();}};
}
function node(tag,attrs={}){
  return {...events(),tagName:tag,attrs:new Map(Object.entries(attrs)),hidden:false,textContent:'',removed:false,
    getAttribute(key){return this.attrs.has(key)?this.attrs.get(key):null;},setAttribute(key,value){this.attrs.set(key,String(value));},
    removeAttribute(key){this.attrs.delete(key);},hasAttribute(key){return this.attrs.has(key);},get target(){return this.attrs.get('target')??'';},remove(){this.removed=true;}};
}
function site(hrefs=['/workspace/','/workspace/','/workspace/'],{base='https://braintimelab.github.io/',fetcher,load,permissions,navigation=false}={}){
  let t=0,id=0;const timers=new Map(),head=[],body=[],assigned=[],requests=[],loads=[],touched=[];
  const links=hrefs.map(href=>node('a',typeof href==='string'?{href}:href));
  const trap=(target,names)=>{for(const name of names)Object.defineProperty(target,name,{get(){touched.push(name);throw Error(name+' must not be used');}});return target;};
  const doc=trap({baseURI:base,querySelectorAll(selector){assert.equal(selector,'a[href]');return links;},createElement:tag=>node(tag),head:{append:value=>head.push(value)},body:{append:value=>body.push(value)}},['cookie','defaultView']);
  const win=trap({...events(),navigation:navigation?events():undefined},['localStorage','sessionStorage','indexedDB','caches','document']);
  const f={links,head,body,assigned,requests,loads,touched,timers,win,skew:0};
  f.count=enhanceEntryLinks({doc,win,location:{origin:new URL(base).origin,assign:url=>assigned.push(url)},permissions,
    fetchImpl:async(url,options)=>{requests.push({url,options});return fetcher?fetcher(url,options):response(primary);},
    load:load||(async()=>{loads.push(1);return import('../assets/app-entry.mjs');}),
    clock:()=>t,now:()=>now+t+f.skew,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:t+ms});return id;},clearTimer:key=>timers.delete(key)});
  f.advance=async ms=>{const end=t+ms;await settle();
    for(;;){const [key,timer]=[...timers].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0]||[];if(!timer)break;timers.delete(key);t=timer.at;timer.fn();await settle();}
    t=end;await settle();};
  f.fire=(link,type,init={})=>{const event={type,button:0,currentTarget:link,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...init};link.dispatch(type,event);return event;};
  f.emit=(type,init={})=>win.dispatch(type,{type,...init});
  f.hover=link=>{f.fire(link,'pointerenter',{screenX:40,screenY:30});f.fire(link,'pointermove',{screenX:43,screenY:30,movementX:3,movementY:0});};
  f.hrefs=()=>links.map(link=>link.getAttribute('href'));
  return f;
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const ENTRY=['/workspace/','/workspace/','/workspace/'];

test('public pages make no request, import or DOM change before intent, and a link scrolled under a resting cursor is not intent',async()=>{
  const f=site();await f.advance(60_000);
  assert.equal(f.count,3);assert.equal(f.requests.length,0);assert.equal(f.loads.length,0);assert.deepEqual(f.head,[]);assert.deepEqual(f.body,[]);assert.equal(f.timers.size,0);
  // Chrome sends only pointerenter when a link scrolls under a still cursor; WebKit may add a pointermove on the same spot.
  f.fire(f.links[0],'pointerenter',{screenX:50,screenY:60});f.fire(f.links[0],'pointermove',{screenX:50,screenY:60,movementX:0,movementY:0});await f.advance(1000);
  assert.equal(f.requests.length,0);assert.equal(f.loads.length,0);assert.deepEqual(f.head,[]);assert.deepEqual(f.body,[]);assert.deepEqual(f.hrefs(),ENTRY);
  // The pointer itself moves: intent, also where an engine reports no movementX.
  f.fire(f.links[0],'pointermove',{screenX:51,screenY:60,movementX:0,movementY:0});await f.advance(0);assert.equal(f.requests.length,1);
  const g=site();g.fire(g.links[1],'pointerenter',{screenX:5,screenY:5});g.fire(g.links[1],'pointermove',{screenX:5,screenY:5,movementX:1,movementY:0});await g.advance(0);assert.equal(g.requests.length,1);
  const other=site(['/members.html','/internal/limited/','https://example.test/workspace/','/workspace/?choose','/boards/?server=recovery','mailto:lab@example.test',{href:'/workspace/',download:''}]);
  assert.equal(other.count,0);for(const link of other.links)assert.deepEqual(link.types(),[]);assert.deepEqual(other.win.types(),[]);
});
test('every intent on every link shares one probe and one module import per page',async()=>{
  const f=site();
  for(const link of f.links){f.hover(link);for(const type of ['pointerdown','touchstart','focus'])f.fire(link,type);}
  await f.advance(0);
  assert.equal(f.loads.length,1);assert.deepEqual(f.requests.map(r=>r.url),[MAIN_ORIGIN+'/workspace/status']);
  assert.equal(f.links[0].listeners.get('touchstart')[0].options.passive,true);
  for(const link of f.links)f.hover(link);await f.advance(FRESH-1);assert.equal(f.requests.length,1);
});
test('intent warms an anonymous and a credentialed connection to the same Main that app-entry verifies',async()=>{
  const f=site();f.fire(f.links[0],'focus');await f.advance(0);
  assert.deepEqual(f.head.map(hint=>[hint.rel,hint.href,hint.crossOrigin??null]),[['preconnect',MAIN_ORIGIN,'anonymous'],['preconnect',MAIN_ORIGIN,null]]);
  assert.equal(MAIN_ORIGIN,new URL(destinations('workspace').main).origin);
  f.fire(f.links[1],'focus');assert.equal(f.head.length,2);
  await f.advance(FRESH);f.fire(f.links[1],'focus');await f.advance(0);assert.equal(f.head.length,4);assert(f.head[0].removed&&f.head[1].removed&&!f.head[2].removed);
});
test('a verified Main rewrites every entry link until the result expires; the next intent probes again',async()=>{
  const f=site();f.hover(f.links[0]);await f.advance(0);
  assert.deepEqual(f.hrefs(),Array(3).fill(MAIN_ORIGIN+'/workspace/'));
  await f.advance(FRESH-1);assert.equal(f.links[2].getAttribute('href'),MAIN_ORIGIN+'/workspace/');
  await f.advance(1);assert.deepEqual(f.hrefs(),ENTRY);
  const click=f.fire(f.links[1],'click',{metaKey:true});assert(!click.defaultPrevented);assert.equal(f.requests.length,1);
  f.fire(f.links[1],'focus');await f.advance(0);assert.equal(f.requests.length,2);assert.equal(f.links[1].getAttribute('href'),MAIN_ORIGIN+'/workspace/');
});
test('the links return to their entry pages as soon as the status itself stops qualifying, if that is before 45 s',async()=>{
  // This visitor's clock runs 40 s ahead of Main: app-entry accepts the status for 20 more seconds only.
  const f=site();f.skew=40_000;f.fire(f.links[0],'focus');await f.advance(0);
  assert.deepEqual(f.hrefs(),Array(3).fill(MAIN_ORIGIN+'/workspace/'));
  await f.advance(20_000-1);assert.equal(f.links[2].getAttribute('href'),MAIN_ORIGIN+'/workspace/');assert(mainReady(primary,now+40_000+20_000-1));
  await f.advance(1);assert.deepEqual(f.hrefs(),ENTRY);
});
test('each use re-checks the status with app-entry rules, so a status past its own 60 s window falls back at once',async()=>{
  const f=site();f.hover(f.links[0]);await f.advance(0);assert.equal(f.links[0].getAttribute('href'),MAIN_ORIGIN+'/workspace/');
  f.skew=61_000;const click=f.fire(f.links[0],'click');
  assert.equal(f.links[0].getAttribute('href'),'/workspace/');assert(click.defaultPrevented);
  await f.advance(0);assert.deepEqual(f.assigned,['https://braintimelab.github.io/workspace/']);
});
test('the fast path accepts exactly what app-entry accepts, through its own probe, checks and destinations',async()=>{
  for(const patch of [{writable:false},{mode:'full-backup'},{cloudId:'cloud2'},{service:'degraded'},{authReady:false},{dataReady:false},{deploymentId:'other'},{observedAt:'2026-11-07T00:00:00Z'},{captureSha256:''},{acceptances:{}},{generation:'short'}]){
    const status={...primary,...patch};assert(!mainReady(status,now));
    const f=site(undefined,{fetcher:async()=>response(status)});f.hover(f.links[0]);await f.advance(0);
    assert.deepEqual(f.hrefs(),ENTRY,JSON.stringify(patch));
  }
  const used=new Set();const spy=(module,name)=>(...args)=>{used.add(name);return module[name](...args);};
  const f=site(undefined,{load:async()=>{const module=await import('../assets/app-entry.mjs');return {...module,...Object.fromEntries(['probeMain','mainReady','mainValidUntil','destinations'].map(name=>[name,spy(module,name)]))};}});
  f.fire(f.links[0],'pointerdown');await f.advance(0);
  assert.deepEqual([...used].sort(),['destinations','mainReady','mainValidUntil','probeMain']);assert.equal(f.links[0].getAttribute('href'),MAIN_ORIGIN+'/workspace/');
  const source=await readFile(new URL('../assets/entry-links.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/fetch\(|deploymentId|service-status|observedAt|acceptances|MAX_AGE|60_000/);
});
test('a failed or unverifiable probe leaves the entry links and their normal navigation for the rest of the window',async()=>{
  for(const fetcher of [async()=>{throw Error('not on the tailnet');},async()=>new Response('{}',{status:503}),async()=>response({...primary,service:'starting'})]){
    const f=site(undefined,{fetcher});f.hover(f.links[0]);await f.advance(0);
    assert.deepEqual(f.hrefs(),ENTRY);
    assert(!f.fire(f.links[0],'click').defaultPrevented);assert.deepEqual(f.assigned,[]);
    f.hover(f.links[1]);await f.advance(1000);assert.equal(f.requests.length,1);
  }
  const offline=site(undefined,{load:async()=>{throw Error('offline');}});offline.fire(offline.links[0],'focus');await offline.advance(0);
  assert.equal(offline.links[0].getAttribute('href'),'/workspace/');assert(!offline.fire(offline.links[0],'click').defaultPrevented);
});
test('a browser that asks before a public page reaches tailnet addresses is not asked from a hover; the entry page asks, in context',async()=>{
  for(const state of ['prompt','denied']){
    const asked=[],f=site(undefined,{permissions:{query:async({name})=>{asked.push(name);return {state};}}});
    f.hover(f.links[0]);f.fire(f.links[0],'pointerdown');await f.advance(0);
    assert.deepEqual(asked,['local-network']);assert.equal(f.requests.length,0);assert.equal(f.loads.length,0);assert.deepEqual(f.head,[]);assert.deepEqual(f.hrefs(),ENTRY);
    assert(!f.fire(f.links[0],'click').defaultPrevented);assert.deepEqual(f.assigned,[]);
  }
  const granted=site(undefined,{permissions:{query:async()=>({state:'granted'})}});granted.fire(granted.links[0],'focus');await granted.advance(0);
  assert.equal(granted.requests.length,1);assert.equal(granted.links[0].getAttribute('href'),MAIN_ORIGIN+'/workspace/');
  // Chrome before the local-network split names it local-network-access; Safari knows neither and probes as before.
  const names=[],older=site(undefined,{permissions:{query:async({name})=>{names.push(name);if(name==='local-network')throw TypeError('unknown');return {state:'granted'};}}});
  older.fire(older.links[0],'focus');await older.advance(0);assert.deepEqual(names,['local-network','local-network-access']);assert.equal(older.requests.length,1);
  for(const permissions of [{query:async()=>{throw TypeError('unknown permission');}},{query(){throw TypeError('sync');}},undefined]){
    const f=site(undefined,{permissions});f.fire(f.links[0],'focus');await f.advance(0);assert.equal(f.requests.length,1);
  }
});
test('a plain click during the probe waits until it is at most 800 ms old, then opens Main or the entry page',async()=>{
  assert.equal(PATIENCE,800);
  const answer=deferred(),f=site(undefined,{fetcher:()=>answer.promise});
  f.fire(f.links[0],'touchstart');await f.advance(80);
  const click=f.fire(f.links[0],'click');assert(click.defaultPrevented);
  const status=f.body[0];assert.equal(status.getAttribute('role'),'status');assert.equal(status.textContent,'Opening Workspace…');
  assert.equal(f.links[0].getAttribute('aria-busy'),'true');
  await f.advance(300);assert.deepEqual(f.assigned,[]);
  answer.resolve(response(primary));await f.advance(0);
  assert.deepEqual(f.assigned,[MAIN_ORIGIN+'/workspace/']);await f.advance(PATIENCE);assert.equal(f.assigned.length,1);
  await f.advance(5000);assert.equal(f.links[0].getAttribute('aria-busy'),null);assert.equal(status.textContent,'');

  const hung=site(['/mouse-data/'],{fetcher:()=>new Promise(()=>{})});hung.hover(hung.links[0]);await hung.advance(300);
  assert(hung.fire(hung.links[0],'click').defaultPrevented);assert.equal(hung.body[0].textContent,'Opening Mouse Data…');
  await hung.advance(PATIENCE-300-1);assert.deepEqual(hung.assigned,[]);
  await hung.advance(1);assert.deepEqual(hung.assigned,['https://braintimelab.github.io/mouse-data/']);hung.emit('pagehide');

  const refused=deferred(),bad=site(undefined,{fetcher:()=>refused.promise});bad.fire(bad.links[0],'pointerdown');await bad.advance(100);
  assert(bad.fire(bad.links[0],'click').defaultPrevented);refused.resolve(new Response('{}',{status:503}));await bad.advance(0);
  assert.deepEqual(bad.assigned,['https://braintimelab.github.io/workspace/']);
});
test('a click without earlier intent starts the probe itself; a probe already older than 800 ms is not waited for',async()=>{
  const answer=deferred(),f=site(undefined,{fetcher:()=>answer.promise});
  assert(f.fire(f.links[0],'click').defaultPrevented);await f.advance(0);assert.equal(f.requests.length,1);
  answer.resolve(response(primary));await f.advance(0);assert.deepEqual(f.assigned,[MAIN_ORIGIN+'/workspace/']);
  const slow=site(undefined,{fetcher:()=>new Promise(()=>{})});slow.hover(slow.links[0]);await slow.advance(PATIENCE);
  assert(!slow.fire(slow.links[0],'click').defaultPrevented);assert.deepEqual(slow.assigned,[]);slow.emit('pagehide');
});
test('during a wait, a later plain click on another app link replaces it, and new-tab links are never held',async()=>{
  const answer=deferred(),f=site(['/workspace/','/boards/',{href:'/mouse-data/',target:'_blank'}],{fetcher:()=>answer.promise});
  f.fire(f.links[0],'pointerdown');await f.advance(10);assert(f.fire(f.links[0],'click').defaultPrevented);
  assert(f.fire(f.links[1],'click').defaultPrevented);assert.equal(f.body[0].textContent,'Opening Boards…');
  assert.equal(f.links[0].getAttribute('aria-busy'),null);assert.equal(f.links[1].getAttribute('aria-busy'),'true');
  assert(!f.fire(f.links[2],'click').defaultPrevented,'a target=_blank link opens its tab at once');
  answer.resolve(response(primary));await f.advance(0);assert.deepEqual(f.assigned,[destinations('boards').main]);
});
test('whatever the visitor starts during a wait wins: another link, an address, Back or Reload; Escape cancels',async()=>{
  const starts={beforeunload:f=>f.emit('beforeunload'),navigate:f=>f.win.navigation.dispatch('navigate',{destination:{sameDocument:false},downloadRequest:null}),escape:f=>f.emit('keydown',{key:'Escape'})};
  for(const [name,start] of Object.entries(starts)){
    const answer=deferred(),f=site(undefined,{fetcher:()=>answer.promise,navigation:true});
    f.fire(f.links[0],'pointerdown');await f.advance(10);assert(f.fire(f.links[0],'click').defaultPrevented);
    assert.deepEqual(f.win.types(),['beforeunload','keydown','pagehide','pageshow']);assert.deepEqual(f.win.navigation.types(),['navigate']);
    await f.advance(100);start(f);
    assert.equal(f.links[0].getAttribute('aria-busy'),null,name);assert.equal(f.body[0].textContent,'',name);
    await f.advance(PATIENCE);answer.resolve(response(primary));await f.advance(0);
    assert.deepEqual(f.assigned,[],name);assert.deepEqual(f.win.types(),['pagehide','pageshow'],name);assert.deepEqual(f.win.navigation.types(),[],name);
    assert.equal(f.links[0].getAttribute('href'),MAIN_ORIGIN+'/workspace/',name); // the probe still serves the next click
  }
  // A jump within the page, a download or another key does not cancel; the wait ends as usual and takes its listeners along.
  const answer=deferred(),f=site(undefined,{fetcher:()=>answer.promise,navigation:true});
  f.fire(f.links[0],'pointerdown');await f.advance(10);assert(f.fire(f.links[0],'click').defaultPrevented);
  f.win.navigation.dispatch('navigate',{destination:{sameDocument:true},downloadRequest:null});
  f.win.navigation.dispatch('navigate',{destination:{sameDocument:false},downloadRequest:''});f.emit('keydown',{key:'Tab'});
  answer.resolve(response(primary));await f.advance(0);
  assert.deepEqual(f.assigned,[MAIN_ORIGIN+'/workspace/']);assert.deepEqual(f.win.types(),['pagehide','pageshow']);assert.deepEqual(f.win.navigation.types(),[]);
  // Without the Navigation API, beforeunload alone still lets the visitor's own navigation win.
  const plain=deferred(),g=site(undefined,{fetcher:()=>plain.promise});g.fire(g.links[0],'pointerdown');await g.advance(10);
  assert(g.fire(g.links[0],'click').defaultPrevented);g.emit('beforeunload');plain.resolve(response(primary));await g.advance(PATIENCE);assert.deepEqual(g.assigned,[]);
});
test('modifier, middle, keyboard-with-modifier and new-tab clicks are never intercepted, also during a wait',async()=>{
  const f=site(undefined,{fetcher:()=>new Promise(()=>{})});f.fire(f.links[0],'pointerdown');await f.advance(10);
  for(const init of [{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true},{button:1},{detail:0,metaKey:true},{detail:0,shiftKey:true}])assert(!f.fire(f.links[0],'click',init).defaultPrevented,JSON.stringify(init));
  for(const type of ['auxclick','mousedown','mouseup','keydown'])assert(!f.links[0].listeners.has(type),type);
  f.links[2].setAttribute('target','_blank');assert(!f.fire(f.links[2],'click').defaultPrevented);
  const handled=f.fire(f.links[1],'click',{defaultPrevented:true});assert.deepEqual(f.assigned,[]);assert.equal(handled.defaultPrevented,true);
  assert(f.fire(f.links[0],'click').defaultPrevented);
  for(const init of [{metaKey:true},{button:1},{ctrlKey:true}])assert(!f.fire(f.links[1],'click',init).defaultPrevented,'during a wait: '+JSON.stringify(init));
  f.emit('pagehide');assert.deepEqual(f.assigned,[]);
});
test('back/forward cache restores entry links and forgets results; leaving aborts the probe and any waiting click',async()=>{
  const f=site();f.hover(f.links[0]);await f.advance(0);assert.equal(f.links[0].getAttribute('href'),MAIN_ORIGIN+'/workspace/');
  f.emit('pageshow',{persisted:false});assert.equal(f.links[0].getAttribute('href'),MAIN_ORIGIN+'/workspace/');
  f.emit('pageshow',{persisted:true});assert.deepEqual(f.hrefs(),ENTRY);assert.equal(f.timers.size,0);
  f.hover(f.links[0]);await f.advance(0);assert.equal(f.requests.length,2);
  let signal;const g=site(undefined,{fetcher:(url,options)=>{signal=options.signal;return new Promise(()=>{});},navigation:true});
  g.fire(g.links[0],'pointerdown');await g.advance(0);assert(g.fire(g.links[0],'click').defaultPrevented);
  g.emit('pagehide');assert(signal.aborted);await g.advance(PATIENCE*2);
  assert.deepEqual(g.assigned,[]);assert.equal(g.links[0].getAttribute('aria-busy'),null);assert.equal(g.body[0].textContent,'');
  assert.deepEqual(g.win.types(),['pagehide','pageshow']);assert.deepEqual(g.win.navigation.types(),[]);
  g.emit('pageshow',{persisted:true});g.fire(g.links[0],'focus');await g.advance(0);assert.equal(g.requests.length,2);g.emit('pagehide');
  // A busy-state timer left by an earlier navigation cannot clear a later wait after a restore.
  const h=site(undefined,{fetcher:()=>new Promise(()=>{})});h.fire(h.links[0],'pointerdown');await h.advance(0);assert(h.fire(h.links[0],'click').defaultPrevented);
  await h.advance(PATIENCE);assert.equal(h.assigned.length,1);h.emit('pageshow',{persisted:true});await h.advance(4700);
  h.fire(h.links[0],'pointerdown');await h.advance(0);assert(h.fire(h.links[0],'click').defaultPrevented);await h.advance(400);
  assert.equal(h.links[0].getAttribute('aria-busy'),'true');h.emit('pagehide');assert.equal(h.links[0].getAttribute('aria-busy'),null);
});
test('a click that goes straight to Main shows the same short status until the page changes',async()=>{
  const f=site();f.hover(f.links[0]);await f.advance(0);
  const click=f.fire(f.links[0],'click');assert(!click.defaultPrevented);assert.equal(f.body[0].textContent,'Opening Workspace…');assert.equal(f.links[0].getAttribute('aria-busy'),'true');
  await f.advance(5000);assert.equal(f.body[0].textContent,'');assert.equal(f.links[0].getAttribute('aria-busy'),null); // the navigation was stopped
  f.fire(f.links[0],'click');f.emit('pageshow',{persisted:true});assert.equal(f.body[0].textContent,'');assert.equal(f.links[0].getAttribute('aria-busy'),null);
  for(const init of [{metaKey:true},{button:1},{shiftKey:true}]){f.fire(f.links[0],'click',init);assert.equal(f.body[0].textContent,'',JSON.stringify(init));}
});
test('the status region is present and empty from the first intent, before a click writes into it',async()=>{
  const f=site();f.fire(f.links[0],'focus');
  assert.equal(f.body.length,1);const status=f.body[0];
  assert.equal(status.tagName,'div');assert.equal(status.getAttribute('role'),'status');assert.equal(status.textContent,'');assert.equal(status.hidden,false);
  f.fire(f.links[1],'focus');f.hover(f.links[2]);assert.equal(f.body.length,1);
  const css=await readFile(new URL('../assets/site.css',import.meta.url),'utf8');
  assert.match(css,/\.entry-link-status:empty\{padding:0;box-shadow:none\}/);assert.doesNotMatch(css,/\.entry-link-status[^{]*\{[^}]*(display:none|visibility:hidden)/);
});
test('the context menu (Copy Link, Open in New Tab, bookmarks) keeps the public entry URL, which works off the tailnet too',async()=>{
  const f=site();f.fire(f.links[0],'pointerdown',{button:2});await f.advance(0);assert.equal(f.links[0].getAttribute('href'),MAIN_ORIGIN+'/workspace/');
  f.fire(f.links[0],'contextmenu');assert.equal(f.links[0].getAttribute('href'),'/workspace/');assert.equal(f.links[1].getAttribute('href'),MAIN_ORIGIN+'/workspace/');
  f.fire(f.links[0],'focus');assert.equal(f.links[0].getAttribute('href'),MAIN_ORIGIN+'/workspace/');
});
test('all six apps and the /internal/ launcher map to their exact Main destinations, keeping only safe app routes',async()=>{
  const hrefs=['/workspace/','/boards/','/mouse-data/#cages','reagents/index.html','../primers/','https://braintimelab.github.io/calculator/','internal/','/workspace/#access_token=secret'];
  const f=site(hrefs,{base:'https://braintimelab.github.io/members.html'});assert.equal(f.count,hrefs.length);
  f.hover(f.links[0]);await f.advance(0);
  assert.deepEqual(f.hrefs(),['/workspace/','/','/mouse-data/#cages','/reagents/','/primers/','/calculator/','/workspace/','/workspace/'].map(path=>MAIN_ORIGIN+path));
  assert.deepEqual(f.hrefs(),[['workspace'],['boards'],['mouse-data','#cages'],['reagents'],['primers'],['calculator'],['workspace'],['workspace','#access_token=secret']].map(([app,hash])=>destinations(app,hash).main));
  f.emit('pageshow',{persisted:true});assert.deepEqual(f.hrefs(),hrefs);
});
test('the fast path sends no credentials and never touches cookies or browser storage',async()=>{
  const f=site(undefined,{navigation:true});f.hover(f.links[0]);await f.advance(0);f.fire(f.links[0],'click');f.fire(f.links[0],'contextmenu');await f.advance(FRESH);f.emit('pageshow',{persisted:true});
  for(const {options} of f.requests){assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');}
  assert.deepEqual(f.touched,[]);
  const source=await readFile(new URL('../assets/entry-links.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/cookie|localStorage|sessionStorage|indexedDB|\bcaches\b|credentials\s*:|Authorization|sendBeacon/i);
});
test('the homepage loads the fast path as a module, with its links and no inline script or style unchanged',async()=>{
  const home=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(home,/<script type="module" src="assets\/entry-links\.mjs\?v=1"><\/script>/);
  assert.equal([...home.matchAll(/href="\/workspace\/"/g)].length,3);
  assert.doesNotMatch(home,/<script(?![^>]*\bsrc=)[^>]*>|<style|\sstyle=|\son[a-z]+=/i);
});
// Pages whose links reach an app entry page or /internal/, and those that load the fast path for them.
async function publicLinks(){
  const {readdir}=await import('node:fs/promises'),root=new URL('../',import.meta.url),skip=/^(assets|tests|scripts|sql|prev|mouse-data|reagents|internal|workspace|boards|primers|calculator|1LED-1PIR-11-14)\//;
  const pages=(await readdir(root,{recursive:true})).filter(path=>path.endsWith('.html')&&!skip.test(path)).sort(),linking=[],wired=[];
  for(const page of pages){
    const html=await readFile(new URL(page,root),'utf8');
    const entries=[...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(match=>new URL(match[1],'https://braintimelab.github.io/'+page)).filter(url=>url.origin==='https://braintimelab.github.io'&&!url.search&&/^\/(workspace|boards|mouse-data|reagents|primers|calculator|internal)\/(index\.html)?$/.test(url.pathname));
    const script=html.match(/<script type="module" src="((?:\.\.\/)*)assets\/entry-links\.mjs\?v=1"><\/script>/);
    const noScripts=/http-equiv="Content-Security-Policy"/.test(html)&&!/script-src 'self'/.test(html);
    if(script){assert(entries.length&&!noScripts,page);assert.equal(script[1],'../'.repeat(page.split('/').length-1),page);wired.push(page);}
    if(entries.length&&!noScripts)linking.push(page);
  }
  return {linking,wired};
}
test('the homepage is the page that loads the fast path; the pages that link Workspace to /internal/ keep their path',async()=>{
  const {linking,wired}=await publicLinks();
  assert.deepEqual(wired,['index.html']);
  assert.deepEqual(linking,['index.html','join.html','lab-notes-privacy.html','lectures.html','members.html','posters/index.html','posters/sfn2026-byer/index.html','posters/sfn2026-truong/index.html','previous-members.html','publications.html','resources.html']);
  // /internal/ is mapped like /workspace/ because it is the same Workspace entry: keep it so.
  const internal=await readFile(new URL('../internal/index.html',import.meta.url),'utf8');
  assert.match(internal,/<body data-app-entry="workspace">/);assert.match(internal,/<script type="module" src="\.\/workspace-entry\.mjs\?v=\d+"><\/script>/);
  assert.match(await readFile(new URL('../internal/workspace-entry.mjs',import.meta.url),'utf8'),/\nexport \* from '\.\.\/assets\/app-entry\.mjs\?v=\d+';\n$/);
});
