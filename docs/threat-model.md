# HAULS threat model

Public document. It lists what could go wrong, what in this repository stops it, and what is still open. Reporting policy: [SECURITY.md](../SECURITY.md). Extension controls and their tests: [security.md](security.md).

Method: STRIDE (**S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of service, **E**levation of privilege) applied per component, then cross-cutting abuse classes. "Status" is one of **Mitigated** (control + test exists and the migration is applied), **Pending apply** (written and tested in the repository, but the migration has not been run on the live project yet), **Partial**, **Planned** or **Accepted**.

## 1. System and trust boundaries

```
 shopping page (hostile) --DOM--> content script --runtime message--> service worker --HTTPS+JWT--> Supabase (Postgres RLS, RPCs)
        ^ untrusted                 isolated world,        validated by guard.js        only holder of the           |
                                    closed shadow root                                   session                      +--> pg_net --> Resend (email)
 maintainer laptop --> git/GitHub --> CI --> dist zip + SHA256SUMS --> GitHub release / Web Store --> user
```

| Asset | Why it matters |
|---|---|
| User session (access/refresh token) | Acts as the user against the database |
| User data: Google name/email/avatar, watchlist, settings, saved places, optional phone | Personal data (India DPDP) |
| Shared price observations and charts | Integrity of verdicts other users rely on |
| Service-role key, JWT secret, Resend key, Google OAuth client secret | Full database access, ability to send mail as HAULS, ability to impersonate the sign-in app |
| Signing/pinned extension key and provenance key | Extension identity (sign-in redirect) and authorship proof |
| Release artefacts (zip, checksums) | What users actually run |

Attackers considered: a malicious web page or other site script; another extension; a signed-in user attacking other users or the service; an anonymous internet caller of the public API; a thief of a leaked credential; a compromised dependency or CI action; a curious bystander reading the public repository.

## 2. STRIDE by component

### 2.1 Browser extension (manifest, permissions, options page)
| STRIDE | Threat | Mitigation in this repo | Residual / status |
|---|---|---|---|
| E | Over-broad permissions let one bug read every site | `extension/manifest.json`: no `<all_urls>`; stores listed explicitly; extra stores only via `optional_host_permissions` on user click; allowlist asserted in `tests/unit/security.test.js` | Independent-store mode asks for `https://*/*` (opt-in, documented). Accepted |
| T | Remote or injected code runs with extension privileges | MV3 CSP `script-src 'self'; object-src 'self'; base-uri 'none'`; no `eval`/`new Function`/CDN script, checked by `security.test.js` | None known. Mitigated |
| I | Secret shipped in the zip | `scripts/build-config.js` embeds only URL, anon key and public Google client id and accepts only a JWT with `role` `anon` or an `sb_publishable_` key and refuses everything else (`tests/unit/buildconfig.test.js`); `scripts/package.sh` greps the finished zip; `scripts/secret-scan.mjs` scans `dist/*.zip` | The anon key is public by design. Mitigated |
| S | Another extension or site messages the service worker | No `externally_connectable`; `validateMessage` requires `sender.id === runtime.id` (`extension/guard.js`, `tests/unit/guard.test.js`) | Mitigated |
| I | Remote config (`ext_remote_config`) used to push behaviour | It can only switch stores (`disabled_stores`) and features (`disabled_features`) off; data, never code or URLs (`loadFlags` in `extension/background.js`). The seeded `min_version` is not read by any extension code, so the table cannot force an update | Mitigated |

