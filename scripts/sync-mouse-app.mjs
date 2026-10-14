// Assemble only the mouse application's reviewed public assets. Never deploys.
import {readFile,writeFile,readdir,mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!process.argv[2])throw new Error('Usage: node scripts/sync-mouse-app.mjs /path/to/colony-app');
const source=resolve(process.argv[2]);
const list=(await readFile(resolve(source,'publication-files.txt'),'utf8')).trim().split('\n');
if(new Set(list).size!==list.length||list.some(p=>!p||p.startsWith('/')||p.split('/').includes('..')))throw Error('Invalid source allowlist');
// Require every tracked source to have passed the source repo's publication review.
const tracked=execFileSync('git',['ls-files','-z'],{cwd:source,encoding:'utf8'}).split('\0').filter(Boolean);
if(tracked.some(p=>!list.includes(p)))throw Error('Source has unapproved tracked files');
const temp=await mkdtemp(resolve(tmpdir(),'braintime-public-app-'));
for(const path of list){const dest=resolve(temp,path);await mkdir(dirname(dest),{recursive:true});await copyFile(resolve(source,path),dest);}
execFileSync(process.execPath,['scripts/prepare-pages.mjs'],{cwd:temp,stdio:'inherit'});
async function files(dir,prefix=''){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('Symlink in public package');const p=prefix+e.name;if(e.isDirectory())out.push(...await files(resolve(dir,e.name),p+'/'));else out.push(p);}return out;}
const expected=list.filter(p=>p.startsWith('web/')).map(p=>p.slice(4)).concat('.nojekyll').sort();
const output=resolve(root,'mouse-data');await mkdir(output,{recursive:true});
const oldListPath=resolve(root,'mouse-data-files.txt');let oldList=[];try{oldList=(await readFile(oldListPath,'utf8')).trim().split('\n');}catch(e){if(e.code!=='ENOENT')throw e;}
for(const path of await files(output))if(!expected.includes(path)&&!oldList.includes(path))throw Error('Unexpected file in mouse-data: '+path);
for(const path of oldList){if(!path||path.startsWith('/')||path.split('/').includes('..'))throw Error('Invalid previous public file list');if(!expected.includes(path))await rm(resolve(output,path),{force:true});}
for(const path of expected){const dest=resolve(output,path);await mkdir(dirname(dest),{recursive:true});await copyFile(resolve(temp,'_site',path),dest);}
await writeFile(oldListPath,expected.join('\n')+'\n');
console.log(`Updated mouse-data with ${expected.length} approved assets. Review and test before committing.`);
console.log(`Reviewed standalone package: ${resolve(temp,'_site')}`);
