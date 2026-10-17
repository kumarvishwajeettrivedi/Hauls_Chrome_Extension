// One headless run: loads the extension, opens the settings page, checks the SW booted cleanly (no errors) and that t2-status answers; screenshots the page.
import { withExt, sleep } from "./lib/ext.mjs";
await withExt({ viewport: { width: 760, height: 900 } }, async ({ ctx, sw, errs, extId }) => {
  const p = await ctx.newPage(); await p.goto(`chrome-extension://${extId}/options.html`); await sleep(1200);
  console.log("stores rows:", await p.locator(".srow").count(), "| status from SW:", JSON.stringify(await sw.evaluate(() => T2.status())), "| T2 stores:", await sw.evaluate(() => Object.keys(T2.STORES).join(",")));
  console.log("errors:", errs.length ? errs.join(" || ") : "none");
  await p.screenshot({ path: process.argv[2] || "/tmp/options.png", fullPage: true });
});
