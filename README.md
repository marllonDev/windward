# Windward

Windward is a self-hostable, Rust-native data platform built on the
[Sail](https://github.com/lakehq/sail) compute engine and
[dbt 2](https://github.com/dbt-labs/dbt) (the Rust rewrite, not
`dbt-labs/dbt-core`). See `NOTICE` for third-party attribution.

v0 targets a single developer/demo environment running on
[OrbStack](https://orbstack.dev) on the owner's machine. There is no
cloud account and no infrastructure spend for v0.

## Repository layout

```
apps/web        Next.js web shell
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

## Run the stack

```sh
docker compose up --build
```

Then open **http://localhost:3000**. Everything runs in containers:

| Service | What it is | Published |
|---|---|---|
| `web` | Next.js shell: SQL console, catalog, query history, dbt panel, engine status | `3000` |
| `api` | Platform API (FastAPI). Supervises the Sail engine, runs dbt, serves `/api/v1` (docs at `/docs`) | `8000` |

Sail's Spark Connect (`50051`) and Flight SQL (`32010`) ports live inside the `api`
container and are never published. The seeded dbt project is in `dbt/`: open the
**dbt project** tab and press **dbt build**, then query `demo.route_summary` in the
SQL console. dbt 2.0.8 is installed in the image, but the project runs on the
`dbt-sail` runner because dbt 2 has no Sail adapter (`docs/adr/0006`).

## What you can do

- **SQL console.** Tabbed editor, Ctrl/⌘+Enter, run a selection, **Explain** plans, **Save** queries, results as a table or a bar/line/pie **chart**, **CSV export**.
- **Notebooks.** SQL, Python (PySpark with `spark` ready and variables kept between cells) and Markdown cells; Run all, Shift+Enter, autosave, restartable kernel. Stored in SQLite on the data volume.
- **Catalog and uploads.** Browse databases and tables, see columns, a 100-row preview and table details, and **upload a CSV, TSV, JSON, JSON Lines or Parquet file** to get a queryable `uploads.<name>` table.
- **dbt project.** Seed, run, test and build from the browser, follow streaming logs and the lineage graph. The demo project builds automatically on start.
- **Engine status.** Live state of the supervised Sail processes, restarts and log tails.

Stop with `docker compose down` (add `-v` to drop the data volume).

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
