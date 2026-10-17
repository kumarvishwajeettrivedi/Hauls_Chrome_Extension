-- HAULS extension: fixes from the independent SECURITY review. Idempotent. Run after 0005.

-- 1) Community history: aggregate PER USER first (one account can no longer outvote others by posting many rows),
--    then take the median across users; the outlier baseline is the median of per-user values.
--    p_min_reporters is clamped server-side to >= 2 so a caller can never read a single user's prices.
create or replace function public.ext_price_history(p_key text, p_days int default 365, p_min_reporters int default 2)
returns table (day date, median_price numeric, min_price numeric, max_price numeric, reporters int)
language sql stable security definer set search_path = '' as $$
  with per_user as (
    select o.observed_day as d, o.user_id, (percentile_cont(0.5) within group (order by o.price))::numeric as p
    from public.ext_price_observations o
    where auth.uid() is not null and o.product_key = p_key
    group by o.observed_day, o.user_id
  ), med as (select percentile_cont(0.5) within group (order by p) as m from per_user)
  select u.d,
         (percentile_cont(0.5) within group (order by u.p))::numeric,
         min(u.p), max(u.p), count(*)::int
  from per_user u, med
  where u.d >= (now() at time zone 'UTC')::date - least(greatest(coalesce(p_days, 365), 1), 1500)
    and u.p between med.m * 0.4 and med.m * 2.5
  group by u.d
  having count(*) >= greatest(coalesce(p_min_reporters, 2), 2)
  order by u.d;
$$;

-- 2) Erase: also remove the caller's row from the shared website waitlist when it came from the extension.
create or replace function public.ext_delete_my_data() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); em text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select email into em from auth.users where id = uid;
  delete from public.ext_price_observations where user_id = uid;
  delete from public.ext_watchlist where user_id = uid;
  delete from public.ext_profiles where id = uid;
  if em is not null then delete from public.waitlist where lower(email) = lower(em) and source like 'extension%'; end if;
end $$;

-- 3) Turning sharing off should be able to take back what was already shared.
create or replace function public.ext_forget_my_observations() returns int
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from public.ext_price_observations where user_id = uid; get diagnostics n = row_count; return n;
end $$;
comment on function public.ext_forget_my_observations() is 'HAULS ext: delete every price the caller ever shared (used when sharing is switched off).';
revoke all on function public.ext_forget_my_observations() from public, anon, authenticated;
grant execute on function public.ext_forget_my_observations() to authenticated;

-- 4) Length / scheme limits on watchlist text (stops oversized rows and javascript: links being stored).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ext_watchlist_text_limits') then
    alter table public.ext_watchlist add constraint ext_watchlist_text_limits check (
      coalesce(length(title), 0) <= 500 and coalesce(length(site), 0) <= 60
      and (url is null or (length(url) <= 2000 and url ~* '^https://'))
      and (image is null or (length(image) <= 2000 and image ~* '^https://')));
  end if;
end $$;

-- 5) Data export (access right) includes the caller's OWN observation rows, not just a count.
create or replace function public.ext_export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.ext_profiles p where p.id = uid),
    'watchlist', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from public.ext_watchlist w where w.user_id = uid), '[]'::jsonb),
    'observation_count', (select count(*) from public.ext_price_observations o where o.user_id = uid),
    'observations', coalesce((select jsonb_agg(jsonb_build_object('product_key', x.product_key, 'site', x.site, 'price', x.price, 'day', x.observed_day) order by x.observed_day desc)
                              from (select * from public.ext_price_observations where user_id = uid order by observed_day desc limit 5000) x), '[]'::jsonb));
end $$;
revoke all on function public.ext_delete_my_data(), public.ext_export_my_data(), public.ext_price_history(text,int,int) from public, anon, authenticated;
grant execute on function public.ext_delete_my_data(), public.ext_export_my_data(), public.ext_price_history(text,int,int) to authenticated;
