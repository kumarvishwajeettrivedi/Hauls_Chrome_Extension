-- 0017: security hardening. Idempotent (safe to re-run). Run in the Supabase SQL editor after 0016. Only ext_* objects; never touches public.waitlist / public.keepalive (except the one INSERT in ext_join_waitlist).
--  1) every user-writable text column gets a database CHECK (length, no control / bidi characters, no markup in names and titles, https-only links, key/site charset, jsonb size caps). Old rows that break a rule are cleaned FIRST.
--  2) payload caps INSIDE the functions that take arrays / jsonb / text (anonymous or signed-in). Oversize or malformed input is refused (false / 0 / 'invalid' / empty), never an error.
--  3) per-role statement_timeout + idle_in_transaction_session_timeout (a permission failure only warns).
--  4) price-alert mail: the link is HTML-escaped like the title; a link with quotes, angle brackets, whitespace or control characters refuses the whole call.
--  5) retention: ext_purge_old_data() (service_role only) deletes alert-log rows > 90 days and feedback > 1 year.
--  6) grants: every public.ext_* function / table / sequence is reset and re-granted from the matrix at the bottom.
-- Character classes used below (repeated literally, because a CHECK cannot call a function the end user may not execute):
--   control/bidi  [\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]   = C0 controls, DEL, C1 controls, zero-width space, LRM/RLM, line/paragraph separators, bidi embeddings/overrides/isolates, BOM. (ZWJ/ZWNJ stay allowed: Indic scripts need them.)
--   key           ^[^\s control " ' ` < > \\]{1,200}$      url  ^https://[^\s control < > " ' \\]+$ (<= 500 chars)

-- ============ helpers (no grants: only other functions / triggers use them) ============
create or replace function public.ext_strip_text(t text) returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(t, '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>]', '', 'g')), '')
$$;
comment on function public.ext_strip_text(text) is 'HAULS ext: removes control / bidi characters and angle brackets, trims; empty becomes NULL.';
create or replace function public.ext_clean_url(t text) returns text language sql immutable set search_path = '' as $$
  select case when t is not null and char_length(t) <= 500 and t ~* '^https://[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''\\]+$' then t end
$$;
comment on function public.ext_clean_url(text) is 'HAULS ext: the value if it is an https link of <= 500 chars without whitespace / quotes / angle brackets, else NULL.';

-- ============ 1a) clean old rows that would break the new rules ============
update public.ext_profiles set name = left(public.ext_strip_text(name), 80)
  where name is not null and (char_length(name) > 80 or name ~ '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>]');
update public.ext_profiles set avatar_url = null where avatar_url is not null and public.ext_clean_url(avatar_url) is null;

update public.ext_watchlist set
  title = left(public.ext_strip_text(title), 500), site = left(public.ext_strip_text(site), 60),
  url = public.ext_clean_url(url), image = public.ext_clean_url(image),
  target_price = case when target_price >= 0 and target_price < 10000000 then target_price end,
  last_price = case when last_price >= 0 and last_price < 10000000 then last_price end,
  notified_price = case when notified_price >= 0 and notified_price < 10000000 then notified_price end
where (title is not null and (char_length(title) > 500 or title ~ '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>]'))
   or (site is not null and (char_length(site) > 60 or site ~ '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>]'))
   or (url is not null and public.ext_clean_url(url) is null) or (image is not null and public.ext_clean_url(image) is null)
   or (target_price is not null and not (target_price >= 0 and target_price < 10000000))
   or (last_price is not null and not (last_price >= 0 and last_price < 10000000))
   or (notified_price is not null and not (notified_price >= 0 and notified_price < 10000000));
-- A product key is an identity, so it cannot be "repaired": rows with an unusable key are removed (a real key is `domain:id`).
delete from public.ext_watchlist where product_key !~ '^[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]{1,200}$';
delete from public.ext_price_observations where product_key !~ '^[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]{1,200}$';
update public.ext_price_observations set site = null where site is not null and (char_length(site) > 60 or site ~ '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>]');
delete from public.ext_chart_series where product_key !~ '^[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]{1,200}$' or octet_length(series::text) > 4000;
delete from public.ext_alert_log where product_key !~ '^[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]{1,200}$';

