# ADR-0007 — Jobs, and dbt 2 projects on DuckDB

- **Status:** Accepted
- **Date:** 2026-10-30
- **Decider:** Owner
- **Related:** [ADR-0002](0002-overall-architecture.md), [ADR-0006](0006-dbt-runner-and-shared-session.md)

## Context

The shell ran dbt 1.x (`dbt-core` + `dbt-sail`) because dbt 2 has no Sail adapter
(ADR-0006). The owner asked for real dbt 2 projects and for a Databricks-style place
to define Jobs, with the engines allowed to be independent but able to meet in a Job.

dbt 2.0.8 ships a native DuckDB adapter. Running it end to end in the API image
produced a working build plus `manifest.json` and `run_results.json`.

## Decision

- **dbt 2 projects are a separate, independent engine.** Each project lives in
  `<data>/dbt2/projects/<name>` and builds into `<data>/dbt2/warehouse/<name>.duckdb`.
  The API writes the `profiles.yml`, runs the `dbt2` binary as a subprocess (one run
  per project at a time), reads the manifest for lineage, and browses the warehouse
  read-only with the `duckdb` Python package. The UI is a small IDE: file tree, editor,
  run and logs, lineage, and a DuckDB query box.
- **Jobs are DAGs of typed tasks**, stored in SQLite with their run history:
  `sql` (Sail), `notebook` (cells in order), `python` (PySpark on Sail), `dbt_sail`
  (dbt 1.x on Sail) and `dbt2` (a dbt 2 project on DuckDB). Independent tasks run
  concurrently; a failed task skips its downstream tasks and fails the run; runs can be
  cancelled; each task has a timeout. This is where Sail and dbt 2 meet, without
  either knowing about the other.
- **Schedules are 5-field cron in UTC** (`croniter`), checked every 15 s. A run is
  skipped while the previous run of the same job is still going, and missed ticks are
  not replayed after a restart. Runs left "running" by a restart are marked failed.
- Definitions are validated when saved (unique keys, known dependencies, no cycles,
  required config per type, valid cron), not when they fire.

## Consequences

- dbt 2 and Sail still cannot share tables. A Job can order them, not join them.
- The scheduler lives in the API process; there is no worker tier (ADR-0002 option D
  stays rejected for v0).
- Python and notebook tasks run unsandboxed (see KNOWN-LIMITATIONS).

## Addendum — run control and parameters (2026-10-30)

- **Retries** per task (up to 5, with a delay), **continue-on-failure** so a
  non-critical task does not stop the graph, and a per-task **timeout** that marks the
  attempt failed.
- **Parameters**: a job declares names with defaults; a run may override them; task
  SQL, Python and dbt selectors substitute `{{ name }}` before the task starts.
  Unknown names are left untouched rather than erroring, so a stray `{{ }}` in SQL is
  not a trap.
- **Run from here** sends `only: [key]`; the runner expands it to that task plus
  everything downstream, because running one task alone would leave its dependants
  stale.
- Runs are stored with their parameters, each task's attempt number and timings, which
  is what the run timeline draws.
