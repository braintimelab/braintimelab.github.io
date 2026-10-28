// Portable synthetic IACUC allowance/history tests; no account or network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../mouse-data/iacuc-portal-usage.js',import.meta.url),'utf8');
const {previewIacucPortalImport,getIacucPortalUsage,validateIacucPortalSnapshot,validateIacucPortalHistoryChange}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

const NOW='2026-10-27T15:00:00.000Z';
function fixture(){return {schema_version:'1.0',sources:[{label:'Synthetic only'}],tables:{mice:[{mouse_sid:'1',protocol:'SHLAC2026-0001'}],cages:[],husbandry_events:[{event_id:'P1',event_type:'iacuc_protocol',event_date:'2026-01-01',record_origin:'source_import',source_record_id:'SYNTHETIC',iacuc_protocol:{schema_version:1,protocol_id:'P1',number:'SHLAC2026-0001',title:'Synthetic fixture only',status:'approved',approved_animals:100,start_date:'2026-01-01',end_date:'2028-12-31',allocations:[{id:'original',species:'mouse',approved:100,portal_used:30}],document:{text:'Synthetic approved document; preserve exactly.'},notes:'Preserve original notes.'}},{event_id:'U1',event_type:'iacuc_usage',iacuc_usage:{protocol_id:'P1',mouse_sids:['1'],unregistered_count:4}}]}};}
const record=data=>data.tables.husbandry_events[0];
const bucket=overrides=>({period_id:'fy-2026',period_kind:'financial_year',period_label:'FY 2026/27 (source label)',scope_label:'All mice for this protocol',species:'mouse',unit:'mice',start_date:'2026-07-01',end_date:'2027-06-30',allowance:100,used:30,pending:null,remaining:null,used_complete:true,same_scope:true,pending_is_disjoint:false,breakdowns:[],...overrides});
const snapshot=(overrides={})=>({schema_version:1,protocol_number:'SHLAC2026-0001',portal_protocol_id:'synthetic-portal-1',source_url:'https://sh-acis.tmu.edu.tw/',source_page:'Synthetic usage row',observed_at:NOW,as_of_date:'2026-10-27',coverage:'complete',periods:[bucket()],...overrides});
const envelope=value=>({schema_version:1,snapshots:[value]});
const run=(data,value,opts={})=>previewIacucPortalImport(data,envelope(value),{now:NOW,...opts});
async function imported(value=snapshot(),data=fixture()){const result=await run(data,value);assert.deepEqual(result.errors,[]);return result.dataset;}
const summary=(data,options={})=>getIacucPortalUsage(record(data),{day:'2026-10-27',now:NOW,...options});

