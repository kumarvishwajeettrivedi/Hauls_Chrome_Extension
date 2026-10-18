// Secret scanner, zero deps. Looks in: git-tracked files, the FULL git history (added lines of every commit on every ref), and dist/*.zip contents.
//   node scripts/secret-scan.mjs              everything (what CI runs)
//   node scripts/secret-scan.mjs --staged     only the staged diff (pre-commit hook)
//   flags: --no-history  --no-zip  --no-tracked     env: SCAN_MAX_MB=300 (history size guard; over it = FAIL, never a silent pass)
// Prints only file / revision / type / a 4-char preview. Never a full value. Exit 1 on a hit, 2 if the scan could not complete.
// A line carrying the marker `secret-scan:allow` is skipped (for documented fake values in tests/docs).
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

const argv = new Set(process.argv.slice(2)), MAX = (+process.env.SCAN_MAX_MB || 300) * 1048576, LINE_CAP = 20000, OVERLAP = 2000;
const git = (...a) => execFileSync("git", a, { maxBuffer: 1 << 28 });
const hits = new Map(); let incomplete = false;   // dedupe key = type + hash of value: one secret in 60 commits is one finding

const redact = v => v.slice(0, 4) + "…(" + v.length + ")";
const jwtRole = v => { try { return JSON.parse(Buffer.from(v.split(".")[1], "base64url").toString()).role; } catch { return null; } };
const looksReal = v => /\d/.test(v) && /[A-Za-z]/.test(v) && !/^(x+|\*+|your|example|changeme|placeholder|<)/i.test(v) && !/process\.env|\$\{|\(/.test(v);
// [type, regex, validate(match) -> preview-string | false]
const RULES = [
  ["supabase-service-role-jwt", /\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/g, v => (jwtRole(v) === "service_role" ? redact(v) : false)],   // anon JWTs are public by design: only role=service_role is a leak
  ["supabase-secret-key", /\bsb_secret_[\w-]{16,}/g, redact],
  ["resend-key", /\bre_[A-Za-z0-9_]{20,}/g, v => (/\d/.test(v) && /[a-z]/.test(v) ? redact(v) : false)],
  ["google-client-secret", /\bGOCSPX-[\w-]{16,}/g, redact],
  ["private-key-block", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g, v => v.slice(11, 15) + "…"],
  ["github-token", /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}/g, redact],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/g, redact],
  // .env style: NAME(KEY|SECRET|TOKEN|PASSWORD)=<long literal>. Group 2 is the value; placeholders and code expressions are ignored.
  ["env-assignment", /^\s*(?:export\s+)?[A-Za-z_]\w*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD)\w*\s*=\s*["']?([\w+/=.-]{24,})["']?\s*$/gim, (v, m) => (looksReal(m[1]) && !/^eyJ/.test(m[1]) ? redact(m[1]) : false)],
  ["env-assignment", /^\s*[A-Za-z_]\w*(?:_secret|_SECRET)\s*=\s*["']?([^\s"']{12,})["']?\s*$/gm, (v, m) => (looksReal(m[1]) ? redact(m[1]) : false)],
];
const BAD_NAME = /(^|\/)(\.env(\.(?!example$)[\w.-]+)?|[\w.-]+\.(pem|p12|pfx|har)|id_rsa|id_ed25519)$/i;

function scanLine(line, where) {
  if (line.length > LINE_CAP) { for (let i = 0; i < line.length; i += LINE_CAP - OVERLAP) scanLine(line.slice(i, i + LINE_CAP), where); return; }   // minified one-liners: overlapping windows, nothing is skipped
  if (line.includes("secret-scan:allow")) return;
  for (const [type, re, check] of RULES) { re.lastIndex = 0; let m; while ((m = re.exec(line))) { const p = check(m[0], m); if (p) record(type, where, p, m[1] || m[0]); if (m[0] === "") re.lastIndex++; } }
}
function record(type, where, preview, raw) {
  const k = type + crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16), h = hits.get(k);
  if (h) h.n++; else hits.set(k, { type, where, preview, n: 1 });
}
const scanText = (text, where) => { for (const l of text.split("\n")) scanLine(l, where); };
// A file with NUL bytes is not skipped: UTF-16 text (either alignment) and byte-wise latin1 are both scanned.
const scanBuf = (b, where) => { if (!b.includes(0)) return scanText(b.toString("utf8"), where); scanText(b.toString("latin1"), where); scanText(b.toString("utf16le"), where); scanText(b.subarray(1).toString("utf16le"), where); };
const flagName = (name, where) => { if (BAD_NAME.test(name)) record("sensitive-filename", where, name, name); };

