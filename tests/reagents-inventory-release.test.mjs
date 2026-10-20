import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const before={
  "mouse-data/app.js": "2b473ed1e543c03f82b36544ae84fa84223f7ac3546a61239176a5fa4193ce7b",
  "mouse-data/index.html": "8c7859c8b94d59023e119a43193719c033de207ea7cb25a38edee731cf4d5e7e",
  "mouse-data/sw.js": "d422ce4d14ab0378c4cf3638ef69170c819e76fa5f49594a8b173006930089e0",
  "mouse-data/data-store.js": "3ab6637c1b031bbb79fa9ca2ec79d274450eb7bcf4cb205439f2fd2fa5e89617",
  "internal/index.html": "a0ca0d00ad6a4202c0c6522cb2d64540ee118f9778c42a1c8e6b3f6adf720348",
  "internal/portal.js": "e598536c590bfb6f192c88dcd3f14c1689f1687c5f59f47b6ac81b2617d2ba98"
};

test('Mouse v178 behavior is preserved outside the single owner-control module import and cache entry URLs',async()=>{
 const app=await read('mouse-data/app.js');assert.equal(digest(app.replace("import('./user-management.js?v=179')","import('./user-management.js?v=175')")),before['mouse-data/app.js']);
 const index=await read('mouse-data/index.html');assert.equal(digest(index.replace('src="./app.js?v=179"','src="./app.js?v=178"')),before['mouse-data/index.html']);
 const worker=await read('mouse-data/sw.js');assert.equal(digest(worker.replace('colony-shell-v179','colony-shell-v178').replaceAll('"./app.js?v=179"','"./app.js?v=178"').replaceAll('"./user-management.js?v=179"','"./user-management.js?v=175"')),before['mouse-data/sw.js']);
 for(const path of ['mouse-data/data-store.js','internal/index.html','internal/portal.js'])assert.equal(digest(await read(path)),before[path],path);
});

test('Reagents and owner Settings load only their reviewed new module URLs',async()=>{
 const app=await read('reagents/app.js'),index=await read('reagents/index.html'),exports=await read('reagents/inventory-export.js');
 assert.match(index,/src="app\.js\?v=179"/);assert.match(app,/from '\.\/model\.js\?v=11'/);assert.match(app,/from '\.\/inventory-export\.js\?v=9'/);assert.match(exports,/from '\.\/model\.js\?v=11'/);assert.doesNotMatch(app,/serviceWorker\.register/);
});
