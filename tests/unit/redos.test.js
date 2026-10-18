// parsePack and the match.js normalisers take page / store-API text: a 200k hostile string must cost milliseconds, not minutes (they used to backtrack quadratically).
const assert = require("assert"), { parsePack } = require("../../extension/lib.js"), M = require("../../extension/match.js");
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const hostile = { digits: "1".repeat(200000), "digit-space": "1 ".repeat(100000), "digit-dot": "1.".repeat(100000), "alnum": "a1".repeat(100000), "spaces": "1" + " ".repeat(200000), "x-run": "2x".repeat(100000), "plus": "a+".repeat(100000) };
for (const [name, s] of Object.entries(hostile)) for (const [fn, f] of [["parsePack", parsePack], ["mtNorm", M.mtNorm], ["mtWords", M.mtWords], ["mtFacts", t => M.mtFacts(t, "boat")]]) {
  f("warm 1 kg"); const t0 = process.hrtime.bigint(); f(s); const ms = Number(process.hrtime.bigint() - t0) / 1e6; ok(ms < 50, `${fn}(${name}, 200k) took ${ms.toFixed(1)} ms`);
}
// normal answers are unchanged, including a real pack size after a long run of junk (the first 300/400 chars are what counts)
assert.deepStrictEqual(parsePack("2 x 500 ml"), { amt: 1000, unit: "ml" }); assert.deepStrictEqual(parsePack("Atta 5 kg"), { amt: 5000, unit: "g" }); assert.deepStrictEqual(parsePack("Tea 1.5 ltr"), { amt: 1500, unit: "ml" }); assert.deepStrictEqual(parsePack("Rice 12 x 1 kg"), { amt: 12000, unit: "g" }); assert.strictEqual(parsePack("iPhone 128 GB 5G"), null); n += 4;
assert.strictEqual(parsePack("x".repeat(400) + " 1 kg"), null); n++;
assert.strictEqual(M.mtNorm("Samsung Galaxy S24 8 GB 6.7 inch 1.5 ltr 2 kg"), "samsung galaxy s24 8gb 6.7inch 1500ml 2000g"); assert.deepStrictEqual(M.mtWords("Pack of 3 Dettol 250 ml"), ["pack3", "dettol", "250ml"]); n += 2;
const f = M.mtFacts("Apple iPhone 16 Pro 256 GB Black", "Apple"); assert.ok(f.storage.has("256gb") && f.variants.has("pro")); n++;
console.log(`redos: ${n} passed, 0 failed`);
