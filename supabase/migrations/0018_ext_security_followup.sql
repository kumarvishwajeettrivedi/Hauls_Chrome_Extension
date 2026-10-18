-- 0018: security follow-up to 0017 (red-team findings). Idempotent (safe to re-run). Run in the Supabase SQL editor after 0017. Only ext_* objects; never touches public.waitlist / public.keepalive.
--  1) ONE hidden-character rule everywhere (CHECKs, feedback, places, alert mail, chart upload), written once in ext_hidden_re() below. Old rows are cleaned FIRST
--     (text is stripped; only rows with an unusable product key are deleted, as in 0017).
--  2) tombstone abuse: deleted_at is clamped to now() (no far-future tombstones that outlive the purge); live rows count against the plan limit, live + deleted rows against a hard ceiling of 500 per user;
--     ext_purge_old_data() also removes tombstones older than 24 h, so retention no longer depends on the owner writing again.
--  3) price-alert mail is sent only to a CONFIRMED account email (auth.users.email_confirmed_at is not null), else 'off'.
--  4) anonymous feedback: calls are serialised before the cap counts; an IPv6 caller is bucketed by its /64.
--  5) heart-only items (no alert price, default 10% alert): see ext_send_price_alert below.
-- NEVER replay an older migration after this one: every earlier file is "idempotent" but re-creates the functions it defines (and 0017 resets every ext_ grant), which silently reverts the fix here.
-- If you did, run 0017 and then 0018 again (0018 last).
--
-- The hidden-character class (the ONLY copy is in ext_hidden_re()): C0 controls, DEL + C1 controls, soft hyphen U+00AD, zero-width space U+200B, LRM / RLM,
-- line / paragraph separators, bidi embeddings / overrides U+202A-202E, U+2060-2064 (word joiner, invisible operators), U+2066-2069 (bidi isolates), BOM U+FEFF, tag characters U+E0000-E007F.
-- ZWNJ U+200C and ZWJ U+200D stay allowed (Indic scripts, emoji). Keys and links also refuse whitespace and unicode spaces (ext_spaced) and quote / angle / backslash characters.
-- The extension uses the same class (extension/lib.js cleanText / okKey, guard.js); tests/unit/db-align.test.js compares the two.
-- Sanity check on the real database after applying (expected: t | f | t | f):
--   select public.ext_hidden(chr(8203)||'a') as zero_width_detected, public.ext_hidden('a'||chr(8205)||'b') as zwj_flagged, public.ext_hidden('a'||chr(917569)) as tag_detected, public.ext_hidden('a'||chr(65529)) as fff9_flagged;
-- This file is pure ASCII on purpose: every code point is written as an escape (\uXXXX, \UXXXXXXXX, chr()), so a copy-paste cannot silently drop one.
-- A CHECK runs as the writing role, so the pure helpers below (no table access, immutable, fixed search_path) are executable by everyone (grants at the bottom).

-- ============ pure helpers (safe for everyone) ============
create or replace function public.ext_hidden_re() returns text language sql immutable parallel safe set search_path = '' as $$
  select '[\x01-\x1f\x7f-\x9f\u00ad\u200b\u200e\u200f\u2028-\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\U000e0000-\U000e007f]'::text
$$;
comment on function public.ext_hidden_re() is 'HAULS ext: the one regex class of hidden characters (controls, bidi, zero-width, tag characters). ZWNJ / ZWJ are allowed.';
create or replace function public.ext_hidden(t text) returns boolean language sql immutable strict parallel safe set search_path = '' as $$
  select t ~ public.ext_hidden_re()
$$;
create or replace function public.ext_spaced(t text) returns boolean language sql immutable strict parallel safe set search_path = '' as $$
  select t ~ '[\s\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]' or public.ext_hidden(t)  -- \s alone depends on the server locale, so the unicode spaces are listed
