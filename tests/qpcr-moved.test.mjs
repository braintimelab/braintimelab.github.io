import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const canonical='https://braintimedisk.tail933238.ts.net:10000/qpcr/';
// A public-only release checkout keeps NAS sources in the enclosing workspace.
const sourceRoot=await (async()=>{for(const relative of ['../../','../../../../']){const candidate=new URL(relative,import.meta.url);try{if((await stat(new URL('braintime-lab-notes/public/qpcr.html',candidate))).isFile())return candidate;}catch{}}throw Error('The maintained NAS qPCR source is unavailable to this check.');})();

test('retired qPCR entry is a static moved notice with no executable legacy assets or automatic forwarding',async()=>{
  const directory=path.join(root,'qpcr-calculator');
  assert.deepEqual(await readdir(directory),['index.html']);
  const html=await readFile(path.join(directory,'index.html'),'utf8');
  assert.match(html,/<html lang="en">/);
  assert.match(html,/<meta name="viewport"/);
  assert.match(html,/<meta name="referrer" content="no-referrer">/);
  assert.match(html,/<section[^>]*aria-labelledby="moved-heading">/);
  assert.match(html,/<h1 id="moved-heading">qPCR Calculator has moved<\/h1>/);
  assert.match(html,/printable 96-well plate designer/);
  assert.equal([...html.matchAll(new RegExp('href="'+canonical.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"','g'))].length,1);
  assert.doesNotMatch(html,/<script\b|<form\b|http-equiv="refresh"|(?:app|model|styles)\.js|(?:location|window)\.|[?&](?:return|redirect|next)=/i);
  for(const [,value]of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    const url=new URL(value,'https://braintimelab.github.io/qpcr-calculator/');
    if(url.origin==='https://braintimelab.github.io'){
      const local=path.join(root,url.pathname.slice(1),url.pathname.endsWith('/')?'index.html':'');
      assert((await stat(local)).isFile(),value);
    }else assert.equal(url.href,canonical);
  }
});

test('Lab tools and the current qPCR source retain the NAS calculator and its 96-well designer',async()=>{
  const portal=await readFile(path.join(root,'internal/index.html'),'utf8');
  assert.match(portal,/id="open-qpcr-calculator"[^>]*href="https:\/\/braintimedisk\.tail933238\.ts\.net:10000\/qpcr\/"/);
  const current=await readFile(new URL('braintime-lab-notes/public/qpcr.html',sourceRoot),'utf8');
  assert.match(current,/data-tab="plate"/);
  assert.match(current,/id="plate-print"/);
  assert((await stat(new URL('qpcr-calculator/plate.js',sourceRoot))).isFile());
  assert((await stat(new URL('braintime-lab-notes/public/qpcr-plate.js',sourceRoot))).isFile());
});
