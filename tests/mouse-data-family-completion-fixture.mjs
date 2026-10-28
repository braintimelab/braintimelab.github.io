// Portable synthetic source loader. No application startup, account or data store.
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const source=fileURLToPath(new URL('../mouse-data/',import.meta.url));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-family-completion-'));
await fs.writeFile(path.join(temporary,'package.json'),'{"type":"module"}\n');
await fs.cp(source,path.join(temporary,'web'),{recursive:true});
export const appSource=await fs.readFile(path.join(source,'app.js'),'utf8');
export const loadMouseData=name=>import(pathToFileURL(path.join(temporary,'web',name)).href);
test.after(()=>fs.rm(temporary,{recursive:true,force:true}));
