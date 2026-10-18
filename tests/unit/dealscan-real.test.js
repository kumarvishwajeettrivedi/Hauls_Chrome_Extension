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
// thin history: no hard claim either way (needs 14+ days AND 8+ prices); the result says how many days it is based on
{ const pts = (n, step, price, from = 0) => Array.from({ length: n }, (_, i) => [now - (from + (n - 1 - i) * step) * DAY, price]);
  ok(A.honestDiscount(pts(4, 2.5, 800), 800, 1000, now) === null, "4 prices over ~8 days: no claim (was 'not a real discount')");
  ok(A.honestDiscount(pts(10, 1, 800), 800, 1000, now) === null, "10 prices but only 9 days: no claim");
  ok(A.honestDiscount(pts(7, 4, 800), 800, 1000, now) === null, "7 prices over 24 days: no claim");
  const edge = A.honestDiscount(pts(8, 2, 800), 800, 1000, now); ok(edge && edge.days === 14 && edge.n === 8 && edge.inflated, "8 prices over 14 days is enough, and carries its day count: " + JSON.stringify(edge));
  // 1000 held for months, then 800 for the last 20 days: the older price counts as 'usual' (window start carried in), so 20% off 1000 is real
  const lh = [[now - 132 * DAY, 1000], ...pts(8, 2.5, 800)], l = A.honestDiscount(lh, 800, 1000, now); ok(l && l.typical === 1000 && l.real === 20 && !l.inflated, "long-held older price is the usual price: " + JSON.stringify(l)); }
// discountNote: one line, same tone/verdict as the cards, always with its basis
{ const flat = []; for (let d = 40; d >= 0; d -= 2) flat.push([now - d * DAY, 1000]); const hd = A.honestDiscount(flat, 1000, 1250, now);
  ok(hd && hd.inflated && hd.real === 0 && hd.days === 40, "flat 40 days, MRP 1250: inflated, 40 days");
  ok(A.discountNote(hd, "fair", "okay") === "usually ₹1,000, not a real discount (based on 40 days)", "fair deal: hard claim with its basis: " + A.discountNote(hd, "fair", "okay"));
  ok(!/not a real discount/.test(A.discountNote(hd, "real", "buy")) && /based on 40 days/.test(A.discountNote(hd, "real", "buy")), "Real Deal: no 'not a real discount' next to it");
  ok(!/not a real discount/.test(A.discountNote(hd, "meh", "buy")), "a Buy verdict also softens it");
  ok(A.discountNote(hd, "unknown", "unknown") === null && A.discountNote(hd, undefined) === null && A.discountNote(null, "real") === null, "Early / not enough history / no data: say nothing");
  const good = A.honestDiscount(flat, 800, 1000, now); ok(A.discountNote(good, "real", "buy") === "20% below its usual price (based on 40 days)", "a real drop reads positive: " + A.discountNote(good, "real", "buy"));
  ok(A.discountNote(A.honestDiscount(flat, 950, 1000, now), "fair", "okay") === null, "a 5% MRP discount that is also 5% real: nothing to say");
  const mix = A.honestDiscount(flat, 900, 1300, now); ok(mix.inflated && mix.real === 10 && /really 10% below its usual ₹1,000/.test(A.discountNote(mix, "fair", "okay")), "partly real: " + A.discountNote(mix, "fair", "okay")); }
// verdict text follows its cause: never 'Above its usual' when the price is at or below the average
{ const m = [[now - 30 * DAY, 900], ...[27, 24, 20, 15, 10, 5, 2].map(d => [now - d * DAY, 1000])], a = A.buyWait(m, 1000, null, now), avg = a.deal.w.avg;
  ok(a.verdict === "wait" && a.deal.badge !== "higher" && 1000 <= avg * 1.05, "setup: waits although the price is near the average (" + Math.round(avg) + ")");
  ok(a.short === "Well above its lowest. Hold off." && !/usual/.test(a.short), "short text names the real cause: " + a.short);
  const lo = []; for (let d = 30; d >= 0; d -= 3) lo.push([now - d * DAY, 900]); const h = A.buyWait(lo, 1000, null, now);
  ok(h.verdict === "wait" && h.deal.badge === "higher" && h.short === "Above its usual. Hold off.", "genuinely above average keeps 'Above its usual': " + h.short); }
// the "how soon do you need it" tabs really change the advice
{ const mk = f => { const h = []; for (let d = 60; d >= 0; d--) h.push([now - d * DAY, f(d)]); return h; }, bw = (h, pr, z) => A.buyWait(h, pr, null, now, null, z);
  const mid = mk(d => d > 20 ? 1000 : d > 5 ? 900 : 960);
  ok(bw(mid, 940, "3d").verdict === "buy" && bw(mid, 940, "1w").verdict === "okay" && bw(mid, 940, "1m").verdict === "wait", "a fair price: fine in 2-3 days, fair for a week, wait if you have a month");
  const low = mk(d => d > 5 ? 1000 : 900); ok(bw(low, 900, "3d").verdict === "buy" && bw(low, 900, "1m").verdict === "buy" && bw(low, 900, "1m").short !== bw(low, 900, "3d").short, "at the low it stays Buy, but the advice for a month says waiting will not beat it");
  const hi = mk(d => d > 10 ? 1000 : 1200); ok(new Set(["3d", "1w", "1m"].map(z => bw(hi, 1200, z).short)).size === 3 && bw(hi, 1200, "1m").alertAt === 1030, "a high price: three different messages, and a month offers an alert price");
  ok(bw(low, 900, "1m").reasons.some(r => /cheaper|last 90 days/.test(r)), "the reasons say how often it was cheaper"); }
console.log(`dealscan-real: ${n} passed, 0 failed`);
