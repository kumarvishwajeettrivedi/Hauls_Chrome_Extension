// Unit tests for cache.js + grocery.js resilience. Fake chrome.storage, fake fetch, fake clock. No network.
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const ext = f => fs.readFileSync(path.join(__dirname, "../../extension", f), "utf8");
const queue = []; const test = (n, f) => queue.push([n, f]);

function fakeStorage(store = {}) {
  return { store, async get(k) { if (k == null) return JSON.parse(JSON.stringify(store)); const o = {}; [].concat(k).forEach(x => { if (x in store) o[x] = JSON.parse(JSON.stringify(store[x])); }); return o; },
    async set(o) { Object.entries(o).forEach(([k, v]) => { store[k] = JSON.parse(JSON.stringify(v)); }); }, async remove(k) { [].concat(k).forEach(x => delete store[x]); } };
}
// One "service worker": its own globals, clock and fetch. Pass the same `store` to simulate a cold start.
function boot({ store = {}, handler } = {}) {
  const clock = { t: 1e12 }, calls = [], local = fakeStorage(store);
  const fetch = (url, opt = {}) => { calls.push(url); return new Promise((res, rej) => {
    if (opt.signal && opt.signal.aborted) return rej(Object.assign(new Error("aborted"), { name: "AbortError" })); // like a real fetch: an already-aborted signal rejects at once
    if (opt.signal) opt.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    Promise.resolve(env.handler(url, opt)).then(res, rej); }); };
  const ctx = vm.createContext({ chrome: { storage: { local } }, fetch, AbortController, setTimeout, clearTimeout, Promise, JSON, Object, Array, Set, Map, Math, Error, String, Number, parseInt, parseFloat, isFinite, encodeURIComponent, URL, RegExp, console,
    crypto: globalThis.crypto, Date: { now: () => clock.t } });
  const env = { clock, calls, store, ctx, handler: handler || (async () => ({ ok: true, json: async () => ({}) })), run: c => vm.runInContext(c, ctx) };
  vm.runInContext(ext("lib.js"), ctx); vm.runInContext(ext("cache.js"), ctx); vm.runInContext(ext("grocery.js"), ctx);
  return env;
}
const jio = n => ({ ok: true, json: async () => ({ items: [{ name: "Amul Butter " + n, brand: { name: "Amul" }, price: { effective: { min: 50 }, marked: { min: 55 } }, sellable: true }] }) });
const blk = () => ({ ok: true, json: async () => ({}) });
const dmartOk = [[/suggestions/, () => ({ json: async () => ({ searchResult: [{ uniqueId: "u", apiMode: "m", pincode: "1" }] }) })], [/details/, () => ({ json: async () => ({ isPincodeServiceable: "true", storePincodeDetails: { storeId: 7 } }) })], [/secure\/search/, () => ({ ok: true, json: async () => ({ products: [] }) })]];
const route = (map) => async (url, o) => { for (const [re, h] of map) if (re.test(url)) return h(url, o); return blk(); };

