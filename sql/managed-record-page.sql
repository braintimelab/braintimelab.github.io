-- Apply after the maintained member/domain/financial and read-context stack.
-- A bounded read page, not a replacement dataset or a new write authority.
begin;
do $guard$
declare f regprocedure;tag text:='Braintime managed record page v1';p record;expected text;
begin
 if to_regprocedure('colony_private.member_app_context(uuid)') is null
  or to_regprocedure('colony_private.member_mouse_restricted(public.memberships)') is null
  or to_regprocedure('colony_private.managed_location_payload(jsonb)') is null
  or to_regprocedure('colony_private.fee_payload(jsonb,boolean,boolean,boolean)') is null
  or to_regprocedure('colony_private.fee_current_record(uuid,jsonb)') is null
  or to_regprocedure('colony_private.fee_full_access(uuid)') is null then
  raise exception 'Apply the maintained member and financial read projections first';
 end if;
 -- The definer page implements this inspected read/projection boundary. A
 -- new or changed direct-table policy requires review, not a silent bypass.
 if (select count(*) from pg_policy where polrelid='public.entity_records'::regclass and polcmd in ('r','*'))<>4 then
  raise exception 'Managed record read policies require review';
 end if;
 for p in select polname,polpermissive,polroles,pg_get_expr(polqual,polrelid) expression from pg_policy where polrelid='public.entity_records'::regclass and polcmd in ('r','*') loop
  expected:=case p.polname
   when 'records_member_read' then '(colony_private.current_role(colony_id) IS NOT NULL)'
   when 'records_member_app_visibility' then 'colony_private.member_mouse_row_allowed(colony_id, entity_type, payload)'
   when 'records_financial_visibility' then '(((entity_type <> ALL (ARRAY[''archive''::text, ''locations''::text])) AND (NOT colony_private.fee_is_record(entity_type, payload))) OR colony_private.fee_full_access(colony_id))'
   when 'records_owner_source_archive' then '((entity_type <> ALL (ARRAY[''archive''::text, ''locations''::text])) OR colony_private.can_read_source_archive(colony_id))'
   else null end;
  if expected is null or p.polpermissive<>(p.polname='records_member_read') or p.polroles<>array['authenticated'::regrole::oid]
   or regexp_replace(lower(p.expression),'[[:space:]"]','','g') is distinct from regexp_replace(lower(expected),'[[:space:]"]','','g') then
   raise exception 'Managed record read policy requires review: %',p.polname;
  end if;
 end loop;
 foreach f in array array[
  to_regprocedure('colony_private.managed_record_current(text,text,jsonb,boolean,text[],text[],text[],text[],text[])'),
  to_regprocedure('public.get_managed_record_page(uuid,text,text,text[],text,integer,boolean)')
 ] loop
  if f is not null and obj_description(f,'pg_proc') is distinct from tag||':'||md5(pg_get_functiondef(f)) then
   raise exception 'Existing managed-page function requires review: %',f;
  end if;
 end loop;
 if to_regclass('public.entity_records_managed_event_page') is not null and
  obj_description(to_regclass('public.entity_records_managed_event_page'),'pg_class') is distinct from tag||':'||md5(pg_get_indexdef(to_regclass('public.entity_records_managed_event_page'))) then
  raise exception 'Existing managed-event index requires review';
 end if;
end $guard$;

-- JSON filters behind RLS cannot be pushed ahead of non-leakproof policy
-- predicates. This index is used only after the RPC verifies the same actor
-- once; no operator is relabelled leakproof and no RLS policy is changed.
create index if not exists entity_records_managed_event_page on public.entity_records
 (colony_id,(payload->>'event_type'),entity_id collate "C")
 where entity_type='husbandry_events';
do $$begin execute format('comment on index public.entity_records_managed_event_page is %L','Braintime managed record page v1:'||md5(pg_get_indexdef('public.entity_records_managed_event_page'::regclass)));end $$;

create or replace function colony_private.managed_record_current(
 kind text,id text,p jsonb,is_archived boolean,mouse_ids text[],cage_ids text[],location_ids text[],room_ids text[],rack_ids text[]
) returns boolean language sql immutable set search_path='' as $$
 select case
  -- Layout collections are small and complete, including inactive references.
  when kind in ('rooms','racks','locations') then true
  when is_archived or coalesce(p->>'app_archived_at','')<>'' or p->>'archived'='true' then false
  when kind='mice' then p->>'state' in ('Stock','Unknown')
  when kind='cages' then id=any(cage_ids)
  when kind='matings' then lower(coalesce(p->>'state',''))='active'
  when kind='litters' then false
  -- Keep complete intervals relevant to current housing. A past phase is
  -- scientific evidence, so this predicate deliberately has no date cutoff.
  when kind='light_events' then
   p->>'mouse_sid'=any(mouse_ids) or p->>'cage_sid'=any(cage_ids) or p->>'location_id'=any(location_ids)
   or p->>'rack_id'=any(rack_ids) or p->>'room_id'=any(room_ids)
   or not exists(select 1 from unnest(array['mouse_sid','cage_sid','location_id','rack_id','room_id']) k where nullif(p->>k,'') is not null)
  when kind='husbandry_events' then
   case p->>'event_type'
    -- Snapshots use original room/label/workbook coordinates, which need not
    -- equal today's managed IDs. Keep intervening absences and ambiguity.
    when 'animal_sheet_cage_snapshot' then true
    when 'animal_sheet_source_change' then true
    when 'source_manager_observation' then true
    when 'cage_card_badge_status' then true
    when 'cage_equipment_status' then true
    when 'cage_summary_options' then true
    when 'locobox_protocol' then true
    when 'mouse_entrainment' then p->>'mouse_sid'=any(mouse_ids) or nullif(p->>'mouse_sid','') is null
    when 'experiment' then p#>>'{experiment,status}' in ('planned','in_progress')
    else p->>'event_type' in ('cage_location','cage_location_assignment','mouse_cage_move','mouse_location','cage_move','cage_assignment','mouse_move')
     and (p->>'mouse_sid'=any(mouse_ids) or p->>'cage_sid'=any(cage_ids) or p->>'location_id'=any(location_ids))
   end
  else false end
