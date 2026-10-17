// Background price tracking: while the browser is open, re-read the price of watched items from each store's own structured data, so history grows and alerts fire
// without a visit. Pure parsers (trkParse*) + fetch (trkFetch) + scheduler (trkRun). Design: docs/internal/specs/2026-10-17-reliability-program-design.md.
// Safety: URLs are built from stored ids on an allowlisted host; a body is only a price if the product id appears in it and the number is plausible
// (captcha pages answer HTTP 200); a big jump or a crossing of the alert target must be seen twice before it is recorded.
const TRK = { BATCH: 4, MIN_MS: 6 * 3600e3, PENDING_MS: 20 * 60e3, DAY_CAP: 60, FAILS: 3, PAUSE_MS: 6 * 3600e3, JUMP: 0.4, MAX_BYTES: 3e6, TIMEOUT: 10000 };
const TRK_STORES = { "amazon.in": { name: "Amazon", host: "amazon.in" }, "flipkart.com": { name: "Flipkart", host: "flipkart.com" }, "myntra.com": { name: "Myntra", host: "myntra.com" } };
const trkNum = v => { const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(/[^\d.]/g, "")); return isFinite(n) && n >= 1 && n < 1e7 ? n : null; };
const trkDomain = key => { const d = String(key || "").split(":")[0]; return TRK_STORES[d] ? d : null; };
const trkId = key => String(key || "").slice(String(key || "").indexOf(":") + 1);
const trkCaptcha = h => /enter the characters you see|api-services-support@amazon|to discuss automated access|robot check|access denied|are you a human/i.test(String(h).slice(0, 6000));

