// Live check of migration 0011 against the real Supabase project (reads .env, never prints secrets). Creates 4 temp users, then deletes them and any rows. Run: npm run verify:live-0011
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const URL_ = env.SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.SUPABASE_ANON_KEY, tag = "v0011-" + Math.random().toString(36).slice(2, 8), results = [], users = [];
const ok = (n, c, extra = "") => { results.push([n, !!c, extra]); console.log(c ? "PASS" : "FAIL", n, extra); };
const rest = (path, { method = "GET", body, key = SR, jwt, headers = {} } = {}) => fetch(URL_ + path, { method, headers: { apikey: key, authorization: "Bearer " + (jwt || key), "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
const rpc = async (name, args, jwt, key = ANON) => { const r = await rest("/rest/v1/rpc/" + name, { method: "POST", body: args, key, jwt }); let b; try { b = await r.json(); } catch { b = null; } return { s: r.status, b }; };
const pw = "Tmp-" + Math.random().toString(36).slice(2) + "A1!";
async function mkUser(i) {
  const email = `${tag}-${i}@example.com`, r = await rest("/auth/v1/admin/users", { method: "POST", body: { email, password: pw, email_confirm: true } }), u = await r.json(); users.push(u.id);
  const t = await (await rest("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password: pw }, key: ANON })).json();
  await rpc("ext_ensure_profile", {}, t.access_token); return { id: u.id, jwt: t.access_token };
}
try {
  const u = await mkUser(0); await rest(`/rest/v1/ext_profiles?id=eq.${u.id}`, { method: "PATCH", body: { contribute: true }, headers: { prefer: "return=minimal" } });
  const k = "flipkart.com:" + tag.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10), put = (src, key = k) => rpc("ext_upsert_observations", { p_rows: [{ product_key: key, site: "Flipkart", price: 500, src }] }, u.jwt);
  ok("0011 installed: a background (bg) observation is stored", (await put("bg")).b === 1);
  ok("an unknown src is still refused", (await put("evil", k + "Z")).b === 0);
  const rows = await (await rest(`/rest/v1/ext_price_observations?product_key=eq.${encodeURIComponent(k)}&select=src`)).json(); ok("the stored row is tagged bg", Array.isArray(rows) && rows.length === 1 && rows[0].src === "bg");
} catch (e) { console.log("ERROR", String(e).slice(0, 200)); ok("script completed", false); }
finally {
  for (const id of users) await rest(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  console.log("CLEANUP: users deleted", users.length);
  console.log("RESULT:", results.filter(r => r[1]).length, "pass,", results.filter(r => !r[1]).length, "fail");
}
