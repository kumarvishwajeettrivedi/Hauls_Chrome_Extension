// Best price across stores. Runs in the service worker on a user click: one search page per store, read as data, matched to this product.
// Pure parsers/matcher are exported for tests; the fetch layer is cmpFind. Names are prefixed cmp* because importScripts shares one global scope.
const CMP_TIMEOUT = 8000, CMP_TTL = 15 * 60e3;
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
    const title = [o.titles.title, o.titles.subtitle].filter(Boolean).join(" "), url = "https://www.flipkart.com" + o.baseUrl;
    if (!price || !title || !/^\/[^/]/.test(o.baseUrl)) continue;
    const pid = (o.baseUrl.match(/pid=([A-Z0-9]+)/) || [])[1] || o.baseUrl, prev = out.get(pid);
    if (!prev || price < prev.price) out.set(pid, { title, price, url });
  }
  return [...out.values()];
}
function cmpParseReliance(html) {
  const st = cmpStateJson(html), out = []; if (!st) return [];
  for (const o of cmpWalk(st)) {
    const eff = o && o.price && o.price.effective, price = eff && cmpNum(eff.min);
    if (!price || !o.name || !o.slug || !/^[a-z0-9-]+$/i.test(o.slug)) continue;
    out.push({ title: cmpEnt(o.name), price, url: "https://www.reliancedigital.in/product/" + o.slug + "/" });
  }
  return out;
}
function cmpParseAmazon(html) {
  const re = /<div[^>]*data-asin="([A-Z0-9]{10})"[^>]*data-component-type="s-search-result"/g, starts = []; let m;
  while ((m = re.exec(html))) starts.push({ i: m.index, asin: m[1] });
  return starts.map((s, k) => {
    const chunk = html.slice(s.i, k + 1 < starts.length ? starts[k + 1].i : s.i + 30000);
    if (/puis-sponsored-label|>\s*Sponsored\s*</i.test(chunk)) return null;
    const t = chunk.match(/<h2[^>]*aria-label="([^"]+)"/) || chunk.match(/<h2[^>]*>\s*<span[^>]*>([^<]{12,})</), p = chunk.match(/class="a-price"[^>]*>\s*<span class="a-offscreen">₹\s?([\d,]+(?:\.\d+)?)</) || chunk.match(/class="a-price-whole">([\d,]+)/);
    const title = t && cmpEnt(t[1]).trim(), price = p && cmpNum(p[1]);
    return title && price ? { title, price, url: "https://www.amazon.in/dp/" + s.asin } : null;
  }).filter(Boolean);
}

