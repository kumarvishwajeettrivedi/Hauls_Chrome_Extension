#!/usr/bin/env bash
# One-time per clone: use the repo's .githooks (pre-commit = staged secret scan). Local git config only; nothing is committed.
set -euo pipefail
cd "$(dirname "$0")/.."
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
echo "hooks installed: core.hooksPath=$(git config core.hooksPath)"
