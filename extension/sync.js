// Browser-first sync: chrome.storage.local is the source of truth for the UI; Supabase is the backup/sharing layer.
// Local changes go to an outbox and are flushed when signed in. Pure helpers below are unit-tested.
const OUTBOX_MAX = 500, DAY_MS = 864e5, COMM_TTL = 6 * 3600e3;
// Serialises every read-modify-write of chrome.storage state so concurrent messages/alarms can't overwrite each other.
let _lockChain = Promise.resolve();
const withLock = fn => { const run = _lockChain.then(fn, fn); _lockChain = run.then(() => {}, () => {}); return run; };
const dayOf = t => typeof t === "number" ? new Date(t).toISOString().slice(0, 10) : String(t).slice(0, 10);
const httpsOnly = u => typeof u === "string" && /^https:\/\//i.test(u) ? u : undefined;

// Keep one pending 'watch' op per product (latest wins); observations dedupe on key+day+price.
function coalesce(outbox, op) {
  const out = outbox.filter(o => !(op.t === "watch" && o.t === "watch" && o.key === op.key) && !(op.t === "obs" && o.t === "obs" && o.key === op.key && o.price === op.price && dayOf(o.at) === dayOf(op.at)));
  out.push(op); return out.slice(-OUTBOX_MAX);
}
const toWatchRow = (uid, op) => ({ user_id: uid, product_key: op.key, site: op.site || null, title: op.title || null, url: op.url || null, image: op.image || null,
  target_price: op.target || null, wish: !!op.wish, last_price: op.last || null, deleted_at: op.deleted ? new Date(op.u).toISOString() : null, updated_at: new Date(op.u).toISOString() });
const toObsRow = op => ({ product_key: op.key, site: op.site, price: op.price, mrp: op.mrp || null, observed_at: new Date(op.at).toISOString(), src: op.src || "dom" });

// Last-write-wins merge of a server watchlist row into a local item. Returns the item (new object) or null when local is newer.
function mergeWatchRow(local, row) {
  const ms = Date.parse(row.updated_at) || 0; if (local && (local.u || 0) >= ms) return null;
  const it = { ...(local || { hist: [] }), site: row.site || (local && local.site), title: row.title || (local && local.title), url: httpsOnly(row.url) || (local && local.url), image: httpsOnly(row.image) || (local && local.image), last: +row.last_price > 0 ? +row.last_price : (local && local.last), u: ms };
  if (row.deleted_at) { it.wish = false; delete it.target; } else { it.wish = !!row.wish; if (row.target_price) it.target = +row.target_price; else delete it.target; }
  return it;
}
async function storeGet(k) { return (await chrome.storage.local.get(k))[k]; }
const opId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
async function enqueue(op) { return withLock(async () => { const ob = safeOutbox(await storeGet("outbox")); await chrome.storage.local.set({ outbox: coalesce(ob, { ...op, id: opId() }) }); }); }

