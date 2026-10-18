//⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​​‌‌‌​​​​‌‌​​​‌​​​‌‌​​‌‌​​‌‌​‌​​​​‌‌‌​​​​‌‌​​‌​‌​​‌‌​‌​‌​​‌‌​‌‌‌⁡
importScripts("config.js", "lib.js", "state.js", "analysis.js", "cache.js", "grocery.js", "match.js", "compare.js", "offers.js", "tracker.js", "amzbg.js", "impulse.js", "guard.js", "tier2.js", "auth.js", "sync.js");
const ready = runMigrations().then(r => r.ran ? invalidate("schema-upgrade") : null).then(() => enforceBudget()).catch(() => {}).then(() => claimLegacyOwner()).catch(() => {}); // tags a session that predates owner tags (sync fails closed without one); repairs stored data once per update (S3), then forgets stale caches and checks the storage budget (S4)
const get = async () => safeItems((await chrome.storage.local.get("items")).items);
const quiet = p => Promise.resolve(p).catch(() => {}); // fire-and-forget without an unhandled rejection
// Writing items can hit the 10 MB quota: free space (caches, old backups and vaults), then the oldest look-only products, and only then give up with the distinct error 'storage-full' (never mistaken for the plan limit).
const QUOTA_BUDGET = 10 * 1024 * 1024, isQuota = e => /quota/i.test(String(e && e.message || e));
async function put(items) {
  try { await chrome.storage.local.set({ items }); return; } catch (e) { if (!isQuota(e)) throw e; }
  try { await enforceBudget({ budget: QUOTA_BUDGET }); } catch {}
  for (let i = 0; i < 5; i++) { try { await chrome.storage.local.set({ items }); return; } catch (e) { if (!isQuota(e)) throw e; if (!dropSeenOnly(items)) break; } }
  throw new Error("storage-full");
}

