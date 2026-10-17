import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// SQL contract checks. The hosted migration must also be checked after applying;
// these tests do not claim to execute PostgreSQL or replace a live permission test.
const sql=await readFile(new URL('../sql/cryopreservation-manager-edit.sql',import.meta.url),'utf8');
const code=sql.replace(/--[^\n]*/g,'');
const predicate=code.match(/function colony_private\.is_cryopreservation_record\(kind text,p jsonb\)([\s\S]*?)\$\$;/)?.[1];
const guard=code.match(/function colony_private\.guard_cryopreservation_manager_edit\(\)([\s\S]*?)end \$\$;/)?.[1];

test('managed cryopreservation is recognized by typed event or nested data, including missing payloads',()=>{
  assert(predicate);
  assert.match(predicate,/returns boolean language sql immutable set search_path=''/);
  assert.match(predicate,/coalesce\(kind='husbandry_events' and/);
  assert.match(predicate,/coalesce\(p->>'event_type',''\) like 'cryopreservation%'/);
  assert.match(predicate,/or p \?\| array\['cryopreservation','cryopreservation_event'\]/);
  assert.match(predicate,/\),false\)/);
});

test('every authenticated insert and update checks the active owner or manager in its colony',()=>{
  assert(guard);
  assert.match(guard,/returns trigger language plpgsql security definer set search_path=''/);
  assert.match(guard,/is_cryopreservation_record\(new\.entity_type,new\.payload\)[\s\S]*?coalesce\(colony_private\.current_role\(new\.colony_id\),''\) not in \('owner','manager'\) then\s*raise exception using errcode='42501'/);
  assert.match(code,/create trigger guard_cryopreservation_manager_edit before insert or update on public\.entity_records\s+for each row execute function colony_private\.guard_cryopreservation_manager_edit\(\)/);
  assert.doesNotMatch(guard,/'editor'|'viewer'|'high'|'low'/);
});

test('existing cryopreservation cannot evade the guard by changing its event type, fields or colony',()=>{
  assert.match(guard,/if TG_OP='UPDATE' then\s*if colony_private\.is_cryopreservation_record\(old\.entity_type,old\.payload\)[\s\S]*?coalesce\(colony_private\.current_role\(old\.colony_id\),''\) not in \('owner','manager'\) then\s*raise exception using errcode='42501'/);
  assert.equal((guard.match(/raise exception using errcode='42501'/g)||[]).length,2);
  assert.doesNotMatch(code,/update of\s+payload/i);
});

test('trusted service path is preserved without changing RPC, RLS, fees, membership or data',()=>{
  assert.match(guard,/if auth\.uid\(\) is null then return new;end if;/);
  assert(guard.indexOf('if auth.uid() is null')<guard.indexOf('is_cryopreservation_record(new.'));
  assert.doesNotMatch(code,/\b(?:insert into|update public|delete from|truncate|grant|disable|alter table|alter function)\b/i);
  assert.doesNotMatch(code,/create or replace function\s+(?:public\.|colony_private\.(?:assert_record_permission|current_role|save_record|fee_))/i);
  assert.match(code,/^\s*begin;/);
  assert.match(code,/commit;\s*$/);
});

test('reapplication replaces only its own trigger and private helper functions are not callable by clients',()=>{
  assert.match(code,/drop trigger if exists guard_cryopreservation_manager_edit on public\.entity_records/);
  for(const signature of ['is_cryopreservation_record\\(text,jsonb\\)','guard_cryopreservation_manager_edit\\(\\)'])
    assert.match(code,new RegExp(`revoke all on function colony_private\\.${signature} from public,anon,authenticated`));
  assert.equal((code.match(/drop trigger/g)||[]).length,1);
  assert.equal((code.match(/create or replace function/g)||[]).length,2);
});
