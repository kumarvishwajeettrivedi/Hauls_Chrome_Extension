// S3: schema versioning for persisted data. To change a stored format: append a migration with the next `v` and make `up` idempotent.⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​​‌‌​‌‌‌​‌‌​​​​‌​‌‌​​​‌‌​​‌‌​​​​​‌‌​​​‌‌​​‌‌‌​​​​​‌‌​‌​‌​​‌‌​‌‌‌⁡
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
// Soft budget for chrome.storage.local (hard quota is 10 MB). Over 80%: evict in this order until under: caches, shared charts, community history, old backups, then vaults (expired first, then the oldest).
// Items and the outbox are never touched here (housekeeping drops look-only products as a last resort).
const STORAGE_BUDGET = 5 * 1024 * 1024, EVICT_ORDER = ["cache:grocery", "chartCache", "histCache", "cache:hist", "cache:geo", "cache:dmart", "cache:flags"], BAK_TTL = 7 * 864e5;
async function enforceBudget({ st = chrome.storage.local, budget = STORAGE_BUDGET, cacheApi = typeof cache !== "undefined" ? cache : null } = {}) {
  const before = await st.getBytesInUse(null), limit = budget * 0.8, evicted = [];
  if (before <= limit) return { before, after: before, evicted, over: false };
  const all = await st.get(null), vttl = typeof VAULT_TTL === "number" ? VAULT_TTL : 30 * 864e5, now = Date.now();
  const vaults = Object.keys(all).filter(k => k.startsWith("vault:")).sort((a, b) => ((now - ((all[a] || {}).at || 0) > vttl ? 0 : 1) - (now - ((all[b] || {}).at || 0) > vttl ? 0 : 1)) || ((all[a] || {}).at || 0) - ((all[b] || {}).at || 0));
  let cur = before;
  for (const k of [...EVICT_ORDER, ...Object.keys(all).filter(k => k.startsWith("bak:")), ...vaults]) { if (cur <= limit) break; if (!(k in all)) continue; if (cacheApi && k.startsWith("cache:")) await cacheApi.clear(k.slice(6)); await st.remove(k); evicted.push(k); cur = await st.getBytesInUse(null); }
  return { before, after: cur, evicted, over: cur > limit }; // over:true = what is left (items, outbox, settings) is still above the soft budget
}
// Last resort: forget the oldest products that were only looked at (not hearted, no alert). The newest look-only one always stays. Mutates `items`; returns how many were dropped.
function dropSeenOnly(items, share = 0.25) {
  const ks = Object.keys(items).filter(k => !(items[k] && (items[k].wish || items[k].target > 0))).sort((a, b) => ((items[a] || {}).seenAt || 0) - ((items[b] || {}).seenAt || 0)); if (ks.length < 2) return 0;
  const n = Math.min(ks.length - 1, Math.max(1, Math.ceil(ks.length * share))); for (const k of ks.slice(0, n)) delete items[k]; return n;
}
// Own history is kept 400 days. The price in force at the cut-off is kept (clamped to the cut-off) so charts still start correctly.
const HISTORY_DAYS = 400;
function pruneHistory(hist, now = Date.now()) {
  const cut = now - HISTORY_DAYS * 864e5, keep = hist.filter(p => p[0] >= cut), before = hist.filter(p => p[0] < cut).pop();
  return before && (!keep.length || keep[0][0] > cut) ? [[cut, before[1]], ...keep] : keep;
}
async function housekeeping({ st = chrome.storage.local, now = Date.now() } = {}) {
  let pruned = 0, dropped = 0;
  await withLock(async () => { const items = safeItems((await st.get("items")).items); let changed = false;
    for (const it of Object.values(items)) { const h = pruneHistory(it.hist, now); if (h.length !== it.hist.length) { pruned += it.hist.length - h.length; it.hist = h; changed = true; } }
    if (changed) await st.set({ items }); });
  const all = await st.get(null), vttl = typeof VAULT_TTL === "number" ? VAULT_TTL : 30 * 864e5; // vaults past their 30 days and backups past 7 are never read again
  const stale = Object.keys(all).filter(k => (k.startsWith("vault:") && now - ((all[k] || {}).at || 0) > vttl) || (k.startsWith("bak:") && now - ((all[k] || {}).t || 0) > BAK_TTL)); if (stale.length) await st.remove(stale);
  let budget = await enforceBudget({ st });
  if (budget.over) await withLock(async () => { const items = safeItems((await st.get("items")).items); let n = 0; // still over: look-only products go, oldest first, until it fits
    while (budget.over && (n = dropSeenOnly(items))) { dropped += n; await st.set({ items }); const after = await st.getBytesInUse(null); budget = { ...budget, after, over: after > STORAGE_BUDGET * 0.8 }; } });
  return { pruned, dropped, swept: stale, budget };
}
if (typeof module !== "undefined") module.exports = { MIGRATIONS, runMigrations, RULES, invalidate, enforceBudget, dropSeenOnly, pruneHistory, housekeeping, STORAGE_BUDGET, HISTORY_DAYS };
