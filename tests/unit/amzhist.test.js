// Amazon's price-history chart parsed from its real SVG (captured from a signed-in Amazon.in product page via Settings > Copy page report).
const assert = require("assert"), fs = require("fs"), path = require("path"), A = require("../../extension/amzhist.js");
const svg = fs.readFileSync(path.join(__dirname, "../fixtures/amazon-history/chart-1m.svg"), "utf8"), NOW = Date.UTC(2026, 9, 17, 12), D = 864e5;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const r = A.ahParseChart(svg, NOW);
ok(r && r.range === "1M" && r.days >= 29 && r.days <= 30, "range/window: " + JSON.stringify(r && [r.range, r.days]));
ok(r.points.length === 3 && r.points[0][1] === 5499 && r.points[1][1] === 4499 && r.points[2][1] === 4499, "step points (5,499 then 4,499): " + JSON.stringify(r.points));
ok(Math.abs(r.points[0][0] - Date.UTC(2026, 8, 18)) < 2 * D / 24, "first point is 18 Sept: " + new Date(r.points[0][0]).toISOString());
{ const d = new Date(r.points[1][0]); ok(d.getUTCMonth() === 9 && d.getUTCDate() >= 5 && d.getUTCDate() <= 7, "price drops on ~6 Oct (the page says the deal began 6 October): " + d.toISOString()); }
ok(r.points[2][0] === NOW, "series ends today");
ok(r.current === 4499 && r.offer === 4049, "current and 'Buy for' offer price: " + JSON.stringify([r.current, r.offer]));
ok(r.highest && r.highest.price === 5499 && /5 October/.test(r.highest.on), "highest price from the chart's own summary");
ok(r.deals.length >= 5 && r.deals.some(x => x.from === "6 October" && x.to === "17 October"), "deal periods: " + JSON.stringify(r.deals.slice(0, 2)));
// refuse anything that does not validate
ok(A.ahParseChart("", NOW) === null && A.ahParseChart("<svg></svg>", NOW) === null, "empty/garbage: null");
ok(A.ahParseChart(svg.replace("₹4,499</text><line", "₹4,999</text><line"), NOW) === null, "a gridline label that disagrees with its position: null");
ok(A.ahParseChart(svg.replace("price ₹4,499", "price ₹9,999"), NOW) === null, "chart that does not end at the price it announces: null");
ok(A.ahParseChart(svg.replace(/stroke="#2162A1"/g, 'stroke="#000000"'), NOW) === null, "no series lines: null");
ok(A.ahParseChart(svg.replace('>18 Sept<', '>31 Feb<'), NOW) === null, "unparseable start date: null");
ok(A.ahParseChart(svg.replace(/<line x1="216[^>]*>/, ""), NOW) === null || A.ahParseChart(svg.replace(/<line x1="216[^>]*>/, ""), NOW).points.length >= 2, "missing last segment does not invent a point");
// 1Y view: month-only x labels (SYNTHETIC fixture, built from the documented structure). The span comes from the labels, not from an assumption.
const y1 = fs.readFileSync(path.join(__dirname, "../fixtures/amazon-history/chart-1y.svg"), "utf8"), ry = A.ahParseChart(y1, NOW);
ok(ry && ry.range === "1Y" && ry.days === 365 && ry.points.length === 5 && ry.current === 4499 && ry.offer === 4049, "1Y fixture: " + JSON.stringify(ry && [ry.range, ry.days, ry.points.length]));
ok(Math.abs(ry.points[0][0] - (NOW - 365 * D)) < 1000 && ry.points[0][1] === 5499 && ry.points[2][1] === 5999 && ry.points.every((q, i) => i === 0 || q[0] > ry.points[i - 1][0]), "1Y points run from a year ago, in order: " + JSON.stringify(ry.points.map(q => q[1])));
{ const r11 = A.ahParseChart(y1.replace(/(x="312"[^>]*>)Oct</, "$1Sep<"), NOW); ok(r11 && r11.days === 335 && r11.range === "1Y", "labels Oct..Sep = 11 months: 335 days, not an assumed 365: " + JSON.stringify(r11 && [r11.range, r11.days])); }
ok(A.ahParseChart(y1.replace(">Jan<", ">Jul<"), NOW) === null, "labels that add up to more than a year: null");
ok(A.ahParseChart(y1.replace(/<text x="117"[^>]*>Jan<\/text>/, "").replace(/<text x="247"[^>]*>Jul<\/text>/, "").replace(/<text x="182"/, '<text x="70"'), NOW) === null, "month labels not spread like the months they name: null");
ok(A.ahParseChart(y1.replace(">Apr<", ">Abc<"), NOW) === null, "a 3-letter label that is not a month: null");
// a start label that resolves to a moment in the future (a few hours ahead) is last year's, not a 'negative window'
{ const rr = A.ahParseChart(svg, Date.UTC(2026, 8, 17, 20)); ok(rr && rr.range === "1Y" && rr.days === 365, "start label '18 Sept' on the evening of 17 Sept is 18 Sept last year: " + JSON.stringify(rr && [rr.range, rr.days])); }
// the guard knows the optional selected-tab field
{ const { validateMessage: v } = require("../../extension/guard.js"), base = { type: "ahist", key: "amazon.in:B0", range: "1M", days: 30, points: [[1.7e12, 100], [1.71e12, 99]], current: 99, offer: null, highest: null }, s0 = { id: "me", tab: { id: 1 } };
  ok(v(base, s0, "me").ok && v({ ...base, tab: "1Y" }, s0, "me").ok && v({ ...base, tab: "3M" }, s0, "me").ok, "ahist accepts no tab, 1M, 3M, 1Y");
  ok(!v({ ...base, tab: "5Y" }, s0, "me").ok && !v({ ...base, tab: 1 }, s0, "me").ok && !v({ ...base, tab: "1y" }, s0, "me").ok, "ahist rejects any other tab value"); }
// merge
const own = [[NOW - 3 * D, 4499], [NOW - D, 4499]], m = A.ahMerge(own, r.points);
ok(m.length === 4 && m[0][1] === 5499 && m[m.length - 1][1] === 4499 && m.every((p, i) => i === 0 || p[0] >= m[i - 1][0]), "amazon points first, own points after, sorted: " + JSON.stringify(m.map(p => p[1])));
ok(A.ahMerge([], r.points).length === 3 && A.ahMerge(own, []).length === 2 && A.ahMerge(null, null).length === 0, "empty sides");
console.log(`amzhist: ${n} passed, 0 failed`);
