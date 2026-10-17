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
(async () => {
  let calls = 0, last; const f = async (u, o) => { calls++; last = { u, o }; return { ok: true, text: async () => fx("aod-multi") }; };
  O.offCache.clear(); let r = await O.offFind({ asin: "B0DCSYTVDD" }, f, 1000);
  ok(r.offers.length === 4 && r.offers[0].price === 57690 && !r.failed && /aodAjaxMain\?asin=B0DCSYTVDD|aodAjaxMain\/ref=dp_aod_ALL_mbc\?asin=B0DCSYTVDD/.test(last.u) && last.o.headers["x-requested-with"] === "XMLHttpRequest", "fetch shape");
  await O.offFind({ asin: "B0DCSYTVDD" }, f, 2000); ok(calls === 1, "cached 15 min");
  r = await O.offFind({ asin: "B0DCSYTVDD" }, async () => ({ ok: false, status: 503 }), 1e9); ok(r.failed && !r.offers.length, "503 reported");
  r = await O.offFind({ asin: "bad id" }, f, 3000); ok(r.failed && calls === 1, "invalid asin never fetched");
  const t0 = Date.now(); r = await O.offFind({ asin: "B0AAAAAAAA" }, (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("a")))), 5000); ok(r.failed && Date.now() - t0 < 9500, "timeout");
  console.log(`offers: ${n} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
