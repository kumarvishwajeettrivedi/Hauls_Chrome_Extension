// Best price across stores. Runs in the service worker on a user click: one search page per store, read as data, matched to this product.⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​​‌‌​​​‌​​‌‌​‌​‌​‌‌​​​​‌​​‌‌‌​​‌​​‌‌​​‌‌​​‌‌​​‌​​‌‌​​‌‌​​‌‌​​​‌​⁡
// Pure parsers/matcher are exported for tests; the fetch layer is cmpFind. Names are prefixed cmp* because importScripts shares one global scope.
const CMP_TIMEOUT = 6000, CMP_TTL = 15 * 60e3, CMP_KEY = "cmp", CMP_MAX = 200;
const cmpEnt = s => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/g, "/").replace(/&#x3D;/g, "=").replace(/&reg;|&trade;/g, "");
const cmpNum = v => { const n = parseFloat(String(v).replace(/[^\d.]/g, "")); return isFinite(n) && n > 0 && n < 1e7 ? n : null; };

// The JSON object that follows `window.__INITIAL_STATE__ =` (brace matching, string aware; the script often continues after it).
function cmpStateJson(html, marker = "__INITIAL_STATE__") {
  const i = html.indexOf(marker); if (i < 0) return null;
  const a = html.indexOf("{", html.indexOf("=", i)); if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = a; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) { try { return JSON.parse(html.slice(a, k + 1)); } catch { return null; } }
  }
  return null;
}
function* cmpWalk(o, depth = 0) { if (depth > 40 || !o || typeof o !== "object") return; yield o; for (const v of Array.isArray(o) ? o : Object.values(o)) yield* cmpWalk(v, depth + 1); }

function cmpParseFlipkart(html) {
  const st = cmpStateJson(html), out = new Map(); if (!st) return [];
  for (const o of cmpWalk(st)) {
    if (!o.titles || !o.pricing || !o.baseUrl || !Array.isArray(o.pricing.prices)) continue;
    const live = o.pricing.prices.filter(p => p && !p.strikeOff).map(p => cmpNum(p.value)).filter(Boolean), price = live.length ? live[live.length - 1] : null;
    const title = [o.titles.title, o.titles.subtitle].filter(Boolean).join(" "), brand = String(o.titles.superTitle || "").slice(0, 60), url = "https://www.flipkart.com" + o.baseUrl;
    if (!price || !title || !/^\/[^/]/.test(o.baseUrl) || /OUT|SOLD|UNAVAIL|SOON/i.test(String(o.availability && o.availability.displayState))) continue; // "Currently unavailable" rows still carry a price
    const pid = (o.baseUrl.match(/pid=([A-Z0-9]+)/) || [])[1] || o.baseUrl, prev = out.get(pid);
    if (!prev || price < prev.price) out.set(pid, { title, price, url, brand });
  }
  return [...out.values()];
}
function cmpParseReliance(html) {
  const st = cmpStateJson(html), out = []; if (!st) return [];
  for (const o of cmpWalk(st)) {
    const eff = o && o.price && o.price.effective, price = eff && cmpNum(eff.min);
    if (!price || !o.name || !o.slug || !/^[a-z0-9-]+$/i.test(o.slug) || o.sellable === false) continue;
    out.push({ title: cmpEnt(o.name), price, url: "https://www.reliancedigital.in/product/" + o.slug + "/", brand: cmpEnt((o.brand && o.brand.name) || "").slice(0, 60) });
  }
  return out;
}
function cmpParseMyntra(html) {
  const st = cmpStateJson(html, "__myx"), list = st && st.searchData && st.searchData.results && st.searchData.results.products; if (!Array.isArray(list)) return [];
  return list.filter(o => !(o && Array.isArray(o.inventoryInfo) && o.inventoryInfo.length && !o.inventoryInfo.some(x => x && x.available))).map(o => { const price = cmpNum(o && o.price), title = cmpEnt((o && (o.productName || o.product)) || ""), lp = String((o && o.landingPageUrl) || ""); return price && title && /^[a-z0-9\-+.%\/]+$/i.test(lp) ? { title, price, url: "https://www.myntra.com/" + lp, brand: cmpEnt(o.brand || "").slice(0, 60), fashion: true } : null; }).filter(Boolean);
}
const CMP_NONELEC = /\b(jeans?|shirts?|t-?shirts?|tshirts?|polo|kurtas?|kurtis?|dress|jackets?|hoodies?|sweatshirts?|trousers|chinos|sarees?|shoes?|sneakers|sandals|slippers|loafers|socks|innerwear|bra|leggings|joggers|blazer|skirt|paperback|hardcover|novel|handwash|shampoo|soap|lipstick|serum|moisturi[sz]er|sunscreen|perfume|detergent|atta|sofa|mattress|bedsheet|wardrobe|curtains?|furniture|tv unit)\b/i; // Reliance Digital sells electronics and appliances only
const CMP_FASHION = /\b(bags?|backpacks?|wallets?|sunglasses|earbuds?|earphones?|headphones?|jeans|jean|shirt|shirts|t-?shirt|tshirt|tshirts|polo|kurta|kurti|dress|jacket|hoodie|sweatshirt|trousers|chinos|shorts|saree|top|tops|shoes|sneakers|sandals|slippers|loafers|socks|innerwear|bra|leggings|joggers|track ?pants?|blazer|suit|skirt|watch)\b/i;
function cmpParseAmazon(html) {
  const re = /<div[^>]*data-asin="([A-Z0-9]{10})"[^>]*data-component-type="s-search-result"/g, starts = []; let m;
  while ((m = re.exec(html))) starts.push({ i: m.index, asin: m[1] });
  return starts.map((s, k) => {
    const chunk = html.slice(s.i, k + 1 < starts.length ? starts[k + 1].i : s.i + 30000);
    if (/puis-sponsored-label|>\s*Sponsored\s*<|Currently unavailable/i.test(chunk)) return null;
    const t = chunk.match(/<h2[^>]*aria-label="([^"]+)"/) || chunk.match(/<h2[^>]*>\s*<span[^>]*>([^<]{12,})</), p = chunk.match(/class="a-price"[^>]*>\s*<span class="a-offscreen">₹\s?([\d,]+(?:\.\d+)?)</) || chunk.match(/class="a-price-whole">([\d,]+)/);
    const title = t && cmpEnt(t[1]).trim(), price = p && cmpNum(p[1]), bm = chunk.match(/<h2[^>]*class="[^"]*a-size-mini[^"]*"[^>]*>\s*<span[^>]*>([^<]{1,60})</), brand = bm ? cmpEnt(bm[1]).trim() : "";
    return title && price ? { title, price, url: "https://www.amazon.in/dp/" + s.asin, brand } : null;
  }).filter(Boolean);
}

