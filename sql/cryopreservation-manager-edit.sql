-- Restrict managed cryopreservation edits without replacing existing save,
-- section-permission, fee-visibility, validation, or audit functions.
begin;

create or replace function colony_private.is_cryopreservation_record(kind text,p jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(kind='husbandry_events' and (
    coalesce(p->>'event_type','') like 'cryopreservation%'
    or p ?| array['cryopreservation','cryopreservation_event']
  ),false)
$$;
revoke all on function colony_private.is_cryopreservation_record(text,jsonb) from public,anon,authenticated;

create or replace function colony_private.guard_cryopreservation_manager_edit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Trusted database imports and scheduled services retain their existing path.
  -- Anonymous clients still cannot write through existing RLS and save RPCs.
  if auth.uid() is null then return new;end if;

  if colony_private.is_cryopreservation_record(new.entity_type,new.payload)
    and coalesce(colony_private.current_role(new.colony_id),'') not in ('owner','manager') then
    raise exception using errcode='42501',message='Manager or owner access is required to edit cryopreservation';
  end if;
  -- Protect the existing record too, so renaming/removing its typed fields or
  -- changing its entity type/colony cannot bypass this restriction.
  if TG_OP='UPDATE' then
    if colony_private.is_cryopreservation_record(old.entity_type,old.payload)
      and coalesce(colony_private.current_role(old.colony_id),'') not in ('owner','manager') then
      raise exception using errcode='42501',message='Manager or owner access is required to edit cryopreservation';
    end if;
  end if;
  return new;
end $$;
revoke all on function colony_private.guard_cryopreservation_manager_edit() from public,anon,authenticated;

drop trigger if exists guard_cryopreservation_manager_edit on public.entity_records;
create trigger guard_cryopreservation_manager_edit before insert or update on public.entity_records
  for each row execute function colony_private.guard_cryopreservation_manager_edit();

commit;
