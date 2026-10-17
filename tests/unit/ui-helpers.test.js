// Unit tests for the pure UI helpers in extension/lib.js (trap editing, history ranges, notch amount).
const fs = require("fs"), path = require("path"), assert = require("assert"), L = require("../../extension/lib.js"), D = 864e5, NOW = Date.UTC(2026, 9, 17);
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log("  ok   " + n); } catch (e) { bad++; console.log("  FAIL " + n + "\n       " + e.message.split("\n")[0]); } };
t("trapStep scales with price", () => { assert.deepEqual([50, 99, 100, 499, 500, 1999, 2000, 9999, 10000, 49999, 50000, 120000].map(L.trapStep), [1, 1, 5, 5, 10, 10, 50, 50, 100, 100, 500, 500]); });
t("validateTrap accepts a sane lower price and rounds", () => { assert.deepEqual(L.validateTrap(699.6, 766), { ok: true, value: 700 }); assert.deepEqual(L.validateTrap("₹ 1,299", 2000), { ok: true, value: 1299 }); });
t("validateTrap rejects zero, negative, NaN, empty, too high, and >= current price", () => {
  for (const bad of [0, -5, "abc", "", NaN, Infinity, null, undefined, "-"]) assert.equal(L.validateTrap(bad, 766).ok, false, String(bad));
  assert.match(L.validateTrap(766, 766).msg, /below the current price/); assert.match(L.validateTrap(900, 766).msg, /below the current price/); assert.equal(L.validateTrap(1e7, 1e9).ok, false); });
t("sliceHistory carries the price in force at the window start", () => { const h = [[NOW - 100 * D, 500], [NOW - 40 * D, 400], [NOW - 5 * D, 450]];
  const s = L.sliceHistory(h, 30, NOW); assert.deepEqual(s, [[NOW - 30 * D, 400], [NOW - 5 * D, 450]]); assert.equal(L.sliceHistory(h, 365, NOW).length, 3); assert.equal(L.sliceHistory(h, 0, NOW).length, 3, "0 = all");
  assert.deepEqual(L.sliceHistory([[NOW - 5 * D, 450]], 30, NOW), [[NOW - 5 * D, 450]]); assert.deepEqual(L.sliceHistory([], 30, NOW), []); });
t("downsample keeps peaks and dips and respects the cap", () => { const h = Array.from({ length: 1000 }, (_, i) => [i * 1000, 100 + (i === 500 ? 900 : i === 700 ? -90 : i % 3)]); const d = L.downsample(h, 100);
  assert.ok(d.length <= 110 && d.length >= 50, "size " + d.length); assert.ok(d.some(p => p[1] === 1000), "peak kept"); assert.ok(d.some(p => p[1] === 10), "dip kept"); assert.ok(d.every((p, i) => i === 0 || p[0] >= d[i - 1][0]), "time sorted"); assert.equal(L.downsample(h.slice(0, 50), 100).length, 50); });
t("notchAmount formats Indian grouping and caps at crores", () => { assert.equal(L.notchAmount(-64), "₹64"); assert.equal(L.notchAmount(123456), "₹1,23,456"); assert.equal(L.notchAmount(12345678), "₹1Cr+"); assert.equal(L.notchAmount(0.4), "₹0"); });
t("cleanProduct yields exactly what the guard accepts", () => { const G = require("../../extension/guard.js");
  const raw = { key: "amazon.in:B0F8BVSK21", site: "Amazon", url: "https://www.amazon.in/dp/B0F8BVSK21", title: "  boAt\u0000 Airdopes \n 141  ", image: undefined, price: 766, mrp: 3990, src: "weird", extra: "x" };
  const p = L.cleanProduct(raw); assert.equal(p.image, null); assert.equal(p.src, "dom"); assert.equal(p.title, "boAt Airdopes 141"); assert.ok(!("extra" in p));
  assert.deepEqual(G.validateMessage({ type: "seen", p }, { id: "x" }, "x"), { ok: true });
  assert.equal(L.cleanProduct({ ...raw, mrp: 100 }).mrp, null, "mrp below price dropped"); assert.equal(L.cleanProduct({ ...raw, price: 0 }), null); assert.equal(L.cleanProduct({ ...raw, price: NaN }), null);
  assert.equal(L.cleanProduct({ ...raw, url: "http://insecure.example/x" }), null); assert.equal(L.cleanProduct({ ...raw, key: "" }), null); assert.equal(L.cleanProduct({ ...raw, title: "x".repeat(900) }).title.length, 500); assert.equal(L.cleanProduct(null), null); });