// --- a unified-diff stream (git log -p / git diff --cached): scans ADDED lines only, tracking commit + file ---
function scanPatch(chunks, label) {
  let rev = label, file = "?", buf = "", seen = 0, cont = false;   // cont: buf is the tail of an added line whose head was already scanned
  const eat = line => {
    if (line.startsWith("commit ")) rev = line.slice(7, 19);
    else if (line.startsWith("diff --git ")) { file = line.split(" b/").pop(); flagName(file, `${rev}:${file}`); }
    else if (line.startsWith("+") && !line.startsWith("+++")) scanLine(line.slice(1), `${rev}:${file}`);
  };
  return new Promise(resolve => {
    chunks.on("data", d => { seen += d.length; if (seen > MAX) { incomplete = true; console.error(`history larger than ${MAX >> 20} MB: aborted (raise SCAN_MAX_MB or squash blobs). This is a FAIL, not a pass.`); chunks.destroy?.(); resolve(); return; }
      buf += d.toString("latin1"); const ls = buf.split("\n"); buf = ls.pop(); if (cont && ls.length) { scanLine(ls.shift(), `${rev}:${file}`); cont = false; }
      if (buf.length > LINE_CAP * 4) { const add = cont || (buf[0] === "+" && !buf.startsWith("+++")); if (add) scanLine(buf.slice(cont ? 0 : 1, -OVERLAP), `${rev}:${file}`); buf = buf.slice(-OVERLAP); cont = add; }   // a huge added line is scanned in pieces, never cut off
      ls.forEach(eat); });
    chunks.on("end", () => { if (cont) scanLine(buf, `${rev}:${file}`); else eat(buf); resolve(); });
    chunks.on("error", () => { incomplete = true; resolve(); });
  });
}
const stream = args => { const p = spawn("git", args, { stdio: ["ignore", "pipe", "inherit"] }); p.on("error", () => {}); p.on("close", c => { if (c) incomplete = true; }); return p.stdout; };

function scanTracked() {
  for (const f of git("ls-files", "-z").toString().split("\0").filter(Boolean)) {
    flagName(f, "worktree:" + f);
    let b; try { b = fs.readFileSync(f); } catch { continue; }
    if (b.length > 5 << 20) continue;   // huge: covered by the filename rules and the zip scan
    scanBuf(b, "worktree:" + f);
  }
}

// --- minimal zip reader (central directory + raw inflate): no `unzip` dependency, no extraction to disk ---
function scanZip(zp) {
  const z = fs.readFileSync(zp), name = path.basename(zp);
  let e = z.length - 22; while (e >= 0 && z.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) { incomplete = true; console.error("not a zip: " + name); return; }
  let p = z.readUInt32LE(e + 16);
  for (let n = z.readUInt16LE(e + 10); n > 0 && z.readUInt32LE(p) === 0x02014b50; n--) {
    const method = z.readUInt16LE(p + 10), csize = z.readUInt32LE(p + 20), nl = z.readUInt16LE(p + 28), xl = z.readUInt16LE(p + 30), cl = z.readUInt16LE(p + 32), off = z.readUInt32LE(p + 42);
    const fn = z.toString("utf8", p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    flagName(fn, `${name}!${fn}`);
    if (fn.endsWith("/") || /\.(png|jpe?g|gif|webp|woff2?)$/i.test(fn)) continue;
    const ds = off + 30 + z.readUInt16LE(off + 26) + z.readUInt16LE(off + 28);
    try { const raw = z.subarray(ds, ds + csize), data = method === 8 ? zlib.inflateRawSync(raw) : raw; scanBuf(data, `${name}!${fn}`); } catch { incomplete = true; console.error(`cannot read ${name}!${fn}`); }
  }
}

if (argv.has("--staged")) await scanPatch(stream(["diff", "--cached", "--no-color", "-U0", "--diff-filter=AMR"]), "staged");
else {
  if (!argv.has("--no-tracked")) scanTracked();
  if (!argv.has("--no-history")) await scanPatch(stream(["log", "--all", "-p", "--no-color", "-U0", "--no-ext-diff", "--no-textconv", "--format=commit %H"]), "history");
  if (!argv.has("--no-zip") && fs.existsSync("dist")) for (const f of fs.readdirSync("dist")) if (f.endsWith(".zip")) scanZip(path.join("dist", f));
}
for (const h of hits.values()) console.log(`HIT ${h.type.padEnd(26)} ${h.where}  preview=${h.preview}${h.n > 1 ? `  (+${h.n - 1} more)` : ""}`);
console.log(hits.size ? `\nFAIL: ${hits.size} finding(s). Rotate the credential first (docs/threat-model.md, key rotation runbook), then remove it.` : incomplete ? "" : "secret-scan: clean");
process.exit(hits.size ? 1 : incomplete ? 2 : 0);
