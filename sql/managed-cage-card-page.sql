-- Cage-card page v5: preserve the v4 result while using the reviewed ordered
-- current-event candidate index before reading completed experiment payloads.
-- Current cage cards, with complete scientific history still available on demand.
-- This adds only the narrower cage_cards scope for light/husbandry pages. Existing
-- current, full and event_types scopes, actor checks and row payloads stay intact.
-- No source record is modified, deleted, truncated, inferred or reidentified.
-- Raw snapshot/change/movement history is deliberately deferred. Callers must not
-- infer resident-history start dates until the full required history is loaded.
begin;
do $guard$
declare f regprocedure:=to_regprocedure('public.get_managed_record_page(uuid,text,text,text[],text,integer,boolean)');d text;tag text:='Braintime managed cage cards page v5';
begin
 if f is null then raise exception 'Apply the reviewed current-event page first';end if;
 d:=obj_description(f,'pg_proc');
 if (d is distinct from 'Braintime managed cage cards page v4:a83f6cf17db30e2e61b4e6c904175358'
    or md5(pg_get_functiondef(f))<>'a83f6cf17db30e2e61b4e6c904175358')
  and d is distinct from tag||':'||md5(pg_get_functiondef(f)) then raise exception 'Existing managed current page requires review';end if;
 if to_regclass('public.entity_records_current_event_page') is null
  or obj_description(to_regclass('public.entity_records_current_event_page'),'pg_class') is distinct from 'Braintime managed current page v2:'||md5(pg_get_indexdef(to_regclass('public.entity_records_current_event_page'))) then raise exception 'Reviewed current-event index is required';end if;
