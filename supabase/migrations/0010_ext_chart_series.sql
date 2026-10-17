-- HAULS extension: shared price-history series seeded by the charts people already see (Amazon's own "Price history"), opt-in. Idempotent. Run after 0009.
-- One compact row per (product, user, range): the series is a jsonb array of [day_number, price]. Users never read this table; they call ext_get_chart().
create table if not exists public.ext_chart_series (
  product_key   text not null check (length(product_key) between 1 and 200),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  range_days    int  not null check (range_days between 5 and 400),
  series        jsonb not null check (jsonb_typeof(series) = 'array' and jsonb_array_length(series) between 2 and 130),
  current_price numeric not null check (current_price > 0 and current_price < 10000000),
  captured_at   timestamptz not null default now(),
  primary key (product_key, user_id, range_days)
);
comment on table public.ext_chart_series is 'HAULS ext: opt-in chart series per user/product/range. No direct access; written by ext_submit_chart(), read as consensus by ext_get_chart().';
create index if not exists ext_chart_key_idx on public.ext_chart_series (product_key);
alter table public.ext_chart_series enable row level security;
revoke all on public.ext_chart_series from public, anon, authenticated;

-- Submit one series. Returns true when stored. Rules: signed in, contribute = true, account at least 3 days old, <= 200 stored series per user per UTC day,
-- range_days one of 30/90/365 (one stored row per user, product and range), 2..130 points, <= 4000 bytes, integer day numbers strictly increasing inside the last ~400 days and spanning at most range+7 days, prices 1..10M with <= 2 decimals,
-- spread <= 20x, the LAST price must match the price the reader saw today (+-1%) and, when >= 3 observers exist for the product, stay within 30% of their median.
-- A product/range is rewritten at most once per 6 hours per user. Any malformed input returns false (never an error).
create or replace function public.ext_submit_chart(p_key text, p_range int, p_series jsonb, p_current numeric) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); today int := (current_date - date '1970-01-01'); n int; i int; d int; first_d int; prev int := -1; pr numeric; lo numeric; hi numeric; lastp numeric; el jsonb; wrote int; om numeric; oc int;
begin
  if uid is null then return false; end if;
  if not coalesce((select contribute from public.ext_profiles where id = uid), false) then return false; end if;
  if (select created_at from public.ext_profiles where id = uid) > now() - interval '3 days' then return false; end if;
  if p_key is null or length(p_key) < 1 or length(p_key) > 200 or p_range is null or p_range not in (30, 90, 365) then return false; end if;
  if p_current is null or p_current < 1 or p_current >= 10000000 or scale(p_current) > 2 then return false; end if;
  if p_series is null or jsonb_typeof(p_series) <> 'array' or octet_length(p_series::text) > 4000 then return false; end if;
  n := jsonb_array_length(p_series); if n < 2 or n > 130 then return false; end if;
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
comment on function public.ext_submit_chart(text,int,jsonb,numeric) is 'HAULS ext: validated opt-in chart upload (see migration 0010).';
revoke all on function public.ext_submit_chart(text,int,jsonb,numeric) from public, anon, authenticated;
grant execute on function public.ext_submit_chart(text,int,jsonb,numeric) to authenticated;

-- Consensus series for a product. Signed-in callers only. One value per user per day (a user's several ranges count once), then the median across users;
-- days need >= 3 distinct reporters (same threshold as ext_price_history); points far from the product median are dropped first.
-- Only the 50 newest distinct readers of a product are read, with a 2 s statement timeout.
create or replace function public.ext_get_chart(p_key text)
returns table (day date, price numeric, reporters int)
language sql stable security definer set search_path = '' set statement_timeout = '2s' as $$
  with src as (
    select c.user_id, c.series from public.ext_chart_series c
    where c.product_key = p_key and c.captured_at > now() - interval '400 days'
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
comment on function public.ext_get_chart(text) is 'HAULS ext: consensus shared chart series (aggregates only, signed-in callers).';
revoke all on function public.ext_get_chart(text) from public, anon, authenticated;
grant execute on function public.ext_get_chart(text) to authenticated;

-- Erase / export / forget include the chart rows.
create or replace function public.ext_delete_my_data() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); em text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select email into em from auth.users where id = uid;
  delete from public.ext_price_observations where user_id = uid;
  delete from public.ext_chart_series where user_id = uid;
  delete from public.ext_watchlist where user_id = uid;
  delete from public.ext_user_settings where user_id = uid;
  delete from public.ext_profiles where id = uid;
  if em is not null then delete from public.waitlist where lower(email) = lower(em) and source like 'extension%'; end if;
end $$;
create or replace function public.ext_forget_my_observations() returns int
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from public.ext_chart_series where user_id = uid;
  delete from public.ext_price_observations where user_id = uid; get diagnostics n = row_count; return n;
end $$;
revoke all on function public.ext_delete_my_data(), public.ext_forget_my_observations() from public, anon, authenticated;
grant execute on function public.ext_delete_my_data(), public.ext_forget_my_observations() to authenticated;

-- Export includes the caller's chart rows.
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
                              from (select * from public.ext_price_observations where user_id = uid order by observed_day desc limit 5000) x), '[]'::jsonb),
    'charts', coalesce((select jsonb_agg(jsonb_build_object('product_key', c.product_key, 'range_days', c.range_days, 'points', jsonb_array_length(c.series), 'captured_at', c.captured_at)) from public.ext_chart_series c where c.user_id = uid), '[]'::jsonb));
end $$;
revoke all on function public.ext_export_my_data() from public, anon, authenticated;
grant execute on function public.ext_export_my_data() to authenticated;
