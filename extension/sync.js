// Browser-first sync: chrome.storage.local is the source of truth for the UI; Supabase is the backup/sharing layer.⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​​‌‌​‌‌‌​‌‌​​‌​‌​​‌‌​​​​​​‌‌​​‌‌​‌‌​​​​‌​​‌‌‌​​​​‌‌​​‌​‌​​‌‌​‌​​⁡
// Local changes go to an outbox and are flushed when signed in. Pure helpers below are unit-tested.
const OUTBOX_MAX = 500, DAY_MS = 864e5, COMM_TTL = 6 * 3600e3;
// Serialises every read-modify-write of chrome.storage state so concurrent messages/alarms can't overwrite each other.
let _lockChain = Promise.resolve();
const withLock = fn => { const run = _lockChain.then(fn, fn); _lockChain = run.then(() => {}, () => {}); return run; };
const dayOf = t => typeof t === "number" ? new Date(t).toISOString().slice(0, 10) : String(t).slice(0, 10);
const httpsOnly = u => typeof u === "string" && /^https:\/\//i.test(u) ? u : undefined;

// Keep one pending 'watch' op per product (latest wins); observations dedupe on key+day+price.
function coalesce(outbox, op) {
  const out = outbox.filter(o => !(op.t === "watch" && o.t === "watch" && o.key === op.key) && !(op.t === "chart" && o.t === "chart" && o.key === op.key && o.range === op.range) && !(op.t === "obs" && o.t === "obs" && o.key === op.key && o.price === op.price && dayOf(o.at) === dayOf(op.at)));
  out.push(op); return out.slice(-OUTBOX_MAX);
}
const toWatchRow = (uid, op) => ({ user_id: uid, product_key: op.key, site: op.site || null, title: op.title || null, url: op.url || null, image: op.image || null,
  target_price: op.target || null, wish: !!op.wish, last_price: op.last || null, deleted_at: op.deleted ? new Date(op.u).toISOString() : null, updated_at: new Date(op.u).toISOString() });
// Chart series for the shared history: [[epoch ms, price]] -> [[day number, price]], one point per day (the last wins), at most 130, last price = today's price.
function toChartArgs(op) {
  const byDay = new Map(); for (const [t, p] of op.series) byDay.set(Math.floor(t / DAY_MS), Math.round(p * 100) / 100);
  let pts = [...byDay.entries()].sort((a, b) => a[0] - b[0]); if (pts.length > 130) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 129) === 0 || i === pts.length - 1).slice(-130);
  return { p_key: op.key, p_range: op.range <= 45 ? 30 : op.range <= 120 ? 90 : 365, p_series: pts.map(([d, p]) => [d, p]), p_current: op.current };
}
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
  await withLock(async () => {}); // let any enqueue already waiting on the lock land first
  const s = await getSession(); if (!s) return { ok: false, reason: "signed-out" };
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
  const charts = failure ? [] : snapshot.filter(o => o.t === "chart");
  for (const o of charts) { // false from the server (rate limit, validation) is an answer, not an error: the op is done either way
    try { if (profile.contribute === true) await api("/rpc/ext_submit_chart", { method: "POST", body: toChartArgs(o) }); done.add(o.id); sent++; }
    catch (e) { if (isClientErr(e)) { done.add(o.id); dropped++; } else { failure = e; break; } }
  }
  await withLock(async () => { const cur = safeOutbox(await storeGet("outbox")); await chrome.storage.local.set({ outbox: cur.filter(o => !done.has(o.id)), ...(failure ? {} : { lastSync: Date.now() }) }); });
  return failure ? { ok: false, reason: String(failure.message || failure).slice(0, 120), sent, dropped } : { ok: true, sent, dropped };
}

