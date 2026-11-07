import {lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';

// Website-owned routing must survive a later publication of a Limited app.
export async function retainedAppEntry(directory,app) {
  if(!['mouse-data','reagents'].includes(app))throw Error('Unknown public app');
  try {
    const folder=await lstat(directory),file=join(directory,'index.html');
    if(!folder.isDirectory()||folder.isSymbolicLink())throw Error('Expected an ordinary app directory without symlinks');
    const stat=await lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Expected an ordinary entry file without symlinks');
    if(stat.size>65536)return null;
    const bytes=await readFile(file);
    return bytes.includes(Buffer.from(`<body data-app-entry="${app}">`))?bytes:null;
  } catch(error) {if(error.code==='ENOENT')return null;throw error;}
}
