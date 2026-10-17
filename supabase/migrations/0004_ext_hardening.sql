-- HAULS extension hardening. Run after 0003. Idempotent. Only ext_* objects; never touches public.waitlist / public.keepalive.
-- Do NOT re-run 0002 after this (it would recreate the old 2-arg history fn and the old upsert fn).

-- ---------- phone (optional, user-typed, unverified; Google does not provide it) ----------
alter table public.ext_profiles add column if not exists phone text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ext_profiles_phone_check' and conrelid = 'public.ext_profiles'::regclass) then
    alter table public.ext_profiles add constraint ext_profiles_phone_check check (phone ~ '^\+?[0-9 ()-]{7,20}$');
  end if;
end $$;
comment on column public.ext_profiles.phone is 'HAULS ext: optional, user-typed, unverified phone.';
grant update (name, contribute, phone) on public.ext_profiles to authenticated;

-- Guard: plan/id/email stay locked for end users; phone is user-editable (same guard, restated).
create or replace function public.ext_profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and coalesce(auth.role(),'') <> 'service_role'
     and (new.plan is distinct from old.plan or new.id is distinct from old.id
          or new.email is distinct from old.email) then
    raise exception 'plan, id and email cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------- new-user trigger: tolerate missing/empty metadata, never block sign-in ----------
create or replace function public.ext_handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.ext_profiles (id, email, name, avatar_url)
  values (new.id, nullif(new.email, ''),
          coalesce(nullif(trim(m->>'full_name'), ''), nullif(trim(m->>'name'), '')),
          coalesce(nullif(trim(m->>'avatar_url'), ''), nullif(trim(m->>'picture'), '')))
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'ext_handle_new_user failed: %', sqlerrm; -- never block auth sign-up
  return new;
end $$;

-- ---------- watchlist cap by plan: free 20, pro 200, max unlimited (live rows only) ----------
create or replace function public.ext_watchlist_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cap int; plan_ text; live int;
begin
  if new.deleted_at is not null then return new; end if;                       -- soft-deleted row: never counts
  if tg_op = 'UPDATE' and old.deleted_at is null then return new; end if;     -- plain edit of a live row: never blocked
  if tg_op = 'INSERT' and exists (select 1 from public.ext_watchlist w
       where w.user_id = new.user_id and w.product_key = new.product_key and w.deleted_at is null)
    then return new; end if;                                                   -- upsert onto a live row = an edit
  select plan into plan_ from public.ext_profiles where id = new.user_id;
  cap := case coalesce(plan_, 'free') when 'max' then null when 'pro' then 200 else 20 end;
  if cap is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  select count(*) into live from public.ext_watchlist w where w.user_id = new.user_id and w.deleted_at is null;
  if live >= cap then
    raise exception 'watchlist_limit_reached' using errcode = 'P0001',
      hint = format('plan %s allows %s live watchlist items', coalesce(plan_, 'free'), cap);
  end if;
  return new;
end $$;
comment on function public.ext_watchlist_limit() is 'HAULS ext: enforces watchlist cap per plan on insert and on restore of a soft-deleted row.';
revoke all on function public.ext_watchlist_limit() from public, anon, authenticated;

drop trigger if exists ext_watchlist_limit on public.ext_watchlist;
create trigger ext_watchlist_limit before insert or update on public.ext_watchlist
  for each row execute function public.ext_watchlist_limit();

-- ---------- observations: <= 500 rows/user/UTC-day; extra rows skipped silently ----------
create or replace function public.ext_upsert_observations(p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r jsonb; n int := 0; c int; i int := 0; room int;
begin
  if uid is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  if not coalesce((select contribute from public.ext_profiles where id = uid), false) then return 0; end if;
  select 500 - count(*) into room from public.ext_price_observations
    where user_id = uid and observed_day = (now() at time zone 'UTC')::date;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; exit when i > 50 or n >= room;
    begin
      insert into public.ext_price_observations (user_id, product_key, site, price, mrp, src)
      values (uid, r->>'product_key', r->>'site', (r->>'price')::numeric,
              nullif(r->>'mrp','')::numeric, r->>'src')
      on conflict do nothing;
      get diagnostics c = row_count; n := n + c;
    exception when others then null; -- bad row: skip
    end;
  end loop;
  return n;
end $$;
comment on function public.ext_upsert_observations(jsonb) is 'HAULS ext: validated bulk insert (max 50/call, 500/user/UTC-day), honours contribute flag, returns inserted count.';
revoke all on function public.ext_upsert_observations(jsonb) from public, anon, authenticated;
grant execute on function public.ext_upsert_observations(jsonb) to authenticated;

-- ---------- history: p_min_reporters (default 2) ----------
drop function if exists public.ext_price_history(text, int);
create or replace function public.ext_price_history(p_key text, p_days int default 365, p_min_reporters int default 2)
returns table (day date, median_price numeric, min_price numeric, max_price numeric, reporters int)
language sql stable security definer set search_path = '' as $$
  with med as (
    select percentile_cont(0.5) within group (order by price) as m
    from public.ext_price_observations where product_key = p_key
  )
  select o.observed_day,
         (percentile_cont(0.5) within group (order by o.price))::numeric,
         min(o.price), max(o.price),
         count(distinct o.user_id)::int
  from public.ext_price_observations o, med
  where auth.uid() is not null
    and o.product_key = p_key
    and o.observed_day >= (now() at time zone 'UTC')::date - greatest(p_days, 1)
    and o.price between med.m * 0.4 and med.m * 2.5
  group by o.observed_day
  having count(distinct o.user_id) >= greatest(coalesce(p_min_reporters, 2), 1)
  order by o.observed_day;
$$;
comment on function public.ext_price_history(text,int,int) is 'HAULS ext: anonymised per-day aggregates; days with fewer than p_min_reporters distinct users are hidden.';
revoke all on function public.ext_price_history(text,int,int) from public, anon, authenticated;
grant execute on function public.ext_price_history(text,int,int) to authenticated;

-- ---------- remote config (data-only kill switch): public read, service-role write ----------
create table if not exists public.ext_remote_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.ext_remote_config is 'HAULS ext: data-only flags (disabled stores/sites, min version). Service role writes.';
alter table public.ext_remote_config enable row level security;
revoke all on public.ext_remote_config from public, anon, authenticated;
grant select on public.ext_remote_config to anon, authenticated;
drop policy if exists ext_remote_config_select on public.ext_remote_config;
create policy ext_remote_config_select on public.ext_remote_config for select to anon, authenticated using (true);
drop trigger if exists ext_remote_config_touch on public.ext_remote_config;
create trigger ext_remote_config_touch before update on public.ext_remote_config
  for each row execute function public.ext_touch_updated_at();
insert into public.ext_remote_config (key, value)
values ('flags', '{"disabled_stores":[],"disabled_sites":[],"min_version":"0.1.0"}'::jsonb)
on conflict (key) do nothing;

-- ---------- export my data (caller only; others' observations never exposed) ----------
create or replace function public.ext_export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.ext_profiles p where p.id = uid),
    'watchlist', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from public.ext_watchlist w where w.user_id = uid), '[]'::jsonb),
    'observation_count', (select count(*) from public.ext_price_observations o where o.user_id = uid));
end $$;
comment on function public.ext_export_my_data() is 'HAULS ext: caller profile + watchlist + own observation count (GDPR-style export).';
revoke all on function public.ext_export_my_data() from public, anon, authenticated;
grant execute on function public.ext_export_my_data() to authenticated;
