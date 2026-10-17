-- HAULS extension: saved delivery places (Home, Mom's house, Office) join the per-account settings. Idempotent. Run after 0007.
-- Same rules as before: writes only through ext_merge_settings (per-key last-write-wins); the table's CHECKs reject anything malformed.

-- A place is exactly {id, name, pin}: id 1-20 [A-Za-z0-9_-], name 1-24 chars, pin 6 digits. At most 8 per account.
create or replace function public.ext_valid_places(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 8 and not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object' or (e - array['id','name','pin']) <> '{}'::jsonb
       or jsonb_typeof(e->'id') <> 'string' or (e->>'id') !~ '^[A-Za-z0-9_-]{1,20}$'
       or jsonb_typeof(e->'name') <> 'string' or char_length(e->>'name') not between 1 and 24
       or jsonb_typeof(e->'pin') <> 'string' or (e->>'pin') !~ '^[0-9]{6}$')
$$;
revoke all on function public.ext_valid_places(jsonb) from public, anon, authenticated;

alter table public.ext_user_settings drop constraint if exists ext_user_settings_keys;
alter table public.ext_user_settings add constraint ext_user_settings_keys
  check ((doc - array['pin','range','stores','places']) = '{}'::jsonb and (stamps - array['pin','range','stores','places']) = '{}'::jsonb);
alter table public.ext_user_settings drop constraint if exists ext_user_settings_size;
alter table public.ext_user_settings add constraint ext_user_settings_size check (pg_column_size(doc) <= 4096 and pg_column_size(stamps) <= 512);
alter table public.ext_user_settings drop constraint if exists ext_user_settings_places;
alter table public.ext_user_settings add constraint ext_user_settings_places check (not (doc ? 'places') or public.ext_valid_places(doc->'places'));

-- Same merge as 0007, now also accepting `places`.
create or replace function public.ext_merge_settings(p_doc jsonb, p_stamps jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); cur public.ext_user_settings%rowtype; k text; d jsonb; s jsonb; incoming numeric;
        now_ms numeric := floor(extract(epoch from now()) * 1000);
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  p_doc := coalesce(p_doc, '{}'::jsonb); p_stamps := coalesce(p_stamps, '{}'::jsonb);
  if jsonb_typeof(p_doc) <> 'object' or jsonb_typeof(p_stamps) <> 'object' then raise exception 'invalid settings payload' using errcode = '22023'; end if;
  insert into public.ext_user_settings (user_id) values (uid) on conflict (user_id) do nothing;
  select * into cur from public.ext_user_settings where user_id = uid for update;
  d := cur.doc; s := cur.stamps;
  for k in select jsonb_object_keys(p_stamps) loop
    continue when k <> all (array['pin','range','stores','places']) or jsonb_typeof(p_stamps->k) <> 'number' or not (p_doc ? k);
    incoming := least((p_stamps->>k)::numeric, now_ms + 60000);
    if not (s ? k) or incoming > (s->>k)::numeric then
      d := jsonb_set(d, array[k], p_doc->k); s := jsonb_set(s, array[k], to_jsonb(incoming));
    end if;
  end loop;
  update public.ext_user_settings set doc = d, stamps = s, updated_at = now() where user_id = uid;
  return jsonb_build_object('doc', d, 'stamps', s);
end $$;
revoke all on function public.ext_merge_settings(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ext_merge_settings(jsonb, jsonb) to authenticated;
