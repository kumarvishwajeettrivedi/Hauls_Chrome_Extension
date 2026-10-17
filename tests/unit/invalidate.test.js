// S4: invalidate(reason), storage budget eviction, history pruning. In-memory chrome.storage, real cache.js + state.js. No browser.
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const src = f => fs.readFileSync(path.join(__dirname, "../../extension", f), "utf8");
function env(initial = {}) {
  const store = JSON.parse(JSON.stringify(initial)), size = () => Object.entries(store).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
  const st = { async get(k) { if (k == null) return JSON.parse(JSON.stringify(store)); const o = {}; [].concat(k).forEach(x => { if (x in store) o[x] = JSON.parse(JSON.stringify(store[x])); }); return o; },
    async set(o) { Object.entries(o).forEach(([k, v]) => { store[k] = JSON.parse(JSON.stringify(v)); }); }, async remove(k) { [].concat(k).forEach(x => delete store[x]); }, async getBytesInUse() { return size(); } };
  const ctx = vm.createContext({ chrome: { storage: { local: st } }, crypto: globalThis.crypto, Date, JSON, Math, Array, Object, Set, Map, Promise, isFinite, console, setTimeout, clearTimeout });
  for (const f of ["lib.js", "state.js", "cache.js", "sync.js"]) vm.runInContext(src(f), ctx);
  return { store, st, size, run: c => vm.runInContext(c, ctx) };
}
const USER_CONTENT = { items: { a: { hist: [[1, 2]], wish: true } }, outbox: [{ t: "watch", id: "o", key: "a" }], profile: { plan: "pro" }, plan: "pro", pin: "560001", knobY: 0.4, range: "30D", session: { access_token: "keep" }, usage: { month: "2026-10", keys: ["a"] }, schemaVersion: 1, localOwner: "u1" };
async function seedCaches(e) { for (const ns of ["grocery", "geo", "dmart", "flags", "breaker"]) await e.run(`cache.set("${ns}", "k", { v: "x".repeat(50) }, 3600e3)`); e.store.histCache = { a: { t: 1, rows: [] } }; }
let ok = 0, bad = 0, q = []; const t = (n, f) => q.push([n, f]); const left = (e, ns) => e.run(`cache.get("${ns}", "k")`);
t("pin-change forgets ONLY grocery results (memory + storage), never location lookups or user content", async () => { const e = env(USER_CONTENT); await seedCaches(e);
  const r = await e.run('invalidate("pin-change")'); assert.equal(r.ok, true); assert.deepEqual(r.cleared, ["grocery"]); assert.equal(await left(e, "grocery"), undefined);
  for (const ns of ["geo", "dmart", "flags", "breaker"]) assert.ok(await left(e, ns), ns + " must survive"); for (const [k, v] of Object.entries(USER_CONTENT)) assert.deepEqual(e.store[k], v, k); assert.ok(e.store.histCache); });
t("flags-change forgets grocery results and breaker state", async () => { const e = env(USER_CONTENT); await seedCaches(e); const r = await e.run('invalidate("flags-change")');
  assert.deepEqual(r.cleared.sort(), ["breaker", "grocery"]); assert.equal(await left(e, "grocery"), undefined); assert.equal(await left(e, "breaker"), undefined); assert.ok(await left(e, "geo")); });
t("schema-upgrade and user-clear-cache forget every cache + histCache but never user content", async () => { for (const reason of ["schema-upgrade", "user-clear-cache"]) { const e = env(USER_CONTENT); await seedCaches(e);
  const r = await e.run(`invalidate("${reason}")`); assert.equal(r.ok, true); for (const ns of ["grocery", "geo", "dmart", "flags", "breaker"]) assert.equal(await left(e, ns), undefined, reason + " " + ns);
  assert.equal(Object.keys(e.store).some(k => k.startsWith("cache:")), false); assert.equal(e.store.histCache, undefined); for (const [k, v] of Object.entries(USER_CONTENT)) assert.deepEqual(e.store[k], v, reason + " kept " + k); } });