t("parseLd stays linear on hostile pages (was ReDoS-able) and still finds a real product", () => {
  const evil = '<script type="application/ld+json">' + "<script type=\"application/ld+json\" ".repeat(60000) , t0 = Date.now(); L.parseLd(evil); L.parseLd("<script ".repeat(300000)); L.parseLd("<script>".repeat(200000) + " ".repeat(500000));
  assert.ok(Date.now() - t0 < 1500, "took " + (Date.now() - t0) + "ms");
  assert.equal(L.parseLd('<html><script>var a=1</script><script type="application/ld+json">{"@type":"Product","name":"T","offers":{"price":"199","highPrice":"299"}}</script>').price, 199);
  assert.equal(L.parseLd('<script type="application/ld+json">{"@graph":[{"@type":["Thing","Product"],"name":"G","offers":[{"lowPrice":"5"}]}]}</script>').price, 5);
  assert.equal(L.parseLd("<script type='application/ld+json'>{bad json</script><script type=\"application/ld+json\">{\"@type\":\"Product\",\"offers\":{\"price\":\"7\"}}</script>").price, 7, "bad block skipped, next one used"); });
t("withStoredFlags: heart and trap mirror storage; a removed item is un-hearted; other fields untouched", () => { const it = { wish: true, target: 500, hist: [[1, 2]], title: "T" };
  assert.deepEqual(L.withStoredFlags(it, { k: { wish: false, target: 400 } }, "k"), { wish: false, target: 400, hist: [[1, 2]], title: "T" }); const gone = L.withStoredFlags(it, {}, "k"); assert.equal(gone.wish, false); assert.equal("target" in gone, false); assert.equal(gone.title, "T"); assert.equal(L.withStoredFlags(it, null, "k").wish, false); assert.equal(it.wish, true, "input not mutated"); });
t("liveUpdate: sign-in/sign-out (profile or authNotice change) asks the header avatar to refresh", () => { const f = ch => L.liveUpdate(ch, { tab: "product", range: "90D", typing: false }); assert.equal(f({ profile: {} }).who, true); assert.equal(f({ authNotice: {} }).who, true); assert.equal(f({ pin: {} }).who, undefined); });
t("liveUpdate: pin chip follows; range change redraws only the product tab; items only the traps tab; never while typing; own writes are no-ops", () => { const u = (ch, o) => L.liveUpdate(ch, Object.assign({ tab: "product", range: "90D", typing: false }, o));
  assert.equal(u({ pin: { newValue: "110001" } }).pin, "110001"); assert.equal(u({ pin: {} }).pin, ""); assert.equal(u({}).pin, undefined);
  assert.deepEqual(u({ range: { newValue: "1Y" } }), { redraw: true, range: "1Y" }); assert.equal(u({ range: { newValue: "1Y" } }, { tab: "grocery" }).redraw, false);
  assert.deepEqual(u({ range: { newValue: "90D" } }), { redraw: false }, "our own write"); assert.equal(u({ range: { newValue: "10Y" } }).range, undefined, "invalid ignored");
  assert.equal(u({ items: {} }, { tab: "traps" }).redraw, true); assert.equal(u({ items: {} }).redraw, false, "product tab ignores unrelated item updates"); assert.equal(u({ items: {} }, { flagsChanged: true }).redraw, true, "…but follows a heart/trap change"); assert.equal(u({ items: {} }, { tab: "grocery", flagsChanged: true }).redraw, false);
  assert.equal(u({ range: { newValue: "1Y" } }, { typing: true }).redraw, false); assert.equal(u({ items: {} }, { tab: "traps", typing: true }).redraw, false); });
t("grocery sort/filter helpers: relevance keeps rank order; price and unit-price sort; pack chips need 2+ items; filter by pack", () => {
  const A = [{ name: "a", price: 300, per: 3, pack: "1 kg" }, { name: "b", price: 100, per: null, pack: "500 g" }, { name: "c", price: 200, per: 1, pack: "1 kg" }, { name: "d", price: 50, per: 9, pack: "500 g" }, { name: "e", price: 10, per: 2, pack: "1 pc" }];
  assert.deepEqual(L.sortGrocery(A, "relevance").map(x => x.name), "abcde".split("")); assert.deepEqual(L.sortGrocery(A, "price").map(x => x.name), "edbca".split(""));
  assert.deepEqual(L.sortGrocery(A, "unit").map(x => x.name), ["c", "e", "a", "d", "b"], "unit price ascending, unknown unit price last"); assert.equal(A[0].name, "a", "does not mutate");
  assert.deepEqual(L.packChips(A), ["1 kg", "500 g"]); assert.deepEqual(L.packChips([{ pack: "1 pc" }, { pack: null }]), []);
  assert.deepEqual(L.filterPack(A, "500 g").map(x => x.name), ["b", "d"]); assert.equal(L.filterPack(A, null).length, 5); });
