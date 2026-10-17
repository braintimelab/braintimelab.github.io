import test from 'node:test';
import assert from 'node:assert/strict';
import {
 inferNoteBadges,noteTextsFromPosition,sourceBadgeTarget,buildSourceBadgeIndex,sourceBadgeRows,
 planSourceBadgeEdit,validateSourceBadgeDrafts,applySourceBadgeDrafts,sourceBadgeReadDependencies,
} from '../mouse-data/cage-note-badges.js';
import {cageCardObservation,cageObservations} from '../mouse-data/cage-observations.js';

const at='2026-10-17T02:00:00.000Z';
const badge=(kind='genotyping',extra={})=>({kind,status:'open',note:'',assignee:'',due_date:null,updated_at:at,...extra});
const observation=()=>({schemaVersion:1,startedDate:'2026-10-01',managerName:'Ada',intensityLux:100,animals:[
 {sourceCell:'A2',tag:'(P)-M1',dateOfBirth:'2026-08-01',sex:'Male',note:'Genotyping'},
 {sourceCell:'A3',tag:'P-F2',dateOfBirth:'2026-08-02',sex:'Female',note:'Experiment'},
]});
const fixture=()=>({tables:{mice:[],cages:[],locations:[
 {location_id:'p1',source_current:true,source_cage_observation:observation(),source_block_text:'Z14: Genotyping\nN15: Experiment\nCK24: PIR not good\nAN6: PIR!\nA2 comment: Genotyping'},
 {location_id:'p2',source_current:true},
],husbandry_events:[]}});
const target=(dataset,animal=null)=>sourceBadgeTarget('p1',cageObservations(dataset.tables.locations[0]),animal);
const kinds=value=>inferNoteBadges(value).map(row=>row.kind);

test('explicit current notes suggest only their declared task or fault',()=>{
 for(const text of ['Genotyping','geno','need genotyping','pending genotyping','not yet genotyped','needs to be genotyped'])assert.deepEqual(kinds(text),['genotyping'],text);
 for(const text of ['Experiment','for experiment','planned experiment','experiment planned'])assert.deepEqual(kinds(text),['experiment'],text);
 for(const text of ['PIR!','PIR not good','PIR notgood','PIR not good but usable','PIR not working','PIR does not work'])assert.deepEqual(kinds(text),['pir'],text);
 for(const text of ['LED broken','LED not working',"LED doesn't work"])assert.deepEqual(kinds(text),['led'],text);
 assert.deepEqual(kinds('待基因分型；預計實驗；PIR故障；LED不亮'),['genotyping','experiment','pir','led']);
 assert.deepEqual(kinds('sampling; (P), (P/B), WT, unknown genotype; PIR; LED'),[]);
});

test('negation, resolved work, and hypothetical failures do not suggest open work',()=>{
 for(const text of [
  'genotyped','genotyping done','Genotyping completed','no genotyping needed','No need for genotyping','genotyping not needed','not genotyping',
  'no experiment planned','experiment completed','past experiment','Experiment results',
  'PIR not bad','PIR no problem','no PIR problem','no PIR fault','no LED problems','no LED fault','PIR works','PIR repaired','LED fixed','PIR working fine','PIR正常',
  'if PIR fails, replace it','If LED broken, move cage','PIR may be broken','genotyping if needed','如果PIR故障，更換',
 ])assert.deepEqual(kinds(text),[],text);
 assert.deepEqual(kinds('Genotyping\ngenotyping done\nPIR bad\nPIR fixed\nLED broken'),['led']);
 assert.deepEqual(kinds('PIR fixed; LED broken; no experiment planned; need genotyping'),['genotyping','led']);
 assert.deepEqual(kinds('PIR not bad but LED broken'),['led']);
 assert.deepEqual(kinds('LED! fixed; PIR!'),['pir']);
 assert.deepEqual(kinds('PIR fixed; PIR broken again'),['pir']);
 assert.deepEqual(kinds('Genotyping done; needs genotyping again'),['genotyping']);
 assert.deepEqual(kinds('PIR fixed; PIR broken again; PIR repaired'),[]);
 assert.deepEqual(inferNoteBadges('PIR!\nno PIR problem'),[]);
 assert.deepEqual(inferNoteBadges('LED broken\nno LED problem'),[]);
 assert.deepEqual(inferNoteBadges('PIR!\nno PIR fault\nLED broken'),[{kind:'led',note:'LED broken'}]);
 assert.deepEqual(inferNoteBadges('PIR!\nno PIR problem\nPIR broken again'),[{kind:'pir',note:'PIR broken again'}]);
});

