// Live accuracy probe for cross-store compare: product titles come from real Amazon.in search results, then cmpFind runs in the service worker.
// Prints one line per product so a human can judge precision. Run: node tests/e2e/compare-eval.mjs  (one headless Chrome, sequential)
import { withExt } from "./lib/ext.mjs";
const QUERIES = process.argv.slice(2).length ? process.argv.slice(2) : ["iphone 15 128gb", "samsung galaxy s24", "oneplus nord ce4", "boat airdopes 141", "sony wh-1000xm5", "hp 15 laptop 16gb", "lenovo ideapad slim 3", "samsung 55 inch 4k tv", "philips air fryer", "prestige pressure cooker 5l", "nike revolution 7 running shoes", "levis 511 jeans", "atomic habits book", "dettol handwash 900ml"];
await withExt({}, async ({ sw }) => {
  for (const q of QUERIES) {
    const src = await sw.evaluate(async q2 => { try { const r = await fetch("https://www.amazon.in/s?k=" + encodeURIComponent(q2), { credentials: "include" }); return cmpParseAmazon(await r.text()).slice(0, 1); } catch (e) { return []; } }, q);
    if (!src.length) { console.log(`\n## ${q}: no Amazon source row`); continue; }
    const p = src[0]; const res = await sw.evaluate(async x => { cmpCache.clear(); return cmpFind({ title: x.title, brand: x.brand, site: "Amazon", price: x.price }); }, p);
    console.log(`\n## ${q}\n   SRC  ₹${p.price}  [${p.brand}] ${p.title.slice(0, 100)}\n   query: ${await sw.evaluate(x => cmpQuery(x.title, x.brand), p)}`);
    for (const r of res.results) console.log(`   ${r.confidence.padEnd(6)} ${r.store.padEnd(17)} ₹${r.price}  ${r.title.slice(0, 80)}`);
    for (const n of res.near || []) console.log(`   near   ${n.store.padEnd(17)} ₹${n.price}  ${n.why}: ${n.title.slice(0, 70)}`);
    if (res.failed.length) console.log("   failed:", res.failed.join(", "));
    if (!res.results.length && !(res.near || []).length) console.log("   (nothing)", JSON.stringify(res.seen));
  }
});
