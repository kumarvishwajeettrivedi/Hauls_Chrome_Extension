// The client must agree with the database CHECKs (migrations 0017/0018), or rows are refused with 23514 and silently dropped; and it must keep what the database keeps (ZWJ/ZWNJ in Indic text).
// Every hidden character in this file is built from a code point (Z): no invisible characters in the source.
const assert = require("assert"), fs = require("fs"), path = require("path");
global.HAULS_CONFIG = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k" };
const L = require("../../extension/lib.js"); global.cleanText = L.cleanText; global.cleanUrl = L.cleanUrl; // sync.js is a service-worker file: it reads lib.js globals
const { sanitizeText, validateMessage } = require("../../extension/guard.js"), { toWatchRow } = require("../../extension/sync.js");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }, eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };
const Z = (...a) => String.fromCodePoint(...a), ZWJ = Z(0x200d), ZWNJ = Z(0x200c);
// ---- the database side: read the ONE class from 0018 (ext_hidden_re) plus the space / quote rules of ext_spaced / ext_valid_key, and turn them into JS regexes
const MIG = path.join(__dirname, "../../supabase/migrations"), SQL = fs.readFileSync(path.join(MIG, "0018_ext_security_followup.sql"), "utf8");
const body = fn => { const m = SQL.match(new RegExp("function public\\." + fn + "\\([^)]*\\)[^$]*\\$\\$([\\s\\S]*?)\\$\\$")); assert.ok(m, "0018 defines " + fn); return m[1]; };
const lit = (src, re) => { const m = src.match(re); assert.ok(m, "literal " + re); return m[1].replace(/''/g, "'"); };
const pgToJs = s => new RegExp(s.replace(/\\U([0-9a-fA-F]{8})/g, (_, h) => "\\u{" + h.replace(/^0+/, "") + "}").replace(/\\s/g, " \\t\\n\\v\\f\\r"), "u"); // Postgres \s (C locale) = ASCII whitespace
const DB_HIDDEN = pgToJs(lit(body("ext_hidden_re"), /select '(\[[^']*\])'::text/));
const DB_SPACE = pgToJs(lit(body("ext_spaced"), /t ~ '(\[[^']*\])'/));
const DB_QUOTE = pgToJs(lit(body("ext_valid_key"), /t !~ '(\[(?:[^']|'')*\])'/));
ok((body("ext_hidden_re").match(/\\x7f-/g) || []).length === 1 && (SQL.match(/\\x7f-/g) || []).length === 1, "0018 holds the class literal exactly once");
const dbKey = k => k.length >= 1 && k.length <= 200 && !DB_QUOTE.test(k) && !DB_SPACE.test(k) && !DB_HIDDEN.test(k);
// the class matches what it should and nothing it should not
for (const cp of [0x01, 0x1f, 0x7f, 0x85, 0x9f, 0xad, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2060, 0x2064, 0x2066, 0x2069, 0xfeff, 0xe0000, 0xe0041, 0xe007f]) ok(DB_HIDDEN.test(Z(cp)), "db class has U+" + cp.toString(16));
for (const cp of [0x200c, 0x200d, 0xfff9, 0xfffb, 0x180e, 0x61c, 0x34f, 0x2065, 0x206a, 0x206f, 0x20, 0x41, 0x915, 0xe0080]) ok(!DB_HIDDEN.test(Z(cp)), "db class lacks U+" + cp.toString(16));
// client text rules (cleanText, sanitizeText) strip exactly the database class. JS \s (unicode spaces, BOM, U+2028/9) is collapsed to a space by both, so those are compared only where JS \s does not apply.
for (let cp = 1; cp <= 0x10ffff; cp++) { if (cp >= 0xd800 && cp <= 0xdfff) continue; const c = Z(cp); if (/\s/u.test(c)) continue; const s = "a" + c + "b";
  const db = DB_HIDDEN.test(c), lc = L.cleanText(s) === "a b", gs = sanitizeText(s) === "a b";
  if (db !== lc || (cp <= 0xffff || (cp >= 0xe0000 && cp <= 0xe00ff)) && db !== gs) assert.fail("text class differs at U+" + cp.toString(16) + " db=" + db + " cleanText=" + lc + " sanitizeText=" + gs); } n++;
// client key rule (okKey) == database key rule over every code point; the guard's key() agrees on the BMP and the tag block
const P = k => ({ type: "track", key: k, target: 10 }), snd = { id: "me", tab: { id: 1 } };
for (let cp = 1; cp <= 0x10ffff; cp++) { if (cp >= 0xd800 && cp <= 0xdfff) continue; const k = "a" + Z(cp) + "b"; if (L.okKey(k) !== dbKey(k)) assert.fail("okKey != db key rule at U+" + cp.toString(16));
  if ((cp <= 0xffff || (cp >= 0xe0000 && cp <= 0xe00ff)) && validateMessage(P(k), snd, "me").ok !== dbKey(k)) assert.fail("guard key != db key rule at U+" + cp.toString(16)); } n++;
