// ONE visible Chrome for a human to try Google sign-in. Single launch, lock-guarded, ends when the window is closed (or after 15 min), temp profile removed.
import { chromium } from "playwright-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireLock } from "./lib/guard.mjs";
import { EXT, CHROME } from "./lib/ext.mjs";
const keep = !!process.env.HAULS_PROFILE, dir = keep ? process.env.HAULS_PROFILE : mkdtempSync(path.join(tmpdir(), "hauls-manual-")); // HAULS_PROFILE = reuse (and keep) one test profile so logins/connections survive a relaunch
if (keep) for (const d of ["Service Worker", "Code Cache", "Extension Scripts"]) rmSync(path.join(dir, "Default", d), { recursive: true, force: true }); // never let a cached old service worker outlive a code change (it ran stale code for us once)
const ctx = await chromium.launchPersistentContext(path.join(dir, "profile"), { headless: false, executablePath: CHROME, viewport: null,
  ignoreDefaultArgs: ["--enable-automation"], args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"] });
const done = new Promise(r => ctx.on("close", r)); const t = setTimeout(() => ctx.close().catch(() => {}), 14 * 60e3);
const p = ctx.pages()[0] || await ctx.newPage(); await p.goto(process.env.HAULS_START || "https://www.amazon.in/", { waitUntil: "domcontentloaded" }).catch(() => {});
console.log("OPEN: test Chrome is up. Close the window when finished."); await done; clearTimeout(t); if (!keep) rmSync(dir, { recursive: true, force: true }); console.log(keep ? "CLOSED (profile kept at " + dir + ")" : "CLOSED and cleaned");
