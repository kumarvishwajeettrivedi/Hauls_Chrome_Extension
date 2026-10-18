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

// ---- hysteresis, cooldown, default alert for a heart without a target
{ const run = (target, seq, t0 = 1e12) => { let it = { target, hist: [], armed: true }, fires = 0; seq.forEach((p, i) => { const d = A.alertDecision(it, p, t0 + i * 60e3); if (d.fire) fires++; Object.assign(it, d.patch); }); return fires; };
  ok(run(1000, [990, 1010, 990, 1010, 990, 980, 980]) === 1, "a price flickering around the target alerts once, not on every crossing");
  ok(run(1000, [990, 1031, 990]) === 1, "re-armed (3% above) but inside the 6 h cooldown: no second alert yet");
  const d1 = A.alertDecision({ target: 1000, armed: true, notified: null, notifiedAt: 1e12 }, 990, 1e12 + 7 * 3600e3); ok(d1.fire, "after the cooldown a re-armed alert fires again");
  ok(A.alertDecision({ target: 1000, armed: true, notified: 990, notifiedAt: 1e12 }, 950, 1e12 + 60e3).fire, "a further 3%+ fall fires even inside the cooldown");
  ok(!A.alertDecision({ target: 1000, armed: true, notified: 990, notifiedAt: 1e12 }, 980, 1e12 + 60e3).fire, "a small further fall inside the cooldown does not");
  ok(A.alertDecision({ target: 1000, armed: false, notified: null }, 1029).patch.armed === undefined && A.alertDecision({ target: 1000, armed: false, notified: null }, 1030).patch.armed === true, "re-arms only at 3% above the target");
  const w = { wish: true, wishPrice: 1000, hist: [] }; ok(A.alertDecision(w, 950).target === 900 && !A.alertDecision(w, 950).fire && A.alertDecision(w, 900).fire && A.alertDecision(w, 900).target === 900, "a heart without a target alerts at 10% under the price it was hearted at");
  ok(A.alertDecision({ ...w, target: 700 }, 800).target === 700 && !A.alertDecision({ ...w, wish: false }, 100).fire, "an explicit target wins; no heart and no target: nothing"); }

