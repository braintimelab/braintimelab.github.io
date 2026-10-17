import test from 'node:test';
import assert from 'node:assert/strict';
import { STRAIN_ACRONYMS, INSERTION_TYPES, getStrainRegistry, validateStrainDefinition, buildStrainDefinition, canonicalStrainName, strainNamingHelpHTML } from '../mouse-data/strain-registry.js';

const empty=()=>({tables:{mice:[{mouse_sid:'SYNTHETIC-1'}],husbandry_events:[]}});
const input=(code='P',extra={})=>({code,insertion_type:'knock_in',stock_reference:'Synthetic stock',notes:'Reviewed synthetic definition',...extra});
const clock={now:'2025-03-05T09:00:00Z',eventDate:'2025-03-05'};
const make=(code='P',extra={},dataset=empty())=>buildStrainDefinition(dataset,input(code,extra),clock);

test('strain guide documents corrected names without inventing a Meis1 acronym or modifying Cre variants',()=>{
  for(const gene of ['Bmal1','Meis1','Vgat'])assert.equal(canonicalStrainName(gene),gene+'-flox');
  assert.equal(canonicalStrainName('FoxJ-Cre'),'FoxJ1-CreERT2');assert.equal(canonicalStrainName('Vgat-Cre'),'Vgat-flox');assert.equal(canonicalStrainName('FoxJ-CreERT2'),'FoxJ1-CreERT2');
  assert.equal(STRAIN_ACRONYMS.some(row=>row.key==='M'||row.name==='Meis1-flox'),false);assert.match(strainNamingHelpHTML(),/Meis1-flox has no confirmed shorthand/);assert.match(strainNamingHelpHTML(),/Vgat-CRE is a legacy lab name/);
  const old=make('F').record;old.strain_definition.name='Foxj1-Cre';assert.deepEqual(validateStrainDefinition(old),[]);assert.equal(getStrainRegistry({tables:{husbandry_events:[old]}}).find(row=>row.key==='F').name,'FoxJ1-CreERT2');
});

test('registry preserves confirmed acronyms and separates unknown insertion types',()=>{
  const rows=getStrainRegistry(empty()),byCode=Object.fromEntries(rows.map(row=>[row.key,row]));
  assert.deepEqual(rows.map(row=>row.key),['P','E','B','F','V','AD','A','32','Vg','Gt','96']);
  assert.equal(byCode.P.name,'PER2::LUC');assert.equal(byCode.E.name,'Bmal1-ELuc');
  assert.equal(byCode.E.insertionType,'transgenic');
  for(const code of ['P','B','F','V','A','32','96'])assert.equal(byCode[code].insertionType,'knock_in');
  for(const code of ['Vg','Gt'])assert.equal(byCode[code].insertionType,'unknown');
  assert.equal(byCode.AD.insertionType,'transgenic');assert.match(byCode.AD.stockReference,/005864.*034832/);assert.match(byCode.AD.notes,/MGI:3524957/);
  assert.deepEqual(INSERTION_TYPES.map(row=>row.value),['unknown','transgenic','knock_in']);
  rows[0].name='Changed locally';assert.equal(STRAIN_ACRONYMS[0].name,'PER2::LUC');assert.equal(getStrainRegistry(empty())[0].name,'PER2::LUC');
});

test('definition upsert is immutable, keeps stable ID and creation time, and preserves unrelated data',()=>{
  const original=empty(),before=structuredClone(original),first=make('P',{},original);
  assert.deepEqual(original,before);assert.deepEqual(first.dataset.tables.mice,before.tables.mice);
  assert.equal(first.record.event_id,'STRAIN-P');assert.equal(first.record.event_type,'strain_definition');assert.equal(first.record.event_date,'2025-03-05');
  assert.equal(first.record.app_created_at,clock.now.replace('Z','.000Z'));
  const second=buildStrainDefinition(first.dataset,input('P',{insertion_type:'unknown',notes:'Recheck local stock'}),{now:'2025-03-06T02:00:00Z',eventDate:'2025-03-06'});
  assert.equal(second.dataset.tables.husbandry_events.length,1);assert.equal(second.record.app_created_at,first.record.app_created_at);assert.notEqual(second.record.app_modified_at,first.record.app_modified_at);
  assert.equal(first.record.strain_definition.insertion_type,'knock_in');
  const row=getStrainRegistry(second.dataset)[0];assert.equal(row.insertionType,'unknown');assert.equal(row.notes,'Recheck local stock');assert.equal(row.stockReference,'Synthetic stock');assert.equal(row.origin,'Colony strain registry');
});

test('invalid and archived definitions cannot silently override verified defaults',()=>{
  const record=make('P',{insertion_type:'transgenic'}).record;
  for(const changed of [
    {...record,event_id:'OTHER'},
    {...record,event_date:'2025-02-31'},
    {...record,strain_definition:{...record.strain_definition,insertion_type:'anything'}},
    {...record,strain_definition:{...record.strain_definition,name:'Wrong name'}},
    {...record,strain_definition:{...record.strain_definition,schema_version:2}},
    {...record,app_archived_at:'2025-03-10T00:00:00Z'},
    {...record,archived:true}
  ])assert.equal(getStrainRegistry({tables:{husbandry_events:[changed]}})[0].insertionType,'knock_in');
  assert.equal(getStrainRegistry({tables:{husbandry_events:[record]}})[0].insertionType,'transgenic');
});

