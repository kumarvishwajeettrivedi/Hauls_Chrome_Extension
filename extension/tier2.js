// Tier 2: stores whose search can only be read from their own page (signed requests / bot protection).
// HAULS opens the store's search page in a background tab the USER connected, copies the page's own search response via t2-hook.js, and closes the tab.
// Everything here is local; nothing is sent anywhere. Parsers are added per store only after a real response has been inspected (see Test in Settings).
const T2_BUILD = "2026-10-17.r17"; // bump when the background code changes; Settings compares it to detect a stale background
const T2 = (() => {
  const STORES = {
    Zepto: { origins: ["https://*.zepto.com/*"], hosts: ["zepto.com"], search: q => "https://www.zepto.com/search?query=" + encodeURIComponent(q) + "&haulsprobe=1" },
    Instamart: { origins: ["https://*.swiggy.com/*"], hosts: ["swiggy.com"], search: q => "https://www.swiggy.com/instamart/search?custom_back=true&query=" + encodeURIComponent(q) + "&haulsprobe=1" },
    BigBasket: { origins: ["https://*.bigbasket.com/*"], hosts: ["bigbasket.com"], search: q => "https://www.bigbasket.com/ps/?q=" + encodeURIComponent(q) + "&nc=as&haulsprobe=1" },
    // JioMart and Flipkart are already in host_permissions, so "Connect" shows no prompt for them.
    JioMart: { origins: ["https://www.jiomart.com/*"], hosts: ["jiomart.com"], search: q => "https://www.jiomart.com/search?q=" + encodeURIComponent(q) + "&haulsprobe=1" },
    "Flipkart Minutes": { origins: ["https://*.flipkart.com/*"], hosts: ["flipkart.com"], search: q => "https://www.flipkart.com/search?q=" + encodeURIComponent(q) + "&marketplace=HYPERLOCAL&haulsprobe=1" },
  };
  const slug = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "-"), hookId = n => "t2-hook-" + slug(n), relayId = n => "t2-relay-" + slug(n);
  const pending = new Map(), chain = {}; // tabId -> {name, caps, done}; per-store serialisation
  const userErr = (m, code) => Object.assign(new Error(m), { user: true, code });
  const lock = (k, fn) => { const run = (chain[k] || Promise.resolve()).then(fn, fn); chain[k] = run.then(() => {}, () => {}); return run; };

  // ---- report helpers (pure) ----
  const TOKENY = /^[A-Za-z0-9+\/_=-]{24,}$|^eyJ[\w-]{10,}\./;
  function safeStr(s) { s = String(s); if (s.length > 80 || TOKENY.test(s)) return `<str:${s.length}>`; return s.slice(0, 40).replace(/\d{10,}/g, "<digits>"); }
  function shapeOf(v, d = 0, max = 7) {
    if (v === null || typeof v === "boolean" || typeof v === "number") return v;
    if (typeof v === "string") return safeStr(v);
    if (d >= max) return "…";
    if (Array.isArray(v)) return v.length ? { [`[${v.length}]`]: shapeOf(v[0], d + 1, max) } : [];
    const o = {}; for (const k of Object.keys(v).slice(0, 40)) o[k] = shapeOf(v[k], d + 1, max); return o;
  }
  const PRICE_KEYS = ["sellingPrice", "selling_price", "offerPrice", "offer_price", "discountedPrice", "price"], MRP_KEYS = ["mrp", "maxPrice", "marked", "mrpPrice"];
  const numish = x => typeof x === "number" ? x : typeof x === "string" && /^\d+(\.\d+)?$/.test(x) ? +x : x && typeof x === "object" ? numish(x.value ?? x.offer_price ?? x.price) : undefined;
  function findProducts(json, max = 6, withNode = false) {
    const out = []; let nodes = 0;
    const walk = (n, path) => {
      if (out.length >= max || nodes++ > 20000 || n === null || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach((x, i) => walk(x, path + "[]"));
      const name = n.name || n.displayName || n.productName || n.title || (n.product && n.product.name);
      if (typeof name === "string") { const k = PRICE_KEYS.find(k => numish(n[k]) !== undefined); if (k) { const mk = MRP_KEYS.find(m => m !== k && numish(n[m]) !== undefined); out.push({ name: safeStr(name), price: numish(n[k]), priceKey: k, mrp: mk ? numish(n[mk]) : undefined, keys: Object.keys(n).slice(0, 25), path, ...(withNode ? { node: n } : {}) }); return; } }
      for (const k of Object.keys(n)) walk(n[k], path + "." + k);
    };
    walk(json, "$"); return out;
  }
  const pathOf = url => { try { const u = new URL(url, "https://x.invalid"); return u.pathname + (u.search ? "?" + [...u.searchParams.keys()].join("&") : ""); } catch { return ""; } };
  // First object that looks like a product card (a name-ish string plus anything price-ish), for stores whose price keys we have not met yet.
  function firstProductLike(json) {
    let nodes = 0, found = null;
    const walk = n => { if (found || nodes++ > 20000 || n === null || typeof n !== "object") return; if (Array.isArray(n)) return n.some(x => { walk(x); return found; });
      const nm = n.name || n.desc || n.title || n.productName || n.displayName || n.display_name || n.product_name; if (typeof nm === "string" && Object.keys(n).some(k => /price|pricing|mrp|^sp$|offer/i.test(k))) { found = n; return; } Object.keys(n).some(k => { walk(n[k]); return found; }); };
    walk(json); return found;
  }
  function report(name, cap) {
    let json = null; try { json = JSON.parse(cap.body); } catch {}
    const path = pathOf(cap.url);
    const first = json ? (findProducts(json, 1, true)[0] || { node: firstProductLike(json) }) : null, pg = cap.page || null;
    return { store: name, at: new Date().toISOString(), request: { method: cap.method, path, status: cap.status, locationHeaders: cap.hdr || {} },
      others: (cap.others || []).slice(0, 8).map(o => ({ method: o.method, path: pathOf(o.url), status: o.status, bytes: o.bytes, shape: o.shape, ...(o.sample ? { sample: o.sample } : {}) })),
      page: pg && { title: safeStr(pg.title || ""), pins: Array.isArray(pg.pins) ? pg.pins.filter(x => /^\d{6}$/.test(x)).slice(0, 6) : [], text: String(pg.text || "").replace(/\d{10,}/g, "<digits>").slice(0, 500), saved: Object.fromEntries(Object.entries(pg.saved || {}).map(([k, v]) => { let j; try { j = JSON.parse(v); } catch {} return [k, j !== undefined && j !== null && typeof j === "object" ? shapeOf(j) : safeStr(v)]; })) },
      response: { bytes: cap.body.length, json: !!json, preview: cap.body.length <= 3000 ? cap.body.replace(/eyJ[\w.-]+/g, "<jwt>").replace(/[A-Za-z0-9+\/_=-]{20,}/g, "<token>").replace(/\d{10,}/g, "<digits>").slice(0, 400) : undefined, shape: json ? shapeOf(json) : safeStr(cap.body.slice(0, 80)), products: json ? findProducts(json).map(({ keys, ...x }) => x) : [], sampleProduct: first && first.node ? shapeOf(first.node, 0, 12) : null } };
  }

  // ---- controller (needs chrome.*) ----
  // "Connected" = the user granted the store's permission. The page hook is (re)registered on demand, because Chrome can drop registered scripts when the extension reloads or updates.
  const hasPerm = name => chrome.permissions.contains({ origins: STORES[name].origins });
  const registered = async name => (await chrome.scripting.getRegisteredContentScripts({ ids: [hookId(name)] })).length > 0;
  // ...and the user's explicit choice (JioMart/Flipkart are host-granted, so permission alone must never start opening windows).
  const optGet = async () => ((await chrome.storage.local.get("t2opt")).t2opt) || {};
  const optSet = async (name, on) => { const o = await optGet(); if (on) o[name] = true; else delete o[name]; await chrome.storage.local.set({ t2opt: o }); };
  const connected = async name => !!STORES[name] && await hasPerm(name) && !!(await optGet())[name];
  async function ensure(name) {
    const s = STORES[name]; if (!s) return { ok: false, reason: "unknown store" }; if (!(await hasPerm(name))) return { ok: false, reason: "permission" };
    try { if (!(await registered(name))) await chrome.scripting.registerContentScripts([
      { id: hookId(name), matches: s.origins, js: ["t2-hook.js"], world: "MAIN", runAt: "document_start", persistAcrossSessions: true },
      { id: relayId(name), matches: s.origins, js: ["t2-relay.js"], runAt: "document_start", persistAcrossSessions: true }]); } catch (e) { return { ok: false, reason: "register", message: String(e && e.message || e).slice(0, 200) }; }
    return { ok: true };
  }
  async function connect(name) { const r = await ensure(name); if (r.ok) await optSet(name, true); return r; }
  const healAll = async () => { const o = await optGet(); return Promise.all(Object.keys(STORES).filter(n => o[n]).map(ensure)); };
  async function disconnect(name) { const s = STORES[name]; if (!s) return false; await optSet(name, false); try { await chrome.scripting.unregisterContentScripts({ ids: [hookId(name), relayId(name)] }); } catch {} return chrome.permissions.remove({ origins: s.origins }).catch(() => false); }
  const status = async () => Object.fromEntries(await Promise.all(Object.keys(STORES).map(async n => [n, await connected(n)])));
  // What the store page itself says about the location (visible text + a few saved settings). Best effort; never fails a capture.
  async function pageInfo(tabId) {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => { const saved = {}; try { for (const k of Object.keys(localStorage)) if (/loc|pin|addr|store|serviceab|city|pos/i.test(k)) saved[k] = String(localStorage.getItem(k)).slice(0, 600); } catch {} try { for (const c of document.cookie.split("; ")) { const i = c.indexOf("="); const k = c.slice(0, i); if (/pin|loc|sa_ids|addr|city|serviceab|store|lat|lng|area/i.test(k)) saved["cookie:" + k] = decodeURIComponent(c.slice(i + 1)).slice(0, 300); } } catch {} const txt = (document.body ? document.body.innerText : "").replace(/\s+/g, " "); return { title: document.title, text: txt.slice(0, 600), pins: [...new Set(txt.slice(0, 4000).match(/\b\d{6}\b/g) || [])].slice(0, 6), saved }; } });
      return r && r.result || null;
    } catch { return null; }
  }
  // Of everything the page fetched, the answer is the response that contains products (largest wins); the rest are kept as small "other calls" (delivery checks etc.).
  function pick(good) {
    const rank = good.map(c => { let n = 0; try { n = findProducts(JSON.parse(c.body), 1).length; } catch {} return [c, n ? c.body.length : 0]; }).sort((x, y) => y[1] - x[1]), best = rank[0][0];
    return { ...best, all: good, others: good.filter(c => c !== best).map(({ body, ...r }) => { let sh = "", sample; try { const j = JSON.parse(body); sh = JSON.stringify(shapeOf(j)).slice(0, 2000); const n = firstProductLike(j); if (n) sample = JSON.stringify(shapeOf(n, 0, 10)).slice(0, 3500); } catch { sh = safeStr(body.slice(0, 80)); } return { ...r, bytes: body.length, shape: sh, sample }; }) };
  }
  // Chrome never paints/animates a hidden tab and throttles its timers, so modern store pages may never run their search there. A small popup window that stays on screen counts as visible; fall back to an inactive tab only if windows are unavailable.
  async function openProbe(url) {
    const back = async prev => { if (prev && prev.id != null) try { await chrome.windows.update(prev.id, { focused: true }); } catch {} }; // the user's own window stays in front
    try { const prev = await chrome.windows.getLastFocused().catch(() => null), w = await chrome.windows.create({ url, type: "popup", width: 420, height: 600, left: 30, top: 30, focused: false }), tab = w && w.tabs && w.tabs[0]; await back(prev);
      if (tab) return { tab, close: async () => { try { await chrome.windows.remove(w.id); } catch {} await back(prev); } }; } catch {}
    const tab = await chrome.tabs.create({ url, active: false }); return { tab, close: () => Promise.resolve(chrome.tabs.remove(tab.id)).catch(() => {}) };
  }
  // Opens the search page in a small window, waits for the page's own search response (plus `settle` ms for its other calls), always closes the tab.
  function capture(name, q, { timeout = 20000, settle = 6000 } = {}) {
    return lock("*", async () => { // one probe window at a time across ALL stores
      if (!(await connected(name))) throw userErr(name + " isn't connected", "not-connected");
      const en = await ensure(name); if (!en.ok) throw userErr(`${name} couldn't be set up (${en.message || en.reason})`, "register");
      let tab, probe; const seen = [], good = [];
      try {
        probe = await openProbe(STORES[name].search(q)); tab = probe.tab;
        const cap = await new Promise((res, rej) => {
          let st = null, fin = false; const finish = () => { if (fin) return; fin = true; clearTimeout(t); clearTimeout(st); res(pick(good)); };
          const t = setTimeout(async () => {
            if (good.length) return finish();
            let shown = "", where = ""; // diagnostics must never stop the timeout from being reported
            try { const pg = await pageInfo(tab.id); shown = pg && pg.text ? String(pg.text).replace(/\d{10,}/g, "…").slice(0, 90) : ""; } catch {}
            try { const tb = await chrome.tabs.get(tab.id); where = tb ? ` Tab: ${tb.status || "?"} ${String(tb.url || "").replace(/[?#].*$/, "").slice(0, 70)}${tb.title ? ` "${String(tb.title).slice(0, 40)}"` : ""}.` : ""; } catch {}
            rej(Object.assign(userErr(`${name} didn't answer in time` + (seen.length ? ` (saw ${seen.map(s => s.status).join(",")})` : "") + (shown ? `. The page showed: "${shown}"` : ".") + where, "timeout"), { pageText: shown, seen: seen.length })); }, timeout);
          pending.set(tab.id, { name, caps: seen, done: c => { good.push(c); if (settle <= 0) finish(); else if (!st) st = setTimeout(finish, settle); } });
        });
        cap.page = await pageInfo(tab.id); return cap;
      } finally { if (tab) pending.delete(tab.id); if (probe) probe.close(); }
    });
  }
  // Called for every t2-capture message. Accepts it only from the tab we opened, on that store's own host.
  function onCapture(sender, m) {
    const p = sender && sender.tab && pending.get(sender.tab.id); if (!p) return false;
    let host = ""; try { host = new URL(sender.url).hostname; } catch { return false; }
    if (!STORES[p.name].hosts.some(h => host === h || host.endsWith("." + h))) return false;
    p.caps.push({ status: m.status }); if (m.status >= 200 && m.status < 300 && m.body.length > 2) p.done(m); return true;
  }
  // ---- store adapters: written from REAL responses captured with Settings > Test, never guessed ----
  const ZEPTO_IMG = "https://cdn.zeptonow.com/production/tr:w-300,ar-1-1,pr-true,f-auto,q-80/", UOM = { MILLILITRE: "ml", LITRE: "l", GRAM: "g", KILOGRAM: "kg" };
  const paise = p => typeof p === "number" && p > 0 ? Math.round(p) / 100 : null; // Zepto prices are in paise
  function parseZepto(body) {
    let json; try { json = JSON.parse(body); } catch { return []; }
    const out = [], seen = new Set(); let nodes = 0;
    const walk = n => {
      if (nodes++ > 60000 || n === null || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.widgetId === "PREMIUM_CONTEXTUAL_ADS_V2") return; // sponsored widget
      const pr = n.product, pv = n.productVariant;
      if (pr && typeof pr.name === "string" && pv && typeof n.sellingPrice === "number") {
        const price = paise(n.sellingPrice), id = pv.id || n.id;
        if (price && !seen.has(id) && !(n.meta && n.meta.is_fly_wheel_ad === true)) {
          seen.add(id); const mrp = paise(n.mrp), img = pv.images && pv.images[0] && typeof pv.images[0].path === "string" ? pv.images[0].path.replace(/^\//, "") : null;
          out.push({ store: "Zepto", name: pr.name, brand: typeof pr.brand === "string" ? pr.brand : undefined, price, mrp: mrp && mrp > price ? mrp : null,
            pack: pv.packsize > 0 && UOM[pv.unitOfMeasure] ? `${pv.packsize} ${UOM[pv.unitOfMeasure]}` : pv.formattedPacksize || null,
            inStock: n.outOfStock !== true && !(n.availableQuantity <= 0) && n.isActive !== false, image: img ? ZEPTO_IMG + img : null,
            url: `https://www.zepto.com/pn/${pr.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "product"}/pvid/${pv.id}`, confirmed: true });
        }
        return;
      }
      Object.values(n).forEach(walk);
    };
    walk(json); return out;
  }
  // The delivery location the store's own page is using (Zepto keeps it in localStorage "user-position"). null = none chosen.
  function zeptoLocation(cap) {
    try { const raw = cap && cap.page && cap.page.saved && cap.page.saved["user-position"], j = typeof raw === "string" ? JSON.parse(raw) : raw, u = j && j.state && j.state.userPosition;
      if (u && Number.isFinite(u.latitude) && Number.isFinite(u.longitude)) return { lat: u.latitude, lon: u.longitude, label: String(u.shortAddress || u.name || "").slice(0, 60) }; } catch {}
    return null;
  }
  const jparse = v => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
  // JioMart: rows from the site's own vertex search; location = the pincode the SITE has saved (localStorage `pin` / cookie app_location_details); no fulfilment stores = it does not deliver there.
  function parseJioPage(cap) {
    const calls = (cap.all || [cap]).filter(x => /\/ext\/vertex\/application\/api\/v1\.0\/products/.test(x.url || "")), want = "q=" + encodeURIComponent(cap.q || "").toLowerCase();
    const c = calls.find(x => String(x.url).toLowerCase().includes(want)) || calls[0], j = c && jparse(c.body); if (!j || !Array.isArray(j.items)) return []; // the call for OUR query, not home-page widgets
    const num = x => typeof x === "number" && x > 0 ? x : null, out = [];
    for (const i of j.items) { const price = num(i.price && i.price.effective && i.price.effective.min); if (!price || typeof i.name !== "string") continue; const mrp = num(i.price.marked && i.price.marked.min);
      out.push({ store: "JioMart", name: i.name, brand: i.brand && i.brand.name, price, mrp: mrp && mrp > price ? mrp : null, pack: i["net-quantity-value"] ? `${i["net-quantity-value"]} ${i["net-quantity-unit"] || ""}`.trim() : (i.sizes && i.sizes[0]) || null,
        inStock: i.sellable !== false && Array.isArray(i.store_ids) && i.store_ids.length > 0, image: i.medias && i.medias[0] && typeof i.medias[0].url === "string" ? i.medias[0].url : null, url: "https://www.jiomart.com/search?q=" + encodeURIComponent(cap.q || i.name), confirmed: true }); }
    return out;
  }
  function jioLocation(cap) {
    const s = (cap && cap.page && cap.page.saved) || {}, a = jparse(s.pin) || jparse(s["cookie:app_location_details"]) || {}, pin = /^\d{6}$/.test(String(a.pincode)) ? String(a.pincode) : ""; if (!pin) return null;
    return { pin, label: String(a.city || "").slice(0, 40), unserviceable: !String(s["cookie:fulfillment_stores"] || "").trim() };
  }
  // BigBasket: rows from tabs[].product_info.products; location = the pincode cookie, never trusted while the location source is "default".
  function parseBigBasket(cap) {
    const j = jparse(cap.body), out = []; if (!j || !Array.isArray(j.tabs)) return out; const base = typeof j.base_img_url === "string" ? j.base_img_url : "https://www.bbassets.com/media/uploads";
    const img = o => { const p = o && (o.m || o.l || o.s); return typeof p === "string" && p ? (/^https?:/.test(p) ? p : base + "/" + p.replace(/^\//, "")) : null; };
    for (const t of j.tabs) for (const p of (t && t.product_info && t.product_info.products) || []) {
      const d = p && p.pricing && p.pricing.discount, sp = parseFloat(d && d.prim_price && d.prim_price.sp), mrp = parseFloat(d && d.mrp); if (!(sp > 0) || typeof p.desc !== "string") continue;
      out.push({ store: "BigBasket", name: p.desc, brand: p.brand && p.brand.name, price: sp, mrp: mrp > sp ? mrp : null, pack: p.w || (p.magnitude ? `${p.magnitude} ${p.unit || ""}`.trim() : null),
        inStock: !!p.availability && p.availability.avail_status === "001" && p.availability.not_for_sale !== true, image: img(Array.isArray(p.images) ? p.images[0] : null), url: typeof p.absolute_url === "string" ? "https://www.bigbasket.com" + p.absolute_url : null, confirmed: true }); }
    return out;
  }
  function bigBasketLocation(cap) {
    const s = (cap && cap.page && cap.page.saved) || {}, pin = String(s["cookie:_bb_pin_code"] || "").trim(), src = String(s["cookie:_bb_locSrc"] || "");
    return /^\d{6}$/.test(pin) && src !== "default" ? { pin, label: "its saved location" } : { pin: "", label: "its default location" };
  }
  const ADAPTERS = { Zepto: { parse: cap => parseZepto(cap.body), location: zeptoLocation }, JioMart: { parse: parseJioPage, location: jioLocation }, BigBasket: { parse: parseBigBasket, location: bigBasketLocation } };
  // Prices from a hidden-tab store, returned ONLY when the store's own delivery location is inside the user's pincode (its saved position is reverse-geocoded to a pincode).
  async function search(name, q, pin, { reverse, settle = 800, timeout } = {}) {
    const ad = ADAPTERS[name]; if (!ad) throw userErr(name + " can't be read in the app yet");
    if (!/^\d{6}$/.test(pin || "")) throw userErr(name + " needs a pincode");
    if (!(await connected(name))) throw Object.assign(userErr(name + " isn't connected", "not-connected"), { silent: true, connect: true });
    let cap; try { cap = await capture(name, q, { settle, ...(timeout ? { timeout } : {}) }); cap.q = q; }
    catch (e) { if (e.code === "timeout" && e.pageText) throw userErr(`${name} didn't return results. It may not deliver to ${pin}, or its page is blocked.`, "no-results"); throw e; }
    const at = ad.location(cap), host = STORES[name].hosts[0];
    if (!at) throw userErr(`${name} has no delivery location set. Open ${host} and set it to ${pin}.`, "no-location");
    let theirs = at.pin || ""; if (!theirs && Number.isFinite(at.lat) && Number.isFinite(at.lon)) { try { theirs = ((await reverse(at.lat, at.lon)) || {}).pin || ""; } catch {} }
    if (!theirs) throw userErr(`Couldn't tell which pincode ${name} is set to (${at.label || "unknown place"}). Open ${host} and set it to ${pin}.`, "unverified");
    if (theirs !== pin) throw userErr(`${name} is set to ${at.label || "another place"} (${theirs}), not ${pin}. Open ${host} and set your location to ${pin}.`, "wrong-location");
    if (at.unserviceable) throw userErr(`${name} doesn't deliver to ${pin}.`, "undeliverable");
    return ad.parse(cap);
  }
  async function test(name, opts) {
    try { return { ok: true, report: report(name, await capture(name, "milk", opts)) }; }
    catch (e) { return { ok: false, code: e.code || "error", message: String(e.message).slice(0, 160) }; }
  }
  return { build: T2_BUILD, STORES, ensure, healAll, shapeOf, findProducts, report, connected, connect, disconnect, status, capture, onCapture, test, parseZepto, zeptoLocation, parseJioPage, parseBigBasket, search };
})();
if (typeof module !== "undefined") module.exports = T2;
