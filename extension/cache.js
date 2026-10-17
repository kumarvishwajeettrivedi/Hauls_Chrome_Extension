// Layered cache: L1 in-memory Map (LRU order = insertion order) + L2 chrome.storage.local under "cache:<ns>".
// Values must be JSON-safe. Storage failures are swallowed: the cache then behaves as memory-only.
function makeCache({ storage, cap = 60, maxBytes = 200 * 1024 } = {}) {
  const st = storage !== undefined ? storage : (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;
  const ns = new Map(), loading = new Map(), inflight = new Map(); let chain = Promise.resolve();
  const load = n => { // L2 -> L1, once per namespace
    if (!loading.has(n)) loading.set(n, (async () => {
      const m = new Map(); ns.set(n, m);
      try { const o = (await st.get("cache:" + n))["cache:" + n]; if (o && typeof o === "object") for (const [k, e] of Object.entries(o)) if (e && typeof e.x === "number") m.set(k, e); } catch (_) {}
      return m;
    })());
    return loading.get(n);
  };
  const save = (n, m) => { // ponytail: whole-namespace rewrite, serialised; fine at <=60 small entries
    if (!st) return chain;
    return (chain = chain.then(() => st.set({ ["cache:" + n]: Object.fromEntries(m) })).catch(() => {}));
  };
  const entry = async (n, k) => { const m = await load(n), e = m.get(k); if (e) { m.delete(k); m.set(k, e); } return e; }; // touch = LRU bump
  const get = async (n, k) => { const e = await entry(n, k); if (!e) return undefined; if (e.x <= Date.now()) { (await load(n)).delete(k); return undefined; } return e.v; };
  async function set(n, k, v, ttlMs) {
    if (v === undefined) return;
    let s; try { s = JSON.stringify(v); } catch (_) { return; }
    if (s === undefined || s.length > maxBytes) return;
    const m = await load(n); m.delete(k); m.set(k, { v: JSON.parse(s), x: Date.now() + ttlMs });
    while (m.size > cap) m.delete(m.keys().next().value);
    await save(n, m);
  }
  // Cached call. Concurrent calls for one key share a single fn(). staleWhileRevalidate: return an expired value now, refresh behind it.
  async function wrap(n, k, ttlMs, fn, { staleWhileRevalidate = false } = {}) {
    const e = await entry(n, k), fresh = e && e.x > Date.now();
    if (fresh) return e.v;
    const id = n + "\u0000" + k, run = () => {
      if (!inflight.has(id)) inflight.set(id, Promise.resolve().then(fn).then(async v => { await set(n, k, v, ttlMs); return v; }).finally(() => inflight.delete(id)));
      return inflight.get(id);
    };
    if (e && staleWhileRevalidate) { run().catch(() => {}); return e.v; }
    return run();
  }
  async function clear(n) {
    if (n) { ns.set(n, new Map()); loading.set(n, Promise.resolve(ns.get(n))); if (st) try { await st.remove("cache:" + n); } catch (_) {} return; }
    ns.clear(); loading.clear();
    if (st) try { const all = await st.get(null); await st.remove(Object.keys(all).filter(k => k.startsWith("cache:"))); } catch (_) {}
  }
  return { get, set, wrap, clear };
}
const cache = makeCache();
if (typeof module !== "undefined") module.exports = { cache, makeCache };
