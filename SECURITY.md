# Security policy

## Reporting a vulnerability

Please report privately. **Do not open a public issue or pull request for a security problem.**

Use GitHub's private vulnerability reporting: open the repository's **Security** tab, choose **Report a vulnerability**
(direct link: <https://github.com/kumarvishwajeettrivedi/Hauls_Chrome_Extension/security/advisories/new>).
It reaches the maintainer only and keeps the discussion private until a fix ships.

Useful in a report: what you did, what you expected, what happened, the extension version (`chrome://extensions`), and if it involves the backend, the function or table name. A short proof of concept is plenty. Please test only against your own account and data.

### Response targets
These are goals for a one-person project, not guarantees.

| Step | Target |
|---|---|
| Acknowledge your report | within 3 days |
| First assessment (accepted / declined / need more info) | within 7 days |
| Fix or mitigation for a critical or high issue (data exposure, account takeover, secret leak) | within 14 days |
| Fix for medium and low issues | next release |
| Public advisory | after the fix is released; you are credited unless you prefer not to be |

Good-faith research that stays inside the scope below, avoids other people's data and does not degrade the service will not be pursued.

## Supported versions

Only the **latest release** (GitHub Releases, and the Chrome Web Store build when published) gets security fixes. The extension is small and updates are cheap: please update before reporting.

## Scope

In scope:
- The extension in `extension/` (content scripts, service worker, options page, message guard).
- The Supabase schema, row-level-security policies and SQL functions in `supabase/migrations/` as deployed.
- The release process in `scripts/` and `.github/` (packaging, checksums, workflows).
- The static website in `site/`.

Out of scope:
- Vulnerabilities in the shopping sites themselves (Amazon, Flipkart, Myntra and others), Google, Supabase, Resend or Cloudflare. Report those to the vendor.
- Findings that need a rooted machine, a malicious browser extension with broader permissions than HAULS, or physical access.
- Volumetric denial of service against Supabase or GitHub Pages infrastructure, social engineering, spam, and missing best-practice headers on the GitHub Pages site without a concrete impact.
- Price accuracy or "wrong verdict" bugs (open a normal issue).

## What HAULS does and does not collect

| | |
|---|---|
| Stays on your device | Browsing on shopping pages, the pages' contents, and your local price history, unless you opt in below. |
| Stored in your account, only if you sign in with Google | Name, email and avatar from Google; watchlist and alert targets; settings and saved places (location rounded to about 1 km); optional phone number you type yourself. Visible only to you through row-level security. |
| Shared only if you turn on "contribute" (off by default) | Anonymous product price observations. They are kept apart from your name and email and shown only as combined history across several contributors. You can delete what you shared from Settings. |
| Feedback form | Rating, optional reasons and message. A plain SHA-256 hash of the sender's network address (with a fixed, public prefix, so not a secret salt) is stored for rate limiting; the address itself is not. A hash of an IP address can be reversed by trying every address, so treat it as pseudonymous, not anonymous. Feedback older than a year is deleted by `ext_purge_old_data()` when the maintainer schedules it. |
| Email alerts, only if you turn them on | The alert is sent to your account email through Resend. |
| Never | HAULS does not sell data, show ads, run trackers, read your passwords or payment details, or load remote code. |

You can export or erase your cloud data from the account menu, which opens Settings where you confirm it. Erasing the Supabase login record itself is still a manual request (see `docs/security.md`, "OPEN" row).

## How keys and secrets are handled

| Secret | Where it lives | Rule |
|---|---|---|
| Supabase **anon** key | In the shipped extension (`extension/config.js`, generated) and the website | Public by design. It only grants what row-level security allows. `scripts/build-config.js` accepts only a JWT whose `role` claim is exactly `anon`, or an `sb_publishable_` key; it refuses service-role JWTs, `sb_secret_` keys, role-less JWTs and anything else (`tests/unit/buildconfig.test.js`). |
| Supabase **service role** key / JWT secret | Maintainer's private `.env` and the Supabase dashboard only | Never in the extension, the website or git. It bypasses row-level security. |
| **Resend** API key | Supabase Vault (`vault.decrypted_secrets`), read inside a `SECURITY DEFINER` function | Never in the repo, the extension or `.env.example`. |
| **Google OAuth** client secret | Supabase Auth provider settings (and the maintainer's `.env`) | Never shipped. The extension signs in with a Google id_token (hashed nonce, public client id only) when `GOOGLE_CLIENT_ID` is set, and with Supabase-hosted PKCE otherwise. |
| Extension signing/provenance keys | `keys/` and `~/.hauls-provenance.key`, outside git | Back them up offline; both are git-ignored. |

Guards: `.gitignore` excludes `.env*`, `keys/`, `dist/`, `hars/` and key files; `scripts/package.sh` refuses to build a zip containing secret-looking strings; `scripts/secret-scan.mjs` scans tracked files, the whole git history and `dist/*.zip` (run by a pre-commit hook after `bash scripts/install-hooks.sh`, and by CI in `.github/workflows/security.yml`).
Rotation steps for every secret are in [`docs/threat-model.md`](docs/threat-model.md#5-key-rotation-runbook).

If you find a real secret in this repository or its history, report it privately as above and **do not use it**.

More detail: [`docs/security.md`](docs/security.md) (extension controls and tests), [`docs/threat-model.md`](docs/threat-model.md) (threats and residual risks).