test('multiple kinds retain only their bounded literal supporting clauses',()=>{
 const note='  Genotyping; for experiment; PIR! LED broken  ';
 assert.deepEqual(inferNoteBadges(note),[
  {kind:'genotyping',note:'Genotyping'},{kind:'experiment',note:'for experiment'},
  {kind:'pir',note:'PIR!'},{kind:'led',note:'LED broken'},
 ]);
 assert.deepEqual(inferNoteBadges('(P)-M1\n2026-08-01\nGenotyping\n100 lux\nPIR not good but usable\nAda'),[
  {kind:'genotyping',note:'Genotyping'},{kind:'pir',note:'PIR not good but usable'},
 ]);
 assert.deepEqual(inferNoteBadges('PIR not good but LED broken'),[{kind:'pir',note:'PIR not good'},{kind:'led',note:'LED broken'}]);
 assert.deepEqual(inferNoteBadges('Genotyping done; needs genotyping again'),[{kind:'genotyping',note:'needs genotyping again'}]);
 assert.deepEqual(inferNoteBadges('PIR!\nPIR not good but usable\nPIR!'),[{kind:'pir',note:'PIR!\nPIR not good but usable'}]);
 assert.equal(inferNoteBadges('Genotyping '+ 'x'.repeat(700))[0].note.length,600);
 assert.deepEqual(inferNoteBadges(null),[]);
});

test('reference-only notes do not imply tasks, while current headers and explicit plans do',()=>{
 for(const value of ['see Experiment sheet','refer to the Experiment sheet','Experiment sheet','see Genotyping sheet','genotyping results'])assert.deepEqual(inferNoteBadges(value),[],value);
 assert.deepEqual(inferNoteBadges('Genotyping'),[{kind:'genotyping',note:'Genotyping'}]);
 assert.deepEqual(inferNoteBadges('Experiment'),[{kind:'experiment',note:'Experiment'}]);
 assert.deepEqual(kinds('experiment planned in Experiment sheet'),['experiment']);
 assert.deepEqual(inferNoteBadges('see Experiment sheet; PIR!'),[{kind:'pir',note:'PIR!'}]);
 assert.deepEqual(inferNoteBadges('Experiment\nsee Experiment sheet'),[{kind:'experiment',note:'Experiment'}]);
});

test('cell and comment extraction is bounded and excludes animal-note duplicates',()=>{
 const position=fixture().tables.locations[0];
 assert.deepEqual(noteTextsFromPosition(position),['Genotyping','Experiment','PIR not good','PIR!','Genotyping']);
 assert.deepEqual(noteTextsFromPosition(position,{exclude:['Genotyping\nExperiment']}),['PIR not good','PIR!']);
 assert.deepEqual(noteTextsFromPosition({source_block_text:'header\nA1: LED broken\nA2 comment: PIR!\nA3:\nBAD: ignored\nA4: long'+ 'x'.repeat(700)},{exclude:['A1']} ).map(value=>value.length),[4,600]);
 assert.equal(noteTextsFromPosition({source_block_text:Array.from({length:220},(_,i)=>`A${i+1}: Genotyping`).join('\n')}).length,200);
});

test('source targets are bounded and insensitive to note, manager, lux, and import changes',()=>{
 const source=observation(),row=source.animals[0],card=sourceBadgeTarget('p1',source),animal=sourceBadgeTarget('p1',source,row);
 assert.equal(card.type,'source_cards');assert.equal(card.name,'Card note');assert.equal(animal.name,row.tag);
 const changed=structuredClone(source);changed.animals[0].note='genotyping done';changed.managerName='Ben';changed.intensityLux=12;changed.imported_at=at;changed.animals.reverse();
 assert.deepEqual(sourceBadgeTarget('p1',changed),card);
 assert.deepEqual(sourceBadgeTarget('p1',changed,changed.animals[1]),animal);
 assert.equal(sourceBadgeTarget('p1',source,{...row,tag:'Managed tag',sourceTag:row.tag,dateOfBirth:'2026-08-03'}).id,animal.id);
 const long=sourceBadgeTarget('source:'.repeat(1000),source);assert.ok(long.id.length<=200);assert.equal(long.id,sourceBadgeTarget('source:'.repeat(1000),source).id);
 assert.notEqual(sourceBadgeTarget('p2',source).id,card.id);
 assert.equal(sourceBadgeTarget('p1',source,{...row,tag:'Invented'}),null);
 assert.equal(sourceBadgeTarget('p1',{...source,animals:[]}),null);
});

test('occupant, row, DOB, sex, and cage-start changes produce fresh identities',()=>{
 const source=observation(),base=sourceBadgeTarget('p1',source),row=sourceBadgeTarget('p1',source,source.animals[0]);
 for(const mutate of [
  source=>source.animals[0].tag='Other-M1',source=>source.animals[0].sourceCell='A4',source=>source.animals[0].dateOfBirth='2026-08-03',
  source=>source.animals[0].sex='Female',source=>source.startedDate='2026-10-02',source=>source.animals.pop(),
 ]){const changed=structuredClone(source);mutate(changed);assert.notEqual(sourceBadgeTarget('p1',changed).id,base.id);}
 const changed=structuredClone(source);changed.animals[1].tag='Other-F2';
 assert.equal(sourceBadgeTarget('p1',changed,changed.animals[0]).id,row.id);
 const duplicate=structuredClone(source);duplicate.animals.push({...duplicate.animals[0]});
 assert.equal(sourceBadgeTarget('p1',duplicate,duplicate.animals[0]),null);
});

