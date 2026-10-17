-- Read-only cage hints for members whose location projection omits raw source
-- blocks. No source record, membership, visibility setting, or status is changed.
-- Only fixed allowlisted phrases leave this function, never source cells, tags,
-- dates, full notes, financial values, or raw blocks. Apply after cage-managers.sql.
begin;

create or replace function public.list_cage_note_hints(p_colony_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  -- Match list_cage_managers' active, verified account guard. current_role reads
  -- only active memberships. All active roles can read housing; has_permission
  -- is a write capability and would incorrectly exclude read-only viewers here.
  if auth.uid() is null or colony_private.current_role(p_colony_id) is null
    or not exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null
      and not coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)
      and not coalesce((to_jsonb(u)->>'banned_until')::timestamptz>clock_timestamp(),false)
      and to_jsonb(u)->>'deleted_at' is null) then
    raise exception using errcode='42501',message='Active colony membership is required';
  end if;

  with positions as (
    select r.entity_id as location_id,r.payload
    from public.entity_records r
    where r.colony_id=p_colony_id and r.entity_type='locations' and not r.archived
      and r.payload->>'location_id'=r.entity_id
      and nullif(r.payload->>'app_archived_at','') is null
      and r.payload->'archived' is distinct from 'true'::jsonb
      and r.payload->'source_current' is distinct from 'false'::jsonb
      and r.payload->'history_read_only' is distinct from 'true'::jsonb
      and r.payload->'source_historical' is distinct from 'true'::jsonb
      and r.payload->'_derived' is distinct from 'true'::jsonb
      and coalesce(r.payload->>'record_origin','') !~ '^historical_(snapshot|assignment)_projection$'
      and jsonb_typeof(r.payload->'source_block_text')='string'
  ), animals as (
    select p.location_id,a.animal
    from positions p
    cross join lateral jsonb_array_elements(case
      when jsonb_typeof(p.payload#>'{source_cage_observation,animals}')='array'
      then p.payload#>'{source_cage_observation,animals}' else '[]'::jsonb end) a(animal)
  ), animal_notes as (
    -- A row's own notes are already available in the ordinary sanitized animal
    -- projection. Exclude both its combined note and each constituent note line.
    select a.location_id,lower(btrim(regexp_replace(n.note,'[[:space:]]+',' ','g'))) as note
    from animals a
    cross join lateral regexp_split_to_table(case
      when jsonb_typeof(a.animal->'note')='string' then a.animal->>'note' else '' end,E'[\r\n]+') n(note)
    union
    select a.location_id,lower(btrim(regexp_replace(a.animal->>'note','[[:space:]]+',' ','g')))
    from animals a where jsonb_typeof(a.animal->'note')='string'
  ), cell_lines as (
    select p.location_id,m.parts
    from positions p
    cross join lateral regexp_split_to_table(p.payload->>'source_block_text',E'[\r\n]+') l(line)
    cross join lateral regexp_matches(l.line,'^([A-Z]{1,3}[1-9][0-9]{0,5})( comment)?:[ \t]?(.*)$','i') m(parts)
  ), cell_notes as (
    select c.location_id,lower(btrim(regexp_replace(c.parts[3],'[[:space:]]+',' ','g'))) as note
    from cell_lines c
    -- Only header/footer rows may supply cage hints. A tag, DOB, genotype,
    -- experiment column, or comment on an animal row is not a cage-wide note,
    -- even if its literal value resembles an allowlisted phrase.
    where not exists(select 1 from animals a where a.location_id=c.location_id
      and upper(a.animal->>'sourceCell') ~ '^[A-Z]{1,3}[1-9][0-9]{0,5}$'
      and substring(a.animal->>'sourceCell' from '[0-9]+$')=substring(c.parts[1] from '[0-9]+$'))
  ), canonical as (
    select c.location_id,case
      when c.note ~ '^(genotyping|geno)( (pending|required|needed))? *[!.]?$' then 'Genotyping'
      when c.note ~ '^(genotyping|geno) (is )?(done|complete|completed|finished) *[!.]?$' then 'Genotyping done'
      when c.note ~ '^(no (genotyping|geno) (needed|required)|no need for (genotyping|geno)|(genotyping|geno) (is )?not (needed|required)) *[!.]?$' then 'no genotyping needed'
      when c.note ~ '^experiments?( (planned|pending|required|needed))? *[!.]?$' then 'Experiment'
      when c.note ~ '^experiments? (is |are )?(done|complete|completed|finished|cancelled|canceled) *[!.]?$' then 'Experiment done'
      when c.note ~ '^(no experiments?( (planned|needed|required))?|experiments? (is |are )?not (planned|needed|required)) *[!.]?$' then 'no experiment planned'
      when c.note ~ '^pir *[!！]+$' then 'PIR!'
      when c.note ~ '^pir (is )?not good but usable *[!.]?$' then 'PIR not good but usable'
      when c.note ~ '^pir (is )?(not good|not working|not functional|broken|bad|faulty|failed|malfunctioning|does not work|doesn''t work|no signal) *[!.]?$' then 'PIR not good'
      when c.note ~ '^pir (is |was )?(fixed|repaired|resolved|replaced) *[!.]?$' then 'PIR fixed'
      when c.note ~ '^pir (is )?(normal|ok|okay|working|working normally|working well|working fine|not broken) *[!.]?$' then 'PIR normal'
      when c.note ~ '^(no pir (problem|problems|fault|faults)|pir (has )?no (problem|problems|fault|faults)) *[!.]?$' then 'no PIR problem'
      when c.note ~ '^led *[!！]+$' then 'LED!'
      when c.note ~ '^led (is )?not good but usable *[!.]?$' then 'LED not good but usable'
      when c.note ~ '^led (is )?(not good|not working|not functional|broken|bad|faulty|failed|malfunctioning|does not work|doesn''t work|no signal|not bright|not lighting) *[!.]?$' then 'LED not good'
      when c.note ~ '^led (is |was )?(fixed|repaired|resolved|replaced) *[!.]?$' then 'LED fixed'
      when c.note ~ '^led (is )?(normal|ok|okay|working|working normally|working well|working fine|not broken) *[!.]?$' then 'LED normal'
      when c.note ~ '^(no led (problem|problems|fault|faults)|led (has )?no (problem|problems|fault|faults)) *[!.]?$' then 'no LED problem'
      else null end as note
    from cell_notes c
    where c.note<>''
      and c.note !~ E'\\m(if|iff|unless|would|could|might|may|whether)\\M'
      and not exists(select 1 from animal_notes a where a.location_id=c.location_id and a.note=c.note)
  ), grouped as (
    select location_id,jsonb_agg(distinct note order by note) as notes
    from canonical where note is not null group by location_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('location_id',location_id,'notes',notes)
    order by location_id),'[]'::jsonb) into result from grouped;
  return result;
end $$;

comment on function public.list_cage_note_hints(uuid) is
  'Read-only allowlisted current cage task/fault phrases for active verified colony members; never returns raw source cells or financial text.';
revoke all on function public.list_cage_note_hints(uuid) from public,anon,authenticated;
grant execute on function public.list_cage_note_hints(uuid) to authenticated;
commit;