test("TTL expiry", async () => { const e = boot(); await e.run('cache.set("a","k",{x:1},1000)'); assert.deepEqual(await e.run('cache.get("a","k")'), { x: 1 }); e.clock.t += 1001; assert.equal(await e.run('cache.get("a","k")'), undefined); });
test("LRU evicts least-recently-used beyond cap", async () => {
  const { makeCache } = require("../../extension/cache.js"), c = makeCache({ storage: null, cap: 3 });
  for (const k of "abc") await c.set("n", k, k, 1e6); await c.get("n", "a"); await c.set("n", "d", "d", 1e6); // b is oldest after a was touched
  assert.equal(await c.get("n", "b"), undefined); for (const k of "acd") assert.equal(await c.get("n", k), k);
});
test("oversize values are skipped", async () => { const e = boot(); await e.run('cache.set("a","big","x".repeat(200*1024+10),1e6)'); assert.equal(await e.run('cache.get("a","big")'), undefined); assert.equal(e.store["cache:a"], undefined); });
test("persists across cold start via chrome.storage", async () => { const a = boot(); await a.run('cache.set("a","k",[1,2],1e9)'); const b = boot({ store: a.store }); assert.deepEqual(await b.run('cache.get("a","k")'), [1, 2]); await b.run('cache.clear("a")'); assert.equal(b.store["cache:a"], undefined); });
test("works when storage throws or is missing", async () => {
  const { makeCache } = require("../../extension/cache.js"), bad = { get: async () => { throw new Error("x"); }, set: async () => { throw new Error("x"); }, remove: async () => { throw new Error("x"); } };
  for (const s of [bad, null]) { const c = makeCache({ storage: s }); await c.set("n", "k", 1, 1e6); assert.equal(await c.get("n", "k"), 1); await c.clear("n"); }
});
test("wrap dedupes concurrent calls and caches; stale-while-revalidate serves old value", async () => {
  const e = boot(); e.run("var n = 0; var f = () => new Promise(r => setTimeout(() => r(++n), 5));");
  const r = await Promise.all([e.run('cache.wrap("w","k",100,f)'), e.run('cache.wrap("w","k",100,f)')]); assert.deepEqual(r, [1, 1]); assert.equal(await e.run('cache.wrap("w","k",100,f)'), 1);
  e.clock.t += 101; assert.equal(await e.run('cache.wrap("w","k",100,f,{staleWhileRevalidate:true})'), 1); await new Promise(r => setTimeout(r, 20)); assert.equal(await e.run('cache.get("w","k")'), 2);
});
// JioMart rows are hidden (delivery unconfirmed), so "got results" = shown + unconfirmed.
const got = r => r.items.length + r.unconfirmed.length;
const SEARCH = 'grocerySearch("amul butter", {pin:"110001",lat:1,lon:2})';
test("repeat search served from cache with zero fetches; key is case/space-insensitive", async () => {
  const e = boot({ handler: route([[/jiomart/, () => jio(1)], ...dmartOk]) }); const a = await e.run(SEARCH), n = e.calls.length; assert.ok(got(a));
  const b = await e.run('grocerySearch("  AMUL Butter ", {pin:"110001"})'); assert.equal(e.calls.length, n); assert.equal(got(b), got(a));
  e.clock.t += 5 * 6e4 + 1; await e.run(SEARCH); assert.ok(e.calls.length > n, "refetched after 5 min");
});
test("a failing store does not break the others", async () => {
  const e = boot({ handler: route([[/jiomart/, () => jio(1)], [/blinkit/, () => ({ ok: false, status: 500 })]]) }); const r = await e.run(SEARCH);
  assert.ok(r.unconfirmed.includes("JioMart")); assert.ok(r.errors.some(m => /Blinkit/.test(m)));
  const again = await e.run(SEARCH); assert.ok(again.errors.length, "degraded results are not cached");
});
test("timeout aborts a hung fetch with a human error", async () => {
  const e = boot({ handler: route([[/jiomart/, () => jio(1)], [/blinkit/, () => new Promise(() => {})]]) });
  const real = setTimeout; const p = e.run(SEARCH); await new Promise(r => real(r, 30)); // let calls start
  // fire the 8 s timer without waiting: swap in a fast timer for a second boot instead
  const f = boot({ handler: route([[/jiomart/, () => jio(1)], [/blinkit/, () => new Promise(() => {})]]) }); f.ctx.setTimeout = (fn, ms) => real(fn, ms === 8000 ? 20 : ms);
  const r = await f.run(SEARCH); assert.ok(r.errors.includes("Blinkit timed out"), r.errors.join()); assert.ok(got(r));
});
test("breaker opens after 3 failures, half-opens after 10 min, one probe at a time", async () => {
  let fail = true; const e = boot({ handler: route([[/blinkit/, () => fail ? { ok: false, status: 500 } : blk()]]) });
  const hits = () => e.calls.filter(u => /blinkit\.com\/v1\/layout/.test(u)).length; // search calls only (the home-page warm-up is not a search)
  for (let i = 0; i < 3; i++) await e.run(`grocerySearch("milk${i}", {pin:"1"})`); assert.equal(hits(), 3);
  const r = await e.run('grocerySearch("milk9", {pin:"1"})'); assert.equal(hits(), 3, "open: no call"); assert.ok(r.errors.some(m => /Blinkit is temporarily unavailable/.test(m)));
  e.clock.t += 10 * 6e4 + 1; await Promise.all([e.run('grocerySearch("p1", {pin:"1"})'), e.run('grocerySearch("p2", {pin:"1"})')]); assert.equal(hits(), 4, "single probe");
  assert.equal((await e.run('cache.get("breaker","Blinkit")')).fails, 4); await e.run('grocerySearch("p3", {pin:"1"})'); assert.equal(hits(), 4, "probe failed: open again");
  fail = false; e.clock.t += 10 * 6e4 + 1; await e.run('grocerySearch("p4", {pin:"1"})'); assert.equal(hits(), 5); assert.equal((await e.run('cache.get("breaker","Blinkit")')).fails, 0, "success closes");
});
test("breaker state survives a cold start", async () => {
  const a = boot({ handler: route([[/blinkit/, () => ({ ok: false, status: 500 })]]) }); for (let i = 0; i < 3; i++) await a.run(`grocerySearch("m${i}", {pin:"1"})`);
  const b = boot({ store: a.store }); b.clock.t = a.clock.t; await b.run('grocerySearch("zz", {pin:"1"})'); assert.equal(b.calls.filter(u => /blinkit\.com\/v1\/layout/.test(u)).length, 0);
});
test("disabled store is skipped with the paused message (even if cached)", async () => {
  const e = boot({ handler: route([[/jiomart/, () => jio(1)], ...dmartOk]) }); await e.run(SEARCH); const n = e.calls.length;
  e.run('setDisabledStores(["blinkit","JioMart"])'); assert.deepEqual(e.run("getDisabledStores()"), ["blinkit", "jiomart"]);
  const r = await e.run(SEARCH); assert.ok(r.errors.includes("JioMart is temporarily paused") && r.errors.includes("Blinkit is temporarily paused")); assert.ok(!r.items.some(i => i.store === "JioMart")); assert.equal(e.calls.length, n);
  const f = boot({ handler: route([[/jiomart/, () => jio(1)], ...dmartOk]) }); f.run('setDisabledStores(["blinkit"])'); await f.run('grocerySearch("rice", {pin:"1"})'); assert.equal(f.calls.filter(u => /blinkit/.test(u)).length, 0);
});
test("geocode cached 30 days; dmartStore cached 24 h", async () => {
  const e = boot({ handler: route([[/nominatim/, () => ({ ok: true, json: async () => [{ lat: "1.5", lon: "2.5" }] })],
    [/suggestions/, () => ({ json: async () => ({ searchResult: [{ uniqueId: "u", apiMode: "m", pincode: "1" }] }) })], [/details/, () => ({ json: async () => ({ isPincodeServiceable: "true", storePincodeDetails: { storeId: 77 } }) })]]) });
  assert.deepEqual(await e.run('geocode("110001")'), { lat: 1.5, lon: 2.5 }); await e.run('geocode("110001")'); assert.equal(e.calls.length, 1);
  e.clock.t += 29 * 864e5; await e.run('geocode("110001")'); assert.equal(e.calls.length, 1); e.clock.t += 2 * 864e5; await e.run('geocode("110001")'); assert.equal(e.calls.length, 2);
  e.calls.length = 0; assert.equal(await e.run('dmartStore("5")'), 77); await e.run('dmartStore("5")'); assert.equal(e.calls.length, 2); e.clock.t += 864e5 + 1; await e.run('dmartStore("5")'); assert.equal(e.calls.length, 4);
});

