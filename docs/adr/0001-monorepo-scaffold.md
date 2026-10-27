# ADR 0001: Monorepo scaffold and pinned toolchains

## Status
Accepted

## Context
Windward is the first task in the repository (M0-1). Before any product
code is written, the repository layout and toolchain versions need to be
fixed so later tasks build on stable ground. v0 targets OrbStack on the
owner's machine only; there is no cloud account and no infrastructure spend.

## Decision
- Single monorepo with top-level directories: `apps/web` (frontend),
  `services/api` (backend API), `engine/` (Sail integration), `dbt/`
  (forked dbt 2 + `sail` adapter), `docs/adr` (architecture decisions),
  `docker/` (container build context), `scripts/` (dev tooling).
- Exact toolchain versions are pinned in checked-in files rather than
  floating tags:
  - Rust: `rust-toolchain.toml` → 1.83.0
  - Python: `.python-version` → 3.12.7
  - Node: `.nvmrc` → 22.11.0
- License is Apache-2.0 (`LICENSE`), matching the upstream projects
  Windward depends on (Sail, dbt). Third-party attribution lives in
  `NOTICE`.
- `scripts/bootstrap.sh` is the only required manual-adjacent step: it
  checks that the OrbStack Docker daemon is reachable and fails loudly
  (no workaround, no mocked output) if it is not.

## Consequences
- Later milestones that add Dockerfiles, docker-compose, and the
  Kubernetes profile build on this layout without renaming directories.
- Toolchain bumps are explicit, reviewed diffs to these pin files, not
  silent drift from floating tags.
