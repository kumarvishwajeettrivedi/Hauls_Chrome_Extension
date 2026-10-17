// S5: settings sync (per-key last-write-wins), against an in-memory chrome.storage and a fake server. No browser.
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const src = f => fs.readFileSync(path.join(__dirname, "../../extension", f), "utf8");
function env(initial = {}, { signedIn = true, server = { doc: {}, stamps: {} } } = {}) {
  const store = JSON.parse(JSON.stringify(initial)), calls = [];
  const st = { async get(k) { const ks = k == null ? Object.keys(store) : [].concat(k), o = {}; ks.forEach(x => { if (x in store) o[x] = JSON.parse(JSON.stringify(store[x])); }); return o; },
    async set(o) { Object.entries(o).forEach(([k, v]) => { store[k] = JSON.parse(JSON.stringify(v)); }); }, async remove(k) { [].concat(k).forEach(x => delete store[x]); } };
  const ctx = vm.createContext({ chrome: { storage: { local: st } }, Date, JSON, Math, Array, Object, Promise, Number, console,
    getSession: async () => signedIn ? { user: { id: "u" } } : null, storeGet: async k => (await st.get(k))[k], api: async (p, o) => { calls.push({ p, body: o.body }); return typeof server === "function" ? server(o.body) : server; } });
  vm.runInContext(src("lib.js"), ctx); vm.runInContext(src("sync.js"), ctx); return { store, calls, run: c => vm.runInContext(c, ctx) };
}
let ok = 0, bad = 0, q = []; const t = (n, f) => q.push([n, f]);
t("push sends only stamped, valid local values (unstamped / invalid / unknown never leave the device)", () => { const e = env();
  const r = e.run('settingsToPush({ pin: "560001", range: "10Y", knobY: 40, junk: 1 }, { pin: 5, range: 6, knobY: 7 })'); assert.deepEqual(r.doc, { pin: "560001" }); assert.deepEqual(r.stamps, { pin: 5 });
  assert.deepEqual(e.run('settingsToPush({ pin: "560001", range: "90D" }, {})').doc, {}, "never edited on this device = nothing to push"); });
t("apply takes only STRICTLY newer, valid server values", () => { const e = env();
  const r = e.run('settingsFromServer({ pin: 5, range: 9 }, { doc: { pin: "110001", range: "1Y" }, stamps: { pin: 6, range: 9 } })'); assert.deepEqual(r.values, { pin: "110001" }); assert.deepEqual(r.stamps, { pin: 6 });
  assert.deepEqual(e.run('settingsFromServer({}, { doc: { pin: "12", range: "bad", x: 1 }, stamps: { pin: 9, range: 9, x: 9 } })').values, {}, "invalid server values are ignored"); assert.deepEqual(e.run('settingsFromServer({}, null)').values, {}); });
t("a newer remote pin is applied locally and drops the stale coordinates", async () => { const e = env({ pin: "560001", setStamps: { pin: 5 }, loc: { lat: 1, lon: 2 } }, { server: { doc: { pin: "110001" }, stamps: { pin: 50 } } });
  assert.equal(await e.run("syncSettings()"), true); assert.equal(e.store.pin, "110001"); assert.equal(e.store.setStamps.pin, 50); assert.equal("loc" in e.store, false); });
t("a newer LOCAL edit is pushed and the stale server value is not applied", async () => { const e = env({ range: "1Y", setStamps: { range: 99 } }, { server: { doc: { range: "1Y" }, stamps: { range: 99 } } });
  assert.equal(await e.run("syncSettings()"), false); assert.deepEqual(e.calls[0].body, { p_doc: { range: "1Y" }, p_stamps: { range: 99 } }); assert.equal(e.store.range, "1Y"); });
t("two devices changing DIFFERENT settings both survive", async () => { const e = env({ pin: "560001", range: "30D", setStamps: { pin: 10, range: 10 } }, { server: { doc: { pin: "560001", range: "1Y" }, stamps: { pin: 10, range: 20 } } });
  await e.run("syncSettings()"); assert.equal(e.store.pin, "560001"); assert.equal(e.store.range, "1Y"); });
t("signed out: no network, nothing changes", async () => { const e = env({ pin: "560001", setStamps: { pin: 1 } }, { signedIn: false }); assert.equal(await e.run("syncSettings()"), false); assert.equal(e.calls.length, 0); });
t("a failing server leaves local settings untouched (rejects, caller swallows)", async () => { const e = env({ pin: "560001", setStamps: { pin: 1 } }, { server: () => { throw new Error("down"); } }); await assert.rejects(e.run("syncSettings()")); assert.equal(e.store.pin, "560001"); });
t("stampSettings stamps only the named keys and keeps others", async () => { const e = env({ setStamps: { range: 3 } }); await e.run('stampSettings(["pin"])'); assert.equal(e.store.setStamps.range, 3); assert.ok(e.store.setStamps.pin > 1e12); });
t("device-only state is never synced", () => { const e = env(); assert.deepEqual(e.run("Object.keys(SYNCED_SETTINGS)").sort(), ["pin", "places", "range"]); });
t("background wires the stamper without an echo loop; sign-out drops the stamps", () => { const bg = src("background.js"), au = src("auth.js");
  assert.ok(/onChanged\.addListener\(\(ch, area\) => \{ if \(area !== "local" \|\| ch\.setStamps\) return;/.test(bg)); assert.ok(/USER_SCOPED_KEYS = \[[^\]]*"setStamps"/.test(au)); });
t("saved places sync like any setting: pushed when edited, applied when newer, invalid lists never leave or enter", async () => {
  const good = [{ id: "p1", name: "Home", pin: "842001" }, { id: "p2", name: "Mom's house", pin: "560001" }];
  let e = env({ places: good, setStamps: { places: 5 } }); assert.deepEqual(e.run('settingsToPush({ places: ' + JSON.stringify(good) + ' }, { places: 5 })').doc.places, good);
  assert.deepEqual(e.run('settingsToPush({ places: [{ id: "p1", name: "", pin: "842001" }] }, { places: 5 })').doc, {}, "a list with a bad entry is not pushed");
  assert.deepEqual(e.run('settingsToPush({ places: ' + JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: "i" + i, name: "n", pin: "842001" }))) + ' }, { places: 5 })').doc, {}, "9 places is not pushed");
  e = env({ places: [good[0]], setStamps: { places: 5 } }, { server: { doc: { places: good }, stamps: { places: 50 } } }); assert.equal(await e.run("syncSettings()"), true); assert.equal(e.store.places.length, 2); assert.equal(e.store.setStamps.places, 50);
  e = env({ places: good, setStamps: { places: 5 } }, { server: { doc: { places: [{ id: "x", name: "x", pin: "12" }] }, stamps: { places: 50 } } }); await e.run("syncSettings()"); assert.equal(e.store.places.length, 2, "an invalid server list is ignored"); });
(async () => { for (const [n, f] of q) { try { await f(); ok++; console.log("  ok   " + n); } catch (e) { bad++; console.log("  FAIL " + n + "\n       " + String(e.message).split("\n")[0]); } } console.log(`\nsettings: ${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0); })();
