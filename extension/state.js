// S3: schema versioning for persisted data. To change a stored format: append a migration with the next `v` and make `up` idempotent.
// A store written by a NEWER build is never touched (forward-compatible); anything repaired is first backed up under `bak:v<N>`.
const MIGRATIONS = [
  { v: 1, name: "normalise items / outbox / usage", async up(st) {
    const raw = await st.get(["items", "outbox", "usage"]), fixed = { items: safeItems(raw.items), outbox: safeOutbox(raw.outbox), usage: safeUsage(raw.usage) };
    const changed = ["items", "outbox", "usage"].filter(k => raw[k] !== undefined && JSON.stringify(raw[k]) !== JSON.stringify(fixed[k] === null ? undefined : fixed[k]));
    if (changed.length) await st.set({ "bak:v1": { t: Date.now(), ...Object.fromEntries(changed.map(k => [k, raw[k]])) } });
    for (const k of changed) { if (fixed[k] === null) await st.remove(k); else await st.set({ [k]: fixed[k] }); }
  } },
];
async function runMigrations(st = chrome.storage.local) {
  const { schemaVersion = 0 } = await st.get("schemaVersion"), latest = MIGRATIONS[MIGRATIONS.length - 1].v;
  if (schemaVersion >= latest) return { from: schemaVersion, to: schemaVersion, ran: 0 };
  let ran = 0;
  for (const m of MIGRATIONS) if (m.v > schemaVersion) { await m.up(st); await st.set({ schemaVersion: m.v }); ran++; }
  return { from: schemaVersion, to: latest, ran };
}
// ---- S4: ONE place that decides what to forget. Only class F caches are ever cleared here; user content (items, settings, outbox, session) is never evicted. ----
const CACHE_NS = ["grocery", "geo", "dmart", "flags", "breaker", "hist"];
const RULES = { // reason -> what to forget
  "pin-change": { ns: ["grocery"] },                       // results were fetched for another location
  "flags-change": { ns: ["grocery", "breaker"] },          // a store/site was paused or resumed remotely
  "schema-upgrade": { all: true, keys: ["histCache"] },    // extension updated its stored format
  "user-clear-cache": { all: true, keys: ["histCache"] },  // the "Clear cache" button
};
async function invalidate(reason, { st = chrome.storage.local, cacheApi = typeof cache !== "undefined" ? cache : null } = {}) {
  const rule = Object.prototype.hasOwnProperty.call(RULES, reason) ? RULES[reason] : null; if (!rule) return { ok: false, reason: "unknown-reason" }; // own keys only: "__proto__"/"constructor" are not reasons
  const cleared = [];
  if (cacheApi) for (const ns of rule.all ? CACHE_NS : rule.ns) { await cacheApi.clear(ns); cleared.push(ns); }
  const all = await st.get(null), keys = [...(rule.keys || []), ...(rule.all ? Object.keys(all).filter(k => k.startsWith("cache:")) : [])].filter(k => k in all);
  if (keys.length) await st.remove(keys);
  return { ok: true, cleared, removed: keys };
}
// Soft budget for chrome.storage.local (hard quota is 10 MB). Over 80%: evict caches in this order until under; user content is never touched.
const STORAGE_BUDGET = 5 * 1024 * 1024, EVICT_ORDER = ["cache:grocery", "histCache", "cache:hist", "cache:geo", "cache:dmart", "cache:flags"];
async function enforceBudget({ st = chrome.storage.local, budget = STORAGE_BUDGET, cacheApi = typeof cache !== "undefined" ? cache : null } = {}) {
  const before = await st.getBytesInUse(null), limit = budget * 0.8, evicted = [];
  if (before <= limit) return { before, after: before, evicted, over: false };
  let now = before;
  for (const k of EVICT_ORDER) { if (now <= limit) break; if (cacheApi && k.startsWith("cache:")) await cacheApi.clear(k.slice(6)); await st.remove(k); evicted.push(k); now = await st.getBytesInUse(null); }
  return { before, after: now, evicted, over: now > limit }; // over:true = user content alone is above the soft budget; we never delete it
}
// Own history is kept 400 days. The price in force at the cut-off is kept (clamped to the cut-off) so charts still start correctly.
const HISTORY_DAYS = 400;
function pruneHistory(hist, now = Date.now()) {
  const cut = now - HISTORY_DAYS * 864e5, keep = hist.filter(p => p[0] >= cut), before = hist.filter(p => p[0] < cut).pop();
  return before && (!keep.length || keep[0][0] > cut) ? [[cut, before[1]], ...keep] : keep;
}
async function housekeeping({ st = chrome.storage.local, now = Date.now() } = {}) {
  let pruned = 0;
  await withLock(async () => { const items = safeItems((await st.get("items")).items); let changed = false;
    for (const it of Object.values(items)) { const h = pruneHistory(it.hist, now); if (h.length !== it.hist.length) { pruned += it.hist.length - h.length; it.hist = h; changed = true; } }
    if (changed) await st.set({ items }); });
  return { pruned, budget: await enforceBudget({ st }) };
}
if (typeof module !== "undefined") module.exports = { MIGRATIONS, runMigrations, RULES, invalidate, enforceBudget, pruneHistory, housekeeping, STORAGE_BUDGET, HISTORY_DAYS };
