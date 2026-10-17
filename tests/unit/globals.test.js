// The service worker (importScripts) and the content script load several files into ONE shared global scope.
// A duplicate top-level const/let/class in any two of them is a SyntaxError that silently kills the whole script.
// This test loads each real script list, in order, into a single vm context and fails on any load error.
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
// config.js is generated (git-ignored); a fresh clone falls back to the committed template
const ext = f => { const full = path.join(__dirname, "../../extension", f); return fs.readFileSync(f === "config.js" && !fs.existsSync(full) ? full.replace("config.js", "config.example.js") : full, "utf8"); };
const manifest = JSON.parse(ext("manifest.json"));
const bgImports = [...ext("background.js").matchAll(/importScripts\(([^)]*)\)/g)].flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
const contentFiles = manifest.content_scripts.flatMap(c => c.js);
let bad = 0;
function load(name, files) {
  const sandbox = { console, URL, URLSearchParams, TextEncoder, crypto: globalThis.crypto, btoa, atob, setTimeout, clearTimeout, AbortController, setInterval, clearInterval, Date, JSON, Math, Promise,
    chrome: { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { id: "x", onMessage: { addListener() {} }, sendMessage() {} } },
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), addEventListener() {}, head: {}, body: { append() {} } }, location: { href: "https://www.amazon.in/", hostname: "www.amazon.in" }, matchMedia: () => ({ matches: false }), innerHeight: 800, innerWidth: 1280, addEventListener() {}, fetch: async () => ({}) };
  const ctx = vm.createContext(sandbox);
  for (const f of files) { try { vm.runInContext(ext(f), ctx, { filename: f }); } catch (e) { if (!/Cannot read|is not a function|Illegal return/.test(e.message) || /already been declared/.test(e.message)) { bad++; console.log(`  FAIL ${name}: loading ${f} -> ${e.message}`); return; } } }
  console.log(`  ok   ${name}: ${files.length} files load together without redeclaration`);
}
assert.ok(bgImports.length >= 6, "found the background importScripts list: " + bgImports.join(","));
load("service worker (importScripts)", bgImports);
load("content script (manifest order)", contentFiles.filter(f => f !== "content.js")); // content.js is an IIFE; it can't redeclare globals
for (const f of contentFiles) assert.ok(fs.existsSync(path.join(__dirname, "../../extension", f)), "manifest references missing file " + f);
for (const f of bgImports) assert.ok(fs.existsSync(path.join(__dirname, "../../extension", f)) || f === "config.js", "importScripts references missing file " + f);
console.log(bad ? `\nglobals: ${bad} failed` : "\nglobals: all passed"); process.exit(bad ? 1 : 0);
