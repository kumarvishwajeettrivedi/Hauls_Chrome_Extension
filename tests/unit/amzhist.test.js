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
// merge
const own = [[NOW - 3 * D, 4499], [NOW - D, 4499]], m = A.ahMerge(own, r.points);
ok(m.length === 4 && m[0][1] === 5499 && m[m.length - 1][1] === 4499 && m.every((p, i) => i === 0 || p[0] >= m[i - 1][0]), "amazon points first, own points after, sorted: " + JSON.stringify(m.map(p => p[1])));
ok(A.ahMerge([], r.points).length === 3 && A.ahMerge(own, []).length === 2 && A.ahMerge(null, null).length === 0, "empty sides");
console.log(`amzhist: ${n} passed, 0 failed`);
