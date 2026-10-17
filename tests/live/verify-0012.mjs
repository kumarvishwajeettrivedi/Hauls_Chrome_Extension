// Live check of migration 0012 (anonymous uninstall feedback) against the real Supabase project (reads .env, never prints secrets). Uses 3 submissions (limit is 5 per caller per hour) and deletes its own rows.
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const U = env.SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.SUPABASE_ANON_KEY, tag = "verify-0012-" + Math.random().toString(36).slice(2, 8), results = [];
const ok = (n, c, extra = "") => { results.push(!!c); console.log(c ? "PASS" : "FAIL", n, extra); };
const h = key => ({ apikey: key, authorization: "Bearer " + key, "content-type": "application/json" });
const send = args => fetch(U + "/rest/v1/rpc/ext_submit_feedback", { method: "POST", headers: h(ANON), body: JSON.stringify(args) }).then(async r => ({ s: r.status, b: await r.json().catch(() => null) }));
try {
  const a = await send({ p_rating: 5, p_reasons: ["bugs", "not_a_reason"], p_message: tag + " hello", p_version: "1.16.0" }); ok("0012 is installed: anonymous feedback is accepted", a.b === true, JSON.stringify(a));
  const bad = await send({ p_rating: 9, p_reasons: [], p_message: tag, p_version: null }); ok("a rating of 9 is refused (false, no error)", bad.s === 200 && bad.b === false);
  const rows = await (await fetch(U + `/rest/v1/ext_feedback?message=like.${tag}*&select=rating,reasons,message,version,ip_hash`, { headers: h(SR) })).json();
  ok("the row is stored with only the known reason", Array.isArray(rows) && rows.length === 1 && rows[0].reasons.join() === "bugs" && rows[0].version === "1.16.0");
  ok("the caller's address is stored only as a hash", rows[0] && (rows[0].ip_hash === null || /^[0-9a-f]{64}$/.test(rows[0].ip_hash)), rows[0] && rows[0].ip_hash ? "hashed" : "no forwarded address seen");
  const direct = await fetch(U + "/rest/v1/ext_feedback?select=*", { headers: h(ANON) }); const dj = await direct.json().catch(() => null);
  ok("anon cannot read the table", direct.status >= 400 || (Array.isArray(dj) && dj.length === 0), "status " + direct.status);
  const ins = await fetch(U + "/rest/v1/ext_feedback", { method: "POST", headers: { ...h(ANON), prefer: "return=minimal" }, body: JSON.stringify({ rating: 5 }) }); ok("anon cannot insert straight into the table", ins.status >= 400, "status " + ins.status);
} catch (e) { console.log("ERROR", String(e).slice(0, 200)); ok("script completed", false); }
finally {
  await fetch(U + `/rest/v1/ext_feedback?message=like.${tag}*`, { method: "DELETE", headers: { ...h(SR), prefer: "return=minimal" } });
  const left = await (await fetch(U + `/rest/v1/ext_feedback?message=like.${tag}*&select=id`, { headers: h(SR) })).json();
  console.log("CLEANUP: rows left", Array.isArray(left) ? left.length : "?"); console.log("RESULT:", results.filter(Boolean).length, "pass,", results.filter(r => !r).length, "fail");
}
