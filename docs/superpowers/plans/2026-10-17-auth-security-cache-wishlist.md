# Auth, Security, Caching & Wishlist Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Open Google sign-in for any user (no test-user cap), harden the extension against breakage/abuse, add a layered browser cache, editable wishlist prices, 30D/90D/1Y history ranges, a bigger non-overflowing notch, and more platforms (Ajio dropped).

**Architecture:** Browser is the source of truth (L1 memory → L2 `chrome.storage.local` with TTL/LRU → L3 optional Supabase). Supabase enforces plan limits, rate caps and privacy server-side via RLS + SECURITY DEFINER RPCs. The service worker validates every inbound message; stores are wrapped in timeouts + circuit breakers; a remote *data-only* kill-switch can disable a broken store/site (never remote code).

**Tech Stack:** Chrome MV3 (Firefox-ready), plain JS (no bundler), Supabase (Postgres + Auth + RLS), Playwright (e2e), Node `assert` (unit). Cloudflare Worker only later (alert cron).

**Spec:** the user's 2026-10-17 request (summarised in Global Constraints); earlier plan `/Users/vishwajeet-coridors/Downloads/TRIVEDI/hauls/hauls-chrome-extension-plan.md` sections 5–9.

## Global Constraints

- Product name HAULS; repo `hauls-chrome-extension`, extension in `extension/`; `.env` at repo root, NEVER inside `extension/`. Service-role/Resend keys never in `extension/`.
- Supabase project shared with the website: only `ext_*` objects; never alter `public.waitlist` / `public.keepalive`.
- Extension ID pinned: `ohakecfhphdlbjblhlgcehdbbopecjcb`; OAuth redirect `https://ohakecfhphdlbjblhlgcehdbbopecjcb.chromiumapp.org/`.
- Sign-in = Google only, PKCE, scopes `openid email profile` (non-sensitive → no Google verification wall; app set to *In production*). Phone is NOT available from Google: optional, user-typed, unverified.
- Design: lavender/mint/yellow sticker style, brand blue `#0754F8` header, less text, details in sheets, touch targets ≥ 44px on mobile, nothing may overflow its box.
- No `<all_urls>` default; independent-store (Shopify) access stays opt-in via `optional_host_permissions`.
- Language rules: "observed", never "fake". All DOM text via `textContent`; no interpolated `innerHTML`.
- Tests: `npm run test:unit` and `npm run test:e2e` stay green; every task adds tests first.

## Review Focus

- A Google profile with no name/picture/email claim must still create a profile row and not break sign-in (Task 1 SQL test + Task 4 unit test).
- Prices ≥ ₹1,00,000, `9999+` deltas and long titles must not overflow the notch, chips or rows (Task 6 e2e overflow assertion).
- Editing a trap price to 0, negative, non-numeric, or above the current price must be rejected/clamped with a visible message (Task 6 unit + e2e).
- Expired/revoked session, offline, or Supabase 5xx must leave the whole UI usable from the browser cache with the outbox preserved (Task 2 + Task 4 tests).
- Two devices editing the same watchlist item (last-write-wins) and a site layout change that makes extraction return null must never crash or lose data (Task 4 + Task 3 tests).

---

### Task 1: Server-side hardening migration `0004`
**Files:** Create `supabase/migrations/0004_ext_hardening.sql`; Modify `supabase/README.md`, `tests/integration/run.mjs`.
**Interfaces — Produces:** column `ext_profiles.phone text null` (user-editable, `check (phone ~ '^\+?[0-9 ()-]{7,20}$')`); trigger `ext_watchlist_limit` (insert blocked when live rows ≥ plan cap: free 20, pro 200, max unlimited, counting `deleted_at is null`); `ext_upsert_observations` enforces ≤ 500 rows/user/UTC-day; RPC `ext_price_history(p_key, p_days, p_min_reporters int default 2)`; table `ext_remote_config(key text pk, value jsonb, updated_at)` readable by `authenticated` and `anon`, writable by service role only, seeded with `('flags','{"disabled_stores":[],"disabled_sites":[],"min_version":"0.1.0"}')`; RPC `ext_export_my_data() returns jsonb`; profile trigger tolerates missing metadata.
- [ ] Write failing PGlite/integration assertions for each bullet → run → implement → run green.

