-- Allow every Guest level to search the purchase catalogue and submit their
-- own requests. Existing section and per-user restrictions remain authoritative.
begin;
do $install$
declare
 f regprocedure:=to_regprocedure('colony_private.guest_defaults(text)');
 base regprocedure:=to_regprocedure('colony_private.guest_order_base_defaults(text)');
 tag text:='Braintime Guest order defaults v1';
 before_defaults jsonb;after_defaults jsonb;pending jsonb;entry jsonb;m public.memberships%rowtype;
 changed integer:=0;definition text;header text:='CREATE OR REPLACE FUNCTION colony_private.guest_defaults(';original_oid oid;
begin
 if f is null or to_regprocedure('colony_private.guest_allowed(public.memberships,text)') is null
  or to_regprocedure('reagents_private.permission(uuid)') is null
  or to_regprocedure('braintime_replica_private.invalidate_member(uuid,uuid)') is null
  or to_regclass('braintime_replica_private.member_enrollments') is null then
  raise exception 'Apply current Guest, Reagents and replica policies first';
 end if;
 if base is null and (md5(pg_get_functiondef(f))<>'9973932139db885ea5b8e3205a267faa' or obj_description(f,'pg_proc') is not null) then
  raise exception 'Installed Guest defaults changed; review the baseline first';
 end if;
 if base is not null then
  if obj_description(base,'pg_proc') is distinct from tag||':'||md5(pg_get_functiondef(base))
   or obj_description(f,'pg_proc') is distinct from tag||':'||md5(pg_get_functiondef(f)) then
   raise exception 'Existing Guest order defaults require review';
  end if;
  return;
 end if;
 select jsonb_object_agg(level,colony_private.guest_defaults(level)) into before_defaults
  from unnest(array['guest1','guest2','guest3','unknown']) level;
 if exists(select 1 from unnest(array['guest1','guest2','guest3']) level
  where jsonb_typeof(before_defaults->level) is distinct from 'object'
   or jsonb_typeof(before_defaults#>array[level,'reagents.orders.read']) is distinct from 'boolean'
   or jsonb_typeof(before_defaults#>array[level,'reagents.orders.write']) is distinct from 'boolean') then
  raise exception 'Guest order defaults could not be verified';
 end if;
 -- Capture only existing, enabled independent enrollments. This does not create
 -- accounts or enrollments and does not edit membership/roster override maps.
 select coalesce(jsonb_agg(jsonb_build_object('colony_id',x.colony_id,'user_id',x.user_id,
  'read',colony_private.guest_allowed(x,'reagents.orders.read'),
  'write',colony_private.guest_allowed(x,'reagents.orders.write'))),'[]'::jsonb) into pending
 from public.memberships x where x.active and x.guest_level='guest1' and exists(
  select 1 from braintime_replica_private.member_enrollments e
  join braintime_replica_private.replicas n using(replica_id)
  where n.colony_id=x.colony_id and n.enabled and e.user_id=x.user_id and e.enabled);
 original_oid:=f::oid;definition:=pg_get_functiondef(f);
 if left(definition,length(header)) is distinct from header then raise exception 'Guest default signature requires review';end if;
 -- Copy the inspected body; replace the existing function in place so stored
 -- dependencies retain its OID, owner, ACL and configuration.
 execute 'CREATE FUNCTION colony_private.guest_order_base_defaults('||substr(definition,length(header)+1);
 execute $definition$
 create or replace function colony_private.guest_defaults(p_level text) returns jsonb
 language sql immutable set search_path='' as $body$
  select colony_private.guest_order_base_defaults(p_level)
   ||case when p_level='guest1' then '{"reagents.orders.read":true,"reagents.orders.write":true}'::jsonb else '{}'::jsonb end
 $body$;
 $definition$;
 base:=to_regprocedure('colony_private.guest_order_base_defaults(text)');
 f:=to_regprocedure('colony_private.guest_defaults(text)');
 if f::oid<>original_oid then raise exception 'Guest default identity changed';end if;
 execute format('comment on function %s is %L',base,tag||':'||md5(pg_get_functiondef(base)));
 execute format('comment on function %s is %L',f,tag||':'||md5(pg_get_functiondef(f)));
 revoke all on function colony_private.guest_order_base_defaults(text)
  from public,anon,authenticated,service_role;
 select jsonb_object_agg(level,colony_private.guest_defaults(level)) into after_defaults
  from unnest(array['guest1','guest2','guest3','unknown']) level;
 if after_defaults is distinct from jsonb_set(before_defaults,'{guest1}',before_defaults->'guest1'
  ||'{"reagents.orders.read":true,"reagents.orders.write":true}'::jsonb) then
  raise exception 'Unexpected Guest default changes';
 end if;
 for entry in select value from jsonb_array_elements(pending) loop
  select * into m from public.memberships where colony_id=(entry->>'colony_id')::uuid
   and user_id=(entry->>'user_id')::uuid;
  if (colony_private.guest_allowed(m,'reagents.orders.read'),colony_private.guest_allowed(m,'reagents.orders.write'))
   is distinct from ((entry->>'read')::boolean,(entry->>'write')::boolean) then
   perform braintime_replica_private.invalidate_member(m.colony_id,m.user_id);changed:=changed+1;
  end if;
 end loop;
 raise notice 'Guest order defaults updated; % existing replica policies queued for renewal',changed;
end $install$;
commit;
select 'VERIFIED' as guest_order_defaults;
