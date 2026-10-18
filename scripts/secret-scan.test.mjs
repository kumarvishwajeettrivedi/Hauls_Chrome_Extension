// node scripts/secret-scan.test.mjs : builds throwaway git repos with FAKE secrets (assembled at runtime so this file itself is clean) and checks the scanner.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
const SCAN = path.join(path.dirname(fileURLToPath(import.meta.url)), "secret-scan.mjs");
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"), jwt = role => `eyJ${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", role, ref: "abcdefghij" })}.${"A1b2C3d4".repeat(4)}`;
const SERVICE = jwt("service_role"), ANON = jwt("anon"), RESEND = "re_" + "Ab3dE5gH7jK9mN1pQ3sT5vW7", GOOG = "GOCSP" + "X-Zq8Xw1Yv2Ut3Sr4Qp5On6Ml7Kj8", PEM = "-----BEGIN " + "PRIVATE KEY-----", ENVV = "k9Fh2Lq8Zt4Wm7Xc1Vb6Nr3Ys5Pd0";
let bad = 0; const T = (n, c) => { console.log(c ? "PASS" : "FAIL", n); if (!c) bad++; };
const sh = (cwd, ...a) => execFileSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: "pipe" });
const run = (cwd, ...a) => { const r = spawnSync(process.execPath, [SCAN, ...a], { cwd, encoding: "utf8" }); return { code: r.status, out: r.stdout + r.stderr }; };
const repo = files => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "ss-")); sh(d, "init", "-q"); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); } sh(d, "add", "-A"); sh(d, "commit", "-qm", "c"); return d; };
const leaks = out => [SERVICE, RESEND, GOOG, ENVV, SERVICE.split(".")[2]].filter(s => out.includes(s));

let d = repo({ "a.js": `// clean\nconst anon = "${ANON}";\nconst re = /re_[a-z]+/;\n`, ".env.example": "SUPABASE_ANON_KEY=\nRESEND_API_KEY=\n" });
let r = run(d); T("clean repo (anon JWT, regex, empty .env.example) passes", r.code === 0);

d = repo({ "cfg.js": `const k = "${SERVICE}";\n` }); r = run(d);
T("service_role JWT in a tracked file fails", r.code === 1 && /supabase-service-role-jwt/.test(r.out));
T("output never contains the full secret", leaks(r.out).length === 0 && r.out.includes("eyJ"));   // 4-char preview only

d = repo({ "x.txt": "hi\n" }); fs.writeFileSync(path.join(d, "x.txt"), "hi\n"); fs.writeFileSync(path.join(d, "n.txt"), `k=${RESEND}\n${PEM}\n`); sh(d, "add", "-A"); sh(d, "commit", "-qm", "leak");
sh(d, "rm", "-q", "n.txt"); sh(d, "commit", "-qm", "oops removed"); r = run(d, "--no-tracked");
T("secret deleted in a later commit is still found in history", r.code === 1 && /resend-key/.test(r.out) && /private-key-block/.test(r.out) && /[0-9a-f]{12}:n\.txt/.test(r.out));
T("worktree-only pass is clean once deleted", run(d, "--no-history").code === 0);

d = repo({ "e.txt": `GOOGLE_API_TOKEN=${ENVV}\nClient_secret=${GOOG}\n` }); r = run(d);
T("env-style assignment + google secret flagged, no leak", r.code === 1 && /env-assignment/.test(r.out) && /google-client-secret/.test(r.out) && leaks(r.out).length === 0);

d = repo({ ".env": "A=b\n", "keys/dev.pem": "x\n", "t.js": "const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY_FOR_TESTS_ONLY_1;\n" }); r = run(d);
T("tracked .env and .pem are flagged by name; code expression is not", r.code === 1 && (r.out.match(/sensitive-filename/g) || []).length === 2 && !/t\.js/.test(r.out));

