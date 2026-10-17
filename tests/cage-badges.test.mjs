import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BADGE_TYPES,badgeLabel,validateWorkBadges,planWorkBadgeEdit,
  equipmentBadgeEventId,validateEquipmentBadgeDrafts,applyEquipmentBadgeDrafts,
  createCageBadgeIndex,cageBadgesForItem,
} from '../mouse-data/cage-badges.js';

const at='2026-10-17T02:00:00.000Z';
const badge=(kind='genotyping',extra={})=>({kind,status:'open',note:'',assignee:'',due_date:null,updated_at:at,...extra});
const fixture=()=>({tables:{
  mice:[
    {mouse_sid:'m1',physical_tag:'(P)-M1',state:'Stock',cage_sid:'c1'},
    {mouse_sid:'m2',physical_tag:'P-M2',state:'Stock',cage_sid:'c1'},
    {mouse_sid:'m3',physical_tag:'P-F1',state:'Stock',cage_sid:'c2'},
  ],
  cages:[{cage_sid:'c1',state:'Active',location_id:'p1'},{cage_sid:'c2',state:'Active',location_id:'p2'}],
  locations:[{location_id:'p1',source_current:true,source_block_text:'A2: (P)-M1'},{location_id:'p2',source_current:true}],
  husbandry_events:[],
}});
const item=(dataset,cageId='c1')=>{const cage=dataset.tables.cages.find(row=>row.cage_sid===cageId);return {cageId,cage,position:dataset.tables.locations.find(row=>row.location_id===cage?.location_id)};};
const experiment=(id,status,participants,extra={})=>({event_id:id,event_type:'experiment',event_date:'2026-10-17',experiment:{schema_version:1,title:'Recording '+id,status,participants,sample_usages:[],...extra}});
const confirmed=mouse_sid=>({link_status:'confirmed',mouse_sid,candidate_sids:[]});

test('badge definitions identify task owners and equipment positions',()=>{
  assert.deepEqual(BADGE_TYPES.map(row=>row.kind),['genotyping','experiment','pir','led','other']);
  assert.deepEqual(BADGE_TYPES.find(row=>row.kind==='pir').types,['locations']);
  assert.equal(badgeLabel({kind:'other',label:'  Replace water  '}),'Replace water');
  assert.equal(badgeLabel({kind:'other'}),'Other');
  assert.equal(badgeLabel({kind:'genotyping'}),'Genotyping');
});

test('validation enforces badge kinds, owner types and one row per kind',()=>{
  assert.deepEqual(validateWorkBadges('mice',undefined),[]);
  assert.deepEqual(validateWorkBadges('mice',[badge()]),[]);
  assert.deepEqual(validateWorkBadges('locations',[badge('pir'),badge('led')]),[]);
  for(const [type,rows]of [
    ['mice',[badge('pir')]],['cages',[badge('led')]],['locations',[badge('genotyping')]],
    ['locations',[badge('experiment')]],['locations',[badge('other')]],
    ['cages',[badge(),badge()]],['mice',[badge('unsupported')]],
    ['rooms',[]],['mice',null],['mice',{}],['mice',[null]],
  ])assert.ok(validateWorkBadges(type,rows).length,JSON.stringify([type,rows]));
  assert.ok(validateWorkBadges('mice',Array.from({length:13},()=>badge())).some(error=>/at most 12/.test(error)));
});

test('validation rejects oversized values and impossible or unzoned dates',()=>{
  for(const update of [
    {status:'cancelled'},{note:'x'.repeat(601)},{assignee:'x'.repeat(161)},
    {due_date:'2026-02-30'},{due_date:'10/17/2026'},
    {updated_at:'2026-10-17T02:00:00'},{updated_at:'2026-02-30T02:00:00Z'},
    {label:'Custom'},{extra:'unexpected'},
  ])assert.ok(validateWorkBadges('mice',[badge('genotyping',update)]).length,JSON.stringify(update));
  assert.ok(validateWorkBadges('mice',[badge('other',{label:'x'.repeat(41)})]).length);
  assert.deepEqual(validateWorkBadges('mice',[badge('other',{label:'x'.repeat(40),note:'x'.repeat(600),assignee:'x'.repeat(160),due_date:'2028-02-29',updated_at:'2026-10-17T10:00:00+08:00'})]),[]);
});

