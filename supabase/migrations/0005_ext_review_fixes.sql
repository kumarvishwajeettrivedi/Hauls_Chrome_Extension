-- HAULS extension: fixes from the independent review. Idempotent. Run after 0004.
-- 1) Observations may ONLY be written through ext_upsert_observations (daily cap, validation, contribute flag).
--    The direct INSERT grant/policy from 0003 bypassed the 500/day cap, so it is removed.
revoke insert on public.ext_price_observations from authenticated;
revoke usage on sequence public.ext_price_observations_id_seq from authenticated;
drop policy if exists ext_obs_insert on public.ext_price_observations;

-- 2) Sharing prices with the community is OPT-IN (consent first). Existing rows keep their current choice.
alter table public.ext_profiles alter column contribute set default false;

-- 3) A user who erased their data and signs in again has no profile row (the trigger only fires on auth.users INSERT).
--    The extension calls this right after every sign-in; it is a no-op when the profile exists.
create or replace function public.ext_ensure_profile() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.ext_profiles (id, email, name, avatar_url)
  select u.id, u.email,
         coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
         coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
  from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
end $$;
comment on function public.ext_ensure_profile() is 'HAULS ext: create the caller''s ext_profiles row if missing (idempotent).';
revoke all on function public.ext_ensure_profile() from public, anon, authenticated;
grant execute on function public.ext_ensure_profile() to authenticated;
