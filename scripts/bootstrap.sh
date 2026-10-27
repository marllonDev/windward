#!/usr/bin/env bash
# Preflight check for the Windward dev environment.
# Verifies OrbStack's Docker daemon is reachable. Exits non-zero with a
# clear message if it is not; never substitutes a different context or
# mocks the result.
set -euo pipefail

echo "Checking OrbStack Docker daemon..."
if ! docker version >/tmp/windward-docker-version.out 2>&1; then
  echo "ERROR: Docker daemon is not reachable." >&2
  echo "Start OrbStack (the OrbStack.app) and re-run this script." >&2
  cat /tmp/windward-docker-version.out >&2
  exit 1
fi

cat /tmp/windward-docker-version.out
echo
echo "OrbStack Docker daemon is up."
