# This-Product → Grocery → Backend: Task Plan (planning only, no code yet)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. **Browser rule (hard):** headless only, ONE browser-driving task at a time, never from parallel agents, always `finally`-close, verify `pgrep -f chrome-mac-arm64` = 0 after, stop after 2 failures. Only research/no-browser tasks may run in parallel.

**Goal:** make the *This product* tab excellent first (reliable extraction, correct location, trustworthy history, drop/urgency checks, seller intelligence, best price across stores), then the *Grocery* tab, backed by a small reliable backend.

**Architecture:** Browser-first (L1 memory → L2 storage → L3 Supabase). Price history comes from a ranked set of sources (own → community → licensed provider → server-side tracked checks). A Cloudflare Worker (free tier) does what the browser can't: account deletion, scheduled checks/alerts, caching, rate limiting. Supabase stays Auth + Postgres + RLS.

**Tech Stack:** MV3 JS (no bundler), Supabase, Cloudflare Workers (plain ES modules, no build step), Playwright headless, Node assert.

**Spec:** the user's 2026-10-17 messages (summarised below). Earlier plans: `2026-10-17-auth-security-cache-wishlist.md`, `/Users/vishwajeet-coridors/Downloads/TRIVEDI/hauls/hauls-chrome-extension-plan.md`.

## Global Constraints
- Nothing slow or scraping-heavy runs without a user click; no background crawling of Amazon/Flipkart. User-initiated reads in the user's own browser only; never evade bot blocks (skip + report).
- Language: "observed / signals / suspicious", never "fake" as a claim about a seller or review.
- Every new capability ships with: unit test, headless e2e case, kill-switch flag (remote config, data-only), and a visible failure message (never a blank/skeleton).
- Notch stays small (logo ≈ 30px; pill only when a real price change exists). No green outline on typing fields.
- Free vs Pro: build Pro features fully; gate by `profile.plan` (everything unlocked while no billing exists).

## Review Focus
- Product page whose price block differs (phones, laptops, deal layouts, out-of-stock, no price) must show a clear message, never "Open a product page".
- HAULS pin ≠ the store's delivery pin: results/prices must be labelled with the pin they were fetched for.
- Third-party/community data that is sparse, stale or wrong must lower confidence and say so, never invent a trend.
- Seller/best-price matches that are wrong variants (storage, colour, pack size) must be labelled "Maybe", never presented as the same product.
- Offline / blocked store / Worker down: UI keeps working from cache with an honest "as of" time.

## What you saw / what I already touched this turn (unverified, needs Task 0)
- The notch pill "↓₹1,23,456" in your screenshot was a **forced test value** I typed to test overflow. Real pills show the real change (e.g. ↓₹64). I shrank the notch/logo, removed the green typing outline, and added Amazon phone-layout price selectors + an "unreadable page" message. **None of it is browser-verified yet.**

---
## Phase 0 — Verify & stabilise (sequential, headless)
### Task 0: Verify this turn's edits
Files: `extension/{lib,content,theme}.js`. Produce 6 real Amazon pages (2 phones, laptop, kitchen, book, fashion) as saved fixtures + one headless run: extraction OK, notch width ≤ 56px, no outline on inputs. Also fix the e2e suite for IndexedDB session + real-click gestures (tests must use `page.mouse` for privileged actions).
- [ ] Gate: `npm run test:unit` + `npm run test:e2e` green; `pgrep chrome-mac-arm64` = 0.

