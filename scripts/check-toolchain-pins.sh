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

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "toolchain pins: OK"
