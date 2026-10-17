// Impulse Check: cue extraction, per-product memory, and the neutral verdict lines.
const assert = require("assert"), I = require("../../extension/impulse.js");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const DAY = 864e5, HR = 3600e3, NOW = 1.8e12;
// ---- cues
let c = I.impCues([{ zone: "stock", text: "Only 2 left in stock - order soon." }]); ok(c.length === 1 && c[0].kind === "stock" && c[0].n === 2, "only N left: " + JSON.stringify(c));
ok(I.impCues([{ zone: "stock", text: "In stock" }]).length === 0, "plain in stock: no cue");
ok(I.impCues([{ zone: "stock", text: "Hurry, only a few left!" }])[0].n === null, "few left: stock cue without a number");
c = I.impCues([{ zone: "deal", text: "Limited time deal ends in 04:12:33" }]); ok(c.some(x => x.kind === "timer" && x.secs === 4 * 3600 + 12 * 60 + 33 && x.gran === "s") && c.some(x => x.kind === "deal"), "timer + deal label: " + JSON.stringify(c));
c = I.impCues([{ zone: "deal", text: "Deal ends in 2h 30m" }]); ok(c[0].kind === "timer" && c[0].secs === 9000 && c[0].gran === "m", "h/m timer: " + JSON.stringify(c));
ok(I.impCues([{ zone: "deal", text: "Great Indian Festival NO_OF_HOURS hours NO_OF_MINUTES minutes NO_OF_SECONDS seconds" }]).every(x => x.kind !== "timer"), "Amazon's hidden placeholder labels are not a timer");
c = I.impCues([{ zone: "deal", text: "Great Indian Festival" }]); ok(c.length === 1 && c[0].kind === "deal", "sale event label is a deal cue");
c = I.impCues([{ zone: "bought", text: "4K+ bought in past month" }]); ok(c[0].kind === "bought" && c[0].n === 4000, "bought in past month: " + JSON.stringify(c));
c = I.impCues([{ zone: "page", text: "47 people are viewing this right now" }]); ok(c[0].kind === "viewers" && c[0].n === 47, "viewers");
ok(I.impCues([{ zone: "stock", text: "Only 1 left in stock." }, { zone: "stock", text: "Only 1 left in stock." }]).length === 1, "same cue twice is one");
ok(I.impCues([{ zone: "bought", text: "Only 2 left" }]).length === 0 && I.impCues([{ zone: "stock", text: "10:00:00" }]).length === 0, "a zone only reads its own kind of message");
ok(I.impCues(null).length === 0 && I.impCues([{ zone: "stock", text: "x".repeat(5000) }]).length === 0 && I.impCues([{ zone: "deal", text: "ends in 99:99:99999" }]).length === 0, "garbage and huge text are harmless");
ok(I.impCues([{ zone: "deal", text: "ends in 400:00:00" }]).every(x => x.kind !== "timer"), "a timer longer than 14 days is not a countdown");
// real phrases captured on Flipkart, Myntra and Shopify stores (2026-10-17)
c = I.impCues([{ zone: "page", text: "Ends in 01d 02h 49m 37s" }]); ok(c[0].kind === "timer" && c[0].secs === 86400 + 2 * 3600 + 49 * 60 + 37 && c[0].gran === "s", "flipkart d/h/m/s timer: " + JSON.stringify(c));
c = I.impCues([{ zone: "page", text: "Lowest Price Live • Ends in 02h 46m 37s" }]); ok(c[0].kind === "timer" && c[0].secs === 2 * 3600 + 46 * 60 + 37, "flipkart 'Lowest Price Live' timer: " + JSON.stringify(c));
c = I.impCues([{ zone: "page", text: "2 left" }]); ok(c.length === 1 && c[0].kind === "stock" && c[0].n === 2, "myntra size '2 left': " + JSON.stringify(c));
ok(I.impCues([{ zone: "page", text: "3 days left" }]).length === 0 && I.impCues([{ zone: "page", text: "2 left of 5 stars" }]).length === 0, "'N days left' and prose are not stock");
c = I.impCues([{ zone: "page", text: "Hurry Up! Only 3 left in stock" }]); ok(c[0].kind === "stock" && c[0].n === 3, "shopify 'Hurry Up! Only N left in stock'");
c = I.impCues([{ zone: "page", text: "Only 4 items left in stock!" }]); ok(c[0].n === 4, "'only N items left'");
c = I.impCues([{ zone: "page", text: "Offer ends Tomorrow" }]); ok(c[0].kind === "deadline" && c[0].text === "Ends tomorrow", "sleep company 'Offer ends Tomorrow': " + JSON.stringify(c));
c = I.impCues([{ zone: "page", text: "27 sold in the last 24 hours" }]); ok(c[0].kind === "bought" && c[0].n === 27, "'sold in the last 24 hours': " + JSON.stringify(c));
ok(I.impCues([{ zone: "page", text: "The Offer is valid only for select serviceable pincodes within Mumbai" }, { zone: "page", text: "Orders above Rs. 149 (only on first purchase)" }, { zone: "page", text: "Sale price" }, { zone: "page", text: "Daily Deals" }, { zone: "page", text: "Top Discount of the Sale" }]).length === 0, "ordinary marketing and fine print are not urgency cues");
c = I.impCues([{ zone: "page", text: "Sale ends in 26 Hrs : 36 Min : 30 Sec" }]); ok(c[0].kind === "timer" && c[0].secs === 26 * 3600 + 36 * 60 + 30 && c[0].gran === "s", "flipkart 'Hrs : Min : Sec' timer: " + JSON.stringify(c));
c = I.impCues([{ zone: "page", text: "Hurry Up! Only 1 Item(s) left in stock" }]); ok(c[0].kind === "stock" && c[0].n === 1, "giva 'Item(s)': " + JSON.stringify(c));
// ---- memory: timer
const T1 = [{ kind: "timer", secs: 4 * 3600, gran: "s" }];
let m = I.impRecord(null, T1, 1000, NOW); ok(m.v.length === 1 && m.v[0].end === NOW + 4 * 3600e3 && m.restarts === 0, "first sight stores the end time");
m = I.impRecord(m, [{ kind: "timer", secs: 4 * 3600 - 2 * 60 }], 1000, NOW + 2 * 60e3); ok(m.restarts === 0 && m.v.length === 2, "counting down on schedule: not a restart");
m = I.impRecord(m, [{ kind: "timer", secs: 4 * 3600, gran: "s" }], 1000, NOW + 3 * HR); ok(m.restarts === 1, "after 3 h the timer shows 4 h again: later end time, counted once");
let m2 = I.impRecord(I.impRecord(null, T1, 1, NOW), T1, 1, NOW + 10 * 60e3); ok(m2.restarts === 1, "a reload 10 min later showing the same 4:00:00 again is a restart");
m2 = I.impRecord(I.impRecord(null, T1, 1, NOW), T1, 1, NOW + 20e3); ok(m2.restarts === 0 && m2.v.length === 1, "reloads within a minute are one visit");
let d = I.impRecord(null, [{ kind: "timer", secs: 3600, gran: "s" }], 1, NOW); d = I.impRecord(d, [{ kind: "timer", secs: 3600, gran: "s" }], 1, NOW + 24 * HR); ok(d.daily === 1 && d.restarts === 0, "a timer that ended and is back the next day is a daily timer, not a restart");
let g = I.impRecord(null, [{ kind: "timer", secs: 9000, gran: "m" }], 1, NOW); g = I.impRecord(g, [{ kind: "timer", secs: 9000 - 60 * 5, gran: "m" }], 1, NOW + 5 * 60e3 + 90e3); ok(g.restarts === 0, "minute-granularity timers get a wider tolerance");
let e1 = I.impRecord(null, [{ kind: "timer", secs: 3600, gran: "s" }], 1, NOW); e1 = I.impRecord(e1, [{ kind: "timer", secs: 7200, gran: "s" }], 1, NOW + 5 * HR); ok(e1.restarts === 1 && e1.daily === 0, "a timer that had ended and comes back with a different length is a restart");
ok(I.impVerdict([{ kind: "stock", n: 2, text: "x" }], { v: [0, 3].map(i => ({ at: NOW - (3 - i) * DAY, stock: 2 })) }, [], NOW).level === "seen", "two visits are not a pattern");
ok(I.impCues([{ zone: "stock", text: "4K+ bought in past month. 12:00:00 Limited time deal" }]).length === 0, "the stock zone does not read popularity, timers or deals");
ok(I.impRecord(null, [{ kind: "stock", n: 4 }, { kind: "stock", n: 2 }, { kind: "stock", n: 3 }], 1, NOW).v[0].stock === 2, "several per-size counts: the lowest is remembered");
ok(I.impRecord(null, [{ kind: "bought", n: 5 }], 1, NOW).v.length === 0, "cues that are not stock/timer leave no memory");
ok(I.impRecord({ v: [{ at: NOW - 100 * DAY, stock: 1 }] }, [{ kind: "stock", n: 1 }], 1, NOW).v.length === 1, "memory older than 90 days is dropped");
let big = null; for (let i = 0; i < 40; i++) big = I.impRecord(big, [{ kind: "stock", n: 2 }], 1, NOW + i * HR); ok(big.v.length <= 16, "memory is bounded");
// ---- verdict
const flat = [[NOW - 40 * DAY, 999], [NOW - 10 * DAY, 999]];
let v = I.impVerdict([], null, flat, NOW); ok(v.level === "none" && !v.lines.length, "no cues: nothing to say");
v = I.impVerdict([{ kind: "stock", n: 2, text: "Only 2 left" }], null, [], NOW); ok(v.level === "seen" && v.lines.length === 1, "one visit, no history: just 'seen'");
v = I.impVerdict([{ kind: "stock", n: 2, text: "Only 2 left" }], null, flat, NOW); ok(v.level === "steady" && /Price unchanged for 21 days/.test(v.lines.join("|")), "steady price is stated with its length: " + v.lines);
v = I.impVerdict([{ kind: "stock", n: 2, text: "Only 2 left" }], null, [[NOW - 40 * DAY, 999], [NOW - 5 * DAY, 1200]], NOW); ok(v.level === "seen", "a price that moved is not 'steady'");
v = I.impVerdict([{ kind: "stock", n: 2, text: "Only 2 left" }], null, [[NOW - 5 * DAY, 999]], NOW); ok(v.level === "seen", "less than 14 days of history says nothing about steadiness");
const rep = { v: [0, 2, 4].map(i => ({ at: NOW - (5 - i) * DAY, stock: 2 })) }; v = I.impVerdict([{ kind: "stock", n: 2, text: "Only 2 left" }], rep, [], NOW); ok(v.level === "repeated" && /on 3 visits over 4 days/.test(v.lines.join("|")), "same count on 3 visits over 4 days: " + v.lines);
v = I.impVerdict([{ kind: "stock", n: 2, text: "x" }], { v: [3, 3, 3].map((s, i) => ({ at: NOW - (1 - i * 0.1) * HR, stock: s })) }, [], NOW); ok(v.level === "seen", "three visits within hours are not a pattern");
v = I.impVerdict([{ kind: "stock", n: 3, text: "x" }], { v: [{ at: NOW - 3 * DAY, stock: 5 }, { at: NOW, stock: 3 }] }, [], NOW); ok(/from 5 to 3/.test(v.lines.join("|")) && v.level === "seen", "a count that goes down is simply reported");
v = I.impVerdict([{ kind: "timer", secs: 100, text: "Countdown timer" }], { v: [], restarts: 2, daily: 0 }, [], NOW); ok(v.level === "restarted" && /2 times/.test(v.lines.join("|")), "restarts are counted: " + v.lines);
v = I.impVerdict([{ kind: "timer", secs: 100, text: "Countdown timer" }], { v: [{ at: 1, end: 5 }, { at: 2, end: 6 }], restarts: 0, daily: 1 }, [], NOW); ok(v.level === "seen" && /every day/.test(v.lines.join("|")), "daily timers stay neutral");
ok(!/fake|scam|lie|fraud|cheat/i.test(JSON.stringify([I.impVerdict([{ kind: "timer", secs: 1, text: "Countdown timer" }], { restarts: 3, v: [] }, flat, NOW), I.impVerdict([{ kind: "stock", n: 1, text: "Only 1 left" }], rep, flat, NOW)])), "wording never accuses");
console.log(`impulse: ${n} passed, 0 failed`);
