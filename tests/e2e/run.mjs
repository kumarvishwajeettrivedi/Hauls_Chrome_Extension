#!/usr/bin/env node
// HAULS end-to-end regression suite.  Usage: node tests/e2e/run.mjs [--only 4,6,live] [--no-live] [--retries N]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { withExt, seed, seedSession, sessionOf, store, sleep, poll, ROOT, EXT, CHROME } from "./lib/ext.mjs";
import { Panel, openPage } from "./lib/panel.mjs";
import { D, inr, dshort, monthKey, key, seedItem, routeProduct, routeLd, fakeSupabase, SESSION, verdictCases } from "./lib/fixtures.mjs";
import { BLOCK, CASES, pageTruth, pageState } from "./lib/live.mjs";

const A = createRequire(import.meta.url)("../../extension/analysis.js"); // the verdict maths itself: the nudge must show exactly what buyWait says
const argv = process.argv.slice(2), arg = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
const ONLY = (arg("--only") || "").split(",").filter(Boolean), NOLIVE = argv.includes("--no-live"), RETRIES = +(arg("--retries") ?? 1);

class Skip extends Error {}
const mkT = () => ({ fails: [], notes: [],
  check(c, m) { if (!c) this.fails.push(m); return !!c; }, note(m) { this.notes.push(m); },
  skip(r) { throw new Skip(r); } });

const PRODUCT_ID = "B0TESTPRD1";
// Opens a routed synthetic product page with the panel ready.
async function product(ctx, { id = PRODUCT_ID, price = 830, mrp = 1299, seller = null, ratings = null, title, offerLine = 0 } = {}) {
  const url = await routeProduct(ctx, { id, price, mrp, seller, ratings, offerLine, ...(title ? { title } : {}) });
  const r = await openPage(ctx, url); if (!r.panel || !(await r.panel.has(".knob"))) throw new Error("knob did not appear");
  return { ...r, url };
}
const lum = c => { const m = c.match(/[\d.]+/g).map(Number), f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const HIST = now => [[now - 70 * D, 1299], [now - 55 * D, 1199], [now - 40 * D, 799], [now - 25 * D, 899], [now - 12 * D, 849], [now - 36e5, 830]];
// Hearts and price alerts need a Google sign-in (the background answers {error:"signin"} otherwise): tests of what happens AFTER saving start signed in with a fake session + fake Supabase.
const signIn = async (ctx, sw, profile = {}) => { const api = await fakeSupabase(ctx); await seedSession(sw, SESSION); await seed(sw, { profile: { plan: "free", contribute: false, name: "Test User", ...profile } }); return api; };

const tests = [];
const test = (id, name, fn, o = {}) => tests.push({ id, name, fn, ...o });

// ---------------------------------------------------------------- 1 smoke
test("1", "smoke: loads, SW up, knob shows, no console errors", t => withExt({}, async ({ ctx, sw, errs }) => {
  t.check(/background\.js$/.test(sw.url()), "service worker is background.js: " + sw.url());
  const m = await sw.evaluate(() => chrome.runtime.getManifest());
  t.check(m.manifest_version === 3 && /HAULS/.test(m.name), "manifest v3 + name");
  const { panel } = await product(ctx);
  await panel.open(); await panel.tab(1); await panel.tab(2); await panel.tab(0);
  t.check(await panel.has(".hero .price"), "price hero rendered");
  t.check((await panel.text(".hero .price")).includes("830"), "hero price shows ₹830");
  t.check(errs.length === 0, "extension console errors: " + errs.join(" | "));
}));

// ---------------------------------------------------------------- 2 notch
test("2", "notch: drag moves, no open, persists, arrow keys", t => withExt({}, async ({ ctx, sw }) => {
  const { p, panel, url } = await product(ctx);
  const topOf = () => panel.run(".knob", function () { return this.getBoundingClientRect().top; });
  const r0 = await panel.rect(".knob"), cx = r0.x + r0.w / 2, cy = r0.y + r0.h / 2;
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy + 80, { steps: 5 }); await p.mouse.move(cx, cy + 200, { steps: 8 }); await p.mouse.up(); await sleep(500);
  const t1 = await topOf();
  t.check(t1 > r0.top + 100, `drag moved knob down (top ${Math.round(r0.top)} -> ${Math.round(t1)})`);
  t.check(!(await panel.has(".w.open")), "drag did not open the panel");
  const saved = (await store(sw, "knobY")).knobY; t.check(typeof saved === "number" && Math.abs(saved * 900 - t1) < 12, "knobY saved ≈ position: " + saved);
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await sleep(700);
  const t2 = await topOf(); t.check(Math.abs(t2 - t1) < 3, `position persists after reload (${Math.round(t1)} vs ${Math.round(t2)})`);
  await panel.focus(".knob"); await p.keyboard.press("ArrowUp"); await sleep(250); const t3 = await topOf();
  t.check(Math.abs((t2 - t3) - 28) < 2, `ArrowUp moves 28px up (${Math.round(t2)} -> ${Math.round(t3)})`);
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowDown"); await sleep(250); const t4 = await topOf();
  t.check(Math.abs((t4 - t3) - 56) < 2, `2x ArrowDown moves 56px down (${Math.round(t3)} -> ${Math.round(t4)})`);
  t.check(!(await panel.has(".w.open")), "arrow keys do not open the panel");
  await panel.click(".knob"); await panel.waitFor(".w.open", 3000); t.check(await panel.has(".w.open"), "plain click still opens panel");
}));

// ---------------------------------------------------------------- 3 panel
test("3", "panel: tabs, heart, trap price, Escape", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw);
  const { p, panel } = await product(ctx), k = key(PRODUCT_ID);
  await panel.open();
  t.check((await panel.count(".tabs button")) === 3, "3 tabs");
  t.check(await panel.has(".hero .price") && await panel.has(".chartbox, .chartbox p") && await panel.has(".vcard") && await panel.has(".trapbox"), "product tab sections render");
  await panel.tab(1); t.check((await panel.count("main input")) === 2 && await panel.has("main .btn.full"), "grocery tab: 2 inputs + Find button");
  await panel.tab(2); t.check(await panel.has("main .empty") || await panel.has("main .wrow"), "watchlist tab renders");
  await panel.tab(0);
  await panel.click(".heart"); await poll(async () => (await store(sw, "items")).items?.[k]?.wish === true, 4000);
  t.check((await store(sw, "items")).items[k].wish === true, "heart persists wish=true in storage");
  t.check(await panel.has(".heart.on"), "heart shows on state");
  await panel.tab(2); t.check((await panel.count("main .wrow")) === 1, "watchlist lists the hearted item"); await panel.tab(0);
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open();
  t.check(await panel.has(".heart.on"), "heart still on after reload");
  const goTxt = await panel.text(".trapbox .btn"); t.check(/Set/.test(goTxt), "new-trap button says Set: " + goTxt);
  await panel.type(".trapbox input", "700"); await panel.click(".trapbox .btn");
  await poll(async () => (await store(sw, "items")).items?.[k]?.target === 700, 4000);
  t.check((await store(sw, "items")).items[k].target === 700, "trap price 700 saved");
  t.check(!!(await poll(async () => (await panel.has(".trapbox .link-btn")) && !(await panel.has(".trapbox .btn")), 5000)), "Set button replaced by Remove link once a trap exists");
  await panel.focus(".info"); await panel.click(".info"); await sleep(400);
  t.check(await panel.has(".w.sheetopen"), "details sheet opens");
  await panel.focus(".info"); await p.keyboard.press("Escape"); await sleep(400);
  t.check(!(await panel.has(".w.sheetopen")) && await panel.has(".w.open"), "Escape #1 closes sheet, panel stays");
  await p.keyboard.press("Escape"); await sleep(500);
  t.check(!(await panel.has(".w.open")), "Escape #2 closes panel");
}));

// ---------------------------------------------------------------- 4 chart
test("4", "chart: hover accuracy, y labels, step line, pill, knob delta", t => withExt({}, async ({ ctx, sw }) => {
  const now = Date.now(), H = HIST(now);
  await seed(sw, { items: seedItem(PRODUCT_ID, H) });
  const { panel } = await product(ctx, { price: 830 }); await panel.open();
  t.check((await panel.count(".cw svg")) === 1, "chart svg present");
  const probe = ago => panel.run(".cw svg", function (ago, t0) { const r = this.getBoundingClientRect(), tn = Date.now(), tt = tn - ago * 864e5, fx = 6 + (tt - t0) / (tn - t0) * 288;
    this.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + fx / 300 * r.width, clientY: r.top + 10, bubbles: true })); return this.parentElement.querySelector(".tip").textContent; }, [ago, H[0][0]]);
  for (const [ago, want] of [[60, 1299], [50, 1199], [30, 799], [20, 899], [8, 849], [2, 849]]) {
    const tip = await probe(ago), exp = `${inr(want)} · ${dshort(Date.now() - ago * D)}`;
    t.check(tip === exp, `hover ${ago}d ago: tooltip "${tip}" expected "${exp}"`);
  }
  const edge = await probe(0); t.check(edge.startsWith("₹830"), `hover at right edge shows current ₹830: "${edge}"`);
  t.check((await panel.text(".yl.t")) === "₹1,299" && (await panel.text(".yl.b")) === "₹799", "y labels = max ₹1,299 / min ₹799");
  const d = await panel.run(".cw .ln", function () { return this.getAttribute("d"); });
  const pts = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => [+m[1], +m[2]]);
  let axis = true, mono = true; for (let i = 1; i < pts.length; i++) { if (pts[i][0] !== pts[i - 1][0] && pts[i][1] !== pts[i - 1][1]) axis = false; if (pts[i][0] < pts[i - 1][0]) mono = false; }
  t.check(axis, "step line is axis-aligned (only horizontal/vertical segments)"); t.check(mono, "x never goes backwards");
  t.check(Math.abs(pts.at(-1)[0] - 294) < 0.2, "line extends to today (x=294): " + pts.at(-1)[0]);
  t.check(pts.every(q => q[1] >= 13.9 && q[1] <= 76.1), "y within plot area");
  t.check(Math.abs(pts[0][1] - 14) < 0.2 && Math.abs(Math.max(...pts.map(q => q[1])) - 76) < 0.2, `max price drawn at top (y=${pts[0][1]}), min at bottom (y=${Math.max(...pts.map(q => q[1]))})`);
  t.check(new Set(pts.map(q => q[1])).size === 6, "6 distinct price levels drawn: " + new Set(pts.map(q => q[1])).size);
  const pill = await panel.text(".chg-pill"), expPill = `▼ ₹19 · 2% vs ${dshort(H[4][0])}`;
  t.check(pill.trim() === expPill, `last-change pill "${pill.trim()}" expected "${expPill}"`);
  const kd = await panel.text(".delta"); t.check(kd.trim() === "↓₹19", `knob delta "${kd.trim()}" expected "↓₹19"`);
}));

// ---------------------------------------------------------------- 5 verdicts
test("5", "verdicts: Buy / Wait / Fair / Early + deal meter", t => withExt({}, async ({ ctx, sw }) => {
  const now = Date.now(), items = {};
  for (const c of verdictCases(now)) if (c.hist.length) Object.assign(items, seedItem(c.id, c.hist));
  await seed(sw, { items });
  for (const c of verdictCases(now)) {
    const url = await routeProduct(ctx, { id: c.id, price: c.price, mrp: null }), { p, panel } = await openPage(ctx, url); await panel.open();
    const word = await panel.text(".vcard .vw"), on = await panel.run(".meter4", function () { return { on: this.querySelectorAll("i.on").length, lo: this.classList.contains("lo") }; });
    t.check(word.startsWith(c.want), `${c.id}: verdict "${word}" expected "${c.want}..."`);
    t.check(on.on === c.meter && on.lo === !!c.low, `${c.id}: meter ${on.on}/4 lo=${on.lo} expected ${c.meter}/4 lo=${!!c.low}`);
    await p.close();
  }
}));

