// Live check of migration 0020 against the real Supabase project (reads .env, never prints secrets). Non-destructive: it never calls ext_purge_old_data with the service role (that deletes real data).
// Creates ONE temp user (to prove a normal signed-in user is refused) and deletes it at the end.
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter(l => l.includes("=") && !l.startsWith("#")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const U = env.SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.SUPABASE_ANON_KEY, results = [], tag = "v0020-" + Math.random().toString(36).slice(2, 8);
const ok = (n, c, x = "") => { results.push(!!c); console.log(c ? "PASS" : "FAIL", n, x); };
const H = (k, jwt) => ({ apikey: k, authorization: "Bearer " + (jwt || k), "content-type": "application/json" });
const call = async (path, o = {}) => { const r = await fetch(U + path, o); let b = null; try { b = await r.json(); } catch {} return { s: r.status, b }; };
const rpc = (fn, args, k, jwt) => call("/rest/v1/rpc/" + fn, { method: "POST", headers: H(k, jwt), body: JSON.stringify(args) });
let uid = null;
try {
  const anon = await rpc("ext_purge_old_data", {}, ANON);
  ok("purge exists (a refusal, not 404 'function not found')", anon.s !== 404 && !/could not find the function/i.test(JSON.stringify(anon.b || "")), "status " + anon.s);
  ok("purge is closed to anonymous callers", anon.s >= 400);
  const pw = "Pw-" + Math.random().toString(36).slice(2) + "A1!", email = `hauls-verify-${tag}@example.com`;
  const cu = await call("/auth/v1/admin/users", { method: "POST", headers: H(SR), body: JSON.stringify({ email, password: pw, email_confirm: true }) }); uid = cu.b && cu.b.id; ok("temp user created", !!uid);
  const si = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: H(ANON), body: JSON.stringify({ email, password: pw }) }); const jwt = si.b && si.b.access_token; ok("temp user signed in", !!jwt);
  const usr = await rpc("ext_purge_old_data", {}, ANON, jwt);
  ok("purge is closed to a signed-in user", usr.s >= 400 && usr.s !== 404, "status " + usr.s);
  ok("a refused call reveals no counts", !(usr.b && typeof usr.b === "object" && "observations" in usr.b) && !(anon.b && typeof anon.b === "object" && "observations" in anon.b));
  // the new indexes cannot be seen through the API; check them in the SQL editor: select indexname from pg_indexes where indexname in ('ext_obs_day_idx','ext_chart_captured_idx');
} catch (e) { console.log("ERROR", String(e).slice(0, 200)); ok("script completed", false); }
finally {
  if (uid) { await call(`/auth/v1/admin/users/${uid}`, { method: "DELETE", headers: H(SR) }); const left = await call(`/auth/v1/admin/users/${uid}`, { headers: H(SR) }); console.log("CLEANUP: temp user removed =", left.s === 404 || !(left.b && left.b.id)); }
  console.log("RESULT:", results.filter(Boolean).length, "pass,", results.filter(r => !r).length, "fail");
}
