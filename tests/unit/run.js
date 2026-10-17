// Unit tests for auth.js + sync.js against an in-memory fake browser + fake Supabase. No network, no secrets.
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const ext = f => fs.readFileSync(path.join(__dirname, "../../extension", f), "utf8");
let passed = 0, failed = 0; const queue = [];
const test = (name, fn) => queue.push([name, fn]);

function makeEnv({ configured = true, google = "" } = {}) {
  const store = {}, calls = [], routes = [];
  const chrome = { storage: { local: {
    async get(k) { if (k == null) return { ...store }; const ks = Array.isArray(k) ? k : [k], o = {}; ks.forEach(x => { if (x in store) o[x] = JSON.parse(JSON.stringify(store[x])); }); return o; },
    async set(o) { Object.entries(o).forEach(([k, v]) => { store[k] = JSON.parse(JSON.stringify(v)); }); },
    async remove(k) { [].concat(k).forEach(x => delete store[x]); } } },
    identity: { getRedirectURL: () => "https://testid.chromiumapp.org/", launchWebAuthFlow: async ({ url }) => { calls.push({ launch: url }); return env.launchResult(url); } } };
  const fetch = async (url, opt = {}) => { const rec = { url, method: opt.method || "GET", headers: opt.headers || {}, body: opt.body ? JSON.parse(opt.body) : undefined }; calls.push(rec);
    for (const [re, h] of routes) if (re.test(url)) { const r = await h(rec); return { ok: r.status < 400, status: r.status, json: async () => r.json, text: async () => JSON.stringify(r.json) }; }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "no route" }; };
  const env = { store, calls, routes, chrome, route: (re, h) => routes.unshift([re, h]), launchResult: () => "" };
  const ctx = vm.createContext({ chrome, fetch, crypto: globalThis.crypto, btoa, atob, URL, URLSearchParams, TextEncoder, console, setTimeout, clearTimeout, AbortController, Date, JSON, Math, Object, Array, Set, Promise, Uint8Array, encodeURIComponent, parseInt, parseFloat, String, Number, Error, isFinite });
  vm.runInContext(`const HAULS_CONFIG = ${JSON.stringify({ SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: configured ? "anon-key" : "", GOOGLE_CLIENT_ID: google })};`, ctx);
  vm.runInContext(ext("lib.js"), ctx); vm.runInContext(ext("auth.js"), ctx); vm.runInContext(ext("sync.js"), ctx);
  env.run = code => vm.runInContext(code, ctx); return env;
}
const tokenResp = (over = {}) => ({ access_token: "AT", refresh_token: "RT", expires_in: 3600, user: { id: "u1", email: "a@b.co", user_metadata: { full_name: "Ann", picture: "http://x/p.png" } }, ...over });

