// Cross-store compare: parsers read real captured structure, the matcher never calls a different model/variant "Exact".
const assert = require("assert"), fs = require("fs"), path = require("path");
global.mtQuery = require("../../extension/match.js").mtQuery; global.mtChecks = require("../../extension/match.js").mtChecks; global.mtFacts = require("../../extension/match.js").mtFacts; global.mtCompare = require("../../extension/match.js").mtCompare; global.mtAlnum = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); const C = require("../../extension/compare.js"), fx = n => fs.readFileSync(path.join(__dirname, "../fixtures/compare", n + ".html"), "utf8");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const AMZ_TITLE = "boAt Airdopes 141 Gen 2, 4 Mics ENx Tech, 48 Hrs Playback, Fast Charge, Low Latency, IPX4, v5.4 Bluetooth Earbuds TWS Ear Buds Wireless with mic (Active Black)";

const fk = C.cmpParseFlipkart(fx("flipkart")), rd = C.cmpParseReliance(fx("reliance")), az = C.cmpParseAmazon(fx("amazon"));
ok(fk.length === 4 && fk[0].price === 766 && /^https:\/\/www\.flipkart\.com\/boat-airdopes-141/.test(fk[0].url), "flipkart parse");
ok(rd.length === 3 && rd[0].price === 1399 && /^https:\/\/www\.reliancedigital\.in\/product\/boat-airdopes-141/.test(rd[0].url), "reliance parse");
ok(az.length === 3 && az[0].price === 766 && az[0].url === "https://www.amazon.in/dp/B0F8BVSK21", "amazon parse");
ok(C.cmpParseFlipkart("<html>no state</html>").length === 0 && C.cmpParseReliance("").length === 0 && C.cmpParseAmazon("<div>x</div>").length === 0, "empty/garbage pages give no rows");
ok(C.cmpStateJson('x __INITIAL_STATE__ = {"a":"}{ \\" }","b":{"c":1}}; more') .b.c === 1, "brace matcher respects strings");

const id = C.cmpIdentity(AMZ_TITLE, "boAt");
let best = C.cmpPick(id, fk, 766); ok(best && best.price === 766 && best.confidence === "Exact", "same model on flipkart is Exact: " + JSON.stringify(best));
best = C.cmpPick(id, rd, 766); ok(!best || best.confidence !== "Exact", "Airdopes 141 ANC at Reliance is not Exact: " + JSON.stringify(best));
ok(!C.cmpPick(id, [{ title: "boAt Airdopes 141 Gen 2 spare charging case", price: 90, url: "https://x" }], 766), "a price far below the product is a different thing");
const ip = C.cmpIdentity("Apple iPhone 16 128 GB: 5G Mobile Phone with Camera Control", "Apple");
ok(!C.cmpPick(ip, [{ title: "Apple iPhone 16 (256 GB) Black", price: 86999, url: "https://x" }], 76999), "128GB never matches 256GB");
best = C.cmpPick(ip, [{ title: "Apple iPhone 16 (128 GB) Black", price: 77999, url: "https://a" }, { title: "Apple iPhone 16 Plus (128 GB)", price: 87999, url: "https://b" }], 76999); ok(best && best.url === "https://a", "iPhone 16 not Plus");
ok(!C.cmpPick(ip, [{ title: "Apple iPhone 16 Plus (128 GB)", price: 87999, url: "https://b" }], 76999), "only a Plus on offer: no match");
ok(!C.cmpPick(C.cmpIdentity("Sony WH-1000XM5 Headphones", "Sony"), [{ title: "Bose QuietComfort 45 Headphones", price: 30000, url: "https://z" }], 29990), "other brand dropped");