// ---- S2 account-switch protection: local data is tagged with the user id that owns it ----
// What belongs to the previous ACCOUNT on this device: content + personal settings (saved places, pincode, coordinates). Every SYNCED_SETTINGS key must be here (a unit test enforces it). Pure UI prefs (notch position) are not.
const CONTENT_KEYS = ["items", "outbox", "histCache", "chartCache", "lastPull", "usage", "setStamps", "places", "pin", "range", "loc", "lastPin"];
// The device shows ONE account's data at a time. Whatever belongs to another account waits in a per-account vault and is never merged, shown or uploaded to a different account.
const VAULT_MAX = 3, VAULT_TTL = 30 * 864e5, VAULT_RECENT = 30, vaultKey = id => "vault:" + id;
const trimContent = ({ histCache, chartCache, ...d }) => { const items = d.items || {}, keep = {}, rest = Object.keys(items).filter(k => !(items[k] && (items[k].wish || items[k].target))).sort((a, b) => ((items[b].seenAt || 0) - (items[a].seenAt || 0))).slice(0, VAULT_RECENT); for (const k of Object.keys(items)) if (items[k] && (items[k].wish || items[k].target)) keep[k] = items[k]; for (const k of rest) keep[k] = items[k]; return { ...d, items: keep }; }; // a vault keeps watched products and the 30 most recent others, so storage stays small
async function takeContent() { const d = await chrome.storage.local.get(CONTENT_KEYS); await chrome.storage.local.remove(CONTENT_KEYS); return d; } // everything the current account owns on this device, removed from the live view
async function vaultPut(ownerId, data) {
  if (!ownerId || !Object.keys(data).length) return;
  const all = await chrome.storage.local.get(null), now = Date.now(), vaults = Object.keys(all).filter(k => k.startsWith("vault:")).map(k => [k, all[k]]), expired = vaults.filter(([, v]) => !v || now - (v.at || 0) > VAULT_TTL).map(([k]) => k);
  const live = vaults.filter(([k]) => !expired.includes(k) && k !== vaultKey(ownerId)).sort((a, b) => b[1].at - a[1].at), drop = [...expired, ...live.slice(VAULT_MAX - 1).map(([k]) => k)]; // at most 3 vaults, none older than 30 days
  if (drop.length) await chrome.storage.local.remove(drop);
  await chrome.storage.local.set({ [vaultKey(ownerId)]: { at: now, data: trimContent(data) } });
}
async function vaultTake(ownerId) { const k = vaultKey(ownerId), v = (await chrome.storage.local.get(k))[k]; await chrome.storage.local.remove(k); return v && Date.now() - (v.at || 0) <= VAULT_TTL ? v.data : null; }
async function clearVaults() { const keys = Object.keys(await chrome.storage.local.get(null)).filter(k => k.startsWith("vault:")); if (keys.length) await chrome.storage.local.remove(keys); }
// A different account signs in, or someone signs in on a device with anonymous data: "same" | "adopted" (anonymous local data joins this account) | "switched" (the previous account's data went to its vault)
async function claimOwner(userId) {
  const { localOwner } = await chrome.storage.local.get("localOwner"); if (localOwner === userId) return "same";
  let anon = {}; if (localOwner) await vaultPut(localOwner, await takeContent()); else anon = await takeContent(); // anonymous data is adopted; another account's data is put away, not merged
  const mine = (await vaultTake(userId)) || {}, merged = { ...mine, ...anon }; // this account's own saved data first, anonymous additions on top
  if (mine.items || anon.items) merged.items = { ...(mine.items || {}), ...(anon.items || {}) }; if (mine.outbox || anon.outbox) merged.outbox = [...(mine.outbox || []), ...(anon.outbox || [])];
  await chrome.storage.local.set({ ...merged, localOwner: userId }); return localOwner ? "switched" : "adopted";
}
// Sign-out (or a session that can no longer be used): the account's data leaves the live view; unsent changes are kept in its vault for its next sign-in.
async function releaseOwner(hint) { const { localOwner } = await chrome.storage.local.get("localOwner"), owner = localOwner || hint; if (!owner) return; /* anonymous data belongs to nobody: it stays */ await vaultPut(owner, await takeContent()); await chrome.storage.local.remove("localOwner"); }
// Creates the profile row if it's missing (e.g. after "delete my data" and a fresh sign-in).
async function ensureProfile() { try { await api("/rpc/ext_ensure_profile", { method: "POST", body: {} }); } catch {} }
async function pullProfile() {
  const s = await getSession(); if (!s) return null;
  const rows = await api(`/ext_profiles?select=plan,contribute,name,phone,avatar_url,email_alerts&id=eq.${s.user.id}`); const p = rows && rows[0];
  if (p) await chrome.storage.local.set({ profile: p, plan: p.plan || "free" }); return p || null;
}
async function pull() {
  const s = await getSession(); if (!s) return { ok: false, reason: "signed-out" };
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
// Shared chart series for one product (consensus of opt-in readers, >= 2-3 reporters per day). Signed-in only; cached 6h; resolves [] on any failure.
async function fetchChart(key) {
  const cache = (await storeGet("chartCache")) || {}, c = cache[key]; if (c && Date.now() - c.t < COMM_TTL) return c.rows;
  if (!(await getSession())) return [];
  try {
    const rows = ((await api("/rpc/ext_get_chart", { method: "POST", body: { p_key: key } })) || []).filter(x => x && /^\d{4}-\d{2}-\d{2}/.test(String(x.day)) && +x.price > 0).slice(0, 800).map(x => ({ day: String(x.day).slice(0, 10), price: +x.price, reporters: +x.reporters || 1 }));
    cache[key] = { t: Date.now(), rows }; const keys = Object.keys(cache); if (keys.length > 60) delete cache[keys.sort((a2, b2) => cache[a2].t - cache[b2].t)[0]]; await chrome.storage.local.set({ chartCache: cache }); return rows;
  } catch { return (c && c.rows) || []; }
}
if (typeof module !== "undefined") module.exports = { toChartArgs, SYNCED_SETTINGS, settingsToPush, settingsFromServer, syncSettings, stampSettings, claimOwner, releaseOwner, clearVaults, VAULT_MAX, CONTENT_KEYS, coalesce, toWatchRow, toObsRow, mergeWatchRow };