## Phase 1 — THIS PRODUCT (one by one)
### Task 1: Extraction robustness
Corpus of ≥40 saved product pages (Amazon 20 incl. phones/laptops/appliances/books, Flipkart 10, Myntra 5, others 5) → fixture tests for price/MRP/title/id. Selector overrides delivered as **data** via remote config (hot-fix without a Store release). Interface: `readProduct(doc, url) -> {ok, product, reason}`.
### Task 2: Location (pin) correctness
Detect the store's current delivery pin (Amazon header `#glow-ingress-line2`, Flipkart header widget). If ≠ HAULS pin show a mismatch card: "Amazon shows prices for 842001; your HAULS pin is 560001" + one-click **Change Amazon/Flipkart location to 560001** (user click, uses the site's own address-change request, reload). Research task first: feasibility/fragility per site; if not safe, ship detection + deep-link instructions only. Compare links: add pincode params where a store supports it, else label. Grocery already uses the pin; every result row shows "for 560001".
### Task 3: History data sources (research, parallel OK — no browser)
(a) Licensed/third-party providers for India: Keepa (amazon.in), PriceHistory.app B2B API, others — coverage, price, terms, rate limits, how to call legally. (b) Government/consumer-affairs angle: Dept of Consumer Affairs / CCPA dark-pattern guidelines (2023), E-Commerce Rules 2020, Legal Metrology MRP rules, National Consumer Helpline, any public price-monitoring datasets — what is actually *published/mandated to be shared* vs rumour. (c) How history sites obtain data (public docs only). Use the **REA CLI** on public front-end bundles / HAR of those sites to map their documented data endpoints; judge usefulness honestly (it was marginal last time). Output: ranked source strategy + cost + legal risk + recommended backfill design (`source`, `confidence`, `as_of` on every point).
### Task 4: Drop-quality + urgency checks (logic)
`dropQuality(history, price, mrp)` → `real | suspicious | unknown` with reasons: price rose ≥15% in the 14 days before the drop then returned to baseline; MRP changed upward before a sale; "big discount vs MRP but price ≈ 90-day median"; countdown/low-stock banners that never change the price across past events. Needs ≥ N points + source confidence; otherwise "unknown". UI: one chip "Drop check" + reasons sheet. Tests with synthetic histories (inflate-then-discount, genuine low, flat).
### Task 5: Seller intelligence (build + backend)
Read seller from page: Amazon (sold by / ships from / seller link / rating via seller page if reachable), Flipkart (seller name, rating), Shopify (vendor). Signals: first-party vs 3P, fulfilled-by-platform, rating & count, "brand official store", price vs other sellers (when offer list is available), seller changed since last visit. Backend: `ext_seller_observations` (+ RPC `ext_seller_profile(seller_key)` → first_seen, products_seen, rating trend). UI: compact **Seller** row (name · 3P · ships from · ★) → sheet with trust meter and "what this means". Logic: weighted score with explicit reasons; never a verdict word like "scam".
### Task 6: Best price across platforms (Pro, build)
Logic: identity from the page (GTIN/MPN/brand/model/storage/colour/pack) → per-store search adapters run from the user's browser on click (8 s timeout, breaker, cache 15 min, pin-aware) → candidate parse (JSON-LD ItemList/cards) → matcher (model-code equality > GTIN > token overlap, variant check, price sanity) → best 1 per store labelled **Exact / Likely / Maybe** → sorted list with lowest highlighted, "offers/shipping may differ" note. Stores: Amazon, Flipkart, Croma, Reliance Digital, Tata CLiQ, Vijay Sales, Snapdeal (+ Shopify brand sites later). Backend: optional `ext_product_matches` (crowd-confirmed matches) to improve accuracy; results also feed community observations if the user opted in. Interface: `findBestPrice(identity, {pin}) -> [{store,title,price,url,confidence,inStock,asOf}]`.
### Task 7: This-product UI pass (design first)
Superdesign mock for: Drop check chip, Seller row, Best-price card (Pro lock state + list), location-mismatch card, unreadable-page card; logo/notch size; typing fields without outline. Text stays minimal; details in sheets.
- [ ] Gate for Phase 1: headless e2e + 8-page real-site regression (keyboard, clothes, phone, laptop) and a manual 5-minute walkthrough by you.

## Phase 2 — GROCERY (after Phase 1 is signed off)
### Task 8: Grocery everywhere
Two ways, both optional: (1) **toolbar click opens the Chrome side panel** on any tab (no extra permission); (2) opt-in "show the HAULS notch on every website" (options page → dynamic content script on https://*/* that only renders the notch + Grocery/Watchlist; scraping stays limited to supported/Shopify product pages). Remove the need to open Blinkit.
### Task 9: Grocery correctness
Pin-forced results with "for 560001" on every row; per-store freshness ("as of"); out-of-stock handling; unit-price ranking; Zepto/Instamart/BigBasket stay link-outs unless a legitimate path appears; cache + breaker already built (verify under load).
### Task 10: Grocery UI + tests (design → implement → headless e2e).

## Phase 3 — BACKEND (Cloudflare Worker + Supabase), one service at a time
Files: `worker/` (wrangler.toml, `src/index.js`, `test/*.test.js`), `supabase/migrations/0007+`.
- B1 skeleton: `/health`, JWT verification against Supabase JWKS, CORS locked to the extension origin, structured logs, per-IP + per-user rate limit (KV).
- B2 account deletion: `POST /v1/account/delete` (verified JWT → service-role `auth.admin.deleteUser` + data purge) — closes the open security finding.
- B3 ingestion hardening: batch endpoint with idempotency keys, dedupe, outlier/poison filters, dead-letter table.
- B4 history API: merges own + community + licensed source, KV-cached per product (TTL 6 h), always returns `source/confidence/as_of`.
- B5 tracked-item checks: cron every 30–60 min over *tracked* items only, polite per-host rate, JSON-LD for Shopify/D2C first; alerts via Resend with unsubscribe; retries with backoff + dead-letter.
- B6 caches/aggregates for best-price matches and seller profiles.
- Reliability for all: idempotent writes, exponential backoff, circuit breakers, "degraded" responses instead of errors, alarms on failure counts, runbook in `docs/runbook.md`. Unit tests with mocked fetch/env; integration tests against a Supabase test schema; no browser involved.

## Phase 4 — Sign-in & release
Finish Google sign-in with your anon key, run migrations 0001–0006(+), live integration tests, privacy-policy/terms pages, package, Web Store checklist, Cloudflare deploy.

## Execution order & agents
Task 3 (research) and the Worker skeleton B1 (no browser) can start immediately in parallel. Browser-touching tasks (0,1,2,6-adapters,7,9) run strictly one at a time. After each task a fresh reviewer agent reads the diff against this plan (no browser).

## Decisions I need from you (defaults in bold)
1. Third-party history: allow a **paid licensed provider (e.g. Keepa) if research shows it's affordable**, or community-only?
2. Pin forcing on Amazon/Flipkart: **detect + one-click "change location" (your click)**, or detection + instructions only?
3. "Notch on every site": **opt-in permission + side panel on toolbar click**, or side panel only?
