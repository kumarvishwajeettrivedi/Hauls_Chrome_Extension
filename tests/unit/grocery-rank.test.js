// Step 1 of the grocery results work: relevance, "Cheapest", unit-price labels, dedupe, unconfirmed stores. Pure logic, no network.
const assert = require("assert"), L = require("../../extension/lib.js");
global.num = L.num; global.parsePack = L.parsePack; global.unitPrice = L.unitPrice;
const G = require("../../extension/grocery.js");
const it = (name, price, pack, o = {}) => ({ store: "Blinkit", name, price, pack, inStock: true, ...o });
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log("  ok   " + n); } catch (e) { bad++; console.log("  FAIL " + n + "\n       " + String(e.message).split("\n")[0]); } };
const names = r => r.map(x => x.name), cheap = r => r.filter(x => x.cheapest).map(x => x.name);
t("any-word match: every 'chakla' product is listed, full matches first, unrelated dropped", () => {
  const r = G.rank([it("Wooden Chakla", 279, "1 pc"), it("Chakla Belan Set", 419, "2 pcs"), it("Rolling Pin Steel", 150, "1 pc"), it("Belan", 99, "1 pc")], "chakla belan");
  assert.equal(r.length, 3); assert.equal(r[0].name, "Chakla Belan Set"); assert.ok(!names(r).includes("Rolling Pin Steel")); });
t("Cheapest = lowest price among the BEST-matching items (exact phrase first), wherever it sits; a cheaper partial match never wins", () => {
  const r = G.rank([it("Chakla Belan Set", 419, "2 pcs"), it("Wooden Chakla", 279, "1 pc"), it("Chakla Belan Premium", 949, "3 pcs"), it("Wooden Chakla Belan Plain", 350, "1 pc")], "chakla belan");
  assert.deepEqual(cheap(r), ["Wooden Chakla Belan Plain"], "cheapest phrase match, not the cheaper partial 'Wooden Chakla'"); assert.ok(r.findIndex(x => x.name === "Wooden Chakla") > r.findIndex(x => x.name === "Chakla Belan Premium"), "partial matches sort below phrase matches"); });
t("'amul butter': the real butter outranks cookies and almond butter, and cheap look-alikes cannot take the Cheapest badge", () => {
  const r = G.rank([it("Amul Fresh Butter Cookies", 40, "200 g"), it("Pintola Almond Butter", 368, "200 g"), it("Amul Butter Pasteurised", 60, "100 g"), it("Amul Butter Garlic", 70, "100 g"), it("Britannia Butter Biscuits", 20, "100 g")], "amul butter");
  assert.deepEqual(r.slice(0, 2).map(x => x.name).sort(), ["Amul Butter Garlic", "Amul Butter Pasteurised"]); assert.deepEqual(cheap(r), ["Amul Butter Pasteurised"]);
  assert.ok(r.findIndex(x => x.name === "Amul Fresh Butter Cookies") < r.findIndex(x => x.name === "Pintola Almond Butter"), "all-words match beats single-word match"); });
t("with no exact phrase anywhere, all-word matches are the best tier (cheapest among them)", () => { const r = G.rank([it("Amul Fresh Butter Cookies", 40, "200 g"), it("Pintola Almond Butter", 10, "200 g"), it("Amul Gold Butter Spread Light", 90, "100 g")], "amul butter"); assert.deepEqual(cheap(r), ["Amul Fresh Butter Cookies"]); });
t("a cheaper sold-out item never gets the badge; all sold out = no badge", () => {
  assert.deepEqual(cheap(G.rank([it("Chakla A", 199, "1 pc", { inStock: false }), it("Chakla B", 279, "1 pc")], "chakla")), ["Chakla B"]);
  assert.deepEqual(cheap(G.rank([it("Chakla A", 199, "1 pc", { inStock: false })], "chakla")), []); });
t("unit labels: per piece only for 2+ pieces; g/ml per 100; per kg/L for big packs; nothing when unknown", () => {
  const r = G.rank([it("Chakla Set A", 419, "2 pcs"), it("Chakla B", 300, "1 pc"), it("Chakla 12 inch", 250, null), it("Atta Chakla Mix", 60, "500 g"), it("Chakla Oil", 95, "1 kg"), it("Chakla Juice", 40, "250 ml")], "chakla"), by = n => r.find(x => x.name === n).perLabel;
  assert.equal(by("Chakla Set A"), "₹209.5/pc"); assert.equal(by("Chakla B"), null); assert.equal(by("Chakla 12 inch"), null); assert.equal(by("Atta Chakla Mix"), "₹12/100g"); assert.equal(by("Chakla Oil"), "₹95/kg"); assert.equal(by("Chakla Juice"), "₹16/100ml"); });
t("Best value only compares the same unit class (g/ml) across different packs; never pieces or mixed units", () => {
  let r = G.rank([it("Salt X", 100, "2 x 500 g"), it("Salt Y", 95, "1 kg")], "salt"); assert.deepEqual(r.filter(x => x.bestValue).map(x => x.name), ["Salt Y"]);
  r = G.rank([it("Atta 1 kg", 60, "1 kg"), it("Atta pack", 50, "10 pcs")], "atta"); assert.equal(r.filter(x => x.bestValue).length, 0, "no cross-class compare");
  r = G.rank([it("Chakla A", 100, "2 pcs"), it("Chakla B", 150, "3 pcs")], "chakla"); assert.equal(r.filter(x => x.bestValue).length, 0, "pieces of different products are not 'value'");
  r = G.rank([it("Salt Z", 20, "1 kg")], "salt"); assert.equal(r.filter(x => x.bestValue).length, 0, "needs 2+ comparable packs"); });