t("saved places: only valid {id,name,pin} survive, max 8, names cleaned; add/update/remove never mutate and report friendly errors", () => {
  const A = [{ id: "a1", name: "  Home  ", pin: "842001" }, { id: "a1", name: "dup id", pin: "110001" }, { id: "a2", name: "", pin: "560001" }, { id: "a3", name: "Bad pin", pin: "12" }, { id: "a4", name: "<b>Mom</b>\u0007's house", pin: "560001" }, null, "x", { id: "bad id!", name: "x", pin: "560001" }];
  const c = L.safePlaces(A); assert.deepEqual(c.map(p => [p.id, p.name, p.pin]), [["a1", "Home", "842001"], ["a4", "b Mom /b 's house", "560001"]]); assert.deepEqual(L.safePlaces("nope"), []); assert.equal(L.safePlaces(Array.from({ length: 20 }, (_, i) => ({ id: "i" + i, name: "n" + i, pin: "842001" }))).length, 8);
  assert.equal(L.safePlaces([{ id: "x", name: "a".repeat(100), pin: "842001" }])[0].name.length, 24);
  let r = L.addPlace([], "Home", "842001"); assert.equal(r.list.length, 1); assert.match(r.list[0].id, /^[\w-]{1,20}$/); assert.equal(L.addPlace(r.list, "home", "842001").error, "Already saved."); assert.ok(L.addPlace(r.list, "Home", "842001").error); assert.equal(L.addPlace(r.list, "  ", "842001").error, "Give this place a name."); assert.equal(L.addPlace(r.list, "X", "12").error, "Pincode must be 6 digits.");
  assert.equal(L.addPlace(Array.from({ length: 8 }, (_, i) => ({ id: "i" + i, name: "n" + i, pin: "842001" })), "Nine", "560001").error, "You can save up to 8 places."); assert.equal(r.list.length, 1, "input not mutated");
  const id = r.list[0].id, u = L.updatePlace(r.list, id, { name: "Mom's house", pin: "560001" }); assert.deepEqual([u.list[0].name, u.list[0].pin], ["Mom's house", "560001"]); assert.equal(L.updatePlace(r.list, id, { pin: "5" }).error, "Pincode must be 6 digits."); assert.equal(L.updatePlace(r.list, "nope", { name: "x" }).error, "Not found."); assert.equal(r.list[0].name, "Home");
  assert.deepEqual(L.removePlace(r.list, id), []); assert.equal(L.placeForPin(r.list, "842001").name, "Home"); assert.equal(L.placeForPin(r.list, "111111"), null); });
t("locConsistent: coordinates must belong to the pincode (stale coordinates after a pincode change are rejected)", () => {
  const blr = { lat: 12.9716, lon: 77.5946 }, mzf = { lat: 26.1197, lon: 85.391 };
  assert.equal(L.locConsistent({ ...blr, pin: "560001" }, blr), true); assert.equal(L.locConsistent({ lat: 13.0, lon: 77.6, pin: "560001" }, blr), true, "a few km off is fine (GPS inside the pincode)");
  assert.equal(L.locConsistent({ ...mzf, pin: "560001" }, blr), false, "stale coordinates from another city"); assert.equal(L.locConsistent({ pin: "560001" }, blr), true, "nothing to compare"); assert.equal(L.locConsistent({ ...blr }, null), true, "no centroid known: cannot judge");
  assert.ok(Math.abs(L.distKm({ lat: 28.6139, lon: 77.209 }, { lat: 19.076, lon: 72.8777 }) - 1148) < 15, "haversine sanity: Delhi-Mumbai is ~1148 km"); assert.ok(Math.abs(L.distKm({ lat: 60, lon: 0 }, { lat: 60, lon: 10 }) - 556) < 8, "10 degrees of longitude at 60N is ~556 km"); });
t("canRedraw: a late product lookup may repaint the Product tab only, and never under a typing user (it used to wipe Grocery input mid-typing)", () => {
  assert.equal(L.canRedraw({ open: true, tab: "product", typing: false }), true); assert.equal(L.canRedraw({ open: true, tab: "grocery", typing: false }), false, "grocery tab is not the product's to repaint");
  assert.equal(L.canRedraw({ open: true, tab: "traps", typing: false }), false); assert.equal(L.canRedraw({ open: true, tab: "product", typing: true }), false); assert.equal(L.canRedraw({ open: false, tab: "product", typing: false }), false); });
t("regression: the panel host is only appended when detached (re-appending dropped keyboard focus while typing)", () => { const c = fs.readFileSync(path.join(__dirname, "../../extension/content.js"), "utf8"), m = c.match(/^.*document\.body\.append\(host\).*$/gm);
  assert.equal(m.length, 1); assert.ok(/if \(!host\.isConnected\) document\.body\.append\(host\)/.test(m[0]), "append must be guarded by isConnected"); });
t("pinFieldState: clean when the field equals the saved pincode, dirty when it is a different valid one, bad when it is not 6 digits", () => {
  assert.equal(L.pinFieldState("842001", "842001"), "clean"); assert.equal(L.pinFieldState(" 842001 ", "842001"), "clean", "spaces ignored"); assert.equal(L.pinFieldState("842002", "842001"), "dirty");
  assert.equal(L.pinFieldState("8420", "842001"), "bad"); assert.equal(L.pinFieldState("", "842001"), "bad"); assert.equal(L.pinFieldState("84200a", "842001"), "bad"); assert.equal(L.pinFieldState("1234567", "842001"), "bad");
  assert.equal(L.pinFieldState("842001", ""), "dirty", "nothing saved yet: a valid pincode is a change to save"); assert.equal(L.pinFieldState("", ""), "bad"); });
console.log(`\nui-helpers: ${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