// Push the outbox. Only ops that were actually delivered (or are permanently rejected, 4xx) are removed; anything enqueued meanwhile is kept.
const isClientErr = e => /^(HTTP )?4\d\d|"code":"(23|22|42|P0001)/.test(String(e && e.message || e)) || /watchlist_limit_reached|violates|invalid input|check constraint/i.test(String(e && e.message || e));
async function flush() {
  const s = await getSession(); if (!s) return { ok: false, reason: "signed-out" };
  if (await storeGet("pendingSwitch")) return { ok: false, reason: "account-switch-pending" };
  const snapshot = safeOutbox(await storeGet("outbox")), profile = (await storeGet("profile")) || {}, done = new Set(); let sent = 0, dropped = 0, failure = null;
  const sendWatch = async list => api("/ext_watchlist?on_conflict=user_id,product_key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: list.map(o => toWatchRow(s.user.id, o)) });
  const watch = snapshot.filter(o => o.t === "watch");
  if (watch.length) {
    try { await sendWatch(watch); watch.forEach(o => done.add(o.id)); sent += watch.length; }
    catch (e) { if (isClientErr(e)) { for (const o of watch) { try { await sendWatch([o]); done.add(o.id); sent++; } catch (e2) { if (isClientErr(e2)) { done.add(o.id); dropped++; } else { failure = e2; break; } } } } else failure = e; }
  }
  const obs = failure ? [] : snapshot.filter(o => o.t === "obs");
  for (let i = 0; i < obs.length && !failure; i += 50) {
    const batch = obs.slice(i, i + 50);
    try { if (profile.contribute === true) await api("/rpc/ext_upsert_observations", { method: "POST", body: { p_rows: batch.map(toObsRow) } }); batch.forEach(o => done.add(o.id)); sent += batch.length; }
    catch (e) { if (isClientErr(e)) { batch.forEach(o => done.add(o.id)); dropped += batch.length; } else failure = e; }
  }
  await withLock(async () => { const cur = safeOutbox(await storeGet("outbox")); await chrome.storage.local.set({ outbox: cur.filter(o => !done.has(o.id)), ...(failure ? {} : { lastSync: Date.now() }) }); });
  return failure ? { ok: false, reason: String(failure.message || failure).slice(0, 120), sent, dropped } : { ok: true, sent, dropped };
}

// ---- S2 account-switch protection: local data is tagged with the user id that owns it ----
const CONTENT_KEYS = ["items", "outbox", "histCache", "lastPull", "usage"];
async function claimOwner(userId) {
  const { localOwner } = await chrome.storage.local.get("localOwner");
  if (!localOwner) { await chrome.storage.local.set({ localOwner: userId }); return "adopted"; } // anonymous local data joins the first account that signs in
  if (localOwner === userId) return "same";
  await chrome.storage.local.set({ pendingSwitch: { from: localOwner, to: userId } }); return "conflict"; // sync stays paused until the user chooses
}
async function resolveSwitch(choice) {
  const { pendingSwitch: p } = await chrome.storage.local.get("pendingSwitch"); if (!p) return "none";
  if (choice === "clear") await chrome.storage.local.remove(CONTENT_KEYS);
  if (choice === "clear" || choice === "merge") await chrome.storage.local.set({ localOwner: p.to });
  await chrome.storage.local.remove("pendingSwitch"); return choice === "clear" ? "cleared" : choice === "merge" ? "merged" : "cancelled";
}
// Creates the profile row if it's missing (e.g. after "delete my data" and a fresh sign-in).
async function ensureProfile() { try { await api("/rpc/ext_ensure_profile", { method: "POST", body: {} }); } catch {} }
async function pullProfile() {
  const s = await getSession(); if (!s) return null;
  const rows = await api(`/ext_profiles?select=plan,contribute,name,phone,avatar_url&id=eq.${s.user.id}`); const p = rows && rows[0];
  if (p) await chrome.storage.local.set({ profile: p, plan: p.plan || "free" }); return p || null;
}
async function pull() {
  const s = await getSession(); if (!s) return { ok: false, reason: "signed-out" };
  if (await storeGet("pendingSwitch")) return { ok: false, reason: "account-switch-pending" };
  try {
    await pullProfile(); await syncSettings().catch(() => {});
    const since = (await storeGet("lastPull")) || "1970-01-01T00:00:00Z", rows = await api(`/ext_watchlist?select=*&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc&limit=500`);
    return await withLock(async () => { const items = safeItems(await storeGet("items")); let changed = 0, last = since;
      for (const r of rows || []) { const m = mergeWatchRow(items[r.product_key], r); if (m) { items[r.product_key] = m; changed++; } if (r.updated_at > last) last = r.updated_at; }
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
  for (const k of Object.keys(SYNCED_SETTINGS)) if (stampOf(ss, k) > stampOf(stamps, k) && SYNCED_SETTINGS[k](d[k])) { values[k] = d[k]; st[k] = ss[k]; }
  return { values, stamps: st };
}
async function syncSettings() {
  if (!(await getSession())) return false;
  const keys = [...Object.keys(SYNCED_SETTINGS), "setStamps"], now = await chrome.storage.local.get(keys), { doc, stamps } = settingsToPush(now, now.setStamps);
  const srv = await api("/rpc/ext_merge_settings", { method: "POST", body: { p_doc: doc, p_stamps: stamps } });
  return withLock(async () => {
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
  const cache = (await storeGet("histCache")) || {}, c = cache[key]; if (c && Date.now() - c.t < COMM_TTL) return c.rows;
  if (!(await getSession())) return [];
  try { const rows = await api("/rpc/ext_price_history", { method: "POST", body: { p_key: key, p_days: 1095 } }); cache[key] = { t: Date.now(), rows: rows || [] }; const keys = Object.keys(cache); if (keys.length > 60) delete cache[keys.sort((a, b) => cache[a].t - cache[b].t)[0]]; await chrome.storage.local.set({ histCache: cache }); return rows || []; }
  catch { return (c && c.rows) || []; }
}
if (typeof module !== "undefined") module.exports = { SYNCED_SETTINGS, settingsToPush, settingsFromServer, syncSettings, stampSettings, claimOwner, resolveSwitch, CONTENT_KEYS, coalesce, toWatchRow, toObsRow, mergeWatchRow };
