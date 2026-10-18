// Supabase Auth for the extension: Google sign-in via PKCE + chrome.identity, token storage and refresh. No SDK, no secrets.
// Pure helpers are exported for unit tests; everything touching chrome.* is guarded.
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomVerifier = (n = 64) => b64url(crypto.getRandomValues(new Uint8Array(n))).slice(0, 96);
async function challengeOf(verifier) { return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))); }
function parseRedirect(url) { // supports ?code=... and #error=... forms
  const u = new URL(url), q = new URLSearchParams(u.search), h = new URLSearchParams(u.hash.replace(/^#/, ""));
  return { code: q.get("code") || h.get("code"), error: q.get("error_description") || q.get("error") || h.get("error_description") || h.get("error") };
}
const sessionFrom = (r, now = Date.now()) => ({ access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at ? r.expires_at * 1000 : now + (r.expires_in || 3600) * 1000,
  user: r.user && { id: r.user.id, email: r.user.email, name: cleanText((r.user.user_metadata || {}).full_name || (r.user.user_metadata || {}).name, 80), avatar: cleanUrl((r.user.user_metadata || {}).avatar_url || (r.user.user_metadata || {}).picture) || "" } }); // provider-supplied text is untrusted too: plain, bounded, https-only
const needsRefresh = (s, now = Date.now(), leeway = 60e3) => !s || !s.access_token || s.expires_at - now < leeway;
// ---- S1 session policy: stay signed in while used; sign out softly after 90 days of NO use ----
const INACTIVITY_MS = 90 * 864e5, TOUCH_EVERY = 864e5, REFRESH_AHEAD = 20 * 60e3;
const inactive = (s, now = Date.now()) => !!s && now - (s.lastActiveAt || s.signedInAt || now) > INACTIVITY_MS;
// Only a rejected refresh token ends a session. Offline, timeouts, 429 and 5xx are transient: keep the session and retry later.
const isInvalidGrant = e => [400, 401, 403].includes(e && e.status) && /invalid[_ ]grant|refresh[_ ]token[_ ]not[_ ]found|refresh[_ ]token[_ ]already[_ ]used|session[_ ]not[_ ]found|session[_ ]expired|invalid refresh|already used|not found|revoked/i.test(`${e.code || ""} ${e.message || ""}`);
// One writer at a time for the stored session, so "I was active" can never overwrite a freshly rotated token (that would force a sign-out).
const sessionLock = (() => { let c = Promise.resolve(); return fn => { const r = c.then(fn, fn); c = r.then(() => {}, () => {}); return r; }; })();
const USER_SCOPED_KEYS = ["histCache", "lastPull", "profile", "plan", "outbox", "lastSync", "setStamps"];
const PERSONAL_KEYS = ["places", "pin", "range", "loc", "lastPin"]; // personal settings: removed by "sign out and clear this device" (a shared computer must not keep someone's saved places)
// The session lives in the extension's OWN IndexedDB (origin chrome-extension://...), which content scripts and web pages cannot read.
// Where IndexedDB doesn't exist (unit tests) it falls back to chrome.storage.local.
const sessionStore = (() => {
  if (typeof indexedDB === "undefined") return { get: async () => (await chrome.storage.local.get("session")).session, set: v => chrome.storage.local.set({ session: v }), del: () => chrome.storage.local.remove("session") };
  const open = () => new Promise((res, rej) => { const r = indexedDB.open("hauls-auth", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("kv", mode), req = fn(t.objectStore("kv")); t.oncomplete = () => { db.close(); res(req && req.result); }; t.onerror = () => { db.close(); rej(t.error); }; }); };
  return { get: () => tx("readonly", s => s.get("session")), set: v => tx("readwrite", s => s.put(v, "session")), del: () => tx("readwrite", s => s.delete("session")) };
})();
const configured = () => typeof HAULS_CONFIG !== "undefined" && !!HAULS_CONFIG.SUPABASE_URL && !!HAULS_CONFIG.SUPABASE_ANON_KEY;

const withTimeout = (ms = 10000) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
async function authFetch(path, body) {
  const r = await fetch(HAULS_CONFIG.SUPABASE_URL + "/auth/v1" + path, { method: "POST", signal: withTimeout(), headers: { "content-type": "application/json", apikey: HAULS_CONFIG.SUPABASE_ANON_KEY }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error_description || j.msg || j.message || "Auth error " + r.status); e.status = r.status; e.code = j.error_code || j.error || j.code || ""; throw e; } return j;
}

const hexSha256 = async v => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map(b => b.toString(16).padStart(2, "0")).join("");
async function storeSignIn(resp) {
  const now = Date.now(), s = { ...sessionFrom(resp), signedInAt: now, lastActiveAt: now };
  await sessionLock(() => sessionStore.set(s)); await chrome.storage.local.remove("authNotice"); return s;
}
// Preferred path: the extension talks to Google itself (so the consent screen shows OUR app, not the supabase.co address) and hands Supabase the signed ID token.
// Google gets sha256(nonce); Supabase gets the raw nonce and checks they match, so a stolen token can't be replayed.
async function signInDirect(clientId) {
  const nonce = randomVerifier(32), redirect = chrome.identity.getRedirectURL();
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ client_id: clientId, response_type: "id_token", scope: "openid email profile", redirect_uri: redirect, nonce: await hexSha256(nonce), prompt: "select_account" });
  const back = await chrome.identity.launchWebAuthFlow({ url, interactive: true }), h = new URLSearchParams(new URL(back || redirect).hash.replace(/^#/, ""));
  if (h.get("error")) throw new Error(h.get("error_description") || h.get("error")); if (!h.get("id_token")) throw new Error("Sign-in was cancelled.");
  return storeSignIn(await authFetch("/token?grant_type=id_token", { provider: "google", id_token: h.get("id_token"), nonce }));
}
async function signInWithGoogle() {
  if (!configured()) throw new Error("Sign-in isn't configured yet (missing anon key).");
  if (HAULS_CONFIG.GOOGLE_CLIENT_ID) return signInDirect(HAULS_CONFIG.GOOGLE_CLIENT_ID);
  const verifier = randomVerifier(), redirect = chrome.identity.getRedirectURL(); // fallback: Supabase-hosted OAuth (PKCE)
  const url = `${HAULS_CONFIG.SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge=${await challengeOf(verifier)}&code_challenge_method=s256&flow_type=pkce`;
  const back = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const { code, error } = parseRedirect(back || ""); if (error) throw new Error(error); if (!code) throw new Error("Sign-in was cancelled.");
  return storeSignIn(await authFetch("/token?grant_type=pkce", { auth_code: code, code_verifier: verifier }));
}

let refreshing = null;
// Ends the session: used for revoked tokens and inactivity. The account's data is put away (not deleted), and the UI shows a "sign in again" notice.
async function softSignOut(reason) { const old = await sessionStore.get(); await sessionLock(() => sessionStore.del()); if (typeof releaseOwner === "function") await releaseOwner(old && old.user && old.user.id); /* their watchlist waits in a vault until they sign in again; the next person at this browser does not see it */ await chrome.storage.local.remove(USER_SCOPED_KEYS); await chrome.storage.local.set({ authNotice: reason }); }
async function getSession(leeway = 60e3) {
  const session = await sessionStore.get(); if (!session) return null;
  if (inactive(session)) { await softSignOut("inactive"); return null; }
  if (!needsRefresh(session, Date.now(), leeway)) return session;
  if (!refreshing) refreshing = (async () => {
    try {
      const fresh = sessionFrom(await authFetch("/token?grant_type=refresh_token", { refresh_token: session.refresh_token }));
      return await sessionLock(async () => { const cur = await sessionStore.get(); if (!cur || cur.refresh_token !== session.refresh_token) return cur || null; /* signed out or replaced while the request was in flight: never bring the old session back */ const s = { ...fresh, user: fresh.user || session.user, signedInAt: cur.signedInAt || session.signedInAt, lastActiveAt: cur.lastActiveAt || session.lastActiveAt }; await sessionStore.set(s); return s; });
    } catch (e) {
      if (isInvalidGrant(e)) { const cur = await sessionStore.get(); if (!cur || cur.refresh_token !== session.refresh_token) return cur || null; /* already signed out / replaced: not ours to end */ await softSignOut("revoked"); return null; }
      return needsRefresh(session, Date.now(), 0) ? null : session; // transient: keep the session; a still-valid token keeps working
    } finally { refreshing = null; }
  })();
  return refreshing;
}
// Call on real user activity only (never from background alarms), at most once a day.
async function touchActive(now = Date.now()) { return sessionLock(async () => { const s = await sessionStore.get(); if (!s || now - (s.lastActiveAt || 0) < TOUCH_EVERY) return false; await sessionStore.set({ ...s, lastActiveAt: now }); return true; }); }
async function signOut({ clear = false } = {}) {
  const session = await sessionStore.get();
  try { if (session && typeof flush === "function") await Promise.race([flush(), new Promise(r => setTimeout(r, 4000))]); } catch {} // send anything still waiting to this account before leaving it; a flush that outlives the timeout is tied to this account (flush0 checks the owner and fixes the vault when it finishes)
  if (session && configured()) fetch(HAULS_CONFIG.SUPABASE_URL + "/auth/v1/logout?scope=local", { method: "POST", headers: { apikey: HAULS_CONFIG.SUPABASE_ANON_KEY, authorization: "Bearer " + session.access_token } }).catch(() => {});
  await sessionLock(() => sessionStore.del());
  // The next person on this browser must see none of this account's data: it goes to a vault (restored only when THIS account signs in again). "Sign out and clear this device" also deletes the vaults.
  if (typeof releaseOwner === "function") await releaseOwner(session && session.user && session.user.id);
  if (clear && typeof clearVaults === "function") await clearVaults();
  await chrome.storage.local.remove([...USER_SCOPED_KEYS, "authNotice", ...(clear ? ["items", "usage", "localOwner", "waitlist", ...PERSONAL_KEYS] : [])]);
}
// Authenticated PostgREST / RPC call. Retries once after a refresh on 401. `uid` pins the call to the account a flush/pull started under: if the session changed meanwhile, nothing is sent.
async function api(path, { method = "GET", body, headers = {}, uid } = {}, retried = false) {
  const s = await getSession(); if (!s) throw new Error("not-signed-in");
  if (uid && (!s.user || s.user.id !== uid)) throw new Error("session-changed");
  const r = await fetch(HAULS_CONFIG.SUPABASE_URL + "/rest/v1" + path, { method, signal: withTimeout(), headers: { apikey: HAULS_CONFIG.SUPABASE_ANON_KEY, authorization: "Bearer " + s.access_token, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 && !retried) { await sessionLock(async () => { const cur = await sessionStore.get(); if (cur && cur.refresh_token === s.refresh_token) await sessionStore.set({ ...cur, expires_at: 0 }); }); return api(path, { method, body, headers, uid }, true); } // only the same session is marked expired; a signed-out or replaced one stays as it is
  if (!r.ok) { const e = new Error((await r.text().catch(() => "")).slice(0, 200) || "HTTP " + r.status); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json().catch(() => null);
}
if (typeof module !== "undefined") module.exports = { sessionStore, INACTIVITY_MS, inactive, isInvalidGrant, touchActive, softSignOut, b64url, randomVerifier, challengeOf, parseRedirect, sessionFrom, needsRefresh };
