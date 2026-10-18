-- 0015: audit fixes. Idempotent (safe to re-run). Run in the Supabase SQL editor after 0014.
--  a) pg_net (0014 calls net.http_post)   b) sender row for the price-alert email   c) watchlist last-write-wins + server-controlled timestamps
--  d) price-alert email: serialised per person, only for a real watchlist alert   e) 'erase my data' also removes the alert log   f) purge strictly own rows

-- a) Supabase installs pg_net into schema "net". A failure here is only a warning; then enable it under Dashboard > Database > Extensions > pg_net.
do $$ begin create extension if not exists pg_net; exception when others then raise warning 'pg_net not enabled (%): enable it in Dashboard > Database > Extensions', sqlerrm; end $$;

-- b) Resend sender (hauls.in is verified). Same table as 0004.
insert into public.ext_remote_config (key, value) values ('email', '{"email_from":"HAULS <hello@hauls.in>"}'::jsonb)
on conflict (key) do update set value = excluded.value;

-- c) Watchlist: the server decides. client_at = when the device made the change (clamped to now), updated_at = server time (what other devices pull by).
alter table public.ext_watchlist add column if not exists client_at timestamptz;

-- Sorts before ext_watchlist_blank / _limit / _touch. Skipped for the table owner / service role (no caller identity) and for the nested fix-up update below.
create or replace function public.ext_watchlist_lww() returns trigger language plpgsql set search_path = '' as $$
declare inc timestamptz;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    new.updated_at := least(new.updated_at, now()); new.client_at := new.updated_at;      -- never in the future
    if new.deleted_at is not null then new.deleted_at := now(); end if;                    -- purge clock is the server's
    return new;
  end if;
  inc := case when new.updated_at is distinct from old.updated_at then least(new.updated_at, now()) else now() end; -- plain update = now
  if inc < coalesce(old.client_at, old.updated_at) then return null; end if;               -- stale write: keep the row as it is (a tombstone stays dead)
  new.client_at := inc;
  if new.deleted_at is not null then new.deleted_at := coalesce(old.deleted_at, now()); end if; -- already deleted: clock does not restart
  return new;
end $$;
revoke all on function public.ext_watchlist_lww() from public, anon, authenticated;
drop trigger if exists ext_watchlist_a_lww on public.ext_watchlist;
create trigger ext_watchlist_a_lww before insert or update on public.ext_watchlist for each row execute function public.ext_watchlist_lww();

-- A new row keeps the client time for the upsert-conflict path above, so stamp it with the server time afterwards (other devices pull by updated_at).
create or replace function public.ext_watchlist_fix_ts() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.updated_at <> now() then update public.ext_watchlist set updated_at = now() where id = new.id; end if;
  return null;
end $$;
revoke all on function public.ext_watchlist_fix_ts() from public, anon, authenticated;
drop trigger if exists ext_watchlist_z_fixts on public.ext_watchlist;
create trigger ext_watchlist_z_fixts after insert on public.ext_watchlist for each row execute function public.ext_watchlist_fix_ts();

-- Blank on EVERY write of a deleted row (not only the first transition).
create or replace function public.ext_watchlist_blank_deleted() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.deleted_at is not null then
    new.title := null; new.url := null; new.image := null; new.site := null; new.target_price := null; new.last_price := null; new.notified_price := null; new.wish := false;
  end if;
  return new;
end $$;

-- f) Purge: the caller's own tombstones only (user_id = auth.uid()).
create or replace function public.ext_purge_my_deleted_watchlist() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  delete from public.ext_watchlist where user_id = auth.uid() and deleted_at is not null and deleted_at < now() - interval '24 hours';
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.ext_purge_my_deleted_watchlist() from public, anon;
grant execute on function public.ext_purge_my_deleted_watchlist() to authenticated;