### 2.2 Content script (runs inside the shop page)
| STRIDE | Threat | Mitigation | Residual / status |
|---|---|---|---|
| T | Hostile page forges or alters scraped prices/titles to poison history | Guard bounds (0 < price < 1e7, `mrp` valid, `src` enum), server needs >= 3 independent reporters and caps 500 rows/user/day (`guard.js`, `0004`, `0006`, `0017`) | A coordinated group of real accounts could still skew a thin product. Partial |
| I | Page reads panel DOM or typed text | Closed shadow root (`extension/content.js`), key/input/composition events stopped at the panel root (`docs/security.md`) | Content scripts share a renderer with the page, so a browser-level exploit defeats this. Accepted |
| T | Stored/DOM XSS from scraped text | Scraped text only goes through `textContent`; `innerHTML` allow-listed by file and expression; titles bounded and run through `sanitizeText`; https-only URLs (`security.test.js`, `guard.test.js`) | Mitigated |
| E | Compromised content script erases or hands out the account (`delete-data`, "sign out and clear this device", `export-data`) | These three are accepted only from an extension page, never on the sender-written `gesture` flag: the panel only opens `options.html#delete` / `#signout-clear` / `#export`, where the user confirms with a click and the export file is made (`guard.js`, `extension/options.js`, `tests/unit/guard.test.js`, `tests/unit/destructive.test.js`, e2e `g4`) | Mitigated |
| E | Compromised content script triggers the other privileged actions (sign in, contribute, profile update, account, forget-shared, waitlist, iplocate) | Privileged message types need an extension-page sender or `gesture: true` in the message (`guard.js`). The flag is set by the content script from `navigator.userActivation.isActive` (a click in the last few seconds) | The flag is written by the sender, so a fully compromised content script can send `gesture: true` itself and this is a speed bump, not a boundary. These types are low-impact (none erases or exports data). Partial |
| T | Compromised content script files a link to another site under a real shop's product key (`amazon.in:ASIN` with an `evil.com` url), so a notification or watchlist click opens it | A product's url must be on the shop its key names: the url host equals the key's domain or is a subdomain (`www.amazon.in` ok; `evil.com`, `amazon.in.evil.com`, `evilamazon.in` not). Independent stores (`shopify:host:handle`) use their own host. Checked in `guard.js` (`keyHostOk`) and again in `record()` in `background.js`, which the background price checker also goes through (`tests/unit/guard.test.js` table of every supported shop plus attacks, `tests/unit/boundary.test.js`) | A page on a shop's own domain can still misreport that shop's products (see the price-poisoning row). Mitigated |
| D | Crafted page makes parsing hang (regex / huge JSON-LD) | Linear scanner, 1.5 MB cap, 10 s fetch timeout (`docs/security.md`) | Mitigated |

### 2.3 Service worker (`background.js`, `auth.js`, `sync.js`)
| STRIDE | Threat | Mitigation | Residual / status |
|---|---|---|---|
| I | Token theft by page or content script | Session kept in the extension's own IndexedDB (`extension/auth.js`), not `chrome.storage.local`; content script only learns an avatar initial via `whoami`; sign-in via `launchWebAuthFlow` returns a Google id_token with a hashed nonce when `GOOGLE_CLIENT_ID` is set (`signInDirect`), and uses Supabase-hosted PKCE otherwise | Malware with local profile access can read it. Accepted |
| S | Sign-in redirect hijack | Pinned extension ID so the redirect URL is fixed; only that URL is allow-listed in Supabase Auth (`docs/google-signin-setup.md`) | Losing the pinned key forces an ID change. See runbook |
| T/E | Account mix-up: user B sees or overwrites user A's local data on a shared browser | Sign-out wipes user-scoped keys; sync reports `same / adopted / switched` and never merges a previous account's data into another (`extension/sync.js`, `extension/state.js`, `tests/unit/state.test.js`) | Local data created while signed out is merged into the next account by design ("adopted"), which the UI states. Accepted |
| R | User denies an action | No audit log of user actions by design (data minimisation) | Accepted |
| D | Server down or slow stalls UI | `withTimeout()` on every fetch, outbox/retry, local-first operation (`extension/auth.js`, `sync.js`) | Mitigated |
| R | A change the server refused for good is dropped from the outbox without the person knowing | The count of dropped watchlist changes is kept (`syncDropped`, 7 days) and shown in Settings and the account sheet as "N changes could not be saved to your account." until a clean "Sync now" (`extension/sync.js`, `extension/background.js`, `tests/unit/run.js`, `tests/unit/tracker.test.js`, e2e `g1`) | The dropped change itself is not retried; the local copy stays. Mitigated |

