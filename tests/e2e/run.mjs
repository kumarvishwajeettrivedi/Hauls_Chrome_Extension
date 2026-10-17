#!/usr/bin/env node
// HAULS end-to-end regression suite.  Usage: node tests/e2e/run.mjs [--only 4,6,live] [--no-live] [--retries N]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { withExt, seed, seedSession, sessionOf, store, sleep, poll, ROOT, EXT, CHROME } from "./lib/ext.mjs";
import { Panel, openPage } from "./lib/panel.mjs";
import { D, inr, dshort, monthKey, key, seedItem, routeProduct, routeLd, fakeSupabase, SESSION, verdictCases } from "./lib/fixtures.mjs";
import { BLOCK, CASES, pageTruth, pageState } from "./lib/live.mjs";

const argv = process.argv.slice(2), arg = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
const ONLY = (arg("--only") || "").split(",").filter(Boolean), NOLIVE = argv.includes("--no-live"), RETRIES = +(arg("--retries") ?? 1);

class Skip extends Error {}
const mkT = () => ({ fails: [], notes: [],
  check(c, m) { if (!c) this.fails.push(m); return !!c; }, note(m) { this.notes.push(m); },
  skip(r) { throw new Skip(r); } });

const PRODUCT_ID = "B0TESTPRD1";
// Opens a routed synthetic product page with the panel ready.
async function product(ctx, { id = PRODUCT_ID, price = 830, mrp = 1299 } = {}) {
  const url = await routeProduct(ctx, { id, price, mrp });
  const r = await openPage(ctx, url); if (!r.panel || !(await r.panel.has(".knob"))) throw new Error("knob did not appear");
  return { ...r, url };
}
const lum = c => { const m = c.match(/[\d.]+/g).map(Number), f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const HIST = now => [[now - 70 * D, 1299], [now - 55 * D, 1199], [now - 40 * D, 799], [now - 25 * D, 899], [now - 12 * D, 849], [now - 36e5, 830]];

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
    t.check(word === c.want, `${c.id}: verdict "${word}" expected "${c.want}"`);
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
  await poll(async () => (await panel.count("main .res")) > 0 || /No matches|not found|deliver/i.test(await panel.text("main").catch(() => "")), 40000, 500);
  await sleep(500);
}
test("6", "grocery: real typing, Enter, results, cheapest-first, own-site links", t => withExt({}, async ({ ctx }) => {
  const { panel } = await product(ctx); await grocerySearch(panel, t);
  const rows = await panel.ev(function () { return [...this.querySelectorAll("main .res")].map(a => ({ cls: a.className, store: (a.querySelector(".sc") || {}).title, small: (a.querySelector(".rn small") || {}).textContent || "", per: (a.querySelector(".rp2 small") || {}).textContent || "", price: a.querySelector(".rp2 b").textContent, name: a.querySelector(".rn span").textContent })); });
  const stores = [...new Set(rows.map(r => r.store))].filter(s => ["Blinkit", "DMart", "JioMart"].includes(s));
  t.note("stores in results: " + stores.join(",") + " (" + rows.length + " rows)");
  const errLines = await panel.ev(function () { return [...this.querySelectorAll("main .meta")].map(e => e.textContent); }); if (errLines.length) t.note("store errors: " + errLines.join(" ; "));
  if (!rows.length) { if (errLines.some(e => /HTTP 4|HTTP 5|Failed to fetch/.test(e))) t.skip("all stores errored (network/blocked): " + errLines.join(";")); t.check(false, "no grocery results"); }
  t.check(stores.length >= 2, `results from >=2 of Blinkit/DMart/JioMart (got ${stores.join(",") || "none"}); store errors: ${errLines.join(" ; ")}`);
  const pers = rows.filter(r => !/sold out/.test(r.small) && r.per).map(r => parseFloat(r.per.replace(/[^\d.]/g, "")));
  if (pers.length) t.check(rows[0].per && parseFloat(rows[0].per.replace(/[^\d.]/g, "")) <= Math.min(...pers) + 1e-9, `first row per-100 (${rows[0].per}) is the cheapest in-stock (min ₹${Math.min(...pers)}); rows: ` + rows.map(r => `${r.store}:${r.per || r.price}`).join(" "));
  t.check(rows[0].cls.includes("best"), "first row flagged Cheapest");
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
  t.note(`${pick.h.slice(0, 70)} | price=${price} mrp=${it.mrp} pagePrice=${tr.price} struck=${JSON.stringify(tr.struck)} | ${(it.title || "").slice(0, 50)}`);
  t.check(typeof price === "number" && price > 0, "price is a positive number");
  if (tr.price) t.check(Math.abs(tr.price - price) < 1.5, `price ${price} equals visible main price ${tr.price}`); else t.note("could not read visible price independently");
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
  const now = Date.now(), keys = Array.from({ length: 49 }, (_, i) => `amazon.in:FILLER${String(i).padStart(5, "0")}`).concat(key("B0SEENPRD1"));
  await seed(sw, { usage: { month: monthKey(), keys }, items: seedItem("B0SEENPRD1", [[now - 20 * D, 900], [now - 36e5, 900]]) });
  let r = await product(ctx, { id: "B0SEENPRD1", price: 900 }); await r.panel.open();
  t.check(await r.panel.has(".hero .price"), "already-counted product still works at 50/50");
  await r.p.close();
  const url = await routeProduct(ctx, { id: "B0NEWPROD1", price: 700, mrp: null }); r = await openPage(ctx, url); await r.panel.open();
  const txt = await r.panel.text(".vcard"), q = await r.panel.text(".quota .num");
  t.check(/All 50 free lookups used this month/.test(txt), `limited message: "${txt.trim()}"`); t.check(/50\/50 lookups/.test(q), "quota row 50/50: " + q);
  t.check(!(await r.panel.has(".hero .price")), "no price hero when limited");
  t.check((await store(sw, "usage")).usage.keys.length === 50, "no 51st lookup recorded");
  await r.p.close();
  // wishlist cap
  const items = {}; for (let i = 0; i < 20; i++) items[`x:${i}`] = { site: "Amazon", title: "w" + i, url: "https://www.amazon.in/x" + i, wish: true, hist: [[now, 100]] };
  await seed(sw, { usage: { month: monthKey(), keys: [] }, items });
  const k = key("B0CAPPROD1"); r = await product(ctx, { id: "B0CAPPROD1", price: 700, mrp: null }); await r.panel.open();
  await r.panel.click(".heart"); await sleep(800);
  t.check(!(await r.panel.has(".heart.on")), "21st heart rejected (not on)");
  t.check((await r.panel.run(".heart", function () { return this.title; })) === "Limit reached", "heart shows 'Limit reached'");
  const wished = Object.values((await store(sw, "items")).items).filter(i => i.wish).length; t.check(wished === 20, "still exactly 20 wished items: " + wished);
  await r.panel.click(".trapbox .btn"); await sleep(600);
  t.check(await r.panel.text(".trapbox .stp-msg") === "Watchlist limit reached on your plan", "trap Set also hits the cap: " + (await r.panel.text(".trapbox .stp-msg")));
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
const MSG0 = "Enter a price above ₹0", MSGHI = "Trap must be below the current price";

// ---------------------------------------------------------------- 12 trap editor
test("12", "trap editor: step size, hold-to-repeat, typed persist, invalid rejected", t => withExt({}, async ({ ctx, sw }) => {
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
  t.check(/Trap set at ₹700/.test(await panel.text(".trapbox .lbl")), "label: " + await panel.text(".trapbox .lbl"));
  // existing trap autosaves (600 ms debounce)
  await panel.type(".trapbox .stp-in input", "650"); await sleep(250);
  t.check((await targetOf(sw, k)) === 700, "not saved before the 600ms debounce");
  t.check(!!(await poll(async () => (await targetOf(sw, k)) === 650, 3000)), "typed 650 autosaved");
  t.check(!!(await poll(async () => await panel.run(".trapbox .stp-tick", function () { return this.classList.contains("on"); }), 1500, 50)), "'Saved' tick shown");
  t.check(/Saved/.test(await panel.text(".trapbox .stp-tick")), "tick text says Saved");
  await panel.press(".trapbox .stp-b", 1); t.check(!!(await poll(async () => (await targetOf(sw, k)) === 660, 3000)), "plus autosaves 650 -> 660");
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open();
  t.check((await panel.val(".trapbox .stp-in input")) === "660", "persisted after reload: " + await panel.val(".trapbox .stp-in input"));
  t.check(/Trap set at ₹660/.test(await panel.text(".trapbox .lbl")), "label after reload: " + await panel.text(".trapbox .lbl"));
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
  const now = Date.now(), h = [[now - 5 * D, 1000], [now - 36e5, 1000]], A = key("B0WISHONL1"), B = key("B0TRAPPED1");
  await seed(sw, { items: { [A]: { site: "Amazon", title: "Wish Only Thing", url: "https://www.amazon.in/dp/B0WISHONL1", hist: h, wish: true }, [B]: { site: "Amazon", title: "Trapped Thing", url: "https://www.amazon.in/dp/B0TRAPPED1", hist: h, target: 800 } } });
  const { p, panel } = await product(ctx, { id: "B0WLPAGE01", price: 830 }); await panel.open(); await panel.tab(2);
  t.check((await panel.count(".wrow")) === 2, ".wrow cards: " + await panel.count(".wrow"));
  const rows = () => panel.ev(function () { return [...this.querySelectorAll(".wrow")].map(r => ({ title: r.querySelector("a").textContent, stp: !!r.querySelector(".stp"), set: [...r.querySelectorAll(".btn")].map(b => b.textContent.trim()) })); });
  let rs = await rows(), bi = rs.findIndex(r => r.title === "Trapped Thing"), ai = rs.findIndex(r => r.title === "Wish Only Thing");
  t.check(bi === 0, "trapped row sorts first: " + JSON.stringify(rs.map(r => r.title)));
  t.check(rs[bi].stp && rs[ai].set.includes("Set a trap") && !rs[ai].stp, "trapped row has stepper; wish-only row has 'Set a trap' and no stepper");
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

// ---------------------------------------------------------------- 14 range selector
test("14", "range selector: 30D/90D/1Y/All changes label, x-axis, y labels, chips; persists", t => withExt({}, async ({ ctx, sw }) => {
  const now = Date.now(), H = [[now - 380 * D, 1500], [now - 200 * D, 1300], [now - 60 * D, 1100], [now - 20 * D, 900], [now - 36e5, 830]];
  await seed(sw, { items: seedItem(PRODUCT_ID, H) });
  const { p, panel } = await product(ctx, { price: 830 }); await panel.open();
  const btns = await panel.ev(function () { return [...this.querySelectorAll(".seg button")].map(b => ({ t: b.textContent, r: b.dataset.r, on: b.getAttribute("aria-pressed") })); });
  t.check(btns.map(b => b.r).join() === "30D,90D,1Y,All" && btns.map(b => b.t).join() === "30D,90D,1Y,All", "four buttons with data-r: " + JSON.stringify(btns));
  t.check(btns.filter(b => b.on === "true").map(b => b.r).join() === "90D", "default 90D pressed (only)");
  const read = () => panel.ev(function () { return { lbl: this.querySelector(".chartbox .lbl").textContent, x0: this.querySelector(".xl span").textContent, yt: (this.querySelector(".yl.t") || {}).textContent, yb: (this.querySelector(".yl.b") || {}).textContent,
    chips: [...this.querySelectorAll(".chip3 b")].map(b => b.textContent), pressed: [...this.querySelectorAll(".seg button[aria-pressed=true]")].map(b => b.dataset.r) }; });
  const seen = {};
  // hi = chart top label (includes the price in force at window start); chi = High chip (observed inside the window only).
  for (const [r, days, hi, chi] of [["30D", 30, "₹1,100", "₹900"], ["90D", 90, "₹1,300", "₹1,100"], ["1Y", 365, "₹1,500", "₹1,300"], ["All", 0, "₹1,500", "₹1,500"]]) {
    await panel.click(`.seg button[data-r='${r}']`); await sleep(300); const s = seen[r] = await read();
    t.check(s.lbl.startsWith(r + " history"), `${r}: label "${s.lbl}"`);
    t.check(s.pressed.join() === r, `${r}: only ${r} pressed (${s.pressed})`);
    const x0 = days ? dshort(Date.now() - days * D) : dshort(H[0][0]); t.check(s.x0 === x0, `${r}: x-axis starts ${x0} (got ${s.x0})`);
    t.check(s.yt === hi && s.yb === "₹830", `${r}: y labels ${s.yt}/${s.yb} expected ${hi}/₹830`);
    t.check(s.chips.length === 3 && s.chips[0] === "₹830" && s.chips[2] === chi, `${r}: low/avg/high chips ${s.chips} (low ₹830, high ${chi})`);
    if (chi !== hi) t.note(`${r}: High chip ${chi} but chart top label ${hi} (chart carries in the price at window start, chips don't)`);
  }
  t.check(new Set(["30D", "90D", "1Y"].map(r => seen[r].chips.join())).size === 3, "chips differ between 30D, 90D and 1Y");
  await panel.click(".seg button[data-r='30D']"); await sleep(300); t.check((await store(sw, "range")).range === "30D", "selected range stored");
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
  const id = "B0REMOVE01", k = key(id), now = Date.now();
  await seed(sw, { items: seedItem(id, [[now - 10 * D, 900], [now - 36e5, 830]], { target: 700, wish: true }) });
  const { p, panel } = await product(ctx, { id, price: 830, mrp: null }); await panel.open();
  t.check(/Trap set at ₹700/.test(await panel.text(".trapbox .lbl")) && (await panel.val(".trapbox .stp-in input")) === "700", "existing trap shown with stepper prefilled 700");
  t.check(await panel.has(".trapbox .link-btn") && /Remove/.test(await panel.text(".trapbox .link-btn")) && !(await panel.has(".trapbox .btn")), "Remove link present, no Set button");
  await panel.click(".trapbox .link-btn");
  t.check(!!(await poll(async () => (await itemOf(sw, k)) && (await targetOf(sw, k)) === undefined, 3000)), "target removed from storage");
  t.check((await itemOf(sw, k)).wish === true, "item still wished");
  await poll(async () => await panel.has(".trapbox .btn"), 3000);
  t.check(/Set/.test(await panel.text(".trapbox .btn")) && !(await panel.has(".trapbox .link-btn")) && /Set trap price/.test(await panel.text(".trapbox .lbl")), "UI back to 'Set trap price' + Set button");
  t.check(await panel.has(".heart.on"), "heart still on");
  await p.reload({ waitUntil: "domcontentloaded" }); await panel.waitKnob(); await panel.open();
  t.check(!(await panel.has(".trapbox .link-btn")), "stays removed after reload");
  await panel.tab(2); t.check((await panel.count(".wrow")) === 1 && (await panel.count(".wrow .stp")) === 0, "watchlist row now offers 'Set a trap' instead of a stepper");
}));

// ---------------------------------------------------------------- 17 heart
test("17", "heart: on/off persists across reload, aria-pressed, watchlist follows", t => withExt({}, async ({ ctx, sw }) => {
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
  t.check(await p.isVisible("#on") && /Enable independent stores/.test(await p.textContent("#on")), "enable button visible"); t.check(await p.isHidden("#off"), "turn-off hidden while Off");
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
  t.check(await panel.has(".trapbox .link-btn") && /Trap set at ₹700/.test(await panel.text(".trapbox .lbl")), "UI shows the trap as set");
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