// ---------------------------------------------------------------- 6 grocery
const GROCERY_Q = "tata salt 1kg";
async function grocerySearch(panel, t) {
  await panel.open(); await panel.tab(1);
  await panel.type("main input", "560001", { i: 0 }); await panel.type("main input", GROCERY_Q, { i: 1 });
  t.check((await panel.run("main input", function () { return this.value; }, [], 0)) === "560001", "pincode keystrokes landed");
  t.check((await panel.run("main input", function () { return this.value; }, [], 1)) === GROCERY_Q, "product keystrokes landed");
  await panel.p.keyboard.press("Enter");
  await poll(async () => (await panel.count("main .ggrid .card")) > 0 || /No matches|not found|deliver/i.test(await panel.text("main").catch(() => "")), 40000, 500);
  await sleep(500);
}
test("6", "grocery: real typing, Enter, results, cheapest-first, own-site links", t => withExt({}, async ({ ctx, sw }) => {
  const { panel } = await product(ctx); await grocerySearch(panel, t);
  const rawErrs = (await sw.evaluate(async q => { try { const r = await groceryAt(q, { lat: 12.97, lon: 77.59, pin: "560001" }, {}); return r.errors; } catch (e) { return ["ERR " + e.message]; } }, GROCERY_Q)) || []; t.note("raw store errors: " + rawErrs.join(" ; "));
  const rows = await panel.ev(function () { return [...this.querySelectorAll("main .ggrid .card")].map(a => ({ cls: a.className, store: (a.querySelector(".lg") || {}).title, soldOut: a.classList.contains("so"), pack: (a.querySelector(".pk") || {}).textContent || "", per: (a.querySelector(".pl") || {}).textContent || "", price: a.querySelector(".pr b").textContent, name: a.querySelector(".nm").textContent })); });
  const stores = [...new Set(rows.map(r => r.store))].filter(s => ["Blinkit", "DMart", "JioMart"].includes(s));
  t.note("stores in results: " + stores.join(",") + " (" + rows.length + " rows)");
  const errLines = await panel.ev(function () { return [...this.querySelectorAll("main .meta")].map(e => e.textContent); }); if (errLines.length) t.note("store errors: " + errLines.join(" ; "));
  if (!rows.length) { if (errLines.some(e => /HTTP 4|HTTP 5|Failed to fetch|A store didn't answer/.test(e))) t.skip("all stores errored (network/blocked): " + errLines.join(";")); t.check(false, "no grocery results"); }
  const blocked = rawErrs.length > 0 && rawErrs.every(e => /HTTP (4|5)\d\d|Failed to fetch/.test(e)); // the stores that did not answer refused this network (e.g. HTTP 403): not our bug
  t.check(stores.length >= 2 || (blocked && stores.length >= 1), `results from >=2 of Blinkit/DMart/JioMart (got ${stores.join(",") || "none"}); store errors: ${errLines.join(" ; ")}`);
  const num = r => parseFloat(r.price.replace(/[^\d.]/g, "")), same = rows.filter(r => !r.soldOut && r.pack === rows[0].pack && /tata salt/i.test(r.name)); // "Cheapest" ranks only the best-matching tier (the exact phrase), not looser matches
  t.check(!rows[0].soldOut && num(rows[0]) <= Math.min(...same.map(num)) + 1e-9, `first card (${rows[0].price}, ${rows[0].pack}) is the cheapest in-stock exact match of its pack; cards: ` + rows.map(r => `${r.store}:${r.price}:${r.pack}:${r.name}`).join(" ; "));
  t.check(rows[0].cls.includes("best"), "first card flagged Cheapest");
  const links = await panel.ev(function () { return [...this.querySelectorAll("main .stores a.store")].map(a => [a.textContent, a.href]); });
  for (const [n, h] of [["Zepto", /zepto\.com/], ["Instamart", /swiggy\.com\/instamart/], ["BigBasket", /bigbasket\.com/]]) { const l = links.find(x => x[0] === n); t.check(l && h.test(l[1]) && /tata/i.test(decodeURIComponent(l[1])), `${n} own-site link with query: ${l && l[1]}`); }
  t.check((await panel.text(".pinchip")).includes("560001"), "pin chip shows 560001");
}), { retries: 1 });

test("6b", "grocery: location button without geolocation permission says so and never guesses a pincode", t => withExt({}, async ({ ctx }) => {
  const { panel } = await product(ctx); await panel.open(); await panel.tab(1);
  await panel.click(".field .btn.ghost");
  await poll(async () => /Using|Couldn|blocked/.test(await panel.text(".gbox .meta:not(.bad)")), 20000, 500);
  const hint = await panel.text(".gbox .meta:not(.bad)"), pin = await panel.run("main input", function () { return this.value; }, [], 0);
  t.check(/blocked|Using/.test(hint), `location hint: "${hint}"`); t.check(/blocked/.test(hint) ? pin === "" : /^\d{6}$/.test(pin), `blocked leaves the pincode box alone (no silent guess); otherwise 6 digits: "${pin}"`);
}), { retries: 1 });

// ---------------------------------------------------------------- 7 live extraction
if (!NOLIVE) for (const c of CASES) test("7:" + c.id, "extraction (live): " + c.id, t => withExt({}, async ({ ctx, sw, errs }) => {
  const p = await ctx.newPage(); await p.bringToFront();
  await p.goto(c.list, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {}); await sleep(4000);
  let st = await p.evaluate(pageState).catch(() => ({ title: "", body: "" }));
  if (BLOCK.test(st.title + " " + st.body.slice(0, 300))) t.skip("listing page blocked: " + st.title.slice(0, 50));
  const links = (await p.evaluate(([sel]) => [...document.querySelectorAll(sel)].map(a => ({ h: a.href, t: (a.textContent || "").trim() })).filter(x => x.h && !/\/sspa\//.test(x.h)), [c.link]).catch(() => [])).filter(l => !c.ok || c.ok.test(l.h));
  const pick = (c.want && links.find(l => c.want.test(l.t))) || links[0]; if (!pick) t.skip("no product links found on listing (layout change or blocked): " + st.title.slice(0, 50));
  await p.goto(pick.h, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  const it = await poll(async () => Object.entries((await store(sw, "items")).items || {}).find(([k]) => k.startsWith(c.site))?.[1], 30000, 1000);
  st = await p.evaluate(pageState).catch(() => ({ title: "", body: "" }));
  if (!it) { if (BLOCK.test(st.title + " " + st.body.slice(0, 300))) t.skip("product page blocked: " + st.title.slice(0, 50)); const tr = await p.evaluate(pageTruth).catch(() => ({})); t.check(false, `nothing extracted though page shows price=${tr.price} (${pick.h.slice(0, 80)}) title "${st.title.slice(0, 50)}"`); return; }
  const price = it.hist.at(-1)[1], tr = await p.evaluate(pageTruth).catch(() => ({}));
  if (/amazon/.test(c.site)) t.check(!!it.seller, "seller read from the live Amazon page: " + it.seller);
  t.note(`${pick.h.slice(0, 70)} | seller=${it.seller} | price=${price} mrp=${it.mrp} pagePrice=${tr.price} struck=${JSON.stringify(tr.struck)} | ${(it.title || "").slice(0, 50)}`);
  t.check(typeof price === "number" && price > 0, "price is a positive number");
  if (tr.price && c.id === "tatacliq-shirt") t.note(`tatacliq: independent price guess ${tr.price} is unreliable there (EMI text); extracted ${price}`); else if (tr.price) t.check(Math.abs(tr.price - price) < 1.5, `price ${price} equals visible main price ${tr.price}`); else t.note("could not read visible price independently");
  const strike = (tr.struck || []).filter(v => v > price && v < price * 12);
  if (strike.length) t.check(it.mrp > price, `page shows struck-through ₹${Math.min(...strike)} so MRP must be > price (got ${it.mrp})`);
  if (it.mrp) t.check(it.mrp > price, `stored MRP ${it.mrp} > price ${price}`);
  t.check(!!(it.title && it.title.trim().length > 3), "title non-empty: " + JSON.stringify(it.title));
  const panel = await Panel.attach(ctx, p); await panel.waitKnob(); await panel.open();
  if (await panel.has(".more")) { await panel.click(".more"); await sleep(300); }
  const names = await panel.ev(function () { return [...this.querySelectorAll(".stores a.store")].map(a => a.textContent); });
  t.note("compare: " + names.join(", "));
  if (c.kind === "keyboard") {
    if (!/keyboard/i.test(it.title || "")) t.note("picked product is not a keyboard; skipping store relevance: " + it.title);
    else { t.check(names.includes("Croma") && names.includes("Vijay Sales"), "keyboard compare has Croma + Vijay Sales: " + names.join(",")); t.check(!names.includes("Myntra"), "keyboard compare has no Myntra"); }
  } else if (c.kind === "other") {
    const here = { "reliancedigital.in": "Reliance Digital", "tatacliq.com": "Tata CLiQ", "snapdeal.com": "Snapdeal" }[c.site];
    t.check(!names.includes(here), `own site (${here}) not listed in compare: ${names.join(",")}`);
  } else {
    const here = { "myntra.com": "Myntra" }[c.site];
    for (const s of ["Myntra", "Ajio"]) if (s !== here) t.check(names.includes(s), `clothing compare includes ${s}: ${names.join(",")}`);
    t.check(!names.includes(here), "own site not listed in compare");
  }
  t.check(errs.length === 0, "extension console errors: " + errs.join(" | "));
}), { retries: 1, live: true });

// ---------------------------------------------------------------- 8 quota
test("8", "quota: 50/50 limited state; wishlist cap 20", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw);
  const now = Date.now(), keys = Array.from({ length: 49 }, (_, i) => `amazon.in:FILLER${String(i).padStart(5, "0")}`).concat(key("B0SEENPRD1"));
  await seed(sw, { usage: { month: monthKey(), keys }, items: seedItem("B0SEENPRD1", [[now - 20 * D, 900], [now - 36e5, 900]]) });
  let r = await product(ctx, { id: "B0SEENPRD1", price: 900 }); await r.panel.open();
  t.check(await r.panel.has(".hero .price"), "already-counted product still works at 50/50");
  await r.p.close();
  const url = await routeProduct(ctx, { id: "B0NEWPROD1", price: 700, mrp: null }); r = await openPage(ctx, url); await r.panel.open();
  const txt = await r.panel.text(".limitcard"), q = await r.panel.text(".quota .num");
  t.check(/You've used your 50 free lookups this month/.test(txt) && /Free lookups reset on /.test(txt) && /Pass this time/.test(txt) && !/About Pro|upgrade|subscribe|purchase|\bpay\b|[₹$]|per month|\/mo|price|offer/i.test(txt), `limit card: "${txt.trim()}"`); t.check(/50\/50 lookups/.test(q), "quota row 50/50: " + q);
  t.check(!(await r.panel.has(".limitcard .vcard.wait")) && !(await r.panel.has(".nudge")), "calm card, not an error, and no alert nudge on it");
  t.check(!(await r.panel.has(".hero .price")), "no price hero when limited");
  t.check((await store(sw, "usage")).usage.keys.length === 50, "no 51st lookup recorded");
  await r.p.close();
  // a saved (hearted) product is never locked behind the limit, and is not counted as a new lookup
  await seed(sw, { items: seedItem("B0SAVEPRD1", [[now - 20 * D, 700], [now - 36e5, 700]], { wish: true }) });
  r = await product(ctx, { id: "B0SAVEPRD1", price: 700, mrp: null }); await r.panel.open();
  t.check(await r.panel.has(".hero .price") && !(await r.panel.has(".limitcard")), "at 50/50 a watchlist product opens normally"); t.check((await store(sw, "usage")).usage.keys.length === 50, "and it is not counted as a new lookup");
  await r.p.close();
  // wishlist cap
  const items = {}; for (let i = 0; i < 20; i++) items[`x:${i}`] = { site: "Amazon", title: "w" + i, url: "https://www.amazon.in/x" + i, wish: true, hist: [[now, 100]] };
  await seed(sw, { usage: { month: monthKey(), keys: [] }, items });
  const k = key("B0CAPPROD1"); r = await product(ctx, { id: "B0CAPPROD1", price: 700, mrp: null }); await r.panel.open();
  await r.panel.click(".heart"); await sleep(800);
  t.check(!(await r.panel.has(".heart.on")), "21st heart rejected (not on)");
  t.check((await r.panel.run(".heart", function () { return this.title; })) === "Your watchlist is full. Remove one to add another.", "heart title explains the full watchlist");
  const wished = Object.values((await store(sw, "items")).items).filter(i => i.wish).length; t.check(wished === 20, "still exactly 20 wished items: " + wished);
  await r.panel.click(".trapbox .btn"); await sleep(600);
  t.check(await r.panel.text(".trapbox .stp-msg") === "Your watchlist is full. Remove one to add another.", "alert Set also hits the cap: " + (await r.panel.text(".trapbox .stp-msg")));
  t.check(!(await store(sw, "items")).items[k].target, "no target saved past cap");
}));

// ---------------------------------------------------------------- 9 mobile
test("9", "mobile 390x844: bottom sheet, no overflow, tap targets >=44px", t => withExt({ viewport: { width: 390, height: 844 } }, async ({ ctx, sw }) => {
  await seed(sw, { items: { ...seedItem(PRODUCT_ID, HIST(Date.now())), ...seedItem("B0MOBWISH1", [[Date.now() - 5 * D, 1000], [Date.now() - 36e5, 1000]], { target: 900, wish: true }), ...seedItem("B0MOBWISH2", [[Date.now() - 5 * D, 1000], [Date.now() - 36e5, 1000]], { wish: true }) } });
  const { p, panel } = await product(ctx); await panel.open(); await sleep(600);
  const pr = await panel.rect(".panel"), iw = await p.evaluate(() => innerWidth), ih = await p.evaluate(() => innerHeight);
  t.check(Math.abs(pr.w - iw) <= 2 && pr.left <= 1, `panel spans viewport width (${Math.round(pr.w)} of ${iw})`);
  t.check(Math.abs(pr.bottom - ih) <= 2 && pr.top > 0 && pr.h < ih, `panel docked to bottom as a sheet (top ${Math.round(pr.top)}, bottom ${Math.round(pr.bottom)}, vh ${ih})`);
  const small = [];
  for (const [ti, name] of [[0, "product"], [1, "grocery"], [2, "watch"]]) {
    await panel.tab(ti);
    const ov = await panel.ev(function () { const pn = this.querySelector(".panel"), m = this.querySelector("main"), bad = [...this.querySelectorAll(".panel *")].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map(e => e.className || e.tagName);
      return { pw: pn.scrollWidth - pn.clientWidth, mw: m.scrollWidth - m.clientWidth, bad }; });
    t.check(ov.pw <= 1 && ov.mw <= 1 && !ov.bad.length, `${name} tab: no horizontal overflow (panel ${ov.pw}, main ${ov.mw}, offenders ${ov.bad})`);
    const tg = await panel.ev(function () { return [...this.querySelectorAll("button,a,input,[role=tab]")].map(e => { const r = (e.tagName === "INPUT" && e.closest(".stp-box") || e).getBoundingClientRect(); return { n: `${e.tagName.toLowerCase()}.${e.className}`.slice(0, 30), t: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.w > 0 && x.h > 0 && Math.min(x.w, x.h) < 44); });
    tg.forEach(x => small.push(`${name}:${x.n}"${x.t}" ${x.w}x${x.h}`));
  }
  t.check((await p.evaluate(() => document.documentElement.scrollWidth)) <= iw, "page itself has no horizontal overflow");
  t.check(small.length === 0, `tap targets <44px (${small.length}): ` + [...new Set(small)].slice(0, 12).join("; "));
}));

// ---------------------------------------------------------------- 10 dark
test("10", "dark browser setting: panel stays light and readable (no dark theme)", t => withExt({}, async ({ ctx, sw, errs }) => {
  await seed(sw, { items: seedItem(PRODUCT_ID, HIST(Date.now())) });
  const { p, panel } = await product(ctx); await panel.open();
  const read = () => panel.ev(function () { const g = (s, pr) => getComputedStyle(this.querySelector(s))[pr]; return { bg: g(".panel", "backgroundColor"), ink: g("h1", "color"), price: g(".price", "color") }; });
  await p.emulateMedia({ colorScheme: "dark" }); await sleep(600); const d = await read();
  t.check(lum(d.bg) > 0.5, "panel background stays light under a dark browser setting " + d.bg);
  t.check(contrast(d.bg, d.price) >= 4.5, `price contrast ${contrast(d.bg, d.price).toFixed(1)}`);
  for (const i of [1, 2, 0]) await panel.tab(i);
  await panel.click(".info"); await sleep(400); const sb = await panel.ev(function () { return getComputedStyle(this.querySelector(".sheet")).backgroundColor; });
  t.check(lum(sb) > 0.5, "details sheet stays light " + sb);
  t.check(errs.length === 0, "extension console errors: " + errs.join(" | "));
}));

// ---------------------------------------------------------------- 11 privacy
const ALLOW = [/(^|\.)amazon\.in$/, /(^|\.)flipkart\.com$/, /(^|\.)myntra\.com$/, /(^|\.)blinkit\.com$/, /^digital\.dmart\.in$/, /^cdn\.dmart\.in$/, /^www\.dmart\.in$/, /(^|\.)jiomart\.com$/, /^nominatim\.openstreetmap\.org$/, /^ipwho\.is$/, /\.supabase\.co$/];
test("11", "privacy: manifest has no <all_urls>; network only to allowlist", t => withExt({}, async ({ ctx, reqs }) => {
  const m = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8")), bad = /<all_urls>|^\*:\/\/\*\/|^https?:\/\/\*\/\*$|^https:\/\/\*\/\*$/;
  t.check(!(m.host_permissions || []).some(h => bad.test(h)), "host_permissions free of <all_urls>/wildcard hosts: " + JSON.stringify(m.host_permissions));
  t.check(!(m.content_scripts || []).some(c => c.matches.some(h => bad.test(h))), "content_scripts.matches free of <all_urls>");
  if ((m.optional_host_permissions || []).some(h => bad.test(h))) t.note("optional_host_permissions requests " + JSON.stringify(m.optional_host_permissions) + " (user-granted, not install-time)");
  const { panel } = await product(ctx); await panel.open(); await panel.click(".heart"); await panel.tab(2); await panel.tab(1);
  await panel.click(".field .btn.ghost"); await poll(async () => /Using|Couldn|blocked/.test(await panel.text("main .meta")), 20000, 500);
  await panel.type("main input", "560001", { i: 0 }); await panel.type("main input", "amul butter 500g", { i: 1 }); await panel.p.keyboard.press("Enter"); await sleep(12000);
  const hosts = {}; for (const r of reqs) { let u; try { u = new URL(r.url); } catch { continue; } if (!/^(https?|wss?):$/.test(u.protocol)) continue; (hosts[u.hostname] ||= { n: 0, sw: 0 }).n++; if (r.sw) hosts[u.hostname].sw++; }
  const off = Object.keys(hosts).filter(h => !ALLOW.some(a => a.test(h)));
  t.note("hosts contacted: " + Object.entries(hosts).map(([h, v]) => `${h}(${v.n}${v.sw ? ",sw" : ""})`).join(" "));
  t.check(off.length === 0, "requests to hosts outside allowlist: " + off.join(", "));
  t.check(Object.values(hosts).some(v => v.sw), "service-worker requests were observed (sanity: capture works)");
}));

// ================================================================ NEW FEATURE TESTS (12+)
const itemOf = async (sw, k) => (await store(sw, "items")).items?.[k];
const targetOf = async (sw, k) => (await itemOf(sw, k))?.target;
const MSG0 = "Enter a price above ₹0", MSGHI = "Alert price must be below today's price";

// ---------------------------------------------------------------- 12 trap editor
test("12", "trap editor: step size, hold-to-repeat, typed persist, invalid rejected", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw);
  const id = "B0TRAPED01", k = key(id), { p, panel } = await product(ctx, { id, price: 766, mrp: null }); await panel.open();
  t.check(await panel.has(".trapbox .stp .stp-b") && (await panel.count(".trapbox .stp-b")) === 2 && await panel.has(".trapbox .stp-in input") && await panel.has(".trapbox .stp-msg"), "stepper markup: 2 .stp-b, .stp-in input, .stp-msg");
  t.check((await panel.val(".trapbox .stp-in input")) === "727", "new-trap default = floor(766*0.95) = 727: " + await panel.val(".trapbox .stp-in input"));
  // invalid values on a NEW trap: message shown, Set does nothing
  for (const [txt, msg] of [["0", MSG0], ["abc", MSG0], ["766", MSGHI], ["900", MSGHI]]) {
    await panel.type(".trapbox .stp-in input", txt); await sleep(100);
    t.check((await panel.text(".trapbox .stp-msg")) === msg, `new trap "${txt}" -> "${await panel.text(".trapbox .stp-msg")}" expected "${msg}"`);
    t.check(await panel.run(".trapbox .stp", function () { return this.classList.contains("bad"); }), `"${txt}" marks stepper .bad`);
    await panel.click(".trapbox .btn"); await sleep(400); t.check(!(await targetOf(sw, k)), `"${txt}" not saved by Set`);
  }
  // step size = trapStep(766) = 10, via real pointer presses
  await panel.type(".trapbox .stp-in input", "700"); await panel.press(".trapbox .stp-b", 1);
  t.check((await panel.val(".trapbox .stp-in input")) === "710", "plus from 700 -> 710 (step 10): " + await panel.val(".trapbox .stp-in input"));
  await panel.press(".trapbox .stp-b", 0); await panel.press(".trapbox .stp-b", 0);
  t.check((await panel.val(".trapbox .stp-in input")) === "690", "2x minus from 710 -> 690: " + await panel.val(".trapbox .stp-in input"));
  // hold-to-repeat
  await panel.press(".trapbox .stp-b", 0, 1100); const held = +(await panel.val(".trapbox .stp-in input"));
  t.check(held <= 690 - 40 && held % 10 === 0, `holding minus 1.1s repeats (690 -> ${held})`);
  // set a valid value
  await panel.type(".trapbox .stp-in input", "700"); await panel.click(".trapbox .btn");
  t.check(!!(await poll(async () => (await targetOf(sw, k)) === 700, 4000)), "Set saves 700");
  await poll(async () => await panel.has(".trapbox .link-btn"), 4000);
  t.check(/Price alert at ₹700/.test(await panel.text(".trapbox .lbl")), "label: " + await panel.text(".trapbox .lbl"));
  // existing trap autosaves (600 ms debounce)
  await panel.type(".trapbox .stp-in input", "650"); await sleep(250);
  t.check((await targetOf(sw, k)) === 700, "not saved before the 600ms debounce");
  t.check(!!(await poll(async () => (await targetOf(sw, k)) === 650, 3000)), "typed 650 autosaved");
  t.check(!!(await poll(async () => await panel.run(".trapbox .stp-tick", function () { return this.classList.contains("on"); }), 1500, 50)), "'Saved' tick shown");
  t.check(/Saved/.test(await panel.text(".trapbox .stp-tick")), "tick text says Saved");
  await panel.press(".trapbox .stp-b", 1); t.check(!!(await poll(async () => (await targetOf(sw, k)) === 660, 3000)), "plus autosaves 650 -> 660");
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open();
  t.check((await panel.val(".trapbox .stp-in input")) === "660", "persisted after reload: " + await panel.val(".trapbox .stp-in input"));
  t.check(/Price alert at ₹660/.test(await panel.text(".trapbox .lbl")), "label after reload: " + await panel.text(".trapbox .lbl"));
  // invalid on existing trap: message, NOT saved (target stays 660)
  for (const [txt, msg] of [["0", MSG0], ["abc", MSG0], ["766", MSGHI], ["1000", MSGHI]]) {
    await panel.type(".trapbox .stp-in input", txt); await sleep(1300);
    t.check((await panel.text(".trapbox .stp-msg")) === msg, `existing trap "${txt}" -> "${await panel.text(".trapbox .stp-msg")}" expected "${msg}"`);
    t.check((await targetOf(sw, k)) === 660, `"${txt}" NOT saved (target ${await targetOf(sw, k)})`);
  }
  await p.keyboard.press("Tab"); await sleep(500); t.check((await targetOf(sw, k)) === 660, "blur with invalid text still does not save");
}));

// ---------------------------------------------------------------- 13 watchlist edit
test("13", "watchlist: inline stepper edit persists, invalid rejected, 'Set a trap' = floor(price*0.95)", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw);
  const now = Date.now(), h = [[now - 5 * D, 1000], [now - 36e5, 1000]], A = key("B0WISHONL1"), B = key("B0TRAPPED1");
  await seed(sw, { items: { [A]: { site: "Amazon", title: "Wish Only Thing", url: "https://www.amazon.in/dp/B0WISHONL1", hist: h, wish: true }, [B]: { site: "Amazon", title: "Trapped Thing", url: "https://www.amazon.in/dp/B0TRAPPED1", hist: h, target: 800 } } });
  const { p, panel } = await product(ctx, { id: "B0WLPAGE01", price: 830 }); await panel.open(); await panel.tab(2);
  t.check((await panel.count(".wrow")) === 2, ".wrow cards: " + await panel.count(".wrow"));
  const rows = () => panel.ev(function () { return [...this.querySelectorAll(".wrow")].map(r => ({ title: r.querySelector("a").textContent, stp: !!r.querySelector(".stp"), set: [...r.querySelectorAll(".btn")].map(b => b.textContent.trim()) })); });
  let rs = await rows(), bi = rs.findIndex(r => r.title === "Trapped Thing"), ai = rs.findIndex(r => r.title === "Wish Only Thing");
  t.check(bi === 0, "trapped row sorts first: " + JSON.stringify(rs.map(r => r.title)));
  t.check(rs[bi].stp && rs[ai].set.includes("Set price alert") && !rs[ai].stp, "trapped row has stepper; wish-only row has 'Set a trap' and no stepper");
  const row = i => `.wlist > .wrow:nth-child(${i + 1})`;
  await panel.type(`${row(bi)} .stp-in input`, "900"); await sleep(250);
  t.check((await targetOf(sw, B)) === 800, "not saved before debounce");
  t.check(!!(await poll(async () => (await targetOf(sw, B)) === 900, 3000)), "inline edit 900 persisted");
  await panel.press(`${row(bi)} .stp-b`, 1); t.check(!!(await poll(async () => (await targetOf(sw, B)) === 910, 3000)), "row plus: 900 -> 910 (trapStep(1000)=10): " + await targetOf(sw, B));
  for (const [txt, msg] of [["0", MSG0], ["abc", MSG0], ["1000", MSGHI]]) {
    await panel.type(`${row(bi)} .stp-in input`, txt); await sleep(1300);
    t.check((await panel.text(`${row(bi)} .stp-msg`)) === msg, `row "${txt}" -> "${await panel.text(`${row(bi)} .stp-msg`)}" expected "${msg}"`);
    t.check((await targetOf(sw, B)) === 910, `row "${txt}" not saved`);
  }
  await panel.type(`${row(bi)} .stp-in input`, "880"); await poll(async () => (await targetOf(sw, B)) === 880, 3000);
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open(); await panel.tab(2);
  rs = await rows(); bi = rs.findIndex(r => r.title === "Trapped Thing"); t.check((await panel.val(`${row(bi)} .stp-in input`)) === "880", "edited value persisted after reload: " + await panel.val(`${row(bi)} .stp-in input`));
  ai = rs.findIndex(r => r.title === "Wish Only Thing");
  await panel.click(`${row(ai)} .trap-line .btn`);
  t.check(!!(await poll(async () => (await targetOf(sw, A)) === 950, 3000)), "'Set a trap' on wish-only row -> floor(1000*0.95)=950: " + await targetOf(sw, A));
  await poll(async () => (await panel.count(".wrow .stp")) === 2, 3000); t.check((await panel.count(".wrow .stp")) === 2, "wish-only row now shows a stepper");
  await panel.click(`${row(1)} .x`); await poll(async () => (await panel.count(".wrow")) === 1, 3000);
  t.check((await panel.count(".wrow")) === 1, "remove (x) drops a row");
}));

test("23", "seller: row shows who sells and ships, sheet explains, a changed seller is flagged", t => withExt({}, async ({ ctx, sw }) => {
  const id = "B0SELLER01", now = Date.now();
  await seed(sw, { items: seedItem(id, [[now - 40 * D, 900], [now - 20 * D, 900], [now - 36e5, 900]]) });
  let { p, panel } = await product(ctx, { id, price: 900, seller: { name: "Clicktech Retail Private Ltd", ships: "Amazon", fba: true } }); await panel.open();
  t.check(await panel.has(".seller"), "seller row present");
  const row = await panel.text(".seller"); t.check(/Clicktech Retail/.test(row) && /3rd-party/.test(row) && /Amazon ships/.test(row) && /Seller signals/.test(row), "row text: " + row); t.check(await panel.has(".seller .gauge svg path") && /^\d+/.test(await panel.text(".seller .gnum")), "half-ring gauge with a score");
  await poll(async () => /positive/.test(await panel.text(".seller")), 20000, 500);
  const live = await panel.text(".seller"); if (/positive/.test(live)) { t.check(/\d\.\d \(\d+(\.\d)?k?\)/.test(live) && /\d+% positive/.test(live), "storefront rating + % positive chips loaded in the background: " + live); const sc = +(await panel.text(".seller .gnum")).match(/^\d+/)[0]; t.check(sc !== 62 && sc >= 5 && sc <= 98, "score comes from the seller's own data, not the old constant: " + sc); } else t.note("storefront not readable right now: " + live);
  await panel.click(".seller"); await sleep(400);
  const sheet = await panel.text(".sheet"); t.check(/independent seller/.test(sheet) && /Seller profile/.test(sheet) && !/scam|fake|fraud/i.test(sheet), "sheet text: " + sheet.slice(0, 160));
  t.check(!/changed from/.test(sheet), "no change note on first sight");
  await p.close();
  ({ p, panel } = await product(ctx, { id, price: 900, seller: { name: "RandomTraders", ships: "RandomTraders", fba: false } })); await panel.open();
  t.check(/RandomTraders/.test(await panel.text(".seller")), "new seller shown");
  await panel.click(".seller"); await sleep(400);
  t.check(/changed from Clicktech Retail Private Ltd to RandomTraders/.test(await panel.text(".sheet")), "seller change flagged: " + (await panel.text(".sheet")).slice(0, 200));
}));
test("23b", "seller: pages without seller info show no row", t => withExt({}, async ({ ctx }) => {
  const { panel } = await product(ctx); await panel.open(); t.check(!(await panel.has(".seller")), "no seller row");
}));

test("24", "reviews: visible answer card with rating split, themes and a details sheet", t => withExt({}, async ({ ctx }) => {
  const { panel } = await product(ctx, { id: "B0REVIEW01", ratings: { total: "12,345", avg: "4.4", dist: { 5: 70, 4: 20, 3: 5, 2: 2, 1: 3 } } }); await panel.open();
  t.check(await panel.has(".rev.good"), "card present with good tone");
  const txt = await panel.text(".rev"); t.check(/mostly happy/.test(txt) && /4\.4★/.test(txt) && /90% rate it 4-5/.test(txt), "card text: " + txt);
  await panel.click(".rev"); await sleep(400); t.check(/Rating breakdown/.test(await panel.text(".sheet")), "sheet opens with rating breakdown");
}));
test("31", "price line: the page's own 'Buy for' offer price is shown (lowest below the price), nothing invented when absent", t => withExt({}, async ({ ctx }) => {
  const { panel } = await product(ctx, { id: "B0OFFERPR1", price: 5000, offerLine: 4600 }); await panel.open();
  t.check(/₹4,600 with offers/.test(await panel.text(".sub2")), "offer price shown: " + await panel.text(".sub2"));
  const r2 = await product(ctx, { id: "B0OFFERPR2", price: 5000 }); await r2.panel.open(); t.check(!/with offers/.test(await r2.panel.text("main")), "no offer line on pages without one");
}));
test("24b", "reviews: polarised ratings read as divided, pages without ratings show no card", t => withExt({}, async ({ ctx }) => {
  const { panel } = await product(ctx, { id: "B0REVIEW02", ratings: { total: "800", avg: "3.6", dist: { 5: 45, 4: 10, 3: 5, 2: 5, 1: 35 } } }); await panel.open();
  t.check(/divided/.test(await panel.text(".rev")), "divided: " + await panel.text(".rev"));
  const r2 = await product(ctx, { id: "B0REVIEW03" }); await r2.panel.open(); t.check(!(await r2.panel.has(".rev")), "no card without ratings");
}));

if (!NOLIVE) test("25", "compare (live): one click lists the same product from other stores, lowest marked, nothing runs before the click", t => withExt({}, async ({ ctx, reqs }) => {
  const title = "boAt Airdopes 141 Gen 2, 4 Mics ENx Tech, 48 Hrs Playback, Fast Charge, Low Latency, IPX4, v5.4 Bluetooth Earbuds TWS Ear Buds Wireless with mic (Active Black)";
  const { panel } = await product(ctx, { id: "B0F8BVSK21", price: 766, mrp: 3990, title }); await panel.open(); await sleep(1500);
  t.check(!reqs.some(r => /flipkart\.com\/search|reliancedigital\.in\/products/.test(r.url)), "no store search before the click");
  t.check(await panel.has(".cmp .btn"), "compare button present");
  await panel.click(".cmp .btn");
  await poll(async () => (await panel.count(".cmp .cmp-r")) > 0 || /Couldn|No confident/.test(await panel.text(".cmp")), 25000, 500);
  const txt = await panel.text(".cmp"), rows = await panel.ev(function () { return [...this.querySelectorAll(".cmp .cmp-r")].map(r => r.textContent); });
  t.note("compare: " + JSON.stringify(rows));
  if (!rows.length) return t.skip("stores returned nothing (blocked or changed): " + txt.slice(0, 100));
  t.check(rows.some(r => /Flipkart/.test(r) && /₹\d/.test(r)), "Flipkart row with a price: " + rows.join(" | "));
  t.check(rows.every(r => !/Amazon/.test(r) || /here/.test(r)), "never lists the store you are on as another store");
  t.check(/Offers, shipping and seller may differ/.test(txt), "honest note shown");
  t.check(await panel.has(".cmp-r.low"), "a lowest row is marked");
}));

test("26", "Amazon history: the range Amazon shows in the page is remembered and drives the scanner when HAULS has little history", t => withExt({}, async ({ ctx, sw }) => {
  const id = "B0AMZHIST1", now = Date.now();
  const { p, panel } = await product(ctx, { id, price: 499, mrp: 1599 }); await panel.open(); await sleep(800);
  t.check(/Not enough history|Keep browsing/.test(await panel.text(".scan")), "scanner starts without data: " + await panel.text(".scan"));
  await p.evaluate(() => { const d = document.createElement("div"); d.id = "rufus-answer"; d.textContent = "Over the past 30 days, the price of boAt Airdopes 141 Bluetooth Earbuds has ranged from ₹499 to ₹579. The current price is ₹499, the lowest in the past 30 days."; document.body.append(d); });
  const ok = await poll(async () => (await store(sw, "items")).items && Object.values((await store(sw, "items")).items).some(i => i.ref), 8000, 300);
  t.check(!!ok, "reference stored");
  const it = Object.values((await store(sw, "items")).items).find(i => i.ref); t.check(it && it.ref.low === 499 && it.ref.high === 579 && it.ref.days === 30, "ref values " + JSON.stringify(it && it.ref));
  await poll(async () => /Amazon's 30-day low/.test(await panel.text(".scan")), 6000, 300);
  const sc = await panel.text(".scan"); t.check(/At Amazon's 30-day low/.test(sc) && /Real Deal|Fair Deal/.test(sc) && /price range this page showed/.test(sc), "scanner uses Amazon's range: " + sc.slice(0, 200));
  await poll(async () => await panel.has(".bandc"), 6000, 300);
  const rb = await panel.text(".chartbox"); t.check(/₹499/.test(rb) && /₹579/.test(rb) && /30-day range/.test(rb) && await panel.has(".bandc svg circle"), "history card draws Amazon's range as a graph frame with today's price: " + rb.slice(0, 120));
  for (const tab of ["30D", "90D", "All"]) { await panel.click(`.seg:not(.hz) button[data-r="${tab}"]`); const c3 = await panel.text(".chips3"); t.check(/Low\s*₹499/.test(c3) && /High\s*₹579/.test(c3) && /Avg\s*~₹539/.test(c3) && /High₹579₹80 below/.test(c3) && /Avg~₹539₹40 below/.test(c3) && /Low₹499at the low/.test(c3), `${tab}: chips show Amazon's range with an estimated average and the distance from now, not one price three times: ` + c3); }
  await p.evaluate(() => { const r = document.createElement("div"); r.id = "reviewsMedley"; r.textContent = "Over the past 30 days, the price of boAt Airdopes 141 Bluetooth Earbuds has ranged from ₹10 to ₹20. The current price is ₹499."; const wrap = document.createElement("section"); const inner = document.createElement("div"); inner.id = "reviewsMedley"; inner.textContent = "x"; wrap.append(inner); wrap.append(document.createTextNode("Over the past 30 days, the price of boAt Airdopes 141 Bluetooth Earbuds has ranged from ₹11 to ₹22. The current price is ₹499.")); document.body.append(wrap); document.body.append(r); const q = document.createElement("div"); q.textContent = "Over the past 30 days, the price of some other gadget has ranged from ₹30 to ₹40. The current price is ₹499."; document.body.append(q); const d = document.createElement("div"); d.textContent = "The price of Y has ranged from ₹900 to ₹100 over time"; document.body.append(d); }); await sleep(1500);
  t.check((await store(sw, "items")) && Object.values((await store(sw, "items")).items).every(i => !i.ref || i.ref.low === 499), "spoofed text (review area, wrapper around review area, other product, nonsense) is ignored");
}));

test("27", "page report: Settings button reads only price-history wording and the chart from the Amazon tab", t => withExt({}, async ({ ctx, extId }) => {
  const { p, panel } = await product(ctx, { id: "B0PROBE001", price: 499 }); await sleep(800);
  await p.evaluate(() => {
    const a = document.createElement("div"); a.id = "rufus-panel"; a.className = "rufus-answer"; a.innerHTML = "<p>Over the past 30 days, the price of Gadget has ranged from ₹499 to ₹579. Contact me at someone@example.com or 9876543210123.</p>";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", "M0 0 L10 10"); svg.append(path);
    const tx = document.createElementNS("http://www.w3.org/2000/svg", "text"); tx.textContent = "₹579"; svg.append(tx); a.append(svg);
    const secret = document.createElement("p"); secret.textContent = "Deliver to Vishwajeet Muzaffarpur 842001 SECRETNAME"; a.append(secret); document.body.append(a);
    const host = document.createElement("div"); host.attachShadow({ mode: "open" }).innerHTML = "<span>Price history: lowest featured offer price each day</span>"; document.body.append(host); });
  const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`); await o.waitForSelector("#probe", { state: "attached" }); await o.evaluate(() => { document.querySelector("details").open = true; });
  await o.click("#probe"); await poll(async () => !(await o.$eval("#preport", e => e.hidden)), 8000, 300);
  const rep = await o.$eval("#preport", e => e.textContent), j = JSON.parse(rep), hits = j.frames.flatMap(f => f.hits), all = JSON.stringify(j);
  t.check(j.kind === "amazon-history-probe" && /dp\/B0PROBE001|B0PROBE001/.test(j.product), "report header: " + j.product);
  t.check(hits.some(h => /ranged from ₹499 to ₹579/.test(h.text) && h.path.some(x => /#rufus-panel/.test(x))), "found the sentence with its container path: " + JSON.stringify(hits[0]));
  t.check(hits.some(h => h.inShadow && /Price history/.test(h.text)), "also reads inside a shadow root");
  t.check(!/someone@example|9876543210123/.test(all) && /\[email\]/.test(all), "emails and long numbers are scrubbed");
  t.check(!/SECRETNAME|Vishwajeet/.test(all), "unrelated page text is never included");
  t.check(j.frames.some(f => f.charts.length && f.charts[0].labels.includes("₹579")), "chart labels captured");
  t.check(j.frames.some(f => f.rufus.some(x => /rufus/.test(x))), "rufus elements listed");
  const none = await ctx.newPage(); await none.goto("about:blank"); await p.close(); await o.click("#probe"); await sleep(1500);
  t.check(/Open an Amazon.in product page first/.test(await o.$eval("#pmsg", e => e.textContent)), "no Amazon tab: clear message");
}));

if (!NOLIVE) test("28", "other sellers (live): one click lists Amazon sellers by price, lowest marked; single-seller items say so; nothing before the click", t => withExt({}, async ({ ctx, reqs }) => {
  let { panel } = await product(ctx, { id: "B0DCSYTVDD", price: 64990, title: "HP 255 G10 Laptop for Home or Work, 16GB RAM DDR5, 512GB SSD" }); await panel.open(); await sleep(1500);
  t.check(!reqs.some(r => /aodAjaxMain/.test(r.url)), "no seller request before the click");
  t.check(await panel.has(".offers .btn"), "button present"); await panel.click(".offers .btn");
  await poll(async () => (await panel.count(".offers .off-r")) > 0 || /Couldn|Only one/.test(await panel.text(".offers")), 25000, 500);
  const rows = await panel.ev(function () { return [...this.querySelectorAll(".offers .off-r")].map(r => r.textContent); });
  if (!rows.length) return t.skip("Amazon returned no sellers (blocked or changed): " + (await panel.text(".offers")).slice(0, 80));
  t.check(rows.length >= 2, "at least two sellers: " + rows.join(" | "));
  const prices = rows.map(r => +((r.match(/₹([\d,]+)/) || [])[1] || "0").replace(/,/g, "")); t.check(prices.every((x, i) => i === 0 || x >= prices[i - 1]), "sorted by price: " + prices);
  t.check(await panel.has(".off-r.low"), "lowest marked"); t.check(/less from/.test(await panel.text(".offers")), "saving line: " + (await panel.text(".offers")).slice(0, 90));
  t.check(/Amazon's own seller list/.test(await panel.text(".offers")), "honest note");
}));
if (!NOLIVE) test("28b", "other sellers (live): a single-seller product says so", t => withExt({}, async ({ ctx }) => {
  const { panel } = await product(ctx, { id: "B0F8BVSK21", price: 766, title: "boAt Airdopes 141 Gen 2 Bluetooth Earbuds" }); await panel.open(); await sleep(800);
  await panel.click(".offers .btn"); await poll(async () => /Only one|Couldn/.test(await panel.text(".offers")), 25000, 500);
  const txt = await panel.text(".offers"); if (/Couldn/.test(txt)) return t.skip("Amazon blocked: " + txt); t.check(/Only one seller|isn't listing other sellers for your delivery location/.test(txt), "single-seller or honest no-location text: " + txt); t.check(!/Only one seller/.test(txt) || !/delivery location/.test(txt), "never both"); // an empty cookieless list is no longer called 'only one seller'

}));

if (!NOLIVE) test("29", "tracker (live): the service worker reads real Amazon, Flipkart and Myntra prices with no tab open and grows history", t => withExt({}, async ({ sw }) => {
  const now = Date.now(), items = {
    "amazon.in:B0F8BVSK21": { site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", title: "boAt", hist: [], wish: true },
    "flipkart.com:ACCHGG7ND9BRXRGZ": { site: "Flipkart", url: "https://www.flipkart.com/boat-airdopes-141-gen-2-4-mics-enx-tech-48h-battery-asap-charge-low-latency-bt-v5-4-bluetooth/p/itm97186a453279a?pid=ACCHGG7ND9BRXRGZ", title: "boAt", hist: [], wish: true },
    "myntra.com:12027436": { site: "Myntra", url: "https://www.myntra.com/lounge-tshirts/levis/levis-men-soft-pure-cotton-round-neck-half-sleeve-tshirt/12027436/buy", title: "Levis", hist: [], wish: true } };
  const read = {}; for (const [k, it] of Object.entries(items)) read[k] = await sw.evaluate(([k2, it2]) => trkFetch(k2, it2), [k, it]);
  const blocked = Object.entries(read).filter(([, r]) => !r.ok).map(([k, r]) => k + ":" + r.reason); t.note("live reads: " + JSON.stringify(read));
  const good = Object.keys(read).filter(k => read[k].ok && read[k].price); if (good.length < 2) return t.skip("fewer than 2 stores readable right now (blocked/changed): " + blocked.join(", "));
  for (const k of good) items[k].hist = [[now - 30 * D, Math.round(read[k].price * 1.1)]]; // a plausible earlier price (+10%)
  const seeded = {}; for (const k of good) seeded[k] = items[k]; await seed(sw, { items: seeded });
  const out = await sw.evaluate(() => trkRun(Date.now())); t.note("trkRun: " + JSON.stringify(out));
  const st = (await store(sw, "items")).items, trk = (await store(sw, "trk")).trk;
  for (const k of good) { t.check(st[k].hist.length === 2 && st[k].hist[1][1] === read[k].price, `${k}: history grew to the live price ${read[k].price}`); t.check(typeof st[k].checked === "number", k + ": checked stamped"); }
  t.check(good.every(k => trk.health[k.split(":")[0]].ok >= 1), "health counters per store: " + JSON.stringify(trk.health).slice(0, 160));
  if (good.length < 3) t.note("not readable this run: " + blocked.join(", "));
}));

test("30", "settings: background price check card shows per-store health and runs on demand (admin message accepted from the extension page)", t => withExt({}, async ({ ctx, sw, extId }) => {
  await seed(sw, { trk: { health: { "amazon.in": { ok: 3, fail: 1, held: 0, unavailable: 0, last: Date.now(), reasons: { captcha: 1 } } }, pause: { "flipkart.com": Date.now() + 3600e3 } }, items: {} });
  const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`); await o.waitForSelector("#trk .srow");
  const txt = await o.$eval("#trk", e => e.textContent); const tips = (await o.$$eval("#trk [title]", es => es.map(e => e.title))).join("|"); t.check(/Amazon.*Working/.test(txt) && /3 ok · 1 failed/.test(tips) && /captcha 1/.test(tips), "amazon health shown (counts and reasons in tooltips): " + txt.slice(0, 160) + " | " + tips); t.check(/Flipkart.*Paused for now/.test(txt) && /Myntra.*Not checked yet/.test(txt), "paused and unchecked states");
  await o.click("#trkrun"); await poll(async () => /Checked 0/.test(await o.$eval("#tmsg", e => e.textContent)), 8000, 300); t.check(/Checked 0 items, 0 new prices/.test(await o.$eval("#tmsg", e => e.textContent)), "run-now answered: " + await o.$eval("#tmsg", e => e.textContent));
}));

test("32", "Amazon chart: the real Price-history SVG, when Amazon draws it, becomes HAULS's history (chart, high/low, verdict) and is merged with own points", t => withExt({}, async ({ ctx, sw }) => {
  const svg = (await import("node:fs")).readFileSync(new URL("../fixtures/amazon-history/chart-1m.svg", import.meta.url), "utf8");
  const { p, panel } = await product(ctx, { id: "B0AMZCHART", price: 4499, mrp: 5999 }); await panel.open(); await sleep(600);
  t.check(!(await panel.has(".cw svg")), "no chart before Amazon's chart appears (only one point)");
  await p.evaluate(h => { const w = document.createElement("div"); w.id = "rufus-react-renderer"; w.innerHTML = '<span class="rufus-pricing-chart-container">' + h + '</span>'; document.body.append(w); }, svg);
  const ok = await poll(async () => Object.values((await store(sw, "items")).items || {}).some(i => i.ahist), 8000, 300); t.check(!!ok, "chart read and stored");
  const it = Object.values((await store(sw, "items")).items).find(i => i.ahist); t.check(it.ahist.ranges["1M"].points[0][1] === 5499 && it.ahist.offer === 4049 && it.ahist.highest.price === 5499, "stored series/offer/highest: " + JSON.stringify(it.ahist.offer));
  await poll(async () => await panel.has(".cw svg"), 6000, 300); t.check(await panel.has(".cw svg"), "history chart drawn from Amazon's data");
  const chips = await panel.text(".chips3"); t.check(/₹4,499/.test(chips) && /₹5,499/.test(chips), "low/high come from the series: " + chips);
  t.check(/Includes Amazon's own price history/.test(await panel.text(".chartbox")) && /with offers ₹4,049/.test(await panel.text(".chartbox")), "source + offer price caption: " + (await panel.text(".chartbox")).slice(-160));
  t.check(!/Too early to call/.test(await panel.text(".vcard")), "verdict no longer 'too early': " + await panel.text(".vcard"));
  // an SVG for another price is refused
  await p.evaluate(h => { const w = document.createElement("div"); w.innerHTML = h.replace(/price ₹4,499/, "price ₹1,111"); document.body.append(w); }, svg);
  await sleep(1500); const it2 = Object.values((await store(sw, "items")).items).find(i => i.ahist); t.check(it2.ahist.ranges["1M"].points.length === it.ahist.ranges["1M"].points.length, "chart announcing a different price is ignored");
}));

test("36", "chart reader: health counters tick (read/stored/refused), Settings shows them, and a remote disabled_features flag stops reading", t => withExt({}, async ({ ctx, sw, extId }) => {
  const svg = (await import("node:fs")).readFileSync(new URL("../fixtures/amazon-history/chart-1m.svg", import.meta.url), "utf8");
  const add = (p, h) => p.evaluate(h => { const w = document.createElement("div"); w.innerHTML = h; document.body.append(w); }, h);
  const { p, panel } = await product(ctx, { id: "B0AMZHEALT", price: 4499, mrp: 5999 }); await panel.open(); await sleep(600);
  await add(p, svg.replace(/price ₹4,499/, "price ₹1,111")); await poll(async () => ((await store(sw, "chartHealth")).chartHealth || {}).reasons, 6000, 300);
  let h = (await store(sw, "chartHealth")).chartHealth || {}; t.check(h.refused >= 1 && (h.reasons.unreadable || h.reasons["other-product"]) >= 1 && !h.stored, "a chart for another price is counted as refused: " + JSON.stringify(h));
  await add(p, svg); await poll(async () => ((await store(sw, "chartHealth")).chartHealth || {}).stored, 8000, 300);
  h = (await store(sw, "chartHealth")).chartHealth || {}; t.check(h.read >= 1 && h.stored === 1, "good chart counted read + stored: " + JSON.stringify(h));
  const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`); await o.waitForSelector("#trk .srow:last-child");
  await o.waitForSelector("#hstat .pill"); await sleep(300); t.check(/1 saved/.test(await o.$eval("#hstat", e => e.textContent)), "Settings shows the chart reader count: " + (await o.$eval("#hstat", e => e.textContent)).slice(0, 80));
  await seed(sw, { flags: { disabled_features: ["chart-read"] } });
  const { p: p2, panel: pn2 } = await product(ctx, { id: "B0AMZKILL01", price: 4499, mrp: 5999 }); await pn2.open(); await sleep(600);
  await add(p2, svg); await sleep(2500);
  t.check(!Object.entries((await store(sw, "items")).items || {}).some(([k, i]) => /B0AMZKILL01/.test(k + (i.url || "")) && i.ahist), "kill switch: chart on a product is not read while chart-read is disabled");
  await o.reload(); await o.waitForSelector("#hstat .pill"); t.check(/Paused for now/.test(await o.$eval("#hstat", e => e.textContent)), "Settings says the reader is paused");
}));

test("33", "how soon: 2-3 days / 1 week / 1 month changes a fair price from Buy to Wait, saves the choice, and offers an alert price", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw);
  const now = Date.now(), id = "B0HORIZON1"; await seed(sw, { items: seedItem(id, [[now - 60 * D, 1050], [now - 40 * D, 1000], [now - 20 * D, 1050], [now - 36e5, 1050]]) });
  const { panel } = await product(ctx, { id, price: 1050, mrp: 0 }); await panel.open();
  const word = () => panel.text(".vcard .vw"), pick = async h => { await panel.click(`.hz [data-h="${h}"]`); await sleep(500); };
  t.check(/Fair/.test(await word()), "default 1 week: fair price stays Fair: " + await word());
  await panel.run(".hero", function () { this.__keep = 1; }); await panel.run(".chips3", function () { this.__keep = 1; });
  const tipTxt = await panel.text(".info .itip"); t.check(tipTxt.length > 10, "info button carries a hover explanation: " + tipTxt.slice(0, 80));
  await panel.click('.hz [data-h="3d"]'); t.check(await panel.has(".bn-body .skel"), "the card shows a skeleton while it refreshes");
  await sleep(600);
  t.check(await panel.run(".hero", function () { return this.__keep === 1; }) && await panel.run(".chips3", function () { return this.__keep === 1; }), "only the buy-now card refreshed: the rest of the panel was not redrawn");
  await pick("1w"); await pick("3d"); t.check(/Buy/.test(await word()), "need it in 2-3 days: Buy: " + await word());
  await pick("1m"); t.check(/Wait/.test(await word()), "can wait a month: Wait: " + await word());
  const ab = await panel.text(".nudge"); t.check(/Alert me at ₹1,0\d\d/.test(ab), "alert price offered between the low and today: " + ab);
  const st = await store(sw, "horizon"); t.check(st.horizon === "1m", "choice saved: " + st.horizon);
  await panel.click(".nudge .btn"); await sleep(600); const it = Object.values((await store(sw, "items")).items).find(i => i.target); t.check(it && it.target > 1000 && it.target < 1050, "alert target stored: " + (it && it.target));
}));

test("34", "auto-read (opt-in): clicks Amazon's own Price-history button in the tab you are on, reads the chart (1M, 3M, 1Y), closes the panel; off by default", t => withExt({}, async ({ ctx, sw }) => {
  const svg = (await import("node:fs")).readFileSync(new URL("../fixtures/amazon-history/chart-1m.svg", import.meta.url), "utf8");
  const install = async p => p.evaluate(h => { window.__clicked = 0; window.__closed = 0; const d = document.createElement("div"); d.id = "rufus-price-ingress-bb"; d.innerHTML = '<span class="a-declarative" data-action="show-rufus-price-ingress"><span class="a-button-text">Price history</span></span>'; document.body.append(d);
    d.querySelector(".a-declarative").addEventListener("click", () => { window.__clicked++; setTimeout(() => { const f = document.createElement("div"); f.id = "nav-flyout-rufus"; f.innerHTML = '<div id="rufus-panel-header-container"><button class="rufus-panel-tooltip-close" aria-label="Close tip"></button><button id="rufus-panel-header-close" aria-label="close"></button></div><div id="rufus-react-renderer"><span class="rufus-pricing-chart-container">' + h + '</span></div>'; document.body.append(f); f.querySelector("#rufus-panel-header-close").addEventListener("pointerup", () => { window.__closed++; f.remove(); }); /* like Amazon: a bare click() does nothing, a real press closes it */ window.__hiddenSeen = !!document.getElementById("hauls-ah-hide"); }, 300); }); }, svg);
  // default OFF: nothing is clicked
  let r = await product(ctx, { id: "B0AUTOOFF1", price: 4499, mrp: 5999 }); await install(r.p); await sleep(3500);
  t.check((await r.p.evaluate(() => window.__clicked)) === 0, "off by default: the Price history button is never touched");
  await r.p.close();
  await seed(sw, { ahAuto: true });
  r = await product(ctx, { id: "B0AUTOON01", price: 4499, mrp: 5999 }); await install(r.p);
  // the content script ran its check before the button existed; trigger a new lookup the way a page change would
  await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  const ok = await poll(async () => Object.values((await store(sw, "items")).items || {}).some(i => i.key !== undefined || (i.ahist && Object.keys(i.ahist.ranges || {}).length)), 12000, 400);
  const got = Object.values((await store(sw, "items")).items || {}).find(i => i.ahist && i.ahist.ranges && i.ahist.ranges["1M"]);
  t.check(!!got, "chart stored after the auto-read (panel removed right after it appeared): clicked=" + await r.p.evaluate(() => window.__clicked));
  t.check((await r.p.evaluate(() => window.__clicked)) >= 1, "button clicked"); t.check(got.ahist.ranges["1M"].points[0][1] === 5499, "chart read");
  await poll(async () => (await r.p.evaluate(() => window.__closed)) >= 1 && !(await r.p.evaluate(() => document.getElementById("hauls-ah-hide"))), 8000, 300); t.check((await r.p.evaluate(() => window.__closed)) >= 1 && !(await r.p.evaluate(() => document.getElementById("hauls-ah-hide"))), "panel closed and the hiding style removed");
  t.check(!!got.ahist.tried, "attempt recorded (no repeat within 12 h)");
  t.check((await r.p.evaluate(() => window.__hiddenSeen)) === false, "the panel is not hidden while it is read (you see it open)");
}));

test("56", "Amazon history opened by YOU on 1M: HAULS switches Amazon's own panel to 1Y once, so 30D / 90D / 1Y all have real data (and never loops)", t => withExt({}, async ({ ctx, sw }) => {
  const svg = (await import("node:fs")).readFileSync(new URL("../fixtures/amazon-history/chart-1m.svg", import.meta.url), "utf8");
  const r = await product(ctx, { id: "B0YEARPICK", price: 4499, mrp: 5999 }); // ahAuto is OFF: nothing here is HAULS's own reader
  await r.p.evaluate(h => { window.__year = 0; const f = document.createElement("div"); f.id = "nav-flyout-rufus"; f.innerHTML = '<div id="rufus-react-renderer"><div role="tablist"><span role="tab" aria-selected="true">1M</span><span role="tab" aria-selected="false">3M</span><span role="tab" aria-selected="false">1Y</span></div><span class="rufus-pricing-chart-container">' + h + '</span></div>'; setTimeout(() => { document.body.append(f); [...f.querySelectorAll("[role=tab]")].find(e => e.textContent === "1Y").addEventListener("click", () => { window.__year++; const c = f.querySelector(".rufus-pricing-chart-container"); c.innerHTML = h; }); }, 800); }, svg);
  await poll(async () => (await r.p.evaluate(() => window.__year)) >= 1, 12000, 300);
  t.check((await r.p.evaluate(() => window.__year)) === 1, "the 1Y tab was clicked once after the 1M chart appeared");
  await sleep(9500);
  t.check((await r.p.evaluate(() => window.__year)) === 1, "and not again (no loop): " + await r.p.evaluate(() => window.__year));
  const got = Object.values((await store(sw, "items")).items || {}).find(i => i.ahist && i.ahist.ranges && i.ahist.ranges["1M"]);
  t.check(!!got, "the 1M chart was still stored");
}));

test("63", "low / avg / high chips: switching ranges never turns a chip into a green oval, and the line under each chip says how today's price compares in words", t => withExt({}, async ({ ctx, sw }) => {
  const now = Date.now(), id = "B0CHIPS001";
  await seed(sw, { items: seedItem(id, [[now - 354 * D, 5599], [now - 250 * D, 5188], [now - 200 * D, 4999], [now - 100 * D, 5299], [now - 5 * D, 4777]]) });
  const { panel } = await product(ctx, { id, price: 4777, mrp: 9999 }); await panel.open();
  const read = () => panel.ev(function () { return [...this.querySelectorAll(".chip3")].map(c => ({ br: getComputedStyle(c).borderRadius, bg: getComputedStyle(c).backgroundColor, cls: c.className, txt: c.textContent.replace(/\s+/g, " ").trim() })); });
  for (const r of ["1Y", "30D", "90D", "1Y"]) { await panel.click(`.seg:not(.hz) button[data-r='${r}']`); await sleep(1200); const c = await read();
    t.check(c.length === 3 && c.every(x => x.br === "14px"), `${r}: all three chips keep the card shape (${c.map(x => x.br).join(",")})`);
    t.check(c[0].bg === "rgb(255, 255, 255)" && c[1].bg === "rgb(255, 255, 255)", `${r}: Low and Avg stay white, no mint fill (${c[0].bg} / ${c[1].bg})`); t.check(!c.some(x => /\bchg\b/.test(x.cls)), `${r}: the flash class does not collide with the pill style`); }
  const c = await read(); t.check(/at the low/.test(c[0].txt) && /below/.test(c[1].txt) && /below/.test(c[2].txt) && !/now/i.test(c.map(x => x.txt).join(" ")), "plain words: " + c.map(x => x.txt).join(" | "));
}));

test("64", "Amazon reader when the tabs only answer a real press (like Amazon's own controls): the year is still reached and stored with tab 1Y", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const id = "B0PRESSONL", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 800, otherMs: 400, tabEvent: "pointerup" }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 45000, 400)), "the panel was closed after reading");
  const w = await r.p.evaluate(() => window.__clicks.join()), ah = ((await store(sw, "items")).items[k] || {}).ahist || { ranges: {} }, y = ah.ranges["1Y"];
  t.check(w === "1Y", "the year tab was reached with a real press (a plain click does nothing on this panel): " + w);
  t.check(!!y && y.tab === "1Y" && y.days === 365, "the year was stored: " + JSON.stringify(y && [y.tab, y.days]) + " ranges=" + JSON.stringify(Object.entries(ah.ranges).map(([n, v]) => [n, v.tab, v.days])) + " tried=" + ah.tried);
  const hh = (await store(sw, "chartHealth")).chartHealth || {}; t.check(JSON.stringify(hh).includes("y-stored"), "Settings counts the stored year: " + JSON.stringify(hh).slice(0, 160));
}));

test("65", "Amazon reader retry rule: a product that only has its month is read again after 20 minutes; a product that already has its year is left alone for 12 hours", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const now = Date.now(), mk = (id, tab, ago) => ({ [key(id)]: { site: "Amazon", title: "Test", url: `https://www.amazon.in/dp/${id}`, hist: [[now - 3 * D, 4499]], ahist: { at: now - ago, tried: now - ago, ranges: { [tab === "1Y" ? "1Y" : "1M"]: { range: tab === "1Y" ? "1Y" : "1M", days: tab === "1Y" ? 365 : 30, points: [[now - 29 * D, 5499], [now - D, 4499], [now, 4499]], current: 4499, at: now - ago, tab } } } } });
  await seed(sw, { items: { ...mk("B0ONLYMNTH", "1M", 3600e3), ...mk("B0HASYEAR1", "1Y", 3600e3) } });
  let r = await product(ctx, { id: "B0ONLYMNTH", price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 600, otherMs: 300 }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 45000, 400)), "month-only product, read 1 h ago: the reader ran again (it used to wait 12 h)");
  const y = (((await store(sw, "items")).items[key("B0ONLYMNTH")] || {}).ahist || { ranges: {} }).ranges["1Y"]; t.check(!!y && y.tab === "1Y", "and it got the year this time");
  await r.p.close();
  r = await product(ctx, { id: "B0HASYEAR1", price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 600, otherMs: 300 }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); }); await sleep(6000);
  t.check((await r.p.evaluate(() => window.__closed)) === 0 && (await r.p.evaluate(() => window.__clicks.length)) === 0, "product that already has its year, read 1 h ago: left alone");
}));