// ZWJ / ZWNJ and the characters dropped from the class survive in both text rules: Indic conjuncts and emoji sequences
const DEV = "\u0915\u094d", KEEP = [DEV + ZWJ + "\u0937", DEV + ZWNJ + "\u0937", "\u0d15\u0d4d" + ZWJ, "\u{1f468}" + ZWJ + "\u{1f469}" + ZWJ + "\u{1f467}", "a" + Z(0xfff9) + "b", "a" + Z(0x180e) + "b", "a" + Z(0x61c) + "b", "a" + Z(0x206a) + "b"];
for (const t of KEEP) { eq(L.cleanText(t), t, "cleanText kept " + JSON.stringify(t)); eq(sanitizeText(t), t, "sanitizeText kept " + JSON.stringify(t)); }
// URLs: an apostrophe is percent-encoded (the database refuses a raw one); the limit is 500 for what is uploaded
eq(L.cleanUrl("https://a.in/it's"), "https://a.in/it%27s", "apostrophe in path"); eq(L.cleanUrl("https://a.in/a?b=c'd#f'g"), "https://a.in/a?b=c%27d#f%27g", "apostrophe in query and fragment"); ok(!L.cleanUrl("https://a.in/x").includes("'"), "plain url unchanged");
eq(L.cleanUrl("https://a.in/" + "x".repeat(600), 500), null, "over 500: no url"); ok(L.cleanUrl("https://a.in/" + "x".repeat(480), 500), "under 500 kept"); ok(L.cleanUrl("https://a.in/" + "x".repeat(600)), "default max is still 2000");
ok(L.cleanUrl("https://a.in/" + "'".repeat(200), 500) === null, "encoding counts toward the limit (200 apostrophes = 600 chars)");
const row = toWatchRow("U", { key: "k", url: "https://a.in/p/it's", image: "https://a.in/" + "i".repeat(600), u: 1000 });
eq(row.url, "https://a.in/p/it%27s", "toWatchRow url encoded"); eq(row.image, null, "toWatchRow image over 500 is not sent"); ok(toWatchRow("U", { key: "k", url: "https://a.in/" + "u".repeat(480), u: 1 }).url, "toWatchRow url under 500 is sent");
// keys: named cases on top of the full sweep above (prototype names are a client-only rule)
const BADK = ["a'b", 'a"b', "a`b", "a<b", "a>b", "a\\b", "a b", ...[0xa0, 0x2003, 0x202f, 0x3000, 0xad, 0x200b, 0x2060, 0x202e, 0xe0041, 0, 0x7f].map(c => "a" + Z(c) + "b"), "__proto__", "constructor", "", "k".repeat(201), "a\ud800b"];
const GOODK = ["amazon.in:B0ABCDEFGH", "shopify:boat-lifestyle.com:airdopes-141", "flipkart.com:ABC123", "myntra.com:12345", "k".repeat(200), "x:y/z?w=1&v=2%27", "\u0928\u092e\u0938\u094d\u0924\u0947:1", ...[0xfff9, 0x180e, 0x200d].map(c => "a" + Z(c) + "b")];
for (const k of BADK) { ok(!L.okKey(k), "okKey accepted " + JSON.stringify(k)); ok(!validateMessage(P(k), snd, "me").ok, "guard accepted key " + JSON.stringify(k)); }
for (const k of GOODK) { ok(L.okKey(k), "okKey refused " + JSON.stringify(k)); ok(validateMessage(P(k), snd, "me").ok, "guard refused key " + JSON.stringify(k)); }
eq(L.cleanProduct({ key: "a'b", site: "s", title: "t", url: "https://a.in/x", price: 5, src: "dom" }), null, "a product with a quote in its key is not trackable");
// migrations from 0017 on are pure ASCII (the rupee sign is the one allowed exception): a hidden character typed literally could be dropped by a copy-paste into the SQL editor
for (const f of fs.readdirSync(MIG).filter(f => /^\d{4}_/.test(f) && +f.slice(0, 4) >= 17)) { const bad = [...fs.readFileSync(path.join(MIG, f), "utf8")].filter(c => c > "\x7f" && c !== "\u20b9");
  eq(bad.length, 0, f + " has non-ASCII characters: " + bad.map(c => "U+" + c.codePointAt(0).toString(16)).join(",")); }
console.log(`db-align: ${n} passed, 0 failed`);
