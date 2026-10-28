#!/usr/bin/env bash
# Runs the full CI check locally, in the same order and with the same
# scripts CI uses. See .github/workflows/ci.yml.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

./scripts/ci-lint.sh
./scripts/ci-test.sh
./scripts/ci-build.sh
echo "ci: all checks passed"
