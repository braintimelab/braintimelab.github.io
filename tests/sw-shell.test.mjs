import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import vm from 'node:vm';

// After changing import versions: node tests/sw-shell.test.mjs --update-shell
// This explicit mode updates only the public worker's cache name and shell list.
const web=new URL('../mouse-data/',import.meta.url),worker=new URL('sw.js',web);
const scope='https://example.test/mouse-data/';
async function publicFiles(directory='',files=[]){
  for(const entry of await readdir(new URL(directory,web),{withFileTypes:true})){
    const path=directory+entry.name;
    if(entry.isDirectory())await publicFiles(path+'/',files);
    else if(path!=='sw.js'&&/\.(?:html|js|css|webmanifest|png|svg|ico)$/.test(path))files.push(path);
  }
  return files;
}
async function currentShell(){
  const files=await publicFiles(),paths=new Set(['./',...files.map(path=>'./'+path)]),referenced=new Set();
  for(const path of files.filter(path=>/\.(?:js|html|css|webmanifest)$/.test(path))){
    const source=await readFile(new URL(path,web),'utf8');
    const refs=[...source.matchAll(/["'](\.\.?\/[^"'`\s]+\.(?:html|js|css|webmanifest|png|svg|ico)(?:\?[^"'`\s]*)?)["']/g)].map(match=>match[1]);
    if(path.endsWith('.css'))refs.push(...[...source.matchAll(/url\(\s*["']?(\.\.?\/[^"')\s]+)["']?\s*\)/g)].map(match=>match[1]));
    for(const ref of refs){
      const target=new URL(ref,new URL(path,scope));
      assert(target.href.startsWith(scope),`${path} depends on a file outside the app shell: ${ref}`);
      const local=target.pathname.slice(new URL(scope).pathname.length);
      if(local==='sw.js')continue;
      assert(files.includes(local),`${path} references a missing public asset: ${ref}`);
      paths.add('./'+local+target.search);
      referenced.add('./'+local+target.search);
    }
  }
  // A versioned module and its raw alias contain identical bytes. Preload only
  // URLs the app uses, retaining a raw URL only when it is referenced itself.
  const versioned=new Set([...referenced].filter(path=>path.includes('?')).map(path=>path.split('?')[0]));
  return [...paths].filter(path=>!versioned.has(path)||referenced.has(path)).sort();
}
async function starterShell(){
 const pending=['./','./index.html'],seen=new Set();
 while(pending.length){
  const path=pending.pop();if(seen.has(path))continue;seen.add(path);
  const local=path==='./'?'index.html':path.slice(2).split('?')[0];
  const source=await readFile(new URL(local,web),'utf8');let refs=[];
  if(local.endsWith('.js'))refs=[...source.matchAll(/(?:\bfrom|\bimport)\s*['"](\.\/?[^'"]+)['"]/g)].map(m=>m[1]);
  else if(local.endsWith('.html'))refs=[...source.matchAll(/<(?:link|script|img)\b[^>]*(?:href|src)="(\.[^"]+)"[^>]*>/g)].map(m=>m[1]);
  else if(local.endsWith('.css'))refs=[...source.matchAll(/url\(\s*['"]?(\.[^"')\s]+)['"]?\s*\)/g)].map(m=>m[1]);
  else if(local.endsWith('.webmanifest'))refs=JSON.parse(source).icons.map(icon=>icon.src);
  for(const ref of refs){const target=new URL(ref,new URL(local,scope));assert(target.href.startsWith(scope));const result='./'+target.pathname.slice(new URL(scope).pathname.length)+target.search;if(result!=='./sw.js')pending.push(result);}
 }
 return [...seen].sort();
}
const expected=await currentShell(),starter=await starterShell();
const indexSource=await readFile(new URL('index.html',web),'utf8');
const releaseVersion=indexSource.match(/src="\.\/app\.js\?v=(\d+)"/)?.[1];
const appPath=`./app.js?v=${releaseVersion}`;
if(process.argv.includes('--update-shell')){
  assert(releaseVersion,'The index requires an explicit app release version.');
  const source=await readFile(worker,'utf8');
  await writeFile(worker,source.replace(/^const CACHE = .*;$/m,`const CACHE = 'colony-shell-v${releaseVersion}';`).replace(/^const SHELL = .*;$/m,`const SHELL = ${JSON.stringify(expected)};`).replace(/^const PRECACHE = .*;$/m,`const PRECACHE = ${JSON.stringify(starter)};`));
}
const source=await readFile(worker,'utf8');
function harness({network=async()=>new Response('online')}={}){
  const listeners=new Map(),stores=new Map(),writes=[],deleted=[],installed=[];
  const absolute=value=>typeof value==='string'?new URL(value,scope).href:value.url;
  const store=name=>{
    if(!stores.has(name))stores.set(name,new Map());const rows=stores.get(name);
    return {async addAll(paths){installed.push(...paths);for(const path of paths)rows.set(absolute(path),new Response('installed'));},async put(request,response){writes.push(absolute(request));rows.set(absolute(request),response);},async match(request){return rows.get(absolute(request));},async keys(){return [...rows.keys()].map(url=>({url}));},async delete(request){return rows.delete(absolute(request));}};
  };
  const context={URL,Response,fetch:network,caches:{async open(name){return store(name);},async keys(){return [...stores.keys()];},async delete(name){deleted.push(name);return stores.delete(name);}},self:{registration:{scope},addEventListener:(type,handler)=>listeners.set(type,handler),async skipWaiting(){},clients:{async claim(){}}}};
  vm.runInNewContext(source+'\nglobalThis.shellConfig={CACHE,SHELL,PRECACHE};',context);
  return {listeners,stores,store,writes,deleted,installed,config:context.shellConfig,async lifecycle(type){let pending;listeners.get(type)({waitUntil(value){pending=value;}});await pending;},async request(url,{method='GET'}={}){let response,pending=[];listeners.get('fetch')({request:{url:new URL(url,scope).href,method},respondWith(value){response=value;},waitUntil(value){pending.push(value);}});const result=response===undefined?undefined:await response;await Promise.all(pending);return result;}};
}

test('shell is the current public files plus exact referenced versions, with no obsolete aliases',()=>{
  const {config}=harness();
  assert.deepEqual([...config.SHELL],expected);
  assert.equal(config.SHELL.length,new Set(config.SHELL).size);
  assert.equal(config.CACHE,`colony-shell-v${releaseVersion}`);
  assert(!config.SHELL.some(path=>/https?:|\/api\/|\.json$/.test(path)));
  const modules=config.SHELL.filter(path=>path.split('?')[0].endsWith('.js'));
  assert.equal(modules.length,new Set(modules.map(path=>path.split('?')[0])).size,'one cached URL per module');
  assert(modules.every(path=>/\?v=\d+$/.test(path)),'each cached module has an explicit version');
});

test('install preloads only the starter dependency closure and leaves optional sections on demand',async()=>{
  const h=harness();await h.lifecycle('install');
  assert.deepEqual(h.installed,starter);
  assert.deepEqual([...h.config.PRECACHE],starter);
  for(const name of ['experiments.js','cryopreservation.js','brainbot.js','locobox.js','lac-fees.js','iacuc.js','breeding-planner.js','cage-label.js'])assert(!starter.some(path=>path.startsWith('./'+name+'?')),name);
  for(const path of starter)assert(await h.store(h.config.CACHE).match(path),path);
});

test('activate deletes old shell caches and stale aliases while preserving unrelated/private caches',async()=>{
  const h=harness();
  await h.store('colony-shell-obsolete').put('./app.js?v=1',new Response('old'));
  await h.store('unrelated-private-cache').put('./private-data',new Response('private'));
  await h.store(h.config.CACHE).put('./app.js?v=1',new Response('obsolete alias'));
  await h.store(h.config.CACHE).put(appPath,new Response('current'));
  await h.lifecycle('activate');
  assert.deepEqual(h.deleted,['colony-shell-obsolete']);
  assert(await h.store('unrelated-private-cache').match('./private-data'));
  assert.equal(await h.store(h.config.CACHE).match('./app.js?v=1'),undefined);
  assert.equal(await (await h.store(h.config.CACHE).match(appPath)).text(),'current');
});

test('worker ignores API/private/foreign requests and non-GET requests',async()=>{
  let fetched=0;const h=harness({network:async()=>{fetched++;return new Response('unexpected');}});
  for(const url of ['https://project.supabase.co/rest/v1/entity_records','./private-data.json','./app.js?unlisted=1','https://other.test/app.js'])assert.equal(await h.request(url),undefined);
  assert.equal(await h.request(appPath,{method:'POST'}),undefined);
  assert.equal(fetched,0);assert.deepEqual(h.writes,[]);
});

test('successful same-origin shell responses refresh only the current cache',async()=>{
  const response={ok:true,type:'basic',clone:()=>new Response('fresh shell')};
  const h=harness({network:async()=>response});
  assert.equal(await h.request(appPath),response);
  assert.deepEqual(h.writes,[scope+appPath.slice(2)]);
  assert.equal(await (await h.store(h.config.CACHE).match(appPath)).text(),'fresh shell');
});

test('repeat openings reuse exact release assets without a network request; HTML still refreshes',async()=>{
  let fetched=0;const h=harness({network:async()=>{fetched++;return new Response('latest HTML');}});
  await h.store(h.config.CACHE).put(appPath,new Response('verified release'));
  await h.store(h.config.CACHE).put('./index.html',new Response('older HTML'));
  h.writes.length=0;
  assert.equal(await (await h.request(appPath)).text(),'verified release');
  assert.equal(fetched,0);assert.deepEqual(h.writes,[]);
  assert.equal(await (await h.request('./index.html')).text(),'latest HTML');
  assert.equal(fetched,1);
});

test('offline fallback only uses this release cache, never a previous shell',async()=>{
  const h=harness({network:async()=>{throw new Error('offline');}});
  await h.store('colony-shell-obsolete').put(appPath,new Response('old shell'));
  assert.equal((await h.request(appPath)).type,'error');
  await h.store(h.config.CACHE).put(appPath,new Response('current shell'));
  assert.equal(await (await h.request(appPath)).text(),'current shell');
});
