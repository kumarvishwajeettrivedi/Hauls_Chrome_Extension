// One headless run: the Grocery pincode field (edit -> sync icon -> saved), header chip always in sync, saved places, results header. No live store calls.
import { withExt, seed, store, sleep, poll } from "./lib/ext.mjs";
import { openPage } from "./lib/panel.mjs";
import { routeProduct } from "./lib/fixtures.mjs";
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? "PASS " : "FAIL ") + m); };
await withExt({ viewport: { width: 1280, height: 900 } }, async ({ ctx, sw, errs }) => {
  const { panel, p } = await openPage(ctx, await routeProduct(ctx, {})); await panel.waitKnob();
  await seed(sw, { pin: "842001", loc: { lat: 26.12, lon: 85.39, pin: "842001" }, places: [{ id: "h1", name: "Home", pin: "842001" }] });
  await sw.evaluate(() => Promise.all([cache.set("geo", "842002", { lat: 26.13, lon: 85.4 }, 1e10), cache.set("geo", "842001", { lat: 26.11, lon: 85.38 }, 1e10), cache.set("geo", "560001", { lat: 12.97, lon: 77.59 }, 1e10), cache.set("grocery", "chakla|842002", { items: rank([{ name: "Chakla Belan Set", price: 419, pack: "2 pcs", store: "Blinkit", inStock: true, url: "https://example.com/p" }], "chakla"), errors: [], unconfirmed: ["JioMart"] }, 3e5)]));
  await panel.open(); await panel.tab(1); await sleep(600);
  const icon = () => panel.run(".pgo", function () { return this.className + "|" + this.title; }, [], 0), chip = () => panel.text(".pinchip"), field = () => panel.val(".pi input", 0);
  ok((await icon()).startsWith("pgo clean|") && (await field()) === "842001" && (await chip()).trim() === "842001", "saved pincode: field + header chip agree, icon is the muted check: " + (await icon()));
  await panel.type(".pi input", "842002", { i: 0 }); await sleep(200);
  ok((await icon()).startsWith("pgo dirty|Use this pincode") && (await chip()).trim() === "842001" && (await store(sw, "pin")).pin === "842001", "edited: icon turns into the mint sync button, nothing saved yet, header still shows the saved pincode");
  await panel.type(".pi input", "8420", { i: 0 }); await sleep(200); ok((await icon()).startsWith("pgo bad|") && /6 digits/.test(await panel.text(".meta.bad")), "invalid: icon disabled with a hint");
  await panel.type(".pi input", "842002", { i: 0 }); await panel.type("main .pi input", "chakla", { i: 1 }); await panel.click(".pgo", 0); await poll(async () => (await panel.count("main .card")) > 0, 15000, 300); await sleep(300);
  const s1 = await store(sw, ["pin", "loc"]); ok(s1.pin === "842002" && s1.loc && s1.loc.lat === 26.13, "tapping the icon saves the pincode in the browser; coordinates are now the NEW pincode's, not the old ones: " + JSON.stringify(s1.loc)); ok((await chip()).trim() === "842002", "header chip updated at once: " + (await chip()).trim());
  ok(/Prices for 842002/.test(await panel.text("main .meta.strong")), "results are for the new pincode and the search ran by itself: " + (await panel.text("main .meta.strong")));
  await sw.evaluate(() => chrome.storage.local.set({ pin: "110001" })); await sleep(500);
  ok((await chip()).trim() === "110001" && (await field()) === "110001", "pincode changed elsewhere (Settings/sync): header chip AND field follow live: " + (await chip()).trim() + "/" + (await field()));
  await panel.type(".pi input", "842001", { i: 0 }); await p.keyboard.press("Enter"); await sleep(600);
  ok((await store(sw, "pin")).pin === "842001" && (await chip()).trim() === "842001", "Enter in the field also saves it");
  await seed(sw, { places: [{ id: "h1", name: "Home", pin: "842001" }, { id: "m1", name: "Mom's house", pin: "560001" }] }); await sleep(400); await panel.type(".pi input", "110001", { i: 0 }); await panel.click(".pgo", 0); await sleep(500);
  await panel.click(".places .plc .cp", 0); await sleep(500); const s2 = await store(sw, ["pin", "loc"]); ok(s2.pin === "842001" && (!s2.loc || s2.loc.lat === 26.11) && (await chip()).trim() === "842001" && (await field()) === "842001", "tapping a saved place switches everything to it (coordinates of that pincode): " + JSON.stringify(s2.loc));
  ok((await panel.count("main .card")) === 0, "no stale prices left under the new pincode");
  await panel.click(".places .cp-x", 1); await sleep(500); ok((await store(sw, "places")).places.length === 1, "x removes a place");
  await p.screenshot({ path: process.argv[2] || "/tmp/pin.png", clip: { x: 1280 - 460, y: 0, width: 460, height: 560 } });
  console.log("errors:", errs.length ? errs.join(" || ") : "none"); console.log(bad ? `${bad} FAILED` : "all passed");
});
