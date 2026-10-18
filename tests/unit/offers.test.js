// Other sellers: parser reads a real captured Amazon.in offers fragment (laptop with 4 sellers), never trusts page text.
const assert = require("assert"), fs = require("fs"), path = require("path");
const O = require("../../extension/offers.js"), fx = n => fs.readFileSync(path.join(__dirname, "../fixtures/offers", n + ".html"), "utf8");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const rows = O.offParseAod(fx("aod-multi"));
ok(rows.length === 4, "four offers: " + rows.length);
ok(rows[0].price === 57690 && rows[0].seller === "FESTIVE BAWAAL" && rows[0].sid === "AFMWYQ5IN4PLA" && rows[0].cond === "New" && /Amazon/.test(rows[0].ships), "first offer: " + JSON.stringify(rows[0]));
ok(rows[0].rating === 1 && rows[0].ratings === 3, "seller rating read with its sample size: " + rows[0].rating + "/" + rows[0].ratings);
ok(rows[3].price === 64990 && rows[3].seller === "BLR Laptop MGL", "last offer " + JSON.stringify(rows[3]));
ok(O.offParseAod(fx("aod-single")).length === 0, "single-seller page: no rows");
ok(O.offParseAod("").length === 0 && O.offParseAod(null).length === 0 && O.offParseAod("<div>x</div>").length === 0, "garbage: no rows");
ok(O.offParseAod('<div id="aod-offer"><span id="aod-price-1"><span class="a-price-whole">1,000</span></span><div id="aod-offer-soldBy"><a href="/x?seller=ABCDEFGH12"><img onerror=alert(1)>Evil &lt;b&gt;</a></div></div>').every(r => !/[<>]/.test(r.seller)), "markup stripped from names");
const b = O.offBest(rows, 64990); ok(b.lowest.price === 57690 && b.saving === 7300, "best + saving " + JSON.stringify(b));
ok(O.offBest([{ ...rows[0], cond: "Used - Good" }], 70000) === null, "used offers never counted as the cheaper new price");
ok(O.offBest(rows, 50000).saving === 0, "already lowest: no saving");
// seller storefront
{ const big = O.offParseSellerPage(fx("seller-big")), tiny = O.offParseSellerPage(fx("seller-tiny"));
  ok(big && big.stars === 3.5 && big.positive === 68 && big.n === 75303 && big.months === 12, "storefront headline: " + JSON.stringify(big));
  ok(big.m1.r === 3.1 && big.m1.n === 8506 && big.m3.r === 3.1 && big.m12.r === 3.7 && big.life.r === 4 && big.life.n === 170541, "rating windows 1m/3m/12m/lifetime: " + JSON.stringify([big.m1, big.m3, big.m12, big.life]));
  ok(big.dist && big.dist[5] === 63 && big.dist[1] === 20, "star split");
  ok(tiny && tiny.stars === 1 && tiny.positive === 0 && tiny.n === 3 && tiny.months === 0, "lifetime/tiny seller: " + JSON.stringify(tiny));
  ok(O.offParseSellerPage("") === null && O.offParseSellerPage("<html>nothing</html>") === null, "garbage: null"); }
