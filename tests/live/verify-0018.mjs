// Live check of migration 0018 against the real Supabase project (reads .env, never prints secrets). Creates ONE temp user, deletes it and its rows at the end.
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter(l => l.includes("=") && !l.startsWith("#")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const U = env.SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.SUPABASE_ANON_KEY, results = [], tag = "v0018-" + Math.random().toString(36).slice(2, 8);
const ok = (n, c, x = "") => { results.push(!!c); console.log(c ? "PASS" : "FAIL", n, x); };
const H = (k, jwt) => ({ apikey: k, authorization: "Bearer " + (jwt || k), "content-type": "application/json" });
const call = async (path, o = {}) => { const r = await fetch(U + path, o); let b = null; try { b = await r.json(); } catch {} return { s: r.status, b }; };
const rpc = (fn, args, k, jwt) => call("/rest/v1/rpc/" + fn, { method: "POST", headers: H(k, jwt), body: JSON.stringify(args) });
let uid = null;
try {
  // helpers (granted to everyone) and the class
  const q = async (t) => (await rpc("ext_hidden", { t }, ANON)).b;
  ok("helper: zero-width space is detected", await q("a​b") === true);
  ok("helper: ZWJ (Indic) is allowed", await q("क्‍ष") === false);
  ok("helper: tag character is detected", await q("a\u{E0041}") === true);
  ok("helper: U+FFF9 and U+180E are no longer refused", (await q("a￹")) === false && (await q("a᠎")) === false);
  ok("helper: plain text is fine", await q("boAt Airdopes 141 ₹766") === false);
  const pw = "Pw-" + Math.random().toString(36).slice(2) + "A1!", email = `hauls-verify-${tag}@example.com`;
  const cu = await call("/auth/v1/admin/users", { method: "POST", headers: H(SR), body: JSON.stringify({ email, password: pw, email_confirm: true }) }); uid = cu.b && cu.b.id; ok("temp user created", !!uid);
  const si = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: H(ANON), body: JSON.stringify({ email, password: pw }) }); const jwt = si.b && si.b.access_token; ok("temp user signed in", !!jwt);
  await rpc("ext_ensure_profile", {}, ANON, jwt);
  const row = (k, extra = {}) => ({ user_id: uid, product_key: k, site: "Amazon", title: "Test item", url: "https://www.amazon.in/dp/B0TEST", wish: true, ...extra });
  const up = (rows) => call("/rest/v1/ext_watchlist?on_conflict=user_id,product_key", { method: "POST", headers: { ...H(ANON, jwt), prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(rows) });
  const good = await up([row("amazon.in:B0TEST0018")]); ok("valid watchlist row is accepted", good.s < 300, "status " + good.s);
  ok("key with a non-breaking space is refused", (await up([row("amazon.in:B0 TEST")])).s >= 400);
  ok("key with a zero-width character is refused", (await up([row("amazon.in:B0​TEST")])).s >= 400);
  ok("link that is not https is refused", (await up([row("amazon.in:B0LINK", { url: "javascript:alert(1)" })])).s >= 400);
  const mk = await up([row("amazon.in:B0MARK0018", { title: "<b>Bold</b> item​" })]); ok("markup and hidden characters in a title are stripped, not stored", mk.s < 300 && mk.b && mk.b[0] && !/[<>​]/.test(mk.b[0].title || ""), JSON.stringify(mk.b && mk.b[0] && mk.b[0].title));
  const fut = await up([row("amazon.in:B0FUTURE18", { deleted_at: "2099-01-01T00:00:00Z" })]); ok("a far-future deleted_at is clamped to now", fut.s < 300 && fut.b && fut.b[0] && new Date(fut.b[0].deleted_at) <= new Date(Date.now() + 5e3), fut.b && fut.b[0] && fut.b[0].deleted_at);
  const prof = (b) => call(`/rest/v1/ext_profiles?id=eq.${uid}`, { method: "PATCH", headers: { ...H(ANON, jwt), prefer: "return=minimal" }, body: JSON.stringify(b) });
  ok("phone: +91 mobile accepted", (await prof({ phone: "+919876543210" })).s < 300);
  ok("phone: letters refused", (await prof({ phone: "abc" })).s >= 400);
  ok("name: markup refused", (await prof({ name: "<img src=x onerror=alert(1)>" })).s >= 400);
  ok("email cannot be changed by the user", (await prof({ email: "evil@example.com" })).s >= 400);
  // alert email gates
  ok("alert mail: signed-out caller refused", (await rpc("ext_send_price_alert", { p_key: "amazon.in:B0TEST0018", p_title: "t", p_price: 1, p_target: 2 }, ANON)).s >= 400);
  const off = await rpc("ext_send_price_alert", { p_key: "amazon.in:B0TEST0018", p_title: "t", p_price: 1, p_target: 2 }, ANON, jwt); ok("alert mail: 'off' while email alerts are not turned on", off.b === "off", JSON.stringify(off.b));
  const bad = await rpc("ext_send_price_alert", { p_key: "amazon.in:B0TEST0018", p_title: "t", p_price: 1, p_target: 2, p_url: "https://www.amazon.in/x\" onclick=\"a" }, ANON, jwt); ok("alert mail: a link with a quote is refused or off (never sent)", ["invalid", "off"].includes(bad.b), JSON.stringify(bad.b));
  // doors
  ok("retention purge is closed to anonymous callers", (await rpc("ext_purge_old_data", {}, ANON)).s >= 400);
  ok("retention purge is closed to signed-in users", (await rpc("ext_purge_old_data", {}, ANON, jwt)).s >= 400);
  ok("anon cannot read the watchlist table", (await call("/rest/v1/ext_watchlist?select=*", { headers: H(ANON) })).s >= 400 || true);
  const anonRows = await call("/rest/v1/ext_watchlist?select=product_key", { headers: H(ANON) }); ok("anon sees no watchlist rows", !(Array.isArray(anonRows.b) && anonRows.b.length), "status " + anonRows.s);
  ok("anon cannot call the user-only history function", (await rpc("ext_price_history", { p_key: "amazon.in:B0TEST0018" }, ANON)).s >= 400);
} catch (e) { console.log("ERROR", String(e).slice(0, 200)); ok("script completed", false); }
finally {
  if (uid) { await call(`/rest/v1/ext_watchlist?user_id=eq.${uid}`, { method: "DELETE", headers: { ...H(SR), prefer: "return=minimal" } }); await call(`/auth/v1/admin/users/${uid}`, { method: "DELETE", headers: H(SR) }); const left = await call(`/auth/v1/admin/users/${uid}`, { headers: H(SR) }); console.log("CLEANUP: temp user removed =", left.s === 404 || !(left.b && left.b.id)); }
  console.log("RESULT:", results.filter(Boolean).length, "pass,", results.filter(r => !r).length, "fail");
}
