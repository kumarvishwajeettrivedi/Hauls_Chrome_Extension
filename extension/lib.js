// Pure helpers shared by background, content script and the node self-check.⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​‌‌​​‌​​​‌‌​​​‌‌​​‌‌​‌‌​​‌‌​​​‌​​​‌‌‌​​​​​‌‌​‌​‌​​‌‌​​​​​‌‌​​‌​‌⁡
const SITES = {
  "amazon.in": { name: "Amazon", id: u => (u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/) || [])[1],
    title: ["#productTitle"], price: ["#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen", ".priceToPay .a-offscreen", "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen", "#apex_desktop .a-price:not(.a-text-price) .a-offscreen", "#centerCol .a-price:not(.a-text-price) .a-offscreen", "#ppd .a-price:not(.a-text-price) .a-offscreen", "#priceblock_ourprice", "#priceblock_dealprice",
      // Newer phone pages leave .a-offscreen blank and only draw the digits: read the visible whole-rupee part.
      ".priceToPay .a-price-whole", "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-price-whole", "#apex_desktop .a-price:not(.a-text-price) .a-price-whole", "#corePrice_feature_div .a-price:not(.a-text-price) .a-price-whole"],
    mrp: [".basisPrice .a-offscreen", ".a-text-price .a-offscreen"], image: ["#landingImage"], search: "https://www.amazon.in/s?k=" },
  "flipkart.com": { name: "Flipkart", id: u => { const p = u.searchParams.get("pid"); return /^[A-Za-z0-9]{1,40}$/.test(p || "") ? p : undefined; }, // pid comes from the address bar: only a plain id becomes a product key
    title: [], price: [], mrp: [], image: [], search: "https://www.flipkart.com/search?q=" },
  "myntra.com": { name: "Myntra", id: u => (u.pathname.match(/\/(\d+)\/buy/) || [])[1], title: [], price: [], mrp: [], image: [], search: "https://www.myntra.com/" },
};
// Verified extra shops (sites-extra.js loads first). JSON-LD/meta + the generic struck-through MRP finder do the extraction.
if (typeof EXTRA_SITES !== "undefined") { for (const [d, x] of Object.entries(EXTRA_SITES)) SITES[d] = { title: [], price: [], mrp: [], image: [], ...x }; if (SITES["croma.com"]) SITES["croma.com"].price = [".amount"]; }
const OTHERS = { Blinkit: "https://blinkit.com/s/?q=" };

const siteFor = host => Object.keys(SITES).find(d => host === d || host.endsWith("." + d));
const num = s => { const n = parseFloat(String(s ?? "").replace(/[^\d.]/g, "")); return isFinite(n) && n > 0 ? n : null; };

// First <script type=ld+json> Product with an offer price; works on raw HTML (no DOM needed).
function parseLd(html) {
  const s = String(html).slice(0, 1500000); let i = 0, guard = 0; // linear scan: no backtracking regex on untrusted HTML
  while (guard++ < 300 && (i = s.indexOf("<script", i)) !== -1) {
    const gt = s.indexOf(">", i); if (gt === -1) break;
    const tag = s.slice(i, gt + 1).toLowerCase(), end = s.indexOf("</script", gt); if (end === -1) break; i = end + 8;
    if (!tag.includes("application/ld+json")) continue;
    const body = s.slice(gt + 1, end); if (body.length > 400000) continue;
    try {
      const walk = x => Array.isArray(x) ? x.map(walk).find(Boolean)
        : x && typeof x === "object" ? (x["@graph"] ? walk(x["@graph"]) : /Product/.test([].concat(x["@type"]).join()) ? x : null) : null;
      const p = walk(JSON.parse(body.replace(/[\u0000-\u001f]+/g, " ")));
      if (!p) continue;
      const o = [].concat(p.offers || [])[0] || {};
      const price = num(o.price ?? o.lowPrice);
      if (price) return { title: p.name, image: [].concat(p.image || [])[0], price, mrp: num(o.highPrice) };
    } catch {}
  }
  return null;
}

