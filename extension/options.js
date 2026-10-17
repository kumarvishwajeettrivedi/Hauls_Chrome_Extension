//⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​​‌‌​‌​‌​​‌‌​​​​​​‌‌​​​‌​‌‌​​​‌‌​​‌‌​‌​​​​‌‌​‌‌​​​‌‌​​​‌​​‌‌​​‌‌⁡
const $ = id => document.getElementById(id), ORIGINS = { origins: ["https://*/*"] };
$("logo").innerHTML = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><circle cx="512" cy="512" r="480" fill="#0754F8"/><g transform="translate(197 197) scale(1.79)"><g transform="translate(16 16)" fill="#fff"><path d="M16 64 112 0v128h64L16 256Z"/><path d="m176 96 128-64v224l-128 64Z"/></g></g></svg>';
async function paint() { const on = await chrome.permissions.contains(ORIGINS); $("state").textContent = on ? "On" : "Off"; $("state").classList.toggle("on", on); $("on").hidden = on; $("off").hidden = !on; }
$("on").onclick = async () => { // must run inside this click (user gesture)
  const ok = await chrome.permissions.request(ORIGINS); if (ok) { const r = await chrome.runtime.sendMessage({ type: "enableShopify" }); $("msg").textContent = r ? "Enabled. Open a product page on an independent store and click the HAULS notch." : "Permission granted, but setup failed. Reload the extension."; } else $("msg").textContent = "Not enabled. You can try again any time.";
  paint(); };
$("off").onclick = async () => { await chrome.runtime.sendMessage({ type: "disableShopify" }); $("msg").textContent = "Turned off."; paint(); };
paint();

// ---- grocery stores (tier 2): connect once, test, copy a sanitised report ----
// Origins must match T2.STORES in tier2.js (a unit test checks this).
const T2_ORIGINS = { Zepto: ["https://*.zepto.com/*"], Instamart: ["https://*.swiggy.com/*"], BigBasket: ["https://*.bigbasket.com/*"], JioMart: ["https://www.jiomart.com/*"], "Flipkart Minutes": ["https://*.flipkart.com/*"] };
const send = m => chrome.runtime.sendMessage({ ...m, gesture: true });
let lastReport = "";
async function paintStores() {
  const st = await send({ type: "t2-status" }) || {}, box = $("stores"); box.replaceChildren();
  for (const name of Object.keys(T2_ORIGINS)) {
    const row = document.createElement("div"), pill = document.createElement("span"), on = !!st[name]; row.className = "srow";
    const b = document.createElement("b"); b.textContent = name; pill.className = "pill" + (on ? " on" : ""); pill.textContent = on ? "Connected" : "Not connected"; row.append(b, pill);
    const btn = (label, cls, fn) => { const x = document.createElement("button"); x.textContent = label; if (cls) x.className = cls; x.onclick = fn; row.append(x); };
    if (!on) btn("Connect", "", async () => { // the permission prompt must open inside this click
      const ok = await chrome.permissions.request({ origins: T2_ORIGINS[name] }); if (!ok) { $("smsg").textContent = "Not allowed."; return; }
      const r = await send({ type: "t2-connect", store: name }); $("smsg").textContent = r && r.ok ? name + " connected." : "Couldn't connect " + name + ": " + ((r && (r.message || r.why || r.reason || r.error)) || "no answer") + "."; paintStores(); });
    else { btn("Test", "", async () => { $("smsg").textContent = "Testing " + name + "… a tab opens briefly."; $("report").hidden = true; $("copy").hidden = true;
        const r = await send({ type: "t2-test", store: name }); if (r && r.ok) { lastReport = JSON.stringify(r.report, null, 2); $("report").textContent = lastReport; $("report").hidden = false; $("copy").hidden = false; $("smsg").textContent = name + ": got a response. No logins in the report."; }
        else $("smsg").textContent = name + ": " + (r && r.message || "failed"); });
      btn("Disconnect", "ghost", async () => { await send({ type: "t2-disconnect", store: name }); $("smsg").textContent = name + " disconnected."; paintStores(); }); }
    box.append(row);
  }
}
$("copy").onclick = async () => { try { await navigator.clipboard.writeText(lastReport); $("smsg").textContent = "Report copied."; } catch { $("smsg").textContent = "Select the report text and copy it."; } };
paintStores();

// One delivery pincode for everything: it is set in the Grocery tab (or the header chip). Here it is only shown.
const showPin = pin => { $("pinval").textContent = pin || "not set"; };
chrome.storage.local.get("pin").then(v => showPin(v.pin)); chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.pin) showPin(ch.pin.newValue); });

