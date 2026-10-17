# HAULS extension: Supabase setup

The project is shared with the website (`public.waitlist`, `public.keepalive`). Everything here is prefixed `ext_` and never alters those tables.

## 1. Run the migrations (in order)
Supabase dashboard > SQL Editor > New query. Paste and run each file, one at a time:
1. `supabase/migrations/0001_ext_core.sql`
2. `supabase/migrations/0002_ext_functions.sql`
3. `supabase/migrations/0003_ext_rls.sql`
4. `supabase/migrations/0004_ext_hardening.sql`, then `0005_ext_review_fixes.sql` (run 0004: phone column, plan watchlist caps, 500 observations/user/day, `p_min_reporters`, `ext_remote_config`, `ext_export_my_data`)

They are idempotent; re-running is safe, but do not re-run 0002 after 0004 (it would restore the old history/upsert functions).

Note: `ext_profiles.phone` is optional and user-typed (unverified); Google does not provide it.
Plan caps: free 20 / pro 200 / max unlimited watchlist items. Change a plan with the service role only (SQL editor).

## 2. Enable Google sign-in
1. Google Cloud Console > APIs & Services > Credentials > Create credentials > OAuth client ID > type **Web application**.
2. Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
3. Copy the Client ID and Client secret into Supabase > Authentication > Providers > Google, enable it, save.

## 3. Allow the extension redirect
Supabase > Authentication > URL Configuration > Redirect URLs > add:
`https://<EXTENSION_ID>.chromiumapp.org/`
(replace `<EXTENSION_ID>` once the extension id is known).

## 4. Anon key
Supabase > Project Settings > API > copy the `anon` public key into `.env`:
`SUPABASE_ANON_KEY=...`

## 5. Verify
`npm run test:integration` (creates and deletes two throwaway users; prints PASS/FAIL only).


### 0006 (security review fixes)
Run `0006_ext_security_review.sql` after 0005: per-user median aggregation, server-side clamp of the reporter threshold, `ext_forget_my_observations()`, erase also removes your extension waitlist row, https-only watchlist links, richer data export.
