// Impulse Check: find urgency / scarcity messages in the product part of a page and say what the evidence shows (never "fake").
// Pure functions (names prefixed imp*): impCues (text -> cues), impRecord (remember numbers + times per product), impVerdict (cues + memory + price history -> lines).
// Memory is numbers and timestamps only. Observations are worded as what happened ("showed a later end time"), never as a verdict on the seller.
const IMP = { KEEP_MS: 90 * 864e5, MAX_VISITS: 16, MIN_GAP_MS: 60e3, TOL_S: 30e3, TOL_M: 120e3, STEADY_DAYS: 21, STEADY_MIN_SPAN: 14 };
const impNum = s => { const m = /^(\d+(?:\.\d)?)([kK]?)$/.exec(String(s)); return m ? Math.round(parseFloat(m[1]) * (m[2] ? 1000 : 1)) : null; };
// parts: [{zone:"stock"|"deal"|"bought"|"page", text}]. The caller picks the zones (never reviews, Q&A, carousels, other sellers).
function impCues(parts) {
  const out = [], seen = new Set(), add = c => { const k = c.kind + (c.n == null ? "" : c.n) + (c.secs == null ? "" : "t"); if (!seen.has(k)) { seen.add(k); out.push(c); } };
  for (const p of parts || []) {
    const z = p && p.zone, t = String((p && p.text) || "").replace(/\S*NO_OF_\S*/g, " ").replace(/\s+/g, " ").slice(0, 600); if (!t.trim()) continue; let m; // Amazon keeps hidden template labels ("NO_OF_HOURS hours") for its own timer: those words are dropped
    if (z === "stock" || z === "page") {
      if ((m = /\bonly\s+(\d{1,3})\s+(?:left|remaining|in stock)/i.exec(t))) add({ kind: "stock", n: +m[1], text: `Only ${m[1]} left` });
      else if (/\b(?:only\s+)?(?:a\s+)?few\s+(?:units?\s+)?left\b|\balmost gone\b|\bselling fast\b/i.test(t)) add({ kind: "stock", n: null, text: "Low stock message" });
    }
    if (z === "deal" || z === "page") {
      if ((m = /(?:ends?\s+in|ending\s+in|time\s+left|left)\D{0,6}(\d{1,2}):(\d{2}):(\d{2})/i.exec(t)) || (m = /\b(\d{1,2}):(\d{2}):(\d{2})\b/.exec(t))) { const secs = +m[1] * 3600 + +m[2] * 60 + +m[3]; if (+m[2] < 60 && +m[3] < 60 && secs > 0 && secs < 14 * 86400) add({ kind: "timer", secs, gran: "s", text: "Countdown timer" }); }
      else if ((m = /ends?\s+in\s+(?:(\d+)\s*d(?:ays?)?\s*)?(?:(\d+)\s*h(?:ours?|rs?)?\s*)?(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i.exec(t)) && (m[1] || m[2] || m[3])) { const secs = (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60; if (secs > 0 && secs < 14 * 86400) add({ kind: "timer", secs, gran: "m", text: "Countdown timer" }); }
      if (/\b(?:limited[- ]time deal|lightning deal|deal of the day|limited[- ]period)\b/i.test(t)) add({ kind: "deal", n: null, text: "Limited-time deal label" });
      else if (/\b(?:great indian festival|big billion days|prime day|end of season sale)\b/i.test(t)) add({ kind: "deal", n: null, text: "Sale event label" });
    }
    if (z === "bought" || z === "page") { if ((m = /(\d+(?:\.\d)?[kK]?)\+?\s*bought\s+in\s+(?:the\s+)?past\s+month/i.exec(t)) && impNum(m[1])) add({ kind: "bought", n: impNum(m[1]), text: `${m[1]}+ bought in past month` }); }
    if ((m = /(\d{1,4})\+?\s+(?:people|others|customers|shoppers)\s+(?:are\s+)?(?:currently\s+)?(?:viewing|watching|looking)/i.exec(t))) add({ kind: "viewers", n: +m[1], text: `${m[1]} people viewing` });
  }
  return out;
}
// mem = {v:[{at, stock?, end?, gran?, price?}], restarts, daily}; one entry per visit (visits closer than a minute update the last one).
function impRecord(mem, cues, price, now = Date.now()) {
  const m = { v: ((mem && mem.v) || []).filter(x => now - x.at < IMP.KEEP_MS).slice(-IMP.MAX_VISITS), restarts: (mem && mem.restarts) || 0, daily: (mem && mem.daily) || 0 };
  const st = (cues || []).find(c => c.kind === "stock" && c.n != null), tm = (cues || []).find(c => c.kind === "timer"); if (!st && !tm) return m;
  const e = { at: now }; if (st) e.stock = st.n; if (tm) { e.end = now + tm.secs * 1000; e.gran = tm.gran; } if (price) e.price = price;
  const prev = m.v[m.v.length - 1];
  if (prev && now - prev.at < IMP.MIN_GAP_MS) { m.v[m.v.length - 1] = { ...prev, ...e, at: prev.at }; return m; }
  if (tm && prev && prev.end) { // the deadline we saw before must still be the deadline now
    const tol = tm.gran === "m" || prev.gran === "m" ? IMP.TOL_M : IMP.TOL_S, drift = e.end - prev.end;
    if (prev.end < now - 60e3) { if (Math.abs(drift - 86400e3) <= 10 * 60e3) m.daily++; else if (drift > tol) m.restarts++; } // it had ended and a timer is back: a new day's timer, or a restart
    else if (drift > tol) m.restarts++; // not over yet but now ends later
  }
  m.v.push(e); m.v = m.v.slice(-IMP.MAX_VISITS); return m;
}
const impDays = ms => Math.max(1, Math.round(ms / 864e5));
function impSteady(hist, now) { // [[t, price]] -> days the price has not moved (>=14, within 2%), else 0
  const h = (hist || []).filter(x => Array.isArray(x) && x[1] > 0).sort((a, b) => a[0] - b[0]); if (!h.length || now - h[0][0] < IMP.STEADY_MIN_SPAN * 864e5) return 0;
  const from = now - IMP.STEADY_DAYS * 864e5, w = h.filter(x => x[0] >= from), before = h.filter(x => x[0] < from).pop(), pts = (before ? [before] : []).concat(w).map(x => x[1]); if (!pts.length) return 0;
  return Math.max(...pts) / Math.min(...pts) <= 1.02 ? impDays(Math.min(now - h[0][0], IMP.STEADY_DAYS * 864e5)) : 0;
}
// -> {level: "none"|"seen"|"steady"|"repeated"|"restarted", head, lines:[string]}
function impVerdict(cues, mem, hist, now = Date.now()) {
  if (!cues || !cues.length) return { level: "none", head: "", lines: [] };
  const lines = cues.map(c => c.text), v = (mem && mem.v) || []; let level = "seen";
  const days = impSteady(hist, now); if (days) { level = "steady"; lines.push(`Price unchanged for ${days} days`); }
  const stocks = v.filter(x => x.stock != null); if (stocks.length >= 3 && new Set(stocks.map(x => x.stock)).size === 1 && stocks[stocks.length - 1].at - stocks[0].at >= 2 * 864e5) { level = "repeated"; lines.push(`"Only ${stocks[0].stock} left" on ${stocks.length} visits over ${impDays(stocks[stocks.length - 1].at - stocks[0].at)} days`); }
  else if (stocks.length >= 2 && stocks[stocks.length - 1].stock < stocks[0].stock) lines.push(`Count went from ${stocks[0].stock} to ${stocks[stocks.length - 1].stock}`);
  if (mem && mem.restarts > 0) { level = "restarted"; lines.push(`The timer showed a later end time when you came back${mem.restarts > 1 ? ` (${mem.restarts} times)` : ""}`); }
  else if (mem && mem.daily > 0) lines.push("The timer starts again every day");
  else if (v.filter(x => x.end).length >= 2) lines.push("The timer is counting down on schedule");
  const head = { restarted: "Timer showed a new end time", repeated: "Same stock message again", steady: `Price steady for ${days} days`, seen: "Urgency message on this page" }[level];
  return { level, head, lines };
}
if (typeof module !== "undefined") module.exports = { IMP, impCues, impRecord, impVerdict, impSteady };
