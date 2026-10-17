// Headless capture of urgency-looking short texts on REAL product pages (Flipkart, Myntra, Shopify brand stores), with their distance from the product title.
// Usage: node tests/live/capture-urgency.mjs flipkart|myntra|shopify [pagesPerSite]. One browser job; always closed. Writes tests/fixtures/impulse/<site>-<n>.json
import { chromium } from "playwright-core";
import fs from "node:fs";
import { CHROME } from "../e2e/lib/ext.mjs";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", which = process.argv[2], N = +(process.argv[3] || 6);
const SHOPIFY = ["www.boat-lifestyle.com", "mamaearth.in", "mcaffeine.com", "www.beardo.in", "www.giva.co", "thesleepcompany.in"];
const GATE = /left|hurry|ends? in|sale|deal|viewing|watching|selling fast|only|limited|offer ends|\d{1,2}:\d{2}:\d{2}|\bbought\b|\bsold\b|in (?:the )?(?:last|past)|almost|stock|last chance|today only|rush|fast/i;
const br = await chromium.launch({ executablePath: CHROME, headless: true });
const collect = () => { const h1 = document.querySelector("h1"), top0 = h1 ? h1.getBoundingClientRect().top + scrollY : 0, out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue.replace(/\s+/g, " ").trim(), pe = n.parentElement; if (!t || t.length > 110 || t.length < 4 || !pe || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(pe.tagName)) continue; if (!window.__GATE.test(t)) continue;
    const r = pe.getBoundingClientRect(); if (!r.width || !r.height) continue; const anc = []; for (let e = pe, i = 0; e && i < 8; e = e.parentElement, i++) anc.push((e.id || "") + "." + String(e.className && e.className.baseVal === undefined ? e.className : "").split(" ")[0]);
    out.push({ t, rel: Math.round(r.top + scrollY - top0), tag: pe.tagName, anc: anc.slice(0, 5).join(" < ").slice(0, 160) }); }
  return { title: h1 ? h1.innerText.slice(0, 80) : document.title.slice(0, 80), h1: !!h1, cands: out.slice(0, 60) }; };
try {
  const ctx = await br.newContext({ userAgent: UA, locale: "en-IN", viewport: { width: 1366, height: 900 } }); await ctx.addInitScript(g => { window.__GATE = new RegExp(g.s, g.f); }, { s: GATE.source, f: GATE.flags });
  const pg = await ctx.newPage(), urls = [];
  if (which === "flipkart") for (const q of ["mixer grinder", "smartphone", "sports shoes", "t shirt"]) { await pg.goto("https://www.flipkart.com/search?q=" + encodeURIComponent(q), { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}); await pg.waitForTimeout(2500); (await pg.$$eval("a[href*='/p/itm']", as => as.map(a => a.href.split("&")[0]))).slice(0, 4).forEach(u => urls.push(u)); }
  else if (which === "myntra") for (const l of ["men-tshirts", "women-kurtas", "men-casual-shoes"]) { await pg.goto("https://www.myntra.com/" + l, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}); await pg.waitForTimeout(2500); (await pg.$$eval("a[href$='/buy']", as => as.map(a => a.href))).slice(0, 4).forEach(u => urls.push(u)); }
  else for (const d of SHOPIFY) { try { const j = await (await fetch(`https://${d}/products.json?limit=3`, { headers: { "user-agent": UA } })).json(); j.products.slice(0, 2).forEach(p => urls.push(`https://${d}/products/${p.handle}`)); } catch {} }
  console.log("urls", urls.length); let i = 0;
  for (const u of [...new Set(urls)].slice(0, N)) {
    await pg.goto(u, { waitUntil: "domcontentloaded", timeout: 35000 }).catch(() => {}); await pg.waitForTimeout(4000);
    const r = await pg.evaluate(collect).catch(e => ({ err: String(e) })); if (r.err) { console.log(u, r.err.slice(0, 80)); continue; }
    fs.writeFileSync(`tests/fixtures/impulse/${which}-${++i}.json`, JSON.stringify({ site: which, url: u, ...r }, null, 1));
    console.log("\n" + u.slice(0, 90), "|", r.title, "| h1:", r.h1); r.cands.filter(c => c.rel > -300 && c.rel < 1600).slice(0, 14).forEach(c => console.log("  ", c.rel, c.tag, JSON.stringify(c.t), "<", c.anc.slice(0, 70)));
  }
} finally { await br.close(); }