test("a location that doesn't belong to the pincode is refused before any store is asked (stale coordinates)", async () => {
  const nom = [[/nominatim/, () => ({ ok: true, json: async () => [{ lat: "26.1197", lon: "85.391" }] })], [/jiomart|blinkit|dmart/, () => { throw new Error("a store must not be called"); }]];
  let e = boot({ handler: route(nom) }); const r = await e.run('groceryAt("milk", {pin:"842001", lat:12.9716, lon:77.5946})'); assert.deepEqual(r.items, []); assert.match(r.errors[0], /doesn't match pincode 842001/); assert.equal(e.calls.filter(u => !/nominatim/.test(u)).length, 0, "no store contacted");
  e = boot({ handler: route([[/nominatim/, () => ({ ok: true, json: async () => [{ lat: "26.1197", lon: "85.391" }] })], ...dmartOk, [/jiomart/, () => jio(1)]]) }); const ok = await e.run('groceryAt("amul butter", {pin:"842001", lat:26.12, lon:85.39})'); assert.ok(e.calls.some(u => /jiomart/.test(u)), "consistent location proceeds to the stores");
  e = boot({ handler: route([[/nominatim/, () => { throw new Error("offline"); }], [/jiomart/, () => jio(1)]]) }); await e.run('groceryAt("amul butter", {pin:"842001", lat:1, lon:2})'); assert.ok(e.calls.some(u => /jiomart/.test(u)), "geocoder down: cannot judge, does not block");
});
test("a store the user hasn't connected is not an error: it is listed under `connect`, results still cache, other stores unaffected", async () => {
  const e = boot({ handler: route([[/jiomart/, () => jio(1)], ...dmartOk]) });
  e.run("var T2 = { search: async () => { throw Object.assign(new Error('Zepto isn\\'t connected'), { user: true, silent: true, connect: true }); } };");
  const a = await e.run(SEARCH); assert.ok(a.connect.includes("Zepto") && a.connect.includes("BigBasket"), "every unconnected hidden-tab store is offered"); assert.ok(!a.errors.some(m => /Zepto|BigBasket/.test(m)), "no error line for a store that is merely not connected"); const n = e.calls.length; const b = await e.run(SEARCH); assert.equal(e.calls.length, n, "result was cached (not degraded)"); assert.ok(b.connect.includes("Zepto"));
  const f = boot({ handler: route([[/jiomart/, () => jio(1)]]) }); f.run("var T2 = { connected: async () => true, search: async () => { throw Object.assign(new Error('wrong place'), { user: true }); } };"); const r = await f.run('grocerySearch("amul butter", {pin:"110001",lat:1,lon:2}, { more: true })'); assert.ok(r.errors.some(m => /Zepto: wrong place/.test(m)), "a real problem is shown with the store name"); assert.ok(!r.connect.includes("Zepto"));
  const g = boot({ handler: route([[/jiomart/, () => jio(1)]]) }); g.run("var T2 = { connected: async () => true, search: async (n, q, pin) => [{ store: 'Zepto', name: 'Amul Butter 500 g', price: 280, pack: '500 g', inStock: true, confirmed: true }] };"); const z = await g.run('grocerySearch("amul butter", {pin:"110001",lat:1,lon:2}, { more: true })'); assert.ok(z.items.some(i => i.store === 'Zepto' && i.price === 280), "Zepto rows flow into the results");
});
test("Blinkit gets its first-visit cookie once (home page GET), then at most every 30 min; a failed warm-up never breaks the search", async () => {
  const hits = []; const e = boot({ handler: route([[/blinkit\.com\/$/, u => { hits.push("warm"); return { ok: true, status: 200, text: async () => "" }; }], [/blinkit\.com\/v1\/layout/, () => ({ ok: true, json: async () => ({}) })], ...dmartOk, [/jiomart/, () => jio(1)]]) });
  await e.run('grocerySearch("milk", {pin:"110001",lat:1,lon:2})'); await e.run('grocerySearch("bread", {pin:"110001",lat:1,lon:2})'); assert.equal(hits.length, 1, "warm-up only once within 30 minutes"); e.clock.t += 31 * 60e3; await e.run('grocerySearch("eggs", {pin:"110001",lat:1,lon:2})'); assert.equal(hits.length, 2, "again after 30 min");
  const f = boot({ handler: route([[/blinkit\.com\/$/, () => { throw new Error("offline"); }], [/blinkit\.com\/v1\/layout/, () => ({ ok: true, json: async () => ({}) })], [/jiomart/, () => jio(1)]]) }); const r = await f.run('grocerySearch("milk", {pin:"110001",lat:1,lon:2})'); assert.ok(f.calls.some(u => /v1\/layout/.test(u)), "search still ran"); assert.ok(!r.errors.some(m => /offline/.test(m)), "warm-up failure is silent");
});
test("JioMart: connected -> its page is read (rows confirmed); not connected -> old direct rows stay hidden and the panel is offered Connect", async () => {
  const e = boot({ handler: route([[/jiomart/, () => jio(1)], ...dmartOk]) }); e.run("var T2 = { connected: async n => n === 'JioMart', search: async (n) => { if (n !== 'JioMart') throw Object.assign(new Error('x'), { user: true, silent: true }); return [{ store: 'JioMart', name: 'Amul Butter 500 g', price: 270, pack: '500 g', inStock: true, confirmed: true }]; } };");
  const a0 = await e.run(SEARCH); assert.ok(a0.later.includes("JioMart") && !a0.items.some(i => i.store === "JioMart"), "a normal search does not run the page read"); const a = await e.run('grocerySearch("amul butter", {pin:"110001",lat:1,lon:2}, { more: true })'); assert.ok(a.items.some(i => i.store === "JioMart" && i.price === 270), "confirmed JioMart rows are shown after the explicit check"); assert.ok(!e.calls.some(u => /jiomart/.test(u)), "no direct call when connected");
  const f = boot({ handler: route([[/jiomart/, () => jio(1)], ...dmartOk]) }); f.run("var T2 = { connected: async () => false, search: async () => { throw new Error('unused'); } };"); const b = await f.run(SEARCH);
  assert.ok(b.unconfirmed.includes("JioMart") && !b.items.some(i => i.store === "JioMart"), "unconnected: hidden"); assert.ok(b.connect.includes("JioMart"), "and Connect is offered");
});
test("page-read stores (JioMart/BigBasket/Zepto) NEVER run on a normal search: it stays instant, lists them under `later`; an explicit `more` runs them once and caches the rows 30 min", async () => {
  let calls = 0; const e = boot({ handler: route([[/jiomart/, () => jio(1)], ...dmartOk]) });
  e.run("var __n = 0; var T2 = { connected: async () => true, search: async (n, q, pin) => { __n++; return [{ store: n, name: 'Amul Butter 500 g', price: 270, pack: '500 g', inStock: true, confirmed: true }]; } };");
  const a = await e.run(SEARCH); assert.equal(e.run("__n"), 0, "no window/tab opened by a normal search"); assert.ok(["Zepto", "BigBasket", "JioMart"].every(n => a.later.includes(n)), "offered under `later`: " + a.later.join()); assert.ok(!a.items.some(i => i.store === "Zepto"));
  const b = await e.run('grocerySearch("amul butter", {pin:"110001",lat:1,lon:2}, { more: true })'); assert.equal(e.run("__n"), 3, "each page store ran exactly once"); assert.ok(["Zepto", "BigBasket", "JioMart"].every(n => b.items.some(i => i.store === n)), "rows shown"); assert.deepEqual(b.later, []);
  const c = await e.run(SEARCH); assert.equal(e.run("__n"), 3, "a later normal search reuses the 30-minute page results without opening anything"); assert.ok(c.items.some(i => i.store === "Zepto") && c.later.length === 0);
  e.clock.t += 31 * 60e3; const d = await e.run(SEARCH); assert.equal(e.run("__n"), 3); assert.ok(d.later.includes("Zepto"), "after 30 minutes they need a fresh click"); });
(async () => { let p = 0, f = 0; for (const [n, fn] of queue) { try { await fn(); p++; console.log("ok  " + n); } catch (e) { f++; console.log("FAIL " + n + "\n  " + (e.stack || e).split("\n").slice(0, 4).join("\n  ")); } } console.log(`${p} passed, ${f} failed`); process.exit(f ? 1 : 0); })();