test("66", "range-only chart (Amazon's sentence but no day-by-day line yet): a 'Read Amazon's chart now' button reads it even with the automatic switch OFF, and the real line replaces the band", t => withExt({}, async ({ ctx, sw }) => {
  const now = Date.now(), id = "B0BANDONLY", k = key(id);
  await seed(sw, { items: { [k]: { site: "Amazon", title: "Test", url: `https://www.amazon.in/dp/${id}`, hist: [], ref: { days: 30, low: 3999, high: 4999, at: now } } } }); // ahAuto is NOT set: the switch is off
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await sleep(800);
  t.check(await r.panel.has(".cw.bandc"), "the band is drawn when only the range is known"); const txt = await r.panel.text(".chartbox");
  t.check(/Only Amazon's 30-day range so far/.test(txt) && /Read Amazon's chart now/.test(txt) && /Turn on automatic reading/.test(txt), "it says what it has and offers the button and the switch: " + txt.replace(/\s+/g, " ").slice(0, 200));
  await amzFake(r.p, { yearMs: 500, otherMs: 300 }); await r.panel.click(".chartbox .readctl button.btn");
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 45000, 400)), "the button ran the reader (the panel opened and closed again) with the switch off");
  await sleep(1200); t.check((await r.panel.has(".cw svg")) && !(await r.panel.has(".cw.bandc")), "the day-by-day line replaced the band");
}));

test("67", "range-only chart when Amazon is not offering its price history (no button on the page): pressing 'Read Amazon's chart now' says so plainly instead of doing nothing", t => withExt({}, async ({ ctx, sw }) => {
  const now = Date.now(), id = "B0NOBUTTON", k = key(id);
  await seed(sw, { items: { [k]: { site: "Amazon", title: "Test", url: `https://www.amazon.in/dp/${id}`, hist: [], ref: { days: 30, low: 3999, high: 4999, at: now } } } });
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await sleep(800);
  await r.panel.click(".chartbox .readctl button.btn");
  t.check(!!(await poll(async () => /Amazon isn't showing its price history/.test(await r.panel.text(".chartbox")), 20000, 500)), "after ~10 s it says Amazon isn't offering the history and to sign in: " + (await r.panel.text(".chartbox")).replace(/\s+/g, " ").slice(0, 160));
  t.check(await r.panel.has(".chartbox .readctl button.btn"), "and the button is available again");
}));

test("68", "Grocery tab carries a small 'Beta' capsule, readable in both tab states, and the tab row does not overflow", t => withExt({}, async ({ ctx }) => {
  const { panel } = await product(ctx, { id: "B0BETATEST", price: 830, mrp: 1299 }); await panel.open(); await sleep(500);
  const info = () => panel.ev(function () { const b = this.querySelectorAll(".tabs button")[1], be = b.querySelector(".beta"), tl = this.querySelector(".tabs"), r = be.getBoundingClientRect(), br = b.getBoundingClientRect(); return { txt: b.textContent.replace(/\s+/g, " ").trim(), bg: getComputedStyle(be).backgroundColor, inside: r.left >= br.left && r.right <= br.right, overflow: tl.scrollWidth > tl.clientWidth + 1, others: [...this.querySelectorAll(".tabs button")].filter((x, i) => i !== 1).every(x => !x.querySelector(".beta")) }; });
  let i = await info(); t.check(i.txt === "Grocery Beta" && i.inside && !i.overflow && i.others, "Beta sits inside the Grocery tab only: " + JSON.stringify(i)); t.check(i.bg === "rgb(255, 217, 61)", "yellow capsule, same in every state: " + i.bg);
  await panel.tab(1); await sleep(500); i = await info(); t.check(i.inside && !i.overflow, "still inside and not overflowing when the Grocery tab is selected: " + JSON.stringify(i));
}));

test("77", "Amazon reader: when Amazon already opens on the year, no tab is touched and the year is stored", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const id = "B0STARTYR1", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 500, otherMs: 300, startYear: true }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 45000, 400)), "the panel was read and closed");
  const w = await r.p.evaluate(() => window.__clicks.join()), y = (((await store(sw, "items")).items[k] || {}).ahist || { ranges: {} }).ranges["1Y"];
  t.check(w === "" && !!y && y.days === 365, "no tab was clicked and the year was stored: clicks=" + JSON.stringify(w) + " " + JSON.stringify(y && [y.tab, y.days]));
}));

test("78", "Amazon reader: the panel is ALREADY open (Amazon restored it) and the button would toggle it shut: the reader leaves the button alone, switches to the year and stores it", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const id = "B0OPENATLD", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 500, otherMs: 300, toggle: true, openAtLoad: true }); await sleep(900); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 45000, 400)), "the panel was read and closed");
  const w = await r.p.evaluate(() => ({ ing: window.__ing, clicks: window.__clicks.join() })), y = (((await store(sw, "items")).items[k] || {}).ahist || { ranges: {} }).ranges["1Y"];
  t.check(w.ing === 0, "the Price history button was NOT clicked (it would have closed the open panel): " + JSON.stringify(w)); t.check(!!y && y.days === 365, "the year was stored: " + JSON.stringify(y && [y.tab, y.days]));
}));

