// Tracker parsers + fetch on real captures (Amazon AOD fragment, Flipkart PDP state, Myntra __myx). Captcha/blocked pages must never become prices.
const assert = require("assert"), fs = require("fs"), path = require("path");
global.cmpStateJson = require("../../extension/compare.js").cmpStateJson;
const T = require("../../extension/tracker.js"), fx = (d, n) => fs.readFileSync(path.join(__dirname, "../fixtures", d, n), "utf8");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
// Amazon
let r = T.trkParseAmazon(fx("offers", "aod-single.html"), "B0F8BVSK21"); ok(r.ok && r.price === 766 && r.mrp === 3990, "amazon single seller: " + JSON.stringify(r));
r = T.trkParseAmazon(fx("offers", "aod-multi.html"), "B0DCSYTVDD"); ok(r.ok && r.price > 1000 && r.price < 1e6, "amazon multi seller reads the pinned (buy-box) offer: " + JSON.stringify(r));
ok(!T.trkParseAmazon(fx("offers", "aod-single.html"), "B0AAAAAAAA").ok, "other asin: wrong page");
ok(T.trkParseAmazon("<html>Enter the characters you see below</html>", "B0F8BVSK21").reason === "captcha", "captcha page");
ok(T.trkParseAmazon("", "B0F8BVSK21").reason === "empty", "empty");
ok(T.trkParseAmazon('<div data-asin="B0F8BVSK21">Currently unavailable.</div>', "B0F8BVSK21").unavailable === true, "unavailable is ok:true, not a failure");
ok(T.trkParseAmazon('<div id="aod-pinned-offer" data-asin="B0F8BVSK21"><div id="aod-offer-heading"><span class="a-text-bold"> Used - Good </span></div><span class="apex-pricetopay-accessibility-label"> ₹500.00 with 10 percent</span></div>', "B0F8BVSK21").neutral === "not-new", "used offer is never the tracked price (neutral, not a failure)");
ok(T.trkParseAmazon("<div data-asin=\"B0F8BVSK21\">Some page without an offer box</div>", "B0F8BVSK21").neutral === "no-offer", "no offer box: neutral, must not count as a store failure");
// Reliance Digital (Fynd state)
r = T.trkParseReliance(fx("track", "reliance-pdp.html"), "8842028"); ok(r.ok && r.price === 999 && r.mrp === 6990, "reliance: " + JSON.stringify(r));
ok(T.trkParseReliance(fx("track", "reliance-pdp.html"), "1234567").reason === "wrong-page", "reliance other product");
ok(!T.trkParseReliance("<html>no state</html>", "1").ok && T.trkParseReliance("<html>Access Denied</html>", "1").reason === "captcha", "reliance garbage / blocked");
ok(T.trkParseReliance('<script>window.__INITIAL_STATE__ = {"productDetailsPage":{"product":{"uid":5},"product_meta":{"sellable":false,"price":{"effective":{"min":10}}}}};</script>', "5").unavailable === true, "reliance not sellable = unavailable, not a price");
ok(T.trkParseReliance('<script>window.__INITIAL_STATE__ = {"productDetailsPage":{"product":{"uid":5},"product_meta":{"sellable":true,"price":{"effective":{"min":0}}}}};</script>', "5").reason === "no-price", "reliance zero price refused");
// Flipkart
r = T.trkParseFlipkart(fx("track", "flipkart-pdp.html"), "ACCHGG7ND9BRXRGZ"); ok(r.ok && r.price === 766 && r.mrp === 3990, "flipkart: " + JSON.stringify(r));
ok(T.trkParseFlipkart(fx("track", "flipkart-pdp.html"), "ACCOTHEROTHER0000").reason === "wrong-page", "flipkart other pid");
ok(!T.trkParseFlipkart("<html>no state</html>", "X").ok && T.trkParseFlipkart("<html>Access Denied</html>", "X").reason === "captcha", "flipkart garbage / blocked");
// Myntra
r = T.trkParseMyntra(fx("offers", "myntra-pdp.html"), "12027436"); ok(r.ok && r.price === 376 && r.mrp === 649, "myntra: " + JSON.stringify(r));
ok(T.trkParseMyntra(fx("offers", "myntra-pdp.html"), "999").reason === "wrong-page", "myntra other style");
ok(T.trkParseMyntra('<script>window.__myx = {"pdpData":{"id":5,"mrp":100,"price":{"discounted":80},"sizes":[{"label":"S","available":false,"sizeSellerData":[]}]}};</script>', "5").unavailable === true, "all sizes sold out: unavailable");
// fetch layer
(async () => {
  let seen; const mk = (body, o = {}) => async (u, init) => { seen = { u, init }; return { ok: o.ok !== false, status: o.status || 200, url: o.url || u, headers: { get: () => "0" }, text: async () => body }; };
  r = await T.trkFetch("amazon.in:B0F8BVSK21", {}, mk(fx("offers", "aod-single.html"))); ok(r.ok && r.price === 766 && /aodAjaxMain\/ref=dp_aod_ALL_mbc\?asin=B0F8BVSK21/.test(seen.u) && seen.init.credentials === "include", "amazon fetch shape");
  r = await T.trkFetch("flipkart.com:ACCHGG7ND9BRXRGZ", { url: "https://www.flipkart.com/x/p/itm1?pid=OTHER&x=1" }, mk(fx("track", "flipkart-pdp.html"))); ok(r.ok && r.price === 766 && /pid=ACCHGG7ND9BRXRGZ$/.test(seen.u), "flipkart url rebuilt from the key id, not from stored query: " + seen.u);
  ok((await T.trkFetch("flipkart.com:ACCHGG7ND9BRXRGZ", { url: "https://evil.example/p" }, mk(""))).reason === "bad-url", "stored url on another host is refused");
  ok((await T.trkFetch("flipkart.com:ACCHGG7ND9BRXRGZ", { url: "http://www.flipkart.com/p" }, mk(""))).reason === "bad-url", "http refused");
  ok((await T.trkFetch("amazon.in:bad id", {}, mk(""))).reason === "bad-id", "bad asin");
  ok((await T.trkFetch("zepto.com:1", {}, mk(""))).reason === "unsupported", "unsupported store");
  ok((await T.trkFetch("amazon.in:B0F8BVSK21", {}, mk("x", { url: "https://www.evil.com/" }))).reason === "redirect", "redirect off host");
  ok((await T.trkFetch("amazon.in:B0F8BVSK21", {}, mk("x", { ok: false, status: 503 }))).reason === "blocked-503", "503 is a block");
  ok((await T.trkFetch("amazon.in:B0F8BVSK21", {}, (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })))))).reason === "timeout", "timeout");
  console.log(`trk: ${n} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
