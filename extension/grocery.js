// Quick-commerce search. Each store: (query, {lat, lon}) -> [{store,name,brand,pack,price,mrp,inStock,image,url}]
const _c = typeof cache !== "undefined" ? cache : require("./cache.js").cache; // cache.js must load first (importScripts) in the worker
const MIN = 6e4, GROCERY_DAY = 864e5, TIMEOUT = 8000, BREAK_AFTER = 3, BREAK_FOR = 10 * MIN;
let disabled = new Set();
const setDisabledStores = l => { disabled = new Set((Array.isArray(l) ? l : []).map(x => String(x).toLowerCase())); }, getDisabledStores = () => [...disabled];
const paused = n => disabled.has(n.toLowerCase());
const userErr = m => Object.assign(new Error(m), { user: true }); // expected condition, not a store fault: never trips the breaker
// Circuit breaker, state in cache ns "breaker": 3 straight failures -> open 10 min; after that ONE probe is let through (half-open).
const probing = new Set();
async function breakerAllow(n) {
  const b = await _c.get("breaker", n);
  if (!b || !b.openUntil) return true;
  if (Date.now() < b.openUntil || probing.has(n)) return false;
  probing.add(n); // claimed synchronously, so concurrent callers can't both probe
  await _c.set("breaker", n, { fails: b.fails, openUntil: Date.now() + BREAK_FOR }, GROCERY_DAY); // probe in flight: block others until it reports
  return true;
}
async function breakerReport(n, ok) {
  probing.delete(n);
  if (ok) return _c.set("breaker", n, { fails: 0, openUntil: 0 }, GROCERY_DAY);
  const b = (await _c.get("breaker", n)) || { fails: 0 }, fails = (b.fails || 0) + 1;
  return _c.set("breaker", n, { fails, openUntil: fails >= BREAK_AFTER ? Date.now() + BREAK_FOR : 0 }, GROCERY_DAY);
}
// Runs one store call with an 8 s AbortController timeout and the breaker. fx = fetch bound to that signal.
async function callStore(n, f, q, loc) {
  if (!(await breakerAllow(n))) throw new Error(n + " is temporarily unavailable");
  const ac = new AbortController(); let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ac.abort(); }, TIMEOUT);
  try {
    const r = await f(q, loc, (u, o) => fetch(u, { ...o, signal: ac.signal }));
    await breakerReport(n, true); return r;
  } catch (e) {
    if (e && e.user) { probing.delete(n); throw e; }
    await breakerReport(n, false);
    throw timedOut ? new Error(n + " timed out") : e;
  } finally { clearTimeout(t); }
}
async function dmartStore(pin, fx = fetch) {
  return _c.wrap("dmart", pin, GROCERY_DAY, () => dmartLookup(pin, fx));
}
async function dmartLookup(pin, fx) {
  const B = "https://digital.dmart.in/api/v2/pincodes/", post = async (u, b) => (await fx(B + u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();
  const s = await post("suggestions", { searchText: pin, sessionToken: crypto.randomUUID(), currentLocationPincode: "", currentLat: "", currentLng: "" }), c = s.searchResult && s.searchResult[0];
  const d = c ? await post("details", { uniqueId: c.uniqueId, apiMode: c.apiMode, pincode: c.pincode, currentLat: "", currentLng: "", isUsersCurrentLocation: "false", skip: "true", flowType: "0" }) : null;
  const id = d && d.isPincodeServiceable === "true" ? d.storePincodeDetails.storeId : null;
  return id || undefined; // not cached when undeliverable
}
// One row per pack-size SKU. ponytail: invStatus "0" = out of stock is inferred from samples, not documented.
function parseDmart(j) {
  const out = [];
  for (const p of j.products || []) for (const s of p.sKUs || []) {
    const price = num(s.priceSALE); if (!price) continue;
    out.push({ store: "DMart", name: p.name, brand: p.manufacturer, pack: s.variantTextValue, price, mrp: num(s.priceMRP), inStock: String(s.invStatus) !== "0",
      image: s.productImageKey ? `https://cdn.dmart.in/images/products/${s.productImageKey}_${s.imgCode || "1"}_P.jpg` : null, url: `https://www.dmart.in/product/${p.seo_token_ntk}?selectedProd=${s.skuUniqueID}` });
  }
  return out;
}
// ponytail: "sellable" is the only stock signal used; in_stock_variant's meaning is unclear. Product links go to the search page (item URL format unverified).
function parseJio(j, q) {
  return (j.items || []).map(i => ({ store: "JioMart", confirmed: false, name: i.name, brand: i.brand && i.brand.name, price: num(i.price && i.price.effective && i.price.effective.min), mrp: num(i.price && i.price.marked && i.price.marked.min),
    pack: i["net-quantity-value"] ? `${i["net-quantity-value"]} ${i["net-quantity-unit"] || ""}`.trim() : null, inStock: i.sellable !== false, image: i.medias && i.medias[0] && i.medias[0].url,
    url: "https://www.jiomart.com/products?q=" + encodeURIComponent(q) })).filter(i => i.price);
}
// Blinkit search layout -> rows. Reads EVERY product card widget (product_card_snippet_type_N), not one snippet type.
function parseBlinkit(json, q) {
  const out = [];
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    if (/^product_card_snippet/.test(n.widget_type || "") && n.data) {
      const d = n.data, ci = ((d.atc_action || {}).add_to_cart || {}).cart_item || {}, price = ci.price ?? num(d.normal_price && d.normal_price.text), name = (d.name && d.name.text) || ci.product_name || ci.name;
      if (price && typeof name === "string") out.push({ store: "Blinkit", name, brand: ci.brand, pack: (d.variant && d.variant.text) || ci.unit, price, mrp: ci.mrp ?? num(d.mrp && d.mrp.text),
        inStock: d.is_sold_out === false && d.product_state === "available", image: d.image && d.image.url, url: "https://blinkit.com/s/?q=" + encodeURIComponent(q) });
    } else Object.values(n).forEach(walk);
  };
  walk(json); return out;
}
// Hidden-page stores (JioMart, BigBasket, Zepto) open a window, so they run ONLY when the user asked (`more`); their rows are kept 30 min so a normal search can still show them.
async function viaPage(name, q, { pin, more }) {
  if (typeof T2 === "undefined") throw Object.assign(new Error(name + " isn't available"), { user: true, silent: true });
  if (!T2.connected || !(await T2.connected(name))) throw Object.assign(new Error(name + " isn't connected"), { user: true, silent: true, connect: true });
  const key = `${name}|${q.toLowerCase().trim()}|${pin}`, hit = await _c.get("t2", key); if (hit) return hit;
  if (!more) throw Object.assign(new Error(name + " not checked yet"), { user: true, silent: true, later: true });
  const rows = await T2.search(name, q, pin, { reverse: reverseCached }); await _c.set("t2", key, rows, 30 * MIN); return rows;
}
const STORES = {
  // Connected: read JioMart's own page (its saved pincode must equal yours). Not connected: the old direct call, whose rows can't prove delivery and stay hidden; the panel offers "Connect".
  async JioMart(q, loc, fx) {
    const { pin } = loc; if (!pin) throw userErr("JioMart needs a pincode");
    const t2 = typeof T2 !== "undefined" && T2.connected;
    if (t2 && await T2.connected("JioMart")) return viaPage("JioMart", q, loc);
    const r = await fx("https://www.jiomart.com/ext/vertex/application/api/v1.0/products?page_id=*&page_size=40&q=" + encodeURIComponent(q), { headers: { "x-location-detail": JSON.stringify({ country: "INDIA", country_iso_code: "IN", pincode: pin }) } });
    if (!r.ok) throw new Error("JioMart HTTP " + r.status);
    const rows = parseJio(await r.json(), q); if (t2) rows.needsConnect = true; return rows;
  },
  async DMart(q, { pin }, fx) {
    if (!pin) throw userErr("DMart needs a pincode");
    const store = await dmartStore(pin, fx);
    if (!store) throw userErr("DMart doesn't deliver to this pincode");
    const r = await fx("https://digital.dmart.in/api/v3/secure/search/" + encodeURIComponent(q) + "?page=1&size=50&channel=web&buryOOS=true", { headers: { storeId: String(store) } });
    if (!r.ok) throw new Error("DMart HTTP " + r.status);
    return parseDmart(await r.json());
  },
  async BigBasket(q, loc) { return viaPage("BigBasket", q, loc); },

  // Hidden-tab store (tier2.js): shows prices only when Zepto's own saved location is inside the requested pincode.
  async Zepto(q, loc) { return viaPage("Zepto", q, loc); },

  async Blinkit(q, { lat, lon }, fx) {
    // Blinkit answers 403 until the browser has visited it once: touch the home page (sets its cookies), at most every 30 min. Failure is ignored.
    if (!(await _c.get("warm", "blinkit"))) { // own 2.5 s budget so a slow home page can never eat the search's 8 s
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 2500); await fetch("https://blinkit.com/", { credentials: "include", signal: ac.signal }).catch(() => {}); clearTimeout(t); await _c.set("warm", "blinkit", 1, 30 * MIN); }
    const r = await fx("https://blinkit.com/v1/layout/search?search_type=type_to_search&q=" + encodeURIComponent(q), {
      method: "POST", credentials: "include", body: "{}",
      headers: { "content-type": "application/json", lat: String(lat), lon: String(lon) } });
    if (!r.ok) throw new Error("Blinkit HTTP " + r.status);
    return parseBlinkit(await r.json(), q);
  },
};

