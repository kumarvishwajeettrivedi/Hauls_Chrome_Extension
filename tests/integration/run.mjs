// Integration test against the REAL Supabase project. Run AFTER applying supabase/migrations/*.sql.
// Creates 2 throwaway users via Admin API, always deletes them. Prints only PASS/FAIL/SKIP.
import fs from 'node:fs';
import crypto from 'node:crypto';
const env = {};
for (const l of fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: SVC, SUPABASE_ANON_KEY: ANON } = env;
if (!URL_ || !SVC) { console.log('SKIP: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env'); process.exit(0); }
if (!ANON) { console.log('SKIP: SUPABASE_ANON_KEY missing in .env (Supabase > Settings > API)'); process.exit(0); }

let failed = 0;
const T = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); if (!c) failed++; };
const call = async (path, { method = 'GET', key = SVC, token, body, headers = {} } = {}) => {
  const r = await fetch(URL_ + path, { method, body: body && JSON.stringify(body),
    headers: { apikey: key, Authorization: 'Bearer ' + (token || key), 'Content-Type': 'application/json', ...headers } });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { ok: r.ok, status: r.status, j };
};
const rpc = (fn, token, body = {}) => call('/rest/v1/rpc/' + fn, { method: 'POST', key: ANON, token, body });
const rest = (p, token, o = {}) => call('/rest/v1/' + p, { key: ANON, token, ...o });

const pw = crypto.randomBytes(12).toString('hex') + 'Aa1!';
const users = [];
async function mk() {
  const email = `hauls-test-${crypto.randomBytes(5).toString('hex')}@example.test`;
  const c = await call('/auth/v1/admin/users', { method: 'POST', body: { email, password: pw, email_confirm: true } });
  if (!c.ok) throw new Error('create user failed ' + c.status);
  const u = { id: c.j.id, email }; users.push(u);
  const s = await call('/auth/v1/token?grant_type=password', { method: 'POST', key: ANON, body: { email, password: pw } });
  if (!s.ok) throw new Error('sign-in failed ' + s.status);
  u.token = s.j.access_token; return u;
}