// ---- matching ----
const CMP_STOP = new Set("the a an and or with for of in on to by from new latest buy online india pack set combo mobile phone smartphone camera control wireless bluetooth mic tws ear buds earbuds earphones headphones headset 3g 4g 5g".split(" "));
const cmpTokens = t => String(t || "").toLowerCase().replace(/[™®©]/g, "").replace(/(\d)\s*(gb|tb|mb|mah|hrs?|hours?|w|mm|db|ms|inch|in|cm|kg|ml|ltr|l)\b/g, "$1$2").replace(/\bhours?\b|\bhrs?\b/g, "h").split(/[^a-z0-9]+/).filter(x => x && !CMP_STOP.has(x));
const cmpStorage = toks => new Set(toks.filter(x => /^\d+(gb|tb)$/.test(x)));
// Identity = the model name only: cut at the first spec separator (": , ( | -  with"), then add the storage size found anywhere in the first 140 chars.
const cmpHead = title => String(title || "").split(/[:,(|;]|\s[-–—]\s|\swith\s/i)[0];
function cmpIdentity(title) {
  const head = cmpTokens(cmpHead(title)).slice(0, 8), st = [...cmpStorage(cmpTokens(String(title || "").slice(0, 140)))][0], toks = st && !head.includes(st) ? [...head, st] : head;
  return { toks, brand: toks[0] || "", nums: toks.filter(x => /\d/.test(x)), storage: cmpStorage(toks) };
}
function cmpMatch(id, cand) {
  const ct = cmpTokens(cand.title), cs = new Set(ct), shared = id.toks.filter(x => cs.has(x)).length, cover = shared / Math.max(1, id.toks.length);
  if (cmpVariants(id.toks) !== cmpVariants(ct.slice(0, 14))) return null;
  const cst = cmpStorage(ct); if (id.storage.size && cst.size && ![...id.storage].some(x => cst.has(x))) return null; // 128GB is not 256GB
  const nums = id.nums, hit = nums.filter(x => cs.has(x)).length, numCover = nums.length ? hit / nums.length : 1;
  const core = id.toks.slice(0, 6).filter(x => /\d/.test(x)), coreOk = core.every(x => cs.has(x));
  const brandOk = cmpEnt(cand.title).toLowerCase().includes(id.brand); // some stores keep the brand outside the title, then the model must match fully
  if (!brandOk && !(cover >= 0.6 && numCover === 1)) return null;
  let label = null; if (coreOk && numCover >= 0.7 && cover >= 0.5) label = "Exact"; else if (coreOk && numCover >= 0.6 && cover >= 0.35) label = "Likely"; else if (cover >= 0.45 && numCover >= 0.4) label = "Maybe";
  return label ? { label, score: cover + numCover } : null;
}
const CMP_VARIANT = new Set("plus pro max ultra mini lite fe se air go neo anc elite".split(" ")); // same number, different product
const cmpVariants = toks => [...new Set(toks.filter(x => CMP_VARIANT.has(x)))].sort().join();
const CMP_RANK = { Exact: 3, Likely: 2, Maybe: 1 };
// Best candidate per store: highest confidence first, then lowest price. Prices far from the reference are dropped as a different product.
function cmpPick(id, cands, refPrice) {
  let best = null;
  for (const c of cands) {
    if (refPrice && (c.price < refPrice * 0.3 || c.price > refPrice * 4)) continue;
    const m = cmpMatch(id, c); if (!m) continue;
    const better = !best || CMP_RANK[m.label] > CMP_RANK[best.confidence] || (CMP_RANK[m.label] === CMP_RANK[best.confidence] && (m.score > best.score + 0.15 || (Math.abs(m.score - best.score) <= 0.15 && c.price < best.price)));
    if (better) best = { ...c, confidence: m.label, score: m.score };
  }
  return best;
}

const CMP_STORES = {
  Amazon: { host: "amazon.in", search: q => "https://www.amazon.in/s?k=" + encodeURIComponent(q), parse: cmpParseAmazon },
  Flipkart: { host: "flipkart.com", search: q => "https://www.flipkart.com/search?q=" + encodeURIComponent(q), parse: cmpParseFlipkart },
  "Reliance Digital": { host: "reliancedigital.in", search: q => "https://www.reliancedigital.in/products?q=" + encodeURIComponent(q), parse: cmpParseReliance },
};
const cmpQuery = title => cmpIdentity(title).toks.join(" ");
const cmpCache = new Map();

async function cmpFetch(url, doFetch = fetch) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), CMP_TIMEOUT);
  try { const r = await doFetch(url, { credentials: "include", signal: ctl.signal, redirect: "follow" }); if (!r.ok) throw new Error("http " + r.status); return await r.text(); } finally { clearTimeout(timer); }
}
// -> { results: [{store,title,price,url,confidence}], failed: [store], here }
async function cmpFind({ title, site, price }, doFetch = fetch, now = Date.now()) {
  const id = cmpIdentity(title), q = cmpQuery(title); if (!q) return { results: [], failed: [], here: site };
  const stores = Object.entries(CMP_STORES).filter(([n]) => n !== site), results = [], failed = [];
  await Promise.all(stores.map(async ([name, s]) => {
    const key = name + "|" + q, hit = cmpCache.get(key);
    let cands; if (hit && now - hit.at < CMP_TTL) cands = hit.cands; else { try { cands = s.parse(await cmpFetch(s.search(q), doFetch)); cmpCache.set(key, { at: now, cands }); } catch { failed.push(name); return; } }
    const best = cmpPick(id, cands, price); if (best) results.push({ store: name, title: best.title, price: best.price, url: best.url, confidence: best.confidence });
  }));
  results.sort((a, b) => a.price - b.price);
  return { results, failed, here: site };
}
if (typeof module !== "undefined") module.exports = { cmpParseFlipkart, cmpParseReliance, cmpParseAmazon, cmpIdentity, cmpMatch, cmpPick, cmpFind, cmpStateJson, cmpTokens, CMP_STORES, cmpCache };