### 2.4 Supabase: tables, RLS and RPCs
| STRIDE | Threat | Mitigation | Residual / status |
|---|---|---|---|
| I/E | Reading or writing another user's rows | RLS enabled on every `ext_` table with `user_id = auth.uid()` policies (`0003_ext_rls.sql`); cross-user tests in `tests/sql/pglite.test.mjs` | Mitigated |
| E | Self-upgrade of plan, edit of email or id | Column-level `grant update (name, contribute, phone, ...)` plus guard trigger `ext_profiles_guard` (`0004`); tested in PGlite | Mitigated |
| E | `SECURITY DEFINER` function abused (search-path hijack, over-broad execute) | Every definer function sets `search_path = ''`, and `revoke all ... from public, anon, authenticated` then grants to the exact role (`0004` to `0015`) | New functions must follow the same pattern; reviewed per migration. Partial |
| D | Anonymous callers hammer open endpoints | Only `ext_submit_feedback` and public-read `ext_remote_config` are anon-reachable: feedback is capped 5/hour per hashed caller, 500/hour and 3000/day overall (`0012`, `0017`). The caller is `cf-connecting-ip` (set by Cloudflare) when present, else the first `x-forwarded-for` entry, which a client can write; the hash is a plain SHA-256 with a fixed public prefix. History/chart RPCs need an authenticated JWT (`0009`, `0010`) | A spoofed address defeats the per-caller limit, so the real bound is the 500/hour and 3000/day overall caps. Platform rate limits (Supabase/Cloudflare) are the real defence. Partial |
| D | Huge arrays/JSON in RPC arguments, slow queries | Row caps (500 observations/user/day, watchlist plan caps); per-call payload caps inside the functions that take arrays or jsonb (observations: 50 rows and 40 kB per call, oversize input refused); `statement_timeout` of 3 s for `anon` and 5 s for `authenticated`, 2 s on `ext_get_chart` (`0017`) | The role timeouts are set in a block that only warns on a permission failure, so confirm them in the dashboard (section 6). Mitigated |
| D | "Free" accounts are cheap to mint | Google-only sign-in; Google verifies accounts | Check in the dashboard that anonymous sign-ins and email sign-ups are **off** (they would hand out `authenticated` tokens). Maintainer step |
| T | Stored markup / control chars / oversize in user text columns (`ext_profiles.name/phone`, watchlist `title/url/image/site`, settings, places, feedback) | CHECK constraints: name <= 80 and no control chars or `<>`, phone `+91` pattern (`0016`); watchlist text limits and https-only URLs (`0006`); feedback sanitised, refused over 2000 characters and stored cut to 1000 (`0012`, `0017`); settings jsonb and saved places validated by CHECKs (`0017`) | The extension also never renders these as HTML (see 2.2). Mitigated |
| D | Soft-deleted watchlist rows used as free storage, or dated in the future so they outlive the purge | `0018`: `deleted_at` is clamped to now(); live rows count against the plan limit and live + deleted rows against a hard ceiling of 500 per user; `ext_purge_old_data()` also removes tombstones older than 24 h for every account (`tests/sql`) | Applies once 0018 is run. The scheduled purge needs pg_cron, which the maintainer must enable (the `cron.schedule` line is in the 0017 header). **Mitigated** (0018, applied and checked on the live project) |
| D | Community price observations and chart series grow without limit (storage cost, slower history queries) | `0020`: `ext_purge_old_data()` deletes observations and chart series older than 400 days (history only reads 365 / 410); indexes on `observed_day` and `captured_at` (`tests/sql`) | Needs the scheduled purge (pg_cron, maintainer must enable; line in the 0017 header). **Mitigated once 0020 is run and the purge is scheduled**
| T | Invisible or direction-changing characters (zero-width, soft hyphen, word joiner, tag characters, bidi controls) in text and keys | `0018`: one character class used by the helpers, CHECKs, feedback, places, alert mail and chart upload; old rows are cleaned first. ZWJ/ZWNJ stay allowed for Indic scripts | **Mitigated** (0018, applied and checked on the live project) |
| D | Parallel anonymous feedback calls all pass the cap check, or an IPv6 caller rotates addresses to dodge the per-caller limit | `0018`: calls are serialised with an advisory lock before the counts, and an IPv6 caller is bucketed by its /64 | **Mitigated** (0018, applied and checked on the live project) |
| I | Shared history reveals one contributor's prices | Aggregation across >= 3 distinct users (server-clamped in `ext_price_history`, `ext_get_chart` requires n >= 3), per-user median first, opt-in only (`0006`, `0009`, `0017`) | Small cohorts can be inferred; threshold is a tunable. Partial |

