#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REPO_URL="${1:-${REPO_URL:-}}"
if [[ -z "$REPO_URL" ]]; then
  echo "Usage: $(basename "$0") <github-repo-url>"
  echo "Example: $(basename "$0") git@github.com:YOUR_USER/zocket.git"
  exit 2
fi

echo "[publish] checking git auth/remote"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

echo "[publish] pushing main and v1.0.0"
git push -u origin main
git push origin v1.0.0

echo "[publish] publishing npm package"
npm whoami >/dev/null
npm publish --access public

echo "[publish] done"
