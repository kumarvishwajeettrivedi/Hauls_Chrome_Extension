// LIVE compare check (headless Chrome + the real extension on real Amazon.in pages). One browser, sequential, self-cleaning. Prints the source title, and every store row the matcher kept, with its label and the candidate title.
// Run: node tests/e2e/compare-live.mjs "query one" "query two" ...   (defaults to a spread of product kinds)
import { withExt, sleep, poll } from "./lib/ext.mjs"; import { Panel } from "./lib/panel.mjs";
const QS = process.argv.slice(2).length ? process.argv.slice(2) : ["apple 20w usb-c power adapter", "boat airdopes 141", "samsung galaxy m35 5g", "lg 43 inch 4k smart tv", "hp 15 laptop 16gb", "mi power bank 20000mah", "nike revolution running shoes men", "levis 511 jeans men", "prestige induction cooktop", "atomic habits james clear", "philips air fryer", "sony wh-ch520 headphones"];
await withExt({ viewport: { width: 1440, height: 1000 } }, async ({ ctx, sw }) => {
  await sw.evaluate(() => { const o = globalThis.cmpFind; globalThis.__cmp = null; globalThis.cmpFind = async (...a) => { const r = await o(...a); globalThis.__cmp = { id: a[0], r }; return r; }; });
  for (const q of QS) {
    const p = await ctx.newPage(); const out = { q };
    try {
      await p.goto("https://www.amazon.in/s?k=" + encodeURIComponent(q), { waitUntil: "domcontentloaded", timeout: 45000 }); await sleep(2000);
      const href = await p.evaluate(() => { const a = [...document.querySelectorAll('[data-component-type="s-search-result"] h2 a, a.a-link-normal.s-no-outline')].find(x => /\/dp\//.test(x.href) && !/sspa|\/gp\/slredirect/.test(x.href)); return a ? a.href : null; });
      if (!href) { console.log(`\n### ${q}\n  (no search result: robot check or layout)`); await p.close(); continue; }
      await p.goto(href.split("?")[0], { waitUntil: "domcontentloaded", timeout: 45000 }); await p.waitForSelector("span#productTitle", { timeout: 20000 });
      const title = (await p.locator("span#productTitle").first().innerText()).trim();
      const panel = await Panel.attach(ctx, p); await panel.waitKnob(25000); await panel.open(); await sleep(1500);
      await sw.evaluate(() => { globalThis.__cmp = null; });
      await panel.click(".cmp .btn"); await poll(async () => (await sw.evaluate(() => !!globalThis.__cmp)), 40000, 500); await sleep(500);
      const c = await sw.evaluate(() => globalThis.__cmp); const res = (c && c.r && c.r.results) || [], errs = (c && c.r && (c.r.errors || c.r.failed)) || [];
      console.log(`\n### ${q}\n  SOURCE: ${title.slice(0, 220)}`);
      if (!res.length) console.log("  (no confirmed result)", JSON.stringify(errs).slice(0, 160));
      for (const r of res) console.log(`  [${r.confidence}] ${r.store}  ₹${r.price}  ${String(r.title).slice(0, 260)}`);
      if (c && c.r && c.r.closest) for (const r of [].concat(c.r.closest).slice(0, 2)) console.log(`  (closest, not shown as same) ${r.store} ${String(r.title).slice(0, 90)}`);
    } catch (e) { console.log(`\n### ${q}\n  ERROR ${String(e.message).slice(0, 140)}`); }
    await p.close().catch(() => {});
  }
});
console.log("\ndone");
