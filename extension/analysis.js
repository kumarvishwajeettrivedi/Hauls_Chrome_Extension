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
  const pump = pumpCheck(hist, price, now); if (pump) reasons.unshift(`The price was lifted to ${inr(pump.peak)} recently and then brought back to about its older level, so this drop is less of a bargain than it looks.`);
  let verdict = pump ? "wait" : near || d.badge === "strong" ? "buy" : d.badge === "higher" || price > w.min * 1.08 ? "wait" : "okay";
  if (d.adv >= 0.25 && d.badge === "weak") reasons.push(`The advertised ${Math.round(d.adv * 100)}% off is measured against the listed MRP, not recent observed prices.`);
  if (verdict === "wait" && price > w.min) reasons.push(`It was ${inr(price - w.min)} cheaper at its lowest.`);
  reasons.push(`Based on ${w.n} observations over ${w.days} days (${d.coverage} coverage). Observed by this extension, not seller-verified.`);
  return { verdict, title: { buy: "Good time to buy", wait: "Wait if you can", okay: "Fair price" }[verdict], short: { buy: near ? "Near its lowest. Grab it." : "Well below usual. Grab it.", wait: pump ? "Price was pumped before this drop." : "Above its usual. Hold off.", okay: "Fair price right now." }[verdict], reasons, deal: d };
}

