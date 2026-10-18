// Offline precision / recall of cross-store compare. No browser, no network: it replays 36 saved runs (tests/fixtures/compare/eval-pool.json) through the real matcher.
//   node tests/e2e/compare-eval.mjs            current extension/        node tests/e2e/compare-eval.mjs <dir with match.js + compare.js>   another copy (e.g. the code before a change)
//   add -v to print every row. Exit 1 if a hand-labelled "wrong" product is shown as Exact, or if precision / recall fall under the floor below.
// A cell = one (run, store). gold = the candidate IS the same product (hand-judged); amb = same line, title cannot confirm (neither right nor wrong); anything else the matcher shows is wrong.
// Re-capturing the pool needs live store pages (about 90 requests, 1.3 s apart): build runs from the titles in the fixture, fetch each store's search URL for cmpQuery(title, brand, mpn), keep the same-brand rows, re-label gold by hand.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url), here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2), V = args.includes("-v");
const dir = path.resolve(args.find(a => !a.startsWith("-")) || path.join(here, "../../extension"));
const M = require(path.join(dir, "match.js")); for (const k of ["mtQuery", "mtChecks", "mtFacts", "mtCompare"]) globalThis[k] = M[k]; globalThis.mtAlnum = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const C = require(path.join(dir, "compare.js")), pool = JSON.parse(readFileSync(path.join(here, "../fixtures/compare/eval-pool.json"), "utf8"));
const FLOOR = { precision: 0.9, recall: 0.9 }; // regression floor for the CURRENT code (2026-10-18: precision 92.6%, recall 96.2%; the code before the audit fixes scored 90.5% / 73.1% on the same candidates)
let tp = 0, fp = 0, amb = 0, gold = 0, exactFp = 0, near = 0, skipped = 0, rows = 0, cells = 0; const lines = [];
for (const r of pool.runs) {
  const id = C.cmpIdentity(r.title, r.brand, r.mpn);
  if (!id.brand && !(id.f.book && id.f.authors && id.f.authors.length)) { skipped++; lines.push(`${r.id}  skipped (no brand, not a book)`); continue; }
  for (const [store, cands] of Object.entries(r.cands)) {
    cells++; const g = (r.gold[store] || []).map(x => new RegExp(x, "i")), a = ((r.amb || {})[store] || []).map(x => new RegExp(x, "i")), best = C.cmpPick(id, cands, r.price); if (g.length) gold++;
    if (best) { rows++; const kind = g.some(x => x.test(best.title)) ? "TP" : a.some(x => x.test(best.title)) ? "AMB" : "FP"; if (kind === "TP") tp++; else if (kind === "AMB") amb++; else { fp++; if (best.confidence === "Exact") exactFp++; } lines.push(`${r.id}  ${store.padEnd(16)} ${kind.padEnd(3)} ${best.confidence.padEnd(6)} ${best.title.slice(0, 70)}`); }
    else { if (g.length) lines.push(`${r.id}  ${store.padEnd(16)} MISS (gold exists)`); const cl = C.cmpClosest(id, cands, r.price); if (cl) { near++; lines.push(`${r.id}  ${store.padEnd(16)} near ${cl.why}: ${cl.title.slice(0, 60)}`); } }
  }
}
const pct = x => (x * 100).toFixed(1) + "%", precision = tp / Math.max(1, tp + fp), recall = tp / Math.max(1, gold);
if (V) console.log(lines.join("\n") + "\n");
console.log(`code: ${path.relative(process.cwd(), dir) || "."}\nruns ${pool.runs.length} (skipped ${skipped}), store answers ${cells}\nrows shown ${rows}: right ${tp}, wrong ${fp} (of which Exact ${exactFp}), ambiguous ${amb}   gold cells ${gold}, found ${tp}, missed ${gold - tp}   closest-but-different rows ${near}\nprecision ${pct(precision)}   recall ${pct(recall)}`);
if (!args.some(a => !a.startsWith("-"))) { if (exactFp || precision < FLOOR.precision || recall < FLOOR.recall) { console.log("FAIL: under the floor (wrong Exact must be 0, precision >= " + pct(FLOOR.precision) + ", recall >= " + pct(FLOOR.recall) + ")"); process.exit(1); } }
