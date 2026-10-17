# HAULS Chrome extension

Price history, buy-or-wait verdicts, trap alerts and grocery comparison for Indian shoppers. Browser-first (everything works offline from `chrome.storage`), optional Google sign-in syncs your watchlist through Supabase.

```
extension/            the unpacked extension (Load unpacked → this folder)
supabase/migrations/  SQL you run once in the Supabase SQL editor (0001 → 0009)
tests/{unit,integration,e2e}
scripts/              build-config, extension-key, package
docs/                 plans, security notes, google-signin-setup.md
.env                  server-side secrets (git-ignored; never inside extension/)
```
**Run it:** `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
**Test:** `npm install && npm run test:unit` (fast) · `npm run test:e2e` (real Chrome, live sites) · `npm run test:integration` (needs `SUPABASE_ANON_KEY`).
**Ship:** `npm run package` → `dist/hauls-extension-<version>.zip`.
**Sign-in:** follow `docs/google-signin-setup.md`.

## Setup
1. `cp .env.example .env` and fill in your Supabase URL, anon key and Google client id (never commit `.env`).
2. `npm install && npm run build:config` writes the git-ignored `extension/config.js`.
3. Run the SQL in `supabase/migrations/` in order, then follow `docs/google-signin-setup.md`.

## Publish (Chrome Web Store)
1. `npm run package` builds `dist/hauls-extension-<version>.zip` (no dev key, no tests, secret scan).
2. Upload it in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) ($5 one-time fee), fill the listing, add the privacy policy URL.
3. The store assigns its own extension ID: add `https://<store-id>.chromiumapp.org/` to Supabase redirect URLs and the Google OAuth client's redirect URIs.