test("80b", "Amazon products without the year show 'Read Amazon's chart now'; one press reads it (switch off) and the button goes away", t => withExt({}, async ({ ctx, sw }) => {
  const now = Date.now(), id = "B0YEARBTN1", k = key(id);
  await seed(sw, { items: { [k]: { site: "Amazon", title: "Test", url: `https://www.amazon.in/dp/${id}`, hist: [[now - 20 * D, 4999], [now - D, 4499]] } } }); // ahAuto is OFF
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await sleep(800);
  t.check(await r.panel.has(".chartbox .link-btn") && /Read Amazon's chart now/.test(await r.panel.text(".chartbox .link-btn")), "the button is offered when only a month is known");
  await amzFake(r.p, { yearMs: 500, otherMs: 300 }); await r.panel.click(".chartbox .link-btn");
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 45000, 400)), "the press ran the reader (switch off) and it closed again");
  await sleep(1500); const y = (((await store(sw, "items")).items[k] || {}).ahist || { ranges: {} }).ranges["1Y"]; t.check(!!y && y.days === 365, "the year was stored");
  t.check(!(await r.panel.has(".chartbox .link-btn")), "the button is gone once the year is there");
}));

test("81", "Compare card: the reason on a closest-but-different row (different product / model / generation...) stays fully inside the card, on desktop and on a phone, and the card look is otherwise unchanged", t => withExt({ viewport: { width: 1280, height: 900 } }, async ({ ctx, sw }) => {
  await sw.evaluate(() => { globalThis.cmpFind = async () => ({ results: [], failed: [], near: [{ store: "Flipkart", price: 283, why: "different product", title: "Some other listing", url: "https://www.flipkart.com/x/p/itm1" }, { store: "Reliance Digital", price: 2490, why: "different generation (storage 256 GB, colour)", title: "Another listing", url: "https://www.reliancedigital.in/product/x/" }] }); });
  const { panel } = await product(ctx, { id: "B0NEARROW1", price: 299, mrp: 499 }); await panel.open(); await sleep(600);
  await panel.click(".cmp .btn"); await poll(async () => (await panel.count(".cmp-r.near")) >= 2, 8000, 300);
  const chk = () => panel.ev(function () { const card = this.querySelector(".cmp").getBoundingClientRect(); return [...this.querySelectorAll(".cmp-r.near")].map(r => { const rr = r.getBoundingClientRect(), tg = r.querySelector(".tag").getBoundingClientRect(); return { txt: r.querySelector(".tag").textContent, inside: tg.left >= rr.left && tg.right <= rr.right && rr.right <= card.right + 1, h: Math.round(tg.height), own: tg.top > r.querySelector("b").getBoundingClientRect().bottom - 2 }; }); });
  let rows = await chk(); t.check(rows.length === 2 && rows.every(x => x.inside && x.own), "desktop: every reason is inside its row and on its own line: " + JSON.stringify(rows));
  t.check(/No confident match at other stores/.test(await panel.text(".cmp")), "the card still says 'No confident match at other stores.'");
  t.check(await panel.ev(function () { return [...this.querySelectorAll(".cmp-r.near .tag")].every(g => { const c = getComputedStyle(g); return c.position === "static" && c.transform === "none"; }); }), "the reason is a plain capsule (not the rotated absolute price sticker)");
}));

test("82", "Amazon reader REGRESSION (1.21.2): the page carries the 'docked' marker but NO panel is open: the reader must still press Price history, then 1Y, and 'Read Amazon's chart now' must work too", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const id = "B0DOCKONLY", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 500, otherMs: 300, dockedOnly: true }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 45000, 400)), "the reader opened Amazon's panel (marker or not) and closed it again");
  const w = await r.p.evaluate(() => ({ ing: window.__ing, clicks: window.__clicks.join() })), y = (((await store(sw, "items")).items[k] || {}).ahist || { ranges: {} }).ranges["1Y"];
  t.check(w.ing >= 1 && w.clicks === "1Y", "the button was pressed and the year tab reached: " + JSON.stringify(w)); t.check(!!y && y.days === 365, "the year was stored: " + JSON.stringify(y && [y.tab, y.days]));
}));

test("88", "Amazon reader REGRESSION (1.21.4, from the owner's probe): the data-action attribute sits ON the .rufus-ph-ingress-pill itself (id rufus-price-ingress-cc), not inside it: the reader must still find the button, read 1M then 1Y and close", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const id = "B0PILLCC01", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 500, otherMs: 300, pill: true }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 45000, 400)), "the reader opened Amazon's panel and closed it again");
  const w = await r.p.evaluate(() => ({ ing: window.__ing, clicks: window.__clicks.join() })), y = (((await store(sw, "items")).items[k] || {}).ahist || { ranges: {} }).ranges["1Y"];
  t.check(w.ing >= 1 && w.clicks === "1Y", "the button was pressed and the year tab reached: " + JSON.stringify(w)); t.check(!!y && y.days === 365, "the year was stored: " + JSON.stringify(y && [y.tab, y.days]));
}));

test("84", "Amazon reader REGRESSION (1.21.3, from the owner's recording): the panel opens at once but Amazon draws the chart 12 s later: the reader presses the button ONCE, waits, and reads 1M then 1Y; it never closes the panel while it loads", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const id = "B0SLOWCHRT", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 500, otherMs: 300, chartDelay: 12000, toggle: true }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 70000, 400)), "the panel was read and closed");
  const w = await r.p.evaluate(() => ({ ing: window.__ing, clicks: window.__clicks.join() })), y = (((await store(sw, "items")).items[k] || {}).ahist || { ranges: {} }).ranges["1Y"];
  t.check(w.ing === 1 && w.clicks === "1Y", "ONE press of the button (a second would have closed the loading panel) and the year tab reached: " + JSON.stringify(w)); t.check(!!y && y.days === 365, "the year was stored: " + JSON.stringify(y && [y.tab, y.days]));
}));

test("85", "Amazon reader: the Price history button only answers a full press (a plain click does nothing): the reader falls back to the press and the year is read", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const id = "B0PRESSBTN", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 500, otherMs: 300, ingressEvent: "pointerup" }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 60000, 400)), "the panel was opened by the press and closed again");
  const y = (((await store(sw, "items")).items[k] || {}).ahist || { ranges: {} }).ranges["1Y"]; t.check(!!y && y.days === 365, "the year was stored: " + JSON.stringify(y && [y.tab, y.days]));
}));

test("86", "Amazon answers with the sentence only and never draws a chart: the reader gives up after its wait, CLOSES the panel it opened, leaves a diagnostic snapshot, and the panel shows the plain failure with ONE button", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const id = "B0NOCHART1", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 500, otherMs: 300, noChart: true }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 80000, 500)), "the panel the reader opened was closed again (not left on screen)");
  const w = await r.p.evaluate(() => window.__ing), d = (await store(sw, "ahDiag")).ahDiag;
  t.check(w === 1 && d && d.why === "no-chart" && d.key === k && Array.isArray(d.steps) && d.steps[0] === "click" && Array.isArray(d.rufus), "one press, and a snapshot of what the page looked like was kept: " + JSON.stringify(d && [d.why, d.steps]));
  await sleep(1500); const txt = await r.panel.text("main"); t.check((txt.match(/Read Amazon's chart now/g) || []).length === 1, "exactly ONE 'Read Amazon's chart now' on screen (not two): " + (txt.match(/Read Amazon's chart now/g) || []).length);
}));

test("87", "Amazon's Price history button does nothing at all (no panel ever opens): click, press and keyboard are each tried once, then the reader stops with a snapshot (no loop, no toggling)", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const id = "B0NOPANEL1", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { noPanel: true }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(async () => (await store(sw, "ahDiag")).ahDiag, 40000, 500)), "a snapshot was written");
  const d = (await store(sw, "ahDiag")).ahDiag, ing = await r.p.evaluate(() => window.__ing);
  t.check(d.why === "no-panel" && d.steps.join() === "click,press,hit", "all three methods tried once, in order: " + JSON.stringify([d.why, d.steps]) + " button events=" + ing);
}));

test("37", "Amazon background read: while idle, one watched product is opened in a small window, its chart is read by the page script, the window closes; off unless opted in", t => withExt({}, async ({ ctx, sw, extId }) => {
  const svg = (await import("node:fs")).readFileSync(new URL("../fixtures/amazon-history/chart-1m.svg", import.meta.url), "utf8"), id = "B0AMZBGRD1", now = Date.now();
  await ctx.addInitScript(h => { if (!/B0AMZBGRD1/.test(location.pathname)) return; document.addEventListener("DOMContentLoaded", () => { const d = document.createElement("div"); d.id = "rufus-price-ingress-bb"; d.innerHTML = '<span class="a-declarative" data-action="show-rufus-price-ingress"><span class="a-button-text">Price history</span></span>'; document.body.append(d);
    d.querySelector(".a-declarative").addEventListener("click", () => setTimeout(() => { const f = document.createElement("div"); f.id = "nav-flyout-rufus"; f.innerHTML = '<div id="rufus-panel-header-container"><button class="rufus-panel-tooltip-close" aria-label="Close tip"></button><button id="rufus-panel-header-close" aria-label="close"></button></div><div id="rufus-react-renderer"><span class="rufus-pricing-chart-container">' + h + '</span></div>'; document.body.append(f); f.querySelector("button").addEventListener("click", () => f.remove()); }, 300)); }); }, svg);
  await routeProduct(ctx, { id, price: 4499, mrp: 5999 });
  await seed(sw, { items: seedItem(id, [[now - 5 * D, 4499], [now - 3600e3, 4499]], { wish: true, seenAt: now - 3600e3 }) });
  const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`);
  const run = () => o.evaluate(() => chrome.runtime.sendMessage({ type: "abg-run", gesture: true }));
  let r = await run(); t.check(r && r.ok === false && r.why === "off", "not opted in: nothing opens: " + JSON.stringify(r));
  await seed(sw, { ahAuto: true }); const pagesBefore = ctx.pages().length;
  ctx.on("page", pg => { pg.reload().catch(() => {}); }); // Playwright attaches its route after an extension-made window has already started loading: reload once so the fake Amazon page is served
  r = await run(); t.check(r && r.ok === true && r.key.endsWith(id), "opted in: the chart was read in the background: " + JSON.stringify(r));
  const it = (await store(sw, "items")).items["amazon.in:" + id]; t.check(it.ahist && it.ahist.ranges["1M"] && it.ahist.ranges["1M"].points[0][1] === 5499, "series stored from the background read");
  await sleep(800); t.check(ctx.pages().length <= pagesBefore, "the window is closed again: " + ctx.pages().length + " pages");
  r = await run(); t.check(r && r.ok === false && /nothing due/.test(r.why), "not repeated for the same product: " + JSON.stringify(r));
  await seed(sw, { flags: { disabled_features: ["chart-auto"] }, abg: null }); r = await run(); t.check(r && r.why === "off", "kill switch chart-auto stops it: " + JSON.stringify(r));
  const h = (await store(sw, "chartHealth")).chartHealth; t.check(h && h["bg-read"] === 1, "counted: " + JSON.stringify(h));
}));

test("38", "Flipkart + Myntra sellers: Flipkart lists sellers on a click (one request, inactive seller never lowest); Myntra lists the page's own sellers with no request", t => withExt({}, async ({ ctx, sw }) => {
  const fs = await import("node:fs"), fk = fs.readFileSync(new URL("../fixtures/offers/flipkart-sellers.json", import.meta.url), "utf8"), my = fs.readFileSync(new URL("../fixtures/offers/myntra-pdp.html", import.meta.url), "utf8");
  let posts = 0; await ctx.route("https://1.rome.api.flipkart.com/**", r => { posts++; r.fulfill({ status: 200, contentType: "application/json", body: fk }); });
  const ld = (title, price) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: title, image: "https://example.com/i.jpg", offers: { "@type": "Offer", price: String(price), priceCurrency: "INR" } })}</script>`;
  await ctx.route("https://www.flipkart.com/test-laptop/p/itm1*", r => r.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><meta charset=utf-8><title>Test Laptop</title>${ld("Test Laptop", 60990)}</head><body><h1>Test Laptop</h1></body></html>` }));
  await ctx.route("https://www.myntra.com/lounge/levis/tee/12027436/buy*", r => r.fulfill({ status: 200, contentType: "text/html", body: my.replace("<html>", `<html><head><meta charset=utf-8><title>Levis tee</title>${ld("Levis Men Soft Pure Cotton Round Neck Half Sleeve Tshirt", 376)}</head>`) }));
  const f = await openPage(ctx, "https://www.flipkart.com/test-laptop/p/itm1?pid=COMGZUYDGFJGHZR4"); await f.panel.open(); await sleep(800);
  t.check(await f.panel.has(".offers .btn"), "flipkart: 'See other sellers' button shown"); t.check(posts === 0, "no request before the click");
  await f.panel.click(".offers .btn"); await poll(async () => (await f.panel.count(".off-r")) >= 5, 8000, 300);
  const txt = await f.panel.text(".offers"); t.check(posts === 1 && (await f.panel.count(".off-r")) === 5, "five sellers from one request: " + posts);
  t.check(/RetailNet \(here\)/.test(txt) && /Seller 4\.3★/.test(txt) && !/\(0/.test(txt), "here + rating shown, no '(0)' count: " + txt.slice(0, 160));
  t.check(!/Delivery /.test(txt) && /default location/.test(txt), "no pin saved: Flipkart's default-location delivery dates are not shown, and the note says why: " + txt.slice(-160));
  t.check(!(await f.panel.ev(function () { return [...this.querySelectorAll(".rdot")].some(d => /\(0\)/.test(d.title)); })), "rating dot tooltip has no '(0)'");
  t.check(await f.panel.count(".off-r.low") === 1 && /RetailNet/.test(await f.panel.text(".off-r.low")), "lowest is the cheapest active seller");
  const m = await openPage(ctx, "https://www.myntra.com/lounge/levis/tee/12027436/buy"); await m.panel.open(); await sleep(1200);
  const mt = await m.panel.text(".offers"); t.check(/Vision Star/.test(mt) && /MODENIK/.test(mt) && /₹376/.test(mt) && /₹421/.test(mt), "myntra: both sellers with their prices: " + mt.slice(0, 200));
  t.check(/Sizes S, M, XL/.test(mt), "myntra: sizes per seller");
}));

test("39", "Impulse Check (Amazon): real page markup -> stock/deal/popularity cues from the product zones only; carousels and reviews ignored; memory + price context drive the verdict; no cue = no card", t => withExt({}, async ({ ctx, sw }) => {
  const fs = await import("node:fs"), fx = n => JSON.parse(fs.readFileSync(new URL(`../fixtures/impulse/amazon-${n}.json`, import.meta.url), "utf8")).zones;
  const page = async (id, fixture, { stockText, extra = "", noSocial = false } = {}) => { const z = fx(fixture); let av = z["#availability"] ? z["#availability"].html : '<div id="availability">In stock</div>'; if (stockText) av = av.replace(/>\s*In stock\s*</, `>${stockText}<`);
    const html = `<!doctype html><html><head><meta charset=utf-8><title>Test</title></head><body><div id="dp-container"><div id="centerCol">${z["#productTitle"].html}${z["#corePrice_feature_div"] ? z["#corePrice_feature_div"].html : '<div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">₹32,999.00</span></span></div>'}${z["#dealBadge_feature_div"] ? z["#dealBadge_feature_div"].html : ""}${z["#socialProofingAsinFaceout_feature_div"] && !noSocial ? z["#socialProofingAsinFaceout_feature_div"].html : ""}${av}</div>${extra}</div></body></html>`;
    await ctx.route(`https://www.amazon.in/dp/${id}*`, r => r.fulfill({ status: 200, contentType: "text/html", body: html })); return `https://www.amazon.in/dp/${id}`; };
  const open = async (id, fixture, o) => { const url = await page(id, fixture, o), r = await openPage(ctx, url); await r.panel.open(); await sleep(700); return r; };
  // 1. a real deal page: the label and the popularity count are shown, nothing is claimed about them
  let r = await open("B07Y916W4P", "B07Y916W4P.deal"); let ic = await r.panel.has(".impulse"); t.check(ic, "deal page shows the Impulse Check card");
  let txt = await r.panel.text(".impulse"); t.check(/Limited-time deal label/.test(txt) && /400\+ bought in past month/.test(txt) && /Urgency message on this page/.test(txt), "deal + bought chips, neutral headline: " + txt.slice(0, 160));
  t.check(!/fake|scam|lie|fraud/i.test(txt), "no accusations");
  // 2. a sale-event label page
  r = await open("B0H1WY55ZL", "B0H1WY55ZL.bought"); txt = await r.panel.text(".impulse"); t.check(/Sale event label/.test(txt), "sale event label shown: " + txt.slice(0, 100));
  // 3. a real page whose main product is 'In stock' but whose carousel says 'Only 1 left in stock': the carousel must not count
  r = await open("B0G319XS3M", "B0G319XS3M.bought", { extra: '<ul id="similar"><li><div>Only 1 left in stock.</div></li><li><div class="a-row"><div class="_cDEzb_savingsRioCompliantBadgeLabel_6EU5w"><span class="a-size-small">Ends in 23:08:24</span></div></div></li></ul><div id="customerReviews">Only 3 left! 47 people are viewing this</div>' }); txt = (await r.panel.has(".impulse")) ? await r.panel.text(".impulse") : "";
  t.check(!/Only \d left|people viewing|Countdown timer/.test(txt), "carousel (stock and a live countdown, as captured on real Amazon) and review text are ignored: " + txt.slice(0, 120));
  // 4. a page with nothing urgent: no card at all
  r = await open("B0F7XWCCY3", "B0F7XWCCY3.bought", {}); t.check(await r.panel.has(".impulse") && !/Limited|Sale event/.test(await r.panel.text(".impulse")), "popularity only: card lists it, no deal/stock claim");
  r = await open("B0NOCUES01", "B0F7XWCCY3.bought", { noSocial: true }); t.check(!(await r.panel.has(".impulse")), "no urgency message: no card (never an empty 'all clear')");
  // 5. real stock message in the availability zone + memory of earlier visits + a flat price -> repeated
  const now = Date.now(); const key = "amazon.in:B0STOCK2VI"; const url = await page("B0STOCK2VI", "B07Y916W4P.deal", { stockText: "Only 2 left in stock - order soon." });
  await seed(sw, { items: { [key]: { site: "Amazon", title: "Backpack", url, hist: [[now - 40 * D, 2249], [now - 10 * D, 2249]], urg: { v: [0, 2].map(i => ({ at: now - (5 - i) * D, stock: 2 })), restarts: 0, daily: 0 } } } });
  r = await openPage(ctx, url); await r.panel.open(); await sleep(900); txt = await r.panel.text(".impulse");
  t.check(/Only 2 left/.test(txt) && /Same stock message again/.test(txt) && /on 3 visits over 5 days/.test(txt), "stock repeated across visits (earlier two + this one): " + txt.slice(0, 200));
  const mem = (await store(sw, "items")).items[key].urg; t.check(mem.v.length === 3 && mem.v[2].stock === 2, "this visit was remembered (numbers only): " + JSON.stringify(mem.v[2]));
  t.check(!JSON.stringify(mem).includes("order soon"), "no page text is stored");
  // 6. flat price and a message: the price context line
  await seed(sw, { items: { [key]: { site: "Amazon", title: "Backpack", url, hist: [[now - 40 * D, 2249], [now - 10 * D, 2249]], urg: { v: [], restarts: 0, daily: 0 } } } });
  r = await openPage(ctx, url); await r.panel.open(); await sleep(900); txt = await r.panel.text(".impulse"); t.check(/Price steady for 21 days/.test(txt), "price context shown: " + txt.slice(0, 160));
}));

test("40", "Impulse Check on REAL Amazon.in pages: chips come only from the product's own zones (live, skippable)", t => withExt({}, async ({ ctx, errs }) => {
  for (const asin of ["B07Y916W4P", "B0H1WY55ZL", "B0G319XS3M"]) {
    const p = await ctx.newPage(); await p.goto(`https://www.amazon.in/dp/${asin}`, { waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => {}); await sleep(2500);
    const raw = await p.evaluate(() => ({ captcha: /enter the characters|robot check/i.test(document.body.innerText), anyOnly: (document.body.innerText.match(/only\s+\d+\s+left/gi) || []).length, avail: (document.querySelector("#availability") || {}).innerText || "" }));
    if (raw.captcha) { t.note(asin + ": captcha, skipped"); await p.close(); continue; }
    const panel = await Panel.attach(ctx, p); await panel.waitKnob(); await panel.open(); await sleep(800);
    const has = await panel.has(".impulse"), txt = has ? await panel.text(".impulse") : "";
    t.note(`${asin}: card=${has} text="${txt.slice(0, 110)}" availability="${raw.avail.trim().slice(0, 30)}" 'Only N left' anywhere on page=${raw.anyOnly}`);
    t.check(has, asin + ": a real page with a deal/bought message shows the card");
    if (!/only\s+\d+\s+left/i.test(raw.avail)) t.check(!/Only \d+ left/.test(txt), asin + ": no stock chip unless the product's own availability says so");
    await p.close();
  }
  t.check(errs.length === 0, "extension console errors: " + errs.join(" | "));
}), { retries: 1, live: true });

test("41", "Impulse Check (Flipkart, Myntra): messages near the product title are read (timer d/h/m/s, per-size stock); menus, banners, reviews, carousels, pop-ups are not; a timer that restarts is reported", t => withExt({}, async ({ ctx, sw }) => {
  const ld = (title, price) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: title, image: "https://example.com/i.jpg", offers: { "@type": "Offer", price: String(price), priceCurrency: "INR" } })}</script>`;
  const decoys = '<nav><a>Daily Deals</a> <span>Only 9 left</span></nav><div class="reviews-block"><p>Only 3 left, 20 people are viewing</p></div><div style="height:2200px"></div><section><p>Hurry, only 7 left</p></section><div class="similar-products"><p>Only few left</p><p>Ends in 01h 00m 00s</p></div><div class="modal"><p>Offer ends Tomorrow</p></div>';
  const page = (body, title, price) => `<!doctype html><html><head><meta charset=utf-8><title>${title}</title>${ld(title, price)}</head><body><header><div class="announcement">Last Chance to Save 5%</div></header><div id="root"><h1>${title}</h1><div class="price">₹${price}</div>${body}</div>${decoys}</body></html>`;
  let timerText = "Ends in 01d 02h 49m 37s";
  await ctx.route("https://www.flipkart.com/test-mixer/p/itm9*", r => r.fulfill({ status: 200, contentType: "text/html", body: page(`<div><div>Top Discount of the Sale</div><div>${timerText}</div><div>Sales Package</div></div>`, "Test Mixer Grinder 750 W", 2999) }));
  await ctx.route("https://www.myntra.com/tshirts/x/test-tee/55555555/buy*", r => r.fulfill({ status: 200, contentType: "text/html", body: page('<div class="size-buttons-size-buttons"><div><button>S</button></div><div><button>XL</button><span class="size-buttons-inventory-left">2 left</span></div><span class="size-buttons-inventory-left size-buttons-inventory-left-hidden" style="display:none">Hide</span></div><span>Orders above Rs. 149 (only on first purchase)</span>', "Test Tee", 499) }));
  let r = await openPage(ctx, "https://www.flipkart.com/test-mixer/p/itm9a?pid=MIXGHMGYQNK1234"); await r.panel.open(); await sleep(800);
  let txt = await r.panel.text(".impulse"); t.check(/Countdown timer/.test(txt) && !/Only 9|Only 3|Only 7|viewing|Only few|Tomorrow|Last Chance/i.test(txt), "flipkart: timer found, decoys ignored: " + txt.slice(0, 160));
  r = await openPage(ctx, "https://www.myntra.com/tshirts/x/test-tee/55555555/buy"); await r.panel.open(); await sleep(800); txt = await r.panel.text(".impulse"); t.check(/Only 2 left/.test(txt) && !/Hide|first purchase|Only 9|Only 7|viewing/.test(txt), "myntra: per-size '2 left' found, offer fine print ignored: " + txt.slice(0, 160));
  // the flipkart timer restarts: remembered end time moves later although time has passed
  const key = "flipkart.com:MIXGHMGYQNK1234", mem0 = (await store(sw, "items")).items[key].urg; t.check(mem0 && mem0.v.length === 1 && mem0.v[0].end > Date.now(), "flipkart end time remembered");
  await seed(sw, { items: { ...(await store(sw, "items")).items, [key]: { ...(await store(sw, "items")).items[key], urg: { v: [{ at: Date.now() - 3 * 3600e3, end: Date.now() + 1 * 3600e3, gran: "s" }], restarts: 0, daily: 0 } } } });
  r = await openPage(ctx, "https://www.flipkart.com/test-mixer/p/itm9a?pid=MIXGHMGYQNK1234"); await r.panel.open(); await sleep(900); txt = await r.panel.text(".impulse");
  t.check(/Timer showed a new end time/.test(txt) && /later end time when you came back/.test(txt), "a timer that shows a later end time after hours is reported neutrally: " + txt.slice(0, 200));
}));

test("42", "Impulse Check inside the extension on REAL Flipkart and Myntra pages: the card appears exactly when the collector finds a message, with no console errors (live, skippable)", t => withExt({}, async ({ ctx, errs }) => {
  const nodeFs = await import("node:fs"), require_ = () => nodeFs, src = nodeFs.readFileSync(new URL("../../extension/impulse.js", import.meta.url), "utf8"), find = async (q, sel, site) => { const p = await ctx.newPage(); await p.goto(q, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}); await sleep(2500); const u = (await p.$$eval(sel, as => as.map(a => a.href.split("&")[0]))).slice(0, 4); await p.close(); return u; };
  const urls = [...(await find("https://www.flipkart.com/search?q=mixer+grinder", "a[href*='/p/itm']")).slice(0, 2), ...[1, 2, 3].map(n => { try { return JSON.parse(nodeFs.readFileSync(new URL(`../fixtures/impulse/myntra-${n}.json`, import.meta.url), "utf8")).url; } catch { return null; } }).filter(Boolean)];
  t.check(urls.length >= 3, "found real product pages: " + urls.length);
  for (const u of urls) {
    const p = await ctx.newPage(); await p.goto(u, { waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => {}); await sleep(4500);
    let expected = null; try { expected = await p.evaluate(code => { try { (0, eval)(code + "\nwindow.__imp = { impCues, impCollectNear };"); return window.__imp.impCues(window.__imp.impCollectNear(document)).length; } catch { return -1; } }, src); } catch {}
    const panel = await Panel.attach(ctx, p).catch(() => null); if (!panel || !(await panel.waitKnob().catch(() => false))) { t.note("no panel on " + u.slice(0, 60)); await p.close(); continue; }
    await panel.open(); await sleep(900); const has = await panel.has(".impulse"), txt = has ? await panel.text(".impulse") : "";
    t.note(`${u.replace(/^https:\/\/(www\.)?/, "").slice(0, 50)}: collector=${expected} card=${has} ${txt.slice(0, 80)}`);
    if (expected >= 0) t.check(has === (expected > 0), "card shown iff a message was found: " + u.slice(0, 60));
    await p.close();
  }
  t.check(errs.length === 0, "extension console errors: " + errs.join(" | "));
}), { retries: 1, live: true });

test("43", "Seller Intel v2a: the seller card shows one neutral tier (Looks fine / Worth a closer look / Limited data) and the price gap to other sellers, with the reasons in the sheet", t => withExt({}, async ({ ctx, sw }) => {
  const fs = await import("node:fs"), seed2 = async (name, html) => sw.evaluate(([h, sid]) => { offSellerCache.set(sid, { at: Date.now(), data: offParseSellerPage(h) }); }, [html, name]);
  const big = fs.readFileSync(new URL("../fixtures/offers/seller-big.html", import.meta.url), "utf8"), tiny = fs.readFileSync(new URL("../fixtures/offers/seller-tiny.html", import.meta.url), "utf8");
  // real storefront: 3.5 stars, 68% positive, 75,303 ratings
  await seed2("AJ6SIZC8YQDZX", big);
  let { p, panel } = await product(ctx, { id: "B0TIERLOOK1", price: 900, seller: { name: "Clicktech Retail Private Ltd", ships: "RandomTraders", fba: false } }); await panel.open();
  await poll(async () => /closer look|Looks fine|Limited/.test(await panel.text(".seller")), 12000, 400);
  let row = await panel.text(".seller"); t.check(/Worth a closer look/.test(row) && /68% positive/.test(row) && !/fake|scam|fraud/i.test(row), "3.7★ (last 12 months) + 68% positive + a recent dip: worth a closer look, neutral words: " + row);
  await panel.click(".seller"); await sleep(400); let sheet = await panel.text(".sheet"); t.check(/68% positive/.test(sheet) && /Rated 3\.7★/.test(sheet) && /not a verdict/.test(sheet), "the sheet lists the reasons and says it is not a verdict: " + sheet.slice(0, 220));
  await p.close();
  // a seller with very few ratings: limited data, never a tier
  await seed2("AJ6SIZC8YQDZX", tiny);
  ({ p, panel } = await product(ctx, { id: "B0TIERLTD01", price: 900, seller: { name: "Tiny Traders", ships: "Tiny Traders", fba: false } })); await panel.open();
  await poll(async () => /Limited/.test(await panel.text(".seller")), 12000, 400); row = await panel.text(".seller"); t.check(/Limited data/.test(row) && !/closer look|Looks fine/.test(row), "few ratings: limited data only: " + row);
}));

// ---- seller list: honest empty / failure states on a fake page. Fixtures are real cookieless Amazon.in fragments (tests/fixtures/offers/aod-*.html) and the real Flipkart response; the captcha page is SYNTHETIC.
const aodFx = n => import("node:fs").then(fs => fs.readFileSync(new URL(`../fixtures/offers/${n}.html`, import.meta.url), "utf8"));
const aodRoute = async (ctx, pick) => { const hits = []; await ctx.route("https://www.amazon.in/gp/product/ajax/aodAjaxMain/**", async r => { const asin = new URL(r.request().url()).searchParams.get("asin"); hits.push(asin); const b = await pick(asin, hits.length); if (b === "hang") return; r.fulfill({ status: 200, contentType: "text/html", body: b }); }); return hits; };
test("90", "sellers (Amazon): an empty list for the delivery location is said honestly with a link to the page's own offers, never 'Only one seller'; a real single offer says so; the buy-box seller is marked (here)", t => withExt({}, async ({ ctx }) => {
  const by = { B0AODNOLOC: "aod-noloc", B0AODONLY1: "aod-pinned-only", B0AODPINN1: "aod-pinned" }, fx = {}; for (const k of Object.values(by)) fx[k] = await aodFx(k);
  await aodRoute(ctx, a => fx[by[a]]);
  const open = async id => { const r = await product(ctx, { id, price: 57650 }); await r.panel.open(); await sleep(500); await r.panel.click(".offers .btn"); await poll(async () => !/Loading sellers/.test(await r.panel.text(".offers")), 12000, 300); return r; };
  let r = await open("B0AODNOLOC"), txt = await r.panel.text(".offers");
  t.check(/isn't listing other sellers for your delivery location/.test(txt) && !/Only one seller/.test(txt), "empty list: honest text, not 'Only one seller': " + txt);
  const href = await r.panel.ev(function () { const a = this.querySelector(".offers a.btn"); return a && a.getAttribute("href") + "|" + a.target + "|" + a.rel; }); t.check(/\/dp\/B0AODNOLOC\?aod=1\|_blank\|noopener/.test(href || ""), "link to the page's own See all buying options: " + href); await r.p.close();
  r = await open("B0AODONLY1"); txt = await r.panel.text(".offers"); t.check(/Only one seller/.test(txt) && !(await r.panel.has(".off-r")), "a response with exactly one offer says 'Only one seller': " + txt); await r.p.close();
  r = await open("B0AODPINN1"); txt = await r.panel.text(".offers"); t.check(/SUPREME-TRADES \(here\)/.test(txt) && (await r.panel.count(".off-r")) === 5 && (txt.match(/\(here\)/g) || []).length === 1, "buy-box seller listed and marked (here) once: " + txt.slice(0, 200));
}));
test("91", "sellers (Amazon): a blocked answer says so, offers Try again, is not cached, and the retry works", t => withExt({}, async ({ ctx }) => {
  const ok = await aodFx("aod-pinned"), hits = await aodRoute(ctx, (a, n) => n === 1 ? "<html><form action=/errors/validateCaptcha>Enter the characters you see below</form></html>" : ok); // SYNTHETIC captcha, then a real fragment
  const { panel } = await product(ctx, { id: "B0AODBLOCK", price: 57650 }); await panel.open(); await sleep(500);
  await panel.click(".offers .btn"); await poll(async () => /asked for a check/.test(await panel.text(".offers")), 12000, 300);
  t.check(/asked for a check/.test(await panel.text(".offers")) && !/Only one seller|Loading/.test(await panel.text(".offers")), "blocked cause named: " + await panel.text(".offers"));
  const b = await panel.ev(function () { const x = this.querySelector(".offers .btn"); return x && x.textContent + "|" + x.disabled; }); t.check(b === "Try again|false", "button restored as Try again, enabled: " + b);
  await panel.click(".offers .btn"); await poll(async () => (await panel.count(".off-r")) >= 5, 12000, 300);
  t.check((await panel.count(".off-r")) === 5 && hits.length === 2, "the failure was not cached; retry listed 5 sellers after 2 requests: " + hits.length);
}));
test("92", "sellers: a lost service-worker reply never leaves 'Loading sellers…' stuck: after ~12 s it says it couldn't load and offers Try again, which works", t => withExt({}, async ({ ctx, sw }) => {
  const ok = await aodFx("aod-pinned"); await aodRoute(ctx, () => ok);
  await sw.evaluate(() => { globalThis.__offFind = offFind; offFind = () => new Promise(() => {}); }); // the worker never answers
  const { panel } = await product(ctx, { id: "B0AODLOST1", price: 57650 }); await panel.open(); await sleep(500);
  await panel.click(".offers .btn"); await sleep(1500); t.check(/Loading sellers/.test(await panel.text(".offers")), "loading while waiting");
  await poll(async () => /Couldn't load/.test(await panel.text(".offers")), 20000, 500);
  const b = await panel.ev(function () { const x = this.querySelector(".offers .btn"); return x && x.textContent + "|" + x.disabled; }); t.check(/Couldn't load other sellers/.test(await panel.text(".offers")) && b === "Try again|false", "timed out into a failure message and a live Try again button: " + b);
  await sw.evaluate(() => { offFind = globalThis.__offFind; });
  await panel.click(".offers .btn"); await poll(async () => (await panel.count(".off-r")) >= 5, 12000, 300); t.check((await panel.count(".off-r")) === 5, "retry after the worker is back lists sellers");
}));
test("93", "sellers (Flipkart): the pincode saved in HAULS is sent as locationContext and its delivery dates are shown with the pincode named; without one the dates stay hidden", t => withExt({}, async ({ ctx, sw }) => {
  const fs = await import("node:fs"), fk = fs.readFileSync(new URL("../fixtures/offers/flipkart-sellers.json", import.meta.url), "utf8"); let body;
  await ctx.route("https://1.rome.api.flipkart.com/**", r => { body = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: fk }); });
  await ctx.route("https://www.flipkart.com/pin-laptop/p/itm2*", r => r.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><meta charset=utf-8><title>Test Laptop</title><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Test Laptop", image: "https://example.com/i.jpg", offers: { "@type": "Offer", price: "60990", priceCurrency: "INR" } })}</script></head><body><h1>Test Laptop</h1></body></html>` }));
  await seed(sw, { pin: "560001" });
  const f = await openPage(ctx, "https://www.flipkart.com/pin-laptop/p/itm2?pid=COMGZUYDGFJGHZR4"); await f.panel.open(); await sleep(800);
  await f.panel.click(".offers .btn"); await poll(async () => (await f.panel.count(".off-r")) >= 5, 8000, 300); const txt = await f.panel.text(".offers");
  t.check(body && body.locationContext.pincode === "560001", "saved pin sent: " + JSON.stringify(body && body.locationContext));
  t.check(/Delivery 24 Oct, Saturday/.test(txt) && /pincode 560001/.test(txt) && !/default location/.test(txt), "delivery shown and its pincode named: " + txt.slice(-170));
}));