test('planning preserves an absent conflict base and never mutates the source dataset',()=>{
  const dataset=fixture(),before=structuredClone(dataset),plan=planWorkBadgeEdit(dataset,{type:'mice',id:'m1'},{kind:'genotyping',status:'open'},{at});
  assert.deepEqual(plan.changes,[{type:'mice',id:'m1',field:'work_badges',base:undefined,value:[badge()]}]);
  assert.deepEqual(dataset,before);
  plan.changes[0].value[0].note='draft';
  assert.equal(dataset.tables.mice[0].work_badges,undefined);
});

test('editing one kind retains resolved rows and a detached complete conflict base',()=>{
  const dataset=fixture(),original=[badge('other',{label:'Check water',status:'done'}),badge('genotyping')];
  dataset.tables.cages[0].work_badges=original;
  const plan=planWorkBadgeEdit(dataset,{type:'cages',id:'c1'},{kind:'genotyping',status:'in_progress',assignee:'Ada',note:'PCR today',due_date:'2026-10-18'},{at:'2026-10-17T03:00:00Z'}),change=plan.changes[0];
  assert.deepEqual(change.base,original);
  assert.notEqual(change.base,original);
  assert.deepEqual(change.value[0],original[0]);
  assert.equal(change.value[1].status,'in_progress');
  change.base[0].label='local mutation';
  assert.equal(original[0].label,'Check water');
  const unchanged=planWorkBadgeEdit(dataset,{type:'cages',id:'c1'},original[1],{at:'2026-10-18T03:00:00Z'});
  assert.deepEqual(unchanged.changes,[]);
});

test('task planning requires a real current linked record and cannot write imported position tasks',()=>{
  const dataset=fixture();
  assert.throws(()=>planWorkBadgeEdit(dataset,{type:'locations',id:'p1'},{kind:'genotyping',status:'open'},{at}),/belongs/);
  assert.throws(()=>planWorkBadgeEdit(dataset,{type:'cages',id:'missing'},{kind:'genotyping',status:'open'},{at}),/current/);
  dataset.tables.cages[0]._derived=true;
  assert.throws(()=>planWorkBadgeEdit(dataset,{type:'cages',id:'c1'},{kind:'genotyping',status:'open'},{at}),/current/);
  dataset.tables.mice[0].history_read_only=true;
  assert.throws(()=>planWorkBadgeEdit(dataset,{type:'mice',id:'m1'},{kind:'genotyping',status:'open'},{at}),/current/);
});

test('equipment planning uses one bounded stable husbandry record and preserves source observations',()=>{
  const dataset=fixture(),before=structuredClone(dataset),plan=planWorkBadgeEdit(dataset,{type:'locations',id:'p1'},{kind:'pir',status:'open',note:'No pulses'},{at});
  const change=plan.changes[0];
  assert.equal(change.type,'husbandry_events');assert.equal(change.field,'$equipment_badges');assert.equal(change.id,'cage-equipment:p1');assert.equal(change.base,null);
  assert.equal(change.value.location_id,'p1');
  assert.deepEqual(change.value.equipment_status,{schemaVersion:1,location_id:'p1',work_badges:[badge('pir',{note:'No pulses'})]});
  assert.deepEqual(validateEquipmentBadgeDrafts(dataset,plan.changes),[]);
  const saved=applyEquipmentBadgeDrafts(dataset,plan.changes);
  assert.deepEqual(dataset,before);
  assert.deepEqual(saved.tables.locations,before.tables.locations);
  assert.equal(saved.tables.husbandry_events.length,1);
  const next=planWorkBadgeEdit(saved,{type:'locations',id:'p1'},{kind:'led',status:'in_progress',assignee:'Ada'},{at:'2026-10-17T17:00:00Z'});
  assert.equal(next.changes[0].id,change.id);
  assert.equal(next.changes[0].value.event_date,'2026-10-18');
  assert.equal(next.changes[0].value.equipment_status.work_badges.length,2);
  assert.equal(applyEquipmentBadgeDrafts(saved,next.changes).tables.husbandry_events.length,1);
  const long='source-position:'.repeat(30);assert.ok(equipmentBadgeEventId(long).length<=200);assert.equal(equipmentBadgeEventId(long),equipmentBadgeEventId(long));assert.notEqual(equipmentBadgeEventId(long),equipmentBadgeEventId(long+'x'));
});