test('validation covers type retention, known codes, ID stability and malformed metadata',()=>{
  const old=make().record;
  assert.deepEqual(validateStrainDefinition({event_type:'unrelated'}),[]);
  assert.match(validateStrainDefinition({...old,event_type:'note'},old).join(' '),/retain/);
  assert.match(validateStrainDefinition({...old,strain_definition:null}).join(' '),/required/);
  for(const value of [null,42,{},'x'.repeat(501)])assert.throws(()=>make('P',{stock_reference:value}),/Stock reference/);
  for(const value of [null,42,{},'x'.repeat(2001)])assert.throws(()=>make('P',{notes:value}),/Strain notes/);
  assert.throws(()=>make('M'),/Animal Sheet legend/);
  assert.throws(()=>make('P',{insertion_type:'__proto__'}),/Unknown, Transgenic or Knock-in/);
  assert.match(validateStrainDefinition(make('E',{insertion_type:'transgenic'}).record,old).join(' '),/saved strain code cannot change/);
  assert.throws(()=>buildStrainDefinition(empty(),input(),{eventDate:'2025-02-29'}),/valid strain-definition date/);
  assert.throws(()=>buildStrainDefinition(empty(),input(),{now:'invalid'}),/valid modification time/);
});

test('upsert does not overwrite collisions, duplicates or archived records',()=>{
  const record=make().record;
  for(const [rows,pattern] of [
    [[{event_id:'STRAIN-P',event_type:'other'}],/already used/],
    [[record,structuredClone(record)],/Duplicate/],
    [[{...record,app_archived_at:'2025-04-01'}],/archived/]
  ])assert.throws(()=>make('P',{}, {tables:{husbandry_events:rows}}),pattern);
});

test('unverified stock metadata stays blank and catalog defaults never modify animal genotype calls',()=>{
  const original={tables:{mice:[{mouse_sid:'00123',physical_tag:'FB-M0123'}],mouse_genes:[{mouse_sid:'00123',gene:'Bmal1',allele:'f/+'}],husbandry_events:[]}};
  for(const row of getStrainRegistry(original).filter(row=>!row.jaxReference))for(const field of ['formal_name','gene_symbol','allele_symbol','promoter','construct','reporter','recombinase','genetic_background','strain_source','references','genotyping_notes'])assert.equal(row[field],'');
  const built=make('F',{formal_name:' Synthetic official name ',gene_symbol:'Synthetic gene',allele_symbol:'Synthetic allele',promoter:'User-verified regulatory region',construct:'Conditional construct',reporter:'Synthetic reporter',recombinase:'Synthetic recombinase',genetic_background:'Recorded background',strain_source:'Recorded supplier',references:'DOI supplied by keeper',genotyping_notes:'Use the stock protocol'},original);
  assert.equal(built.record.strain_definition.schema_version,1);assert.equal(built.record.strain_definition.name,'FoxJ1-CreERT2');
  assert.equal(built.record.strain_definition.formal_name,'Synthetic official name');assert.equal(getStrainRegistry(built.dataset).find(row=>row.key==='F').promoter,'User-verified regulatory region');
  assert.deepEqual(built.dataset.tables.mice,original.tables.mice);assert.deepEqual(built.dataset.tables.mouse_genes,original.tables.mouse_genes);
});

test('legacy definitions remain valid and partial legacy saves retain richer stock metadata',()=>{
  const rich=make('P',{promoter:'Verified promoter',allele_symbol:'Saved allele'}).dataset;
  rich.tables.husbandry_events[0].strain_definition.future_extension={preserve:true};
  const updated=make('P',{notes:'Changed only old fields'},rich);
  assert.equal(updated.record.strain_definition.promoter,'Verified promoter');assert.equal(updated.record.strain_definition.allele_symbol,'Saved allele');
  assert.deepEqual(updated.record.strain_definition.future_extension,{preserve:true});
  const old=structuredClone(updated.record);
  for(const key of ['formal_name','gene_symbol','allele_symbol','promoter','construct','reporter','recombinase','genetic_background','strain_source','references','genotyping_notes'])delete old.strain_definition[key];
  assert.deepEqual(validateStrainDefinition(old),[]);assert.equal(getStrainRegistry({tables:{husbandry_events:[old]}})[0].promoter,'');
});

test('optional metadata is bounded typed text, including explicit clears',()=>{
  for(const [field,max] of [['formal_name',500],['gene_symbol',200],['allele_symbol',500],['promoter',500],['construct',1000],['reporter',500],['recombinase',500],['genetic_background',500],['strain_source',500],['references',1500],['genotyping_notes',2000]]){
    assert.throws(()=>make('P',{[field]:42}),/must be text/);assert.throws(()=>make('P',{[field]:'x'.repeat(max+1)}),/must be text/);
    assert.equal(make('P',{[field]:'x'.repeat(max)}).record.strain_definition[field].length,max);
  }
  const old=make('P',{promoter:'Verified'}).dataset;assert.equal(make('P',{promoter:''},old).record.strain_definition.promoter,'');
});
