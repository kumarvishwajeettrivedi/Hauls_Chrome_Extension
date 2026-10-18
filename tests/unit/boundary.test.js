// Storage-boundary hardening: page-derived text is normalised once on its way into storage, hostile JSON cannot pollute prototypes,
// the background handlers do not trust what guard.js does not check, and the manifest / extension pages stay minimal. No browser, no network.
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const EXT = path.join(__dirname, "../../extension"), read = f => fs.readFileSync(path.join(EXT, f), "utf8");
const L = require("../../extension/lib.js"), { sanitizeText } = require("../../extension/guard.js");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }, eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const BIDI = "\u202e\u202a\u2066\u2069\u200b\u200f\u2060\ufeff", TAGS = "\u{e0041}\u{e0042}", CTRL = "\u0000\u0007\u001b\u007f\u0085\u009f";

// ---- cleanText: control / bidi / zero-width / tag / lone-surrogate characters out, whitespace collapsed, capped, never throws
for (const bad of [BIDI, TAGS, CTRL, "\ud800", "\udc00", "a\ud83d", "\ud83d"]) { const s = L.cleanText("x" + bad + "y"); ok(!/[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/u.test(s) && !/[\ud800-\udfff]/.test(s.replace(/[\ud800-\udbff][\udc00-\udfff]/g, "")), "left a bad character in " + JSON.stringify(bad)); }
eq(L.cleanText("  a \n\t b  "), "a b", "whitespace collapsed"); eq(L.cleanText("Visit 😀 now"), "Visit 😀 now", "valid emoji survive"); eq(L.cleanText("x".repeat(900), 500).length, 500); { const c5 = L.cleanText("😀".repeat(10), 5); ok(c5.length > 0 && c5.length <= 5 && !/[\ud800-\udfff]/.test(c5.replace(/[\ud800-\udbff][\udc00-\udfff]/g, "")), "a cap never leaves half an emoji"); }
for (const v of [null, undefined, {}, [], () => 1, Symbol("s"), 5n, { toString() { throw new Error("x"); } }, NaN]) { let r; try { r = L.cleanText(v); } catch { assert.fail("cleanText threw"); } ok(typeof r === "string", "string out"); }
eq(L.cleanText(12.5), "12.5", "numbers are text"); eq(L.cleanText({}), "", "objects are not stringified into the store");
// guard.sanitizeText and lib.cleanText are one rule
for (const v of ["a" + BIDI + "b", "t" + TAGS, CTRL + "c", "\ud800x", "😀".repeat(300), "  x\n y ", 5, null, {}]) eq(sanitizeText(v, 50), L.cleanText(v, 50), "sanitizeText != cleanText for " + JSON.stringify(v));

// ---- cleanUrl: https only, must parse, no credentials, normalised
for (const good of ["https://www.amazon.in/dp/B0X?a=1", "HTTPS://WWW.AMAZON.IN/dp/B0X", "https://m.media-amazon.com/images/I/1.jpg"]) ok(L.cleanUrl(good) && L.cleanUrl(good).startsWith("https://"), "good url refused: " + good);
for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,<b>", "blob:https://x/1", "http://insecure.example/", "ftp://x/", "file:///etc/passwd", "//evil.example/x", "/relative", "https://", "https://user:pw@evil.example/", "https://a.example@evil.example/", "", " ", null, undefined, 5, {}, [], "https://x.example/" + "a".repeat(2100), "x".repeat(10000)]) eq(L.cleanUrl(bad), null, "bad url accepted: " + String(bad).slice(0, 50));
ok(/^[\x20-\x7e]+$/.test(L.cleanUrl("https://ex.example/p‮/\u0000x?q=\n1") || ""), "a normalised url is plain ASCII (bidi/control are percent-encoded)");

// ---- okKey: never a prototype name, never control/space/bidi
for (const bad of ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty", "", "a b", "a\nb", "a​b", "a‮b", "k".repeat(201), null, 5, {}]) ok(!L.okKey(bad), "okKey accepted " + JSON.stringify(bad));
for (const good of ["amazon.in:B0TESTTES1", "flipkart.com:ABCDEFGH12345678", "shopify:shop.example:my-handle", "myntra.com:123"]) ok(L.okKey(good), "okKey refused " + good);

// ---- cleanProduct: the content script's last stop before the message
const P0 = { key: "amazon.in:B0TESTTES1", site: "Amazon", url: "https://www.amazon.in/dp/B0TESTTES1", title: "Thing", image: "https://m.media-amazon.com/i.jpg", price: 99, mrp: 120, src: "dom" };
ok(L.cleanProduct(P0), "valid product kept"); for (const o of [{ url: "javascript:alert(1)" }, { url: "http://www.amazon.in/x" }, { key: "__proto__" }, { key: "constructor" }, { key: "a b" }, { price: 0 }, { price: NaN }, { price: Infinity }, { url: "https://u:p@amazon.in/x" }]) eq(L.cleanProduct({ ...P0, ...o }), null, "cleanProduct kept " + JSON.stringify(o));
eq(L.cleanProduct({ ...P0, image: "data:image/png;base64,AAAA" }).image, null, "data: image dropped"); eq(L.cleanProduct({ ...P0, image: "javascript:1" }).image, null);
const cp = L.cleanProduct({ ...P0, title: "T" + BIDI + CTRL + TAGS + "itle", site: "Am‮azon", brand: "B\u0000", seller: { name: "Sel‮ler", ships: "\u0007x", text: "t", href: "/sp?x=1" } }); ok(cp.title.startsWith("T") && cp.title.endsWith("itle"), "visible text kept: " + cp.title); ok(!/[\u0000-\u001f‮​]/.test(JSON.stringify(cp).replace(/\\u[0-9a-f]{4}/gi, "")) && !/[\u0000-\u001f​-‏‪-‮]/.test(cp.title + cp.site + cp.brand + cp.seller.name + cp.seller.ships), "control/bidi gone from product text");

// ---- safeItems / safeItem with hostile JSON (prototype pollution)
const HJ = '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}},"toString":{"hist":[]},"prototype":{"hist":[]},"good":{"hist":[[1,5]],"title":"G\\u202e","url":"javascript:alert(1)","image":"http://x/i.png","site":"S\\u0000","seller":"Se\\u202el","__proto__":{"polluted3":"yes"},"constructor":{"x":1},"prototype":{"y":1}},"":{"hist":[]}}';
const hostile = JSON.parse(HJ), si = L.safeItems(hostile);
eq(Object.keys(si), ["good"], "only safe keys survive"); eq(({}).polluted, undefined); eq(({}).polluted2, undefined); eq(({}).polluted3, undefined); eq(Object.getPrototypeOf(si), Object.prototype, "items dict keeps its prototype");
ok(!Object.hasOwn(si.good, "__proto__") && !Object.hasOwn(si.good, "constructor") && !Object.hasOwn(si.good, "prototype"), "dangerous own keys stripped from an item"); eq(si.good.title, "G"); eq(si.good.url, undefined); eq(si.good.image, undefined); eq(si.good.site, "S"); eq(si.good.seller, "Se l", "seller text normalised");
eq(L.safeItem(JSON.parse('{"hist":[],"__proto__":{"a":1}}')).a, undefined, "an own __proto__ key is not copied through"); for (const bad of [null, [], "x", 5, undefined]) eq(L.safeItems(bad), {}, "safeItems(" + JSON.stringify(bad) + ")");
const big = {}; for (let i = 0; i < 300; i++) big["k" + i] = { hist: [], title: "t".repeat(5000), url: "https://x.example/" + i }; ok(Object.values(L.safeItems(big)).every(i => i.title.length <= 500), "titles capped on read");
// flipkart pid comes from the address bar: only a plain id becomes a product key
const S = L.SITES["flipkart.com"]; eq(S.id(new URL("https://www.flipkart.com/p/x?pid=ABCDEFGH12345678")), "ABCDEFGH12345678"); for (const bad of ["__proto__", "../x", "a b", "a%00b", "x".repeat(41), "", "constructor<script>"]) eq(S.id(new URL("https://www.flipkart.com/p/x?pid=" + encodeURIComponent(bad))), undefined, "pid " + bad);
eq(L.mergeHistory([[1, 5]], [{ day: "2026-01-01", median_price: "Infinity" }, { day: "garbage", median_price: 5 }, null, "x", { day: "2026-01-02", median_price: 5 }]).length, 2, "community rows: junk ignored (1 own + 1 valid)");

// ---- background: a stateful fake chrome, the real onMessage listener
const mem = {}, notes = [], tabsCreated = [], apiCalls = []; let onMsg = null, onClick = null;
const chrome = { storage: { local: { async getBytesInUse() { return 0; }, async get(k) { if (k == null) return JSON.parse(JSON.stringify(mem)); const ks = Array.isArray(k) ? k : [k], o = {}; for (const x of ks) if (mem[x] !== undefined) o[x] = JSON.parse(JSON.stringify(mem[x])); return o; }, async set(o) { Object.assign(mem, JSON.parse(JSON.stringify(o))); }, async remove(k) { [].concat(k).forEach(x => delete mem[x]); } }, onChanged: { addListener() {} } },
  runtime: { id: "x", onMessage: { addListener: f => { if (/validateMessage/.test(f.toString())) onMsg = f; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, sendMessage() {}, getURL: p => p, getManifest: () => ({ version: "0" }), setUninstallURL() {} }, alarms: { create() {}, clear: async () => true, get: async () => ({}), onAlarm: { addListener() {} } },
  notifications: { create: (id, o, cb) => { notes.push({ id, ...o }); cb && cb(id); }, getPermissionLevel: cb => cb("granted"), onClicked: { addListener: f => { onClick = f; } }, clear() {} }, action: { onClicked: { addListener() {} } }, tabs: { sendMessage() {}, create: o => tabsCreated.push(o) }, scripting: { getRegisteredContentScripts: async () => [] }, permissions: { contains: async () => false, onRemoved: { addListener() {} } }, identity: {}, windows: {}, idle: {} };
const sandbox = { console, URL, URLSearchParams, TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, setTimeout, clearTimeout, AbortController, AbortSignal, setInterval, clearInterval, Date, JSON, Math, Promise, Object, chrome, navigator: {}, self: {}, fetch: async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "" }) };
const ctx = vm.createContext(sandbox); sandbox.importScripts = (...fs2) => { for (const f of fs2) vm.runInContext(read(f === "config.js" && !fs.existsSync(path.join(EXT, "config.js")) ? "config.example.js" : f), ctx, { filename: f }); };
vm.runInContext(read("background.js"), ctx, { filename: "background.js" });
sandbox.__enq = [];
vm.runInContext("getSession = async () => ({ user: { id: 'u1' } }); sessionStore.get = async () => ({ user: { id: 'u1' } }); enqueue = o => __enq.push(o); flush = async () => {}; api = async (p, o) => { __api.push([p, o]); return null; }; fetchCommunity = async () => []; fetchChart = async () => [];", ctx); sandbox.__api = apiCalls;
const tab = { id: "x", tab: { id: 1 }, url: "https://www.amazon.in/dp/B0TESTTES1" }, extPage = { id: "x", tab: { id: 2 }, url: "chrome-extension://x/options.html" };
const send = (m, s = tab) => new Promise(res => { const r = onMsg(m, s, res); if (r !== true) setTimeout(() => res({ sync: true }), 0); });
(async () => {
  await vm.runInContext("ready", ctx); ok(typeof onMsg === "function", "message listener registered");
  // 1) page-derived text that guard.js accepts (right size and shape) is cleaned before it is stored or queued
  mem.profile = { contribute: true }; const KEY = "amazon.in:B0TESTTES1";
  const r = await send({ type: "seen", p: { ...P0, title: "Evil" + BIDI + "\u0000 <b>x</b>", site: "Am‮azon", seller: { name: "Sel‮ler\u0000", ships: "", text: "", href: "" }, brand: "B‮", mpn: "M1" } });
  ok(!r.error && !r.rejected && r.it, "seen accepted: " + JSON.stringify(r).slice(0, 120)); const st = mem.items[KEY];
  ok(!/[\u0000-\u001f​-‏‪-‮⁦-⁩﻿]/.test(st.title + st.site + st.seller), "stored text still has control/bidi characters"); eq(st.site, "Am azon"); eq(st.seller, "Sel ler"); ok(/Evil/.test(st.title), "the visible text is kept");
  ok(__enqClean(sandbox.__enq), "queued ops are clean");
  // 2) a key that guard.js would also refuse can never reach record(): and record() itself refuses it, with Object.prototype untouched
  eq((await send({ type: "seen", p: { ...P0, key: "__proto__" } })).error, "rejected", "guard rejects __proto__ key"); for (const k of ["__proto__", "constructor", "toString"]) { await assert.rejects(() => vm.runInContext(`withLock(() => record(${JSON.stringify({ ...P0, key: k })}))`, ctx), /bad product/, "record accepted " + k); n++; }
  eq(vm.runInContext("({}).hist === undefined && ({}).title === undefined && Object.prototype.site === undefined && ({}).url === undefined", ctx), true, "Object.prototype was written through record()"); await assert.rejects(() => vm.runInContext(`withLock(() => record(${JSON.stringify({ ...P0, price: 0 })}))`, ctx), /bad product/); n++;
  // 3) bad links never make it to storage; a bad image on a re-read keeps the good one
  await vm.runInContext(`withLock(() => record(${JSON.stringify({ ...P0, url: "javascript:alert(1)", image: "data:text/html,x", price: 98 })}))`, ctx); const st2 = mem.items[KEY]; eq(st2.url, "https://www.amazon.in/dp/B0TESTTES1", "javascript: url ignored, old url kept"); eq(st2.image, "https://m.media-amazon.com/i.jpg"); ok(!/javascript|data:/.test(JSON.stringify(mem.items)));
  // 3b) the link must be on the shop the key names: the message is refused by guard.js AND record() refuses it on its own (the tracker calls record() directly); the stored link is untouched
  { const before = JSON.stringify(mem.items[KEY]); for (const u of ["https://evil.example/dp/B0TESTTES1", "https://amazon.in.evil.example/dp/B0TESTTES1"]) { eq((await send({ type: "seen", p: { ...P0, url: u, price: 97 } })).error, "rejected", "guard: " + u); await assert.rejects(() => vm.runInContext(`withLock(() => record(${JSON.stringify({ ...P0, url: u, price: 97 })}))`, ctx), /bad product/, "record accepted " + u); n++; }
    eq(JSON.stringify(mem.items[KEY]), before, "a refused link changed nothing"); }
  // 4) a notification click only opens a clean https link
  mem.items = { n1: { hist: [[1, 5]], url: "javascript:alert(1)" }, n2: { hist: [[1, 5]], url: "https://shop.example/p" } }; tabsCreated.length = 0; await onClick("n1"); await onClick("n2"); eq(tabsCreated.map(t => t.url), ["https://shop.example/p"], "only the https link opens");
  // 5) a stored/synced plan that is not a real tier cannot crash the quota check or lift the limit
  mem.items = { [KEY]: { hist: [[1, 5]], site: "A" } }; mem.plan = "__proto__"; const w = await send({ type: "wish", key: KEY, on: true }); ok(w === true, "wish with a bogus plan: " + JSON.stringify(w)); mem.plan = "constructor"; const sn = await send({ type: "seen", p: { ...P0, price: 97 } }); ok(!sn.error && sn.usage.limit === 50, "seen with a bogus plan uses the free limit: " + JSON.stringify(sn).slice(0, 100));
  // 6) a counter name from a message cannot be a prototype name
  await send({ type: "ahist-health", event: "read", reason: "other-product" }); eq(Object.keys(mem.chartHealth.reasons), ["other-product"]); eq((await send({ type: "ahist-health", event: "read", reason: "constructor" })).error, "rejected");
  // 7) profile-update: name is sanitised, the +91 rule applies on every path
  apiCalls.length = 0; const pu = await send({ type: "profile-update", name: "A" + BIDI + CTRL + "n".repeat(60), phone: "+919876543210", gesture: true }); ok(pu.ok, "profile-update ok: " + JSON.stringify(pu)); const body = apiCalls.find(c => /ext_profiles/.test(c[0]))[1].body; ok(body.name.length <= 80 && !/[\u0000-\u001f​-‏‪-‮﻿\u007f-\u009f]/.test(body.name), "name sent clean: " + JSON.stringify(body.name)); eq(body.phone, "+919876543210");
  for (const phone of ["9876543210", "+915876543210", "+91 98765 43210", "+9198765432101", "0919876543210", "+91987654321\n", "+٩١9876543210"]) { eq((await send({ type: "profile-update", phone, gesture: true })).error, "rejected", "phone accepted by guard: " + phone); }
  eq(vm.runInContext("sanitizeText('x' + String.fromCharCode(0x202e) + 'y')", ctx), "x y");
  // 8) ip lookup text from a third party is bounded and clean
  sandbox.fetch = async () => ({ json: async () => ({ success: true, postal: "560001", latitude: "NaN", longitude: 77.5, city: "Ban‮galore" + "x".repeat(100) }) }); const ip = await vm.runInContext("ipLocate()", ctx); ok(ip.city.length <= 60 && !ip.city.includes("‮") && ip.lat === undefined && ip.lon === 77.5, "ipLocate output: " + JSON.stringify(ip).slice(0, 100));
  staticChecks();
  console.log(`boundary: ${n} checks passed`);
})().catch(e => { console.log("FAIL " + (e && e.stack || e)); process.exit(1); });
function __enqClean(ops) { return ops.every(o => !/[\u0000-\u001f​-‏‪-‮﻿]/.test(String(o.site || "") + String(o.title || ""))); }

// ---- manifest + extension pages: minimal and static
function staticChecks() {
  const man = JSON.parse(read("manifest.json")), html = read("options.html"), files = fs.readdirSync(EXT).filter(f => f.endsWith(".js") && !/\.test\.js$/.test(f) && f !== "selfcheck.js");
  ok(!("web_accessible_resources" in man), "web_accessible_resources would let any page load extension files / fingerprint the extension"); ok(!("externally_connectable" in man), "externally_connectable would open the message channel to web pages"); ok(!("update_url" in man) && !("devtools_page" in man) && !("sandbox" in man) && !("chrome_url_overrides" in man), "no unused extension surface");
  const hosts = [...man.host_permissions, ...man.optional_host_permissions, ...man.content_scripts.flatMap(c => c.matches)]; ok(hosts.every(h => /^https:\/\//.test(h)), "every host pattern is https-only (no http, no *://, no <all_urls>): " + hosts.filter(h => !/^https:\/\//.test(h))); ok(!hosts.some(h => /^https:\/\/\*\/\*$/.test(h)) || JSON.stringify(man.optional_host_permissions) === '["https://*/*"]', "broad https://*/* only as an OPTIONAL permission the user grants (independent-store opt-in)");
  ok(!man.host_permissions.some(h => /^https:\/\/\*\/|<all_urls>/.test(h)), "no required broad host permission");
  for (const c of man.content_scripts) ok(!c.all_frames && !c.match_about_blank && !c.match_origin_as_host && c.world !== "MAIN" && c.run_at === "document_idle", "content script stays in the isolated world, top frame only"); ok(!man.permissions.includes("tabs") && !man.permissions.includes("history") && !man.permissions.includes("cookies") && !man.permissions.includes("webRequest") && !man.permissions.includes("debugger") && !man.permissions.includes("management") && !man.permissions.includes("downloads"), "no powerful permission");
  const csp = man.content_security_policy.extension_pages; ok(/script-src 'self'/.test(csp) && /object-src 'self'/.test(csp) && /base-uri 'none'/.test(csp) && !/unsafe|\*|https?:|data:|blob:/.test(csp), "strict extension-page CSP: " + csp);
  // options.html: no inline script, no event-handler attributes, no remote or javascript: references, no forms posting anywhere
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]; ok(scripts.length > 0 && scripts.every(([, a, body]) => /\bsrc="[A-Za-z0-9._-]+\.js"/.test(a) && !body.trim()), "options.html scripts are local src files only (no inline script)"); ok(!/\son[a-z]+\s*=/i.test(html), "no inline event handlers"); ok(!/(src|href|action|data|srcset)\s*=\s*["']?\s*(https?:|\/\/|javascript:|data:)/i.test(html), "options.html references nothing remote"); ok(!/<(iframe|object|embed|form|link\b[^>]*rel=["']?(import|preload|prefetch))/i.test(html), "no iframe/object/embed/form");
  for (const f of files) { const s = read(f); ok(!/importScripts\(\s*["'`]https?:|import\(\s*["'`]https?:|<script[^>]+src=["']?https?:/i.test(s), f + ": no remote code"); ok(!/\bconsole\.(log|info|debug|warn|error|trace|dir)\b/.test(s), f + ": console output would leak tokens/emails/phones into the extension log"); ok(!/lastError\s*\.\s*message|(String|JSON\.stringify)\([^)]*lastError/.test(s), f + ": runtime.lastError text is not surfaced"); ok(!/\.(innerHTML|outerHTML)\s*=[^=]*\b(title|name|url|text|message|seller|brand)\b/.test(s), f + ": no scraped field assigned to innerHTML"); }
  // background.js only reads message fields that some guard.js schema validates (a field read here but unchecked there would be attacker-controlled)
  const G = vm.runInThisContext("(() => {" + read("guard.js").replace("const { validateMessage, sanitizeText, keyHostOk } = (() => {", "const G = (() => {").replace("return { validateMessage, sanitizeText, keyHostOk };", "return { S };").replace(/if \(typeof module[^\n]*/, "") + "\nreturn G;})()");
  const checked = new Set(["type", "gesture", ...Object.values(G.S).flatMap(o => Object.keys(o))]), used = [...new Set([...read("background.js").matchAll(/\bm\.(\w+)/g)].map(m => m[1]))];
  ok(used.length > 15, "parsed the handler fields"); for (const f of used) ok(checked.has(f), "background.js reads m." + f + " which no guard schema validates");
}