$$;
create or replace function public.ext_valid_key(t text) returns boolean language sql immutable strict parallel safe set search_path = '' as $$
  select char_length(t) between 1 and 200 and t !~ '[<>"''`\\]' and not public.ext_spaced(t)
$$;
create or replace function public.ext_valid_text(t text, max int) returns boolean language sql immutable strict parallel safe set search_path = '' as $$
  select char_length(t) <= max and t !~ '[<>]' and not public.ext_hidden(t)
$$;
create or replace function public.ext_strip_text(t text) returns text language sql immutable strict parallel safe set search_path = '' as $$
  select nullif(btrim(regexp_replace(t, '[<>]|' || public.ext_hidden_re(), '', 'g')), '')
$$;
comment on function public.ext_strip_text(text) is 'HAULS ext: removes hidden characters and angle brackets, trims; empty becomes NULL.';
create or replace function public.ext_clean_url(t text) returns text language sql immutable strict parallel safe set search_path = '' as $$
  select case when char_length(t) <= 500 and t ~* '^https://[^<>"''\\]+$' and not public.ext_spaced(t) then t end
$$;
comment on function public.ext_clean_url(text) is 'HAULS ext: the value if it is an https link of <= 500 chars without whitespace / hidden characters / quotes / angle brackets, else NULL.';

-- Saved places: as 0017 with the full hidden class.
create or replace function public.ext_valid_places(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 8 and not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object' or (e - array['id','name','pin']) <> '{}'::jsonb
       or jsonb_typeof(e->'id') <> 'string' or (e->>'id') !~ '^[A-Za-z0-9_-]{1,20}$'
       or jsonb_typeof(e->'name') <> 'string' or char_length(e->>'name') not between 1 and 24 or not public.ext_valid_text(e->>'name', 24)
       or jsonb_typeof(e->'pin') <> 'string' or (e->>'pin') !~ '^[0-9]{6}$')
$$;

-- ============ 1a) clean old rows that would break the widened rules ============
update public.ext_profiles set name = left(public.ext_strip_text(name), 80) where not public.ext_valid_text(name, 80);
update public.ext_profiles set avatar_url = null where public.ext_clean_url(avatar_url) is null and avatar_url is not null;

-- tombstones dated in the future never reach the purge: pull them back to now()
update public.ext_watchlist set deleted_at = now() where deleted_at > now();

update public.ext_watchlist set
  title = left(public.ext_strip_text(title), 500), site = left(public.ext_strip_text(site), 60),
  url = public.ext_clean_url(url), image = public.ext_clean_url(image)
where not public.ext_valid_text(title, 500) or not public.ext_valid_text(site, 60)
   or (url is not null and public.ext_clean_url(url) is null) or (image is not null and public.ext_clean_url(image) is null);
-- A product key is an identity, so it cannot be "repaired": rows with an unusable key are removed (a real key is `domain:id`).
delete from public.ext_watchlist where not public.ext_valid_key(product_key);
delete from public.ext_price_observations where not public.ext_valid_key(product_key);
update public.ext_price_observations set site = null where not public.ext_valid_text(site, 60);
delete from public.ext_chart_series where not public.ext_valid_key(product_key);
delete from public.ext_alert_log where not public.ext_valid_key(product_key);

-- feedback keeps tab / newline / carriage return: the rule looks at the message without them, the strip skips them
update public.ext_feedback set message = left(nullif(btrim(regexp_replace(message, '(?![\t\n\r])' || public.ext_hidden_re(), '', 'g')), ''), 1000)
  where public.ext_hidden(translate(message, E'\t\n\r', ''));

update public.ext_user_settings set doc = doc - 'places', stamps = stamps - 'places' where doc ? 'places' and not public.ext_valid_places(doc->'places');

-- ============ 1c) CHECK constraints (same names and shapes as 0017, helpers instead of literal classes) ============
alter table public.ext_profiles drop constraint if exists ext_profiles_name_check;
alter table public.ext_profiles add constraint ext_profiles_name_check check (public.ext_valid_text(name, 80));
alter table public.ext_profiles drop constraint if exists ext_profiles_avatar_check;
alter table public.ext_profiles add constraint ext_profiles_avatar_check check (avatar_url is null or public.ext_clean_url(avatar_url) is not null);

