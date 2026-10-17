#!/usr/bin/env bash
# Builds dist/hauls-extension-<version>.zip from extension/ only (no tests, no keys, no .env) and fails if secret-looking strings are inside.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./extension/manifest.json').version")
node scripts/build-config.js >/dev/null
rm -rf dist && mkdir -p dist
stage=$(mktemp -d); cp -R extension/. "$stage"; rm -f "$stage/config.example.js" "$stage/selfcheck.js" "$stage"/*.test.js "$stage/.DS_Store"
node -e 'const f=process.argv[1]+"/manifest.json",m=JSON.parse(require("fs").readFileSync(f));delete m.key;require("fs").writeFileSync(f,JSON.stringify(m,null,2))' "$stage"   # the Web Store assigns its own extension ID: no dev key in the store build
( cd "$stage" && zip -qr "$OLDPWD/dist/hauls-extension-$version.zip" . ); rm -rf "$stage"
echo "== scanning the package for secrets =="
tmp=$(mktemp -d); unzip -q "dist/hauls-extension-$version.zip" -d "$tmp"
if grep -rEq "service_role|SERVICE_ROLE|sb_secret|re_[A-Za-z0-9]{20,}|BEGIN (RSA )?PRIVATE KEY" "$tmp"; then echo "FAIL: secret-looking content in package"; rm -rf "$tmp"; exit 1; fi
test ! -e "$tmp/.env" || { echo "FAIL: .env in package"; exit 1; }
grep -q '"key"' "$tmp/manifest.json" && echo "note: manifest.key present (needed to keep the dev extension ID; the Web Store assigns its own ID, so remove it for the store upload)"
rm -rf "$tmp"; echo "OK -> dist/hauls-extension-$version.zip ($(du -h dist/hauls-extension-$version.zip | cut -f1))"