$$;
revoke all on function colony_private.managed_record_current(text,text,jsonb,boolean,text[],text[],text[],text[],text[]) from public,anon,authenticated,service_role;

create or replace function public.get_managed_record_page(
 p_colony_id uuid,p_entity_type text,p_scope text default 'current',p_event_types text[] default array[]::text[],
 p_after text default null,p_limit integer default 1000,p_metadata_only boolean default false
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 m public.memberships%rowtype;policy jsonb;rows jsonb;raw_allowed boolean;fee_allowed boolean;history_allowed boolean;
 mouse_ids text[]:=array[]::text[];mouse_cage_ids text[]:=array[]::text[];cage_ids text[]:=array[]::text[];location_ids text[]:=array[]::text[];linked_location_ids text[]:=array[]::text[];
 room_ids text[]:=array[]::text[];rack_ids text[]:=array[]::text[];
 event_types text[]:=array['animal_sheet_cage_snapshot','animal_sheet_source_change','source_manager_observation','cage_card_badge_status','cage_equipment_status','cage_summary_options','locobox_protocol','mouse_entrainment','experiment','cage_location','cage_location_assignment','mouse_cage_move','mouse_location','cage_move','cage_assignment','mouse_move'];
begin
 m:=colony_private.member_app_context(p_colony_id);
 -- current_role also retains the installed registration-completion boundary.
 if colony_private.current_role(p_colony_id) is null or m.role not in ('owner','manager','editor','viewer') or m.guest_level is not null
  or colony_private.member_mouse_restricted(m) then
  raise exception using errcode='42501',message='Use the existing member record projection';
 end if;
 if p_entity_type is null or p_entity_type<>all(array['mice','matings','litters','cages','rooms','racks','locations','light_events','husbandry_events'])
  or p_scope is null or p_scope<>all(array['current','full','event_types'])
  or p_event_types is null or coalesce(array_ndims(p_event_types),1)<>1 or cardinality(p_event_types)>64
  or exists(select 1 from unnest(p_event_types) v where v is null or v !~ '^[A-Za-z][A-Za-z0-9_ -]{0,79}$')
  or (p_scope='event_types' and (p_entity_type<>'husbandry_events' or cardinality(p_event_types)=0))
  or (p_scope<>'event_types' and cardinality(p_event_types)<>0)
  or (p_after is not null and (length(p_after) not between 1 and 200 or btrim(p_after)<>p_after))
  or p_limit is null or p_limit not between 1 and 1000 or p_metadata_only is null then
  raise exception using errcode='22023',message='Invalid managed record page';
 end if;
 policy:=public.get_lac_fee_visibility(p_colony_id);
 if jsonb_typeof(policy->'source_archive_allowed') is distinct from 'boolean'
  or jsonb_typeof(policy->'history_allowed') is distinct from 'boolean'
  or jsonb_typeof(policy->'estimate') is distinct from 'boolean' or jsonb_typeof(policy->'actual') is distinct from 'boolean' then
  raise exception using errcode='42501',message='Record visibility could not be verified';
 end if;
 raw_allowed:=(policy->>'source_archive_allowed')::boolean;
 history_allowed:=(policy->>'history_allowed')::boolean;
 fee_allowed:=history_allowed and (policy->>'estimate')::boolean and (policy->>'actual')::boolean;
 if p_scope='current' and p_entity_type in ('cages','light_events','husbandry_events') then
  select coalesce(array_agg(entity_id),array[]::text[]),coalesce(array_agg(distinct payload->>'cage_sid') filter(where nullif(payload->>'cage_sid','') is not null),array[]::text[]) into mouse_ids,mouse_cage_ids from public.entity_records
   where colony_id=p_colony_id and entity_type='mice' and not archived and coalesce(payload->>'app_archived_at','')=''
    and coalesce(payload->>'archived','false')<>'true' and payload->>'state' in ('Stock','Unknown');
  select coalesce(array_agg(c.entity_id),array[]::text[]) into cage_ids from public.entity_records c
   where c.colony_id=p_colony_id and c.entity_type='cages' and not c.archived and coalesce(c.payload->>'app_archived_at','')=''
    and coalesce(c.payload->>'archived','false')<>'true' and
    (lower(coalesce(c.payload->>'state','')) not in ('ended','inactive') or c.entity_id=any(mouse_cage_ids));
  if p_entity_type in ('light_events','husbandry_events') then
   select coalesce(array_agg(distinct v) filter(where nullif(v,'') is not null),array[]::text[]) into linked_location_ids
    from public.entity_records c cross join lateral unnest(array[c.payload->>'location_id',c.payload->>'cage_sheet_source_location_id',c.payload#>>'{cage_sheet_card,source_location_id}']) v
    where c.colony_id=p_colony_id and c.entity_type='cages' and c.entity_id=any(cage_ids);
   select coalesce(array_agg(entity_id),array[]::text[]),coalesce(array_agg(distinct payload->>'room_id') filter(where nullif(payload->>'room_id','') is not null),array[]::text[]),coalesce(array_agg(distinct payload->>'rack_id') filter(where nullif(payload->>'rack_id','') is not null),array[]::text[])
    into location_ids,room_ids,rack_ids from public.entity_records where colony_id=p_colony_id and entity_type='locations'
     and (entity_id=any(linked_location_ids) or not archived and coalesce(payload->>'app_archived_at','')='' and coalesce(payload->>'archived','false')<>'true' and coalesce(payload->>'source_current','true')<>'false');
   location_ids:=array(select distinct v from unnest(location_ids||linked_location_ids) v);
  end if;
 end if;
 -- The literal event entity_type permits the partial expression index. Only
 -- inexpensive data predicates remain inside this narrowed, authorized query.
 if p_entity_type='husbandry_events' and p_scope in ('current','event_types') then
  if p_scope='event_types' then event_types:=p_event_types;end if;
  select coalesce(jsonb_agg((jsonb_build_object('colony_id',r.colony_id,'entity_type',r.entity_type,'entity_id',r.entity_id,'version',r.version,'archived',r.archived)
   ||case when p_metadata_only then '{}'::jsonb else jsonb_build_object('payload',case when colony_private.fee_is_record(r.entity_type,r.payload) then colony_private.fee_payload(r.payload,(policy->>'estimate')::boolean,(policy->>'actual')::boolean,fee_allowed) else r.payload end) end) order by r.entity_id collate "C"),'[]'::jsonb)
  into rows from (select e.* from public.entity_records e where e.colony_id=p_colony_id and e.entity_type='husbandry_events'
   and e.payload->>'event_type'=any(event_types) and (p_after is null or e.entity_id collate "C">p_after collate "C")
   and (not colony_private.fee_is_record(e.entity_type,e.payload) or history_allowed or colony_private.fee_current_record(p_colony_id,e.payload))
   and (p_scope<>'current' or colony_private.managed_record_current(e.entity_type,e.entity_id,e.payload,e.archived,mouse_ids,cage_ids,location_ids,room_ids,rack_ids))
   order by e.entity_id collate "C" limit p_limit) r;
 else
  select coalesce(jsonb_agg((jsonb_build_object('colony_id',r.colony_id,'entity_type',r.entity_type,'entity_id',r.entity_id,'version',r.version,'archived',r.archived)
   ||case when p_metadata_only then '{}'::jsonb else jsonb_build_object('payload',case
    when not raw_allowed and r.entity_type='locations' then colony_private.managed_location_payload(r.payload)
    when colony_private.fee_is_record(r.entity_type,r.payload) then colony_private.fee_payload(r.payload,(policy->>'estimate')::boolean,(policy->>'actual')::boolean,fee_allowed)
    else r.payload end) end) order by r.entity_id collate "C"),'[]'::jsonb)
  into rows from (select e.* from public.entity_records e where e.colony_id=p_colony_id and e.entity_type=p_entity_type
   and (p_after is null or e.entity_id collate "C">p_after collate "C")
   and (not colony_private.fee_is_record(e.entity_type,e.payload) or history_allowed or colony_private.fee_current_record(p_colony_id,e.payload))
   and (p_scope<>'current' or colony_private.managed_record_current(e.entity_type,e.entity_id,e.payload,e.archived,mouse_ids,cage_ids,location_ids,room_ids,rack_ids))
   order by e.entity_id collate "C" limit p_limit) r;
 end if;
 return rows;
end $$;
revoke all on function public.get_managed_record_page(uuid,text,text,text[],text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_managed_record_page(uuid,text,text,text[],text,integer,boolean) to authenticated;
do $$declare f regprocedure;begin
 foreach f in array array['colony_private.managed_record_current(text,text,jsonb,boolean,text[],text[],text[],text[],text[])'::regprocedure,'public.get_managed_record_page(uuid,text,text,text[],text,integer,boolean)'::regprocedure] loop
  execute format('comment on function %s is %L',f,'Braintime managed record page v1:'||md5(pg_get_functiondef(f)));
 end loop;
end $$;
commit;
