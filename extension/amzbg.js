// Opt-in (Settings "Read Amazon's price history automatically"): while you are away from the computer, open ONE watched Amazon product in a small window,⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​‌‌​​‌‌​​​‌‌​‌‌‌​​‌‌‌​​‌​‌‌​​‌​​​​‌‌​​‌‌​‌‌​​​‌‌​​‌‌​​​‌​​‌‌​‌​‌⁡
// let the page script (content.js ahAutoRead) read Amazon's own chart, then close it. Same chart reading and checks as when you browse; no endpoint is called.
// Limits: you must be idle 2 min, one product per run, 12 h per product, 4 a day, never while a kill-switch flag is set. Names prefixed abg*.
const ABG = { IDLE_S: 120, TRY_MS: 12 * 3600e3, FRESH_MS: 24 * 3600e3, DAY_CAP: 4, WAIT_MS: 30e3 };
async function abgRun(now = Date.now(), { force = false } = {}) {
  const S = await chrome.storage.local.get(["ahAuto", "flags", "abg", "items"]), dis = (S.flags && S.flags.disabled_features) || [];
  if (S.ahAuto !== true || dis.includes("chart-auto") || dis.includes("chart-read")) return { ok: false, why: "off" };
  const day = new Date(now).toISOString().slice(0, 10), A = S.abg && S.abg.day === day ? S.abg : { day, n: 0, tries: (S.abg && S.abg.tries) || {} };
  if (!force && A.n >= ABG.DAY_CAP) return { ok: false, why: "daily limit" };
  if (!force && await chrome.idle.queryState(ABG.IDLE_S) !== "idle") return { ok: false, why: "you are active" };
  const items = S.items || {}, key = Object.keys(items).filter(k => /^amazon\.in:/.test(k) && (items[k].wish || items[k].target || (items[k].seenAt && now - items[k].seenAt < 30 * 864e5)) && /^https:\/\/www\.amazon\.in\//.test(items[k].url || "") && now - ((items[k].ahist && items[k].ahist.at) || 0) > ABG.FRESH_MS && now - (A.tries[k] || 0) > ABG.TRY_MS)
    .sort((a, b) => ((items[a].ahist && items[a].ahist.at) || 0) - ((items[b].ahist && items[b].ahist.at) || 0))[0];
  if (!key) return { ok: false, why: "nothing due" };
  A.n++; A.tries[key] = now; for (const k of Object.keys(A.tries)) if (now - A.tries[k] > 3 * 864e5) delete A.tries[k]; await chrome.storage.local.set({ abg: A });
  const before = (items[key].ahist && items[key].ahist.at) || 0, probe = await T2.openProbe(items[key].url); let got = false;
  try { for (let t0 = Date.now(); Date.now() - t0 < ABG.WAIT_MS && !got; ) { await new Promise(r => setTimeout(r, 1000)); const it = ((await chrome.storage.local.get("items")).items || {})[key]; got = !!(it && it.ahist && it.ahist.at > before); } }
  finally { await probe.close(); }
  await bumpHealth("chartHealth", got ? "bg-read" : "bg-miss", got ? undefined : "no-chart-in-background");
  return { ok: got, key };
}
if (typeof module !== "undefined") module.exports = { abgRun, ABG };