test('equipment save checks conflicts, permissions and current position before changing anything',()=>{
  const dataset=fixture(),plan=planWorkBadgeEdit(dataset,{type:'locations',id:'p1'},badge('pir'),{at}),saved=applyEquipmentBadgeDrafts(dataset,plan.changes);
  assert.deepEqual(validateEquipmentBadgeDrafts(saved,plan.changes),[]); // retry is idempotent
  const edit=planWorkBadgeEdit(saved,{type:'locations',id:'p1'},badge('pir',{status:'done'}),{at:'2026-10-18T02:00:00Z'}),remote=structuredClone(saved);
  remote.tables.husbandry_events[0].equipment_status.work_badges[0].note='Changed by colleague';
  assert.throws(()=>applyEquipmentBadgeDrafts(remote,edit.changes),/changed/);
  assert.equal(remote.tables.husbandry_events[0].equipment_status.work_badges[0].note,'Changed by colleague');
  assert.throws(()=>applyEquipmentBadgeDrafts(saved,edit.changes,{canEdit:type=>type!=='cages'}),/permission/);
  saved.tables.locations[0].source_current=false;
  assert.throws(()=>applyEquipmentBadgeDrafts(saved,edit.changes),/current/);
});

test('equipment drafts cannot inject unrelated events, transplant ownership or alter existing metadata',()=>{
  const dataset=fixture(),plan=planWorkBadgeEdit(dataset,{type:'locations',id:'p1'},badge('pir'),{at});
  for(const mutate of [
    change=>{change.value.event_type='other';},change=>{change.value.equipment_status.location_id='p2';},change=>{change.value.location_id='p2';},
    change=>{change.value.mouse_sid='m1';},change=>{change.value.equipment_status.extra='no';},
    change=>{change.value.equipment_status.work_badges=[badge('experiment')];},
  ]){const changes=structuredClone(plan.changes);mutate(changes[0]);assert.ok(validateEquipmentBadgeDrafts(dataset,changes).length);}
  const saved=applyEquipmentBadgeDrafts(dataset,plan.changes);saved.tables.husbandry_events[0].comment='Keep metadata';
  const edit=planWorkBadgeEdit(saved,{type:'locations',id:'p1'},badge('led'),{at:'2026-10-18T02:00:00Z'});
  assert.equal(edit.changes[0].value.comment,'Keep metadata');
  edit.changes[0].value.comment='Overwrite';
  assert.throws(()=>applyEquipmentBadgeDrafts(saved,edit.changes),/unrelated/);
});

test('cage and animal tasks follow their owners while equipment faults stay at the vacated position',()=>{
  let dataset=fixture();dataset.tables.cages[0].work_badges=[badge('other',{label:'Change bedding'})];dataset.tables.mice[0].work_badges=[badge()];
  dataset=applyEquipmentBadgeDrafts(dataset,planWorkBadgeEdit(dataset,{type:'locations',id:'p1'},badge('pir'),{at}).changes);
  dataset.tables.cages[0].location_id='p2';
  const index=createCageBadgeIndex(dataset),moved=cageBadgesForItem(index,item(dataset),[{mouseSid:'m1',tag:'(P)-M1'}]);
  assert.deepEqual(moved.map(row=>row.kind),['other','genotyping']);
  assert.deepEqual(cageBadgesForItem(index,{position:dataset.tables.locations[0]},[]).map(row=>[row.kind,row.type,row.id]),[['pir','locations','p1']]);
  dataset.tables.mice[0].cage_sid='c2';
  const movedAnimal=createCageBadgeIndex(dataset);
  assert.equal(cageBadgesForItem(movedAnimal,item(dataset),[]).some(row=>row.kind==='genotyping'),false);
  assert.equal(cageBadgesForItem(movedAnimal,item(dataset,'c2'),[{mouseSid:'m1'}]).find(row=>row.kind==='genotyping').id,'m1');
});

test('unknown genotype labels and unlinked source tags never create work tasks',()=>{
  const dataset=fixture();dataset.tables.mice[0].work_badges=[badge()];
  const index=createCageBadgeIndex(dataset);
  assert.deepEqual(cageBadgesForItem(index,{position:dataset.tables.locations[0]},[{tag:'(P)-M1'}]),[]);
  dataset.tables.mice[0].work_badges=undefined;
  assert.deepEqual(cageBadgesForItem(createCageBadgeIndex(dataset),item(dataset),[{mouseSid:'m1',tag:'(P)-M1'}]),[]);
});

