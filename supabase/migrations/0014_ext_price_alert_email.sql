-- Price-drop email, sent by the SERVER so the email provider's key never ships inside the extension.
-- Opt-in per person (ext_profiles.email_alerts, off by default). The mail goes ONLY to the account's own email (read here from ext_profiles, never taken from the client),
-- with a fixed template, at most one mail per product per 24 h and 10 per day per person.
-- ONE-TIME SETUP (SQL editor, as the project owner):  select vault.create_secret('<your Resend API key>', 'resend_api_key');
-- Sending address: set  insert into ext_remote_config(key, value) values ('email', '{"email_from":"HAULS <alerts@your-verified-domain>"}') on conflict (key) do update set value = excluded.value;
-- Without a verified domain Resend only delivers to the Resend account owner's own address (fine for a first test).
alter table public.ext_profiles add column if not exists email_alerts boolean not null default false;
grant update (email_alerts) on public.ext_profiles to authenticated;

create table if not exists public.ext_alert_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_key text not null check (length(product_key) <= 200),
  sent_at timestamptz not null default now()
);
create index if not exists ext_alert_log_user_time on public.ext_alert_log (user_id, sent_at desc);
alter table public.ext_alert_log enable row level security;
revoke all on public.ext_alert_log from public, anon, authenticated; -- only the function below writes it; no policies

create or replace function public.ext_send_price_alert(p_key text, p_title text, p_price numeric, p_target numeric, p_url text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); to_addr text; wants boolean; secret text; sender text; title text; link text; html text; price_txt text; target_txt text;
  esc constant text[] := array['&','&amp;','<','&lt;','>','&gt;','"','&quot;'];
begin
  if uid is null then return 'not-signed-in'; end if;
  select email, email_alerts into to_addr, wants from public.ext_profiles where id = uid;
  if to_addr is null or not coalesce(wants, false) then return 'off'; end if;
  if p_key is null or length(p_key) > 200 or p_price is null or p_target is null or p_price <= 0 or p_target <= 0 or p_price > p_target * 1.001 or p_price > 10000000 then return 'invalid'; end if;
  if (select count(*) from public.ext_alert_log where user_id = uid and product_key = p_key and sent_at > now() - interval '24 hours') >= 1 then return 'rate-limited'; end if;
  if (select count(*) from public.ext_alert_log where user_id = uid and sent_at > now() - interval '24 hours') >= 10 then return 'rate-limited'; end if;
  begin select decrypted_secret into secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1; exception when others then secret := null; end;
  if secret is null or secret = '' then return 'not-configured'; end if;
  begin select value ->> 'email_from' into sender from public.ext_remote_config where key = 'email'; exception when others then sender := null; end;
  sender := coalesce(nullif(sender, ''), 'HAULS <onboarding@resend.dev>');
  title := left(regexp_replace(coalesce(p_title, p_key), '[\x01-\x1f\x7f]', '', 'g'), 160);
  for i in 1..array_length(esc, 1) by 2 loop title := replace(title, esc[i], esc[i + 1]); end loop;
  link := case when p_url ~ '^https://([a-z0-9-]+\.)*(amazon\.in|flipkart\.com|myntra\.com|reliancedigital\.in|tatacliq\.com|croma\.com|jiomart\.com)(/|$)' and length(p_url) <= 500 then p_url else null end;
  price_txt := '₹' || to_char(p_price, 'FM99,99,99,999'); target_txt := '₹' || to_char(p_target, 'FM99,99,99,999');
  html := '<div style="font-family:system-ui,sans-serif;max-width:480px"><h2 style="margin:0 0 8px">Price drop on your watchlist</h2><p style="margin:0 0 12px"><b>' || title || '</b></p><p style="font-size:22px;margin:0 0 6px"><b>' || price_txt || '</b></p><p style="margin:0 0 16px;color:#555">Your price alert was ' || target_txt || '.</p>'
    || case when link is not null then '<p><a href="' || link || '" style="background:#131316;color:#fff;padding:10px 18px;border-radius:99px;text-decoration:none">Open the product</a></p>' else '' end
    || '<p style="font-size:12px;color:#777;margin-top:24px">You get this because you turned on email alerts in HAULS. Turn them off in the HAULS account menu. Check the store for the final price, offers and seller before you buy.</p></div>';
  perform net.http_post(url := 'https://api.resend.com/emails', headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', sender, 'to', jsonb_build_array(to_addr), 'subject', 'Price drop: ' || price_txt || ' (alert ' || target_txt || ')', 'html', html));
  insert into public.ext_alert_log (user_id, product_key) values (uid, p_key);
  return 'queued';
end $$;
comment on function public.ext_send_price_alert(text, text, numeric, numeric, text) is 'HAULS ext: opt-in price-drop email to the caller''s own address via Resend (key in Vault). 1 per product per 24 h, 10 per day.';
revoke all on function public.ext_send_price_alert(text, text, numeric, numeric, text) from public, anon;
grant execute on function public.ext_send_price_alert(text, text, numeric, numeric, text) to authenticated;
