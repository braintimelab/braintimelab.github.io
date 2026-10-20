import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const appURL=new URL('../mouse-data/app.js',import.meta.url),app=await readFile(appURL,'utf8'),html=await readFile(new URL('index.html',appURL),'utf8');
const staticRefs=source=>[...source.matchAll(/(?:\bfrom|\bimport)\s*['"](\.\/[^'"]+)['"]/g)].map(m=>m[1]);
async function graph(root){const seen=new Map(),pending=[root];while(pending.length){const url=pending.pop();if(seen.has(url.href))continue;const body=await readFile(url,'utf8');seen.set(url.href,body);for(const ref of staticRefs(body))pending.push(new URL(ref,url));}return seen;}
const initial=await graph(appURL);

test('Cages startup does not request specialist screen or label-designer code',()=>{
 for(const name of ['mouse-review-view','brainbot-review-runner','brainbot','strain-management','family-explorer','cryopreservation','cryo-register','experiments','lac-fees','locobox','iacuc','cage-label'])assert(![...initial.keys()].some(path=>path.split('?')[0].endsWith('/'+name+'.js')),name);
 assert(initial.size<=67);
});
test('all startup and lazy screen imports retain one datastore and auth module URL',async()=>{
 const all=new Set(initial.keys());
 for(const match of app.matchAll(/import\('(\.\/[^']+)'\)/g))for(const href of (await graph(new URL(match[1],appURL))).keys())all.add(href);
 for(const name of ['data-store.js','cloud-provider.js','cloud-intents.js'])assert.equal([...all].filter(path=>path.split('?')[0].endsWith('/'+name)).length,1,name);
});
test('early module hints request only already-required Cages and authentication code',()=>{
 const hints=[...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map(m=>new URL(m[1],appURL).href);assert.equal(hints.length,3);for(const hint of hints)assert(initial.has(hint),hint);
});
test('the first loading panel is styled in HTML without waiting for JS or blocking stylesheets',()=>{
 assert.match(html,/<html[^>]+data-loading-shell/);assert.match(html,/<style>[\s\S]*html\[data-loading-shell\] progress/);
 assert.match(html,/<progress aria-label="Loading Mouse Data"/);assert.match(html,/<p id="shell-loading-status" role="status">Loading the workspace/);
 const sheets=[...html.replace(/<noscript>[\s\S]*?<\/noscript>/g,'').matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m=>m[0]);
 assert.equal(sheets.length,1);assert.match(sheets[0],/media="print"/);assert.match(sheets[0],/this.media='all'/);assert.match(sheets[0],/onerror="[^"]*removeAttribute\('data-loading-shell'\)/);
 assert.doesNotMatch(html,/href="\.\/(planner-layout|strain-management)\.css/);
});
function fixture(){
 const wait=new Map(),calls=[],main={innerHTML:''},env={route:'experiments',pageRenderGeneration:1,cloud:{id:'one'},document:{querySelector:()=>null,createElement:()=>({dataset:{}}),head:{appendChild(){}}},$:()=>main,titles:{experiments:'Experiments',cages:'Cages'},managedViewKey(){return env.route;},labUserDirectoryContext:state=>state.id,panel:(title,body)=>title+body,button:(label,action)=>`<button data-action="${action}">${label}</button>`,render(){calls.push('render');env.pageRenderGeneration++;},load(path){calls.push(path);return new Promise((resolve,reject)=>wait.set(path,{resolve,reject}));}};
 const start=app.indexOf('const sectionModules = new Map();'),end=app.indexOf('store.setPrimaryCloudPolicy?.();');
 const code=app.slice(start,end).replace(/import\('(\.\/[^']+)'\)/g,"load('$1')");
 new Function('env',`with(env){${code};env.gate=sectionRouteGate;env.loadSection=loadSectionModule;env.retry=()=>{sectionLoadFailure=null;return sectionRouteGate();};env.sections=loadedSections;}`)(env);
 return{env,main,calls,wait,resolve(path){const bindings=Object.fromEntries(['renderExperiments','experimentHelpHTML','hasExperimentDrafts','resetExperimentSourceView'].map(k=>[k,()=>{}]));wait.get(path).resolve(bindings);}};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
test('specialist code loads once only when that menu is opened',async()=>{
 const h=fixture();assert.deepEqual(h.calls,[]);assert(h.env.gate());assert(h.env.gate());assert.equal(h.calls.length,1);assert.match(h.main.innerHTML,/Opening this section/);h.resolve('./experiments.js?v=132');await settle();assert(h.env.sections.has('experiments'));assert.equal(h.env.gate(),false);assert.equal(h.calls.filter(x=>x==='render').length,1);
});
test('late code cannot overwrite a changed menu, render generation or account',async()=>{
 for(const change of [h=>{h.env.route='cages';},h=>{h.env.pageRenderGeneration++;},h=>{h.env.cloud={id:'two'};}]){const h=fixture();h.env.gate();h.main.innerHTML='New view';change(h);h.resolve('./experiments.js?v=132');await settle();assert.equal(h.main.innerHTML,'New view');assert(!h.calls.includes('render'));}
});
test('a failed section load shows Retry, releases its failed promise, and can recover',async()=>{
 const h=fixture();h.env.gate();h.wait.get('./experiments.js?v=132').reject(Error('offline'));await settle();assert.match(h.main.innerHTML,/section-retry/);assert(h.env.retry());assert.equal(h.calls.filter(x=>x==='./experiments.js?v=132').length,2);h.resolve('./experiments.js?v=132');await settle();assert(h.env.sections.has('experiments'));assert.equal(h.env.gate(),false);
});
function cacheFixture(){
 const callbacks=[],calls=[],env={startupLoading:true,cachedPreview:false,cloud:{mode:'cloud'},cloudReady:false,document:{hidden:false,addEventListener(){}},window:{addEventListener(){}},navigator:{serviceWorker:{register:async path=>calls.push(path)}},location:{protocol:'https:'},manualPullPending:false,managedLoadState:null,historyLoadState:null,setTimeout:fn=>callbacks.push(fn)};
 const start=app.indexOf('let shellCacheScheduled=false;'),end=app.indexOf('function recoveryContext(){');new Function('env',`with(env){${app.slice(start,end)};env.queue=queueShellCache;}`)(env);return{env,calls,callbacks};
}
test('offline shell caching waits for verified current records and runs in background',async()=>{
 const h=cacheFixture();h.env.queue();assert.equal(h.callbacks.length,0);h.env.startupLoading=false;h.env.cachedPreview=true;h.env.queue();assert.equal(h.callbacks.length,0);h.env.cachedPreview=false;h.env.queue();assert.equal(h.callbacks.length,0);h.env.cloudReady=true;h.env.queue();assert.equal(h.callbacks.length,1);assert.deepEqual(h.calls,[]);h.callbacks.shift()();await settle();assert.deepEqual(h.calls,['./sw.js']);h.env.queue();assert.equal(h.callbacks.length,0);
});
test('a newly busy or hidden document does not begin a background worker install',()=>{
 for(const key of ['hidden','manualPullPending','managedLoadState','historyLoadState']){const h=cacheFixture();h.env.startupLoading=false;h.env.cloudReady=true;h.env.queue();if(key==='hidden')h.env.document.hidden=true;else h.env[key]=true;h.callbacks.shift()();assert.deepEqual(h.calls,[]);}
});

test('a completed section render can reschedule a worker install skipped during record loading',async()=>{
 const h=cacheFixture();h.env.startupLoading=false;h.env.cloudReady=true;h.env.queue();h.env.managedLoadState={};h.callbacks.shift()();assert.deepEqual(h.calls,[]);h.env.managedLoadState=null;h.env.queue();assert.equal(h.callbacks.length,1);h.callbacks.shift()();await settle();assert.deepEqual(h.calls,['./sw.js']);
 assert.match(app,/if\(startupLoading\)\{renderStartupLoading\(\);return;\}\s*queueShellCache\(\);/);
});
