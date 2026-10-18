# HAULS extension: Supabase setup

The project is shared with the website (`public.waitlist`, `public.keepalive`). Everything here is prefixed `ext_` and never alters those tables.

## 1. Run the migrations (in order)
Supabase dashboard > SQL Editor > New query. Paste and run each file, one at a time, in this order (a fresh project needs all 18; an existing one only the files it has not run yet):

| # | File | What it does |
|---|------|--------------|
| 1 | `0001_ext_core.sql` | tables: profiles, watchlist, price observations, remote config; new-user trigger |
| 2 | `0002_ext_functions.sql` | first RPCs (observations upsert, price history) |
| 3 | `0003_ext_rls.sql` | row-level security: every person sees only their own rows |
| 4 | `0004_ext_hardening.sql` | phone column, plan watchlist caps (free 20 / pro 200 / max unlimited), 500 observations/user/day, `p_min_reporters`, `ext_remote_config`, `ext_export_my_data` |
| 5 | `0005_ext_review_fixes.sql` | review fixes (observations only through the RPC) |
| 6 | `0006_ext_security_review.sql` | per-user median, server-side clamp of the reporter threshold, `ext_forget_my_observations()`, erase also removes the waitlist row, https-only links, richer export |
| 7 | `0007_ext_user_settings.sql` | per-account settings, written only through `ext_merge_settings` |
| 8 | `0008_ext_settings_places.sql` | saved delivery places inside the settings |
| 9 | `0009_ext_history_privacy.sql` | shared history needs more reporters per day |
| 10 | `0010_ext_chart_series.sql` | opt-in shared price-history series (`ext_submit_chart`, `ext_get_chart`) |
| 11 | `0011_ext_obs_src_bg.sql` | background (tracker) readings may be shared (`src = 'bg'`) |
| 12 | `0012_ext_feedback.sql` | anonymous uninstall feedback (`ext_submit_feedback`) |
| 13 | `0013_ext_watchlist_deletion.sql` | deleted items are blanked, tombstones purged after 24 h |
| 14 | `0014_ext_price_alert_email.sql` | server-side price-drop email (opt-in, own address only) |
| 15 | `0015_ext_hardening.sql` | pg_net, sender row, watchlist last-write-wins, serialised alert mail, strict own-rows purge |
| 16 | `0016_ext_profile_input_checks.sql` | name / phone CHECKs |
| 17 | `0017_ext_security_hardening.sql` | CHECKs on every user-writable text column, payload caps inside the RPCs, role timeouts, retention function, the final grants matrix |
| 18 | `0018_ext_security_followup.sql` | one hidden-character class, written once in `ext_hidden_re()` and used by every CHECK / function through small pure helpers (`ext_hidden`, `ext_valid_key`, `ext_valid_text`, `ext_clean_url`; executable by everyone because a CHECK runs as the writing role; ZWNJ / ZWJ allowed; file is pure ASCII; old rows cleaned first), tombstone clamp + hard ceiling of 500 rows per account + tombstone purge in `ext_purge_old_data`, price-alert mail only to a confirmed email, feedback serialised and bucketed per IPv6 /64, heart-only alert rule |

**Never replay an older migration. If you do, re-run 0017 and then 0018 after it.** Every file is safe to run twice on its own, but each one re-creates the functions it defines, so replaying (say) 0015 silently puts back the price-alert function from before 0017 and 0018 (no link or key checks, no confirmed-email rule). 0018 is the last word on every function and CHECK it touches; keep it last. Also do not re-run 0002 after 0004 (it would restore the old history / upsert functions).

Retention: `select public.ext_purge_old_data();` (service role only, for example from `pg_cron`) deletes alert-log rows older than 90 days, feedback older than 1 year and watchlist tombstones older than 24 hours. Without it, a deleted item is removed 24 hours later only when its owner next writes or signs in.

Note: `ext_profiles.phone` is optional and user-typed (unverified); Google does not provide it.
Plan caps: free 20 / pro 200 / max unlimited live watchlist items; every account is also capped at 500 rows in total, deleted ones included. Change a plan with the service role only (SQL editor).
Price-drop mail goes only to a CONFIRMED account email. Keep email sign-up off or with confirmation on in Authentication > Providers > Email.
Feedback `ip_hash` is a plain hash of the caller address (IPv6: its /64) with a fixed public salt, used only to rate-limit; it is not a secret-keyed hash.

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