-- d) Price-alert email. p_target is ignored: the stored alert price counts. Needs a live watchlist item with an alert price >= p_price.
create or replace function public.ext_send_price_alert(p_key text, p_title text, p_price numeric, p_target numeric, p_url text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); to_addr text; wants boolean; secret text; sender text; title text; link text; html text; price_txt text; target_txt text; tgt numeric;
  esc constant text[] := array['&','&amp;','<','&lt;','>','&gt;','"','&quot;'];
begin
  if uid is null then return 'not-signed-in'; end if;
  select email, email_alerts into to_addr, wants from public.ext_profiles where id = uid;
  if to_addr is null or not coalesce(wants, false) then return 'off'; end if;
  if p_key is null or length(p_key) > 200 or p_price is null or p_price <= 0 or p_price > 10000000 then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));                                       -- one call per person at a time: the counts below cannot be raced
  select target_price into tgt from public.ext_watchlist where user_id = uid and product_key = p_key and deleted_at is null;
  if tgt is null or tgt <= 0 or p_price > tgt then return 'invalid'; end if;
  if (select count(*) from public.ext_alert_log where user_id = uid and product_key = p_key and sent_at > now() - interval '24 hours') >= 1 then return 'rate-limited'; end if;
  if (select count(*) from public.ext_alert_log where user_id = uid and sent_at > now() - interval '24 hours') >= 10 then return 'rate-limited'; end if;
  begin select decrypted_secret into secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1; exception when others then secret := null; end;
  if secret is null or secret = '' then return 'not-configured'; end if;
  begin select value ->> 'email_from' into sender from public.ext_remote_config where key = 'email'; exception when others then sender := null; end;
  if sender is null or sender = '' then return 'not-configured'; end if;                      -- never fall back to Resend's sandbox sender (it only reaches the account owner)
  title := left(regexp_replace(coalesce(p_title, p_key), '[\x01-\x1f\x7f]', '', 'g'), 160);
  for i in 1..array_length(esc, 1) by 2 loop title := replace(title, esc[i], esc[i + 1]); end loop;
  link := case when p_url ~ '^https://([a-z0-9-]+\.)*(amazon\.in|flipkart\.com|myntra\.com|reliancedigital\.in|tatacliq\.com|croma\.com|jiomart\.com)(/|$)' and length(p_url) <= 500 then p_url else null end;
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
revoke all on function public.ext_send_price_alert(text, text, numeric, numeric, text) from public, anon;
grant execute on function public.ext_send_price_alert(text, text, numeric, numeric, text) to authenticated;

-- e) Erase / export include the alert log.
create or replace function public.ext_delete_my_data() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); em text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select email into em from auth.users where id = uid;
  delete from public.ext_price_observations where user_id = uid;
  delete from public.ext_chart_series where user_id = uid;
  delete from public.ext_watchlist where user_id = uid;
  delete from public.ext_alert_log where user_id = uid;
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
    'alerts_sent', coalesce((select jsonb_agg(jsonb_build_object('product_key', a.product_key, 'sent_at', a.sent_at) order by a.sent_at desc) from public.ext_alert_log a where a.user_id = uid), '[]'::jsonb),
    'observation_count', (select count(*) from public.ext_price_observations o where o.user_id = uid),
    'observations', coalesce((select jsonb_agg(jsonb_build_object('product_key', x.product_key, 'site', x.site, 'price', x.price, 'day', x.observed_day) order by x.observed_day desc)
                              from (select * from public.ext_price_observations where user_id = uid order by observed_day desc limit 5000) x), '[]'::jsonb),
    'charts', coalesce((select jsonb_agg(jsonb_build_object('product_key', c.product_key, 'range_days', c.range_days, 'points', jsonb_array_length(c.series), 'captured_at', c.captured_at)) from public.ext_chart_series c where c.user_id = uid), '[]'::jsonb));
end $$;
revoke all on function public.ext_delete_my_data(), public.ext_export_my_data() from public, anon, authenticated;
grant execute on function public.ext_delete_my_data(), public.ext_export_my_data() to authenticated;
