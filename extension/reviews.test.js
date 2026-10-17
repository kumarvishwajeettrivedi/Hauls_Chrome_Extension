const assert = require('assert');
const R = require('./reviews.js');
const D = 864e5, t0 = Date.parse('2026-01-01');
const mk = (rating, text, o) => Object.assign({ rating, text, date: null, verified: true, helpful: null }, o || {});
const ids = (x) => x.signals.map((s) => s.id);

// insufficient
let r = R.reviewSignals([mk(5, 'good')], null);
assert.strictEqual(r.confidence, 'insufficient'); assert.strictEqual(r.signals.length, 0); assert.ok(r.disclaimer);

// J-shape
let j = []; for (let i = 0; i < 14; i++) j.push(mk(5, 'works well number ' + i + ' unique words alpha' + i)); for (let i = 0; i < 4; i++) j.push(mk(1, 'stopped after week variant' + i + ' beta'));
r = R.reviewSignals(j); assert.ok(ids(r).includes('j_shape')); assert.strictEqual(r.confidence, 'low');

// burst
let b = []; for (let i = 0; i < 12; i++) b.push(mk(4, 'text number ' + i + ' about thing' + i, { date: t0 + (i < 9 ? 0 : i) * D }));
r = R.reviewSignals(b); assert.ok(ids(r).includes('burst'));

// duplicates
let d = []; for (let i = 0; i < 5; i++) d.push(mk(5, 'very nice product must buy for everyone at this price'));
for (let i = 0; i < 5; i++) d.push(mk(3, 'different words entirely sentence ' + i + ' gamma' + i + ' delta' + i));
r = R.reviewSignals(d); assert.ok(ids(r).includes('repeated_text'));

// unverified + short
let u = []; for (let i = 0; i < 10; i++) u.push(mk(4, i % 2 ? 'ok' : 'nice one', { verified: false }));
r = R.reviewSignals(u); assert.ok(ids(r).includes('unverified')); assert.ok(ids(r).includes('short_generic'));

// mismatch (incl. Hinglish)
let m = []; for (let i = 0; i < 6; i++) m.push(mk(5, 'bekar product bilkul bakwas item ' + i));
m.push(mk(1, 'paisa vasool mast')); m.push(mk(1, 'excellent perfect quality')); m.push(mk(5, 'great'), mk(4, 'fine thing here ok'));
r = R.reviewSignals(m); assert.ok(ids(r).includes('mismatch'));

// clean sample, no banned wording anywhere
let c = []; for (let i = 0; i < 25; i++) c.push(mk(3 + (i % 3), 'varied honest comment about feature' + i + ' and detail' + i + ' of the use', { date: t0 + i * D }));
r = R.reviewSignals(c, { count: 900 }); assert.strictEqual(r.signals.length, 0); assert.strictEqual(r.confidence, 'medium'); assert.ok(r.sampleNote);
assert.ok(!/fake/i.test(JSON.stringify([R.reviewSignals(j), R.reviewSignals(d), R.reviewSignals(m)])));

// summary
let s = [];
for (let i = 0; i < 6; i++) s.push(mk(5, 'Good battery life and nice display, mast sound quality'));
for (let i = 0; i < 5; i++) s.push(mk(1, 'Poor build quality, charger stopped working, bekar camera'));
const sm = R.reviewSummary(s);
assert.strictEqual(sm.n, 11); assert.ok(sm.likes.length && sm.likes.length <= 4 && sm.dislikes.length <= 4);
assert.ok(sm.likes.join('|').includes('battery'), sm.likes.join()); assert.ok(sm.dislikes.join('|').includes('charger') || sm.dislikes.join('|').includes('build'), sm.dislikes.join());

// readReviews: no DOM / empty -> []
assert.deepStrictEqual(R.readReviews(null, 'amazon'), []);
assert.deepStrictEqual(R.readReviews({ querySelectorAll: () => [] }, 'flipkart'), []);
assert.strictEqual(globalThis.Reviews_.reviewSummary, R.reviewSummary);