d = repo({ "ok.txt": "ok\n" }); fs.writeFileSync(path.join(d, "bad.txt"), `t=${RESEND}\n`); sh(d, "add", "bad.txt");
T("--staged catches the staged secret", run(d, "--staged").code === 1);
sh(d, "reset", "-q", "bad.txt"); T("--staged ignores unstaged files", run(d, "--staged").code === 0);

d = repo({ "ok.txt": "ok\n" }); fs.mkdirSync(path.join(d, "dist")); fs.mkdirSync(path.join(d, "pk")); fs.writeFileSync(path.join(d, "pk/c.js"), `x="${SERVICE}"\n`);
if (spawnSync("zip", ["-v"]).status === 0) { execFileSync("zip", ["-qr", "../dist/p.zip", "."], { cwd: path.join(d, "pk") }); fs.rmSync(path.join(d, "pk"), { recursive: true }); r = run(d, "--no-history");
  T("secret inside dist/*.zip is found (deflated entry)", r.code === 1 && /p\.zip!c\.js/.test(r.out)); } else console.log("SKIP zip test (no zip binary)");

// long lines (minified JS/JSON) are scanned in overlapping windows, in the worktree AND in history
const pad = n => '"' + "x".repeat(n) + '";';
d = repo({ "min.js": pad(30000) + `var k="${SERVICE}";\n` }); r = run(d, "--no-history");
T("secret after 30k chars on one line is found (worktree)", r.code === 1 && /supabase-service-role-jwt/.test(r.out) && leaks(r.out).length === 0);
d = repo({ "min.js": pad(19900) + `var k="${SERVICE}";\n` }); r = run(d, "--no-history"); T("secret straddling a window edge is found", r.code === 1);
d = repo({ "min.js": pad(30000) + `var k="${SERVICE}";\n` }); r = run(d, "--no-tracked"); T("secret after 30k chars on one line is found (history)", r.code === 1 && /history|[0-9a-f]{12}:min\.js/.test(r.out));
d = repo({ "min.js": pad(300000) + `var k="${SERVICE}";\n` }); r = run(d, "--no-tracked"); T("secret after 300k chars on one added line is found (history)", r.code === 1 && /[0-9a-f]{12}:min\.js/.test(r.out));
d = repo({ "min.js": `var k="${SERVICE}";` + pad(300000) + "\n" }); r = run(d, "--no-tracked"); T("secret at the START of a 300k added line is found (history)", r.code === 1);
d = repo({ "min.js": pad(300000) + "\n" }); T("a long clean line passes", run(d).code === 0);
// NUL bytes no longer hide a file: UTF-16 (both alignments) and NUL-padded latin1
const u16 = t => Buffer.from(t, "utf16le");
d = repo({ "u.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), u16(`k="${SERVICE}"\n`)]) }); r = run(d, "--no-history"); T("secret in a UTF-16LE file is found", r.code === 1 && leaks(r.out).length === 0);
d = repo({ "u.txt": Buffer.concat([Buffer.from([0]), u16(`k="${SERVICE}"\n`)]) }); T("secret in a UTF-16 file at odd alignment is found", run(d, "--no-history").code === 1);
d = repo({ "b.bin": Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(`k="${RESEND}"\n`, "latin1")]) }); T("secret in a binary file with NUL bytes is found", run(d, "--no-history").code === 1);
d = repo({ "b.bin": Buffer.from([0, 1, 2, 0, 255, 254]) }); T("a clean binary file passes", run(d, "--no-history").code === 0);

d = repo({ "a.txt": "a\n" }); r = spawnSync(process.execPath, [SCAN, "--no-tracked"], { cwd: d, encoding: "utf8", env: { ...process.env, SCAN_MAX_MB: "0.0001" } });
T("history over the size guard fails closed (exit 2, not 0)", r.status === 2);
console.log(bad ? `${bad} FAILED` : "secret-scan: all checks passed"); process.exit(bad ? 1 : 0);
