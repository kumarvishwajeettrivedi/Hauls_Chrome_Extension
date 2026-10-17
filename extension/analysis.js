// Decision engine (pure). Language rules from the HAULS plan: observed-data framing, never "fake", always show sample size.
const DAY = 864e5;
const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");

// Time-weighted average so frequent visits don't over-weight a price (prices hold until the next observation).
function windowStats(hist, now = Date.now(), days = 90) {
  const from = now - days * DAY, pts = hist.filter(h => h[0] >= from);
  if (!pts.length) return null;
  let sum = 0, span = 0;
  pts.forEach((h, i) => { const end = i + 1 < pts.length ? pts[i + 1][0] : now, w = Math.max(end - h[0], 1); sum += h[1] * w; span += w; });
  const ps = pts.map(h => h[1]);
  return { avg: sum / span, min: Math.min(...ps), max: Math.max(...ps), minAt: pts[ps.indexOf(Math.min(...ps))][0], n: pts.length, days: Math.max(1, Math.round((now - pts[0][0]) / DAY)) };
}

function coverage(w) { // how much history backs a claim
  if (!w || w.n < 3 || w.days < 7) return "insufficient";
  return w.days >= 45 && w.n >= 8 ? "high" : "medium";
}

function dealStrength(hist, price, mrp, now = Date.now()) {
  const w = windowStats(hist, now), cov = coverage(w);
  if (cov === "insufficient") return { badge: "unknown", label: "Not enough history yet", coverage: cov, w };
  const adv = mrp && mrp > price ? (mrp - price) / mrp : 0, vsAvg = (price - w.avg) / w.avg;
  let badge = "normal";
  if (vsAvg <= -0.1) badge = "strong";
  else if (vsAvg >= 0.05) badge = "higher";
  else if (adv >= 0.25 && vsAvg > -0.03) badge = "weak";
  const label = { strong: "Strong deal", normal: "Normal price", weak: "Weak discount", higher: "Higher than recent norm" }[badge];
  return { badge, label, coverage: cov, vsAvg, adv, w };
}

function buyWait(hist, price, mrp, now = Date.now()) {
  const d = dealStrength(hist, price, mrp, now), w = d.w;
  if (d.badge === "unknown") return { verdict: "unknown", title: "Too early to call", short: "Too early to call.", reasons: [`Only ${w ? w.n : 0} observation${w && w.n === 1 ? "" : "s"} so far. HAULS-style advice needs more history, so revisit or track this item.`], deal: d };
  const pct = Math.abs(Math.round(d.vsAvg * 100)), reasons = [];
  reasons.push(d.vsAvg > 0.005 ? `${inr(price)} is ${pct}% above the ${w.days}-day average of ${inr(w.avg)}.` : d.vsAvg < -0.005 ? `${inr(price)} is ${pct}% below the ${w.days}-day average of ${inr(w.avg)}.` : `${inr(price)} matches the ${w.days}-day average of ${inr(w.avg)}.`);
  reasons.push(`Lowest observed: ${inr(w.min)} on ${new Date(w.minAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.`);
  const near = price <= w.min * 1.02;
  let verdict = near || d.badge === "strong" ? "buy" : d.badge === "higher" || price > w.min * 1.08 ? "wait" : "okay";
  if (d.adv >= 0.25 && d.badge === "weak") reasons.push(`The advertised ${Math.round(d.adv * 100)}% off is measured against the listed MRP, not recent observed prices.`);
  if (verdict === "wait" && price > w.min) reasons.push(`It was ${inr(price - w.min)} cheaper at its lowest.`);
  reasons.push(`Based on ${w.n} observations over ${w.days} days (${d.coverage} coverage). Observed by this extension, not seller-verified.`);
  return { verdict, title: { buy: "Good time to buy", wait: "Wait if you can", okay: "Fair price" }[verdict], short: { buy: near ? "Near its lowest. Grab it." : "Well below usual. Grab it.", wait: "Above its usual. Hold off.", okay: "Fair price right now." }[verdict], reasons, deal: d };
}

// Observations only: we never claim a scarcity message is untrue.
function urgencySignals(text) {
  const t = String(text || "").slice(0, 20000), out = [];
  let m;
  if ((m = t.match(/only\s+(\d+)\s+(?:left|remaining|in stock)/i))) out.push(`"Only ${m[1]} left" appears on this page`);
  if ((m = t.match(/(\d+)\+?\s+(?:people|others|customers|shoppers)\s+(?:are\s+)?(?:currently\s+)?(?:viewing|watching|looking)/i))) out.push(`"${m[1]} people viewing" appears on this page`);
  if (/\b\d{1,2}:\d{2}:\d{2}\b/.test(t) && /(ends in|deal ends|offer ends|time left|hurry)/i.test(t)) out.push("A countdown timer appears on this page");
  else if (/(hurry|limited[- ]time|deal of the day|lightning deal|selling fast|almost gone|few left)/i.test(t)) out.push("Limited-time wording appears on this page");
  return out;
}

const priceConfidence = (source, price, mrp) =>
  !price ? { level: "none", note: "Price could not be reliably determined." }
    : source === "jsonld" ? { level: "high", note: "Read from the page's structured product data." }
    : source === "dom" ? { level: mrp && mrp < price ? "low" : "medium", note: mrp && mrp < price ? "Price from page layout; it disagrees with the MRP, so double-check." : "Price detected from the page layout." }
    : { level: "low", note: "Price inferred from page metadata." };

// Free tier meters server-costly things only (plan section 5): distinct products looked up per month + tracked items.
const LIMITS = { free: { lookups: 50, tracked: 20 }, pro: { lookups: 500, tracked: 200 }, max: { lookups: Infinity, tracked: Infinity } };
const monthKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
function useLookup(usage, key, plan = "free", now = new Date()) {
  const u = usage && usage.month === monthKey(now) ? { month: usage.month, keys: [...usage.keys] } : { month: monthKey(now), keys: [] };
  if (u.keys.includes(key)) return { usage: u, allowed: true, used: u.keys.length, limit: LIMITS[plan].lookups };
  if (u.keys.length >= LIMITS[plan].lookups) return { usage: u, allowed: false, used: u.keys.length, limit: LIMITS[plan].lookups };
  u.keys.push(key); return { usage: u, allowed: true, used: u.keys.length, limit: LIMITS[plan].lookups };
}

// Latest price movement: current price vs the most recent *different* observed price.
function lastChange(hist) {
  const n = hist.length; if (n < 2) return null; const cur = hist[n - 1][1];
  for (let i = n - 2; i >= 0; i--) if (hist[i][1] !== cur) return { delta: cur - hist[i][1], pct: (cur - hist[i][1]) / hist[i][1], from: hist[i][1], at: hist[i][0] };
  return null;
}
if (typeof module !== "undefined") module.exports = { lastChange, windowStats, dealStrength, buyWait, urgencySignals, priceConfidence, useLookup, LIMITS, inr, DAY };