### 2.5 Email alert path (`ext_send_price_alert`, `0014`, `0015`)
| STRIDE | Threat | Mitigation | Residual / status |
|---|---|---|---|
| I | Resend key leaks | Stored only in Supabase Vault, read inside the definer function; never in repo, extension or `.env.example`; scanned by `scripts/secret-scan.mjs` | Anyone with SQL-editor or service-role access can read Vault. Accepted |
| T | HTML injection through `p_title` | Control chars stripped, length 160, `& < > "` escaped before building HTML (`0015`) | Mitigated |
| T | HTML/attribute injection through `p_url` | `0015` accepts only `https://` URLs on an allow-listed shop domain, <= 500 chars; `0017` also HTML-escapes the link and refuses the whole call if it contains quotes, angle brackets, whitespace or control characters | The mail only goes to the caller's own address. Mitigated |
| D / abuse | Mail to an unverified address (if email sign-up without confirmation were ever enabled) | `0018`: mail is sent only when `auth.users.email_confirmed_at` is set, else the function returns `off` | Disabling email sign-up is still the primary control (section 6). **Mitigated** (0018, applied and checked on the live project) |
| S / abuse | Waitlist join or erase using someone else's address through an unconfirmed email sign-up | `0019`: the waitlist functions act only on a confirmed `auth.users.email_confirmed_at`. Disabling email sign-up stays the primary control | **Mitigated** (0019, applied) |
| D / abuse | Using HAULS as a spam cannon | Recipient is always the caller's own account email; one mail per product per 24 h and 10/day per user; advisory lock prevents racing the counters; the alert must match a real watchlist target (`0015`) | Mitigated |
| S | Sender spoofing / sandbox sender | Sender address read from `ext_remote_config` (service-role write); no fallback to Resend's sandbox | Mitigated |
| R | No record of mail sent | `ext_alert_log` stores user and product only (no content) | Accepted |

### 2.6 Release pipeline (repo, CI, packaging)
| STRIDE | Threat | Mitigation | Residual / status |
|---|---|---|---|
| I | Secret committed (now or in history) | `.gitignore` for `.env*`, `keys/`, `dist/`, `hars/`, key files; pre-commit hook (`scripts/install-hooks.sh`); `scripts/secret-scan.mjs` over tracked files, full history and zips (long minified lines are scanned in overlapping 20,000-character windows so a secret on a window edge is still found, `scripts/secret-scan.test.mjs`), run in CI (`.github/workflows/security.yml`); GitHub secret scanning + push protection (maintainer setting) | A hook can be bypassed with `--no-verify`; CI and GitHub push protection are the backstop. Partial |
| T | Poisoned dependency or CI action | No runtime dependencies in the extension; dev deps only (`npm audit --omit=dev` gate); actions pinned by full commit SHA; Dependabot for npm and actions; least-privilege `permissions:` per job | Dev-time tools (PGlite, Playwright) are trusted at install. Accepted |
| T | Tampered download | `SHA256SUMS.txt` published with each release (`scripts/package.sh share`); provenance mark (`scripts/provenance.mjs`) proves authorship | Checksums on the same host prove integrity only if the release page is not compromised. Enable branch protection and 2FA. Partial |
| S | Unauthorised release / push | GitHub branch protection, required status checks, 2FA on the maintainer account (settings: section 6) | Single maintainer. Accepted |
| E | Workflow takes over with a write token | Top-level `permissions: {}`; jobs read-only except CodeQL `security-events: write`; no secrets used; `persist-credentials: false` | Mitigated |

## 3. Cross-cutting abuse classes

