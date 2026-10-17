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
const PAGE_BUILD = "2026-10-17.r21";
chrome.runtime.sendMessage({ type: "t2-version" }).then(r => { const ok = r && r.build === PAGE_BUILD; $("ver").textContent = "HAULS " + chrome.runtime.getManifest().version + (ok ? " · up to date" : ""); $("stale").hidden = !!ok; }).catch(() => { $("stale").hidden = false; });
$("reload").onclick = () => chrome.runtime.reload();

// Back goes to the extension home screen (the same panel, full page).
$("back").onclick = () => { location.href = "home.html"; };

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
$("pcopy").onclick = async () => { try { await navigator.clipboard.writeText(lastProbe); $("pmsg").textContent = "Copied."; } catch { $("pmsg").textContent = "Select the text and copy it."; } };

// ---- background price checks: per-store health + manual run
async function paintTrk() {
  const { trk, items } = await chrome.storage.local.get(["trk", "items"]), box = $("trk"); box.replaceChildren();
  const watched = Object.entries(items || {}).filter(([k, i]) => i && (i.target || i.wish)).length, H = (trk && trk.health) || {};
  const head = document.createElement("p"); head.className = "meta"; head.textContent = `${watched} item${watched === 1 ? "" : "s"} watched.`; box.append(head);
  for (const [dom, name] of [["amazon.in", "Amazon"], ["flipkart.com", "Flipkart"], ["myntra.com", "Myntra"]]) {
    const h = H[dom], row = document.createElement("div"), b = document.createElement("b"), pill = document.createElement("span"); row.className = "srow"; b.textContent = name;
    const paused = trk && trk.pause && trk.pause[dom] > Date.now(), bad = h && h.fail > h.ok;
    pill.className = "pill" + (h && h.ok && !bad && !paused ? " on" : ""); pill.textContent = paused ? "Paused (blocked)" : !h ? "Not checked yet" : `${h.ok} ok · ${h.fail} failed`;
    row.append(b, pill); if (h && h.last) { const t = document.createElement("span"); t.className = "meta"; t.textContent = new Date(h.last).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + (Object.keys(h.reasons || {}).length ? " · " + Object.entries(h.reasons).map(([k, v]) => `${k} ${v}`).join(", ") : "") + (h.starved ? ` · ${h.starved} skipped (daily limit)` : "") + (h.errors ? ` · ${h.errors} save errors` : ""); row.append(t); }
    box.append(row);
  }
}
$("trkrun").onclick = async () => { $("tmsg").textContent = "Checking…"; const r = await chrome.runtime.sendMessage({ type: "trk-run", gesture: true }).catch(() => null); $("tmsg").textContent = r && !r.error ? `Checked ${r.checked}, new prices ${r.recorded}, waiting for a second read ${r.held}, failed ${r.failed}.` : "Couldn't run the check."; paintTrk(); };
paintTrk();

chrome.storage.local.get("ahAuto").then(r => { $("ahauto").checked = r.ahAuto === true; }); $("ahauto").onchange = () => chrome.storage.local.set({ ahAuto: $("ahauto").checked });
