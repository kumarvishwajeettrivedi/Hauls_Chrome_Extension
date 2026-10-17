// Live check of migration 0010 against the real Supabase project (reads .env, never prints secrets). Creates 4 temp users, then deletes them and any rows. Run: npm run verify:live-0010
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const URL_ = env.SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.SUPABASE_ANON_KEY, tag = "v0010-" + Math.random().toString(36).slice(2, 8), results = [], users = [];
const ok = (n, c, extra = "") => { results.push([n, !!c, extra]); console.log(c ? "PASS" : "FAIL", n, extra); };
const rest = (path, { method = "GET", body, key = SR, jwt, headers = {} } = {}) => fetch(URL_ + path, { method, headers: { apikey: key, authorization: "Bearer " + (jwt || key), "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
const rpc = async (name, args, jwt, key = ANON) => { const r = await rest("/rest/v1/rpc/" + name, { method: "POST", body: args, key, jwt }); let b; try { b = await r.json(); } catch { b = null; } return { s: r.status, b }; };
const pw = "Tmp-" + Math.random().toString(36).slice(2) + "A1!";
async function mkUser(i) {
  const email = `${tag}-${i}@example.com`, r = await rest("/auth/v1/admin/users", { method: "POST", body: { email, password: pw, email_confirm: true } }), u = await r.json(); users.push(u.id);
  const t = await (await rest("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password: pw }, key: ANON })).json();
  await rpc("ext_ensure_profile", {}, t.access_token); return { id: u.id, jwt: t.access_token };
}
const day = n => Math.floor((Date.now() - n * 864e5) / 864e5);
try {
  const U = []; for (let i = 0; i < 4; i++) U.push(await mkUser(i));
  // contribute on; ages: users 0-2 backdated 10 days, user 3 stays fresh
  for (let i = 0; i < 4; i++) await rest(`/rest/v1/ext_profiles?id=eq.${U[i].id}`, { method: "PATCH", body: i < 3 ? { contribute: true, created_at: new Date(Date.now() - 10 * 864e5).toISOString() } : { contribute: true }, headers: { prefer: "return=minimal" } });
  const key = "amazon.in:" + tag.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10), series = [[day(29), 5499], [day(10), 4499], [day(0), 4499]];
  const sub = (u, k = key, range = 30, s = series, cur = 4499) => rpc("ext_submit_chart", { p_key: k, p_range: range, p_series: s, p_current: cur }, u.jwt);
  const get = u => rpc("ext_get_chart", { p_key: key }, u.jwt);
  ok("0010 is installed: submit works for an aged, opted-in account", (await sub(U[0])).b === true);
  ok("a second submit within 6h is not rewritten", (await sub(U[0])).b === false);
  ok("an account younger than 3 days is refused", (await sub(U[3])).b === false);
  ok("last point that disagrees with today's price is refused", (await sub(U[1], key, 30, series, 4900)).b === false);
  ok("range other than 30/90/365 is refused", (await sub(U[1], key, 45)).b === false);
  ok("malformed series returns false (no error)", (await sub(U[1], key, 30, [["x", 1], [2, 3]], 3)).b === false);
  ok("ONE reader: consensus is empty", Array.isArray((await get(U[3])).b) && (await get(U[3])).b.length === 0);
  ok("second reader stored", (await sub(U[1])).b === true);
  ok("TWO readers: still empty (needs 3)", (await get(U[3])).b.length === 0);
  ok("third reader stored", (await sub(U[2])).b === true);
  const g = await get(U[3]); ok("THREE readers: consensus appears with reporter counts, no user ids", Array.isArray(g.b) && g.b.length === 3 && g.b.every(r => r.reporters === 3) && !JSON.stringify(g.b).includes(U[0].id), JSON.stringify(g.b));
  const an = await rpc("ext_get_chart", { p_key: key }, null, ANON); ok("anon key cannot read the consensus", an.s === 401 || an.s === 403 || (an.b && an.b.code && /42501|permission/.test(JSON.stringify(an.b))), "status " + an.s);
  const as = await rpc("ext_submit_chart", { p_key: key, p_range: 30, p_series: series, p_current: 4499 }, null, ANON); ok("anon key cannot submit", as.s === 401 || as.s === 403 || (as.b && /permission|42501/.test(JSON.stringify(as.b))), "status " + as.s);
  const direct = await rest(`/rest/v1/ext_chart_series?product_key=eq.${encodeURIComponent(key)}`, { jwt: U[0].jwt, key: ANON }); const db = await direct.json(); ok("a signed-in user cannot read the table directly", direct.status >= 400 || (Array.isArray(db) && db.length === 0), "status " + direct.status);
  const ex = await rpc("ext_export_my_data", {}, U[0].jwt); ok("export includes the caller's chart rows", ex.b && Array.isArray(ex.b.charts) && ex.b.charts.length === 1);
  const erased = await rpc("ext_forget_my_observations", {}, U[1].jwt); const g2 = await get(U[3]); ok("forget-my-observations removes a reader's chart (consensus drops below 3)", g2.b.length === 0, "status " + erased.s);
  // opt-out user cannot submit
  await rest(`/rest/v1/ext_profiles?id=eq.${U[2].id}`, { method: "PATCH", body: { contribute: false }, headers: { prefer: "return=minimal" } });
  ok("an opted-out reader cannot submit", (await sub(U[2], key + "X")).b === false);
} catch (e) { console.log("ERROR", String(e).slice(0, 200)); ok("script completed", false); }
finally {
  for (const id of users) await rest(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  const left = await (await rest(`/rest/v1/ext_chart_series?product_key=like.*${tag.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)}*&select=product_key`)).json();
  console.log("CLEANUP: users deleted", users.length, "| chart rows left:", Array.isArray(left) ? left.length : "?");
  console.log("RESULT:", results.filter(r => r[1]).length, "pass,", results.filter(r => !r[1]).length, "fail");
}