| Class | Where it can happen | Controls | Open items |
|---|---|---|---|
| Text-input attacks (markup, control chars, bidi/zero-width, oversize, wrong scheme, prototype pollution) | Scraped titles, profile name/phone, watchlist, settings, places, feedback, email | Layered: guard schema + `sanitizeText` in the extension, CHECKs and sanitising in SQL, `textContent` rendering, escaped email HTML | Settings/places CHECKs and the email link rules are in 0017 (applied). Prototype-pollution-safe parsing at the storage boundary: Planned with the extension hardening pass |
| Server abuse / DoS | Public RPCs, large payloads, auth endpoint, email | Caps and per-user limits above; Supabase and Cloudflare rate limiting (Supabase documents a `db_pre_request` write-rate limiter) | Payload caps and role timeouts are in 0017 (applied). Platform rate limits and CAPTCHA on auth are configuration the maintainer must switch on |
| Credential theft | `.env`, Vault, CI, laptop, extension storage | Section 2.3 and 2.5 controls, key handling table in SECURITY.md, rotation runbook below | Laptop compromise defeats local secrets; use full-disk encryption and a password manager |
| Account mix-up | Shared browser, switching Google accounts, stale local state, guessable IDs | Sign-out wipe, `same/adopted/switched` sync logic, `auth.uid()` on every row, user-scoped storage keys | None known |
| Supply chain | npm, GitHub Actions, Chrome Web Store build vs GitHub build, Supabase extensions | Pinned SHAs, Dependabot, no runtime deps, store build strips the dev key, checksums | Third-party endpoints the extension calls (Nominatim, ipwho.is) see the user's IP; they are used only on user action |

## 4. Verification

| Control | Test |
|---|---|
| Message guard, sender and schema | `node tests/unit/guard.test.js` |
| No eval, permission allowlist, CSP, secrets in extension | `node tests/unit/security.test.js` |
| RLS, column grants, definer functions, input CHECKs, idempotent migrations | `npm run test:sql` |
| Secret scanner (tracked, history, staged, zip, size guard) | `npm run test:secrets` |
| Whole repo + history + zips | `npm run scan:secrets` |
| Dependencies | `npm audit --omit=dev` |
| CI | `.github/workflows/security.yml` |

## 5. Key rotation runbook

General rule: **rotate first, clean up second.** A secret that reached git, a chat, a screenshot or a zip is compromised even if you delete it. Rotation order when unsure: Resend -> Google client secret -> Supabase keys -> signing keys.

Before you start: `npm run scan:secrets` (find every place it leaked) and note the time. After: re-run it, then check Supabase logs, the Resend dashboard and the Google Cloud audit log for use between the leak and the rotation.

Supabase's key system has changed; the dashboard labels move, so follow the current docs ([API keys](https://supabase.com/docs/guides/api/api-keys), [Rotating anon, service and JWT secrets](https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd)).

### 5.1 Supabase service role key leaked
1. Dashboard > Project Settings > API Keys. If the project is on the legacy keys, **migrate first**: enable JWT signing keys and create a publishable key (`sb_publishable_...`) and a secret key (`sb_secret_...`). Supabase states the legacy anon/service/JWT secrets can no longer be rotated individually.
2. Replace every consumer of the old service key (local `.env`, scripts, any Edge Function or Worker) with the new secret key.
3. Delete the leaked secret key (new system) or revoke the old legacy key / rotate signing keys, then in JWT Keys press **Revoke** on the previous key (an unrevoked old key stays valid).
4. If you still depend on the legacy JWT secret and it was exposed, regenerating it invalidates **all** keys immediately, including the anon key inside every installed extension. Only do that after step 1, and plan a new extension release (5.2).
5. Verify: `curl` with the old key must return 401; `npm run verify:live-0012` still passes with the new key. Review `auth.users` and `ext_profiles` for rows you did not expect.

### 5.2 Anon key (or JWT secret) must change
The anon key is public, so rotate it only if the JWT secret was exposed or a service-role value was shipped by mistake.
1. Create the new publishable key (or new signing key), put it in `.env` as `SUPABASE_ANON_KEY`.
2. `npm run build:config` (accepts only an anon JWT or an `sb_publishable_` key), then `bash scripts/package.sh` and `bash scripts/package.sh share`; bump the version in `extension/manifest.json`.
3. Publish to the Chrome Web Store and GitHub Releases. Installed copies keep the old key until they update, so keep the old key valid for a short overlap, then revoke it.
4. Update the website config (`site/feedback-config.js`).

