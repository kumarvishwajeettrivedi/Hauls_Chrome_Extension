# Google sign-in setup (open to everyone, not a test list)

You do this once. About 15 minutes. Nothing here needs code changes.

**Your fixed values** (already in the code):
- Supabase project: `https://xesmxpwcmbimhngdufje.supabase.co`
- Supabase's Google callback (goes in Google): `https://xesmxpwcmbimhngdufje.supabase.co/auth/v1/callback`
- Extension redirect URL (goes in Supabase): `https://ohakecfhphdlbjblhlgcehdbbopecjcb.chromiumapp.org/`

## Step 0 — Run the database migrations
Supabase → SQL Editor → run, in order: `0001_ext_core.sql`, `0002_ext_functions.sql`, `0003_ext_rls.sql`, `0004_ext_hardening.sql`, `0005_ext_review_fixes.sql`, `0006_ext_security_review.sql` (from `supabase/migrations/`). Run each once. Do not re-run 0002 after 0004 (it would restore the old function versions).

## Step 1 — Google Cloud project
1. Go to https://console.cloud.google.com → project picker → **New project** → name it `HAULS`.
2. Open **Google Auth Platform** (older UI: *APIs & Services → OAuth consent screen*).

## Step 2 — Consent screen (Branding + Audience)
1. **User type: External** (this is what lets anyone with a Google account sign in).
2. App name `HAULS`, your support email, developer contact email.
3. **App domain** (use your domain): home page `https://YOURDOMAIN`, **privacy policy URL** and **terms URL** (both must be live pages on your domain; I can draft the text).
4. **Authorized domains**: add `YOURDOMAIN` (the bare domain). Google may ask you to verify it in Search Console. Do so if prompted.
5. Skip the app logo for now. Adding a logo triggers extra brand verification.

## Step 3 — Scopes (data access)
Add only these three (non-sensitive, so **no Google review is needed**):
`openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
They give us: name, email, profile picture URL. **Google does not provide phone numbers** through these scopes (the phone scope is restricted). The extension therefore has an *optional, user-typed* phone field instead.

## Step 4 — Publish (this removes the test-user cap)
Google Auth Platform → **Audience** → **Publish app** → status becomes **In production**.
Until you do this, only ≤100 listed test users can log in and their tokens expire after 7 days. With only the three non-sensitive scopes above, publishing needs no verification review.

## Step 5 — Create the OAuth client
1. **Clients → Create client** → Application type **Web application**, name `HAULS Supabase`.
2. **Authorized redirect URIs** → add exactly: `https://xesmxpwcmbimhngdufje.supabase.co/auth/v1/callback`
3. Create → copy the **Client ID** and **Client secret**.

## Step 6 — Turn on Google in Supabase
Supabase → **Authentication → Sign In / Providers → Google** → enable → paste Client ID and Client secret → Save.

## Step 7 — Tell Supabase about the extension
Supabase → **Authentication → URL Configuration**:
- **Site URL**: `https://YOURDOMAIN`
- **Redirect URLs** → add: `https://ohakecfhphdlbjblhlgcehdbbopecjcb.chromiumapp.org/`

(Recommended) **Authentication → Sign In / Providers → Email** → turn off *Enable email signup*. The extension only uses Google, and this closes a bot-signup door. Your website's waitlist does not use Supabase Auth, so it is unaffected.

## Step 8 — The one key to add to `.env`
Supabase → **Project Settings → API** → copy the **`anon` `public`** key and add to `.env`:
```
SUPABASE_ANON_KEY=<paste here>
```
- This key is *meant* to be public; Row Level Security protects the data.
- **Never** put the `service_role` key in the extension. It stays only in `.env` (git-ignored) for server use.
Then run: `npm run build:config` → it writes `extension/config.js` (public values only).

## Step 9 — Try it
1. Reload the extension (`chrome://extensions` → refresh on HAULS).
2. Open a product page → HAULS notch → account icon → **Continue with Google**.
3. Verify: Supabase → *Authentication → Users* shows you; *Table Editor → ext_profiles* has your row (name, email, avatar).
4. Run `node tests/integration/run.mjs` (tests the real database with throw-away users).

## What we store (and don't)
| Data | Stored | Why |
|---|---|---|
| Name, email, avatar URL (from Google) | `ext_profiles` | show your account, send alerts later |
| Phone | only if **you** type it, unverified | optional |
| Watchlist + trap prices | `ext_watchlist` | cross-device sync |
| Prices you saw (no title, link or identity visible to anyone) | `ext_price_observations`, only if "Share anonymous prices" is on | community history |
| Passwords | never (Google handles login) | — |
You can export or delete everything from the account sheet in the panel.
