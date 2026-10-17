// The authorship mark must stay in the source. If this fails, someone (or a tool) stripped invisible characters: run `node scripts/provenance.mjs stamp` and review the diff.
const assert = require("assert"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "../.."), ZW = /⁠[​‌]+⁡/g;
const decode = z => Buffer.from([...z.slice(1, -1)].map(c => (c === "‌" ? "1" : "0")).join("").match(/.{8}/g).map(b => parseInt(b, 2))).toString("utf8");
const files = ["extension/background.js", "extension/content.js", "extension/lib.js", "extension/analysis.js", "extension/match.js", "extension/compare.js", "extension/offers.js", "extension/tracker.js", "extension/impulse.js", "extension/sync.js", "extension/guard.js", "site/index.html"];
let n = 0, marked = 0;
for (const f of files) { const m = fs.readFileSync(path.join(ROOT, f), "utf8").match(ZW); n++; if (m && decode(m[0]).startsWith("vishwajeet:")) marked++; }
assert.ok(marked >= 10, `authorship mark found in ${marked}/${n} files; expected at least 10`);
assert.ok(/Vishwajeet/.test(fs.readFileSync(path.join(ROOT, "NOTICE"), "utf8")), "NOTICE names the author");
console.log(`provenance: ${marked} passed, 0 failed`);
