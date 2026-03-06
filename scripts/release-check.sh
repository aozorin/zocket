#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[1/4] Python tests"
PYTHONPATH="$ROOT" pytest -q

echo "[2/4] Python build"
python3 -m pip install --upgrade build >/dev/null
TMP_BUILD="$(mktemp -d)"
trap 'rm -rf "$TMP_BUILD"' EXIT
tar \
  --exclude-vcs \
  --exclude='.pytest_cache' \
  --exclude='build' \
  --exclude='dist' \
  --exclude='*.egg-info' \
  --exclude='__pycache__' \
  -cf - . | (cd "$TMP_BUILD" && tar -xf -)
(cd "$TMP_BUILD" && python3 -m build --outdir "$ROOT/dist")

echo "[3/4] npm pack dry run"
npm pack --dry-run >/dev/null

echo "[4/4] Done"
echo "Artifacts:"
echo "  Python: dist/"
echo "  npm: run 'npm pack' to produce tarball"
