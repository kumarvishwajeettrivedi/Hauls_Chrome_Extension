<p align="center"><img src="site/img/logo.png" width="72" alt="HAULS"></p>

<h1 align="center">HAULS</h1>
<p align="center"><b>Don't buy blind.</b><br>A free browser extension that shows the real price history and a plain buy-or-wait answer on Indian shopping sites.</p>

<p align="center">
  <a href="../../releases/latest"><img alt="latest release" src="https://img.shields.io/github/v/release/kumarvishwajeettrivedi/Hauls_Chrome_Extension?label=release"></a>
  <img alt="Chrome Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-014baa">
</p>
<p align="center">
  <a href="https://kumarvishwajeettrivedi.github.io/Hauls_Chrome_Extension/">Website</a> ·
  <a href="../../releases/latest/download/hauls-share.zip">Download</a> ·
  <a href="INSTALL.md">Install guide</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<p align="center"><img src="site/img/hero.jpg" alt="HAULS panel open on an Amazon.in product page" width="860"></p>

## What it does

Open a product on Amazon.in, Flipkart or Myntra and HAULS adds a small tab on the right edge of the page. Click it to see how the price has moved, whether the discount is real, who else sells the item, and whether to buy now or wait.

- **Price history** for 30 days, 90 days, a year or all time.
- **Buy-or-wait verdict**, tuned to how soon you need the item.
- **Deal Scanner** score, with a warning when a price was raised before a "discount".
- **Impulse Check** for "Only 2 left" labels and countdown timers.
- **Seller card** and **other sellers** for the same item.
- **Compare across stores**, listing only results confirmed to be the same product.
- **Price alerts** and an optional email alert when your price is reached.
- **Grocery prices** at your pincode (Beta).

Price history, the verdict and compare work without an account. The watchlist and price alerts need a Google sign-in.

## Works on

Amazon.in, Flipkart and Myntra, with price tracking for Croma, Reliance Digital, Tata CLiQ, Nykaa, Vijay Sales and Snapdeal. Chrome, Edge, Brave and other Chromium browsers on a computer.

## Your privacy

- Your price history and settings stay in your browser.
- Signing in backs up only your watchlist and settings, visible only to you.
- Sharing prices with the community is off unless you turn it on.
- Items you delete are removed from the server. HAULS does not sell data and has no ads or trackers.

## Install

1. Download `hauls-share.zip` and `SHA256SUMS.txt` from the [latest release](../../releases/latest).
2. Check the download: `shasum -a 256 hauls-share.zip` must match the line in `SHA256SUMS.txt`.
3. Unzip it, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select the folder.

Full steps for each browser: [INSTALL.md](INSTALL.md).

## Security

No remote code, a narrow permission set, and only the public sign-in key in the extension. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

All rights reserved; see [NOTICE](NOTICE). The code is public for transparency. Built by [Vishwajeet](https://github.com/kumarvishwajeettrivedi). An independent tool, not affiliated with any store it works with. Prices come from the pages you visit and may differ at checkout.