### 5.3 Resend API key (Vault)
1. Resend dashboard > API Keys > create a new key (sending access only, restricted to the HAULS domain). Do not delete the old one yet.
2. In the Supabase SQL editor, as project owner:
   `select vault.update_secret((select id from vault.secrets where name = 'resend_api_key'), '<new key>');`
   (Do not paste the key into a file, chat or ticket. Close the editor tab afterwards.)
3. Trigger one test alert from a test account; confirm the mail arrives.
4. Delete the old key in Resend. Rotate every 6 months or on staff/device change.

### 5.4 Google OAuth client (id/secret)
1. Google Cloud Console > APIs & Services > Credentials > the Web client > **Add secret** (a second secret is allowed, so there is no downtime).
2. Supabase > Authentication > Providers > Google: paste the new secret, save.
3. Test a sign-in, then disable and delete the old secret in Google.
4. The client **id** is public. Changing it also needs a new `GOOGLE_CLIENT_ID` in `.env`, a rebuilt extension and the redirect URI re-checked (`docs/google-signin-setup.md`).

### 5.5 Provenance signing key (`~/.hauls-provenance.key`)
This key only proves authorship (`scripts/provenance.mjs`); it does not protect users.
1. **Back it up** now: copy the file (mode 600) into a password manager or an encrypted offline drive. Losing it means you can no longer prove the marks.
2. If it leaked: keep the old copy offline for historical proof, create a new key (move the old file aside, run `node scripts/provenance.mjs stamp`), commit the re-stamped files, and state the date of the switch in the release notes.
3. Never store it in the repo; `.gitignore` also blocks `*.key`.

### 5.6 Pinned extension key (`keys/hauls-dev.pem`)
It fixes the extension ID, hence the OAuth redirect URL. If leaked, someone could build an extension with your ID only by side-loading with your key; the Web Store build does not use it.
1. Back it up offline like 5.5.
2. If it must change: generate a new key, run `node scripts/extension-key.js` (prints the new ID and redirect URL), update Supabase Auth > URL Configuration and the Google client, rebuild, release. Users of the GitHub build must reinstall because their ID changes.

### 5.7 After any leak that reached git
1. Rotate (above). 2. Remove from history only if you need to (`git filter-repo --replace-text`), then force-push; assume forks, clones and GitHub's cached views still have it. 3. Ask GitHub Support to purge cached views if needed. 4. Close the loop: confirm GitHub secret scanning shows no open alerts and `npm run scan:secrets` is clean.

## 6. Maintainer checklist (GitHub and Supabase settings)
- GitHub > Settings > Code security: enable **Secret scanning**, **Push protection**, **Private vulnerability reporting**, **Dependabot alerts** and **Dependabot security updates**, and **Code scanning** (CodeQL results appear after the workflow runs).
- Branch protection on `main`: require pull request, require status checks `secret-scan`, `npm-audit`, `tests`, `codeql`, block force pushes, require signed commits if you can.
- 2FA (hardware key or passkey) on the GitHub, Supabase, Google Cloud, Resend and Cloudflare accounts.
- Supabase: Authentication > disable anonymous sign-ins and email sign-up; set auth rate limits and enable CAPTCHA if abuse appears; keep Data API on `public` only for objects that need it; confirm the per-role `statement_timeout` that 0017 sets (anon 3 s, authenticated 5 s) is in place, because a permission failure there only logs a warning; turn on Supabase network restrictions or a Cloudflare rate-limit rule in front of the project if traffic grows.

## 7. References relied on
- Supabase: [Hardening the Data API](https://supabase.com/docs/guides/api/hardening-data-api) (grant minimum privileges, revoke default function EXECUTE, review every SECURITY DEFINER function, `db_pre_request` rate limiting), [API keys](https://supabase.com/docs/guides/api/api-keys), [Rotating anon, service and JWT secrets](https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd).
- Chrome: [Stay secure (extensions)](https://developer.chrome.com/docs/extensions/mv2/security) (isolation is not safety, keep sensitive work in the background script).
- OWASP: [Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), [Cross Site Scripting Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html), [Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html).
- GitHub: [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) (pin actions to a full commit SHA, least-privilege `GITHUB_TOKEN`).