// Is the background (service worker) the same build as this page? A stale one rejects the unknown message.
const PAGE_BUILD = "2026-10-18.r34";
chrome.runtime.sendMessage({ type: "t2-version" }).then(r => { const ok = r && r.build === PAGE_BUILD; $("ver").textContent = "HAULS " + chrome.runtime.getManifest().version + (ok ? " · up to date" : "") + " · built by Vishwajeet · hauls.in"; $("stale").hidden = !!ok; }).catch(() => { $("stale").hidden = false; });
$("reload").onclick = () => chrome.runtime.reload();


// ---- Amazon price-history page report: runs only on click, only on an Amazon.in tab the user already has open ----
let lastProbe = "";
$("probe").onclick = async () => {
  $("pmsg").textContent = "Looking at your Amazon tab…"; $("preport").hidden = true; $("pcopy").hidden = true;
  try {
    const tabs = (await chrome.tabs.query({ url: ["https://www.amazon.in/*"] })).filter(t => /\/(dp|gp\/product)\//.test(t.url || ""));
    const tab = tabs.find(t => t.active) || tabs[0]; if (!tab) { $("pmsg").textContent = "Open an Amazon.in product page first, then come back."; return; }
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: historyProbe });
    const frames = res.map(r => r.result).filter(Boolean), found = frames.reduce((n, f) => n + f.hits.length, 0);
    lastProbe = JSON.stringify({ kind: "amazon-history-probe", build: PAGE_BUILD, at: new Date().toISOString(), product: new URL(tab.url).pathname.slice(0, 60), frames }, null, 2);
    $("preport").textContent = lastProbe; $("preport").hidden = false; $("pcopy").hidden = false;
    try { await navigator.clipboard.writeText(lastProbe); $("pmsg").textContent = found ? `Copied. Found ${found} price-history line${found > 1 ? "s" : ""}. Paste it in the chat.` : "Copied, but no price-history wording was on the tab. Open Amazon's Price history first, then press again."; }
    catch { $("pmsg").textContent = "Select the report text below and copy it."; }
  } catch (e) { $("pmsg").textContent = "Couldn't read the tab: " + String(e && e.message).slice(0, 100); }
};
// What HAULS has stored about your Amazon products (keys, counts and times only: no titles, links or prices of your account), to see whether a chart or range was kept.
$("sumcopy").onclick = async () => { const { items, chartHealth } = await chrome.storage.local.get(["items", "chartHealth"]), rows = Object.entries(items || {}).filter(([k]) => /^amazon\.in:/.test(k)).map(([k, i]) => ({ key: k, points: (i.hist || []).length, first: i.hist && i.hist[0] ? new Date(i.hist[0][0]).toISOString() : null, ref: i.ref ? { days: i.ref.days, low: i.ref.low, high: i.ref.high, at: new Date(i.ref.at).toISOString() } : null, ahist: i.ahist ? { at: new Date(i.ahist.at || 0).toISOString(), ranges: Object.fromEntries(Object.entries(i.ahist.ranges || {}).map(([r, v]) => [r, { points: v.points.length, days: v.days }])) } : null, urg: i.urg ? i.urg.v.length : 0 }));
  lastProbe = JSON.stringify({ kind: "storage-summary", build: PAGE_BUILD, version: chrome.runtime.getManifest().version, chartHealth: chartHealth || null, amazonItems: rows.slice(0, 40) }, null, 2); $("preport").textContent = lastProbe; $("preport").hidden = false; $("pcopy").hidden = false;
  try { await navigator.clipboard.writeText(lastProbe); $("pmsg").textContent = `Copied a summary of ${rows.length} Amazon product${rows.length === 1 ? "" : "s"}. Paste it in the chat.`; } catch { $("pmsg").textContent = "Select the text below and copy it."; } };
$("pcopy").onclick = async () => { try { await navigator.clipboard.writeText(lastProbe); $("pmsg").textContent = "Copied."; } catch { $("pmsg").textContent = "Select the text and copy it."; } };