test('source status exists only after an edit and never mutates imported observations',()=>{
 const dataset=fixture(),before=structuredClone(dataset),owner=target(dataset),plan=planSourceBadgeEdit(dataset,owner,{kind:'genotyping',status:'done',note:'PCR complete'},{at});
 assert.deepEqual(sourceBadgeRows(dataset,owner),[]);
 assert.equal(plan.changes[0].type,'husbandry_events');assert.equal(plan.changes[0].field,'$source_badges');assert.equal(plan.changes[0].base,null);
 assert.equal(plan.changes[0].value.event_type,'cage_card_badge_status');assert.equal(plan.changes[0].value.record_origin,'app_created');assert.equal(plan.changes[0].value.location_id,'p1');
 assert.deepEqual(validateSourceBadgeDrafts(dataset,plan.changes),[]);
 const saved=applySourceBadgeDrafts(dataset,plan.changes);
 assert.deepEqual(dataset,before);assert.deepEqual(saved.tables.locations,before.tables.locations);assert.equal(saved.tables.husbandry_events.length,1);
 assert.deepEqual(sourceBadgeRows(buildSourceBadgeIndex(saved),owner),[badge('genotyping',{status:'done',note:'PCR complete'})]);
 const rows=sourceBadgeRows(saved,owner);rows[0].status='open';assert.equal(sourceBadgeRows(saved,owner)[0].status,'done');
 saved.tables.locations[0].source_cage_observation.animals[0].note='Need genotyping, edited spelling';
 assert.equal(target(saved).id,owner.id);assert.equal(sourceBadgeRows(saved,target(saved))[0].status,'done');
 const noOp=planSourceBadgeEdit(saved,owner,{kind:'genotyping',status:'done',note:'PCR complete'},{at:'2026-10-18T02:00:00Z'});assert.deepEqual(noOp.changes,[]);
});

test('one identity keeps multiple task statuses with a detached full conflict base',()=>{
 let dataset=fixture();const owner=target(dataset);
 dataset=applySourceBadgeDrafts(dataset,planSourceBadgeEdit(dataset,owner,badge('genotyping',{status:'done'}),{at}).changes);
 dataset.tables.husbandry_events[0].comment='Preserved metadata';
 const plan=planSourceBadgeEdit(dataset,owner,{kind:'other',label:'Change bedding',status:'in_progress',assignee:'Ada',due_date:'2026-10-19'},{at:'2026-10-17T17:00:00Z'}),change=plan.changes[0];
 assert.deepEqual(change.base,dataset.tables.husbandry_events[0]);assert.notEqual(change.base,dataset.tables.husbandry_events[0]);
 assert.equal(change.value.comment,'Preserved metadata');assert.equal(change.value.event_date,'2026-10-18');assert.equal(change.value.card_badge_status.work_badges.length,2);
 const saved=applySourceBadgeDrafts(dataset,plan.changes);assert.equal(saved.tables.husbandry_events.length,1);
 assert.deepEqual(sourceBadgeRows(saved,owner).map(row=>row.status),['done','in_progress']);
});

test('saved source work follows an explicitly moved card with its original location identity',()=>{
 let dataset=fixture();const owner=target(dataset,cageObservations(dataset.tables.locations[0]).animals[0]);
 dataset=applySourceBadgeDrafts(dataset,planSourceBadgeEdit(dataset,owner,badge(),{at}).changes);
 const original=cageObservations(dataset.tables.locations[0]);
 dataset.tables.cages=[{cage_sid:'c1',state:'Active',location_id:'p2',cage_sheet_card:{schemaVersion:1,source_location_id:'p1',observation:original,unresolved_rows:[]}}];
 const card=cageCardObservation(dataset,{position:dataset.tables.locations[1],cage:dataset.tables.cages[0]});
 const moved=sourceBadgeTarget(card.source_location_id,card.observation,card.observation.animals[0]);assert.equal(moved.id,owner.id);
 assert.equal(cageCardObservation(dataset,{position:dataset.tables.locations[0]}).observation.animals.length,0);
 const plan=planSourceBadgeEdit(dataset,moved,badge('genotyping',{status:'done'}),{at:'2026-10-18T02:00:00Z'});
 assert.equal(plan.changes[0].value.location_id,'p1');assert.equal(sourceBadgeRows(applySourceBadgeDrafts(dataset,plan.changes),owner)[0].status,'done');
 assert.deepEqual(sourceBadgeReadDependencies(dataset,plan.changes),[{type:'locations',id:'p1'},{type:'cages',id:'c1'},{type:'locations',id:'p2'}]);
 dataset.tables.locations[0].source_current=false;
 assert.doesNotThrow(()=>planSourceBadgeEdit(dataset,moved,badge('genotyping',{status:'done'}),{at}));
 dataset.tables.locations[1].source_current=false;
 assert.throws(()=>planSourceBadgeEdit(dataset,moved,badge(),{at}),/no longer current/);
});

