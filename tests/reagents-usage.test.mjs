import test from 'node:test';
import assert from 'node:assert/strict';
import {USAGE_GROUPS,usageGroup,usageItemLabel,buildUsageGroups,resolveUsageSelection,usageSelectorHTML,usageLoggedBy} from '../reagents/usage.js';

const item=(id,name,extra={})=>({id,kind:'item',payload:{name,inventory_classification:'Chemicals',...extra}});

test('frequent use is restricted to the named solvents and exact aliases or a sole CAS',()=>{
  for(const name of ['Chloroform',' chloroform ','Trichloromethane','Dichloromethane','Methylene chloride','DCM'])assert.equal(usageGroup(item(name,name)),'frequent',name);
  for(const cas_number of ['67-66-3','75-09-2','CAS: 75-09-2','CAS No. 67-66-3'])assert.equal(usageGroup(item(cas_number,'Solvent',{cas_number})),'frequent');
  for(const row of [item('mix','Chloroform mixture'),item('mix-cas','Chloroform solution',{cas_number:'67-66-3'}),item('compound','Chloroformate'),item('salt','Dichloromethane derivative'),item('mixed-cas','Solvent',{cas_number:'67-66-3, 75-09-2'}),item('flag','Chloroform',{is_mixture:true})])assert.equal(usageGroup(row),'chemicals',row.payload.name);
});

test('every active item appears once in the appropriate group, including equipment',()=>{
  const rows=[item('ch','Chloroform'),item('dc','Dichloromethane'),item('chemical','NaCl'),item('antibody','PER2 antibody',{inventory_classification:'Antibody'}),{id:'equipment',kind:'equipment',payload:{name:'qPCR'}},item('equipment-item','Pipette',{inventory_classification:'Equipment'}),item('unknown','Unclassified',{inventory_classification:''}),{...item('archive','Old chloroform'),archived:true},{id:'order',kind:'order',payload:{name:'Chloroform'}}];
  const groups=buildUsageGroups(rows);
  assert.deepEqual(groups.map(({id})=>id),USAGE_GROUPS.map(({id})=>id));
  assert.deepEqual(groups.map(({rows})=>rows.map(({id})=>id)),[['ch','dc'],['chemical'],['equipment-item','equipment'],['antibody','unknown']]);
  assert.equal(new Set(groups.flatMap(({rows})=>rows.map(({id})=>id))).size,7);
  assert.equal(usageGroup(rows.at(-1)),'');
});

test('selector labels distinguish same-name bottles, search fields, and stable sorting',()=>{
  const rows=[item('b','Chloroform',{brand:'Beta',catalog_number:'102',unit:'mL',location:'Shelf B'}),item('a','Chloroform',{brand:'Alpha',catalog_number:'101',barcode:'Bottle 2',unit:'mL',location:'Shelf A'}),item('c','Chloroform',{brand:'Alpha',catalog_number:'101',barcode:'Bottle 1',unit:'mL',location:'Shelf A'})];
  const before=structuredClone(rows);
  assert.match(usageItemLabel(rows[1]),/Alpha · 101 · Bottle 2 · mL · Shelf A/);
  assert.deepEqual(buildUsageGroups(rows)[0].rows.map(({id})=>id),['c','a','b']);
  assert.deepEqual(buildUsageGroups(rows,{query:'alpha 101 bottle 2'})[0].rows.map(({id})=>id),['a']);
  assert.deepEqual(buildUsageGroups(rows,{query:'BETA shelf b'})[0].rows.map(({id})=>id),['b']);
  assert.deepEqual(rows,before);
  const same=[item('bottle-1','Chloroform'),item('bottle-2','Chloroform')];
  assert.match(usageSelectorHTML(same).html,/Chloroform · ID bottle-1/);
  assert.match(usageSelectorHTML(same).html,/Chloroform · ID bottle-2/);
});

