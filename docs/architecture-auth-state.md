# Auth, state & caching architecture (design only: no code yet)

Goal: a login that behaves like a professional app (stay signed in for weeks, settings follow your Google email on every device) with state that is **simple, self-healing and not tied to any website's layout**.

## 1. Principles (the "not too hard" rules)
1. **Storage IS the store.** One authoritative owner (the service worker). Everything is a small JSON "slice" in `chrome.storage.local` (or IndexedDB for secrets). The panel is a thin renderer: it asks via messages and re-renders on `chrome.storage.onChanged`. No state library, no UI-side copies.
2. **Every slice is `{ v, updatedAt, data }`** with a schema version and a tiny validator on read. Corrupt or unknown → reset *that slice* (keep a backup), never crash. Unknown fields are preserved (forward-compatible).
3. **Website changes never touch state.** Pages only produce validated `Observation` objects (`cleanProduct`). A broken extractor produces an "unreadable" event, not bad state. Selectors/flags are *data* (remote config), versioned.
4. **Local-first, server-second.** UI always works from local data; the server is backup + cross-device sync. Offline, 5xx, expired tokens never block the UI.
5. **Sync = per-record last-write-wins + tombstones**, settings = **per-key** last-write-wins (two devices changing different settings never clobber each other).

## 2. What is stored where, and for how long
| Class | Examples | Where | Lifetime / refresh | Cleared when |
|---|---|---|---|---|
| **A. Secrets** | access + refresh token | Extension-private **IndexedDB** (not readable by pages/content scripts) | access token 1 h (refreshed ~60 s early + alarm every 45 min); refresh token rotates on every use | sign-out, revoke, 90-day inactivity |
| **B. Identity** | name, email, avatar URL, plan, contribute flag | Supabase `ext_profiles` (truth) + cached copy in `storage.local` | re-read at sign-in and every 24 h | sign-out, account change |
| **C. User content** | watchlist, trap prices, wish flags | `storage.local` (truth for UI) ⇄ Supabase `ext_watchlist` | synced within seconds when online; tombstones purged server-side after 30 days | erase-my-data, account change |
| **D. Settings** | pin, history range, grocery stores on/off, share-prices opt-in, alert prefs | `storage.local` ⇄ Supabase **`ext_user_settings`** (one JSON doc, per-key timestamps) | synced at change + 15 min | erase-my-data |
| **D2. Device-only settings** | notch position, panel open state, theme | `storage.local` only (never synced) | forever | uninstall |
| **E. Price data** | your own history | `storage.local` (≤ 2 000 points/product, 400 days) | pruned monthly | erase-my-data |
| | community history | cache, **6 h**, stale-while-revalidate | auto | sign-out, product change |
| | outbox (unsent changes) | `storage.local` (≤ 500 ops) | until delivered or permanently rejected | sign-out (re-built from local data at next sign-in) |
| **F. Caches** | grocery search **5 min**; pincode→coords **30 d**; DMart store **24 h**; remote flags **24 h**; breaker state **10 min** | cache layer (L1 memory + L2 storage, LRU, ≤ 200 KB/value, ≤ 5 MB total) | TTL + LRU | events in §4 |

"Same email = same preferences": Supabase links Google identities by verified email, so every device signs into the **same user id**; C and D are keyed by that id. Nothing is keyed by device.

## 3. Login & session lifecycle
```
click "Continue with Google"  (user gesture)
 → service worker: PKCE verifier+challenge → launchWebAuthFlow(Supabase /authorize → Google → Supabase /callback)
 → redirect https://<extId>.chromiumapp.org/?code=…  → exchange code (PKCE) → session
 → store session in IndexedDB + { signedInAt, lastActiveAt } → ext_ensure_profile()
 → pull profile + settings + watchlist → merge (LWW) → flush outbox → storage.onChanged → UI updates
```
- **Stay signed in:** no timer logs you out while the extension is used. We keep `lastActiveAt` (touched on use, at most once/day). **Sliding inactivity window (default 90 days; 30 if you prefer)**: past it, the next start signs out softly. Server side Supabase refresh tokens don't expire; the paid time-box/inactivity settings aren't needed because we enforce this ourselves.
- **Refresh (single-flight, only in the service worker):** on demand before any API call if < 60 s left; plus a 45-minute alarm while signed in. Refresh tokens rotate; a lock guarantees one refresh at a time.
- **Failure handling (never log out for the wrong reason):** *network error / 5xx* → keep session, retry later, UI keeps working. *`invalid_grant` / revoked / reuse detected* → **soft sign-out**: keep local data, show "Sign in again", no data loss. *User taps Sign out* → revoke on server, wipe class A/B/outbox/user caches; **offer** "also clear this device" (default off).
- **Sensitive actions** (erase data, export, delete account) require a **recent sign-in (≤ 10 min)**; otherwise re-authenticate first (step-up).
- **Account-switch protection:** local data is tagged `ownerId`. Anonymous local data merges into the *first* account that signs in. If a *different* account signs in on a browser owned by someone else, we ask "Clear this browser's previous data?" (default yes) instead of merging two people's wishlists.

## 4. Cache-clearing events (one rule table, one function `invalidate(reason)`)
| Event | Clears |
|---|---|
| Sign-out | class A/B, outbox, community cache, user-scoped caches |
| Account switch | + local watchlist/settings (after confirm) |
| Pincode/location change | grocery results, location-bound caches |
| Remote flag / selector-version change | the affected store/site caches + parse results |
| Extension update with new schema | migrate slices (v→v+1); drop caches |
| Storage > 80 % of budget | LRU-evict caches (never class A–D) |
| Refresh invalid | class A only (soft sign-out) |
| User taps "Clear cache" | all of class F |
| Erase-my-data | everything server-linked + local copies |
| Inactivity window passed | class A/B + caches |

## 5. Server side (Supabase + Cloudflare Worker)
- Auth: Google only; email sign-up **off**; JWT expiry 1 h; refresh-token rotation **on** (reuse interval 10 s); redirect allow-list = extension URL (+ `http://localhost:3000/**` for web dev, + the Firefox URL later).
- New migration (planned): `ext_user_settings (user_id pk, doc jsonb, stamps jsonb, updated_at)`, `ext_profiles.last_seen_at`, RPC `ext_touch()` (≤ 1/day).
- Retention jobs (Worker cron): purge soft-deleted watchlist rows > 30 days; prune observations > 400 days; email-then-delete accounts inactive 24 months; account deletion endpoint (`auth.admin.deleteUser`).

## 6. Build order (each step: unit tests → headless e2e → review; browser tests one at a time)
S1 session policy (signedInAt/lastActiveAt, sliding window, 45-min refresh alarm, soft vs hard sign-out, network-vs-invalid_grant) · S2 `ownerId` + account-switch protection · S3 slice envelope `{v,updatedAt,data}` + validators + migration runner · S4 `invalidate(reason)` + budgets · S5 settings sync (`ext_user_settings`, per-key LWW) · S6 `storage.onChanged`-driven UI (remove ad-hoc refreshes) · S7 step-up auth for erase/export · S8 retention jobs + account-delete Worker.

## Open choices (defaults in bold)
Inactivity window **90 days** or 30? · Sign-out keeps local watchlist **(yes, with an optional "clear this device")** · Settings that sync: **pin, range, grocery stores, sharing opt-in, alert prefs** (not notch position).