test("44", "header Settings icon: sits between account and close, is a 44px target on a phone, and opens the Settings page in one click", t => withExt({}, async ({ ctx, extId }) => {
  const { panel } = await product(ctx); await panel.open();
  t.check(await panel.has('header button[aria-label="Settings"]'), "gear button in the header");
  const order = await panel.ev(function () { return [...this.querySelectorAll("header .hd .r > *")].map(e => e.getAttribute("aria-label") || e.className); }); t.check(order.indexOf("Account") >= 0 && order.indexOf("Settings") === order.indexOf("Account") + 1, "order: account, settings: " + order.join(" | ")); t.check(!(await panel.run("header .x.cl", function () { return getComputedStyle(this).display !== "none"; })), "no cross on desktop: the side handle closes the panel");
  const opened = ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null); await panel.click('header button[aria-label="Settings"]'); const pg = await opened;
  t.check(!!pg && /options\.html/.test(pg.url() || ""), "Settings page opened: " + (pg && pg.url()));
}));

test("45", "uninstall feedback: the extension registers the feedback page; the page needs a rating, sends rating + known reasons + text + version once, shows thanks, and never calls anything else", t => withExt({}, async ({ ctx, sw }) => {
  const url = await sw.evaluate(() => FEEDBACK_URL), ver = await sw.evaluate(() => chrome.runtime.getManifest().version);
  t.check(url === `https://kumarvishwajeettrivedi.github.io/Hauls_Chrome_Extension/feedback.html?v=${ver}` && url.length < 1000, "uninstall URL is the hosted feedback page with only the version: " + url);
  const fs = await import("node:fs"), site = f => fs.readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), base = "https://kumarvishwajeettrivedi.github.io/Hauls_Chrome_Extension/";
  const calls = []; await ctx.route(base + "**", r => { const f = new URL(r.request().url()).pathname.replace(/^\/Hauls_Chrome_Extension\//, ""); try { r.fulfill({ status: 200, contentType: f.endsWith(".js") ? "text/javascript" : "text/html", body: site(f) }); } catch { r.fulfill({ status: 404, body: "" }); } });
  await ctx.route("https://xesmxpwcmbimhngdufje.supabase.co/**", r => { calls.push({ url: r.request().url(), body: r.request().postData() }); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "true" }); });
  await ctx.route("https://api.fontshare.com/**", r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  const p = await ctx.newPage(); const errs2 = []; p.on("console", m => /Content Security Policy|Refused/i.test(m.text()) && errs2.push(m.text().slice(0, 120)));
  await p.goto(url, { waitUntil: "domcontentloaded" }); await sleep(500);
  await p.click("#send"); t.check(/rating/i.test(await p.textContent("#err")) && calls.length === 0, "no rating: asks for one and sends nothing");
  await p.click('.star[aria-label="4 out of 5"]'); await p.check('input[value="bugs"]'); await p.check('input[value="privacy"]'); await p.fill("#msg", "Slow on Flipkart pages."); await p.click("#send"); await sleep(700);
  t.check(calls.length === 1 && /ext_submit_feedback$/.test(calls[0].url), "one request to the feedback function: " + calls.map(c => c.url).join(","));
  const body = JSON.parse(calls[0].body); t.check(body.p_rating === 4 && body.p_reasons.join() === "bugs,privacy" && body.p_message === "Slow on Flipkart pages." && body.p_version === ver, "payload: " + calls[0].body);
  t.check(await p.isVisible("#thanks") && !(await p.isVisible("#form")), "thank-you shown");
  t.check(errs2.length === 0, "no CSP violations: " + errs2.join(" | "));
  const p2 = await ctx.newPage(); await p2.goto(url, { waitUntil: "domcontentloaded" }); await p2.click('.star[aria-label="2 out of 5"]'); await p2.fill("#website", "bot"); await p2.click("#send"); await sleep(400);
  t.check(calls.length === 1, "a filled hidden field (bot) sends nothing");
}));

test("46", "real Amazon chart captured 2026-10-17 (30-day, 9,487 -> 7,599): read, stored, drawn now AND still drawn after reloading the product page", t => withExt({}, async ({ ctx, sw }) => {
  const svg = (await import("node:fs")).readFileSync(new URL("../fixtures/amazon-history/chart-real-2026-10-17.svg", import.meta.url), "utf8"), id = "B0F9X7Z16M";
  let { p, panel } = await product(ctx, { id, price: 7599, mrp: 19990 }); await panel.open(); await sleep(600);
  await p.evaluate(h => { const w = document.createElement("div"); w.id = "rufus-react-renderer"; w.innerHTML = '<span class="rufus-pricing-chart-container">' + h + '</span>'; document.body.append(w); }, svg);
  const ok = await poll(async () => Object.values((await store(sw, "items")).items || {}).some(i => i.ahist), 8000, 300); t.check(!!ok, "chart read and stored");
  const it = Object.values((await store(sw, "items")).items).find(i => i.ahist); t.check(it && it.ahist.ranges["1M"] && it.ahist.ranges["1M"].points[0][1] === 9487 && it.ahist.ranges["1M"].points.at(-1)[1] === 7599, "stored series 9,487 -> 7,599: " + JSON.stringify(it && it.ahist.ranges["1M"].points.map(q => q[1])));
  await poll(async () => await panel.has(".cw svg"), 6000, 300); t.check(await panel.has(".cw svg"), "history chart drawn right after the read");
  await p.close();
  ({ p, panel } = await product(ctx, { id, price: 7599, mrp: 19990 })); await panel.open(); await sleep(900);
  t.check(await panel.has(".cw svg"), "after reloading the product page the graph is still there (read from the stored series)");
  const chips = await panel.text(".chips3"); t.check(/₹7,599/.test(chips) && /₹9,487/.test(chips), "low/high come from Amazon's series: " + chips);
}));

test("47", "Amazon's range sentence arrives split across elements (as on the real Rufus panel): the range is still read, stored, and drives the scanner and the range graph", t => withExt({}, async ({ ctx, sw }) => {
  const id = "B0SPLITSENT", title = "boAt Airdopes 141 Bluetooth Earbuds";
  const { p, panel } = await product(ctx, { id, price: 499, mrp: 1599 }); await panel.open(); await sleep(800);
  await p.evaluate(ttl => { const w = document.createElement("div"); w.id = "rufus-react-renderer"; const turn = document.createElement("div"); turn.className = "rufus-papyrus-turn"; turn.innerHTML = "<span>Over the past 30 days, the price of </span><b>" + ttl + "</b>"; w.append(turn); document.body.append(w);
    setTimeout(() => { const tail = document.createElement("span"); tail.className = "css-1jxf684"; tail.textContent = " has ranged from ₹499 to ₹579. The current price is ₹499, the lowest in the past 30 days."; turn.append(tail); }, 900); }, title);
  const ok = await poll(async () => Object.values((await store(sw, "items")).items || {}).some(i => i.ref), 9000, 300); t.check(!!ok, "range stored although the sentence was split");
  const it = Object.values((await store(sw, "items")).items).find(i => i.ref); t.check(it && it.ref.low === 499 && it.ref.high === 579 && it.ref.days === 30, "values " + JSON.stringify(it && it.ref));
  await poll(async () => /Amazon's 30-day low/.test(await panel.text(".scan")), 6000, 300); t.check(/Amazon's 30-day low/.test(await panel.text(".scan")), "the scanner uses it: " + (await panel.text(".scan")).slice(0, 100));
  // a user-written review that contains the same words, split the same way, is still ignored
  const { p: p2 } = await product(ctx, { id: "B0SPLITREVW", price: 499, mrp: 1599 }); await sleep(800);
  await p2.evaluate(ttl => { const r = document.createElement("div"); r.id = "reviewsMedley"; r.innerHTML = "<span>Over the past 30 days, the price of </span><b>" + ttl + "</b>"; document.body.append(r); setTimeout(() => { const s2 = document.createElement("span"); s2.textContent = " has ranged from ₹10 to ₹20. The current price is ₹499."; r.append(s2); }, 600); }, title);
  await sleep(2500); t.check(!Object.entries((await store(sw, "items")).items).some(([k, i]) => /B0SPLITREVW/.test(k) && i.ref), "the same split sentence inside reviews is ignored");
}));

test("48", "a chart read while you are typing in the panel is drawn as soon as you leave the field (the redraw is not lost)", t => withExt({}, async ({ ctx, sw }) => {
  const svg = (await import("node:fs")).readFileSync(new URL("../fixtures/amazon-history/chart-real-2026-10-17.svg", import.meta.url), "utf8");
  const { p, panel } = await product(ctx, { id: "B0TYPINGRD", price: 7599, mrp: 19990 }); await panel.open(); await sleep(700);
  await panel.run("input", function () { this.focus(); });
  await p.evaluate(h => { const w = document.createElement("div"); w.id = "rufus-react-renderer"; w.innerHTML = '<span class="rufus-pricing-chart-container">' + h + '</span>'; document.body.append(w); }, svg);
  await poll(async () => Object.values((await store(sw, "items")).items || {}).some(i => i.ahist), 8000, 300); await sleep(900);
  t.check(!(await panel.has(".cw svg")), "while the field has focus the card is left alone");
  await panel.run("input", function () { this.blur(); }); await poll(async () => await panel.has(".cw svg"), 5000, 300);
  t.check(await panel.has(".cw svg"), "after leaving the field the graph appears without a reload");
}));

test("49", "Settings: first install opens the guided tour; Amazon history is the first card with a clear On/Off switch; the Get started card ticks itself", t => withExt({ keepWelcome: true }, async ({ ctx, sw, extId }) => {
  let o = ctx.pages().find(p => /options\.html\?welcome=1/.test(p.url())); if (!o) o = await ctx.waitForEvent("page", { timeout: 8000, predicate: p => /options\.html/.test(p.url()) }).catch(() => null);
  t.check(!!o, "a fresh install opens the Settings page with the welcome tour");
  await o.waitForSelector(".tour-tip", { timeout: 6000 }); await poll(async () => /1\. How it works/.test(await o.textContent(".tour-tip")), 4000, 200); t.check(/1\. How it works/.test(await o.textContent(".tour-tip")), "tour step 1 explains how it works: " + (await o.textContent(".tour-tip")).slice(0, 80)); t.check(await o.evaluate(() => document.querySelector(".tour-tip").classList.contains("hide")), "the words fade in after the spotlight (hidden at first)"); await poll(async () => await o.evaluate(() => !document.querySelector(".tour-tip").classList.contains("hide")), 4000, 200); t.check(await o.evaluate(() => !document.querySelector(".tour-tip").classList.contains("hide")), "then they appear");
  await sleep(1300); await o.click('.tour-tip button:has-text("Next")'); await poll(async () => /2\. Turn this on/.test(await o.textContent(".tour-tip")), 4000, 200); t.check(/2\. Turn this on/.test(await o.textContent(".tour-tip")), "step 2 points at the Amazon history switch");
  await sleep(1200); const spot = await o.evaluate(() => { const r = document.querySelector(".tour-spot").getBoundingClientRect(), h = document.getElementById("s-history").getBoundingClientRect(); return Math.abs(r.top - (h.top - 6)) < 8 && r.width > h.width; }); t.check(spot, "the spotlight sits on the Amazon history card");
  await o.click('.tour-tip button:has-text("Turn it on")'); await sleep(300); t.check((await store(sw, "ahAuto")).ahAuto === true, "the tour can turn the switch on for you");
  await o.click('.tour-tip button:has-text("Next")'); await poll(async () => /3\. Check it is working/.test(await o.textContent(".tour-tip")), 4000, 200); t.check(/3\. Check it is working/.test(await o.textContent(".tour-tip")), "step 3"); await sleep(1300); await o.click('.tour-tip button:has-text("Next")'); await poll(async () => /4\. Optional extras/.test(await o.textContent(".tour-tip")), 4000, 200); t.check(/4\. Optional extras/.test(await o.textContent(".tour-tip")), "step 4"); await sleep(1300);
  await o.click('.tour-tip button:has-text("Done")'); await sleep(200); t.check(!(await o.$(".tour-tip")) && (await store(sw, "tourDone")).tourDone === true, "tour closes and is remembered");
  const order = await o.evaluate(() => [...document.querySelectorAll("main > section")].filter(s => !s.hidden).map(s => s.id)); t.check(order.indexOf("s-history") <= 1 && order.indexOf("s-history") < order.indexOf("s-track") && order.indexOf("s-track") < order.indexOf("s-stores"), "Amazon history is at the top: " + order.join(" > "));
  t.check(await o.isChecked("#ahauto") && /On/.test(await o.evaluate(() => getComputedStyle(document.querySelector(".onoff"), "::after").content)), "the switch shows On");
  await o.click(".sw"); await sleep(300); t.check((await store(sw, "ahAuto")).ahAuto === false && /Off/.test(await o.evaluate(() => getComputedStyle(document.querySelector(".onoff"), "::after").content)), "clicking the switch turns it off and it says Off");
  t.check(/\d of 3/.test(await o.textContent("#startcount")), "Get started shows progress: " + await o.textContent("#startcount"));
  await seed(sw, { ahAuto: true, items: seedItem("B0TOURTEST", [[Date.now() - 36e5, 500]], { wish: true }) }); await sleep(500); const hidden = await o.$eval("#start", e => e.hidden); t.check(hidden && /3 of 3/.test(await o.textContent("#startcount")), "all three steps done: the card hides itself");
}));

test("50", "Impulse Check samples a timer twice: one that counts down is reported as live, one whose text never changes as unchanged", t => withExt({}, async ({ ctx }) => {
  const ld = (title, price) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: title, image: "https://example.com/i.jpg", offers: { "@type": "Offer", price: String(price), priceCurrency: "INR" } })}</script>`;
  const page = (title, timerJs) => `<!doctype html><html><head><meta charset=utf-8><title>${title}</title>${ld(title, 999)}</head><body><div id="root"><h1>${title}</h1><div class="price">₹999</div><div><span id="tm">Ends in 02:00:00</span></div></div>${timerJs}</body></html>`;
  await ctx.route("https://www.flipkart.com/live-timer/p/itm1*", r => r.fulfill({ status: 200, contentType: "text/html", body: page("Live Timer Gadget", '<script>let s=7200;setInterval(()=>{s--;const h=String(Math.floor(s/3600)).padStart(2,"0"),m=String(Math.floor(s%3600/60)).padStart(2,"0"),x=String(s%60).padStart(2,"0");document.getElementById("tm").textContent="Ends in "+h+":"+m+":"+x},1000)</script>') }));
  await ctx.route("https://www.flipkart.com/static-timer/p/itm1*", r => r.fulfill({ status: 200, contentType: "text/html", body: page("Static Timer Gadget", "") }));
  let r = await openPage(ctx, "https://www.flipkart.com/live-timer/p/itm1?pid=LIVETIMER0000001"); await r.panel.open(); await sleep(7500); let txt = await r.panel.text(".impulse"); t.check(/Countdown timer/.test(txt) && /counts down live/.test(txt), "a live timer: " + txt.slice(0, 160));
  r = await openPage(ctx, "https://www.flipkart.com/static-timer/p/itm1?pid=STATICTIMER000001"); await r.panel.open(); await sleep(7500); txt = await r.panel.text(".impulse"); t.check(/Countdown timer/.test(txt) && /did not change over 5 seconds/.test(txt) && !/fake|scam/i.test(txt), "a static timer: " + txt.slice(0, 160));
}));

test("51", "compare card: a one-line answer first (cheaper elsewhere / lowest here), rows sorted by price with a bar, confirmed matches carry no spec chips, likely matches do", t => withExt({}, async ({ ctx, sw }) => {
  const mock = res => sw.evaluate(r => { globalThis.cmpFind = async () => r; }, res);
  const chk = [{ k: "Brand", v: "boAt", ok: true }, { k: "Storage", v: "", ok: null }];
  await mock({ results: [{ store: "Reliance Digital", title: "x", price: 7499, url: "https://www.reliancedigital.in/product/x/", confidence: "Exact", checks: [] }, { store: "Flipkart", title: "x", price: 6490, url: "https://www.flipkart.com/x/p/itm1", confidence: "Exact", checks: [] }, { store: "Croma", title: "x", price: 6890, url: "https://www.croma.com/x/p/1", confidence: "Likely", checks: chk }], failed: [], why: {}, near: [], here: "Amazon", seen: {} });
  const { panel } = await product(ctx, { id: "B0CMPCARD1", price: 6999, mrp: 9999 }); await panel.open(); await sleep(700);
  await panel.click(".cmp .btn"); await poll(async () => (await panel.count(".cmp .cmp-r")) >= 4, 8000, 300);
  const sum = await panel.text(".cmp-sum"); t.check(/Cheaper elsewhere/.test(sum) && /₹6,490/.test(sum) && /Flipkart/.test(sum) && /₹509 less/.test(sum), "one-line answer: " + sum);
  const rows = await panel.ev(function () { return [...this.querySelectorAll(".cmp .cmp-r")].map(r => (r.querySelector(".sn") || {}).textContent + "|" + (r.querySelector(".num") || {}).textContent); }); t.check(rows.join(",") === "Amazon (here)|₹6,999,Flipkart|₹6,490,Croma|₹6,890,Reliance Digital|₹7,499", "here first, then cheapest to dearest: " + rows.join(","));
  t.check(await panel.count(".cmp .pbar i") === 4, "a price bar per row"); t.check(await panel.has(".cmp-r.low") && /Flipkart/.test(await panel.text(".cmp-r.low")), "the lowest confirmed row is highlighted");
  const fk = await panel.ev(function () { return [...this.querySelectorAll(".cmp .cmp-r")].find(r => /Flipkart/.test(r.textContent)).querySelectorAll(".chk").length; }), cr = await panel.ev(function () { return [...this.querySelectorAll(".cmp .cmp-r")].find(r => /Croma/.test(r.textContent)).querySelectorAll(".chk").length; });
  t.check(fk === 0 && cr === 2, "a confirmed match shows no spec chips, a likely match shows them: " + fk + " / " + cr);
  t.check(/Same product/.test(await panel.text(".cmp")) && /Likely the same/.test(await panel.text(".cmp")), "confidence badges");
  await mock({ results: [{ store: "Flipkart", title: "x", price: 7200, url: "https://www.flipkart.com/x/p/itm1", confidence: "Exact", checks: [] }], failed: [], why: {}, near: [], here: "Amazon", seen: {} });
  const { panel: p2 } = await product(ctx, { id: "B0CMPCARD2", price: 6999, mrp: 9999 }); await p2.open(); await sleep(600); await p2.click(".cmp .btn"); await poll(async () => (await p2.count(".cmp-sum")) > 0, 8000, 300);
  t.check(/Lowest price here/.test(await p2.text(".cmp-sum")) && await p2.has(".cmp-r.low"), "when you already have the lowest price the card says so");
}));

test("80", "compare, real service worker: a bot-challenge page shows as 'Couldn't check (blocked)' and is not kept; real answers are kept in chrome.storage.session (not worker memory) and reused", t => withExt({}, async ({ ctx, sw }) => {
  const fx = n => readFileSync(path.join(ROOT, "tests/fixtures/compare", n + ".html"), "utf8"), BM = "<html><head><meta http-equiv=\"refresh\" content=\"0;URL='/s?bm-verify=AAQAAAAF'\"></head></html>"; // SYNTHETIC challenge page (the real Akamai body was not saved)
  await sw.evaluate(() => chrome.storage.session.remove("cmp"));
  await sw.evaluate(h => { globalThis.__calls = []; globalThis.fetch = async u => { __calls.push(u); return { ok: true, status: 200, text: async () => h }; }; }, BM); // every store answers 200 with the challenge page
  const a = await product(ctx, { id: "B0CMPBLOCK1", price: 899, mrp: 1299 }); await a.panel.open(); await sleep(600); await a.panel.click(".cmp .btn"); await poll(async () => /Couldn't check/.test(await a.panel.text(".cmp")), 12000, 300);
  const txt = await a.panel.text(".cmp"); t.check(/Couldn't check: .*Flipkart \(blocked\)/.test(txt) && /Reliance Digital \(blocked\)/.test(txt), "challenge page shown as blocked: " + txt.slice(0, 200));
  t.check(await sw.evaluate(async () => Object.keys((await chrome.storage.session.get("cmp")).cmp || {}).length) === 0, "a blocked answer is not cached");
  // real answers: Flipkart gives the boAt page, Reliance 503
  const FK = fx("flipkart"); await sw.evaluate(h => { globalThis.__calls = []; globalThis.fetch = async u => { __calls.push(u); const host = new URL(u).hostname; return /flipkart/.test(host) ? { ok: true, status: 200, text: async () => h } : { ok: false, status: 503 }; }; }, FK);
  const b = await product(ctx, { id: "B0CMPBLOCK2", price: 899, mrp: 1299 }); await b.panel.open(); await sleep(600); await b.panel.click(".cmp .btn"); await poll(async () => (await b.panel.count(".cmp .cmp-r")) >= 2, 12000, 300);
  t.check(/Flipkart/.test(await b.panel.text(".cmp")), "the Flipkart row is shown: " + (await b.panel.text(".cmp")).slice(0, 160));
  const keys = await sw.evaluate(async () => Object.keys((await chrome.storage.session.get("cmp")).cmp || {})); t.check(keys.length >= 1 && keys.every(k => /^(Flipkart|Myntra)\|/.test(k)) && !keys.some(k => /^Reliance/.test(k)), "only stores that answered are kept in chrome.storage.session: " + keys);
  t.check(await sw.evaluate(() => typeof cmpCache === "undefined"), "no cache left in worker memory");
  const again = await sw.evaluate(async () => { await cmpFind({ title: "boAt Airdopes 141 Bluetooth Earbuds", brand: "boAt", site: "Amazon", price: 899 }); return { flipkart: __calls.filter(u => /flipkart/.test(u)).length }; });
  t.check(again.flipkart === 1, "second compare reuses the stored Flipkart answer (Flipkart fetched " + again.flipkart + "x in total)");
}));

test("52", "panel header: nothing overlaps the HAULS title (desktop and phone), and the cross exists only in the phone layout", t => withExt({ viewport: { width: 1280, height: 900 } }, async ({ ctx, sw }) => {
  await seed(sw, { pin: "560001" });
  const geo = async panel => panel.ev(function () { const l = this.querySelector("header .hd > div:first-child").getBoundingClientRect(), r = this.querySelector("header .hd .r").getBoundingClientRect(), h1 = this.querySelector("header .hd h1").getBoundingClientRect(), txt = el => { const g = document.createRange(); g.selectNodeContents(el); return g.getBoundingClientRect(); }, tr = Math.max(txt(this.querySelector("header .hd h1")).right, txt(this.querySelector("header .hd .sub")).right), vis = el => { const c = el.getBoundingClientRect(); return Math.min(txt(el).right, c.right); }; return { overlap: l.right > r.left + 0.5 || vis(this.querySelector("header .hd h1")) > r.left + 0.5 || vis(this.querySelector("header .hd .sub")) > r.left + 0.5 || (tr > r.left + 0.5 && getComputedStyle(this.querySelector("header .hd > div:first-child")).overflow !== "hidden"), titleVisible: h1.width > 30, rightWithin: r.right <= this.querySelector("header").getBoundingClientRect().right + 1, rowTop: Math.round(l.top) === Math.round(r.top) || Math.abs(l.top - r.top) < 40 }; });
  let { p, panel } = await product(ctx); await panel.open(); await sleep(500); let g = await geo(panel); t.check(!g.overlap && g.titleVisible && g.rightWithin && g.rowTop, "desktop: no overlap: " + JSON.stringify(g));
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(600); g = await geo(panel); t.check(!g.overlap && g.rightWithin && g.rowTop && await panel.run("header .hd .brand .logo", function () { return this.getBoundingClientRect().width > 20; }), "phone width: logo only, no overlap, one row: " + JSON.stringify(g));
  t.check(await panel.run("header .x.cl", function () { return getComputedStyle(this).display !== "none"; }), "the cross is there on a phone, where the side handle is hidden");
}));

test("35", "shared history: an opted-in reader's Amazon chart is uploaded (validated args); the shared consensus for a product is drawn for another reader", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx, sw, extId }) => {
  const svg = (await import("node:fs")).readFileSync(new URL("../fixtures/amazon-history/chart-1m.svg", import.meta.url), "utf8");
  const sb = await fakeSupabase(ctx); await seedSession(sw, SESSION); await seed(sw, { profile: { plan: "free", contribute: true, name: "Test User" } });
  const { p, panel } = await product(ctx, { id: "B0SHAREDC1", price: 4499, mrp: 5999 }); await panel.open(); await sleep(500);
  await p.evaluate(h => { const w = document.createElement("div"); w.id = "rufus-react-renderer"; w.innerHTML = h; document.body.append(w); }, svg);
  await poll(async () => (await outboxOf(sw)).some(o => o.t === "chart"), 8000, 300);
  const op = (await outboxOf(sw)).find(o => o.t === "chart"); t.check(!!op && op.range >= 29 && op.range <= 45, "chart op queued: " + JSON.stringify(op && [op.key, op.range, op.current, op.series.length]));
  const ep = await ctx.newPage(); await ep.goto(`chrome-extension://${extId}/options.html`); await ep.evaluate(() => chrome.runtime.sendMessage({ type: "sync" })); await ep.close();
  const post = await poll(async () => sb.calls.find(c => /\/rpc\/ext_submit_chart/.test(c.path)), 8000, 300);
  t.check(!!post, "ext_submit_chart called"); const b = post && post.body; t.check(b && /B0SHAREDC1/.test(b.p_key) && b.p_current === 4499 && b.p_range >= 29 && b.p_range <= 30 && b.p_series.length === 3 && b.p_series[0][1] === 5499 && b.p_series.every(x => Number.isInteger(x[0])), "args: " + JSON.stringify(b).slice(0, 220));
  // opted OUT: nothing is queued
  await seed(sw, { profile: { plan: "free", contribute: false } }); const before = (await outboxOf(sw)).filter(o => o.t === "chart").length;
  const r2 = await product(ctx, { id: "B0SHAREDC2", price: 4499, mrp: 5999 }); await r2.panel.open(); await sleep(400);
  await r2.p.evaluate(h => { const w = document.createElement("div"); w.id = "rufus-react-renderer"; w.innerHTML = h; document.body.append(w); }, svg); await sleep(1800);
  t.check((await outboxOf(sw)).filter(o => o.t === "chart" && /B0SHAREDC2/.test(o.key)).length === 0, "contribute=false: no chart op");
  // another reader: shared consensus is shown
  const d = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10); sb.chartRows = [60, 50, 40, 30, 15, 5].map((n, i) => ({ day: d(n), price: [5200, 5200, 5499, 5499, 4999, 4499][i], reporters: i === 5 ? 4 : 3 }));
  await seed(sw, { profile: { plan: "free", contribute: true } });
  const r3 = await product(ctx, { id: "B0SHAREDC3", price: 4499, mrp: 5999 }); await r3.panel.open(); await poll(async () => await r3.panel.has(".cw svg"), 8000, 300);
  t.check(await r3.panel.has(".cw svg") && new RegExp(`shared history from 4 HAULS readers, updated ${Math.floor((Date.now() - Date.parse(d(5) + "T12:00:00Z")) / 864e5)} days ago`).test(await r3.panel.text(".chartbox")) /* the label counts from noon UTC of the last data day, so the number depends on the time of day */, "shared chart drawn with its source: " + (await r3.panel.text(".chartbox")).slice(-90));
  // a stale shared series (last price far from this page) is ignored
  sb.chartRows = [{ day: d(60), price: 9000, reporters: 3 }, { day: d(5), price: 9500, reporters: 3 }];
  const r4 = await product(ctx, { id: "B0SHAREDC4", price: 4499, mrp: 5999 }); await r4.panel.open(); await sleep(1500);
  t.check(!(await r4.panel.has(".cw svg")), "shared series that disagrees with the page price is ignored");
  sb.chartRows = [{ day: d(60), price: 5200, reporters: 3 }, { day: d(30), price: 5499, reporters: 3 }, { day: d(5), price: 4499, reporters: 4 }];
  const r5 = await product(ctx, { id: "B0SHAREDC5", price: 4499, mrp: 5999 }); await r5.panel.open(); await sleep(1500);
  t.check(!(await r5.panel.has(".cw svg")), "a series with fewer than 6 points is not drawn");
  sb.chartRows = [90, 80, 70, 60, 50, 40].map((n, i) => ({ day: d(n), price: i === 5 ? 4499 : 5200, reporters: 3 }));
  const r6 = await product(ctx, { id: "B0SHAREDC6", price: 4499, mrp: 5999 }); await r6.panel.open(); await sleep(1500);
  t.check(!(await r6.panel.has(".cw svg")), "a series whose newest point is older than 14 days is not drawn");
}));

