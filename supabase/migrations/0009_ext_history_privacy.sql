-- HAULS extension: stronger anonymity for community price history (security review). Idempotent. Run after 0008.
-- Before: a day with 2 reporters was shown with its min and max, so one reporter could read the other's price.
-- Now: a day needs >= 3 reporters, and min/max are only returned with >= 5 reporters (below that they equal the median).
-- The extension only uses day + median_price, so nothing visible changes except that thin days disappear.
create or replace function public.ext_price_history(p_key text, p_days int default 365, p_min_reporters int default 3)
returns table (day date, median_price numeric, min_price numeric, max_price numeric, reporters int)
language sql stable security definer set search_path = '' as $$
  with per_user as (
    select o.observed_day as d, o.user_id, (percentile_cont(0.5) within group (order by o.price))::numeric as p
    from public.ext_price_observations o
    where auth.uid() is not null and o.product_key = p_key
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
revoke all on function public.ext_price_history(text, int, int) from public, anon, authenticated;
grant execute on function public.ext_price_history(text, int, int) to authenticated;