t("unknown / dangerous reasons do nothing", async () => { const e = env(USER_CONTENT); await seedCaches(e); const before = JSON.stringify(e.store);
  for (const reason of ["sign-out", "erase-data", "", "__proto__", "everything"]) assert.deepEqual(await e.run(`invalidate(${JSON.stringify(reason)})`), { ok: false, reason: "unknown-reason" }); assert.equal(JSON.stringify(e.store), before); });
t("enforceBudget: under 80% does nothing", async () => { const e = env(USER_CONTENT); await seedCaches(e); const before = JSON.stringify(e.store), r = await e.run("enforceBudget({ budget: 1e6 })"); assert.equal(r.over, false); assert.deepEqual(r.evicted, []); assert.equal(JSON.stringify(e.store), before); });
t("enforceBudget: over budget evicts caches in order and STOPS as soon as it is under; user content untouched", async () => { const e = env(USER_CONTENT); await seedCaches(e);
  for (const ns of ["grocery", "geo"]) e.store["cache:" + ns] = { big: "y".repeat(4000) }; e.store.histCache = { big: "z".repeat(4000) };
  const total = e.size(), budget = Math.floor((total - 5000) / 0.8); // need to shed ~5 KB: grocery (4 KB) + histCache (4 KB) is enough, geo should survive
  const r = await e.run(`enforceBudget({ budget: ${budget} })`); assert.deepEqual(r.evicted, ["cache:grocery", "histCache"]); assert.equal(r.over, false); assert.ok(e.store["cache:geo"], "later cache kept"); assert.ok(r.after < r.before);
  for (const [k, v] of Object.entries(USER_CONTENT)) assert.deepEqual(e.store[k], v, k); });
t("enforceBudget: if user content alone is over budget it reports over:true and deletes NOTHING of the user's", async () => { const e = env(USER_CONTENT); await seedCaches(e); e.store.items = { huge: { hist: Array.from({ length: 800 }, (_, i) => [i, i + 1]), wish: true } };
  const r = await e.run("enforceBudget({ budget: 3000 })"); assert.equal(r.over, true); assert.ok(r.evicted.length >= 1); assert.equal(e.store.items.huge.hist.length, 800); assert.ok(e.store.outbox && e.store.session && e.store.profile); });
t("pruneHistory: drops points older than 400 days but keeps the price in force at the cut-off", () => { const e = env(), now = 1e12, D = 864e5;
  const h = [[now - 500 * D, 100], [now - 450 * D, 110], [now - 300 * D, 120], [now - 10 * D, 90]];
  const p = e.run(`pruneHistory(${JSON.stringify(h)}, ${now})`); assert.deepEqual(p, [[now - 400 * D, 110], [now - 300 * D, 120], [now - 10 * D, 90]]);
  assert.deepEqual(e.run(`pruneHistory(${JSON.stringify(h.slice(2))}, ${now})`), h.slice(2), "nothing old: unchanged"); assert.deepEqual(e.run(`pruneHistory([], ${now})`), []);
  assert.deepEqual(e.run(`pruneHistory([[${now - 500 * D}, 100]], ${now})`), [[now - 400 * D, 100]], "only-old history keeps one point"); });
t("housekeeping prunes stored history under the lock and reports the budget check", async () => { const now = Date.now(), D = 864e5, e = env({ items: { a: { wish: true, hist: [[now - 700 * D, 5], [now - 600 * D, 6], [now - 5 * D, 7]] }, b: { hist: [[now - 2 * D, 9]] } } });
  const r = await e.run("housekeeping()"); assert.equal(r.pruned, 1); assert.equal(e.store.items.a.hist.length, 2); assert.deepEqual(e.store.items.b.hist, [[now - 2 * D, 9]]); assert.equal(r.budget.over, false);
  assert.equal((await e.run("housekeeping()")).pruned, 0, "idempotent"); });
(async () => { for (const [n, f] of q) { try { await f(); ok++; console.log("  ok   " + n); } catch (e) { bad++; console.log("  FAIL " + n + "\n       " + String(e.message).split("\n")[0]); } } console.log(`\ninvalidate: ${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0); })();