// ---------------------------------------------------------------- 14 range selector
test("14", "range selector: 30D/90D/1Y/All changes label, x-axis, y labels, chips; persists", t => withExt({}, async ({ ctx, sw }) => {
  const now = Date.now(), H = [[now - 380 * D, 1500], [now - 200 * D, 1300], [now - 60 * D, 1100], [now - 20 * D, 900], [now - 36e5, 830]];
  await seed(sw, { items: seedItem(PRODUCT_ID, H) });
  const { p, panel } = await product(ctx, { price: 830 }); await panel.open();
  const btns = await panel.ev(function () { return [...this.querySelectorAll(".seg:not(.hz) button")].map(b => ({ t: b.textContent, r: b.dataset.r, on: b.getAttribute("aria-pressed") })); });
  t.check(btns.map(b => b.r).join() === "30D,90D,1Y,All" && btns.map(b => b.t).join() === "30D,90D,1Y,All", "four buttons with data-r: " + JSON.stringify(btns));
  t.check(btns.filter(b => b.on === "true").map(b => b.r).join() === "90D", "default 90D pressed (only)");
  const read = () => panel.ev(function () { return { lbl: this.querySelector(".chartbox .lbl").textContent, x0: this.querySelector(".xl span").textContent, yt: (this.querySelector(".yl.t") || {}).textContent, yb: (this.querySelector(".yl.b") || {}).textContent,
    chips: [...this.querySelectorAll(".chip3 b")].map(b => b.textContent), pressed: [...this.querySelectorAll(".seg:not(.hz) button[aria-pressed=true]")].map(b => b.dataset.r) }; });
  const seen = {};
  // hi = chart top label, chi = High chip: both include the price in force at the window start (the chips use the same rows as the line).
  for (const [r, days, hi, chi] of [["30D", 30, "₹1,100", "₹1,100"], ["90D", 90, "₹1,300", "₹1,300"], ["1Y", 365, "₹1,500", "₹1,500"], ["All", 0, "₹1,500", "₹1,500"]]) {
    await panel.click(`.seg:not(.hz) button[data-r='${r}']`); await sleep(300); const s = seen[r] = await read();
    t.check(s.lbl.startsWith(r + " history"), `${r}: label "${s.lbl}"`);
    t.check(s.pressed.join() === r, `${r}: only ${r} pressed (${s.pressed})`);
    const x0 = days ? dshort(Date.now() - days * D) : dshort(H[0][0]); t.check(s.x0 === x0, `${r}: x-axis starts ${x0} (got ${s.x0})`);
    t.check(s.yt === hi && s.yb === "₹830", `${r}: y labels ${s.yt}/${s.yb} expected ${hi}/₹830`);
    t.check(s.chips.length === 3 && s.chips[0] === "₹830" && s.chips[2] === chi, `${r}: low/avg/high chips ${s.chips} (low ₹830, high ${chi})`);
  }
  t.check(new Set(["30D", "90D", "1Y"].map(r => seen[r].chips.join())).size === 3, "chips differ between 30D, 90D and 1Y");
  await panel.click(".seg:not(.hz) button[data-r='30D']"); await sleep(300); t.check((await store(sw, "range")).range === "30D", "selected range stored");
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open(); await sleep(400);
  const after = await read(); t.check(after.pressed.join() === "30D", "range survives reload: " + after.pressed);
}));

// ---------------------------------------------------------------- 15 notch overflow
async function notchCheck(t, ctx, sw, { id, hist, want, label }) {
  await seed(sw, { items: seedItem(id, hist) });
  const { p, panel } = await product(ctx, { id, price: 830, mrp: null }); await sleep(500);
  const txt = (await panel.text(".delta")).trim(); t.check(txt === want, `${label}: pill "${txt}" expected "${want}"`);
  const m = await panel.ev(function () { const R = e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, k = this.querySelector(".knob");
    return { knob: R(k), pill: R(this.querySelector(".delta")), mark: R(this.querySelector(".mark")), grip: R(this.querySelector(".grip")), row: R(this.querySelector(".krow")), sw: k.scrollWidth, cw: k.clientWidth, sh: k.scrollHeight, ch: k.clientHeight, vw: innerWidth, vh: innerHeight }; });
  const e = 1;
  t.check(m.pill.l >= m.knob.l - e && m.pill.r <= m.knob.r + e && m.pill.t >= m.knob.t - e && m.pill.b <= m.knob.b + e, `${label}: pill inside knob (pill x ${Math.round(m.pill.l)}-${Math.round(m.pill.r)}, knob x ${Math.round(m.knob.l)}-${Math.round(m.knob.r)}; pill bottom ${Math.round(m.pill.b)} <= knob bottom ${Math.round(m.knob.b)})`);
  t.check(m.knob.l >= 0 && m.knob.r <= m.vw + e && m.knob.t >= 0 && m.knob.b <= m.vh + e, `${label}: knob inside viewport (x ${Math.round(m.knob.l)}..${Math.round(m.knob.r)} of ${m.vw}, y ${Math.round(m.knob.t)}..${Math.round(m.knob.b)} of ${m.vh})`);
  t.check(m.sw <= m.cw + 1 && m.sh <= m.ch + 1, `${label}: knob no scroll overflow (${m.sw}/${m.cw}, ${m.sh}/${m.ch})`);
  t.check(Math.abs(m.mark.w - 30) < 1 && Math.abs(m.mark.h - 30) < 1, `${label}: logo mark 30px (${m.mark.w}x${m.mark.h})`);
  t.check(m.grip.l >= m.mark.r - e && Math.abs((m.grip.t + m.grip.b) / 2 - (m.mark.t + m.mark.b) / 2) < 3, `${label}: grip dots right of the logo, vertically centred`);
  t.check(m.pill.t >= m.row.b - e, `${label}: pill sits below the logo row`);
  await p.close();
}
test("15", "notch: ₹1,23,456 / ₹1Cr+ pill contained, no overflow (desktop + mobile)", async t => {
  const now = Date.now();
  for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]])
    await withExt({ viewport }, async ({ ctx, sw }) => {
      await notchCheck(t, ctx, sw, { id: "B0NOTCHBIG", hist: [[now - 20 * D, 830 + 123456], [now - 36e5, 830]], want: "↓₹1,23,456", label: name + " ₹1,23,456" });
      await notchCheck(t, ctx, sw, { id: "B0NOTCHUP1", hist: [[now - 20 * D, 100], [now - 36e5, 830]], want: "↑₹730", label: name + " up" });
      await notchCheck(t, ctx, sw, { id: "B0NOTCHCR1", hist: [[now - 20 * D, 830 + 25000000], [now - 36e5, 830]], want: "↓₹2Cr+", label: name + " crore cap" });
    });
});

// ---------------------------------------------------------------- 16 remove trap
test("16", "remove trap: Remove link clears target, keeps wish, UI returns to Set", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw);
  const id = "B0REMOVE01", k = key(id), now = Date.now();
  await seed(sw, { items: seedItem(id, [[now - 10 * D, 900], [now - 36e5, 830]], { target: 700, wish: true }) });
  const { p, panel } = await product(ctx, { id, price: 830, mrp: null }); await panel.open();
  t.check(/Price alert at ₹700/.test(await panel.text(".trapbox .lbl")) && (await panel.val(".trapbox .stp-in input")) === "700", "existing trap shown with stepper prefilled 700");
  t.check(await panel.has(".trapbox .link-btn") && /Remove/.test(await panel.text(".trapbox .link-btn")) && !(await panel.has(".trapbox .btn")), "Remove link present, no Set button");
  await panel.click(".trapbox .link-btn");
  t.check(!!(await poll(async () => (await itemOf(sw, k)) && (await targetOf(sw, k)) === undefined, 3000)), "target removed from storage");
  t.check((await itemOf(sw, k)).wish === true, "item still wished");
  await poll(async () => await panel.has(".trapbox .btn"), 3000);
  t.check(/Set/.test(await panel.text(".trapbox .btn")) && !(await panel.has(".trapbox .link-btn")) && /Set price alert/.test(await panel.text(".trapbox .lbl")), "UI back to 'Set price alert' + Set button");
  t.check(await panel.has(".heart.on"), "heart still on");
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open();
  t.check(!(await panel.has(".trapbox .link-btn")), "stays removed after reload");
  await panel.tab(2); t.check((await panel.count(".wrow")) === 1 && (await panel.count(".wrow .stp")) === 0, "watchlist row now offers 'Set a trap' instead of a stepper");
}));

// ---------------------------------------------------------------- 17 heart
test("17", "heart: on/off persists across reload, aria-pressed, watchlist follows", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw);
  const id = "B0HEART001", k = key(id), { p, panel } = await product(ctx, { id, price: 830 }); await panel.open();
  const pr = () => panel.run(".heart", function () { return this.getAttribute("aria-pressed"); });
  t.check((await pr()) === "false", "starts aria-pressed=false");
  await panel.click(".heart"); await poll(async () => (await itemOf(sw, k))?.wish === true, 3000);
  t.check((await pr()) === "true" && await panel.has(".heart.on"), "on: aria-pressed=true + .on");
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open();
  t.check(await panel.has(".heart.on") && (await pr()) === "true", "still on after reload");
  await panel.tab(2); t.check((await panel.count(".wrow")) === 1, "watchlist has the item"); await panel.tab(0);
  await panel.click(".heart"); await poll(async () => (await itemOf(sw, k))?.wish === false, 3000);
  t.check(!(await panel.has(".heart.on")) && (await pr()) === "false", "off: aria-pressed=false");
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open();
  t.check(!(await panel.has(".heart.on")), "still off after reload");
  await panel.tab(2); t.check(await panel.has("main .empty") && (await panel.count(".wrow")) === 0, "watchlist empty again");
}));

// ---------------------------------------------------------------- 18 guard / skeleton
test("18", "guard: normal page loads past skeleton; malformed messages rejected; unextractable page does not hang", t => withExt({}, async ({ ctx, sw, extId }) => {
  const { panel } = await product(ctx, { id: "B0SKELET01", price: 830 }); await panel.open();
  t.check(!!(await poll(async () => !(await panel.has(".sk")) && await panel.has(".hero .price"), 8000, 200)), "panel gets past the loading skeleton and shows the price hero");
  t.check((await panel.count(".sk")) === 0, "no skeleton blocks left");
  // runtime messages from an extension page
  const ep = await ctx.newPage(); await ep.goto(`chrome-extension://${extId}/options.html`);
  const send = m => ep.evaluate(m => chrome.runtime.sendMessage(m), m);
  const good = { key: "amazon.in:B0GUARD001", site: "Amazon", url: "https://www.amazon.in/dp/B0GUARD001", title: "x", image: null, price: 100, mrp: null, src: "dom" };
  for (const [name, m] of [["unknown type", { type: "nope" }], ["undefined price", { type: "seen", p: { ...good, price: undefined } }], ["string price", { type: "seen", p: { ...good, price: "100" } }], ["price 0", { type: "seen", p: { ...good, price: 0 } }],
    ["price >= 1e7", { type: "seen", p: { ...good, price: 1e7 } }], ["http url", { type: "seen", p: { ...good, url: "http://www.amazon.in/dp/x" } }], ["extra field", { type: "seen", p: { ...good, evil: 1 } }], ["bad src", { type: "seen", p: { ...good, src: "x" } }],
    ["track target 0", { type: "track", key: "k", target: 0 }], ["huge key", { type: "untrack", key: "k".repeat(201) }], ["extra top-level", { type: "untrack", key: "k", x: 1 }]]) {
    const r = await send(m); t.check(r && r.error === "rejected", `${name} rejected: ${JSON.stringify(r)}`);
  }
  const r = await send({ type: "seen", p: good }); t.check(r && !r.error && r.it, "well-formed seen is accepted");
  await ep.close();
  // a page whose price cannot be cleaned (>= 1e7) must settle (empty state), never sit on a skeleton forever
  const url = await routeProduct(ctx, { id: "B0HUGEPRC1", price: 99999999, mrp: null }), { panel: p2 } = await openPage(ctx, url, { wait: false });
  await sleep(11000); await p2.waitKnob(5000); await p2.open();
  t.check(!!(await poll(async () => !(await p2.has(".sk")), 6000)), "unextractable page leaves the skeleton");
}));

// ---------------------------------------------------------------- 19 account sheet
// A real mouse click first: privileged messages require user activation (programmatic .click() from CDP does not count).
async function acctSheet(panel) { await panel.p.mouse.click(300, 300); await panel.open(); await panel.click(".acct"); await panel.waitFor(".w.sheetopen", 4000); await sleep(400); return panel.ev(function () { const s = this.querySelector(".sheet"), cb = s.querySelector("input[type=checkbox]"); return { title: s.querySelector("h4").textContent, text: s.textContent, btns: [...s.querySelectorAll("button")].map(b => b.textContent.trim()), cb: cb && cb.checked }; }); }
test("19a", "account: empty anon key -> sheet says sign-in isn't set up", t => withExt({ anonKey: "" }, async ({ ctx }) => {
  const { panel } = await product(ctx); const s = await acctSheet(panel);
  t.check(/Sign-in isn't set up/.test(s.text), "sheet text: " + s.text.slice(0, 120));
  t.check(!s.btns.includes("Continue with Google"), "no Google button when unconfigured");
}));
test("19b", "account: signed-out sheet offers Continue with Google (dummy anon key copy)", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx }) => {
  await fakeSupabase(ctx); const { panel } = await product(ctx); const s = await acctSheet(panel);
  t.check(/Sign in to HAULS/.test(s.title), "title: " + s.title); t.check(s.btns.includes("Continue with Google"), "Continue with Google button: " + s.btns.join("|"));
  t.check(!/isn't set up/.test(s.text), "does not claim to be unconfigured");
}));
test("19c", "account: seeded signed-in sheet shows user, plan, consent, sign out", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx, sw }) => {
  await fakeSupabase(ctx); await seedSession(sw, SESSION); await seed(sw, { profile: { plan: "pro", contribute: false, name: "Test User" } });
  const { panel } = await product(ctx);
  t.check((await panel.text(".acct")).trim() === "T", "account button shows initial: " + await panel.text(".acct"));
  const s = await acctSheet(panel);
  t.check(/Your account/.test(s.title), "title: " + s.title); t.check(/tester@example\.com/.test(s.text) && /Test User/.test(s.text), "shows name + email"); t.check(/pro/.test(s.text), "shows plan pill 'pro'");
  t.check(s.cb === false, "share-prices checkbox reflects profile.contribute=false"); t.check(s.btns.includes("Sign out") && s.btns.some(b => /Export my data/.test(b)), "Sign out + Export present: " + s.btns.join("|"));
  await panel.click(".sheet button", s.btns.indexOf("Sign out"));
  t.check(!!(await poll(async () => !(await sessionOf(sw)), 4000)), "Sign out clears the session");
}));

