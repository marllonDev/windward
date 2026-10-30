# Known Limitations

Honest record of what the Windward environment, its upstream engines, or the
current milestone could not do, as discovered during QA verification. This
file is QA-owned (`TES-8`); entries are added as they are found and removed
only when the underlying constraint is actually resolved, not when it is
merely worked around.

## Environment

### OrbStack control socket fails under a deeply nested `$HOME`

`orb start` fails with `panic: listen vmcontrol: ... bind: invalid argument`
whenever `$HOME` resolves to a path long enough that
`$HOME/.orbstack/run/vmcontrol.sock` exceeds the ~104-byte `AF_UNIX` `sun_path`
limit on macOS. This is not a Windward defect — it is a property of OrbStack's
own socket placement — but it will bite any sandboxed agent runner (CI
container, QA harness, etc.) whose `$HOME` is itself a long generated scratch
path. Observed first on `TES-2`/flagged again on `TES-7` (`B3`) as the reason
`scripts/ci-build.sh`'s success path had never executed; confirmed again here
with a measured socket path of 171 bytes against this run's `$HOME`.

Workaround used for QA verification on `TES-8`: re-point `$HOME` to a short
path (e.g. `/tmp/orbhome`) for the duration of the OrbStack session only. This
let the real success path of `scripts/bootstrap.sh` execute and be observed
for the first time (see `TES-8` verdict for the transcript). On the product
owner's actual machine, `$HOME` is a normal user home directory and this
constraint should not apply — but any future CI runner or agent sandbox with
a similarly deep `$HOME`/`$TMPDIR` will hit the same failure and will need the
same workaround or a shorter sandbox home path.

### GitHub Actions workflow has never executed in CI

The repository has no git remote configured, so `.github/workflows/ci.yml`
has never run on GitHub's infrastructure. All CI-equivalent checks
(`scripts/ci-lint.sh`, `scripts/ci-test.sh`, `scripts/ci-build.sh`,
`scripts/check-toolchain-pins.sh`) have only been verified by running them
locally. This satisfies M0-5's "no cloud account, no paid resource" scope
constraint by construction, but it means the workflow YAML itself (runner
image, step ordering, caching) is unverified against a real Actions run.

## Upstream engines

### dbt 2 license verified, but no exact version is pinned yet

`NOTICE` and `README.md` previously attributed the product's dbt dependency
to `dbt-labs/dbt-core` (the archived Python implementation). This was
corrected (`TES-9`, commit `2e84102`): the actual dependency is
`dbt-labs/dbt`, confirmed Apache-2.0 at `main` and at the GA tag `v2.0.0`
(2026-09-14), with the carve-out that dbt Labs' separately sold proprietary
"dbt" product is not covered by this check — see `docs/adr/0005-dbt-2-license-verification.md`
for the full verification. Previously tracked as blocking finding `B1` on
`TES-7`; resolved as of this entry.

Residual, non-blocking gap: M0 is scaffold-only and pins no exact dbt 2
commit or tag anywhere in the repository. Whichever commit/tag actually
gets vendored in a later milestone should be re-checked against this ADR's
findings before vendoring, in case the license posture changes between now
and that pin.

### Sail and dbt 2 are not yet pinned to exact versions or vendored

M0 is scaffold-only: there is no Dockerfile, no `docker-compose.yml`, and no
actual Sail or dbt 2 dependency manifest yet. `scripts/check-toolchain-pins.sh`
enforces exact pins for Rust/Python/Node today but has nothing to enforce for
Sail/dbt base images until `docker/` gains real content in a later milestone
(noted as optional item `O4` on `TES-7`). Not a defect at M0 — scope as
designed — but recorded here so it is not mistaken for an oversight later.

### dbt 2 has no Sail adapter, so the Sail project runs on the Python `dbt-sail` runner

dbt 2 does run: dbt 2 projects (UI: "dbt 2 projects") build into DuckDB and are fully
independent from Sail. The paragraph below is about the bundled project that targets
Sail. A Job can run both, but they cannot share tables.

The dbt 2 Rust CLI (v2.0.8) is installed in the API image and reports its
version in the dbt panel, but it cannot target Sail: its built-in adapters are
Snowflake, BigQuery, Databricks, Redshift, Postgres and DuckDB, and it does not
support out-of-tree adapters. `dbt run/build/seed/test` from the shell therefore
execute on `dbt-core` 1.12.6 plus `dbt-sail` 0.1.0 (the fallback ADR-0002
"Dissent" recommended; see ADR-0006). Swapping to dbt 2 is a `DbtRunner` change
once a Sail adapter exists.

