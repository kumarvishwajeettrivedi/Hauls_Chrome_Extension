// OBSOLETE until updated: this script captured the full-page Home screen (home.html), which was removed in 1.17.1. Capture the grocery and watchlist tabs from the panel on a product page instead.
throw new Error("store-shots/site-capture need updating: home.html no longer exists");
// Chrome Web Store screenshots (1280x800) from the real UI with sample data. Run: node tests/e2e/store-shots.mjs
import { withExt, seed, sleep, poll } from "./lib/ext.mjs";
import { Panel, openPage } from "./lib/panel.mjs";
import { D, seedItem, routeProduct } from "./lib/fixtures.mjs";
const OUT = new URL("../../store-assets/", import.meta.url).pathname;
const svg = (c, r) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="20" y="30" width="60" height="50" rx="10" fill="${c}"/><rect x="30" y="18" width="40" height="16" rx="6" fill="#131316" opacity=".85"/></svg>`);
const now = Date.now(), hist = [[now - 70 * D, 1299], [now - 55 * D, 1199], [now - 40 * D, 799], [now - 25 * D, 899], [now - 12 * D, 849], [now - 36e5, 830]];
await withExt({ viewport: { width: 1280, height: 800 } }, async ({ ctx, sw, extId }) => {
  // 1. product page: verdict + history
  await seed(sw, { items: seedItem("B0TESTPRD1", hist), pin: "560001" });
  const { panel, p } = await openPage(ctx, await routeProduct(ctx, { id: "B0TESTPRD1", price: 830, mrp: 1299 })); await panel.waitKnob(); await panel.open(); await sleep(1800); await p.screenshot({ path: OUT + "1-price-history-verdict.png" });
  // 2. grocery results (home page)
  const items = ["Amul Butter Pasteurised 500 g|285|300|500 g|Blinkit|#f3d35c", "Amul Butter Unsalted 100 g|60|62|100 g|DMart|#f5e6a8", "Mother Dairy Butter 100 g|58|60|100 g|Blinkit|#f7efc0", "Britannia Salted Butter 100 g|62|65|100 g|DMart|#ffe08a", "Nandini Butter 200 g|118|120|200 g|Blinkit|#f0d98c", "Amul Garlic Butter 100 g|70|75|100 g|Blinkit|#d6e8b5"].map(s => { const [name, price, mrp, pack, store, c] = s.split("|"); return { name, price: +price, mrp: +mrp, pack, store, inStock: true, image: svg(c), url: "https://example.com" }; });
  await seed(sw, { pin: "560001", loc: { lat: 12.97, lon: 77.59, pin: "560001" } });
  await sw.evaluate(it => cache.set("grocery", "amul butter|560001", { items: rank(it, "amul butter"), errors: [], unconfirmed: [], connect: [], later: [] }, 3e5), items);
  const h = await ctx.newPage(); await h.goto(`chrome-extension://${extId}/home.html`); const hp = await Panel.attach(ctx, h); await hp.waitFor(".w.app", 10000); await sleep(600);
  await hp.type("main .pi input", "amul butter", { i: 1 }); await h.keyboard.press("Enter"); await poll(async () => (await hp.count("main .card")) > 0, 15000, 300); await sleep(700); await h.screenshot({ path: OUT + "2-grocery-compare.png" });
  // 3. watchlist with trap prices
  const more = { ...seedItem("B0TESTPRD1", hist, { wish: true, target: 750 }), ...seedItem("B0TESTPRD2", hist.map(([t, v]) => [t, Math.round(v * 1.8)]), { wish: true, target: 1200, title: "Noise ColorFit Pro Smartwatch" }) };
  await seed(sw, { items: more }); await hp.click(".tabs button", 1); await sleep(1200); await h.screenshot({ path: OUT + "3-watchlist-trap-prices.png" });
  // 4. settings
  const s = await ctx.newPage(); await s.goto(`chrome-extension://${extId}/options.html`); await sleep(900); await s.screenshot({ path: OUT + "4-settings.png" });
  console.log("done");
});
