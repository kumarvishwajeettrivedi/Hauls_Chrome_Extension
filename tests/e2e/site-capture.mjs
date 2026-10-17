// Real screenshots for the website: ONE visible Chrome window, the real extension on real Amazon.in, then Grocery mode in the same tab. Sequential, self-closing. Run: node tests/e2e/site-capture.mjs
import { chromium } from "playwright-core";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import path from "node:path";
import { EXT, CHROME, sleep, poll } from "./lib/ext.mjs"; import { Panel } from "./lib/panel.mjs";
const OUT = "/tmp/site-raw/", D = 864e5, dir = mkdtempSync(path.join(tmpdir(), "hauls-capture-"));
const ctx = await chromium.launchPersistentContext(path.join(dir, "profile"), { headless: false, executablePath: CHROME, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "en-IN",
  ignoreDefaultArgs: ["--enable-automation"], args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"] });
const kill = setTimeout(() => ctx.close().catch(() => {}), 9 * 60e3); const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  await sw.evaluate(() => chrome.storage.local.set({ pin: "842001", loc: { lat: 26.1197, lon: 85.391, pin: "842001" } }));
  const p = ctx.pages()[0] || await ctx.newPage(); await p.bringToFront();
  await p.goto("https://www.amazon.in/s?k=boat+airdopes+141", { waitUntil: "domcontentloaded", timeout: 45000 }); await sleep(2500);
  log("search page:", (await p.title()).slice(0, 70)); if (/robot|captcha|sorry/i.test(await p.title()) || /captcha/i.test(p.url())) { log("BLOCKED by a robot check"); await p.screenshot({ path: OUT + "blocked.png" }); throw new Error("amazon robot check"); }
  await p.waitForSelector('[data-component-type="s-search-result"]', { timeout: 20000 }).catch(() => {}); await sleep(1500);
  const info = await p.evaluate(() => { const rs = [...document.querySelectorAll('[data-component-type="s-search-result"]')]; const links = rs.flatMap(r => [...r.querySelectorAll('a[href*="/dp/"]')].map(a => a.href)); return { results: rs.length, links: links.length, first: links.find(h => !/\/sspa\//.test(h) && !/\/slredirect\//.test(h)) || links[0] || null }; });
  log("results:", info.results, "| product links:", info.links); const href = info.first;
  log("first result:", (href || "none").slice(0, 90)); if (!href) throw new Error("no result link"); await p.goto(href, { waitUntil: "domcontentloaded", timeout: 45000 }); await p.waitForSelector("span#productTitle", { timeout: 20000 }); await sleep(2500);
  let panel = await Panel.attach(ctx, p); await panel.waitKnob(25000); log("product:", (await p.locator("span#productTitle").first().innerText()).trim().slice(0, 70));
  // wait until the extension recorded this product, then give it a realistic history ending at the REAL current price
  const key = await poll(async () => sw.evaluate(async () => { const { items = {} } = await chrome.storage.local.get("items"); return Object.keys(items).find(k => k.startsWith("amazon.in:")) || null; }), 20000, 500); log("recorded key:", key);
  const cur = await sw.evaluate(async k => { const { items } = await chrome.storage.local.get("items"), it = items[k], p = it.hist.length ? it.hist[it.hist.length - 1][1] : it.last; const now = Date.now(), D = 864e5; const f = [[-86, 1.24], [-71, 1.19], [-58, 1.27], [-44, 1.08], [-33, 0.99], [-21, 1.07], [-9, 1.02], [-1, 1]]; it.hist = f.map(([d, m]) => [now + d * D, Math.round(p * m)]); await chrome.storage.local.set({ items }); return p; }, key); log("current real price:", cur);
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForSelector("span#productTitle", { timeout: 20000 }); await sleep(2500); panel = await Panel.attach(ctx, p); await panel.waitKnob(25000); await panel.open(); await sleep(2500);
  await p.screenshot({ path: OUT + "amazon-product.png" }); log("saved amazon-product.png");
  const r = await panel.rect(".panel"); await p.screenshot({ path: OUT + "panel-product.png", clip: { x: r.x, y: 0, width: r.w, height: 900 } }); log("saved panel-product.png");
  // Grocery mode in the SAME Amazon tab
  await panel.tab(1); await sleep(700); await panel.type("main .pi input", "amul butter", { i: 1 }); await p.keyboard.press("Enter");
  await poll(async () => (await panel.count("main .card")) > 0 || /No matches/.test(await panel.text("main").catch(() => "")), 40000, 500); await sleep(2500);
  log("grocery cards:", await panel.count("main .card"), "| text:", (await panel.text("main")).replace(/\s+/g, " ").slice(0, 160));
  await p.screenshot({ path: OUT + "amazon-grocery.png" }); await p.screenshot({ path: OUT + "panel-grocery.png", clip: { x: r.x, y: 0, width: r.w, height: 900 } }); log("saved grocery shots");
  // the full-page home (grocery) in its own tab
  const extId = new URL(sw.url()).hostname, h = await ctx.newPage(); await h.goto(`chrome-extension://${extId}/home.html`); const hp = await Panel.attach(ctx, h); await hp.waitFor(".w.app", 10000); await sleep(800);
  await hp.type("main .pi input", "amul butter", { i: 1 }); await h.keyboard.press("Enter"); await poll(async () => (await hp.count("main .card")) > 0, 40000, 500); await sleep(2500); await h.screenshot({ path: OUT + "home-grocery.png" }); log("saved home-grocery.png");
  await hp.click(".tabs button", 1).catch(() => {}); await sleep(1200); await h.screenshot({ path: OUT + "home-watchlist.png" }); log("saved home-watchlist.png");
} catch (e) { log("ERROR:", e.message); } finally { clearTimeout(kill); await ctx.close().catch(() => {}); rmSync(dir, { recursive: true, force: true }); log("closed and cleaned"); }
