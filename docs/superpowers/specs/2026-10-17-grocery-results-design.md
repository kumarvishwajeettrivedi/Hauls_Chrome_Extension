# Grocery results: correct, deliverable, image grid (design)

Status: DRAFT for user approval (nothing built yet). Research files: scratchpad `serviceability-research.md`, `zepto-instamart-research.md`, `bb-fkm-and-ranking-research.md`.

## Why
User compared HAULS with Buyhatke for "chakla belan" at 842001 (Muzaffarpur). Buyhatke: product-image grid, store-logo badge, "Starts from", rows from Blinkit, Instamart, BigBasket. HAULS: text rows, letter badges, only Blinkit/JioMart, one odd result, wrong "Cheapest", meaningless "/100" for pieces, duplicate rows, and JioMart rows although JioMart does not deliver there. Trust in the numbers matters more than the look.

## Goals
1. Every price shown is one the user can actually buy at THEIR pincode (deliverable stores only).
2. Show the same breadth as Buyhatke: Blinkit, Instamart, BigBasket, Zepto, Flipkart Minutes, JioMart, DMart, each only when it really delivers and returns a price.
3. Buyhatke-style card grid with product photo, pack size, name, "Starts from" price, store-logo badge, Add to Cart (opens the store).
4. Correct ranking/labels (rules below), verified against fixtures captured from real responses.

## Non-goals / anti-goals
- No bypassing bot protection (Akamai/AWS WAF). No fake or "estimated" prices. No default-store fallback (e.g. DMart store 10677). No copying Buyhatke code/config/servers. No data leaves the browser.
- Anti-goal: a store that silently shows wrong-location prices. Unknown deliverability = shown as "not confirmed", never as a price.

## Verified facts (evidence)
- DMart: pincode API verified (842001 not serviceable; 560001 serviceable). Already implemented.
- JioMart search returns IDENTICAL results for 842001 and 560001 (verified): the location header changes nothing, so today's JioMart rows prove nothing about delivery. Its pincode API needs the site's own token (401 without). => JioMart needs the user's own session token, or stays "not confirmed".
- Blinkit, Zepto, Instamart, BigBasket, Flipkart Minutes: all return 403/202/302 to plain requests (bot protection / no location session). Cannot be verified from outside a real browser session. Zepto search needs a request-signature minted by Zepto's own page JS.
- Buyhatke itself works only for stores the user is logged in/connected to, using each store's own API from the extension.

## Design
### A. Ranking and labels (no new data, do first; fixtures from the research file)
- Relevance: keep items matching ANY query word; score by words matched; never reduce to one item.
- "Cheapest" = lowest price among relevant + in-stock + deliverable items. "Best unit price" is a separate tag only inside one unit class (g, ml, pc). Per-100 only for g/ml; "/pc" only when pack >= 2 pieces; nothing otherwise.
- Dedupe on store + normalised name + base-unit pack + price.
- Stores with no deliverability check are excluded from the Cheapest tag.
### B. Card grid UI (Superdesign draft 8a8e4ba1-0028-4442-98c4-139b817b2ae5)
2-column grid at 420 px (mobile sheet too); photo, pack strip, 2-line name, "Starts from", price, round store-logo badge bottom-right, outlined Add to Cart (opens the store's product/search page), Cheapest sticker, Filter/Sort/pack chips, "also at" mini-row, grey row for stores that do not deliver ("JioMart doesn't deliver to 842001"), "open once to connect" chip. Real store logos bundled as small local images.
### C. Connectors, in order of confidence
1. DMart (done), Blinkit (works in the user's browser session; add: no merchant id / no items => "not delivering here").
2. JioMart: read the user's own site token (like Buyhatke's content script) to call the pincode check; without it, "not confirmed" (no price shown).
3. Flipkart Minutes, BigBasket, Zepto, Instamart: need ground truth first (see below). Approach per research: background tab on the store's search URL + MAIN-world response hook, because signing/WAF live in page JS.
### D. Ground truth before writing the last four connectors (needs the user, 10 minutes, no automation)
In the user's own Chrome, logged in with pincode 842001 set on each site: DevTools > Network > search "chakla" > right-click > Save all as HAR, for Zepto, Instamart, BigBasket, Flipkart Minutes (and Blinkit, JioMart). I analyse the HARs (REA supports HAR) to get the exact request/response shapes and build parsers + tests from REAL data. Without them these four would be guesses, which the anti-goals forbid.

## Constraints
Headless-only tests, one browser job at a time (laptop overheating rule). TDD with mutation checks. Cache classes follow docs/architecture-auth-state.md (cache:grocery). Anything unverified is labelled so in the UI and docs.

## Left to the builder
Logo image sourcing/size, chip behaviour details, exact "connect" wording.

## Decision log (2026-10-17, user-approved in chat)
- Approach = three tiers per store: (1) direct request from the service worker (Blinkit, DMart; Flipkart Minutes if a capture confirms), (2) hidden page read for Zepto / Instamart / BigBasket (user connects each store once; HAULS opens the store's search page in an inactive background tab marked `haulsprobe=1`, copies the page's own search response via `t2-hook.js` (MAIN world) + `t2-relay.js`, closes the tab), (3) link-only fallback. Per-store remote switch + circuit breaker stay.
- Human step replaced: no HAR files. Settings > Grocery stores > Connect > Test > Copy report gives a sanitised sample (structure, a few products, location headers) from the user's own session; per-store parsers and location verification are written from that, never guessed.
- Tier-2 rows stay HIDDEN until a parser AND a location check exist for that store (anti-goal: wrong-location prices).
- Bot protection is never bypassed: headless/automated browsers are blocked by Zepto (202 then 429), so verification happens in the user's real Chrome.
- Value hook: record every grocery price seen into a local grocery price history (later step).