// ---------------------------------------------------------------- 20 options page
test("20", "options page: loads, enable button + state pill", t => withExt({}, async ({ ctx, extId, errs }) => {
  const p = await ctx.newPage(); await p.goto(`chrome-extension://${extId}/options.html`);
  t.check(/HAULS settings/.test(await p.title()), "title: " + await p.title());
  t.check(!!(await poll(async () => /^(On|Off)$/.test(await p.textContent("#state")), 5000)), "state pill resolved: " + await p.textContent("#state"));
  t.check(await p.isVisible("#on") && /Turn on/i.test(await p.textContent("#on")), "enable button visible"); t.check(await p.isHidden("#off"), "turn-off hidden while Off");
  t.check(errs.length === 0, "console errors: " + errs.join(" | "));
}));

// ---------------------------------------------------------------- 21 sync outbox
const outboxOf = async sw => (await store(sw, "outbox")).outbox || [];
const isWatchPost = c => c.method === "POST" && /\/rest\/v1\/ext_watchlist/.test(c.path);
// Expect the trap-triggered flush to POST the watch op by itself; if it does not, force a manual sync (options page) so the remaining assertions still mean something.
async function expectFlush(t, ctx, sb, extId, label) {
  let post = await poll(async () => sb.calls.find(isWatchPost), 6000, 300);
  t.check(!!post, label + ": trap-triggered flush POSTs /rest/v1/ext_watchlist on its own (calls: " + sb.calls.map(c => c.method + " " + c.path.split("?")[0].replace("/rest/v1", "")).join(", ") + ")");
  if (!post) { const ep = await ctx.newPage(); await ep.goto(`chrome-extension://${extId}/options.html`); await ep.evaluate(() => chrome.runtime.sendMessage({ type: "sync" })); await ep.close(); post = await poll(async () => sb.calls.find(isWatchPost), 6000, 300); t.note("manual sync " + (post ? "did" : "did NOT") + " send the watch op"); }
  return post;
}
test("21a", "sync: trap queues a watch op and flush POSTs ext_watchlist; observations uploaded when contribute=true", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx, sw, extId }) => {
  const sb = await fakeSupabase(ctx); await seedSession(sw, SESSION); await seed(sw, { profile: { plan: "free", contribute: true } });
  const id = "B0SYNCOK01", k = key(id), { panel } = await product(ctx, { id, price: 830, mrp: null }); await panel.open();
  await panel.type(".trapbox .stp-in input", "700"); await panel.click(".trapbox .btn");
  const post = await expectFlush(t, ctx, sb, extId, "21a");
  const row = post && [].concat(post.body)[0]; t.check(row && row.product_key === k && row.target_price === 700 && row.user_id === SESSION.user.id, "row payload: " + JSON.stringify(row));
  t.check(!!(await poll(async () => (await outboxOf(sw)).length === 0, 5000)), "outbox drained after a successful flush: " + JSON.stringify(await outboxOf(sw)));
  t.check(sb.calls.some(c => /\/rpc\/ext_upsert_observations/.test(c.path)), "observation uploaded via rpc (contribute=true)");
}));
test("21b", "sync: observations NOT uploaded when profile.contribute=false (watchlist still syncs)", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx, sw, extId }) => {
  const sb = await fakeSupabase(ctx); await seedSession(sw, SESSION); await seed(sw, { profile: { plan: "free", contribute: false } });
  const { panel } = await product(ctx, { id: "B0SYNCNO01", price: 830, mrp: null }); await panel.open();
  await panel.type(".trapbox .stp-in input", "700"); await panel.click(".trapbox .btn");
  t.check(!!(await expectFlush(t, ctx, sb, extId, "21b")), "watch op POSTed");
  await sleep(1500); t.check(!sb.calls.some(c => /ext_upsert_observations/.test(c.path)), "no ext_upsert_observations call");
  t.check(!(await outboxOf(sw)).some(o => o.t === "obs"), "no obs ops queued in outbox");
}));
test("21c", "sync: server 500 keeps the outbox and the UI stays usable", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx, sw, extId }) => {
  const sb = await fakeSupabase(ctx, { fail: true }); await seedSession(sw, SESSION); await seed(sw, { profile: { plan: "free", contribute: true } });
  const id = "B0SYNC5XX1", k = key(id), { panel } = await product(ctx, { id, price: 830, mrp: null }); await panel.open();
  await panel.type(".trapbox .stp-in input", "700"); await panel.click(".trapbox .btn");
  t.check(!!(await expectFlush(t, ctx, sb, extId, "21c")), "POST attempted");
  await sleep(1200);
  const ob = await outboxOf(sw); t.check(ob.some(o => o.t === "watch" && o.key === k && o.target === 700), "watch op still queued: " + JSON.stringify(ob).slice(0, 160));
  t.check((await targetOf(sw, k)) === 700, "local trap saved regardless of server");
  t.check(await panel.has(".trapbox .link-btn") && /Price alert at ₹700/.test(await panel.text(".trapbox .lbl")), "UI shows the trap as set");
  await panel.type(".trapbox .stp-in input", "650"); t.check(!!(await poll(async () => (await targetOf(sw, k)) === 650, 3000)), "further edits still work while server is down");
  await panel.tab(2); await panel.tab(1); await panel.tab(0); t.check(await panel.has(".trapbox") && !(await panel.has("main .vcard.wait")), "tabs still render, no error card");
  t.check((await outboxOf(sw)).filter(o => o.t === "watch" && o.key === k).length === 1, "outbox coalesces to one watch op per product");
}));

// ---------------------------------------------------------------- 22 platforms
test("22", "platforms: Ajio dropped; six new shops declared; JSON-LD extraction on routed pages", t => withExt({}, async ({ ctx, sw }) => {
  const m = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8")), all = JSON.stringify([m.host_permissions, m.content_scripts, m.optional_host_permissions]);
  t.check(!/ajio/i.test(all), "manifest has no ajio");
  const cs = m.content_scripts.flatMap(c => c.matches).join(" ");
  for (const d of ["croma.com", "reliancedigital.in", "tatacliq.com", "nykaa.com", "vijaysales.com", "snapdeal.com"]) t.check(cs.includes(d), "content_scripts match " + d);
  t.check(!/meesho/i.test(all), "Meesho (blocks automation) not declared");
  t.check(!/"ajio\.com"\s*:/.test(readFileSync(path.join(EXT, "lib.js"), "utf8") + readFileSync(path.join(EXT, "sites-extra.js"), "utf8")), "no ajio.com site entry in SITES/EXTRA_SITES");
  // routed JSON-LD product pages (deterministic)
  const cases = [["reliancedigital.in", "https://www.reliancedigital.in/product/test-keyboard-123456", "reliancedigital.in:123456", 1499, "Reliance Digital"],
    ["tatacliq.com", "https://www.tatacliq.com/test-shirt/p-mp000000012345", "tatacliq.com:mp000000012345", 999, "Tata CLiQ"],
    ["snapdeal.com", "https://www.snapdeal.com/product/test-keyboard/628496998415", "snapdeal.com:628496998415", 649, "Snapdeal"],
    ["nykaa.com", "https://www.nykaa.com/test-lipstick/p/123456", "nykaa.com:123456", 349, "Nykaa"],
    ["vijaysales.com", "https://www.vijaysales.com/p/P260811/260813/test-tv", "vijaysales.com:P260811", 24990, "Vijay Sales"]];
  for (const [site, url, k, price, name] of cases) {
    await routeLd(ctx, url, { price, mrp: price + 500 }); const { p, panel } = await openPage(ctx, url);
    const it = await poll(async () => (await itemOf(sw, k)), 8000);
    t.check(!!it && it.hist.at(-1)[1] === price && it.site === name && it.mrp === price + 500, `${site}: extracted ${JSON.stringify(it && { price: it.hist.at(-1)[1], site: it.site, mrp: it.mrp })}`);
    await panel.open(); const names = await panel.ev(function () { return [...this.querySelectorAll(".stores a.store")].map(a => a.textContent); });
    t.check(!names.includes(name), `${name} not listed in its own compare row: ${names}`); await p.close();
  }
  // Ajio page: no panel at all
  await ctx.route("https://www.ajio.com/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>x</title><span>₹999</span>" }));
  const p = await ctx.newPage(); await p.goto("https://www.ajio.com/some-shirt/p/469000000_blue"); await sleep(2500);
  t.check((await p.evaluate(() => !!document.getElementById("hauls-root"))) === false, "no HAULS panel injected on ajio.com");
}));

// ---------------------------------------------------------------- 57-61 Amazon reader: waits for the year, honest chart, empty states
// Fake of Amazon's Price-history panel (the real one needs a signed-in page): ingress button -> docked panel with 1M/3M/1Y tabs. yearMs / otherMs = how long a tab takes to draw its chart (null = the click does nothing); noPanel = the button opens nothing.
const AMZ = n => readFileSync(new URL(`../fixtures/amazon-history/${n}.svg`, import.meta.url), "utf8");
const amzFakeFn = ({ h1m, h1y, o }) => { const W = window; W.__clicks = []; W.__closed = 0; W.__closeAt = 0; W.__yearAt = 0; W.__yearClickAt = 0; W.__opacity = null;
  const d = document.createElement("div"); d.id = o.pill ? "rufus-price-ingress-cc" : "rufus-price-ingress-bb"; d.innerHTML = o.pill ? '<span class="rufus-ph-ingress-pill a-declarative" data-action="show-rufus-price-ingress" data-show-rufus-price-ingress="{}"><span class="a-button a-button-base"><span class="a-button-inner"><span class="a-button-text">Price history</span></span></span></span>' : '<span class="a-declarative" data-action="show-rufus-price-ingress"><span class="a-button-text">Price history</span></span>'; if (o.openAtLoad) setTimeout(() => document.body.append(d), 1500); else document.body.append(d);
  W.__ing = 0; const openPanel = () => { setTimeout(() => { const f = document.createElement("div"); f.id = "nav-flyout-rufus"; document.body.classList.add("rufus-docked-left");
    f.innerHTML = '<div id="rufus-panel-header-container"><button class="rufus-panel-tooltip-close" aria-label="Close tip"></button><button id="rufus-panel-header-close" aria-label="close"></button></div><div id="rufus-react-renderer"><div role="tablist">' + ["1M", "3M", "1Y"].map(l => `<span role="tab" aria-selected="${l === (o.startYear ? "1Y" : "1M")}">${l}</span>`).join("") + '</div><span class="rufus-pricing-chart-container">' + (o.chartDelay || o.noChart ? (o.noChart ? "<p>Over the past 30 days, the price has ranged from ₹94,990 to ₹107,990.</p>" : "") : (o.startYear ? h1y : h1m)) + '</span></div>';
    document.body.append(f); const box = f.querySelector(".rufus-pricing-chart-container"), tabs = [...f.querySelectorAll("[role=tab]")]; if (o.chartDelay) setTimeout(() => { box.innerHTML = h1m; }, o.chartDelay);
    tabs.forEach(tb => tb.addEventListener(o.tabEvent || "click", () => { const l = tb.textContent; W.__clicks.push(l); if (l === "1Y") W.__yearClickAt = Date.now(); const ms = l === "1Y" ? o.yearMs : o.otherMs; if (ms == null) return; tabs.forEach(x => x.setAttribute("aria-selected", String(x === tb)));
      setTimeout(() => { box.innerHTML = l === "1Y" ? h1y : h1m; if (l === "1Y") { W.__yearAt = Date.now(); W.__opacity = getComputedStyle(f).opacity; } }, ms); }));
    f.querySelector("#rufus-panel-header-close").addEventListener("pointerup", () => { W.__closed++; W.__closeAt = Date.now(); setTimeout(() => { f.remove(); document.body.classList.remove("rufus-docked-left"); }, 300); }); /* like Amazon: only a real press closes it, and the page un-docks a moment later */ }, 300); };
  d.querySelector(".a-declarative").addEventListener(o.ingressEvent || "click", () => { W.__ing++; if (o.noPanel) return; const ex = document.getElementById("nav-flyout-rufus"); if (ex && o.toggle) { ex.remove(); document.body.classList.remove("rufus-docked-left"); return; } /* like Amazon: the button TOGGLES the panel */ openPanel(); });
  if (o.dockedOnly) document.body.classList.add("rufus-docked-left"); /* the page marker without any panel (Amazon restores it) */
  if (o.openEmpty) { const f0 = document.createElement("div"); f0.id = "nav-flyout-rufus"; document.body.classList.add("rufus-docked-left"); f0.innerHTML = '<div id="rufus-react-renderer"></div>'; document.body.append(f0); } /* a panel left open with no chart in it */
  if (o.openAtLoad) openPanel(); };
const amzFake = (p, o) => p.evaluate(amzFakeFn, { h1m: AMZ("chart-1m"), h1y: AMZ("chart-1y"), o });

test("57", "Amazon reader waits for a slow year: 1Y draws 2.5 s after its tab is clicked; the reader stores it (tab 1Y, 365 days), keeps the panel open (visible) 1.2 s more, and only then closes", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true }); const id = "B0SLOWYEAR", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: 2500, otherMs: 400 }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 45000, 400)), "the panel was closed");
  await poll(() => r.p.evaluate(() => !document.getElementById("nav-flyout-rufus")), 6000, 300);
  const w = await r.p.evaluate(() => ({ clicks: window.__clicks.join(), closed: window.__closed, closeAt: window.__closeAt, yearAt: window.__yearAt, op: window.__opacity, hide: !!document.getElementById("hauls-ah-hide"), docked: document.body.classList.contains("rufus-docked-left"), flyout: !!document.getElementById("nav-flyout-rufus") }));
  const ah = ((await store(sw, "items")).items[k] || {}).ahist || { ranges: {} }, y = ah.ranges["1Y"];
  t.check(w.clicks === "1Y" && w.closed === 1, "month on screen, then the year, closed once: " + JSON.stringify(w));
  t.check(!!y && y.tab === "1Y" && y.days === 365 && y.points.length === 5 && y.points[0][1] === 5499, "the year was stored with its tab and its real span: " + JSON.stringify(y && [y.tab, y.days, y.points.length]));
  t.check(!!y && y.at >= w.yearAt && w.closeAt >= y.at + 1100, `closed only after the year was stored (+1.2 s): drawn ${w.yearAt % 1e5}, stored ${y && y.at % 1e5}, closed ${w.closeAt % 1e5}`);
  t.check(w.op === "1" && !w.hide, "the panel is not hidden while it is read (opacity " + w.op + ")");
  t.check(!w.docked && !w.flyout, "the page is not left shifted: " + JSON.stringify([w.docked, w.flyout]));
  t.check(!!ah.ranges["1M"], "the month that was on screen first was stored too");
  await r.panel.click(".seg:not(.hz) button[data-r='1Y']"); await sleep(400); const lbl = await r.panel.text(".chartbox .lbl"); t.check(/^1Y history$/.test(lbl.trim()), "HAULS 1Y now has a year of data and says nothing short: " + lbl);
}));

test("58", "Amazon reader, 1Y never appears (tab click does nothing): it gives up after ~10 s, records what it did read, closes cleanly, leaves the page unshifted; a tab that does not fit the span is dropped", t => withExt({}, async ({ ctx, sw, extId }) => {
  await seed(sw, { ahAuto: true }); const id = "B0NOYEAR01", k = key(id);
  const r = await product(ctx, { id, price: 4499, mrp: 5999 }); await r.panel.open(); await amzFake(r.p, { yearMs: null, otherMs: 400 }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.p.evaluate(() => window.__closed >= 1), 60000, 500)), "the panel was closed although the year never came");
  await poll(() => r.p.evaluate(() => !document.getElementById("nav-flyout-rufus")), 6000, 300);
  const w = await r.p.evaluate(() => ({ clicks: window.__clicks.join(), closed: window.__closed, wait: window.__closeAt - window.__yearClickAt, docked: document.body.classList.contains("rufus-docked-left"), flyout: !!document.getElementById("nav-flyout-rufus"), hide: !!document.getElementById("hauls-ah-hide") }));
  t.check(/^1Y(,1Y)*$/.test(w.clicks) && w.closed === 1 && w.wait >= 9500 && w.wait < 25000, "it waited about 10 s for the year, then closed once: " + JSON.stringify(w));
  t.check(!w.docked && !w.flyout && !w.hide, "page unshifted, nothing left behind");
  const ah = ((await store(sw, "items")).items[k] || {}).ahist || {};
  t.check(!!ah.ranges && !!ah.ranges["1M"] && !ah.ranges["1Y"] && ah.tried > ah.at, "what was read (1M/3M) is kept, no year is invented, and the end of the run is marked: " + JSON.stringify([Object.keys(ah.ranges || {}), ah.tried > ah.at]));
  // the handler keeps a tab only when the span fits it
  const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`); const now = Date.now();
  const send = tab => o.evaluate(m => chrome.runtime.sendMessage(m), { type: "ahist", key: k, range: "1Y", days: 300, points: [[now - 300 * D, 4499], [now, 4499]], current: 4499, offer: null, highest: null, ...(tab ? { tab } : {}) });
  await send("1M"); let y = ((await store(sw, "items")).items[k].ahist.ranges["1Y"]); t.check(y && y.days === 300 && y.tab === undefined, "tab 1M cannot describe 300 days: dropped: " + JSON.stringify(y && y.tab));
  await send("1Y"); y = ((await store(sw, "items")).items[k].ahist.ranges["1Y"]); t.check(y && y.tab === "1Y", "tab 1Y with 300 days is kept");
  const bad = await send("5Y"); t.check(!bad || bad.ok === false || bad.error, "an unknown tab is refused by the guard: " + JSON.stringify(bad));
}));

test("59", "chart box is never an empty box: one plain line when there is too little history (+ the Settings switch only for an Amazon product with the reader off)", t => withExt({}, async ({ ctx, sw }) => {
  const line = "Not enough history yet. It builds as you visit this product.";
  let r = await product(ctx, { id: "B0EMPTYST1", price: 830, mrp: 1299 }); await r.panel.open(); await sleep(400);
  let box = await r.panel.text(".chartbox"); t.check(box.includes(line) && !/First seen|Revisit/.test(box), "reader off: the plain line is shown: " + box.slice(0, 160));
  t.check((await r.panel.count(".chartbox > *")) >= 2 && /Turn on automatic reading/.test(await r.panel.text(".chartbox .link-btn")), "and the switch is offered");
  const [pg] = await Promise.all([ctx.waitForEvent("page", { timeout: 8000 }), r.panel.click(".chartbox .link-btn")]); t.check(!!(await poll(() => /options\.html/.test(pg.url()), 6000, 200)), "the switch opens Settings: " + pg.url()); await pg.close().catch(() => {});
  await r.p.close(); await seed(sw, { ahAuto: true });
  r = await product(ctx, { id: "B0EMPTYST2", price: 830, mrp: 1299 }); await r.panel.open(); await sleep(400);
  box = await r.panel.text(".chartbox"); t.check(box.includes(line) && !(await r.panel.has(".chartbox .link-btn")), "reader on: the same line, no switch offered: " + box.slice(0, 160));
}));

test("60", "a read in flight shows a skeleton in the chart box (not a blank), and when it gives up the box says so in one line", t => withExt({}, async ({ ctx, sw }) => {
  await seed(sw, { ahAuto: true });
  const r = await product(ctx, { id: "B0INFLIGHT", price: 830, mrp: 1299 }); await r.panel.open(); await amzFake(r.p, { noPanel: true }); await r.p.evaluate(() => { history.pushState({}, "", location.pathname + "?x=1"); });
  t.check(!!(await poll(() => r.panel.has(".chartbox .sk"), 8000, 250)), "skeleton while the read is in flight");
  t.check(/Reading Amazon's history/.test(await r.panel.text(".chartbox")), "with a one-line note: " + (await r.panel.text(".chartbox")).slice(0, 80));
  t.check(!!(await poll(async () => /Couldn't read Amazon's history this time/.test(await r.panel.text(".chartbox")), 45000, 400)) && !(await r.panel.has(".chartbox .sk")), "when the panel never opens the skeleton is replaced by a plain line: " + (await r.panel.text(".chartbox")).slice(0, 120));
}));

test("61", "chart honesty: a range wider than the data says how much data there is, never a full year from a month; the chips match the window the line draws", t => withExt({}, async ({ ctx, sw }) => {
  const now = Date.now(), pick = async (panel, r) => { await panel.click(`.seg:not(.hz) button[data-r='${r}']`); await sleep(300); return panel.ev(function () { return { lbl: this.querySelector(".chartbox .lbl").textContent.trim(), yt: (this.querySelector(".yl.t") || {}).textContent, chips: [...this.querySelectorAll(".chip3 b")].map(b => b.textContent) }; }); };
  await seed(sw, { items: { ...seedItem("B0HONEST01", [[now - 29 * D, 1000], [now - 10 * D, 900], [now - 36e5, 830]]), ...seedItem("B0HONEST03", [[now - 354 * D, 1500], [now - 120 * D, 1100], [now - 20 * D, 900], [now - 36e5, 830]]), ...seedItem("B0HONEST02", [[now - 380 * D, 1500], [now - 45 * D, 1100], [now - 20 * D, 900], [now - 36e5, 830]]) } });
  const a = await product(ctx, { id: "B0HONEST01", price: 830 }); await a.panel.open();
  let s = await pick(a.panel, "1Y"); t.check(s.lbl === "1Y history · 29 days of data so far", "1Y with 29 days of data says so: " + s.lbl);
  s = await pick(a.panel, "90D"); t.check(s.lbl === "90D history · 29 days of data so far", "90D too: " + s.lbl);
  s = await pick(a.panel, "30D"); t.check(s.lbl === "30D history", "30D is covered (29 days is a month): " + s.lbl);
  s = await pick(a.panel, "All"); t.check(s.lbl === "All history", "All never claims more than it has: " + s.lbl);
  const c = await product(ctx, { id: "B0HONEST03", price: 830 }); await c.panel.open();
  s = await pick(c.panel, "1Y"); t.check(s.lbl === "1Y history", "354 of 365 days is a year, not 'so far': " + s.lbl);
  const b = await product(ctx, { id: "B0HONEST02", price: 830 }); await b.panel.open();
  s = await pick(b.panel, "1Y"); t.check(s.lbl === "1Y history", "a year of data: no note: " + s.lbl);
  // 30D window starts inside the 1,100 period: the line starts at 1,100, so the High chip must too (it used to say 900, the highest price seen INSIDE the window)
  s = await pick(b.panel, "30D"); t.check(s.yt === "₹1,100" && s.chips[2] === "₹1,100" && s.chips[0] === "₹830", `30D: line top ${s.yt} = High chip ${s.chips[2]}, Low ${s.chips[0]}`);
  s = await pick(b.panel, "90D"); t.check(s.yt === "₹1,500" && s.chips[2] === "₹1,500", `90D: line top ${s.yt} = High chip ${s.chips[2]}`);
}));

test("62", "Amazon background read waits for the year too: the small window stays until the page script marks it is finished, so 1Y (slow to draw) is stored before it closes", t => withExt({}, async ({ ctx, sw, extId }) => {
  const id = "B0AMZBGYR1", now = Date.now(), args = { h1m: AMZ("chart-1m"), h1y: AMZ("chart-1y"), o: { yearMs: 2500, otherMs: 400 } };
  await ctx.addInitScript(({ src, a, id }) => { if (!location.pathname.includes(id)) return; document.addEventListener("DOMContentLoaded", () => (0, eval)("(" + src + ")")(a)); }, { src: amzFakeFn.toString(), a: args, id });
  await routeProduct(ctx, { id, price: 4499, mrp: 5999 });
  await seed(sw, { ahAuto: true, items: seedItem(id, [[now - 5 * D, 4499], [now - 3600e3, 4499]], { wish: true, seenAt: now - 3600e3 }) });
  const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`); ctx.on("page", pg => { pg.reload().catch(() => {}); });
  const r = await o.evaluate(() => chrome.runtime.sendMessage({ type: "abg-run", gesture: true })); t.check(r && r.ok === true, "background read ok: " + JSON.stringify(r));
  const ah = (await store(sw, "items")).items["amazon.in:" + id].ahist || { ranges: {} };
  t.check(!!ah.ranges["1Y"] && ah.ranges["1Y"].tab === "1Y" && ah.ranges["1Y"].days === 365, "the year was stored before the window closed: " + JSON.stringify(Object.keys(ah.ranges)));
}));

// ---------------------------------------------------------------- g1 dropped sync changes are visible
test("g1", "dropped changes: Settings and the account sheet say '3 changes could not be saved to your account.' only while the count is above 0; Try again syncs and clears it", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx, sw, extId }) => {
  await fakeSupabase(ctx); await seedSession(sw, SESSION); await seed(sw, { profile: { plan: "free", contribute: false, name: "Test User" } });
  const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`); await sleep(1200);
  t.check(await o.isHidden("#dropbox"), "nothing shown while no change was dropped");
  await seed(sw, { syncDropped: { n: 3, at: Date.now() } }); await poll(() => o.isVisible("#dropbox"), 5000);
  t.check(await o.isVisible("#dropbox") && (await o.textContent("#dropmsg")).trim() === "3 changes could not be saved to your account.", "Settings text: " + await o.textContent("#dropmsg"));
  await seed(sw, { syncDropped: { n: 1, at: Date.now() } }); await poll(async () => /^1 change /.test((await o.textContent("#dropmsg")).trim()), 5000); t.check(/^1 change could not/.test((await o.textContent("#dropmsg")).trim()), "singular: " + await o.textContent("#dropmsg"));
  await seed(sw, { syncDropped: { n: 4, at: Date.now() - 8 * 864e5 } }); await sleep(500); const old = await sw.evaluate(() => droppedCount({ n: 4, at: Date.now() - 8 * 864e5 })); t.check(old === 0, "an 8-day-old count is not counted");
  const { panel } = await product(ctx); await seed(sw, { syncDropped: { n: 2, at: Date.now() } }); const s = await acctSheet(panel);
  t.check(/2 changes could not be saved to your account\./.test(s.text) && s.btns.includes("Try again"), "account sheet says it and offers Try again: " + s.text.slice(0, 200));
  await o.bringToFront(); await o.click("#droptry"); t.check(!!(await poll(async () => (await store(sw, "syncDropped")).syncDropped === undefined, 8000)), "a clean sync clears the count");
  t.check(!!(await poll(() => o.isHidden("#dropbox"), 5000)), "Settings hides the notice again");
}));

// ---------------------------------------------------------------- g4 export is made on the Settings page
test("g4", "export: the account sheet's Export button opens Settings at #export, a click there downloads the same JSON; and Settings has its own Export button", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx, sw, extId }) => {
  await fakeSupabase(ctx); await seedSession(sw, SESSION); await seed(sw, { profile: { plan: "free", contribute: false, name: "Test User" } });
  const { panel } = await product(ctx), s = await acctSheet(panel);
  const [np] = await Promise.all([ctx.waitForEvent("page", { timeout: 8000 }), panel.click(".sheet button", s.btns.findIndex(b => /Export my data/.test(b)))]);
  await np.waitForLoadState("domcontentloaded"); await np.waitForSelector("#confirm:not([hidden])", { timeout: 8000 });
  t.check(/#export$/.test(np.url()) && (await np.textContent("#cfh")).trim() === "Export your data?", "Settings opened at #export with the confirm card: " + np.url());
  const [dl] = await Promise.all([np.waitForEvent("download", { timeout: 8000 }), np.click("#cfgo")]); const body = JSON.parse(readFileSync(await dl.path(), "utf8"));
  t.check(dl.suggestedFilename() === "hauls-my-data.json" && Object.keys(body).join() === "exportedAt,account,localWatchlist", "same file as before: " + dl.suggestedFilename() + " " + Object.keys(body));
  await np.close();
  const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`); await poll(() => o.isVisible("#export"), 6000);
  const [dl2] = await Promise.all([o.waitForEvent("download", { timeout: 8000 }), o.click("#export")]); t.check(dl2.suggestedFilename() === "hauls-my-data.json", "Settings' own Export button downloads it");
}));

