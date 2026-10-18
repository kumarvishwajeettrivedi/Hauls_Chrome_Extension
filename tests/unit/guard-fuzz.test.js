// Fuzz for the message guard (guard.js). Deterministic (seeded) so a failure reproduces. Thousands of random + hostile payloads for EVERY message type.
// Invariants, for every payload and every sender: never throws; answers {ok:true} or {ok:false, reason}; an accepted message has no key the schema does not list
// (own OR inherited names like constructor/toString/__proto__); ADMIN types are never accepted from a content script or a foreign sender; PRIVILEGED types never from a tab without a gesture.
const assert = require("assert"), fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "../../extension/guard.js"), "utf8");
// Load guard.js with its internals exposed (the production file exports only validateMessage + sanitizeText).
const patched = src.replace("const { validateMessage, sanitizeText, keyHostOk } = (() => {", "const G = (() => {").replace("return { validateMessage, sanitizeText, keyHostOk };", "return { validateMessage, sanitizeText, S, ADMIN, PRIVILEGED };").replace(/if \(typeof module[^\n]*/, "");
assert.notStrictEqual(patched, src, "guard.js layout changed: update the fuzz loader");
const { validateMessage, sanitizeText, S, ADMIN, PRIVILEGED } = require("vm").runInThisContext("(() => {" + patched + "\nreturn G;})()"); // same realm: guard checks Object.getPrototypeOf(m) === Object.prototype
const ID = "selfid", TYPES = Object.keys(S);
const SENDERS = { page: { id: ID, tab: { id: 1 }, url: "https://www.amazon.in/dp/B0TESTTEST1", origin: "https://www.amazon.in" }, ext: { id: ID, url: "chrome-extension://" + ID + "/options.html", origin: "chrome-extension://" + ID, tab: { id: 2 } },
  foreign: { id: "otherext", url: "chrome-extension://otherext/x.html", origin: "chrome-extension://otherext" }, spoofUrl: { id: ID, tab: { id: 3 }, url: "https://evil.example/chrome-extension://" + ID + "/", origin: "https://evil.example" }, bare: { id: ID } };

// seeded PRNG
let seed = 0x9e3779b9; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)], int = n => Math.floor(rnd() * n);

// one valid example per message type: a new type without an example fails the coverage check below
const P = { key: "amazon.in:B0TESTTEST1", site: "Amazon", url: "https://www.amazon.in/dp/B0TESTTEST1", title: "Thing", image: "https://m.media-amazon.com/i.jpg", price: 99, mrp: 120, src: "dom", seller: { name: "S", ships: "A", text: "t", href: "/sp" }, brand: "B", mpn: "M123" };
const TPL = {
  seen: { p: P }, pass: {}, nudge: { key: "k", act: "dismiss" }, track: { key: "k", target: 50 }, untrack: { key: "k" }, wish: { key: "k", on: true }, remove: { key: "k" }, "history-ref": { key: "k", days: 30, low: 10, high: 20 }, "trk-run": {},
  urg: { key: "k", price: 99, cues: [{ kind: "stock", n: 3, secs: 60, gran: "m", text: "only 3 left" }] }, "offers-fk": { pid: "ABCDEFGHJK123456" }, "abg-run": {},
  ahist: { key: "k", range: "1M", days: 30, points: [[1.7e12, 100], [1.71e12, 99]], current: 99, offer: null, highest: { price: 120, on: "1 Jan" } }, "ahist-tried": { key: "k" }, "ahist-health": { event: "read", reason: "x" },
  seller: { sid: "A1B2C3D4E5" }, offers: { asin: "B0TESTTES1" }, compare: { title: "boAt Airdopes 141", brand: "boAt", mpn: "A1", site: "Amazon", price: 700 }, grocery: { q: "milk", loc: { lat: 12, lon: 77, pin: "560001" }, more: true },
  geocode: { pin: "560001" }, reverse: { lat: 12, lon: 77 }, iplocate: {}, whoami: {}, invalidate: { reason: "user-clear-cache" }, "forget-shared": {}, disableShopify: {}, "open-options": {}, account: {}, signin: {}, signout: { clear: true }, sync: {}, waitlist: {}, "delete-data": {}, "export-data": {}, enableShopify: {},
  "t2-capture": { url: "https://x/y", method: "GET", status: 200, body: "{}", hdr: { a: "b" } }, "t2-status": {}, "t2-version": {}, "t2-connect": { store: "Zepto" }, "t2-disconnect": { store: "Zepto" }, "t2-test": { store: "Zepto" },
  contribute: { on: true }, toggle: { on: true }, "test-alert": {}, "profile-update": { name: "Ann", phone: "+919876543210", email_alerts: true },
};
assert.deepStrictEqual(TYPES.filter(t => !(t in TPL)), [], "message types without a fuzz template");
assert.deepStrictEqual(Object.keys(TPL).filter(t => !TYPES.includes(t)), [], "templates for types that no longer exist");
const withG = m => ({ ...m, gesture: true });

