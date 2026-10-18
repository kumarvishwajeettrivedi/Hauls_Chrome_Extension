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
test("sessionFrom maps user + computes expiry; needsRefresh boundary", () => { const e = makeEnv(); const s = e.run(`sessionFrom(${JSON.stringify(tokenResp())}, 1000)`); assert.equal(s.expires_at, 1000 + 3600e3); assert.equal(s.user.name, "Ann"); assert.equal(s.user.avatar, "", "an http avatar is not kept");
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
const signedIn = (e, extra = {}) => { e.store.session = { access_token: "A", refresh_token: "R", expires_at: Date.now() + 1e7, user: { id: "u1", email: "a@b.co" } }; Object.assign(e.store, { localOwner: "u1" }, extra); }; // sync only runs for data tagged with the signed-in account
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
test("S2 fail closed: flush and pull refuse while another account's data is live", async () => {
  const e = makeEnv(); Object.assign(e.store, { localOwner: "u1", items: { a: W("u1 item") }, outbox: [{ id: "o1", t: "watch", key: "a" }] }); e.run('getSession = async () => ({ user: { id: "u2" } })');
  const f = await e.run("flush()"), p = await e.run("pull()"); assert.equal(f.reason, "owner-mismatch"); assert.equal(p.reason, "owner-mismatch"); assert.equal(e.store.outbox.length, 1, "u1's queue was not sent as u2"); assert.ok(!e.calls.some(c => /ext_watchlist/.test(c.url || "")), "no request was made");
});
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
// ---------- review fixes: owner fail-closed, session pairing, races, outbox ----------
const gate = () => { let open; const p = new Promise(r => { open = r; }); return { p, open }; }, until = async (f, ms = 2000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await new Promise(r => setTimeout(r, 5)); } };
test("S2 no owner tag = no sync: with a session but no localOwner flush and pull refuse (fail closed); tagging the legacy session makes them work", async () => {
  const e = makeEnv(); signedIn(e, { items: { a: W("A") }, outbox: [{ t: "watch", id: "w1", key: "a", wish: true, u: 1 }] }); delete e.store.localOwner; e.route(/ext_watchlist|ext_profiles/, () => ({ status: 200, json: [] }));
  assert.equal((await e.run("flush()")).reason, "owner-mismatch"); assert.equal((await e.run("pull()")).reason, "owner-mismatch"); assert.ok(!e.calls.some(c => /rest\/v1/.test(c.url || "")), "no request was made"); assert.equal(e.store.outbox.length, 1);
  await e.run("claimLegacyOwner()"); assert.equal(e.store.localOwner, "u1"); assert.ok(e.store.items.a, "its own data stays"); assert.equal((await e.run("flush()")).ok, true); assert.equal((await e.run("pull()")).ok, true);
});
test("S2 a pull that overlaps sign-out is dropped: the signed-out device does not receive the account's watchlist", async () => {
  const e = makeEnv(); signedIn(e, { items: {} }); const g = gate(); let hit = false; e.route(/ext_profiles/, () => ({ status: 200, json: [] }));
  e.route(/ext_watchlist\?select/, async () => { hit = true; await g.p; return { status: 200, json: [{ product_key: "amazon.in:SERVERA", site: "Amazon", wish: true, updated_at: "2026-10-17T05:00:00Z" }] }; }); e.route(/logout/, () => ({ status: 204, json: {} }));
  const p = e.run("pull()"); await until(() => hit); await e.run("signOut()"); g.open(); const r = await p;
  assert.equal(r.ok, false); assert.equal(r.reason, "owner-mismatch"); assert.equal(e.store.items, undefined, "nothing of the account lands on the signed-out device"); assert.equal(e.store.lastPull, undefined);
  assert.equal(await e.run('claimOwner("u2")'), "adopted"); assert.equal(e.store.items, undefined, "the next account does not adopt it");
});
test("S2 api(): a flush/pull stays pinned to its account; if the session changes mid-way, nothing more is sent with the new token", async () => {
  const e = makeEnv(); signedIn(e, { items: {} }); const g = gate(); let hit = false;
  e.route(/ext_profiles/, async () => { hit = true; await g.p; return { status: 200, json: [] }; }); e.route(/rest\/v1\/(?!ext_profiles)/, () => ({ status: 200, json: [] }));
  const p = e.run("pull()"); await until(() => hit); e.store.session = { access_token: "AT-B", refresh_token: "RB", expires_at: Date.now() + 1e7, user: { id: "u2" } }; g.open(); const r = await p;
  assert.equal(r.ok, false); assert.ok(!e.calls.some(c => (c.headers || {}).authorization === "Bearer AT-B"), "no request carried B's token for A's pull");
  await assert.rejects(() => e.run('api("/ext_watchlist", { uid: "u1" })'), /session-changed/); assert.ok(!e.calls.some(c => /ext_watchlist/.test(c.url || "") && (c.headers || {}).authorization === "Bearer AT-B"));
});
test("S1 a refresh that finishes after sign-out (or after another account signed in) never brings the old session back", async () => {
  let e = makeEnv(); e.store.session = mkSession({ expires_at: Date.now() - 1000 }); let g = gate(), hit = false; e.route(/grant_type=refresh_token/, async () => { hit = true; await g.p; return { status: 200, json: tokenResp({ access_token: "NEW", refresh_token: "RNEW" }) }; });
  let p = e.run("getSession()"); await until(() => hit); await e.run("sessionStore.del()"); g.open(); assert.equal(await p, null); assert.equal(e.store.session, undefined, "signed out stays signed out");
  e = makeEnv(); e.store.session = mkSession({ expires_at: Date.now() - 1000 }); g = gate(); hit = false; e.route(/grant_type=refresh_token/, async () => { hit = true; await g.p; return { status: 200, json: tokenResp({ access_token: "NEW", refresh_token: "RNEW" }) }; });
  p = e.run("getSession()"); await until(() => hit); e.store.session = mkSession({ access_token: "B1", refresh_token: "RB", user: { id: "u2" } }); g.open(); const s = await p; assert.equal(s.user.id, "u2"); assert.equal(e.store.session.refresh_token, "RB", "B's session is untouched");
  e = makeEnv(); e.store.session = mkSession({ expires_at: Date.now() - 1000 }); g = gate(); hit = false; e.route(/grant_type=refresh_token/, async () => { hit = true; await g.p; return { status: 400, json: { error: "invalid_grant", error_description: "Invalid Refresh Token: Already Used" } }; });
  p = e.run("getSession()"); await until(() => hit); e.store.session = mkSession({ access_token: "B1", refresh_token: "RB", user: { id: "u2" } }); g.open(); await p; assert.equal(e.store.session.refresh_token, "RB", "a rejected old token does not end the new account's session");
});
test("S1 the 401 path does not restore a signed-out session", async () => {
  const e = makeEnv(); signedIn(e, {}); const g = gate(); let hit = false; e.route(/rest\/v1\/thing/, async () => { hit = true; await g.p; return { status: 401, json: {} }; });
  const p = e.run('api("/thing")').catch(x => x); await until(() => hit); await e.run("sessionStore.del()"); g.open(); const r = await p; assert.match(String(r.message || r), /not-signed-in/); assert.equal(e.store.session, undefined);
});
test("flush: one at a time; a call made while one runs gets one more pass; a late flush after sign-out cannot resend what it delivered", async () => {
  let e = makeEnv(); signedIn(e, { outbox: [{ t: "watch", id: "w1", key: "a", wish: true, u: 1 }] }); const g = gate(); let posts = 0, started = 0; e.route(/ext_watchlist\?on_conflict/, async () => { started++; posts++; if (started === 1) await g.p; return { status: 201, json: {} }; });
  const p1 = e.run("flush()"); await until(() => started === 1); const p2 = e.run("flush()"); await new Promise(r => setTimeout(r, 30)); assert.equal(posts, 1, "no second request while the first is in flight"); e.store.outbox = [...e.store.outbox, { t: "watch", id: "w2", key: "b", wish: true, u: 2 }];
  g.open(); await Promise.all([p1, p2]); assert.equal(posts, 2, "the queued call got its own pass"); assert.equal(e.store.outbox.length, 0);
  e = makeEnv(); signedIn(e, { items: { a: W("A") }, outbox: [{ t: "watch", id: "w1", key: "a", wish: true, u: 1 }] }); const g2 = gate(); let hit = false; e.route(/ext_watchlist\?on_conflict/, async () => { hit = true; await g2.p; return { status: 201, json: {} }; });
  const p = e.run("flush()"); await until(() => hit); await e.run("sessionStore.del()"); await e.run("releaseOwner()"); assert.equal(e.store["vault:u1"].data.outbox.length, 1, "the unsent op waits in the vault"); g2.open(); await p;
  assert.deepEqual(e.store["vault:u1"].data.outbox, [], "it was delivered after all: it is not sent again at the next sign-in"); assert.equal(e.store.outbox, undefined, "and nothing is written to the signed-out device"); assert.equal(e.store.lastSync, undefined);
});
test("outbox: server errors are counted and an op is dropped after 10 flushes; offline does not count; 4xx classes", async () => {
  const e = makeEnv(); signedIn(e, { outbox: [{ t: "watch", id: "w1", key: "a", wish: true, u: 1 }] }); let mode = 500; e.route(/ext_watchlist/, () => { if (mode === "offline") throw new TypeError("Failed to fetch"); return { status: mode, json: { m: "boom" } }; });
  for (let i = 0; i < 3; i++) await e.run("flush()"); assert.equal(e.store.outbox[0].n, 3); mode = "offline"; for (let i = 0; i < 4; i++) await e.run("flush()"); assert.equal(e.store.outbox[0].n, 3, "being offline is not counted"); mode = 500;
  for (let i = 0; i < 6; i++) assert.equal((await e.run("flush()")).ok, false); assert.equal(e.store.outbox[0].n, 9); const r = await e.run("flush()"); assert.equal(e.store.outbox.length, 0, "poison op dropped on the 10th failure"); assert.equal(r.dropped, 1);
  const c = x => e.run(`isClientErr(Object.assign(new Error("x"), { status: ${x} }))`); for (const [st, want] of [[400, true], [413, true], [422, true], [401, false], [404, false], [408, false], [429, false], [500, false], [503, false]]) assert.equal(await c(st), want, "status " + st);
});
test("coalesce: when full, old observations go first and a pending delete is never the one evicted", () => { const e = makeEnv();
  const ob = [{ t: "watch", key: "gone", deleted: true, u: 1, id: "d" }, ...Array.from({ length: 499 }, (_, i) => ({ t: "obs", key: "k" + i, price: i + 1, at: "2026-10-17", id: "o" + i }))];
  const out = e.run(`coalesce(${JSON.stringify(ob)}, {t:"obs",key:"new",price:7,at:"2026-10-18",id:"n"})`); assert.equal(out.length, 500); assert.ok(out.some(o => o.id === "d"), "the delete survives"); assert.ok(!out.some(o => o.id === "o0"), "the oldest observation went"); assert.ok(out.some(o => o.id === "n")); });
test("toWatchRow sends the edit time faithfully (never 'now' at upload) and survives a missing one", () => { const e = makeEnv();
  assert.equal(e.run('toWatchRow("U", {key:"k",u:1000,wish:true}).updated_at'), new Date(1000).toISOString()); assert.equal(e.run('toWatchRow("U", {key:"k",u:1000,deleted:true}).deleted_at'), new Date(1000).toISOString());
  assert.ok(!Number.isNaN(Date.parse(e.run('toWatchRow("U", {key:"k",wish:true}).updated_at')))); });
test("mergeWatchRow: a target that arrives from another device does not alert at once (armed only while the price is above it); a heart gets a default-alert price", () => { const e = makeEnv();
  const m = e.run(`mergeWatchRow({ hist: [[1, 900]], u: 1 }, { updated_at: "2026-10-17T00:00:00Z", wish: true, target_price: 1000 })`); assert.equal(m.armed, false); assert.equal(m.notified, null); assert.equal(m.target, 1000); assert.equal(m.wishPrice, 900);
  const m2 = e.run(`mergeWatchRow({ hist: [[1, 1200]], u: 1 }, { updated_at: "2026-10-17T00:00:00Z", wish: false, target_price: 1000 })`); assert.equal(m2.armed, true);
  const m3 = e.run(`mergeWatchRow({ hist: [[1, 900]], u: 1, target: 1000, armed: true, notified: 880 }, { updated_at: "2026-10-17T00:00:00Z", target_price: 1000, title: "t" })`); assert.equal(m3.armed, true); assert.equal(m3.notified, 880, "same target: local alert state is kept");
  const m4 = e.run(`mergeWatchRow(undefined, { updated_at: "2026-10-17T00:00:00Z", wish: true, last_price: 500 })`); assert.equal(m4.wishPrice, 500); assert.equal(e.run(`mergeWatchRow({ hist: [[1, 5]], wish: true, wishPrice: 5, u: 1 }, { updated_at: "2026-10-17T00:00:00Z", deleted_at: "2026-10-17T00:00:00Z" })`).wishPrice, undefined); });
test("S2 claimOwner: restoring an account's vault over anonymous browsing keeps its history and flags; anonymous-only products are added; usage stays the account's", async () => {
  const e = makeEnv(), D = 864e5, h30 = Array.from({ length: 30 }, (_, i) => [1e12 + i * D, 100 + i]);
  Object.assign(e.store, { "vault:u1": { at: Date.now(), data: { items: { x: { site: "Amazon", hist: h30, wish: true, target: 800, ref: { low: 1 }, seenAt: 5 } }, usage: { month: "2026-10", keys: Array.from({ length: 49 }, (_, i) => "k" + i) }, lastPull: "2026-10-01T00:00:00Z" } },
    items: { x: { site: "Amazon", title: "fresh title", hist: [[1e12 + 40 * D, 90]], seenAt: 99 }, y: { site: "Amazon", hist: [[1, 1]] } }, usage: { month: "2026-10", keys: ["x"] } });
  assert.equal(await e.run('claimOwner("u1")'), "adopted"); const x = e.store.items.x;
  assert.equal(x.hist.length, 31, "30 saved points + the new one"); assert.equal(x.hist[0][1], 100); assert.equal(x.hist.at(-1)[1], 90); assert.equal(x.wish, true); assert.equal(x.target, 800); assert.deepEqual(x.ref, { low: 1 }); assert.equal(x.seenAt, 99);
  assert.ok(e.store.items.y, "anonymous-only product joins"); assert.equal(e.store.usage.keys.length, 49, "the account's lookups count, not the anonymous one"); assert.equal(e.store.lastPull, "2026-10-01T00:00:00Z"); assert.equal(e.store["vault:u1"], undefined);
});
test("S2 vault is written BEFORE the live copy goes: a failing vault write loses nothing", async () => {
  const e = makeEnv(); signedIn(e, { items: { a: W("A") }, outbox: [{ t: "watch", id: "w1", key: "a", u: 1 }] }); const set = e.chrome.storage.local.set; e.chrome.storage.local.set = async o => { if (Object.keys(o).some(k => k.startsWith("vault:"))) throw new Error("QUOTA_BYTES quota exceeded"); return set(o); };
  await assert.rejects(() => e.run("releaseOwner()"), /quota/i); assert.ok(e.store.items.a, "items still live"); assert.equal(e.store.outbox.length, 1, "unsent changes still queued"); assert.equal(e.store.localOwner, "u1");
});

// ---------- storage-boundary hardening (server text / hostile JSON) ----------
const HOSTILE_ROW = { product_key: "x1", site: "Fli‮pkart\u0000", title: "T​‮itle <img src=x onerror=1>\n\n" + "z".repeat(900), url: "javascript:alert(1)", image: "data:text/html,<b>", last_price: "Infinity", target_price: "NaN", wish: "yes", updated_at: "2026-10-17T05:00:00Z" };
test("mergeWatchRow: server text is normalised (bidi/control stripped, capped), links must be https, junk prices ignored", () => { const e = makeEnv();
  const it = e.run(`mergeWatchRow(null, ${JSON.stringify(HOSTILE_ROW)})`); assert.ok(!/[\u0000-\u001f​-‏‪-‮]/.test(it.site + it.title), "control/bidi gone"); assert.equal(it.site, "Fli pkart"); assert.ok(it.title.length <= 500); assert.equal(it.url, undefined, "javascript: url dropped"); assert.equal(it.image, undefined, "data: image dropped");
  assert.ok(!(it.last > 0), "Infinity last price ignored"); assert.ok(!("target" in it), "NaN target ignored"); assert.equal(e.run('mergeWatchRow(null, null)'), null); assert.equal(e.run('mergeWatchRow(null, "x")'), null);
  const ok = e.run('mergeWatchRow(null, { product_key: "k", url: "HTTPS://Shop.Example/p?a=1", image: "https://u:p@evil.example/i.png", updated_at: "2026-10-17T05:00:00Z", target_price: 99 })'); assert.equal(ok.url, "https://shop.example/p?a=1"); assert.equal(ok.image, undefined, "credentials in an image url are refused"); assert.equal(ok.target, 99); });
test("pull: a hostile server row cannot reach Object.prototype, poison the cursor, or store junk (prototype pollution)", async () => {
  const e = makeEnv(); signedIn(e, { items: {} });
  e.route(/ext_profiles/, () => ({ status: 200, json: [] }));
  e.route(/ext_watchlist\?select/, () => ({ status: 200, json: [{ ...HOSTILE_ROW, product_key: "__proto__", title: "POLLUTED" }, { ...HOSTILE_ROW, product_key: "constructor" }, { ...HOSTILE_ROW, product_key: "toString" }, { ...HOSTILE_ROW, product_key: "prototype" }, null, "str", 5, { ...HOSTILE_ROW, product_key: "good", updated_at: "2026-10-17T07:00:00Z" }, { ...HOSTILE_ROW, product_key: "bad-ts", updated_at: "zzzz-not-a-date" }] }));
  const r = await e.run("pull()"); assert.equal(r.ok, true); assert.equal(({}).title, undefined, "Object.prototype.title polluted"); assert.equal(e.run("({}).title"), undefined); assert.equal(e.run("({}).wish"), undefined);
  assert.deepEqual(Object.keys(e.store.items).sort(), ["bad-ts", "good"], "only safe keys are stored"); assert.equal(e.store.lastPull, "2026-10-17T07:00:00Z", "a garbage updated_at never becomes the cursor"); });
test("pull: server profile is reduced to known fields; the phone follows the +91 rule; an unknown plan is the free tier", async () => {
  const e = makeEnv(); signedIn(e);
  e.route(/ext_profiles/, () => ({ status: 200, json: [{ plan: "__proto__", contribute: "yes", name: "A‮B\u0000\n" + "n".repeat(200), phone: "9876543210", avatar_url: "javascript:alert(1)", email_alerts: 1, evil: "x", __proto__x: 1 }] })); e.route(/ext_watchlist\?select/, () => ({ status: 200, json: [] }));
  await e.run("pull()"); const p = e.store.profile; assert.equal(e.store.plan, "free"); assert.equal(p.plan, "free"); assert.equal(p.contribute, false); assert.equal(p.phone, null, "a phone without +91 is dropped"); assert.equal(p.avatar_url, null); assert.equal(p.email_alerts, false); assert.ok(p.name.length <= 80 && !/[\u0000\n‮]/.test(p.name)); assert.ok(!("evil" in p));
  e.route(/ext_profiles/, () => ({ status: 200, json: [{ plan: "pro", phone: "+919876543210", name: "Ann", contribute: true, email_alerts: true, avatar_url: "https://lh3.example/a.png" }] })); await e.run("pull()"); assert.equal(e.store.profile.phone, "+919876543210"); assert.equal(e.store.plan, "pro"); });
test("fetchCommunity / fetchChart: rows are validated, bounded and reduced; a non-array answer is an empty history", async () => {
  const e = makeEnv(); signedIn(e);
  e.route(/rpc\/ext_price_history/, () => ({ status: 200, json: [{ day: "2026-10-01", median_price: "5", evil: "<b>" }, { day: "2026-10-02", median_price: "Infinity" }, { day: "<script>", median_price: 5 }, null, "x", { day: "2026-10-03", median_price: 1e12 }, ...Array.from({ length: 3000 }, (_, i) => ({ day: "2026-01-01", median_price: i + 1 }))] }));
  const rows = await e.run('fetchCommunity("k1")'); assert.ok(rows.length <= 1500 && rows.every(r => Object.keys(r).join() === "day,median_price" && isFinite(r.median_price) && r.median_price < 1e7)); assert.ok(!rows.some(r => r.day === "<script>"));
  e.route(/rpc\/ext_price_history/, () => ({ status: 200, json: { not: "an array" } })); assert.deepEqual(await e.run('fetchCommunity("k2")'), []); assert.deepEqual(await e.run('fetchCommunity("__proto__")'), [], "a dictionary-poisoning key is refused");
  e.route(/rpc\/ext_get_chart/, () => ({ status: 200, json: [{ day: "2026-10-01", price: "Infinity", reporters: 3 }, { day: "2026-10-02", price: 100, reporters: 1e99 }] })); const ch = await e.run('fetchChart("k3")'); assert.equal(ch.length, 1); assert.equal(ch[0].reporters, 1e6); });
test("claimOwner: a tampered vault only restores content keys, normalised (no session/plan/flags, no __proto__ products)", async () => {
  const e = makeEnv(); e.store.localOwner = "u0"; e.store["vault:u1"] = { at: Date.now(), data: JSON.parse('{"items":{"__proto__":{"hist":[],"title":"POLLUTED"},"ok":{"hist":[],"title":"T\\u202e","url":"javascript:1"}},"session":{"access_token":"stolen"},"plan":"max","flags":{"x":1},"outbox":[{"t":"obs","key":"k","price":"NaN","at":1},{"t":"watch","key":"w"}],"pin":"560001"}') };
  await e.run('claimOwner("u1")'); assert.equal(e.store.session, undefined); assert.equal(e.store.plan, undefined); assert.equal(e.store.flags, undefined); assert.equal(e.run("({}).title"), undefined);
  assert.deepEqual(Object.keys(e.store.items), ["ok"]); assert.equal(e.store.items.ok.title, "T"); assert.equal(e.store.items.ok.url, undefined); assert.deepEqual(e.store.outbox.map(o => o.t), ["watch"], "the poisoned obs op is dropped"); assert.equal(e.store.pin, "560001"); });
test("outbound rows: toWatchRow / toObsRow send only normalised text, https links and bounded numbers", () => { const e = makeEnv();
  const w = e.run(`toWatchRow("u1", ${JSON.stringify({ key: "k", site: "S‮", title: "T\u0000" + "x".repeat(900), url: "javascript:1", image: "http://i/x.png", target: "NaN", last: 1e99, wish: 1, u: 5 })})`); assert.equal(w.site, "S"); assert.ok(w.title.length <= 500 && !w.title.includes("\u0000")); assert.equal(w.url, null); assert.equal(w.image, null); assert.equal(w.target_price, null); assert.equal(w.last_price, null);
  const o = e.run(`toObsRow(${JSON.stringify({ key: "k", site: "S​", price: 5, mrp: -3, at: 1, src: "<x>" })})`); assert.equal(o.site, "S"); assert.equal(o.mrp, null); assert.equal(o.src, "dom"); });
test("an outbox op that would throw on upload (bad time/price) is dropped on read, so it can never block the queue", () => { const e = makeEnv();
  assert.equal(e.run('safeOutbox([{ t: "obs", key: "k", price: 5, at: NaN }, { t: "obs", key: "k", price: "x", at: 1 }, { t: "obs", key: "k", price: 5, at: 1 }]).length'), 1); });
test("settings from the server: a place list is rebuilt (extra keys and oversize fields never reach storage)", () => { const e = makeEnv();
  const r = e.run(`settingsFromServer({}, { doc: { places: [{ id: "a1", name: "Home\\u202e", pin: "560001", junk: "J".repeat(100000), __proto__x: 1 }] }, stamps: { places: 5 } })`); assert.deepEqual(JSON.parse(JSON.stringify(r.values.places)), [{ id: "a1", name: "Home", pin: "560001" }]); });
test("planOf lists exactly the tiers of LIMITS; useLookup survives an unknown tier", () => { const A = require("../../extension/analysis.js"), e = makeEnv(); assert.deepEqual(["free", "pro", "max"], Object.keys(A.LIMITS || { free: 1, pro: 1, max: 1 })); for (const p of ["__proto__", "constructor", "", null, 5, "FREE"]) { assert.equal(e.run(`planOf(${JSON.stringify(p)})`), "free"); assert.equal(A.useLookup(null, "k", p).limit, 50); } });

(async () => { for (const [name, fn] of queue) { try { await fn(); passed++; console.log("  ok   " + name); } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e && e.message || e).split("\n")[0]); } } console.log(`\nunit: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); })();
