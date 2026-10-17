(() => {
  const u = new URL(location.href), dom = siteFor(u.hostname), S = dom ? SITES[dom] : null;
  if (window.__hauls) return;
  const GROCERY = /(^|\.)blinkit\.com$/.test(u.hostname);
  const SHOP = !S && !GROCERY && typeof Shopify_ !== "undefined" && Shopify_.isShopifyDocument(document) && !!Shopify_.productHandle(location.href);
  const APP = !!window.HAULS_APP; // home.html: the same panel as a full page (Grocery + Watchlist), always open
  if (!S && !GROCERY && !SHOP && !APP) return;
  window.__hauls = 1;
  const q = sels => { for (const s of sels) { const e = document.querySelector(s); if (e && e.textContent.trim()) return e.textContent; } };
  const meta = p => document.querySelector(`meta[property="${p}"],meta[name="${p}"]`)?.content;

  // Generic MRP: a line-through "₹1,999" shown near the price (Flipkart/Myntra/Ajio hash their class names, so selectors don't work).
  function strikePrice(price) {
    let best = null; const scope = document.querySelector("main, [role=main], #centerCol, #dp-container") || document.body;
    let seen = 0;
    for (const e of scope.querySelectorAll("span,div,s,del")) {
      if (e.children.length > 1) continue; if (++seen > 1500) break; const t = e.textContent.trim(); if (t.length > 14 || !/^₹\s?[\d,]+(\.\d+)?$/.test(t)) continue;
      if (!getComputedStyle(e).textDecorationLine.includes("line-through")) continue;
      const v = num(t); if (v && v > price && v < price * 12 && (!best || v < best)) best = v;
    }
    return best;
  }

  // Who sells and ships this item, as the page states it (Amazon layouts + generic JSON-LD). Text only; nothing is fetched.
  function readSeller() {
    const t = sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, " ").trim() : ""; };
    const link = document.querySelector("#sellerProfileTriggerId"), name = t("#sellerProfileTriggerId") || t('[offer-display-feature-name="desktop-merchant-info"] .offer-display-feature-text');
    const ships = t('[offer-display-feature-name="desktop-fulfiller-info"] .offer-display-feature-text') || "", text = t("#merchant-info");
    let ld = ""; if (!name && !text) { for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { const m = s.textContent.match(/"seller"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]{2,80})"/); if (m) { ld = m[1]; break; } } }
    const out = { name: name || ld, ships, text, href: link ? (link.getAttribute("href") || "") : "" };
    return out.name || out.text ? out : null;
  }

  // Best "Buy for ₹X" (with offers / + cashback) the page itself shows. Leaf text only, below the listed price, never invented.
  function readOfferPrice(price) {
    let best = null; for (const e of document.querySelectorAll("#ppd span, #ppd div, #centerCol span, #centerCol div")) { if (e.children.length) continue; const m = e.textContent.trim().match(/^Buy for\s*₹\s*([\d,]+(?:\.\d+)?)/i); if (!m) continue; const v = num(m[1]); if (v && v < price && v > price * 0.5 && (!best || v < best)) best = v; }
    return best;
  }
  // Brand of the product on this page (needed for matching: Amazon titles often omit it). Byline, spec table, JSON-LD, else the title's first word.
  function readBrand(title) {
    const t = sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, " ").trim() : ""; };
    let b = ""; const by = t("#bylineInfo, #brand, a#bylineInfo");
    b = (by.match(/Visit the (.+?) Store/i) || by.match(/Brand:\s*(.+)/i) || [])[1] || "";
    if (!b) for (const tr of document.querySelectorAll("#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .prodDetTable tr, #detailBullets_feature_div li")) { const m = tr.textContent.replace(/\s+/g, " ").trim().match(/^Brand(?: Name)?\s*[:‎‏]?\s*(.{1,40})$/i); if (m) { b = m[1]; break; } }
    if (!b) for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { const m = s.textContent.match(/"brand"\s*:\s*(?:\{[^}]*?"name"\s*:\s*"([^"]{1,60})"|"([^"]{1,60})")/); if (m) { b = m[1] || m[2]; break; } }
    if (!b && dom !== "amazon.in") b = String(title || "").trim().split(/\s+/)[0] || "";
    return b.replace(/[‎‏]/g, "").slice(0, 60);
  }

  // Manufacturer model / part number as the page states it ("Item model number", "Manufacturer Part Number", JSON-LD mpn): the strongest free identifier.
  function readMpn() {
    for (const tr of document.querySelectorAll("#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .prodDetTable tr, #detailBullets_feature_div li")) { const m = tr.textContent.replace(/\s+/g, " ").replace(/[‎‏]/g, "").trim().match(/^(?:Item model number|Model Number|Manufacturer Part Number|Part Number)\s*[:]?\s*([A-Za-z0-9][A-Za-z0-9\-\/\. ]{3,38})$/i); if (m) return m[1].trim(); }
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { const m = s.textContent.match(/"mpn"\s*:\s*"([^"]{4,40})"/); if (m) return m[1]; }
    return "";
  }

  function extract() {
    const u = new URL(location.href), id = S && S.id(u);
    if (!id) return null;
    let ldMrp = null, src = "dom", price = num(q(S.price)), title = q(S.title)?.trim(), image = document.querySelector(S.image[0] || "x")?.src;
    if (!price) { const ld = parseLd([...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.outerHTML).join("")); if (ld) { src = "jsonld"; price = ld.price; title = title || ld.title; image = image || ld.image; ldMrp = ld.mrp; } }
    if (!price) { price = num(meta("product:price:amount") || meta("og:price:amount")); src = "meta"; }
    if (!price) return null;
    return { key: `${dom}:${id}`, site: S.name, url: u.origin + u.pathname + (dom === "flipkart.com" ? `?pid=${id}` : ""),
      title: title || meta("og:title") || document.title, image: image || meta("og:image"), price, mrp: num(q(S.mrp)) || (ldMrp > price ? ldMrp : null) || strikePrice(price), src, seller: readSeller(), brand: readBrand(title || meta("og:title") || document.title), mpn: readMpn() || undefined };
  }


  const T = TT.s, el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const P = { bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', out: '<path d="M7 17 17 7M8 7h9v9"/>', heart: '<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 2.7 5 6.1 5c2 0 3.4 1.1 4.2 2.4h3.4C14.5 6.1 15.9 5 17.9 5c3.4 0 5.2 3.5 3.7 6.8C19.5 16.4 12 21 12 21z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', swap: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', checkc: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>', sync: '<path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4"/>', pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>', bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>', trend: '<path d="M3 17l6-6 4 4 8-8"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>', download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', sync: '<path d="M20 11a8 8 0 0 0-14-4M4 5v4h4M4 13a8 8 0 0 0 14 4M20 19v-4h-4"/>', cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9z"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' };
  const ico = n => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2.2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true"); s.innerHTML = P[n]; return s; };
  const LOGO = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><circle cx="512" cy="512" r="480" fill="#0754F8"/><g transform="translate(197 197) scale(1.79)"><g transform="translate(16 16)" fill="#fff"><path d="M16 64 112 0v128h64L16 256Z"/><path d="m176 96 128-64v224l-128 64Z"/></g></g></svg>';
  const logoEl = cls => { const d = el("span", cls); d.innerHTML = LOGO; return d; };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const burst = node => { if (reduce) return; const r = el("i", "rp"); node.append(r); setTimeout(() => r.remove(), 700); };
  const countUp = (node, to) => { if (reduce) return void (node.textContent = fmt(to)); const t0 = performance.now(), f = t => { const k = Math.min(1, (t - t0) / 500); node.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); };
  const STORE_C = c => c || "#999";

  const dshort = t => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  // Semi-ring gauge (5 colour bands + needle + number), DOM only. Shared by the Deal Scanner and the seller card.
  const gaugeEl = (score, caption, w = 120) => {
    const g = el("div", "gauge"), NS = "http://www.w3.org/2000/svg", mk = (tag, at) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); return e; }, svg = mk("svg", { viewBox: "0 0 100 58", "aria-hidden": "true" });
    const ang = Math.PI * (1 - score / 100), nx = 50 + 36 * Math.cos(ang), ny = 50 - 36 * Math.sin(ang);
    ["#E5484D", "#F5A524", "#FFD93D", "#7ED957", "#19B968"].forEach((c, i) => { const a0 = Math.PI * (1 - i / 5), a1 = Math.PI * (1 - (i + 1) / 5), pt = (a, r) => `${50 + r * Math.cos(a)} ${50 - r * Math.sin(a)}`; svg.append(mk("path", { d: `M${pt(a0, 42)} A42 42 0 0 1 ${pt(a1, 42)}`, stroke: c, "stroke-width": 9, fill: "none" })); });
    svg.append(mk("line", { x1: 50, y1: 50, x2: nx, y2: ny, stroke: "#131316", "stroke-width": 3, "stroke-linecap": "round" }), mk("circle", { cx: 50, cy: 50, r: 4.5, fill: "#fff", stroke: "#131316", "stroke-width": 2.5 }));
    svg.style.width = w + "px"; svg.style.height = Math.round(w * 0.58) + "px"; g.style.width = w + "px"; const gn = el("div", "gnum num", String(score)); if (caption) gn.append(el("small", "", caption)); g.append(svg, gn); return g;
  };
  // Small rating dot for rows: green/amber/red ring by seller rating (grey when unknown).
  const ratingDot = (rating, ratings) => { const d = el("i", "rdot"); d.style.setProperty("--c", !rating ? "#B9B9C4" : rating >= 4 ? "#19B968" : rating >= 3 ? "#F5A524" : "#E5484D"); d.title = rating ? `Seller ${rating}★ (${ratings})` : "No seller rating"; return d; };
  // The shared (community) chart for this product: rows {day, price, reporters} -> points. Ignored when its last price is far from the price on this page (stale or wrong product).
  const sharedChart = (rows, price) => { const pts = (rows || []).map(r => [Date.parse(r.day + "T12:00:00Z"), r.price]).filter(x => x[0] > 0 && x[1] > 0).sort((a, b) => a[0] - b[0]); if (pts.length < 6) return { points: [], n: 0 }; // a thin series draws a misleading line
    const age = Math.floor((Date.now() - pts[pts.length - 1][0]) / 864e5); if (age > 14 || Math.abs(pts[pts.length - 1][1] - price) / price > 0.08) return { points: [], n: 0 }; return { points: pts, n: Math.max(...(rows || []).map(r => r.reporters || 1)), age: Math.max(0, age) }; };
  // All ranges Amazon's chart has shown us for this product, as one series (finer/newer ranges win on overlap).
  const ahPoints = ah => { if (!ah || !ah.ranges) return []; const pts = []; for (const k of ["1Y", "3M", "1M"]) { const r = ah.ranges[k]; if (r) for (const p of r.points) pts.push(p); } pts.sort((a, b) => a[0] - b[0]); const out = []; for (const p of pts) { const l = out[out.length - 1]; if (l && p[0] - l[0] < 12 * 3600e3) { out[out.length - 1] = p; continue; } if (!l || l[1] !== p[1] || p[0] - l[0] > 6 * 864e5) out.push(p); } return out; };
  // Impulse Check input: only the parts of the page that describe THIS product's stock, deal and popularity. Never reviews, Q&A, carousels or other sellers.
  const urgSent = {}, IMP_ZONES = { "amazon.in": { stock: ["#availability"], deal: ["#dealBadge_feature_div", "#apex_desktop", "#corePrice_feature_div"], bought: ["#socialProofingAsinFaceout_feature_div"] } };
  const visText = e => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), out = []; for (let n = w.nextNode(); n; n = w.nextNode()) { const pe = n.parentElement; if (pe && !pe.closest("style,script,noscript,.aok-hidden,[hidden]")) out.push(n.nodeValue); } return out.join(" "); }; // what the shopper can read: no hidden template labels
  const impCollect = () => { const z = IMP_ZONES[dom]; if (!z) return []; const parts = []; for (const [zone, sels] of Object.entries(z)) for (const q2 of sels) { const e = document.querySelector(q2); if (e && !(e.closest && e.closest(HISTORY_UNTRUSTED))) parts.push({ zone, text: visText(e).slice(0, 600) }); } return parts; };
  // Same frame as the step chart for when only a range is known (no series yet): the band between Amazon's low and high, and today's price on it. Nothing in between is drawn because nothing in between is known.
  const bandChart = (ref, price) => {
    const lo = Math.min(ref.low, price), hi = Math.max(ref.high, price), W = 300, L = 6, R = 294, T = 14, B = 76, Y = v => hi === lo ? (T + B) / 2 : B - (v - lo) / (hi - lo) * (B - T), cw = el("div", "cw bandc");
    const NS = "http://www.w3.org/2000/svg", mk = (tag, at) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); return e; }, svg = mk("svg", { viewBox: `0 0 ${W} 90`, role: "img", "aria-label": `Range ${fmt(ref.low)} to ${fmt(ref.high)}, now ${fmt(price)}` }), dash = y => mk("line", { x1: L, x2: R, y1: y, y2: y, stroke: "var(--ink-3)", "stroke-dasharray": "4 4" });
    svg.append(mk("rect", { x: L, y: Y(ref.high), width: R - L, height: Math.max(2, Y(ref.low) - Y(ref.high)), rx: 6, fill: "var(--mint)", opacity: ".35" }), dash(Y(ref.high)), dash(Y(ref.low)), mk("circle", { cx: R, cy: Y(price), r: 6, fill: "var(--surface)", stroke: "var(--ink)", "stroke-width": 3 })); cw.append(svg);
    cw.append(el("span", "yl t num", fmt(ref.high)), el("span", "yl b num", fmt(ref.low)));
    const out = el("div"), xl = el("div", "xl"); xl.append(el("span", "", `${ref.days} days ago`), el("span", "", "Today")); out.append(cw, xl, el("p", "meta", `Range shown on this page for the last ${ref.days} days. The day-by-day line appears once Amazon's chart has been read.`)); return out;
  };
  // Step chart: a price holds until the next observation, and the last price is extended to today.
  const chart = (h, now = Date.now(), win = "") => {
    if (h.length === 1 && win) return el("p", "meta num", `No price change recorded in the last ${win}: ${fmt(h[0][1])}.`);
    if (h.length < 2) return el("p", "meta", h.length ? `Tracking since ${dshort(h[0][0])}. Revisit to build the trend.` : "No history in this range yet.");
    const t0 = h[0][0], t1 = Math.max(now, h[h.length - 1][0]), span = (t1 - t0) || 1, ps = h.map(x => x[1]), lo = Math.min(...ps), hi = Math.max(...ps), W = 300, L = 6, R = 294, T = 14, B = 76;
    const X = t => L + (t - t0) / span * (R - L), Y = p => hi === lo ? (T + B) / 2 : B - (p - lo) / (hi - lo) * (B - T), f = n => n.toFixed(1);
    let d = `M${f(X(h[0][0]))},${f(Y(h[0][1]))}`; for (let i = 1; i < h.length; i++) d += ` L${f(X(h[i][0]))},${f(Y(h[i - 1][1]))} L${f(X(h[i][0]))},${f(Y(h[i][1]))}`; d += ` L${R},${f(Y(h[h.length - 1][1]))}`;
    const mi = ps.indexOf(lo), cw = el("div", "cw"), tip = el("div", "tip");
    cw.innerHTML = `<svg viewBox="0 0 ${W} 90" role="img" aria-label="Price history, ${fmt(lo)} to ${fmt(hi)}"><path class="ln" pathLength="1" d="${d}" fill="none" style="stroke:var(--ink)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <line class="vl" y1="${T}" y2="${B}" style="stroke:var(--ink-3);opacity:0" stroke-dasharray="3 3"/><circle class="hv" r="4.5" style="fill:var(--surface);stroke:var(--ink);opacity:0" stroke-width="2.5"/>
      <circle cx="${f(X(h[mi][0]))}" cy="${f(Y(lo))}" r="5" style="fill:var(--mint);stroke:var(--ink)" stroke-width="2.5"/></svg>`;
    if (hi !== lo) cw.append(Object.assign(el("span", "yl t num", fmt(hi))));
    cw.append(el("span", "yl b num", fmt(lo)), tip);
    const svg = cw.firstChild, vl = svg.querySelector(".vl"), hv = svg.querySelector(".hv");
    const at = e => { const r = svg.getBoundingClientRect(), fx = Math.max(L, Math.min(R, (e.clientX - r.left) / r.width * W)), t = t0 + (fx - L) / (R - L) * span; let i = 0; while (i + 1 < h.length && h[i + 1][0] <= t) i++;
      const x = X(Math.max(h[i][0], t0)), y = Y(h[i][1]); vl.setAttribute("x1", fx); vl.setAttribute("x2", fx); vl.style.opacity = 1; hv.setAttribute("cx", fx); hv.setAttribute("cy", y); hv.style.opacity = 1;
      tip.textContent = `${fmt(h[i][1])} · ${dshort(Math.min(t, t1))}`; tip.style.left = Math.max(15, Math.min(85, fx / W * 100)) + "%"; cw.classList.toggle("touch", e.pointerType === "touch"); };
    svg.addEventListener("pointermove", at); svg.addEventListener("pointerdown", at);
    svg.addEventListener("pointerleave", () => { vl.style.opacity = 0; hv.style.opacity = 0; cw.classList.remove("touch"); });
    const out = el("div"), xl = el("div", "xl"); xl.append(el("span", "", dshort(t0)), el("span", "", "Today")); out.append(cw, xl); return out;
  };

  const host = document.createElement("div"); host.id = "hauls-root";
  const sr = host.attachShadow({ mode: "closed" }), sh = sr;
  const wrap = el("div", "w"), knob = el("button", "knob"), kd = el("span", "delta num");
  { const kr = el("span", "krow"); kr.append(logoEl("mark"), el("i", "grip")); knob.append(kr, kd); } knob.title = "HAULS · drag to move"; knob.setAttribute("aria-label", T.open); knob.setAttribute("aria-expanded", "false");
  const panel = el("aside", "panel"); panel.setAttribute("aria-label", T.brand); panel.setAttribute("role", "dialog"); panel.tabIndex = -1;
  const hdr = el("header"), hd = el("div", "hd"), tt = el("div"), rt = el("div", "r"), pinChip = el("button", "pinchip"), close = el("button", "x"); close.append(ico("x")); close.setAttribute("aria-label", T.close);
  { const br = el("div", "brand"), nm = el("div"); nm.append(el("h1", "", T.brand), el("div", "sub", T.sub)); br.append(logoEl("logo"), nm); tt.append(br); } const acctBtn = el("button", "x acct"); acctBtn.setAttribute("aria-label", "Account"); acctBtn.append(ico("user")); rt.append(pinChip, acctBtn, close); hd.append(tt, rt);
  const tabs = el("div", "tabs"); tabs.setAttribute("role", "tablist");
  const main = el("main"); main.setAttribute("tabindex", "-1");
  const scrim = el("div", "scrim"), sheet = el("div", "sheet");
  hdr.append(hd, tabs); panel.append(hdr, main, scrim, sheet); wrap.append(knob, panel);
  sr.append(el("style", "", TT.css), wrap);

  let range = "90D"; chrome.storage.local.get("range").then(s => { if (s.range) range = s.range; });
  const RANGES = [["30D", 30], ["90D", 90], ["1Y", 365], ["All", 0]];
  let cur = null, loading = !!(S || SHOP), tab = S || SHOP ? "product" : "grocery";
  const TABS = APP ? ["grocery", "traps"] : ["product", "grocery", "traps"];
  let sheetOpener = null;
  const closeSheet = () => { wrap.classList.remove("sheetopen"); sheet.setAttribute("aria-hidden", "true"); if (sheetOpener && sheetOpener.isConnected) sheetOpener.focus({ preventScroll: true }); sheetOpener = null; };
  const openSheet = (title, nodes) => { sheetOpener = sheetOpener || sh.activeElement; const h = el("h4", "", title); h.tabIndex = -1; const cx = el("button", "x"); cx.append(ico("x")); cx.setAttribute("aria-label", "Close"); cx.onclick = closeSheet; const head = el("div", "sheet-h"); head.append(h, cx); sheet.replaceChildren(head, ...nodes); sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", title); sheet.removeAttribute("aria-hidden"); wrap.classList.add("sheetopen"); setTimeout(() => h.focus({ preventScroll: true }), 50); };
  scrim.onclick = closeSheet;
  const setOpen = o => { wrap.classList.toggle("open", o); if (!o) closeSheet(); knob.setAttribute("aria-expanded", String(o)); if (o) { draw(); setTimeout(() => panel.focus({ preventScroll: true }), 60); } else knob.focus({ preventScroll: true }); };
  const toggle = () => setOpen(!wrap.classList.contains("open"));
  close.onclick = () => setOpen(false);
  if (APP) { wrap.classList.add("app"); close.className = "pinchip"; close.replaceChildren(ico("gear"), "Settings"); close.setAttribute("aria-label", "Settings"); close.title = "Settings"; close.onclick = () => chrome.runtime.sendMessage({ type: "open-options" }); }
  // Draggable notch: vertical position is remembered. A drag never counts as a click.
  let knobTop = 0, drag = null, moved = false;
  const clampTop = y => Math.max(8, Math.min(innerHeight - knob.offsetHeight - 8, y));
  const applyTop = y => { knobTop = clampTop(y); knob.style.top = knobTop + "px"; };
  chrome.storage.local.get("knobY").then(s => applyTop((s.knobY != null ? s.knobY : innerWidth <= 600 ? .62 : .38) * innerHeight));
  addEventListener("resize", () => applyTop(knobTop));
  const saveTop = () => chrome.storage.local.set({ knobY: knobTop / innerHeight });
  knob.addEventListener("pointerdown", e => { drag = { y: e.clientY, top: knobTop }; moved = false; knob.setPointerCapture(e.pointerId); });
  knob.addEventListener("pointermove", e => { if (!drag) return; const dy = e.clientY - drag.y; if (Math.abs(dy) > 4) { moved = true; knob.classList.add("drag"); } if (moved) applyTop(drag.top + dy); });
  const endDrag = () => { if (!drag) return; drag = null; knob.classList.remove("drag"); if (moved) { saveTop(); setTimeout(() => { moved = false; }, 0); } };
  knob.addEventListener("pointerup", endDrag); knob.addEventListener("pointercancel", endDrag);
  knob.addEventListener("click", () => { if (!moved) toggle(); });
  knob.addEventListener("keydown", e => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); applyTop(knobTop + (e.key === "ArrowUp" ? -28 : 28)); saveTop(); } });
  // Keep keystrokes inside the panel: sites bind hotkeys (e.g. "/" to search) that would otherwise steal typing.
  ["keydown", "keyup", "keypress", "input", "beforeinput", "compositionstart", "compositionupdate", "compositionend"].forEach(t => wrap.addEventListener(t, e => { e.stopPropagation(); if (t === "keydown" && e.key === "Escape") { if (wrap.classList.contains("sheetopen")) closeSheet(); else setOpen(false); } }));
  chrome.runtime.onMessage.addListener(m => { if (m.type === "toggle") toggle(); });
  pinChip.onclick = async () => { tab = "grocery"; await draw(); const i = sr.querySelector(".pi input"); if (i) { i.focus(); i.select(); } }; // tap the pincode chip to edit the delivery pincode
  // S6: follow changes made elsewhere (sync from another device, another tab) without a reload.
  let whoHook = () => {}, pinHook = () => {};
  chrome.storage.onChanged.addListener((ch, area) => { if (area !== "local") return; const a = sr.activeElement, fc = !!(ch.items && cur && cur.it && cur.p && (n => n.wish !== !!cur.it.wish || n.target !== cur.it.target)(withStoredFlags(cur.it, safeItems(ch.items.newValue), cur.p.key))), u = liveUpdate(ch, { tab, range, flagsChanged: fc, typing: !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName) });
    if (u.pin !== undefined) { pinChip.replaceChildren(ico("pin"), u.pin || "Pin"); pinHook(u.pin); } if (u.range) range = u.range; if (u.who) whoHook(); if (u.redraw) draw(); });

  const idleRedraw = () => { const a = sr.activeElement; if (canRedraw({ open: wrap.classList.contains("open"), tab, typing: !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName) })) draw(); };
  // Draws run one after another: two overlapping draws each appended their rows after an await, which doubled the watchlist.
  let drawQ = Promise.resolve(); const draw = () => (drawQ = drawQ.then(drawNow, drawNow));
  async function drawNow() {
    tabs.style.setProperty("--i", TABS.indexOf(tab));
    tabs.replaceChildren(el("i"), ...TABS.map(k => { const b = el("button", "", T.tabs[k]); b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(k === tab)); b.tabIndex = k === tab ? 0 : -1; b.onclick = () => { if (tab !== k) { tab = k; draw(); } }; b.onkeydown = e => { const i = TABS.indexOf(k), n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (n) { e.preventDefault(); tab = TABS[(i + n + TABS.length) % TABS.length]; draw().then(() => { const t2 = tabs.querySelectorAll("button")[TABS.indexOf(tab)]; if (t2) t2.focus(); }); } }; return b; }));
    const { pin } = await chrome.storage.local.get("pin"); pinChip.replaceChildren(ico("pin"), pin || "Pin");
    main.replaceChildren(); main.scrollTop = 0;
    try { await (tab === "product" ? drawProduct : tab === "grocery" ? drawGrocery : drawTraps)(); }
    catch (e) { main.replaceChildren(); const w = el("div", "vcard wait"), rt2 = el("button", "btn", "Retry"); w.append(el("span", "vl", "Something went wrong. Your data is safe.")); rt2.onclick = () => draw(); main.append(w, rt2); }
    [...main.children].forEach((c, i) => c.style.setProperty("--n", Math.min(i, 8)));
  }

  const send = m => chrome.runtime.sendMessage(m);
  // Real user-activation (not a constant): privileged actions are only honoured after the user has interacted with the page.
  const gesture = () => !!(navigator.userActivation ? navigator.userActivation.hasBeenActive : true);
  // Price stepper: − / typed amount / +, hold to repeat, validated against the current price. onSave(value) resolves to an error string or null.
  function stepper({ value, price, onSave, autosave = true }) {
    const root = el("div", "stp"), box = el("div", "stp-box"), msg = el("div", "stp-msg"), tick = el("span", "stp-tick"), minus = el("button", "stp-b"), plus = el("button", "stp-b"), pre = el("label", "stp-in"), inp = el("input");
    minus.append(ico("minus")); plus.append(ico("plus")); minus.setAttribute("aria-label", "Decrease trap price"); plus.setAttribute("aria-label", "Increase trap price"); tick.append(ico("check"), "Saved");
    inp.inputMode = "numeric"; inp.value = String(value); inp.setAttribute("aria-label", "Trap price"); pre.append("₹", inp);
    let saved = value, timer = null, hold = null; const step = trapStep(price);
    const show = m => { msg.textContent = m || ""; root.classList.toggle("bad", !!m); };
    const commit = async () => { clearTimeout(timer); const v = validateTrap(inp.value, price); if (!v.ok) return show(v.msg); show(""); if (v.value === saved) return; inp.value = String(v.value);
      const err = await onSave(v.value); if (err) return show(err); saved = v.value; tick.classList.add("on"); setTimeout(() => tick.classList.remove("on"), 1500); };
    const queue = () => { clearTimeout(timer); const v = validateTrap(inp.value, price); if (!v.ok) return show(v.msg); show(""); if (autosave) timer = setTimeout(commit, 600); };
    const bump = d => { const raw = parseFloat(String(inp.value).replace(/[₹,\s]/g, "")), base = isFinite(raw) ? raw : saved; inp.value = String(Math.max(1, Math.round(base / step) * step + d * step)); queue(); };
    [[minus, -1], [plus, 1]].forEach(([b, d]) => { b.addEventListener("pointerdown", e => { e.preventDefault(); bump(d); hold = setTimeout(() => { hold = setInterval(() => bump(d), 90); }, 420); });
      ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, () => { clearTimeout(hold); clearInterval(hold); hold = null; }));
      b.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); bump(d); } }); });
    inp.addEventListener("input", queue); inp.addEventListener("blur", () => { if (autosave) commit(); });
    inp.addEventListener("keydown", e => { if (e.key === "ArrowUp") { e.preventDefault(); bump(1); } else if (e.key === "ArrowDown") { e.preventDefault(); bump(-1); } else if (e.key === "Enter") commit(); });
    box.append(minus, pre, plus); root.append(box, msg, tick);
    return { el: root, commit, get value() { return validateTrap(inp.value, price); }, show };
  }
  const LIMIT_MSG = "Watchlist limit reached on your plan";
  // Trap box on the product tab: set once, then edit (autosave) or remove right here.
  function trapEditor(p, it) {
    const tb = el("div", "trapbox"), save = async v => { const r = await send({ type: "track", key: p.key, target: v }); if (r && r.error) return LIMIT_MSG; it.target = v; lbl.lastChild.textContent = ` Trap set at ${fmt(v)}`; return null; };
    const lbl = el("p", "lbl"); lbl.append(ico("bell"), el("span")); lbl.lastChild.textContent = it.target ? ` Trap set at ${fmt(it.target)}` : " Set trap price";
    const start = it.target || Math.max(1, Math.floor(p.price * 0.95)), st = stepper({ value: start, price: p.price, autosave: !!it.target, onSave: save }), row = el("div", "stp-row"); row.append(st.el);
    if (it.target) { const rm = el("button", "link-btn", "Remove"); rm.onclick = async () => { await send({ type: "untrack", key: p.key }); delete it.target; draw(); }; row.append(rm); }
    else { const set = el("button", "btn", "Set"); set.append(ico("arrow")); set.onclick = async () => { const v = st.value; if (!v.ok) return st.show(v.msg); const err = await save(v.value); if (err) return st.show(err); burst(set); draw(); }; row.append(set); }
    tb.append(lbl, row); return tb;
  }

  const note = (t, ...rest) => { const n = el("div", "note"); n.append(el("b", "", t), ...rest); return n; };

  async function drawProduct() {
    if (loading) { ["64px", "56px", "110px", "52px"].forEach(h => { const s = el("div", "sk"); s.style.setProperty("--h", h); main.append(s); }); return; }
    if (!cur && unreadable) { const n = el("div", "quiet"); n.append(el("b", "", "Couldn't read this page's price"), "HAULS found the product but not its price. The page layout may be new. Try reloading; if it keeps happening, the Grocery and Watchlist tabs still work."); const rb = el("button", "btn ghost", "Try again"); rb.onclick = () => { tries = 0; unreadable = false; loading = true; draw(); run(); }; return main.append(n, rb); }
    if (!cur) return main.append(el("p", "empty", T.emptyProduct));
    if (cur.limited) { main.append(el("div", "vcard wait", ""), quotaRow()); main.firstChild.append(el("span", "vl", `All ${cur.limit} free lookups used this month. Saved items still update.`)); return; }
    cur.it = withStoredFlags(cur.it, safeItems((await chrome.storage.local.get("items")).items), cur.p.key);
    const { p, it } = cur, ahp = ahPoints(it.ahist), cch = sharedChart(cur.chart, p.price), H = ahMerge(ahMerge(cur.comm && cur.comm.length ? mergeHistory(it.hist, cur.comm) : it.hist, ahp), cch.points), s = stats(H), horizon = (await chrome.storage.local.get("horizon")).horizon || "1w", bw = buyWait(H, p.price, p.mrp, Date.now(), it.ref, horizon), d = bw.deal;
    // hero: price sticker + lowest tag + heart
    const hero = el("div", "hero"), sw = el("div", "st-wrap"), price = el("span", "price num"); sw.append(price);
    if (H.length > 1 && s.min === p.price) sw.append(el("span", "tag", `Lowest in ${d.w ? d.w.days : 1} days`));
    else if (H.length > 1 && d.badge === "higher") sw.append(el("span", "tag y", `₹${p.price - s.min} above low`));
    countUp(price, p.price);
    const heart = el("button", "heart" + (it.wish ? " on" : "")); heart.append(ico("heart")); heart.setAttribute("aria-pressed", String(!!it.wish)); heart.setAttribute("aria-label", it.wish ? T.wished : T.wish); heart.title = it.wish ? T.wished : T.wish;
    heart.onclick = async () => { const on = !heart.classList.contains("on"), r = await chrome.runtime.sendMessage({ type: "wish", key: p.key, on }); if (r && r.error) { heart.title = T.limit; return; }
      it.wish = on; heart.classList.toggle("on", on); heart.setAttribute("aria-pressed", String(on)); heart.title = on ? T.wished : T.wish; if (on) burst(heart); };
    hero.append(sw, heart); main.append(hero);
    const lc = lastChange(H);
    if (lc) { const cp = el("span", "chg-pill num" + (lc.delta > 0 ? " up" : "")); cp.append(`${lc.delta < 0 ? "▼" : "▲"} ${fmt(Math.abs(lc.delta))} · ${Math.abs(Math.round(lc.pct * 100))}% vs ${dshort(lc.at)}`); const w = el("div"); w.append(cp); main.append(w); }
    const pk = parsePack(p.title), per = pk && unitPrice(p.price, pk), bits = [];
    if (p.mrp && p.mrp > p.price) bits.push(`${Math.round((1 - p.price / p.mrp) * 100)}% off`);
    if (per) bits.push(`₹${per}/${pk.unit === "pc" ? "pc" : "100" + pk.unit}`);
    const offerP = readOfferPrice(p.price); if (offerP) bits.push(`${fmt(offerP)} with offers`); // the page's own "Buy for ₹X" line (coupons, bank offers, cashback)
    if (bits.length) { const sub = el("div", "sub2 num", bits.join(" · ")); if (p.mrp && p.mrp > p.price) { sub.append(el("span", "mrp", fmt(p.mrp))); } main.append(sub); }
    // low / avg / high + history chart, both following the selected range
    const c3 = el("div", "chips3"), cb = el("div", "chartbox"), seg = el("div", "seg"), now = Date.now();
    const paintRange = () => {
      const days = (RANGES.find(r => r[0] === range) || RANGES[1])[1]; let ws = windowStats(H, now, days || 99999) || { min: s.min, avg: s.avg, max: s.max }, sl = downsample(sliceHistory(H, days, now), 200);
      const useRef = sl.length < 2 && refUsable(it.ref, p.price, now); // too little own history in this tab: the numbers are Amazon's range for the days it covers, not one price repeated three times
      if (useRef) ws = { min: Math.min(it.ref.low, p.price), avg: (Math.min(it.ref.low, p.price) + Math.max(it.ref.high, p.price)) / 2, max: Math.max(it.ref.high, p.price), est: true }; // only a range is known: the midpoint stands in for the average and says so
      const prevV = c3.dataset.v ? JSON.parse(c3.dataset.v) : {}, nowV = { Low: ws.min, Avg: ws.avg, High: ws.max }; c3.dataset.v = JSON.stringify(nowV);
      c3.replaceChildren(); [["Low", ws.min, "down"], ["Avg", ws.avg, "trend"], ["High", ws.max, "up"]].forEach(([n, v, i]) => { const x = el("div", "chip3" + (prevV[n] != null && Math.round(prevV[n]) !== Math.round(v) ? " chg" : "")), sm = el("small"), dv = Math.round(p.price - v); sm.append(ico(i), n);
        x.append(sm, el("b", "num", (ws.est && n === "Avg" ? "~" : "") + fmt(v)), el("em", "dlt num", dv === 0 ? "now" : `now ${dv > 0 ? "+" : "−"}${fmt(Math.abs(dv))}`)); if (ws.est && n === "Avg") x.title = "Estimated from Amazon's range"; c3.append(x); });
      [...seg.children].forEach(b => b.classList.toggle("beyond", useRef && +b.dataset.d > it.ref.days));
      cb.replaceChildren(el("p", "lbl", useRef && (!days || days > it.ref.days) ? `Last ${it.ref.days} days · all HAULS has for now` : `${range} history${cur.comm && cur.comm.length ? " · community + yours" : ""}`), !useRef ? chart(sl, now, days ? range : "") : bandChart(it.ref, p.price), ...(ahp.length ? [el("p", "meta", `Includes Amazon's own price history${it.ahist.offer ? ` · with offers ${fmt(it.ahist.offer)}` : ""}. Weekly lowest featured offer price, excluding shipping.`)] : cch.points.length ? [el("p", "meta", `Includes shared history from ${cch.n} HAULS reader${cch.n === 1 ? "" : "s"}, updated ${cch.age ? cch.age + " days ago" : "today"}.`)] : []));
      [...seg.children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.r === range)));
    };
    RANGES.forEach(([k, dd]) => { const b = el("button", "", k); b.dataset.r = k; b.dataset.d = dd || 99999; b.setAttribute("aria-pressed", "false"); b.onclick = () => { range = k; chrome.storage.local.set({ range: k }); paintRange(); }; seg.append(b); });
    main.append(seg, c3, cb); paintRange();
    // "Should you buy this now?": horizon tabs + half-ring score + recommendation (+ alert price)
    const sc = dealScan(H, p.price, p.mrp, Date.now(), it.ref);
    // "Should you buy this now?": the horizon tabs refresh THIS card only (short skeleton, then the new verdict); nothing else in the panel redraws.
    { const bn = el("div", "buynow"), hz = el("div", "seg hz"), body = el("div", "bn-body"); hz.setAttribute("role", "group"); hz.setAttribute("aria-label", "How soon do you need it");
      const paintBuy = h => {
        const w = buyWait(H, p.price, p.mrp, Date.now(), it.ref, h), vc = el("div", "vcard " + w.verdict), info = el("button", "info"), tipEl = el("span", "itip"); tipEl.setAttribute("role", "tooltip"); tipEl.textContent = (w.reasons || []).slice(0, 2).join(" ") || w.short;
        info.append(ico("info"), tipEl); info.setAttribute("aria-label", "Why this verdict");
        vc.append(el("span", "vw", { buy: "Buy now", wait: "Wait for savings", okay: "Fair price", unknown: "Early" }[w.verdict]), el("span", "vl", w.short), info);
        info.onclick = () => { const ul = el("ul"); w.reasons.forEach(r => ul.append(el("li", "", r)));
          const nodes = [ul]; if (d.adv >= 0.1 && d.w && d.coverage !== "insufficient") nodes.push(note("Discount context", `Advertised ${Math.round(d.adv * 100)}% off the listed MRP. Against recent observed prices it's ${Math.abs(Math.round(d.vsAvg * 100))}% ${d.vsAvg <= 0 ? "below" : "above"}.`));
          openSheet(w.title, nodes); };
        const row = el("div", "bn-row"), right = el("div", "bn-right"); if (sc.score != null) { const gw = el("div", "bn-g"), lg = el("div", "bn-lg"); lg.append(el("span", "bad", "Bad time"), el("span", "good", "Good time")); gw.append(gaugeEl(sc.score, "Deal score", 112), lg); row.append(gw); } right.append(el("p", "lbl", "Our recommendation"), vc); row.append(right);
        const kids = [row]; if (w.alertAt && !it.target) { const ab = el("button", "btn ghost full", `Set price alert at ${fmt(w.alertAt)}`); ab.onclick = async () => { ab.disabled = true; const r = await send({ type: "track", key: p.key, target: w.alertAt }); ab.textContent = r && r.error ? "Tracking limit reached" : `Alert set at ${fmt(w.alertAt)}`; }; kids.push(ab); }
        body.replaceChildren(...kids); body.classList.remove("busy"); body.classList.add("fresh"); setTimeout(() => body.classList.remove("fresh"), 400);
      };
      let curH = horizon, tmr = 0;
      HORIZONS.forEach(([k, l]) => { const b = el("button", "", l); b.setAttribute("aria-pressed", String(k === horizon)); b.dataset.h = k; b.onclick = () => { if (k === curH) return; curH = k; chrome.storage.local.set({ horizon: k }); [...hz.children].forEach(x => x.setAttribute("aria-pressed", String(x.dataset.h === k)));
        body.classList.add("busy"); body.replaceChildren(...[0, 1, 2].map(() => el("div", "skel"))); clearTimeout(tmr); tmr = setTimeout(() => paintBuy(k), 260); }; hz.append(b); });
      bn.append(el("p", "lbl bn-h", "Should you buy this now?"), hz, el("p", "meta", "Select based on how soon you need the item."), body); paintBuy(horizon);
      main.append(bn); }
    // Impulse Check: urgency messages found in the product part of the page, with what the evidence says (observations only, never a verdict on the seller)
    { const cues = impCues(impCollect()); if (cues.length) {
        const mem = it.urg || null, v = impVerdict(cues, mem, H, Date.now()), ic = el("button", "impulse " + v.level), top = el("div", "imp-top"), chips = el("div", "s-chips");
        top.append(el("span", "lbl", "Impulse Check"), el("b", "imp-head", v.head)); cues.slice(0, 4).forEach(c => { const x = el("span", "schip"); x.append(ico(c.kind === "timer" ? "clock" : "info"), c.text); chips.append(x); });
        ic.append(top, chips, ...v.lines.filter(l => !cues.some(c => c.text === l)).slice(0, 2).map(l => el("p", "meta", l))); ic.setAttribute("aria-label", `Impulse Check: ${v.head}. Tap for details`);
        ic.onclick = () => { const ul = el("ul"); v.lines.forEach(l => ul.append(el("li", "", l))); openSheet("Impulse Check", [ul, el("p", "meta", "HAULS does not say whether a message is true. It shows what this page displayed, what it displayed on your earlier visits, and what the price did. Stock and viewer counts cannot be checked from outside the store.")]); };
        main.append(ic);
        if (!urgSent[p.key]) { urgSent[p.key] = 1; send({ type: "urg", key: p.key, price: p.price, cues: cues.filter(c => c.kind === "stock" || c.kind === "timer").map(c => ({ kind: c.kind, n: c.n === undefined ? undefined : c.n, secs: c.secs, gran: c.gran, text: c.text })) }).then(m => { if (m && cur && cur.p && cur.p.key === p.key) { cur.it.urg = m; } }).catch(() => {}); }
      } }
    // Deal Scanner: 0-100 score with the exact points behind it
    const scard = el("div", "scan " + sc.tone), sh = el("div", "scan-h");
    sh.append(el("b", "", "Deal Scanner"), el("span", "meta", sc.score == null ? "" : `${sc.score}/100`)); scard.append(sh);
    if (sc.score == null) scard.append(el("p", "meta", sc.headline));
    else {
      const top = el("div", "scan-top"), pill = el("span", "scan-pill", sc.label), g = gaugeEl(sc.score, "Deal score"), gcol = el("div", "bn-g"), lg2 = el("div", "bn-lg"); lg2.append(el("span", "bad", "Bad time"), el("span", "good", "Good time")); gcol.append(g, lg2);
      top.append(pill, gcol); scard.append(top, el("div", "scan-head", sc.headline));
      const list = el("div", "scan-rows"); sc.rows.forEach(r => { const li = el("div", "scan-r" + (r.bad ? " bad" : "")); li.append(el("span", "", r.label), el("span", "num", r.value), el("b", "num", `${r.pts}/${r.max}`)); list.append(li); });
      scard.append(list, el("p", "meta", sc.source === "amazon" ? "Based on the price range this page showed for this product. HAULS has too little of its own history yet." : "Observed by this extension from the prices it has seen. Not a seller statement."));
    }
    main.append(scard);
    // deal strength meter + chips
    const row = el("div", "row2"), mt = el("div", "meter4" + (["weak", "higher"].includes(d.badge) ? " lo" : "")), lvl = { strong: 4, normal: 3, weak: 2, higher: 1, unknown: 0 }[d.badge];
    mt.title = d.label; for (let i = 0; i < 4; i++) mt.append(el("i", i < lvl ? "on" : "")); row.append(mt);
    if (d.adv >= 0.1 && d.w && d.coverage !== "insufficient") row.append(el("span", "pill num", `${Math.abs(Math.round(d.vsAvg * 100))}% ${d.vsAvg <= 0 ? "below" : "above"} usual`));
    else row.append(el("span", "pill", bw.source === "amazon" ? `Amazon ${it.ref.days}-day range` : d.label));
    main.append(row);
    main.append(trapEditor(p, it));
    // what buyers say (from the rating breakdown or visible reviews)
    const rc = reviewsInfo();
    if (rc && rc.ans) {
      const a = rc.ans, rv = el("button", "rev " + a.tone), rh = el("div", "rev-h"), chips = el("div", "rev-chips");
      rh.append(el("b", "", a.headline), el("span", "num rev-avg", `${a.avg}★`));
      rv.append(el("span", "lbl", "Reviews say"), rh, el("span", "meta num", `${a.pos}% rate it 4-5★, ${a.neg}% 1-2★ · ${a.total ? a.total.toLocaleString("en-IN") : ""} ${a.from}${a.odd ? ` · ${a.odd} pattern${a.odd > 1 ? "s" : ""} to note` : ""}`));
      (rc.sm.likes || []).slice(0, 3).forEach(x => chips.append(el("span", "rchip up", x))); (rc.sm.dislikes || []).slice(0, 3).forEach(x => chips.append(el("span", "rchip dn", x)));
      if (chips.children.length) rv.append(chips);
      rv.onclick = () => openSheet("Review signals", rc.nodes()); rv.setAttribute("aria-label", `${a.headline}. Tap for review details`); main.append(rv);
    }
    // seller
    const sl = sellerInfo(p.seller, p.title);
    if (sl) {
      // visual seller card: half-ring score + name + icon chips (text kept to a few words). fill() reruns when the offers list adds the seller's rating.
      const sb = el("button", "seller " + sl.tone), sw = it.sellerChange && Date.now() - it.sellerChange.at < 30 * 864e5 ? sellerChange(it.sellerChange.from, sl.name) : null;
      const fill = () => {
        const d = spDone[sl.sid] && spDone[sl.sid].data, sg = sellerSignals(sl, d || null), compact = n => n >= 1e5 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(".0", "") + "k" : String(n);
        const mid = el("div", "s-mid"), chips = el("div", "s-chips"), chip = (icon, text, cls) => { const c = el("span", "schip " + (cls || "")); c.append(ico(icon), text); chips.append(c); };
        mid.append(el("span", "lbl", "Seller"), el("span", "sname", sl.name), el("span", "skind", sl.kind));
        chip(sl.fba || sl.firstParty ? "shield" : "pin", sl.fba || sl.firstParty ? "Amazon ships" : "Seller ships", sl.fba || sl.firstParty ? "ok" : "warn");
        if (d && !sg.limited) { chip("star", `${sg.r} (${compact(sg.n)})`, sg.r >= 4 ? "ok" : sg.r >= 3 ? "" : "warn"); chip("check", `${sg.pos}% positive`, sg.pos >= 85 ? "ok" : sg.pos >= 65 ? "" : "warn"); if (sg.trend <= -0.4) chip("down", "Recent dip", "warn"); }
        else if (sg.limited) chip("info", `Limited data · ${sg.n} rating${sg.n === 1 ? "" : "s"}`, "warn");
        else if (sl.sid && spDone[sl.sid] == null) chip("sync", "Checking seller…", "");
        if (sw) chip("swap", "Changed", "warn");
        sb.dataset.reasons = JSON.stringify(sg.reasons || []);
        mid.append(chips); sb.replaceChildren(mid, ...(sg.score == null ? [] : [gaugeEl(sg.score, "Seller signals", 96)])); sb.setAttribute("aria-label", `Seller ${sl.name}, ${sl.kind}${sg.score == null ? ", limited data" : ", signals " + sg.score + " of 100"}. Tap for details`);
      };
      fill(); sellerFill = fill;
      if (sl.sid && spDone[sl.sid] === undefined) { spDone[sl.sid] = null; send({ type: "seller", sid: sl.sid }).then(r => { spDone[sl.sid] = r && r.data ? r : { failed: true }; if (cur && cur.p && cur.p.key === p.key && sellerFill) sellerFill(); }).catch(() => { spDone[sl.sid] = { failed: true }; }); }
      sb.onclick = () => { const ul = el("ul"); sl.notes.forEach(n => ul.append(el("li", "", n))); try { JSON.parse(sb.dataset.reasons || "[]").forEach(n => ul.append(el("li", "", n))); } catch {} if (sw) ul.append(el("li", "", sw));
        const nodes = [ul, el("p", "meta", "Signals come from this page and the seller's public Amazon storefront (ratings, % positive, volume). HAULS does not rate or vouch for any seller.")];
        if (sl.sid) { const a = el("a", "btn ghost", "Seller profile"); a.href = new URL(p.url).origin + "/sp?seller=" + sl.sid; a.target = "_blank"; a.rel = "noopener"; nodes.push(a); }
        openSheet("About this seller", nodes); };
      main.append(sb);
    }
    // other sellers on this Amazon product (one click, one request)
    const asinM = dom === "amazon.in" && /^amazon\.in:([A-Z0-9]{10})$/.exec(p.key), pidM = dom === "flipkart.com" && /^flipkart\.com:([A-Z0-9]{16})$/.exec(p.key);
    if (asinM || pidM) {
      const ob = el("div", "offers"), obtn = el("button", "btn ghost full", "See other sellers"), paintOff = r => {
        ob.replaceChildren(); if (r.failed) return void ob.append(el("p", "meta", "Couldn't load other sellers right now."), obtn);
        if (!r.offers.length) return void ob.append(el("p", "meta", "Only one seller for this product."));
        const best = offBest(r.offers, p.price), here = (p.seller && p.seller.name || "").toLowerCase();
        if (best && best.saving > 0) ob.append(el("p", "off-save", `${fmt(best.saving)} less from ${best.lowest.seller}${best.lowest.rating && best.lowest.rating <= 2 ? ` (seller rated ${best.lowest.rating}★)` : ""}`));
        r.offers.slice(0, 8).forEach(o => { const row = el(o.sid ? "a" : "div", "off-r" + (best && o === best.lowest ? " low" : "") + (o.dormant ? " dim" : "")); if (o.sid) { row.href = new URL(p.url).origin + "/sp?seller=" + o.sid; row.target = "_blank"; row.rel = "noopener"; }
          const mine = o.here || (here && o.seller.toLowerCase() === here); row.append(ratingDot(o.rating, o.ratings), el("span", "on", o.seller + (mine ? " (here)" : "")), el("b", "num", fmt(o.price)),
            el("small", "", [o.cond !== "New" ? o.cond : "", o.ships ? "Ships from " + o.ships : "", o.delivery ? "Delivery " + o.delivery : "", o.rating ? `Seller ${o.rating}★${o.ratings ? ` (${o.ratings} rating${o.ratings === 1 ? "" : "s"})` : ""}` : ""].filter(Boolean).join(" · "))); ob.append(row); });
        ob.append(el("p", "meta", `Read from ${pidM ? "Flipkart" : "Amazon"}'s own seller list for this item. Delivery, returns and seller quality can differ.`));
      };
      obtn.onclick = async () => { obtn.disabled = true; obtn.textContent = "Loading sellers…"; offDone[p.key] = await send(pidM ? { type: "offers-fk", pid: pidM[1] } : { type: "offers", asin: asinM[1] }).catch(() => ({ failed: true, offers: [] })); if (cur && cur.p && cur.p.key === p.key) { paintOff(offDone[p.key]); if (sellerFill) sellerFill(); } };
      if (offDone[p.key]) paintOff(offDone[p.key]); else ob.append(obtn); main.append(ob);
    }
    // Myntra: the sellers are inside the page itself, so this needs no request
    if (dom === "myntra.com") {
      const sc = [...document.scripts].find(x => x.textContent.includes("__myx") && x.textContent.includes("pdpData")), ms = sc ? offParseMyntra(sc.textContent) : [];
      if (ms.length >= 2) {
        const mb = el("div", "offers"); mb.append(el("p", "lbl", "Sellers on this page"));
        ms.slice(0, 6).forEach((m, i) => { const row = el("div", "off-r" + (i === 0 ? " low" : "")); row.append(el("span", "on", m.name), el("b", "num", m.minPrice === m.maxPrice ? fmt(m.minPrice) : `${fmt(m.minPrice)}–${fmt(m.maxPrice)}`), el("small", "", "Sizes " + m.sizes.join(", "))); mb.append(row); });
        mb.append(el("p", "meta", "Price depends on the size and the seller. Read from this page.")); main.append(mb);
      }
    }
    // stores
    const { links } = smartLinks(p.title, S ? S.name : ""), SHOW = 5, sec = el("div"), st = el("div", "stores");
    sec.append(el("p", "lbl", "Compare"));
    // best price across stores: runs only when asked, one search page per store
    const cbox = el("div", "cmp"), cbtn = el("button", "btn ghost full", "Find the best price across stores");
    const paintCmp = r => {
      cbox.replaceChildren(); const here = p.price;
      if (r.error) return void cbox.append(el("p", "meta", "Couldn't compare right now. Try again later."), cbtn);
      const all = [...r.results.filter(x => x.confidence === "Exact").map(x => x.price), here], low = Math.min(...all); // a "lowest" badge is only earned against confirmed same-product rows
      if (!r.results.length) { cbox.append(el("p", "meta", "No confident match at other stores.")); (r.near || []).slice(0, 2).forEach(x => { const a = el("a", "cmp-r near"); a.href = x.url; a.target = "_blank"; a.rel = "noopener"; a.append(el("span", "", x.store), el("b", "num", fmt(x.price)), el("span", "tag", x.why), el("small", "", "Closest, not the same item: " + String(x.title).slice(0, 70))); cbox.append(a); }); }
      else { const hr = el("div", "cmp-r" + (here <= low ? " low" : "")); hr.append(el("span", "", `${p.site} (here)`), el("b", "num", fmt(here)), el("span", "tag", here <= low ? "Lowest" : "")); cbox.append(hr); }
      r.results.forEach(x => { const ex = x.confidence === "Exact", a = el("a", "cmp-r" + (ex && x.price <= low ? " low" : "")), d = x.price - here; a.href = x.url; a.target = "_blank"; a.rel = "noopener";
        a.append(el("span", "", x.store), el("b", "num", fmt(x.price)), el("span", "tag", ex && x.price <= low ? "Lowest" : d > 0 ? `${fmt(d)} more` : d < 0 ? `${fmt(-d)} less` : "Same"));
        const sp = el("div", "same"); sp.append(el("b", "", x.confidence === "Exact" ? "Same product" : "Likely the same"));
        (x.checks || []).forEach(c => { const ch = el("span", "chk " + (c.ok === true ? "y" : c.ok === false ? "n" : "u")); ch.append(ico(c.ok === true ? "check" : "minus"), `${c.k} ${c.v}`); ch.title = c.ok === null ? "The listing does not say" : c.info ? "Differs; price can vary by this" : "Matches"; sp.append(ch); });
        a.append(sp); cbox.append(a); });
      if (r.failed.length) cbox.append(el("p", "meta", `Couldn't check: ${r.failed.map(n => n + (r.why && r.why[n] ? " (" + r.why[n] + ")" : "")).join(", ")}.`));
      cbox.append(el("p", "meta", "Prices come from each store's search page. Offers, shipping and seller may differ."));
    };
    cbtn.onclick = async () => { cbtn.disabled = true; cbtn.textContent = "Checking other stores…"; const r = await send({ type: "compare", title: p.title, brand: p.brand || undefined, mpn: p.mpn || undefined, site: p.site, price: p.price }).catch(() => ({ error: "x" })); cmpDone[p.key] = r || { error: "x" }; if (cur && cur.p && cur.p.key === p.key) paintCmp(cmpDone[p.key]); };
    if (cmpDone[p.key]) paintCmp(cmpDone[p.key]); else cbox.append(cbtn);
    sec.append(cbox);
    const mk = ([n, h, col]) => { const a = el("a", "store"); a.href = h; a.target = "_blank"; a.rel = "noopener"; a.style.setProperty("--c", STORE_C(col)); a.append(el("i"), n); return a; };
    links.slice(0, SHOW).forEach(l => st.append(mk(l)));
    if (links.length > SHOW) { const more = el("button", "more", `+${links.length - SHOW} more`); more.onclick = () => { st.classList.add("wrap"); more.remove(); links.slice(SHOW).forEach(l => st.append(mk(l))); }; st.append(more); }
    sec.append(st); main.append(sec);
    // reviews + trust (details live in sheets)
    const r2 = el("div", "row2"); const pc = priceConfidence(p.src, p.price, p.mrp);
    const trust = el("button", "pill"); trust.append(ico("shield"), pc.level + " confidence"); trust.style.cursor = "pointer";
    trust.onclick = () => { const ul = el("ul"); [pc.note, `Last seen ${new Date(it.hist[it.hist.length - 1][0]).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`,
      `${it.hist.length} of your own observation${it.hist.length === 1 ? "" : "s"}${cur.comm && cur.comm.length ? ` plus community prices for ${cur.comm.length} days` : ""}.`, "Prices exclude coupons and bank offers.", "Observed data, not seller-verified."].forEach(t => ul.append(el("li", "", t)));
      openSheet("How we know this", [ul, note("Our promise", T.trust)]); };
    r2.append(trust); if (rc) { const rb = el("button", "pill"); rb.append(ico("search"), rc.label); rb.style.cursor = "pointer"; rb.onclick = () => openSheet("Review signals", rc.nodes()); r2.append(rb); }
    main.append(r2, quotaRow());
  }

  // Review quality signals + themes. Rating shape comes from the page's rating breakdown (large sample); text signals from visible reviews (+ more if the user asks).
  let revExtra = null; const cmpDone = {}, offDone = {}, spDone = {}; let sellerFill = null;
  function reviewsInfo() {
    if (typeof Reviews_ === "undefined") return null;
    const site = dom === "amazon.in" ? "amazon" : dom === "flipkart.com" ? "flipkart" : ""; if (!site) return null;
    const vis = Reviews_.readReviews(document, site), hist = (revExtra && revExtra.histogram) || Reviews_.readHistogram(document, site);
    if (vis.length < 3 && !hist) return null;
    const all = () => vis.concat(revExtra ? revExtra.reviews : []), compute = () => ({ sg: Reviews_.reviewSignals(all(), { histogram: hist }), sm: Reviews_.reviewSummary(all()) });
    const { sg } = compute(), odd = sg.signals.filter(x => x.severity === "watch").length;
    const label = sg.confidence === "insufficient" ? `${all().length} reviews` : odd ? `${odd} pattern${odd > 1 ? "s" : ""} to note` : hist ? "Ratings look normal" : "Reviews look normal";
    const nodes = () => {
      const { sg, sm } = compute(), out = [];
      if (sg.confidence === "insufficient") out.push(el("p", "meta", `Only ${all().length} reviews are visible, too few to read patterns from.`));
      else { sg.signals.forEach(x => out.push(note(x.label, x.detail))); if (!sg.signals.length) out.push(el("p", "meta", "No unusual patterns seen.")); }
      if (hist) out.push(el("p", "meta num", `Rating breakdown: ${hist.total.toLocaleString("en-IN")} ratings, avg ${hist.avg || "?"}★ (${[5, 4, 3, 2, 1].map(s => `${s}★ ${Math.round((hist.dist[s] || 0) * 100)}%`).join(" · ")})`));
      out.push(el("p", "meta", `Confidence: ${sg.confidence}. ${sg.disclaimer || "These are signals of unusual patterns, not proof about any review, seller or buyer."}`));
      [["Buyers like", sm.likes], ["Buyers mention", sm.dislikes]].forEach(([t, l]) => { if (l && l.length) out.push(note(t, l.join(", "))); });
      const more = el("button", "btn ghost", !revExtra ? "Read more reviews" : revExtra.blocked ? "Couldn't load more" : "Loaded more reviews ✓");
      if (!revExtra) more.onclick = async () => { more.textContent = "Loading…"; revExtra = await Reviews_.fetchMoreReviews(site, { url: location.href }, fetch, 3);
        const n = revExtra.blocked === "login" ? "This store asks for a login to show more reviews, so I'm relying on the rating breakdown." : revExtra.blocked ? "The store didn't allow more reviews to load." : `Read ${revExtra.reviews.length} more reviews.`;
        openSheet("Review signals", [...nodes(), el("p", "meta", n)]); draw(); };
      out.push(more); return out;
    };
    return { label, nodes, ans: Reviews_.reviewAnswer(hist, all(), sg), sm: compute().sm };
  }

  // ---- account sheet: Google sign-in, consent toggle, sync status ----
  async function openAccount() {
    const a = await chrome.runtime.sendMessage({ type: "account", gesture: gesture() }), nodes = [];
    const refresh = () => openAccount();
    if (!a.configured) { nodes.push(note("Sign-in isn't set up in this build", "Add the Supabase anon key and rebuild the config. Everything else works offline, and your data stays in this browser.")); return openSheet("Account", nodes); }
    if (a.signedIn && a.pendingSwitch) {
      nodes.push(el("p", "", "This browser still has a watchlist from a different HAULS account. Clear it so your account starts clean, or merge it into this one."));
      const go = (choice, label, cls) => { const b = el("button", cls, label); b.onclick = async () => { b.textContent = "Working…"; await send({ type: "resolve-switch", choice, gesture: gesture() }); closeSheet(); draw(); }; return b; };
      nodes.push(go("clear", "Clear and continue", "btn full"), go("merge", "Keep it and merge into this account", "btn ghost"), go("cancel", "Cancel and sign out", "link-btn"));
      return openSheet("Different account detected", nodes);
    }
    if (!a.signedIn) {
      if (a.notice) { const n = el("div", "quiet warn"); n.append(el("b", "", a.notice === "inactive" ? "You were signed out after 90 days without using HAULS" : "Your session ended"), a.notice === "inactive" ? "Sign in again to sync. Your watchlist on this device is safe." : "It expired or was revoked. Sign in again to keep syncing. Your watchlist on this device is safe."); nodes.push(n); }
      [["sync", "Sync your watchlist across devices"], ["chart", "Community price history from day one"], ["bell", "Price-drop emails (coming soon)"]].forEach(([i, t]) => { const r = el("div", "row2"); r.append(ico(i), el("span", "", t)); r.style.fontWeight = "700"; nodes.push(r); });
      const btn = el("button", "btn full"), msg = el("p", "meta"); btn.append("Continue with Google"); btn.onclick = async () => { btn.textContent = "Opening Google…"; const r = await chrome.runtime.sendMessage({ type: "signin", gesture: gesture() }); if (r && r.ok) { refresh(); draw(); } else { btn.replaceChildren("Continue with Google"); msg.textContent = r && r.error ? r.error : "Sign-in failed."; } };
      nodes.push(btn, msg); { const cc = el("button", "link-btn", "Clear cache"); cc.onclick = async () => { await send({ type: "invalidate", reason: "user-clear-cache", gesture: gesture() }); cc.textContent = "Cache cleared"; }; nodes.push(cc); }
      { const sg = el("button", "btn ghost"); sg.append(ico("gear"), "Independent stores & settings"); sg.onclick = () => send({ type: "open-options" }); nodes.push(sg); }
      nodes.push(el("p", "meta", "We store your name, email and watchlist. Prices you see (and the ones HAULS re-checks for your watched items), and the Amazon price charts you open, are shared only if you switch sharing on. They are kept apart from your name and email and shown only as combined history. Your data stays in this browser first. You can erase your cloud data anytime."));
      return openSheet("Sign in to HAULS", nodes);
    }
    const who = el("div", "row2"), av = el("span", "sc", (a.user.name || a.user.email || "?")[0].toUpperCase()); av.style.setProperty("--c", "var(--mint)");
    const nm = el("div"); nm.append(el("b", "", a.user.name || a.user.email), el("div", "meta", a.user.email)); who.append(av, nm, el("span", "pill", (a.profile && a.profile.plan) || "free")); nodes.push(who);
    const sw = el("label", "row2"), cb = el("input"); cb.type = "checkbox"; cb.checked = !!(a.profile && a.profile.contribute === true); sw.append(cb, el("span", "", "Share prices I see with the community (optional)")); sw.style.cursor = "pointer"; sw.style.fontWeight = "700";
    const fg = el("button", "btn ghost", "Also remove prices I shared earlier"); fg.hidden = cb.checked;
    fg.onclick = async () => { const r = await send({ type: "forget-shared", gesture: gesture() }); fg.textContent = r && r.ok ? `Removed ${r.removed || 0} shared price${r.removed === 1 ? "" : "s"}` : "Couldn't remove them"; };
    cb.onchange = () => { chrome.runtime.sendMessage({ type: "contribute", on: cb.checked, gesture: gesture() }); fg.hidden = cb.checked; }; nodes.push(sw, fg);
    const st = el("p", "meta", a.lastSync ? `Last synced ${new Date(a.lastSync).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · ${a.queued} waiting` : `Not synced yet · ${a.queued} waiting`), sy = el("button", "btn ghost"); sy.append(ico("sync"), "Sync now");
    sy.onclick = async () => { sy.textContent = "Syncing…"; const r = await chrome.runtime.sendMessage({ type: "sync" }); st.textContent = r.ok ? "Synced just now." : "Couldn't sync: " + ((r.flush && r.flush.reason) || (r.pull && r.pull.reason) || "try again"); sy.replaceChildren(ico("sync"), "Sync now"); draw(); };
    nodes.push(st, sy);
    const ph = el("label", "pi"), phi = el("input"), phm = el("p", "meta"); phi.type = "tel"; phi.placeholder = "Phone (optional)"; phi.value = (a.profile && a.profile.phone) || ""; ph.append(phi); phi.setAttribute("aria-label", "Phone number, optional");
    phi.onchange = async () => { const v = phi.value.trim(); if (v && !/^\+?[0-9 ()-]{7,20}$/.test(v)) return void (phm.textContent = "Enter a valid phone number or leave it empty."); const r = await send({ type: "profile-update", phone: v, gesture: gesture() }); phm.textContent = r && r.ok ? "Saved." : "Couldn't save."; };
    nodes.push(ph, phm, el("p", "meta", "Google doesn't share phone numbers, so this is optional and only you can type it. We never verify or use it for marketing."));
    const ex = el("button", "btn ghost"); ex.append(ico("download"), "Export my data"); ex.onclick = async () => { const r = await send({ type: "export-data", gesture: gesture() }); if (!r || !r.ok) return void (ex.textContent = "Couldn't export"); const u = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), account: r.data, localWatchlist: r.local }, null, 2)], { type: "application/json" })), l = document.createElement("a"); l.href = u; l.download = "hauls-my-data.json"; l.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
    nodes.push(ex);
    const out = el("button", "btn ghost", "Sign out"); out.onclick = async () => { await chrome.runtime.sendMessage({ type: "signout", gesture: gesture() }); closeSheet(); draw(); };
    const del = el("button", "more", "Erase my cloud data"); let armed = false; del.onclick = async () => { if (!armed) { armed = true; del.textContent = "Tap again to erase everything"; return; } const r = await chrome.runtime.sendMessage({ type: "delete-data", gesture: gesture() }); closeSheet(); draw(); };
    const outc = el("button", "link-btn", "Sign out and clear this device"); outc.onclick = async () => { await send({ type: "signout", clear: true, gesture: gesture() }); closeSheet(); draw(); };
    const cc = el("button", "link-btn", "Clear cache"); cc.onclick = async () => { await send({ type: "invalidate", reason: "user-clear-cache", gesture: gesture() }); cc.textContent = "Cache cleared"; };
    nodes.push(out, outc, cc, del); openSheet("Your account", nodes);
  }
  acctBtn.onclick = openAccount;
  const refreshWho = () => chrome.runtime.sendMessage({ type: "whoami" }).then(w => { if (w && w.initial) { acctBtn.replaceChildren(w.initial); acctBtn.style.fontWeight = "800"; } else { acctBtn.replaceChildren(ico("user")); acctBtn.style.fontWeight = ""; } }).catch(() => {});
  refreshWho(); whoHook = refreshWho;

  function quotaRow() {
    const u = cur && cur.usage || { used: 0, limit: 50 }, q = el("div", "quota"), b = el("div", "bar"), i = el("i");
    i.style.width = Math.min(100, (u.used / (u.limit || 1)) * 100) + "%"; b.append(i); q.append(el("span", "num", `${u.used}/${u.limit === Infinity ? "∞" : u.limit} lookups`), b); return q;
  }

  function drawGrocery() {
    const pinI = el("input"), qI = el("input"), out = el("div"), go = el("button", "btn full"), pl = el("label", "pi"), ql = el("label", "pi");
    pinI.placeholder = T.pin; pinI.inputMode = "numeric"; pinI.maxLength = 6; pinI.setAttribute("aria-label", T.pin); qI.placeholder = "amul butter 500g"; qI.setAttribute("aria-label", "Grocery product");
    pl.append(ico("pin"), pinI); ql.append(ico("search"), qI); go.append(T.find, ico("arrow"));
    const msg = t => out.replaceChildren(el("p", "empty", t));
    // ---- pincode: edit it, then tap the round icon inside the box to use it. The saved pincode drives the header chip and every search. ----
    let runId = 0; // every search takes a number; changing the pincode invalidates the ones still running so a late answer can never overwrite the new pincode
    const go2 = el("button", "pgo"), phint = el("p", "meta bad"); go2.type = "button"; pl.append(go2);
    let savedPin = "", flashT = null;
    const paintPin = () => {
      const st = pinFieldState(pinI.value, savedPin); go2.className = "pgo " + st; go2.disabled = st === "bad"; go2.replaceChildren(ico(st === "dirty" ? "sync" : "checkc"));
      const lab = st === "dirty" ? "Use this pincode" : st === "bad" ? "Enter 6 digits" : "Pincode saved. Tap to search again"; go2.title = lab; go2.setAttribute("aria-label", lab);
      phint.textContent = st === "bad" && pinI.value.trim() ? "Pincodes have 6 digits." : ""; phint.hidden = !phint.textContent;
    };
    const usePin = async v => { runId++; await chrome.storage.local.remove("loc"); await chrome.storage.local.set({ pin: v }); savedPin = v; pinI.value = v; pinChip.replaceChildren(ico("pin"), v); out.replaceChildren(); paintPin(); paintPlaces(); };
    const commitPin = async () => {
      if (pinFieldState(pinI.value, savedPin) === "bad") return; const v = pinI.value.trim(); if (v !== savedPin) await usePin(v);
      go2.className = "pgo done"; go2.replaceChildren(ico("check")); clearTimeout(flashT); flashT = setTimeout(paintPin, 1400); if (qI.value.trim()) run();
    };
    go2.onclick = commitPin; pinI.addEventListener("input", paintPin); pinI.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); commitPin(); } });
    // the saved pincode changed somewhere else (Settings, another tab, a synced device): the field follows unless you are in the middle of typing
    pinHook = v => { savedPin = v || ""; if (sr.activeElement !== pinI) pinI.value = savedPin; paintPin(); paintPlaces(); };
    // ---- saved places (Home / Mom's house / Office): tap to switch, x to remove. Kept in the browser and synced to the account. ----
    const placesBox = el("div", "places"); let perr = "";
    const savePlaces = async l => { await chrome.storage.local.set({ places: l }); perr = ""; paintPlaces(); };
    const iconBtn = (name, label, cls, fn) => { const b = el("button", cls); b.type = "button"; b.append(ico(name)); b.title = label; b.setAttribute("aria-label", label); b.onclick = fn; return b; };
    async function paintPlaces() {
      const list = safePlaces((await chrome.storage.local.get("places")).places), nodes = [];
      {
        for (const p of list) { const w = el("span", "plc"), b = el("button", "cp", `${p.name} · ${p.pin}`); b.setAttribute("aria-pressed", String(p.pin === savedPin)); b.onclick = () => { pinI.value = p.pin; commitPin(); };
          w.append(b, iconBtn("x", `Remove ${p.name}`, "cp-x", () => savePlaces(removePlace(list, p.id)))); nodes.push(w); }
      }
      if (perr) nodes.push(el("p", "meta bad", perr)); placesBox.replaceChildren(...nodes);
    }
    chrome.storage.local.get("pin").then(s => { savedPin = s.pin || ""; if (!pinI.value) pinI.value = savedPin; paintPin(); paintPlaces(); });
    const run = async (more = false) => { // more = the user asked to also check the page-read stores (opens ONE small window, one store at a time)
      const my = ++runId, stale = () => my !== runId;
      const q = qI.value.trim(), pin = pinI.value.trim(), st0 = await chrome.storage.local.get("loc");
      if (!q || !(/^\d{6}$/.test(pin) || st0.loc)) return msg(q ? "Add a pincode or tap Locate." : "Type a product.");
      out.replaceChildren(...(more ? [el("p", "meta strong", "Checking JioMart, BigBasket & Zepto, one at a time. A small window opens briefly and closes by itself…")] : []), ...[0, 1, 2].map(() => el("div", "sk")));
      let { loc, pin: saved } = await chrome.storage.local.get(["loc", "pin"]);
      if (/^\d{6}$/.test(pin) && (!loc || saved !== pin)) { loc = await chrome.runtime.sendMessage({ type: "geocode", pin }); if (stale()) return; if (loc.error) return msg(loc.error); await chrome.storage.local.set({ loc, pin }); pinChip.replaceChildren(ico("pin"), pin); }
      const { pin: sp } = await chrome.storage.local.get("pin"), { items, errors, unconfirmed = [], connect = [], later = [] } = await chrome.runtime.sendMessage({ type: "grocery", q, loc: { ...loc, pin: /^\d{6}$/.test(pin) ? pin : sp }, more });
      if (stale()) return; // the pincode changed while we were asking the stores
      out.replaceChildren();
      { const used = /^\d{6}$/.test(pin) ? pin : sp, pl2 = used && placeForPin((await chrome.storage.local.get("places")).places, used); out.append(el("p", "meta strong", used ? `Prices for ${used}${pl2 ? " · " + pl2.name : ""}. Delivery-confirmed stores only.` : "Prices near your location. Delivery-confirmed stores only.")); }
      // store badge: the real logo when the page allows data: images, else a letter
      const badge = (name, cls = "lg") => { const b = el("span", cls); b.title = name; const letter = () => { b.replaceChildren(name[0]); b.style.setProperty("--c", STORE_C((STORE[name] || [])[1])); };
        if (STORE_LOGO[name]) { const im = el("img"); im.alt = name; im.src = STORE_LOGO[name]; im.onerror = letter; b.append(im); } else letter(); return b; };
      const view = { sort: "relevance", pack: null }, chips = el("div", "chipsrow"), grid = el("div", "ggrid"), top = [...items.filter(i => i.cheapest), ...items.filter(i => !i.cheapest)];
      const card = i => {
        const a = el("a", "card" + (i.cheapest ? " best" : "") + (i.inStock ? "" : " so")); a.href = i.url; a.target = "_blank"; a.rel = "noopener";
        const ph = el("div", "ph"); if (i.image) { const im = el("img"); im.alt = ""; im.loading = "lazy"; im.referrerPolicy = "no-referrer"; im.src = i.image; im.onerror = () => im.remove(); ph.append(im); }
        if (i.cheapest) ph.append(el("em", "cb", T.cheapest)); else if (i.bestValue) ph.append(el("em", "cb v", "Best value")); if (!i.inStock) ph.append(el("em", "cb o", "Sold out"));
        const pr = el("div", "pr"), pv = el("div"); pv.append(el("b", "num", "₹" + i.price)); if (i.mrp > i.price) pv.append(el("s", "num", "₹" + i.mrp)); pr.append(pv, badge(i.store));
        const atc = el("span", "atc", "Add to Cart"); a.append(ph, el("div", "pk", i.pack || "\u00a0"), el("div", "nm", i.name), el("div", "fr", "Starts from"), pr, ...(i.perLabel ? [el("small", "pl num", i.perLabel)] : []), atc); return a; };
      const paint = () => {
        const list = sortGrocery(filterPack(top, view.pack), view.sort).slice(0, 24); grid.replaceChildren(...list.map(card));
        chips.replaceChildren(...[["relevance", "Relevance"], ["price", "Price ↑"], ["unit", "Unit price"]].map(([k, l]) => { const c = el("button", "cp", l); c.setAttribute("aria-pressed", String(view.sort === k)); c.onclick = () => { view.sort = k; paint(); }; return c; }),
          ...packChips(top).map(k => { const c = el("button", "cp pk2", k); c.setAttribute("aria-pressed", String(view.pack === k)); c.onclick = () => { view.pack = view.pack === k ? null : k; paint(); }; return c; })); };
      if (top.length) { paint(); out.append(chips, grid); } else { out.append(el("p", "empty", "No matches from the connected stores.")); errors.forEach(e => out.append(el("p", "meta", e))); } // say WHY right here when there is nothing to show
      if (unconfirmed.length) { const nd = el("div", "nodel"); nd.append(...unconfirmed.map(n => badge(n, "lg off")), el("span", "", `${unconfirmed.join(" & ")}: can't confirm delivery to ${pin || sp || "your pincode"} yet, so no price is shown.`)); out.append(nd); }
      if (later.length) { const mb = el("button", "btn ghost sm", `Check ${later.join(", ")} too`); mb.title = "Opens one small window for a few seconds"; mb.onclick = () => run(true); out.append(mb); }
      if (connect.length) { const cn = el("button", "btn ghost", `Connect ${connect.join(" & ")} to see prices here`); cn.onclick = () => send({ type: "open-options" }); out.append(cn); }
      const own = el("div"), st = el("div", "stores wrap"); own.append(el("p", "lbl", T.ownSite)); [["Zepto", q], ["Instamart", q], ["BigBasket", q]].forEach(([n]) => { const a = el("a", "store"); a.href = STORE[n][0] + encodeURIComponent(q); a.target = "_blank"; a.rel = "noopener"; a.style.setProperty("--c", STORE[n][1]); a.append(el("i"), n); st.append(a); });
      own.append(st); out.append(own); if (top.length) errors.forEach(e => out.append(el("p", "meta", e)));
    };
    go.onclick = () => run(false); [qI, pinI].forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") run(); }));
    const gps = el("button", "btn ghost sm"); gps.append(ico("pin"), T.locate); gps.setAttribute("aria-label", T.locate); const hint = el("p", "meta");
    const useLoc = async (loc, pin, how) => { pinI.value = pin || pinI.value; await chrome.storage.local.set({ loc, pin: pin || "" }); if (pin) pinChip.replaceChildren(ico("pin"), pin); hint.textContent = pin ? `Using ${how} (${pin}).` : `Using ${how}.`; };
    const viaNetwork = async why => { hint.textContent = why + " Using an approximate location from your network (ipwho.is)…"; const r = await chrome.runtime.sendMessage({ type: "iplocate", gesture: gesture() });
      if (r && r.lat) await useLoc({ lat: r.lat, lon: r.lon }, r.pin, "approximate location" + (r.city ? " near " + r.city : "")); else hint.textContent = "Couldn't detect your location. Type your pincode."; };
    gps.onclick = () => {
      hint.textContent = "Asking your browser for permission… (we look up the pincode with OpenStreetMap)";
      if (!navigator.geolocation) return void viaNetwork("No location support here.");
      navigator.geolocation.getCurrentPosition(async pos => {
        const r2 = n => Math.round(n * 100) / 100, loc = { lat: r2(pos.coords.latitude), lon: r2(pos.coords.longitude) }, r = await chrome.runtime.sendMessage({ type: "reverse", ...loc });
        await useLoc(loc, r && r.pin, "your location");
      }, err => { if (err.code === 1) hint.textContent = "Location is blocked for this site. Allow it from the lock icon in the address bar, or type your pincode."; else viaNetwork("GPS isn't available in this browser."); }, { timeout: 8000, maximumAge: 600000 });
    };
    const f1 = el("div", "field"); f1.append(pl, gps);
    const sr2 = el("div", "srow"); sr2.append(ql, go); out.className = "gout"; const gb = el("div", "gbox"); gb.append(placesBox, f1, phint, hint, sr2, out); main.append(gb); // search + button share a row on wide screens
  }

  async function drawTraps() {
    const items = safeItems((await chrome.storage.local.get("items")).items), rows = Object.entries(items).filter(([, i]) => i.target || i.wish).sort((a, b) => !!b[1].target - !!a[1].target);
    if (!rows.length) return main.append(el("p", "empty", T.emptyTraps));
    if (rows.length >= 3) {
      const { waitlist } = await chrome.storage.local.get("waitlist"), w = el("div", "wl"), b = el("button", "btn", waitlist ? T.joined : T.join);
      w.append(el("b", "", "Android app coming"), "Compare across the apps on your phone. If you are signed in we use your account email only to tell you when it launches."); b.onclick = async () => { await chrome.storage.local.set({ waitlist: true }); chrome.runtime.sendMessage({ type: "waitlist", gesture: gesture() }); b.replaceChildren(ico("check"), T.joined); b.firstChild.classList.add("ck"); burst(b); }; w.append(b); main.append(w);
    }
    const list = el("div", "wlist");
    for (const [k, it] of rows) {
      const s = it.hist.length ? stats(it.hist) : null, cp = s ? s.now : (it.last || 0), lc = lastChange(it.hist), d = el("div", "wrow");
      const top = el("div", "wtop"), img = el("img"); img.alt = ""; if (it.image) img.src = it.image;
      const a = el("a", "", it.title || k); a.href = it.url; a.target = "_blank"; a.rel = "noopener";
      const p = el("div", "p num", cp ? fmt(cp) : "Open the product to see the price"); if (lc) p.append(el("span", "chg " + (lc.delta > 0 ? "up" : ""), `${lc.delta > 0 ? "+" : "−"}${fmt(Math.abs(lc.delta))}`));
      const t = el("div", "t"); t.append(a, p, el("div", "meta", it.site));
      const x = el("button", "x"); x.append(ico("x")); x.setAttribute("aria-label", "Remove from watchlist"); x.onclick = async () => { await send({ type: "remove", key: k }); draw(); };
      top.append(img, t, x); d.append(top);
      const line = el("div", "trap-line"), lab = el("span", "tl", "Trap");
      if (it.target) { line.append(lab, stepper({ value: it.target, price: cp, onSave: async v => { const r = await send({ type: "track", key: k, target: v }); return r && r.error ? LIMIT_MSG : null; } }).el); }
      else { const set = el("button", "btn ghost", "Set a trap"); set.onclick = async () => { if (!cp) return; const v = Math.max(1, Math.floor(cp * 0.95)); await send({ type: "track", key: k, target: v }); draw(); }; line.append(lab, set); }
      d.append(line); list.append(d);
    }
    main.append(list);
  }

  function setBadge() {
    kd.className = "delta num"; kd.textContent = "";
    const lc = cur && cur.it && lastChange(cur.it.hist); if (!lc) return;
    kd.textContent = `${lc.delta < 0 ? "↓" : "↑"}${notchAmount(lc.delta)}`; if (lc.delta > 0) kd.classList.add("up");
  }

  let tries = 0, unreadable = false;
  async function shopifyExtract() {
    const h = Shopify_.productHandle(location.href), sp = await Shopify_.fetchShopifyProduct(location.origin, h, fetch, location.href);
    return sp && { key: sp.key, site: sp.site, url: sp.url, title: sp.title, image: sp.image, price: sp.price, mrp: sp.mrp > sp.price ? sp.mrp : null, src: "jsonld" };
  }
  async function run() {
    if (!APP && (await chrome.storage.local.get("overlay")).overlay === false) return void host.remove();
    if (!host.isConnected) document.body.append(host); // re-appending an attached node detaches it first, which silently drops keyboard focus mid-typing
    if (!S && !SHOP) return;
    const p = cleanProduct(S ? extract() : await shopifyExtract());
    if (!p) { cur = null; setBadge(); if (tries++ < 5) return void setTimeout(run, 1500); loading = false; unreadable = !!(S ? S.id(new URL(location.href)) : SHOP); idleRedraw(); return; }
    const r = await chrome.runtime.sendMessage({ type: "seen", p });
    if (!r || r.error) { cur = null; loading = false; setBadge(); idleRedraw(); return; }
    cur = r.limited ? { limited: true, limit: r.limit, usage: { used: r.used, limit: r.limit } } : { p, it: r.it, usage: r.usage, comm: r.comm || [], chart: r.chart || [] };
    loading = false; setBadge(); idleRedraw(); ahAutoRead().catch(() => {});
  }
  run(); if (APP) setOpen(true);
  // SPA navigation (Flipkart/Myntra/Ajio): re-run when the URL changes.
  let href = location.href;
  // Amazon's own price-history answer appears inside the page when the user opens it. We read its text, nothing else, and remember the range for this product.
  if (S && dom === "amazon.in") {
    const featOff = async n => { try { const d = ((await chrome.storage.local.get("flags")).flags || {}).disabled_features; return Array.isArray(d) && d.includes(n); } catch { return false; } }, health = (event, reason) => send({ type: "ahist-health", event, reason }).catch(() => {}); // counters for Settings
    let hrT = null; const pend = []; // every batch is kept: a later batch (for example the panel closing) must not discard the chart added just before it
    new MutationObserver(mu => { pend.push(...mu); if (pend.length > 500) pend.splice(0, pend.length - 500); clearTimeout(hrT); hrT = setTimeout(async () => { const muts = pend.splice(0);
      if (!cur || !cur.p || await featOff("chart-read")) return;
      for (const m of muts) for (const n of m.addedNodes) { const root = n.nodeType === 1 ? n : null; if (!root) continue;
        const svgs = root.matches && root.matches("svg") ? [root] : [...(root.querySelectorAll ? root.querySelectorAll("svg[aria-label]") : [])];
        for (const sv of svgs) { if (!/price history/i.test(sv.getAttribute("aria-label") || "") || (sv.closest && sv.closest(HISTORY_UNTRUSTED))) continue;
          const ch = ahParseChart(sv.outerHTML, Date.now()); if (!ch) { health("refused", "unreadable"); continue; } if (!ch.current || Math.abs(ch.current - cur.p.price) > 1) { health("refused", "other-product"); continue; } // must announce today's price on THIS product
          health("read");
          const r = await send({ type: "ahist", key: cur.p.key, range: ch.range, days: ch.days, points: ch.points, current: ch.current, offer: ch.offer, highest: ch.highest }).catch(() => null);
          if (r && r.ok) { cur.it = r.it; idleRedraw(); health("stored"); } else health("refused", "price-mismatch"); } }
      let found = null;
      for (const m of muts) for (const n of m.addedNodes) { const el1 = n.nodeType === 1 ? n : n.parentElement, t = n.nodeType === 1 ? n.textContent : n.nodeType === 3 ? n.nodeValue : "";
        if (!t || t.length >= 4000 || !/ranged from/i.test(t) || !el1 || (el1.closest && el1.closest(HISTORY_UNTRUSTED)) || (n.nodeType === 1 && n.querySelector && n.querySelector(HISTORY_UNTRUSTED))) continue;
        const f = parseAmazonHistoryText(t); if (f && historyTextTrusted(f, cur.p)) { found = f; break; } }
      if (!found) return; const r = await send({ type: "history-ref", key: cur.p.key, days: found.days, low: found.low, high: found.high }).catch(() => null);
      if (r && r.ok) { cur.it = r.it; idleRedraw(); }
    }, 700); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  // Experimental, opt-in (Settings): open Amazon's own "Price history" answer out of sight, let the observer above read its chart, then close it. No endpoint is called.
  // Fail-safes: only with an ingress button present, once per product per 12 h, panel hidden by CSS while it runs, every step has a timeout, on any doubt it stops and stays quiet.
  let ahBusy = false;
  async function ahAutoRead() {
    if (ahBusy || !cur || !cur.p || dom !== "amazon.in") return; const dis = ((await chrome.storage.local.get("flags")).flags || {}).disabled_features || []; if (dis.includes("chart-auto") || dis.includes("chart-read")) return; const { ahAuto } = await chrome.storage.local.get("ahAuto"); if (ahAuto !== true) return;
    const last = cur.it && cur.it.ahist && Math.max(cur.it.ahist.at || 0, cur.it.ahist.tried || 0); if (last && Date.now() - last < 12 * 3600e3) return;
    const wait = (f, ms) => new Promise(res => { const t0 = Date.now(), iv = setInterval(() => { let v; try { v = f(); } catch { v = null; } if (v || Date.now() - t0 > ms) { clearInterval(iv); res(v || null); } }, 150); });
    ahBusy = true; let trig; try { trig = await wait(() => document.querySelector('#rufus-price-ingress-bb [data-action="show-rufus-price-ingress"], .rufus-ph-ingress-pill [data-action="show-rufus-price-ingress"]'), 10000); } finally { if (!trig) ahBusy = false; } if (!trig) return; // Amazon draws the button after the page loads
    const key = cur.p.key, hide = document.createElement("style"); hide.id = "hauls-ah-hide"; hide.textContent = "#nav-flyout-rufus,.rufus-panel-container,#rufus-conversation-papyrus-container{opacity:0!important;pointer-events:none!important;transition:none!important}"; document.documentElement.append(hide);
    const chart = () => document.querySelector('#rufus-react-renderer svg[aria-label*="price history" i]');
    try {
      await send({ type: "ahist-tried", key }).catch(() => {});
      (trig.querySelector("button, .a-button-text, a") || trig).click();
      const first = await wait(chart, 8000); if (!first) return;
      for (const label of ["3M", "1Y"]) { const tab = [...document.querySelectorAll("#rufus-react-renderer [role=tab], #rufus-react-renderer button, #rufus-react-renderer span")].find(e => e.children.length === 0 && e.textContent.trim() === label); if (!tab) continue; const before = chart() && chart().outerHTML; tab.click(); await wait(() => chart() && chart().outerHTML !== before, 4000); }
      const close = document.querySelector('#rufus-panel-header-container [aria-label*="lose" i], #nav-flyout-rufus button[aria-label*="lose" i]'); if (close) close.click();
    } finally { await new Promise(r => setTimeout(r, 400)); hide.remove(); ahBusy = false; }
  }
  setInterval(() => { if (!document.hidden && location.href !== href) { href = location.href; tries = 0; cur = null; loading = !!(S || SHOP); setBadge(); run(); } }, 1000);
})();
