// One headless run: seeds a cached grocery result (through the REAL rank()), types the search, screenshots the card grid. No live store calls.
import { withExt, seed, sleep, poll } from "./lib/ext.mjs";
import { Panel, openPage } from "./lib/panel.mjs";
import { routeProduct } from "./lib/fixtures.mjs";
const svg = (c, d) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="58" rx="40" ry="${d}" fill="${c}"/><rect x="18" y="30" width="64" height="12" rx="6" fill="#7a4a21"/></svg>`);
const RAW = [["Swastika Indian White Marble Chakla - Roti Maker", 429, "1 piece", "Blinkit", "#ddd", 22], ["UrbanFix Chakla Belan Set for Kitchen & Home Durable", 574, "1 pack", "Instamart", "#b07a3b", 24], ["Wood Rolling Board/Chakla - With Rolling Pin, Brown", 309, "1 piece", "BigBasket", "#e8b66f", 26],
  ["Chakla - Wooden OGGN", 209, "1 piece", "BigBasket", "#8a6a3a", 14], ["HAZEL Chakla Belan Set (Wood)", 419, "2 pcs", "Blinkit", "#c89458", 20], ["ReeQ Heavy Duty Chakla & Rolling Pin Set (Stainless Steel)", 999, "2 pcs", "Blinkit", "#bbb", 18], ["Vesta Homes Chakla Belan Set with Stand (Wood)", 949, "3 pcs", "Blinkit", "#7b4a2a", 22]]
  .map(([name, price, pack, store, c, d]) => ({ name, price, mrp: Math.round(price * 1.18), pack, store, inStock: true, image: svg(c, d), url: "https://example.com/p" }));
await withExt({ viewport: { width: 1280, height: 900 } }, async ({ ctx, sw }) => {
  const url = await routeProduct(ctx, {}); const { panel, p } = await openPage(ctx, url); await panel.waitKnob();
  const ranked = await sw.evaluate(items => rank(items, "chakla"), RAW);
  await sw.evaluate(out => cache.set("grocery", "chakla|842001", out, 3e5), { items: ranked, errors: [], unconfirmed: ["JioMart"] });
  await seed(sw, { pin: "842001", loc: { lat: 26.1197, lon: 85.391, pin: "842001" } });
  await panel.open(); await panel.tab(1); await sleep(400);
  await panel.type("main input", "chakla", { i: 1 }); await p.keyboard.press("Enter");
  await poll(async () => (await panel.count("main .card")) > 0, 15000, 300); await sleep(600);
  console.log("cards:", await panel.count("main .card"), "cheapest:", await panel.ev(function () { return [...this.querySelectorAll("main .card.best .nm")].map(n => n.textContent); }), "logos:", await panel.ev(function () { return [...this.querySelectorAll("main .card .lg img")].length; }));
  await p.screenshot({ path: process.argv[2] || "/tmp/grid.png", clip: { x: 1280 - 460, y: 0, width: 460, height: 900 } });
  await panel.run("main", function () { this.scrollTop = this.scrollHeight; }); await sleep(400);
  await p.screenshot({ path: (process.argv[2] || "/tmp/grid.png").replace(".png", "-bottom.png"), clip: { x: 1280 - 460, y: 0, width: 460, height: 900 } });
});
console.log("done");
