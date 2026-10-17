# HAULS extension - security model

Tests: `node tests/unit/guard.test.js` (message guard), `node tests/unit/security.test.js` (static scan of `extension/*.js` + manifest).

| Threat | Mitigation | Proving test |
|---|---|---|
| Page JS reads/modifies extension state | Content scripts run in an isolated world; page JS cannot reach `chrome.*` or script variables. All persistent state lives in `chrome.storage.local`/service worker. | Platform guarantee; `security.test.js` bans `eval`/`new Function`/`document.write` so we never bridge into the page world |
| Page reads/styles the panel DOM | Panel is mounted in a closed shadow root (`mode: "closed"`) | e2e (Task 6) asserts `host.shadowRoot === null` |
| Message spoofing (other extension, web page via externally_connectable, forged payload) | `validateMessage` in `guard.js`: `sender.id === runtime.id`, type allowlist, per-field schema, no unknown keys, 20 KB cap, plain-object check (no prototype tricks) | `guard.test.js` (sender, unknown/proto types, extra keys, size, field bounds) |
| Privileged action triggered by a compromised content script | signin/signout/delete-data/contribute/profile-update/export-data/account need `sender.tab` absent (extension page) or `gesture: true` from the panel | `guard.test.js` "gesture required" cases |
| Token theft | Session in `chrome.storage.local` (not exposed to content scripts); PKCE via `launchWebAuthFlow`; only the anon key ships; no service-role/secret strings; strict extension-page CSP | `security.test.js` secrets scan, CSP check |
| XSS via scraped titles/images | Scraped text only goes through `textContent`; `innerHTML` only with static strings or numeric-built SVG (allow-list by file + expression); titles bounded by guard (500 chars) and `sanitizeText`; URLs https-only | `security.test.js` innerHTML check; `guard.test.js` url/title cases |
| Price poisoning (bad/forged observations) | Guard bounds 0 < price < 1e7, finite, `mrp` null or valid, `src` enum; server requires >= 2 independent reporters for shared history and caps 500 rows/user/day (migration 0004) | `guard.test.js` price cases; Task 1 SQL tests |
| Supply chain | No runtime dependencies, no remote code, no CDN scripts, CSP `script-src 'self'`; no `eval` | `security.test.js` eval/Function/unsafe-eval checks, CSP check |
| Over-permissioning | Permissions limited to storage, alarms, notifications, scripting, identity; no `<all_urls>`; extra stores via runtime `optional_host_permissions` on user click | `security.test.js` permission allowlist + `<all_urls>` check |
| Remote config misuse | Remote config can only switch stores/sites off and set a minimum version; it never carries code or URLs; fetched over https, cached daily | `security.test.js` (no http://); Task 4 config unit test |
| Cleartext traffic | No `http://` literals (only the inert SVG XML namespace) | `security.test.js` http check |
| DPDP / privacy | Contribution is opt-in (`contribute`); users can edit profile, export (`export-data`) and erase (`delete-data`) their data; only watchlist + profile are stored; phone optional and format-validated | `guard.test.js` profile/privileged cases; Task 5 export test |

Known gap: the CSP check in `security.test.js` is red until the manifest declares `content_security_policy.extension_pages = "script-src 'self'; object-src 'self'; base-uri 'none'"`.


## Update 2026-10-17
| Finding | Status |
|---|---|
| Direct INSERT into observations bypassed the daily cap | Fixed in migration 0005 (RPC only, direct grant + policy removed) |
| One account could skew community medians | Fixed in 0006 (per-user aggregation first; `p_min_reporters` clamped to >= 2 on the server) |
| Price sharing was on by default; notice said "opt-in" | Fixed: opt-in default in 0005, UI copy corrected, "Also remove prices I shared earlier" button (`ext_forget_my_observations`, 0006) |
| Erase left the waitlist row | Fixed in 0006 (extension waitlist row removed) |
| Erase leaves the Supabase auth user (Google name/email/picture) | OPEN: needs a server function with the service role (planned Cloudflare Worker / Edge Function calling `auth.admin.deleteUser`). Interim: say so in the UI; email us to remove the login |
| JSON-LD regex could be ReDoS'd by a crafted page | Fixed: linear scanner, 1.5 MB cap, 10 s fetch timeout, test with hostile inputs |
| Tokens readable from content scripts via chrome.storage.local | Fixed: session now lives in the extension's own IndexedDB (invisible to content scripts/pages); content script only asks `whoami` for the avatar initial |
| Sign-out left plan/profile/outbox for the next user | Fixed: sign-out wipes user-scoped keys (test added) |
| Typed text could be observed by host-page scripts through composed input events | Fixed: input/beforeinput/composition events are stopped at the panel root, like key events |
| `gesture` flag was a constant | Fixed: uses `navigator.userActivation.hasBeenActive`; waitlist, iplocate and forget-shared now require it too |
| Service-role JWT could be pasted as the anon key | Fixed: `build-config` decodes the JWT and refuses any role other than anon |
| No length/scheme limits on watchlist text | Fixed in 0006 (https-only urls, size limits) |
| CSP gap listed as open | Closed: manifest declares `script-src 'self'; object-src 'self'; base-uri 'none'` |
| Independent-store mode needs `https://*/*` | Accepted and opt-in (options page), documented; no default broad permission |
| Precise location stored | Reduced: rounded to ~1 km before storing |