// Long Amazon phone title: identity is the model name + storage, not spec noise (this exact title returned "No confident match" live)
const LONG = "Apple iPhone 17e 256 GB: 15.40 cm (6.1″) Super Retina XDR Display, A19 Chip, All-Day Battery Life, 48MP Fusion Camera, 256GB Starting Storage; White";
ok(C.cmpIdentity(LONG, "Apple").toks.join(" ") === "apple iphone 17e 256gb", "identity: " + C.cmpIdentity(LONG, "Apple").toks.join(" "));
ok(C.cmpIdentity("Apple iPhone 15 (128 GB) - Black", "Apple").toks.join(" ") === "apple iphone 15 128gb", "storage kept when it sits in the brackets");
const phones = [{ title: "Apple iPhone 17 (Black, 256 GB)", price: 86999, url: "https://a" }, { title: "Apple iPhone 17e (Soft Pink, 512 GB)", price: 84900, url: "https://b" }, { title: "Apple iPhone 17e (White, 256 GB)", price: 64900, url: "https://c" }, { title: "Apple iPhone 17 Pro 256 GB", price: 130490, url: "https://d" }];
best = C.cmpPick(C.cmpIdentity(LONG, "Apple"), phones, 71999); ok(best && best.url === "https://c" && best.confidence === "Exact", "iPhone 17e 256 picks the right row: " + JSON.stringify(best));
const cl = C.cmpClosest(C.cmpIdentity(LONG, "Apple"), [{ title: "Apple iPhone 17 (Black, 256 GB)", price: 86999, url: "https://a" }, { title: "Samsung Galaxy S25", price: 70000, url: "https://s" }], 71999);
ok(cl && cl.url === "https://a" && /model|version/.test(cl.why), "closest explains itself: " + JSON.stringify(cl)); ok(C.cmpClosest(C.cmpIdentity(LONG, "Apple"), [{ title: "Boat Rockerz", price: 1000, url: "https://z" }], 71999) === null, "nothing close: null");
// Myntra (apparel): parsed from __myx.searchData, never "Exact" (no style code on the page)
const my = C.cmpParseMyntra(fx("myntra")); ok(my.length === 6 && my[0].price === 1268 && my[0].fashion && /^https:\/\/www\.myntra\.com\/jeans\/levis\//.test(my[0].url) && my[0].brand === "Levis", "myntra parse: " + JSON.stringify(my[0]));
ok(C.cmpParseMyntra("<html>x</html>").length === 0, "myntra garbage");
{ const idj = C.cmpIdentity("Levi's Men's 511 Slim Fit Jeans, Blue", "Levi's"), pj = C.cmpPick(idj, my, 1500); ok(pj && pj.confidence === "Likely", "apparel match is capped at Likely: " + JSON.stringify(pj && [pj.title, pj.confidence])); }
ok(C.CMP_STORES.Myntra.applies("Levi's Men's 511 Slim Fit Jeans") && !C.CMP_STORES.Myntra.applies("Apple iPhone 16 128 GB"), "myntra is only queried for fashion titles");
// ---- stock: a row the store itself marks unavailable never wins (real nodes trimmed from a 2026-10-18 Flipkart / Reliance capture) ----
{ const fk2 = C.cmpParseFlipkart(fx("flipkart-oos")), id17 = C.cmpIdentity(LONG, "Apple");
  ok(fk2.length === 2 && fk2.every(r => !/17e|Pro/.test(r.title)), "out-of-stock Flipkart rows are dropped: " + fk2.map(r => r.title).join(" | "));
  ok(C.cmpPick(id17, fk2, 71999) === null, "iPhone 17e 256 is out of stock at Flipkart: no 'Exact' at ₹64,900");
  const rs = C.cmpParseReliance(fx("reliance-sellable")); ok(rs.length === 3 && rs.every(r => r.price < 1400 && r.price !== 1399 || /141 ANC/.test(r.title)) && rs.map(r => r.price).sort().join() === "1399,799,999", "Reliance rows with sellable=false are dropped: " + rs.map(r => r.price));
  // SYNTHETIC mutations of the real Myntra / Amazon fixtures (the real captures held no sold-out row)
  const myOos = C.cmpParseMyntra(fx("myntra").replace('"price": 1268,', '"price": 1268, "inventoryInfo": [{"label": "32", "inventory": 0, "available": false}],')); ok(myOos.length === 5 && !myOos.some(r => r.price === 1268), "Myntra row with every size sold out is dropped [synthetic]");
  const azOos = C.cmpParseAmazon(fx("amazon").replace("<h2", "<span>Currently unavailable</span><h2")); ok(azOos.length === 2 && azOos[0].url !== "https://www.amazon.in/dp/B0F8BVSK21", "Amazon 'Currently unavailable' row is dropped [synthetic]"); }

// ---- query: ordered, de-junked, and the quick links use the very same builder ----
{ const q = (t, b, m) => C.cmpQuery(t, b, m), Q = {
    "Apple iPhone 16 128 GB: 5G Mobile Phone with Camera Control": ["Apple", "apple iphone 16 128gb"], "Samsung Galaxy M35 5G (Moonlight Blue, 8GB RAM, 128GB Storage) | Corning Gorilla Glass Victus+ | 6000 mAh Battery": ["Samsung", "samsung galaxy m35 128gb"],
    "Sony WH-1000XM5 Wireless Industry Leading Active Noise Cancelling Headphones, 8 Mics for Clear Calling, 40Hr Battery, Black": ["Sony", "sony wh1000xm5"], "Nike Men's Revolution 7 Running Shoes": ["Nike", "nike revolution 7"],
    "LG 108 cm (43 inches) 4K Ultra HD Smart LED TV 43UR7500PSC (Black)": ["LG", "lg 43ur7500psc"], "Philips Air Fryer HD9200/90, uses up to 90% less fat, 1400W, 4.1 Liter, Rapid Air Technology (Black), Large": ["Philips", "philips airfryer hd9200"],
    "Atomic Habits: The life-changing million copy bestseller by James Clear (Paperback)": ["James Clear", "james clear atomic habits"], "Apple iPhone 15 Pro Max (256 GB) - Natural Titanium": ["Apple", "apple iphone 15 pro max 256gb"],
    "HP Laptop 15, 13th Gen Intel Core i5-1335U (16GB DDR4, 512GB SSD) 15.6-inch (39.6 cm), FHD, Anti-Glare, Win 11, MSO 2021, Silver, 1.59 kg, fy5002TU": ["HP", "hp 15 fy5002tu 512gb"] };
  for (const [t, [b, want]] of Object.entries(Q)) ok(q(t, b) === want, `query "${want}" <- got "${q(t, b)}"`);
  ok(q("Sony Bravia KD-55X75L 55 inch 4K TV", "Sony") === "sony bravia kd 55x75l" && !/000ml/.test(q("Sony Bravia KD-55X75L 55 inch 4K TV", "Sony")), "a model code ending in L is not turned into millilitres");
  ok(q("Fire-Boltt Ninja Call Pro Plus 1.83 Smart Watch", "Fire-Boltt") === "fire boltt ninja call pro plus", "brand is not repeated: " + q("Fire-Boltt Ninja Call Pro Plus 1.83 Smart Watch", "Fire-Boltt")); }
// quick links: the two 404 templates are fixed (checked live 2026-10-18: /search-listing?q= and /search/result?q= answer 200 with results), and with match.js loaded the chips search for the compare query
{ const L = require("../../extension/lib.js"), T0 = "Apple iPhone 16 128 GB: 5G Mobile Phone with Camera Control, A18 Chip", links = L.smartLinks(T0, "Amazon", "Apple").links, url = nm => (links.find(l => l[0] === nm) || [])[1];
  ok(url("Vijay Sales") === "https://www.vijaysales.com/search-listing?q=" + encodeURIComponent("apple iphone 16 128gb"), "Vijay Sales chip: " + url("Vijay Sales"));
  ok(url("Flipkart") === "https://www.flipkart.com/search?q=" + encodeURIComponent(C.cmpQuery(T0, "Apple")), "chip query = compare query");
  ok(/shoppersstop\.com\/search\/result\?q=/.test(L.smartLinks("Nike Men's Revolution 7 Running Shoes", "Amazon", "Nike").links.find(l => l[0] === "Shoppers Stop")[1]), "Shoppers Stop chip");
  const keep = global.mtQuery; global.mtQuery = undefined; ok(/\?q=Apple%20iPhone%2016%20128%20GB$/.test(L.smartLinks(T0, "Amazon").links[0][1]), "without match.js the fallback query no longer carries the colon junk: " + L.smartLinks(T0, "Amazon").links[0][1]); global.mtQuery = keep; }
// ---- closest-but-rejected rows must share the model or its product line ----
{ const wk = C.cmpIdentity("Wakefit Eco TV Unit | Engineered Wood TV Stand for Living Room, Walnut Finish", "Wakefit"), pr = C.cmpIdentity("Prestige Svachh Deluxe Alpha Stainless Steel Pressure Cooker, 5 Litre, Silver", "Prestige");
  ok(C.cmpClosest(wk, [{ title: "Wakefit Fabric 3 Seater Sofa [abbreviated]", price: 15000, url: "https://s" }], 5499) === null, "a Wakefit sofa is not 'closest' to a Wakefit TV unit");
  ok(C.cmpClosest(pr, [{ title: "TTK Prestige Marvel GTM 04 Cooktop Hob", price: 7899, url: "https://c" }], 2799) === null, "a cooktop is not 'closest' to a pressure cooker");
  const near = C.cmpClosest(C.cmpIdentity("Apple iPhone 15 (128 GB) - Black", "Apple"), [{ title: "Apple iPhone 15 Pro (Black Titanium, 128 GB)", price: 134900, url: "https://p" }], 65900); ok(!near || /version|model/.test(near.why), "a same-line row is still explained"); }
// ---- store gating: no wasted request ----
{ const R = C.CMP_STORES["Reliance Digital"].applies, M = C.CMP_STORES.Myntra.applies;
  ok(R("Apple iPhone 15 (128 GB)") && R("Samsung Galaxy M35 5G (8GB RAM, 128GB)") && R("Philips Air Fryer HD9200/90") && R("Whirlpool 7 kg Top Load Washing Machine"), "Reliance is asked about electronics and appliances");
  ok(!R("Nike Men's Revolution 7 Running Shoes") && !R("Levi's Men's 511 Slim Fit Jeans") && !R("Atomic Habits (Paperback)") && !R("Wakefit Eco TV Unit | Sofa") && !R("Dettol Liquid Handwash Refill"), "Reliance is not asked about shoes, jeans, books, furniture, handwash");
  ok(M("boAt Airdopes 141 Gen 2 Earbuds") && M("Skybags Backpack 30L") && !M("Apple iPhone 15 (128 GB)"), "Myntra also sells earbuds and bags, not phones"); }

// network layer: skips the current store, parses each store's page, sorts by price, reports failures, persists answers in chrome.storage.session
(async () => {
  const mem = {}; global.chrome = { storage: { session: { get: async k => ({ [k]: mem[k] }), set: async o => { Object.assign(mem, o); } } } }; const wipe = () => { for (const k of Object.keys(mem)) delete mem[k]; }, ent = () => mem[C.CMP_KEY] || {};
  const pages = { "www.flipkart.com": fx("flipkart"), "www.reliancedigital.in": fx("reliance"), "www.amazon.in": fx("amazon"), "www.myntra.com": fx("myntra") }; let calls = 0;
  const f = async u => { calls++; const h = new URL(u).hostname; if (h === "www.reliancedigital.in") return { ok: false, status: 503 }; return { ok: true, text: async () => pages[h] }; };
  let r = await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Amazon", price: 766 }, f, 1000);
  ok(calls === 3 && r.failed.join() === "Reliance Digital" && r.why["Reliance Digital"] === "blocked" && r.results.length === 1 && r.results[0].store === "Flipkart" && r.results[0].price === 766, "find from Amazon: " + JSON.stringify(r));
  ok(Object.keys(ent()).sort().join() === ["Flipkart", "Myntra"].map(x => x + "|" + C.cmpQuery(AMZ_TITLE, "boAt")).join(), "only the stores that answered are persisted: " + Object.keys(ent()));
  r = await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Amazon", price: 766 }, f, 2000); ok(calls === 4, "answered stores served from the persisted cache, failed store retried: " + calls);
  r = await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Amazon", price: 766 }, f, 2000 + 16 * 60e3); ok(calls === 7, "the cache expires after 15 minutes: " + calls);
  r = await C.cmpFind({ title: "", brand: "x", site: "Amazon", price: 1 }, f, 3000); ok(r.results.length === 0, "empty title");
  calls = 0; r = await C.cmpFind({ title: "Philips Air Fryer HD9200/90", brand: "", site: "Amazon", price: 5000 }, f, 3000); ok(calls === 0 && !r.results.length && !r.failed.length, "no brand and not a book: nothing to confirm, no request is made");
  // soft blocks: the store must show as failed (not as "0 results") and must not be cached. SYNTHETIC bodies: the real Akamai page was not saved.
  const bmVerify = "<html><head><meta http-equiv=\"refresh\" content=\"0;URL='/s?k=x&bm-verify=AAQAAAAF'\"></head><body></body></html>", big = "<html><body>" + "<p>no results for your search</p>".repeat(300) + "</body></html>";
  const body = (b, status = 200) => async () => ({ ok: status < 400, status, text: async () => b });
  for (const [name, fn, wantWhy] of [["bm-verify meta-refresh (200)", body(bmVerify), "blocked"], ["empty 200", body(""), "blocked"], ["429", body("x", 429), "blocked"], ["403", body("x", 403), "blocked"], ["503", body("x", 503), "blocked"], ["captcha page (200, 20 KB)", body("<html>" + "x".repeat(20000) + "Type the characters you see in this image captcha</html>"), "blocked"]]) {
    wipe(); r = await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Amazon", price: 766 }, fn, 5000);
    ok(r.failed.length === 3 && r.why.Flipkart === wantWhy && !Object.keys(ent()).length, `${name}: reported as failed (${wantWhy}) and not cached: ` + JSON.stringify([r.failed, r.why, Object.keys(ent())]));
  }
  wipe(); r = await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Amazon", price: 766 }, body(big), 5000);
  ok(r.failed.length === 0 && r.seen.Flipkart === 0 && !Object.keys(ent()).length, "a normal 'no results' page is not a failure, but an empty answer is never cached [synthetic body]");
  // bounded: 250 old entries + this run -> at most 200 kept, newest first
  wipe(); mem[C.CMP_KEY] = Object.fromEntries(Array.from({ length: 250 }, (_, i) => ["X|q" + i, { at: 6000 + i, cands: [] }])); await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Amazon", price: 766 }, f, 7000);
  ok(Object.keys(ent()).length === 200 && ent()["Flipkart|" + C.cmpQuery(AMZ_TITLE, "boAt")] && !ent()["X|q0"] && ent()["X|q249"], "cache keeps the newest 200 entries: " + Object.keys(ent()).length);
  // storage.session unavailable: no cache, no crash
  { const keep = global.chrome; global.chrome = undefined; calls = 0; r = await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Amazon", price: 766 }, f, 8000); ok(r.results.length === 1 && calls === 3, "works without chrome.storage.session"); global.chrome = keep; }
  // stores are asked in parallel: total time is the slowest store, not the sum
  const delayed = async u => { await new Promise(res => setTimeout(res, 300)); return f(u); }; wipe(); const t1 = Date.now(); await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Myntra", price: 766 }, delayed, 9000); ok(Date.now() - t1 < 800, "3 stores at 300 ms each finish in parallel (" + (Date.now() - t1) + "ms)");
  const slow = (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  wipe(); const t0 = Date.now(); r = await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Flipkart", price: 766 }, slow, 5000);
  ok(r.failed.length === 3 && r.why.Amazon === "timeout" && Date.now() - t0 < 7500, "slow stores time out after ~6 s and are reported (" + (Date.now() - t0) + "ms)");
  console.log(`compare: ${n} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
