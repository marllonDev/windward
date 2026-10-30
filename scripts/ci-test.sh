#!/usr/bin/env bash
# CI test step: the scaffold invariants from docs/adr/0001, then the platform
# API's integration suite.
#
# The API suite is not mocked. It starts a real Sail engine as a child of the
# application under test, which needs no Docker and no running OrbStack --
# `pysail` ships the engine as a wheel. Extend this script as apps/web and
# dbt/ gain content.
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

echo "== platform API integration suite (live Sail) =="
PYTHON="$(scripts/api-venv.sh)"
(cd services/api && "$PYTHON" -m pytest)

echo "test: OK"
