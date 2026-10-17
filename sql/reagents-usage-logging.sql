-- Apply after purchasing.sql and lab-members.sql. No existing usage is rewritten.
begin;

create or replace function reagents_private.usage_actor_acronym(p_colony_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; actor_email text; result text; matches integer;
begin
 select m.role,lower(btrim(u.email)) into actor_role,actor_email
 from public.memberships m join auth.users u on u.id=m.user_id
 where m.colony_id=p_colony_id and m.user_id=actor and m.active
 and u.email_confirmed_at is not null
 and not coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)
 and not coalesce((to_jsonb(u)->>'banned_until')::timestamptz>current_timestamp,false)
 and to_jsonb(u)->>'deleted_at' is null;
 if actor is null or actor_role is null then raise exception using errcode='42501',message='A verified active lab account is required to log usage';end if;
 select count(*)::integer,min(p.acronym) into matches,result from public.lab_members p
 where p.colony_id=p_colony_id and p.status='current' and not p.archived
 and p.linked_user_id=actor;
 if matches=0 and actor_role='owner' then
  select count(*)::integer,min(p.acronym) into matches,result from public.lab_members p
  where p.colony_id=p_colony_id and p.status='current' and not p.archived
  and p.linked_user_id is null and p.email=actor_email;
 end if;
 return case when matches=1 then result else null end;
end $$;
revoke all on function reagents_private.usage_actor_acronym(uuid) from public,anon,authenticated;

create or replace function reagents_private.stamp_usage_logger()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_acronym text;
begin
 if tg_op='UPDATE' then
  if (old.kind='usage' or new.kind='usage') and
   (old.payload->'recorded_by_user_id' is distinct from new.payload->'recorded_by_user_id'
    or old.payload->'recorded_by_acronym' is distinct from new.payload->'recorded_by_acronym') then
   raise exception using errcode='22023',message='The account that logged usage is immutable';
  end if;
  return new;
 end if;
 if new.kind<>'usage' then return new;end if;
 if new.source_id is not null then
  if new.payload ?| array['recorded_by_user_id','recorded_by_acronym'] then
   raise exception using errcode='22023',message='Imported usage retains its source operator, without an account logger';
  end if;
  return new;
 end if;
 if actor is null or new.created_by is distinct from actor then
  raise exception using errcode='42501',message='The signed-in account must log its own usage entry';
 end if;
 actor_acronym:=reagents_private.usage_actor_acronym(new.colony_id);
 new.payload:=new.payload||jsonb_build_object('recorded_by_user_id',actor,'recorded_by_acronym',actor_acronym);
 return new;
end $$;
revoke all on function reagents_private.stamp_usage_logger() from public,anon,authenticated;
drop trigger if exists reagent_usage_logger on public.reagent_records;
create trigger reagent_usage_logger before insert or update on public.reagent_records
for each row execute function reagents_private.stamp_usage_logger();

create or replace function reagents_private.usage_item_is_equipment(r public.reagent_records)
returns boolean language sql immutable set search_path='' as $$
 select exists(select 1 from unnest(array[r.kind,r.payload->>'inventory_type',r.payload->>'inventory_classification',
  r.payload->>'source_sheet',r.payload#>>'{source_ref,sheet,title}',r.payload#>>'{source_ref,sheet}',
  r.payload->>'sheet',r.payload#>>'{source_fields,sheet}',r.payload->>'category']) value
 where lower(btrim(value)) in ('equipment','equipments'))
$$;
revoke all on function reagents_private.usage_item_is_equipment(public.reagent_records) from public,anon,authenticated;

create or replace function public.reagents_record_usage(p_colony_id uuid,p_id text,p_expected_version integer,p_event jsonb,p_apply_balance boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb; item public.reagent_records%rowtype; usage public.reagent_records%rowtype;
 event_payload jsonb; d date; amount numeric; balance numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended('reagents:'||p_colony_id::text,0));
 p:=reagents_private.permission(p_colony_id);
 if p->>'can_write'<>'true' then raise exception using errcode='42501',message='Reagent write permission is required'; end if;
 if jsonb_typeof(p_event) is distinct from 'object' or p_apply_balance is null or p_expected_version is null or p_expected_version<1
 or jsonb_typeof(p_event->'amount') is distinct from 'number' or jsonb_typeof(p_event->'unit') is distinct from 'string'
 or length(btrim(p_event->>'unit')) not between 1 and 40 then raise exception using errcode='22023',message='Usage requires version, amount and unit'; end if;
 amount:=(p_event->>'amount')::numeric; d:=colony_private.export_date(p_event->'event_date');
 if amount<=0 or d is null or d>(current_timestamp at time zone 'Asia/Taipei')::date then raise exception using errcode='22023',message='Usage requires a positive amount and a valid date no later than today'; end if;
 if exists(select 1 from jsonb_each(p_event) where key like 'source%' or key in ('record_origin','provenance','original_fields','owner_only','snapshot_date')) then
  raise exception using errcode='22023',message='Usage cannot assign source provenance'; end if;
 select * into item from public.reagent_records where colony_id=p_colony_id and id=p_id for update;
 if not found or item.kind not in ('item','equipment') or item.archived or not reagents_private.record_allowed(item,p) then raise exception using errcode='42501',message='An accessible active item is required'; end if;
 if item.version<>p_expected_version then raise exception using errcode='40001',message='Version conflict; reload before recording usage'; end if;
 if exists(select 1 from public.reagent_records where colony_id=p_colony_id and id=p_event->>'id') then raise exception using errcode='23505',message='Usage event ID already exists'; end if;
 event_payload:=(p_event-'id')||jsonb_build_object('item_id',p_id,'balance_applied',p_apply_balance);
 perform reagents_private.validate_record(p_event->>'id','usage',event_payload);
 perform reagents_private.assert_safety('usage',event_payload,null,p);
 if p_apply_balance then
  if reagents_private.usage_item_is_equipment(item) then
   raise exception using errcode='22023',message='Equipment usage is logged without subtracting stock';end if;
  if jsonb_typeof(item.payload->'remaining_amount') is distinct from 'number' or item.payload->>'unit' is distinct from p_event->>'unit' then
   raise exception using errcode='22023',message='Balance changes require a known numeric balance and exactly matching units'; end if;
  balance:=(item.payload->>'remaining_amount')::numeric;
  if balance<amount then raise exception using errcode='22023',message='Usage cannot make the remaining balance negative'; end if;
  update public.reagent_records set payload=jsonb_set(payload,'{remaining_amount}',to_jsonb(balance-amount)),version=version+1,
   updated_at=clock_timestamp(),updated_by=auth.uid() where colony_id=p_colony_id and id=p_id returning * into item;
 end if;
 insert into public.reagent_records(colony_id,id,kind,payload,record_date,owner_only,created_by,updated_by)
  values(p_colony_id,p_event->>'id','usage',event_payload,d,item.owner_only,auth.uid(),auth.uid()) returning * into usage;
 return jsonb_build_object('item',reagents_private.visible_record(item,p),'usage',to_jsonb(usage));
end $$;
notify pgrst,'reload schema';
commit;