end $guard$;
create or replace function public.get_managed_record_page(
 p_colony_id uuid,p_entity_type text,p_scope text default 'current',p_event_types text[] default array[]::text[],
 p_after text default null,p_limit integer default 1000,p_metadata_only boolean default false
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 m public.memberships%rowtype;policy jsonb;rows jsonb;raw_allowed boolean;fee_allowed boolean;history_allowed boolean;
 mouse_ids text[]:=array[]::text[];mouse_cage_ids text[]:=array[]::text[];cage_ids text[]:=array[]::text[];location_ids text[]:=array[]::text[];linked_location_ids text[]:=array[]::text[];
 room_ids text[]:=array[]::text[];rack_ids text[]:=array[]::text[];review_source_ids text[]:=array[]::text[];sort_before text;
 event_types text[]:=array['animal_sheet_cage_snapshot','animal_sheet_source_change','source_manager_observation','cage_card_badge_status','cage_equipment_status','cage_summary_options','locobox_protocol','mouse_entrainment','experiment','cage_location','cage_location_assignment','mouse_cage_move','mouse_location','cage_move','cage_assignment','mouse_move'];
begin
 m:=colony_private.member_app_context(p_colony_id);
 -- current_role also retains the installed registration-completion boundary.
 if colony_private.current_role(p_colony_id) is null or m.role not in ('owner','manager','editor','viewer') or m.guest_level is not null
  or colony_private.member_mouse_restricted(m) then
  raise exception using errcode='42501',message='Use the existing member record projection';
 end if;
 if p_entity_type is null or p_entity_type<>all(array['mice','matings','litters','cages','rooms','racks','locations','light_events','husbandry_events'])
  or p_scope is null or p_scope<>all(array['current','full','event_types','cage_cards'])
  or p_event_types is null or coalesce(array_ndims(p_event_types),1)<>1 or cardinality(p_event_types)>64
  or exists(select 1 from unnest(p_event_types) v where v is null or v !~ '^[A-Za-z][A-Za-z0-9_ -]{0,79}$')
  or (p_scope='cage_cards' and p_entity_type<>all(array['light_events','husbandry_events']))
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
 if p_scope in ('current','cage_cards') and p_entity_type in ('cages','light_events','husbandry_events') then
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
 -- Keep conflict groups of reviewed source phases together. A review for a
 -- different slot may contradict the same source identity; never select a
 -- single latest review and silently hide that conflict.
 if p_scope='cage_cards' and p_entity_type='husbandry_events' then
  select coalesce(array_agg(distinct source_id) filter(where nullif(source_id,'') is not null),array[]::text[]) into review_source_ids
  from (
   select p.payload#>>'{locobox_protocol,reviewed_source_event_id}' source_id
   from public.entity_records p
   where p.colony_id=p_colony_id and p.entity_type='husbandry_events'
    and not p.archived and coalesce(p.payload->>'app_archived_at','')='' and coalesce(p.payload->>'archived','false')<>'true'
    and p.payload->>'event_type'='locobox_protocol'
    and (p.payload#>>'{locobox_protocol,cage_sid}'=any(cage_ids) or p.payload->>'cage_sid'=any(cage_ids)
      or p.payload#>>'{locobox_protocol,location_id}'=any(location_ids) or p.payload->>'location_id'=any(location_ids)
      or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(p.payload#>'{locobox_protocol,animal_sids}')='array' then p.payload#>'{locobox_protocol,animal_sids}' else '[]'::jsonb end) animal_sid where animal_sid=any(mouse_ids)))
   union all
   select p.payload#>>'{entrainment,source_event_id}' source_id
   from public.entity_records p
   where p.colony_id=p_colony_id and p.entity_type='husbandry_events'
    and not p.archived and coalesce(p.payload->>'app_archived_at','')='' and coalesce(p.payload->>'archived','false')<>'true'
    and p.payload->>'event_type'='mouse_entrainment' and p.payload->>'mouse_sid'=any(mouse_ids)
  ) referenced;
  -- The explicit predicate matches the reviewed partial index; the CASE below
  -- retains the exact v4 result. Scope the existing planner preference to this
  -- one read and restore it even when the query raises an error.
  sort_before:=pg_catalog.current_setting('enable_sort');
  begin
   perform pg_catalog.set_config('enable_sort','off',true);
  select coalesce(jsonb_agg((jsonb_build_object('colony_id',r.colony_id,'entity_type',r.entity_type,'entity_id',r.entity_id,'version',r.version,'archived',r.archived)
   ||case when p_metadata_only then '{}'::jsonb else jsonb_build_object('payload',case when colony_private.fee_is_record(r.entity_type,r.payload) then colony_private.fee_payload(r.payload,(policy->>'estimate')::boolean,(policy->>'actual')::boolean,fee_allowed) else r.payload end) end) order by r.entity_id collate "C"),'[]'::jsonb)
  into rows from (select e.* from public.entity_records e
   where e.colony_id=p_colony_id and e.entity_type='husbandry_events'
    and ((e.payload->>'event_type')<>'experiment' or e.payload#>>'{experiment,status}'=any(array['planned','in_progress']))
    and e.payload->>'event_type'=any(array['mouse_entrainment','locobox_protocol','cage_equipment_status','cage_card_badge_status','cage_summary_options','experiment'])
    and not e.archived and coalesce(e.payload->>'app_archived_at','')='' and coalesce(e.payload->>'archived','false')<>'true'
    and e.entity_id collate "C">coalesce(p_after,'') collate "C"
    and (not colony_private.fee_is_record(e.entity_type,e.payload) or history_allowed or colony_private.fee_current_record(p_colony_id,e.payload))
    and case e.payload->>'event_type'
     when 'mouse_entrainment' then e.payload->>'mouse_sid'=any(mouse_ids)
     when 'locobox_protocol' then e.payload#>>'{locobox_protocol,cage_sid}'=any(cage_ids) or e.payload->>'cage_sid'=any(cage_ids)
      or e.payload#>>'{locobox_protocol,location_id}'=any(location_ids) or e.payload->>'location_id'=any(location_ids)
      or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(e.payload#>'{locobox_protocol,animal_sids}')='array' then e.payload#>'{locobox_protocol,animal_sids}' else '[]'::jsonb end) animal_sid where animal_sid=any(mouse_ids))
      or e.entity_id=any(review_source_ids)
      or e.payload#>>'{locobox_protocol,reviewed_source_event_id}'=any(review_source_ids)
     when 'cage_equipment_status' then e.payload->>'location_id'=any(location_ids) or e.payload#>>'{equipment_status,location_id}'=any(location_ids)
     when 'cage_card_badge_status' then e.payload->>'location_id'=any(location_ids)
     when 'cage_summary_options' then true
     when 'experiment' then e.payload#>>'{experiment,status}'=any(array['planned','in_progress']) and exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(e.payload#>'{experiment,participants}')='array' then e.payload#>'{experiment,participants}' else '[]'::jsonb end) participant
      where participant->>'link_status'='confirmed' and participant->>'mouse_sid'=any(mouse_ids))
     else false end
   order by e.entity_id collate "C" limit p_limit) r;
  exception when others then
   perform pg_catalog.set_config('enable_sort',sort_before,true);
   raise;
  end;
  perform pg_catalog.set_config('enable_sort',sort_before,true);
 elsif p_entity_type='husbandry_events' and p_scope='current' then
  -- The opaque scientific predicate underestimates qualifying rows. Keep the
  -- ordered current-candidate index attractive without changing other reads.
  sort_before:=pg_catalog.current_setting('enable_sort');
  begin
   perform pg_catalog.set_config('enable_sort','off',true);
  select coalesce(jsonb_agg((jsonb_build_object('colony_id',r.colony_id,'entity_type',r.entity_type,'entity_id',r.entity_id,'version',r.version,'archived',r.archived)
   ||case when p_metadata_only then '{}'::jsonb else jsonb_build_object('payload',case when colony_private.fee_is_record(r.entity_type,r.payload) then colony_private.fee_payload(r.payload,(policy->>'estimate')::boolean,(policy->>'actual')::boolean,fee_allowed) else r.payload end) end) order by r.entity_id collate "C"),'[]'::jsonb)
  into rows from (select e.* from public.entity_records e where e.colony_id=p_colony_id and e.entity_type='husbandry_events'
   and ((e.payload->>'event_type')<>'experiment' or e.payload#>>'{experiment,status}'=any(array['planned','in_progress']))
   and e.payload->>'event_type'=any(event_types) and e.entity_id collate "C">coalesce(p_after,'') collate "C"
   and (not colony_private.fee_is_record(e.entity_type,e.payload) or history_allowed or colony_private.fee_current_record(p_colony_id,e.payload))
   and colony_private.managed_record_current(e.entity_type,e.entity_id,e.payload,e.archived,mouse_ids,cage_ids,location_ids,room_ids,rack_ids)
   order by e.entity_id collate "C" limit p_limit) r;
  exception when others then
   perform pg_catalog.set_config('enable_sort',sort_before,true);
   raise;
  end;
  perform pg_catalog.set_config('enable_sort',sort_before,true);
 elsif p_entity_type='husbandry_events' and p_scope='event_types' then
  event_types:=p_event_types;
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
   and (p_scope not in ('current','cage_cards') or colony_private.managed_record_current(e.entity_type,e.entity_id,e.payload,e.archived,mouse_ids,cage_ids,location_ids,room_ids,rack_ids))
   -- Complete intervals remain attached to explicit current cages. Unlinked
   -- historical sheet copies cannot describe today's slot and stay deferred.
   -- No date cutoff or latest-only choice removes phases or conflicts.
   and (p_scope<>'cage_cards' or e.payload->>'cage_sid'=any(cage_ids) or e.payload->>'mouse_sid'=any(mouse_ids) or
    (coalesce(e.payload->>'source_current','true')<>'false'
     and coalesce(e.payload->>'source_historical','false')<>'true'
     and coalesce(e.payload->>'history_read_only','false')<>'true'
     and coalesce(e.payload->>'record_origin','')<>'historical_google_sheet'))
   order by e.entity_id collate "C" limit p_limit) r;
 end if;
 return rows;
end $$;
revoke all on function public.get_managed_record_page(uuid,text,text,text[],text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_managed_record_page(uuid,text,text,text[],text,integer,boolean) to authenticated;
do $$begin execute format('comment on function public.get_managed_record_page(uuid,text,text,text[],text,integer,boolean) is %L','Braintime managed cage cards page v5:'||md5(pg_get_functiondef('public.get_managed_record_page(uuid,text,text,text[],text,integer,boolean)'::regprocedure)));end $$;
commit;