// Append only when price changed or the last point is >6h old.
function addPoint(hist, price, ts) {
  const last = hist[hist.length - 1];
  if (last && last[1] === price && ts - last[0] < 6 * 3600e3) return hist;
  return [...hist, [ts, price]].slice(-2000);
}
function stats(hist) {
  if (!hist.length) return null;
  const ps = hist.map(h => h[1]);
  return { min: Math.min(...ps), max: Math.max(...ps), avg: Math.round(ps.reduce((a, b) => a + b) / ps.length), now: ps[ps.length - 1] };
}
// "500 g", "1 kg", "2 x 500 ml", "6 pcs" -> {amt, unit} in g / ml / pc
function parsePack(t) {
  const m = String(t || "").slice(0, 300).toLowerCase().replace(/,/g, "").replace(/\b[2-6]g\b/g, " ").match(/(?:(\d{1,4})\s*[x×]\s*)?(\d{1,6}(?:\.\d{1,3})?)\s*(kg|g|gm|ltr|l|ml|pcs|pc|piece|pieces|unit|units)\b/);
  if (!m) return null;
  const k = { kg: ["g", 1000], g: ["g", 1], gm: ["g", 1], l: ["ml", 1000], ltr: ["ml", 1000], ml: ["ml", 1] }[m[3]] || ["pc", 1];
  return { amt: (m[1] ? +m[1] : 1) * parseFloat(m[2]) * k[1], unit: k[0] };
}
// Price per 100 g/ml (or per piece) so different pack sizes compare fairly.
const unitPrice = (price, pack) => !pack ? null : Math.round((price / pack.amt) * (pack.unit === "pc" ? 1 : 100) * 100) / 100;
// Smart compare links: guess the category from the title, then list every store that plausibly sells it.
// ponytail: keyword guess + search URL templates; every template answered 200 on 2026-10-18 (Vijay Sales /search/ and Shoppers Stop /search?q= were 404 and are fixed). Swap for a classifier / link checker if it misfires.
const STORE = { // [search url prefix, brand colour]
  Amazon: ["https://www.amazon.in/s?k=", "#FF9900"], Flipkart: ["https://www.flipkart.com/search?q=", "#2874F0"], Myntra: ["https://www.myntra.com/", "#FF3F6C"], Ajio: ["https://www.ajio.com/search/?text=", "#2C4152"],
  "Tata CLiQ": ["https://www.tatacliq.com/search/?searchCategory=all&text=", "#B60D2B"], Meesho: ["https://www.meesho.com/search?q=", "#9F2089"], Snapdeal: ["https://www.snapdeal.com/search?keyword=", "#E40046"],
  Croma: ["https://www.croma.com/searchB?text=", "#12D8B0"], "Reliance Digital": ["https://www.reliancedigital.in/products?q=", "#E42529"], "Vijay Sales": ["https://www.vijaysales.com/search-listing?q=", "#E31E24"],
  "Shoppers Stop": ["https://www.shoppersstop.com/search/result?q=", "#1A1A1A"], Westside: ["https://www.westside.com/search?q=", "#2E7D32"], Decathlon: ["https://www.decathlon.in/search?Ntt=", "#0082C3"],
  Nykaa: ["https://www.nykaa.com/search/result/?q=", "#FC2779"], "Nykaa Fashion": ["https://www.nykaafashion.com/catalogsearch/result/?q=", "#FC2779"], Purplle: ["https://www.purplle.com/search?q=", "#E5457C"], Tira: ["https://www.tirabeauty.com/products?q=", "#111111"],
  FirstCry: ["https://www.firstcry.com/search?q=", "#F79220"], Pepperfry: ["https://www.pepperfry.com/site_product/search?q=", "#F26722"], IKEA: ["https://www.ikea.com/in/en/search/?q=", "#0058A3"],
  Crossword: ["https://www.crossword.in/search?q=", "#C8102E"], Bata: ["https://www.bata.com/in/search?q=", "#E1251B"], Blinkit: ["https://blinkit.com/s/?q=", "#F8CB46"], Zepto: ["https://www.zepto.com/search?query=", "#7B3FE4"],
  Instamart: ["https://www.swiggy.com/instamart/search?custom_back=true&query=", "#FC8019"], BigBasket: ["https://www.bigbasket.com/ps/?q=", "#84C225"], JioMart: ["https://www.jiomart.com/products?q=", "#0078AD"], DMart: ["https://www.dmart.in/search?searchTerm=", "#00A651"],
  "Google Shopping": ["https://www.google.com/search?tbm=shop&q=", "#4285F4"],
};
const CATS = [
  ["grocery", /\b(atta|rice|dal|oil|ghee|butter|milk|paneer|curd|salt|sugar|tea|coffee|biscuits?|snacks?|noodles|masala|spice|juice|chocolates?|detergent|shampoo|soap|toothpaste|flour|oats|cereal)\b/i, ["Blinkit", "Zepto", "Instamart", "BigBasket", "JioMart", "DMart", "Amazon", "Flipkart"]],
  ["beauty", /\b(lipstick|serum|moisturi[sz]er|face ?wash|sunscreen|perfume|deodorant|foundation|kajal|mascara|nail polish|skincare|makeup|conditioner|hair oil|trimmer|razor)\b/i, ["Nykaa", "Amazon", "Flipkart", "Purplle", "Tira", "Myntra", "Tata CLiQ", "Meesho"]],
  ["footwear", /\b(shoes?|sneakers?|sandals?|slippers?|flip[- ]?flops?|boots?|loafers?|heels?|crocs|running shoes)\b/i, ["Myntra", "Ajio", "Amazon", "Flipkart", "Tata CLiQ", "Bata", "Decathlon", "Meesho", "Snapdeal", "Shoppers Stop"]],
  ["fashion", /\b(t-?shirts?|shirts?|jeans|kurtas?|kurtis?|dress(es)?|sarees?|hoodies?|jackets?|trousers?|shorts|tops?|lehengas?|leggings|joggers|sweatshirts?|blazers?|polo|pants|skirts?|innerwear|bra|socks|tracksuits?|co-?ords?)\b/i, ["Myntra", "Ajio", "Amazon", "Flipkart", "Tata CLiQ", "Meesho", "Nykaa Fashion", "Shoppers Stop", "Westside", "Snapdeal"]],
  ["kids", /\b(toys?|diapers?|baby|stroller|kids?|lego|doll)\b/i, ["FirstCry", "Amazon", "Flipkart", "Meesho", "Tata CLiQ", "Snapdeal"]],
  ["sports", /\b(dumbbells?|yoga mat|treadmill|cricket|football|badminton|gym|protein|whey|cycle|bicycle|skipping)\b/i, ["Decathlon", "Amazon", "Flipkart", "Myntra", "Tata CLiQ", "Snapdeal"]],
  ["books", /\b(books?|novel|paperback|hardcover|notebook|diary|pen|stationery)\b/i, ["Amazon", "Flipkart", "Crossword", "Snapdeal", "Meesho"]],
  ["home", /\b(sofa|mattress|pillow|curtains?|bedsheet|lamp|furniture|table|chair|shelf|wardrobe|cookware|pressure cooker|mixer|grinder|air fryer|kettle|iron|vacuum|fan|cooler|heater|geyser|refrigerator|washing machine|microwave|oven|purifier|ac)\b/i, ["Amazon", "Flipkart", "Croma", "Reliance Digital", "Vijay Sales", "Tata CLiQ", "Pepperfry", "IKEA", "Snapdeal"]],
  ["electronics", /\b(keyboards?|mouse|mice|laptops?|monitors?|headphones?|earbuds?|earphones?|airdopes|airpods|speakers?|soundbar|tv|television|phones?|smartphones?|mobiles?|chargers?|cables?|camera|tablets?|ssd|hard ?disk|pen ?drive|router|printer|smart ?watch|powerbank|power bank|gaming|webcam|microphone|projector|ipad|iphone|macbook)\b/i, ["Amazon", "Flipkart", "Croma", "Reliance Digital", "Vijay Sales", "Tata CLiQ", "Snapdeal", "Meesho"]],
  ["general", /./, ["Amazon", "Flipkart", "Croma", "Reliance Digital", "Tata CLiQ", "Snapdeal", "Meesho", "Vijay Sales"]],
];
function smartLinks(title, here, brand) {
  // same query as the compare fetch when match.js is loaded (mtQuery); otherwise the head of the title, cut at the first colon / comma / bracket / dash
  const q = typeof mtQuery === "function" ? mtQuery(title, brand) : String(title || "").split(/[:;,|(\[]|\s[–-]\s|\swith\s/i)[0].replace(/[{}"]/g, " ").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  const [cat, , names] = CATS.find(c => c[1].test(title));
  const enc = n => n === "Myntra" ? q.replace(/\s+/g, "-").toLowerCase() : encodeURIComponent(q);
  const ns = [...names.filter(n => n !== here), "Google Shopping"];
  return { cat, links: ns.map(n => [n, STORE[n][0] + enc(n), STORE[n][1]]) };
}

// Community daily medians + your own observations. Your own day always wins; result sorted by time.
function mergeHistory(local, rows) {
  const day = t => new Date(t).toISOString().slice(0, 10), mine = new Set(local.map(h => day(h[0])));
  const comm = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === "object" && !mine.has(r.day) && +r.median_price > 0 && +r.median_price < 1e7 && isFinite(Date.parse(r.day + "T12:00:00Z"))).map(r => [Date.parse(r.day + "T12:00:00Z"), +r.median_price]);
  return [...comm, ...local].sort((a, b) => a[0] - b[0]);
}


// ---- trap-price editing + history ranges (pure, unit-tested) ----
// Step grows with the price so +/- feels right: ~0.5-1% of the price, rounded to a "nice" rupee amount.
function trapStep(price) { return price < 100 ? 1 : price < 500 ? 5 : price < 2000 ? 10 : price < 10000 ? 50 : price < 50000 ? 100 : 500; }
// Validates a typed/stepped trap price against the current price. Returns { ok, value, msg }.
function validateTrap(raw, price) {
  const v = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[₹,\s]/g, ""));
  if (!isFinite(v) || v <= 0) return { ok: false, msg: "Enter a price above ₹0" };
  if (v >= 1e7) return { ok: false, msg: "That's too high" };
  if (price && v >= price) return { ok: false, msg: "Alert price must be below today's price" };
  return { ok: true, value: Math.round(v) };
}
// Rows for the chart/stats over a window. The price in force at the window start is carried in (clamped to the start) so the step line begins correctly.
function sliceHistory(h, days, now = Date.now()) {
  if (!h.length || !days) return h.slice();
  const t0 = now - days * 864e5, inside = h.filter(p => p[0] >= t0), before = h.filter(p => p[0] < t0).pop();
  return before ? [[t0, before[1]], ...inside] : inside;
}
// Keep at most `max` points, preserving each bucket's min and max so peaks/dips survive.
function downsample(h, max = 200) {
  if (h.length <= max) return h.slice();
  const size = Math.ceil(h.length / (max / 2)), out = [];
  for (let i = 0; i < h.length; i += size) { const b = h.slice(i, i + size); let lo = b[0], hi = b[0]; for (const p of b) { if (p[1] < lo[1]) lo = p; if (p[1] > hi[1]) hi = p; } [lo, hi].sort((a, c) => a[0] - c[0]).forEach((p, k, a) => { if (k === 0 || p !== a[0]) out.push(p); }); }
  return out;
}
// Compact Indian-grouped amount for the notch pill: ₹64, ₹1,23,456, ₹1Cr+
const notchAmount = n => { const a = Math.abs(Math.round(n)); return a >= 1e7 ? "₹" + Math.floor(a / 1e7) + "Cr+" : "₹" + a.toLocaleString("en-IN"); };
// ---- storage boundary: ONE normaliser for every string that came from a page or the server (guard.js sanitizeText is the same rule for the message path) ----
// Strips control, bidi, zero-width, tag and lone-surrogate characters, collapses whitespace, caps the length. Never throws; non-string/number input becomes "".
const _BAD_CH = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}\ud800-\udfff]/gu; // /u: only UNPAIRED surrogates match. U+200C/U+200D (ZWNJ/ZWJ) stay: Indic conjuncts and emoji sequences need them (the database keeps them too)
const cleanText = (s, max = 500) => (typeof s === "string" || typeof s === "number" ? String(s) : "").replace(_BAD_CH, " ").replace(/\s+/g, " ").trim().slice(0, max).replace(/[\ud800-\udfff]/gu, "").trim();
// https only, must parse, no user:pass@, no javascript:/data:/blob:/http:. Returns the normalised href (ASCII only: the parser percent-encodes and punycodes) or null.
function cleanUrl(s, max = 2000) {
  if (typeof s !== "string" || s.length > max * 3) return null; let u; try { u = new URL(s.trim()); } catch { return null; }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null; const h = u.href.replace(/'/g, "%27"); return h.length <= max ? h : null; // the database refuses a raw apostrophe in a link
}
// Names that must never be dictionary keys: "__proto__", "constructor", "toString"... would hit Object.prototype on a plain {} (prototype pollution). Keys come from the address bar and from server rows.
// Same character class as the database key CHECK (and guard.js key()): control, space, bidi, invisible, tag characters and the quote/angle/backslash characters that break out of HTML or SQL text.
const _BAD_KEY = /[\u0000-\u0020\u007f-\u00a0\u00ad\u1680\u2000-\u200a\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u202f\u205f\u2060-\u2064\u2066-\u2069\u3000\ufeff\u{e0000}-\u{e007f}\ud800-\udfff"'`<>\\]/u;
const okKey = k => typeof k === "string" && k.length > 0 && k.length <= 200 && !(k in Object.prototype) && k !== "prototype" && !_BAD_KEY.test(k);
const planOf = p => ["free", "pro", "max"].includes(p) ? p : "free"; // must list the tiers of LIMITS (analysis.js; a unit test compares them)
// Normalises a scraped product into exactly the shape the background accepts (see guard.js). Returns null when it can't be tracked safely.
function cleanProduct(p) {
  if (!p || typeof p !== "object") return null;
  const txt = cleanText, https = s => cleanUrl(s);
  const price = Number(p.price), mrp = Number(p.mrp), key = txt(p.key, 200), url = https(p.url);
  if (!okKey(key) || !url || !isFinite(price) || price <= 0 || price >= 1e7) return null;
  return { key, site: txt(p.site, 60), url, title: txt(p.title, 500), image: https(p.image), price, mrp: isFinite(mrp) && mrp > price && mrp < 1e7 ? mrp : null, src: ["jsonld", "dom", "meta"].includes(p.src) ? p.src : "dom", brand: txt(p.brand, 60) || undefined, mpn: txt(p.mpn, 40) || undefined, seller: p.seller && typeof p.seller === "object" && txt(p.seller.name, 80) ? { name: txt(p.seller.name, 80), ships: txt(p.seller.ships, 60), text: txt(p.seller.text, 200), href: txt(p.seller.href, 300) } : null };
}
// ---- S3 safe readers: persisted data may be old, hand-edited or corrupted. They repair on read and never throw. Unknown fields are preserved. ----
const _uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
function safeItem(it) {
  if (!it || typeof it !== "object" || Array.isArray(it)) return null;
  const out = { ...it }; for (const k of ["__proto__", "constructor", "prototype"]) if (Object.hasOwn(out, k)) delete out[k]; // a stored/synced object may carry these as plain own keys
  out.hist = (Array.isArray(it.hist) ? it.hist : []).filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && +p[1] > 0).map(p => [+p[0], +p[1]]).sort((a, b) => a[0] - b[0]).slice(-2000);
  out.wish = !!it.wish;
  for (const [k, n] of [["site", 60], ["title", 500], ["seller", 80]]) if (typeof out[k] !== "string") delete out[k]; else out[k] = cleanText(out[k], n);
  for (const k of ["url", "image"]) { const u = typeof out[k] === "string" ? cleanUrl(out[k]) : null; if (u) out[k] = u; else delete out[k]; }
  if (!(+out.target > 0 && +out.target < 1e7)) delete out.target; else out.target = +out.target;
  return out;
}
function safeItems(raw) {
  const out = {}; if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) { if (!okKey(k)) continue; const s = safeItem(v); if (s) out[k] = s; }
  return out;
}
// Remote kill switch (data only): flags.disabled_features may contain "chart-read", "chart-upload", "chart-auto", "bg-upload".
const featureOff = (flags, name) => !!(flags && Array.isArray(flags.disabled_features) && flags.disabled_features.includes(name));
const safeOutbox = raw => (Array.isArray(raw) ? raw : []).filter(o => o && typeof o === "object" && (o.t === "watch" || (o.t === "obs" && Number.isFinite(o.at) && Number.isFinite(o.price) && o.price > 0 && o.price < 1e7) || (o.t === "chart" && Array.isArray(o.series) && o.series.length >= 2 && o.series.length <= 130 && o.series.every(q => Array.isArray(q) && q.length === 2 && isFinite(q[0]) && isFinite(q[1])))) && typeof o.key === "string" && o.key.length <= 200).map(o => (typeof o.id === "string" && o.id ? o : { ...o, id: _uid() })).slice(-500);
const safeUsage = raw => raw && typeof raw === "object" && typeof raw.month === "string" && Array.isArray(raw.keys) ? { month: raw.month, keys: raw.keys.filter(k => typeof k === "string").slice(0, 5000) } : null;
// "Pass this time" (signed-in free users over the monthly lookup limit): the person's own choice to keep browsing for the rest of the LOCAL day. Remembered per account; tomorrow the limit card returns while they are still over it.
const dayKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const passOk = (pass, uid, now = new Date()) => !!uid && !!pass && typeof pass === "object" && pass.uid === uid && pass.day === dayKey(now);
// The Product tab's heart/trap must mirror the stored watchlist (it changes from the Watchlist tab, another tab, or a sync). Missing item = not wished, no trap.
function withStoredFlags(it, items, key) { const st = (items && items[key]) || {}, o = { ...it, wish: !!st.wish }; if (st.target) o.target = st.target; else delete o.target; return o; }
// S6: what an open panel should do about a storage change made elsewhere (another tab, a sync, the popup). Never rebuilds the panel under a typing user.
function liveUpdate(ch, { tab, range, typing, flagsChanged }) {
  const out = { redraw: false };
  if (ch.profile || ch.authNotice) out.who = true; // signed in / out: the header avatar must follow
  if (ch.pin) out.pin = ch.pin.newValue || "";
  if (ch.range && ch.range.newValue !== range && ["30D", "90D", "1Y", "All"].includes(ch.range.newValue)) { out.range = ch.range.newValue; out.redraw = tab === "product"; }
  if (ch.items && (tab === "traps" || (tab === "product" && flagsChanged))) out.redraw = true;
  if (typing) out.redraw = false;
  return out;
}
// Grocery results: sort modes, pack-size chips (only sizes that 2+ results share), and the pack filter. Pure; never mutates its input.
const sortGrocery = (items, mode) => mode === "price" ? [...items].sort((a, b) => a.price - b.price) : mode === "unit" ? [...items].sort((a, b) => (a.per ?? 1e12) - (b.per ?? 1e12)) : [...items];
function packChips(items) { const n = {}; for (const i of items) if (i.pack) n[i.pack] = (n[i.pack] || 0) + 1; return Object.keys(n).filter(k => n[k] >= 2).sort((a, b) => n[b] - n[a]).slice(0, 4); }
const filterPack = (items, pack) => pack ? items.filter(i => i.pack === pack) : items;
// ---- saved delivery places (Home, Mom's house, Office): pure, never mutate, always return a clean list ----
const MAX_PLACES = 8, PIN6 = /^\d{6}$/;
const cleanName = n => cleanText(typeof n === "string" ? n.replace(/[<>]/g, " ") : n, 24);
function safePlaces(v) {
  const out = [], seen = new Set(); if (!Array.isArray(v)) return out;
  for (const p of v) { if (!p || typeof p !== "object") continue; const name = cleanName(p.name), pin = String(p.pin || ""), id = typeof p.id === "string" && /^[\w-]{1,20}$/.test(p.id) ? p.id : null;
    if (!PIN6.test(pin) || !name || !id || seen.has(id)) continue; seen.add(id); out.push({ id, name, pin }); if (out.length >= MAX_PLACES) break; }
  return out;
}
const newPlaceId = () => "p" + Math.random().toString(36).slice(2, 10);
function addPlace(list, name, pin) {
  const l = safePlaces(list); name = cleanName(name);
  if (!name) return { error: "Give this place a name." }; if (!PIN6.test(pin)) return { error: "Pincode must be 6 digits." }; if (l.length >= MAX_PLACES) return { error: "You can save up to 8 places." };
  if (l.some(p => p.pin === pin && p.name.toLowerCase() === name.toLowerCase())) return { error: "Already saved." };
  return { list: [...l, { id: newPlaceId(), name, pin }] };
}
function updatePlace(list, id, patch) {
  const l = safePlaces(list), i = l.findIndex(p => p.id === id); if (i < 0) return { error: "Not found." };
  const name = patch.name === undefined ? l[i].name : cleanName(patch.name), pin = patch.pin === undefined ? l[i].pin : String(patch.pin);
  if (!name) return { error: "Give this place a name." }; if (!PIN6.test(pin)) return { error: "Pincode must be 6 digits." };
  return { list: l.map((p, j) => j === i ? { ...p, name, pin } : p) };
}
const removePlace = (list, id) => safePlaces(list).filter(p => p.id !== id);
const placeForPin = (list, pin) => safePlaces(list).find(p => p.pin === pin) || null;
// Coordinates must belong to the pincode they travel with: a stale lat/lon from a previous pincode would give another area's prices.
function distKm(a, b) { const r = x => x * Math.PI / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); }
const locConsistent = (loc, centroid, maxKm = 40) => !loc || !centroid || typeof loc.lat !== "number" || typeof loc.lon !== "number" || distKm(loc, centroid) <= maxKm;
// A product lookup that finishes late may repaint the Product tab, only while the panel is open and nobody is typing (a repaint destroys inputs).
const canRedraw = ({ open, tab, typing }) => !!open && tab === "product" && !typing;
// Pincode field next to "Use my location": clean = nothing to save, dirty = a different valid pincode waiting for the sync icon, bad = not 6 digits.
const pinFieldState = (draft, saved) => { const d = String(draft == null ? "" : draft).trim(); return !PIN6.test(d) ? "bad" : d === saved ? "clean" : "dirty"; };
if (typeof module !== "undefined") module.exports = { planOf, cleanText, cleanUrl, okKey, featureOff, pinFieldState, canRedraw, MAX_PLACES, safePlaces, addPlace, updatePlace, removePlace, placeForPin, distKm, locConsistent, sortGrocery, packChips, filterPack, withStoredFlags, liveUpdate, safeItem, safeItems, safeOutbox, safeUsage, dayKey, passOk, cleanProduct, trapStep, validateTrap, sliceHistory, downsample, notchAmount, mergeHistory, smartLinks, parsePack, unitPrice, SITES, siteFor, num, parseLd, addPoint, stats };