// Small counters for Settings ("is this reader working?"): {read, refused, stored, uploaded, declined, last, reasons:{}}. Failures here never matter.
async function bumpHealth(key, event, reason) { try { await withLock(async () => { const h = (await chrome.storage.local.get(key))[key] || { reasons: {} }; h[event] = (h[event] || 0) + 1; h.last = Date.now(); if (reason && typeof reason === "string" && !(reason in Object.prototype)) h.reasons[reason] = (h.reasons[reason] || 0) + 1; await chrome.storage.local.set({ [key]: h }); }); } catch {} }
const isPrice = v => typeof v === "number" && v > 0 && v < 1e7;
async function record(p) {
  // The ONE place page-derived text enters storage and the outbox (guard.js already bounded sizes; this removes control/bidi characters, forces https URLs, and refuses dictionary-poisoning keys).
  if (!p || !okKey(p.key) || !isPrice(p.price)) throw new Error("bad product");
  p = { ...p, site: cleanText(p.site, 60), title: cleanText(p.title, 500), image: cleanUrl(p.image), url: cleanUrl(p.url), mrp: p.mrp === undefined ? undefined : isPrice(p.mrp) ? p.mrp : null, seller: p.seller && cleanText(p.seller.name, 80) ? { name: cleanText(p.seller.name, 80) } : undefined };
  if (p.url && !keyHostOk(p.key, p.url)) throw new Error("bad product"); // the link must be on the shop the key names (guard.js keyHostOk); no link at all keeps the stored one
  const items = await get(), it = Object.hasOwn(items, p.key) ? items[p.key] : items[p.key] = { hist: [] };
  Object.assign(it, { site: p.site || it.site, title: p.title || it.title, image: p.image || it.image, url: p.url || it.url }); if (p.mrp !== undefined) it.mrp = p.mrp; // undefined = this reader did not look at MRP: keep what we know
  if (p.seller && p.seller.name) { if (it.seller && it.seller !== p.seller.name) it.sellerChange = { from: it.seller, at: Date.now() }; it.seller = p.seller.name; }
  if (p.src !== "bg") it.seenAt = Date.now(); // a page visit: the tracker keeps recently viewed products fresh too
  if (p.checked) it.checked = p.checked; for (const k of p.clear || []) delete it[k]; // the tracker clears its hold markers in the same write as the point
  const lastP = it.hist.length ? it.hist[it.hist.length - 1][1] : null; // a page read 4x higher / 4x lower than the last point is usually an EMI, bundle or variant artefact: it needs a second read within 2h
  if (p.src !== "bg" && lastP && (p.price < lastP * 0.25 || p.price > lastP * 4)) { const v = it.vhold; if (!(v && Date.now() - v.at < 2 * 3600e3 && Math.abs(v.price - p.price) / p.price <= 0.02)) { it.vhold = { price: p.price, at: Date.now() }; await put(items); return it; } delete it.vhold; } else delete it.vhold;
  const before = it.hist.length; it.hist = addPoint(it.hist, p.price, Date.now()), day = new Date().toISOString().slice(0, 10);
  if (p.src !== "bg") it.pv = { price: p.price, at: Date.now() }; // the last price a person saw on the page: background reads are shared only if they stay close to it
  const grew = it.hist.length > before;
  // A background (tracker) read is shared only when it is a new confirmed price, within 10% of what the page showed in the last 14 days, at most once per product per day, and not switched off remotely.
  const bgOk = p.src === "bg" && grew && p.price !== lastP && it.pv && Date.now() - it.pv.at < 14 * 864e5 && Math.abs(p.price / it.pv.price - 1) <= 0.10 && it.bgSent !== day;
  if (bgOk) it.bgSent = day;
  await put(items);
  if (grew && (p.src !== "bg" || bgOk)) { const { profile } = await chrome.storage.local.get("profile"); if (await sessionStore.get() && (profile && profile.contribute === true) && !(p.src === "bg" && featureOff((await chrome.storage.local.get("flags")).flags, "bg-upload"))) quiet(enqueue({ t: "obs", key: p.key, site: p.site || it.site, price: p.price, mrp: p.mrp, at: Date.now(), src: p.src === "bg" ? "bg" : p.src })); }
  await maybeAlert(p.key, it);
  return it;
}
// Opt-in email (Settings/account): the SERVER sends it, to the account's own address only; the mail provider's key never leaves the server.
async function emailAlert(key, it, price, target = alertDecision(it, price).target || it.target) { try { const { profile } = await chrome.storage.local.get("profile"); if (!profile || profile.email_alerts !== true || !(await getSession())) return; await api("/rpc/ext_send_price_alert", { method: "POST", body: { p_key: key, p_title: cleanText(it.title, 500) || null, p_price: price, p_target: target, p_url: cleanUrl(it.url) } }); } catch {} }
// Clicking the notification opens the product (https only).
chrome.notifications.onClicked.addListener(async id => { try { if (id === "hauls-test") { chrome.runtime.openOptionsPage(); } else { const it = (await get())[id]; const u = it && cleanUrl(it.url); if (u) chrome.tabs.create({ url: u }); } chrome.notifications.clear(id); } catch {} });
const notifyLevel = () => new Promise(r => { try { chrome.notifications.getPermissionLevel(l => r(l || "granted")); } catch { r("granted"); } });
const notifyShow = (id, o) => new Promise(r => { try { chrome.notifications.create(id, o, () => r(!chrome.runtime.lastError)); } catch { r(false); } });
// Shows the desktop notification; false when it could not be shown. Remembers a blocked permission (notifyBlocked) so Settings can say so.
async function notifyUser(id, o) {
  const level = await notifyLevel(), shown = level !== "denied" && await notifyShow(id, o);
  const { notifyBlocked } = await chrome.storage.local.get("notifyBlocked");
  if (!shown && level === "denied") { if (!notifyBlocked) await chrome.storage.local.set({ notifyBlocked: true }); } else if (shown && notifyBlocked) await chrome.storage.local.remove("notifyBlocked");
  return shown;
}
async function maybeAlert(key, it) {
  const price = it.hist[it.hist.length - 1][1];
  if (it.wish && !(it.target > 0) && !(it.wishPrice > 0)) it.wishPrice = price; // a heart from before the default alert existed: measured from now
  const d = alertDecision(it, price); let patch = d.patch;
  if (!d.fire && !Object.keys(patch).length) return;
  if (d.fire) {
    const shown = await notifyUser(key, { type: "basic", iconUrl: "icons/icon-128.png", title: `Price drop: ₹${price}`, message: `${cleanText(it.title || key, 120)}\nYour alert was ₹${d.target}. Click to open.`, priority: 2 });
    quiet(emailAlert(key, it, price, d.target));
    if (!shown) patch = {}; // could not be shown: the alert is not spent, the next read tries again
  }
  Object.assign(it, patch);
  const items = await get(); items[key] = it; await put(items);
}

