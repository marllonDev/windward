# ADR-0002 — Overall architecture

- **Status:** Accepted
- **Date:** 2026-10-27
- **Decider:** Solution Architect
- **Informs:** Platform Engineer, dbt Platform Engineer, Frontend Engineer, DevOps Engineer, QA Engineer
- **Related:** [ADR-0003 — Sail interface choice per consumer](0003-sail-interface-choice-per-consumer.md)

## Context

Windward is a self-hostable data platform for a single user on their own machine.
A browser shell gives the user a SQL console, a catalog browser, query history, a
dbt project panel, and an engine status view. Compute is the Sail engine
(`lakehq/sail`, Apache-2.0, Rust, Spark-compatible). Transformation is dbt 2
(`dbt-labs/dbt`, Apache-2.0, Rust, GA 2026-09-14). Neither engine is ours; both
move fast. The whole product ships as containers that come up with one command on
OrbStack.

Five things exist at runtime and they have to be separated on purpose, because the
team building them is also separated: five engineers, each owning one surface,
each needing to work without reading the others' code.

Constraints that shape this decision:

- **v0 is single-user and has no authentication.** No multi-tenancy, no SSO, no
  RBAC, no audit logging. This is explicitly out of scope, so the architecture
  must not pay for it — but it also must not make adding it later a rewrite.
- **The engines are pinned dependencies, not code we maintain.** Sail is consumed
  as released; we do not patch or fork it. (The dbt adapter is the one exception,
  and it is argued in ADR-0003 and in "Dissent" below.)
- **The engine must be invisible.** No JVM, no Spark install, no manual start
  step. Something in our layer has to own the engine process lifecycle.
- **The product must look and behave finished,** including the unhappy paths: a
  dead engine, a cancelled query, a failed dbt model, a result set too large to
  render. Those paths are architectural, not cosmetic — they decide where state
  lives and who detects failure.
- **The toolchains are pinned:** Rust 1.83.0, Python 3.12.7, Node 22.11.0
  (`rust-toolchain.toml`, `.python-version`, `.nvmrc`).

## Options considered

### Option A — Browser shell, Python platform API, supervised engine processes (chosen)

A Next.js shell talks REST and WebSocket to a FastAPI service. That service is the
only thing that talks to Sail (over the two gRPC interfaces, per ADR-0003), the
only thing that invokes the dbt 2 CLI, and the only writer of platform state.

### Option B — One Rust backend, Sail embedded in-process

Build the platform API in Rust and link Sail as a library rather than supervising
it as a process. Truly "Rust-native" end to end, one process, no gRPC hop.

Rejected. It couples our release to Sail's internal Rust API rather than to its
stable wire protocols, which is the opposite of what a consumer of a 0.7.x
dependency should do: a Sail minor version could break our build instead of
merely our calls. It also makes engine death indistinguishable from platform
death — we would lose the "detect, report, restart" behavior the product needs —
and it forfeits the mature Python client libraries for both Spark Connect and
ADBC. The gRPC hop is local and carries Arrow batches; it is not the bottleneck.

### Option C — Browser talks directly to Sail

Let the shell speak Spark Connect or Flight SQL from the browser (gRPC-web or a
proxy), with a thin API only for persistence.

Rejected. It publishes an unauthenticated engine to anything running in the
browser's origin, spreads session lifecycle and cancellation across two codebases,
and makes the frontend depend on Sail's protocol version. It would also mean no
single place to cap, spool, and page large result sets.

### Option D — Option A plus a broker and worker tier

Add Redis plus a task queue so queries and dbt runs execute in workers.

Rejected for v0 as premature. One user, one machine, no scheduled jobs: there is
nothing to queue. It adds two services to the container set and a second source of
truth for run state. If scheduling ever enters scope, it enters as a new ADR.

### Option E — Option A with the platform API also reading data files directly

Let the API read Parquet and Delta directly (via Arrow or DuckDB) for catalog
listings and small previews, bypassing the engine.

Rejected. It produces two implementations of "what is in this table" that will
disagree on types, partitioning, and Delta snapshot semantics, and it is exactly
the kind of convenience that makes the honest reporting of Sail's limitations
impossible. One engine, one answer.

## Decision

**Option A.** Five components, one direction of control, explicit boundaries.

```
                   Browser (Next.js shell)                    apps/web
                             |
                  REST + WebSocket, /api/v1
                             |
                 Platform API (FastAPI, Python)            services/api
                             |
    +------------------------+-------------------------+
    |                        |                         |
 Spark Connect           Flight SQL          process exec + artifacts
 gRPC :50051             gRPC :32010                   |
    |                        |                         |
    +---- Sail engine (Rust, supervised) ----+     dbt 2 (Rust CLI)   dbt/
         one process, two listeners          |          |
                    |                        +-- ADBC Flight SQL :32010
                    |                                   |
            Data: local FS / S3-compatible / Delta Lake
```

