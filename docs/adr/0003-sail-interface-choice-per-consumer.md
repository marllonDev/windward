# ADR-0003 — Sail interface choice per consumer

- **Status:** Accepted
- **Date:** 2026-10-27
- **Decider:** Solution Architect
- **Informs:** Platform Engineer, dbt Platform Engineer
- **Related:** [ADR-0002 — Overall architecture](0002-overall-architecture.md)

## Context

Sail exposes two network interfaces, both already running inside the engine
process (`engine/` owns the pin and entrypoint per ADR-0002):

- **Spark Connect**, gRPC, default port `50051`. Session-oriented: a client
  opens a session, submits a logical plan or SQL string, gets back Arrow
  batches, and can cancel in-flight work against that session. This is the
  protocol the Spark ecosystem (and most mature client libraries) targets.
- **Arrow Flight SQL**, gRPC, default port `32010`. Statement-oriented: a
  client prepares a statement, executes it, and reads an Arrow stream back
  through the Flight `DoGet` call. This is the protocol ADBC and most BI/ETL
  tooling targets, and it is what dbt adapters built on ADBC expect.

There are two consumers inside the platform API (ADR-0002, `engine/` module,
behind `EngineClient`), and they have different shapes of work:

1. **The interactive query path** — the SQL console and catalog browser. A
   human runs a query, waits, looks at a page of results, sometimes cancels,
   sometimes runs several queries against the same warmed-up state in a row.
2. **The dbt adapter** — `dbt/`'s `sail` adapter (Rust, per ADR-0002
   "Dissent", with Python as the time-boxed fallback). dbt issues one
   statement per model run: compile, execute, materialize, move on. There is
   no human waiting on it and no session to reuse across models beyond what
   dbt itself threads through.

Both interfaces can technically execute arbitrary SQL against Sail. The
question is not "which protocol works" — both do — it is which one is the
boring, predictable choice for each consumer's actual access pattern.

## Options considered

### Option A — Spark Connect for the query path, Flight SQL for the dbt adapter (chosen)

Each consumer uses the interface shaped like its workload: sessions for the
interactive path, single statements for the batch path.

### Option B — Flight SQL for both

One protocol, one client library, one thing to debug. ADBC has first-class
Python and Rust bindings, so both the platform API and a Rust dbt adapter
could share it.

Rejected for the query path. Flight SQL has no native concept of a
long-lived interactive session with server-side cancellation of a specific
in-flight statement by session id — cancellation in ADBC is
connection/handle-scoped, which is a worse fit for "cancel this one query the
user is tired of waiting for" than Spark Connect's session and operation
model. Building session semantics on top of Flight SQL ourselves is exactly
the kind of custom layer ADR-0002 says we should not own. We would be
reinventing what Spark Connect already gives us for free.

### Option C — Spark Connect for both

Standardize on the session-oriented protocol everywhere, including the dbt
adapter.

Rejected. dbt's adapter ecosystem is built around ADBC/Flight SQL semantics
(prepare, execute, fetch a result set, done) — that is the shape `dbt-labs`
assumes for the Rust adapter interface, and it is the shape `lakehq/dbt-sail`
already uses for the Python fallback (ADR-0002 "Dissent," item 2). Forcing
Spark Connect onto the dbt path means writing and maintaining a session
lifecycle inside the adapter for a consumer that has no use for one — one
model, one statement, no reuse — which is work with no payoff and a second
place our code can drift from the protocol's intended use.

### Option D — Let each engineer pick per call site

No platform-wide rule; Platform Engineer and dbt Platform Engineer each
choose whatever client library is convenient when they write the code.

Rejected. This is the option that turns our layer into the unpredictable
part. Both interfaces are capable enough that "whatever's convenient" would
produce inconsistent behavior across the two call sites, two sets of
assumptions about session handling, and a support burden when they disagree.
The point of an ADR here is to remove this decision from individual PRs.

## Decision

**Option A.**

| Consumer | Interface | Port | Reasoning |
| --- | --- | --- | --- |
| Interactive query path (`query/`, via `EngineClient`) | Spark Connect | `50051` | Matches the workload: a session the user keeps across several queries, server-side cancel of one in-flight operation, Arrow batches paged back through the platform API's result spool. |
| dbt adapter (`dbt/`'s `sail` adapter) | Arrow Flight SQL | `32010` | Matches the workload: one prepared statement per model, no session to keep warm, and the protocol dbt's own adapter ecosystem (and the Python fallback `lakehq/dbt-sail`) already assumes. |

Both ports are internal-only per ADR-0002 ("Only the platform API port and
the shell port are published to the host"). Neither is reachable from the
browser or from the host network.

Every call from the platform API into Spark Connect goes through
`EngineClient` (ADR-0002, `engine/` module) — no other call site imports a
Spark Connect symbol. The dbt adapter's Flight SQL calls are entirely inside
`dbt/`; the platform API does not execute queries over `:32010`, it only
probes it for liveness (ADR-0002, "Allowed edges").

Default ports (`50051`, `32010`) are read once at startup from configuration,
per ADR-0002 — no call site hardcodes them.

### Swap surface

If the M1.5 Rust `sail` dbt adapter spike fails and the platform falls back
to `lakehq/dbt-sail` (Python, dbt 1.8+), the dbt adapter still speaks Flight
SQL to Sail — `lakehq/dbt-sail` is itself ADBC/Flight-SQL-based. The port and
protocol for the dbt path do not change on that fallback; what changes is the
process that owns the adapter (Rust CLI vs. Python package) and the artifact
format it writes (Parquet vs. JSON, handled by `ArtifactReader` per
ADR-0002 "Dissent"). This decision is therefore stable across that fallback
and does not need to be revisited if M1.5 fails.

## Consequences

**Good**

- Each consumer uses the protocol its own client ecosystem already assumes,
  so neither the Platform Engineer nor the dbt Platform Engineer builds
  session or cancellation semantics the protocol doesn't natively support.
- `EngineClient` is the only place that knows the query path uses Spark
  Connect. If Sail ever changes its recommended interactive protocol, one
  module changes.
- The dbt adapter's protocol choice is unaffected by the M1.5 Rust-vs-Python
  outcome, so this ADR does not need a conditional decision or a follow-up.
- Two protocols, two ports, no shared client code between them — a bug in one
  path's gRPC handling cannot silently corrupt the other's.

**Costs, accepted**

- Two gRPC client stacks instead of one: more dependencies, two sets of
  version pins to track against Sail releases, two things that can break on
  a Sail minor bump instead of one.
- The platform API cannot reuse a single generic "run SQL against Sail"
  helper across both consumers; `EngineClient` and the dbt adapter are
  genuinely separate code paths, by design, with no shared abstraction
  layer between them beyond the Sail server they both ultimately call.
- If a future consumer needs both session reuse and prepared-statement
  batching, it will not map cleanly onto either existing client and will
  need its own ADR rather than slotting into this table.