// A new pincode makes cached results for the old one dead weight: forget them (S4).
async function noteLocation(loc) { const pin = loc && loc.pin; if (!pin) return; const { lastPin } = await chrome.storage.local.get("lastPin"); if (lastPin === pin) return; if (lastPin) await invalidate("pin-change"); await chrome.storage.local.set({ lastPin: pin }); }
const watchOp = (key, it, extra = {}) => ({ t: "watch", key, site: it.site, title: it.title, url: it.url, image: it.image, target: it.target, wish: it.wish, last: it.hist && it.hist.length ? it.hist[it.hist.length - 1][1] : null, u: it.u, ...extra });
const trackedCount = items => Object.values(items).filter(i => i.target || i.wish).length;
async function account() {
  const session = await sessionStore.get(), { profile, lastSync, outbox, syncDropped } = await chrome.storage.local.get(["profile", "lastSync", "outbox", "syncDropped"]);
  const { authNotice, notifyBlocked } = await chrome.storage.local.get(["authNotice", "notifyBlocked"]);
  return { configured: configured(), signedIn: !!session, notice: authNotice || null, notifyBlocked: notifyBlocked === true, user: session && session.user, profile: profile || null, lastSync: lastSync || null, queued: (outbox || []).length, dropped: session ? droppedCount(syncDropped) : 0 };
}
async function afterSignIn() {
  const session = await sessionStore.get(); if (session && session.user) await claimOwner(session.user.id); // first: tags the live data with this account (another account's data is put away, never merged); sync refuses to run before this
  await ensureProfile(); await pullProfile().catch(() => {}); api("/rpc/ext_purge_my_deleted_watchlist", { method: "POST", body: {} }).catch(() => {}); // deleted items older than 24 h are removed from this account for good
  // First sync uploads the local watchlist, but only what this account has not seen from the server yet (never synced, or edited after the last pull): a device that was away must not bring back what was deleted elsewhere.
  const ops = await withLock(async () => { const items = await get(), t = Date.now(), lp = Date.parse((await chrome.storage.local.get("lastPull")).lastPull) || 0, out = [];
    for (const [k, it] of Object.entries(items)) if ((it.wish || it.target) && (!it.u || it.u > lp)) { it.u = it.u || t; out.push(watchOp(k, it)); }
    if (out.length) await put(items); return out; });
  for (const op of ops) await enqueue(op);
  await flush(); await pull(); return account();
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const g = validateMessage(m, sender, chrome.runtime.id); if (!g.ok) { reply({ error: "rejected", why: g.reason }); return; }
  if (m.type === "t2-capture") { T2.onCapture(sender, m); reply(true); return; } // page data, not a user action: never counts as activity
  touchActive().catch(() => {}); // a real user action keeps the 90-day inactivity window alive (background alarms never do)
  (async () => { try { await ready;
    if (m.type === "seen") {
      const q = await withLock(async () => { const { usage, plan } = await chrome.storage.local.get(["usage", "plan"]), q = useLookup(safeUsage(usage), m.p.key, planOf(plan)); if (q.allowed) await chrome.storage.local.set({ usage: q.usage }); return q; });
      if (!q.allowed) return reply({ limited: true, used: q.used, limit: q.limit });
      const it = await withLock(() => record(m.p)), comm = await Promise.race([fetchCommunity(m.p.key), new Promise(r => setTimeout(() => r([]), 2500))]), chart = await Promise.race([fetchChart(m.p.key), new Promise(r => setTimeout(() => r([]), 2500))]);
      reply({ it, usage: { used: q.used, limit: q.limit }, comm, chart });
    }
    else if (m.type === "track") { // saving or changing a price alert needs a Google sign-in (alerts, email, sync, abuse limits): this is the check, the panel's prompt is only the courtesy. Remove / untrack / view never need it.
      if (!(await getSession())) return reply({ error: "signin" });
      reply(await withLock(async () => { const items = await get(), it = items[m.key]; if (!it) return { error: "gone" }; const plan = planOf((await chrome.storage.local.get("plan")).plan);
        if (!it.target && !it.wish && trackedCount(items) >= LIMITS[plan].tracked) return { error: "limit" };
        it.target = m.target; it.notified = null; it.armed = !(it.hist.length && it.hist[it.hist.length - 1][1] <= m.target); it.u = Date.now(); await put(items); quiet(enqueue(watchOp(m.key, it))); quiet(flush()); return true; })); }
    else if (m.type === "wish") { // same rule: hearting (on) needs a session; un-hearting an existing item stays open
      if (m.on && !(await getSession())) return reply({ error: "signin" });
      reply(await withLock(async () => { const items = await get(), it = items[m.key]; if (!it) return { error: "gone" }; const plan = planOf((await chrome.storage.local.get("plan")).plan);
        if (m.on && !it.wish && !it.target && trackedCount(items) >= LIMITS[plan].tracked) return { error: "limit" };
        if (m.on && !it.wish) { if (it.hist.length) it.wishPrice = it.hist[it.hist.length - 1][1]; else delete it.wishPrice; if (!(it.target > 0)) { it.notified = null; delete it.armed; } } else if (!m.on) delete it.wishPrice; // a heart alone alerts at a 10% drop from the price it was hearted at (analysis.js alertDecision)
        it.wish = m.on; it.u = Date.now(); await put(items); quiet(enqueue(watchOp(m.key, it, { deleted: !it.wish && !it.target }))); quiet(flush()); return true; })); }
    else if (m.type === "untrack") {
      reply(await withLock(async () => { const items = await get(), it = items[m.key]; if (it) { delete it.target; it.u = Date.now(); await put(items); quiet(enqueue(watchOp(m.key, it, { deleted: !it.wish }))); quiet(flush()); } return true; })); }
    else if (m.type === "remove") {
      reply(await withLock(async () => { const items = await get(), it = items[m.key]; if (it) { it.u = Date.now(); quiet(enqueue(watchOp(m.key, { ...it, wish: false, target: null }, { deleted: true }))); quiet(flush()); delete items[m.key]; await put(items); } return true; })); }
    else if (m.type === "invalidate") reply(await invalidate(m.reason));
    else if (m.type === "grocery") reply(await noteLocation(m.loc).then(() => groceryAt(m.q, m.loc, { more: !!m.more })).catch(e => ({ items: [], errors: [e.message] })));
    else if (m.type === "history-ref") reply(await withLock(async () => { const items = await get(), it = items[m.key]; const price = it && it.hist.length ? it.hist[it.hist.length - 1][1] : 0;
      if (it && m.low <= m.high && price >= m.low * 0.6 && price <= m.high * 1.4) { it.ref = { days: Math.round(m.days), low: m.low, high: m.high, at: Date.now() }; await put(items); return { ok: true, it }; } return { ok: false }; }));
    else if (m.type === "ahist") { await withLock(async () => { const items = await get(), it = items[m.key]; if (!it || !it.hist.length) return reply({ ok: false });
        const price = it.hist[it.hist.length - 1][1], last = m.points[m.points.length - 1][1];
        if (!(last >= price * 0.6 && last <= price * 1.4)) return reply({ ok: false }); // the chart must agree with the price this product shows today
        const ah = it.ahist || { ranges: {} }; ah.at = Date.now(); const tab = ["1M", "3M", "1Y"].includes(m.tab) && m.days <= { "1M": 60, "3M": 150, "1Y": 400 }[m.tab] ? m.tab : undefined; /* the tab Amazon had selected, only when the span fits it */ ah.ranges[m.range] = { at: Date.now(), days: m.days, points: m.points, ...(tab ? { tab } : {}) }; if (m.offer) ah.offer = m.offer; if (m.highest) ah.highest = m.highest; it.ahist = ah; await put(items);
        { const { profile } = await chrome.storage.local.get("profile"); if (profile && profile.contribute === true && !featureOff((await chrome.storage.local.get("flags")).flags, "chart-upload") && await sessionStore.get()) quiet(enqueue({ t: "chart", key: m.key, range: m.days, series: m.points, current: m.current || last })); } // opt-in: share the chart Amazon itself showed this reader
        reply({ ok: true, it }); }); }
    else if (m.type === "ahist-health") { await bumpHealth("chartHealth", m.event, m.reason); reply({ ok: true }); }
    else if (m.type === "ahist-tried") { await withLock(async () => { const items = await get(), it = items[m.key]; if (it) { it.ahist = it.ahist || { ranges: {} }; it.ahist.tried = Date.now(); await put(items); } }); reply({ ok: true }); }
    else if (m.type === "seller") reply(await offSeller({ sid: m.sid }).catch(() => ({ failed: true })));
    else if (m.type === "urg") reply(await withLock(async () => { const items = await get(), it = items[m.key]; if (!it) return null; it.urg = impRecord(it.urg, m.cues, m.price, Date.now()); await put(items); return it.urg; }).catch(() => null));
    else if (m.type === "offers-fk") reply(await offFindFlipkart({ pid: m.pid }).catch(() => ({ offers: [], failed: true })));
    else if (m.type === "offers") reply(await offFind({ asin: m.asin }).catch(() => ({ offers: [], failed: true })));
    else if (m.type === "compare") reply(await cmpFind({ title: m.title, brand: m.brand, mpn: m.mpn, site: m.site, price: m.price }).catch(e => ({ results: [], failed: [], error: e.message })));
    else if (m.type === "test-alert") { const level = await notifyLevel(), ok = await notifyUser("hauls-test", { type: "basic", iconUrl: "icons/icon-128.png", title: "HAULS alerts work", message: "This is a test. A real alert looks like this when a price reaches your alert.", priority: 2 }), { profile } = await chrome.storage.local.get("profile"); reply({ ok, level, email: !(await sessionStore.get()) ? "signed-out" : profile && profile.email_alerts === true ? "on" : "off" }); }
    else if (m.type === "abg-run") reply(await abgRun(Date.now(), { force: true }).catch(e => ({ ok: false, why: e.message })));
    else if (m.type === "trk-run") reply(await trkRun(Date.now()).catch(e => ({ error: e.message })));
    else if (m.type === "iplocate") reply(await ipLocate().catch(() => ({})));
    else if (m.type === "reverse") reply(await reverseGeocode(m.lat, m.lon).catch(() => ({})));
    else if (m.type === "geocode") reply(await geocode(m.pin).catch(e => ({ error: e.message })));
    else if (m.type === "t2-version") reply({ build: T2.build, version: chrome.runtime.getManifest().version });
    else if (m.type === "t2-status") reply(await T2.status());
    else if (m.type === "t2-connect") reply(await T2.connect(m.store));
    else if (m.type === "t2-disconnect") reply(await T2.disconnect(m.store));
    else if (m.type === "t2-test") reply(await T2.test(m.store));
    else if (m.type === "enableShopify") reply(await enableShopify());
    else if (m.type === "disableShopify") { try { await chrome.scripting.unregisterContentScripts({ ids: ["shopify"] }); } catch {} reply(await chrome.permissions.remove({ origins: ["https://*/*"] }).catch(() => false)); }
    else if (m.type === "open-options") { if (m.at) chrome.tabs.create({ url: chrome.runtime.getURL("options.html#" + m.at) }); else chrome.runtime.openOptionsPage(); reply(true); } // m.at = "delete" | "signout-clear": the options page asks for the confirming click
    // ---- account ----
    else if (m.type === "account") reply(await account());
    else if (m.type === "whoami") { const s = await sessionStore.get(); reply({ signedIn: !!s, initial: s && s.user ? String(s.user.name || s.user.email || "?")[0].toUpperCase() : null }); }
    else if (m.type === "forget-shared") { try { reply({ ok: true, removed: await api("/rpc/ext_forget_my_observations", { method: "POST", body: {} }) }); } catch (e) { reply({ ok: false, error: String(e.message).slice(0, 120) }); } }
    else if (m.type === "signin") { try { await signInWithGoogle(); reply({ ok: true, account: await afterSignIn() }); } catch (e) { reply({ ok: false, error: String(e.message || e) }); } }
    else if (m.type === "signout") { await signOut({ clear: !!m.clear }); reply({ ok: true, account: await account() }); }
    else if (m.type === "sync") { const t0 = Date.now(), f = await flush(), p = await pull(); if (f.ok && p.ok) await clearDropped(t0); reply({ ok: f.ok && p.ok, flush: f, pull: p, account: await account() }); }
    else if (m.type === "contribute") { try { const s = await getSession(); await api(`/ext_profiles?id=eq.${s.user.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { contribute: !!m.on } }); const { profile } = await chrome.storage.local.get("profile"); await chrome.storage.local.set({ profile: { ...(profile || {}), contribute: !!m.on } }); reply({ ok: true }); } catch (e) { reply({ ok: false, error: String(e.message) }); } }
    else if (m.type === "waitlist") { try { reply({ ok: true, joined: await api("/rpc/ext_join_waitlist", { method: "POST", body: { p_source: "extension-android" } }) }); } catch (e) { reply({ ok: false, error: String(e.message) }); } }
    else if (m.type === "profile-update") { try { const s = await getSession(), body = {}; if (m.name !== undefined) body.name = sanitizeText(m.name, 80); if (m.phone !== undefined) { if (m.phone && !/^\+91[6-9][0-9]{9}$/.test(m.phone)) return reply({ ok: false }); body.phone = m.phone || null; } if (m.email_alerts !== undefined) body.email_alerts = m.email_alerts === true;
      await api(`/ext_profiles?id=eq.${s.user.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body }); const { profile } = await chrome.storage.local.get("profile"); await chrome.storage.local.set({ profile: { ...(profile || {}), ...body } }); reply({ ok: true }); } catch (e) { reply({ ok: false, error: String(e.message).slice(0, 120) }); } }
    else if (m.type === "export-data") { try { reply({ ok: true, data: await api("/rpc/ext_export_my_data", { method: "POST", body: {} }), local: (await chrome.storage.local.get("items")).items || {} }); } catch (e) { reply({ ok: false, error: String(e.message).slice(0, 120) }); } }
    else if (m.type === "delete-data") { try { const sess = await sessionStore.get(), uid = sess && sess.user && sess.user.id; await api("/rpc/ext_delete_my_data", { method: "POST", body: {} });
      await withLock(() => chrome.storage.local.remove(["items", "outbox", "usage", "lastPull"])); // the erased list must not be uploaded again on the way out, or restored from a vault at the next sign-in
      await signOut(); await chrome.storage.local.remove(["profile", "outbox", ...(uid ? ["vault:" + uid] : [])]); reply({ ok: true }); } catch (e) { reply({ ok: false, error: String(e.message) }); } }
  } catch (e) { reply({ error: isQuota(e) ? "storage-full" : String(e && e.message || e).slice(0, 120) }); }
  })();
  return true;
});

