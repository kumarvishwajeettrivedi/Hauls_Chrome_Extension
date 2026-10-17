// S3: safe readers + schema migrations, against an in-memory chrome.storage. No browser.
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const src = f => fs.readFileSync(path.join(__dirname, "../../extension", f), "utf8");
function env(initial = {}) {
  const store = JSON.parse(JSON.stringify(initial)), st = { async get(k) { const ks = k == null ? Object.keys(store) : [].concat(k), o = {}; ks.forEach(x => { if (x in store) o[x] = JSON.parse(JSON.stringify(store[x])); }); return o; },
    async set(o) { Object.entries(o).forEach(([k, v]) => { store[k] = JSON.parse(JSON.stringify(v)); }); }, async remove(k) { [].concat(k).forEach(x => delete store[x]); } };
  const ctx = vm.createContext({ chrome: { storage: { local: st } }, crypto: globalThis.crypto, Date, JSON, Math, Array, Object, Promise, isFinite, console });
  vm.runInContext(src("lib.js"), ctx); vm.runInContext(src("state.js"), ctx); return { store, st, run: c => vm.runInContext(c, ctx) };
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
  const out = e.run('safeOutbox([{ t: "watch", key: "a" }, { t: "obs", key: "b", id: "keep" }, { t: "evil", key: "c" }, null, "x", { t: "watch" }, { t: "watch", key: 5 }])'); assert.equal(out.length, 2); assert.ok(out[0].id && out[0].id.length > 5); assert.equal(out[1].id, "keep");
  assert.equal(e.run('safeOutbox(Array.from({ length: 700 }, (_, i) => ({ t: "obs", key: "k" + i, id: "i" + i })))').length, 500); for (const bad of ['null', '{}', '"x"']) assert.deepEqual(e.run(`safeOutbox(${bad})`), []); });
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
(async () => { for (const [n, f] of q) { try { await f(); ok++; console.log("  ok   " + n); } catch (e) { bad++; console.log("  FAIL " + n + "\n       " + String(e.message).split("\n")[0]); } } console.log(`\nstate: ${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0); })();
