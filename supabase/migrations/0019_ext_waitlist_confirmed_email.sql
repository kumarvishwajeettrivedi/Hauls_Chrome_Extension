-- 0019: the waitlist functions act only on a CONFIRMED account email (auth.users.email_confirmed_at is not null), like the alert mail in 0018.
-- Why: with email sign-up on, someone could register another person's address without confirming it, then add that address to the waitlist (mail to a stranger)
-- or erase that person's waitlist row. Google sign-in is unaffected (its emails are always confirmed). Idempotent. Run after 0018.
create or replace function public.ext_join_waitlist(p_source text default 'extension-android') returns boolean
language plpgsql security definer set search_path = '' as $$
declare em text;
begin
  select email into em from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if em is null then return false; end if;
  if exists (select 1 from public.waitlist where lower(email) = lower(em)) then return false; end if;
  insert into public.waitlist (email, source) values (em, case when p_source ~ '^extension-[a-z0-9-]{1,40}$' then p_source else 'extension-android' end);
  return true;
end $$;

-- As 0015 (erase everything of the caller), but the waitlist row is removed only when the caller's email is confirmed.
create or replace function public.ext_delete_my_data() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); em text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select email into em from auth.users where id = uid and email_confirmed_at is not null;
  delete from public.ext_price_observations where user_id = uid;
  delete from public.ext_chart_series where user_id = uid;
  delete from public.ext_watchlist where user_id = uid;
  delete from public.ext_alert_log where user_id = uid;
  delete from public.ext_user_settings where user_id = uid;
  delete from public.ext_profiles where id = uid;
  if em is not null then delete from public.waitlist where lower(email) = lower(em) and source like 'extension%'; end if;
end $$;
revoke all on function public.ext_join_waitlist(text), public.ext_delete_my_data() from public, anon, authenticated;
grant execute on function public.ext_join_waitlist(text), public.ext_delete_my_data() to authenticated;
