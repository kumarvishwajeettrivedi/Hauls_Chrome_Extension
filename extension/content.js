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

  function extract() {
    const u = new URL(location.href), id = S && S.id(u);
    if (!id) return null;
    let ldMrp = null, src = "dom", price = num(q(S.price)), title = q(S.title)?.trim(), image = document.querySelector(S.image[0] || "x")?.src;
    if (!price) { const ld = parseLd([...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.outerHTML).join("")); if (ld) { src = "jsonld"; price = ld.price; title = title || ld.title; image = image || ld.image; ldMrp = ld.mrp; } }
    if (!price) { price = num(meta("product:price:amount") || meta("og:price:amount")); src = "meta"; }
    if (!price) return null;
    return { key: `${dom}:${id}`, site: S.name, url: u.origin + u.pathname + (dom === "flipkart.com" ? `?pid=${id}` : ""),
      title: title || meta("og:title") || document.title, image: image || meta("og:image"), price, mrp: num(q(S.mrp)) || (ldMrp > price ? ldMrp : null) || strikePrice(price), src, seller: readSeller() };
  }


  const T = TT.s, el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const P = { bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', out: '<path d="M7 17 17 7M8 7h9v9"/>', heart: '<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 2.7 5 6.1 5c2 0 3.4 1.1 4.2 2.4h3.4C14.5 6.1 15.9 5 17.9 5c3.4 0 5.2 3.5 3.7 6.8C19.5 16.4 12 21 12 21z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', swap: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
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
  // Too little own history: show the range this page reported (Amazon's own price history), with today's price on it. DOM only, no markup strings.
  const refBar = (ref, price) => {
    const w = el("div", "refbar"), track = el("div", "rb-track"), dot = el("i", "rb-dot"), lab = el("div", "rb-lab"), pos = ref.high > ref.low ? Math.min(1, Math.max(0, (price - ref.low) / (ref.high - ref.low))) : 0.5;
    dot.style.left = `calc(${(pos * 100).toFixed(1)}% - 9px)`; track.append(dot); lab.append(el("span", "num", fmt(ref.low)), el("span", "num", fmt(ref.high)));
    w.append(track, lab, el("p", "meta", `Range shown on this page for the last ${ref.days} days. HAULS is still building its own history.`)); return w;
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
    const { p, it } = cur, H = cur.comm && cur.comm.length ? mergeHistory(it.hist, cur.comm) : it.hist, s = stats(H), bw = buyWait(H, p.price, p.mrp), d = bw.deal;
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
    if (bits.length) { const sub = el("div", "sub2 num", bits.join(" · ")); if (p.mrp && p.mrp > p.price) { sub.append(el("span", "mrp", fmt(p.mrp))); } main.append(sub); }
    // low / avg / high + history chart, both following the selected range
    const c3 = el("div", "chips3"), cb = el("div", "chartbox"), seg = el("div", "seg"), now = Date.now();
    const paintRange = () => {
      const days = (RANGES.find(r => r[0] === range) || RANGES[1])[1], ws = windowStats(H, now, days || 99999) || { min: s.min, avg: s.avg, max: s.max }, sl = downsample(sliceHistory(H, days, now), 200);
      c3.replaceChildren(); [["Low", ws.min, "down"], ["Avg", ws.avg, "trend"], ["High", ws.max, "up"]].forEach(([n, v, i]) => { const x = el("div", "chip3"), sm = el("small"); sm.append(ico(i), n); x.append(sm, el("b", "num", fmt(v))); c3.append(x); });
      cb.replaceChildren(el("p", "lbl", `${range} history${cur.comm && cur.comm.length ? " · community + yours" : ""}`), sl.length > 1 || !refUsable(it.ref, p.price, now) ? chart(sl, now, days ? range : "") : refBar(it.ref, p.price));
      [...seg.children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.r === range)));
    };
    RANGES.forEach(([k]) => { const b = el("button", "", k); b.dataset.r = k; b.setAttribute("aria-pressed", "false"); b.onclick = () => { range = k; chrome.storage.local.set({ range: k }); paintRange(); }; seg.append(b); });
    main.append(seg, c3, cb); paintRange();
    // verdict
    const vc = el("div", "vcard " + bw.verdict), info = el("button", "info"); info.append(ico("info")); info.setAttribute("aria-label", "Why this verdict");
    vc.append(el("span", "vw", { buy: "Buy", wait: "Wait", okay: "Fair", unknown: "Early" }[bw.verdict]), el("span", "vl", bw.short), info);
    info.onclick = () => { const ul = el("ul"); bw.reasons.forEach(r => ul.append(el("li", "", r)));
      const nodes = [ul]; if (d.adv >= 0.1 && d.w && d.coverage !== "insufficient") nodes.push(note("Discount context", `Advertised ${Math.round(d.adv * 100)}% off the listed MRP. Against recent observed prices it's ${Math.abs(Math.round(d.vsAvg * 100))}% ${d.vsAvg <= 0 ? "below" : "above"}.`));
      openSheet(bw.title, nodes); };
    main.append(vc);
    // Deal Scanner: 0-100 score with the exact points behind it
    const sc = dealScan(H, p.price, p.mrp, Date.now(), it.ref), scard = el("div", "scan " + sc.tone), sh = el("div", "scan-h");
    sh.append(el("b", "", "Deal Scanner"), el("span", "meta", sc.score == null ? "" : `${sc.score}/100`)); scard.append(sh);
    if (sc.score == null) scard.append(el("p", "meta", sc.headline));
    else {
      const top = el("div", "scan-top"), pill = el("span", "scan-pill", sc.label), g = gaugeEl(sc.score, "Deal score");
      top.append(pill, g); scard.append(top, el("div", "scan-head", sc.headline));
      const list = el("div", "scan-rows"); sc.rows.forEach(r => { const li = el("div", "scan-r" + (r.bad ? " bad" : "")); li.append(el("span", "", r.label), el("span", "num", r.value), el("b", "num", `${r.pts}/${r.max}`)); list.append(li); });
      scard.append(list, el("p", "meta", sc.source === "amazon" ? "Based on the price range this page showed for this product. HAULS has too little of its own history yet." : "Observed by this extension from the prices it has seen. Not a seller statement."));
    }
    main.append(scard);
    // deal strength meter + chips
    const row = el("div", "row2"), mt = el("div", "meter4" + (["weak", "higher"].includes(d.badge) ? " lo" : "")), lvl = { strong: 4, normal: 3, weak: 2, higher: 1, unknown: 0 }[d.badge];
    mt.title = d.label; for (let i = 0; i < 4; i++) mt.append(el("i", i < lvl ? "on" : "")); row.append(mt);
    if (d.adv >= 0.1 && d.w && d.coverage !== "insufficient") row.append(el("span", "pill num", `${Math.abs(Math.round(d.vsAvg * 100))}% ${d.vsAvg <= 0 ? "below" : "above"} usual`));
    else row.append(el("span", "pill", d.label));
    const zone = document.querySelector("#centerCol, #ppd, #dp-container, main, [role=main]") || document.body, urg = urgencySignals(zone.innerText);
    if (urg.length) { const u = el("button", "pill y"); u.append("Urgency banner"); u.style.cursor = "pointer"; u.onclick = () => openSheet("Seen on this page", [note("Observed", urg.join(". ") + "."), note("Price history says", d.badge === "unknown" ? "Not enough history to compare yet." : `This price is: ${d.label}.`)]); row.append(u); }
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
        const known = offDone[p.key] && (offDone[p.key].offers || []).find(o => o.seller.toLowerCase() === sl.name.toLowerCase()), score = sellerScore(sl, known || null);
        const mid = el("div", "s-mid"), chips = el("div", "s-chips"), chip = (icon, text, cls) => { const c = el("span", "schip " + (cls || "")); c.append(ico(icon), text); chips.append(c); };
        mid.append(el("span", "lbl", "Seller"), el("span", "sname", sl.name), el("span", "skind", sl.kind));
        chip(sl.fba || sl.firstParty ? "shield" : "pin", sl.fba || sl.firstParty ? "Amazon ships" : "Seller ships", sl.fba || sl.firstParty ? "ok" : "warn");
        if (known && known.rating) chip("star", `${known.rating} (${known.ratings})`, known.rating >= 4 ? "ok" : known.rating >= 3 ? "" : "warn");
        if (sw) chip("swap", "Changed", "warn");
        mid.append(chips); sb.replaceChildren(mid, gaugeEl(score, "Seller signals", 96)); sb.setAttribute("aria-label", `Seller ${sl.name}, ${sl.kind}, signals ${score} of 100. Tap for details`);
      };
      fill(); sellerFill = fill;
      sb.onclick = () => { const ul = el("ul"); sl.notes.forEach(n => ul.append(el("li", "", n))); if (sw) ul.append(el("li", "", sw));
        const nodes = [ul, el("p", "meta", "Signals come from this product page and, once loaded, Amazon's seller list. HAULS does not rate or vouch for any seller.")];
        if (sl.sid) { const a = el("a", "btn ghost", "Seller profile"); a.href = new URL(p.url).origin + "/sp?seller=" + sl.sid; a.target = "_blank"; a.rel = "noopener"; nodes.push(a); }
        openSheet("About this seller", nodes); };
      main.append(sb);
    }
    // other sellers on this Amazon product (one click, one request)
    const asinM = dom === "amazon.in" && /^amazon\.in:([A-Z0-9]{10})$/.exec(p.key);
    if (asinM) {
      const ob = el("div", "offers"), obtn = el("button", "btn ghost full", "See other sellers"), paintOff = r => {
        ob.replaceChildren(); if (r.failed) return void ob.append(el("p", "meta", "Couldn't load other sellers right now."), obtn);
        if (!r.offers.length) return void ob.append(el("p", "meta", "Only one seller for this product."));
        const best = offBest(r.offers, p.price), here = (p.seller && p.seller.name || "").toLowerCase();
        if (best && best.saving > 0) ob.append(el("p", "off-save", `${fmt(best.saving)} less from ${best.lowest.seller}${best.lowest.rating && best.lowest.rating <= 2 ? ` (seller rated ${best.lowest.rating}★)` : ""}`));
        r.offers.slice(0, 8).forEach(o => { const row = el(o.sid ? "a" : "div", "off-r" + (best && o === best.lowest ? " low" : "")); if (o.sid) { row.href = new URL(p.url).origin + "/sp?seller=" + o.sid; row.target = "_blank"; row.rel = "noopener"; }
          const mine = here && o.seller.toLowerCase() === here; row.append(ratingDot(o.rating, o.ratings), el("span", "on", o.seller + (mine ? " (here)" : "")), el("b", "num", fmt(o.price)),
            el("small", "", [o.cond !== "New" ? o.cond : "", o.ships ? "Ships from " + o.ships : "", o.rating ? `Seller ${o.rating}★ (${o.ratings} rating${o.ratings === 1 ? "" : "s"})` : ""].filter(Boolean).join(" · "))); ob.append(row); });
        ob.append(el("p", "meta", "Read from Amazon's own seller list for this item. Delivery, returns and seller quality can differ."));
      };
      obtn.onclick = async () => { obtn.disabled = true; obtn.textContent = "Loading sellers…"; offDone[p.key] = await send({ type: "offers", asin: asinM[1] }).catch(() => ({ failed: true, offers: [] })); if (cur && cur.p && cur.p.key === p.key) { paintOff(offDone[p.key]); if (sellerFill) sellerFill(); } };
      if (offDone[p.key]) paintOff(offDone[p.key]); else ob.append(obtn); main.append(ob);
    }
    // stores
    const { links } = smartLinks(p.title, S ? S.name : ""), SHOW = 5, sec = el("div"), st = el("div", "stores");
    sec.append(el("p", "lbl", "Compare"));
    // best price across stores: runs only when asked, one search page per store
    const cbox = el("div", "cmp"), cbtn = el("button", "btn ghost full", "Find the best price across stores");
    const paintCmp = r => {
      cbox.replaceChildren(); const here = p.price;
      if (r.error) return void cbox.append(el("p", "meta", "Couldn't compare right now. Try again later."), cbtn);
      const all = [...r.results.map(x => x.price), here], low = Math.min(...all);
      if (!r.results.length) { cbox.append(el("p", "meta", "No confident match at other stores.")); (r.near || []).slice(0, 2).forEach(x => { const a = el("a", "cmp-r near"); a.href = x.url; a.target = "_blank"; a.rel = "noopener"; a.append(el("span", "", x.store), el("b", "num", fmt(x.price)), el("span", "tag", x.why), el("small", "", "Closest, not the same item: " + String(x.title).slice(0, 70))); cbox.append(a); }); }
      else { const hr = el("div", "cmp-r" + (here <= low ? " low" : "")); hr.append(el("span", "", `${p.site} (here)`), el("b", "num", fmt(here)), el("span", "tag", here <= low ? "Lowest" : "")); cbox.append(hr); }
      r.results.forEach(x => { const a = el("a", "cmp-r" + (x.price <= low ? " low" : "")), d = x.price - here; a.href = x.url; a.target = "_blank"; a.rel = "noopener";
        a.append(el("span", "", x.store), el("b", "num", fmt(x.price)), el("span", "tag", x.price <= low ? "Lowest" : d > 0 ? `${fmt(d)} more` : d < 0 ? `${fmt(-d)} less` : "Same"), el("small", "", x.confidence + " match")); cbox.append(a); });
      if (r.failed.length) cbox.append(el("p", "meta", `Couldn't check: ${r.failed.join(", ")}.`));
      cbox.append(el("p", "meta", "Prices come from each store's search page. Offers, shipping and seller may differ."));
    };
    cbtn.onclick = async () => { cbtn.disabled = true; cbtn.textContent = "Checking other stores…"; const r = await send({ type: "compare", title: p.title, site: p.site, price: p.price }).catch(() => ({ error: "x" })); cmpDone[p.key] = r || { error: "x" }; if (cur && cur.p && cur.p.key === p.key) paintCmp(cmpDone[p.key]); };
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
  let revExtra = null; const cmpDone = {}, offDone = {}; let sellerFill = null;
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
      nodes.push(el("p", "meta", "We store your name, email and watchlist. Prices you see are shared only if you switch sharing on, and are kept apart from your name and email (never shown to anyone). Your data stays in this browser first. You can erase your cloud data anytime."));
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
    cur = r.limited ? { limited: true, limit: r.limit, usage: { used: r.used, limit: r.limit } } : { p, it: r.it, usage: r.usage, comm: r.comm || [] };
    loading = false; setBadge(); idleRedraw();
  }
  run(); if (APP) setOpen(true);
  // SPA navigation (Flipkart/Myntra/Ajio): re-run when the URL changes.
  let href = location.href;
  // Amazon's own price-history answer appears inside the page when the user opens it. We read its text, nothing else, and remember the range for this product.
  if (S && dom === "amazon.in") {
    let hrT = null;
    new MutationObserver(muts => { clearTimeout(hrT); hrT = setTimeout(async () => {
      if (!cur || !cur.p) return; let found = null;
      for (const m of muts) for (const n of m.addedNodes) { const el1 = n.nodeType === 1 ? n : n.parentElement, t = n.nodeType === 1 ? n.textContent : n.nodeType === 3 ? n.nodeValue : "";
        if (!t || t.length >= 4000 || !/ranged from/i.test(t) || !el1 || (el1.closest && el1.closest(HISTORY_UNTRUSTED)) || (n.nodeType === 1 && n.querySelector && n.querySelector(HISTORY_UNTRUSTED))) continue;
        const f = parseAmazonHistoryText(t); if (f && historyTextTrusted(f, cur.p)) { found = f; break; } }
      if (!found) return; const r = await send({ type: "history-ref", key: cur.p.key, days: found.days, low: found.low, high: found.high }).catch(() => null);
      if (r && r.ok) { cur.it = r.it; idleRedraw(); }
    }, 700); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  setInterval(() => { if (!document.hidden && location.href !== href) { href = location.href; tries = 0; cur = null; loading = !!(S || SHOP); setBadge(); run(); } }, 1000);
})();
