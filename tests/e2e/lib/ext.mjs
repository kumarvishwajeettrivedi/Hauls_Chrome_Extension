// Launch Chrome-for-Testing with the extension in a fresh temp profile; collect extension errors + network requests.
import { chromium } from "playwright-core";
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireLock, headlessArgs } from "./guard.mjs";
acquireLock(); // one run at a time; released automatically on exit

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const EXT = path.join(ROOT, "extension");
export const CHROME = process.env.CHROME || path.join(homedir(), "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function poll(fn, timeout = 10000, every = 250) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = null; } await sleep(every); }
  return last || null;
}

// Runs fn({ctx, sw, errs, reqs}) in a throwaway profile, always cleaning up.
export async function withExt(opts, fn) {
  const { viewport = { width: 1280, height: 900 }, colorScheme, geolocation, anonKey, keepWelcome } = opts || {};
  const dir = mkdtempSync(path.join(tmpdir(), "hauls-e2e-"));
  // anonKey: run a temp COPY of extension/ whose config.js carries a dummy anon key (the repo ships it empty). The real source is never touched.
  let extDir = EXT;
  if (anonKey !== undefined) { extDir = path.join(dir, "ext-copy"); cpSync(EXT, extDir, { recursive: true }); const f = path.join(extDir, "config.js"); writeFileSync(f, readFileSync(f, "utf8").replace(/("SUPABASE_ANON_KEY":\s*)"[^"]*"/, `$1"${anonKey}"`)); }
  const ctx = await chromium.launchPersistentContext(path.join(dir, "profile"), { headless: false, executablePath: CHROME, viewport, colorScheme,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--no-first-run", "--no-default-browser-check", ...headlessArgs(), ...(process.env.HAULS_ARGS || "").split(" ").filter(Boolean)] });
  const errs = [], reqs = [];
  try {
    if (geolocation) { await ctx.grantPermissions(["geolocation"]); await ctx.setGeolocation(geolocation); }
    ctx.on("request", r => { let sw = false; try { sw = !!r.serviceWorker(); } catch {} reqs.push({ url: r.url(), sw, page: (() => { try { return r.frame()?.url() || ""; } catch { return ""; } })() }); });
    const hook = p => { p.on("console", m => { if (m.type() === "error" && (m.location().url || "").startsWith("chrome-extension://")) errs.push(`[page] ${m.text().slice(0, 200)}`); }); };
    ctx.pages().forEach(hook); ctx.on("page", hook);
    // a fresh install opens the Settings welcome tab (that is the product behaviour); tests close it so page counts stay predictable, except the test that checks it
    if (!keepWelcome) { const closeWelcome = p => p.on("framenavigated", f => { if (f === p.mainFrame() && /options\.html\?welcome=1/.test(f.url())) p.close().catch(() => {}); }); ctx.pages().forEach(closeWelcome); ctx.on("page", closeWelcome); }
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: 15000 });
    sw.on("console", m => { if (m.type() === "error") errs.push(`[sw] ${m.text().slice(0, 200)}`); });
    ctx.on("serviceworker", w => w.on("console", m => { if (m.type() === "error") errs.push(`[sw] ${m.text().slice(0, 200)}`); }));
    return await fn({ ctx, sw, errs, reqs, extId: new URL(sw.url()).hostname });
  } finally { await ctx.close().catch(() => {}); try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

export const seed = (sw, data) => sw.evaluate(d => chrome.storage.local.set(d), data);
export const store = (sw, keys) => sw.evaluate(k => chrome.storage.local.get(k), keys);
// The auth session lives in the service worker's IndexedDB (sessionStore in auth.js), not chrome.storage.
export const seedSession = (sw, s) => sw.evaluate(v => sessionStore.set(v), s);
export const sessionOf = sw => sw.evaluate(() => sessionStore.get());
