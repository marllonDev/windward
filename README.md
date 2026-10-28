# Windward

Windward is a self-hostable, Rust-native data platform built on the
[Sail](https://github.com/lakehq/sail) compute engine and
[dbt](https://github.com/dbt-labs/dbt-core) 2. See `NOTICE` for
third-party attribution.

v0 targets a single developer/demo environment running on
[OrbStack](https://orbstack.dev) on the owner's machine. There is no
cloud account and no infrastructure spend for v0.

## Repository layout

```
apps/web        frontend
services/api    backend API
engine/         Sail integration
dbt/            seeded dbt 2 project, profile template, sail adapter pin
docs/adr/       architecture decision records
docker/         container build context (Dockerfiles, compose)
scripts/        dev tooling
```

## Pinned toolchains

Exact versions, not floating tags:

| Toolchain | Version | File |
|---|---|---|
| Rust | 1.83.0 | `rust-toolchain.toml` |
| Python | 3.12.7 | `.python-version` |
| Node | 22.11.0 | `.nvmrc` |

## Bootstrap

Prerequisite: [OrbStack](https://orbstack.dev) installed and running.
That is the only manual step.

```sh
git clone <this-repo>
cd windward
./scripts/bootstrap.sh
```

`scripts/bootstrap.sh` checks that the OrbStack Docker daemon is
reachable (`docker version`) and fails with a clear message if it is
not — it does not fall back to another Docker context or mock the
result.

This is re-verifiable from clean: delete all Docker volumes and OrbStack
VM state, start OrbStack, and re-run `./scripts/bootstrap.sh`.

At this milestone (M0) the repository is scaffold and configuration
only — no `docker-compose.yml` or Dockerfiles exist yet, so
`docker compose up` is not yet available. That lands in a later
milestone once `apps/web`, `services/api`, `engine/`, and `dbt/` have
real content; this README will be updated at that point to document the
single `docker compose up` command for the full engine/API/web/seed-data
stack.

## CI

`.github/workflows/ci.yml` runs three jobs — lint, test, build — on every
push and pull request. Each job is a thin wrapper around a script you can
run yourself; there is no check that only exists in CI:

| CI job | Local equivalent | What it checks |
|---|---|---|
| lint | `./scripts/ci-lint.sh` | shellcheck on `scripts/*.sh`, actionlint on the workflow file, no floating toolchain-version tags |
| test | `./scripts/ci-test.sh` | the scaffold layout and toolchain pin files from `docs/adr/0001` exist |
| build | `./scripts/ci-build.sh` | `scripts/bootstrap.sh` — the OrbStack Docker-daemon preflight check |

Run everything at once with `./scripts/ci.sh`. See `docs/adr/0004` for why
these particular checks and why nothing more at this milestone, and
`docs/adr/0001` for the pinning policy the lint job enforces.

The `build` job needs a reachable Docker daemon — on GitHub-hosted
runners this is already there; locally, start OrbStack first.

## License

Apache License 2.0. See `LICENSE`. Third-party attribution for Sail and
dbt is in `NOTICE`.
