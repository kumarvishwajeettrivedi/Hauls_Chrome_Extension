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
  runtime: { id: "x", onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, sendMessage() {}, getURL: p => p }, alarms: { create: (n2, o) => alarms.push(n2), onAlarm: { addListener: f => { onAlarm = f; } } },
  notifications: { create: (id, o) => notes.push({ id, ...o }) }, action: { onClicked: { addListener() {} } }, tabs: { sendMessage() {}, create() {} }, scripting: { getRegisteredContentScripts: async () => [] }, permissions: { contains: async () => false, onRemoved: { addListener() {} } }, identity: {}, windows: {}, declarativeNetRequest: {} };
let fetched = []; const sandbox = { console, URL, URLSearchParams, TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, setTimeout, clearTimeout, AbortController, AbortSignal, setInterval, clearInterval, Date, JSON, Math, Promise, chrome, navigator: {}, self: {},
  fetch: async u => { fetched.push(u); return { ok: true, headers: { get: () => "0" }, text: async () => '<script type="application/ld+json">{"@type":"Product","name":"Thing","offers":{"price":"450","priceCurrency":"INR"}}</script>' }; } };
const ctx = vm.createContext(sandbox); sandbox.importScripts = (...fs2) => { for (const f of fs2) vm.runInContext(fs.readFileSync(path.join(__dirname, "../../extension", f === "config.js" && !fs.existsSync(path.join(__dirname, "../../extension/config.js")) ? "config.example.js" : f), "utf8"), ctx, { filename: f }); };
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../extension/background.js"), "utf8"), ctx, { filename: "background.js" });
vm.runInContext("getSession = async () => null; enqueue = () => {}; flush = async () => {};", ctx);
(async () => {
  ok(typeof onAlarm === "function", "alarm listener registered");
  const key = "amazon.in:B0TESTTEST1";
  mem.items = { [key]: { site: "Amazon", title: "Thing", url: "https://www.amazon.in/dp/B0TESTTEST1", mrp: 999, hist: [[Date.now() - 3 * D, 700]], target: 500, armed: true } };
  // recheck path: JSON-LD price 450 <= target 500, record() must keep MRP 999
  await onAlarm({ name: "recheck" });
  let it = mem.items[key]; ok(it.mrp === 999, "recheck keeps the stored MRP: " + it.mrp); ok(it.hist.at(-1)[1] === 450, "new point recorded"); ok(notes.length === 1 && /450/.test(notes[0].message), "alert fired once: " + notes.length);
  await onAlarm({ name: "recheck" }); ok(notes.length === 1, "second pass at the same price: no repeat alert");
  fetched = []; await onAlarm({ name: "something-else" }); ok(fetched.length === 0, "unknown alarm name does not scan");
  // page visit with MRP null clears MRP deliberately; undefined keeps it
  await ctx.record({ key, site: "Amazon", url: it.url, title: "Thing", price: 450, mrp: null, src: "dom" }); ok(mem.items[key].mrp === null, "a page that shows no MRP clears it");
  console.log(`tracker: ${n} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