### What each component owns

| Component | Location | Owns | Must not |
| --- | --- | --- | --- |
| **Browser shell** | `apps/web` | Rendering, client-side state, routing, the design system, all user-facing error presentation | Talk to Sail or dbt; read the filesystem; hold authoritative state |
| **Platform API** | `services/api` | The HTTP/WS contract; engine supervision; session lifecycle; query submit, cancel, paging; catalog reads; history and saved queries; dbt invocation and artifact parsing; OpenAPI | Execute SQL itself; read user data files; be bypassed by the shell |
| **Sail engine** | `engine/` (pin, config, entrypoint) | SQL execution, Arrow results, storage access, its own catalog | Be patched or forked; be started manually by the user; be reached from the browser |
| **dbt 2 process** | `dbt/` (seeded project, profile template, adapter pin) | Transformation: compiling and materializing models, tests, artifacts | Be long-running; hold platform state; be invoked by the shell |
| **Data sources** | user-configured | The actual data | Be written by the platform API |

### Allowed edges

These are the only permitted runtime calls. Anything else is a boundary
violation and a blocking review finding.

1. Browser → Platform API (REST + WebSocket, `/api/v1` only).
2. Platform API → Sail, Spark Connect `:50051` (interactive query path).
3. Platform API → dbt 2 CLI (subprocess: argv in, exit code + stdout/stderr out).
4. dbt 2 (via our `sail` adapter) → Sail, Flight SQL `:32010`.
5. Sail → data sources. dbt 2 → data sources through Sail only.
6. Platform API → dbt artifact directory (read-only).

The platform API does **not** call Flight SQL `:32010` for query execution. Its
only business with that port is a liveness probe for engine status.

### Platform API internal modules

One module per boundary, so the engineers do not collide:

- `engine/` — process supervision (start, health, death detection, restart,
  backoff) and the `EngineClient` interface. **Every call into Sail goes through
  `EngineClient`.** No call site elsewhere may import a Spark Connect or Arrow
  Flight symbol. This is what makes the transport decision in ADR-0003 reversible.
- `query/` — sessions (create, reuse, idle expiry, kill), submit, cancel, the
  result spool, and paging.
- `catalog/` — database, table, and column listings, served through `EngineClient`.
- `store/` — SQLite access for history, saved queries, and dbt run records. The
  platform API is the single writer.
- `dbt/` — the dbt process runner (one run at a time, cancel by process kill, log
  streaming) and the artifact reader. **The runner sits behind a `DbtRunner`
  interface and the artifact reader behind an `ArtifactReader` interface**, for the
  reason given under "Dissent".
- `api/` — routers, request and response schemas, OpenAPI generation, error
  mapping. The only module the shell's contract depends on.
- `ws/` — WebSocket channels for result streaming and dbt log streaming.

### State ownership

| State | Writer | Reader |
| --- | --- | --- |
| SQLite (`history`, `saved_queries`, `dbt_runs`) | Platform API only | Platform API |
| Result spool (large result sets, local Parquet) | Platform API | Platform API |
| dbt artifacts (dbt 2 writes Parquet) | dbt 2 process | Platform API, read-only |
| Warehouse / table data | Sail and dbt | Sail |
| Engine configuration | Platform API, at engine start | Sail |
| Client UI state | Browser | Browser |

There is exactly one SQLite writer. No file is written by two components.

### Process and network model

- One container per component: shell, platform API (which supervises Sail as a
  child process and invokes dbt as a short-lived subprocess), and the data volume.
  DevOps owns the exact composition; this ADR fixes only that **the platform API
  is the parent of the engine process**, so engine death is observable without
  polling an orchestrator.
- **Only the platform API port and the shell port are published to the host.**
  `:50051` and `:32010` stay on the internal container network. v0 has no
  authentication, so an engine port reachable from the host is a security defect,
  not a convenience.
- Port numbers are configuration with the defaults in ADR-0003. They are read
  once at startup and passed to `EngineClient` and to the dbt profile; no call
  site hardcodes them.
- Sail version, dbt 2 version, and all base images are pinned to exact versions.
  A floating tag is a defect (DevOps owns enforcement).

### Failure domains

- **Engine death is a normal condition.** The platform API detects it, surfaces it
  through engine status, fails in-flight queries with a typed error the shell can
  render, and restarts with backoff. Sessions do not survive an engine restart;
  the API reports them as lost rather than silently recreating them.