// ---------- auth helpers ----------
test("PKCE challenge matches the RFC 7636 test vector", async () => { const e = makeEnv(); assert.equal(await e.run('challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")'), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"); });
test("verifier is url-safe and long enough", () => { const e = makeEnv(); const v = e.run("randomVerifier()"); assert.ok(/^[A-Za-z0-9_-]{43,128}$/.test(v), v); });
test("parseRedirect reads code and errors", () => { const e = makeEnv(); assert.equal(e.run('parseRedirect("https://x.chromiumapp.org/?code=abc").code'), "abc"); assert.match(e.run('parseRedirect("https://x.chromiumapp.org/#error=access_denied&error_description=No+way").error'), /No/); assert.equal(e.run('parseRedirect("https://x.chromiumapp.org/").code'), null); });
test("sessionFrom maps user + computes expiry; needsRefresh boundary", () => { const e = makeEnv(); const s = e.run(`sessionFrom(${JSON.stringify(tokenResp())}, 1000)`); assert.equal(s.expires_at, 1000 + 3600e3); assert.equal(s.user.name, "Ann"); assert.equal(s.user.avatar, "http://x/p.png");
  assert.equal(e.run(`needsRefresh({access_token:"a",expires_at:${Date.now() + 30e3}})`), true); assert.equal(e.run(`needsRefresh({access_token:"a",expires_at:${Date.now() + 600e3}})`), false); assert.equal(e.run("needsRefresh(null)"), true); });

// ---------- sign-in flow ----------
test("signInWithGoogle: sends PKCE challenge, exchanges code, stores session", async () => {
  const e = makeEnv(); e.launchResult = url => { const u = new URL(url); assert.equal(u.searchParams.get("provider"), "google"); assert.equal(u.searchParams.get("code_challenge_method"), "s256"); assert.equal(u.searchParams.get("redirect_to"), "https://testid.chromiumapp.org/"); assert.ok(u.searchParams.get("code_challenge").length >= 43); return "https://testid.chromiumapp.org/?code=THECODE"; };
  e.route(/\/auth\/v1\/token\?grant_type=pkce/, r => { assert.equal(r.body.auth_code, "THECODE"); assert.ok(r.body.code_verifier.length >= 43); assert.equal(r.headers.apikey, "anon-key"); return { status: 200, json: tokenResp() }; });
  const s = await e.run("signInWithGoogle()"); assert.equal(s.user.email, "a@b.co"); assert.equal(e.store.session.access_token, "AT");
});
test("direct Google sign-in (no Supabase hop): hashed nonce to Google, RAW nonce + id_token to Supabase, session stored", async () => {
  const e = makeEnv({ google: "cid.apps.googleusercontent.com" }); let body;
  e.launchResult = url => "https://testid.chromiumapp.org/#id_token=IDT&state=x"; e.route(/\/auth\/v1\/token\?grant_type=id_token/, r => { body = r.body; return { status: 200, json: tokenResp() }; });
  const s = await e.run("signInWithGoogle()"); const launch = new URL(e.calls.find(c => c.launch).launch);
  assert.equal(launch.host, "accounts.google.com"); assert.equal(launch.searchParams.get("client_id"), "cid.apps.googleusercontent.com"); assert.equal(launch.searchParams.get("response_type"), "id_token");
  assert.equal(launch.searchParams.get("redirect_uri"), "https://testid.chromiumapp.org/"); assert.match(launch.searchParams.get("scope"), /^openid email profile$/);
  assert.equal(body.provider, "google"); assert.equal(body.id_token, "IDT"); assert.ok(body.nonce.length >= 20);
  assert.equal(launch.searchParams.get("nonce"), require("crypto").createHash("sha256").update(body.nonce).digest("hex"), "Google gets sha256(hex) of the nonce Supabase receives raw");
  assert.equal(s.user.email, "a@b.co"); assert.equal(e.store.session.access_token, "AT"); assert.ok(!e.calls.some(c => /\/authorize/.test(c.url || "")), "never touches Supabase's authorize hop");
});
test("direct Google sign-in: Google error and cancel are surfaced; a server rejection is not swallowed", async () => {
  let e = makeEnv({ google: "cid" }); e.launchResult = () => "https://x.chromiumapp.org/#error=access_denied"; await assert.rejects(() => e.run("signInWithGoogle()"), /access_denied/);
  e = makeEnv({ google: "cid" }); e.launchResult = () => "https://x.chromiumapp.org/"; await assert.rejects(() => e.run("signInWithGoogle()"), /cancelled/);
  e = makeEnv({ google: "cid" }); e.launchResult = () => "https://x.chromiumapp.org/#id_token=BAD"; e.route(/grant_type=id_token/, () => ({ status: 400, json: { msg: "Nonces mismatch" } })); await assert.rejects(() => e.run("signInWithGoogle()"), /Nonces mismatch/); assert.equal(e.store.session, undefined);
});
test("signInWithGoogle: provider error and cancel are surfaced; unconfigured is refused", async () => {
  let e = makeEnv(); e.launchResult = () => "https://x.chromiumapp.org/?error=access_denied&error_description=User+denied"; await assert.rejects(() => e.run("signInWithGoogle()"), /denied/);
  e = makeEnv(); e.launchResult = () => "https://x.chromiumapp.org/"; await assert.rejects(() => e.run("signInWithGoogle()"), /cancelled/);
  e = makeEnv({ configured: false }); await assert.rejects(() => e.run("signInWithGoogle()"), /configured|anon/i);
});
test("getSession refreshes an expired token once, even for concurrent callers", async () => {
  const e = makeEnv(); e.store.session = { access_token: "old", refresh_token: "R1", expires_at: Date.now() - 1000, user: { id: "u1", email: "a@b.co" } }; let n = 0;
  e.route(/grant_type=refresh_token/, r => { n++; assert.equal(r.body.refresh_token, "R1"); return { status: 200, json: tokenResp({ access_token: "new", refresh_token: "R2", user: undefined }) }; });
  const [a, b] = await Promise.all([e.run("getSession()"), e.run("getSession()")]); assert.equal(a.access_token, "new"); assert.equal(b.access_token, "new"); assert.equal(n, 1, "single refresh call"); assert.equal(e.store.session.user.email, "a@b.co", "user kept after refresh");
});
test("getSession clears the session when the refresh token is revoked", async () => {
  const e = makeEnv(); e.store.session = { access_token: "old", refresh_token: "R", expires_at: 0, user: { id: "u" } }; e.route(/grant_type=refresh_token/, () => ({ status: 400, json: { error_description: "Invalid Refresh Token: Already Used" } }));
  assert.equal(await e.run("getSession()"), null); assert.equal(e.store.session, undefined);
});
test("signOut clears session + caches but keeps local watchlist", async () => {
  const e = makeEnv(); e.store.session = { access_token: "a", expires_at: Date.now() + 1e6 }; e.store.items = { k: { wish: true, hist: [] } }; e.store.histCache = { k: {} }; e.route(/logout/, () => ({ status: 204, json: {} }));
  await e.run("signOut()"); assert.equal(e.store.session, undefined); assert.equal(e.store.histCache, undefined); assert.ok(e.store.items.k, "local data stays in the browser");
});
test("api(): adds apikey + bearer; one retry after 401; fails when signed out", async () => {
  const e = makeEnv(); e.store.session = { access_token: "A1", refresh_token: "R", expires_at: Date.now() + 1e6, user: { id: "u" } }; let hits = 0;
  e.route(/rest\/v1\/thing/, r => { hits++; return r.headers.authorization === "Bearer A2" ? { status: 200, json: [{ ok: 1 }] } : { status: 401, json: {} }; });
  e.route(/grant_type=refresh_token/, () => ({ status: 200, json: tokenResp({ access_token: "A2" }) }));
  assert.deepEqual(await e.run('api("/thing")'), [{ ok: 1 }]); assert.equal(hits, 2);
  const e2 = makeEnv(); await assert.rejects(() => e2.run('api("/thing")'), /not-signed-in/);
});

// ---------- sync pure helpers ----------
test("coalesce keeps the latest watch op per product and dedupes same-day observations", () => { const e = makeEnv();
  let ob = e.run('coalesce([], {t:"watch",key:"a",wish:true,u:1})'); ob = e.run(`coalesce(${JSON.stringify(ob)}, {t:"watch",key:"a",wish:false,u:2})`); assert.equal(ob.length, 1); assert.equal(ob[0].u, 2);
  ob = e.run(`coalesce(${JSON.stringify(ob)}, {t:"obs",key:"a",price:100,at:"2026-10-17T01:00:00Z"})`); ob = e.run(`coalesce(${JSON.stringify(ob)}, {t:"obs",key:"a",price:100,at:"2026-10-17T09:00:00Z"})`); assert.equal(ob.filter(o => o.t === "obs").length, 1);
  ob = e.run(`coalesce(${JSON.stringify(ob)}, {t:"obs",key:"a",price:90,at:"2026-10-17T10:00:00Z"})`); assert.equal(ob.filter(o => o.t === "obs").length, 2, "different price is kept"); });
test("coalesce caps the outbox", () => { const e = makeEnv(); const big = Array.from({ length: 600 }, (_, i) => ({ t: "obs", key: "k" + i, price: i + 1, at: "2026-10-17" })); assert.equal(e.run(`coalesce(${JSON.stringify(big)}, {t:"obs",key:"z",price:5,at:"2026-10-18"})`).length, 500); });
test("mergeWatchRow is last-write-wins and handles server deletes", () => { const e = makeEnv();
  const local = { site: "Amazon", title: "T", wish: true, target: 100, u: 5000, hist: [[1, 100]] };
  assert.equal(e.run(`mergeWatchRow(${JSON.stringify(local)}, {updated_at:"1970-01-01T00:00:01Z",wish:false})`), null, "older server row ignored");
  const m = e.run(`mergeWatchRow(${JSON.stringify(local)}, {updated_at:"2026-10-17T00:00:00Z",wish:false,target_price:null,title:"New"})`); assert.equal(m.wish, false); assert.equal(m.target, undefined); assert.equal(m.title, "New"); assert.deepEqual(m.hist, [[1, 100]], "local history preserved");
  const d = e.run('mergeWatchRow(undefined, {updated_at:"2026-10-17T00:00:00Z",wish:true,deleted_at:"2026-10-17T00:00:00Z",site:"A",title:"t"})'); assert.equal(d.wish, false); const n = e.run('mergeWatchRow(undefined, {updated_at:"2026-10-17T00:00:00Z",wish:true,target_price:"249.5",site:"A",title:"t"})'); assert.equal(n.target, 249.5); assert.deepEqual(n.hist, []); });
test("mergeHistory: your own day beats the community, output sorted, junk ignored", () => { const e = makeEnv();
  const day = d => new Date(d).toISOString().slice(0, 10), t1 = Date.parse("2026-10-10T08:00:00Z"), t2 = Date.parse("2026-10-14T08:00:00Z");
  const out = e.run(`mergeHistory([[${t2}, 500]], [{day:"${day(t1)}",median_price:"700"},{day:"${day(t2)}",median_price:"650"},{day:"2026-10-01",median_price:"0"}])`);
  assert.equal(out.length, 2); assert.equal(out[0][1], 700); assert.equal(out[1][1], 500, "own observation wins on its day"); assert.ok(out[0][0] < out[1][0]); assert.deepEqual(e.run("mergeHistory([[1,2]], null)"), [[1, 2]]); });
test("row mappers", () => { const e = makeEnv(); const r = e.run('toWatchRow("U", {key:"k",site:"S",title:"t",target:99,wish:true,u:1000,deleted:true,last:50})'); assert.equal(r.user_id, "U"); assert.equal(r.product_key, "k"); assert.equal(r.target_price, 99); assert.ok(r.deleted_at); assert.equal(r.updated_at, new Date(1000).toISOString());
  const o = e.run('toObsRow({key:"k",site:"S",price:10,mrp:20,at:1000,src:"jsonld"})'); assert.equal(o.src, "jsonld"); assert.equal(o.mrp, 20); assert.ok(!("title" in o) && !("url" in o) && !("user_id" in o), "observations carry no identity"); });

// ---------- sync flows ----------
const signedIn = (e, extra = {}) => { e.store.session = { access_token: "A", refresh_token: "R", expires_at: Date.now() + 1e7, user: { id: "u1", email: "a@b.co" } }; Object.assign(e.store, extra); };
test("flush: uploads watch rows + observation batches, clears outbox", async () => {
  const e = makeEnv(); signedIn(e, { profile: { contribute: true }, outbox: [{ t: "watch", id: "w1", key: "a", site: "S", wish: true, u: 1 }, ...Array.from({ length: 120 }, (_, i) => ({ t: "obs", id: "o" + i, key: "p" + i, site: "S", price: i + 1, at: 1 }))] }); let obsBatches = [], watch;
  e.route(/ext_watchlist\?on_conflict=user_id,product_key/, r => { watch = r; return { status: 201, json: {} }; }); e.route(/rpc\/ext_upsert_observations/, r => { obsBatches.push(r.body.p_rows.length); return { status: 200, json: r.body.p_rows.length }; });
  const res = await e.run("flush()"); assert.equal(res.ok, true); assert.deepEqual(obsBatches, [50, 50, 20]); assert.equal(watch.headers.Prefer, "resolution=merge-duplicates,return=minimal"); assert.equal(watch.body[0].user_id, "u1"); assert.equal(e.store.outbox.length, 0); assert.ok(e.store.lastSync);
});
test("flush: contribute=false never sends observations (but still drains the queue)", async () => {
  const e = makeEnv(); signedIn(e, { profile: { contribute: false }, outbox: [{ t: "obs", id: "o1", key: "p", site: "S", price: 5, at: 1 }] }); let sent = 0; e.route(/rpc\/ext_upsert_observations/, () => { sent++; return { status: 200, json: 1 }; });
  await e.run("flush()"); assert.equal(sent, 0); assert.equal(e.store.outbox.length, 0);
});
test("flush: keeps the outbox when the server fails; signed-out is a no-op", async () => {
  const e = makeEnv(); signedIn(e, { outbox: [{ t: "watch", id: "w1", key: "a", wish: true, u: 1 }] }); e.route(/ext_watchlist/, () => ({ status: 500, json: { m: "boom" } }));
  const r = await e.run("flush()"); assert.equal(r.ok, false); assert.equal(e.store.outbox.length, 1);
  const e2 = makeEnv(); e2.store.outbox = [{ t: "obs" }]; const r2 = await e2.run("flush()"); assert.equal(r2.reason, "signed-out"); assert.equal(e2.store.outbox.length, 1, "queue untouched while signed out");
});
test("pull: merges server watchlist into local items, tracks lastPull, loads plan", async () => {
  const e = makeEnv(); signedIn(e, { items: { old: { site: "A", title: "Old", wish: true, u: 9e15, hist: [[1, 1]] } } });
  e.route(/ext_profiles/, () => ({ status: 200, json: [{ plan: "pro", contribute: true }] }));
  e.route(/ext_watchlist\?select/, r => { assert.match(r.url, /updated_at=gt\.1970/); return { status: 200, json: [{ product_key: "new", site: "Flipkart", title: "N", wish: true, updated_at: "2026-10-17T05:00:00Z" }, { product_key: "old", wish: false, updated_at: "2026-10-17T06:00:00Z" }] }; });
  const r = await e.run("pull()"); assert.equal(r.ok, true); assert.equal(e.store.items.new.wish, true); assert.equal(e.store.items.old.wish, true, "newer local edit not overwritten"); assert.equal(e.store.plan, "pro"); assert.equal(e.store.lastPull, "2026-10-17T06:00:00Z");
});
test("fetchCommunity: caches 6h, returns [] signed out, falls back to stale cache on failure", async () => {
  const e = makeEnv(); assert.deepEqual(await e.run('fetchCommunity("k")'), []); signedIn(e); let hits = 0; e.route(/rpc\/ext_price_history/, () => { hits++; return { status: 200, json: [{ day: "2026-10-01", median_price: "5" }] }; });
  assert.equal((await e.run('fetchCommunity("k")')).length, 1); await e.run('fetchCommunity("k")'); assert.equal(hits, 1, "second call served from cache");
  e.store.histCache.k.t = Date.now() - 7 * 3600e3; e.routes.length = 0; e.route(/rpc\/ext_price_history/, () => ({ status: 500, json: {} })); assert.equal((await e.run('fetchCommunity("k")')).length, 1, "stale rows on failure");
});

test("flush: ops enqueued while a flush is in flight are NOT lost", async () => {
  const e = makeEnv(); signedIn(e, { outbox: [{ t: "watch", id: "w1", key: "a", wish: true, u: 1 }] });
  e.route(/ext_watchlist\?on_conflict/, async () => { e.store.outbox = [...e.store.outbox, { t: "watch", id: "w2", key: "b", wish: true, u: 2 }]; return { status: 201, json: {} }; });
  await e.run("flush()"); assert.deepEqual(e.store.outbox.map(o => o.id), ["w2"], "only the delivered op is removed");
});
test("flush: a permanently rejected (4xx) op is dropped and does not block the rest", async () => {
  const e = makeEnv(); signedIn(e, { outbox: [{ t: "watch", id: "bad", key: "bad", wish: true, u: 1 }, { t: "watch", id: "good", key: "good", wish: true, u: 2 }] }); const delivered = [];
  e.route(/ext_watchlist\?on_conflict/, r => { if (r.body.some(x => x.product_key === "bad")) return { status: 400, json: { message: "watchlist_limit_reached" } }; r.body.forEach(x => delivered.push(x.product_key)); return { status: 201, json: {} }; });
  const r = await e.run("flush()"); assert.equal(r.ok, true); assert.equal(r.dropped, 1); assert.deepEqual(delivered, ["good"]); assert.equal(e.store.outbox.length, 0);
});
test("flush: a transient failure (5xx) on one op keeps it and later ops for retry", async () => {
  const e = makeEnv(); signedIn(e, { outbox: [{ t: "watch", id: "a", key: "a", wish: true, u: 1 }] }); e.route(/ext_watchlist/, () => ({ status: 503, json: {} })); const r = await e.run("flush()"); assert.equal(r.ok, false); assert.equal(e.store.outbox.length, 1);
});
test("observation dedupe uses the calendar day for epoch-ms timestamps", () => { const e = makeEnv(); const day = 864e5, t0 = Date.UTC(2026, 9, 17, 1);
  let ob = e.run(`coalesce([], {t:"obs",key:"a",price:5,at:${t0}})`); ob = e.run(`coalesce(${JSON.stringify(ob)}, {t:"obs",key:"a",price:5,at:${t0 + 3600e3}})`); assert.equal(ob.length, 1, "same day+price deduped");
  ob = e.run(`coalesce(${JSON.stringify(ob)}, {t:"obs",key:"a",price:5,at:${t0 + day}})`); assert.equal(ob.length, 2, "next day kept"); });
test("withLock serialises read-modify-write sections", async () => { const e = makeEnv(); const out = await e.run(`(async () => { let v = 0; const log = []; await Promise.all([1, 2, 3].map(i => withLock(async () => { const x = v; await new Promise(r => setTimeout(r, 5 - i)); v = x + 1; log.push(i); }))); return { v, log }; })()`); assert.equal(out.v, 3); assert.deepEqual(out.log, [1, 2, 3]); });
test("pulled watchlist rows can't inject non-https links and keep last_price", () => { const e = makeEnv(); const m = e.run('mergeWatchRow(undefined, {updated_at:"2026-10-17T00:00:00Z",wish:true,site:"A",title:"t",url:"javascript:alert(1)",image:"http://x/y.png",last_price:"499"})'); assert.equal(m.url, undefined); assert.equal(m.image, undefined); assert.equal(m.last, 499); assert.deepEqual(m.hist, []); });
test("signOut wipes user-scoped state (plan, profile, queue) so the next person inherits nothing; the watchlist is put away for its owner, not shown", async () => {
  const e = makeEnv(); signedIn(e, { profile: { plan: "pro" }, plan: "pro", outbox: [{ t: "watch", id: "x", key: "a", u: 1 }], histCache: { a: {} }, lastPull: "2026-01-01", lastSync: 5, items: { a: { wish: true, hist: [] } } }); e.route(/logout/, () => ({ status: 204, json: {} }));
  await e.run("signOut()"); for (const k of ["session", "profile", "plan", "outbox", "histCache", "lastPull", "lastSync"]) assert.equal(e.store[k], undefined, k + " should be wiped"); assert.equal(e.store.items, undefined, "not visible to the next person"); assert.ok(e.store["vault:u1"].data.items.a, "kept for u1's next sign-in");
});
// ---------- S1: session policy ----------
const DAYMS = 864e5, mkSession = (over = {}) => ({ access_token: "A1", refresh_token: "R1", expires_at: Date.now() + 3600e3, user: { id: "u1", email: "a@b.co" }, signedInAt: Date.now() - 5 * DAYMS, lastActiveAt: Date.now() - 2 * DAYMS, ...over });
test("S1 sign-in stamps signedInAt/lastActiveAt and clears an old notice", async () => {
  const e = makeEnv(); e.store.authNotice = "revoked"; e.launchResult = () => "https://x.chromiumapp.org/?code=C"; e.route(/grant_type=pkce/, () => ({ status: 200, json: tokenResp() }));
  const s = await e.run("signInWithGoogle()"); assert.ok(Math.abs(s.signedInAt - Date.now()) < 5000 && Math.abs(s.lastActiveAt - Date.now()) < 5000); assert.equal(e.store.session.signedInAt, s.signedInAt); assert.equal(e.store.authNotice, undefined);
});
test("S1 offline / 503 / 429 during refresh keep the session (never a surprise logout)", async () => {
  for (const mode of ["throw", 503, 429, 500]) {
    const e = makeEnv(); e.store.session = mkSession({ expires_at: Date.now() - 1000 }); e.store.items = { a: { wish: true, hist: [] } };
    e.route(/grant_type=refresh_token/, () => { if (mode === "throw") throw new TypeError("Failed to fetch"); return { status: mode, json: { message: "server busy" } }; });
    assert.equal(await e.run("getSession()"), null, "expired token + transient failure => no usable session right now (" + mode + ")"); assert.ok(e.store.session, "session retained (" + mode + ")"); assert.equal(e.store.authNotice, undefined, "no notice"); assert.ok(e.store.items.a);
  }
  const e2 = makeEnv(); e2.store.session = mkSession({ expires_at: Date.now() + 10 * 60e3 }); e2.route(/grant_type=refresh_token/, () => ({ status: 503, json: {} }));
  const s = await e2.run("getSession(20 * 60e3)"); assert.equal(s.access_token, "A1", "a still-valid token keeps working when the proactive refresh fails");
});
test("S1 a rejected refresh token ends the session softly: notice set, watchlist put away for its owner, user-scoped state wiped", async () => {
  for (const [status, body] of [[400, { error: "invalid_grant", error_description: "Invalid Refresh Token: Already Used" }], [400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }], [401, { error_description: "Session expired" }]]) {
    const e = makeEnv(); e.store.session = mkSession({ expires_at: 0 }); Object.assign(e.store, { profile: { plan: "pro" }, plan: "pro", outbox: [{ id: "x" }], items: { a: { wish: true, hist: [[1, 2]] } } });
    e.route(/grant_type=refresh_token/, () => ({ status, json: body })); assert.equal(await e.run("getSession()"), null);
    assert.equal(e.store.session, undefined); assert.equal(e.store.authNotice, "revoked"); assert.equal(e.store.profile, undefined); assert.equal(e.store.plan, undefined); assert.equal(e.store.outbox, undefined); assert.equal(e.store.items, undefined); assert.deepEqual(e.store["vault:u1"].data.items.a.hist, [[1, 2]]);
  }
});
test("S1 90-day inactivity: 89 days still signed in (and refreshed), 91 days signed out softly without any network call", async () => {
  let e = makeEnv(); e.store.session = mkSession({ expires_at: 0, lastActiveAt: Date.now() - 89 * DAYMS, signedInAt: Date.now() - 200 * DAYMS }); let n = 0;
  e.route(/grant_type=refresh_token/, () => { n++; return { status: 200, json: tokenResp({ access_token: "NEW", refresh_token: "R2" }) }; });
  const s = await e.run("getSession()"); assert.equal(s.access_token, "NEW"); assert.equal(n, 1);
  assert.ok(e.store.session.signedInAt < Date.now() - 199 * DAYMS && e.store.session.lastActiveAt < Date.now() - 88 * DAYMS, "refresh must not reset the activity/sign-in stamps");
  e = makeEnv(); e.store.session = mkSession({ lastActiveAt: Date.now() - 91 * DAYMS }); e.route(/./, () => { throw new Error("no network call expected"); });
  assert.equal(await e.run("getSession()"), null); assert.equal(e.store.session, undefined); assert.equal(e.store.authNotice, "inactive");
});
test("S1 touchActive: at most once a day, only for a signed-in user", async () => {
  const e = makeEnv(); assert.equal(await e.run("touchActive()"), false, "signed out"); e.store.session = mkSession({ lastActiveAt: Date.now() - 2 * 3600e3 });
  assert.equal(await e.run("touchActive()"), false, "touched 2 h ago: no write"); e.store.session.lastActiveAt = Date.now() - 25 * 3600e3; assert.equal(await e.run("touchActive()"), true); assert.ok(Date.now() - e.store.session.lastActiveAt < 5000);
});
test("S1 'I was active' never overwrites a token rotated at the same moment", async () => {
  const e = makeEnv(); e.store.session = mkSession({ expires_at: Date.now() - 1000, lastActiveAt: Date.now() - 30 * 3600e3 });
  e.route(/grant_type=refresh_token/, async () => { await new Promise(r => setTimeout(r, 20)); return { status: 200, json: tokenResp({ access_token: "ROTATED", refresh_token: "R-ROTATED" }) }; });
  await Promise.all([e.run("getSession()"), e.run("touchActive()"), e.run("touchActive()")]);
  assert.equal(e.store.session.access_token, "ROTATED"); assert.equal(e.store.session.refresh_token, "R-ROTATED"); assert.ok(Date.now() - e.store.session.lastActiveAt < 5000, "activity stamp updated too");
});
test("S1 proactive refresh: due when <20 min left, not when 40 min left", async () => {
  let n = 0, e = makeEnv(); e.store.session = mkSession({ expires_at: Date.now() + 15 * 60e3 }); e.route(/grant_type=refresh_token/, () => { n++; return { status: 200, json: tokenResp({ access_token: "N" }) }; });
  await e.run("getSession(20 * 60e3)"); assert.equal(n, 1);
  e = makeEnv(); e.store.session = mkSession({ expires_at: Date.now() + 40 * 60e3 }); e.route(/grant_type=refresh_token/, () => { n++; return { status: 200, json: tokenResp() }; }); await e.run("getSession(20 * 60e3)"); assert.equal(n, 1, "no refresh needed");
});
test("S1 user sign-out clears any 'sign in again' notice", async () => { const e = makeEnv(); e.store.session = mkSession(); e.store.authNotice = "inactive"; e.route(/logout/, () => ({ status: 204, json: {} })); await e.run("signOut()"); assert.equal(e.store.authNotice, undefined); assert.equal(e.store.session, undefined); });
test("S1 error classification", () => { const e = makeEnv(); const iv = x => e.run(`isInvalidGrant(${JSON.stringify(x)})`);
  assert.equal(iv({ status: 400, code: "invalid_grant", message: "x" }), true); assert.equal(iv({ status: 503, message: "not found" }), false, "5xx is never an invalid grant"); assert.equal(iv({ message: "Failed to fetch" }), false); assert.equal(iv({ status: 429, message: "revoked?" }), false); });
// ---------- S2: one account's data at a time (switching accounts never shows, merges or uploads another person's watchlist) ----------
const W = (title, extra = {}) => ({ site: "Amazon", title, hist: [[1, 100]], wish: true, ...extra });
test("S2 claimOwner: anonymous local data is adopted by the first account; the same account is 'same'; a different account is 'switched' and the old account's data goes to its vault", async () => {
  const e = makeEnv(); Object.assign(e.store, { items: { a: W("anon item") } });
  assert.equal(await e.run('claimOwner("u1")'), "adopted"); assert.equal(e.store.localOwner, "u1"); assert.ok(e.store.items.a, "anonymous items join the first account");
  assert.equal(await e.run('claimOwner("u1")'), "same");
  assert.equal(await e.run('claimOwner("u2")'), "switched"); assert.equal(e.store.localOwner, "u2"); assert.equal(e.store.items, undefined, "u1's watchlist is not visible to u2"); assert.ok(e.store["vault:u1"] && e.store["vault:u1"].data.items.a, "it waits in u1's vault");
});
test("S2 the reported bug: A's watchlist never appears for B, B's never for A, and each comes back for its own owner", async () => {
  const e = makeEnv(); signedIn(e, { localOwner: "u1", items: { a: W("A's phone") } }); e.route(/logout|ext_watchlist/, () => ({ status: 204, json: {} }));
  await e.run("signOut()"); assert.equal(e.store.items, undefined, "after sign-out nobody sees u1's watchlist"); assert.equal(e.store.localOwner, undefined);
  assert.equal(await e.run('claimOwner("u2")'), "adopted"); assert.equal(e.store.items, undefined, "u2 starts clean"); e.store.items = { b: W("B's laptop") };
  assert.equal(await e.run('claimOwner("u1")'), "switched"); assert.deepEqual(Object.keys(e.store.items), ["a"], "u1 sees only u1's items");
  assert.equal(await e.run('claimOwner("u2")'), "switched"); assert.deepEqual(Object.keys(e.store.items), ["b"], "u2 sees only u2's items");
});
test("S2 another account's queued changes are never uploaded by the new account (no outbox leak)", async () => {
  const e = makeEnv(); Object.assign(e.store, { localOwner: "u1", items: { a: W("A") }, outbox: [{ t: "watch", id: "w1", key: "a", wish: true, u: 1 }] });
  await e.run('claimOwner("u2")'); assert.equal(e.store.outbox, undefined, "u2's outbox is empty"); assert.equal(e.store["vault:u1"].data.outbox.length, 1, "u1's unsent change waits for u1");
  await e.run('claimOwner("u1")'); assert.equal(e.store.outbox.length, 1, "and is back when u1 returns");
});
test("S2 anonymous items added while signed out join the next account on top of its own saved data", async () => {
  const e = makeEnv(); Object.assign(e.store, { "vault:u1": { at: Date.now(), data: { items: { a: W("saved A") } } }, items: { x: W("added while signed out") } });
  assert.equal(await e.run('claimOwner("u1")'), "adopted"); assert.deepEqual(Object.keys(e.store.items).sort(), ["a", "x"]); assert.equal(e.store["vault:u1"], undefined, "the vault is emptied once restored");
});
test("S2 vaults stay small: at most 3, none older than 30 days, caches dropped, watched items kept plus the 30 most recent others", async () => {
  const e = makeEnv(); for (let k = 1; k <= 5; k++) { Object.assign(e.store, { localOwner: "o" + k, items: { w: W("w" + k) } }); await new Promise(r => setTimeout(r, 2)); await e.run(`releaseOwner()`); }
  assert.ok(Object.keys(e.store).filter(k => k.startsWith("vault:")).length <= 3, "at most 3 vaults: " + Object.keys(e.store).filter(k => k.startsWith("vault:")));
  Object.assign(e.store, { "vault:old": { at: Date.now() - 31 * 864e5, data: { items: { z: W("old") } } } }); assert.equal(await e.run('claimOwner("old")'), "adopted"); assert.equal(e.store.items, undefined, "a 30-day-old vault is not restored");
  const items = { keep1: W("watched", { wish: true }), keep2: W("tracked", { target: 5, wish: false }) }; for (let k = 0; k < 45; k++) items["v" + k] = { site: "Amazon", hist: [[1, 5]], seenAt: k };
  Object.assign(e.store, { localOwner: "big", items, histCache: { a: 1 }, chartCache: { b: 2 } }); await e.run("releaseOwner()"); const d = e.store["vault:big"].data; assert.ok(d.items.keep1 && d.items.keep2, "watched items kept"); assert.equal(Object.keys(d.items).length, 2 + 30, "plus 30 recent others"); assert.ok(d.items.v44 && !d.items.v0, "the recent ones, not the old ones"); assert.equal(d.histCache, undefined); assert.equal(d.chartCache, undefined);
});
test("S2 signOut first sends what is still queued to THIS account, then puts its data away; nothing of it stays visible", async () => {
  const e = makeEnv(); signedIn(e, { localOwner: "u1", items: { a: W("A") }, outbox: [{ t: "watch", id: "w1", key: "a", wish: true, u: 1, site: "Amazon", title: "A" }] }); const order = []; e.route(/ext_watchlist/, () => { order.push("push"); return { status: 201, json: [] }; }); e.route(/logout/, () => { order.push("logout"); return { status: 204, json: {} }; });
  await e.run("signOut()"); assert.deepEqual(order.slice(0, 2), ["push", "logout"], "the queue is pushed before leaving the account: " + order); assert.equal(e.store.session, undefined); assert.equal(e.store.items, undefined); assert.equal(e.store.localOwner, undefined); assert.ok(e.store["vault:u1"].data.items.a);
});
test("S2 sign-out and clear also deletes the vaults, saved places, pincode and coordinates; plain sign-out puts them away for the same account; every synced setting is covered by both wipe lists", async () => {
  const mine = { places: [{ id: "p1", name: "Home", pin: "842001" }], pin: "842001", loc: { lat: 1, lon: 2, pin: "842001" }, lastPin: "842001", range: "1Y" };
  let e = makeEnv(); signedIn(e, { localOwner: "u1", ...mine, knobY: 0.4 }); e.route(/logout|ext_watchlist/, () => ({ status: 204, json: {} })); await e.run("signOut()"); for (const k of Object.keys(mine)) assert.equal(e.store[k], undefined, k + " is not visible after sign-out"); assert.equal(e.store.knobY, 0.4); assert.deepEqual(e.store["vault:u1"].data.pin, "842001"); await e.run('claimOwner("u1")'); for (const k of Object.keys(mine)) assert.ok(e.store[k] !== undefined, k + " returns for the same account");
  e = makeEnv(); signedIn(e, { localOwner: "u1", ...mine, "vault:other": { at: Date.now(), data: { items: { q: W("q") } } } }); e.route(/logout|ext_watchlist/, () => ({ status: 204, json: {} })); await e.run("signOut({ clear: true })"); for (const k of ["places", "pin", "loc", "lastPin", "range", "vault:other", "vault:u1", "items", "localOwner"]) assert.equal(e.store[k], undefined, k);
  const synced = e.run("Object.keys(SYNCED_SETTINGS)"), contentKeys = e.run("CONTENT_KEYS"), personal = e.run("PERSONAL_KEYS"); for (const k of synced) { assert.ok(contentKeys.includes(k), "CONTENT_KEYS covers synced setting " + k); assert.ok(personal.includes(k), "PERSONAL_KEYS covers synced setting " + k); } });
test("S2 a session that can no longer be used (revoked, inactive) also puts the watchlist away", async () => {
  const e = makeEnv(); signedIn(e, { localOwner: "u1", items: { a: W("A") } }); await e.run('softSignOut("expired")'); assert.equal(e.store.items, undefined); assert.ok(e.store["vault:u1"].data.items.a); assert.equal(e.store.authNotice, "expired");
});
(async () => { for (const [name, fn] of queue) { try { await fn(); passed++; console.log("  ok   " + name); } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e && e.message || e).split("\n")[0]); } } console.log(`\nunit: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); })();
