// Tier-2 relay (isolated world): forwards what t2-hook.js saw to the extension. Only this window's own messages; size-capped.
window.addEventListener("message", e => {
  const d = e.data; if (e.source !== window || !d || d.hauls !== "t2cap") return;
  try { chrome.runtime.sendMessage({ type: "t2-capture", url: String(d.url).slice(0, 500), method: String(d.method).slice(0, 10), status: +d.status || 0, body: String(d.body).slice(0, 700000), hdr: d.hdr && typeof d.hdr === "object" ? d.hdr : {} }); } catch {}
});