alter table public.ext_watchlist drop constraint if exists ext_watchlist_text_limits;
alter table public.ext_watchlist add constraint ext_watchlist_text_limits check (
  public.ext_valid_key(product_key) and public.ext_valid_text(site, 60) and public.ext_valid_text(title, 500)
  and (url is null or public.ext_clean_url(url) is not null) and (image is null or public.ext_clean_url(image) is not null));

alter table public.ext_price_observations drop constraint if exists ext_obs_text_limits;
alter table public.ext_price_observations add constraint ext_obs_text_limits check (public.ext_valid_key(product_key) and public.ext_valid_text(site, 60));
alter table public.ext_chart_series drop constraint if exists ext_chart_text_limits;
alter table public.ext_chart_series add constraint ext_chart_text_limits check (public.ext_valid_key(product_key) and octet_length(series::text) <= 4000);
alter table public.ext_alert_log drop constraint if exists ext_alert_log_key_fmt;
alter table public.ext_alert_log add constraint ext_alert_log_key_fmt check (public.ext_valid_key(product_key));

alter table public.ext_feedback drop constraint if exists ext_feedback_text_limits;
alter table public.ext_feedback add constraint ext_feedback_text_limits check (
  (message is null or (char_length(message) <= 1000 and not public.ext_hidden(translate(message, E'\t\n\r', ''))))
  and reasons <@ array['missing_feature','prices_wrong','too_slow','confusing','permissions','found_better','privacy','bugs','not_needed','other']
  and (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'));

-- ============ 2) tombstone abuse ============
-- A tombstone dated in the future would never reach the 24 h purge. Sorts first (0_clean), so it also runs for the service role / owner.
create or replace function public.ext_watchlist_clean() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.title := public.ext_strip_text(new.title); new.site := public.ext_strip_text(new.site);
  if new.image is not null and public.ext_clean_url(new.image) is null then new.image := null; end if;
  if new.deleted_at > now() then new.deleted_at := now(); end if;
  return new;
end $$;
drop trigger if exists ext_watchlist_0_clean on public.ext_watchlist;
create trigger ext_watchlist_0_clean before insert or update on public.ext_watchlist for each row execute function public.ext_watchlist_clean();

-- Plan limit (free 20 / pro 200 / max unlimited) counts LIVE rows only, as before. New: ALL rows of a person (live + tombstones) are capped at 500, so soft-deleted
-- rows cannot be used as free storage. At the ceiling, that person's own tombstones older than 24 h are purged first; only then is the insert refused.
-- ponytail: the ceiling also caps the "max" plan at 500 rows; raise the literal if a real user needs more.
create or replace function public.ext_watchlist_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cap int; plan_ text; live int; total int;
begin
  if tg_op = 'UPDATE' and (new.deleted_at is not null or old.deleted_at is null) then return new; end if; -- delete / edit of an existing row: neither count changes
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  if tg_op = 'INSERT' and not exists (select 1 from public.ext_watchlist w where w.user_id = new.user_id and w.product_key = new.product_key) then -- a genuinely new row
    select count(*) into total from public.ext_watchlist w where w.user_id = new.user_id;
    if total >= 500 then
      delete from public.ext_watchlist w where w.user_id = new.user_id and w.deleted_at is not null and w.deleted_at < now() - interval '24 hours';
      select count(*) into total from public.ext_watchlist w where w.user_id = new.user_id;
      if total >= 500 then
        raise exception 'watchlist_limit_reached' using errcode = 'P0001', hint = 'at most 500 watchlist rows (including deleted ones) per account';
      end if;
    end if;
  end if;
  if new.deleted_at is not null then return new; end if;                       -- soft-deleted row: never counts against the plan
  if tg_op = 'INSERT' and exists (select 1 from public.ext_watchlist w
       where w.user_id = new.user_id and w.product_key = new.product_key and w.deleted_at is null)
    then return new; end if;                                                   -- upsert onto a live row = an edit
  select plan into plan_ from public.ext_profiles where id = new.user_id;
  cap := case coalesce(plan_, 'free') when 'max' then null when 'pro' then 200 else 20 end;
  if cap is null then return new; end if;
  select count(*) into live from public.ext_watchlist w where w.user_id = new.user_id and w.deleted_at is null;
  if live >= cap then
    raise exception 'watchlist_limit_reached' using errcode = 'P0001',
      hint = format('plan %s allows %s live watchlist items', coalesce(plan_, 'free'), cap);
  end if;
  return new;
end $$;
comment on function public.ext_watchlist_limit() is 'HAULS ext: plan cap on live rows (insert / restore) and a hard ceiling of 500 rows per account including tombstones.';
drop trigger if exists ext_watchlist_limit on public.ext_watchlist;
create trigger ext_watchlist_limit before insert or update on public.ext_watchlist
  for each row execute function public.ext_watchlist_limit();

-- Retention: as 0017, plus tombstones older than 24 h for EVERY account (the per-user purge only runs when that account writes again).
create index if not exists ext_watchlist_tomb_age on public.ext_watchlist (deleted_at) where deleted_at is not null;
create or replace function public.ext_purge_old_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; f int; t int;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then raise exception 'service role only' using errcode = '42501'; end if;
  delete from public.ext_alert_log where sent_at < now() - interval '90 days'; get diagnostics a = row_count;
  delete from public.ext_feedback where created_at < now() - interval '1 year'; get diagnostics f = row_count;
  delete from public.ext_watchlist where deleted_at is not null and deleted_at < now() - interval '24 hours'; get diagnostics t = row_count;
  return jsonb_build_object('alert_log', a, 'feedback', f, 'tombstones', t);
end $$;
comment on function public.ext_purge_old_data() is 'HAULS ext: retention. Deletes ext_alert_log rows older than 90 days, ext_feedback older than 1 year and watchlist tombstones older than 24 hours. service_role / owner only.';

-- ============ chart upload: the key rule is ext_valid_key ============
create or replace function public.ext_submit_chart(p_key text, p_range int, p_series jsonb, p_current numeric) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); today int := (current_date - date '1970-01-01'); n int; i int; d int; first_d int; prev int := -1; pr numeric; lo numeric; hi numeric; lastp numeric; el jsonb; wrote int; om numeric; oc int;
begin
  if uid is null then return false; end if;
  if p_key is null or not public.ext_valid_key(p_key) or p_range is null or p_range not in (30, 90, 365) then return false; end if;
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

