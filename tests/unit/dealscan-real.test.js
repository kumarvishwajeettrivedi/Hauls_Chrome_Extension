// Deal Scanner checked against REAL Amazon.in one-year price series (read by HAULS on 2026-10-17), not invented data.
const assert = require("assert"), fs = require("fs"), path = require("path"), A = require("../../extension/analysis.js");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const S = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/amazon-history/real-series-2026-10-17.json"), "utf8")).series, DAY = 864e5, now = Date.now(), by = k => S.find(s => s.key === k);
const scan = (s, price = s.price) => A.dealScan(s.points, price, s.mrp, now, s.ref);
// time-weighted median: how long a price held matters, not how many points it has
ok(A.twMedian([[0, 100], [9 * DAY, 50], [9.5 * DAY, 100]], 0, 10 * DAY) === 100, "a short dip (half a day) does not move the usual price");
ok(A.twMedian([[0, 100], [1 * DAY, 50], [9 * DAY, 100]], 0, 10 * DAY) === 50, "a dip that held 8 of 10 days IS the usual price");
ok(A.twMedian([[0, 200], [1 * DAY, 100]], 0, 20 * DAY) === 100 && A.twMedian([], 0, DAY) === null, "the price that held longest decides; empty is null");
// real products at their current price
let d = scan(by("B0D8QFDC67")); ok(d.tone === "real" && d.score >= 85 && /lowest/i.test(d.headline), "at its one-year low with a 75% 'MRP discount': a Real Deal near its lowest, not 'inflated': " + d.score + " " + d.headline);
d = scan(by("B0F26VX6W4")); ok(d.tone === "real" && d.score >= 85, "another product at its one-year low: " + d.score);
d = scan(by("B0FMDL81GS")); ok(d.tone === "fair" && d.score <= 74 && /usual price this year/i.test(d.headline), "20% above its yearly low and above the year's usual price: Fair, never Real: " + d.score + " " + d.headline);
// the same product at the highest price it ever had must not be a Real Deal
for (const s of S) { const top = Math.max(...s.points.map(p => p[1])); const x = scan(s, top); ok(x.tone !== "real", s.key + " at its yearly high (" + top + ") is not a Real Deal: " + x.score); }
// backtest: as of each past date, did a 'Real Deal' call hold up (waiting 45 days would not have saved more than 5%)?
let real = 0, held = 0; for (const s of S) { const P = s.points; for (let i = 5; i < P.length - 1; i++) { const t = P[i][0], price = P[i][1]; if (t - P[0][0] < 30 * DAY) continue; const r = A.dealScan(P.slice(0, i + 1), price, null, t, null); if (r.score == null || r.tone !== "real") continue; const fut = P.filter(p => p[0] > t && p[0] <= t + 45 * DAY).map(p => p[1]); if (!fut.length) continue; real++; if ((price - Math.min(...fut)) / price < 0.05) held++; } }
ok(real >= 3 && held / real >= 0.8, `backtest on real history: ${held} of ${real} 'Real Deal' calls held up (waiting 45 days would not have saved >5%)`);
// honest discount: "60% off" MRP vs what it really sold for
{ const h = []; for (let d = 60; d >= 0; d--) h.push([now - d * DAY, 1000]);
  const a = A.honestDiscount(h, 1000, 2500, now); ok(a && a.claimed === 60 && a.real === 0 && a.inflated && a.typical === 1000, "MRP 2500 but always 1000: claimed 60%, real 0%, flagged");
  const b = A.honestDiscount(h, 800, 1000, now); ok(b && b.claimed === 20 && b.real === 20 && !b.inflated, "a genuine drop is not flagged");
  ok(A.honestDiscount([[now - DAY, 1000]], 1000, 2500, now) === null, "too little history: no claim either way");
  ok(A.honestDiscount(h, 1000, null, now).claimed === 0, "no MRP: nothing claimed"); }
console.log(`dealscan-real: ${n} passed, 0 failed`);