// hostile values
const huge = n => "A".repeat(n);
const deep = n => { let o = { a: 1 }; for (let i = 0; i < n; i++) o = { a: o }; return o; };
const deepArr = n => { let o = []; for (let i = 0; i < n; i++) o = [o]; return o; };
const HOSTILE_KEYS = ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "__defineGetter__", "__lookupGetter__", "toLocaleString", "propertyIsEnumerable", "x", "", "type", "gesture", "‮", "a".repeat(5000)];
const HOSTILE_VALUES = () => [null, undefined, true, false, 0, -0, 1, -1, NaN, Infinity, -Infinity, 1e308, -1e308, 5e-324, Number.MAX_SAFE_INTEGER, 2 ** 53, 1e7, 1e7 - 1, 4e12, 1e12, 123456789012345678901234567890n === 0 ? 0 : 7,
  "", " ", "0", "1", "true", "null", "undefined", "NaN", "__proto__", "constructor", "toString", "prototype", "hasOwnProperty", "<script>alert(1)</script>", "javascript:alert(1)", "data:text/html,<b>", "blob:https://x/1", "http://insecure.example/", "https://user:pw@evil.example/", "https://a b/", "HTTPS://OK.EXAMPLE/p",
  "‮evil‬", "a​b", "a\u0000b", "a\r\nb", "\ud800", "\udc00x", "\u{e0041}\u{e0042}", "  ", "﻿", "é".normalize("NFD"), "İ", "𝕳𝖊𝖑𝖑𝖔", "%00", "../../etc/passwd", "'; DROP TABLE x;--", "${7*7}", "{{7*7}}", "\\u0000",
  huge(100), huge(1000), huge(2000), huge(5000), huge(21 * 1024), [], [[]], [1, 2, 3], ["a"], [null], [[1, 2], [3]], Array.from({ length: 500 }, (_, i) => [1.7e12 + i, 5]), {}, { a: 1 }, { __proto__: null }, JSON.parse('{"__proto__":{"polluted":true}}'),
  JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'), deep(30), deepArr(30), Object.create({ inherited: 1 }), new Date(0), /x/, () => 1, Symbol.iterator, new Map(), new Set([1]), new Uint8Array(4), Object.assign(Object.create(null), { a: 1 }), new (class Foo { constructor() { this.a = 1; } })(), new Proxy({}, {}), [undefined], [NaN],
  { kind: "stock" }, { kind: "x", n: -1 }, { lat: 1, lon: 2, pin: "123456" }, { lat: 1e9, lon: 0 }, { name: "x", ships: 1 }, { price: 1, on: "x" }];
const hostileSet = HOSTILE_VALUES(), GIANTS = [huge(700001), huge(1.5e6), Array.from({ length: 20000 }, () => 1), deep(2000), deepArr(5000)]; // slow: tried against two senders only

const stats = { n: 0, ok: 0, rejected: 0 };
function check(m, sender, label) {
  let r; try { r = validateMessage(m, sender, ID); } catch (e) { assert.fail("validateMessage THREW (" + (e && e.message) + ") for " + label); }
  stats.n++;
  assert.ok(r && typeof r === "object" && (r.ok === true || (r.ok === false && typeof r.reason === "string")), "bad result shape for " + label + ": " + JSON.stringify(r));
  if (!r.ok) { stats.rejected++; return r; }
  stats.ok++;
  // accepted: every key (own, incl. __proto__ as an own key from JSON, and symbols) must be one the schema lists, or type/gesture
  assert.ok(Object.getPrototypeOf(m) === Object.prototype, "accepted a non-plain object: " + label);
  const schema = S[m.type];
  for (const k of Reflect.ownKeys(m)) assert.ok(k === "type" || k === "gesture" || (typeof k === "string" && Object.prototype.hasOwnProperty.call(schema, k)), "ACCEPTED UNKNOWN KEY " + String(k) + " for " + label);
  if (m.type === "delete-data" || m.type === "export-data" || (m.type === "signout" && m.clear === true)) assert.ok(sender === SENDERS.ext, "destructive/export " + m.type + " accepted from a non-extension-page sender (gesture is sender-written): " + label);
  if (ADMIN.has(m.type)) assert.ok(sender === SENDERS.ext, "ADMIN type " + m.type + " accepted from a non-extension-page sender: " + label);
  if (PRIVILEGED.has(m.type) && sender.tab && sender !== SENDERS.ext) assert.strictEqual(m.gesture, true, "PRIVILEGED type " + m.type + " accepted from a tab without a gesture: " + label);
  if (m.type === "t2-capture") assert.ok(sender.tab, "t2-capture accepted without a tab");
  return r;
}
const run = (m, label, senders = SENDERS) => { for (const [sn, s] of Object.entries(senders)) check(m, s, label + " @" + sn); };

