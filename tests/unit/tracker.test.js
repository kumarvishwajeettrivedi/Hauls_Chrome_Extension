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
  // recently viewed products are polled too (top 12, last 30 days)
  mem.items = {}; mem.trk = {}; for (let i = 0; i < 15; i++) mem.items["amazon.in:B0RECENT0" + String.fromCharCode(65 + i)] = { site: "Amazon", url: "https://www.amazon.in/dp/B0RECENT0" + String.fromCharCode(65 + i), hist: [[t0, 766]], seenAt: t0 - i * 3600e3 };
  mem.items["amazon.in:B0OLDSEEN1"] = { site: "Amazon", url: "https://www.amazon.in/dp/B0OLDSEEN1", hist: [[t0, 766]], seenAt: t0 - 40 * D };
  { const asked = new Set(); for (let r = 0; r < 4; r++) { await ctx.trkRun(t0 + 5e6 + r * 1e3, async u => { asked.add(u.match(/asin=([A-Z0-9]{10})/)[1]); return { ok: true, status: 200, url: u, headers: { get: () => "0" }, text: async () => AOD.replace(/B0F8BVSK21/g, u.match(/asin=([A-Z0-9]{10})/)[1]) }; }); }
    ok(asked.size === 12 && [...asked].every(a => /^B0RECENT0[A-L]$/.test(a)), "only the 12 most recently viewed are polled, not older ones or a 40-day-old view: " + [...asked].join(",")); }
  mem.items = { "amazon.in:B0RECENT0Z": { site: "Amazon", url: "https://www.amazon.in/dp/B0RECENT0Z", hist: [[t0, 766]], seenAt: t0 - 3600e3 }, "amazon.in:B0OLDSEEN2": { site: "Amazon", url: "https://www.amazon.in/dp/B0OLDSEEN2", hist: [[t0, 766]], seenAt: t0 - 40 * D } }; mem.trk = {};
  { const asked = new Set(); await ctx.trkRun(t0 + 8e6, async u => { asked.add(u.match(/asin=([A-Z0-9]{10})/)[1]); return { ok: true, status: 200, url: u, headers: { get: () => "0" }, text: async () => AOD.replace(/B0F8BVSK21/g, u.match(/asin=([A-Z0-9]{10})/)[1]) }; }); ok(asked.has("B0RECENT0Z") && !asked.has("B0OLDSEEN2"), "a product last viewed 40 days ago is not polled: " + [...asked]); }
  // ---- review round: per-item backoff, hold expiry, lease, first read, visit-path hold, cap scaling, apply errors
  const body = u => AOD.replace(/B0F8BVSK21/g, u.match(/asin=([A-Z0-9]{10})/)[1]);
  mem.items = { "amazon.in:B0GOODITM1": { site: "Amazon", url: "https://www.amazon.in/dp/B0GOODITM1", hist: [[t0, 766]], wish: true }, "amazon.in:B0BADITEM1": { site: "Amazon", url: "https://www.amazon.in/dp/B0BADITEM1", hist: [[t0, 766]], wish: true } }; mem.trk = {};
  const picky = u => /B0BADITEM1/.test(u) ? "<html>nothing here</html>" : body(u);
  let T0 = t0 + 2e6; out = await ctx.trkRun(T0, mkFetch(picky)); ok(out.checked === 2 && out.failed === 1 && !(mem.trk.pause || {})["amazon.in"], "one bad item does not pause the store: " + JSON.stringify(out));
  ok(mem.items["amazon.in:B0BADITEM1"].failN === 1, "the bad item backs off by itself");
  fetched = []; await ctx.trkRun(T0 + 7 * 3600e3, mkFetch(picky)); ok(fetched.length === 2 && mem.items["amazon.in:B0BADITEM1"].failN === 2, "after 6h both are due again (backoff 6h for the first failure)");
  fetched = []; await ctx.trkRun(T0 + 8 * 3600e3, mkFetch(picky)); ok(!fetched.some(u => /BADITEM1/.test(u)), "second failure waits 12h: not retried after 1h");
  // no-offer page is neutral, not a failure
  mem.items = { [AK]: { site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", hist: [[t0, 766]], wish: true } }; mem.trk = {};
  out = await ctx.trkRun(T0 + 3e7, mkFetch(u => '<div data-asin="B0F8BVSK21">no offer box</div>')); ok(out.failed === 0 && mem.items[AK].checked === T0 + 3e7 && !mem.items[AK].failN, "no-offer is neutral and the item is stamped");
  // hold expiry: a stale suspect from days ago cannot be confirmed by a later read
  mem.items[AK] = { site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", hist: [[t0, 800]], wish: true, suspect: { price: 100, at: T0 - 5 * 3600e3 }, checked: 0 }; mem.trk = {};
  out = await ctx.trkRun(T0, mkFetch(() => aod(100))); ok(out.held === 1 && mem.items[AK].hist.length === 1 && mem.items[AK].suspect.at === T0, "stale hold is replaced, not confirmed");
  // first-ever reading below the target is confirmed before alerting
  mem.items[AK] = { site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", hist: [], wish: true, target: 700, checked: 0 }; mem.trk = {}; notes.length = 0;
  out = await ctx.trkRun(T0, mkFetch(() => aod(650))); ok(out.held === 1 && notes.length === 0, "first read below target is held");
  // lease: a second run while one is in progress does nothing
  mem.items[AK].checked = 0; mem.trk = {}; mem.trkLease = Date.now(); const busy = await ctx.trkRun(Date.now() + 1000, mkFetch(() => aod(650))); ok(busy.busy === true && busy.checked === 0, "overlapping run is refused");
  delete mem.trkLease;
  // apply errors are counted, never reported as ok
  mem.items[AK] = { site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", hist: [[t0, 766]], wish: true, checked: 0 }; mem.trk = {};
  const origSet = chrome.storage.local.set; let calls2 = 0; chrome.storage.local.set = async o => { if (o.items && ++calls2 >= 1) throw new Error("quota"); return origSet(o); };
  out = await ctx.trkRun(T0 + 9e7, mkFetch(() => aod(900))); chrome.storage.local.set = origSet; ok(mem.trk.health["amazon.in"].errors === 1 && mem.trk.health["amazon.in"].ok === 0, "write failure counted as apply error, not ok: " + JSON.stringify(mem.trk.health["amazon.in"]));
  // daily cap scales with the number of watched items (no silent starvation)
  mem.items = {}; for (let i = 0; i < 12; i++) mem.items["amazon.in:B0CAPITM0" + String(i).padStart(1, "0") + "X"] = { site: "Amazon", url: "https://www.amazon.in/dp/B0CAPITM0" + i + "X", hist: [[t0, 766]], wish: true };
  mem.trk = { day: new Date(T0 + 1e8).toISOString().slice(0, 10), counts: { "amazon.in": 60 } }; out = await ctx.trkRun(T0 + 1e8, mkFetch(body)); ok(out.checked > 0, "12 watched items raise the daily cap above the flat 60 (cap 72): " + JSON.stringify(out));
  // visit-path hold in record(): a 4x jump from a page read needs a second read
  mem.items = { [AK]: { site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", hist: [[t0, 766]] } };
  const visit = price => ctx.record({ key: AK, site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", price, src: "dom" });
  await visit(9000); ok(mem.items[AK].hist.length === 1 && mem.items[AK].vhold && mem.items[AK].vhold.price === 9000, "a 12x page price (EMI/bundle artefact) is held, not recorded");
  await visit(9000); ok(mem.items[AK].hist.length === 2 && !mem.items[AK].vhold, "the same price on a second visit is accepted");
  await visit(2531); ok(mem.items[AK].hist.length === 3 && !mem.items[AK].vhold, "a drop to 28% of the last price is a normal move below the 4x guard"); 
  vm.runInContext('getSession = async () => null', ctx);
  // a page visit with MRP null clears MRP deliberately; undefined (a poll that did not read it) keeps it
  mem.items = { [AK]: { site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", title: "Earbuds", mrp: 3990, hist: [[Date.now() - D, 766]] } };
  await ctx.record({ key: AK, price: 766, src: "bg" }); ok(mem.items[AK].mrp === 3990 && mem.items[AK].url && mem.items[AK].site === "Amazon", "bg record without mrp/url keeps stored values");
  await ctx.record({ key: AK, site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", title: "Earbuds", price: 770, mrp: null, src: "dom" }); ok(mem.items[AK].mrp === null, "a page that shows no MRP clears it");
  console.log(`tracker: ${n} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