try {
  const [A, B, C] = [await mk(), await mk(), await mk()];
  const P = 'itest-' + crypto.randomBytes(4).toString('hex');
  // profile trigger
  let r = await rest('ext_profiles?select=*', A.token);
  T('profile auto-created, plan=free', r.ok && r.j.length === 1 && r.j[0].plan === 'free');
  // watchlist isolation
  r = await rest('ext_watchlist', A.token, { method: 'POST', body: { product_key: P, title: 't' }, headers: { Prefer: 'return=minimal' } });
  T('A inserts watchlist row', r.ok);
  r = await rest('ext_watchlist?select=*', B.token);
  T('B cannot read A watchlist', r.ok && r.j.length === 0);
  r = await rest('ext_watchlist', B.token, { method: 'POST', body: { user_id: A.id, product_key: 'x' } });
  T('B cannot insert as A', !r.ok);
  await rest(`ext_watchlist?product_key=eq.${P}`, B.token, { method: 'PATCH', body: { title: 'hack' } });
  r = await rest('ext_watchlist?select=title', A.token);
  T('B cannot update A row', r.j[0]?.title === 't');
  // plan self-upgrade
  r = await rest(`ext_profiles?id=eq.${A.id}`, A.token, { method: 'PATCH', body: { plan: 'pro' } });
  T('plan cannot be self-upgraded', !r.ok);
  r = await rest(`ext_profiles?id=eq.${A.id}`, A.token, { method: 'PATCH', body: { name: 'Tester' }, headers: { Prefer: 'return=minimal' } });
  T('name can be updated', r.ok);
  // sharing is opt-in (0005): by default nothing is stored; users opt in through their own profile
  let optIn = await rpc('ext_upsert_observations', A.token, { p_rows: [{ product_key: P, site: 'amazon', price: 7, src: 'dom' }] });
  T('0005: default contribute=false stores nothing until the user opts in', optIn.ok && optIn.j === 0);
  for (const U of [A, B]) await rest(`ext_profiles?id=eq.${U.id}`, U.token, { method: 'PATCH', body: { contribute: true }, headers: { Prefer: 'return=minimal' } });
  // observations
  const rows = (ps) => ps.map((price) => ({ product_key: P, site: 'amazon', price, src: 'jsonld' }))
    .concat([{ product_key: P, price: -1, src: 'dom' }, { product_key: P, price: 5, src: 'nope' }]);
  r = await rpc('ext_upsert_observations', A.token, { p_rows: rows([1000, 1010]) });
  T('A upserts 2 valid rows (bad skipped)', r.ok && r.j === 2);
  await rpc('ext_upsert_observations', B.token, { p_rows: rows([1020, 5000, 10]) });
  r = await rest('ext_price_observations?select=*', A.token);
  T('observations not directly selectable', !r.ok || (Array.isArray(r.j) && r.j.length === 0));
  r = await rest('ext_price_observations', A.token, { method: 'POST', body: { user_id: B.id, product_key: P, price: 1 } });
  T('cannot insert observation as another user', !r.ok);
  r = await rest('ext_price_observations', A.token, { method: 'POST', body: { user_id: A.id, product_key: P, price: 1 } });
  T('0005: direct insert of own observation is blocked (RPC only)', !r.ok);
  r = await rpc('ext_ensure_profile', A.token, {});
  T('0005: ext_ensure_profile callable and idempotent', r.ok);
  r = await rpc('ext_ensure_profile', ANON, {});
  T('0005: anon cannot call ext_ensure_profile', !r.ok);
  r = await rpc('ext_price_history', A.token, { p_key: P, p_days: 30 });
  const d = r.j?.[0];
  T('history aggregates + rejects outliers', r.ok && r.j.length === 1 && +d.max_price === 1020 && +d.min_price === 1000 && d.reporters === 2);
  r = await rpc('ext_price_history', ANON, { p_key: P });
  T('anon cannot call history', !r.ok);
  // contribute flag
  await rest(`ext_profiles?id=eq.${B.id}`, B.token, { method: 'PATCH', body: { contribute: false }, headers: { Prefer: 'return=minimal' } });
  r = await rpc('ext_upsert_observations', B.token, { p_rows: rows([1111]) });
  T('contribute=false inserts nothing', r.ok && r.j === 0);
  // waitlist (cleaned up below)
  const w1 = await rpc('ext_join_waitlist', A.token), w2 = await rpc('ext_join_waitlist', A.token);
  T('waitlist true then false', w1.j === true && w2.j === false);
  // ---- 0004 hardening ----
  r = await rpc('ext_price_history', A.token, { p_key: P, p_days: 30, p_min_reporters: 5 });
  T('p_min_reporters hides under-reported days', r.ok && r.j.length === 0);
  r = await rpc('ext_price_history', A.token, { p_key: P, p_days: 30, p_min_reporters: 1 });
  T('p_min_reporters=1 shows day', r.ok && r.j.length === 1);
  r = await rpc('ext_price_history', ANON, { p_key: P, p_days: 30, p_min_reporters: 1 });
  T('anon cannot call 3-arg history', !r.ok);
  r = await rest(`ext_profiles?id=eq.${C.id}`, C.token, { method: 'PATCH', body: { phone: 'abc' } });
  T('bad phone rejected', !r.ok);
  r = await rest(`ext_profiles?id=eq.${C.id}`, C.token, { method: 'PATCH', body: { phone: '+91 98765 43210' }, headers: { Prefer: 'return=minimal' } });
  T('phone updatable', r.ok);
  r = await rest('ext_profiles?select=email,name', C.token);
  T('profile created without name/avatar metadata', r.ok && r.j.length === 1 && r.j[0].email === C.email);
  // watchlist caps (C): free 20 -> pro 200
  const wrows = (from, n) => Array.from({ length: n }, (_, i) => ({ product_key: `cap-${P}-${from + i}` }));
  r = await rest('ext_watchlist', C.token, { method: 'POST', body: wrows(0, 20), headers: { Prefer: 'return=minimal' } });
  T('free: 20 items accepted', r.ok);
  r = await rest('ext_watchlist', C.token, { method: 'POST', body: wrows(20, 1) });
  T('free: 21st blocked (watchlist_limit_reached)', !r.ok && JSON.stringify(r.j).includes('watchlist_limit_reached'));
  r = await rest(`ext_watchlist?product_key=eq.cap-${P}-0`, C.token, { method: 'PATCH', body: { title: 'edited' }, headers: { Prefer: 'return=minimal' } });
  T('edit at cap allowed', r.ok);
  r = await rest(`ext_watchlist?product_key=eq.cap-${P}-1`, C.token, { method: 'PATCH', body: { deleted_at: new Date().toISOString() }, headers: { Prefer: 'return=minimal' } });
  T('soft-delete at cap allowed', r.ok);
  await call(`/rest/v1/ext_profiles?id=eq.${C.id}`, { method: 'PATCH', body: { plan: 'pro' }, headers: { Prefer: 'return=minimal' } });
  r = await rest('ext_watchlist', C.token, { method: 'POST', body: wrows(100, 181), headers: { Prefer: 'return=minimal' } });
  T('pro: up to 200 live accepted', r.ok);
  r = await rest('ext_watchlist', C.token, { method: 'POST', body: wrows(400, 1) });
  T('pro: 201st blocked', !r.ok && JSON.stringify(r.j).includes('watchlist_limit_reached'));
  // daily observation cap (C)
  let ins = 0;
  for (let b = 0; b < 11; b++) {
    const rows = Array.from({ length: 50 }, (_, i) => ({ product_key: `obs-${P}-${b * 50 + i}`, site: 'amazon', price: 100 + b * 50 + i, src: 'dom' }));
    const x = await rpc('ext_upsert_observations', C.token, { p_rows: rows });
    if (!x.ok) { ins = -1; break; } ins += x.j;
  }
  T('observations: capped at 500/day, extra skipped without error', ins === 500);
  // remote config
  r = await call('/rest/v1/ext_remote_config?select=key,value&key=eq.flags', { key: ANON });
  T('anon can read remote config flags', r.ok && r.j.length === 1 && Array.isArray(r.j[0].value.disabled_stores));
  r = await call('/rest/v1/ext_remote_config', { method: 'POST', key: ANON, body: { key: 'x-' + P, value: {} } });
  T('anon cannot write remote config', !r.ok);
  r = await call('/rest/v1/ext_remote_config', { method: 'POST', key: ANON, token: A.token, body: { key: 'x-' + P, value: {} } });
  T('authenticated cannot write remote config', !r.ok);
  // export
  r = await rpc('ext_export_my_data', C.token);
  T('export: own profile + watchlist only', r.ok && r.j.profile?.id === C.id && r.j.watchlist.length === 201 && r.j.observation_count === 500 && !('observations' in r.j));
  r = await rpc('ext_export_my_data', ANON);
  T('anon cannot export', !r.ok);
  // erasure
  r = await rpc('ext_delete_my_data', A.token);
  const wl = await call(`/rest/v1/ext_watchlist?user_id=eq.${A.id}&select=id`);
  const ob = await call(`/rest/v1/ext_price_observations?user_id=eq.${A.id}&select=id`);
  const pf = await call(`/rest/v1/ext_profiles?id=eq.${A.id}&select=id`);
  T('ext_delete_my_data erases everything', r.ok && !wl.j.length && !ob.j.length && !pf.j.length);
} catch (e) {
  console.log('FAIL unexpected error:', String(e.message).slice(0, 120)); failed++;
} finally {
  for (const u of users) {
    await call(`/rest/v1/waitlist?email=eq.${encodeURIComponent(u.email)}`, { method: 'DELETE' }).catch(() => {});
    const d = await call('/auth/v1/admin/users/' + u.id, { method: 'DELETE' }).catch(() => ({ ok: false }));
    console.log(d.ok ? 'PASS' : 'FAIL', 'cleanup test user');
    if (!d.ok) failed++;
  }
}
process.exit(failed ? 1 : 0);