// 0) baselines: each template is accepted from the right sender (so mutations below actually reach the deep validators)
for (const t of TYPES) { const m = withG({ type: t, ...TPL[t] }), sender = ADMIN.has(t) || t === "delete-data" || t === "export-data" || t === "signout" ? SENDERS.ext : SENDERS.page; assert.deepStrictEqual(validateMessage(m, sender, ID), { ok: true }, "template for " + t + " should be valid: " + JSON.stringify(validateMessage(m, sender, ID))); stats.n++; }

// 1) every key of every template (top level + one level down) replaced by every hostile value, or deleted, or given a hostile sibling key
const clone = o => JSON.parse(JSON.stringify(o));
function* paths(o, pre = []) { for (const k of Object.keys(o)) { yield [...pre, k]; if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) && pre.length < 1) yield* paths(o[k], [...pre, k]); } }
const setAt = (o, p, v) => { let c = o; for (const k of p.slice(0, -1)) c = c[k]; if (v === undefined) delete c[p[p.length - 1]]; else c[p[p.length - 1]] = v; return o; };
const hostileKey = (o, p, k, v) => { let c = o; for (const x of p) c = c[x]; Object.defineProperty(c, k, { value: v, enumerable: true, writable: true, configurable: true }); return o; }; // defineProperty so "__proto__" becomes an OWN key
for (const t of TYPES) {
  const base = withG({ type: t, ...clone(TPL[t]) });
  const paramPaths = [...paths(base)].filter(p => p[0] !== "type"), containers = [[], ...[...paths(base)].filter(p => base[p[0]] && typeof base[p[0]] === "object" && !Array.isArray(base[p[0]]) && p.length === 1)];
  for (const p of paramPaths) for (const v of hostileSet) { let m; try { m = setAt(clone(base), p, v); } catch { continue; } if (typeof v === "bigint") continue; run(m, t + "." + p.join(".") + "=" + String(typeof v === "string" ? v.slice(0, 20) : typeof v)); }
  for (const c of containers) for (const k of HOSTILE_KEYS) for (const v of [1, "x", null, {}, [], { polluted: true }, huge(25000), deep(40)]) { const m = hostileKey(clone(base), c, k, v); if (k === "type" && c.length === 0) continue; run(m, t + " extra key " + (k.length > 20 ? "long" : k) + " in " + (c.join(".") || "root")); }
  for (const k of Object.keys(base)) if (k !== "type") { const m = clone(base); delete m[k]; run(m, t + " missing " + k); }
  for (const p of paramPaths) for (const v of GIANTS) run(setAt(clone(base), p, v), t + "." + p.join(".") + " giant", { page: SENDERS.page, ext: SENDERS.ext });
  // the top-level type field itself
  for (const v of hostileSet) { if (typeof v === "bigint") continue; run({ ...clone(base), type: v }, "type=" + typeof v); }
}

