// One headless live Amazon product with the panel open, scrolled to show every card. Run: node tests/e2e/live-shot.mjs <asin> <out.png>
import { withExt, sleep, poll, store } from "./lib/ext.mjs"; import { Panel } from "./lib/panel.mjs";
const [asin = "B0DGJ8YZDF", out = "/tmp/live.png"] = process.argv.slice(2);
await withExt({ viewport: { width: 1440, height: 1900 } }, async ({ ctx, sw }) => {
  const p = await ctx.newPage(); await p.goto(`https://www.amazon.in/dp/${asin}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await poll(async () => Object.keys((await store(sw, "items")).items || {}).length > 0, 30000, 1000);
  const panel = await Panel.attach(ctx, p); await panel.waitKnob(25000); await panel.open(); await sleep(1500);
  await p.screenshot({ path: out, clip: { x: 1000, y: 0, width: 440, height: 1900 } }); console.log("saved", out);
});
