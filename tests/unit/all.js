// Runs every unit test file: tests/unit/run.js + tests/unit/*.test.js, each in its own process. Exit code 1 if any fails.
const { spawnSync } = require("child_process"), fs = require("fs"), path = require("path");
const files = ["run.js", ...fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).sort()]; let bad = 0;
for (const f of files) { const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8" }); const last = (r.stdout.trim().split("\n").pop() || "").trim(); const finished = /\b\d+ (passed|checks passed)|all .*(passed|ok)/i.test(last); // a script that stalls goes idle and exits 0: without its summary line it did NOT finish
  const good = r.status === 0 && finished; console.log(`${good ? "PASS" : "FAIL"} ${f.padEnd(24)} ${finished ? last : "NO FINAL SUMMARY (stalled or crashed): " + last}`); if (!good) { bad++; console.log(r.stdout.split("\n").filter(l => /FAIL/.test(l)).join("\n") || r.stderr.slice(0, 400)); } }
console.log(bad ? `\n${bad} unit file(s) failed` : `\nall ${files.length} unit files passed`); process.exit(bad ? 1 : 0);
