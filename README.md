<p align="center"><img src="site/img/logo.png" width="72" alt="HAULS"></p>

<h1 align="center">HAULS</h1>
<p align="center"><b>Don't buy blind.</b> Price history, buy-or-wait verdicts, trap prices and grocery comparison for Indian shoppers.</p>
<p align="center">
  <a href="https://kumarvishwajeettrivedi.github.io/Hauls_Chrome_Extension/">Website</a> ·
  <a href="../../releases/latest/download/hauls-share.zip">Download</a> ·
  <a href="INSTALL.md">Install guide</a>
</p>

<p align="center"><img src="site/img/hero.jpg" alt="HAULS panel open on an Amazon.in product page" width="860"></p>

## What it does

- **Price history.** Lowest, average and highest price over 30 days, 90 days, a year or all time, drawn as a chart.
- **Buy-or-wait verdict.** A plain answer with the reason, and a check for discounts that were never real.
- **Trap prices.** Set the price you want and get a notification when it is reached.
- **Deal Scanner.** A 0–100 score with the points behind it, and a warning when a price was lifted before a "discount".
- **Background price checks.** While the browser is open, watched items are re-read a few times a day from each store's own data, so history and alerts continue without a visit. Settings shows per-store health.
- **Reviews and seller.** What buyers say, from the rating breakdown, and who sells and ships the item.
- **Other sellers.** On Amazon, every seller's price for the same item, with the lowest marked and seller ratings.
- **Best price across stores.** One click compares Amazon, Flipkart and Reliance Digital for the same product, with a match confidence on each.
- **Grocery comparison.** Search once and compare Blinkit, DMart and more at your exact pincode. Only stores that confirm delivery to that pincode show a price.
- **Watchlist and sync.** Keep products on a watchlist. Signing in with Google is optional and only syncs your watchlist, saved places and settings.

Supported shops include Amazon.in, Flipkart, Myntra, Croma, Reliance Digital, Tata CLiQ and Snapdeal. HAULS runs in Chrome, Edge, Brave and other Chromium browsers on a computer.

## Install

Download the latest `hauls-share.zip` from the [releases page](../../releases/latest) and follow the [install guide](INSTALL.md). No store account is needed.

## Privacy

Prices you browse are stored in your browser first. Sharing anonymous prices to build community history is off unless you switch it on, and shared prices are kept apart from your name and email. Details are in [docs/security.md](docs/security.md).

## Development

Requirements: Node 20 or newer, Chrome for Testing (installed by Playwright).

```bash
npm install
cp .env.example .env        # Supabase URL, anon key and Google client id
npm run build:config        # writes the git-ignored extension/config.js
```

Load `extension/` as an unpacked extension (`chrome://extensions`, Developer mode, Load unpacked).

| Command | What it does |
|---|---|
| `npm run test:unit` | Fast unit tests |
| `npm run test:e2e` | Headless Chrome with the extension against live shops |
| `npm run test:integration` | Backend checks (needs `SUPABASE_ANON_KEY`) |
| `npm run package:share` | Builds `dist/hauls-share-<version>.zip` |

### Repository layout

```
extension/            the unpacked Manifest V3 extension
supabase/migrations/  database schema and policies, applied in order
tests/                unit, integration and end-to-end tests
scripts/              config generation and packaging
docs/                 sign-in setup, auth and state architecture, security notes
site/                 the project website (GitHub Pages)
```

Sign-in setup is described in [docs/google-signin-setup.md](docs/google-signin-setup.md).

## Disclaimer

HAULS is an independent tool and is not affiliated with any store it works with. Prices come from the pages you visit and from public store endpoints, and may differ at checkout.
