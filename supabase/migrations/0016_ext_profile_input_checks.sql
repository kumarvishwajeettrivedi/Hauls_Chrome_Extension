-- HAULS: user-typed profile fields (name, phone) are checked by the database itself, not only by the extension, so a hand-made request
-- cannot store anything else. Idempotent. (Queries are parameterised by PostgREST, so this is about stored content, not SQL injection.)
-- Old values that break the new rule are cleared first (phone is optional and unverified), otherwise those users could not update their profile.
update public.ext_profiles set phone = null where phone is not null and phone !~ '^\+91[6-9][0-9]{9}$';
update public.ext_profiles set name = left(regexp_replace(name, '[\x01-\x1f\x7f<>]', '', 'g'), 80) where name is not null and (char_length(name) > 80 or name ~ '[\x01-\x1f\x7f<>]');
alter table public.ext_profiles drop constraint if exists ext_profiles_phone_check;
alter table public.ext_profiles add constraint ext_profiles_phone_check check (phone is null or phone ~ '^\+91[6-9][0-9]{9}$');
alter table public.ext_profiles drop constraint if exists ext_profiles_name_check;
alter table public.ext_profiles add constraint ext_profiles_name_check check (name is null or (char_length(name) <= 80 and name !~ '[\x01-\x1f\x7f<>]'));
