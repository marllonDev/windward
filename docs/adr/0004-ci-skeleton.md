# ADR-0004 — CI skeleton

- **Status:** Accepted
- **Date:** 2026-10-28
- **Decider:** DevOps Engineer
- **Related:** [ADR-0001 — Monorepo scaffold](0001-monorepo-scaffold.md)

## Context

M0-1 left the repository scaffold-only: directories and pinned toolchain
files, no application code, no Dockerfiles, no package manifests. CI still
needs to run lint, test, and build on every change, stay green on this
scaffold, fail on a deliberately broken commit, use no cloud account or paid
resource, and have a documented local equivalent for each check.

With no application code yet, "lint", "test", and "build" can't mean the
usual per-language checks. They're scoped to what the scaffold actually
contains today:

- **lint** — shellcheck on `scripts/*.sh`, actionlint on the workflow file
  itself, and a custom check that the toolchain pin files
  (`rust-toolchain.toml`, `.nvmrc`, `.python-version`) are exact versions,
  not floating tags.
- **test** — the scaffold's own invariants from ADR-0001: the required
  directories exist and the toolchain pin files are present and non-empty.
- **build** — `scripts/bootstrap.sh`, the one build-equivalent artifact
  that exists: the OrbStack Docker-daemon preflight check every later
  build will depend on.

## Decision

- One script per step (`scripts/ci-lint.sh`, `scripts/ci-test.sh`,
  `scripts/ci-build.sh`), run in sequence by `scripts/ci.sh`. This is the
  single source of truth for what "CI" means; it is also the local
  equivalent, so there is no drift between what runs locally and what runs
  in GitHub Actions.
- `.github/workflows/ci.yml` runs the same three scripts as three jobs, on
  `ubuntu-24.04` (an exact runner image, not `ubuntu-latest`). GitHub
  Actions is free at this scale and requires no new cloud account beyond
  the GitHub hosting the repository would already need for review; it is
  not provisioned or exercised by this change, since the repository has no
  remote yet.
- Actions used in the workflow are pinned to exact version tags
  (`actions/checkout@v4.2.2`), and `actionlint` is installed in CI at the
  same exact version (1.7.12) used locally, consistent with the no-floating
  -tags policy from ADR-0001.
- Each script extends in place as real content lands: `ci-lint.sh` gains
  per-language linters, `ci-test.sh` gains real test runners, `ci-build.sh`
  gains image builds, once `apps/web`, `services/api`, `engine/`, and
  `dbt/` have content.

## Consequences

- CI is honest about the milestone: it is green because the scaffold
  invariants hold, not because of placeholder checks that always pass.
- The `build` job requires a reachable Docker daemon. On GitHub-hosted
  runners and on the owner's machine with OrbStack running, it passes; if
  Docker is unreachable, it fails loudly with the same message a developer
  would see, by design — it never mocks the result.
- Because the repository has no git remote yet, the workflow file is
  configuration that will execute once pushed; `scripts/ci.sh` is what is
  actually run and verified today.
