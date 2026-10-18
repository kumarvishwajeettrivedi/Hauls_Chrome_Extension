// Headless website screenshots: each panel section as its own zoomed image, from the CURRENT panel on a routed sample product (no real network).
// History, seller and watchlist items are SAMPLE data (the site says so). Pincode: Connaught Place, New Delhi. Run: node tests/e2e/site-shots.mjs <outdir>
import { withExt, seed, sleep } from "./lib/ext.mjs";
import { openPage } from "./lib/panel.mjs";
import { routeProduct, key, D } from "./lib/fixtures.mjs";
const OUT = (process.argv[2] || "/tmp/site-raw2").replace(/\/$/, "") + "/", id = "B0F8BVSK21", now = Date.now(), T = "boAt Airdopes 141 Bluetooth Earbuds";
const hist = [[89, 973], [75, 920], [62, 973], [48, 880], [38, 850], [26, 790], [20, 758], [10, 781], [0.05, 766]].map(([d, p]) => [now - d * D, p]);
const sample = (k, title, site, price, mrp, target, wish, img) => ({ [k]: { site, title, image: "https://sample.hauls.test/" + img + ".svg", url: "https://www.amazon.in/dp/" + k.split(":")[1], mrp, last: price, target, wish, hist: [[now - 60 * D, mrp * 0.8], [now - 30 * D, price * 1.12], [now - 2 * D, price]] } });
await mkdirp();
async function mkdirp() { const { mkdirSync } = await import("node:fs"); mkdirSync(OUT, { recursive: true }); }
await withExt({ viewport: { width: 1440, height: 2600 }, scale: 2 }, async ({ ctx, sw }) => {
  const art = { watch: '<rect x="38" y="10" width="24" height="80" rx="8" fill="#334"/><rect x="32" y="30" width="36" height="40" rx="10" fill="#19E68C" stroke="#131316" stroke-width="3"/>', phones: '<path d="M22 60V48a28 28 0 0 1 56 0v12" fill="none" stroke="#131316" stroke-width="7"/><rect x="14" y="52" width="16" height="28" rx="6" fill="#7b61ff"/><rect x="70" y="52" width="16" height="28" rx="6" fill="#7b61ff"/>', buds: '<rect x="22" y="34" width="26" height="34" rx="13" fill="#131316"/><rect x="52" y="34" width="26" height="34" rx="13" fill="#131316"/><circle cx="35" cy="46" r="5" fill="#19E68C"/><circle cx="65" cy="46" r="5" fill="#19E68C"/>', shoe: '<path d="M10 66c0-14 8-26 18-26l14 10 22 4c14 2 26 6 26 16v6H10z" fill="#FFD93D" stroke="#131316" stroke-width="3"/><rect x="10" y="72" width="78" height="8" rx="4" fill="#131316"/>' };
  await ctx.route("https://sample.hauls.test/**", r => { const n = r.request().url().split("/").pop().replace(".svg", ""); r.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#EEF1FF"/>${art[n] || ""}</svg>` }); });
  const url = await routeProduct(ctx, { id, price: 766, mrp: 3990, title: T, seller: { name: "Clicktech Retail Private Ltd", ships: "Amazon", fba: true }, ratings: { total: "91,440", avg: "3.8", dist: { 5: 45, 4: 20, 3: 12, 2: 7, 1: 16 } } });
  await seed(sw, { pin: "110001", loc: { lat: 28.6315, lon: 77.2167, pin: "110001" }, items: {
    [key(id)]: { site: "Amazon", title: T, url, image: "https://sample.hauls.test/buds.svg", hist, mrp: 3990, last: 766, target: 727, wish: true },
    ...sample("amazon.in:B0BTYCRZ6P", "Noise ColorFit Pro 5 Smart Watch", "Amazon", 2999, 7999, 2499, true, "watch"),
    ...sample("amazon.in:B0CHX1W1XY", "Sony WH-CH520 Wireless Headphones", "Amazon", 3990, 5990, 3499, false, "phones"),
    ...sample("flipkart.com:ITMFXZ4GZ6", "Puma Men's Running Shoes", "Flipkart", 1799, 4999, undefined, true, "shoe") } });
  const { panel, p } = await openPage(ctx, url); await panel.waitKnob(); await panel.open(); await sleep(2500);
  const R = await panel.ev(function () { const pick = s => { const e = this.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }; return { sub: pick("main .sub2"), chart: pick("main .chartbox"), buy: pick("main .buynow"), scan: pick("main .scan"), trap: pick("main .trapbox"), rev: pick("main button.rev"), seller: pick("main button.seller"), cmpl: pick("main .stores") }; });
  const panelRect = await panel.rect(".panel"), X = panelRect.x + 10, W = panelRect.w - 20, pad = 12;
  const shot = async (name, a, b) => { if (!a || !b) { console.log("missing", name); return; } await p.screenshot({ path: OUT + name + ".png", clip: { x: X, y: Math.max(0, a.top - pad), width: W, height: b.bottom - a.top + 2 * pad } }); console.log("saved", name); };
  await shot("buy", R.buy, R.buy); await shot("scan", R.scan, R.scan); await shot("history", R.sub, R.chart); await shot("alert", R.trap, R.trap);
  await shot("seller", R.rev, R.seller); await shot("compare", { top: R.cmpl.top - 74 }, R.cmpl);
  await panel.tab(2); await sleep(1500); const c0 = await panel.ev(function () { const els = [...this.querySelectorAll("main div")].filter(d => /Noise ColorFit/.test(d.textContent) && /alert price/i.test(d.textContent) && d.getBoundingClientRect().height < 230); const r = els[els.length - 1].getBoundingClientRect(); return { top: r.top }; }); await p.screenshot({ path: OUT + "watchlist.png", clip: { x: X, y: c0.top - 10, width: W, height: 535 } }); console.log("saved watchlist");
});
console.log("done");