// ---- background with fake chrome
const mem = {}; const notes = []; let onAlarm = null; const alarms = []; let permLevel = "granted", notifyFail = false, alarmsHave = {};
let onMsg = null, quotaLimit = 0; const memSize = o => Object.entries(o).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
const chrome = { storage: { local: { async getBytesInUse() { return memSize(mem); }, async get(k) { if (k == null) return JSON.parse(JSON.stringify(mem)); const ks = Array.isArray(k) ? k : typeof k === "string" ? [k] : Object.keys(k); const o = {}; for (const x of ks) if (mem[x] !== undefined) o[x] = JSON.parse(JSON.stringify(mem[x])); return o; },
    async set(o) { if (quotaLimit && memSize({ ...mem, ...o }) > quotaLimit) throw new Error("QUOTA_BYTES quota exceeded"); Object.assign(mem, JSON.parse(JSON.stringify(o))); }, async remove(k) { [].concat(k).forEach(x => delete mem[x]); } }, onChanged: { addListener() {} } },
  runtime: { id: "x", onMessage: { addListener: f => { if (/validateMessage/.test(f.toString())) onMsg = f; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, sendMessage() {}, getURL: p => p, openOptionsPage() { (sandbox.__tabs = sandbox.__tabs || []).push("OPTIONS"); } }, alarms: { create: (n2, o) => alarms.push(n2), clear: async () => true, get: async n2 => alarmsHave[n2], onAlarm: { addListener: f => { onAlarm = f; } } },
  notifications: { create: (id, o, cb) => { if (notifyFail) { chrome.runtime.lastError = { message: "x" }; } else notes.push({ id, ...o }); cb && cb(id); chrome.runtime.lastError = undefined; }, getPermissionLevel: cb => cb(permLevel), onClicked: { addListener() {} }, clear() {} }, action: { onClicked: { addListener() {} } }, tabs: { sendMessage() {}, create(o) { (sandbox.__tabs = sandbox.__tabs || []).push(o.url); } }, scripting: { getRegisteredContentScripts: async () => [] }, permissions: { contains: async () => false, onRemoved: { addListener() {} } }, identity: {}, windows: {}, declarativeNetRequest: {} };
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
  mem.session = { access_token: "a", expires_at: 9e15, user: { id: "u" } }; vm.runInContext('getSession = async () => ({ user: 1 })', ctx); mem.profile = { contribute: true }; // signed in + sharing on: bg reads must still not be uploaded
  let out = await ctx.trkRun(t0, mkFetch(() => aod(766)));
  ok(out.checked === 1 && out.recorded === 0 && mem.items[AK].hist.length === 1 && mem.items[AK].checked === t0, "unchanged price: no new point, checked stamped: " + JSON.stringify(out));
  ok(fetched.length === 1 && !fetched.some(u => /NOTWATCH/.test(u)), "only watched items are polled");
  out = await ctx.trkRun(t0 + 60e3, mkFetch(() => aod(766))); ok(out.checked === 0, "not due again for 6h");
  out = await ctx.trkRun(t0 + 7 * 3600e3, mkFetch(() => aod(800))); ok(out.recorded === 1 && mem.items[AK].hist.at(-1)[1] === 800 && mem.items[AK].hist.length === 2, "real change recorded");
  ok(!sandbox.__enq.some(o => o.t === "obs"), "a background read with no recent page visit is not shared");
  { // sharing rules for a background read: new price, close to what the page last showed (14 days, 10%), once a day, not switched off
    const bg = async (id, price, pv, extra = {}) => { const k = "amazon.in:" + id; mem.items[k] = { site: "Amazon", title: "X", url: "https://www.amazon.in/dp/" + id, hist: [[Date.now() - 3 * D, pv ? pv.price : 100]], pv, ...extra }; sandbox.__enq.length = 0; await ctx.record({ key: k, site: "Amazon", price, src: "bg" }); return sandbox.__enq.filter(o => o.t === "obs"); };
    const near = { price: 1000, at: Date.now() - 2 * D };
    const o1 = await bg("B0SHAREAAA", 950, near); ok(o1.length === 1 && o1[0].src === "bg" && o1[0].price === 950 && o1[0].site === "Amazon", "close to the last page price: shared as src bg");
    ok((await bg("B0SHAREBBB", 800, near)).length === 0, "20% away from the page price: not shared");
    ok((await bg("B0SHARECCC", 950, { price: 1000, at: Date.now() - 20 * D })).length === 0, "page visit older than 14 days: not shared");
    ok((await bg("B0SHAREDDD", 950, near, { bgSent: new Date().toISOString().slice(0, 10) })).length === 0, "already shared today: not shared again");
    ok((await bg("B0SHAREEEE", 1000, near)).length === 0, "unchanged price adds no point so nothing to share");
    mem.flags = { disabled_features: ["bg-upload"] }; ok((await bg("B0SHAREFFF", 950, near)).length === 0, "remote switch bg-upload stops sharing"); delete mem.flags;
    mem.profile = { contribute: false }; ok((await bg("B0SHAREGGG", 950, near)).length === 0, "sharing off: nothing leaves"); mem.profile = { contribute: true };
  } await ctx.record({ key: AK, site: "Amazon", url: mem.items[AK].url, price: 801, src: "dom" }); ok(sandbox.__enq.some(o => o.t === "obs" && o.price === 801), "control: a page visit IS uploaded");
  ok(mem.items[AK].mrp === 3990, "mrp kept");
  let t = t0 + 14 * 3600e3; out = await ctx.trkRun(t, mkFetch(() => aod(100)));
  ok(out.held === 1 && mem.items[AK].hist.at(-1)[1] === 801 && mem.items[AK].suspect, "an 87% fall is held, not recorded");
  t += 25 * 60e3; out = await ctx.trkRun(t, mkFetch(() => aod(100))); ok(out.recorded === 1 && mem.items[AK].hist.at(-1)[1] === 100 && !mem.items[AK].suspect, "second matching read confirms it");
  // alert crossing: reset to 800 then 650 (target 700)
  mem.items[AK].hist = [[t - 20 * D, 800]]; mem.items[AK].checked = 0; mem.items[AK].armed = true; mem.items[AK].notified = null; delete mem.items[AK].notifiedAt; delete mem.items[AK].suspect; notes.length = 0;
  t += 7 * 3600e3; out = await ctx.trkRun(t, mkFetch(() => aod(650))); ok(out.held === 1 && notes.length === 0, "crossing the target needs a second read before it records or alerts");
  t += 25 * 60e3; out = await ctx.trkRun(t, mkFetch(() => aod(650))); ok(out.recorded === 1 && notes.length === 1 && /650/.test(notes[0].title), "confirmed: recorded and alerted once");
  // email alert is opt-in, needs a signed-in account, and is sent by the server (no key in the extension)
  { const calls = []; mem.session = { access_token: "a", expires_at: 9e15, user: { id: "u" } }; vm.runInContext("getSession = async () => ({ user: { id: 'u' } }); api = async (p, o) => { __calls.push([p, o.body]); return true; };", Object.assign(ctx, {}));
    sandbox.__calls = calls; const it = { title: "Earbuds", url: "https://www.amazon.in/dp/B0F8BVSK21", target: 700 };
    mem.profile = { email_alerts: false }; await ctx.emailAlert(AK, it, 650); ok(calls.length === 0, "email off: no request");
    mem.profile = { email_alerts: true }; await ctx.emailAlert(AK, it, 650); ok(calls.length === 1 && calls[0][0] === "/rpc/ext_send_price_alert" && calls[0][1].p_price === 650 && calls[0][1].p_target === 700, "email on: one server call with price and target");
    vm.runInContext("getSession = async () => null;", ctx); await ctx.emailAlert(AK, it, 650); ok(calls.length === 1, "signed out: no request"); }
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
  { // Tata CLiQ through the scheduler: the URL is built from the id on the allowlisted host, the price is read from the JSON, a changed price is recorded
    const TCK = "tatacliq.com:mp000000025829896", TCJ = fs.readFileSync(path.join(__dirname, "../fixtures/track/tatacliq-productdetails.json"), "utf8"), tt0 = Date.now(); fetched = []; sandbox.__enq.length = 0;
    mem.items = { [TCK]: { site: "Tata CLiQ", title: "Airdopes", url: "https://www.tatacliq.com/boat-airdopes/p-mp000000025829896", hist: [[tt0 - 10 * D, 1500]], wish: true, target: 1000, armed: true } }; mem.profile = { contribute: true };
    const o = await ctx.trkRun(tt0, mkFetch(() => TCJ)); ok(o.checked === 1 && o.recorded === 1 && mem.items[TCK].hist.at(-1)[1] === 1445 && mem.items[TCK].mrp === 4990, "tata cliq price recorded through the scheduler: " + JSON.stringify(o));
    ok(fetched.length === 1 && fetched[0] === "https://www.tatacliq.com/marketplacewebservices/v2/mpl/products/productDetails/mp000000025829896?isPwa=true&isMDE=true&isDynamicVar=true", "request URL built from the id on the allowlisted host: " + fetched[0]);
    mem.items = { "tatacliq.com:evil;id": { site: "Tata CLiQ", url: "https://evil.example/x", hist: [[tt0 - D, 100]], wish: true }, "tatacliq.com:abc123": { site: "Tata CLiQ", url: "https://www.tatacliq.com/x/p-abc123", hist: [[tt0 - D, 100]], wish: true } }; fetched = []; await ctx.trkRun(tt0 + 7 * 3600e3, mkFetch(() => TCJ)); ok(fetched.length === 0, "an id that is not an mp-code never produces a request");
  }

  // ---- review fixes: hearts, stale tabs, blocked notifications, quota, alarms, sign-in upload, erase
  vm.runInContext("getSession = async () => null;", ctx); mem.profile = {}; delete mem.flags;
  const inCtx = o => vm.runInContext("(" + JSON.stringify(o) + ")", ctx), send = (m, page) => new Promise(r => onMsg(inCtx(m), inCtx(page ? { id: "x", url: "chrome-extension://x/options.html" } : { id: "x", tab: { id: 1 } }), r)), // objects must be built inside the context (the guard checks prototypes)
     HK = "amazon.in:B0HEARTAAA1", hv = { site: "Amazon", title: "Heart", url: "https://www.amazon.in/dp/B0HEARTAAA1" };
  mem.items = { [HK]: { ...hv, hist: [[Date.now() - D, 1000]] } }; sandbox.__enq.length = 0;
  ok((await send({ type: "wish", key: "amazon.in:B0NOPE0000", on: true })).error === "gone" && (await send({ type: "track", key: "amazon.in:B0NOPE0000", target: 5 })).error === "gone", "heart / alert from a stale tab (item gone) answers {error:'gone'} instead of success");
  ok((await send({ type: "wish", key: HK, on: true })) === true && mem.items[HK].wish && mem.items[HK].wishPrice === 1000 && sandbox.__enq.some(o => o.t === "watch" && o.key === HK), "heart remembers the price it was hearted at and queues the sync op");
  notes.length = 0; await ctx.record({ key: HK, ...hv, price: 950, src: "dom" }); ok(notes.length === 0, "a heart without a target does not alert on a small dip");
  await ctx.record({ key: HK, ...hv, price: 890, src: "dom" }); ok(notes.length === 1 && /890/.test(notes[0].title) && /900/.test(notes[0].message) && mem.items[HK].notified === 890, "a heart without a target alerts at a 10% drop from the hearted price");
  { const calls = []; mem.session = { access_token: "a", expires_at: 9e15, user: { id: "u" } }; vm.runInContext("getSession = async () => ({ user: { id: 'u' } }); api = async (p, o) => { __calls.push([p, o.body]); return true; };", ctx); sandbox.__calls = calls; mem.profile = { email_alerts: true };
    mem.items[HK].notified = null; delete mem.items[HK].notifiedAt; await ctx.record({ key: HK, ...hv, price: 880, src: "dom" }); await new Promise(r => setTimeout(r, 20));
    ok(calls.length === 1 && calls[0][1].p_target === 900 && calls[0][1].p_price === 880, "the email carries the default alert price too: " + JSON.stringify(calls[0] && calls[0][1])); calls.length = 0; mem.items[HK].notified = null; delete mem.items[HK].notifiedAt; await ctx.emailAlert(HK, mem.items[HK], 880); ok(calls.length === 1 && calls[0][1].p_target === 900, "emailAlert for a heart-only item sends the default alert price even when the caller passes no target: " + JSON.stringify(calls[0] && calls[0][1]));
    vm.runInContext("getSession = async () => null;", ctx); mem.profile = {}; }
  // erasing actions: a content script cannot trigger them (even with a gesture); it can only ask the settings page to open
  { mem.items = { [HK]: { ...hv, hist: [[Date.now() - D, 1000]] } }; mem.session = { access_token: "a", expires_at: 9e15, user: { id: "u" } };
    for (const m of [{ type: "delete-data", gesture: true }, { type: "signout", clear: true, gesture: true }, { type: "export-data", gesture: true }]) { const r = await send(m); ok(r && r.error === "rejected" && mem.items && mem.items[HK] && mem.session, m.type + " from a content script is refused and nothing is erased or handed out: " + JSON.stringify(r)); }
    sandbox.__tabs = []; ok((await send({ type: "open-options", at: "delete" })) === true && (await send({ type: "open-options", at: "signout-clear" })) === true && (await send({ type: "open-options", at: "export" })) === true && sandbox.__tabs.join() === "options.html#delete,options.html#signout-clear,options.html#export", "the panel can only open the confirming page: " + sandbox.__tabs);
    sandbox.__tabs = []; ok((await send({ type: "open-options" })) === true && sandbox.__tabs.join() === "OPTIONS", "plain Settings still opens the options page"); 
    // G1: the dropped-changes count reaches the panel and Settings through the account message, only while signed in and while fresh
    mem.syncDropped = { n: 3, at: Date.now() }; const ad = await send({ type: "account", gesture: true }, true); ok(ad.dropped === 3, "account reports the dropped count: " + JSON.stringify(ad.dropped));
    mem.syncDropped = { n: 3, at: Date.now() - 8 * D }; ok((await send({ type: "account", gesture: true }, true)).dropped === 0, "an old count is not reported"); mem.syncDropped = { n: 3, at: Date.now() }; delete mem.session; ok((await send({ type: "account", gesture: true }, true)).dropped === 0, "signed out: nothing reported"); delete mem.syncDropped;
    { const run = c => vm.runInContext(c, ctx); run("globalThis.__pull0 = pull"); mem.session = { access_token: "a", expires_at: 9e15, user: { id: "u" } };
      run("flush = async () => ({ ok: true, sent: 0, dropped: 0 }); pull = async () => ({ ok: true })"); mem.syncDropped = { n: 2, at: Date.now() - 50 }; await send({ type: "sync" }); ok(mem.syncDropped === undefined, "a clean Sync now clears the dropped count");
      run("pull = async () => ({ ok: false, reason: 'offline' })"); mem.syncDropped = { n: 2, at: Date.now() - 50 }; await send({ type: "sync" }); ok(mem.syncDropped && mem.syncDropped.n === 2, "a Sync now that did not complete keeps it");
      run("pull = async () => ({ ok: true }); flush = async () => { await chrome.storage.local.set({ syncDropped: { n: 1, at: Date.now() + 5 } }); return { ok: true, sent: 0, dropped: 1 }; }"); mem.syncDropped = { n: 2, at: Date.now() - 50 }; await send({ type: "sync" }); ok(mem.syncDropped && mem.syncDropped.n === 1, "something dropped during that very sync stays");
      run("flush = async () => {}; pull = globalThis.__pull0"); delete mem.syncDropped; delete mem.session; } }
  ok((await send({ type: "wish", key: HK, on: false })) === true && !("wishPrice" in mem.items[HK]), "un-hearting forgets the heart price");
  // blocked / failed notifications do not spend the alert
  mem.items[HK] = { ...hv, hist: [[Date.now() - D, 1000]], target: 900, armed: true }; notes.length = 0; permLevel = "denied";
  await ctx.record({ key: HK, ...hv, price: 850, src: "dom" }); ok(notes.length === 0 && mem.notifyBlocked === true && mem.items[HK].notified == null && !mem.items[HK].notifiedAt, "notifications blocked: nothing shown, remembered as notifyBlocked, alert NOT spent");
  permLevel = "granted"; notifyFail = true; await ctx.record({ key: HK, ...hv, price: 840, src: "dom" }); ok(notes.length === 0 && mem.items[HK].notified == null, "the browser refused to create it: alert not spent");
  notifyFail = false; await ctx.record({ key: HK, ...hv, price: 830, src: "dom" }); ok(notes.length === 1 && mem.items[HK].notified === 830 && !("notifyBlocked" in mem), "once it can be shown it fires, is spent, and the blocked flag clears");
  { permLevel = "denied"; delete mem.session; vm.runInContext("getSession = async () => null;", ctx); const r = await send({ type: "test-alert" }, true); ok(r.ok === false && r.level === "denied" && r.email === "signed-out" && mem.notifyBlocked === true, "test alert: reports blocked + email state: " + JSON.stringify(r)); permLevel = "granted";
    mem.session = { access_token: "a", expires_at: 9e15, user: { id: "u1" } }; mem.profile = { email_alerts: true }; const r2 = await send({ type: "test-alert" }, true); ok(r2.ok === true && r2.level === "granted" && r2.email === "on" && !("notifyBlocked" in mem), "test alert: shown, email on"); mem.profile = { email_alerts: false }; ok((await send({ type: "test-alert" }, true)).email === "off", "test alert: email off"); delete mem.session; mem.profile = {}; }
  // storage full: caches, then backups, then vaults go first; then look-only products; the error is 'storage-full', never the plan limit
  { const big = n => "x".repeat(n), seenN = (n, size) => Object.fromEntries(Array.from({ length: n }, (_, i) => ["amazon.in:B0SEEN" + String(i).padStart(5, "0"), { site: "Amazon", seenAt: 1000 + i, hist: [[1, 5]], pad: big(size) }]));
    const keepW = { site: "Amazon", title: "keep", wish: true, hist: [[1, 5]] }, base = () => { for (const k of Object.keys(mem)) delete mem[k]; }; base(); quotaLimit = 10485760;
    Object.assign(mem, { chartCache: { a: big(1e6) }, histCache: { a: big(1e6) }, "bak:v1": { t: Date.now(), x: big(4.8e6) }, "vault:old": { at: Date.now(), data: { pad: big(5e5) } }, items: { w: keepW, ...seenN(31, 1e5) } });
    const items = { ...mem.items, "amazon.in:B0SEEN99999": { site: "Amazon", seenAt: 9e12, hist: [[1, 5]], pad: big(1e5) } }; quotaLimit = 10485760; ok(memSize({ ...mem, items }) > 10485760, "fixture is over the quota: " + memSize({ ...mem, items }));
    await ctx.put(items); ok(!mem.chartCache && !mem.histCache && !mem["bak:v1"] && mem["vault:old"] && memSize(mem) <= 10485760 && Object.keys(mem.items).length === 33, "caches, then backup go first (vault kept, items intact): " + Object.keys(mem).join(","));
    base(); Object.assign(mem, { chartCache: { a: big(1e6) }, items: { w: keepW, ...seenN(60, 2e5) } }); const it2 = { ...mem.items, "amazon.in:B0SEEN99999": { site: "Amazon", seenAt: 9e12, hist: [[1, 5]], pad: big(2e5) } }; quotaLimit = 10485760; ok(memSize({ ...mem, items: it2 }) > 10485760, "second fixture over quota");
    await ctx.put(it2); ok(memSize(mem) <= 10485760 && mem.items.w && mem.items["amazon.in:B0SEEN99999"] && !mem.items["amazon.in:B0SEEN00000"] && Object.keys(mem.items).length < 62, "then the OLDEST look-only products go, the hearted one and the newest stay: " + Object.keys(mem.items).length);
    base(); mem.items = { w: { ...keepW, pad: big(9e6) } }; quotaLimit = 10485760; const hog = { w: { ...keepW, pad: big(11e6) } }; let err; try { await ctx.put(hog); } catch (e) { err = e; } ok(err && err.message === "storage-full" && mem.items.w.pad.length === 9e6, "hearted data alone too big: distinct error, nothing hearted is deleted");
    base(); quotaLimit = 1; mem.items = { [HK]: { ...hv, hist: [[Date.now() - D, 1000]] } }; quotaLimit = memSize(mem) + 50; const sr = await send({ type: "seen", p: { key: HK, site: "Amazon", url: hv.url, title: "Heart", image: null, price: 990, mrp: null, src: "dom" } }); ok(sr.error === "storage-full", "a full disk is reported as 'storage-full', not as the plan limit: " + JSON.stringify(sr).slice(0, 80)); quotaLimit = 0; base(); }
  // alarms: created only when absent (a service-worker wake-up must not restart the periods)
  { alarms.length = 0; alarmsHave = {}; await ctx.ensureAlarms(); ok(["trk", "sync", "tokens", "flags", "housekeeping"].every(n => alarms.includes(n)) && alarms.length === 5, "all five alarms created when missing: " + alarms);
    alarms.length = 0; alarmsHave = { sync: {}, tokens: {}, flags: {}, housekeeping: {} }; await ctx.ensureAlarms(); ok(alarms.length === 1 && alarms[0] === "trk", "only the missing one is created, the others keep their schedule: " + alarms); alarmsHave = { trk: {}, sync: {}, tokens: {}, flags: {}, housekeeping: {} }; alarms.length = 0; await ctx.ensureAlarms(); ok(alarms.length === 0, "nothing is re-created when all exist"); }
  // sign-in upload: only what this account has not seen from the server (never synced or edited after the last pull); owner tagged first
  { const t1 = Date.now(); mem.session = { access_token: "a", expires_at: 9e15, user: { id: "u1" } }; mem.lastPull = new Date(t1 - 5 * D).toISOString(); sandbox.__enq.length = 0;
    mem.items = { "amazon.in:B0OLDSYNC1": { site: "Amazon", wish: true, u: t1 - 20 * D, hist: [[1, 5]] }, "amazon.in:B0NEVERSY1": { site: "Amazon", target: 50, hist: [[1, 5]] }, "amazon.in:B0EDITED01": { site: "Amazon", wish: true, u: t1 - D, hist: [[1, 5]] }, "amazon.in:B0LOOKONLY": { site: "Amazon", hist: [[1, 5]] } };
    await ctx.afterSignIn(); const keys = sandbox.__enq.filter(o => o.t === "watch").map(o => o.key).sort();
    ok(JSON.stringify(keys) === JSON.stringify(["amazon.in:B0EDITED01", "amazon.in:B0NEVERSY1"]) && mem.localOwner === "u1" && sandbox.__enq.every(o => o.u > 0), "sign-in uploads only never-synced / newer-than-last-pull items (an old synced one could be a deletion elsewhere): " + keys); delete mem.session; delete mem.localOwner; delete mem.lastPull; }
  // erase my data: nothing local survives to be uploaded or restored
  { vm.runInContext("api = async () => true; getSession = async () => null;", ctx); mem.session = { access_token: "a", expires_at: 9e15, user: { id: "u1" } }; mem.localOwner = "u1"; mem.items = { "amazon.in:B0ERASE001": { site: "Amazon", wish: true, hist: [[1, 5]] } }; mem.outbox = [{ t: "watch", id: "w", key: "amazon.in:B0ERASE001", wish: true, u: 1 }]; mem.usage = { month: "2026-10", keys: ["a"] }; mem["vault:u1"] = { at: Date.now(), data: { items: { z: { hist: [] } } } };
    const r = await send({ type: "delete-data" }, true); ok(r.ok === true && !mem.items && !mem.outbox && !mem["vault:u1"] && !mem.session, "erase: local list, queue and vault are gone: " + Object.keys(mem).join(","));
    await ctx.claimOwner("u1"); ok(!mem.items && !mem.outbox, "a later sign-in has nothing old to restore or upload"); for (const k of Object.keys(mem)) delete mem[k]; }
  console.log(`tracker: ${n} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
