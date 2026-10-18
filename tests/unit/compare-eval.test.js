// Regression gate for cross-store compare: replays the 36 saved runs (tests/fixtures/compare/eval-pool.json) and fails on a wrong "Exact" or when precision / recall drop under the floor in tests/e2e/compare-eval.mjs.
const { spawnSync } = require("child_process"), path = require("path"), assert = require("assert");
const r = spawnSync(process.execPath, [path.join(__dirname, "../e2e/compare-eval.mjs")], { encoding: "utf8" });
assert.equal(r.status, 0, "compare-eval failed:\n" + r.stdout + r.stderr);
const m = r.stdout.match(/precision ([\d.]+)%\s+recall ([\d.]+)%/); assert.ok(m, "no summary line: " + r.stdout);
console.log(`compare-eval: ${r.stdout.match(/rows shown \d+/)[0]}, precision ${m[1]}%, recall ${m[2]}% - all checks passed`);