chrome.alarms.clear("recheck"); // retired: replaced by the tracker below
// Create only if absent: re-running create on every service-worker start (it wakes on every page read) would keep resetting the schedule, so periods longer than the gaps between wake-ups would never fire.
const ALARMS = [["trk", 30, 5], ["sync", 15, 1], ["tokens", 45, 1], ["flags", 360, 1], ["housekeeping", 720, 1]];
function ensureAlarms() { return Promise.all(ALARMS.map(([n, period, delay]) => Promise.resolve(chrome.alarms.get(n)).then(a => { if (!a) chrome.alarms.create(n, { periodInMinutes: period, delayInMinutes: delay }); }).catch(() => {}))); }
ensureAlarms();
// A user edit of a synced setting gets a timestamp; a sync write carries setStamps in the same change, so it is skipped (no echo loop).
chrome.storage.onChanged.addListener((ch, area) => { if (area !== "local" || ch.setStamps) return; const ks = Object.keys(SYNCED_SETTINGS).filter(k => ch[k] && ch[k].newValue !== undefined); if (ks.length) stampSettings(ks).then(() => syncSettings()).catch(() => {}); });
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "sync") { await flush(); await pull(); return; }
  if (alarm.name === "flags") { await loadFlags(); return; }
  if (alarm.name === "housekeeping") { await housekeeping().catch(() => {}); return; } // prune >400-day history + enforce the storage budget
  if (alarm.name === "tokens") { await getSession(REFRESH_AHEAD).catch(() => {}); return; } // keep the 1-hour access token fresh while the browser is open
  if (alarm.name === "trk") { await trkRun().catch(() => {}); await abgRun().catch(() => {}); return; }
});

