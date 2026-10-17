// Live check of the Impulse Check collector on REAL pages (Flipkart, Myntra, Shopify brand stores): loads impulse.js into the page and prints what the card would show.
// Usage: node tests/live/validate-urgency.mjs  (one browser job; always closed)
import { chromium } from "playwright-core";
import fs from "node:fs";
import { CHROME } from "../e2e/lib/ext.mjs";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", src = fs.readFileSync(new URL("../../extension/impulse.js", import.meta.url), "utf8");
const br = await chromium.launch({ executablePath: CHROME, headless: true }), out = [];
try {
  const ctx = await br.newContext({ userAgent: UA, locale: "en-IN", viewport: { width: 1366, height: 900 } }), pg = await ctx.newPage(), urls = [];
  for (const q of ["mixer grinder", "smartphone", "headphones", "trimmer"]) { await pg.goto("https://www.flipkart.com/search?q=" + encodeURIComponent(q), { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}); await pg.waitForTimeout(2000); (await pg.$$eval("a[href*='/p/itm']", as => as.map(a => a.href.split("&")[0]))).slice(0, 3).forEach(u => urls.push(u)); }
  for (const l of ["men-tshirts", "women-kurtas", "men-casual-shoes", "women-tops"]) { await pg.goto("https://www.myntra.com/" + l, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}); await pg.waitForTimeout(2000); (await pg.$$eval("a[href$='/buy']", as => as.map(a => a.href))).slice(0, 6).forEach(u => urls.push(u)); }
  for (const d of ["www.boat-lifestyle.com", "mamaearth.in", "mcaffeine.com", "www.beardo.in", "www.giva.co", "thesleepcompany.in"]) { try { const j = await (await fetch(`https://${d}/products.json?limit=6`, { headers: { "user-agent": UA } })).json(); j.products.slice(0, 5).forEach(p => urls.push(`https://${d}/products/${p.handle}`)); } catch {} }
  console.log("pages", urls.length); let withCue = 0;
  for (const u of urls) {
    await pg.goto(u, { waitUntil: "domcontentloaded", timeout: 35000 }).catch(() => {}); await pg.waitForTimeout(3500);
    const r = await pg.evaluate(code => { try { (0, eval)(code + "\nwindow.__imp = { impCues, impCollectNear };"); const parts = window.__imp.impCollectNear(document), cues = window.__imp.impCues(parts); return { ok: true, h1: !!document.querySelector("h1"), parts: parts.map(p => p.text), cues: cues.map(c => c.kind + ":" + c.text) }; } catch (e) { return { ok: false, err: String(e).slice(0, 100) }; } }, src).catch(e => ({ ok: false, err: String(e).slice(0, 100) }));
    out.push({ u, ...r }); if (r.ok && r.cues.length) withCue++; console.log(u.replace(/^https:\/\/(www\.)?/, "").slice(0, 70).padEnd(70), r.ok ? (r.h1 ? JSON.stringify(r.cues) : "no-h1") : "ERR " + r.err);
  }
  console.log("pages with at least one cue:", withCue, "of", urls.length); fs.writeFileSync("/tmp/imp/validate.json", JSON.stringify(out, null, 1));
} finally { await br.close(); }
