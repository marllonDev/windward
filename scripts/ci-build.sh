#!/usr/bin/env bash
# CI build step: the OrbStack preflight, then the container images that
# docker-compose.yml builds. Needs a reachable Docker daemon.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

./scripts/bootstrap.sh

# shellcheck source=scripts/lib-compose.sh
source scripts/lib-compose.sh

echo "== compose build =="
"${COMPOSE[@]}" build

echo "build: OK"
