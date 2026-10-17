// Safety rails so test runs can NEVER pile up browsers again: one run at a time (lock), invisible by default, always killed on exit, hard time limit.
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const LOCK = path.join(tmpdir(), "hauls-test.lock"), MAX_MS = 15 * 60e3;
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
export function acquireLock() {
  try { mkdirSync(LOCK); } catch {
    let pid = 0; try { pid = +readFileSync(path.join(LOCK, "pid"), "utf8"); } catch {}
    if (pid && alive(pid) && pid !== process.pid) { console.error(`Another test run (pid ${pid}) is active. Refusing to start a second one. Run: npm run test:stop`); process.exit(2); }
    rmSync(LOCK, { recursive: true, force: true }); mkdirSync(LOCK); // stale lock from a crashed run
  }
  writeFileSync(path.join(LOCK, "pid"), String(process.pid));
  const release = () => rmSync(LOCK, { recursive: true, force: true });
  process.on("exit", release);
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => { release(); process.exit(130); });
  setTimeout(() => { console.error("Test run exceeded its time limit; aborting."); release(); process.exit(124); }, MAX_MS).unref();
}
// Headless unless HAULS_SHOW=1. "--headless=new" is the mode that still loads extensions.
export const headlessArgs = () => (process.env.HAULS_SHOW === "1" ? [] : ["--headless=new"]);