update public.ext_feedback set message = left(nullif(btrim(regexp_replace(message, '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]', '', 'g')), ''), 1000)
  where message is not null and (char_length(message) > 1000 or message ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]');
update public.ext_feedback set reasons = coalesce((select array_agg(distinct r order by r) from unnest(reasons) r
    where r = any (array['missing_feature','prices_wrong','too_slow','confusing','permissions','found_better','privacy','bugs','not_needed','other'])), '{}')
  where not (reasons <@ array['missing_feature','prices_wrong','too_slow','confusing','permissions','found_better','privacy','bugs','not_needed','other']);
update public.ext_feedback set ip_hash = null where ip_hash is not null and ip_hash !~ '^[0-9a-f]{64}$';

-- ============ 1b) settings validators (used by CHECKs on a table users cannot write directly) ============
-- Saved places: as 0008, plus no control / bidi characters or angle brackets in the name.
create or replace function public.ext_valid_places(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 8 and not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object' or (e - array['id','name','pin']) <> '{}'::jsonb
       or jsonb_typeof(e->'id') <> 'string' or (e->>'id') !~ '^[A-Za-z0-9_-]{1,20}$'
       or jsonb_typeof(e->'name') <> 'string' or char_length(e->>'name') not between 1 and 24 or (e->>'name') ~ '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>]'
       or jsonb_typeof(e->'pin') <> 'string' or (e->>'pin') !~ '^[0-9]{6}$')
