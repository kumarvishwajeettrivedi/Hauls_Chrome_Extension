# HAULS security and privacy review (independent, read-only)

Date: 2026-10-17. Scope: extension/ (manifest, background, auth, sync, guard, content, grocery, lib, shopify, reviews, options), scripts/, supabase/migrations 0001-0004, docs. No code was changed. Claims below were checked by reading the code; items marked VERIFIED were also run in node. Server behaviour is inferred from the SQL (no live project access, no anon key is set in config.js yet).

Severity scale: critical / high / medium / low / info. No critical findings.

## Ranked findings

### H1 (high) Crowd price data can be poisoned and back-dated by any signed-in user
- Where: supabase/migrations/0003_ext_rls.sql:12 (`grant insert on ext_price_observations to authenticated`) and :34-37 (insert policy only checks `user_id` and `contribute`); 0004_ext_hardening.sql:79-82 (500/day and 50/call caps live only inside the RPC); 0004:103-118 (`ext_price_history` medians are over rows, not users).
- Attack: the table is directly insertable through PostgREST (`POST /rest/v1/ext_price_observations` with the anon key plus the user's JWT). That path skips every RPC control: no 50-row or 500/day cap, and `observed_at` / `created_at` are client-settable (the RPC ignores the client timestamp; the table does not). One account can post thousands of distinct-price rows (unique key is user+key+day+price, so varying the decimals defeats it) for any product_key on any back-dated day. The global median `m` and each day's median are computed over rows, so one account dominates both. A day only needs 2 distinct reporters to be shown, so one honest user plus the attacker is enough. A second throwaway Google account removes even that need. Result: fake "lowest ever" or inflated history that flows into `mergeHistory` and the Buy/Wait verdict (analysis.js `buyWait`).
- Also: `product_key`, `site` and `src` are free text (only `src` and length-200 are constrained), so key spam and key/site mismatch are possible.
- Fix:
  1. `revoke insert on public.ext_price_observations from authenticated;` and drop `ext_obs_insert`. Insert only through `ext_upsert_observations` (SECURITY DEFINER, already server-timestamps).
  2. In the RPC enforce `product_key ~ '^[a-z0-9.]+:[A-Za-z0-9._:-]{1,150}$'`, `site` length, and prefix-equals-site.
  3. Make aggregation per-user first: take one price per (user, key, day) (the user's median), then the median across users. Compute the outlier band from a trimmed or windowed median of per-user values and require N>=3 reporters for the band.
  4. Add a per-user per-key-per-day cap (for example 3 rows) and a global per-user rate (rows/hour).

### H2 (high, privacy) "Delete my data" does not erase personal data and leaves a broken account
- Where: 0002_ext_functions.sql:63-72 (`ext_delete_my_data` deletes watchlist, observations, `ext_profiles` only); background.js:68; docs/google-signin-setup.md "What we store".
- Failure: the `auth.users` row (email, Google `full_name`, `picture`, `sub`, provider ids in `raw_user_meta_data` and `auth.identities`) is kept. The marketing row in `public.waitlist` created by `ext_join_waitlist` (0002:50-60) is kept. Because the profile trigger fires only on `auth.users` INSERT (0001:58-60), a user who deletes and signs in again has no `ext_profiles` row: `pullProfile` returns nothing, `PATCH ext_profiles` (contribute/phone/name) silently updates 0 rows and the UI still shows "saved", while the client treats a missing profile as contribute=true (background.js:10, sync.js:27, content.js:258) and the server RPC ignores uploads (`coalesce(...,false)`, 0004:78). That is consent state that cannot be changed. This does not meet DPDP s.12 / GDPR Art.17 erasure.
- Fix: perform deletion in an Edge Function using the service role: remove waitlist rows by email, then `auth.admin.deleteUser(uid)`. All ext_* FKs already cascade (0001:12, 65, 90). Keep the RPC as the first step. If the account must survive, add `ext_ensure_profile()` (SECURITY DEFINER, insert on conflict do nothing) and call it from `afterSignIn`.

### H3 (high, privacy) Data sharing is opt-out, pre-ticked, and described inaccurately
- Where: 0001_ext_core.sql:17 (`contribute ... default true`); content.js:258 (checkbox checked unless profile says false); sync.js:27 and background.js:10 (missing profile means contribute); content.js:253 (notice text: "no title, no link, no identity"); docs/security.md "DPDP / privacy" row says "Contribution is opt-in" and "only watchlist + profile are stored"; content.js:327 + background.js:64 (waitlist).
- Issues:
  1. Every product page view with a price change becomes a row tied to `user_id` (0001:90). That is browsing history linked to a Google identity, collected by default. Pre-ticked or default-on consent is not valid under DPDP s.6 or GDPR Art.7 (not affirmative, not specific).
  2. "No identity" is false at rest. It is only true for readers of `ext_price_history`. The notice must say "linked to your account, deletable, shown to others only as daily aggregates".
  3. Turning sharing off stops future uploads but does not delete past contributions. Provide "withdraw and delete my contributions".
  4. Clicking "Join" in the Traps tab sends the Google email to the website marketing waitlist with no disclosure at the button (the RPC trusts `auth.users.email`).
  5. No privacy policy link is shown in the extension UI (Google consent screen requires one, the panel does not link it).
  6. No retention limit: observations and soft-deleted watchlist rows (0004:47) are kept forever.
- Fix: default `contribute` to false for new accounts (migration: `alter column contribute set default false`), show an explicit unticked "Share anonymous prices" step at first sign-in with the accurate wording, add a delete-my-contributions path (delete observations where user_id=uid), label the waitlist button "Email me when the Android app launches (uses your Google email)", link the policy, add a retention job (for example null out `user_id` after 90 days or aggregate and purge). Correct docs/security.md.

### M1 (medium) ReDoS in `parseLd`, run in the service worker on fetched third-party HTML
- Where: lib.js:18 (`/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi`); caller background.js:83-85 (alarm "recheck": `fetch(it.url)` with no timeout, no size cap) and content.js:26.
- VERIFIED: 0.70 MB of repeated `<script type="application/ld+json">` takes 2.8 s, 1.4 MB takes 12.4 s, 2.8 MB takes 46.9 s (quadratic). 0.64 MB of `<script ` with no `>` takes 24 s.
- Attack: a store the user tracked (any Shopify-mode site, or any host an attacker can lure the user to track) serves a ~2 MB body when it sees the cookieless extension fetch. The worker thread is pinned every 2 hours, delaying the sync and price-alert alarms and message handling, and Chrome may kill the worker mid-write. On the page itself the same input freezes only the attacker's own tab.
- Fix: replace the regex with a linear scan (`indexOf("<script")`, find `>` once, check the type attribute, `indexOf("</script", end)`), cap input (`text.slice(0, 1_000_000)`), and fetch with `signal: AbortSignal.timeout(10000)`; read `Content-Length` or stream and abort above 2 MB. Add one regression test with the 1 MB payload above.

### M2 (medium) Tokens live in a storage area that content scripts can read; documented control is wrong
- Where: auth.js:27, 33 (`chrome.storage.local.set({ session })` with access and refresh tokens); content.js:273 (a content script reads `session` directly: VERIFIED by reading); no `setAccessLevel` call anywhere; docs/security.md "Token theft" row claims "not exposed to content scripts".
- Facts: `chrome.storage.local` defaults to TRUSTED_AND_UNTRUSTED_CONTEXTS, so every content script, including the one injected on any https site once Shopify mode is enabled, can read the refresh token. Page JS cannot (isolated world), so exploitation needs a content-script bug, but that bug class is exactly what the guard and shadow-root work is trying to contain, and a refresh token is long-lived.
- Fix: at worker start call `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` (Chrome 102+). Then route the few content-script reads (`range`, `knobY`, `pin`, `loc`, `overlay`, `waitlist`, `items`, `session` for the avatar letter) through messages (add a read-only `prefs` message, and use `account` for the initial). Update the doc.

### M3 (medium) k-anonymity threshold is caller-controlled
- Where: 0004_ext_hardening.sql:100 and :117 (`p_min_reporters int default 2`; `greatest(coalesce(p_min_reporters,2),1)`).
- Attack: any signed-in user calls `rpc/ext_price_history` with `p_min_reporters = 1` and reads per-day min/max/median for single-reporter days: one user's exact observation, with the day. Polling a product reveals when someone views it and at what price. Not an identity leak by itself, but it voids the "anonymous, 2+ reporters" promise.
- Fix: drop the parameter or clamp: `having count(distinct o.user_id) >= greatest(coalesce(p_min_reporters,3), 3)`. Also add per-user read rate limiting (the function is unmetered and does a full-key median scan each call).

### M4 (medium) Sign-out leaves another user's state behind (cross-account leakage, entitlement persistence)
- Where: auth.js:40 (only removes `session`, `histCache`, `lastPull`); background.js:26-27 (`account()` returns `profile` even when signed out); background.js:31-33 (`afterSignIn` uploads the whole local watchlist to the new account); sync.js:25-36 (stale `outbox` is flushed under the next user's id); `plan`, `profile`, `loc`, `pin`, `usage` remain.
- Failure: on a shared browser, user B inherits A's `plan` ("max" lifts the local limits), A's name/phone/contribute from `profile`, A's queued watch/obs operations (uploaded as B), and A's local watchlist (documented as intentional, but not disclosed on sign-in). Also the logout call is fire-and-forget (auth.js:39), so with no network the refresh token stays valid server-side.
- Fix: on signout also remove `profile`, `plan`, `outbox`, `lastSync`; tag outbox ops with `uid` and drop foreign ones; make `account()` return `profile` only when `session` exists; show "Local data stays in this browser" on sign-out; `await` the logout and retry later if it fails.

### M5 (medium) Panel leaks typed text to the host page; "gesture" check is a self-asserted flag
- Where: content.js:108 (stops only keydown/keyup/keypress); inputs at content.js:125, 263, 281-282 (trap price, phone, pincode, grocery query); guard.js:36 and PRIVILEGED (guard.js:3).
- Leak: `beforeinput` and `input` events are composed, so listeners on `document` or `window` of the hosting site receive them with `InputEvent.data` (the typed characters), even with a closed shadow root. Any third-party script on amazon.in / flipkart.com can harvest the phone number, name and search terms. The closed root hides the DOM, not these events.
- Gesture: the guard accepts any content-script message carrying `gesture: true`. VERIFIED: `validateMessage({type:"delete-data",gesture:true}, {id, tab})` returns ok. It only stops accidents, not a compromised content script. `waitlist`, `iplocate`, `geocode`, `reverse`, `grocery` are not privileged at all, so a compromised content script can send the account email to the waitlist or reveal the IP location without any click.
- Fix: in the `wrap` listener also `stopPropagation()` for `beforeinput`, `input`, `compositionstart/update/end`, `paste`, `copy`, `cut`; and check `e.isTrusted` in the panel click handlers that send privileged messages. Drop the `gesture` field and instead restrict `signin/signout/delete-data/export-data/contribute/profile-update/waitlist/iplocate` to extension pages (`!sender.tab`) by moving the account UI into the options page or a popup. Add `waitlist` and `iplocate` to PRIVILEGED at minimum.

### M6 (medium) Independent-store mode requests every https site and injects into all of them
- Where: manifest.json `optional_host_permissions: ["https://*/*"]`; background.js:97-103 (registers the content scripts on `https://*/*`); options.js:5; content.js:5.
- Impact: after one click the extension can read every https page the user visits (banking, mail) and the worker can `fetch` any https host with host permission (the recheck alarm fetches `it.url`, which came from page-controlled data). Today the code only looks for Shopify markers and then returns, but this is the largest blast radius if any parser bug appears, and a Chrome Web Store reviewer will ask for justification. The `shopify:host:handle` key namespacing does stop one site faking another site's keys, which is good.
- Fix: request the specific origin when the user clicks on that store (`chrome.permissions.request({origins:[origin+"/*"]})`), register the content script per origin, and keep an allow-list in storage with a "remove store" action. Restrict the recheck fetch to origins currently granted.

### L1 (low) Location handling
- content.js:310-317: `navigator.geolocation` in a content script prompts for the host page's origin ("amazon.in wants your location"), and a "Allow" is stored for that site, so the site's own scripts then get location. Use a lookup by pincode only, or run geolocation in an extension page.
- content.js:291, 307: precise `lat/lon` and `pin` persist in `chrome.storage.local` (readable by content scripts, see M2) and are not cleared by `delete-data`/`signout` (auth.js:40, background.js:68). Cache entries `cache:grocery` keep the query and pincode after TTL (cache.js only drops expired entries on read).
- grocery.js:128, 120, 132: user IP goes to ipwho.is, pincode and precise coordinates go to nominatim.openstreetmap.org (also Blinkit receives lat/lon with credentials:include, grocery.js:80-82). The UI comment says "disclosed in the UI"; confirm the notice and the privacy policy list these processors. Nominatim policy also expects a contact in the User-Agent/Referer.

### L2 (low) Build and key hygiene
- scripts/build-config.js:5-7 takes `SUPABASE_ANON_KEY` as-is. If the service-role JWT is pasted in that slot, nothing stops it: scripts/package.sh:11 greps for the literal text `service_role`, but a service-role JWT is base64, so the text never appears. tests/unit/security.test.js "JWT-like" check (`eyJ...`) will in turn fail as soon as the legitimate anon JWT is placed in config.js, which invites someone to whitelist it. Fix: in build-config decode the JWT payload and require `role === "anon"` (or the `sb_publishable_` prefix) and `ref` equal to the URL's project; make the test assert the same instead of banning `eyJ`.
- Currently safe: extension/ contains no service-role, Resend or other secret (grep over extension/ found none; config.js has an empty anon key). `.env` (mode 600) holds the service-role and Resend keys, is git-ignored, and the repo has no commits yet. `keys/hauls-dev.pem` (extension signing key) sits inside the tree; it is git-ignored, but move it outside the repo.
- Supabase Auth settings must be verified live (not in code): Redirect URLs allow-list must hold exactly the one chromiumapp.org URL (no wildcard); email signup is only "recommended" off (docs step 7). If it stays on, anyone can mint a JWT with an unverified email, and `ext_join_waitlist` (0002:52) would add arbitrary addresses to the marketing list. Remove the dev extension ID from the allow-list once the Web Store ID is final.

### L3 (low) Server-side input validation and untrusted server data
- 0001:63-79: `ext_watchlist` has no constraints on `title`, `url`, `image`, `site` length or scheme, or on `target_price` (negative/huge); `ext_profiles.name` has no length limit (client limit 80 only). A direct PostgREST call can store megabytes per row.
- 0004:47: rows with `deleted_at` set skip the plan cap, so unlimited soft-deleted rows can be inserted (storage abuse), and soft-deleted rows are never purged.
- Client trusts server rows: sync.js:17 copies `row.url` / `row.image` unvalidated into local items; content.js:333 uses `a.href = it.url` (a `javascript:` URL clicked in the panel would run in the host page's origin) and content.js:332 `img.src = it.image` (arbitrary host, leaks IP and origin referrer). Only the user's own rows reach them, so this is self-inflicted unless an account is hijacked, but validate https and set `img.referrerPolicy = "no-referrer"`.
- Add table CHECKs: `url ~ '^https://'`, `char_length(title)<=500`, `char_length(url)<=2000`, `target_price between 0 and 1e7`, and `check (deleted_at is null or true)` counted in a separate hard cap.
- lib.js:80: Myntra search link is not URL-encoded (`q.replace(/\s+/g,"-")`), so a title with `/`, `?`, `#` shapes the path (VERIFIED: `https://www.myntra.com/shoes-x/../../?a=b#c`). Host is fixed so there is no open redirect; encode anyway.
- background.js:132 SW does not verify that `m.p.url`/`m.p.key` match `sender.tab.url` host; a compromised content script could pose as another site's product. Add `new URL(sender.tab.url).hostname` vs `new URL(m.p.url).hostname` (and the key prefix).

### L4 (low) Export is not complete
- 0004:144-153: `ext_export_my_data` returns `observation_count` only. Subject-access/portability requests normally cover the rows themselves. The function is SECURITY DEFINER, so include `jsonb_agg` of the caller's own observations (key, site, price, mrp, observed_at).

### Info
- docs/security.md is stale/inaccurate: CSP "known gap" is already fixed in manifest.json; "opt-in" (see H3); "only watchlist + profile stored" (observations are too); "no `<all_urls>`" is true but `optional_host_permissions` is `https://*/*` (M6).
- Client plan/lookup quotas (analysis.js `useLookup`, `LIMITS`) are local only; the server only enforces the watchlist cap. Fine for UX, not a security boundary.
- Shopify and reviews parsing: no prototype pollution found (no key-based assignment from parsed JSON); `JSON.parse` depth errors are caught; `urgencySignals` caps input at 20 KB; `rank` builds a RegExp only from `\W+`-split words, so no injection. reviews.js `fetchMoreReviews` is same-origin and stops on the first block.
- manifest `browser_specific_settings.gecko.id` is a placeholder (`hauls@example.local`); manifest `key` must be removed for the Web Store upload (package.sh already notes it).

## What is already done well
- Message guard (guard.js): sender.id check, own-property type allow-list (no `__proto__`/`constructor` hits, tested), per-field schema, unknown keys rejected, 20 KB cap, plain-object check, https-only URLs, bounded numbers.
- No `externally_connectable`, no `web_accessible_resources`, no `onMessageExternal`; strict extension-page CSP (`script-src 'self'; object-src 'self'; base-uri 'none'`); no remote code, no eval; innerHTML limited to static SVG or numeric-built paths and scanned by a test; scraped text always goes through `textContent`/`sanitizeText`.
- OAuth: PKCE with S256, 512-bit verifier, `launchWebAuthFlow` (no tab for page JS to observe), pinned extension ID via `manifest.key`, code bound to the verifier so a stray or replayed code is useless (login CSRF handled by PKCE), only the anon key ships, provider tokens from the Google leg are not stored, refresh is single-flight, 401 retried once, minimal profile fields extracted (id, email, name, avatar).
- Database: RLS on all three tables; table privileges reset then re-granted minimally; column-level UPDATE grant (name, contribute, phone) plus guard trigger protecting plan/id/email; all SECURITY DEFINER functions set `search_path = ''` and use schema-qualified names; function EXECUTE explicitly revoked from public/anon and granted to authenticated only; observations have no SELECT policy; new-user trigger never blocks sign-up; advisory lock for the plan cap; remote config is data-only, service-role write.
- Third-party fetches: fixed hosts, `credentials: "omit"` for recheck, timeouts and circuit breaker on stores, `encodeURIComponent` on all interpolated query values, cache size-capped.
- Content script: closed shadow root, key events kept inside the panel, no `eval`, no use of page-provided HTML, SPA navigation handled without injecting page script.
- Packaging: `package.sh` builds from extension/ only, excludes tests/self-check, scans for secret-like strings, refuses a packaged `.env`.

## Suggested fix order
1. H1 (revoke direct insert, per-user aggregation), H2 and H3 (deletion, consent) before any public launch.
2. M1 (parseLd), M2 (setAccessLevel), M3 (clamp reporters), M4 (sign-out cleanup), M5 (input events, privileged set).
3. M6 and L-items with the Web Store submission.
