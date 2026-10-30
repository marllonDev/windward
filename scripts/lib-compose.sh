#!/usr/bin/env bash
# Resolves how to invoke Docker Compose on this machine into $COMPOSE.
#
# `docker compose` is the form the product documents, but the docker CLI finds
# its plugins under $HOME/.docker/cli-plugins, so a sandbox with a generated
# $HOME (CI container, agent runner) has the daemon but not the subcommand.
# The standalone `docker-compose` binary works there. Both drive the same
# docker-compose.yml.
#
# Sourced, not executed.

# shellcheck disable=SC2034 # read by the sourcing script
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "ERROR: neither 'docker compose' nor 'docker-compose' is available." >&2
  echo "Start OrbStack and make sure its CLI tools are on PATH." >&2
  exit 1
fi
