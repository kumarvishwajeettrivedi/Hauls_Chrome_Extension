// Background behaviour with a stateful fake chrome: record() keeps MRP, alerts fire once and re-arm, unknown alarms do nothing.
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const A = require("../../extension/analysis.js");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
// ---- pure alert rule
const D = 864e5;
const it0 = { target: 500, hist: [[1, 600]], armed: true };
ok(!A.alertDecision(it0, 600).fire, "above target: no alert");
ok(A.alertDecision(it0, 480).fire && A.alertDecision(it0, 480).patch.notified === 480, "drops to target: alert");
ok(!A.alertDecision({ ...it0, notified: 480 }, 480).fire, "same price again: no repeat");
ok(A.alertDecision({ ...it0, notified: 480 }, 450).fire, "drops further: alert again");
ok(A.alertDecision({ ...it0, notified: 480 }, 700).patch.notified === null, "price rises above target: re-arms");
ok(!A.alertDecision({ target: 500, armed: false }, 450).fire, "target set at/above current price: never alerts instantly");
ok(A.alertDecision({ target: 500, armed: false }, 700).patch.armed === true, "armed again after the price rises");
ok(A.alertDecision({ target: 500 }, 450).fire, "old items without armed still alert");
ok(!A.alertDecision({}, 450).fire && !A.alertDecision(null, 450).fire && !A.alertDecision({ target: 500 }, 0).fire, "no target / bad price: nothing");

// ---- background with fake chrome
const mem = {}; const notes = []; let onAlarm = null; const alarms = [];
const chrome = { storage: { local: { async get(k) { if (k == null) return JSON.parse(JSON.stringify(mem)); const ks = Array.isArray(k) ? k : typeof k === "string" ? [k] : Object.keys(k); const o = {}; for (const x of ks) if (mem[x] !== undefined) o[x] = JSON.parse(JSON.stringify(mem[x])); return o; },
    async set(o) { Object.assign(mem, JSON.parse(JSON.stringify(o))); }, async remove(k) { [].concat(k).forEach(x => delete mem[x]); } }, onChanged: { addListener() {} } },
  runtime: { id: "x", onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, sendMessage() {}, getURL: p => p }, alarms: { create: (n2, o) => alarms.push(n2), clear: async () => true, get: async () => undefined, onAlarm: { addListener: f => { onAlarm = f; } } },
  notifications: { create: (id, o) => notes.push({ id, ...o }) }, action: { onClicked: { addListener() {} } }, tabs: { sendMessage() {}, create() {} }, scripting: { getRegisteredContentScripts: async () => [] }, permissions: { contains: async () => false, onRemoved: { addListener() {} } }, identity: {}, windows: {}, declarativeNetRequest: {} };
let fetched = []; const sandbox = { console, URL, URLSearchParams, TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, setTimeout, clearTimeout, AbortController, AbortSignal, setInterval, clearInterval, Date, JSON, Math, Promise, chrome, navigator: {}, self: {},
  fetch: async u => { fetched.push(u); return { ok: true, headers: { get: () => "0" }, text: async () => '<script type="application/ld+json">{"@type":"Product","name":"Thing","offers":{"price":"450","priceCurrency":"INR"}}</script>' }; } };
