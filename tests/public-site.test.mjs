import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const pages=['index.html','members.html','previous-members.html','publications.html','lectures.html','resources.html','join.html','internal/index.html'];
test('public pages have a complete local navigation and no remote executable resources',async()=>{
 for(const page of pages){const text=await readFile(resolve(root,page),'utf8');assert.match(text,/<meta\b(?=[^>]*\bname=["']referrer["'])(?=[^>]*\bcontent=["']no-referrer["'])[^>]*>/i);assert.match(text,/<h1[ >]/);
  for(const match of text.matchAll(/(?:src|href)="([^"]+)"/g)){
   const url=new URL(match[1].replaceAll('&amp;','&'),`https://braintimelab.github.io/${page}`);
   if(url.origin!=='https://braintimelab.github.io')continue;
   const path=decodeURIComponent(url.pathname).replace(/^\//,'');const local=resolve(root,path.endsWith('/')?path+'index.html':path||'index.html');assert((await stat(local)).isFile(),`${page}: ${path}`);
  }
  assert(!/<script[^>]+src="https?:/i.test(text));
 }
 const css=await readFile(resolve(root,'assets/site.css'),'utf8');assert(!/@import/.test(css));
});
test('published mouse app exactly matches its public asset list and never contains secret credentials',async()=>{
 const list=(await readFile(resolve(root,'mouse-data-files.txt'),'utf8')).trim().split('\n');
 async function files(dir,prefix=''){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){assert(!e.isSymbolicLink());if(e.isDirectory())result.push(...await files(resolve(dir,e.name),prefix+e.name+'/'));else result.push(prefix+e.name);}return result;}
 assert.deepEqual((await files(resolve(root,'mouse-data'))).sort(),list.slice().sort());
 for(const path of list.filter(p=>/\.(js|html|css|json|webmanifest)$/.test(p))){const text=await readFile(resolve(root,'mouse-data',path),'utf8');assert(!/PRIVATE KEY-----|sb_secret_[A-Za-z0-9_-]{20,}/.test(text));
  for(const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)){const claims=JSON.parse(Buffer.from(match[1],'base64url').toString());assert.equal(claims.role,'anon');}
 }
});
