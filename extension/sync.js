// Browser-first sync: chrome.storage.local is the source of truth for the UI; Supabase is the backup/sharing layer.⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​​‌‌​‌‌‌​‌‌​​‌​‌​​‌‌​​​​​​‌‌​​‌‌​‌‌​​​​‌​​‌‌‌​​​​‌‌​​‌​‌​​‌‌​‌​​⁡
// Local changes go to an outbox and are flushed when signed in. Pure helpers below are unit-tested.
const OUTBOX_MAX = 500, DAY_MS = 864e5, COMM_TTL = 6 * 3600e3, MAX_TRIES = 10, DROP_TTL = 7 * 864e5;
// Serialises every read-modify-write of chrome.storage state so concurrent messages/alarms can't overwrite each other.
let _lockChain = Promise.resolve();
const withLock = fn => { const run = _lockChain.then(fn, fn); _lockChain = run.then(() => {}, () => {}); return run; };
const dayOf = t => typeof t === "number" ? new Date(t).toISOString().slice(0, 10) : String(t).slice(0, 10);

// Keep one pending 'watch' op per product (latest wins); observations dedupe on key+day+price.
function coalesce(outbox, op) {
  const out = outbox.filter(o => !(op.t === "watch" && o.t === "watch" && o.key === op.key) && !(op.t === "chart" && o.t === "chart" && o.key === op.key && o.range === op.range) && !(op.t === "obs" && o.t === "obs" && o.key === op.key && o.price === op.price && dayOf(o.at) === dayOf(op.at)));
  out.push(op);
  const over = out.length - OUTBOX_MAX; if (over <= 0) return out;
  const rank = o => o.t === "watch" ? (o.deleted ? 2 : 1) : 0, drop = new Set(out.map((o, i) => [rank(o), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, over).map(x => x[1])); // full: oldest observations/charts go first; a pending delete is the last thing to lose
  return out.filter((_, i) => !drop.has(i));
}
// Outbound boundary: whatever sits in the outbox, only normalised text/https URLs/bounded numbers reach the server (the database CHECKs are the second wall).
const pricey = v => typeof v === "number" && v > 0 && v < 1e7 ? v : null;
const toWatchRow = (uid, op) => { const u = Number.isFinite(op.u) ? op.u : Date.now(); return { user_id: uid, product_key: op.key, site: cleanText(op.site, 60) || null, title: cleanText(op.title, 500) || null, url: cleanUrl(op.url, 500), image: cleanUrl(op.image, 500),
  target_price: pricey(op.target), wish: !!op.wish, last_price: pricey(op.last), deleted_at: op.deleted ? new Date(u).toISOString() : null, updated_at: new Date(u).toISOString() }; }; // updated_at is the time of the edit on this device, never "now" at upload time
// Chart series for the shared history: [[epoch ms, price]] -> [[day number, price]], one point per day (the last wins), at most 130, last price = today's price.
function toChartArgs(op) {
  const byDay = new Map(); for (const [t, p] of op.series) byDay.set(Math.floor(t / DAY_MS), Math.round(p * 100) / 100);
  let pts = [...byDay.entries()].sort((a, b) => a[0] - b[0]); if (pts.length > 130) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 129) === 0 || i === pts.length - 1).slice(-130);
  return { p_key: op.key, p_range: op.range <= 45 ? 30 : op.range <= 120 ? 90 : 365, p_series: pts.map(([d, p]) => [d, p]), p_current: op.current };
}
const toObsRow = op => ({ product_key: op.key, site: cleanText(op.site, 60), price: op.price, mrp: pricey(op.mrp), observed_at: new Date(op.at).toISOString(), src: ["dom", "jsonld", "meta", "bg"].includes(op.src) ? op.src : "dom" });

