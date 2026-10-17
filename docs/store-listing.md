# Chrome Web Store listing (copy and paste)

Build: `npm run package` -> `dist/hauls-extension-<version>.zip` · Screenshots: `store-assets/` (1280x800; replace with real ones from your own browser if you like) · Icon: `extension/icons/icon-128.png`

## Name
HAULS – Don't Buy Blind

## Summary (max 132 characters)
See a product's real price history, get a buy-or-wait verdict, set trap prices, and compare grocery prices for your pincode.

## Category / language
Shopping · English (India)

## Description
HAULS helps Indian shoppers stop overpaying.

On product pages for Amazon.in, Flipkart, Myntra, Croma, Reliance Digital, Tata CLiQ, Nykaa, Vijay Sales and Snapdeal, HAULS shows:
• Price history – lowest, average and highest price, with a chart you can view over 30 days, 90 days, a year or all time
• A plain buy-or-wait verdict, and a check for "discounts" that were never real
• Trap prices – set the price you want and get a notification when it is reached
• A wishlist/watchlist that stays in your browser

Grocery comparison for your pincode:
• Prices from Blinkit, DMart and JioMart, with price per 100 g / ml so different pack sizes compare fairly
• Only stores that really deliver to your exact pincode are shown. Save places like Home or Mom's house and switch between them
• Optional: connect JioMart, BigBasket or Zepto to include them. HAULS opens one small window for a few seconds, only when you click

Private by design:
• Your watchlist, history and settings live in your browser first
• Sign in with Google (optional) only to sync across your devices
• Sharing anonymous prices with the community is off unless you turn it on
• No ads, no tracking, no selling data

HAULS is an independent tool and is not affiliated with, or endorsed by, any store named above.

## Single purpose
Show price history and buy-or-wait guidance for products on Indian shopping sites, and compare grocery prices for the user's pincode.

## Permission justifications
| Permission | Why |
|---|---|
| storage | Keeps the watchlist, price history, trap prices, saved pincodes and settings in the browser. |
| alarms | Re-checks tracked prices and syncs (when signed in) on a schedule. |
| notifications | Tells the user when a trap price is reached. |
| scripting | Registers the page reader for stores the user explicitly connects (grocery stores, independent Shopify stores). |
| identity | Optional Google sign-in (chrome.identity) to sync the watchlist and settings between devices. |
| Host: amazon.in, flipkart.com, myntra.com, croma.com, reliancedigital.in, tatacliq.com, nykaa.com, vijaysales.com, snapdeal.com | Read the product title and price on product pages to record price history and show the verdict. |
| Host: blinkit.com, digital.dmart.in, dmart.in, jiomart.com | Fetch grocery search results so prices can be compared. |
| Host: nominatim.openstreetmap.org | Turn a pincode into a location (and back) so only stores that deliver there are shown. |
| Host: ipwho.is | Approximate location when the browser's own location is unavailable, only if the user asks. |
| Host: the project's Supabase URL | Account, sync and optional community price data. |
| Optional hosts (https://*/*) | Requested only when the user clicks Enable independent stores or Connect on a grocery store. Never granted automatically. |

Remote code: none. All code ships in the package.

## Privacy practices tab
- Personally identifiable information: yes (name, email, profile picture) – only if the user signs in with Google.
- Website content: yes (product title and price on pages the user views) – kept locally; shared anonymously only if the user opts in.
- Location: yes (pincode and approximate coordinates) – to show deliverable stores; saved locally and synced when signed in.
- User activity / web history / health / financial / authentication data / personal communications: no.
- Certify: data is not sold, not used for anything unrelated to the single purpose, and not used for creditworthiness or lending.
- Privacy policy URL: https://hauls.in/privacy

## After the first upload
1. The store assigns the extension ID (it is different from the development ID). Copy it.
2. Supabase -> Authentication -> URL Configuration -> add `https://<store-id>.chromiumapp.org/`.
3. Google Cloud -> Auth Platform -> Clients -> your web client -> Authorized redirect URIs -> add the same URL.
4. In the Google Auth Platform, click Publish app (no logo, so no brand verification is required).
5. Run `supabase/migrations/0009_ext_history_privacy.sql` in the Supabase SQL editor (if you have not already).
6. Test sign-in from the installed store version, then publish the listing.