t("dedupe: identical store+name+pack+price collapses; different price or pack stays", () => {
  assert.equal(G.rank([it("Vesta Homes Chakla Belan Set", 949, "3 pcs"), it("Vesta Homes Chakla Belan Set", 949, "3 pcs")], "chakla").length, 1);
  assert.equal(G.rank([it("Vesta Chakla", 949, "3 pcs"), it("Vesta Chakla", 899, "3 pcs")], "chakla").length, 2);
  assert.equal(G.rank([it("Chakla Atta", 60, "1 kg"), it("Chakla Atta", 35, "500 g")], "chakla").length, 2);
  assert.equal(G.rank([it("Chakla", 100, "1 pc"), it("Chakla", 100, "1 pc", { store: "DMart" })], "chakla").length, 2, "same product at two stores is kept"); });
t("matching is whole-word, case/hyphen/plural tolerant", () => {
  assert.equal(G.rank([it("CHAKLAS", 1, "1 pc"), it("Chakla-Belan", 2, "1 pc"), it("Chaklasomething", 3, "1 pc")], "chakla").length, 2); });
t("typed size: only same-unit packs near the size can win the badge, and they sort first", () => {
  const r = G.rank([it("Amul Butter", 60, "100 g"), it("Amul Butter", 270, "500 g")], "amul butter 500g"); assert.equal(r[0].pack, "500 g"); assert.deepEqual(cheap(r), ["Amul Butter"]); assert.equal(r.find(x => x.cheapest).pack, "500 g"); });
t("a typed size outranks text matches: 'amul butter 500g' puts Amul Salted Butter 500 g above an Amul Butter Cookies 200 g, and the badge goes to a 500 g pack", () => {
  const r = G.rank([it("Amul Butter Cookies", 40, "200 g"), it("Amul Salted Butter", 285, "500 g"), it("Pintola Almond Butter", 120, "500 g")], "amul butter 500g"); assert.equal(r[0].pack, "500 g"); assert.equal(r.find(x => x.name === "Amul Butter Cookies").cheapest, false); assert.deepEqual(cheap(r), ["Amul Salted Butter"]); });
t("parseBlinkit reads every product_card snippet type (not only type_2), skips cards without a price, keeps sold-out flag", () => {
  const card = (type, o) => ({ widget_type: type, data: { name: { text: o.name }, variant: { text: o.pack }, image: { url: "https://cdn/x.png" }, is_sold_out: !!o.so, product_state: "available", atc_action: { add_to_cart: { cart_item: { price: o.price, mrp: o.mrp, brand: o.brand, unit: o.pack } } } } });
  const json = { layout: [{ children: [card("product_card_snippet_type_2", { name: "Amul Butter 100 g", price: 60, mrp: 62, brand: "Amul", pack: "100 g" }), { x: [card("product_card_snippet_type_3", { name: "Amul Butter 500 g", price: 285, brand: "Amul", pack: "500 g" })] }, card("product_card_snippet_type_9", { name: "No price", price: undefined, pack: "1 pc" }), card("not_a_product", { name: "Banner", price: 5, pack: "1 pc" }), card("product_card_snippet_type_2", { name: "Sold out", price: 10, pack: "1 pc", so: true })] }] };
  const rows = G.parseBlinkit(json, "amul butter"); assert.deepEqual(rows.map(r => r.name), ["Amul Butter 100 g", "Amul Butter 500 g", "Sold out"]); assert.equal(rows[0].price, 60); assert.equal(rows[0].mrp, 62); assert.equal(rows[2].inStock, false); assert.ok(rows.every(r => r.store === "Blinkit")); assert.deepEqual(G.parseBlinkit(null, "x"), []); });
t("a query with only size/stop words keeps everything; junk prices are dropped", () => {
  assert.equal(G.rank([it("A", 10, "1 kg"), it("B", 20, "1 kg")], "1kg").length, 2); assert.equal(G.rank([it("A", 0, "1 kg"), it("B", NaN, "1 kg"), it("C", null, "1 kg"), it("D", 5, "1 kg")], "d").length, 1); });
t("stores whose delivery can't be confirmed never win the badge, and splitUnconfirmed removes their rows", () => {
  const r = G.rank([it("Chakla J", 100, "1 pc", { store: "JioMart", confirmed: false }), it("Chakla B", 200, "1 pc")], "chakla"); assert.deepEqual(cheap(r), ["Chakla B"]);
  const s = G.splitUnconfirmed(r); assert.deepEqual(s.items.map(x => x.name), ["Chakla B"]); assert.deepEqual(s.unconfirmed, ["JioMart"]); assert.deepEqual(G.splitUnconfirmed([]).unconfirmed, []); });
t("parseJio marks every row unconfirmed (its search ignores the pincode)", () => {
  const rows = G.parseJio({ items: [{ name: "X", price: { effective: { min: 10 }, marked: { min: 12 } }, sellable: true }] }, "x"); assert.equal(rows[0].confirmed, false); });
console.log(`\ngrocery-rank: ${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
