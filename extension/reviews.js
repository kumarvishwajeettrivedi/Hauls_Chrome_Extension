// Review quality signals + review summary. Pure JS, no deps, no network.
// Wording rule: "signals" / "unusual patterns" from the visible sample only; never an accusation.
(function (root) {
  'use strict';
  var DISCLAIMER = 'Based only on the reviews visible on this page. These are signals of unusual patterns, not proof of anything about any review, seller or buyer.';

  // ---------- reading ----------
  function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function num(s) { var m = /(\d+(?:[.,]\d+)?)/.exec(s || ''); return m ? parseFloat(m[1].replace(',', '.')) : null; }
  function parseDate(s) {
    if (!s) return null;
    var t = Date.parse(String(s).replace(/^.*?\bon\s+/i, '').replace(/(\d)(st|nd|rd|th)\b/, '$1'));
    return isNaN(t) ? null : t;
  }
  function helpful(s) {
    if (!s) return null;
    if (/^\s*(one|1)\s+(person|customer)/i.test(s)) return 1;
    var m = /([\d,]+)\s+(people|persons?|customers?)/i.exec(s);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : (/helpful/i.test(s) ? 0 : null);
  }
  function fromJsonLd(doc) {
    var out = [];
    [].forEach.call(doc.querySelectorAll('script[type="application/ld+json"]'), function (s) {
      var j; try { j = JSON.parse(s.textContent); } catch (e) { return; }
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(walk);
        if (o.review) [].concat(o.review).forEach(function (r) {
          var rv = r && r.reviewRating && num(String(r.reviewRating.ratingValue));
          if (rv >= 1 && rv <= 5) out.push({ rating: rv, text: String(r.reviewBody || r.description || '').trim(),
            date: parseDate(r.datePublished), verified: null, helpful: null });
        });
        Object.keys(o).forEach(function (k) { if (k !== 'review') walk(o[k]); });
      })(j);
    });
    return out;
  }
  function readAmazon(doc) {
    var out = [];
    [].forEach.call(doc.querySelectorAll('[data-hook="review"]'), function (el) {
      var r = num(txt(el.querySelector('[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"]')));
      if (!(r >= 1 && r <= 5)) return;
      var title = txt(el.querySelector('[data-hook="review-title"], [data-hook="reviewTitle"]'));
      var clean = function (t) { return t.replace(/Brief content visible, double tap to read full content\.?|Full content visible, double tap to read brief content\.?|Read (more|less)/g, ' ').replace(/\s+/g, ' ').trim(); };
      var body = clean(txt(el.querySelector('[data-hook="review-body"], [data-hook="reviewTextContainer"]')));
      out.push({ rating: r, text: body || title, date: parseDate(txt(el.querySelector('[data-hook="review-date"]'))),
        verified: !!el.querySelector('[data-hook="avp-badge"]'),
        helpful: helpful(txt(el.querySelector('[data-hook="helpful-vote-statement"]'))) });
    });
    return out;
  }
  // Flipkart class names are obfuscated and rotate, so anchor on stable text: the
  // "Certified Buyer" label and a lone 1-5 rating digit inside the same review block.
  // Current Flipkart pages carry reviews as JSON in window.__INITIAL_STATE__ (stars are not in the DOM text).
  // Dates there are month-grain ("Dec, 2023"), so date stays null: month-grain would fake a 'burst'.
  function flipkartState(doc) {
    var out = [];
    [].forEach.call(doc.querySelectorAll('script'), function (sc) {
      var t = sc.textContent || '';
      if (t.indexOf('ProductReviewValue') < 0) return;
      var a = t.indexOf('{'), b = t.lastIndexOf('}'), j;
      try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { return; }
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(walk);
        if (o.type === 'ProductReviewValue' && o.rating >= 1 && o.rating <= 5)
          return out.push({ rating: o.rating, text: [o.title, o.text].filter(Boolean).join('. ').trim(), date: null,
            verified: o.certifiedBuyer == null ? null : !!o.certifiedBuyer, helpful: typeof o.helpfulCount === 'number' ? o.helpfulCount : null });
        Object.keys(o).forEach(function (k) { walk(o[k]); });
      })(j);
    });
    return out;
  }
  function readFlipkart(doc) {
    var st = flipkartState(doc);
    if (st.length) return st;
    var out = [], seen = new Set();
    var anchors = [].filter.call(doc.querySelectorAll('p, span, div'), function (e) {
      return e.children.length === 0 && /^Certified Buyer\b/i.test(txt(e));
    });
    anchors.forEach(function (a) {
      var blk = a;
      for (var i = 0; i < 8 && blk.parentElement; i++) {
        blk = blk.parentElement;
        var leaves = [].filter.call(blk.querySelectorAll('div, span'), function (e) { return e.children.length === 0 && /^[1-5]$/.test(txt(e)); });
        if (leaves.length && txt(blk).length > 60) {
          if (seen.has(blk)) return; // same block reached twice
          // do not climb into a block holding several reviews
          if (blk.querySelectorAll('*').length && [].filter.call(anchors, function (x) { return blk.contains(x); }).length > 1) return;
          seen.add(blk);
          var rating = parseInt(txt(leaves[0]), 10);
          var long = [].filter.call(blk.querySelectorAll('div, span, p'), function (e) { return e.children.length === 0 && txt(e).length > 3 && !/^(Certified Buyer|READ MORE|\d+)$/i.test(txt(e)) && !/Permalink|Report Abuse/i.test(txt(e)); })
            .map(txt);
          out.push({ rating: rating, text: long.sort(function (x, y) { return y.length - x.length; })[0] || '',
            date: null, verified: true, helpful: null });
          return;
        }
      }
    });
    return out;
  }
  function readReviews(doc, site) {
    try {
      if (!doc) return [];
      var r = site === 'amazon' ? readAmazon(doc) : site === 'flipkart' ? readFlipkart(doc) : [];
      return r.length ? r : fromJsonLd(doc);
    } catch (e) { return []; }
  }

  // ---------- aggregate histogram ----------
  function cnt(s) { var m = /(\d[\d,]*)/.exec(s || ''); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null; }
  function finishHist(raw, total, avg) {
    var sum = 0, k; for (k = 1; k <= 5; k++) sum += raw[k] || 0;
    if (!sum) return null;
    var dist = {}, mean = 0;
    for (k = 1; k <= 5; k++) { dist[k] = (raw[k] || 0) / sum; mean += k * dist[k]; }
    return { total: total || null, avg: avg || Math.round(mean * 100) / 100, dist: dist };
  }
  // Amazon: aria-label "50 percent of reviews have 5 stars" (stable), fallback to .a-histogram-row text.
  // Flipkart: review-listing page shows "1,69,142 ratings and 8,306 reviews" and rows "<n> ★ <count>".
  // The Flipkart product page only has avg + total, so it returns null there.
  function readHistogram(doc, site) {
    try {
      if (!doc) return null;
      var raw = {}, total = null, avg = null, t = doc.body ? doc.body.textContent || '' : '';
      if (site === 'amazon') {
        [].forEach.call(doc.querySelectorAll('[aria-label*="percent of reviews have"]'), function (a) {
          var m = /(\d+)\s*percent of reviews have (\d) star/i.exec(a.getAttribute('aria-label')); if (m) raw[m[2]] = +m[1];
        });
        if (Object.keys(raw).length < 5) {
          raw = {};
          [].forEach.call(doc.querySelectorAll('.a-histogram-row'), function (r) {
            var x = txt(r), a = /([1-5])\s*star/i.exec(x), p = /(\d+)\s*%/.exec(x); if (a && p) raw[a[1]] = +p[1];
          });
        }
        if (Object.keys(raw).length < 5) return null;
        // scope to the summary widgets, never the whole body (carousels also say "N ratings")
        var cand = [txt(doc.querySelector('#acrCustomerReviewText')), txt(doc.querySelector('[data-hook="total-review-count"]')), txt(doc.querySelector('[data-hook="cr-filter-info-review-rating-count"]'))];
        for (var q = 0; q < cand.length && !total; q++) total = cnt(cand[q]);
        var am = null; [].some.call(doc.querySelectorAll('[aria-label$="out of 5 stars"], [data-hook="rating-out-of-text"], #acrPopover'), function (e) { return (am = /^(\d(?:\.\d)?)\s*out of 5/i.exec((e.getAttribute('aria-label') || txt(e) || '').trim())); });
        return finishHist(raw, total, am ? parseFloat(am[1]) : null);
      }
      if (site === 'flipkart') {
        [].forEach.call(doc.querySelectorAll('div, span'), function (e) {
          if (e.children.length || txt(e) !== '★') return;
          var p = e.previousElementSibling, n = e.parentElement && e.parentElement.lastElementChild;
          if (p && /^[1-5]$/.test(txt(p)) && n && n !== e && /^[\d,]+$/.test(txt(n))) raw[txt(p)] = cnt(txt(n));
        });
        if (Object.keys(raw).length < 5) return null;
        var m2 = /([\d,]+)\s+ratings\s+and/i.exec(t);
        return finishHist(raw, m2 ? cnt(m2[1]) : null, null);
      }
    } catch (e) {}
    return null;
  }

  // ---------- user-initiated, same-origin fetch of the site's own review pages ----------
  // Never retries or works around a block: first login wall / captcha / bad status stops the loop.
  function ctxFromUrl(url, site) {
    var u = String(url || ''), c = {};
    if (site === 'amazon') { var a = /\/(?:dp|gp\/product|product-reviews)\/([A-Z0-9]{10})/i.exec(u); if (a) c.asin = a[1].toUpperCase(); }
    else { var i = /\/(itm[a-z0-9]+)/i.exec(u), p = /[?&]pid=([A-Z0-9]+)/i.exec(u), sl = /^(?:https?:\/\/[^/]+)?\/([^/?]+)\/p\/itm/i.exec(u); if (i) c.itm = i[1]; if (p) c.pid = p[1]; if (sl) c.slug = sl[1]; }
    return c;
  }
  function reviewUrl(site, c, n) {
    if (site === 'amazon') return c.asin && '/product-reviews/' + c.asin + '?reviewerType=all_reviews&sortBy=recent&pageNumber=' + n;
    return c.itm && c.pid && '/' + (c.slug || 'product') + '/product-reviews/' + c.itm + '?pid=' + c.pid + '&page=' + n;
  }
  function blockOf(res, html) {
    var url = res.url || '';
    if (/\/ap\/signin|\/ap\/cvf|\/account\/login|\/login\b/i.test(url)) return 'login';
    if (!res.ok) return /captcha/i.test(url) ? 'captcha' : 'http';
    if (/validateCaptcha|\/errors\/validateCaptcha|Enter the characters you see below|are you a (?:human|robot)/i.test(html.slice(0, 60000))) return 'captcha';
    return null;
  }
  async function fetchMoreReviews(site, ctx, fetchImpl, pages) {
    ctx = ctx || {}; pages = pages == null ? 3 : pages;
    var f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    var res = { reviews: [], histogram: null, pages: 0, blocked: null };
    var c = Object.assign({}, ctxFromUrl(ctx.url || (typeof location !== 'undefined' ? location.href : ''), site), ctx);
    if (!f || (site !== 'amazon' && site !== 'flipkart')) { res.blocked = 'http'; return res; }
    var parse = ctx.parse || function (h) { return new DOMParser().parseFromString(h, 'text/html'); };
    for (var n = 1; n <= pages; n++) {
      var u = reviewUrl(site, c, n);
      if (!u) { res.blocked = res.blocked || 'http'; break; }
      var r, html;
      try { r = await f(u, { credentials: 'include' }); html = await r.text(); }
      catch (e) { res.blocked = 'http'; break; }
      var b = blockOf(r, html);
      if (b) { res.blocked = b; break; }
      var doc = parse(html), got = readReviews(doc, site);
      if (!res.histogram) res.histogram = readHistogram(doc, site);
      if (!got.length) { if (n === 1) res.blocked = 'http'; break; } // empty page: end of list, or unknown layout; stop
      res.reviews = res.reviews.concat(got); res.pages = n;
      if (n < pages && c.delayMs !== 0) await new Promise(function (ok) { setTimeout(ok, c.delayMs || 400); });
    }
    return res;
  }

  // ---------- text helpers ----------
  var POS = ['mast', 'badiya', 'badhiya', 'zabardast', 'paisa vasool', 'shandar', 'acha', 'accha', 'achha', 'bahut accha', 'good', 'great', 'excellent', 'amazing', 'awesome', 'love', 'loved', 'perfect', 'best', 'nice', 'worth', 'superb', 'fantastic', 'happy', 'satisfied', 'recommend', 'recommended', 'value for money'];
  var NEG = ['bekar', 'bekaar', 'bakwas', 'ghatiya', 'kharab', 'faltu', 'paisa barbad', 'waste', 'worst', 'bad', 'poor', 'terrible', 'horrible', 'useless', 'disappointed', 'disappointing', 'defective', 'broken', 'cheap quality', 'not working', 'stopped working', 'fraud', 'regret', 'damaged', 'not good', 'not worth', 'return'];
  function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s']/g, ' ').split(/\s+/).filter(Boolean); }
  function sentiment(text) {
    var t = ' ' + words(text).join(' ') + ' ', s = 0;
    POS.forEach(function (w) { if (t.indexOf(' ' + w + ' ') >= 0) s += 1; });
    NEG.forEach(function (w) { if (t.indexOf(' ' + w + ' ') >= 0) s -= 1; });
    // simple negation: "not good", "not bad" flips
    if (/ not (good|great|nice|worth|happy|satisfied)/.test(t) && s > 0) s = -1;
    if (/ not (bad|that bad)/.test(t) && s < 0) s = 1;
    return s;
  }
  function jaccard(a, b) {
    var i = 0; a.forEach(function (x) { if (b.has(x)) i++; });
    var u = a.size + b.size - i; return u ? i / u : 0;
  }
  function shingles(w) {
    var s = new Set();
    if (w.length < 3) { s.add(w.join(' ')); return s; }
    for (var i = 0; i + 3 <= w.length; i++) s.add(w.slice(i, i + 3).join(' '));
    return s;
  }
  var pct = function (x) { return Math.round(x * 100) + '%'; };

  // ---------- signals ----------
  // Shape tests share one function so the large aggregate histogram (high confidence) and the small
  // visible sample use the same calibrated thresholds. Natural products often sit at 50-65% 5-star with
  // 5-15% 1-star and 25-40% in between; only a near-empty middle with a heavy 1-star tail, or an almost
  // uniform 5-star wall, is flagged.
  function shapeSignals(d) {
    var p5 = d[5], p1 = d[1], mid = d[2] + d[3] + d[4];
    if (p5 >= 0.6 && p1 >= 0.08 && mid <= 0.15)
      return { id: 'j_shape', label: 'Polarised ratings', severity: 'watch', detail: pct(p5) + ' are 5-star and ' + pct(p1) + ' are 1-star with only ' + pct(mid) + ' in between; a pattern sometimes seen when opinions split or ratings are unevenly collected' };
    if (p5 >= 0.92 && p1 < 0.03)
      return { id: 'all_top', label: 'Almost all 5-star', severity: 'info', detail: pct(p5) + ' of ratings are 5-star; unusually uniform' };
    return null;
  }
  function reviewSignals(reviews, agg) {
    reviews = (reviews || []).filter(function (r) { return r && r.rating >= 1 && r.rating <= 5; });
    var n = reviews.length, H = agg && agg.histogram && agg.histogram.dist ? agg.histogram : null;
    var out = { n: n, confidence: 'insufficient', signals: [], disclaimer: DISCLAIMER };
    var hTotal = H ? (H.total || 0) : 0;
    var hConf = !H ? 'insufficient' : hTotal >= 100 ? 'high' : hTotal >= 30 ? 'medium' : hTotal ? 'low' : 'low';
    var sConf = n < 8 ? 'insufficient' : n < 20 ? 'low' : n < 60 ? 'medium' : 'high';
    var rank = { insufficient: 0, low: 1, medium: 2, high: 3 };
    out.sampleConfidence = sConf; out.histogramConfidence = hConf;
    out.confidence = rank[hConf] >= rank[sConf] ? hConf : sConf;
    var sig = function (id, label, detail, severity, basis) {
      out.signals.push({ id: id, label: label, basis: basis || 'sample', severity: severity || 'watch',
        detail: detail + (basis === 'ratings' ? ' (based on ' + (hTotal ? hTotal.toLocaleString('en-IN') : 'all') + ' ratings)' : ' (sample: ' + n + ' reviews)') });
    };
    if (H && hConf !== 'low') {
      var hs = shapeSignals(H.dist); if (hs) sig(hs.id, hs.label, hs.detail, hs.severity, 'ratings');
      out.histogram = { total: H.total, avg: H.avg, dist: H.dist };
    }
    if (n < 8) { if (H && hTotal > n) out.sampleNote = n + ' reviews are readable on this page; the rating shape uses all ' + hTotal.toLocaleString('en-IN') + ' ratings.'; return out; }

    // sample-based rating shape only when no aggregate is available
    if (!H || hConf === 'low') {
      var c = [0, 0, 0, 0, 0, 0]; reviews.forEach(function (r) { c[Math.round(r.rating)]++; });
      var ss = shapeSignals({ 1: c[1] / n, 2: c[2] / n, 3: c[3] / n, 4: c[4] / n, 5: c[5] / n });
      if (ss) sig(ss.id, ss.label, ss.detail.replace(' of ratings', ' of visible reviews'), ss.severity);
    }

    // burst
    var days = {}, dated = 0;
    reviews.forEach(function (r) { if (r.date != null) { dated++; var d = Math.floor(r.date / 864e5); days[d] = (days[d] || 0) + 1; } });
    if (dated >= 8) {
      var cn = Object.keys(days).map(function (k) { return days[k]; }).sort(function (a, b) { return b - a; });
      var top1 = cn[0] / dated, top3 = (cn[0] + (cn[1] || 0) + (cn[2] || 0)) / dated;
      if ((top1 >= 0.3 && cn[0] >= 4) || (top3 >= 0.6 && cn.length > 3 && cn[0] >= 4))
        sig('burst', 'Review burst', pct(top3) + ' of ' + dated + ' dated reviews fall on just 3 days (' + cn[0] + ' on the busiest day)');
    }

    // near-duplicate wording
    var sh = reviews.map(function (r) { var w = words(r.text); return w.length >= 4 ? shingles(w) : null; });
    var inDup = {};
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++)
      if (sh[i] && sh[j] && jaccard(sh[i], sh[j]) >= 0.6) { inDup[i] = inDup[j] = 1; }
    var dn = Object.keys(inDup).length;
    if (dn >= 3 && dn / n >= 0.15)
      sig('repeated_text', 'Repeated wording', dn + ' reviews (' + pct(dn / n) + ') share near-identical wording with another review');

    // unverified
    var vk = reviews.filter(function (r) { return r.verified !== null && r.verified !== undefined; });
    if (vk.length >= n / 2) {
      var uv = vk.filter(function (r) { return !r.verified; }).length / vk.length;
      if (uv >= 0.4) sig('unverified', 'Many unverified purchases', pct(uv) + ' of ' + vk.length + ' reviews with purchase info are not marked verified', uv >= 0.6 ? 'watch' : 'info');
    }

    // short generic
    var sh4 = reviews.filter(function (r) { return words(r.text).length <= 4; }).length / n;
    if (sh4 >= 0.35) sig('short_generic', 'Many very short reviews', pct(sh4) + ' have 4 words or fewer, which gives little detail to learn from', 'info');

    // sentiment mismatch
    var mm = reviews.filter(function (r) { var s = sentiment(r.text); return (r.rating >= 4 && s <= -1) || (r.rating <= 2 && s >= 1); }).length;
    if (mm >= 2 && mm / n >= 0.1)
      sig('mismatch', 'Rating and text disagree', mm + ' reviews (' + pct(mm / n) + ') have a star rating that does not match the tone of the text');

    var tot = (agg && agg.count) || hTotal;
    if (tot > n) out.sampleNote = n + ' of about ' + tot.toLocaleString('en-IN') + ' ratings are readable; wording/date signals describe only this sample.';
    return out;
  }

  // ---------- summary ----------
  var STOP = new Set(('a an the and or but if so of to in on at for with from by as is are was were be been am it its this that these those i me my we you your he she they them their ' +
    'have has had do does did not no yes very too also just really more most much many some any all can could would should will than then there here what which who when how ' +
    'one two product item buy bought buying order ordered got get use used using day days month months time review amazon flipkart seller delivery delivered ' +
    'hai hain ka ki ke ko se me mein hi bhi aur par pe ye yeh wo woh nahi nhi tha thi the hu hoon kya bahut bohot ek tha ho hua liya liye kar karo kaafi bas abhi jo toh to ' +
    'good bad nice great best worst ok okay awesome excellent amazing superb mast acha accha bekar').split(' '));
  // Only product-attribute terms count as themes; generic words ("working", "love", "daily", "experience") never do.
  var ATTR = new Set(('battery backup life charging charger charge sound audio bass treble mic microphone call calling noise cancellation anc connectivity bluetooth pairing latency range ' +
    'quality build material plastic finish design look color colour size fit comfort comfortable weight display screen brightness resolution camera photo video ' +
    'performance speed processor lag heating heat gaming storage memory ram fabric stitching packaging price delivery warranty service sensor touch strap case cable ' +
    'awaaz taste smell flavour').split(' '));
  var VAGUE = new Set(['quality', 'life', 'backup', 'charge', 'range', 'service', 'size', 'look']); // fine inside a bigram ("build quality"), too vague alone
  // Phrases that matter in complaints but are built from stopwords/verbs; matched on raw text.
  var PHRASES = [[/\b(?:stopped|stop|not|nahi|nhi)\s+working\b/, 'stopped working'], [/\bheat(?:s|ing|ed)?\b|\boverheat/, 'heating'],
    [/\b(?:not|nahi|nhi)\s+charg/, 'not charging'], [/\bbattery\s+(?:drain|dies|dead)/, 'battery drain'], [/\bconnection\s+(?:issue|problem)s?|disconnect/, 'connectivity issues']];
  function grams(text) {
    var w = words(text).filter(function (x) { return x.length > 1; }), set = new Set(), t = ' ' + w.join(' ') + ' ';
    w.forEach(function (x, i) {
      if (ATTR.has(x) && !VAGUE.has(x)) set.add(x);
      var y = w[i + 1];
      if (y && !STOP.has(x) && !STOP.has(y) && ATTR.has(x) && ATTR.has(y)) set.add(x + ' ' + y);
    });
    PHRASES.forEach(function (p) { if (p[0].test(t)) set.add(p[1]); });
    return set;
  }
  function top(group, other, k) {
    var df = {}, odf = {};
    group.forEach(function (r) { grams(r.text).forEach(function (g) { df[g] = (df[g] || 0) + 1; }); });
    other.forEach(function (r) { grams(r.text).forEach(function (g) { odf[g] = (odf[g] || 0) + 1; }); });
    var cand = Object.keys(df).filter(function (g) { return df[g] >= 2 && df[g] / group.length > (odf[g] || 0) / Math.max(other.length, 1); })
      .sort(function (a, b) { return (df[b] * (b.indexOf(' ') > 0 ? 2.5 : 1)) - (df[a] * (a.indexOf(' ') > 0 ? 2.5 : 1)) || (a < b ? -1 : 1); });
    var picked = [];
    cand.forEach(function (g) {
      if (picked.length >= k) return;
      if (picked.some(function (p) { return p.indexOf(g) >= 0 || g.indexOf(p) >= 0; })) return;
      picked.push(g);
    });
    return picked;
  }
  function reviewSummary(reviews) {
    reviews = (reviews || []).filter(function (r) { return r && r.text; });
    var pos = reviews.filter(function (r) { return r.rating >= 4; }), neg = reviews.filter(function (r) { return r.rating <= 2; });
    return { likes: top(pos, neg, 4), dislikes: top(neg, pos, 4), n: reviews.length };
  }

  // One plain answer from the rating breakdown (or visible reviews when there is none). Wording: what buyers say, never a verdict on anyone.
  function reviewAnswer(hist, reviews, signals) {
    var avg = null, total = null, share4 = null, share1 = null, from = 'ratings';
    if (hist && hist.dist) { var mean = [1, 2, 3, 4, 5].reduce(function (a, k) { return a + k * (hist.dist[k] || 0); }, 0); avg = hist.avg && Math.abs(hist.avg - mean) <= 0.35 ? hist.avg : mean; /* the page's own average (4.1) beats the mean of rounded percentages (4.18); a wildly different parse is ignored */ total = hist.total; share4 = (hist.dist[4] || 0) + (hist.dist[5] || 0); share1 = (hist.dist[1] || 0) + (hist.dist[2] || 0); }
    else { var rs = (reviews || []).filter(function (r) { return r && r.rating >= 1 && r.rating <= 5; }); if (rs.length < 3) return null;
      avg = rs.reduce(function (a, r) { return a + r.rating; }, 0) / rs.length; total = rs.length; share4 = rs.filter(function (r) { return r.rating >= 4; }).length / rs.length; share1 = rs.filter(function (r) { return r.rating <= 2; }).length / rs.length; from = 'visible reviews'; }
    if (!avg) return null;
    var a = Math.round(avg * 10) / 10, tone, headline;
    if (share1 >= 0.2 && share4 >= 0.5 && share4 < 0.8) { tone = 'mixed'; headline = 'Buyers are divided'; }
    else if (a >= 4.2 && share4 >= 0.75) { tone = 'good'; headline = 'Buyers are mostly happy'; }
    else if (a >= 3.6) { tone = 'mixed'; headline = 'Mixed reviews'; }
    else { tone = 'bad'; headline = 'Many buyers are unhappy'; }
    var odd = signals && signals.signals ? signals.signals.filter(function (x) { return x.severity === 'watch'; }).length : 0;
    return { tone: tone, headline: headline, avg: a, total: total, from: from, pos: Math.round(share4 * 100), neg: Math.round(share1 * 100), odd: odd };
  }

  var api = { reviewAnswer: reviewAnswer, readReviews: readReviews, readHistogram: readHistogram, reviewSignals: reviewSignals, fetchMoreReviews: fetchMoreReviews, reviewSummary: reviewSummary, ctxFromUrl: ctxFromUrl };
  root.Reviews_ = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