test('fresh cohort, historical state, and housing permission block source edits',()=>{
 const dataset=fixture(),owner=target(dataset),plan=planSourceBadgeEdit(dataset,owner,badge(),{at});
 assert.throws(()=>applySourceBadgeDrafts(dataset,plan.changes,{canEdit:type=>type!=='locations'}),/permission/);
 assert.throws(()=>applySourceBadgeDrafts(dataset,plan.changes,{canEdit:type=>type!=='cages'}),/permission/);
 for(const mutate of [
  dataset=>dataset.tables.locations[0].source_cage_observation.animals[0].dateOfBirth='2026-08-03',
  dataset=>dataset.tables.locations[0].source_cage_observation.startedDate='2026-10-02',
  dataset=>dataset.tables.locations[0].source_current=false,
  dataset=>dataset.tables.locations[0].history_read_only=true,
 ]){const changed=structuredClone(dataset);mutate(changed);assert.throws(()=>applySourceBadgeDrafts(changed,plan.changes),/changed|current/);}
 dataset.history_projection={read_only:true};
 assert.throws(()=>planSourceBadgeEdit(dataset,owner,badge(),{at}),/Historical/);
 assert.throws(()=>applySourceBadgeDrafts(dataset,plan.changes),/Historical/);
 assert.deepEqual(sourceBadgeRows(dataset,owner),[]);
});

test('full saved event conflicts fail closed, while exact retries remain idempotent',()=>{
 const dataset=fixture(),owner=target(dataset),initial=planSourceBadgeEdit(dataset,owner,badge(),{at}),saved=applySourceBadgeDrafts(dataset,initial.changes);
 assert.deepEqual(validateSourceBadgeDrafts(saved,initial.changes),[]);
 const edit=planSourceBadgeEdit(saved,owner,badge('genotyping',{status:'done'}),{at:'2026-10-18T02:00:00Z'}),remote=structuredClone(saved);
 remote.tables.husbandry_events[0].comment='Concurrent metadata';
 assert.throws(()=>applySourceBadgeDrafts(remote,edit.changes),/changed/);assert.equal(remote.tables.husbandry_events[0].comment,'Concurrent metadata');
 const duplicate=structuredClone(saved);duplicate.tables.husbandry_events.push(structuredClone(duplicate.tables.husbandry_events[0]));
 assert.deepEqual(sourceBadgeRows(duplicate,owner),[]);assert.throws(()=>planSourceBadgeEdit(duplicate,owner,badge(),{at}),/conflicting/);
});

test('drafts reject equipment kinds, malformed fields, identity transplants, and metadata edits',()=>{
 const dataset=fixture(),owner=target(dataset),plan=planSourceBadgeEdit(dataset,owner,badge(),{at});
 for(const change of [{kind:'pir'},{kind:'led'},{note:'x'.repeat(601)},{assignee:'x'.repeat(161)},{due_date:'2026-02-30'},{status:'cancelled'},{extra:'injected'},{label:'Wrong kind'}])assert.throws(()=>planSourceBadgeEdit(dataset,owner,badge('genotyping',change),{at}));
 for(const mutate of [
  change=>change.value.event_type='other',change=>change.value.location_id='p2',change=>change.value.mouse_sid='m1',
  change=>change.value.card_badge_status.anchor='invented',change=>change.value.card_badge_status.extra='injected',
  change=>change.value.card_badge_status.work_badges[0].kind='pir',change=>change.value.event_date='2026-10-18',
 ]){const changes=structuredClone(plan.changes);mutate(changes[0]);assert.ok(validateSourceBadgeDrafts(dataset,changes).length);}
 const saved=applySourceBadgeDrafts(dataset,plan.changes);saved.tables.husbandry_events[0].comment='Keep me';
 const edit=planSourceBadgeEdit(saved,owner,badge('experiment'),{at:'2026-10-18T02:00:00Z'});edit.changes[0].value.comment='Overwrite';
 assert.throws(()=>applySourceBadgeDrafts(saved,edit.changes),/unrelated/);
 const forged={...owner,source:{...owner.source,anchor:'invented'}};assert.throws(()=>planSourceBadgeEdit(dataset,forged,badge(),{at}),/current literal/);
});