### Task 2: Cache layer + store resilience
**Files:** Create `extension/cache.js`, `tests/unit/cache.test.js`; Modify `extension/grocery.js`.
**Interfaces — Produces:** `cache.get(ns, key) -> value|undefined`, `cache.set(ns, key, value, ttlMs)`, `cache.wrap(ns, key, ttlMs, fn)` (stale-while-revalidate option), LRU cap per namespace (default 60 entries), `cache.clear(ns?)`; in `grocery.js`: per-store `AbortController` timeout 8 000 ms, circuit breaker (3 consecutive failures → store off 10 min, state persisted), result cache TTL 5 min keyed `q|pin`, pincode→loc cache 30 days, DMart store-id cache 24 h, `setDisabledStores(list)` fed by remote config.
- [ ] Tests: TTL expiry, LRU eviction, breaker opens/half-opens, timeout aborts, disabled store skipped, cached search served without network.

### Task 3: Platforms
**Files:** Modify `extension/lib.js` (SITES), `extension/manifest.json`, `extension/content.js` gating; Create `extension/sites-extra.js`, `tests/unit/sites.test.js`.
**Interfaces — Produces:** Ajio removed from content-script matches and `SITES` (Ajio stays only as a compare link); `EXTRA_SITES[domain] = { name, id(url) -> string|null, search, color }` for Croma, Reliance Digital, Tata CLiQ, Nykaa, Vijay Sales, Snapdeal, Meesho — each verified live for id pattern + JSON-LD price (skip + document any that block automation).
- [ ] Unit test per site: URL → id table (≥ 3 URLs each) and "no id on listing/home URLs".

### Task 4: Message guard, CSP, error boundaries
**Files:** Create `extension/guard.js`, `tests/unit/guard.test.js`, `tests/unit/security.test.js`; Modify `extension/background.js`, `extension/manifest.json`, `extension/content.js`.
**Interfaces — Produces:** `validateMessage(m, sender) -> {ok:true}|{ok:false,reason}` (sender.id === runtime.id; known `type` allowlist; field types/lengths; price 0 < p < 1e7; keys ≤ 200 chars; account/signin/delete messages only from extension pages or panel with `userGesture` flag); manifest `content_security_policy.extension_pages = "script-src 'self'; object-src 'self'; base-uri 'none'"`; content-script try/catch boundary that renders a "Something went wrong · Retry" card instead of a blank panel; remote-config fetch (daily, cached) feeding `setDisabledStores` and per-site switches.
- [ ] Security test scans `extension/*.js`: no `eval`, no `new Function`, `innerHTML` only with static strings or numeric-built SVG, no `http://` URLs, manifest has no `<all_urls>`/`unsafe-eval`, no secrets-looking strings.

### Task 5: Account profile + Google setup guide
**Files:** Create `docs/google-signin-setup.md`; Modify `extension/background.js` (profile fields), `extension/content.js` (account sheet: name, optional phone, export, delete).
**Interfaces — Consumes:** Task 1 `phone` column and `ext_export_my_data`. **Produces:** messages `profile-update {name?, phone?}`, `export-data`.
- [ ] Unit test: profile update validates phone pattern; export returns JSON containing watchlist + profile only.

### Task 6: UI — notch, stepper, wishlist edit, history range
**Files:** Modify `extension/content.js`, `extension/theme.js`, `extension/background.js` (`edit-target` message); Test `tests/e2e/` additions.
**Interfaces — Produces:** notch = `[logo 44px][vertical 3-dot grip]` row + delta pill below, width fits content (assert `scrollWidth <= clientWidth`); `stepper(value, {min, step, max}, onChange) -> HTMLElement` (− / input / +, step = 1% of price rounded to ₹1/5/10/50/100, long-press repeat, clamps and shows an inline message on invalid); Watchlist rows get an inline stepper + "Update" auto-save (debounced 600 ms) + remove; product tab trap box shows "Trap set at ₹X" with the stepper pre-filled and a Remove option; chart range control `30D | 90D | 1Y | All` (default 90D) slicing merged history; render ≤ 200 points (downsample by min/max bucket).
- [ ] e2e: edit a trap from Watchlist and from the product tab, reload, value persisted; invalid values rejected; range buttons change the x-axis label and point count; notch with ₹1,23,456 delta does not overflow.

### Task 7: Independent-stores options page
**Files:** Create `extension/options.html`, `extension/options.js`; Modify `extension/manifest.json` (`options_ui`), panel account sheet link.
**Interfaces — Produces:** page with "Enable independent stores (Shopify)" permission toggle (calls `chrome.permissions.request` on a user click) + status.
- [ ] e2e smoke: options page loads, button present (permission prompt itself is manual).

### Task 8: Review gate
- [ ] Fresh reviewer agents: (a) security review of whole extension → `docs/security.md`; (b) code review of the diff for gaps vs this plan; (c) full `npm run test:unit` + `npm run test:e2e`; fix every finding; re-run until green.
