// Tier-2 page hook. Runs in the PAGE of a store the user connected, ONLY on a tab HAULS opened itself (URL carries haulsprobe=1).
// It copies the store's own search responses to the extension and never changes them. Normal browsing of the store is untouched.
(() => {
  if (window.__haulsT2 || !/[?&]haulsprobe=1\b/.test(location.search)) return; window.__haulsT2 = 1;
  const PAT = /user-search-service\/api\/v3\/search|instamart|listing-svc\/|ext\/vertex\/application\/api\/v1\.0\/products|api\/4\/page\/fetch|serviceab|pincode|pin_code/i, LOC = /store|lat|lon|pin|loc|serviceab/i, MAX = 7e5;
  const hdrs = h => { const o = {}; try { const it = typeof Headers !== "undefined" && h instanceof Headers ? [...h.entries()] : Array.isArray(h) ? h : Object.entries(h || {}); for (const [k, v] of it) if (LOC.test(k)) o[String(k).toLowerCase()] = String(v).slice(0, 120); } catch {} return o; };
  const send = (url, method, status, text, hdr) => { try { window.postMessage({ hauls: "t2cap", url: String(url), method: String(method || "GET"), status, body: String(text).slice(0, MAX), hdr }, location.origin); } catch {} };
  const f0 = window.fetch;
  window.fetch = function (input, init) {
    const p = f0.apply(this, arguments); let url; try { url = typeof input === "string" ? input : (input && input.url) || String(input); } catch {}
    if (url && PAT.test(url)) { const method = (init && init.method) || (input && input.method), hdr = hdrs((init && init.headers) || (input && input.headers)); p.then(r => r.clone().text().then(t => send(url, method, r.status, t, hdr)).catch(() => {}), () => {}); }
    return p;
  };
  const X = XMLHttpRequest.prototype, open = X.open, setH = X.setRequestHeader, sendX = X.send;
  X.open = function (m, u) { this.__h = { m, u: String(u), hdr: {} }; return open.apply(this, arguments); };
  X.setRequestHeader = function (k, v) { if (this.__h && LOC.test(k)) this.__h.hdr[String(k).toLowerCase()] = String(v).slice(0, 120); return setH.apply(this, arguments); };
  X.send = function () { const h = this.__h; if (h && PAT.test(h.u)) this.addEventListener("load", () => { try { send(h.u, h.m, this.status, typeof this.response === "string" ? this.response : this.responseText, h.hdr); } catch {} }); return sendX.apply(this, arguments); };
})();
