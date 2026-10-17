// Authorship mark. Writes an invisible signature into many source files, shows it on demand, and checks it against a private key.
//   node scripts/provenance.mjs stamp     put/refresh the mark in the listed files (safe to re-run)
//   node scripts/provenance.mjs reveal    decode the mark from the files and print the name (no key needed)
//   node scripts/provenance.mjs verify    also check each file's signature with your private key (proof only you can produce)
// The mark is zero-width characters at the end of a file's first line (a comment): invisible in editors and browsers, harmless to the code.
// The signature is HMAC(private key, "<path>|<name>"), 32 bits per file. The key lives OUTSIDE the repo (~/.hauls-provenance.key, mode 600): back it up, never commit it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), NAME = "vishwajeet", KEY_FILE = process.env.HAULS_PROVENANCE_KEY || path.join(os.homedir(), ".hauls-provenance.key");
const FILES = ["extension/background.js", "extension/content.js", "extension/lib.js", "extension/analysis.js", "extension/match.js", "extension/compare.js", "extension/offers.js", "extension/tracker.js", "extension/impulse.js", "extension/amzhist.js", "extension/amzbg.js", "extension/sync.js", "extension/guard.js", "extension/state.js", "extension/theme.js", "extension/options.js", "extension/tier2.js", "site/index.html", "supabase/migrations/0010_ext_chart_series.sql", "supabase/migrations/0011_ext_obs_src_bg.sql", "scripts/package-share.mjs"].filter(f => fs.existsSync(path.join(ROOT, f)));
const ZERO = "​", ONE = "‌", OPEN = "⁠", CLOSE = "⁡", ZW = new RegExp(`${OPEN}[${ZERO}${ONE}]+${CLOSE}`, "g");
const encode = s => OPEN + [...Buffer.from(s, "utf8")].map(b => b.toString(2).padStart(8, "0")).join("").replace(/0/g, ZERO).replace(/1/g, ONE) + CLOSE;
const decode = z => { const bits = [...z.slice(1, -1)].map(c => (c === ONE ? "1" : "0")).join(""); return Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2))).toString("utf8"); };
const key = (create = false) => { if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, "utf8").trim(); if (!create) return null; const k = crypto.randomBytes(32).toString("hex"); fs.writeFileSync(KEY_FILE, k + "\n", { mode: 0o600 }); console.log("created private key:", KEY_FILE, "(back it up; without it you cannot prove the signatures)"); return k; };
const sig = (k, rel) => crypto.createHmac("sha256", k).update(`${rel}|${NAME}`).digest("hex").slice(0, 8);
const strip = text => text.replace(ZW, "");
function stamp(rel, k) {
  const abs = path.join(ROOT, rel), text = strip(fs.readFileSync(abs, "utf8")), nl = text.indexOf("\n"), first = nl < 0 ? text : text.slice(0, nl), rest = nl < 0 ? "" : text.slice(nl), mark = encode(`${NAME}:${sig(k, rel)}`);
  const comment = /^\s*(\/\/|\/\*|--|<!--|#)/.test(first); // a comment first line takes the mark as is; otherwise a new comment line carries it
  const out = comment ? first + mark + rest : /\.html$/.test(rel) ? first + `\n<!--${mark}-->` + rest : /\.sql$/.test(rel) ? `--${mark}\n` + text : `//${mark}\n` + text;
  if (out !== fs.readFileSync(abs, "utf8")) fs.writeFileSync(abs, out); return true;
}
function read(rel) { const m = fs.readFileSync(path.join(ROOT, rel), "utf8").match(ZW); if (!m) return null; try { const [name, s] = decode(m[0]).split(":"); return { name, sig: s }; } catch { return null; } }
const cmd = process.argv[2];
if (cmd === "stamp") { const k = key(true); for (const f of FILES) stamp(f, k); console.log("stamped", FILES.length, "files"); }
else if (cmd === "reveal" || cmd === "verify") {
  const k = cmd === "verify" ? key() : null; if (cmd === "verify" && !k) { console.log("no private key at", KEY_FILE); process.exit(2); }
  let found = 0, good = 0; for (const f of FILES) { const r = read(f); if (!r) { console.log("  missing  ", f); continue; } found++; const ok = k ? r.sig === sig(k, f) : null; if (ok) good++; console.log(`  ${ok === null ? "mark" : ok ? "verified" : "MISMATCH"}  ${f}  ${r.name}`); }
  console.log(`${found}/${FILES.length} files carry the mark` + (k ? `, ${good} verified with your private key` : "")); process.exit(found ? 0 : 1);
}
else { console.log("usage: node scripts/provenance.mjs stamp | reveal | verify"); process.exit(1); }