### Sail's catalog is per session; dbt and the console share one session id

Sail 0.7.2 keeps table metadata in an in-memory catalog scoped to a Spark
Connect session. dbt runs in a separate process, so by default its tables are
invisible to the SQL console. Windward pins one session id
(`WINDWARD_ENGINE_SESSION_ID`) that both the API's query client and the dbt
profile open, and the profile smuggles that id through the `host` field because
`dbt-sail` builds `sc://<host>:<port>` itself. Consequences: the catalog is lost
when the engine restarts (re-run `dbt build` to rebuild it), and the console and
dbt are one logical session, not isolated ones.

### Sail 0.7.2 cannot load a typed mixed-literal `INSERT ... VALUES`

dbt's seed loader failed with `Unsupported CAST from Decimal128(2, 1) to
Boolean` when the CSV mixed booleans and decimals. The demo seed therefore loads
every column as `string` and the staging model casts them.

### Python notebook cells are not sandboxed

Each notebook gets a persistent Python worker process inside the API container,
running as the unprivileged `windward` user with the shared Sail session as
`spark`. It can read and write anything that user can. That is acceptable for the
single-user, local, unauthenticated v0 (ADR-0002) and would not be for a shared
deployment. Cells time out after 120 s, which restarts the kernel and loses its
variables.

### Sail 0.7.2/0.7.3 quirks the shell works around (re-checked on 0.7.3)

- `CREATE TABLE ... USING csv OPTIONS (path ...)` ignores `header` and
  `inferSchema` and yields an empty schema; uploads use `LOCATION` instead.
- `DESCRIBE TABLE` returns no rows for file-backed tables, so the catalog reads
  the column list from `SELECT * ... LIMIT 0`.
- `DESCRIBE uploads.<table>` without the `TABLE` keyword is a parse error (it works for
  `demo.<table>`), so the shell always writes `DESCRIBE TABLE`.

### Sail drops an idle Spark Connect session after 15 minutes

Sail's `spark.session_timeout_secs` defaults to 900. When it fired, the shared
session id (see above) was gone for good ("session ... is not running"), which
made the SQL console, catalog and notebooks fail together and lost the catalog.
Windward now starts Sail with `SAIL_SPARK__SESSION_TIMEOUT_SECS=604800` (7 days;
set the variable yourself to change it), and if a session is still lost the API
moves to a new session id, resets notebook kernels, re-registers uploads and
re-runs `dbt build`. Python variables and objects created only in the old
session are not recoverable.

### Tabs and query history live in the browser

The console's open tabs and the query history are stored in `localStorage`.
Saved queries and notebooks are server-side (SQLite).

### Job scheduling is simple on purpose

Cron is UTC. The scheduler is a loop inside the API (15 s resolution): ticks missed
while the API was down are not replayed, a job whose previous run is still going is
skipped, and runs interrupted by a restart are marked failed. `dbt_sail` tasks share
one runner, so two Jobs queue on each other; dbt 2 projects run one at a time each.

### Cancelling a query interrupts it on the engine, not always instantly

`POST /api/v1/queries/{id}/cancel` tags the statement and calls Spark Connect's
`interruptTag`. Sail stops the operation at its next checkpoint, so a cancel is a
request, not a guarantee of an immediate stop, and the API answers `499
QUERY_CANCELLED` once the client sees the interruption. The console's Cancel button
cancels every statement currently running, because v0 has one session per user.

### Profiling reads the whole table

The catalog's column profile is one aggregate over the table (null counts, distinct
estimates, min/max). On a large table it costs a full scan, and the distinct count is
an estimate computed over the value cast to a string, because Sail 0.7.3 has no
`approx_distinct` for floating-point columns. The per-column statistics in a result
grid are different: those are computed in the browser over the rows on screen only.

## Product behavior

Not yet applicable: M0 ships no application code (`apps/web`, `services/api`,
`engine/`, `dbt/` are all placeholder directories). Engine integration,
unhappy-path behavior (cancelled query, dead engine, malformed SQL, empty
table, failed dbt model, large result set), and UI states are specified in
the design system and functional specification but have no running code to
exercise yet. This section will gain real entries starting at M1.
