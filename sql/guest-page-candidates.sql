-- A read-plan correction only. Existing visibility and payload checks remain.
begin;
do $helper_guard$
declare target regprocedure:=to_regprocedure('colony_private.guest_mouse_candidate_types(public.memberships)');
begin
 if target is not null and obj_description(target,'pg_proc') is distinct from 'Braintime guest candidate types v1:'||md5(pg_get_functiondef(target)) then raise exception 'The Guest candidate helper already exists and requires review';end if;
end $helper_guard$;
create or replace function colony_private.guest_mouse_candidate_types(m public.memberships)
returns text[] language sql stable set search_path='' as $$
 select coalesce(array_agg(kind order by kind),array[]::text[]) from (values
  ('mice','mice'),('cages','cages'),('matings','breeding'),('litters','litters'),
  ('rooms','housing'),('racks','housing'),('locations','housing'),('light_events','housing'),('husbandry_events',null)
 ) candidates(kind,feature) where
 case when kind='husbandry_events' then exists(select 1 from unnest(array['housing','experiments','cryo','fees','iacuc','strains']) f where colony_private.guest_allowed(m,'mouse.'||f||'.read'))
 else colony_private.guest_allowed(m,'mouse.'||feature||'.read')
  or kind=any(array['mice','cages','rooms','racks','locations']) and colony_private.guest_allowed(m,'mouse.cages.read') end
$$;
revoke all on function colony_private.guest_mouse_candidate_types(public.memberships) from public,anon,authenticated,service_role;
do $helper_tag$begin execute format('comment on function colony_private.guest_mouse_candidate_types(public.memberships) is %L','Braintime guest candidate types v1:'||md5(pg_get_functiondef('colony_private.guest_mouse_candidate_types(public.memberships)'::regprocedure)));end $helper_tag$;

do $patch$
declare
 target regprocedure:=to_regprocedure('colony_private.get_guest_mouse_records_before_guest_availability(uuid,integer,integer)');
 definition text;original_source_hash text;original_acl aclitem[];original_owner oid;original_config text[];original_security boolean;original_volatility "char";
 declaration text:='declare m public.memberships%rowtype;rows jsonb;';
 predicate text:='where e.colony_id=p_colony_id and colony_private.guest_mouse_visible(m,e.entity_type,e.entity_id,e.payload,e.archived)';
 assignment text:='select coalesce(jsonb_agg(jsonb_build_object(';
 tag text:='Braintime guest page candidates v1';
begin
 if target is null then raise exception 'The maintained Guest record reader is missing';end if;
 select pg_get_functiondef(p.oid),p.proacl,p.proowner,p.proconfig,p.prosecdef,p.provolatile,md5(p.prosrc) into definition,original_acl,original_owner,original_config,original_security,original_volatility,original_source_hash from pg_proc p where p.oid=target;
 if position('e.entity_type=any(allowed_types)' in definition)>0 then
  if obj_description(target,'pg_proc') is distinct from tag||':'||md5(definition) then raise exception 'The Guest page correction changed and requires review';end if;
 else
  if original_source_hash<>'f69f7c0b9be05493ba6d16a3a702467e' or not original_security or original_volatility<>'s'
   or position('Active guest membership is required' in definition)=0 or position('Invalid guest page' in definition)=0
   or (length(definition)-length(replace(definition,declaration,'')))/length(declaration)<>1
   or (length(definition)-length(replace(definition,predicate,'')))/length(predicate)<>1
   or (length(definition)-length(replace(definition,assignment,'')))/length(assignment)<>1 then
    raise exception 'The Guest reader changed; no correction was applied';
  end if;
  definition:=replace(definition,declaration,declaration||'allowed_types text[];');
  definition:=replace(definition,assignment,'allowed_types:=colony_private.guest_mouse_candidate_types(m);'||chr(10)||' '||assignment);
  definition:=replace(definition,predicate,'where e.colony_id=p_colony_id and e.entity_type=any(allowed_types) and colony_private.guest_mouse_visible(m,e.entity_type,e.entity_id,e.payload,e.archived)');
  execute definition;
  execute format('comment on function %s is %L',target,tag||':'||md5(pg_get_functiondef(target)));
 end if;
 if exists(select 1 from pg_proc p where p.oid=target and (p.proacl is distinct from original_acl or p.proowner<>original_owner or p.proconfig is distinct from original_config or p.prosecdef<>original_security or p.provolatile<>original_volatility)) then raise exception 'The Guest reader authorization metadata changed';end if;
end $patch$;
commit;
