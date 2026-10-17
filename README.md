<p align="center"><img src="site/img/logo.png" width="72" alt="HAULS"></p>

<h1 align="center">HAULS</h1>
<p align="center"><b>Don't buy blind.</b> A free price tracker and price history extension for Amazon.in, Flipkart and Myntra: buy-or-wait verdicts, other sellers, urgency checks and grocery comparison for Indian shoppers. Chrome, Edge and Brave.</p>
<p align="center">
  <a href="https://kumarvishwajeettrivedi.github.io/Hauls_Chrome_Extension/">Website</a> ·
  <a href="../../releases/latest/download/hauls-share.zip">Download</a> ·
  <a href="INSTALL.md">Install guide</a> ·
  <a href="https://hauls.in/">hauls.in</a>
</p>
<p align="center"><a href="../../releases/latest"><img alt="latest release" src="https://img.shields.io/github/v/release/kumarvishwajeettrivedi/Hauls_Chrome_Extension?label=release"></a> <img alt="manifest v3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-014baa"> <img alt="free" src="https://img.shields.io/badge/price-free-19e68c"></p>

<p align="center"><img src="site/img/hero.jpg" alt="HAULS panel open on an Amazon.in product page" width="860"></p>

## What it does

- **Price history.** Lowest, average and highest price over 30 days, 90 days, a year or all time, drawn as a chart.
- **Buy-or-wait verdict.** A plain answer with the reason, and a check for discounts that were never real.
- **Trap prices.** Set the price you want and get a notification when it is reached.
- **Amazon's own price graph.** When Amazon draws its "Price history" chart, HAULS reads the chart data, merges it with its own history and draws the graph with the lowest/highest prices and the "Buy for ₹X with offers" price. An opt-in setting can read it automatically.
- **How soon do you need it?** 2-3 days / 1 week / 1 month changes the buy-or-wait call for fair prices and suggests an alert price.
- **Deal Scanner.** A 0–100 score with the points behind it, and a warning when a price was lifted before a "discount".
- **Background price checks.** While the browser is open, watched items are re-read a few times a day from each store's own data, so history and alerts continue without a visit. Settings shows per-store health.
- **Reviews and seller.** What buyers say (the page's own average and rating split), and a seller card built from the seller's public storefront: rating windows, % positive, volume and recent trend.
- **Other sellers.** Amazon and Flipkart: every seller's price for the same item, with the lowest marked. Myntra: the sellers listed on the page, with a price per size.
- **Impulse Check.** Spots "Only 2 left", countdown timers and sale labels near the product, remembers them across your visits, and shows what it saw: did the timer restart, is the count the same, has the price moved. It never calls a message fake.
- **Same-product compare.** One click compares Amazon, Flipkart and Reliance Digital, and shows only listings it can confirm are the same item: brand, model, version, storage and size are checked and listed on each row. Different models, accessories, used units and other variants are rejected, and the closest rejected item is shown with the reason.
- **Grocery comparison.** Search once and compare Blinkit, DMart and more at your exact pincode. Only stores that confirm delivery to that pincode show a price.
- **Watchlist and sync.** Keep products on a watchlist. Signing in with Google is optional and only syncs your watchlist, saved places and settings.

Supported shops include Amazon.in, Flipkart, Myntra, Croma, Reliance Digital, Tata CLiQ and Snapdeal. HAULS runs in Chrome, Edge, Brave and other Chromium browsers on a computer.

## Install

Download the latest `hauls-share.zip` from the [releases page](../../releases/latest) and follow the [install guide](INSTALL.md). No store account is needed.

## Privacy

Prices you browse are stored in your browser first. Sharing anonymous prices and the Amazon price charts you open, to build community history, is off unless you switch it on. Shared data is kept apart from your name and email and shown only as combined history (several readers per day). Details are in [docs/security.md](docs/security.md).

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

## Author and authenticity

HAULS is designed and built by **[Vishwajeet](https://github.com/kumarvishwajeettrivedi)** ([@kumarvishwajeettrivedi](https://github.com/kumarvishwajeettrivedi)). More about the product: [hauls.in](https://hauls.in/).

- **Official sources:** this repository, the [project website](https://kumarvishwajeettrivedi.github.io/Hauls_Chrome_Extension/) and the [GitHub releases](../../releases). Copies elsewhere are not published by the author.
- **Check your download:** every release carries `SHA256SUMS.txt`. Run `shasum -a 256 hauls-share.zip` and compare it with the value in that file.
- **Cite or reference this project:** use the "Cite this repository" button on GitHub (`CITATION.cff`), and link to this repository. The commit history here shows who wrote what and when.
- **Rights:** see [NOTICE](NOTICE). The code is published for transparency; copying or republishing it as your own work is not permitted without the author's written permission.
- **Security issues:** please open a private security advisory on this repository instead of a public issue.