// Relevance, badges and labels (see docs/superpowers/specs/2026-10-17-grocery-results-design.md).
// - keeps every item matching ANY query word (full matches sort first); dedupes identical rows
// - cheapest = lowest price among relevant + in-stock + delivery-confirmed items (and the typed pack size, if any); bestValue = best g/ml unit price among 2+ comparable packs
const STOP = new Set(["for", "and", "the", "with", "of", "in", "to"]);
const packKey = p => p ? p.amt + p.unit : "";
function unitLabel(price, p) {
  if (!p) return null;
  if (p.unit === "pc") return p.amt >= 2 ? `₹${unitPrice(price, p)}/pc` : null;
  const per = unitPrice(price, p), u = p.unit;
  return p.amt >= 1000 ? `₹${Math.round(per * 10 * 100) / 100}/${u === "g" ? "kg" : "L"}` : `₹${per}/100${u}`;
}
function rank(items, q) {
  const words = q.toLowerCase().split(/\W+/).filter(w => w.length >= 2 && !/^\d/.test(w) && !STOP.has(w)), want = parsePack(q);
  const seen = new Set(), rows = [];
  for (let i of items) {
    if (!i || typeof i !== "object" || !(i.price > 0) || !isFinite(i.price)) continue;
    // third-party rows (store JSON / hidden pages) are untrusted: plain bounded text, https-only links and images, before anything renders them
    i = { ...i, name: cleanText(i.name, 200), brand: i.brand == null ? i.brand : cleanText(i.brand, 80), pack: i.pack == null ? i.pack : cleanText(i.pack, 60), image: cleanUrl(i.image), url: cleanUrl(i.url) };
    const p = parsePack(i.pack || i.name), key = [i.store, ((i.brand || "") + " " + (i.name || "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), packKey(p), i.price].join("|");
    if (seen.has(key)) continue; seen.add(key);
    const hay = ((i.brand || "") + " " + (i.name || "")).toLowerCase(), score = words.length ? words.filter(w => new RegExp("\\b" + w + "(?:s|es)?\\b").test(hay)).length / words.length : 1;
    if (score === 0) continue;
    const off = !want ? 0 : p && p.unit === want.unit ? Math.abs(Math.log(p.amt / want.amt)) : 5;
    const norm = " " + hay.replace(/[^a-z0-9]+/g, " ").trim() + " ", phrase = words.length < 2 ? score === 1 : new RegExp("\\s" + words.join("\\s") + "(?:s|es)?\\s").test(norm);
    const tier = (phrase ? 2 : score === 1 ? 1 : 0) + (want && off < 0.7 ? 3 : 0); // exact phrase > all words > some words; a typed size outranks all of that
    rows.push({ ...i, score, tier, off, per: unitPrice(i.price, p), perLabel: unitLabel(i.price, p), _p: p });
  }
  rows.sort((a, b) => (b.tier - a.tier) || (b.score - a.score) || (b.inStock - a.inStock) || (a.off - b.off) || (a.price - b.price));
  const ok = r => r.inStock && r.confirmed !== false && (!want || r.off < 0.7);
  const all = rows.filter(ok), top = Math.max(-1, ...all.map(r => r.tier)), elig = all.filter(r => r.tier === top), min = elig.reduce((m, r) => !m || r.price < m.price || (r.price === m.price && r.score > m.score) ? r : m, null);
  const cls = {}; for (const r of elig) if (r._p && r._p.unit !== "pc") (cls[r._p.unit] = cls[r._p.unit] || []).push(r);
  const best = new Set(Object.values(cls).filter(g => g.length >= 2).map(g => g.reduce((m, r) => r.per < m.per ? r : m)));
  return rows.map(row => { const { _p, ...r } = row; return { ...r, cheapest: row === min, bestValue: best.has(row) }; });
}
// Rows from stores that can't confirm delivery to this pincode are not prices we can stand behind: hide them, name the stores.
const splitUnconfirmed = items => ({ items: items.filter(i => i.confirmed !== false), unconfirmed: [...new Set(items.filter(i => i.confirmed === false).map(i => i.store))] });
async function grocerySearch(q, loc, { more = false } = {}) {
  const key = `${q.toLowerCase().trim()}|${(loc && loc.pin) || ""}${more ? "|more" : ""}`, off = Object.keys(STORES).filter(paused), pausedErr = off.map(n => n + " is temporarily paused");
  const hit = await _c.get("grocery", key);
  if (hit) return { items: hit.items.filter(i => !paused(i.store)), unconfirmed: hit.unconfirmed || [], connect: hit.connect || [], later: hit.later || [], errors: pausedErr };
  const active = Object.entries(STORES).filter(([n]) => !paused(n));
  const res = await Promise.allSettled(active.map(([n, f]) => callStore(n, f, q, { ...(loc || {}), more }).then(x => x, e => { throw Object.assign(new Error(e.message.startsWith(n) ? e.message : n + ": " + e.message), { silent: e.silent, connect: e.connect, later: e.later }); })));
  const sp = splitUnconfirmed(res.flatMap(r => r.status === "fulfilled" ? r.value : []));
  const connect = active.filter((_, i) => (res[i].status === "rejected" && res[i].reason.connect) || (res[i].status === "fulfilled" && res[i].value && res[i].value.needsConnect)).map(([n]) => n); // opted-in stores the user hasn't connected: a prompt, not an error
  const later = active.filter((_, i) => res[i].status === "rejected" && res[i].reason.later).map(([n]) => n); // connected page stores waiting for the user's click
  const out = { items: rank(sp.items, q), unconfirmed: sp.unconfirmed, connect, later, errors: pausedErr.concat(res.filter(r => r.status === "rejected" && !r.reason.silent).map(r => r.reason.message)) };
  if (!out.errors.length && !later.length) await _c.set("grocery", key, out, 5 * MIN); // never cache a degraded result, nor one still waiting for the page stores
  return out;
}
const geocode = pin => _c.wrap("geo", String(pin), 30 * GROCERY_DAY, async () => {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&postalcode=${encodeURIComponent(pin)}`);
  const j = (await r.json())[0];
  if (!j) throw new Error("Pincode not found");
  return { lat: +j.lat, lon: +j.lon };
});
// The search entry point the panel uses: refuses coordinates that don't belong to the pincode (stale lat/lon after the pincode changed would return another area's prices).
async function groceryAt(q, loc, opts) {
  const c = loc && loc.pin ? await geocode(loc.pin).catch(() => null) : null;
  if (!locConsistent(loc, c)) return { items: [], unconfirmed: [], errors: [`The saved location doesn't match pincode ${loc.pin}. Pick the pincode again.`] };
  return grocerySearch(q, loc, opts);
}
// Approximate (city-level) location from the network, used only when the browser has no GPS. ponytail: third-party lookup, disclosed in the UI.
async function ipLocate() {
  const d = await (await fetch("https://ipwho.is/")).json();
  return d && d.success ? { pin: /^\d{6}$/.test(String(d.postal || "")) ? String(d.postal) : "", lat: Number.isFinite(d.latitude) ? d.latitude : undefined, lon: Number.isFinite(d.longitude) ? d.longitude : undefined, city: cleanText(d.city, 60) } : {};
}
const reverseCached = (lat, lon) => _c.wrap("rev", `${(+lat).toFixed(3)},${(+lon).toFixed(3)}`, 30 * GROCERY_DAY, () => reverseGeocode(lat, lon));
async function reverseGeocode(lat, lon) {
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`), a = (await r.json()).address || {};
  return { pin: /^\d{6}$/.test((a.postcode || "").replace(/\s/g, "")) ? a.postcode.replace(/\s/g, "") : "" };
}
if (typeof module !== "undefined") module.exports = { parseBlinkit, groceryAt, rank, splitUnconfirmed, parseDmart, parseJio, grocerySearch, geocode, dmartStore, setDisabledStores, getDisabledStores };