test('append changes only the new nested history field, preserving approved documents, allocations and local use',async()=>{
 const data=fixture(),original=structuredClone(data),result=await run(data,snapshot());assert.deepEqual(result.errors,[]);assert.equal(result.changes.length,1);assert.equal(result.changes[0].protocolId,'P1');assert.match(result.changes[0].hash,/^[a-f0-9]{64}$/);assert.deepEqual(data,original);
 const changed=structuredClone(record(result.dataset));delete changed.iacuc_protocol.portal_usage_snapshots;assert.deepEqual(changed,record(original));assert.strictEqual(result.dataset.tables.husbandry_events[1],data.tables.husbandry_events[1]);assert.strictEqual(result.dataset.tables.mice,data.tables.mice);
});
test('observation timestamp alone creates no write/version',async()=>{
 const data=await imported();const r=await run(data,snapshot({observed_at:'2026-10-27T15:01:00Z'}),{now:'2026-10-27T15:02:00Z'});assert.deepEqual(r.errors,[]);assert.equal(r.unchangedCount,1);assert.equal(r.changes.length,0);assert.strictEqual(r.dataset,data);
});
test('changed cumulative use replaces comparison, never adds to yesterday; a correction can return to an older value',async()=>{
 let data=await imported();data=await imported(snapshot({periods:[bucket({used:40})]}),data);data=await imported(snapshot({periods:[bucket({used:30})]}),data);assert.equal(record(data).iacuc_protocol.portal_usage_snapshots.length,3);assert.equal(summary(data).selected.used,30);assert.equal(summary(data).selected.calculatedNotYetUsed,70);
});
test('unknown reservations produce only not-yet-used, no available authorization',async()=>{
 const p=summary(await imported()).selected;assert.equal(p.remainingDisplay,70);assert.equal(p.remainingKind,'not_yet_used');assert.equal(p.calculatedAvailable,null);assert.equal(p.currentAuthorization,false);
});
test('explicit disjoint pending, including zero, supports labelled available calculation',async()=>{
 const p=summary(await imported(snapshot({periods:[bucket({pending:5,pending_is_disjoint:true})]}))).selected;assert.equal(p.calculatedAvailable,65);assert.equal(p.remainingKind,'calculated_available');assert.equal(p.currentAuthorization,true);
 const zero=summary(await imported(snapshot({periods:[bucket({pending:0,pending_is_disjoint:true})]}))).selected;assert.equal(zero.calculatedAvailable,70);
});
test('official remaining is retained independently and discrepancy is visible',async()=>{
 const result=summary(await imported(snapshot({periods:[bucket({pending:5,pending_is_disjoint:true,remaining:60})]})));assert.equal(result.selected.remainingDisplay,60);assert.equal(result.selected.remainingKind,'portal');assert.equal(result.selected.calculatedAvailable,65);assert.equal(result.selected.currentAuthorization,false);assert(result.warnings.some(w=>w.includes('differs')));
});
test('negative source remaining and calculated overuse are preserved without clamping',async()=>{
 const p=summary(await imported(snapshot({periods:[bucket({allowance:10,used:12,remaining:-2})]}))).selected;assert.equal(p.remainingDisplay,-2);assert.equal(p.overBy,2);assert.equal(p.calculatedNotYetUsed,-2);assert.equal(p.currentAuthorization,false);
});
test('explicit zero, missing used, unknown allowance and mismatched scope remain distinct',async()=>{
 const zero=summary(await imported(snapshot({periods:[bucket({allowance:0,used:0,pending:0,pending_is_disjoint:true})]}))).selected;assert.equal(zero.remainingDisplay,0);assert.equal(zero.percentUsed,null);assert.equal(zero.currentAuthorization,false);
 const missing=summary(await imported(snapshot({periods:[bucket({used:null,used_complete:false})]}))).selected;assert.equal(missing.calculatedNotYetUsed,null);
 const unknown=summary(await imported(snapshot({periods:[bucket({allowance:null,remaining:4})]}))).selected;assert.equal(unknown.currentAuthorization,false);
 const mismatch=summary(await imported(snapshot({periods:[bucket({same_scope:false})]}))).selected;assert.equal(mismatch.remainingDisplay,null);
});
test('financial year boundaries are explicit and no January reset or rollover is inferred',async()=>{
 const data=await imported();assert.equal(summary(data,{day:'2027-01-01',periodId:'fy-2026'}).selected.used,30);assert.equal(summary(data,{day:'2027-06-30',periodId:'fy-2026'}).selected.periodStatus,'current');assert.equal(summary(data,{day:'2027-07-01',periodId:'fy-2026'}).selected.periodStatus,'expired');assert.equal(summary(data,{day:'2026-06-30',periodId:'fy-2026'}).selected.periodStatus,'future');
});
test('overlapping annual, grant and protocol-total buckets require selection and are never summed',async()=>{
 const data=await imported(snapshot({periods:[bucket(),bucket({period_id:'grant',period_kind:'grant_duration',period_label:'Synthetic grant',start_date:'2026-01-01',end_date:'2028-12-31',allowance:250,used:80}),bucket({period_id:'total',period_kind:'protocol_total',period_label:'Protocol lifetime',start_date:'2026-01-01',end_date:'2028-12-31',allowance:400,used:100})]}));const s=summary(data);assert.equal(s.status,'period_required');assert.equal(s.selected,null);assert.equal(s.periods.length,3);assert.equal(summary(data,{periodId:'grant'}).selected.used,80);
});
test('a sole labelled source bucket is displayed without pretending its unspecified dates are current',async()=>{
 const data=await imported(snapshot({periods:[bucket({start_date:null,end_date:null,remaining:70})]}));const p=summary(data).selected;assert.equal(p.remainingDisplay,70);assert.equal(p.datesKnown,false);assert.equal(p.periodStatus,'unknown');assert.equal(p.currentAuthorization,false);
});
test('omitted periods and prior breakdown evidence survive partial captures; unknown current used stays unknown',async()=>{
 let data=await imported(snapshot({periods:[bucket({breakdowns:[{axis:'genotype',label:'A',used:30},{axis:'room',label:'SPF',used:30}]}),bucket({period_id:'grant',period_kind:'grant_duration',period_label:'Grant',start_date:'2026-01-01',end_date:'2028-12-31',used:70})]}));data=await imported(snapshot({coverage:'partial',periods:[bucket({used:null,used_complete:false})]}),data);
 const s=summary(data,{periodId:'fy-2026'});assert.equal(s.periods.length,2);assert.equal(s.selected.used,null);assert.equal(s.selected.remainingDisplay,null);assert.equal(summary(data,{periodId:'grant'}).selected.used,70);assert.equal(record(data).iacuc_protocol.portal_usage_snapshots[0].periods.find(p=>p.period_id==='fy-2026').breakdowns.length,2);
});
test('overlapping genotype and room breakdowns do not alter the authoritative total',async()=>{
 const p=summary(await imported(snapshot({periods:[bucket({breakdowns:[{axis:'genotype',label:'A',used:30},{axis:'room',label:'SPF',used:30}]})]}))).selected;assert.equal(p.used,30);assert.equal(p.breakdowns.length,2);assert.equal(p.calculatedNotYetUsed,70);
});
test('stale observed or source-as-of evidence is never current authorization',async()=>{
 const data=await imported(snapshot({periods:[bucket({remaining:70})]}));assert.equal(summary(data,{now:'2026-10-30T15:00:00Z'}).selected.stale,true);assert.equal(summary(data,{now:'2026-10-30T15:00:00Z'}).selected.currentAuthorization,false);
 const oldAsOf=summary(await imported(snapshot({as_of_date:'2026-10-01',periods:[bucket({remaining:70})]}))).selected;assert.equal(oldAsOf.stale,true);
});
test('exact protocol, mouse species, units, portal identity and target are checked',async()=>{
 for(const bad of [snapshot({protocol_number:'LAC2026-0001'}),snapshot({periods:[bucket({species:'rat'})]}),snapshot({periods:[bucket({unit:'cages'})]})])assert((await run(fixture(),bad)).errors.length);
 assert((await run(fixture(),snapshot(),{targetProtocolId:'P-other'})).errors.length);
 const data=await imported();assert((await run(data,snapshot({portal_protocol_id:'another-approval'}))).errors.length);
});
test('source URL credentials, tokens, external origin and invalid dates/counts fail closed',async()=>{
 for(const url of ['https://example.com/','https://user:pass@sh-acis.tmu.edu.tw/','https://sh-acis.tmu.edu.tw/?token=secret','https://sh-acis.tmu.edu.tw/#session','http://sh-acis.tmu.edu.tw/'])assert((await run(fixture(),snapshot({source_url:url}))).errors.length);
 for(const p of [bucket({allowance:-1}),bucket({used:1.5}),bucket({used:Number.MAX_SAFE_INTEGER+1}),bucket({pending_is_disjoint:true}),bucket({start_date:'2026-02-30'}),bucket({start_date:'2028-01-01',end_date:'2027-01-01'})])assert((await run(fixture(),snapshot({periods:[p]}))).errors.length);
 assert((await run(fixture(),snapshot({observed_at:'2026-02-30T12:00:00Z'}))).errors.length);assert((await run(fixture(),snapshot({observed_at:'2026-10-27T24:00:00Z'}))).errors.length);
});
test('all-or-nothing multi-protocol input, duplicate periods and damaged JSON fail without a candidate dataset',async()=>{
 const r=await previewIacucPortalImport(fixture(),{schema_version:1,snapshots:[snapshot(),snapshot({protocol_number:'unknown'})]},{now:NOW});assert(r.errors.length);assert.equal(r.dataset,null);assert.deepEqual(r.changes,[]);
 assert((await run(fixture(),snapshot({periods:[bucket(),bucket()]}))).errors.length);assert((await previewIacucPortalImport(fixture(),'{bad')).errors.length);
});
test('older observations cannot roll current evidence backward; forged content hash fails',async()=>{
 const data=await imported();assert((await run(data,snapshot({observed_at:'2026-10-26T15:00:00Z',as_of_date:'2026-10-26',periods:[bucket({used:40})]}))).errors.length);assert((await run(fixture(),snapshot({content_sha256:'a'.repeat(64)}))).errors.length);
});
test('history guard rejects deletion, mutation, reorder, co-edits and malformed appended values',async()=>{
 const data=await imported(),before=record(data);const next=await run(data,snapshot({periods:[bucket({used:31})]}));assert.deepEqual(validateIacucPortalHistoryChange(before,next.changes[0].record,{now:NOW}).errors,[]);
 for(const mutate of [r=>r.iacuc_protocol.portal_usage_snapshots.shift(),r=>r.iacuc_protocol.portal_usage_snapshots[0].periods[0].used=999,r=>r.iacuc_protocol.portal_usage_snapshots.reverse(),r=>r.iacuc_protocol.document.text='changed',r=>r.iacuc_protocol.portal_usage_snapshots.at(-1).periods[0].species='rat']){const r=structuredClone(next.changes[0].record);mutate(r);assert(validateIacucPortalHistoryChange(before,r,{now:NOW}).errors.length);}
});
test('restricted projections can summarize without private URLs or source-page identifiers',async()=>{
 const data=await imported(),row=structuredClone(record(data));for(const s of row.iacuc_protocol.portal_usage_snapshots){delete s.source_url;delete s.source_page;delete s.portal_protocol_id;}const p=getIacucPortalUsage(row,{day:'2026-10-27',now:NOW}).selected;assert.equal(p.used,30);assert.equal(p.sourceURL,null);assert.equal(p.sourcePage,null);
});
test('invalid stored history is not silently overwritten by a new import',async()=>{
 const data=fixture();record(data).iacuc_protocol.portal_usage_snapshots={bad:'format'};const r=await run(data,snapshot());assert(r.errors.some(e=>e.includes('malformed')));assert.equal(r.dataset,null);
});
test('default absent confirmations never imply paired scope or complete use',()=>{
 const s=snapshot({periods:[bucket()]});delete s.periods[0].same_scope;delete s.periods[0].used_complete;const r=validateIacucPortalSnapshot(s,record(fixture()),{now:NOW});assert.deepEqual(r.errors,[]);assert.equal(r.snapshot.periods[0].same_scope,false);assert.equal(r.snapshot.periods[0].used_complete,false);
});