// ---- background price checks: per-store health + manual run
async function paintTrk() {
  const { trk, items } = await chrome.storage.local.get(["trk", "items"]), box = $("trk"); box.replaceChildren();
  const watched = Object.entries(items || {}).filter(([k, i]) => i && (i.target || i.wish)).length, H = (trk && trk.health) || {};
  const head = document.createElement("p"); head.className = "meta"; head.textContent = `${watched} item${watched === 1 ? "" : "s"} watched.`; box.append(head);
  for (const [dom, name] of [["amazon.in", "Amazon"], ["flipkart.com", "Flipkart"], ["myntra.com", "Myntra"], ["reliancedigital.in", "Reliance Digital"], ["tatacliq.com", "Tata CLiQ"]]) {
    const h = H[dom], row = document.createElement("div"), b = document.createElement("b"), pill = document.createElement("span"); row.className = "srow"; b.textContent = name;
    const paused = trk && trk.pause && trk.pause[dom] > Date.now(), bad = h && h.fail > h.ok;
    pill.className = "pill" + (h && h.ok && !bad && !paused ? " on" : ""); pill.textContent = paused ? "Paused (blocked)" : !h ? "Not checked yet" : `${h.ok} ok · ${h.fail} failed`;
    row.append(b, pill); if (h && h.last) { const t = document.createElement("span"); t.className = "meta"; t.textContent = new Date(h.last).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + (Object.keys(h.reasons || {}).length ? " · " + Object.entries(h.reasons).map(([k, v]) => `${k} ${v}`).join(", ") : "") + (h.starved ? ` · ${h.starved} skipped (daily limit)` : "") + (h.errors ? ` · ${h.errors} save errors` : ""); row.append(t); }
    box.append(row);
  }
  paintHist();
}
// Amazon history card: the on/off switch is above; this is its health in one line.
async function paintHist() {
  const { chartHealth: C, flags, ahAuto } = await chrome.storage.local.get(["chartHealth", "flags", "ahAuto"]), off = ((flags && flags.disabled_features) || []).some(f => /^chart-/.test(f)), box = $("hstat"); box.replaceChildren();
  const pill = document.createElement("span"), t = document.createElement("span"), skipped = C ? Object.values(C.reasons || {}).reduce((n, v) => n + v, 0) : 0; pill.className = "pill" + (C && C.stored && !off ? " on" : ""); t.className = "meta";
  pill.textContent = off ? "Paused by HAULS" : !C ? "Not read yet" : `${C.stored || 0} saved`;
  t.textContent = off ? "HAULS switched chart reading off for now." : !C ? (ahAuto === true ? "Press Read now, or just browse: it also reads while you are away." : "Turn the switch on, then press Read now.") : `${skipped} skipped · last ${new Date(C.last).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` + (skipped ? " · " + Object.entries(C.reasons || {}).map(([k, v]) => `${k} ${v}`).join(", ") : "");
  box.append(pill, t);
}
$("trkrun").onclick = async () => { $("tmsg").textContent = "Checking…"; const r = await chrome.runtime.sendMessage({ type: "trk-run", gesture: true }).catch(() => null); $("tmsg").textContent = r && !r.error ? `Checked ${r.checked}, new prices ${r.recorded}, waiting for a second read ${r.held}, failed ${r.failed}.` : "Couldn't run the check."; paintTrk(); };
$("testalert").onclick = async () => { const r = await chrome.runtime.sendMessage({ type: "test-alert", gesture: true }).catch(() => null); $("tmsg").textContent = !r || !r.ok ? "Couldn't send a test alert." : r.level === "granted" ? "Test alert sent. If you saw nothing, check your system's notification settings for Chrome." : "Chrome notifications are blocked on this device. Allow them in system settings."; };
$("abgrun").onclick = async () => { $("hmsg").textContent = "Opening one watched Amazon product in a small window…"; const r = await chrome.runtime.sendMessage({ type: "abg-run", gesture: true }).catch(() => null); $("hmsg").textContent = r && r.ok ? "Read Amazon's price history for one product." : r && r.why === "off" ? "Turn on automatic reading first." : r && r.why === "nothing due" ? "Nothing due: every watched Amazon product was read in the last day." : "Couldn't read it this time (needs Amazon sign-in and a product with a price-history button)."; paintHist(); };
paintTrk();

chrome.storage.local.get("ahAuto").then(r => { $("ahauto").checked = r.ahAuto === true; }); $("ahauto").onchange = () => chrome.storage.local.set({ ahAuto: $("ahauto").checked });

// ---- Get started card: three animated steps that tick themselves off as you do them
async function paintStart() {
  const S = await chrome.storage.local.get(["ahAuto", "items", "startHidden"]), items = Object.values(S.items || {}), done = [S.ahAuto === true, items.length > 0, items.some(i => i && (i.wish || i.target))], n = done.filter(Boolean).length;
  done.forEach((d, i) => $("st" + (i + 1)).classList.toggle("done", d)); $("startcount").textContent = `${n} of 3`; $("startbar").style.width = Math.round(n / 3 * 100) + "%"; $("start").hidden = S.startHidden === true || n === 3;
}
$("starthide").onclick = async () => { await chrome.storage.local.set({ startHidden: true }); paintStart(); };
$("st1go").onclick = () => { $("s-history").scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => $("ahauto").focus(), 300); };
paintStart(); paintHist();
chrome.storage.onChanged.addListener((ch, area) => { if (area !== "local") return; if (ch.ahAuto) $("ahauto").checked = ch.ahAuto.newValue === true; if (ch.ahAuto || ch.items || ch.startHidden) paintStart(); if (ch.chartHealth || ch.ahAuto || ch.flags) paintHist(); if (ch.trk || ch.items) paintTrk(); });

