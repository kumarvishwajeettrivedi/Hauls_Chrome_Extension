// Static security scan of extension/*.js + manifest.json. Each check collects failures; exits 1 if any.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "../../extension");
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js") && !f.endsWith(".test.js"));
const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const results = []; const check = (name, errs, expectedRed) => results.push({ name, errs, expectedRed });
const scan = (re, filter = () => true) => Object.entries(src).flatMap(([f, s]) => [...s.matchAll(re)].filter(m => filter(m, f, s)).map(m => `${f}: ${m[0].slice(0, 60)}`));

check("no eval(", scan(/(?<![\w.])eval\s*\(/g));
check("no new Function", scan(/new\s+Function\b/g));
check("no document.write", scan(/document\.write(ln)?\s*\(/g));
check("no unsafe-eval", [...scan(/unsafe-eval/g), ...(JSON.stringify(manifest).includes("unsafe-eval") ? ["manifest"] : [])]);
// http:// literals: only localhost and the inert SVG XML namespace (never fetched) are allowed.
check("no http:// literals", scan(/http:\/\/[^\s"'`)]*/g, m => !/^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(m[0]) && m[0] !== "http://www.w3.org/2000/svg"));
check("no insertAdjacentHTML / outerHTML assignment", scan(/insertAdjacentHTML\s*\(|outerHTML\s*=(?!=)/g));

// innerHTML assignments. RHS must be a plain string literal, or an allow-listed static source, or a template whose
// every ${} is allow-listed. Allow-list is by file + exact expression, with the reason.
const ALLOW_RHS = {
  "content.js": [
    [/^P\[n\]$/, "P is a const map of static SVG path strings; n is an internal icon name"],
    [/^LOGO$/, "LOGO is a const static SVG string"],
  ],
};
const ALLOW_INTERP = {
  "content.js": [/^(W|T|B|d)$/, /^fmt\((lo|hi)\)$/, /^f\([^`]*\)$/], // chart svg: W/T/B consts, d = path string built only from toFixed numbers, fmt() = money formatter on numbers, f() = n.toFixed(1)
};
const inner = [];
for (const [f, s] of Object.entries(src)) for (const m of s.matchAll(/\.innerHTML\s*=(?!=)\s*/g)) {
  const rest = s.slice(m.index + m[0].length); let rhs;
  if (rest[0] === "`") { let i = 1; while (i < rest.length && rest[i] !== "`") i += rest[i] === "\\" ? 2 : 1; rhs = rest.slice(0, i + 1); } else rhs = rest.slice(0, rest.search(/[;\n]/));
  const where = `${f}: innerHTML = ${rhs.slice(0, 50).replace(/\s+/g, " ")}`;
  if (/^(["'])(?:(?!\1)[^\\]|\\.)*\1$/.test(rhs.trim())) continue;            // plain literal
  if (rhs[0] === "`") {
    const exprs = [...rhs.matchAll(/\$\{([^}]*(?:\([^)]*\)[^}]*)*)\}/g)].map(x => x[1].trim());
    const bad = exprs.filter(e => !(ALLOW_INTERP[f] || []).some(re => re.test(e)));
    if (bad.length) inner.push(`${where}  (non-allow-listed interpolation: ${bad.join(" | ")})`); continue;
  }
  if (!(ALLOW_RHS[f] || []).some(([re]) => re.test(rhs.trim()))) inner.push(where);
}
check("innerHTML only static / allow-listed numeric svg", inner);

// secrets
const anonRole = j => { try { return JSON.parse(Buffer.from(j.split(".")[1], "base64url").toString()).role === "anon"; } catch { return false; } };
check("no JWT-like / secret strings", [
  ...scan(/eyJ[A-Za-z0-9_-]{20,}/g, (m, f, s) => !(f === "config.js" && (s.match(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g) || []).every(anonRole))), // the generated config.js may carry ONE thing: the public anon key (role must decode to "anon")
   ...scan(/service_role/g), ...scan(/sb_secret/g), ...scan(/\bre_[A-Za-z0-9]{16,}/g), ...scan(/\bsk_(live|test)_[A-Za-z0-9]+/g),
]);

// manifest
const hosts = [...(manifest.host_permissions || []), ...(manifest.optional_host_permissions || []), ...(manifest.content_scripts || []).flatMap(c => c.matches || [])];
check("manifest has no <all_urls>", hosts.filter(h => h === "<all_urls>"));
const PERMS = ["storage", "alarms", "notifications", "scripting", "identity", "idle"]; // idle: lets the opt-in Amazon history reader wait until you are away (no install warning)
check("permissions subset of allowlist", (manifest.permissions || []).filter(p => !PERMS.includes(p)));
// EXPECTED RED until Task 4 integration adds the CSP to manifest.json.
const csp = manifest.content_security_policy && manifest.content_security_policy.extension_pages;
check("manifest declares strict CSP (extension_pages)", csp ? (/script-src 'self'/.test(csp) && /object-src 'self'/.test(csp) && /base-uri 'none'/.test(csp) && !/unsafe-/.test(csp) ? [] : ["weak CSP: " + csp]) : ["content_security_policy.extension_pages missing"], true);

let bad = 0;
for (const r of results) { const ok = !r.errs.length; if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"} ${r.name}${r.expectedRed && !ok ? "  [EXPECTED RED until Task 4 manifest integration]" : ""}`); r.errs.forEach(e => console.log("     " + e)); }
console.log(bad ? `${bad} security check(s) failed` : "all security checks passed"); process.exit(bad ? 1 : 0);
