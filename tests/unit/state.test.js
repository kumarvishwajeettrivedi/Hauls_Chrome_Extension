// S3: safe readers + schema migrations, against an in-memory chrome.storage. No browser.
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const src = f => fs.readFileSync(path.join(__dirname, "../../extension", f), "utf8");
function env(initial = {}) {
  const store = JSON.parse(JSON.stringify(initial)), st = { async get(k) { const ks = k == null ? Object.keys(store) : [].concat(k), o = {}; ks.forEach(x => { if (x in store) o[x] = JSON.parse(JSON.stringify(store[x])); }); return o; },
    async set(o) { Object.entries(o).forEach(([k, v]) => { store[k] = JSON.parse(JSON.stringify(v)); }); }, async remove(k) { [].concat(k).forEach(x => delete store[x]); }, async getBytesInUse() { return Object.entries(store).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0); } };
  const ctx = vm.createContext({ chrome: { storage: { local: st } }, crypto: globalThis.crypto, URL, Date, JSON, Math, Array, Object, Promise, Set, Map, isFinite, console });
  vm.runInContext(src("lib.js"), ctx); vm.runInContext(src("state.js"), ctx); vm.runInContext(src("sync.js"), ctx); return { store, st, run: c => vm.runInContext(c, ctx) };
}
let ok = 0, bad = 0, q = []; const t = (n, f) => q.push([n, f]);
t("safeItem repairs hist (junk dropped, sorted, capped at 2000) and keeps unknown fields", () => { const e = env();
  const it = e.run('safeItem({ site: "A", custom: { keep: 1 }, hist: [[3, 30], [1, 10], ["x", 5], [2, -4], null, [5], [4, "40"], [2, 20]], wish: "yes", target: "700" })');
  assert.deepEqual(it.hist, [[1, 10], [2, 20], [3, 30], [4, 40]]); assert.equal(it.wish, true); assert.equal(it.target, 700); assert.deepEqual(it.custom, { keep: 1 });
  assert.equal(e.run('safeItem({ hist: Array.from({ length: 2500 }, (_, i) => [i, 1 + i]) })').hist.length, 2000); assert.equal(e.run('safeItem({ hist: Array.from({ length: 2500 }, (_, i) => [i, 1 + i]) })').hist[1999][0], 2499, "keeps the newest"); });
t("safeItem drops unsafe/invalid fields and rejects non-objects", () => { const e = env();
  const it = e.run('safeItem({ title: 5, site: {}, url: "javascript:alert(1)", image: "http://x/y.png", target: -3 })'); for (const k of ["title", "site", "url", "image", "target"]) assert.equal(k in it, false, k); assert.deepEqual(it.hist, []);
  for (const bad of ['null', '"str"', '42', '[1,2]', 'undefined']) assert.equal(e.run(`safeItem(${bad})`), null, bad); assert.equal(e.run('safeItem({ url: "https://ok.example/p" })').url, "https://ok.example/p"); });
t("safeItems tolerates any input and drops bad entries / oversized keys", () => { const e = env();
  for (const bad of ['null', '"x"', '[1]', '7', 'undefined']) assert.deepEqual(e.run(`safeItems(${bad})`), {}, bad);
  const out = e.run('safeItems({ good: { hist: [[1, 2]] }, bad1: null, bad2: "s", ["k".repeat(300)]: { hist: [] }, "": { hist: [] } })'); assert.deepEqual(Object.keys(out), ["good"]); });
t("safeOutbox keeps valid ops, gives ids to old ones, caps at 500, tolerates garbage", () => { const e = env();
  const out = e.run('safeOutbox([{ t: "watch", key: "a" }, { t: "obs", key: "b", id: "keep", at: 1, price: 5 }, { t: "evil", key: "c" }, null, "x", { t: "watch" }, { t: "watch", key: 5 }])'); assert.equal(out.length, 2); assert.ok(out[0].id && out[0].id.length > 5); assert.equal(out[1].id, "keep");
  assert.equal(e.run('safeOutbox(Array.from({ length: 700 }, (_, i) => ({ t: "obs", key: "k" + i, id: "i" + i, at: 1, price: 5 })))').length, 500); for (const bad of ['null', '{}', '"x"']) assert.deepEqual(e.run(`safeOutbox(${bad})`), []); });