// ---- Guided tour: a spotlight walks through the three sections that matter (starts by itself on a fresh install, or from "Take the tour")
const TOUR = [
  { el: "s-history", title: "Turn this on", text: "One switch gives you real Amazon price history. The rest works with the defaults.", act: ["Turn it on", async () => { await chrome.storage.local.set({ ahAuto: true }); }] },
  { el: "s-track", title: "Check it is working", text: "Each store shows if background checks are healthy. Press Check now any time." },
  { el: "s-stores", title: "Optional extras", text: "Brand sites and grocery stores need your OK once. Skip this if you only shop on Amazon, Flipkart or Myntra." },
];
function startTour(i = 0) {
  document.querySelectorAll(".tour-dim,.tour-spot,.tour-tip,.tour-hand").forEach(e => e.remove());
  const dim = document.createElement("div"), spot = document.createElement("div"), tip = document.createElement("div"), hand = document.createElement("div"); dim.className = "tour-dim"; spot.className = "tour-spot"; tip.className = "tour-tip"; hand.className = "tour-hand"; hand.textContent = "👆"; tip.setAttribute("role", "dialog"); tip.setAttribute("aria-label", "Settings tour");
  document.body.append(dim, spot, tip, hand);
  const end = () => { [dim, spot, tip, hand].forEach(e => e.remove()); removeEventListener("resize", place); removeEventListener("scroll", place, true); removeEventListener("keydown", key); chrome.storage.local.set({ tourDone: true }); }, key = e => { if (e.key === "Escape") end(); };
  function place() {
    const st = TOUR[i], t = $(st.el).getBoundingClientRect(), pad = 6; Object.assign(spot.style, { left: t.left - pad + "px", top: t.top - pad + "px", width: t.width + 2 * pad + "px", height: t.height + 2 * pad + "px" });
    const below = t.bottom + 16 + 190 < innerHeight, top = below ? t.bottom + 14 : Math.max(10, t.top - 14 - tip.offsetHeight), left = Math.max(12, Math.min(innerWidth - tip.offsetWidth - 12, t.left)); Object.assign(tip.style, { top: top + "px", left: left + "px" });
    Object.assign(hand.style, { left: Math.min(innerWidth - 40, t.right - 44) + "px", top: (below ? t.bottom - 10 : t.top - 36) + "px" });
  }
  let seq = 0;
  function show() {
    const my = ++seq, st = TOUR[i]; $(st.el).scrollIntoView({ block: "center", behavior: "smooth" }); tip.classList.add("hide"); hand.style.opacity = "0";
    const dots = document.createElement("div"), h = document.createElement("h3"), p = document.createElement("p"), acts = document.createElement("div"); dots.className = "dots"; TOUR.forEach((_, k) => { const d = document.createElement("i"); if (k === i) d.className = "on"; dots.append(d); }); h.textContent = `${i + 1}. ${st.title}`; p.textContent = st.text; acts.className = "acts";
    const mk = (label, cls, fn) => { const b = document.createElement("button"); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; acts.append(b); return b; };
    mk("Skip", "skip", end); if (i > 0) mk("Back", "ghost", () => { i--; show(); });
    if (st.act) mk(st.act[0], "ghost", async e => { await st.act[1](); e.target.textContent = "Done ✓"; e.target.disabled = true; });
    mk(i === TOUR.length - 1 ? "Done" : "Next", "", () => { if (i === TOUR.length - 1) end(); else { i++; show(); } });
    setTimeout(() => { if (my !== seq) return; tip.replaceChildren(dots, h, p, acts); place(); }, tip.childElementCount ? 380 : 0); // let the old text fade before the new text appears
    setTimeout(() => { if (my === seq) place(); }, 600); setTimeout(() => { if (my !== seq) return; place(); tip.classList.remove("hide"); hand.style.opacity = "1"; }, 1100); // the spotlight settles first, then the words fade in
  }
  addEventListener("resize", place); addEventListener("scroll", place, true); addEventListener("keydown", key); dim.onclick = end; show();
}
$("tour").onclick = () => startTour();
if (new URLSearchParams(location.search).get("welcome") === "1") setTimeout(() => startTour(), 700);
