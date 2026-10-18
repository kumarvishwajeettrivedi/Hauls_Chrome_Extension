-- 0020: retention for old community price data. Idempotent (safe to re-run). Run in the Supabase SQL editor after 0019.
-- Run after 0019; never replay an older migration after it (re-run 0017, 0018, 0019, 0020 in order if you did).
-- ext_purge_old_data() keeps everything 0018 made it do (alert log 90 days, feedback 1 year, tombstones older than 24 h, service role only) and now ALSO deletes
-- ext_price_observations with observed_day older than 400 days and ext_chart_series with captured_at older than 400 days. The community history only reads 365 / 410 days
-- (chart rows 400), so nothing visible changes. Returns {alert_log, feedback, tombstones, observations, charts}. Only ext_* objects.
create index if not exists ext_obs_day_idx on public.ext_price_observations (observed_day);
create index if not exists ext_chart_captured_idx on public.ext_chart_series (captured_at);

create or replace function public.ext_purge_old_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; f int; t int; o int; c int;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then raise exception 'service role only' using errcode = '42501'; end if;
  delete from public.ext_alert_log where sent_at < now() - interval '90 days'; get diagnostics a = row_count;
  delete from public.ext_feedback where created_at < now() - interval '1 year'; get diagnostics f = row_count;
  delete from public.ext_watchlist where deleted_at is not null and deleted_at < now() - interval '24 hours'; get diagnostics t = row_count;
  delete from public.ext_price_observations where observed_day < (now() at time zone 'UTC')::date - 400; get diagnostics o = row_count;
  delete from public.ext_chart_series where captured_at < now() - interval '400 days'; get diagnostics c = row_count;
  return jsonb_build_object('alert_log', a, 'feedback', f, 'tombstones', t, 'observations', o, 'charts', c);
end $$;
comment on function public.ext_purge_old_data() is 'HAULS ext: retention. Deletes ext_alert_log rows older than 90 days, ext_feedback older than 1 year, watchlist tombstones older than 24 hours, price observations and chart series older than 400 days. service_role / owner only.';
revoke all on function public.ext_purge_old_data() from public, anon, authenticated;
grant execute on function public.ext_purge_old_data() to service_role;
