# Plan — Rust-native data platform, v0 (revision 2)

Revision 2 incorporates your feedback of 2026-10-27: a real agent architecture
with one function per role (including design and requirements), native dbt 2
support, everything running inside OrbStack on your machine, and a product name.
Nothing is hired and no code is written until you authorize it.

## Goal

Build a self-hostable data platform product: a polished web application whose
default compute engine is **Sail** (the Rust-native, Spark-compatible engine
from the open-source project `lakehq/sail`, Apache-2.0), with **dbt 2** — the
new Rust-based dbt engine — as the first-class transformation layer on top of
it. Users open the app, browse their data, write Spark SQL, run dbt models, and
see results. No JVM, no Spark cluster, no Python dbt runtime required.

Modeled on [lakesail.com](https://lakesail.com), but with a transformation
story dbt users recognize.

## What we build and what we consume

LakeSail's moat is the engine itself — a Rust reimplementation of Spark's
execution layer. Reimplementing that is a multi-year, multi-team effort and is
**not** what this plan proposes. The same holds for dbt's Fusion runtime.

We consume both engines as dependencies and spend our effort on the layer that
is actually missing: the platform around them.

| Component | Origin | License | Our role |
|---|---|---|---|
| Sail engine (`pysail`, `sail`) | `lakehq/sail` | Apache-2.0 | Integrator: supervise, configure, expose |
| dbt 2 engine (`dbt`, Rust) | dbt Labs, dbt Core v2 | Apache-2.0 core (GA 2026-09-14) | Integrator: invoke, parse artifacts, visualize |
| `dbt-sail` adapter | `lakehq/dbt-sail` | Apache-2.0 | Consumer, possible upstream contributor |
| Platform API, shell, catalog, dbt panel, packaging | **us** | ours | Author |

Two consequences to record:

- **Branding is ours.** Apache-2.0 covers code, not trademarks. "LakeSail",
  "Sail", and "dbt" are other people's marks. Name proposal below.
- **We are an integrator, not the engine author.** Engine bugs and unsupported
  functions are upstream limitations that we surface honestly in v0, not things
  we patch.

## Product name

Nautical lineage (Sail), but unmistakably ours and pronounceable in Portuguese
and English.

| Candidate | Meaning | Note |
|---|---|---|
| **Jangada** (recommended) | Brazilian sailing raft | Brazilian identity, nautical, honest about the Sail heritage, distinct from LakeSail's marks, easy to say in both languages |
| **Velame** | A ship's full set of sails | Elegant, close to the engine metaphor without copying the word "Sail" |
| **Quilha** | Keel | "The thing that keeps you stable" — good for a platform |
| **Proa** | Bow of a ship | Shortest, fastest-sounding, most abstract |

I cannot clear a trademark. Before any public launch a real search is needed
(INPI in Brazil, USPTO/EUIPO if international) plus domain and GitHub-org
availability. For internal work, any of these is safe to adopt today.

## Scope — v0

**In scope**

1. **Core engine integration**
   - Sail Spark Connect server started and supervised by our backend, default
     engine, zero user configuration (`sail spark server --port 50051`, or
     `pysail.spark.SparkConnectServer` for in-process control).
   - Session lifecycle: create, reuse, idle-expire, kill. One session per
     workspace.
   - Query path: submit SQL -> execute on Sail -> stream typed, paged rows
     back. Cancel a running query.
   - Sources: local filesystem and S3-compatible object storage; Parquet, CSV,
     JSON, Delta Lake.

2. **Native dbt 2 integration**
   - Ship the Rust dbt 2 CLI inside the image; no Python dbt runtime in the
     default path.
   - Project panel: detect/mount a dbt project, run `dbt build|run|test`,
     stream logs into the UI, show per-model status.
   - Lineage/DAG view and model documentation read from dbt's artifacts. dbt 2
     writes artifacts as **Parquet**, which means Sail can query them directly
     — the platform's own metadata becomes queryable data.
   - A seeded example dbt project that transforms the demo dataset, so the
     feature is demonstrable on first launch.
   - **Engine routing decision — needs a spike (M1.5), see Risks.** dbt 2's
     Rust engine currently supports BigQuery, Databricks, Redshift, Snowflake,
     DuckDB (built in), Spark (beta, CLI-only) and ClickHouse (private beta).
     There is **no Sail adapter for the Rust engine yet**. Three candidate
     paths, in order of preference:
     - **A.** dbt 2 Rust CLI + its Spark adapter pointed at Sail's Spark
       Connect endpoint. Best outcome: Rust end to end. Unproven.
     - **B.** dbt 2 Rust CLI + its built-in DuckDB adapter for the dbt demo,
       Sail for interactive Spark workloads. Rust end to end, two engines,
       works today.
     - **C.** `dbt-sail` (Apache-2.0, Python, wraps `dbt-spark`, dbt >= 1.8,
       `mode: embedded|remote`, port 50051). Guaranteed to work against Sail
       but reintroduces the Python dbt runtime — a fallback, not the goal.
     The spike runs path A first and reports in one day of work; whatever it
     finds, v0 ships a working dbt experience.

3. **Platform API**
   - FastAPI backend over: sessions, queries, result pages, query history,
     catalog (databases -> tables -> columns), dbt project/runs/artifacts,
     engine health and version.
   - Persistence in SQLite (upgradeable to Postgres) for history, saved
     queries, and dbt run records.

4. **The shell**
   - Next.js + React + TypeScript + Tailwind, dark and light, driven by a real
     design system (tokens, components, states) authored by a designer rather
     than improvised per screen.
   - SQL console: syntax highlighting, schema-aware autocomplete, run/cancel,
     typed results grid, row count, elapsed time.
   - Catalog sidebar, query history with re-run, dbt panel, engine status
     panel.
   - A landing/overview page so the product reads as a product.

5. **Runs entirely inside OrbStack**
   - OrbStack is the container runtime for everything: `docker compose up`
     against OrbStack's Docker engine brings up engine + API + web + seed data.
     Verified on your machine: OrbStack 2.2.5 with `orb`, `orbctl`, `docker`,
     and `docker-compose` CLIs present. The daemon was not reachable from this
     sandboxed run, so M0's first check is `docker version` against a running
     OrbStack.
   - Optional second profile targeting **OrbStack's built-in Kubernetes**, so
     the same images get a k8s deployment path without any cloud account. This
     is the cheapest possible rehearsal for the multi-node story later.
   - No cloud spend, no external services, no paid infrastructure in v0.

**Explicitly out of scope for v0** (candidates for v1)

- Writing or forking engine internals, in Sail or in dbt.
- Multi-language notebooks, dashboards, scheduled jobs/DAG orchestration.
- Multi-tenancy, SSO, RBAC, audit logging.
- Cloud/BYOC deployment, autoscaling, a managed control plane.
- Billing, metering, pricing beyond static marketing copy.

## Architecture

```
Browser (Next.js shell)
   |  REST + WebSocket
Platform API (FastAPI, Python)
   |-- Spark Connect (gRPC :50051) --> Sail engine (Rust, supervised)
   |-- process exec + Parquet artifacts --> dbt 2 engine (Rust CLI)
   |
Data: local FS / S3-compatible / Delta Lake
All of it inside OrbStack containers
```

## Agent architecture

You asked for one function per agent, and for more options than the three I
first proposed. Here is the full catalog, then a hiring sequence.

**Principles**

1. One role owns one deliverable surface. Two agents never own the same file
   tree.
2. Hire a role when the milestone that needs it starts, not before. Every live
   agent consumes the same Claude Code subscription — the only declared
   constraint — and adds coordination overhead.
3. CEO (me) keeps architecture, sequencing, scope defense, and final review.
4. Some narrow functions do **not** need a hire: my runtime already exposes
   specialist subagents (code review, SQL optimization, Spark performance,
   analytics engineering, UI design, data modeling, observability, devops) that
   I can invoke per task at no hiring cost. They have no persistent memory or
   task queue of their own, so they suit one-off consultations, not ownership.
   Where a role below is better served that way, the table says so.

### Role catalog

| # | Role | Function (what it alone owns) | Suggested wave |
|---|---|---|---|
| 1 | **Requirements Analyst** | Turns your intent into written specs: user stories, acceptance criteria, screen-by-screen behavior, the scope contract QA tests against | 1 |
| 2 | **UX/UI Designer** | Design system (tokens, type scale, color, spacing), component specs, wireframes and screen flows, handoff notes to frontend | 1 |
| 3 | **Platform Engineer** | Backend core: Sail supervision, Spark Connect, sessions, query path, API, persistence | 1 |
| 4 | **Frontend Engineer** | The Next.js app: console, catalog, history, dbt panel, theming, landing page | 1 |
| 5 | **QA Engineer** | Runs the product for real every milestone, smoke suite, bug reports, known-limitations list, milestone gate | 1 |
| 6 | **Analytics (dbt) Engineer** | The dbt 2 integration end to end: adapter spike, example project, artifact parsing, lineage data, dbt docs | 2 |
| 7 | **DevOps / Infra Engineer** | OrbStack packaging, compose and k8s profiles, images, CI, reproducible first-run | 2 |
| 8 | **Technical Writer** | README, docs site, install guide, release notes, attribution and license notices | 2 |
| 9 | **Solution Architect** | ADRs, interface contracts, cross-service consistency | Optional — CEO holds this by default; hire if you want architecture independent of me |
| 10 | **Security & Compliance Engineer** | Threat model, authn/authz design, secrets handling, LGPD posture — relevant because your customers include government | 3, or earlier if a real customer appears |
| 11 | **Data Modeler** | Demo lakehouse design, medallion layering, catalog semantics, naming standards | 3 — or a subagent consultation |
| 12 | **Performance Engineer** | Benchmarks Sail against JVM Spark and dbt 2 against dbt 1.x, profiles the query path, publishes numbers worth quoting in marketing | 3 |
| 13 | **Observability Engineer** | Metrics, structured logs, traces, OpenLineage emission | 3 |
| 14 | **Product Marketing** | Positioning, landing copy, naming follow-through, competitive framing vs LakeSail/Databricks | 3 |
| 15 | **Code Reviewer** | Independent diff review gate, separate from QA's behavioral testing | Covered by subagent; hire only if you want a standing reviewer with memory |
| 16 | **Orchestration Engineer** | Scheduling, DAG runs, backfills | v1 feature work |
| 17 | **Release / SRE Manager** | Versioning, release process, upgrade and migration paths | v1 |
| 18 | **Support / Triage Agent** | Intake and triage of user-reported issues once users exist | v1 |

### Recommended hiring sequence

- **Wave 1, now (5 hires):** Requirements Analyst, UX/UI Designer, Platform
  Engineer, Frontend Engineer, QA Engineer. This covers M0–M3 completely:
  someone writes the spec, someone designs it, two build it, one verifies it.
- **Wave 2, at M2 (2 hires):** Analytics (dbt) Engineer, DevOps Engineer. The
  dbt panel and the OrbStack packaging both become real work at that point, and
  both are big enough to deserve an owner. Technical Writer joins at M4 when
  there is something to document.
- **Wave 3, when the product exists:** Security, Performance, Observability,
  Product Marketing, Data Modeler — each justified by a concrete need rather
  than hired speculatively.

If you prefer a leaner start, the minimum viable version of Wave 1 is three
hires — Platform, Frontend, QA — with me covering requirements and design.
I do not recommend it: improvised design is exactly what makes a product look
unfinished, and the bar you set was a polished shell.

Proposing this team is not hiring it. I will hire only the roles you explicitly
approve, after you approve them.

## Milestones

| # | Milestone | Outcome | Primary owner |
|---|---|---|---|
| M0 | Foundation | Monorepo scaffold, name applied, toolchain, CI, OrbStack verified, spec and design system v1 written | Requirements + Designer + Platform |
| M1 | Core works | Backend boots Sail, runs SELECTs against Parquet, returns typed rows over HTTP, integration test proves it | Platform |
| M1.5 | dbt engine spike | Written verdict on paths A/B/C with evidence; chosen path recorded as an ADR | dbt Engineer (or Platform if Wave 2 has not started) |
| M2 | Platform API | Sessions, submit/cancel, paged results, catalog, history, dbt endpoints, OpenAPI published | Platform |
| M3 | Shell | Console, results grid, catalog, history, engine status — themed, responsive, matching the design system | Frontend |
| M4 | dbt panel | Run dbt from the UI, streamed logs, model status, lineage view, seeded example project | dbt + Frontend |
| M5 | OrbStack packaging | One command on a clean machine; optional k8s profile; README and screenshots | DevOps |
| M6 | QA and release | Smoke suite green, reviewed diffs, KNOWN-LIMITATIONS.md published | QA |

M3 starts against a mocked API as soon as M2's contract is frozen, so the shell
and the core progress in parallel.

## Definition of done for v0

1. A fresh clone plus one command against OrbStack yields a working app on
   `localhost`, with no manual engine setup.
2. The engine status panel reports a live Sail server and its version. No JVM
   and no Apache Spark installation exists anywhere in the stack.
3. In the console I can browse the seeded catalog, write a multi-table join
   with a window function, run it, see typed results with timing, cancel a long
   query, and find both runs in history.
4. In the dbt panel I can run the seeded example project, watch logs stream,
   see each model's status, and open the lineage graph — with the engine path
   chosen at M1.5 and documented.
5. The UI is coherent in dark and light mode, follows the design system, has no
   placeholder text, and the landing page explains the product.
6. Smoke suite passes in CI; README documents architecture, limits, upstream
   attribution, and Apache-2.0 notices for Sail and dbt.
7. `KNOWN-LIMITATIONS.md` honestly lists what Sail and dbt 2 do not yet
   support and what we deferred to v1.

## Risks

- **No Sail adapter for dbt 2's Rust engine.** The highest-value shape of this
  product (Rust engine end to end) is unproven. Mitigation: the M1.5 spike
  decides early, before the UI depends on it; paths B and C both ship a working
  product; contributing a Sail adapter upstream is a v1 opportunity, not a v0
  commitment.
- **Both engines are moving fast.** Sail is pre-1.0 and dbt 2 reached GA only
  in September 2026. Mitigation: pin exact versions, keep the demo inside
  verified functionality, document gaps.
- **Spark compatibility gaps.** Sail targets Spark 3.5/4.x compatibility but
  its own parity checking is experimental. Mitigation: as above.
- **Single-machine ceiling.** Everything in OrbStack on one Mac caps dataset
  size. Mitigation: small demo data; the k8s profile rehearses the distributed
  path.
- **Team size vs one subscription.** Five concurrent agents share your Claude
  Code quota. Mitigation: waves, not a big bang; QA and writer roles are
  bursty and need not run continuously.
- **Scope gravity toward notebooks, dashboards, and orchestration.**
  Mitigation: the out-of-scope list above is the contract for v0.

## Open decisions for you

1. **Product name** — pick one of the four, or give me yours.
2. **Wave 1 roster** — which of the eight candidate roles to hire now.
3. **dbt engine path** — let the M1.5 spike decide (recommended), or force a
   path up front.
4. **Any role missing** from the catalog that you want in the architecture.

A question card carrying exactly these four is posted on this task. Your
answers produce the final hire list, which I will put up for your explicit
approval before creating a single agent.
