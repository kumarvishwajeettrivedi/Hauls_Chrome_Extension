-- HAULS extension S5: per-account settings that follow your Google email on every device. Idempotent. Run after 0006.
-- Writes happen ONLY through ext_merge_settings (per-key last-write-wins), so two devices changing different settings never clobber each other.

create table if not exists public.ext_user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,   -- { pin, range, stores }
  stamps     jsonb not null default '{}'::jsonb,   -- { pin: <ms epoch>, ... } time each key was last edited
  updated_at timestamptz not null default now(),
  -- only known keys, sane shapes, tiny size
  constraint ext_user_settings_keys  check ((doc - array['pin','range','stores']) = '{}'::jsonb and (stamps - array['pin','range','stores']) = '{}'::jsonb),
  constraint ext_user_settings_size  check (pg_column_size(doc) <= 2048 and pg_column_size(stamps) <= 512),
  constraint ext_user_settings_pin   check (not (doc ? 'pin')   or (jsonb_typeof(doc->'pin') = 'string' and doc->>'pin' ~ '^(\d{6})?$')),
  constraint ext_user_settings_range check (not (doc ? 'range') or (jsonb_typeof(doc->'range') = 'string' and doc->>'range' in ('30D','90D','1Y','All'))),
  constraint ext_user_settings_stores check (not (doc ? 'stores') or (jsonb_typeof(doc->'stores') = 'array' and jsonb_array_length(doc->'stores') <= 12))
);
comment on table public.ext_user_settings is 'HAULS ext: synced user settings (one JSONdoc + per-key edit timestamps). Write via ext_merge_settings only.';

alter table public.ext_user_settings enable row level security;
revoke all on public.ext_user_settings from public, anon, authenticated;
grant select on public.ext_user_settings to authenticated;              -- read own row only (policy below); no direct writes
drop policy if exists ext_user_settings_select on public.ext_user_settings;
create policy ext_user_settings_select on public.ext_user_settings for select to authenticated using (user_id = auth.uid());

-- One call both pushes the caller's changed keys and returns the merged result. Per key: newer stamp wins; equal stamp keeps the server's value.
-- Stamps are clamped to now()+60 s so a device with a wrong clock cannot win forever.
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
    continue when k <> all (array['pin','range','stores']) or jsonb_typeof(p_stamps->k) <> 'number' or not (p_doc ? k);
    incoming := least((p_stamps->>k)::numeric, now_ms + 60000);
    if not (s ? k) or incoming > (s->>k)::numeric then
      d := jsonb_set(d, array[k], p_doc->k); s := jsonb_set(s, array[k], to_jsonb(incoming));
    end if;
  end loop;
  update public.ext_user_settings set doc = d, stamps = s, updated_at = now() where user_id = uid;  -- CHECK constraints reject invalid values
  return jsonb_build_object('doc', d, 'stamps', s);
end $$;
comment on function public.ext_merge_settings(jsonb, jsonb) is 'HAULS ext: per-key last-write-wins merge of the caller''s settings; returns the merged doc + stamps.';
revoke all on function public.ext_merge_settings(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ext_merge_settings(jsonb, jsonb) to authenticated;

-- Erase / export now include settings.
create or replace function public.ext_delete_my_data() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); em text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select email into em from auth.users where id = uid;
  delete from public.ext_price_observations where user_id = uid;
  delete from public.ext_watchlist where user_id = uid;
  delete from public.ext_user_settings where user_id = uid;
  delete from public.ext_profiles where id = uid;
  if em is not null then delete from public.waitlist where lower(email) = lower(em) and source like 'extension%'; end if;
end $$;
create or replace function public.ext_export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.ext_profiles p where p.id = uid),
    'settings', (select jsonb_build_object('doc', u.doc, 'stamps', u.stamps) from public.ext_user_settings u where u.user_id = uid),
    'watchlist', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from public.ext_watchlist w where w.user_id = uid), '[]'::jsonb),
    'observation_count', (select count(*) from public.ext_price_observations o where o.user_id = uid),
    'observations', coalesce((select jsonb_agg(jsonb_build_object('product_key', x.product_key, 'site', x.site, 'price', x.price, 'day', x.observed_day) order by x.observed_day desc)
                              from (select * from public.ext_price_observations where user_id = uid order by observed_day desc limit 5000) x), '[]'::jsonb));
end $$;
revoke all on function public.ext_delete_my_data(), public.ext_export_my_data() from public, anon, authenticated;
grant execute on function public.ext_delete_my_data(), public.ext_export_my_data() to authenticated;
