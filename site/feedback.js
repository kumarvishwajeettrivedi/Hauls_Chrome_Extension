// Uninstall feedback form. Sends one anonymous request to the ext_submit_feedback function; nothing else leaves the page, nothing is stored in the browser.
(() => {
  const $ = id => document.getElementById(id), cfg = window.HAULS_FEEDBACK || {}, v = (new URLSearchParams(location.search).get("v") || "").match(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  let rating = 0; const stars = [...document.querySelectorAll(".star")];
  const paint = () => stars.forEach((b, i) => { b.setAttribute("aria-checked", String(i + 1 === rating)); b.classList.toggle("on", i < rating); });
  stars.forEach((b, i) => { b.onclick = () => { rating = i + 1; $("err").textContent = ""; paint(); };
    b.onkeydown = e => { if (e.key === "ArrowRight" || e.key === "ArrowUp") { rating = Math.min(5, (rating || 0) + 1); paint(); stars[rating - 1].focus(); e.preventDefault(); } if (e.key === "ArrowLeft" || e.key === "ArrowDown") { rating = Math.max(1, (rating || 2) - 1); paint(); stars[rating - 1].focus(); e.preventDefault(); } }; });
  const msg = $("msg"), count = $("count"); msg.oninput = () => { count.textContent = `${msg.value.length} / 2000`; };
  $("form").onsubmit = async e => {
    e.preventDefault(); if ($("website").value) return done(); // hidden field: only bots fill it
    if (!rating) { $("err").textContent = "Pick a rating first."; return; }
    const reasons = [...document.querySelectorAll('input[name="reason"]:checked')].map(c => c.value), btn = $("send"); btn.disabled = true; btn.textContent = "Sending…";
    try {
      const r = await fetch(cfg.url + "/rest/v1/rpc/ext_submit_feedback", { method: "POST", headers: { "content-type": "application/json", apikey: cfg.anonKey, authorization: "Bearer " + cfg.anonKey },
        body: JSON.stringify({ p_rating: rating, p_reasons: reasons, p_message: msg.value.trim().slice(0, 2000) || null, p_version: v ? v[0] : null }) });
      if (!r.ok) throw new Error("http " + r.status); const ok = await r.json(); if (ok !== true) throw new Error("refused");
      done();
    } catch { btn.disabled = false; btn.textContent = "Send feedback"; $("err").textContent = "Couldn't send that right now. Please try again in a minute."; }
  };
  function done() { $("form").hidden = true; $("thanks").hidden = false; }
})();
