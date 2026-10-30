#!/usr/bin/env bash
# CI lint step. Same script runs in GitHub Actions and locally.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "== shellcheck =="
shellcheck scripts/*.sh

echo "== actionlint =="
actionlint

echo "== toolchain pins (no floating tags) =="
scripts/check-toolchain-pins.sh

echo "== ruff (services/api) =="
PYTHON="$(scripts/api-venv.sh)"
"$PYTHON" -m ruff check services/api
"$PYTHON" -m ruff format --check services/api

echo "lint: OK"