// Amazon's own price-history answer, as the user sees it: "Over the past 30 days, the price of X has ranged from ₹499 to ₹579. The current price is ₹499, the lowest in the past 30 days."
// Text only; we never call Amazon's endpoint. Returns {days, low, high, now} or null.
function parseAmazonHistoryText(text) {
  const t = String(text || "").replace(/\s+/g, " ").slice(0, 2000);
  const m = t.match(/(?:over|in|during) the (?:past|last) (\d+|year|month)\s*(days?|months?|years?)?,?\s*the price of (.{3,200}?) has ranged from ₹\s?([\d,]+(?:\.\d+)?) to ₹\s?([\d,]+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? +m[1] : 1, unit = (m[2] || m[1]).toLowerCase(), days = n * (unit.startsWith("year") ? 365 : unit.startsWith("month") ? 30 : 1);
  const low = parseFloat(m[4].replace(/,/g, "")), high = parseFloat(m[5].replace(/,/g, "")), cur = t.match(/current price is ₹\s?([\d,]+(?:\.\d+)?)/i), now = cur ? parseFloat(cur[1].replace(/,/g, "")) : null;
  if (!(days >= 7 && days <= 400) || !(low > 0) || !(high >= low) || high > low * 20) return null;
  return { days, low, high, now, title: m[3].trim() };
}
// Provenance: the sentence must be about THIS product (title words overlap), quote the same current price the page shows, and not sit inside user-written areas.
const HISTORY_UNTRUSTED = '[data-hook="review"], [data-hook="review-collection-footer"], #reviewsMedley, #cr-medley, #customer_review_foreign, #aplus, #productDescription, #feature-bullets, #ask-btf-container, #ask_lazy_load_div, .askTeaserQuestions, #important-information, [id^="question"], [id^="answer"]';
function historyTextTrusted(parsed, product) {
  if (!parsed || !product || !(parsed.now > 0) || Math.abs(parsed.now - product.price) > 1) return false;
  const w = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(x => x.length > 2), a = w(parsed.title).slice(0, 8), b = new Set(w(product.title));
  return a.length >= 2 && a.filter(x => b.has(x)).length >= Math.ceil(a.length / 2);
}
// A reference is only trusted when it agrees with the price on the page (within 40% either side) and is under two weeks old.
const refUsable = (ref, price, now = Date.now()) => !!(ref && ref.low > 0 && ref.high >= ref.low && now - ref.at < 14 * DAY && price >= ref.low * 0.6 && price <= ref.high * 1.4);

// Alert rule (pure). Fires once when the price is at/below the target after having been above it (or after the target was set below the price).
// armed: false while the target was set at/above the current price, so setting a target never alerts instantly; it re-arms once the price is above target.
function alertDecision(it, price) {
  if (!it || !(it.target > 0) || !(price > 0)) return { fire: false, patch: {} };
  if (price > it.target) return { fire: false, patch: it.armed === true && it.notified == null ? {} : { armed: true, notified: null } };
  const fire = it.armed !== false && it.notified !== price && (it.notified == null || price < it.notified);
  return { fire, patch: fire ? { notified: price } : {} };
}

// Deal Scanner: a 0-100 score from observed prices only. Rows carry earned/max points so the card can show exactly why.
const median = a => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
// A pump = the price was lifted 15%+ above its older baseline in the last 45 days and is now "discounted" back to that baseline.
function pumpCheck(hist, price, now = Date.now()) {
  const recent = hist.filter(h => h[0] >= now - 45 * DAY && h[0] < now - DAY), older = hist.filter(h => h[0] < (recent[0] ? recent[0][0] : now - 45 * DAY) && h[0] >= now - 150 * DAY);
  if (!recent.length || older.length < 2) return null;
  const base = median(older.map(h => h[1])), peak = recent.reduce((a, h) => (h[1] > a[1] ? h : a), recent[0]);
  return peak[1] >= base * 1.15 && price <= base * 1.03 ? { base, peak: peak[1], at: peak[0] } : null;
}
function dealScan(hist, price, mrp, now = Date.now(), ref = null) {
  const w = windowStats(hist, now), cov = coverage(w);
  if (cov === "insufficient" && refUsable(ref, price, now)) { // too little of our own history: use what Amazon itself reported, capped because it is a range, not a series
    const spread = Math.max(ref.high - ref.low, 1), pos = Math.min(1, Math.max(0, (price - ref.low) / spread)), pts = Math.round(70 * (1 - pos)), score = Math.min(85, pts + (ref.high > ref.low ? 15 : 0)), tone = score >= 75 ? "real" : score >= 50 ? "fair" : score >= 30 ? "meh" : "mirage";
    return { score, label: { real: "Real Deal", fair: "Fair Deal", meh: "Think Twice", mirage: "Deal Mirage" }[tone], tone, source: "amazon", headline: price <= ref.low * 1.01 ? `At Amazon's ${ref.days}-day low` : pos > 0.8 ? `Near Amazon's ${ref.days}-day high` : `Inside Amazon's ${ref.days}-day range`, rows: [{ label: `Place in Amazon's ${ref.days}-day range`, value: `${inr(ref.low)} to ${inr(ref.high)}`, max: 70, pts }, { label: "Range reported by Amazon", value: ref.days + " days", max: 30, pts: score - pts }], coverage: "amazon" };
  }
  if (cov === "insufficient") return { score: null, label: "Not enough history", tone: "unknown", headline: "Keep browsing, the scanner needs a few more days of prices.", rows: [] };
  const med = median(hist.filter(h => h[0] >= now - 90 * DAY).map(h => h[1])), pump = pumpCheck(hist, price, now), adv = mrp && mrp > price ? (mrp - price) / mrp : 0;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const vsMed = clamp((med - price) / med, -0.2, 0.2), fromLow = w.min ? clamp((price - w.min) / w.min, 0, 0.3) : 0;
  const rows = [
    { label: "Price vs 90-day typical", value: inr(med), max: 30, pts: Math.round(30 * (vsMed + 0.2) / 0.4) },
    { label: "Distance from lowest", value: inr(w.min), max: 25, pts: Math.round(25 * (1 - fromLow / 0.3)) },
    pump ? { label: "Price pump detected", value: inr(pump.peak), max: 20, pts: 0, bad: true } : { label: "No price pump seen", value: "", max: 20, pts: 20 },
    adv >= 0.25 && price >= med * 0.95 ? { label: "MRP discount looks inflated", value: Math.round(adv * 100) + "% off MRP", max: 15, pts: 0, bad: true } : { label: "Discount vs MRP", value: adv ? Math.round(adv * 100) + "% off" : "", max: 15, pts: adv ? 15 : 8 },
    { label: "Data behind this", value: `${w.n} prices, ${w.days} days`, max: 10, pts: cov === "high" ? 10 : 5 },
  ];
  const raw = clamp(rows.reduce((a, r) => a + r.pts, 0), 0, 100), score = pump ? Math.min(raw, 20) : raw, tone = score >= 75 ? "real" : score >= 50 ? "fair" : score >= 30 ? "meh" : "mirage";
  const label = { real: "Real Deal", fair: "Fair Deal", meh: "Think Twice", mirage: "Deal Mirage" }[tone];
  const headline = pump ? "Price pump detected" : adv >= 0.25 && price >= med * 0.95 ? "Discount looks inflated" : price <= w.min * 1.02 ? "Near its lowest" : vsMed > 0.05 ? "Below its usual price" : vsMed < -0.05 ? "Above its usual price" : "Priced as usual";
  return { score, label, tone, headline, rows, pump, coverage: cov };
}

// Seller intelligence (pure). Input comes from the page: {name, ships, href, text}. We describe what the page says, never judge honesty.
function sellerInfo(raw, title = "") {
  if (!raw || typeof raw !== "object") return null;
  const clean = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  let name = clean(raw.name, 80), ships = clean(raw.ships, 60); const href = String(raw.href || ""), text = clean(raw.text, 200);
  if (!name && text) { const m = text.match(/sold by\s+(.+?)(?:\s+and\s+fulfilled|\.|$)/i); if (m) name = clean(m[1], 80); }
  if (!name) return null;
  const firstParty = /^(amazon(\.in)?|amazon retail( india)?|appario retail|cloudtail( india)?)(\s*(pvt|private)?\.?\s*(ltd|limited)?\.?)?$/i.test(name) && !/third/i.test(text);
  const fba = /amazon/i.test(ships) || /fulfilled by amazon/i.test(text) || /isAmazonFulfilled=1/.test(href);
  const brand = clean(title, 80).split(/\s+/)[0].toLowerCase(), brandStore = !firstParty && brand.length >= 3 && name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand.replace(/[^a-z0-9]/g, "")) ;
  const kind = firstParty ? "Amazon" : brandStore ? "Brand store" : "3rd-party";
  const sid = (href.match(/[?&]seller=([A-Z0-9]{8,16})/) || [])[1] || null;
  const notes = [];
  notes.push(firstParty ? "Sold directly by the store itself." : brandStore ? "The seller's name matches the brand on the listing." : "Sold by an independent seller on the marketplace.");
  notes.push(fba ? "Shipped and handled by Amazon, so returns and delivery follow Amazon's own process." : ships ? `Shipped by ${ships}. Delivery and returns follow that seller's process.` : "The page does not say who ships it.");
  const tone = firstParty || brandStore ? "good" : fba ? "neutral" : "watch";
  return { name, ships, kind, fba, firstParty, tone, sid, notes };
}

// Seller signals 0-100 from what the page states (+ the seller's own rating when the offers list has been loaded). Descriptive, never a verdict on honesty.
function sellerScore(sl, rt) {
  if (!sl) return null;
  let sc = sl.firstParty ? 92 : sl.kind === "Brand store" ? 82 : sl.fba ? 62 : 38;
  if (rt && rt.rating) { if (rt.ratings >= 20) sc += Math.round((rt.rating - 3.5) * 12); else if (rt.rating <= 2) sc -= 10; }
  return Math.max(5, Math.min(98, sc));
}
function sellerChange(prev, cur) { return prev && cur && prev !== cur ? `Seller changed from ${prev} to ${cur} since your last visit.` : null; }

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
if (typeof module !== "undefined") module.exports = { alertDecision, sellerScore, historyTextTrusted, HISTORY_UNTRUSTED, parseAmazonHistoryText, refUsable, sellerInfo, sellerChange, dealScan, pumpCheck, lastChange, windowStats, dealStrength, buyWait, urgencySignals, priceConfidence, useLookup, LIMITS, inr, DAY };
