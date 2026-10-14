import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {syncReagentsApp,REAGENTS_PUBLIC_FILES} from '../scripts/sync-reagents-app.mjs';

async function fixture(t) {
  const temp=await mkdtemp(join(tmpdir(),'reagents-package-test-'));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const source=join(temp,'source'),destinationRoot=join(temp,'public');
  await mkdir(join(source,'web'),{recursive:true});await mkdir(destinationRoot);
  for(const name of REAGENTS_PUBLIC_FILES) await writeFile(join(source,'web',name),`Synthetic public asset ${name}\n`);
  return {source,destinationRoot};
}

test('packaging copies exactly five explicit web files and never traverses source data',async t=>{
  const f=await fixture(t);
  await mkdir(join(f.source,'private'));await writeFile(join(f.source,'private','export.json'),'PRIVATE-TEST-ROW');
  await writeFile(join(f.source,'web','private-export.json'),'PRIVATE-TEST-ROW');
  await mkdir(join(f.source,'web','nested'));await writeFile(join(f.source,'web','nested','hidden.js'),'PRIVATE-TEST-ROW');
  await symlink(join(f.source,'private'),join(f.source,'web','ignored-private-link'));
  const result=await syncReagentsApp(f);
  assert.deepEqual((await readdir(result.output)).sort(),[...REAGENTS_PUBLIC_FILES]);
  assert.equal(await readFile(join(f.destinationRoot,'reagents-files.txt'),'utf8'),REAGENTS_PUBLIC_FILES.join('\n')+'\n');
  for(const name of REAGENTS_PUBLIC_FILES) assert.equal(await readFile(join(result.output,name),'utf8'),`Synthetic public asset ${name}\n`);
});

test('missing required asset fails before changing an existing package',async t=>{
  const f=await fixture(t);await syncReagentsApp(f);
  await writeFile(join(f.source,'web','app.js'),'Changed app');await rm(join(f.source,'web','model.js'));
  await assert.rejects(syncReagentsApp(f),{code:'ENOENT'});
  assert.equal(await readFile(join(f.destinationRoot,'reagents','app.js'),'utf8'),'Synthetic public asset app.js\n');
});

test('allowed source symlinks and unexpected destination files are rejected, not copied or deleted',async t=>{
  const f=await fixture(t);await rm(join(f.source,'web','model.js'));
  const secret=join(f.source,'secret.json');await writeFile(secret,'PRIVATE-TEST-ROW');await symlink(secret,join(f.source,'web','model.js'));
  await assert.rejects(syncReagentsApp(f),/without symlinks/);
  await rm(join(f.source,'web','model.js'));await writeFile(join(f.source,'web','model.js'),'Public model');
  await mkdir(join(f.destinationRoot,'reagents'));await writeFile(join(f.destinationRoot,'reagents','unexpected.json'),'Preserve me');
  await assert.rejects(syncReagentsApp(f),/Unexpected file/);
  assert.equal(await readFile(join(f.destinationRoot,'reagents','unexpected.json'),'utf8'),'Preserve me');
});

test('symlinked output directory, asset and file manifest cannot overwrite an outside target',async t=>{
  const f=await fixture(t),outside=join(f.destinationRoot,'outside');await mkdir(outside);
  await symlink(outside,join(f.destinationRoot,'reagents'));await assert.rejects(syncReagentsApp(f),/without symlinks/);
  await rm(join(f.destinationRoot,'reagents'));await mkdir(join(f.destinationRoot,'reagents'));
  const victim=join(outside,'victim');await writeFile(victim,'Preserve me');
  await symlink(victim,join(f.destinationRoot,'reagents','app.js'));await assert.rejects(syncReagentsApp(f),/without symlinks/);
  await rm(join(f.destinationRoot,'reagents','app.js'));
  await symlink(victim,join(f.destinationRoot,'reagents-files.txt'));await assert.rejects(syncReagentsApp(f),/without symlinks/);
  assert.equal(await readFile(victim,'utf8'),'Preserve me');
});

test('privileged/user JWTs and secret key markers are refused before publication',async t=>{
  const f=await fixture(t);
  const jwt=claims=>`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`;
  for(const value of ['sb_secret_synthetic','-----BEGIN PRIVATE KEY-----',jwt({role:'service_role'}),jwt({role:'authenticated',sub:'synthetic-user'})]) {
    await writeFile(join(f.source,'web','app.js'),value);await assert.rejects(syncReagentsApp(f),/credential|token/);
  }
  await writeFile(join(f.source,'web','app.js'),jwt({role:'anon'}));
  await syncReagentsApp(f);
});