const ctx = vm.createContext(sandbox); sandbox.importScripts = (...fs2) => { for (const f of fs2) vm.runInContext(fs.readFileSync(path.join(__dirname, "../../extension", f === "config.js" && !fs.existsSync(path.join(__dirname, "../../extension/config.js")) ? "config.example.js" : f), "utf8"), ctx, { filename: f }); };
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../extension/background.js"), "utf8"), ctx, { filename: "background.js" });
sandbox.__enq = []; vm.runInContext("getSession = async () => null; enqueue = o => __enq.push(o); flush = async () => {};", ctx);
(async () => {
  await vm.runInContext("ready", ctx); // startup migrations must finish before the test seeds storage
  ok(typeof onAlarm === "function", "alarm listener registered");
  const key = "amazon.in:B0TESTTEST1";
  mem.items = { [key]: { site: "Amazon", title: "Thing", url: "https://www.amazon.in/dp/B0TESTTEST1", mrp: 999, hist: [[Date.now() - 3 * D, 700]], target: 500, armed: true } };
  fetched = []; await onAlarm({ name: "something-else" }); ok(fetched.length === 0, "unknown alarm name does not scan");
  ok(!alarms.includes("recheck"), "legacy recheck alarm is not recreated");
  // ---- scheduler
  const AOD = fs.readFileSync(path.join(__dirname, "../fixtures/offers/aod-single.html"), "utf8"), aod = price => AOD.replace(/₹766\.0+/g, "₹" + price + ".00");
  const mkFetch = priceFn => async u => { fetched.push(u); const body = priceFn(u); if (body === 503) return { ok: false, status: 503, url: u, headers: { get: () => "0" }, text: async () => "" }; return { ok: true, status: 200, url: u, headers: { get: () => "0" }, text: async () => body }; };
  const AK = "amazon.in:B0F8BVSK21", t0 = Date.now(); notes.length = 0; sandbox.__enq.length = 0; fetched = [];
  mem.items = { [AK]: { site: "Amazon", title: "Earbuds", url: "https://www.amazon.in/dp/B0F8BVSK21", mrp: 3990, hist: [[t0 - 10 * D, 766]], wish: true, target: 700, armed: true }, "amazon.in:B0NOTWATCH1": { site: "Amazon", url: "https://www.amazon.in/dp/B0NOTWATCH1", hist: [[t0 - D, 5]] } };
  vm.runInContext('getSession = async () => ({ user: 1 })', ctx); mem.profile = { contribute: true }; // signed in + sharing on: bg reads must still not be uploaded
  let out = await ctx.trkRun(t0, mkFetch(() => aod(766)));
  ok(out.checked === 1 && out.recorded === 0 && mem.items[AK].hist.length === 1 && mem.items[AK].checked === t0, "unchanged price: no new point, checked stamped: " + JSON.stringify(out));
  ok(fetched.length === 1 && !fetched.some(u => /NOTWATCH/.test(u)), "only watched items are polled");
  out = await ctx.trkRun(t0 + 60e3, mkFetch(() => aod(766))); ok(out.checked === 0, "not due again for 6h");
  out = await ctx.trkRun(t0 + 7 * 3600e3, mkFetch(() => aod(800))); ok(out.recorded === 1 && mem.items[AK].hist.at(-1)[1] === 800 && mem.items[AK].hist.length === 2, "real change recorded");
  ok(!sandbox.__enq.some(o => o.t === "obs"), "background reads are not uploaded as community observations"); await ctx.record({ key: AK, site: "Amazon", url: mem.items[AK].url, price: 801, src: "dom" }); ok(sandbox.__enq.some(o => o.t === "obs" && o.price === 801), "control: a page visit IS uploaded");
  ok(mem.items[AK].mrp === 3990, "mrp kept");
  let t = t0 + 14 * 3600e3; out = await ctx.trkRun(t, mkFetch(() => aod(100)));
  ok(out.held === 1 && mem.items[AK].hist.at(-1)[1] === 801 && mem.items[AK].suspect, "an 87% fall is held, not recorded");
  t += 25 * 60e3; out = await ctx.trkRun(t, mkFetch(() => aod(100))); ok(out.recorded === 1 && mem.items[AK].hist.at(-1)[1] === 100 && !mem.items[AK].suspect, "second matching read confirms it");
  // alert crossing: reset to 800 then 650 (target 700)
  mem.items[AK].hist = [[t - 20 * D, 800]]; mem.items[AK].checked = 0; mem.items[AK].armed = true; mem.items[AK].notified = null; delete mem.items[AK].suspect; notes.length = 0;
  t += 7 * 3600e3; out = await ctx.trkRun(t, mkFetch(() => aod(650))); ok(out.held === 1 && notes.length === 0, "crossing the target needs a second read before it records or alerts");
  t += 25 * 60e3; out = await ctx.trkRun(t, mkFetch(() => aod(650))); ok(out.recorded === 1 && notes.length === 1 && /650/.test(notes[0].message), "confirmed: recorded and alerted once");
  // captcha body never becomes a price
  mem.items[AK].checked = 0; const before = mem.items[AK].hist.length; out = await ctx.trkRun(t + 1e3, mkFetch(() => "<html>Enter the characters you see below</html>")); ok(out.failed === 1 && mem.items[AK].hist.length === before, "captcha: failure counted, no point");
  ok(mem.trk.health["amazon.in"].reasons.captcha === 1, "health records the reason");
  // backoff after 3 failures, per domain
  for (let i = 0; i < 2; i++) { mem.items[AK].checked = 0; await ctx.trkRun(t + (i + 2) * 1e3, mkFetch(() => 503)); }
  ok(mem.trk.pause["amazon.in"] > t, "three failures pause the domain"); mem.items[AK].checked = 0; fetched = []; out = await ctx.trkRun(t + 10e3, mkFetch(() => aod(650))); ok(fetched.length === 0 && out.skipped === 1, "paused domain is not hit");
  ok((await ctx.trkRun(t + 7 * 3600e3 + 1, mkFetch(() => aod(650)))).checked === 1, "pause ends");
  // batch + cursor + daily cap
  mem.items = {}; for (let i = 0; i < 6; i++) mem.items["amazon.in:B0BATCH00" + i] = { site: "Amazon", url: "https://www.amazon.in/dp/B0BATCH00" + i, hist: [[t0, 766]], wish: true }; mem.trk = {};
  fetched = []; out = await ctx.trkRun(t0 + 1e6, mkFetch(u => AOD.replace(/B0F8BVSK21/g, u.match(/asin=([A-Z0-9]{10})/)[1]))); ok(out.checked === 4, "batch of 4: " + out.checked);
  out = await ctx.trkRun(t0 + 1e6 + 1, mkFetch(u => AOD.replace(/B0F8BVSK21/g, u.match(/asin=([A-Z0-9]{10})/)[1]))); ok(out.checked === 2, "the rest next run, none twice: " + out.checked);
  mem.trk.counts = { "amazon.in": 60 }; mem.trk.day = new Date(t0 + 1e6).toISOString().slice(0, 10); for (const k of Object.keys(mem.items)) mem.items[k].checked = 0; fetched = [];
  out = await ctx.trkRun(t0 + 1e6 + 5, mkFetch(() => aod(766))); ok(fetched.length === 0, "daily per-domain cap holds");
  vm.runInContext('getSession = async () => null', ctx);
  // a page visit with MRP null clears MRP deliberately; undefined (a poll that did not read it) keeps it
  mem.items = { [AK]: { site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", title: "Earbuds", mrp: 3990, hist: [[Date.now() - D, 766]] } };
  await ctx.record({ key: AK, price: 766, src: "bg" }); ok(mem.items[AK].mrp === 3990 && mem.items[AK].url && mem.items[AK].site === "Amazon", "bg record without mrp/url keeps stored values");
  await ctx.record({ key: AK, site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", title: "Earbuds", price: 770, mrp: null, src: "dom" }); ok(mem.items[AK].mrp === null, "a page that shows no MRP clears it");
  console.log(`tracker: ${n} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