// ---- histogram signals (calibration)
const H = (a, total) => ({ histogram: { total: total || 5000, avg: 4, dist: { 1: a[0], 2: a[1], 3: a[2], 4: a[3], 5: a[4] } } });
const hid = (a, total) => ids(R.reviewSignals([], H(a, total)));
assert.deepStrictEqual(hid([0.14, 0.04, 0.10, 0.22, 0.50]), [], 'real amazon.in earbuds: not flagged');
assert.deepStrictEqual(hid([0.13, 0.058, 0.092, 0.175, 0.545]), [], 'real flipkart earbuds: not flagged');
assert.deepStrictEqual(hid([0.05, 0.04, 0.10, 0.31, 0.50]), [], 'avg~4.2 natural spread');
assert.deepStrictEqual(hid([0.08, 0.05, 0.07, 0.20, 0.60]), [], 'polarised-ish but real middle');
assert.ok(hid([0.10, 0.01, 0.02, 0.02, 0.85]).includes('j_shape'), '85% 5-star + 10% 1-star');
assert.ok(hid([0.01, 0, 0.01, 0.04, 0.94]).includes('all_top'));
r = R.reviewSignals([], H([0.10, 0.01, 0.02, 0.02, 0.85], 3200));
assert.strictEqual(r.confidence, 'high'); assert.strictEqual(r.signals[0].basis, 'ratings');
assert.ok(/3,200 ratings/.test(r.signals[0].detail) && !/fake/i.test(JSON.stringify(r)));
r = R.reviewSignals([], H([0.10, 0.01, 0.02, 0.02, 0.85], 10)); assert.strictEqual(r.signals.length, 0, 'tiny aggregate not trusted');
// text signals stay tied to the sample even with a histogram; sample wording stays 'sample'
r = R.reviewSignals(d, H([0.05, 0.05, 0.1, 0.3, 0.5], 4000));
assert.ok(ids(r).includes('repeated_text')); assert.ok(/sample: 10 reviews/.test(r.signals.find((x) => x.id === 'repeated_text').detail));
assert.strictEqual(r.confidence, 'high'); assert.strictEqual(r.sampleConfidence, 'medium'.replace('medium', 'low'));

// ---- readHistogram with a minimal fake DOM
const el = (o) => Object.assign({ children: [], textContent: '', getAttribute(k) { return (this.attrs || {})[k] || null; } }, o);
const fdoc = (map) => ({ body: { textContent: '' }, querySelectorAll: (s) => map[s] || [], querySelector: (s) => (map[s] || [])[0] || null });
const lab = [[5, 50], [4, 22], [3, 10], [2, 4], [1, 14]].map(([k, p]) => el({ attrs: { 'aria-label': p + ' percent of reviews have ' + k + ' stars' } }));
let hh = R.readHistogram(fdoc({ '[aria-label*="percent of reviews have"]': lab, '#acrCustomerReviewText': [el({ textContent: '(91,434)' })], '[aria-label$="out of 5 stars"], [data-hook="rating-out-of-text"], #acrPopover': [el({ attrs: { 'aria-label': '3.9 out of 5 stars' } })] }), 'amazon');
assert.strictEqual(hh.total, 91434); assert.strictEqual(hh.avg, 3.9); assert.ok(Math.abs(hh.dist[5] - 0.5) < 1e-9 && Math.abs(hh.dist[1] - 0.14) < 1e-9);
assert.strictEqual(R.readHistogram(fdoc({}), 'amazon'), null); assert.strictEqual(R.readHistogram(null, 'flipkart'), null);
const row = (n, c) => { const p = el({ textContent: String(n) }), st = el({ textContent: '★' }), cc = el({ textContent: c }); p.previousElementSibling = null; st.previousElementSibling = p; st.parentElement = { lastElementChild: cc }; return st; };
hh = R.readHistogram({ body: { textContent: '1,69,142 ratings and 8,306 reviews' }, querySelectorAll: () => [row(1, '22,002'), row(2, '9,774'), row(3, '15,630'), row(4, '29,597'), row(5, '92,139')] }, 'flipkart');
assert.strictEqual(hh.total, 169142); assert.ok(hh.dist[5] > 0.54 && hh.dist[5] < 0.55);

