// Headless capture of REAL Amazon.in product pages, trimmed to the urgency-relevant zones, for the Impulse Check fixtures. One browser job; always closed.
// Usage: node tests/live/capture-amazon-urgency.mjs [maxPages]   (writes tests/fixtures/impulse/amazon-<ASIN>.html + prints a summary)
import { chromium } from "playwright-core";
import fs from "node:fs";
import { CHROME } from "../e2e/lib/ext.mjs";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", MAX = +(process.argv[2] || 40);
const ZONES = ["#productTitle", "#availability", "#dealBadge_feature_div", "#socialProofingAsinFaceout_feature_div", "#corePrice_feature_div", "#apex_desktop", "#acrCustomerReviewText"];
const br = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await br.newContext({ userAgent: UA, locale: "en-IN", viewport: { width: 1280, height: 900 } }), pg = await ctx.newPage(), asins = new Set();
  for (const q of ["mixer grinder", "mobile phone", "smart watch", "earbuds", "laptop", "air fryer", "trimmer", "backpack", "water bottle", "television", "fan", "kitchen appliance"]) {
    await pg.goto("https://www.amazon.in/s?k=" + encodeURIComponent(q), { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    (await pg.$$eval("[data-asin]", els => els.map(e => e.getAttribute("data-asin")).filter(a => /^[A-Z0-9]{10}$/.test(a)))).slice(0, 6).forEach(a => asins.add(a));
  }
  console.log("asins", asins.size); const seen = [];
  for (const a of [...asins].slice(0, MAX)) {
    await pg.goto("https://www.amazon.in/dp/" + a, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}); await pg.waitForTimeout(1200);
    const r = await pg.evaluate(zs => { const out = {}; for (const z of zs) { const e = document.querySelector(z); out[z] = e ? { html: e.outerHTML.slice(0, 6000), text: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400) } : null; }
      const main = (document.querySelector("#centerCol") || document.body).innerText, carousel = (document.body.innerText.match(/only\s+\d+\s+left[^\n]{0,24}/gi) || []).length; return { out, anywhere: carousel, captcha: /enter the characters|robot check/i.test(document.body.innerText), timerText: (main.match(/(ends in|deal ends|time left)[^\n]{0,30}/i) || [])[0] || "" }; }, ZONES);
    if (r.captcha) { console.log(a, "captcha"); continue; }
    const av = r.out["#availability"] ? r.out["#availability"].text : "", deal = r.out["#dealBadge_feature_div"] ? r.out["#dealBadge_feature_div"].text : "", core = r.out["#corePrice_feature_div"] ? r.out["#corePrice_feature_div"].text : "", sp = r.out["#socialProofingAsinFaceout_feature_div"] ? r.out["#socialProofingAsinFaceout_feature_div"].text : "";
    const cue = /only\s+\d+\s+left/i.test(av) ? "STOCK" : /ends in|\d{1,2}:\d{2}:\d{2}/i.test(deal + r.timerText) ? "TIMER" : /limited time deal|deal of the day|lightning/i.test(deal + core) ? "DEAL" : /bought in past/i.test(sp) ? "BOUGHT" : r.anywhere ? "CAROUSEL-ONLY" : "none";
    console.log(a, cue, JSON.stringify({ av: av.slice(0, 50), deal: deal.slice(0, 50), sp: sp.slice(0, 30), timer: r.timerText })); seen.push(a + ":" + cue);
    if (cue !== "none") fs.writeFileSync(`tests/fixtures/impulse/amazon-${a}.${cue.toLowerCase()}.json`, JSON.stringify({ asin: a, cue, zones: r.out }, null, 1));
  }
  console.log(seen.join(" "));
} finally { await br.close(); }
