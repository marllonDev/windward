#!/usr/bin/env bash
# Creates (or refreshes) the Python environment the platform API and its
# integration suite run in, using the version pinned in .python-version.
#
# The engine comes from this same environment: `pysail` installs the `sail`
# CLI next to the interpreter, and the API spawns it from there (ADR-0002).
# Prints the interpreter path on the last line so callers can use it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

VENV_DIR="${WINDWARD_VENV:-.venv}"
PYTHON_VERSION="$(cat .python-version)"

if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv is not installed. See https://docs.astral.sh/uv/ ." >&2
  exit 1
fi

# The repository may live on a volume where hardlinking across filesystems
# fails; copying is slower but always works.
export UV_LINK_MODE=copy

uv python install "$PYTHON_VERSION" >&2
# `--allow-existing` keeps this script idempotent: without it `uv venv` refuses
# to touch a directory that is already there, so every run after the first one
# fails. uv still repoints the environment at $PYTHON_VERSION, and the
# `uv pip install` below refreshes the dependencies either way.
uv venv --python "$PYTHON_VERSION" --allow-existing "$VENV_DIR" >&2
uv pip install --python "$VENV_DIR/bin/python" --editable "services/api[test]" >&2

echo "$PWD/$VENV_DIR/bin/python"
