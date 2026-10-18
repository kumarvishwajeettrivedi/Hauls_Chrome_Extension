// Message guard for chrome.runtime.onMessage. Pure; works in the service worker (importScripts) and node (module.exports).⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​​‌‌‌​​​​​‌‌​‌‌‌​‌‌​​‌‌​​​‌‌​‌​‌​‌‌​​​‌​​‌‌​​​‌‌​​‌‌​​​​​‌‌​​​‌‌⁡
const { validateMessage, sanitizeText, keyHostOk } = (() => {
const MAX_JSON = 20 * 1024, TYPE_MAX = { "t2-capture": 800 * 1024 }, ADMIN = new Set(["t2-status", "t2-connect", "t2-disconnect", "t2-test", "trk-run", "abg-run", "test-alert"]), T2_STORES = ["Zepto", "Instamart", "BigBasket", "JioMart", "Flipkart Minutes"], PRIVILEGED = new Set(["signin", "signout", "delete-data", "contribute", "profile-update", "export-data", "account", "forget-shared", "waitlist", "iplocate", "invalidate", "t2-connect", "t2-disconnect", "t2-test"]);
const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const str = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max;
const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v > lo && v < hi;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k); // NOT `k in o`: "constructor"/"toString"/"__proto__" are "in" every object
const https = (v, max) => str(v, 1, max) && /^https:\/\//i.test(v) && (() => { try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password && !!u.hostname; } catch { return false; } })();
const pin = v => typeof v === "string" && /^\d{6}$/.test(v);
const key = v => str(v, 1, 200) && !(v in Object.prototype) && v !== "prototype" && !/[\u0000-\u0020\u007f-\u00a0\u00ad\u1680\u2000-\u200a\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u202f\u205f\u2060-\u2064\u2066-\u2069\u3000\ufeff\u{e0000}-\u{e007f}\ud800-\udfff"'`<>\\]/u.test(v); // a key is a dictionary key in the background: no prototype names, no control/space/bidi/invisible/quote characters (same class as okKey in lib.js)
// A product key names its shop ("amazon.in:ASIN", "tatacliq.com:mp123", or "shopify:shop.example:handle" for independent stores): the product's url must be on that shop (the host itself or a subdomain), so a page cannot file a link to evil.com under amazon.in's key. Needs a dotted lowercase host: "com:1" would match every .com.
const keyHostOk = (k, u) => { const h = typeof k === "string" && (/^(?:shopify:)?([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+):/.exec(k) || [])[1]; if (!h) return false; try { const x = new URL(u).hostname; return x === h || x.endsWith("." + h); } catch { return false; } };
const PK = ["key", "site", "url", "title", "image", "price", "mrp", "src", "seller", "brand", "mpn"];
const SELLER_MAX = { name: 80, ships: 60, text: 200, href: 300 };
const seller = v => v === undefined || v === null || (isObj(v) && Object.keys(v).every(k => own(SELLER_MAX, k) && str(v[k], 0, SELLER_MAX[k])));
const product = p => isObj(p) && Object.keys(p).every(k => PK.includes(k)) && key(p.key) && str(p.site, 0, 60) && https(p.url, 2000) && keyHostOk(p.key, p.url) && str(p.title, 0, 500) && (p.image === null || https(p.image, 2000)) && num(p.price, 0, 1e7) && (p.mrp === null || num(p.mrp, 0, 1e7)) && ["jsonld", "dom", "meta"].includes(p.src) && seller(p.seller) && (p.brand === undefined || str(p.brand, 0, 60)) && (p.mpn === undefined || str(p.mpn, 0, 40));
const loc = l => isObj(l) && Object.keys(l).every(k => ["lat", "lon", "pin"].includes(k)) && num(l.lat, -91, 91) && num(l.lon, -181, 181) && (l.pin === undefined || pin(l.pin));
// per type: allowed extra keys -> validator. Missing optional keys are only allowed where the validator tolerates undefined.
const S = {
  seen: { p: product }, pass: {}, nudge: { key, act: v => v === "dismiss" || v === "asked" }, track: { key, target: v => num(v, 0, 1e7) }, untrack: { key }, wish: { key, on: v => typeof v === "boolean" }, remove: { key },
  "history-ref": { key, days: v => num(v, 6, 401), low: v => num(v, 0, 1e7), high: v => num(v, 0, 1e7) },
  "trk-run": {},
  urg: { key: v => key(v) && v.length <= 80, price: v => typeof v === "number" && v > 0 && v < 1e7, cues: v => Array.isArray(v) && v.length <= 8 && v.every(c => isObj(c) && ["stock", "timer", "deal", "bought", "viewers", "deadline"].includes(c.kind) && (c.n === undefined || c.n === null || (typeof c.n === "number" && c.n >= 0 && c.n < 1e7)) && (c.secs === undefined || (typeof c.secs === "number" && c.secs > 0 && c.secs < 14 * 86400)) && (c.gran === undefined || c.gran === "s" || c.gran === "m") && Object.keys(c).every(k => ["kind", "n", "secs", "gran", "text"].includes(k)) && (c.text === undefined || (typeof c.text === "string" && c.text.length <= 80))) },
  "offers-fk": { pid: v => typeof v === "string" && /^[A-Z0-9]{16}$/.test(v) },
  "abg-run": {},
  ahist: { key, range: v => ["1M", "3M", "1Y"].includes(v), days: v => num(v, 5, 400), points: v => Array.isArray(v) && v.length >= 2 && v.length <= 400 && v.every(p => Array.isArray(p) && p.length === 2 && num(p[0], 1e12, 4e12) && num(p[1], 0, 1e7)), current: v => v === null || num(v, 0, 1e7), tab: v => v === undefined || v === "1M" || v === "3M" || v === "1Y", offer: v => v === null || num(v, 0, 1e7), highest: v => v === null || (isObj(v) && num(v.price, 0, 1e7) && str(v.on, 1, 20) && Object.keys(v).length === 2) },
  "ahist-tried": { key },
  "ahist-health": { event: v => ["read", "refused", "stored", "paused"].includes(v), reason: v => v === undefined || (str(v, 0, 30) && /^[a-z0-9-]*$/i.test(v) && !(v in Object.prototype)) }, // it becomes a counter name in a plain object
  seller: { sid: v => typeof v === "string" && /^[A-Z0-9]{8,16}$/.test(v) },
  offers: { asin: v => typeof v === "string" && /^[A-Z0-9]{10}$/.test(v) },
  compare: { title: v => str(v, 3, 500), brand: v => v === undefined || str(v, 0, 60), mpn: v => v === undefined || str(v, 0, 40), site: v => str(v, 1, 60), price: v => num(v, 0, 1e7) },
  grocery: { q: v => str(v, 1, 120), loc, more: v => v === undefined || typeof v === "boolean" }, geocode: { pin }, reverse: { lat: v => num(v, -91, 91), lon: v => num(v, -181, 181) },
  iplocate: {}, whoami: {}, invalidate: { reason: v => v === "user-clear-cache" },  "forget-shared": {}, disableShopify: {}, "open-options": { at: v => v === undefined || v === "delete" || v === "signout-clear" || v === "export" }, account: {}, signin: {}, signout: { clear: v => v === undefined || typeof v === "boolean" }, sync: {}, waitlist: {}, "delete-data": {}, "export-data": {}, enableShopify: {},
  "t2-capture": { url: v => str(v, 1, 500), method: v => str(v, 1, 10), status: v => typeof v === "number" && v >= 0 && v < 1000, body: v => str(v, 0, 700000), hdr: isObj },
  "t2-status": {}, "t2-version": {}, "t2-connect": { store: v => T2_STORES.includes(v) }, "t2-disconnect": { store: v => T2_STORES.includes(v) }, "t2-test": { store: v => T2_STORES.includes(v) },
  contribute: { on: v => typeof v === "boolean" }, toggle: { on: v => typeof v === "boolean" },
  "test-alert": {},
  "profile-update": { email_alerts: v => v === undefined || typeof v === "boolean", name: v => v === undefined || str(v, 0, 80), phone: v => v === undefined || v === "" || (typeof v === "string" && /^\+91[6-9][0-9]{9}$/.test(v)) },
};
const OPTIONAL = { ahist: ["tab"], "profile-update": ["name", "phone", "email_alerts"], signout: ["clear"], grocery: ["more"], "open-options": ["at"] };
function validateMessage(m, sender, selfId) { try { return validate(m, sender, selfId); } catch { return { ok: false, reason: "invalid" }; } } // a hostile getter/proxy must reject, never throw
function validate(m, sender, selfId) {
  const no = reason => ({ ok: false, reason });
  if (!sender || typeof selfId !== "string" || !selfId || sender.id !== selfId) return no("bad sender");
  if (!isObj(m) || typeof m.type !== "string" || !Object.prototype.hasOwnProperty.call(S, m.type)) return no("unknown type");
  let size; try { size = JSON.stringify(m).length; } catch { return no("unserializable"); }
  if (size > (TYPE_MAX[m.type] || MAX_JSON)) return no("too large");
  const extPage = (typeof sender.url === "string" && sender.url.startsWith("chrome-extension://" + selfId + "/")) || sender.origin === "chrome-extension://" + selfId;
  // Erasing the account / the device's data, and handing the whole account out as a file, are confirmed on an extension page (options.html#delete / #signout-clear / #export): `gesture` is a flag the sender writes, so a content script is never trusted for these three.
  if ((ADMIN.has(m.type) || m.type === "delete-data" || m.type === "export-data" || (m.type === "signout" && m.clear === true)) && !extPage) return no("extension page only");
  if (m.type === "t2-capture" && !sender.tab) return no("capture must come from a tab");
  const schema = S[m.type], opt = OPTIONAL[m.type] || [];
  for (const k of Object.keys(m)) if (k !== "type" && k !== "gesture" && !own(schema, k)) return no("unexpected field " + k);
  if ("gesture" in m && typeof m.gesture !== "boolean") return no("bad gesture");
  for (const k of Object.keys(schema)) {
    if (m[k] === undefined && opt.includes(k)) continue;
    if (!schema[k](m[k])) return no("bad field " + k);
  }
  if (PRIVILEGED.has(m.type) && sender.tab && m.gesture !== true) return no("gesture required");
  return { ok: true };
}
// Strip control chars, collapse whitespace, truncate. Always returns a string.
// Same rule as cleanText in lib.js (a unit test keeps the two identical): control, bidi, zero-width, tag characters and unpaired surrogates become spaces.
function sanitizeText(s, max = 500) { return (typeof s === "string" || typeof s === "number" ? String(s) : "").replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}\ud800-\udfff]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).replace(/[\ud800-\udfff]/gu, "").trim(); }
return { validateMessage, sanitizeText, keyHostOk };
})();
if (typeof module !== "undefined") module.exports = { validateMessage, sanitizeText, keyHostOk };