// Toolbar click toggles the companion panel; on tabs without it (new tab, chrome://), open Settings.
chrome.action.onClicked.addListener(async tab => {
  try { await chrome.tabs.sendMessage(tab.id, { type: "toggle" }); } catch { chrome.runtime.openOptionsPage(); }
});

// Independent (Shopify) stores: only after the user grants optional host access from the help page.
const SHOPIFY_JS = ["sites-extra.js", "lib.js", "analysis.js", "shopify.js", "reviews.js", "theme.js", "content.js"];
async function enableShopify() {
  if (!(await chrome.permissions.contains({ origins: ["https://*/*"] }))) return false;
  const have = await chrome.scripting.getRegisteredContentScripts({ ids: ["shopify"] });
  if (!have.length) await chrome.scripting.registerContentScripts([{ id: "shopify", matches: ["https://*/*"],
    excludeMatches: ["https://*.amazon.in/*", "https://*.flipkart.com/*", "https://*.myntra.com/*", "https://*.blinkit.com/*", "https://*.croma.com/*", "https://*.reliancedigital.in/*", "https://*.tatacliq.com/*", "https://*.nykaa.com/*", "https://*.vijaysales.com/*", "https://*.snapdeal.com/*"],
    js: SHOPIFY_JS, runAt: "document_idle", persistAcrossSessions: true }]);
  return true;
}

