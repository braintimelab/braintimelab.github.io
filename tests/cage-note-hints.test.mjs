import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inferNoteBadges} from '../mouse-data/cage-note-badges.js';

const sql=readFileSync(new URL('../sql/cage-note-hints.sql',import.meta.url),'utf8');
// These contracts exercise the SQL's literal allowlist and its actual consumer.
// They do not replace compiling/executing the function in PostgreSQL.
const rules=[...sql.matchAll(/when c\.note ~ '((?:''|[^'])*)' then '((?:''|[^'])*)'/g)]
  .map(([,pattern,value])=>({pattern:new RegExp(pattern.replaceAll("''","'")),value:value.replaceAll("''","'")}));
const normalize=value=>value.replace(/\s+/g,' ').trim().toLowerCase();
const hint=value=>rules.find(row=>row.pattern.test(normalize(value)))?.value??null;
const kinds=value=>inferNoteBadges(value).map(row=>row.kind);

test('hint RPC retains verified active-member access, definer isolation, and read-only source access',()=>{
  assert.match(sql,/returns jsonb language plpgsql stable security definer set search_path=''/);
  for(const guard of [
    /auth\.uid\(\) is null or colony_private\.current_role\(p_colony_id\) is null/,
    /u\.email_confirmed_at is not null/,/is_anonymous/,/banned_until/,/deleted_at/,
  ])assert.match(sql,guard);
  assert.doesNotMatch(sql,/colony_private\.has_permission\(/,'Viewer reads cannot require a write capability');
  assert.match(sql,/r\.colony_id=p_colony_id and r\.entity_type='locations' and not r\.archived/);
  for(const field of ['app_archived_at','source_current','history_read_only','source_historical','_derived'])assert.ok(sql.includes(`r.payload->${field==='app_archived_at'?'>':''}'${field}'`),field);
  assert.match(sql,/revoke all on function public\.list_cage_note_hints\(uuid\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.list_cage_note_hints\(uuid\) to authenticated/);
  assert.doesNotMatch(sql,/\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+table)\b/i);
});

test('projection only returns fixed allowlisted phrases and excludes animal rows and note duplicates',()=>{
  assert.ok(rules.length>=16);
  const allowed=new Set(['Genotyping','Genotyping done','no genotyping needed','Experiment','Experiment done','no experiment planned',
    'PIR!','PIR not good','PIR not good but usable','PIR fixed','PIR normal','no PIR problem',
    'LED!','LED not good','LED not good but usable','LED fixed','LED normal','no LED problem']);
  for(const {pattern,value} of rules){assert.ok(pattern.source.startsWith('^')&&pattern.source.endsWith('$'));assert.ok(allowed.has(value),value);}
  assert.match(sql,/substring\(a\.animal->>'sourceCell' from '\[0-9\]\+\$'\)=substring\(c\.parts\[1\] from '\[0-9\]\+\$'\)/);
  assert.match(sql,/not exists\(select 1 from animal_notes a where a\.location_id=c\.location_id and a\.note=c\.note\)/);
  assert.match(sql,/else null end as note/);
  assert.match(sql,/jsonb_agg\(distinct note order by note\)/);
  assert.match(sql,/jsonb_build_object\('location_id',location_id,'notes',notes\)/);
});

test('known headers and faults retain intent after case and whitespace normalization',()=>{
  for(const [input,canonical,kind] of [
    [' GENOTYPING  ','Genotyping','genotyping'],['experiment','Experiment','experiment'],
    ['PIR!','PIR!','pir'],['PIR   not good','PIR not good','pir'],
    ['PIR not good but usable','PIR not good but usable','pir'],
    ['LED broken','LED not good','led'],["LED doesn't work",'LED not good','led'],
  ]){assert.equal(hint(input),canonical,input);assert.deepEqual(kinds(canonical),[kind],input);}
});

test('resolution hints clear prior intent for every kind in the actual badge parser',()=>{
  for(const [active,resolved,canonical] of [
    ['Genotyping','Genotyping completed','Genotyping done'],['Genotyping','no genotyping needed','no genotyping needed'],
    ['Experiment','Experiment finished','Experiment done'],['Experiment','no experiment planned','no experiment planned'],
    ['PIR!','PIR fixed','PIR fixed'],['PIR!','PIR normal','PIR normal'],['PIR!','no PIR problem','no PIR problem'],
    ['LED broken','LED repaired','LED fixed'],['LED broken','LED normal','LED normal'],['LED broken','no LED problem','no LED problem'],
  ]){assert.equal(hint(resolved),canonical,resolved);assert.deepEqual(kinds(`${hint(active)}\n${canonical}`),[],resolved);}
});

test('conditionals, identities, numeric fields, fees, and arbitrary source text fail closed',()=>{
  for(const input of [
    'if PIR broken','PIR broken if needed','PIR may be broken','PIR would be broken','Experiment if needed',
    'Genotyping $100','Experiment P-M1234','P-M1','(P)-M1','2026-01-01','100 lux','100 TWD',
    'Genotyping; account 1234','PIR! fixed','LED broken but repaired','not genotyping','some Experiment results',
    'A1: Genotyping','B2 comment: PIR!',
  ])assert.equal(hint(input),null,input);
});