// ---------------------------------------------------------------- si: hearts and price alerts need a Google sign-in
const PROMPT = /Sign in with Google to save this to your watchlist and get alerts\./;
const sheetOf = panel => panel.ev(function () { const w = this.querySelector(".w"), s = this.querySelector(".sheet"); return { open: !!w && w.classList.contains("sheetopen"), text: s ? s.textContent : "", btns: s ? [...s.querySelectorAll("button")].map(b => b.textContent.trim()) : [] }; });
const rawMsg = (o, m) => o.evaluate(x => chrome.runtime.sendMessage(x), m);
test("si1", "signed out: the heart and Set show the sign-in prompt, store nothing; the background itself answers {error:'signin'}; the empty Watchlist shows the same prompt", t => withExt({}, async ({ ctx, sw, extId }) => {
  const id = "B0SIGNOUT1", k = key(id), { panel } = await product(ctx, { id, price: 830 }); await panel.open();
  await panel.click(".heart"); await panel.waitFor(".w.sheetopen", 4000); await sleep(400);
  let sh = await sheetOf(panel);
  t.check(sh.open && PROMPT.test(sh.text) && sh.btns.includes("Continue with Google") && sh.btns.includes("Not now"), "heart: prompt with Continue with Google + Not now: " + JSON.stringify(sh).slice(0, 200));
  t.check(!(await panel.has(".heart.on")) && (await panel.run(".heart", function () { return this.getAttribute("aria-pressed"); })) === "false", "the heart is not pressed after a refused save");
  let it = (await store(sw, "items")).items?.[k]; t.check(it && !it.wish, "nothing hearted in storage: " + JSON.stringify(it && it.wish));
  await panel.click(".sheet .link-btn"); await sleep(500); t.check(!(await panel.has(".w.sheetopen")), "Not now closes the prompt");
  await panel.type(".trapbox .stp-in input", "700"); await panel.click(".trapbox .btn"); await panel.waitFor(".w.sheetopen", 4000); await sleep(400);
  sh = await sheetOf(panel); t.check(sh.open && PROMPT.test(sh.text), "Set price alert: the same prompt"); await panel.click(".sheet .link-btn"); await sleep(400);
  it = (await store(sw, "items")).items?.[k]; t.check(it && it.target === undefined && !it.wish && !(it.armed), "no alert stored: " + JSON.stringify({ target: it && it.target, armed: it && it.armed }));
  t.check(await panel.has(".trapbox .btn") && !(await panel.has(".trapbox .link-btn")), "the trap box still says Set (no Remove link)");
  await panel.tab(2); t.check(await panel.has("main .vcard.wait") && PROMPT.test(await panel.text("main .vcard.wait")) && await panel.has("main .btn.full") && !(await panel.has("main .empty")), "empty Watchlist signed out: the prompt and Continue with Google instead of 'Nothing saved'");
  const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`);
  t.check((await rawMsg(o, { type: "wish", key: k, on: true })).error === "signin" && (await rawMsg(o, { type: "track", key: k, target: 700 })).error === "signin", "raw wish / track messages are refused with {error:'signin'}");
  it = (await store(sw, "items")).items?.[k]; t.check(it && !it.wish && it.target === undefined, "and nothing changed in storage");
}));
test("si2", "signed out: items saved before sign-in still show; removing, un-hearting and removing an alert still work; changing an alert asks for sign-in", t => withExt({}, async ({ ctx, sw, extId }) => {
  const now = Date.now(), h = [[now - 5 * D, 1000], [now - 36e5, 1000]], A = key("B0LEGACY01"), B = key("B0LEGACY02");
  await seed(sw, { items: { [A]: { site: "Amazon", title: "Old Heart", url: "https://www.amazon.in/dp/B0LEGACY01", hist: h, wish: true }, [B]: { site: "Amazon", title: "Old Alert", url: "https://www.amazon.in/dp/B0LEGACY02", hist: h, target: 800 } } });
  const { panel } = await product(ctx, { id: "B0SIGNOUT2", price: 830 }); await panel.open(); await panel.tab(2);
  t.check((await panel.count("main .wrow")) === 2 && !(await panel.has("main .vcard.wait")), "both old items are listed, no sign-in card");
  await panel.type("main .wrow .stp-in input", "750"); await panel.press("main .wrow .stp-b", 1); await sleep(1500);
  t.check((await store(sw, "items")).items[B].target === 800 && await panel.has(".w.sheetopen"), "changing an old alert signed out is refused (still 800) and the prompt opens");
  await panel.click(".sheet .link-btn");
  const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`);
  t.check((await rawMsg(o, { type: "untrack", key: B })) === true && (await store(sw, "items")).items[B].target === undefined, "removing an alert works signed out");
  t.check((await rawMsg(o, { type: "wish", key: A, on: false })) === true && !(await store(sw, "items")).items[A].wish, "un-hearting works signed out");
  t.check((await rawMsg(o, { type: "remove", key: A })) === true && !(await store(sw, "items")).items[A], "removing an item works signed out");
}));
const fakeGoogle = sw => sw.evaluate(s => { globalThis.signInWithGoogle = async () => { await sessionStore.set(s); }; }, SESSION); // no Google window in a test: the sign-in just stores a session
test("si3", "signed out: heart -> Continue with Google -> the heart is saved by itself and shows pressed", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx, sw }) => {
  await fakeSupabase(ctx); await fakeGoogle(sw);
  const id = "B0REPLAY01", k = key(id), { panel } = await product(ctx, { id, price: 830 }); await panel.open();
  await panel.click(".heart"); await panel.waitFor(".w.sheetopen", 4000); await sleep(400);
  t.check(!(await panel.has(".heart.on")) && !((await store(sw, "items")).items[k] || {}).wish, "before sign-in: nothing saved, heart not pressed");
  await panel.press(".sheet .btn.full"); // a real press: sign-in needs user activation
  const done = await poll(async () => (await store(sw, "items")).items?.[k]?.wish === true, 8000, 250);
  t.check(!!done, "after sign-in the same heart was saved (wish=true)"); await sleep(600);
  t.check(!(await panel.has(".w.sheetopen")) && await panel.has(".heart.on"), "prompt closed and the heart shows pressed");
  t.check(!!(await sessionOf(sw)), "a session exists now");
}));
test("si4", "signed out: Set alert at 700 -> Continue with Google -> the alert is saved at 700", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx, sw }) => {
  await fakeSupabase(ctx); await fakeGoogle(sw);
  const id = "B0REPLAY02", k = key(id), { panel } = await product(ctx, { id, price: 830 }); await panel.open();
  await panel.type(".trapbox .stp-in input", "700"); await panel.click(".trapbox .btn"); await panel.waitFor(".w.sheetopen", 4000); await sleep(400);
  t.check(((await store(sw, "items")).items[k] || {}).target === undefined, "before sign-in: no alert stored");
  await panel.press(".sheet .btn.full");
  t.check(!!(await poll(async () => (await store(sw, "items")).items?.[k]?.target === 700, 8000, 250)), "after sign-in the alert was saved at 700");
  await sleep(600); t.check(await panel.has(".trapbox .link-btn") && !(await panel.has(".w.sheetopen")), "the trap box now shows Remove and the prompt is closed");
}));

// ---------------------------------------------------------------- 70+ verdict nudge + lookup limit
const nudgeOf = panel => panel.ev(function () { const n = this.querySelector(".nudge"); return n ? { text: n.textContent, ok: n.classList.contains("ok") } : null; });
const sessNudge = sw => sw.evaluate(() => chrome.storage.session.get("nudge")).then(r => r.nudge || {});
const NV = now => Object.fromEntries(verdictCases(now).map(c => [c.want, c])), openV = (ctx, c, o = {}) => product(ctx, { id: c.id, price: c.price, mrp: null, ...o });
test("70", "verdict nudge: 'Alert me at ₹X' under the verdict on Wait and Fair only, X is the verdict's own alert price and follows the how-soon tabs; none on Buy or when an alert exists; the verdict is never covered", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw); const now = Date.now(), V = NV(now);
  await seed(sw, { items: { ...seedItem(V.Wait.id, V.Wait.hist), ...seedItem(V.Fair.id, V.Fair.hist), ...seedItem(V.Buy.id, V.Buy.hist), ...seedItem("B0NUDGEHAS", V.Wait.hist, { target: 1100 }) } });
  const want = (c, h) => A.buyWait(c.hist.concat([[now, c.price]]), c.price, null, now, undefined, h).alertAt;
  let r = await openV(ctx, V.Wait); await r.panel.open(); let n = await nudgeOf(r.panel);
  t.check(n && n.text.includes("Alert me at " + inr(want(V.Wait, "1w"))) && n.text.includes("1,030"), "Wait: nudge offers the verdict's alert price: " + (n && n.text));
  t.check((await r.panel.text(".vcard .vw")).startsWith("Wait") && (await r.panel.rect(".vcard")).bottom <= (await r.panel.rect(".nudge")).top + 1, "the verdict stays visible and the nudge sits below it");
  t.check((await r.panel.text(".nudge .btn")).trim() === "Set alert" && (await r.panel.text(".nudge .btn.ghost")).trim() === "Not now", "a clear primary and an equal-weight dismiss"); await r.p.close();
  r = await openV(ctx, V.Fair); await r.panel.open(); n = await nudgeOf(r.panel); t.check(n && n.text.includes(inr(want(V.Fair, "1w"))), "Fair: nudge shown: " + (n && n.text));
  await r.panel.click('.hz [data-h="3d"]'); await sleep(700); t.check(/Buy/.test(await r.panel.text(".vcard .vw")) && !(await nudgeOf(r.panel)), "need it in 2-3 days -> Buy: the nudge goes away");
  await r.panel.click('.hz [data-h="1m"]'); await sleep(700); n = await nudgeOf(r.panel); t.check(/Wait/.test(await r.panel.text(".vcard .vw")) && n && n.text.includes(inr(want(V.Fair, "1m"))), "a month -> Wait: the nudge is back with that verdict's price: " + (n && n.text)); await r.p.close();
  r = await openV(ctx, V.Buy); await r.panel.open(); t.check(/Buy/.test(await r.panel.text(".vcard .vw")) && !(await nudgeOf(r.panel)), "Buy: nothing to wait for, no nudge"); await r.p.close();
  r = await openV(ctx, { id: "B0NUDGEHAS", price: V.Wait.price }); await r.panel.open(); const wd = await r.panel.text(".vcard .vw"), nd = await nudgeOf(r.panel); t.check(/Wait/.test(wd) && !nd, `an alert already exists: no nudge (verdict "${wd}", nudge ${JSON.stringify(nd)})`);
}));
test("71", "verdict nudge, signed in: Set alert saves the alert at that price, confirms calmly without redrawing the panel, 'Change' goes to the alert box, and the nudge is gone after a reload", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw); const now = Date.now(), V = NV(now), k = key(V.Wait.id); await seed(sw, { items: seedItem(V.Wait.id, V.Wait.hist) });
  const { p, panel } = await openV(ctx, V.Wait); await panel.open(); await panel.run(".hero", function () { this.__keep = 1; });
  await panel.click(".nudge .btn"); t.check(!!(await poll(async () => (await store(sw, "items")).items?.[k]?.target === 1030, 5000, 200)), "alert saved at the suggested ₹1,030: " + JSON.stringify((await store(sw, "items")).items?.[k]?.target));
  await sleep(500); const n = await nudgeOf(panel); t.check(n && n.ok && /Alert set at ₹1,030/.test(n.text), "calm confirmation: " + (n && n.text));
  t.check(await panel.run(".hero", function () { return this.__keep === 1; }), "no full redraw under the reader"); t.check(await panel.has(".trapbox .link-btn") && (await panel.val(".trapbox input")) === "1030" && /Price alert at ₹1,030/.test(await panel.text(".trapbox .lbl")), "the alert box now shows the alert (Remove, 1030)");
  t.check(await panel.ev(function () { const a = this.activeElement; return !!a && !!a.closest(".nudge.ok"); }), "after Set alert, focus moves to the confirmation's Change button");
  await panel.click(".nudge.ok .link-btn"); await sleep(300); t.check(await panel.ev(function () { const a = this.activeElement; return !!a && !!a.closest(".trapbox"); }), "Change moves focus to the alert box");
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open(); t.check(!(await nudgeOf(panel)), "after a reload the alert exists, so no nudge");
}));
const fakeGoogle2 = sw => sw.evaluate(s => { globalThis.signInWithGoogle = async () => { await sessionStore.set(s); }; }, SESSION);
test("72", "verdict nudge, signed out: tapping opens the sign-in sheet (nothing saved); after sign-in the alert is saved at that price; 'Not now' on the sheet means no second nudge ask for that product, but the heart still asks", t => withExt({ anonKey: "dummy-anon-key" }, async ({ ctx, sw }) => {
  await fakeSupabase(ctx); await fakeGoogle2(sw); const now = Date.now(), V = NV(now), A1 = "B0NUDGESO1", A2 = "B0NUDGESO2";
  await seed(sw, { items: { ...seedItem(A1, V.Wait.hist), ...seedItem(A2, V.Wait.hist) } });
  let r = await openV(ctx, { ...V.Wait, id: A1 }); await r.panel.open(); await r.panel.click(".nudge .btn"); await r.panel.waitFor(".w.sheetopen", 4000); await sleep(400);
  let sh = await sheetOf(r.panel); t.check(sh.open && PROMPT.test(sh.text) && sh.btns.includes("Continue with Google") && sh.btns.includes("Not now"), "sign-in sheet with an equal 'Not now': " + JSON.stringify(sh).slice(0, 160));
  t.check(((await store(sw, "items")).items[key(A1)] || {}).target === undefined, "nothing saved before sign-in");
  await r.panel.click(".sheet .link-btn"); await sleep(500); t.check(!(await r.panel.has(".w.sheetopen")) && !(await nudgeOf(r.panel)), "Not now closes the sheet and the nudge does not ask again");
  t.check((await sessNudge(sw))[key(A1)]?.a === 1, "the ask is remembered for this browser session");
  await r.p.reload({ waitUntil: "domcontentloaded" }); await r.panel.waitKnob(); await r.panel.open(); await sleep(500); t.check(!(await nudgeOf(r.panel)) && !(await r.panel.has(".w.sheetopen")), "after a reload: no nudge and the sheet does not open by itself");
  await r.panel.click(".heart"); await r.panel.waitFor(".w.sheetopen", 4000); t.check(await r.panel.has(".w.sheetopen"), "an explicit heart tap still asks to sign in"); await r.p.close();
  const full = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`amazon.in:FULL${String(i).padStart(5, "0")}`, { site: "Amazon", title: "w" + i, url: "https://www.amazon.in/dp/FULL" + i, wish: true, hist: [[now, 100]] }]));
  await seed(sw, { items: { ...seedItem(A1, V.Wait.hist), ...seedItem(A2, V.Wait.hist), ...full } }); // a full watchlist: the alert replayed after sign-in is refused
  r = await openV(ctx, { ...V.Wait, id: A2 }); await r.panel.open(); await r.panel.click(".nudge .btn"); await r.panel.waitFor(".w.sheetopen", 4000); await sleep(400); await r.panel.press(".sheet .btn.full");
  await poll(async () => /watchlist is full/.test((await r.panel.text(".nudge")) || ""), 8000, 250).catch(() => null); const fm = await r.panel.text(".nudge");
  t.check(/watchlist is full/.test(fm) && !(await r.panel.has(".w.sheetopen")) && (await store(sw, "items")).items?.[key(A2)]?.target === undefined, "a failed replay after sign-in says why in the nudge strip instead of nothing: " + fm.trim());
  await seed(sw, { items: { ...seedItem(A1, V.Wait.hist), ...seedItem(A2, V.Wait.hist) } }); await r.panel.click(".nudge .btn"); await sleep(600);
  t.check(!!(await poll(async () => (await store(sw, "items")).items?.[key(A2)]?.target === 1030, 8000, 250)), "after sign-in the alert is saved at ₹1,030");
  await sleep(800); const n = await nudgeOf(r.panel); t.check(n && n.ok && /Alert set at ₹1,030/.test(n.text) && !(await r.panel.has(".w.sheetopen")), "sheet closed and the confirmation shows: " + (n && n.text));
}));
test("73", "verdict nudge: Not now on one product hides the nudge on every product for the rest of the browser session (still hidden after a reload), and no alert is stored", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw); const now = Date.now(), V = NV(now), B = "B0NUDGENO2"; await seed(sw, { items: { ...seedItem(V.Wait.id, V.Wait.hist), ...seedItem(B, V.Wait.hist) } });
  const { p, panel } = await openV(ctx, V.Wait); await panel.open(); t.check(!!(await nudgeOf(panel)), "nudge is there");
  await panel.click(".nudge .btn.ghost"); await sleep(400); t.check(!(await nudgeOf(panel)), "Not now removes it"); t.check((await sessNudge(sw))[key(V.Wait.id)]?.d === 1, "dismissal kept in the browser session store");
  t.check(Object.values((await store(sw, "items")).items).every(i => i.target === undefined), "dismissing stores no alert");
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open(); await sleep(500); t.check(!(await nudgeOf(panel)) && /Wait/.test(await panel.text(".vcard .vw")), "after a reload: still hidden, verdict still there"); await p.close();
  const r = await openV(ctx, { ...V.Wait, id: B }); await r.panel.open(); t.check(!(await nudgeOf(r.panel)) && /Wait/.test(await r.panel.text(".vcard .vw")), "dismiss on product A hides it on product B in the same session, verdict still there");
}));
test("74", "lookup limit: a signed-out visitor is never limited and nothing is counted, even with usage at 55; no counter is shown", t => withExt({}, async ({ ctx, sw }) => {
  const keys = Array.from({ length: 55 }, (_, i) => `amazon.in:FILLER${String(i).padStart(5, "0")}`); await seed(sw, { usage: { month: monthKey(), keys } });
  const r = await product(ctx, { id: "B0NEWPROD2", price: 700, mrp: null }); await r.panel.open();
  t.check(await r.panel.has(".hero .price") && !(await r.panel.has(".limitcard")) && !(await r.panel.has(".quota")), "price shown, no limit card, no counter");
  t.check(!/free lookups|Pass this time/i.test(await r.panel.ev(function () { return this.querySelector("main").textContent; })), "no limit wording anywhere");
  t.check((await store(sw, "usage")).usage.keys.length === 55, "nothing counted for a signed-out visitor");
}));
test("75", "lookup limit, signed in at 50: calm card; Pass this time reveals the product for the rest of the day (survives a reload, not counted); tomorrow the card returns; no teaser, no purchase wording", t => withExt({}, async ({ ctx, sw }) => {
  await signIn(ctx, sw); const keys = Array.from({ length: 50 }, (_, i) => `amazon.in:FILLER${String(i).padStart(5, "0")}`); await seed(sw, { usage: { month: monthKey(), keys } });
  const { p, panel } = await product(ctx, { id: "B0NEWPROD3", price: 700, mrp: null }); await panel.open();
  t.check(await panel.has(".limitcard") && !(await panel.has(".hero .price")), "limit card, product hidden until the person chooses");
  const lc = await panel.text(".limitcard"); t.check(!/About Pro|upgrade|subscribe|purchase|buy|\bpay\b|[₹$]|per month|\/mo|price|offer|discount|plan/i.test(lc) && (await panel.ev(function () { return this.querySelectorAll(".limitcard button").length === 1 && this.querySelector(".limitcard").getAttribute("role") === "group"; })), "limit card: one button, a labelled group, no teaser or purchase wording: " + lc.trim());
  await panel.click(".limitcard .btn"); t.check(!!(await panel.waitFor(".hero .price", 8000)), "Pass this time shows the product"); await sleep(400);
  t.check(await panel.ev(function () { const a = this.activeElement; return !!a && !!a.closest(".buynow"); }), "after Pass this time focus lands on the verdict card, not on <body>");
  const lp = (await store(sw, "lookupPass")).lookupPass; t.check(lp && lp.uid === SESSION.user.id, "the pass is remembered for this account: " + JSON.stringify(lp));
  t.check((await store(sw, "usage")).usage.keys.length === 50, "a passed lookup is not counted");
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open(); await sleep(600); t.check(await panel.has(".hero .price") && !(await panel.has(".limitcard")), "same day, after a reload: no card");
  await seed(sw, { lookupPass: { uid: SESSION.user.id, day: "2000-01-01" } }); await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open(); await sleep(600);
  t.check(await panel.has(".limitcard") && !(await panel.has(".hero .price")), "next day (stored day changed): the card is back");
  await seed(sw, { lookupPass: { uid: "someone-else", day: dayKeyNow() } }); await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open(); await sleep(600); t.check(await panel.has(".limitcard"), "another account's pass does not count");
}));
test("76", "verdict nudge and limit card on a phone (390x844): 44px targets, no sideways scroll", t => withExt({ viewport: { width: 390, height: 844 } }, async ({ ctx, sw }) => {
  await signIn(ctx, sw); const now = Date.now(), V = NV(now); await seed(sw, { items: seedItem(V.Wait.id, V.Wait.hist) });
  let r = await openV(ctx, V.Wait); await r.panel.open(); await sleep(500);
  const m = await r.panel.ev(function () { const h = s => [...this.querySelectorAll(s)].map(e => Math.round(e.getBoundingClientRect().height)), m = this.querySelector("main"); return { btn: h(".nudge .btn, .nudge .link-btn"), over: m.scrollWidth > m.clientWidth + 1 }; });
  t.check(m.btn.length === 2 && m.btn.every(x => x >= 44) && m.btn[0] === m.btn[1] && !m.over, "nudge buttons >= 44px and panel does not scroll sideways: " + JSON.stringify(m)); await r.p.close();
  await seed(sw, { usage: { month: monthKey(), keys: Array.from({ length: 50 }, (_, i) => "amazon.in:FILLER" + String(i).padStart(5, "0")) } });
  r = await product(ctx, { id: "B0NEWPROD4", price: 700, mrp: null }); await r.panel.open(); await sleep(500);
  const l = await r.panel.ev(function () { const c = this.querySelector(".limitcard"), m = this.querySelector("main"); return c ? { btn: [...c.querySelectorAll("button")].map(e => Math.round(e.getBoundingClientRect().height)), over: m.scrollWidth > m.clientWidth + 1 } : null; });
  t.check(l && l.btn.length === 1 && l.btn.every(x => x >= 44) && !l.over, "limit card buttons >= 44px, no sideways scroll: " + JSON.stringify(l));
}));
const dayKeyNow = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

// ---------------------------------------------------------------- runner
const results = [], sel = tests.filter(x => !ONLY.length || ONLY.some(o => x.id === o || x.id.startsWith(o + ":") || (o === "live" && x.live)));
console.log(`HAULS e2e | chrome: ${CHROME}\n  ${existsSync(CHROME) ? "" : "!! CHROME NOT FOUND (set CHROME=...)"}`);
for (const x of sel) {
  let rec;
  let flake = 0; // browser killed from outside (e.g. another run pkill-ing Chrome) is infrastructure, not a product failure: retry up to 2x
  for (let a = 0; a <= (x.retries ?? 0) + flake; a++) {
    const t = mkT(), t0 = Date.now(); rec = { id: x.id, name: x.name, status: "PASS", ms: 0, failures: t.fails, notes: t.notes, attempts: a + 1 };
    try { await Promise.race([x.fn(t), new Promise((_, rj) => setTimeout(() => rj(new Error("timeout 150s")), 150000))]); if (t.fails.length) rec.status = "FAIL"; }
    catch (e) { if (e instanceof Skip) { rec.status = "SKIP"; rec.reason = e.message; } else { rec.status = "FAIL"; t.fails.push("exception: " + (e.stack || e.message).split("\n").slice(0, 3).join(" ")); } }
    rec.ms = Date.now() - t0; if (rec.status === "FAIL" && flake < 2 && t.fails.some(f => /has been closed|Target closed/.test(f))) { flake++; continue; } if (rec.status !== "FAIL") break;
  }
  results.push(rec); console.log(`${rec.status.padEnd(4)} ${x.id.padEnd(18)} ${x.name} (${(rec.ms / 1000).toFixed(1)}s${rec.attempts > 1 ? ", retried" : ""})`);
  rec.failures.forEach(f => console.log("       - " + f)); if (rec.reason) console.log("       ~ " + rec.reason);
}
const n = s => results.filter(r => r.status === s).length;
console.log("\n" + "ID".padEnd(18) + "RESULT  TEST"); results.forEach(r => console.log(r.id.padEnd(18) + r.status.padEnd(8) + r.name));
console.log(`\nPASS ${n("PASS")}  FAIL ${n("FAIL")}  SKIP ${n("SKIP")}`);
writeFileSync(path.join(ROOT, "tests/e2e/report.json"), JSON.stringify({ at: new Date().toISOString(), summary: { pass: n("PASS"), fail: n("FAIL"), skip: n("SKIP") }, results }, null, 2));
process.exit(n("FAIL") ? 1 : 0);
