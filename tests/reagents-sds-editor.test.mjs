import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../reagents/model.js';
import * as sorting from '../reagents/table-sort.js';
import * as inventoryExports from '../reagents/inventory-export.js';
import {bindSheetOrderImportDialog} from '../reagents/orders.js';
import {cloudControlsHTML,cloudIndicatorHTML,showCloud1SignIn} from '../mouse-data/cloud-status.js';

const appSource=await readFile(new URL('../reagents/app.js',import.meta.url),'utf8');
const chemical=(safety={})=>({id:'synthetic-bottle',kind:'item',version:7,archived:false,payload:{name:'2-Mercaptoethanol',brand:'Sigma-Aldrich',catalog_number:'M6250',cas_number:'60-24-2',location:'Synthetic shelf',status:'in_stock',safety}});
const unescape=value=>value.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
function fixture(record,{access={}}={}){
 const nodes=new Map(),calls=[],permissions={role:'editor',can_write:true,can_manage_safety:true,export_level:'high',...access};let controls=[];
 const node=id=>{
  if(nodes.has(id))return nodes.get(id);let html='';const value={id,open:false,textContent:'',dataset:{},listeners:{},elements:[],addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(selector){return selector==='input[type=checkbox]'?controls.filter(control=>control.type==='checkbox'):[];}};
  Object.defineProperty(value,'innerHTML',{get:()=>html,set:next=>{html=next;if(id==='edit-fields'){controls=[];for(const match of next.matchAll(/<input\b([^>]*)>|<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)){const attrs=Object.fromEntries([...(match[1]||match[2]).matchAll(/([\w-]+)="([^"]*)"/g)].map(([,name,content])=>[name,unescape(content)]));if(!attrs.name)continue;controls.push({...attrs,value:match[2]!==undefined?unescape(match[3]||''):attrs.value||'',checked:/\schecked(?:\s|$)/.test(match[1]||match[2]),disabled:/\sdisabled(?:\s|$)/.test(match[1]||match[2])});}const form=node('edit-form');form.elements=controls;for(const control of controls)form.elements[control.name]=control;}}});nodes.set(id,value);return value;
 };
 class FormDataFake{constructor(form){this.rows=form.elements.filter(field=>!field.disabled&&(field.type!=='checkbox'||field.checked)).map(field=>[field.name,field.value]);}[Symbol.iterator](){return this.rows[Symbol.iterator]();}}
 const identity={url:'https://synthetic.supabase.co',colonyId:'synthetic-colony',signedIn:true,email:'editor@example.invalid',username:'editor',role:'editor',exportLevel:'high'};
 const context=vm.createContext({bindSheetOrderImportDialog,createPresence:()=>({refresh(){},clear(){},destroy(){}}),cloudControlsHTML,cloudIndicatorHTML,showCloud1SignIn,createCloudMonitor:()=>({dispose(){}}),createAccessActivity:()=>({observe(){},resume(){},touch(){},suspend(){},reset(){},signOut(){}}),...model,...sorting,...inventoryExports,structuredClone,FormData:FormDataFake,
  store:{getCloudStatus:()=>identity,callReagents:async(action,args)=>{calls.push({action,args:structuredClone(args)});if(action==='save')return {...record,payload:structuredClone(args.p_payload),version:record.version+1};return action==='access'?{permissions}:{rows:[],total:0,next_offset:null};}},PUBLIC_CONFIG:{},document:{getElementById:node,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){}},location:new URL('https://synthetic.invalid/reagents/#inventory'),console,setTimeout,clearTimeout,URL,Blob});
 context.fixtureRecord=structuredClone(record);context.fixturePermissions=permissions;
 const expose='\nmember=true;permissions=globalThis.fixturePermissions;items=[globalThis.fixtureRecord];records=new Map(items.map(row=>[row.id,row]));globalThis.app={open:()=>editSafety(globalThis.fixtureRecord),values:()=>{const form=document.getElementById("edit-form"),values=Object.fromEntries(new FormData(form));for(const box of form.querySelectorAll("input[type=checkbox]"))values[box.name]=box.checked;return values;},save:()=>editAction(globalThis.app.values()),revoke:()=>{permissions={...permissions,can_manage_safety:false};},switchActor:()=>{generation++;},privateReset:resetPrivate};';
 vm.runInContext(appSource.replace(/^import .*;\n/gm,'').replace(/await start\(\);\s*$/,'')+expose,context);
 const fill=()=>node('edit-fields').onclick({preventDefault(){},target:{closest:()=>({disabled:false,dataset:{safetyReferenceFill:'aldrich-m6250'}})}});
 return {app:context.app,node,calls,fill,control:name=>node('edit-form').elements[name]};
}

test('supplier references are opt-in drafts and keep source classification, regulatory fields and edited notes',async()=>{
 const record=chemical({classification:'Danger, CMR',regulatory_list:'Recorded local list',review_status:'unverified',notes:'Original note'}),before=structuredClone(record),f=fixture(record);f.app.open();const html=f.node('edit-fields').innerHTML;
 assert.match(html,/Supplier SDS reference/);assert.match(html,/Fill missing SDS details/);assert.match(html,/Source \/ regulatory classification/);assert.match(html,/Supplier GHS classification/);assert.match(html,/Search supplier SDS/);assert.equal(f.calls.length,0);
 f.control('notes').value='Edited personal draft note';f.control('classification').value='Recorded source classification';f.fill();const draft=f.app.values();assert.equal(draft.classification,'Recorded source classification');assert.equal(draft.regulatory_list,'Recorded local list');assert.equal(draft.notes,'Edited personal draft note');assert.equal(draft.sds_version,'8.4');assert.equal(draft.sds_document_date,'2026-06-15');assert.equal(draft.review_status,'supplier_sds_pending_bottle_check');assert.match(draft.ghs_classification,/Acute toxicity: oral 3, inhalation 3, dermal 2/);assert.match(f.node('edit-fields').innerHTML,/SDS region \/ language/);assert.match(f.node('edit-fields').innerHTML,/US · English/);assert.match(f.node('edit-fields').innerHTML,/SDS retrieved/);assert.equal(f.calls.length,0);
 await f.app.save();const save=f.calls.find(call=>call.action==='save');assert.equal(save.args.p_id,record.id);assert.equal(save.args.p_expected_version,7);assert.equal(save.args.p_payload.location,'Synthetic shelf');assert.equal(save.args.p_payload.safety.classification,'Recorded source classification');assert.equal(save.args.p_payload.safety.sds_region,'US');assert.equal(save.args.p_payload.safety.sds_retrieved_date,'2026-10-21');assert.equal(save.args.p_payload.safety.sds_source_type,'manufacturer_sds');assert.ok(save.args.p_payload.safety.ghs_classification.includes('Acute toxicity: oral 3, inhalation 3, dermal 2'));assert.equal(save.args.p_payload.safety.sds_reviewer,'');assert.notEqual(save.args.p_payload.safety.review_status,'reviewed');assert.deepEqual(record,before);
});

test('reviewed records and contradictory supplier SDS details are preserved even after a forged fill click',()=>{
 for(const safety of [{review_status:'reviewed',sds_url:'https://example.invalid/current-sds.pdf',sds_reviewer:'Reviewer'},{sds_url:'https://www.sigmaaldrich.com/US/en/sds/aldrich/m6250',sds_version:'7.0',review_status:'unverified'}]){const f=fixture(chemical(safety));f.app.open();assert.doesNotMatch(f.node('edit-fields').innerHTML,/data-safety-reference-fill=/);const before=JSON.stringify(f.app.values());f.fill();assert.equal(JSON.stringify(f.app.values()),before);assert.match(f.node('edit-error').textContent,/existing|reviewed|differs|different|version/i);assert.equal(f.calls.length,0);}
});

test('unmatched products offer an SDS search without applying a same-name or CAS-only reference',()=>{
 const record=chemical();record.payload.catalog_number='DIFFERENT';record.payload.source_fields={secret:'PRIVATE SOURCE'};record.payload.owner='PRIVATE OWNER';const f=fixture(record);f.app.open();const html=f.node('edit-fields').innerHTML;assert.doesNotMatch(html,/data-safety-reference-fill|PRIVATE SOURCE|PRIVATE OWNER/);assert.match(html,/Search supplier SDS/);assert.match(html,/q=Sigma-Aldrich%20DIFFERENT%202-Mercaptoethanol%20safety%20data%20sheet/);assert.equal(f.calls.length,0);
});

test('no safety edit is available to ordinary readers, and late permission or account loss blocks fill and Save',async()=>{
 const reader=fixture(chemical(),{access:{can_manage_safety:false}});reader.app.open();assert.equal(reader.node('editor').open,false);assert.equal(reader.node('edit-fields').innerHTML,'');
 for(const action of ['revoke','switchActor']){const f=fixture(chemical());f.app.open();f.app[action]();f.fill();assert.match(f.node('edit-error').textContent,/access changed|session changed/);await assert.rejects(f.app.save(),/access changed|session changed/);assert.equal(f.calls.length,0);}
 const closed=fixture(chemical());closed.app.open();closed.node('editor').close();closed.fill();assert.equal(closed.calls.length,0);assert.equal(closed.control('sds_url').value,'');
});

test('safety exports keep source and supplier classifications distinct with SDS version and region metadata',()=>{
 const record=chemical(model.supplierSafetyPatch(chemical({classification:'Recorded source classification',regulatory_list:'Recorded local list'}).payload,'aldrich-m6250')),book=inventoryExports.inventoryExportWorkbook([record],{capturedAt:'2026-10-21T00:00:00Z'}),headers=book.sheets[0].rows[0],row=book.sheets[0].rows[1],field=title=>row[headers.indexOf(title)];
 assert.equal(field('Source / regulatory classification'),'Recorded source classification');assert.match(field('Supplier GHS classification'),/Acute toxicity: oral 3, inhalation 3, dermal 2/);assert.equal(field('SDS region'),'US');assert.equal(field('SDS retrieved'),'2026-10-21');assert.equal(field('SDS version'),'8.4');const html=inventoryExports.inventoryPrintBodyHTML([record],{capturedAt:'2026-10-21T00:00:00Z'});assert.match(html,/Source: Recorded source classification/);assert.match(html,/Supplier GHS:/);assert.match(html,/Region:<\/span> US/);assert.match(html,/Retrieved:<\/span> 2026-10-21/);
});
