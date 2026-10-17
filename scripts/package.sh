#!/usr/bin/env bash
# `bash scripts/package.sh`        -> dist/hauls-extension-<version>.zip  (Chrome Web Store upload: no dev key, the store assigns its own ID)
# `bash scripts/package.sh share`  -> dist/hauls-share-<version>.zip      (GitHub release: KEEPS the pinned key so everyone gets the same extension ID and Google sign-in works)
# Both contain extension/ only (no tests, no .env) and fail if secret-looking strings are inside.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./extension/manifest.json').version")
node scripts/build-config.js >/dev/null
mode=${1:-store}; name=hauls-extension; [ "$mode" = share ] && name=hauls-share
mkdir -p dist; rm -f "dist/$name-$version.zip"
stage=$(mktemp -d); cp -R extension/. "$stage"; rm -f "$stage/config.example.js" "$stage/selfcheck.js" "$stage"/*.test.js "$stage/.DS_Store"
[ "$mode" = share ] || node -e 'const f=process.argv[1]+"/manifest.json",m=JSON.parse(require("fs").readFileSync(f));delete m.key;require("fs").writeFileSync(f,JSON.stringify(m,null,2))' "$stage"   # the Web Store assigns its own extension ID: no dev key in the store build
( cd "$stage" && zip -qr "$OLDPWD/dist/$name-$version.zip" . ); rm -rf "$stage"
echo "== scanning the package for secrets =="
tmp=$(mktemp -d); unzip -q "dist/$name-$version.zip" -d "$tmp"
if grep -rEq "service_role|SERVICE_ROLE|sb_secret|re_[A-Za-z0-9]{20,}|BEGIN (RSA )?PRIVATE KEY" "$tmp"; then echo "FAIL: secret-looking content in package"; rm -rf "$tmp"; exit 1; fi
test ! -e "$tmp/.env" || { echo "FAIL: .env in package"; exit 1; }
if [ "$mode" = share ]; then grep -q '"key"' "$tmp/manifest.json" || { echo "FAIL: share build lost the pinned key"; exit 1; }; else ! grep -q '"key"' "$tmp/manifest.json" || { echo "FAIL: store build still has the dev key"; exit 1; }; fi
grep -q '"SUPABASE_ANON_KEY": "[^"]' "$tmp/config.js" || { echo "FAIL: config.js has no anon key (run npm run build:config with .env)"; exit 1; }
rm -rf "$tmp"; echo "OK -> dist/$name-$version.zip ($(du -h dist/$name-$version.zip | cut -f1))"