// Last-write-wins merge of a server watchlist row into a local item. Returns the item (new object) or null when local is newer.
function mergeWatchRow(local, row) {
  if (!row || typeof row !== "object") return null; // server text is untrusted too: normalised once here, on its way into storage
  const ms = Date.parse(row.updated_at) || 0; if (local && (local.u || 0) >= ms) return null;
  const lp = pricey(+row.last_price) || 0, it = { ...(local || { hist: [] }), site: cleanText(row.site, 60) || (local && local.site), title: cleanText(row.title, 500) || (local && local.title), url: cleanUrl(row.url) || (local && local.url), image: cleanUrl(row.image) || (local && local.image), last: lp || (local && local.last), u: ms };
  const last = local && local.hist && local.hist.length ? local.hist[local.hist.length - 1][1] : lp;
  if (row.deleted_at) { it.wish = false; delete it.target; delete it.wishPrice; } else {
    it.wish = !!row.wish;
    if (pricey(+row.target_price)) { const tg = +row.target_price; if (!local || local.target !== tg) { it.armed = !(last > 0 && last <= tg); it.notified = null; } it.target = tg; } // a target set elsewhere never alerts on arrival: armed only while the price is still above it
    else delete it.target;
    if (!it.wish) delete it.wishPrice; else if (!(it.wishPrice > 0) && last > 0) it.wishPrice = last; // a heart from another device: the default alert is measured from the price known now
  }
  return it;
}
async function storeGet(k) { return (await chrome.storage.local.get(k))[k]; }
const opId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
async function enqueue(op) { return withLock(async () => { const ob = safeOutbox(await storeGet("outbox")); await chrome.storage.local.set({ outbox: coalesce(ob, { ...op, id: opId() }) }); }); }