- **A failed dbt run is a successful API call** returning a failed run record.
  Non-zero exit is data, not an exception.
- **Platform API death** takes the engine with it (child process) and the shell
  shows a disconnected state. Acceptable for v0.
- **Large result sets** are capped and spooled by the platform API. The shell
  never receives an unbounded stream. The cap is a contract value, set in M2.

### Contract rules

- The HTTP and WebSocket contract is versioned at `/api/v1` and published as
  OpenAPI from `services/api`.
- The contract is **frozen before the Frontend Engineer starts M3**, so the shell
  can be built against a mock. That freeze is M2's deliverable, defined in a later
  ADR — not in this one.
- After the freeze, a change is additive or it is a new version. Silent mutation
  of a frozen field is a blocking review finding.

## Consequences

**Good**

- Each engineer owns one directory and one boundary. The Frontend Engineer never
  needs to know which Sail interface is in use; the Platform Engineer never needs
  to know how dbt artifacts are rendered.
- The two fast-moving dependencies are reached only through wire protocols, behind
  one interface each (`EngineClient`, `DbtRunner`). An upstream change lands in one
  module, not across the codebase.
- Engine supervision lives with the component that has a reason to care, which is
  what makes "the engine is invisible" and "engine death is reported honestly" both
  implementable.
- One catalog code path means the catalog browser and the console cannot disagree.

**Costs, accepted**

- **The platform API is Python, not Rust.** See "Dissent" — this is a deliberate
  trade and it has a marketing consequence we must not lie about.
- The API is a single process doing supervision, streaming, and persistence. It is
  a bottleneck by design. For one user that is correct; for anything concurrent it
  is the first thing to split.
- A local gRPC hop and a result spool add latency and disk I/O versus embedding.
  Measured against the alternative of breaking on Sail minor releases, this is
  cheap.
- No authentication means the deployment model is part of the security model. The
  internal-network rule above is load-bearing, and QA should verify that
  `:50051` and `:32010` are not reachable from the host.
- Sessions are not durable. An engine restart loses them, and the shell must have
  a state for that.

## Dissent

Two places where I do not agree with the approved direction. Both are recorded
here rather than omitted, and in both cases the approved direction is what this
ADR specifies — with the architecture arranged so a reversal is cheap.

**1. "Rust-native" describes the engines, not our layer.** The compute engine and
the transformation engine are Rust; our platform API is Python 3.12 on FastAPI,
and our shell is Node. I support that choice on the merits — the Python client
libraries for Spark Connect and ADBC are the boring, well-trodden option, and a
Rust control plane would buy performance we do not need at one user while costing
velocity we do need. But "Rust-native data platform" in user-facing copy, without
qualification, is a claim about our code that is not true. Recommendation: say
"Rust-native compute", or "no JVM, no Python runtime in the query path" — both are
true and both are the thing a user actually cares about. The Requirements Analyst
owns the wording; this ADR flags the inaccuracy.

**2. Committing v0 to a fork of `dbt-labs/dbt` is the largest risk in the plan,
and I would not take it in v0.** dbt v2 does not support out-of-tree adapters, so
a `sail` adapter means maintaining a fork of a GA Rust monorepo that is moving
fast, and rebasing it for the life of the product. That is precisely the opposite
of "our layer should be the predictable part". The user-visible v0 feature — run
dbt from the panel, stream logs, show per-model status and lineage — is identical
whether the runtime underneath is the Rust engine with our adapter or
`lakehq/dbt-sail` (Python, dbt 1.8+, works against Sail today). My recommendation
would have been: ship the Python adapter in v0, pursue the Rust adapter upstream
on its own track, and switch when it merges.

The CEO's decision is Rust-first with a time-boxed M1.5 spike as the gate, and the
reasoning — that the Rust path is the differentiator and the spike bounds the
risk — is legitimate. So this architecture implements it, and pays for the
disagreement with two cheap interfaces instead of an argument:

- `DbtRunner` abstracts how a dbt invocation happens, so swapping the Rust CLI for
  the Python one does not touch the API layer or the shell.
- `ArtifactReader` abstracts artifact parsing, because **this is not a cosmetic
  swap: dbt 2 writes artifacts as Parquet and dbt 1.8 writes JSON.** Any code that
  assumes Parquet artifacts outside `ArtifactReader` makes the fallback a rewrite.
- The fallback also changes which Sail port dbt uses — `:50051` instead of
  `:32010`. See ADR-0003, "Swap surface".

If the M1.5 spike fails, the decision returns to the CEO, and the cost of taking
the fallback should be two implementations behind two interfaces, not a
re-architecture. If it fails a second time, I will argue for the Python path
again, in writing.
