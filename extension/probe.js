// Page probe for Settings > "Copy page report". Runs inside the user's own Amazon tab (all frames) only when they click the button.
// Self-contained (it is injected by source). Reads only: matching sentences, a few ancestor tag/id/class names, and chart/Rufus element counts.
// It never reads cookies, forms, the account name, or anything that does not match the price-history wording.
function historyProbe() {
  const RE = /price history|ranged from|featured offer price|lowest price|price over time/i, MAXHITS = 8;
  const scrubFull = t => String(t).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/\b\d{10,}\b/g, "[number]").replace(/\s+/g, " ").trim(), scrub = t => scrubFull(t).slice(0, 400);
  const desc = e => e.tagName.toLowerCase() + (e.id ? "#" + e.id.slice(0, 40) : "") + (e.classList.length ? "." + [...e.classList].slice(0, 3).join(".").slice(0, 60) : "") + (e.getAttribute("role") ? "[role=" + e.getAttribute("role") + "]" : "") + (e.getAttribute("data-hook") ? "[data-hook=" + e.getAttribute("data-hook") + "]" : "");
  const out = { triggers: [], frame: location.origin + location.pathname, isTop: window === window.top, hits: [], charts: [], rufus: [], shadowRoots: 0 };
  const scan = (root, inShadow) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n && out.hits.length < MAXHITS; n = w.nextNode()) {
      const v = n.nodeValue; if (!v || v.length > 1500 || !RE.test(v)) continue;
      const path = []; for (let e = n.parentElement, i = 0; e && i < 7; e = e.parentElement, i++) path.push(desc(e));
      out.hits.push({ text: scrub(v), inShadow, path });
    }
    for (const e of root.querySelectorAll("*")) { if (e.shadowRoot) { out.shadowRoots++; if (out.shadowRoots < 20) scan(e.shadowRoot, true); } }
  };
  try { scan(document.body || document, false); } catch (e) { out.error = String(e && e.message).slice(0, 80); }
  // the "Price history" link/button itself: how a page (or we, later) could open it
  for (const e of [...document.querySelectorAll("a,button,span[role=button],div[role=button],[data-action]")].slice(0, 3000)) { if (!/^\s*price history\s*$/i.test(e.textContent || "")) continue;
    const at = {}; for (const a of e.attributes) if (/^(id|class|href|role|aria-[a-z-]+|data-[a-z0-9-]+)$/.test(a.name)) at[a.name] = String(a.value).slice(0, 160); out.triggers.push({ tag: e.tagName.toLowerCase(), attrs: at, path: (() => { const p = []; for (let x = e.parentElement, i = 0; x && i < 6; x = x.parentElement, i++) p.push(desc(x)); return p; })() }); if (out.triggers.length >= 3) break; }
  const hitEls = out.hits.length;
  for (const s of [...document.querySelectorAll("svg")].slice(0, 400)) {
    const paths = s.querySelectorAll("path"), texts = [...s.querySelectorAll("text")].map(t => t.textContent.trim()).filter(Boolean);
    if (texts.some(t => /₹|\d{1,2}\s?(Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug)/i.test(t)) || (paths.length && hitEls && s.closest("[class*=price i],[id*=price i],[class*=rufus i],[id*=rufus i],[class*=history i]")))
      out.charts.push({ path: (() => { const p = []; for (let e = s.parentElement, i = 0; e && i < 5; e = e.parentElement, i++) p.push(desc(e)); return p; })(), paths: paths.length, labels: texts.slice(0, 12), pathD: paths.length ? (paths[0].getAttribute("d") || "").slice(0, 300) : "", svg: scrubFull(s.outerHTML.replace(/ style="[^"]*"/g, "")).slice(0, 14000) });
    if (out.charts.length >= 4) break;
  }
  for (const e of [...document.querySelectorAll("[id*=rufus i],[class*=rufus i],[aria-label*=rufus i]")].slice(0, 12)) out.rufus.push(desc(e));
  return out;
}
if (typeof module !== "undefined") module.exports = { historyProbe };
