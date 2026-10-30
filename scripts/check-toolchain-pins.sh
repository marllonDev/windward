#!/usr/bin/env bash
# Fails if a toolchain pin file uses a floating tag instead of an exact
# version. Floating tags (latest, stable, lts, *, master, main, or a range
# operator) are a defect per the pinning policy in docs/adr/0001.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

semver_re='^[0-9]+\.[0-9]+\.[0-9]+$'
fail=0

check_exact_version() {
  local file="$1" value="$2"
  if [[ ! "$value" =~ $semver_re ]]; then
    echo "FLOATING TAG: $file pins '$value', expected an exact x.y.z version." >&2
    fail=1
  fi
}

rust_channel=$(grep -E '^[[:space:]]*channel[[:space:]]*=' rust-toolchain.toml |
  sed -E 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/')
check_exact_version "rust-toolchain.toml" "$rust_channel"
check_exact_version ".nvmrc" "$(cat .nvmrc)"
check_exact_version ".python-version" "$(cat .python-version)"

# The Sail pin appears wherever Sail is installed, and engine/sail.version is
# the single source of truth for it (see engine/README.md). Drift between them
# would mean the API supervises a different engine than the image ships.
sail_version="$(cat engine/sail.version)"
check_exact_version "engine/sail.version" "$sail_version"

while IFS=: read -r file pinned; do
  if [[ "$pinned" != "$sail_version" ]]; then
    echo "SAIL PIN DRIFT: $file pins pysail '$pinned', engine/sail.version says '$sail_version'." >&2
    fail=1
  fi
done < <(grep -rno 'pysail==[0-9A-Za-z.]*' \
  --include='Dockerfile' --include='*.toml' \
  --exclude-dir=.venv --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=target . |
  sed -E 's/^\.\/([^:]+):[0-9]+:pysail==(.*)$/\1:\2/')

if ! grep -rq 'pysail==' services/api/pyproject.toml; then
  echo "MISSING PIN: services/api/pyproject.toml does not pin pysail." >&2
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "toolchain pins: OK (sail $sail_version)"