t("safeUsage accepts only { month: string, keys: string[] }", () => { const e = env(); assert.deepEqual(e.run('safeUsage({ month: "2026-10", keys: ["a", 5, "b"] })'), { month: "2026-10", keys: ["a", "b"] });
  for (const bad of ['null', '{}', '{ month: 1, keys: [] }', '{ month: "x", keys: "y" }', '"s"']) assert.equal(e.run(`safeUsage(${bad})`), null, bad); });
t("migration v1 on a fresh install: sets schemaVersion, creates nothing", async () => { const e = env(); const r = await e.run("runMigrations()"); assert.equal(r.ran, 1); assert.equal(e.store.schemaVersion, 1); assert.deepEqual(Object.keys(e.store), ["schemaVersion"]); });
t("migration v1 repairs corrupted data, backs up the ORIGINAL, and is idempotent", async () => {
  const e = env({ items: { good: { hist: [[2, 20], [1, 10]], wish: 1 }, junk: "oops", worse: { hist: "no" } }, outbox: [{ t: "watch", key: "a" }, { t: "bad" }], usage: "garbage", other: "untouched" });
  await e.run("runMigrations()"); assert.deepEqual(Object.keys(e.store.items).sort(), ["good", "worse"]); assert.deepEqual(e.store.items.good.hist, [[1, 10], [2, 20]]); assert.equal(e.store.outbox.length, 1); assert.ok(e.store.outbox[0].id); assert.equal(e.store.usage, undefined);
  assert.equal(e.store["bak:v1"].items.junk, "oops", "original kept for recovery"); assert.equal(e.store["bak:v1"].usage, "garbage"); assert.equal(e.store.other, "untouched"); assert.equal(e.store.schemaVersion, 1);
  const snap = JSON.stringify(e.store), r = await e.run("runMigrations()"); assert.equal(r.ran, 0); assert.equal(JSON.stringify(e.store), snap, "second run changes nothing");
});
t("clean data is left byte-identical and no backup is written", async () => { const items = { a: { hist: [[1, 10]], wish: true, site: "S", title: "T", url: "https://x.example/p" } }, e = env({ items, outbox: [], usage: { month: "2026-10", keys: ["a"] } });
  await e.run("runMigrations()"); assert.deepEqual(e.store.items, items); assert.equal(e.store["bak:v1"], undefined); });