-- ============ 4) anonymous feedback ============
-- As 0017, plus:
--  * the message loses every hidden character (ext_hidden_re) except tab / newline / carriage return;
--  * pg_advisory_xact_lock(hashtext('ext_feedback')) before the three cap counts, so parallel callers cannot all read "4 of 5" and all insert (one global lock: feedback is rare and the body is tiny);
--  * the caller bucket of an IPv6 address is its /64 (a person owns a whole /64, so one address per call used to dodge the 5/hour cap); IPv4-mapped IPv6 counts as the IPv4 address.
-- ip_hash is a plain sha256 of a CONSTANT-salted string, NOT a secret-keyed hash: the salt is public in this file and the IPv4 space is small, so anyone who can read the table could
-- recompute an address. The table is closed to every client role (service role only). Docs therefore say "hash", never "salted/keyed".
create or replace function public.ext_submit_feedback(p_rating int, p_reasons text[] default '{}', p_message text default null, p_version text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  allowed constant text[] := array['missing_feature','prices_wrong','too_slow','confusing','permissions','found_better','privacy','bugs','not_needed','other'];
  hdrs json; ip text; h text; clean text[]; msg text; v inet;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then return false; end if;
  if coalesce(cardinality(p_reasons), 0) > 20 or octet_length(coalesce(p_message, '')) > 8000 then return false; end if;
  select coalesce(array_agg(distinct r order by r), '{}') into clean from unnest(coalesce(p_reasons, '{}')) as r where r = any (allowed);
  msg := nullif(btrim(regexp_replace(coalesce(p_message, ''), '(?![\t\n\r])' || public.ext_hidden_re(), '', 'g')), '');
  if msg is not null and char_length(msg) > 2000 then return false; end if;
  msg := left(msg, 1000);
  if p_version is not null and (length(p_version) > 20 or p_version !~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$') then p_version := null; end if;
  begin hdrs := nullif(current_setting('request.headers', true), '')::json; exception when others then hdrs := null; end;
  ip := left(btrim(split_part(coalesce(nullif(hdrs ->> 'cf-connecting-ip', ''), hdrs ->> 'x-forwarded-for', ''), ',', 1)), 64);
  begin                                                                                      -- canonical caller bucket: IPv4 as is, IPv6 as its /64
    v := ip::inet;
    if family(v) = 6 and ip ~* '^::ffff:[0-9.]+$' then v := substr(ip, 8)::inet; end if;
    ip := case when family(v) = 6 then host(network(set_masklen(v, 64))) else host(v) end;
  exception when others then null;                                                           -- not an address (empty, garbage): the raw text is hashed as before
  end;
  h := case when ip = '' then null else encode(sha256(convert_to('hauls-feedback|' || ip, 'utf8')), 'hex') end;
  perform pg_advisory_xact_lock(hashtext('ext_feedback'));                                   -- serialise: the counts below cannot be raced
  if h is not null and (select count(*) from public.ext_feedback where ip_hash = h and created_at > now() - interval '1 hour') >= 5 then return false; end if;
  if (select count(*) from public.ext_feedback where created_at > now() - interval '1 hour') >= 500 then return false; end if;
  if (select count(*) from public.ext_feedback where created_at > now() - interval '1 day') >= 3000 then return false; end if;
  insert into public.ext_feedback (rating, reasons, message, version, ip_hash) values (p_rating::smallint, clean, msg, p_version, h);
  return true;
end $$;
comment on function public.ext_submit_feedback(int, text[], text, text) is 'HAULS ext: validated anonymous feedback insert (known reasons only, message cut to 1000 chars, 5/hour per caller (IPv6 per /64), 500/hour and 3000/day overall, serialised). Returns false when refused. ip_hash is a plain hash (constant salt).';

-- ============ 3) + 5) price-alert mail ============
-- As 0017, plus:
--  * the account email must be CONFIRMED (auth.users.email_confirmed_at is not null), else 'off': if the project allows email sign-up without confirmation, someone could otherwise
--    register somebody else's address and have HAULS mail it;
--  * key / link rules from the helpers (hidden characters and unicode spaces refuse the call);
--  * heart-only items. The extension's default alert for a hearted item without an alert price is a 10% drop from the price it was hearted at, which the server does not store. Rule:
--    a live watchlist row with wish = true and NO stored alert price is accepted only when the client's p_target lies between 85% and 100% of the STORED last_price
--    (last_price * 0.85 <= p_target <= last_price) and the price is <= p_target; otherwise 'invalid'. So the server still never trusts an arbitrary client target
--    (an attacker cannot raise the line above the last stored price, nor claim a bigger drop than 15% below it), and a row with a stored alert price ignores p_target entirely.
create or replace function public.ext_send_price_alert(p_key text, p_title text, p_price numeric, p_target numeric, p_url text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); to_addr text; wants boolean; secret text; sender text; title text; link text; html text; price_txt text; target_txt text; tgt numeric; heart boolean; lastp numeric;
  esc constant text[] := array['&','&amp;','<','&lt;','>','&gt;','"','&quot;','''','&#39;'];
begin
  if uid is null then return 'not-signed-in'; end if;
  select email, email_alerts into to_addr, wants from public.ext_profiles where id = uid;
  if to_addr is null or not coalesce(wants, false) then return 'off'; end if;
  if not exists (select 1 from auth.users u where u.id = uid and u.email_confirmed_at is not null) then return 'off'; end if; -- unconfirmed address: never mail it
  if p_key is null or not public.ext_valid_key(p_key) or p_price is null or p_price <= 0 or p_price > 10000000 then return 'invalid'; end if;
  if p_url is not null and (length(p_url) > 2000 or p_url ~ '[<>"''`\\]' or public.ext_spaced(p_url)) then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));                                       -- one call per person at a time: the counts below cannot be raced
  select target_price, wish, last_price into tgt, heart, lastp from public.ext_watchlist where user_id = uid and product_key = p_key and deleted_at is null;
  if not found then return 'invalid'; end if;
  if tgt is null or tgt <= 0 then                                                            -- heart only (default 10% alert): the client line is accepted only inside [85%, 100%] of the stored last price
    if not coalesce(heart, false) or lastp is null or lastp <= 0 or p_target is null or p_target > lastp or p_target < lastp * 0.85 then return 'invalid'; end if;
    tgt := p_target;
  end if;
  if p_price > tgt then return 'invalid'; end if;
  if (select count(*) from public.ext_alert_log where user_id = uid and product_key = p_key and sent_at > now() - interval '24 hours') >= 1 then return 'rate-limited'; end if;
  if (select count(*) from public.ext_alert_log where user_id = uid and sent_at > now() - interval '24 hours') >= 10 then return 'rate-limited'; end if;
  begin select decrypted_secret into secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1; exception when others then secret := null; end;
  if secret is null or secret = '' then return 'not-configured'; end if;
  begin select value ->> 'email_from' into sender from public.ext_remote_config where key = 'email'; exception when others then sender := null; end;
  if sender is null or sender = '' then return 'not-configured'; end if;                      -- never fall back to Resend's sandbox sender (it only reaches the account owner)
  title := left(regexp_replace(left(coalesce(p_title, p_key), 400), public.ext_hidden_re(), '', 'g'), 160);
  link := case when p_url ~ '^https://([a-z0-9-]+\.)*(amazon\.in|flipkart\.com|myntra\.com|reliancedigital\.in|tatacliq\.com|croma\.com|jiomart\.com)(/|$)' and length(p_url) <= 500 then p_url else null end;
  for i in 1..array_length(esc, 1) by 2 loop title := replace(title, esc[i], esc[i + 1]); link := replace(link, esc[i], esc[i + 1]); end loop;
  price_txt := chr(8377) || to_char(p_price, 'FM99,99,99,999'); target_txt := chr(8377) || to_char(tgt, 'FM99,99,99,999');
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

-- ============ grants ============
-- create or replace keeps the grants from 0017; its matrix stays final except for this one row:
--   pure helpers, safe for everyone (PUBLIC, so anon, authenticated, service_role and any other writer): ext_hidden_re, ext_hidden, ext_spaced, ext_valid_key, ext_valid_text, ext_strip_text, ext_clean_url
--   (they read no table and only answer "is this string clean"; the CHECKs above call them as the WRITING role, so without this grant every client and service-role write fails).
-- ext_valid_places / ext_valid_stores stay closed: their CHECK is on ext_user_settings, which only ext_merge_settings (security definer) writes.
revoke all on function public.ext_hidden_re(), public.ext_hidden(text), public.ext_spaced(text), public.ext_valid_key(text), public.ext_valid_text(text, int), public.ext_strip_text(text), public.ext_clean_url(text) from anon, authenticated;
grant execute on function public.ext_hidden_re(), public.ext_hidden(text), public.ext_spaced(text), public.ext_valid_key(text), public.ext_valid_text(text, int), public.ext_strip_text(text), public.ext_clean_url(text) to public;
