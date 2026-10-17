importScripts("config.js", "lib.js", "state.js", "analysis.js", "cache.js", "grocery.js", "match.js", "compare.js", "offers.js", "tracker.js", "guard.js", "tier2.js", "auth.js", "sync.js");
const ready = runMigrations().then(r => r.ran ? invalidate("schema-upgrade") : null).then(() => enforceBudget()).catch(() => {}); // repairs stored data once per update (S3), then forgets stale caches and checks the storage budget (S4)
const get = async () => safeItems((await chrome.storage.local.get("items")).items);
const put = items => chrome.storage.local.set({ items });

async function record(p) {
  const items = await get(), it = items[p.key] ||= { hist: [] };
  Object.assign(it, { site: p.site || it.site, title: p.title || it.title, image: p.image || it.image, url: p.url || it.url }); if (p.mrp !== undefined) it.mrp = p.mrp; // undefined = this reader did not look at MRP: keep what we know
  if (p.seller && p.seller.name) { if (it.seller && it.seller !== p.seller.name) it.sellerChange = { from: it.seller, at: Date.now() }; it.seller = p.seller.name; }
  if (p.checked) it.checked = p.checked; for (const k of p.clear || []) delete it[k]; // the tracker clears its hold markers in the same write as the point
  const lastP = it.hist.length ? it.hist[it.hist.length - 1][1] : null; // a page read 4x higher / 4x lower than the last point is usually an EMI, bundle or variant artefact: it needs a second read within 2h
  if (p.src !== "bg" && lastP && (p.price < lastP * 0.25 || p.price > lastP * 4)) { const v = it.vhold; if (!(v && Date.now() - v.at < 2 * 3600e3 && Math.abs(v.price - p.price) / p.price <= 0.02)) { it.vhold = { price: p.price, at: Date.now() }; await put(items); return it; } delete it.vhold; } else delete it.vhold;
  const before = it.hist.length; it.hist = addPoint(it.hist, p.price, Date.now());
  await put(items);
  if (it.hist.length > before) { const { profile } = await chrome.storage.local.get("profile"); if (p.src !== "bg" && await getSession() && (profile && profile.contribute === true)) enqueue({ t: "obs", key: p.key, site: p.site, price: p.price, mrp: p.mrp, at: Date.now(), src: p.src }); }
  await maybeAlert(p.key, it);
  return it;
}
async function maybeAlert(key, it) {
  const price = it.hist[it.hist.length - 1][1], d = alertDecision(it, price);
  if (!d.fire && !Object.keys(d.patch).length) return;
  Object.assign(it, d.patch);
  if (d.fire) chrome.notifications.create(key, { type: "basic", iconUrl: "icons/icon-128.png", title: "Price drop", message: `${it.title || key}: ₹${price} (target ₹${it.target})` });
  const items = await get(); items[key] = it; await put(items);
}

