-- Narrow in-place correction: preserve the existing recording ACLs and guards.
begin;
do $patch$
declare
  body text;
  old_block text := $old$  if exists(select 1 from colony_private.app_access_log l where l.colony_id=p_colony_id and l.user_id=actor
    and l.app=p_app and l.session_id=p_session_id and l.event=p_event
    and (p_event<>'page_view' or (l.page=p_page and l.occurred_at>received_at-interval '30 seconds'))) then$old$;
  new_block text := $new$  if (p_event='page_view' and exists(
    select 1 from (
      select l.event,l.page,l.occurred_at from colony_private.app_access_log l
      where l.colony_id=p_colony_id and l.user_id=actor and l.app=p_app and l.session_id=p_session_id
      order by l.access_id desc limit 1
    ) latest where latest.event in ('session_start','page_view') and latest.page=p_page
      and latest.occurred_at>received_at-interval '30 seconds'
  )) or (p_event<>'page_view' and exists(
    select 1 from colony_private.app_access_log l where l.colony_id=p_colony_id and l.user_id=actor
      and l.app=p_app and l.session_id=p_session_id and l.event=p_event
  )) then$new$;
begin
  select pg_get_functiondef('public.record_app_access(uuid,text,text,text,uuid,uuid)'::regprocedure) into body;
  if position(old_block in body)=0 then
    if position(new_block in body)=0 then raise exception 'Recording implementation changed; no update applied';end if;
  else
    if length(body)-length(replace(body,old_block,''))<>length(old_block) then raise exception 'Ambiguous recording implementation';end if;
    execute replace(body,old_block,new_block);
  end if;
end $patch$;

-- Tests run in subtransactions. Their temporary events never remain in logs.
do $verify$
declare
  member record; sid uuid; first_id uuid; reply jsonb; checked integer:=0;
  old_sub text:=current_setting('request.jwt.claim.sub',true);
  old_claims text:=current_setting('request.jwt.claims',true);
  saw_owner boolean:=false;saw_member boolean:=false;
begin
  for member in
    select distinct on(m.role) m.user_id,m.colony_id,m.role
      from public.memberships m join auth.users u on u.id=m.user_id
      where m.active and u.email_confirmed_at is not null
      order by m.role,m.user_id
  loop
    begin
      perform set_config('request.jwt.claim.sub',member.user_id::text,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',member.user_id,'role','authenticated')::text,true);
      sid:=gen_random_uuid();first_id:=gen_random_uuid();
      reply:=public.record_app_access(member.colony_id,'mouse','session_start','mice',sid,first_id);
      if (reply->>'recorded') is distinct from 'true' then raise exception 'Session test failed';end if;
      reply:=public.record_app_access(member.colony_id,'mouse','page_view','cages',sid,gen_random_uuid());
      if (reply->>'recorded') is distinct from 'true' then raise exception 'Section test failed';end if;
      reply:=public.record_app_access(member.colony_id,'mouse','page_view','mice',sid,gen_random_uuid());
      if (reply->>'recorded') is distinct from 'true' then raise exception 'Rapid return test failed';end if;
      reply:=public.record_app_access(member.colony_id,'mouse','page_view','mice',sid,gen_random_uuid());
      if (reply->>'reason') is distinct from 'debounced' then raise exception 'Consecutive deduplication failed';end if;
      reply:=public.record_app_access(member.colony_id,'mouse','session_start','mice',sid,first_id);
      if (reply->>'reason') is distinct from 'duplicate' then raise exception 'Retry idempotency failed';end if;
      if member.role<>'owner' then
        begin
          perform public.list_app_access(member.colony_id);
          raise exception 'Non-owner read was not denied';
        exception when insufficient_privilege then null;
        end;
      end if;
      raise exception using errcode='Z0001',message='Discard test events';
    exception when sqlstate 'Z0001' then null;
    end;
    checked:=checked+1;if member.role='owner' then saw_owner:=true;else saw_member:=true;end if;
  end loop;
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(old_claims,'{}'),true);
  if checked<2 or not saw_owner or not saw_member then raise exception 'Owner and non-owner verification required';end if;
end $verify$;
commit;
select 'VERIFIED' as access_recording_precision;
