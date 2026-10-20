import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as guest from '../mouse-data/guest-access.js';
import * as access from '../mouse-data/app-access.js';
import * as manager from '../mouse-data/permissions.js';

const source=await readFile(new URL('../mouse-data/user-management.js',import.meta.url),'utf8');
const user=(id,extra={})=>({user_id:id,email:id+'@example.invalid',name:id,role:'editor',export_level:'high',active:true,status:'active',app_permissions_verified:true,updated_at:'2026-10-21T00:00:00Z',notes_permissions:{},mouse_permissions:{},reagents_permissions:{},...extra});
async function fixture(users,{text=source}={}){
 const calls=[],container={innerHTML:''},context=vm.createContext({...guest,...access,...manager,structuredClone,console});
 vm.runInContext(text.replace(/^import .*;\n/gm,'').replace('export async function renderUserManagement','async function renderUserManagement')+'\nglobalThis.mount=renderUserManagement;',context);
 await context.mount(container,{manageColonyUsers:async action=>{assert.equal(action,'list');return {viewer:{role:'owner',user_id:'OWNER'},users:structuredClone(users)};},setUserAppPermissions:async payload=>calls.push({kind:'app',payload}),setGuestAccess:async payload=>calls.push({kind:'guest',payload})});
 const change=(id,key,value)=>container.onchange({target:{dataset:{userAppPermission:key,userId:id},value}});
 const guestChange=(id,key,value)=>container.onchange({target:{dataset:{userGuestPermission:key,userId:id},checked:value}});
 const save=(id,action='save-app-permissions')=>container.onclick({target:{closest:()=>({dataset:{userAction:action,userId:id}})}});
 const control=(id,key)=>container.innerHTML.match(new RegExp('<select data-user-app-permission="'+key+'" data-user-id="'+id+'"[^>]*>[\\s\\S]*?<\\/select>'))?.[0];
 return {container,calls,change,guestChange,save,control};
}

test('owner per-user controls lock Inventory writes below High without changing other feature controls',async()=>{
 const users=[user('LOW',{export_level:'low'}),user('MID1',{export_level:'mid1'}),user('MID2',{export_level:'mid2'}),user('VIEWER',{role:'viewer'}),user('HIGH'),user('MAX',{export_level:'max'}),user('MANAGER',{role:'manager',export_level:'low'})],f=await fixture(users);
 assert.match(f.container.innerHTML,/Inventory and Equipment editing requires High\/Max/);
 for(const id of ['LOW','MID1','MID2','VIEWER'])for(const key of ['reagents.inventory.write','reagents.equipment.write']){assert.match(f.control(id,key),/ disabled>/);assert.match(f.control(id,key),/Read only \(access level\)/);f.change(id,key,'allow');await f.save(id);}
 assert.equal(f.calls.length,0);
 for(const id of ['HIGH','MAX','MANAGER'])for(const key of ['reagents.inventory.write','reagents.equipment.write']){assert.doesNotMatch(f.control(id,key),/ disabled>/);assert.match(f.control(id,key),/Allow \(within role\)/);}
 assert.doesNotMatch(f.control('LOW','reagents.usage.write'),/ disabled>/);
 assert.doesNotMatch(f.control('LOW','reagents.dangerous.write'),/ disabled>/);
});

test('saving an unrelated permission preserves old Inventory overrides below High',async()=>{
 const saved={'reagents.inventory.write':true,'reagents.equipment.write':false},f=await fixture([user('LOW',{export_level:'low',reagents_permissions:saved})]);
 f.change('LOW','reagents.inventory.write','block');f.change('LOW','reagents.usage.write','block');await f.save('LOW');
 assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].payload.reagents_permissions)),{...saved,'reagents.usage.write':false});
});

test('High users retain explicit Inventory blocks and can save a reviewed restriction change',async()=>{
 const f=await fixture([user('HIGH',{reagents_permissions:{'reagents.inventory.write':false}})]);
 assert.match(f.control('HIGH','reagents.inventory.write'),/<option value="block" selected>Block/);
 f.change('HIGH','reagents.equipment.write','block');await f.save('HIGH');assert.equal(f.calls.length,1);assert.equal(f.calls[0].payload.reagents_permissions['reagents.inventory.write'],false);assert.equal(f.calls[0].payload.reagents_permissions['reagents.equipment.write'],false);
});

test('Guest Inventory write controls show the High minimum while retaining stored overrides when another Guest flag is saved',async()=>{
 const saved={'reagents.inventory.write':true,'reagents.equipment.write':true},f=await fixture([user('GUEST',{role:'viewer',guest_level:'guest3',guest_permissions:saved})]);
 for(const key of Object.keys(saved)){
  const field=f.container.innerHTML.match(new RegExp('<input type="checkbox" data-user-guest-permission="'+key+'" data-user-id="GUEST"[^>]*>'))?.[0];assert.ok(field);assert.match(field,/ disabled>/);assert.doesNotMatch(field,/ checked/);f.guestChange('GUEST',key,false);
 }
 assert.match(f.container.innerHTML,/High\/Max required/);await f.save('GUEST','save-guest');assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].payload.guest_permissions)),saved);f.calls.length=0;
 f.guestChange('GUEST','reagents.usage.read',true);await f.save('GUEST','save-guest');assert.equal(f.calls.length,1);assert.equal(f.calls[0].payload.guest_permissions['reagents.inventory.write'],true);assert.equal(f.calls[0].payload.guest_permissions['reagents.equipment.write'],true);
});