// A new pincode makes cached results for the old one dead weight: forget them (S4).
async function noteLocation(loc) { const pin = loc && loc.pin; if (!pin) return; const { lastPin } = await chrome.storage.local.get("lastPin"); if (lastPin === pin) return; if (lastPin) await invalidate("pin-change"); await chrome.storage.local.set({ lastPin: pin }); }
const watchOp = (key, it, extra = {}) => ({ t: "watch", key, site: it.site, title: it.title, url: it.url, image: it.image, target: it.target, wish: it.wish, last: it.hist && it.hist.length ? it.hist[it.hist.length - 1][1] : null, u: it.u, ...extra });
const trackedCount = items => Object.values(items).filter(i => i.target || i.wish).length;
async function account() {
  const session = await sessionStore.get(), { profile, lastSync, outbox } = await chrome.storage.local.get(["profile", "lastSync", "outbox"]);
  const { authNotice } = await chrome.storage.local.get("authNotice");
  const { pendingSwitch } = await chrome.storage.local.get("pendingSwitch");
  return { configured: configured(), signedIn: !!session, notice: authNotice || null, pendingSwitch: !!pendingSwitch, user: session && session.user, profile: profile || null, lastSync: lastSync || null, queued: (outbox || []).length };
}
async function afterSignIn() {
  await ensureProfile(); await pullProfile().catch(() => {});
  const session = await sessionStore.get(); if (session && session.user && (await claimOwner(session.user.id)) === "conflict") return account(); // wait for the user's choice
  const items = await get(), t = Date.now();
  for (const [k, it] of Object.entries(items)) if (it.wish || it.target) { it.u = it.u || t; await enqueue(watchOp(k, it)); } // first sync uploads the existing local watchlist
  await put(items); await flush(); await pull(); return account();
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const g = validateMessage(m, sender, chrome.runtime.id); if (!g.ok) { reply({ error: "rejected", why: g.reason }); return; }
  if (m.type === "t2-capture") { T2.onCapture(sender, m); reply(true); return; } // page data, not a user action: never counts as activity
  touchActive().catch(() => {}); // a real user action keeps the 90-day inactivity window alive (background alarms never do)
  (async () => { try { await ready;
    if (m.type === "seen") {
      const { usage, plan = "free" } = await chrome.storage.local.get(["usage", "plan"]), q = useLookup(safeUsage(usage), m.p.key, plan);
      if (!q.allowed) return reply({ limited: true, used: q.used, limit: q.limit });
      await chrome.storage.local.set({ usage: q.usage });
      const it = await withLock(() => record(m.p)), comm = await Promise.race([fetchCommunity(m.p.key), new Promise(r => setTimeout(() => r([]), 2500))]);
      reply({ it, usage: { used: q.used, limit: q.limit }, comm });
    }
    else if (m.type === "track") {
      reply(await withLock(async () => { const items = await get(), it = items[m.key]; if (!it) return true; const { plan = "free" } = await chrome.storage.local.get("plan");
        if (!it.target && !it.wish && trackedCount(items) >= LIMITS[plan].tracked) return { error: "limit" };
        it.target = m.target; it.notified = null; it.armed = !(it.hist.length && it.hist[it.hist.length - 1][1] <= m.target); it.u = Date.now(); await put(items); enqueue(watchOp(m.key, it)); flush(); return true; })); }
    else if (m.type === "wish") {
      reply(await withLock(async () => { const items = await get(), it = items[m.key]; if (!it) return true; const { plan = "free" } = await chrome.storage.local.get("plan");
        if (m.on && !it.wish && !it.target && trackedCount(items) >= LIMITS[plan].tracked) return { error: "limit" };
        it.wish = m.on; it.u = Date.now(); await put(items); enqueue(watchOp(m.key, it, { deleted: !it.wish && !it.target })); flush(); return true; })); }
    else if (m.type === "untrack") {
      reply(await withLock(async () => { const items = await get(), it = items[m.key]; if (it) { delete it.target; it.u = Date.now(); await put(items); enqueue(watchOp(m.key, it, { deleted: !it.wish })); flush(); } return true; })); }
    else if (m.type === "remove") {
      reply(await withLock(async () => { const items = await get(), it = items[m.key]; if (it) { it.u = Date.now(); enqueue(watchOp(m.key, { ...it, wish: false, target: null }, { deleted: true })); flush(); delete items[m.key]; await put(items); } return true; })); }
    else if (m.type === "invalidate") reply(await invalidate(m.reason));
    else if (m.type === "grocery") reply(await noteLocation(m.loc).then(() => groceryAt(m.q, m.loc, { more: !!m.more })).catch(e => ({ items: [], errors: [e.message] })));
    else if (m.type === "history-ref") { const items = await get(), it = items[m.key]; const price = it && it.hist.length ? it.hist[it.hist.length - 1][1] : 0;
      if (it && m.low <= m.high && price >= m.low * 0.6 && price <= m.high * 1.4) { it.ref = { days: Math.round(m.days), low: m.low, high: m.high, at: Date.now() }; await put(items); reply({ ok: true, it }); } else reply({ ok: false }); }
    else if (m.type === "seller") reply(await offSeller({ sid: m.sid }).catch(() => ({ failed: true })));
    else if (m.type === "offers") reply(await offFind({ asin: m.asin }).catch(() => ({ offers: [], failed: true })));
    else if (m.type === "compare") reply(await cmpFind({ title: m.title, brand: m.brand, mpn: m.mpn, site: m.site, price: m.price }).catch(e => ({ results: [], failed: [], error: e.message })));
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
    else if (m.type === "open-options") { chrome.runtime.openOptionsPage(); reply(true); }
    // ---- account ----
    else if (m.type === "account") reply(await account());
    else if (m.type === "whoami") { const s = await sessionStore.get(); reply({ signedIn: !!s, initial: s && s.user ? String(s.user.name || s.user.email || "?")[0].toUpperCase() : null }); }
    else if (m.type === "forget-shared") { try { reply({ ok: true, removed: await api("/rpc/ext_forget_my_observations", { method: "POST", body: {} }) }); } catch (e) { reply({ ok: false, error: String(e.message).slice(0, 120) }); } }
    else if (m.type === "signin") { try { await signInWithGoogle(); reply({ ok: true, account: await afterSignIn() }); } catch (e) { reply({ ok: false, error: String(e.message || e) }); } }
    else if (m.type === "resolve-switch") { const r = await resolveSwitch(m.choice); if (r === "cancelled") await signOut(); else { await afterSignIn(); } reply({ ok: true, result: r, account: await account() }); }
    else if (m.type === "signout") { await signOut({ clear: !!m.clear }); reply({ ok: true, account: await account() }); }
    else if (m.type === "sync") { const f = await flush(), p = await pull(); reply({ ok: f.ok && p.ok, flush: f, pull: p, account: await account() }); }
    else if (m.type === "contribute") { try { const s = await getSession(); await api(`/ext_profiles?id=eq.${s.user.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { contribute: !!m.on } }); const { profile } = await chrome.storage.local.get("profile"); await chrome.storage.local.set({ profile: { ...(profile || {}), contribute: !!m.on } }); reply({ ok: true }); } catch (e) { reply({ ok: false, error: String(e.message) }); } }
    else if (m.type === "waitlist") { try { reply({ ok: true, joined: await api("/rpc/ext_join_waitlist", { method: "POST", body: { p_source: "extension-android" } }) }); } catch (e) { reply({ ok: false, error: String(e.message) }); } }
    else if (m.type === "profile-update") { try { const s = await getSession(), body = {}; if (m.name !== undefined) body.name = sanitizeText(m.name, 80); if (m.phone !== undefined) body.phone = m.phone || null;
      await api(`/ext_profiles?id=eq.${s.user.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body }); const { profile } = await chrome.storage.local.get("profile"); await chrome.storage.local.set({ profile: { ...(profile || {}), ...body } }); reply({ ok: true }); } catch (e) { reply({ ok: false, error: String(e.message).slice(0, 120) }); } }
    else if (m.type === "export-data") { try { reply({ ok: true, data: await api("/rpc/ext_export_my_data", { method: "POST", body: {} }), local: (await chrome.storage.local.get("items")).items || {} }); } catch (e) { reply({ ok: false, error: String(e.message).slice(0, 120) }); } }
    else if (m.type === "delete-data") { try { await api("/rpc/ext_delete_my_data", { method: "POST", body: {} }); await signOut(); await chrome.storage.local.remove(["profile", "outbox"]); reply({ ok: true }); } catch (e) { reply({ ok: false, error: String(e.message) }); } }
  } catch (e) { reply({ error: String(e && e.message || e).slice(0, 120) }); }
  })();
  return true;
});

