#!/usr/bin/env bash
# CI test step. At this milestone there is no application code, so this
# verifies the scaffold invariants fixed by docs/adr/0001: the directory
# layout exists and the pinned toolchain files are present and non-empty.
# Extend this script with real test runners once apps/web, services/api,
# engine/, and dbt/ have content.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

required_dirs=(apps/web services/api engine dbt docs/adr docker scripts)
fail=0

for dir in "${required_dirs[@]}"; do
  if [[ ! -d "$dir" ]]; then
    echo "MISSING: required directory '$dir' from docs/adr/0001 is absent." >&2
    fail=1
  fi
done

for file in rust-toolchain.toml .nvmrc .python-version; do
  if [[ ! -s "$file" ]]; then
    echo "MISSING: toolchain pin file '$file' is absent or empty." >&2
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "test: OK"
