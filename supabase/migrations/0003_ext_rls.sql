-- HAULS extension RLS + grants. Run after 0002. Idempotent.
alter table public.ext_profiles          enable row level security;
alter table public.ext_watchlist         enable row level security;
alter table public.ext_price_observations enable row level security;

-- Supabase default privileges hand out ALL; reset, then grant minimum.
revoke all on public.ext_profiles, public.ext_watchlist, public.ext_price_observations from public, anon, authenticated;
revoke all on sequence public.ext_price_observations_id_seq from public, anon, authenticated;
grant select on public.ext_profiles to authenticated;
grant update (name, contribute) on public.ext_profiles to authenticated;
grant select, insert, update, delete on public.ext_watchlist to authenticated;
grant insert on public.ext_price_observations to authenticated;
grant usage on sequence public.ext_price_observations_id_seq to authenticated;

-- profiles: read own, update own (columns limited by grant + guard trigger).
drop policy if exists ext_profiles_select on public.ext_profiles;
create policy ext_profiles_select on public.ext_profiles for select to authenticated using (id = auth.uid());
drop policy if exists ext_profiles_update on public.ext_profiles;
create policy ext_profiles_update on public.ext_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- watchlist: full own-row CRUD.
drop policy if exists ext_watchlist_select on public.ext_watchlist;
create policy ext_watchlist_select on public.ext_watchlist for select to authenticated using (user_id = auth.uid());
drop policy if exists ext_watchlist_insert on public.ext_watchlist;
create policy ext_watchlist_insert on public.ext_watchlist for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ext_watchlist_update on public.ext_watchlist;
create policy ext_watchlist_update on public.ext_watchlist for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists ext_watchlist_delete on public.ext_watchlist;
create policy ext_watchlist_delete on public.ext_watchlist for delete to authenticated using (user_id = auth.uid());

-- observations: insert own only (and only if contributing); deliberately NO select policy.
drop policy if exists ext_obs_insert on public.ext_price_observations;
create policy ext_obs_insert on public.ext_price_observations for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.ext_profiles p where p.id = auth.uid() and p.contribute));
