// Other sellers on the same Amazon product. Runs in the service worker on a user click: one request to Amazon's own offers fragment.⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​​‌‌​‌​‌​‌‌​​‌​​​‌‌​​‌​‌​​‌‌​‌​‌​​‌‌​‌‌‌​​‌‌​​​​​​‌‌‌​​​​​‌‌​‌‌​⁡
// Pure parser (offParseAod) + fetch layer (offFind). Text from the page is untrusted: capped and tag-stripped here.
const OFF_TIMEOUT = 8000, OFF_TTL = 15 * 60e3, OFF_EMPTY_TTL = 2 * 60e3, offCache = new Map(); // an empty answer is kept 2 min, a failure never
const offBad = reason => Object.assign(new Error(reason), { reason }), offHttp = s => offBad([403, 429, 503].includes(s) ? "blocked" : "network"); // why a call failed: blocked | network | parse
const offText = h => String(h || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, " ").trim();
function offParseAod(html) {
  const chunks = String(html || "").split(/(?=<div id="aod-(?:pinned-)?offer")/).slice(1), out = []; // the pinned (buy-box) offer comes first and is the one on this page
  for (const c of chunks) {
    const price = (c.match(/id="aod-price-\d+"[\s\S]*?a-price-whole">([\d,]+)/) || [])[1], p = price ? parseFloat(price.replace(/,/g, "")) : null;
    const sold = c.match(/id="aod-offer-soldBy"[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]{2,80})</), name = sold ? offText(sold[2]).slice(0, 80) : "", sid = sold ? (sold[1].match(/[?&;]seller=([A-Z0-9]{8,16})/) || [])[1] || null : null;
    if (!p || !(p < 1e7) || !name) continue;
    const ships = (c.match(/id="aod-offer-shipsFrom"[\s\S]*?Ships from<\/span>[\s\S]*?class="[^"]*a-color-base[^"]*">([^<]{2,60})</) || c.match(/id="aod-offer-shipsFrom"[\s\S]*?a-col-right[^>]*>([\s\S]{0,300}?)<\/div>/) || [])[1],
      cond = (c.match(/id="aod-offer-heading"[\s\S]*?a-text-bold">\s*([^<]+?)\s*</) || [])[1], rate = c.match(/Seller rating is (\d(?:\.\d)?) out of 5 stars[\s\S]{0,200}?\((\d[\d,]*) ratings?\)/);
    out.push({ price: p, cond: offText(cond || "New").slice(0, 30), seller: name, sid, ships: offText(ships || "").slice(0, 60), rating: rate ? parseFloat(rate[1]) : null, ratings: rate ? parseInt(rate[2].replace(/,/g, ""), 10) : 0, here: c.startsWith('<div id="aod-pinned-offer"') });
  }
  const pin = out.find(o => o.here), dup = pin && pin.sid && out.find(o => o !== pin && o.sid === pin.sid && o.price === pin.price); if (dup) { dup.here = true; out.splice(out.indexOf(pin), 1); } // the buy-box seller is often also in the list: one row
  return out;
}
// Why an Amazon fragment had no rows: blocked (captcha/robot page), parse (not the offers fragment, or offers we could not read), or noloc (Amazon lists nobody else for this delivery location).
const offAodWhy = html => !/id="aod-container"/.test(html) ? (/captcha|not a robot|characters you see/i.test(html) ? "blocked" : "parse") : /<div id="aod-offer"/.test(html) ? "parse" : "noloc";
// Lowest New offer and how much cheaper it is than the price on this page.
function offBest(offers, here) {
  const fresh = (offers || []).filter(o => /^new/i.test(o.cond) && !o.dormant); if (!fresh.length) return null;
  const lowest = fresh.reduce((a, o) => (o.price < a.price ? o : a), fresh[0]);
  return { lowest, saving: here > lowest.price ? Math.round(here - lowest.price) : 0 };
}
async function offFind({ asin }, doFetch = fetch, now = Date.now()) {
  if (!/^[A-Z0-9]{10}$/.test(asin || "")) return { offers: [], failed: true, reason: "parse" };
  const hit = offCache.get(asin); if (hit && now - hit.at < (hit.offers.length ? OFF_TTL : OFF_EMPTY_TTL)) return { offers: hit.offers, failed: false, reason: hit.reason };
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), OFF_TIMEOUT);
  try {
    const r = await doFetch(`https://www.amazon.in/gp/product/ajax/aodAjaxMain/ref=dp_aod_ALL_mbc?asin=${asin}&pc=dp&experienceId=aodAjaxMain`, { credentials: "include", signal: ctl.signal, headers: { "x-requested-with": "XMLHttpRequest" } });
    if (!r.ok) throw offHttp(r.status);
    const html = await r.text(), offers = offParseAod(html).sort((a, b) => a.price - b.price), reason = offers.length ? "" : offAodWhy(html);
    if (reason === "blocked" || reason === "parse") throw offBad(reason);
    offCache.set(asin, { at: now, offers, reason }); return { offers, failed: false, reason };
  } catch (e) { return { offers: [], failed: true, reason: e.reason || "network" }; } finally { clearTimeout(t); }
}

// ---- Flipkart: the same page endpoint Flipkart's own "sellers" page calls (one POST on a click). Rows are untrusted text: capped, no links built from them.
const offTxt = (v, n) => String(v == null ? "" : v).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
function offParseFlipkart(j) {
  const list = j && j.RESPONSE && j.RESPONSE.data && j.RESPONSE.data.product_seller_detail_1 && j.RESPONSE.data.product_seller_detail_1.data; if (!Array.isArray(list)) return [];
  return list.map(x => { const v = x && x.value, si = v && v.sellerInfo && v.sellerInfo.value, price = v && v.pricing && v.pricing.value && v.pricing.value.finalPrice && +v.pricing.value.finalPrice.value, md = (v && v.metadata) || {};
    if (!si || !si.name || !(price >= 1 && price < 1e7)) return null;
    const rating = +md.averageRating; return { price, cond: "New", seller: offTxt(si.name, 80), sid: null, ships: "", rating: rating > 0 && rating <= 5 ? rating : null, ratings: 0, delivery: offTxt(v.deliveryInfo && v.deliveryInfo.primaryOption && v.deliveryInfo.primaryOption.deliveryDate, 40), dormant: si.dormantSeller === true, here: v.selected === true }; }).filter(Boolean);
}
// pin = the pincode saved in HAULS (Grocery tab). Flipkart's seller list is per delivery location: with a pin the delivery dates are for it, without one they are for Flipkart's default location, so they are dropped.
async function offFindFlipkart({ pid, pin }, doFetch = fetch, now = Date.now()) {
  if (!/^[A-Z0-9]{16}$/.test(pid || "")) return { offers: [], failed: true, reason: "parse" };
  pin = /^\d{6}$/.test(pin || "") ? pin : ""; const key = "fk:" + pid + ":" + pin;
  const hit = offCache.get(key); if (hit && now - hit.at < (hit.offers.length ? OFF_TTL : OFF_EMPTY_TTL)) return { offers: hit.offers, failed: false, reason: hit.reason, pin };
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), OFF_TIMEOUT);
  try {
    const r = await doFetch("https://1.rome.api.flipkart.com/api/3/page/dynamic/product-sellers", { method: "POST", credentials: "omit", signal: ctl.signal, headers: { "content-type": "application/json", "x-user-agent": "Mozilla/5.0 FKUA/website/42/website/Desktop" }, body: JSON.stringify({ requestContext: { productId: pid }, locationContext: pin ? { pincode: pin } : {} }) });
    if (!r.ok) throw offHttp(r.status);
    const j = await r.json().catch(() => { throw offBad("parse"); }), offers = offParseFlipkart(j).sort((a, b) => a.price - b.price), reason = offers.length ? "" : "empty";
    if (!offers.length && !(j && j.RESPONSE && j.RESPONSE.data && j.RESPONSE.data.product_seller_detail_1)) throw offBad("parse");
    if (!pin) offers.forEach(o => { o.delivery = ""; });
    offCache.set(key, { at: now, offers, reason }); return { offers, failed: false, reason, pin };
  } catch (e) { return { offers: [], failed: true, reason: e.reason || "network" }; } finally { clearTimeout(t); }
}