// ---- matching ----
// Identity and matching live in match.js (mtFacts / mtCompare): brand + model + every known spec must agree, conflicts reject.
function cmpIdentity(title, brand, mpn) { const f = mtFacts(title, brand, mpn); return { f, brand: f.brand, title, title0: title, toks: mtQuery(title, brand, mpn).split(" ").filter(Boolean) }; }
function cmpMatch(id, cand) { const r = mtCompare(id.f, cand); return r.verdict ? { label: r.verdict === "exact" ? "Exact" : "Likely", score: r.verdict === "exact" ? 2 : 1 } : null; }
const CMP_RANK = { Exact: 3, Likely: 2 };
// Best candidate per store: highest confidence first, then lowest price. Prices far from the reference are dropped as a different product.
function cmpPick(id, cands, refPrice) {
  let best = null;
  for (const c of cands) {
    if (refPrice && (c.price < refPrice * 0.3 || c.price > refPrice * 4)) continue;
    const m = cmpMatch(id, c); if (!m) continue; if (c.fashion && m.label === "Exact") { m.label = "Likely"; m.score = 1; } // apparel has no style code on the page: same line and cut, never "confirmed"
    if (refPrice && m.label === "Exact" && (c.price > refPrice * 2 || c.price < refPrice / 2)) { m.label = "Likely"; m.score = 1; } // a price this far off cannot prove a wrong product, but it is too odd for "Same product" / Lowest
    const better = !best || CMP_RANK[m.label] > CMP_RANK[best.confidence] || (CMP_RANK[m.label] === CMP_RANK[best.confidence] && (m.score > best.score + 0.15 || (Math.abs(m.score - best.score) <= 0.15 && c.price < best.price)));
    if (better) best = { ...c, confidence: m.label, score: m.score };
  }
  return best;
}


// Why the nearest same-brand candidate was rejected, so an empty result is explainable instead of silent.
function cmpClosest(id, cands, refPrice) {
  let best = null;
  for (const c of cands) {
    if (refPrice && (c.price < refPrice * 0.3 || c.price > refPrice * 4)) continue;
    const r = mtCompare(id.f, c); if (r.verdict || r.conflicts.includes("brand") || !r.conflicts.length) continue;
    const ct = [...mtFacts(c.title, id.brand).tokens].filter(x => x.length > 1 && !x.includes(".")); if (!(id.f.model.length ? id.f.model.some(m => ct.some(x => (x.startsWith(m) || m.startsWith(x)) && Math.abs(x.length - m.length) <= 2)) : id.f.series.filter(x => ct.includes(x)).length >= Math.min(2, id.f.series.length))) continue; // same brand is not enough: share the model (or, with none, the product line), else the row is noise (a sofa for a TV unit, a Galaxy A27 for an M35)
    if (!best || r.conflicts.length < best.r.conflicts.length) best = { c, r };
  }
  if (!best) return null;
  const k = best.r.conflicts[0], why = /^model/.test(k) ? "different model" : k === "version" ? "different version" : k === "name" ? "different product" : "different " + k;
  return { title: best.c.title, price: best.c.price, url: best.c.url, why };
}

