const assert = require("assert"), { validateMessage: v, sanitizeText } = require("../../extension/guard.js");
const ID = "me", ext = { id: ID }, tab = { id: ID, tab: { id: 1 } };
const P = { key: "amazon:B0", site: "amazon", url: "https://amazon.in/dp/B0", title: "T", image: null, price: 99, mrp: null, src: "jsonld" };
let n = 0; const ok = (m, s = ext) => { n++; assert.deepStrictEqual(v(m, s, ID), { ok: true }, JSON.stringify(m).slice(0, 80)); };
const bad = (m, re, s = ext) => { n++; const r = v(m, s, ID); assert.strictEqual(r.ok, false, "should reject " + JSON.stringify(m).slice(0, 80)); if (re) assert.match(r.reason, re); };
// every real type accepts its real shape
ok({ type: "seen", p: P }, tab); ok({ type: "track", key: "k", target: 50 }, tab); ok({ type: "untrack", key: "k" }, tab); ok({ type: "wish", key: "k", on: true }, tab); ok({ type: "remove", key: "k" }, tab);
ok({ type: "grocery", q: "milk", loc: { lat: 12, lon: 77, pin: "560001" } }, tab); ok({ type: "grocery", q: "milk", loc: { lat: 12, lon: 77 } }, tab);
ok({ type: "geocode", pin: "560001" }, tab); ok({ type: "reverse", lat: 1, lon: 2 }, tab); ok({ type: "iplocate", gesture: true }, tab); ok({ type: "waitlist", gesture: true }, tab); ok({ type: "whoami" }, tab); ok({ type: "forget-shared", gesture: true }, tab);
bad({ type: "iplocate" }, /gesture/, tab); ok({ type: "resolve-switch", choice: "clear", gesture: true }, tab); bad({ type: "resolve-switch", choice: "clear" }, /gesture/, tab); bad({ type: "resolve-switch", choice: "wipe-everything", gesture: true }, /bad field choice/, tab); ok({ type: "signout", clear: true, gesture: true }, tab); ok({ type: "signout", gesture: true }, tab); bad({ type: "signout", clear: "yes", gesture: true }, /bad field clear/, tab); bad({ type: "waitlist" }, /gesture/, tab); bad({ type: "forget-shared" }, /gesture/, tab); ok({ type: "forget-shared" }); ok({ type: "sync" }, tab); ok({ type: "toggle", on: false }, tab);
ok({ type: "track", key: "k", target: 10 }, tab); ok({ type: "enableShopify" }); bad({ type: "edit-target", key: "k", target: 10 }, /unknown type/, tab);
for (const t of ["signin", "signout", "delete-data", "export-data", "account"]) { ok({ type: t }); ok({ type: t, gesture: true }, tab); bad({ type: t }, /gesture/, tab); }
ok({ type: "contribute", on: true }); bad({ type: "contribute", on: true }, /gesture/, tab);
ok({ type: "profile-update", name: "Ann", phone: "+91 98765-43210" }); ok({ type: "profile-update", phone: "" }); ok({ type: "profile-update" });
bad({ type: "profile-update", phone: "abc" }); bad({ type: "profile-update", name: "x".repeat(81) }); bad({ type: "profile-update", name: "a", phone: "1" }, null, tab);
// sender / shape
bad({ type: "sync" }, /sender/, { id: "evil" }); bad({ type: "sync" }, /sender/, {}); bad({ type: "sync" }, /sender/, null); bad(null, /unknown/); bad("seen", /unknown/); bad([], /unknown/); bad({}, /unknown/);
bad({ type: "__proto__" }, /unknown/); bad({ type: "toString" }, /unknown/); bad({ type: "constructor" }, /unknown/); bad({ type: "sync", extra: 1 }, /unexpected/);
bad(Object.create({ type: "sync" }), /unknown/); bad(new (class X { constructor() { this.type = "sync"; } })(), /unknown/);
// products
const bp = o => bad({ type: "seen", p: { ...P, ...o } });
ok({ type: "seen", p: { ...P, seller: { name: "A", ships: "B", text: "", href: "/x" } } }, tab); ok({ type: "seen", p: { ...P, seller: null } }, tab);
bp({ seller: { name: "x".repeat(81) } }); bp({ seller: { evil: "x" } }); bp({ seller: "str" }); bp({ seller: { name: 5 } });
bp({ price: 0 }); bp({ price: -1 }); bp({ price: NaN }); bp({ price: Infinity }); bp({ price: 1e7 }); bp({ price: "9" }); bp({ mrp: 0 }); bp({ mrp: "1" }); bp({ src: "x" }); bp({ key: "" }); bp({ key: "k".repeat(201) });
bp({ url: "http://a.in/x" }); bp({ url: "javascript:alert(1)" }); bp({ image: "http://a/i.png" }); bp({ image: "data:text/html," }); bp({ title: "t".repeat(501) }); bp({ site: "s".repeat(61) }); bp({ url: "https://a/" + "x".repeat(2000) });
ok({ type: "seen", p: { ...P, mrp: 120, image: "https://i/p.png", key: "k".repeat(200) } }, tab); bad({ type: "seen", p: { ...P, extra: 1 } }, null, tab); bad({ type: "seen" });
// numbers / grocery / geo
bad({ type: "track", key: "k", target: 0 }); bad({ type: "track", key: "k", target: -5 }); bad({ type: "track", key: "k", target: 1e7 }); bad({ type: "track", key: "k", target: "5" }); bad({ type: "wish", key: "k", on: 1 });
bad({ type: "grocery", q: "", loc: { lat: 1, lon: 1 } }); bad({ type: "grocery", q: "x".repeat(121), loc: { lat: 1, lon: 1 } }); bad({ type: "grocery", q: "m", loc: { lat: 91, lon: 1 } }); bad({ type: "grocery", q: "m", loc: { lat: 1, lon: 181 } }); bad({ type: "grocery", q: "m", loc: { lat: 1, lon: 1, pin: "12345" } }); bad({ type: "grocery", q: "m" });
bad({ type: "geocode", pin: "12345a" }); bad({ type: "geocode", pin: 560001 }); bad({ type: "reverse", lat: "1", lon: 2 });
// size
bad({ type: "seen", p: { ...P, title: "x".repeat(500) }, junk: "y".repeat(21000) }); bad({ type: "sync", gesture: "yes" });
// sanitizeText
assert.strictEqual(sanitizeText("  a\u0000b\n\t c‮  "), "a b c"); assert.strictEqual(sanitizeText("abcdef", 3), "abc"); assert.strictEqual(sanitizeText(null), "");
console.log(`guard: ${n} checks passed`);