// 2) fully random objects + random mixes of fields from different types
const FIELD_POOL = [...new Set(TYPES.flatMap(t => Object.keys(TPL[t])))].concat(HOSTILE_KEYS);
for (let i = 0; i < 4000; i++) {
  const m = {}; if (rnd() < 0.9) m.type = rnd() < 0.8 ? pick(TYPES) : pick(hostileSet);
  for (let k = int(8); k > 0; k--) Object.defineProperty(m, pick(FIELD_POOL), { value: pick(hostileSet), enumerable: true, writable: true, configurable: true });
  if (rnd() < 0.5) m.gesture = pick([true, false, 1, "true", null]);
  if (rnd() < 0.3 && typeof m.type === "string" && Object.prototype.hasOwnProperty.call(TPL, m.type)) Object.assign(m, clone(TPL[m.type]), rnd() < 0.5 ? { [pick(FIELD_POOL)]: pick(hostileSet) } : {});
  run(m, "random#" + i);
}
// 3) messages that are not plain objects, hostile getters and proxies, hostile senders
const throwing = { get type() { throw new Error("boom"); } }, throwing2 = { type: "sync", get x() { throw new Error("boom"); } }, px = new Proxy({}, { get() { throw new Error("trap"); }, ownKeys() { throw new Error("trap"); }, getPrototypeOf() { throw new Error("trap"); } });
for (const m of [throwing, throwing2, px, null, undefined, 0, "", "seen", [], [{ type: "sync" }], () => 1, Symbol("x"), 5n, new Date(), Object.create({ type: "sync" }), JSON.parse('{"type":"sync","__proto__":{"a":1}}'), Object.create(null, { type: { value: "sync", enumerable: true } })]) run(m, "weird " + String(m && typeof m));
const circ = { type: "sync" }; circ.self = circ; run(circ, "circular");
for (const s of [null, undefined, 0, "", [], {}, { id: null }, { id: ID, url: 5, origin: {} }, { id: ID, url: { startsWith: () => true } }, new Proxy({}, { get() { throw new Error("trap"); } }), { get id() { throw new Error("x"); } }])
  for (const t of ["sync", "t2-connect", "trk-run", "test-alert"]) { let r; try { r = validateMessage(withG({ type: t }), s, ID); } catch (e) { assert.fail("threw on hostile sender"); } stats.n++; if (ADMIN.has(t)) assert.ok(!r.ok, "ADMIN type accepted from a hostile sender"); }
// selfId missing/hostile
for (const id of [undefined, null, "", 0, {}]) { assert.ok(!validateMessage({ type: "whoami" }, { id }, id).ok, "empty selfId must never match"); stats.n++; }

// 4) targeted regressions found by this fuzz
for (const k of ["constructor", "toString", "valueOf", "hasOwnProperty", "__defineGetter__"]) { const m = { type: "sync" }; Object.defineProperty(m, k, { value: { big: huge(1000) }, enumerable: true, writable: true, configurable: true }); assert.strictEqual(validateMessage(m, SENDERS.page, ID).ok, false, "inherited name accepted as an extra key: " + k); stats.n++; }
for (const bad of ["__proto__", "constructor", "toString", "prototype", "a b", "a\nb", "‮", "a​b"]) { assert.strictEqual(validateMessage({ type: "track", key: bad, target: 5 }, SENDERS.page, ID).ok, false, "dangerous product key accepted: " + JSON.stringify(bad)); assert.strictEqual(validateMessage({ type: "urg", key: bad, price: 5, cues: [] }, SENDERS.page, ID).ok, false, "dangerous urg key accepted"); stats.n += 2; }
assert.strictEqual(validateMessage({ type: "urg", key: "k", price: 5, cues: [Object.create({ kind: "stock" })] }, SENDERS.page, ID).ok, false, "cue with inherited fields accepted"); stats.n++;
assert.strictEqual(validateMessage({ type: "ahist-health", event: "read", reason: "constructor" }, SENDERS.page, ID).ok, false, "reason 'constructor' accepted"); stats.n++;
assert.strictEqual(validateMessage({ type: "seen", p: { ...P, url: "https://user:pw@evil.example/x" } }, SENDERS.page, ID).ok, false, "url with credentials accepted"); stats.n++;
// sanitizeText never throws and always returns a clean bounded string
for (const v of hostileSet) { let s; try { s = sanitizeText(v, 50); } catch { if (typeof v === "symbol") continue; assert.fail("sanitizeText threw on " + String(v)); } assert.strictEqual(typeof s, "string"); assert.ok(s.length <= 50); assert.ok(!/[\u0000-\u001f​-‏‪-‮⁦-⁩﻿\u{e0000}-\u{e007f}]/u.test(s), "control/bidi left in sanitizeText output"); assert.ok(!/[\ud800-\udfff]/.test(s.replace(/[\ud800-\udbff][\udc00-\udfff]/g, "")), "lone surrogate left"); stats.n++; }

assert.ok(stats.n > 5000, "fuzz should run thousands of cases, ran " + stats.n);
assert.ok(stats.ok > 50 && stats.rejected > 3000, "fuzz should both accept (valid) and reject (hostile): " + JSON.stringify(stats));
console.log(`guard-fuzz: ${stats.n} checks passed (${stats.ok} accepted, ${stats.rejected} rejected, ${TYPES.length} message types, ${Object.keys(SENDERS).length} sender kinds)`);
