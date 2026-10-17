-- Watchlist deletion: when a person deletes an item it is removed from THEIR account for good.
--  1) the moment it is soft-deleted, everything about the product is blanked (only the key and the deleted_at tombstone remain, so other devices of the same account learn about the deletion);
--  2) tombstones older than 24 hours are deleted for good. Purging runs by itself whenever that user's watchlist changes, and can be called directly (ext_purge_my_deleted_watchlist).
-- Rows are only ever visible to their owner (row-level security from 0003); nothing here widens that.
create index if not exists ext_watchlist_tombstones on public.ext_watchlist (user_id, deleted_at) where deleted_at is not null;

create or replace function public.ext_watchlist_blank_deleted() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
    new.title := null; new.url := null; new.image := null; new.site := null; new.target_price := null; new.last_price := null; new.notified_price := null; new.wish := false;
  end if;
  return new;
end $$;
drop trigger if exists ext_watchlist_blank on public.ext_watchlist;
create trigger ext_watchlist_blank before insert or update on public.ext_watchlist for each row execute function public.ext_watchlist_blank_deleted();

create or replace function public.ext_purge_my_deleted_watchlist() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  delete from public.ext_watchlist where user_id = auth.uid() and deleted_at is not null and deleted_at < now() - interval '24 hours';
  get diagnostics n = row_count; return n;
end $$;
comment on function public.ext_purge_my_deleted_watchlist() is 'HAULS ext: permanently removes the caller''s watchlist tombstones older than 24 hours.';
revoke all on function public.ext_purge_my_deleted_watchlist() from public, anon;
grant execute on function public.ext_purge_my_deleted_watchlist() to authenticated;

create or replace function public.ext_watchlist_purge_trigger() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    delete from public.ext_watchlist where user_id = auth.uid() and deleted_at is not null and deleted_at < now() - interval '24 hours';
  end if;
  return null;
end $$;
revoke all on function public.ext_watchlist_purge_trigger() from public, anon, authenticated;
drop trigger if exists ext_watchlist_purge on public.ext_watchlist;
create trigger ext_watchlist_purge after insert or update on public.ext_watchlist for each statement execute function public.ext_watchlist_purge_trigger();