const tab=(ordinal,label,allowance,used,pending,remaining)=>({allocation_id:'synthetic-tab-'+ordinal,ordinal,label,species:'mouse',unit:'mice',allowance,used,pending,remaining});
const allocationBucket=allocations=>bucket({period_id:'source-allocation-scope-unspecified',period_kind:'unknown',period_label:'Allowance period not specified by portal',start_date:null,end_date:null,allowance:null,used:null,pending:null,remaining:null,count_basis:'complete_allocation_sum',allocation_partition_complete:true,allocations});
test('complete disjoint source tabs derive explicit allocation totals with unknown allowance period',async()=>{
 const rows=[tab(1,'Literal same strain',100,7,0,93),tab(2,'Literal same strain',80,3,0,77),tab(3,'Literal same strain',20,5,0,15)];const result=await run(fixture(),snapshot({periods:[allocationBucket(rows)]}));assert.deepEqual(result.errors,[]);const p=summary(result.dataset).selected;assert.equal(p.allowance,200);assert.equal(p.used,15);assert.equal(p.pending,0);assert.equal(p.remainingDisplay,185);assert.equal(p.remainingKind,'allocation_sum');assert.equal(p.countBasis,'complete_allocation_sum');assert.equal(p.currentAuthorization,false);assert.equal(p.calculatedNotYetUsed,null);assert.equal(p.allocations.length,3);assert.deepEqual(p.allocations.map(r=>r.label),rows.map(r=>r.label));assert(p.warnings.some(w=>w.includes('not an explicit overall row')));
});
test('allocation aggregation rejects incomplete/overlapping/unmatched species rows and supplied false totals',async()=>{
 const rows=[tab(1,'Source A',10,2,0,8),tab(2,'Source B',20,3,0,17)],base=allocationBucket(rows);
 for(const p of [{...base,allocation_partition_complete:false},{...base,same_scope:false},{...base,used:100},{...base,allocations:[rows[0],rows[0]]},{...base,allocations:[rows[0],{...rows[1],species:'rat'}]},{...base,allocations:[rows[0],{...rows[1],used:null}]}])assert((await run(fixture(),snapshot({periods:[p]}))).errors.length);
});
test('reported overall totals survive a disagreement with complete allocation rows',async()=>{
 const rows=[tab(1,'Source A',10,2,0,8),tab(2,'Source B',20,3,0,17)];const p=summary(await imported(snapshot({periods:[bucket({allowance:40,used:6,remaining:34,count_basis:'reported',allocation_partition_complete:true,allocations:rows})]}))).selected;assert.equal(p.used,6);assert.equal(p.allowance,40);assert.equal(p.remainingDisplay,34);assert(p.warnings.some(w=>w.includes('used total differs')));assert.equal(p.currentAuthorization,false);
});
test('source period IDs cannot be repurposed for a new financial year or grant scope',async()=>{
 const data=await imported();for(const p of [bucket({period_label:'Next FY'}),bucket({start_date:'2027-07-01',end_date:'2028-06-30'}),bucket({scope_label:'A different allocation'})])assert((await run(data,snapshot({periods:[p]}))).errors.length);
 const next=await run(data,snapshot({periods:[bucket({period_id:'fy-2027',period_label:'FY 2027/28',start_date:'2027-07-01',end_date:'2028-06-30'})]}));assert.deepEqual(next.errors,[]);assert.equal(summary(next.dataset).periods.length,2);
});