// Push the outbox. Only ops that were actually delivered (or are permanently rejected, 4xx) are removed; anything enqueued meanwhile is kept.
// 4xx is the server's final answer, except: 401 (token), 404 (not deployed yet), 408/429 (try later). Everything else is retried; an op the server keeps answering with an error for MAX_TRIES flushes is dropped (offline failures are not counted).
const isClientErr = e => { const st = e && e.status, m = String(e && e.message || e);
  if (st >= 400 && st < 500) return ![401, 404, 408, 429].includes(st);
  if (!st && /^(HTTP )?4\d\d/.test(m)) return !/^(HTTP )?(401|404|408|429)/.test(m);
  return /"code":"(23|22|42|P0001)|watchlist_limit_reached|violates|invalid input|check constraint/i.test(m); };
// One flush at a time (overlapping ones would send the same ops twice and an older request could land after a newer one); calls made meanwhile get one more pass.
let _flushing = null, _flushAgain = false;
function flush() {
  if (_flushing) { _flushAgain = true; return _flushing; }
  return _flushing = (async () => { try { let r; do { _flushAgain = false; r = await flush0(); } while (_flushAgain && r.ok); return r; } finally { _flushing = null; } })();
}
// Watchlist changes the server refused for good (or kept failing for MAX_TRIES flushes) are dropped from the outbox: remember how many, so Settings and the account sheet can say so. Ages out after 7 days; a clean "Sync now" clears it. (Dropped price points/charts are not the person's changes: not counted.)
const droppedCount = v => v && Number.isInteger(v.n) && v.n > 0 && Date.now() - v.at < DROP_TTL ? Math.min(v.n, 9999) : 0;
const clearDropped = since => withLock(async () => { const v = await storeGet("syncDropped"); if (v && !(v.at >= since)) await chrome.storage.local.remove("syncDropped"); }); // only what was dropped before this sync started
async function flush0() {
  const s = await getSession(); if (!s) return { ok: false, reason: "signed-out" };
  const uid = s.user.id, call = (p, o = {}) => api(p, { ...o, uid }); // every request is pinned to the account this flush started under
  const snap = await withLock(async () => (await ownerOk(uid)) ? { ob: safeOutbox(await storeGet("outbox")), profile: (await storeGet("profile")) || {} } : null); // owner check and outbox read are one step (and let any enqueue already waiting land first)
  if (!snap) return { ok: false, reason: "owner-mismatch" };
  const snapshot = snap.ob, profile = snap.profile, done = new Set(), failed = new Set(); let sent = 0, dropped = 0, lost = 0, failure = null;
  const fail = (e, ids) => { failure = e; if (e && e.status) ids.forEach(i => failed.add(i)); };
  const sendWatch = async list => call("/ext_watchlist?on_conflict=user_id,product_key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: list.map(o => toWatchRow(uid, o)) });
  const watch = snapshot.filter(o => o.t === "watch");
  if (watch.length) {
    try { await sendWatch(watch); watch.forEach(o => done.add(o.id)); sent += watch.length; }
    catch (e) { if (isClientErr(e)) { for (const o of watch) { try { await sendWatch([o]); done.add(o.id); sent++; } catch (e2) { if (isClientErr(e2)) { done.add(o.id); dropped++; lost++; } else { fail(e2, [o.id]); break; } } } } else fail(e, watch.map(o => o.id)); }
  }
  const obs = failure ? [] : snapshot.filter(o => o.t === "obs");
  for (let i = 0; i < obs.length && !failure; i += 50) {
    const batch = obs.slice(i, i + 50);
    try { if (profile.contribute === true) await call("/rpc/ext_upsert_observations", { method: "POST", body: { p_rows: batch.map(toObsRow) } }); batch.forEach(o => done.add(o.id)); sent += batch.length; }
    catch (e) { if (isClientErr(e)) { batch.forEach(o => done.add(o.id)); dropped += batch.length; } else fail(e, batch.map(o => o.id)); }
  }
  const charts = failure ? [] : snapshot.filter(o => o.t === "chart");
  for (const o of charts) { // false from the server (rate limit, validation) is an answer, not an error: the op is done either way
    try { if (profile.contribute === true) await call("/rpc/ext_submit_chart", { method: "POST", body: toChartArgs(o) }); done.add(o.id); sent++; }
    catch (e) { if (isClientErr(e)) { done.add(o.id); dropped++; } else { fail(e, [o.id]); break; } }
  }
  await withLock(async () => {
    if (await ownerOk(uid)) { const cur = safeOutbox(await storeGet("outbox")).filter(o => !done.has(o.id)).map(o => failed.has(o.id) ? { ...o, n: (o.n || 0) + 1 } : o).filter(o => (o.n || 0) < MAX_TRIES || (dropped++, lost += o.t === "watch" ? 1 : 0, false));
      await chrome.storage.local.set({ outbox: cur, ...(failure ? {} : { lastSync: Date.now() }), ...(lost ? { syncDropped: { n: droppedCount(await storeGet("syncDropped")) + lost, at: Date.now() } } : {}) }); }
    else if (done.size) { const vk = vaultKey(uid), v = await storeGet(vk); if (v && v.data && v.data.outbox) { v.data.outbox = v.data.outbox.filter(o => !done.has(o.id)); await chrome.storage.local.set({ [vk]: v }); } } // sign-out gave up waiting: what did get delivered must not be sent again from the vault
  });
  return failure ? { ok: false, reason: String(failure.message || failure).slice(0, 120), sent, dropped } : { ok: true, sent, dropped };
}

// ---- S2 account-switch protection: local data is tagged with the user id that owns it ----
// What belongs to the previous ACCOUNT on this device: content + personal settings (saved places, pincode, coordinates). Every SYNCED_SETTINGS key must be here (a unit test enforces it). Pure UI prefs (notch position) are not.
const CONTENT_KEYS = ["items", "outbox", "syncDropped", "histCache", "chartCache", "lastPull", "usage", "setStamps", "places", "pin", "range", "loc", "lastPin"];
// The device shows ONE account's data at a time. Whatever belongs to another account waits in a per-account vault and is never merged, shown or uploaded to a different account.
const VAULT_MAX = 3, VAULT_TTL = 30 * 864e5, VAULT_RECENT = 30, vaultKey = id => "vault:" + id;
const trimContent = ({ histCache, chartCache, ...d }) => { const items = d.items || {}, keep = {}, rest = Object.keys(items).filter(k => !(items[k] && (items[k].wish || items[k].target))).sort((a, b) => ((items[b].seenAt || 0) - (items[a].seenAt || 0))).slice(0, VAULT_RECENT); for (const k of Object.keys(items)) if (items[k] && (items[k].wish || items[k].target)) keep[k] = items[k]; for (const k of rest) keep[k] = items[k]; return { ...d, items: keep }; }; // a vault keeps watched products and the 30 most recent others, so storage stays small
async function vaultPut(ownerId, data) {
  if (!ownerId || !Object.keys(data).length) return;
  const all = await chrome.storage.local.get(null), now = Date.now(), vaults = Object.keys(all).filter(k => k.startsWith("vault:")).map(k => [k, all[k]]), expired = vaults.filter(([, v]) => !v || now - (v.at || 0) > VAULT_TTL).map(([k]) => k);
  const live = vaults.filter(([k]) => !expired.includes(k) && k !== vaultKey(ownerId)).sort((a, b) => b[1].at - a[1].at), drop = [...expired, ...live.slice(VAULT_MAX - 1).map(([k]) => k)]; // at most 3 vaults, none older than 30 days
  if (drop.length) await chrome.storage.local.remove(drop);
  await chrome.storage.local.set({ [vaultKey(ownerId)]: { at: now, data: trimContent(data) } });
}
async function clearVaults() { const keys = Object.keys(await chrome.storage.local.get(null)).filter(k => k.startsWith("vault:")); if (keys.length) await chrome.storage.local.remove(keys); }
// A different account signs in, or someone signs in on a device with anonymous data: "same" | "adopted" (anonymous local data joins this account) | "switched" (the previous account's data went to its vault)
const ownerOk = async uid => { const { localOwner } = await chrome.storage.local.get("localOwner"); return !!uid && localOwner === uid; }; // fail closed: sync only while the live data is tagged as THIS account's (afterSignIn / claimLegacyOwner tag it first)
// A session from before owners were tagged: its data is that account's, so tag it (no-op when already tagged or signed out).
async function claimLegacyOwner() { const s = await sessionStore.get(); if (s && s.user && s.user.id) await claimOwner(s.user.id); }
async function claimOwner(userId) { return withLock(() => claimOwner0(userId)); }
const mergeHist = (a = [], b = []) => { const m = new Map(); for (const p of [...b, ...a]) m.set(p[0], p); return [...m.values()].sort((x, y) => x[0] - y[0]); }; // union by timestamp, the first list wins a tie
// The account's saved copy (mine) and what was browsed while signed out (anon): per product the saved flags/target/refs win and the histories are merged; usage and lastPull stay the account's.
function mergeAnon(mine, anon) {
  const out = { ...mine, ...anon }; for (const k of ["usage", "lastPull"]) if (k in mine) out[k] = mine[k];
  if (mine.items || anon.items) { const mi = mine.items || {}, ai = anon.items || {}; out.items = { ...ai, ...mi };
    for (const k of Object.keys(ai)) if (mi[k]) { const seenAt = Math.max(mi[k].seenAt || 0, ai[k].seenAt || 0); out.items[k] = { ...ai[k], ...mi[k], hist: mergeHist(mi[k].hist, ai[k].hist), ...(seenAt ? { seenAt } : {}) }; } }
  if (mine.outbox || anon.outbox) out.outbox = [...(mine.outbox || []), ...(anon.outbox || [])];
  return out;
}
async function claimOwner0(userId) {
  const { localOwner } = await chrome.storage.local.get("localOwner"); if (localOwner === userId) return "same";
  const live = await chrome.storage.local.get(CONTENT_KEYS); let anon = {};
  if (localOwner) { await vaultPut(localOwner, live); await chrome.storage.local.remove(CONTENT_KEYS); } else anon = live; // anonymous data is adopted; another account's data is put away (vault written BEFORE the live copy goes), not merged
  const vk = vaultKey(userId), v = (await chrome.storage.local.get(vk))[vk], mine = v && Date.now() - (v.at || 0) <= VAULT_TTL ? v.data || {} : {};
  const merged = mergeAnon(mine, anon), keep = Object.fromEntries(CONTENT_KEYS.filter(k => Object.hasOwn(merged, k)).map(k => [k, merged[k]])); // a vault only ever restores content keys, normalised: never session/plan/flags or unknown keys
  if (keep.items) keep.items = safeItems(keep.items); if (keep.outbox) keep.outbox = safeOutbox(keep.outbox);
  await chrome.storage.local.set({ ...keep, localOwner: userId }); await chrome.storage.local.remove(vk); return localOwner ? "switched" : "adopted";
}
// Sign-out (or a session that can no longer be used): the account's data leaves the live view; unsent changes are kept in its vault for its next sign-in.
async function releaseOwner(hint) { return withLock(() => releaseOwner0(hint)); }
async function releaseOwner0(hint) { const { localOwner } = await chrome.storage.local.get("localOwner"), owner = localOwner || hint; if (!owner) return; /* anonymous data belongs to nobody: it stays */ await vaultPut(owner, await chrome.storage.local.get(CONTENT_KEYS)); await chrome.storage.local.remove([...CONTENT_KEYS, "localOwner"]); } // vault first, then the live copy goes: a crash in between loses nothing
// Creates the profile row if it's missing (e.g. after "delete my data" and a fresh sign-in).
async function ensureProfile() { try { await api("/rpc/ext_ensure_profile", { method: "POST", body: {} }); } catch {} }
// Server profile -> storage: only known fields, normalised. The phone rule is the same +91 one the extension sends (guard.js); anything else is dropped.
const cleanProfile = p => ({ plan: planOf(p.plan), contribute: p.contribute === true, name: cleanText(p.name, 80), phone: typeof p.phone === "string" && /^\+91[6-9][0-9]{9}$/.test(p.phone) ? p.phone : null, avatar_url: cleanUrl(p.avatar_url), email_alerts: p.email_alerts === true });
async function pullProfile(uid) {
  const s = await getSession(); if (!s || (uid && s.user.id !== uid)) return null;
  const rows = await api(`/ext_profiles?select=plan,contribute,name,phone,avatar_url,email_alerts&id=eq.${s.user.id}`, { uid: s.user.id }); const p = rows && rows[0];
  if (p) await withLock(async () => { if (await ownerOk(s.user.id)) await chrome.storage.local.set({ profile: cleanProfile(p), plan: planOf(p.plan) }); }); return p || null;
}
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/;
async function pull() {
  const s = await getSession(); if (!s) return { ok: false, reason: "signed-out" };
  const uid = s.user.id; if (!(await ownerOk(uid))) return { ok: false, reason: "owner-mismatch" };
  try {
    await pullProfile(uid); await syncSettings(uid).catch(() => {});
    const since = (await storeGet("lastPull")) || "1970-01-01T00:00:00Z", rows = await api(`/ext_watchlist?select=*&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc&limit=500`, { uid });
    return await withLock(async () => { const cur = await sessionStore.get(); if (!cur || !cur.user || cur.user.id !== uid || !(await ownerOk(uid))) return { ok: false, reason: "owner-mismatch" }; // signed out or switched while the answer was on its way: it is not applied
      const items = safeItems(await storeGet("items")); let changed = 0, last = since;
      for (const r of Array.isArray(rows) ? rows.slice(0, 500) : []) { if (!r || typeof r !== "object") continue;
        if (okKey(r.product_key)) { const m = mergeWatchRow(items[r.product_key], r); if (m) { items[r.product_key] = m; changed++; } } // a "__proto__"/"constructor" key would write through Object.prototype
        if (ISO_TS.test(String(r.updated_at)) && r.updated_at > last) last = r.updated_at; } // a garbage cursor would make every later pull ask the server for nonsense
      await chrome.storage.local.set({ items, lastPull: last, lastSync: Date.now() }); return { ok: true, changed }; });
  } catch (e) { return { ok: false, reason: String(e.message || e).slice(0, 120) }; }
}
// ---- S5: settings that follow the Google account. Per-key last-write-wins; device-only state (notch position, panel state, theme) is NOT listed here.
const SYNCED_SETTINGS = { pin: v => typeof v === "string" && /^(\d{6})?$/.test(v), range: v => ["30D", "90D", "1Y", "All"].includes(v),
  places: v => Array.isArray(v) && v.length <= MAX_PLACES && safePlaces(v).length === v.length }; // saved delivery places (lib.js): the whole list is one setting, newest edit wins
const stampOf = (stamps, k) => stamps && Number.isFinite(stamps[k]) ? stamps[k] : 0;
// What we send: every stamped, valid local value (the server decides who wins per key).
function settingsToPush(local, stamps) {
  const doc = {}, st = {}; for (const k of Object.keys(SYNCED_SETTINGS)) if (stampOf(stamps, k) > 0 && SYNCED_SETTINGS[k](local[k])) { doc[k] = local[k]; st[k] = stamps[k]; }
  return { doc, stamps: st };
}
// What we apply from the server's merged result: only keys whose server stamp is strictly newer than ours, and only valid values.
function settingsFromServer(stamps, server) {
  const values = {}, st = {}; const d = (server && server.doc) || {}, ss = (server && server.stamps) || {};
  for (const k of Object.keys(SYNCED_SETTINGS)) if (stampOf(ss, k) > stampOf(stamps, k) && SYNCED_SETTINGS[k](d[k])) { values[k] = k === "places" ? safePlaces(d[k]) : d[k]; st[k] = ss[k]; } // places are rebuilt: extra keys / oversize fields on a place never reach storage
  return { values, stamps: st };
}
async function syncSettings(uid) {
  const s0 = await getSession(); if (!s0 || (uid && s0.user.id !== uid)) return false;
  const keys = [...Object.keys(SYNCED_SETTINGS), "setStamps"], now = await chrome.storage.local.get(keys), { doc, stamps } = settingsToPush(now, now.setStamps);
  const srv = await api("/rpc/ext_merge_settings", { method: "POST", body: { p_doc: doc, p_stamps: stamps }, uid: s0.user.id });
  return withLock(async () => {
    const s1 = await sessionStore.get(); if (!s1 || s1.user.id !== s0.user.id) return false; // signed out meanwhile: the answer is not applied
    const cur = await chrome.storage.local.get(keys), { values, stamps: ns } = settingsFromServer(cur.setStamps, srv); if (!Object.keys(values).length) return false;
    // One write carries values + stamps, so the onChanged stamper (background.js) can tell this is a sync write and not a user edit.
    await chrome.storage.local.set({ ...values, setStamps: { ...(cur.setStamps || {}), ...ns } });
    if ("pin" in values) await chrome.storage.local.remove("loc"); // coordinates belonged to the old pincode; re-geocoded on next use
    return true;
  });
}
// Called by the storage.onChanged listener when the user edits a synced setting.
const stampSettings = keys => withLock(async () => { const { setStamps } = await chrome.storage.local.get("setStamps"), t = Date.now(); await chrome.storage.local.set({ setStamps: { ...(setStamps || {}), ...Object.fromEntries(keys.map(k => [k, t])) } }); });
// Community history for one product, cached for 6h. Resolves with [] when signed out or on failure.
async function fetchCommunity(key) {
  if (!okKey(key)) return [];
  const cache = (await storeGet("histCache")) || {}, c = cache[key]; if (c && Date.now() - c.t < COMM_TTL) return c.rows;
  if (!(await getSession())) return [];
  try { let rows = ((await api("/rpc/ext_price_history", { method: "POST", body: { p_key: key, p_days: 1095 } })) || []); if (!Array.isArray(rows)) throw 0; rows = rows.slice(0, 1500).filter(r => r && typeof r === "object" && /^\d{4}-\d{2}-\d{2}/.test(String(r.day)) && +r.median_price > 0 && +r.median_price < 1e7).map(r => ({ day: String(r.day).slice(0, 10), median_price: +r.median_price })); cache[key] = { t: Date.now(), rows }; const keys = Object.keys(cache); if (keys.length > 60) delete cache[keys.sort((a, b) => cache[a].t - cache[b].t)[0]]; await chrome.storage.local.set({ histCache: cache }); return rows; }
  catch { return (c && c.rows) || []; }
}
// Shared chart series for one product (consensus of opt-in readers, >= 2-3 reporters per day). Signed-in only; cached 6h; resolves [] on any failure.
async function fetchChart(key) {
  if (!okKey(key)) return [];
  const cache = (await storeGet("chartCache")) || {}, c = cache[key]; if (c && Date.now() - c.t < COMM_TTL) return c.rows;
  if (!(await getSession())) return [];
  try {
    const rows = ((await api("/rpc/ext_get_chart", { method: "POST", body: { p_key: key } })) || []).filter(x => x && /^\d{4}-\d{2}-\d{2}/.test(String(x.day)) && +x.price > 0 && +x.price < 1e7).slice(0, 800).map(x => ({ day: String(x.day).slice(0, 10), price: +x.price, reporters: Math.min(1e6, +x.reporters || 1) }));
    cache[key] = { t: Date.now(), rows }; const keys = Object.keys(cache); if (keys.length > 60) delete cache[keys.sort((a2, b2) => cache[a2].t - cache[b2].t)[0]]; await chrome.storage.local.set({ chartCache: cache }); return rows;
  } catch { return (c && c.rows) || []; }
}
if (typeof module !== "undefined") module.exports = { droppedCount, clearDropped, toChartArgs, SYNCED_SETTINGS, settingsToPush, settingsFromServer, syncSettings, stampSettings, claimOwner, claimLegacyOwner, mergeAnon, releaseOwner, clearVaults, flush, isClientErr, VAULT_MAX, CONTENT_KEYS, coalesce, toWatchRow, toObsRow, mergeWatchRow };