test('selection cannot silently substitute another group, filtered item, or ambiguous ID',()=>{
  const rows=[item('ch','Chloroform'),item('salt','NaCl'),{id:'eq',kind:'equipment',payload:{name:'qPCR'}}];
  assert.equal(resolveUsageSelection(rows,{group:'frequent',selectedId:'ch'}),rows[0]);
  for(const options of [{group:'chemicals',selectedId:'ch'},{group:'frequent',selectedId:'missing'},{group:'frequent',selectedId:'ch',query:'not found'},{group:'invalid',selectedId:'ch'}])assert.equal(resolveUsageSelection(rows,options),null);
  const html=usageSelectorHTML(rows,{group:'equipment',selectedId:'ch'});
  assert.equal(html.selectedItem,null);assert.equal(html.selectedId,'');assert.match(html.html,/<option value="">Choose an item/);assert.doesNotMatch(html.html,/<option value="ch"/);
  const duplicate=[...rows,item('ch','Another bottle')];
  assert.equal(resolveUsageSelection(duplicate,{selectedId:'ch'}),null);
  assert.equal(buildUsageGroups(duplicate).flatMap(group=>group.rows).some(row=>row.id==='ch'),false);
});

test('HTML selection uses only escaped labels, identifiers and search text',()=>{
  const row=item('a"<script>','Chloroform',{brand:'<img src=x onerror=alert(1)>',catalog_number:'"&',location:'<b>freezer</b>'});
  const result=usageSelectorHTML([row],{selectedId:row.id,query:'',id:'select"x',name:'item"x'});
  assert.equal(result.selectedItem,row);
  assert.doesNotMatch(result.html,/<script>|<img|<b>/);
  assert.match(result.html,/&lt;img/);assert.match(result.html,/id="select&quot;x"/);assert.match(result.html,/name="item&quot;x"/);
  assert.match(usageSelectorHTML([],{query:'"<svg onload=x>'}).html,/value="&quot;&lt;svg onload=x&gt;"/);
  assert.match(usageSelectorHTML([]).html,/No matching items/);
});

test('server logger stamp takes precedence, while historical multi-acronyms stay intact',()=>{
  assert.equal(usageLoggedBy({payload:{recorded_by_acronym:'jm',operator:'HV'}}),'JM');
  for(const operator of ['HV','JM','HV, DT','HV, VT','HV,VT','VT, TL'])assert.equal(usageLoggedBy({payload:{operator}}),operator);
  for(const operator of ['',null,'Unaccounted','Unknown','Lalitha'])assert.equal(usageLoggedBy({payload:{operator}}),'—');
});

test('historical names need an exact unique directory mapping, never guessed initials or importer identity',()=>{
  const directory=[{user_id:'lali',name:'Lalitha',email:'lali@example.org',acronym:'LP'},{user_id:'owner',name:'Jihwan Myung',acronym:'JM'}];
  assert.equal(usageLoggedBy({payload:{operator:'Lalitha'}},{directory}),'LP');
  assert.equal(usageLoggedBy({payload:{operator:'lalitha'}},{directory}),'LP');
  assert.equal(usageLoggedBy({payload:{operator:'Lal'}},{directory}),'—');
  assert.equal(usageLoggedBy({payload:{recorded_by:'lali'}},{directory}),'LP');
  assert.equal(usageLoggedBy({source_id:'source',created_by:'owner',payload:{source_ref:{sheet:'Usage'},operator:'Unaccounted'}},{directory}),'—');
  assert.equal(usageLoggedBy({created_by:'owner',payload:{}},{directory}),'—');
  assert.equal(usageLoggedBy({payload:{operator:'Lalitha'}},{directory:[...directory,{name:'Lalitha',acronym:'LA'}]}),'—');
});

test('a stamped account without an acronym never borrows the editable Used by value',()=>{
 assert.equal(usageLoggedBy({payload:{recorded_by_user_id:'verified-user',recorded_by_acronym:null,operator:'HV'}}),'—');
 assert.equal(usageLoggedBy({payload:{recorded_by_acronym:'JM_RESEARCH1',operator:'HV'}}),'JM_RESEARCH1');
});

test('current bilingual solvent labels retain their frequent-use grouping without a separate CAS field',()=>{
 for(const name of ['Chloroform 氯仿 (濃度50%以 上)、三氯甲烷','Dichloromethane 二氯甲烷 (濃度25% 以上)','Dichloromethane\n二氯甲烷 (濃度25% 以上)'])assert.equal(usageGroup({id:name,kind:'item',payload:{name}}),'frequent');
 for(const name of ['Dichloromethane 二氯甲烷 / 甲醇','Chloroform 氯仿混合液'])assert.notEqual(usageGroup({id:name,kind:'item',payload:{name}}),'frequent');
});
