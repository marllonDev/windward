#!/usr/bin/env bash
# CI build step. No Dockerfiles or package manifests exist yet (M0 is
# scaffold-only, see docs/adr/0001), so the only build-equivalent artifact
# is the preflight check every later build will depend on. Extend this
# script with real image builds once docker/ has Dockerfiles.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

./scripts/bootstrap.sh
echo "build: OK"
