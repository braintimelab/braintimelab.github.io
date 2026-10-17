import test from 'node:test';
import assert from 'node:assert/strict';
import { tableHistoryConfig,tableRecordDate,tableHistoryView,compareTableRecency,tableHistoryPage } from '../mouse-data/table-history.js';

const asOf='2026-10-17',view=(type,records,options={})=>tableHistoryView(type,records,{asOf,...options});
const mouse=(id,date,extra={})=>({mouse_sid:id,date_of_birth:date,...extra});

test('Mice, Breeding, and Litters use biological dates without import or edit dates',()=>{
 assert.deepEqual(tableHistoryConfig('mice'),{id:'mouse_sid',date:'date_of_birth'});
 assert.deepEqual(tableHistoryConfig('matings'),{id:'mating_sid',date:'set_up_date'});
 assert.deepEqual(tableHistoryConfig('litters'),{id:'litter_sid',date:'date_of_birth'});
 assert.equal(tableHistoryConfig('cages'),null);
 for(const type of ['mice','matings','litters'])assert.equal(tableRecordDate(type,{app_created_at:'2026-10-17',app_modified_at:'2026-10-17',source_snapshot_date:'2026-10-17'}),null);
 assert.equal(tableRecordDate('matings',{set_up_date:'2024-01-01',date_of_birth:'2026-01-01'}),'2024-01-01');
});

test('initial sparse three-year window never fills its vacant rows with older records',()=>{
 const rows=[mouse('1','2023-10-17'),mouse('2','2023-10-16'),mouse('3','2026-10-17'),mouse('4','2018-01-01',{state:'Stock'})],snapshot=structuredClone(rows);
 const result=view('mice',rows);
 assert.deepEqual(result.rows.map(row=>row.mouse_sid),['1','3']);assert.equal(result.hasOlder,true);
 assert.equal(result.start,'2023-10-17');assert.equal(result.end,null);assert.equal(result.label,'Since 2023-10-17');assert.deepEqual(rows,snapshot);
 const prior=view('mice',rows,{windowIndex:1});assert.deepEqual(prior.rows.map(row=>row.mouse_sid),['2']);assert.equal(prior.end,'2023-10-17');assert.equal(prior.label,'2020-10-17 – 2023-10-16');assert.equal(prior.hasOlder,true);
});

test('empty and short first windows leave Next available only when older dated records exist',()=>{
 const rows=[mouse('old','2021-01-01')],initial=view('mice',rows);
 assert.equal(initial.rows.length,0);assert.equal(initial.hasOlder,true);
 assert.deepEqual(tableHistoryPage({...initial,rowCount:0,page:0},'next'),{windowIndex:1,undated:false,page:0});
 const older=view('mice',rows,{windowIndex:1});assert.equal(older.hasOlder,false);
 assert.deepEqual(tableHistoryPage({...older,rowCount:1,page:0},'next'),{windowIndex:1,undated:false,page:0});
 assert.equal(view('mice',[]).hasOlder,false);
});

test('future breeding schedules remain visible and are ordered first in the initial window',()=>{
 const rows=[{mating_sid:'1',set_up_date:'2026-11-01'},{mating_sid:'2',set_up_date:'2026-10-17'},{mating_sid:'3',set_up_date:'2023-10-16'}];
 assert.deepEqual(view('matings',rows).rows.sort((a,b)=>compareTableRecency('matings',a,b)).map(row=>row.mating_sid),['1','2']);
});

test('leap-day anchor uses disjoint calendar-year windows and never loses boundary dates',()=>{
 const rows=['2021-02-27','2021-02-28','2021-03-01','2018-02-27','2018-02-28'].map((date,i)=>mouse(String(i),date));
 const current=tableHistoryView('mice',rows,{asOf:'2024-02-29'}),older=tableHistoryView('mice',rows,{asOf:'2024-02-29',windowIndex:1});
 assert.equal(current.start,'2021-02-28');assert.equal(older.end,'2021-02-28');assert.equal(older.start,'2018-02-28');
 assert.deepEqual(current.rows.map(row=>row.date_of_birth),['2021-02-28','2021-03-01']);
 assert.deepEqual(older.rows.map(row=>row.date_of_birth),['2021-02-27','2018-02-28']);
});

test('blank and malformed dates remain separately accessible and never imply historical coverage',()=>{
 const rows=[mouse('valid','2026-01-01'),...['',null,'2023-02-30','2026-13-01','2026-1-1','2026-01-01T00:00:00Z'].map((date,i)=>mouse(String(i),date))];
 const dated=view('mice',rows),undated=view('mice',rows,{undated:true});
 assert.equal(dated.rows.length,1);assert.equal(dated.undatedCount,6);assert.equal(dated.hasOlder,false);
 assert.equal(undated.rows.length,6);assert.equal(undated.label,'Undated');assert.equal(undated.hasOlder,false);
 assert.equal(view('mice',[mouse('blank',null)]).hasOlder,false);
 assert.throws(()=>view('mice',rows,{asOf:'2023-02-30'}),/valid table date/);
 assert.throws(()=>view('mice',rows,{windowIndex:-1}),/Invalid table history window/);
});

test('newest-first sorting has deterministic SID ties, with undated rows last',()=>{
 for(const type of ['mice','matings','litters']){
  const cfg=tableHistoryConfig(type),rows=[{[cfg.id]:'10',[cfg.date]:'2026-01-01'},{[cfg.id]:'2',[cfg.date]:'2026-01-01'},{[cfg.id]:'02',[cfg.date]:'2026-01-01'},{[cfg.id]:'z',[cfg.date]:'2026-10-01'},{[cfg.id]:'1',[cfg.date]:null}];
  const sorted=[...rows].sort((a,b)=>compareTableRecency(type,a,b));
  assert.equal(sorted[0][cfg.id],'z');assert.equal(sorted.at(-1)[cfg.id],'1');
  assert.deepEqual([...rows].reverse().sort((a,b)=>compareTableRecency(type,a,b)),sorted);
 }
});

test('row pagination finishes the current window before stepping into an older window',()=>{
 let state={windowIndex:0,undated:false,page:0,rowCount:51,pageSize:50,hasOlder:true};
 const second=tableHistoryPage(state,'next');assert.deepEqual(second,{windowIndex:0,undated:false,page:1});
 const older=tableHistoryPage({...state,...second},'next');assert.deepEqual(older,{windowIndex:1,undated:false,page:0});
 const back=tableHistoryPage({...state,...older,rowCount:20},'previous');assert.equal(back.windowIndex,0);assert.equal(back.page,Number.MAX_SAFE_INTEGER);
 assert.deepEqual(tableHistoryPage({...state,...back},'previous'),{windowIndex:0,undated:false,page:0});
 assert.deepEqual(tableHistoryPage({...state,hasOlder:false,page:1},'next'),{windowIndex:0,undated:false,page:1});
 assert.deepEqual(tableHistoryPage({...state,undated:true,page:1},'next'),{windowIndex:0,undated:true,page:1});
});
