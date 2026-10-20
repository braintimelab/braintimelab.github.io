import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../mouse-data/app.js',import.meta.url),'utf8');
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function fixture(){
 const pending=new Map(),calls=[],nodes=new Map(),env={pageRenderGeneration:1,context:'member-one',settingsAccessContext:()=>env.context,$:id=>nodes.get(id),load:path=>{calls.push(path);return new Promise((resolve,reject)=>pending.set(path,{resolve,reject}));}};
 const start=app.indexOf('const settingsComponentModules='),end=app.indexOf('// Load specialist screens only when opened.',start);
 const code=app.slice(start,end).replace(/import\('(\.\/[^']+)'\)/g,"load('$1')");
 new Function('env',`with(env){${code};env.mount=renderSettingsComponent;env.clear=clearSettingsComponent;}`)(env);
 return {env,calls,pending,node(id){const node={id,innerHTML:'',onclick:null,isConnected:true};nodes.set(id,node);return node;},resolve(path,module){pending.get(path).resolve(module);}};
}
test('Cages startup excludes all Settings-only renderer modules',()=>{
 const initial=app.slice(0,app.indexOf('// Settings code is requested'));
 for(const name of ['user-management','lab-members','access-logs','account-setup','account-acronym'])assert(!new RegExp(`from ['"]\\./${name}\\.js`).test(initial),name);
});
test('only requested Settings panels load, with one module download for simultaneous mounts',async()=>{
 const h=fixture(),one=h.node('one'),two=h.node('two');assert.deepEqual(h.calls,[]);
 h.env.mount('users',one,{});h.env.mount('users',two,{});assert.equal(h.calls.length,1);assert.match(one.innerHTML,/Opening this panel/);
 let drawn=0;h.resolve('./user-management.js?v=171',{renderUserManagement(){drawn++;}});await settle();assert.equal(drawn,2);
 h.env.mount('users',one,{});assert.equal(h.calls.length,1);assert.equal(drawn,3);
});
test('a panel resolving after navigation, identity change, host replacement or clear cannot render',async()=>{
 for(const change of [(h,n)=>h.env.pageRenderGeneration++,(h,n)=>h.env.context='member-two',(h,n)=>{n.isConnected=false;},(h,n)=>h.node(n.id),(h,n)=>h.env.clear('account',n)]){
  const h=fixture(),node=h.node('profile');let drawn=0;h.env.mount('account',node,{});change(h,node);h.resolve('./account-setup.js?v=162',{renderAccountSetup(){drawn++;},clearAccountSetup(){}});await settle();assert.equal(drawn,0);
 }
});
test('deferred access logs retain cleanup before and after the module resolves',async()=>{
 const h=fixture(),node=h.node('logs');let drawn=0,cleaned=0;const module={renderAccessLogs(){drawn++;return ()=>{cleaned++;};}};
 const cancel=h.env.mount('access',node,{});cancel();h.resolve('./access-logs.js?v=171',module);await settle();assert.equal(drawn,0);
 const clear=h.env.mount('access',node,{});assert.equal(drawn,1);clear();clear();assert.equal(cleaned,1);
});
test('failed panel code has an isolated Retry without rebuilding other Settings fields',async()=>{
 const h=fixture(),node=h.node('members'),other=h.node('password');other.innerHTML='typed input stays';h.env.mount('members',node,{});h.pending.get('./lab-members.js?v=171').reject(Error('offline'));await settle();assert.match(node.innerHTML,/Retry/);
 node.onclick({target:{closest:()=>true},preventDefault(){},stopPropagation(){}});assert.equal(h.calls.length,2);h.resolve('./lab-members.js?v=171',{renderLabMembers(host){host.innerHTML='Members';}});await settle();assert.equal(node.innerHTML,'Members');assert.equal(other.innerHTML,'typed input stays');
});
