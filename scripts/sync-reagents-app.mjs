// Copy a fixed, reviewed web allowlist only. This script never deploys.
import {readFile,writeFile,readdir,lstat,realpath,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REAGENTS_PUBLIC_FILES = Object.freeze([
  'app.js', 'index.html', 'inventory-export.js', 'manifest.webmanifest', 'model.js', 'orders.js', 'styles.css'
]);
const defaultRoot = fileURLToPath(new URL('../',import.meta.url));

async function ordinary(path,kind) {
  const stat = await lstat(path);
  if(stat.isSymbolicLink() || (kind==='directory' ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`Expected a regular ${kind}, without symlinks: ${path}`);
  }
}

function rejectSecrets(contents,name) {
  const text = contents.toString('utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsb_secret_[A-Za-z0-9_-]+/.test(text)) {
    throw new Error(`Private credential marker in public asset: ${name}`);
  }
  for(const token of text.matchAll(/\b(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g)) {
    try {
      const claims = JSON.parse(Buffer.from(token[1].split('.')[1],'base64url').toString('utf8'));
      if(claims.role === 'service_role' || claims.role === 'authenticated' || claims.sub) {
        throw new Error(`Privileged or user token in public asset: ${name}`);
      }
    } catch(error) {
      if(error.message.startsWith('Privileged or user token')) throw error;
    }
  }
}

export async function syncReagentsApp({source,destinationRoot=defaultRoot}) {
  if(!source) throw new Error('A Reagents source directory is required');
  const sourcePath = resolve(source), rootPath = resolve(destinationRoot);
  await ordinary(sourcePath,'directory');
  await ordinary(rootPath,'directory');
  const sourceRoot = await realpath(sourcePath), root = await realpath(rootPath);
  const web = join(sourceRoot,'web'), output = join(root,'reagents');
  await ordinary(web,'directory');
  // Read and validate every allowed input before modifying the existing package.
  // Extra source files (including private exports, SQL and tests) are never walked.
  const assets = new Map();
  for(const name of REAGENTS_PUBLIC_FILES) {
    const path = join(web,name);
    await ordinary(path,'file');
    const bytes = await readFile(path);
    if(bytes.length>2*1024*1024) throw new Error(`Public asset exceeds 2 MiB: ${name}`);
    rejectSecrets(bytes,name);
    assets.set(name,bytes);
  }
  try {
    await ordinary(output,'directory');
    for(const name of await readdir(output)) {
      if(!REAGENTS_PUBLIC_FILES.includes(name)) throw new Error(`Unexpected file in Reagents package: ${name}`);
      await ordinary(join(output,name),'file');
    }
  } catch(error) {
    if(error.code!=='ENOENT') throw error;
  }
  const manifestPath=join(root,'reagents-files.txt');
  try { await ordinary(manifestPath,'file'); } catch(error) { if(error.code!=='ENOENT') throw error; }
  await mkdir(output,{recursive:true});
  for(const [name,bytes] of assets) await writeFile(join(output,name),bytes);
  await writeFile(manifestPath,REAGENTS_PUBLIC_FILES.join('\n')+'\n');
  return {output,files:[...REAGENTS_PUBLIC_FILES]};
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if(process.argv.length!==3) throw new Error('Usage: node scripts/sync-reagents-app.mjs /path/to/reagents-app');
  const result=await syncReagentsApp({source:process.argv[2]});
  console.log(`Updated Reagents with ${result.files.length} approved public assets. Review and test before committing.`);
}