// ---- parsers: each returns {ok, price, mrp, unavailable, reason}
function trkParseAmazon(html, asin) {
  const h = String(html || ""); if (!h) return { ok: false, reason: "empty" };
  if (trkCaptcha(h)) return { ok: false, reason: "captcha" };
  if (!h.includes(asin)) return { ok: false, reason: "wrong-page" }; // positive proof the body is about this product
  const i = h.indexOf('id="aod-pinned-offer"');
  if (i < 0) return /currently unavailable/i.test(h) ? { ok: true, unavailable: true } : { ok: false, reason: "no-offer" };
  const seg = h.slice(i, i + 50000), end = seg.search(/id="aod-offer-list"|id="aod-offer"/), pin = end > 0 ? seg.slice(0, end) : seg;
  const head = (pin.match(/id="aod-offer-heading"[\s\S]*?a-text-bold">\s*([^<]+?)\s*</) || [])[1];
  if (head && !/^new/i.test(head)) return { ok: false, reason: "not-new" };
  const m = pin.match(/apex-pricetopay-accessibility-label">\s*₹\s?([\d,]+(?:\.\d+)?)/) || pin.match(/class="a-offscreen">\s*₹\s?([\d,]+(?:\.\d+)?)</) || pin.match(/a-price-whole">([\d,]+)/), price = m ? trkNum(m[1]) : null;
  if (!price) return /currently unavailable/i.test(pin) ? { ok: true, unavailable: true } : { ok: false, reason: "no-price" };
  const mr = pin.match(/M\.R\.P\.?:?\s*₹\s?([\d,]+(?:\.\d+)?)/), mrp = mr ? trkNum(mr[1]) : null;
  return { ok: true, price, mrp: mrp && mrp > price ? mrp : null };
}
function trkParseFlipkart(html, pid) {
  const h = String(html || ""); if (!h) return { ok: false, reason: "empty" };
  if (trkCaptcha(h)) return { ok: false, reason: "captcha" };
  const st = typeof cmpStateJson === "function" ? cmpStateJson(h) : null; if (!st) return { ok: false, reason: "no-state" };
  const pc = st.multiWidgetState && st.multiWidgetState.pageDataResponse && st.multiWidgetState.pageDataResponse.pageContext;
  if (!pc || pc.productId !== pid) return { ok: false, reason: "wrong-page" };
  const ppd = pc.fdpEventTracking && pc.fdpEventTracking.events && pc.fdpEventTracking.events.psi && pc.fdpEventTracking.events.psi.ppd;
  let price = ppd && trkNum(ppd.finalPrice), mrp = ppd && trkNum(ppd.mrp);
  if (!price) { const sch = ((st.multiWidgetState.pageDataResponse.seoData || {}).schema || []).find(x => x && x.offers && x.offers.price); const o = sch && sch.offers; if (o && (!o.priceCurrency || o.priceCurrency === "INR")) price = trkNum(o.price); }
  if (!price) return { ok: true, unavailable: true };
  return { ok: true, price, mrp: mrp && mrp > price ? mrp : null };
}
function trkParseMyntra(html, id) {
  const h = String(html || ""); if (!h) return { ok: false, reason: "empty" };
  if (trkCaptcha(h)) return { ok: false, reason: "captcha" };
  const st = typeof cmpStateJson === "function" ? cmpStateJson(h, "__myx") : null, pd = st && st.pdpData; if (!pd) return { ok: false, reason: "no-state" };
  if (String(pd.id) !== String(id)) return { ok: false, reason: "wrong-page" };
  const live = (pd.sizes || []).filter(z => z && z.available), prices = [];
  for (const z of live) for (const d of z.sizeSellerData || []) if (d && d.availableCount > 0 && trkNum(d.discountedPrice)) prices.push(trkNum(d.discountedPrice));
  const price = prices.length ? Math.min(...prices) : null, base = pd.price && trkNum(pd.price.discounted);
  if (!live.length) return { ok: true, unavailable: true };
  const p = price || base; if (!p) return { ok: false, reason: "no-price" };
  const mrp = trkNum(pd.mrp);
  return { ok: true, price: p, mrp: mrp && mrp > p ? mrp : null };
}

// ---- fetch: URL built from ids on an allowlisted host; redirects must stay on the host; the body is checked by the parser
async function trkFetch(key, it, doFetch = fetch) {
  const dom = trkDomain(key), id = trkId(key); if (!dom) return { ok: false, reason: "unsupported" };
  let url;
  if (dom === "amazon.in") { if (!/^[A-Z0-9]{10}$/.test(id)) return { ok: false, reason: "bad-id" }; url = `https://www.amazon.in/gp/product/ajax/aodAjaxMain/ref=dp_aod_ALL_mbc?asin=${id}&pc=dp&experienceId=aodAjaxMain`; }
  else { try { const u = new URL(it && it.url); if (u.protocol !== "https:" || !(u.hostname === dom || u.hostname.endsWith("." + dom))) return { ok: false, reason: "bad-url" }; url = u.origin + u.pathname + (dom === "flipkart.com" ? "?pid=" + id : ""); } catch { return { ok: false, reason: "bad-url" }; } }
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TRK.TIMEOUT);
  try {
    const r = await doFetch(url, { credentials: "include", signal: ctl.signal, redirect: "follow", headers: dom === "amazon.in" ? { "x-requested-with": "XMLHttpRequest" } : {} });
    if (r.url && !new RegExp("^https://([a-z0-9-]+\\.)*" + dom.replace(".", "\\.") + "/").test(r.url)) return { ok: false, reason: "redirect" };
    if (r.status === 403 || r.status === 429 || r.status === 503) return { ok: false, reason: "blocked-" + r.status };
    if (!r.ok) return { ok: false, reason: "http-" + r.status };
    if (+(r.headers && r.headers.get && r.headers.get("content-length") || 0) > TRK.MAX_BYTES) return { ok: false, reason: "too-large" };
    const body = (await r.text()).slice(0, TRK.MAX_BYTES);
    return dom === "amazon.in" ? trkParseAmazon(body, id) : dom === "flipkart.com" ? trkParseFlipkart(body, id) : trkParseMyntra(body, id);
  } catch (e) { return { ok: false, reason: e && e.name === "AbortError" ? "timeout" : "network" }; } finally { clearTimeout(t); }
}

// ---- applying a reading (inside the state lock; one item; no network here)
// -> "recorded" | "unchanged" | "held" | "skipped"
async function trkApply(key, res, now = Date.now()) {
  const items = await get(), it = items[key]; if (!it) return "skipped";
  it.checked = now;
  if (!res.ok || res.unavailable) { await put(items); return "skipped"; }
  const price = res.price, last = it.hist.length ? it.hist[it.hist.length - 1][1] : null, near = (a, b) => Math.abs(a - b) / b <= 0.02;
  let confirmed = false;
  if (last && Math.abs(price - last) / last > TRK.JUMP) { // a huge move may be a captcha/variant/pincode artefact: needs a second matching read
    if (it.suspect && near(price, it.suspect.price)) { delete it.suspect; confirmed = true; } else { it.suspect = { price, at: now }; await put(items); return "held"; }
  } else delete it.suspect;
  if (it.target > 0 && price <= it.target && last > it.target) { // crossing the alert line: confirm before recording (and alerting)
    if (confirmed || (it.pending && near(price, it.pending.price))) delete it.pending; else { it.pending = { price, at: now }; await put(items); return "held"; }
  } else delete it.pending;
  if (last === price) { if (res.mrp) it.mrp = res.mrp; await put(items); return "unchanged"; } // same price: no new point (keeps storage flat); `checked` shows it is fresh
  await put(items);
  await record({ key, site: it.site, url: it.url, price, mrp: res.mrp || undefined, src: "bg" });
  return "recorded";
}

// ---- scheduler: a few items per run, persisted cursor, per-domain caps and backoff, health counters
const trkDay = now => new Date(now).toISOString().slice(0, 10);
async function trkRun(now = Date.now(), doFetch = fetch) {
  const st = (await chrome.storage.local.get("trk")).trk || {}, T = { cursor: st.cursor || 0, day: st.day || "", counts: st.counts || {}, fails: st.fails || {}, pause: st.pause || {}, health: st.health || {} };
  if (T.day !== trkDay(now)) { T.day = trkDay(now); T.counts = {}; }
  const save = () => chrome.storage.local.set({ trk: T }), items = await get(), out = { checked: 0, recorded: 0, held: 0, failed: 0, skipped: 0 };
  const keys = Object.keys(items).filter(k => trkDomain(k) && (items[k].target || items[k].wish)).sort();
  const due = keys.filter(k => now - (items[k].checked || 0) >= (items[k].pending || items[k].suspect ? TRK.PENDING_MS : TRK.MIN_MS));
  const start = T.cursor % Math.max(due.length, 1), order = [...due.slice(start), ...due.slice(0, start)];
  for (const key of order) {
    if (out.checked >= TRK.BATCH) break;
    const dom = trkDomain(key), H = T.health[dom] ||= { ok: 0, fail: 0, held: 0, unavailable: 0, last: 0, reasons: {} };
    if ((T.pause[dom] || 0) > now || (T.counts[dom] || 0) >= TRK.DAY_CAP) { out.skipped++; continue; }
    T.counts[dom] = (T.counts[dom] || 0) + 1; out.checked++; T.cursor++;
    const res = await trkFetch(key, items[key], doFetch); H.last = now;
    if (!res.ok) { H.fail++; H.reasons[res.reason] = (H.reasons[res.reason] || 0) + 1; out.failed++; T.fails[dom] = (T.fails[dom] || 0) + 1; if (T.fails[dom] >= TRK.FAILS) { T.pause[dom] = now + TRK.PAUSE_MS; T.fails[dom] = 0; } await save(); continue; }
    T.fails[dom] = 0; if (res.unavailable) H.unavailable++; else H.ok++;
    const r = await withLock(() => trkApply(key, res, now)).catch(() => "skipped"); if (r === "recorded") out.recorded++; else if (r === "held") { out.held++; H.held++; }
    await save();
  }
  await save(); return out;
}
if (typeof module !== "undefined") module.exports = { trkParseAmazon, trkParseFlipkart, trkParseMyntra, trkFetch, TRK };
