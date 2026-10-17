-- Uninstall feedback: an anonymous page on the website sends a rating, optional reasons and optional text.
-- Anonymous = no account, no email, no cookie. The only identifier is a salted hash of the caller's IP, kept just to rate-limit and never returned.
-- Writes go through ext_submit_feedback() only; the table itself is closed to anon and signed-in users (service role reads it from the dashboard).
create table if not exists public.ext_feedback (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  rating     smallint not null check (rating between 1 and 5),
  reasons    text[] not null default '{}' check (cardinality(reasons) <= 10),
  message    text check (message is null or char_length(message) <= 2000),
  version    text check (version is null or version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'),
  ip_hash    text
);
create index if not exists ext_feedback_ip_time on public.ext_feedback (ip_hash, created_at desc);
create index if not exists ext_feedback_time on public.ext_feedback (created_at desc);
comment on table public.ext_feedback is 'HAULS ext: anonymous uninstall feedback. Insert only through ext_submit_feedback; read with the service role.';
alter table public.ext_feedback enable row level security;
revoke all on public.ext_feedback from public, anon, authenticated; -- no policies: RLS denies everything else

create or replace function public.ext_submit_feedback(p_rating int, p_reasons text[] default '{}', p_message text default null, p_version text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  allowed constant text[] := array['missing_feature','prices_wrong','too_slow','confusing','permissions','found_better','privacy','bugs','not_needed','other'];
  hdrs json; ip text; h text; clean text[]; msg text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then return false; end if;
  -- reasons: only the known list, no duplicates, at most 10
  select coalesce(array_agg(distinct r order by r), '{}') into clean from unnest(coalesce(p_reasons, '{}')) as r where r = any (allowed);
  -- message: control characters out, trimmed, empty means none, hard cap
  msg := nullif(btrim(regexp_replace(coalesce(p_message, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g')), '');
  if msg is not null and char_length(msg) > 2000 then return false; end if;
  if p_version is not null and p_version !~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$' then p_version := null; end if;
  -- who is calling (as far as rate limiting goes): first address of x-forwarded-for, salted and hashed
  begin hdrs := nullif(current_setting('request.headers', true), '')::json; exception when others then hdrs := null; end;
  ip := btrim(split_part(coalesce(hdrs ->> 'x-forwarded-for', hdrs ->> 'cf-connecting-ip', ''), ',', 1));
  h := case when ip = '' then null else encode(sha256(convert_to('hauls-feedback|' || ip, 'utf8')), 'hex') end;
  -- limits: 5 per caller per hour, 3000 per day overall (storage stays bounded even under abuse)
  if h is not null and (select count(*) from public.ext_feedback where ip_hash = h and created_at > now() - interval '1 hour') >= 5 then return false; end if;
  if (select count(*) from public.ext_feedback where created_at > now() - interval '1 day') >= 3000 then return false; end if;
  insert into public.ext_feedback (rating, reasons, message, version, ip_hash) values (p_rating::smallint, clean, msg, p_version, h);
  return true;
end $$;
comment on function public.ext_submit_feedback(int, text[], text, text) is 'HAULS ext: validated anonymous feedback insert (known reasons only, 2000 chars, 5/hour per caller, 3000/day total). Returns false when refused.';
revoke all on function public.ext_submit_feedback(int, text[], text, text) from public;
grant execute on function public.ext_submit_feedback(int, text[], text, text) to anon, authenticated;