t("data written by a NEWER build (schemaVersion > known) is never touched", async () => { const weird = { items: { x: "future-format" }, schemaVersion: 99 }, e = env(weird); const r = await e.run("runMigrations()"); assert.equal(r.ran, 0); assert.deepEqual(e.store, weird); });
t("migrations are strictly ordered with unique versions", () => { const e = env(); const vs = e.run("MIGRATIONS.map(m => m.v)"); assert.deepEqual(vs, [...vs].sort((a, b) => a - b)); assert.equal(new Set(vs).size, vs.length); assert.equal(vs[0], 1); });
t("housekeeping over budget evicts in order: shared charts, community history, old backups, vaults (expired first), then the OLDEST look-only products; hearted items, alerts and the outbox are never touched", async () => {
  const big = n => "x".repeat(n), D = 864e5, now = Date.now(), items = { w: { site: "A", wish: true, hist: [[1, 5]], title: "keep" }, t: { site: "A", target: 5, hist: [[1, 5]] } };
  for (let i = 0; i < 40; i++) items["amazon.in:B0SEEN" + String(i).padStart(4, "0")] = { site: "A", hist: [[1, 5]], seenAt: 1000 + i, pad: big(1e5) };
  const e = env({ items, outbox: [{ t: "watch", id: "o", key: "w" }], chartCache: { a: big(1.5e6) }, histCache: { a: big(1.5e6) }, "bak:v1": { t: now - D, x: big(1e6) }, "bak:old": { t: now - 9 * D, x: big(5e5) }, "vault:expired": { at: now - 40 * D, data: { pad: big(5e5) } }, "vault:fresh": { at: now - D, data: { pad: big(5e5) } }, session: { access_token: "a" } });
  const before = await e.st.getBytesInUse(); assert.ok(before > 5 * 1024 * 1024 * 0.8, "fixture is over the soft limit: " + before);
  const r = await e.run("housekeeping()"); assert.deepEqual(r.swept.sort(), ["bak:old", "vault:expired"], "expired vault and week-old backup are swept first"); assert.deepEqual(r.budget.evicted.slice(0, 2), ["chartCache", "histCache"]);
  const ev = r.budget.evicted; assert.ok(ev.indexOf("histCache") < ev.indexOf("bak:v1") || !ev.includes("bak:v1")); assert.ok(!e.store.chartCache && !e.store.histCache);
  const after = await e.st.getBytesInUse(); assert.ok(after <= 5 * 1024 * 1024 * 0.8, "under the soft limit: " + after); assert.equal(r.budget.over, false);
  assert.ok(e.store.items.w && e.store.items.t && e.store.outbox.length === 1 && e.store.session, "hearted, alert, queue, session survive");
  const seen = Object.keys(e.store.items).filter(k => k.startsWith("amazon.in:B0SEEN")); assert.equal(seen.length, 40, "caches/backups/vaults were enough: no look-only product dropped needlessly");
  // squeeze harder: only look-only products are left to give up, oldest first
  for (let i = 0; i < 25; i++) e.store.items["amazon.in:B0MORE" + String(i).padStart(4, "0")] = { site: "A", hist: [[1, 5]], seenAt: 5000 + i, pad: big(1e5) };
  e.store.pad = big(0); const r2 = await e.run("housekeeping()"); assert.ok(r2.dropped > 0 && r2.budget.over === false, JSON.stringify([r2.dropped, r2.budget.over]));
  const left = Object.keys(e.store.items); assert.ok(left.includes("w") && left.includes("t") && !left.includes("amazon.in:B0SEEN0000") && left.includes("amazon.in:B0MORE0024"), "the oldest went, the newest stayed");
});
t("dropSeenOnly: oldest look-only first, never hearted/alert items, always keeps the newest look-only one", () => { const e = env();
  const items = { w: { wish: true, seenAt: 1 }, t: { target: 5, seenAt: 2 }, a: { seenAt: 10 }, b: { seenAt: 20 }, c: { seenAt: 30 }, d: { seenAt: 40 } };
  const n = e.run(`(() => { const it = ${JSON.stringify(items)}; const n = dropSeenOnly(it, 0.5); return [n, Object.keys(it).sort()]; })()`); assert.equal(n[0], 2); assert.deepEqual(n[1], ["c", "d", "t", "w"]);
  assert.equal(e.run('dropSeenOnly({ a: { seenAt: 1 }, w: { wish: true } })'), 0, "a single look-only product is never dropped"); });
t("housekeeping sweeps vaults past 30 days and backups past 7 days even when under budget", async () => { const now = Date.now(), D = 864e5, e = env({ "vault:old": { at: now - 31 * D, data: {} }, "vault:ok": { at: now - 29 * D, data: {} }, "bak:v1": { t: now - 8 * D }, items: {} });
  const r = await e.run("housekeeping()"); assert.deepEqual(r.swept.sort(), ["bak:v1", "vault:old"]); assert.ok(e.store["vault:ok"] && !e.store["vault:old"] && !e.store["bak:v1"]); });
(async () => { for (const [n, f] of q) { try { await f(); ok++; console.log("  ok   " + n); } catch (e) { bad++; console.log("  FAIL " + n + "\n       " + String(e.message).split("\n")[0]); } } console.log(`\nstate: ${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0); })();