// ---- Myntra: sellers and per-size prices are inside the page itself (window.__myx.pdpData), so no request is needed.
function offState(text, marker) { // the JSON object after `marker =` (brace matching, string aware)
  const i = text.indexOf(marker); if (i < 0) return null; const a = text.indexOf("{", text.indexOf("=", i)); if (a < 0) return null;
  let d = 0, s = false, e = false;
  for (let k = a; k < text.length; k++) { const c = text[k]; if (s) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') s = false; continue; } if (c === '"') s = true; else if (c === "{") d++; else if (c === "}" && --d === 0) { try { return JSON.parse(text.slice(a, k + 1)); } catch { return null; } } }
  return null;
}
function offParseMyntra(text) { // -> [{sid, name, minPrice, maxPrice, sizes:[label]}] for sellers with stock, cheapest first; [] when the page has no seller data
  const st = offState(String(text || ""), "__myx"), pd = st && st.pdpData; if (!pd || !Array.isArray(pd.sellers) || !Array.isArray(pd.sizes)) return [];
  const by = new Map(pd.sellers.filter(s => s && s.sellerPartnerId != null).map(s => [String(s.sellerPartnerId), { sid: String(s.sellerPartnerId), name: offTxt(s.sellerName || s.displayName, 80), prices: [], sizes: [] }]));
  for (const z of pd.sizes) { if (!z || !z.available) continue; for (const d of z.sizeSellerData || []) { const s = d && by.get(String(d.sellerPartnerId)), p = d && +d.discountedPrice; if (s && d.availableCount > 0 && p >= 1 && p < 1e7) { s.prices.push(p); s.sizes.push(offTxt(z.label, 8)); } } }
  return [...by.values()].filter(s => s.name && s.prices.length).map(s => ({ sid: s.sid, name: s.name, minPrice: Math.min(...s.prices), maxPrice: Math.max(...s.prices), sizes: s.sizes.slice(0, 12) })).sort((a, b) => a.minPrice - b.minPrice);
}

// Amazon seller storefront (/sp?seller=ID): rating windows, % positive and star split, all public. Parsed from the page text.
function offParseSellerPage(html) {
  const t = String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const head = t.match(/(\d(?:\.\d)?) out of 5 stars?\s+(\d+)% positive (?:in the last (\d+) months?|lifetime) \(([\d,]+)(?: total)? ratings?\)/);
  if (!head) return null;
  const rev = t.slice(t.indexOf("Reviews", t.indexOf(head[0]))), win = [...rev.matchAll(/(\d(?:\.\d)?) out of 5\s+([\d,]+) ratings?/g)].slice(0, 4).map(m => ({ r: parseFloat(m[1]), n: parseInt(m[2].replace(/,/g, ""), 10) }));
  const dist = {}; for (const m of rev.slice(0, 600).matchAll(/([1-5]) star (\d+)%/g)) dist[m[1]] = +m[2];
  const total = parseInt(head[4].replace(/,/g, ""), 10);
  return { stars: parseFloat(head[1]), positive: +head[2], months: head[3] ? +head[3] : 0, n: total, m1: win[0] || null, m3: win[1] || null, m12: win[2] || null, life: win[3] || null, dist: Object.keys(dist).length === 5 ? dist : null };
}
const offSellerCache = new Map();
async function offSeller({ sid }, doFetch = fetch, now = Date.now()) {
  if (!/^[A-Z0-9]{8,16}$/.test(sid || "")) return { failed: true };
  const mem = offSellerCache.get(sid); if (mem && now - mem.at < 24 * 3600e3) return { data: mem.data };
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), OFF_TIMEOUT);
  try {
    const r = await doFetch(`https://www.amazon.in/sp?seller=${sid}`, { credentials: "include", signal: ctl.signal }); if (!r.ok) throw new Error("http " + r.status);
    const data = offParseSellerPage((await r.text()).slice(0, 2e6)); if (!data) return { failed: true, reason: "unreadable" }; offSellerCache.set(sid, { at: now, data }); return { data };
  } catch { return { failed: true }; } finally { clearTimeout(t); }
}
if (typeof module !== "undefined") module.exports = { offParseSellerPage, offSeller, offSellerCache, offParseAod, offBest, offFind, offCache, offParseFlipkart, offFindFlipkart, offParseMyntra, offState };
