# ADR-0006 — dbt runner for M3/M4, web shell, and the shared Sail session

- **Status:** Accepted
- **Date:** 2026-10-29
- **Decider:** Owner
- **Related:** [ADR-0002](0002-overall-architecture.md), [ADR-0003](0003-sail-interface-choice-per-consumer.md), [ADR-0005](0005-dbt-2-license-verification.md)

## Context

The owner asked for the full stack in Docker: Sail, dbt 2, and a web UI. Three
facts found while building it shaped the result:

1. dbt 2.0.8 (`dbt-labs/dbt`) ships a prebuilt Rust CLI, but its adapter set is
   fixed (Snowflake, BigQuery, Databricks, Redshift, Postgres, DuckDB) and it has
   no Sail adapter. ADR-0002 "Dissent" had already warned about this.
2. `lakehq/dbt-sail` 0.1.0 (Python, dbt-core 1.8+) works against Sail 0.7.2 over
   Spark Connect.
3. Sail's catalog is in-memory and scoped to a Spark Connect session.

## Decision

- **Both dbt distributions are installed.** The API image carries dbt 2.0.8
  (pinned by version and SHA-256, installed as `dbt2`) and a venv with
  `dbt-core` 1.12.6 + `dbt-sail` 0.1.0 (installed as `dbt`). The platform API's
  `DbtRunner` executes the latter, because only it can reach Sail. This is the
  ADR-0002 fallback, taken now rather than later.
- **dbt runs as a subprocess of the API**, one run at a time, with logs polled
  over `GET /api/v1/dbt/runs/{id}?after=N` (polling instead of WebSocket for v0).
- **The web shell is Next.js** (`apps/web`), proxying `/api/*` to the API through
  `next.config.mjs` rewrites, so the browser talks to one origin and no engine
  port is exposed.
- **One shared Spark Connect session id** (`WINDWARD_ENGINE_SESSION_ID`) is used
  by the API's query client and by the dbt profile, so models dbt builds appear in
  the SQL console and catalog browser.

## Consequences

- The UI works end to end today; swapping to dbt 2 later is a `DbtRunner` change.
- The shared session couples the console and dbt, and the catalog does not
  survive an engine restart. A persistent Iceberg REST catalog would remove both
  limits and is the next step if that matters.
- Query history lives in the browser (localStorage) until the API owns it.
- Recorded in `KNOWN-LIMITATIONS.md`.
