// Cross-store compare: parsers read real captured structure, the matcher never calls a different model/variant "Exact".
const assert = require("assert"), fs = require("fs"), path = require("path");
global.mtFacts = require("../../extension/match.js").mtFacts; global.mtCompare = require("../../extension/match.js").mtCompare; global.mtAlnum = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); const C = require("../../extension/compare.js"), fx = n => fs.readFileSync(path.join(__dirname, "../fixtures/compare", n + ".html"), "utf8");
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
// network layer: skips the current store, parses each store's page, sorts by price, reports failures, caches
(async () => {
  const pages = { "www.flipkart.com": fx("flipkart"), "www.reliancedigital.in": fx("reliance"), "www.amazon.in": fx("amazon") }; let calls = 0;
  const f = async u => { calls++; const h = new URL(u).hostname; if (h === "www.reliancedigital.in") return { ok: false, status: 503 }; return { ok: true, text: async () => pages[h] }; };
  C.cmpCache.clear();
  let r = await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Amazon", price: 766 }, f, 1000);
  ok(calls === 2 && r.failed.join() === "Reliance Digital" && r.results.length === 1 && r.results[0].store === "Flipkart" && r.results[0].price === 766, "find from Amazon: " + JSON.stringify(r));
  r = await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Amazon", price: 766 }, f, 2000); ok(calls === 3, "flipkart cached, failed store retried: " + calls);
  r = await C.cmpFind({ title: "", brand: "x", site: "Amazon", price: 1 }, f, 3000); ok(r.results.length === 0, "empty title");
  const slow = (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  C.cmpCache.clear(); const t0 = Date.now(); r = await C.cmpFind({ title: AMZ_TITLE, brand: "boAt", site: "Flipkart", price: 766 }, slow, 5000);
  ok(r.failed.length === 2 && Date.now() - t0 < 9500, "slow stores time out and are reported (" + (Date.now() - t0) + "ms)");
  console.log(`compare: ${n} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