(async () => {
  let calls = 0, last; const f = async (u, o) => { calls++; last = { u, o }; return { ok: true, text: async () => fx("aod-multi") }; };
  O.offCache.clear(); let r = await O.offFind({ asin: "B0DCSYTVDD" }, f, 1000);
  ok(r.offers.length === 4 && r.offers[0].price === 57690 && !r.failed && /aodAjaxMain\?asin=B0DCSYTVDD|aodAjaxMain\/ref=dp_aod_ALL_mbc\?asin=B0DCSYTVDD/.test(last.u) && last.o.headers["x-requested-with"] === "XMLHttpRequest", "fetch shape");
  await O.offFind({ asin: "B0DCSYTVDD" }, f, 2000); ok(calls === 1, "cached 15 min");
  r = await O.offFind({ asin: "B0DCSYTVDD" }, async () => ({ ok: false, status: 503 }), 1e9); ok(r.failed && !r.offers.length, "503 reported");
  r = await O.offFind({ asin: "bad id" }, f, 3000); ok(r.failed && calls === 1, "invalid asin never fetched");
  const t0 = Date.now(); r = await O.offFind({ asin: "B0AAAAAAAA" }, (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("a")))), 5000); ok(r.failed && Date.now() - t0 < 9500, "timeout");
  O.offSellerCache.clear(); let sc = 0; const sf = async u => { sc++; return { ok: true, text: async () => fx("seller-big") }; };
  let rs = await O.offSeller({ sid: "AJ6SIZC8YQDZX" }, sf, 1000); ok(rs.data && rs.data.n === 75303 && sc === 1, "seller fetched"); await O.offSeller({ sid: "AJ6SIZC8YQDZX" }, sf, 2000); ok(sc === 1, "cached 24h");
  ok((await O.offSeller({ sid: "bad" }, sf, 3000)).failed && sc === 1, "bad id never fetched"); ok((await O.offSeller({ sid: "AAAAAAAAAA" }, async () => ({ ok: false, status: 503 }), 4000)).failed, "503 reported");
  // ---- Flipkart sellers (real captured response, trimmed)
  const fk = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/offers/flipkart-sellers.json"), "utf8")), fr = O.offParseFlipkart(fk);
  ok(fr.length === 5, "flipkart: five sellers " + fr.length);
  ok(fr[0].seller === "RetailNet" && fr[0].price === 60990 && fr[0].rating === 4.3 && fr[0].here === true && fr[0].delivery === "24 Oct, Saturday" && fr[0].sid === null, "flipkart first: " + JSON.stringify(fr[0]));
  const dm = fr.find(x => x.seller === "BBDDIGITAL"); ok(dm.dormant === true && dm.rating === 1, "dormant seller flagged");
  const cheapDormant = [{ price: 100, cond: "New", seller: "A", dormant: true }, { price: 200, cond: "New", seller: "B" }]; ok(O.offBest(cheapDormant, 300).lowest.seller === "B", "an inactive seller is never 'lowest'");
  ok(!O.offParseFlipkart(null).length && !O.offParseFlipkart({}).length && !O.offParseFlipkart({ RESPONSE: { data: { product_seller_detail_1: { data: [{ value: { sellerInfo: { value: { name: "X" } }, pricing: { value: { finalPrice: { value: 0 } } } } }] } } } }).length, "flipkart garbage / zero price: no rows");
  ok(O.offParseFlipkart({ RESPONSE: { data: { product_seller_detail_1: { data: [{ value: { sellerInfo: { value: { name: "<b>Evil</b>" + "x".repeat(200) } }, pricing: { value: { finalPrice: { value: 10 } } }, metadata: { averageRating: 0 } } }] } } } })[0].seller.length <= 80, "seller name capped, tags stripped");
  O.offCache.clear(); let fc = 0, req; const ff = async (u, o) => { fc++; req = { u, o }; return { ok: true, json: async () => fk }; };
  let fo = await O.offFindFlipkart({ pid: "COMGZUYDGFJGHZR4" }, ff, 1000); ok(fo.offers.length === 5 && fo.offers[0].price === 60990 && fo.offers[4].price === 77233, "flipkart sorted by price");
  ok(req.u === "https://1.rome.api.flipkart.com/api/3/page/dynamic/product-sellers" && req.o.method === "POST" && JSON.parse(req.o.body).requestContext.productId === "COMGZUYDGFJGHZR4" && req.o.credentials === "omit", "flipkart request shape");
  await O.offFindFlipkart({ pid: "COMGZUYDGFJGHZR4" }, ff, 2000); ok(fc === 1, "flipkart cached 15 min");
  ok((await O.offFindFlipkart({ pid: "bad" }, ff, 3000)).failed && fc === 1, "invalid pid never fetched");
  ok((await O.offFindFlipkart({ pid: "AAAAAAAAAAAAAAAA" }, async () => ({ ok: false, status: 503 }), 4000)).failed, "flipkart 503 reported");
  // ---- Myntra sellers (inside the page)
  const my = O.offParseMyntra(fx("myntra-pdp")); ok(my.length === 2 && my[0].name === "Vision Star" && my[0].minPrice === 376 && my[0].maxPrice === 376, "myntra cheapest seller first: " + JSON.stringify(my[0]));
  ok(my[1].minPrice === 421 && my[1].sizes.join() === "S,M,XL", "myntra second seller sizes: " + JSON.stringify(my[1]));
  ok(O.offParseMyntra("").length === 0 && O.offParseMyntra("<html>x</html>").length === 0 && O.offParseMyntra("window.__myx = {").length === 0, "myntra garbage: none");
  ok(O.offParseMyntra('window.__myx = {"pdpData":{"sellers":[{"sellerPartnerId":1,"sellerName":"A"}],"sizes":[{"label":"S","available":false,"sizeSellerData":[{"sellerPartnerId":1,"availableCount":5,"discountedPrice":10}]},{"label":"M","available":true,"sizeSellerData":[{"sellerPartnerId":1,"availableCount":0,"discountedPrice":10}]}]}};').length === 0, "sold-out sizes never count");
  // ---- honest empty / pinned / failure causes (real cookieless Amazon fragments captured 2026-10-18; "captcha" page below is SYNTHETIC)
  const aod = (html, st = 200) => async () => ({ ok: st === 200, status: st, text: async () => html });
  const pr = O.offParseAod(fx("aod-pinned")); ok(pr.length === 5 && pr[0].seller === "SUPREME-TRADES" && pr[0].here === true && pr.filter(x => x.here).length === 1 && pr[1].seller === "FESTIVE BAWAAL" && !pr[1].here, "pinned buy-box seller parsed and marked here, list rows are not: " + pr.map(x => x.seller + x.here));
  const mu = O.offParseAod(fx("aod-multi")); ok(mu.length === 4 && mu[0].here === true && mu.filter(x => x.here).length === 1, "pinned seller that is also in the list becomes ONE row marked here");
  const po = O.offParseAod(fx("aod-pinned-only")); ok(po.length === 1 && po[0].seller === "NexSure Retail" && po[0].here === true && po[0].price === 1299, "pinned-only product = exactly one offer, here");
  const np = O.offParseAod(fx("aod-pinned-noprice")); ok(np.length === 1 && np[0].here === false, "pinned has no price: the one list row is not 'here'");
  O.offCache.clear();
  r = await O.offFind({ asin: "B0F8BVSK21" }, aod(fx("aod-noloc")), 1e6); ok(!r.failed && r.offers.length === 0 && r.reason === "noloc", "'no sellers matching your location' is noloc, not single: " + r.reason);
  r = await O.offFind({ asin: "B0CP3JV7VP" }, aod(fx("aod-pinned-only")), 1e6); ok(!r.failed && r.offers.length === 1 && r.offers[0].here, "one real offer listed");
  O.offCache.clear(); let c2 = 0; const cnt = h => async () => { c2++; return { ok: true, status: 200, text: async () => h }; };
  await O.offFind({ asin: "B0F8BVSK21" }, cnt(fx("aod-noloc")), 1000); await O.offFind({ asin: "B0F8BVSK21" }, cnt(fx("aod-noloc")), 1000 + 60e3); ok(c2 === 1, "empty answer cached briefly");
  await O.offFind({ asin: "B0F8BVSK21" }, cnt(fx("aod-noloc")), 1000 + 3 * 60e3); ok(c2 === 2, "empty answer expires after 2 min, not 15");
  O.offCache.clear(); r = await O.offFind({ asin: "B0F8BVSK21" }, aod(fx("aod-404")), 1e6); ok(r.failed && r.reason === "parse", "404 page served with 200 is a parse failure: " + r.reason);
  r = await O.offFind({ asin: "B0F8BVSK21" }, aod("<html><form action=/errors/validateCaptcha>Enter the characters you see below</form></html>"), 1e6); ok(r.failed && r.reason === "blocked", "SYNTHETIC captcha page is blocked");
  r = await O.offFind({ asin: "B0F8BVSK21" }, aod("", 503), 1e6); ok(r.failed && r.reason === "blocked", "503 = blocked");
  r = await O.offFind({ asin: "B0F8BVSK21" }, aod("", 500), 1e6); ok(r.failed && r.reason === "network", "500 = network");
  r = await O.offFind({ asin: "B0F8BVSK21" }, async () => { throw new TypeError("Failed to fetch"); }, 1e6); ok(r.failed && r.reason === "network", "fetch throw = network");
  ok(O.offCache.size === 0, "failures are never cached: " + O.offCache.size);
  r = await O.offFind({ asin: "B0F8BVSK21" }, aod(fx("aod-pinned")), 1e6 + 3 * 60e3); ok(!r.failed && r.offers.length === 5, "a retry after a failure fetches again");
  // ---- Flipkart: location, causes, nothing cached on failure
  O.offCache.clear(); let rq; const fk2 = (j, st = 200) => async (u, o) => { rq = JSON.parse(o.body); return { ok: st === 200, status: st, json: async () => { if (j === "bad") throw new SyntaxError("x"); return j; } }; };
  r = await O.offFindFlipkart({ pid: "COMGZUYDGFJGHZR4", pin: "560001" }, fk2(fk), 1000); ok(rq.locationContext.pincode === "560001" && r.pin === "560001" && r.offers[0].delivery === "24 Oct, Saturday", "saved pin goes in locationContext (verified live: it changes delivery dates), delivery kept");
  r = await O.offFindFlipkart({ pid: "COMGZUYDGFJGHZR4" }, fk2(fk), 1000); ok(!("pincode" in rq.locationContext) && r.pin === "" && r.offers.every(x => x.delivery === ""), "no pin: default-location delivery dates dropped (they would be someone else's)");
  r = await O.offFindFlipkart({ pid: "COMGZUYDGFJGHZR4", pin: "5600" }, fk2(fk), 1000); ok(!("pincode" in rq.locationContext) && r.pin === "", "malformed pin never sent (Flipkart answers 400)");
  let fcn = 0; await O.offFindFlipkart({ pid: "COMGZUYDGFJGHZR4", pin: "560001" }, async () => { fcn++; return { ok: true, json: async () => fk }; }, 2000); ok(fcn === 0, "same pid+pin cached; other pins are separate entries");
  O.offCache.clear(); r = await O.offFindFlipkart({ pid: "COMGZUYDGFJGHZR4" }, fk2({ RESPONSE: { data: { product_seller_detail_1: { data: [] } } } }), 1000); ok(!r.failed && !r.offers.length && r.reason === "empty", "empty list is an answer (reason empty)");
  r = await O.offFindFlipkart({ pid: "COMGZUYDGFJGHZR4" }, fk2({ RESPONSE: {} }), 1000 + 3 * 60e3); ok(r.failed && r.reason === "parse", "unknown shape = parse");
  r = await O.offFindFlipkart({ pid: "COMGZUYDGFJGHZR4" }, fk2("bad"), 1000 + 3 * 60e3); ok(r.failed && r.reason === "parse", "non-JSON = parse");
  r = await O.offFindFlipkart({ pid: "COMGZUYDGFJGHZR4" }, fk2({}, 429), 1000 + 3 * 60e3); ok(r.failed && r.reason === "blocked", "429 = blocked");
  console.log(`offers: ${n} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