test('only active experiments with explicit confirmed participants lend a derived badge',()=>{
  const dataset=fixture();dataset.tables.husbandry_events=[
    experiment('planned','planned',[confirmed('m1'),confirmed('m2')]),
    experiment('running','in_progress',[confirmed('m1')]),
    experiment('candidate','planned',[{link_status:'unresolved',raw_identifier:'P-M1',candidate_sids:['m1']}]),
    experiment('completed','completed',[confirmed('m1')]),experiment('cancelled','cancelled',[confirmed('m1')]),
    experiment('unreviewed','unreviewed',[confirmed('m1')]),
    {...experiment('archived','planned',[confirmed('m1')]),app_archived_at:at},
    experiment('specimen-only','planned',[],{sample_usages:[{sample_id:'sample'}]}),
    {event_id:'sample',event_type:'experiment_sample',experiment_sample:{donors:[confirmed('m1')],parent_sample_ids:[]}},
  ];
  const index=createCageBadgeIndex(dataset),badges=cageBadgesForItem(index,item(dataset),[{mouseSid:'m1'},{mouseSid:'m2'},{mouseSid:'m1'}]);
  assert.deepEqual(badges.map(row=>row.experimentId).sort(),['planned','running']);
  assert.equal(badges.find(row=>row.experimentId==='planned').status,'open');
  assert.deepEqual(badges.find(row=>row.experimentId==='planned').mouseSids,['m1','m2']);
  assert.equal(badges.find(row=>row.experimentId==='running').status,'in_progress');
  assert.ok(badges.every(row=>row.derived&&row.type==='husbandry_events'&&row.id===row.experimentId));
  assert.equal(dataset.tables.mice[0].work_badges,undefined);
});

test('resolved rows stay saved and can be reopened while current displays hide them',()=>{
  let dataset=fixture();dataset.tables.cages[0].work_badges=[badge('genotyping',{status:'done'})];
  dataset=applyEquipmentBadgeDrafts(dataset,planWorkBadgeEdit(dataset,{type:'locations',id:'p1'},badge('pir',{status:'done'}),{at}).changes);
  assert.deepEqual(cageBadgesForItem(createCageBadgeIndex(dataset),item(dataset),[]),[]);
  assert.equal(dataset.tables.cages[0].work_badges[0].status,'done');
  const reopen=planWorkBadgeEdit(dataset,{type:'cages',id:'c1'},badge('genotyping'),{at:'2026-10-18T02:00:00Z'});
  assert.equal(reopen.changes[0].value[0].status,'open');assert.equal(reopen.changes[0].base[0].status,'done');
});

test('historical views suppress every operational badge and reject edits',()=>{
  let dataset=fixture();dataset.tables.cages[0].work_badges=[badge()];
  dataset=applyEquipmentBadgeDrafts(dataset,planWorkBadgeEdit(dataset,{type:'locations',id:'p1'},badge('pir'),{at}).changes);
  assert.deepEqual(cageBadgesForItem(createCageBadgeIndex(dataset,{historical:true}),item(dataset)),[]);
  assert.deepEqual(cageBadgesForItem(createCageBadgeIndex(dataset),{...item(dataset),position:{...dataset.tables.locations[0],history_read_only:true}}),[]);
  dataset.history_projection={read_only:true};
  assert.deepEqual(cageBadgesForItem(createCageBadgeIndex(dataset),item(dataset)),[]);
  assert.throws(()=>planWorkBadgeEdit(dataset,{type:'cages',id:'c1'},badge(),{at}),/Historical/);
});

test('prebuilt maps support repeated cage lookups without rereading the dataset',()=>{
  const dataset=fixture();dataset.tables.mice[0].work_badges=[badge()];
  const index=createCageBadgeIndex(dataset),cageItem=item(dataset);
  Object.defineProperty(dataset,'tables',{get(){throw new Error('Unexpected per-cage dataset scan');}});
  assert.equal(cageBadgesForItem(index,cageItem).filter(row=>row.kind==='genotyping').length,1);
  assert.equal(cageBadgesForItem(index,cageItem,[{mouseSid:'m1'}]).filter(row=>row.kind==='genotyping').length,1);
});
