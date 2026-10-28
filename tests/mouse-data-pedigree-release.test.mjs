// Offline release graph and actual service-worker VM tests. No network, browser,
// user data, production API or runtime source mutation is performed.
// NAS port: set PEDIGREE_WEB_ROOT, PEDIGREE_CACHE_PREPARATION,
// PEDIGREE_EXPECTED_TAG and optionally PEDIGREE_SERVER_FILE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const web=path.resolve(process.env.PEDIGREE_WEB_ROOT||fileURLToPath(new URL('../mouse-data/',import.meta.url)));
const prepPath=path.resolve(process.env.PEDIGREE_CACHE_PREPARATION||fileURLToPath(new URL('../../release/PUBLIC_CACHE_PREPARATION.json',import.meta.url)));
const tag=process.env.PEDIGREE_EXPECTED_TAG||'201-public-pedigree-r3';
const scope='https://release-test.invalid/mouse-data/';
const sha=value=>createHash('sha256').update(value).digest('hex');
const [html,worker,preparation]=await Promise.all([readFile(path.join(web,'index.html'),'utf8'),readFile(path.join(web,'sw.js'),'utf8'),readFile(prepPath,'utf8').then(JSON.parse)]);
const inlineMap=/<script\s+type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1];assert.ok(inlineMap,'One actual index import map is required');
assert.equal((html.match(/<script\s+type="importmap">/g)||[]).length,1);
const imports=JSON.parse(inlineMap).imports;
const normalizedMap=new Map(Object.entries(imports).map(([key,value])=>[new URL(key,scope).href,new URL(value,scope).href]));
const canonicalNames=['app.js','data-store.js','cloud-provider.js','family-explorer.js','family-pedigree.js','family-pedigree-view.js','family-pedigree-read.js','family-pedigree.css'];
const resolve=(specifier,from='index.html')=>{const raw=new URL(specifier,new URL(from,scope)).href;return normalizedMap.get(raw)||raw;};
const relative=url=>'./'+new URL(url).pathname.slice(new URL(scope).pathname.length)+new URL(url).search;
const eagerImports=source=>[
 ...source.matchAll(/(?:^|[;\n])\s*import(?!\s*\()\s*(?:[^;'"`]*?\bfrom\s*)?["']([^"']+)["']/g),
 ...source.matchAll(/(?:^|[;\n])\s*export\s*(?:\*|\{[^}]*\})[^;'"`]*?\bfrom\s*["']([^"']+)["']/g)
].map(m=>m[1]);
const sourceImports=source=>[...eagerImports(source),...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map(m=>m[1])];
async function inventory(dir,prefix=''){
 const files=[];for(const row of await readdir(dir,{withFileTypes:true})){const name=prefix+row.name;if(row.isDirectory())files.push(...await inventory(path.join(dir,row.name),name+'/'));else if(row.isFile())files.push(name);else assert.fail('Release shell contains a nonregular path '+name);}return files.sort();
}
const files=await inventory(web),modules=files.filter(name=>name.endsWith('.js')&&name!=='sw.js');
const sources=new Map(await Promise.all(modules.map(async name=>[name,await readFile(path.join(web,name),'utf8')])));
const urlKey=value=>typeof value==='string'?value:value?.url||value?.href;
const response=(body,type='basic',ok=true)=>({body,type,ok,clone(){return response(body,type,ok);}});
function actualWorker({networkType='basic',networkOK=true}={}){
 const events=new Map(),stores=new Map(),fetches=[],deleted=[],calls=[];
 const cacheFor=name=>{
  if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);
  return {values,async match(request){return values.get(urlKey(request));},async put(request,value){values.set(urlKey(request),value);},async keys(){return [...values.keys()].map(url=>({url}));},async delete(request){return values.delete(urlKey(request));}};
 };
 const caches={async open(name){return cacheFor(name);},async keys(){return [...stores.keys()];},async delete(name){deleted.push(name);return stores.delete(name);}};
 const sandbox={URL,Response:{error:()=>response('NETWORK_ERROR','error',false)},caches,fetch:async(request,options)=>{const url=urlKey(request);fetches.push({url,options});return response('NETWORK:'+url,networkType,networkOK);},self:{registration:{scope},clients:{async claim(){calls.push('claim');}},async skipWaiting(){calls.push('skipWaiting');},addEventListener(name,fn){assert.ok(!events.has(name),'Duplicate worker event '+name);events.set(name,fn);}}};
 vm.runInNewContext(worker+'\nglobalThis.releaseState={CACHE,SHELL,PRECACHE,REFRESH:[...REFRESH]};',sandbox,{filename:path.join(web,'sw.js'),timeout:1000});
 return {...sandbox.releaseState,stores,fetches,deleted,calls,cacheFor,
  async lifecycle(name){const waits=[];events.get(name)({waitUntil:p=>waits.push(p)});await Promise.all(waits);},
  async request(url,{method='GET'}={}){const waits=[];let intercepted=false,promise;events.get('fetch')({request:{url,method},waitUntil:p=>waits.push(p),respondWith:p=>{intercepted=true;promise=p;}});const result=intercepted?await promise:null;await Promise.all(waits);return {intercepted,result};}
 };
}
const sw=actualWorker();

test('preparation pins match actual index/worker/import-map CSP and declared release counts',()=>{
 assert.equal(preparation.tag,tag);assert.equal(preparation.index_sha256,sha(html));assert.equal(preparation.worker_sha256,sha(worker));
 assert.equal(preparation.shell_entries,sw.SHELL.length);assert.equal(preparation.precache_entries,sw.PRECACHE.length);
 assert.equal(preparation.importmap_csp_source,"'sha256-"+createHash('sha256').update(inlineMap).digest('base64')+"'");
 assert.equal(sw.CACHE,'colony-shell-v'+tag);assert.equal(sw.SHELL.length,new Set(sw.SHELL).size);assert.equal(sw.PRECACHE.length,new Set(sw.PRECACHE).size);
});

test('all changed JS/CSS aliases and active entry resolve to one exact new canonical identity',()=>{
 const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(m=>m[1]);assert.deepEqual(scripts,['./app.js?v='+tag]);
 for(const name of canonicalNames){const target='./'+name+'?v='+tag;assert.equal(preparation.canonical[name],target);assert.ok(sw.SHELL.includes(target),name+' SHELL');assert.ok(sw.REFRESH.includes(target),name+' REFRESH');
  for(const [key,value]of Object.entries(imports))if(new URL(key,scope).pathname===new URL('./'+name,scope).pathname)assert.equal(value,target,'Stale alias '+key);
  assert.equal(resolve('./'+name),new URL(target,scope).href);assert.equal(resolve(target),new URL(target,scope).href);
 }
 assert.match(html,new RegExp('href="\\./family-pedigree\\.css\\?v='+tag+'"'));
});

test('every actual static/lazy module edge exists and has a single canonical browser identity',async t=>{
 const identities=new Map();let edgeCount=0;
 for(const match of html.matchAll(/<(?:script|link)\b[^>]*>/g))if(/\btype="module"|\brel="modulepreload"/.test(match[0])){
  const ref=/\b(?:src|href)="([^"]+)"/.exec(match[0])?.[1];if(!ref)continue;const url=new URL(resolve(ref)),name=url.pathname.slice(new URL(scope).pathname.length);if(!identities.has(name))identities.set(name,new Set());identities.get(name).add(url.href);
 }
 for(const [name,source]of sources){
  assert.doesNotMatch(source,/\bimport\s*\(\s*(?!["'\s])/,name+' has an unverified computed import');
  for(const specifier of sourceImports(source)){
   assert.match(specifier,/^\.\.?\//,name+' imports an external/bare module');
   const url=new URL(resolve(specifier,name));assert.equal(url.origin,new URL(scope).origin);assert.ok(url.pathname.startsWith(new URL(scope).pathname),'Import escapes app root: '+name+' '+specifier);assert.equal(url.hash,'');
   const target=url.pathname.slice(new URL(scope).pathname.length);assert.ok(files.includes(target),name+' → '+specifier);assert.ok(sw.SHELL.includes(relative(url.href)),'Uncached import '+name+' → '+relative(url.href));
   if(!identities.has(target))identities.set(target,new Set());identities.get(target).add(url.href);edgeCount++;
  }
 }
 assert.ok(edgeCount>300,'Meaningful whole-app closure must be checked');
 t.diagnostic(`${modules.length} JavaScript modules; ${edgeCount} static/lazy import edges checked.`);
 t.diagnostic('module-source-set-sha256='+sha(JSON.stringify([...sources])));
 for(const [name,urls]of identities)assert.equal(urls.size,1,name+' has duplicate module identities: '+[...urls].join(', '));
 for(const name of modules){const urls=sw.SHELL.filter(ref=>new URL(ref,scope).pathname===new URL(name,scope).pathname);assert.equal(urls.length,1,'One cached URL for '+name);}
 for(const name of canonicalNames.filter(n=>n.endsWith('.js')))assert.equal([...identities.get(name)||[]][0],new URL('./'+name+'?v='+tag,scope).href,name);
});

test('precache contains each eager module dependency while lazy sections remain in the bounded shell',()=>{
 for(const ref of sw.PRECACHE){assert.ok(sw.SHELL.includes(ref),'Precache outside SHELL '+ref);const file=new URL(ref,scope).pathname.slice(new URL(scope).pathname.length);if(!file.endsWith('.js'))continue;
  const source=sources.get(file);assert.ok(source,ref);
  const eager=eagerImports(source);
  for(const specifier of eager)assert.ok(sw.PRECACHE.includes(relative(resolve(specifier,file))),'Missing eager dependency '+ref+' → '+specifier);
 }
 for(const name of ['family-pedigree.js','family-pedigree-view.js','family-pedigree-read.js','family-pedigree.css'])assert.ok(sw.PRECACHE.includes('./'+name+'?v='+tag));
});

test('dedicated lineage Worker retains its uncoupled 199 identity and direct engine dependency',()=>{
 const client=sources.get('lineage-recovery-worker-client.js'),workerSource=sources.get('lineage-recovery-worker.js');
 assert.match(client,/new URL\(['"]\.\/lineage-recovery-worker\.js\?v=199['"],\s*import\.meta\.url\)/);
 assert.ok(sw.SHELL.includes('./lineage-recovery-worker.js?v=199'));assert.ok(sw.SHELL.includes('./lineage-recovery.js?v=199'));
 assert.match(workerSource,/from\s*['"]\.\/lineage-recovery\.js\?v=199['"]/);assert.equal(sw.SHELL.filter(ref=>ref.startsWith('./lineage-recovery-worker.js?')).length,1);
});

test('shell is an exact local public-asset allowlist with no external/private/API/fixture data',async()=>{
 for(const ref of sw.SHELL){assert.match(ref,/^\.\//);const url=new URL(ref,scope);assert.equal(url.origin,new URL(scope).origin);assert.ok(url.pathname.startsWith(new URL(scope).pathname));assert.equal(url.hash,'');
  assert.deepEqual([...url.searchParams.keys()].filter(key=>key!=='v'),[]);assert.doesNotMatch(ref,/(?:private|fixture|snapshot|capture|\/rpc\/|\/api\/|rest\/v1|auth\/v1|\.json(?:\?|$)|\.sql(?:\?|$)|\.xlsx(?:\?|$))/i);
  const file=url.pathname.slice(new URL(scope).pathname.length);if(file)assert.ok((await stat(path.join(web,file))).isFile(),ref);
 }
 assert.ok(!sw.SHELL.some(ref=>ref==='./sw.js'));assert.ok(sw.SHELL.includes('./index.html'));assert.ok(sw.SHELL.includes('./manifest.webmanifest'));
});

test('actual worker refuses POSTs, private RPC/data URLs, other origins and noncanonical query variants',async()=>{
 const h=actualWorker(),app=new URL('./app.js?v='+tag,scope).href;
 for(const [url,method]of [[app,'POST'],[new URL('./rpc/get_family_pedigree_page',scope).href,'GET'],[new URL('/rest/v1/rpc/get_family_pedigree_page',scope).href,'POST'],[new URL('./private-snapshot.json',scope).href,'GET'],['https://provider.invalid/rest/v1/entity_records','GET'],[app+'&token=private','GET']])assert.equal((await h.request(url,{method})).intercepted,false,url);
 assert.deepEqual(h.fetches,[]);assert.equal(h.stores.size,0);
});

test('install refreshes changed modules even when old exact-URL cache entries exist, carrying only immutable public URLs',async()=>{
 const h=actualWorker(),old=h.cacheFor('colony-shell-previous'),current=h.cacheFor(h.CACHE);h.cacheFor('unrelated-private-cache').values.set('private://user-data',response('PRIVATE'));
 for(const ref of h.SHELL)old.values.set(new URL(ref,scope).href,response('OLD:'+ref));
 const changed='./family-explorer.js?v='+tag;current.values.set(new URL(changed,scope).href,response('WRONG_CURRENT_EXACT_ALIAS'));
 await h.lifecycle('install');
 for(const name of canonicalNames){const url=new URL('./'+name+'?v='+tag,scope).href;assert.equal(current.values.get(url)?.body,'NETWORK:'+url,name);assert.ok(h.fetches.some(row=>row.url===url&&row.options?.cache==='no-store'));}
 const immutable=new URL('./cloud-bridge.js?v=183',scope).href;assert.equal(current.values.get(immutable).body,'OLD:./cloud-bridge.js?v=183');assert.ok(!h.fetches.some(row=>row.url===immutable));
 assert.equal(current.values.has('private://user-data'),false);assert.ok(h.fetches.every(row=>h.SHELL.some(ref=>new URL(ref,scope).href===row.url)));assert.ok(h.calls.includes('skipWaiting'));
});

test('activation removes stale shell/private spill entries while preserving unrelated user caches',async()=>{
 const h=actualWorker(),cache=h.cacheFor(h.CACHE),privateURL=new URL('./rpc/get_family_pedigree_page',scope).href;
 h.cacheFor('colony-shell-old');h.cacheFor('unrelated-private-cache').values.set('private://user-data',response('PRIVATE'));
 const publicURL=new URL('./app.js?v='+tag,scope).href;cache.values.set(privateURL,response('BAD_SPILL'));cache.values.set(publicURL,response('PUBLIC'));
 await h.lifecycle('activate');assert.equal(h.stores.has('colony-shell-old'),false);assert.equal(h.stores.has('unrelated-private-cache'),true);assert.equal(cache.values.has(privateURL),false);assert.equal(cache.values.get(publicURL).body,'PUBLIC');assert.ok(h.calls.includes('claim'));
});

test('runtime immutable assets hit public cache while HTML remains network-first; opaque install cannot become active',async()=>{
 const h=actualWorker(),cache=h.cacheFor(h.CACHE),app=new URL('./app.js?v='+tag,scope).href,index=new URL('./index.html',scope).href;
 cache.values.set(app,response('CACHED_APP'));cache.values.set(index,response('OLD_HTML'));
 assert.equal((await h.request(app)).result.body,'CACHED_APP');assert.equal(h.fetches.length,0);
 assert.equal((await h.request(index)).result.body,'NETWORK:'+index);assert.equal(cache.values.get(index).body,'NETWORK:'+index);
 const bad=actualWorker({networkType:'opaque'});await assert.rejects(bad.lifecycle('install'),/shell could not be verified/);assert.ok(!bad.calls.includes('skipWaiting'));
});

if(process.env.PEDIGREE_SERVER_FILE)test('NAS import-map hash is pinned in gateway script policy without unsafe script sources',async()=>{
 const server=await readFile(process.env.PEDIGREE_SERVER_FILE,'utf8');assert.ok(server.includes(preparation.importmap_csp_source),'Gateway lacks current importmap CSP hash');
 const scriptPolicies=[...server.matchAll(/script-src[^;\n]+/g)].map(m=>m[0]);assert.ok(scriptPolicies.length);for(const policy of scriptPolicies)assert.doesNotMatch(policy,/unsafe-inline|unsafe-eval|https?:\/\//);
});
