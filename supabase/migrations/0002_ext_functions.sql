-- HAULS extension RPCs. Run after 0001. Idempotent.

-- Per-day aggregate history; drops prices outside [0.4x, 2.5x] of the product's overall median.
create or replace function public.ext_price_history(p_key text, p_days int default 365)
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
  order by o.observed_day;
$$;
comment on function public.ext_price_history(text,int) is 'HAULS ext: anonymised per-day price aggregates with outlier rejection.';

-- Bulk insert of up to 50 observations; invalid rows skipped; no-op if profile.contribute is false.
create or replace function public.ext_upsert_observations(p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r jsonb; n int := 0; c int; i int := 0;
begin
  if uid is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  if not coalesce((select contribute from public.ext_profiles where id = uid), false) then return 0; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; exit when i > 50;
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
comment on function public.ext_upsert_observations(jsonb) is 'HAULS ext: validated bulk insert (max 50), honours contribute flag, returns inserted count.';

-- Adds caller's email to the marketing waitlist if absent. No unique constraint assumed.
create or replace function public.ext_join_waitlist(p_source text default 'extension-android') returns boolean
language plpgsql security definer set search_path = '' as $$
declare em text;
begin
  select email into em from auth.users where id = auth.uid();
  if em is null then return false; end if;
  if exists (select 1 from public.waitlist where lower(email) = lower(em)) then return false; end if;
  insert into public.waitlist (email, source) values (em, left(coalesce(p_source,'extension-android'), 100));
  return true;
end $$;
comment on function public.ext_join_waitlist(text) is 'HAULS ext: idempotent waitlist signup for the signed-in user; true if newly added.';

-- Right to erasure (app data; auth.users row itself is kept).
create or replace function public.ext_delete_my_data() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from public.ext_price_observations where user_id = uid;
  delete from public.ext_watchlist where user_id = uid;
  delete from public.ext_profiles where id = uid;
end $$;
comment on function public.ext_delete_my_data() is 'HAULS ext: erases caller watchlist, observations and profile.';

-- Lock down: authenticated only.
do $$
declare f text;
begin
  foreach f in array array[
    'public.ext_price_history(text,int)', 'public.ext_upsert_observations(jsonb)',
    'public.ext_join_waitlist(text)', 'public.ext_delete_my_data()',
    'public.ext_touch_updated_at()', 'public.ext_profiles_guard()', 'public.ext_handle_new_user()']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.ext_price_history(text,int), public.ext_upsert_observations(jsonb),
  public.ext_join_waitlist(text), public.ext_delete_my_data() to authenticated;
