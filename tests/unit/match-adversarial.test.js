// Ratchet over tests/fixtures/compare/adversarial.json: 114 look-alike pairs (89 "none" = different product, 25 "match" = same). origin "real" = titles from the owner's 1.21.0 report; everything else is synthetic.
// A wrong "exact" is never allowed; wrong rows and found rows may only improve (constants below only move toward 1 / 25).
const assert = require("assert"), M = require("../../extension/match.js"), P = require("../fixtures/compare/adversarial.json");
const FP_MAX = 1, FOUND_MIN = 23; // before the identity fix (1.21.0): 18 wrong (14 exact), 22 found. The one allowed wrong row is Ultraboost Light vs Ultraboost 22, now only Likely
let fp = 0, fpExact = 0, found = 0; const kinds = {};
for (const p of P) { const v = M.mtCompare(M.mtFacts(p.src, p.brand), { title: p.cand }).verdict, k = kinds[p.kind] = kinds[p.kind] || { fp: 0, found: 0 };
  if (p.expect === "none" && v) { fp++; k.fp++; if (v === "exact") fpExact++; console.log("FP", v, p.note, "::", p.cand); }
  if (p.expect === "match" && v) { found++; k.found++; } }
console.log("per kind (wrong / found):", Object.entries(kinds).map(([k, x]) => `${k} ${x.fp}/${x.found}`).join(", "));
assert.equal(fpExact, 0, `${fpExact} different product(s) shown as exact`);
assert.ok(fp <= FP_MAX, `${fp} wrong rows > ${FP_MAX}`);
assert.ok(found >= FOUND_MIN, `${found}/25 found < ${FOUND_MIN}`);
console.log(`adversarial: ${P.length} pairs, ${fp} wrong (${fpExact} exact), ${found}/25 true matches found, ${P.length - fp - (25 - found)} passed`);