const CMP_STORES = {
  Amazon: { host: "amazon.in", search: q => "https://www.amazon.in/s?k=" + encodeURIComponent(q), parse: cmpParseAmazon },
  Flipkart: { host: "flipkart.com", search: q => "https://www.flipkart.com/search?q=" + encodeURIComponent(q), parse: cmpParseFlipkart },
  Myntra: { host: "myntra.com", search: q => "https://www.myntra.com/" + q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "?rawQuery=" + encodeURIComponent(q), parse: cmpParseMyntra, applies: title => CMP_FASHION.test(title) },
  "Reliance Digital": { host: "reliancedigital.in", search: q => "https://www.reliancedigital.in/products?q=" + encodeURIComponent(q), parse: cmpParseReliance, applies: title => !CMP_NONELEC.test(title) },
};
const cmpQuery = (title, brand, mpn) => cmpIdentity(title, brand, mpn).toks.join(" ");
// Candidate lists live in chrome.storage.session (the service worker is killed after ~30 s idle, which emptied a Map): one key, newest CMP_MAX entries, CMP_TTL. Only real answers are stored.
const cmpLoad = async () => { try { return (await chrome.storage.session.get(CMP_KEY))[CMP_KEY] || {}; } catch { return {}; } };
const cmpSave = async (map, now) => { try { const ks = Object.keys(map).filter(k => now - map[k].at < CMP_TTL).sort((a, b) => map[b].at - map[a].at).slice(0, CMP_MAX); await chrome.storage.session.set({ [CMP_KEY]: Object.fromEntries(ks.map(k => [k, map[k]])) }); } catch {} };
const CMP_BLOCK = /bm-verify|captcha|access denied|are you a robot|robot check|unusual traffic|pardon our interruption/i;

async function cmpFetch(url, doFetch = fetch) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), CMP_TIMEOUT);
  try { const r = await doFetch(url, { credentials: "include", signal: ctl.signal, redirect: "follow" }); if (!r.ok) throw new Error("http " + r.status); if (/captcha|\/blocked/i.test(String(r.url || ""))) throw new Error("blocked"); return await r.text(); } finally { clearTimeout(timer); }
}
// -> { results: [{store,title,price,url,confidence}], failed: [store], here }
async function cmpFind({ title, brand, mpn, site, price }, doFetch = fetch, now = Date.now()) {
  const id = cmpIdentity(title, brand, mpn), q = id.toks.join(" "); if (!q || (!id.brand && !(id.f.book && id.f.authors.length))) return { results: [], failed: [], here: site }; // no brand (and no book author) = nothing we could confirm: skip the requests
  const stores = Object.entries(CMP_STORES).filter(([n, sd]) => n !== site && (!sd.applies || sd.applies(title))), results = [], failed = [], near = [], seen = {}, why = {}, cache = await cmpLoad(); let dirty = false;
  await Promise.all(stores.map(async ([name, s]) => {
    const key = name + "|" + q, hit = cache[key];
    let cands; if (hit && now - hit.at < CMP_TTL) cands = hit.cands; else { try {
      const html = await cmpFetch(s.search(q), doFetch); cands = s.parse(html);
      if (!cands.length && (html.length < 3000 || (html.length < 150000 && CMP_BLOCK.test(html)))) throw new Error("blocked"); // an empty or challenge page is a failed store, not "no match"
      if (cands.length) { cache[key] = { at: now, cands: cands.slice(0, 40) }; dirty = true; } // an empty list is never cached
    } catch (e) { failed.push(name); why[name] = e && e.name === "AbortError" ? "timeout" : /blocked|http (4|5)\d\d/.test(String(e && e.message)) ? "blocked" : "network"; return; } }
    seen[name] = cands.length; const best = cmpPick(id, cands, price); if (best) results.push({ store: name, title: best.title, price: best.price, url: best.url, confidence: best.confidence, checks: mtChecks(id.f, best, id.title0) }); else { const cl = cmpClosest(id, cands, price); if (cl) near.push({ store: name, ...cl }); }
  }));
  if (dirty) await cmpSave(cache, now);
  results.sort((a, b) => a.price - b.price);
  return { results, failed, why, here: site, near, seen };
}
if (typeof module !== "undefined") module.exports = { cmpParseMyntra, cmpClosest, cmpParseFlipkart, cmpParseReliance, cmpParseAmazon, cmpIdentity, cmpMatch, cmpPick, cmpFind, cmpStateJson, CMP_STORES, cmpQuery, CMP_KEY };