$$;
-- Stores filter: at most 12 short identifiers.
create or replace function public.ext_valid_stores(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 12 and not exists (
    select 1 from jsonb_array_elements(p) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[A-Za-z0-9._-]{1,40}$')
$$;
update public.ext_user_settings set doc = doc - 'places', stamps = stamps - 'places' where doc ? 'places' and not public.ext_valid_places(doc->'places');
update public.ext_user_settings set doc = doc - 'stores', stamps = stamps - 'stores' where doc ? 'stores' and not public.ext_valid_stores(doc->'stores');

-- ============ 1c) CHECK constraints ============
alter table public.ext_profiles drop constraint if exists ext_profiles_name_check;
alter table public.ext_profiles add constraint ext_profiles_name_check check (name is null or (char_length(name) <= 80 and name !~ '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>]'));
alter table public.ext_profiles drop constraint if exists ext_profiles_avatar_check;
alter table public.ext_profiles add constraint ext_profiles_avatar_check check (avatar_url is null or (char_length(avatar_url) <= 500 and avatar_url ~* '^https://[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''\\]+$'));
-- phone: ext_profiles_phone_check (0016) already pins it to +91 followed by a 10 digit mobile number.

alter table public.ext_watchlist drop constraint if exists ext_watchlist_text_limits;
alter table public.ext_watchlist add constraint ext_watchlist_text_limits check (
  product_key ~ '^[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]{1,200}$'
  and (site is null or (char_length(site) <= 60 and site !~ '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>]'))
  and (title is null or (char_length(title) <= 500 and title !~ '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>]'))
  and (url is null or (char_length(url) <= 500 and url ~* '^https://[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''\\]+$'))
  and (image is null or (char_length(image) <= 500 and image ~* '^https://[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''\\]+$')));
alter table public.ext_watchlist drop constraint if exists ext_watchlist_price_range;
alter table public.ext_watchlist add constraint ext_watchlist_price_range check (
  (target_price is null or (target_price >= 0 and target_price < 10000000)) and (last_price is null or (last_price >= 0 and last_price < 10000000))
  and (notified_price is null or (notified_price >= 0 and notified_price < 10000000)));

alter table public.ext_price_observations drop constraint if exists ext_obs_text_limits;
alter table public.ext_price_observations add constraint ext_obs_text_limits check (
  product_key ~ '^[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]{1,200}$' and (site is null or (char_length(site) <= 60 and site !~ '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>]')));
alter table public.ext_chart_series drop constraint if exists ext_chart_text_limits;
alter table public.ext_chart_series add constraint ext_chart_text_limits check (product_key ~ '^[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]{1,200}$' and octet_length(series::text) <= 4000);
alter table public.ext_alert_log drop constraint if exists ext_alert_log_key_fmt;
alter table public.ext_alert_log add constraint ext_alert_log_key_fmt check (product_key ~ '^[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]{1,200}$');

-- feedback: message <= 1000 chars (tabs / newlines allowed), reasons only from the known list, ip_hash only a sha256 hex digest.
alter table public.ext_feedback drop constraint if exists ext_feedback_text_limits;
alter table public.ext_feedback add constraint ext_feedback_text_limits check (
  (message is null or (char_length(message) <= 1000 and message !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]'))
  and reasons <@ array['missing_feature','prices_wrong','too_slow','confusing','permissions','found_better','privacy','bugs','not_needed','other']
  and (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'));

-- remote config is world-readable (anon): short key, small value. NEVER store a secret in it.
alter table public.ext_remote_config drop constraint if exists ext_remote_config_limits;
alter table public.ext_remote_config add constraint ext_remote_config_limits check (key ~ '^[a-z0-9_.-]{1,40}$' and octet_length(value::text) <= 8192);

-- settings: real text size (pg_column_size, kept from 0008, can be fooled by compression) + stores identifiers.
alter table public.ext_user_settings drop constraint if exists ext_user_settings_textsize;
alter table public.ext_user_settings add constraint ext_user_settings_textsize check (octet_length(doc::text) <= 4096 and octet_length(stamps::text) <= 1024);
alter table public.ext_user_settings drop constraint if exists ext_user_settings_stores;
alter table public.ext_user_settings add constraint ext_user_settings_stores check (not (doc ? 'stores') or public.ext_valid_stores(doc->'stores'));
-- (ext_user_settings_places from 0008 now calls the stricter ext_valid_places above.)

-- Watchlist: older extension versions send raw page titles ("A > B", control characters). Strip those instead of failing the whole sync;
-- an unusable image link (cosmetic) becomes NULL. Everything else (length, scheme, key) is refused by the CHECK above.
create or replace function public.ext_watchlist_clean() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.title := public.ext_strip_text(new.title); new.site := public.ext_strip_text(new.site);
  if new.image is not null and public.ext_clean_url(new.image) is null then new.image := null; end if;
  return new;
end $$;
drop trigger if exists ext_watchlist_0_clean on public.ext_watchlist;
create trigger ext_watchlist_0_clean before insert or update on public.ext_watchlist for each row execute function public.ext_watchlist_clean();

-- ============ new-user / ensure-profile: Google / email-signup metadata is user-controlled, so it is cleaned, never trusted ============
-- (0016 made an oversize or "<" name fail the insert; this trigger swallowed that and the person had no profile at all.)
create or replace function public.ext_handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.ext_profiles (id, email, name, avatar_url)
  values (new.id, nullif(new.email, ''),
          left(public.ext_strip_text(coalesce(nullif(trim(m->>'full_name'), ''), nullif(trim(m->>'name'), ''))), 80),
          public.ext_clean_url(coalesce(nullif(trim(m->>'avatar_url'), ''), nullif(trim(m->>'picture'), ''))))
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'ext_handle_new_user failed: %', sqlerrm; -- never block auth sign-up
  return new;
end $$;
create or replace function public.ext_ensure_profile() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.ext_profiles (id, email, name, avatar_url)
  select u.id, u.email,
         left(public.ext_strip_text(coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), ''))), 80),
         public.ext_clean_url(coalesce(nullif(trim(u.raw_user_meta_data->>'avatar_url'), ''), nullif(trim(u.raw_user_meta_data->>'picture'), '')))
  from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
end $$;

-- ============ 2) payload caps inside the functions ============
-- Observations: whole call <= 50 rows and <= 40000 bytes (else 0, nothing stored); every row must be an object <= 800 bytes. Rest as 0004 (500/user/day, contribute flag).
create or replace function public.ext_upsert_observations(p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r jsonb; n int := 0; c int; i int := 0; room int;
begin
  if uid is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  if jsonb_array_length(p_rows) > 50 or octet_length(p_rows::text) > 40000 then return 0; end if;
  if not coalesce((select contribute from public.ext_profiles where id = uid), false) then return 0; end if;
  select 500 - count(*) into room from public.ext_price_observations
    where user_id = uid and observed_day = (now() at time zone 'UTC')::date;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; exit when i > 50 or n >= room;
    continue when jsonb_typeof(r) <> 'object' or octet_length(r::text) > 800;
    begin
      insert into public.ext_price_observations (user_id, product_key, site, price, mrp, src)
      values (uid, r->>'product_key', r->>'site', (r->>'price')::numeric,
              nullif(r->>'mrp','')::numeric, r->>'src')
      on conflict do nothing;
      get diagnostics c = row_count; n := n + c;
    exception when others then null; -- bad row (check/cast violation): skip
    end;
  end loop;
  return n;
end $$;
comment on function public.ext_upsert_observations(jsonb) is 'HAULS ext: validated bulk insert (whole call <= 50 rows / 40 kB else 0, row <= 800 bytes, 500/user/UTC-day), honours contribute flag, returns inserted count.';

-- History: a key longer than 200 characters matches nothing (and is never used for an index probe).
create or replace function public.ext_price_history(p_key text, p_days int default 365, p_min_reporters int default 3)
returns table (day date, median_price numeric, min_price numeric, max_price numeric, reporters int)
language sql stable security definer set search_path = '' as $$
  with per_user as (
    select o.observed_day as d, o.user_id, (percentile_cont(0.5) within group (order by o.price))::numeric as p
    from public.ext_price_observations o
    where auth.uid() is not null and length(p_key) <= 200 and o.product_key = p_key
    group by o.observed_day, o.user_id
  ), med as (select percentile_cont(0.5) within group (order by p) as m from per_user), agg as (
    select u.d, (percentile_cont(0.5) within group (order by u.p))::numeric as med_p, min(u.p) as lo, max(u.p) as hi, count(*)::int as n
    from per_user u, med
    where u.d >= (now() at time zone 'UTC')::date - least(greatest(coalesce(p_days, 365), 1), 1500)
      and u.p between med.m * 0.4 and med.m * 2.5
    group by u.d
  )
  select a.d, a.med_p, case when a.n >= 5 then a.lo else a.med_p end, case when a.n >= 5 then a.hi else a.med_p end, a.n
  from agg a
  where a.n >= greatest(coalesce(p_min_reporters, 3), 3)
  order by a.d;
$$;

-- Chart upload: as 0010, plus the key must pass the key rule (before, a key with a space reached the INSERT and raised an error instead of returning false).
create or replace function public.ext_submit_chart(p_key text, p_range int, p_series jsonb, p_current numeric) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); today int := (current_date - date '1970-01-01'); n int; i int; d int; first_d int; prev int := -1; pr numeric; lo numeric; hi numeric; lastp numeric; el jsonb; wrote int; om numeric; oc int;
begin
  if uid is null then return false; end if;
  if p_key is null or p_key !~ '^[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]{1,200}$' or p_range is null or p_range not in (30, 90, 365) then return false; end if;
  if p_current is null or p_current < 1 or p_current >= 10000000 or scale(p_current) > 2 then return false; end if;
  if p_series is null or jsonb_typeof(p_series) <> 'array' or octet_length(p_series::text) > 4000 then return false; end if;
  n := jsonb_array_length(p_series); if n < 2 or n > 130 then return false; end if;
  if not coalesce((select contribute from public.ext_profiles where id = uid), false) then return false; end if;
  if (select created_at from public.ext_profiles where id = uid) > now() - interval '3 days' then return false; end if;
  if (select count(*) from public.ext_chart_series where user_id = uid and captured_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') >= 200 then return false; end if;
  begin
    for i in 0..n - 1 loop
      el := p_series -> i;
      if jsonb_typeof(el) <> 'array' or jsonb_array_length(el) <> 2 or jsonb_typeof(el -> 0) <> 'number' or jsonb_typeof(el -> 1) <> 'number' then return false; end if;
      if (el ->> 0) !~ '^[0-9]{5}$' then return false; end if;
      d := (el ->> 0)::int; pr := (el ->> 1)::numeric;
      if d <= prev or d < today - 410 or d > today + 1 or pr < 1 or pr >= 10000000 or scale(pr) > 2 then return false; end if;
      if i = 0 then first_d := d; end if;
      prev := d; lo := least(coalesce(lo, pr), pr); hi := greatest(coalesce(hi, pr), pr); lastp := pr;
    end loop;
  exception when others then return false; end;
  if hi > lo * 20 or prev - first_d > p_range + 7 then return false; end if;
  if abs(lastp - p_current) > greatest(p_current * 0.01, 1) then return false; end if;
  select percentile_cont(0.5) within group (order by price), count(distinct user_id) into om, oc from public.ext_price_observations where product_key = p_key and observed_day >= current_date - 14;
  if oc >= 3 and (p_current < om * 0.7 or p_current > om * 1.3) then return false; end if; -- anchored to what other readers saw this fortnight
  insert into public.ext_chart_series as c (product_key, user_id, range_days, series, current_price)
  values (p_key, uid, p_range, p_series, p_current)
  on conflict (product_key, user_id, range_days) do update set series = excluded.series, current_price = excluded.current_price, captured_at = now()
    where c.captured_at < now() - interval '6 hours';
  get diagnostics wrote = row_count;
  return wrote > 0;
end $$;

-- Consensus chart: a key longer than 200 characters matches nothing.
create or replace function public.ext_get_chart(p_key text)
returns table (day date, price numeric, reporters int)
language sql stable security definer set search_path = '' set statement_timeout = '2s' as $$
  with src as (
    select c.user_id, c.series from public.ext_chart_series c
    where length(p_key) <= 200 and c.product_key = p_key and c.captured_at > now() - interval '400 days'
      and c.user_id in (select u.user_id from public.ext_chart_series u where u.product_key = p_key group by u.user_id order by max(u.captured_at) desc limit 50) -- the 50 newest DISTINCT readers (a few ranges each)
  ), pts as (
    select s.user_id, (date '1970-01-01' + (e.v ->> 0)::int) as d, (e.v ->> 1)::numeric as p from src s, jsonb_array_elements(s.series) as e(v)
  ), per_user as (
    select user_id, d, (percentile_cont(0.5) within group (order by p))::numeric as p from pts where d >= current_date - 410 group by user_id, d
  ), med as (select percentile_cont(0.5) within group (order by p) as m from per_user),
  ok as (select u.* from per_user u, med where u.p between med.m * 0.4 and med.m * 2.5),
  agg as (select d, (percentile_cont(0.5) within group (order by p))::numeric as price, count(*)::int as n, min(p) as lo, max(p) as hi from ok group by d)
  select d, price, n from agg where auth.uid() is not null and n >= 3 order by d limit 800;
$$;

-- Anonymous feedback. Caps run BEFORE any regexp / unnest work: <= 20 reasons, <= 8000 bytes of message (over 2000 characters = refused,
-- 1001..2000 = cut to 1000 so the website form, which still allows 2000, keeps working), version <= 20 characters.
-- Caller identity: Cloudflare's cf-connecting-ip (set by the edge, a client cannot forge it) is preferred over the client-writable first
-- x-forwarded-for entry. Besides 5/hour per caller and 3000/day overall there is now a 500/hour overall cap, so a spoofed address cannot fill the table.
create or replace function public.ext_submit_feedback(p_rating int, p_reasons text[] default '{}', p_message text default null, p_version text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  allowed constant text[] := array['missing_feature','prices_wrong','too_slow','confusing','permissions','found_better','privacy','bugs','not_needed','other'];
  hdrs json; ip text; h text; clean text[]; msg text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then return false; end if;
  if coalesce(cardinality(p_reasons), 0) > 20 or octet_length(coalesce(p_message, '')) > 8000 then return false; end if;
  select coalesce(array_agg(distinct r order by r), '{}') into clean from unnest(coalesce(p_reasons, '{}')) as r where r = any (allowed);
  msg := nullif(btrim(regexp_replace(coalesce(p_message, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]', '', 'g')), '');
  if msg is not null and char_length(msg) > 2000 then return false; end if;
  msg := left(msg, 1000);
  if p_version is not null and (length(p_version) > 20 or p_version !~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$') then p_version := null; end if;
  begin hdrs := nullif(current_setting('request.headers', true), '')::json; exception when others then hdrs := null; end;
  ip := left(btrim(split_part(coalesce(nullif(hdrs ->> 'cf-connecting-ip', ''), hdrs ->> 'x-forwarded-for', ''), ',', 1)), 64);
  h := case when ip = '' then null else encode(sha256(convert_to('hauls-feedback|' || ip, 'utf8')), 'hex') end;
  if h is not null and (select count(*) from public.ext_feedback where ip_hash = h and created_at > now() - interval '1 hour') >= 5 then return false; end if;
  if (select count(*) from public.ext_feedback where created_at > now() - interval '1 hour') >= 500 then return false; end if;
  if (select count(*) from public.ext_feedback where created_at > now() - interval '1 day') >= 3000 then return false; end if;
  insert into public.ext_feedback (rating, reasons, message, version, ip_hash) values (p_rating::smallint, clean, msg, p_version, h);
  return true;
end $$;
comment on function public.ext_submit_feedback(int, text[], text, text) is 'HAULS ext: validated anonymous feedback insert (known reasons only, message cut to 1000 chars, 5/hour per caller, 500/hour and 3000/day overall). Returns false when refused.';

-- Settings merge: an oversize payload (legit ones are < 2 kB) is ignored, the caller just gets the stored state back. Everything else as 0008.
create or replace function public.ext_merge_settings(p_doc jsonb, p_stamps jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); cur public.ext_user_settings%rowtype; k text; d jsonb; s jsonb; incoming numeric;
        now_ms numeric := floor(extract(epoch from now()) * 1000);
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  p_doc := coalesce(p_doc, '{}'::jsonb); p_stamps := coalesce(p_stamps, '{}'::jsonb);
  if jsonb_typeof(p_doc) <> 'object' or jsonb_typeof(p_stamps) <> 'object' then raise exception 'invalid settings payload' using errcode = '22023'; end if;
  if octet_length(p_doc::text) > 8192 or octet_length(p_stamps::text) > 2048 then p_doc := '{}'::jsonb; p_stamps := '{}'::jsonb; end if;
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

-- Waitlist: the source label is a short fixed shape that starts with "extension" (so "erase my data" can always find the row), else the default.
create or replace function public.ext_join_waitlist(p_source text default 'extension-android') returns boolean
language plpgsql security definer set search_path = '' as $$
declare em text;
begin
  select email into em from auth.users where id = auth.uid();
  if em is null then return false; end if;
  if exists (select 1 from public.waitlist where lower(email) = lower(em)) then return false; end if;
  insert into public.waitlist (email, source) values (em, case when p_source ~ '^extension-[a-z0-9-]{1,40}$' then p_source else 'extension-android' end);
  return true;
end $$;

-- ============ 4) price-alert mail ============
-- As 0015, plus: title cut BEFORE the regexp (cost), title AND link both go through the same HTML escaping (now also the apostrophe),
-- and a link containing whitespace, control characters, quotes, backticks, backslashes or angle brackets refuses the whole call ('invalid',
-- before any limit is used). A merely long or non-allowlisted link still just drops the button, as before.
create or replace function public.ext_send_price_alert(p_key text, p_title text, p_price numeric, p_target numeric, p_url text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); to_addr text; wants boolean; secret text; sender text; title text; link text; html text; price_txt text; target_txt text; tgt numeric;
  esc constant text[] := array['&','&amp;','<','&lt;','>','&gt;','"','&quot;','''','&#39;'];
begin
  if uid is null then return 'not-signed-in'; end if;
  select email, email_alerts into to_addr, wants from public.ext_profiles where id = uid;
  if to_addr is null or not coalesce(wants, false) then return 'off'; end if;
  if p_key is null or p_key !~ '^[^\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]{1,200}$' or p_price is null or p_price <= 0 or p_price > 10000000 then return 'invalid'; end if;
  if p_url is not null and (length(p_url) > 2000 or p_url ~ '[\s\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff<>"''`\\]') then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));                                       -- one call per person at a time: the counts below cannot be raced
  select target_price into tgt from public.ext_watchlist where user_id = uid and product_key = p_key and deleted_at is null;
  if tgt is null or tgt <= 0 or p_price > tgt then return 'invalid'; end if;
  if (select count(*) from public.ext_alert_log where user_id = uid and product_key = p_key and sent_at > now() - interval '24 hours') >= 1 then return 'rate-limited'; end if;
  if (select count(*) from public.ext_alert_log where user_id = uid and sent_at > now() - interval '24 hours') >= 10 then return 'rate-limited'; end if;
  begin select decrypted_secret into secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1; exception when others then secret := null; end;
  if secret is null or secret = '' then return 'not-configured'; end if;
  begin select value ->> 'email_from' into sender from public.ext_remote_config where key = 'email'; exception when others then sender := null; end;
  if sender is null or sender = '' then return 'not-configured'; end if;                      -- never fall back to Resend's sandbox sender (it only reaches the account owner)
  title := left(regexp_replace(left(coalesce(p_title, p_key), 400), '[\x01-\x1f\x7f-\x9f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]', '', 'g'), 160);
  link := case when p_url ~ '^https://([a-z0-9-]+\.)*(amazon\.in|flipkart\.com|myntra\.com|reliancedigital\.in|tatacliq\.com|croma\.com|jiomart\.com)(/|$)' and length(p_url) <= 500 then p_url else null end;
  for i in 1..array_length(esc, 1) by 2 loop title := replace(title, esc[i], esc[i + 1]); link := replace(link, esc[i], esc[i + 1]); end loop;
  price_txt := '₹' || to_char(p_price, 'FM99,99,99,999'); target_txt := '₹' || to_char(tgt, 'FM99,99,99,999');
  html := '<div style="font-family:system-ui,sans-serif;max-width:480px"><h2 style="margin:0 0 8px">Price drop on your watchlist</h2><p style="margin:0 0 12px"><b>' || title || '</b></p><p style="font-size:22px;margin:0 0 6px"><b>' || price_txt || '</b></p><p style="margin:0 0 16px;color:#555">Your alert was ' || target_txt || '.</p>'
    || case when link is not null then '<p><a href="' || link || '" style="background:#131316;color:#fff;padding:10px 18px;border-radius:99px;text-decoration:none">Open the product</a></p>' else '' end
    || '<p style="font-size:12px;color:#777;margin-top:24px">You get this because you turned on email alerts in HAULS. Turn them off in the HAULS account menu. Check the store for the final price, offers and seller before you buy.</p></div>';
  begin
    perform net.http_post(url := 'https://api.resend.com/emails', headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
      body := jsonb_build_object('from', sender, 'to', jsonb_build_array(to_addr), 'subject', 'Price drop: ' || price_txt || ' (alert ' || target_txt || ')', 'html', html));
  exception when others then return 'error';                                                  -- transport problem (e.g. pg_net off): clean code, nothing logged
  end;
  insert into public.ext_alert_log (user_id, product_key) values (uid, p_key);
  return 'queued';
end $$;

-- ============ 3) role timeouts ============
-- Supabase already ships anon = 3s and authenticated = 8s; these pin anon at 3s and tighten authenticated to 5s. PostgREST applies the role's settings per request.
-- If this project may not ALTER ROLE, each statement only warns: then set them in Dashboard > Database > Roles (or ask support) and re-run.
do $do$ begin
  begin alter role anon set statement_timeout = '3s'; exception when others then raise warning 'anon statement_timeout not set (%)', sqlerrm; end;
  begin alter role authenticated set statement_timeout = '5s'; exception when others then raise warning 'authenticated statement_timeout not set (%)', sqlerrm; end;
  begin alter role anon set idle_in_transaction_session_timeout = '15s'; exception when others then raise warning 'anon idle_in_transaction_session_timeout not set (%)', sqlerrm; end;
  begin alter role authenticated set idle_in_transaction_session_timeout = '15s'; exception when others then raise warning 'authenticated idle_in_transaction_session_timeout not set (%)', sqlerrm; end;
  begin perform pg_notify('pgrst', 'reload config'); exception when others then null; end;
end $do$;

-- ============ 5) retention ============
-- alert-log rows only matter for the 24 h mail limits (kept 90 days), feedback is kept 1 year. Run daily by the project owner / pg_cron / a scheduled job with the service_role key:
--   select cron.schedule('ext-purge-old-data', '17 3 * * *', $$select public.ext_purge_old_data()$$);   -- needs Database > Extensions > pg_cron; not required for anything else
create index if not exists ext_alert_log_sent on public.ext_alert_log (sent_at);
create or replace function public.ext_purge_old_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; f int;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then raise exception 'service role only' using errcode = '42501'; end if;
  delete from public.ext_alert_log where sent_at < now() - interval '90 days'; get diagnostics a = row_count;
  delete from public.ext_feedback where created_at < now() - interval '1 year'; get diagnostics f = row_count;
  return jsonb_build_object('alert_log', a, 'feedback', f);
end $$;
comment on function public.ext_purge_old_data() is 'HAULS ext: retention. Deletes ext_alert_log rows older than 90 days and ext_feedback older than 1 year. service_role / owner only.';

-- ============ 6) grants: reset, then grant the matrix ============
-- FINAL MATRIX (anything not listed has NO access for public / anon / authenticated; service_role and the owner bypass as usual)
--   tables     ext_profiles           authenticated: SELECT (own row, RLS), UPDATE (name, contribute, phone, email_alerts) (RLS own row + guard trigger)
--              ext_watchlist          authenticated: SELECT, INSERT, UPDATE, DELETE (own rows, RLS)
--              ext_user_settings      authenticated: SELECT (own row, RLS); writes only via ext_merge_settings
--              ext_remote_config      anon + authenticated: SELECT (public flags; never put a secret here)
--              ext_price_observations, ext_chart_series, ext_feedback, ext_alert_log   nobody (reached only through the functions below)
--   sequences  none (identity / serial sequences are used by their owners' functions only)
--   functions  anon + authenticated:  ext_submit_feedback
--              authenticated only:    ext_price_history, ext_upsert_observations, ext_submit_chart, ext_get_chart, ext_merge_settings, ext_send_price_alert,
--                                     ext_join_waitlist, ext_ensure_profile, ext_export_my_data, ext_delete_my_data, ext_forget_my_observations, ext_purge_my_deleted_watchlist
--              service_role only:     ext_purge_old_data
--              nobody (triggers / helpers): ext_touch_updated_at, ext_profiles_guard, ext_handle_new_user, ext_watchlist_limit, ext_watchlist_lww, ext_watchlist_fix_ts,
--                                     ext_watchlist_blank_deleted, ext_watchlist_purge_trigger, ext_watchlist_clean, ext_valid_places, ext_valid_stores, ext_strip_text, ext_clean_url
do $do$
declare r record;
  auth_fns constant text[] := array['ext_price_history','ext_upsert_observations','ext_submit_chart','ext_get_chart','ext_merge_settings','ext_send_price_alert','ext_join_waitlist','ext_ensure_profile','ext_export_my_data','ext_delete_my_data','ext_forget_my_observations','ext_purge_my_deleted_watchlist'];
  anon_fns constant text[] := array['ext_submit_feedback'];
  svc_fns  constant text[] := array['ext_purge_old_data'];
begin
  for r in select p.oid::regprocedure::text as sig, p.proname::text as nm from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ext\_%' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.nm = any (auth_fns) or r.nm = any (anon_fns) then execute format('grant execute on function %s to authenticated', r.sig); end if;
    if r.nm = any (anon_fns) then execute format('grant execute on function %s to anon', r.sig); end if;
    if r.nm = any (svc_fns) and exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', r.sig); end if;
    if not (r.nm = any (auth_fns) or r.nm = any (anon_fns) or r.nm = any (svc_fns)) then raise notice 'ext function % is internal (no grants)', r.sig; end if;
  end loop;
  for r in select c.oid::regclass::text as rel, c.relkind::text as k from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname like 'ext\_%' and c.relkind in ('r', 'p', 'S') loop
    execute format('revoke all on %s %s from public, anon, authenticated', case when r.k = 'S' then 'sequence' else 'table' end, r.rel);
  end loop;
end $do$;
grant select on public.ext_profiles to authenticated;
grant update (name, contribute, phone, email_alerts) on public.ext_profiles to authenticated;
grant select, insert, update, delete on public.ext_watchlist to authenticated;
grant select on public.ext_user_settings to authenticated;
grant select on public.ext_remote_config to anon, authenticated;