// Remote kill-switch: DATA ONLY (never code). Lets us pause a broken store/site without a store update. Cached 24h; failures keep the last good flags.
async function loadFlags() {
  if (!configured()) return;
  try {
    const flags = await cache.wrap("flags", "v", 24 * 3600e3, async () => { const r = await fetch(`${HAULS_CONFIG.SUPABASE_URL}/rest/v1/ext_remote_config?select=value&key=eq.flags`, { headers: { apikey: HAULS_CONFIG.SUPABASE_ANON_KEY } });
      if (!r.ok) throw new Error("flags " + r.status); const j = await r.json(); return (j[0] && j[0].value) || {}; }, { staleWhileRevalidate: true });
    const { flags: oldFlags } = await chrome.storage.local.get("flags"); if (oldFlags && JSON.stringify(oldFlags) !== JSON.stringify(flags)) await invalidate("flags-change"); // a store was paused/resumed: results may be stale
    await chrome.storage.local.set({ flags }); setDisabledStores(Array.isArray(flags.disabled_stores) ? flags.disabled_stores : []);
  } catch {}
}
ready.then(() => T2.healAll()).catch(() => {}); // re-register store page hooks Chrome may have dropped on reload
chrome.storage.local.get("flags").then(s => s.flags && setDisabledStores(s.flags.disabled_stores || [])); loadFlags();
// First install: open Settings with the guided tour (Mozilla's onboarding guidance). Updates and reloads stay silent.
chrome.runtime.onInstalled.addListener(d => { if (d && d.reason === "install") { try { chrome.tabs.create({ url: chrome.runtime.getURL("options.html?welcome=1") }); } catch {} } });
// When the extension is removed, Chrome opens this page (hosted on the project site: extension pages no longer exist by then). Only the version number is passed.
const FEEDBACK_URL = "https://kumarvishwajeettrivedi.github.io/Hauls_Chrome_Extension/feedback.html?v=" + (() => { try { return chrome.runtime.getManifest().version; } catch { return ""; } })();
try { chrome.runtime.setUninstallURL(FEEDBACK_URL); } catch {}

