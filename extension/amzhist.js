// Amazon's own price-history chart (the Rufus "Price history" answer), read as data from its SVG markup. Pure; names prefixed ah*.
// The chart is a step line: horizontal <line> segments in #2162A1 between gridlines labelled with prices; x runs from the first date label to "today" (last label).
// We read ONLY what the page draws for the user: no endpoint is called. Anything that does not validate returns null (no chart, never a wrong chart).
const AH_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const ahAttr = (s, k) => { const m = new RegExp("(?:^|\\s)" + k + '="([^"]*)"').exec(s); return m ? m[1] : null; };
const ahPrice = s => { const m = /₹\s?([\d,]+(?:\.\d+)?)/.exec(s || ""); return m ? parseFloat(m[1].replace(/,/g, "")) : null; };
function ahDate(label, now) { // "18 Sept" / "02 Oct" -> the latest such date not after `now`
  const m = /^(\d{1,2})\s+([A-Za-z]{3,4})\.?$/.exec(String(label).trim()); if (!m || AH_MONTHS[m[2].toLowerCase()] === undefined) return null;
  const n = new Date(now); let t = Date.UTC(n.getUTCFullYear(), AH_MONTHS[m[2].toLowerCase()], +m[1]); if (new Date(t).getUTCMonth() !== AH_MONTHS[m[2].toLowerCase()]) return null; // 31 Feb
  if (t > now + 864e5) t = Date.UTC(n.getUTCFullYear() - 1, AH_MONTHS[m[2].toLowerCase()], +m[1]); return t;
}
function ahParseChart(markup, now = Date.now()) {
  const svg = String(markup || ""); if (svg.length < 200 || svg.length > 60000 || !/<svg\b/.test(svg)) return null;
  const texts = [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map(m => ({ x: parseFloat(ahAttr(m[1], "x")), y: parseFloat(ahAttr(m[1], "y")), a: ahAttr(m[1], "text-anchor") || "start", t: m[2].trim() })).filter(t => isFinite(t.x) && isFinite(t.y));
  const lines = [...svg.matchAll(/<line\b([^>]*)>/g)].map(m => ({ x1: parseFloat(ahAttr(m[1], "x1")), y1: parseFloat(ahAttr(m[1], "y1")), x2: parseFloat(ahAttr(m[1], "x2")), y2: parseFloat(ahAttr(m[1], "y2")), c: (ahAttr(m[1], "stroke") || "").toLowerCase(), w: parseFloat(ahAttr(m[1], "stroke-width")) }));
  // y axis: gridline labels "₹3,999" (right-aligned left of the plot)
  const yl = texts.filter(t => t.a === "end" && /^₹[\d,]+$/.test(t.t)).map(t => ({ y: t.y, p: ahPrice(t.t) })).filter(t => t.p).sort((a, b) => a.y - b.y); if (yl.length < 2) return null;
  const slope = (yl[yl.length - 1].p - yl[0].p) / (yl[yl.length - 1].y - yl[0].y), p0 = yl[0].p, y0 = yl[0].y, priceAt = y => p0 + (y - y0) * slope;
  if (!(slope < 0) || yl.some(l => Math.abs(priceAt(l.y) - l.p) > 1)) return null; // price must fall as y grows and every gridline must agree
  // x axis: date labels under the axis; the last one (anchor end) is "today"
  const axisY = Math.max(...yl.map(l => l.y)) + 5, xl = texts.filter(t => t.y > axisY && /^\d{1,2}\s+[A-Za-z]{3,4}\.?$|^[A-Za-z]{3}$/.test(t.t)).sort((a2, b2) => a2.x - b2.x); if (xl.length < 2) return null;
  const first = xl[0], last = xl[xl.length - 1], tEnd = now; let tStart = ahDate(first.t, now), windowMs;
  const fullDates = /^\d/.test(first.t);
  if (fullDates) { if (tStart === null) return null; windowMs = tEnd - tStart; } else windowMs = 365 * 864e5; // month-only labels (1Y view)
  if (!(windowMs > 5 * 864e5 && windowMs < 400 * 864e5)) return null;
  const xStart = first.x, xEnd = last.x, tAt = x => tEnd - (xEnd - x) / (xEnd - xStart) * windowMs;
  // the drawn series: horizontal segments in the chart blue
  const seg = lines.filter(l => l.c === "#2162a1" && l.w >= 1.5 && Math.abs(l.y1 - l.y2) < 0.01 && l.x2 > l.x1).sort((a, b) => a.x1 - b.x1); if (!seg.length) return null;
  const points = seg.map(l => [Math.round(tAt(l.x1)), Math.round(priceAt(l.y1))]); points.push([tEnd, points[points.length - 1][1]]);
  const lo = Math.min(...yl.map(l => l.p)), hi = Math.max(...yl.map(l => l.p)); if (points.some(p => p[1] < lo * 0.97 || p[1] > hi * 1.03)) return null;
  for (let i = 1; i < points.length; i++) if (points[i][0] < points[i - 1][0]) return null;
  const all = texts.map(t => t.t).join(" "), cur = /price\s*₹\s?([\d,]+)/i.exec(all), buy = /Buy for\s*₹\s?([\d,]+)/i.exec(all);
  const current = cur ? parseFloat(cur[1].replace(/,/g, "")) : null, offer = buy ? parseFloat(buy[1].replace(/,/g, "")) : null;
  if (current && Math.abs(current - points[points.length - 1][1]) > 1) return null; // the chart must end at the price it announces
  const aria = ahAttr(svg.slice(0, 1500), "aria-label") || "", hm = /highest price[^.]*?was\s*₹\s?([\d,]+)\s+on\s+(\d{1,2}\s+[A-Za-z]+)/i.exec(aria);
  const deals = [...aria.matchAll(/from (\d{1,2} [A-Za-z]+) to (\d{1,2} [A-Za-z]+)/g)].map(m => ({ from: m[1], to: m[2] })).slice(0, 12);
  const days = Math.round(windowMs / 864e5);
  return { range: days <= 45 ? "1M" : days <= 120 ? "3M" : "1Y", days, points, current, offer: offer && current && offer < current ? offer : null, highest: hm ? { price: parseFloat(hm[1].replace(/,/g, "")), on: hm[2] } : null, deals };
}
// Series from Amazon (older) + HAULS's own points (newer, authoritative where they overlap).
function ahMerge(own, amazon) {
  const a = (amazon || []).filter(p => Array.isArray(p) && p[0] > 0 && p[1] > 0), o = own || []; if (!a.length) return o;
  const firstOwn = o.length ? o[0][0] : Infinity;
  return [...a.filter(p => p[0] < firstOwn - 6 * 3600e3), ...o].sort((x, y) => x[0] - y[0]);
}
if (typeof module !== "undefined") module.exports = { ahParseChart, ahMerge, ahDate, ahPrice };
