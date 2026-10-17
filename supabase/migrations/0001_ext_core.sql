-- HAULS extension core schema. Shared project: only ext_* objects; never touches public.waitlist / public.keepalive.
-- Idempotent. Run first.

-- Shared updated_at trigger function.
create or replace function public.ext_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
comment on function public.ext_touch_updated_at() is 'HAULS ext: sets updated_at on UPDATE.';

-- ---------- ext_profiles ----------
create table if not exists public.ext_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  avatar_url text,
  plan       text not null default 'free' check (plan in ('free','pro','max')),
  contribute boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.ext_profiles is 'HAULS ext: one row per auth user. plan is service-role/admin only.';
comment on column public.ext_profiles.contribute is 'If false, user price observations are never stored.';

drop trigger if exists ext_profiles_touch on public.ext_profiles;
create trigger ext_profiles_touch before update on public.ext_profiles
  for each row execute function public.ext_touch_updated_at();

-- Block plan/id/email changes by end users (JWT present and not service_role).
create or replace function public.ext_profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and coalesce(auth.role(),'') <> 'service_role'
     and (new.plan is distinct from old.plan or new.id is distinct from old.id
          or new.email is distinct from old.email) then
    raise exception 'plan, id and email cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
comment on function public.ext_profiles_guard() is 'HAULS ext: stops users self-upgrading plan or editing id/email.';

drop trigger if exists ext_profiles_guard on public.ext_profiles;
create trigger ext_profiles_guard before update on public.ext_profiles
  for each row execute function public.ext_profiles_guard();

-- Create profile on signup.
create or replace function public.ext_handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ext_profiles (id, email, name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'))
  on conflict (id) do nothing;
  return new;
end $$;
comment on function public.ext_handle_new_user() is 'HAULS ext: auth.users AFTER INSERT -> ext_profiles.';

drop trigger if exists ext_on_auth_user_created on auth.users;
create trigger ext_on_auth_user_created after insert on auth.users
  for each row execute function public.ext_handle_new_user();

-- ---------- ext_watchlist ----------
create table if not exists public.ext_watchlist (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_key    text not null check (length(product_key) <= 200),
  site           text,
  title          text,
  url            text,
  image          text,
  target_price   numeric,
  wish           boolean not null default false,
  last_price     numeric,
  notified_price numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (user_id, product_key)
);
comment on table public.ext_watchlist is 'HAULS ext: per-user tracked products / wishlist (soft delete via deleted_at).';
create index if not exists ext_watchlist_user_idx on public.ext_watchlist (user_id) where deleted_at is null;

drop trigger if exists ext_watchlist_touch on public.ext_watchlist;
create trigger ext_watchlist_touch before update on public.ext_watchlist
  for each row execute function public.ext_touch_updated_at();

-- ---------- ext_price_observations ----------
create table if not exists public.ext_price_observations (
  id           bigserial primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_key  text not null check (length(product_key) <= 200),
  site         text,
  price        numeric not null check (price > 0 and price < 10000000),
  mrp          numeric check (mrp is null or (mrp > 0 and mrp < 10000000)),
  observed_at  timestamptz not null default now(),
  observed_day date generated always as ((observed_at at time zone 'UTC')::date) stored,
  src          text check (src in ('jsonld','dom','meta')),
  created_at   timestamptz not null default now(),
  unique (user_id, product_key, observed_day, price)
);
comment on table public.ext_price_observations is 'HAULS ext: crowd-sourced prices. Write-only for users; read only via ext_price_history().';
create index if not exists ext_obs_key_day_idx on public.ext_price_observations (product_key, observed_day);