// ---- fetchMoreReviews: same-origin urls, credentials, and never past a block
(async () => {
  const calls = [], page = (rv) => ({ rv });
  const mkFetch = (resp) => async (u, o) => { calls.push([u, o]); return resp(u); };
  const ok = (url, body) => ({ ok: true, status: 200, url, text: async () => body || '<html>ok</html>' });
  const parse = (h) => h; // readReviews is fed the "doc"; stub via ctx below
  const base = { asin: 'B0F8BVSK21', delayMs: 0, parse: () => ({ querySelectorAll: (s) => (s === '[data-hook="review"]' ? [] : []), body: { textContent: '' } }) };
  // login redirect on page 1
  let f = await R.fetchMoreReviews('amazon', base, mkFetch((u) => ok('https://www.amazon.in/ap/signin?x=1')), 3);
  assert.deepStrictEqual([f.reviews.length, f.blocked, calls.length], [0, 'login', 1]);
  // captcha
  calls.length = 0;
  f = await R.fetchMoreReviews('amazon', base, mkFetch((u) => ok(u, '<form action="/errors/validateCaptcha">')), 3);
  assert.deepStrictEqual([f.blocked, calls.length], ['captcha', 1]);
  // non-200
  calls.length = 0;
  f = await R.fetchMoreReviews('flipkart', { url: 'https://www.flipkart.com/boat-x/p/itm63134e79353d1?pid=ACCG1', delayMs: 0, parse: base.parse }, mkFetch((u) => ({ ok: false, status: 429, url: u, text: async () => '' })), 3);
  assert.deepStrictEqual([f.blocked, calls.length], ['http', 1]);
  // success: urls + credentials; amazon-shaped fake reviews, stops at 3 pages
  calls.length = 0;
  const rev = (n) => el({ attrs: {}, querySelector: (s) => (/star-rating/.test(s) ? el({ textContent: '4.0 out of 5 stars' }) : /body/.test(s) ? el({ textContent: 'review text ' + n }) : null) });
  const okParse = () => ({ querySelectorAll: (s) => (s === '[data-hook="review"]' ? [rev(1), rev(2)] : []), body: { textContent: '' } });
  f = await R.fetchMoreReviews('amazon', { asin: 'B0F8BVSK21', delayMs: 0, parse: okParse }, mkFetch((u) => ok('https://www.amazon.in' + u)), 3);
  assert.strictEqual(f.reviews.length, 6); assert.strictEqual(f.blocked, null); assert.strictEqual(calls.length, 3);
  assert.ok(calls[2][0].startsWith('/product-reviews/B0F8BVSK21?reviewerType=all_reviews&sortBy=recent&pageNumber=3'));
  assert.ok(calls.every((c) => c[0][0] === '/' && c[1].credentials === 'include'), 'relative = same-origin');
  calls.length = 0;
  await R.fetchMoreReviews('flipkart', { url: 'https://www.flipkart.com/boat-x/p/itm63134e79353d1?pid=ACCG1&lid=1', delayMs: 0, parse: okParse }, mkFetch((u) => ok('https://www.flipkart.com' + u)), 1);
  assert.strictEqual(calls[0][0], '/boat-x/product-reviews/itm63134e79353d1?pid=ACCG1&page=1');
  assert.deepStrictEqual(R.ctxFromUrl('https://www.amazon.in/dp/B0F8BVSK21?th=1', 'amazon'), { asin: 'B0F8BVSK21' });

  // ---- summary: attribute n-grams only
  const ss = [];
  for (let i = 0; i < 5; i++) ss.push(mk(5, 'Love it, working great daily, great experience. Battery backup is amazing and sound quality is superb'));
  for (let i = 0; i < 4; i++) ss.push(mk(1, 'Worst. Stopped working in a week, build quality poor, heating a lot'));
  const sm2 = R.reviewSummary(ss), all = sm2.likes.concat(sm2.dislikes).join('|');
  assert.ok(sm2.likes.includes('battery backup') && sm2.likes.includes('sound quality'), sm2.likes.join());
  assert.ok(sm2.dislikes.includes('build quality') && sm2.dislikes.includes('stopped working'), sm2.dislikes.join());
  assert.ok(!/\b(love|daily|experience)\b/.test(all) && !/^working$|\|working\b/.test(all), all);
  assert.equal(R.reviewAnswer({ avg: 3.2, total: 10, dist: { 5: .7, 4: .2, 3: .05, 2: .02, 1: .03 } }, [], null).tone, 'good', 'a wrongly parsed avg must not override the breakdown');
  assert.equal(R.reviewAnswer({ avg: 4.1, total: 100, dist: { 5: .6, 4: .25, 3: .08, 2: .02, 1: .05 } }, [], null).avg, 4.1, 'the page average is shown, not the rounded-percentage mean');
  var ra = R.reviewAnswer({ avg: 4.4, total: 12000, dist: { 5: .7, 4: .2, 3: .05, 2: .02, 1: .03 } }, [], { signals: [] });
  assert.equal(ra.tone, 'good'); assert.equal(ra.pos, 90); assert.equal(ra.neg, 5);
  assert.equal(R.reviewAnswer({ avg: 3.9, total: 500, dist: { 5: .4, 4: .2, 3: .1, 2: .1, 1: .2 } }, [], null).tone, 'mixed');
  assert.equal(R.reviewAnswer({ avg: 2.8, total: 500, dist: { 5: .2, 4: .1, 3: .1, 2: .2, 1: .4 } }, [], null).tone, 'bad');
  assert.equal(R.reviewAnswer(null, [{ rating: 5 }, { rating: 4 }, { rating: 5 }, { rating: 5 }], null).from, 'visible reviews');
  assert.equal(R.reviewAnswer(null, [{ rating: 5 }], null), null); assert.equal(R.reviewAnswer(null, [], null), null);
  assert.equal(R.reviewAnswer({ avg: 4.4, total: 1, dist: { 5: 1 } }, [], { signals: [{ severity: 'watch' }, { severity: 'info' }] }).odd, 1);
  console.log('reviews.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
