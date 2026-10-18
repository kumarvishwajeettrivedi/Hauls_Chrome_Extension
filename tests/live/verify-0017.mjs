// Live check of migration 0017 (security hardening) against the real Supabase project (reads .env inside node, never prints secrets). Run (after applying 0017): node tests/live/verify-0017.mjs
// Creates ONE temp user (deleted at the end, which cascades its rows) and sends ONE anonymous feedback (deleted at the end). Never triggers a real email.
// Not covered live (it would delete real rows / send real mail; use the SQL editor): ext_purge_old_data() itself (covered by tests/sql), the price-alert mail (covered by tests/sql), role timeouts -> select rolname, rolconfig from pg_roles where rolname in ('anon','authenticated');
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const U = env.SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.SUPABASE_ANON_KEY, tag = "v0017-" + Math.random().toString(36).slice(2, 8), results = [], users = [];
const ok = (n, c, extra = "") => { results.push(!!c); console.log(c ? "PASS" : "FAIL", n, extra); };
const rest = (path, { method = "GET", body, key = ANON, jwt, headers = {} } = {}) => fetch(U + path, { method, headers: { apikey: key, authorization: "Bearer " + (jwt || key), "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const rpc = async (name, args, jwt, key = ANON) => { const r = await rest("/rest/v1/rpc/" + name, { method: "POST", body: args, key, jwt }); let b; try { b = await r.json(); } catch { b = null; } return { s: r.status, b }; };
const denied = r => r.s >= 400; // 401/403 (no EXECUTE / no grant) or 404 (not exposed): all mean "not callable"
const pw = "Tmp-" + Math.random().toString(36).slice(2) + "A1!";
async function mkUser() {
  const email = `${tag}@example.com`, r = await rest("/auth/v1/admin/users", { method: "POST", key: SR, body: { email, password: pw, email_confirm: true } }), u = await r.json(); users.push(u.id);
  const t = await (await rest("/auth/v1/token?grant_type=password", { method: "POST", key: ANON, body: { email, password: pw } })).json();
  await rpc("ext_ensure_profile", {}, t.access_token); return { id: u.id, jwt: t.access_token };
}
try {
  // ---- doors that must stay shut for the public (anon) key
  for (const t of ["ext_price_observations", "ext_chart_series", "ext_alert_log", "ext_feedback", "ext_profiles", "ext_watchlist", "ext_user_settings"]) {
    const r = await rest(`/rest/v1/${t}?select=*&limit=1`), j = await r.json().catch(() => null); ok(`anon cannot read ${t}`, r.status >= 400 || (Array.isArray(j) && j.length === 0), "status " + r.status);
  }
  const cfg = await rest("/rest/v1/ext_remote_config?select=key&limit=5"), cj = await cfg.json().catch(() => null); ok("anon can still read the public flags (ext_remote_config)", cfg.status === 200 && Array.isArray(cj) && cj.length >= 1);
  for (const [fn, args] of [["ext_price_history", { p_key: "x" }], ["ext_get_chart", { p_key: "x" }], ["ext_upsert_observations", { p_rows: [] }], ["ext_submit_chart", { p_key: "x", p_range: 30, p_series: [], p_current: 1 }], ["ext_send_price_alert", { p_key: "x", p_title: "t", p_price: 1, p_target: 1 }], ["ext_merge_settings", { p_doc: {}, p_stamps: {} }], ["ext_export_my_data", {}], ["ext_delete_my_data", {}], ["ext_ensure_profile", {}], ["ext_join_waitlist", {}], ["ext_purge_old_data", {}], ["ext_purge_my_deleted_watchlist", {}]])
    ok(`anon cannot call ${fn}`, denied(await rpc(fn, args)));

  const u = await mkUser();
  ok("a signed-in user cannot call ext_purge_old_data (service role only)", denied(await rpc("ext_purge_old_data", {}, u.jwt)));
  for (const fn of ["ext_clean_url", "ext_strip_text", "ext_valid_places", "ext_valid_stores"]) ok(`a signed-in user cannot call the internal helper ${fn}`, denied(await rpc(fn, { t: "x", p: [] }, u.jwt)));

  // ---- profile fields
  const patch = (body) => rest(`/rest/v1/ext_profiles?id=eq.${u.id}`, { method: "PATCH", jwt: u.jwt, body, headers: { prefer: "return=minimal" } });
  ok("profile name with markup is refused", (await patch({ name: "<img src=x onerror=1>" })).status >= 400);
  ok("profile name with a bidi override is refused", (await patch({ name: "a‮b" })).status >= 400);
  ok("profile name over 80 chars is refused", (await patch({ name: "n".repeat(81) })).status >= 400);
  ok("a normal name and contribute=true are stored", (await patch({ name: "Temp Tester", contribute: true })).status < 300);
  ok("avatar_url and plan are not user-writable", (await patch({ avatar_url: "https://x.example/a.png" })).status >= 400 && (await patch({ plan: "max" })).status >= 400);

  // ---- watchlist text columns (through the same REST door the extension uses)
  const put = async (key, over = {}) => { const r = await rest("/rest/v1/ext_watchlist?on_conflict=user_id,product_key", { method: "POST", jwt: u.jwt, headers: { prefer: "resolution=merge-duplicates,return=representation" }, body: { user_id: u.id, product_key: key, site: "Amazon", title: "T", url: "https://www.amazon.in/dp/B0TEST", ...over } }); return { s: r.status, b: await r.json().catch(() => null) }; };
  ok("watchlist: a normal row is stored", (await put(tag + ":ok")).s === 201);
  ok("watchlist: http:// and javascript: links are refused", (await put(tag + ":h", { url: "http://www.amazon.in/x" })).s >= 400 && (await put(tag + ":j", { url: "javascript:alert(1)" })).s >= 400);
  ok("watchlist: a link with a quote / space / angle bracket is refused", (await put(tag + ":q", { url: 'https://a.in/x"y' })).s >= 400 && (await put(tag + ":s", { url: "https://a.in/x y" })).s >= 400 && (await put(tag + ":a", { url: "https://a.in/<x>" })).s >= 400);
  ok("watchlist: a 501 char title and a 501 char link are refused", (await put(tag + ":t", { title: "t".repeat(501) })).s >= 400 && (await put(tag + ":l", { url: "https://a.in/" + "a".repeat(488) })).s >= 400);
  ok("watchlist: product keys with spaces / quotes / 201 chars are refused", (await put("bad key " + tag)).s >= 400 && (await put('bad"' + tag)).s >= 400 && (await put("k".repeat(201))).s >= 400);
  const mk = await put(tag + ":m", { title: "Fan <b>big</b> \u0007 ‮ fast", image: "http://img.example/a.png" });
  ok("watchlist: markup / control / bidi characters are stripped from the title, an http image becomes NULL", mk.s === 201 && mk.b && mk.b[0] && !/[<>\u0007‮]/.test(mk.b[0].title) && mk.b[0].image === null, JSON.stringify(mk.b && mk.b[0] && { title: mk.b[0].title }));
  ok("watchlist: a negative / absurd alert price is refused", (await put(tag + ":p1", { target_price: -1 })).s >= 400 && (await put(tag + ":p2", { target_price: 1e12 })).s >= 400);

  // ---- observation call caps (the temp user is deleted at the end, its rows cascade)
  const rows = n => Array.from({ length: n }, (_, i) => ({ product_key: `${tag}:o${i}`, site: "Amazon", price: 100 + i, src: "dom" }));
  ok("51 observations in one call: nothing stored", (await rpc("ext_upsert_observations", { p_rows: rows(51) }, u.jwt)).b === 0);
  ok("50 observations in one call: all stored", (await rpc("ext_upsert_observations", { p_rows: rows(50) }, u.jwt)).b === 50);
  ok("a row padded with junk (> 800 bytes) is skipped, no error", (await rpc("ext_upsert_observations", { p_rows: [{ product_key: tag + ":pad", site: "A", price: 5, src: "dom", junk: "j".repeat(900) }] }, u.jwt)).b === 0);
  const ch = await rpc("ext_submit_chart", { p_key: "bad key", p_range: 30, p_series: [[20000, 1], [20001, 2]], p_current: 2 }, u.jwt); ok("a chart with a bad key returns false (200), never an error", ch.s === 200 && ch.b === false);
  const hi = await rpc("ext_price_history", { p_key: "k".repeat(201) }, u.jwt); ok("history with a 201 char key is empty, no error", hi.s === 200 && Array.isArray(hi.b) && hi.b.length === 0);

  // ---- settings
  const m = await rpc("ext_merge_settings", { p_doc: { pin: "123456", pad: "x".repeat(9000) }, p_stamps: { pin: Date.now() } }, u.jwt); ok("an oversize settings payload is ignored, not an error", m.s === 200 && m.b && !(m.b.doc && m.b.doc.pin));
  const ms = await rpc("ext_merge_settings", { p_doc: { stores: ["ok", "a b"] }, p_stamps: { stores: Date.now() } }, u.jwt); ok("stores with a space are refused", ms.s >= 400);

  // ---- anonymous feedback (1 accepted row; refused ones are not stored)
  const fb = args => rpc("ext_submit_feedback", args);
  const okf = await fb({ p_rating: 4, p_reasons: ["bugs"], p_message: tag + " " + "m".repeat(1500), p_version: "1.2.3" }); ok("feedback: a 1500 char message is accepted", okf.b === true, JSON.stringify(okf));
  const stored = await (await rest(`/rest/v1/ext_feedback?message=like.${tag}*&select=message`, { key: SR })).json(); ok("feedback: it is stored cut to 1000 chars", Array.isArray(stored) && stored.length === 1 && stored[0].message.length === 1000);
  ok("feedback: > 2000 chars, > 20 reasons and a rating of 9 are refused (false, no error)", (await fb({ p_rating: 4, p_reasons: [], p_message: tag + "x".repeat(2001) })).b === false && (await fb({ p_rating: 4, p_reasons: Array(21).fill("bugs"), p_message: tag })).b === false && (await fb({ p_rating: 9, p_reasons: [], p_message: tag })).b === false);

} catch (e) { console.log("ERROR", String(e).slice(0, 200)); ok("script completed", false); }
finally {
  await rest(`/rest/v1/ext_feedback?message=like.${tag}*`, { method: "DELETE", key: SR, headers: { prefer: "return=minimal" } });
  for (const id of users) await rest(`/auth/v1/admin/users/${id}`, { method: "DELETE", key: SR });
  const left = await (await rest(`/rest/v1/ext_feedback?message=like.${tag}*&select=id`, { key: SR })).json().catch(() => null);
  console.log("CLEANUP: users deleted", users.length, "| feedback rows left", Array.isArray(left) ? left.length : "?");
  console.log("RESULT:", results.filter(Boolean).length, "pass,", results.filter(r => !r).length, "fail");
}