chrome.alarms.clear("recheck"); // retired: replaced by the tracker below
// Create only if absent: re-running create on every service-worker start would keep resetting the schedule.
chrome.alarms.get("trk").then(a => { if (!a) chrome.alarms.create("trk", { periodInMinutes: 30, delayInMinutes: 5 }); });
chrome.alarms.create("sync", { periodInMinutes: 15 });
chrome.alarms.create("tokens", { periodInMinutes: 45 });
// A user edit of a synced setting gets a timestamp; a sync write carries setStamps in the same change, so it is skipped (no echo loop).
chrome.storage.onChanged.addListener((ch, area) => { if (area !== "local" || ch.setStamps) return; const ks = Object.keys(SYNCED_SETTINGS).filter(k => ch[k] && ch[k].newValue !== undefined); if (ks.length) stampSettings(ks).then(() => syncSettings()).catch(() => {}); });
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "sync") { await flush(); await pull(); return; }
  if (alarm.name === "flags") { await loadFlags(); return; }
  if (alarm.name === "housekeeping") { await housekeeping().catch(() => {}); return; } // prune >400-day history + enforce the storage budget
  if (alarm.name === "tokens") { await getSession(REFRESH_AHEAD).catch(() => {}); return; } // keep the 1-hour access token fresh while the browser is open
  if (alarm.name === "trk") { await trkRun().catch(() => {}); return; }
});

// Toolbar click toggles the companion panel; on tabs without it, open the help page.
chrome.action.onClicked.addListener(async tab => {
  try { await chrome.tabs.sendMessage(tab.id, { type: "toggle" }); } catch { chrome.tabs.create({ url: chrome.runtime.getURL("home.html") }); } // pages the overlay cannot run on (new tab, chrome://): open the full-page home
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
chrome.alarms.create("flags", { periodInMinutes: 360 });
chrome.alarms.create("housekeeping", { periodInMinutes: 720 });
