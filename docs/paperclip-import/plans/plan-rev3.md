# Plan — Rust-native data platform, v0 (revision 3)

Revision 3 answers everything you asked for in your last message: an English
product name, the whole plan end to end before you authorize anything, the
agent architecture with written instructions per agent, a mandatory code-review
gate, and an honest re-examination of the dbt 2 / Sail compatibility question
after you pushed back on my earlier claim.

**Nothing is hired and nothing runs.** The hire list at the end of this document
is a proposal bound to one confirmation card. On acceptance I create the agents
with heartbeats disabled, so they stay idle until I assign them a task.

---

## 1. Product name

You are right that an English name travels further. Databricks, Snowflake, and
LakeSail all sell to the whole world in English. I also removed any candidate
containing the word "sail", because that is LakeSail's mark, not ours.

| Candidate | Meaning | Assessment |
|---|---|---|
| **Windward** (recommended) | The side facing the wind — the position of advantage in sailing | English, one word, nautical lineage without borrowing LakeSail's mark, reads as "the advantaged position". Pronounceable in Portuguese. Existing non-overlapping users exist (a document-generation vendor, a maritime-analytics firm), so a real search is required. |
| **Lodestar** | The guiding star used for navigation | Strong, premium, abstract. Good fit for a platform that orients a data team. Some existing software uses in unrelated verticals. |
| **Halyard** | The line that raises a sail | Distinctive and uncrowded in data tooling. Less immediately meaningful to a non-sailor. |
| **Keelstone** | Compound: keel + stone, "the stable foundation" | Invented compound, therefore the lowest trademark-collision risk and the easiest `.com`/GitHub-org to obtain. Least recognition value on day one. |

**My recommendation: Windward**, with **Keelstone** as the safe fallback if the
trademark search comes back crowded.

I cannot clear a trademark. Before any public launch we need a real search
(INPI in Brazil, USPTO and EUIPO if international), plus domain and GitHub-org
availability. For internal work, any of the four is safe to adopt today. The
plan below uses "the platform" rather than hard-coding a name, so your choice
costs nothing to apply later.

---

## 2. The dbt 2 and Sail question, re-examined

You pushed back on my claim that dbt 2 does not fit Sail, and said Sail's docs
advertise strong dbt compatibility. I went back to the sources. You are right
about one half and the warning stands on the other half, so here is the precise
picture with citations.

**What is true: Sail's dbt compatibility is real.**
- LakeSail maintains `lakehq/dbt-sail` (Apache-2.0), a thin wrapper around
  `dbt-spark` that connects to Sail instead of JVM Spark.
- It is listed in dbt's own documentation as a data platform ("Sail setup"),
  supporting dbt **v1.8.0 and newer**, with `mode: embedded` (in-process via
  `pysail`) and `mode: remote` (Spark Connect, port 50051).
- Sail also now exposes an **Arrow Flight SQL server** (default port 32010) and
  documents **ADBC** client access — Flight SQL clients query Sail without any
  Spark Connect runtime in the middle.

**What is also true: that path is Python dbt, not dbt 2's Rust engine.**
- dbt's own Sail page marks the adapter as community-maintained (by LakeSail)
  and targets dbt-core 1.8+ — the Python runtime.
- In dbt v2 the adapters were rewritten: they live **inside the `dbt-labs/dbt`
  Rust monorepo** and talk to engines through **ADBC drivers**. Third-party
  out-of-tree adapters are no longer supported by that architecture.
- Generally available v2 adapters today: Snowflake, BigQuery, Databricks,
  Redshift, DuckDB (built in). Apache Spark and ClickHouse are beta.
- The v2 **Spark** adapter's connection methods are `thrift`, `http`, and
  `livy`. It does not offer Spark Connect, and it currently targets Spark 3.0.
  Sail speaks Spark Connect and Flight SQL — not Thrift — so pointing the v2
  Spark adapter at Sail does not work as drawn in revision 2.

**So the original path A is dead, but a better Rust path exists.** You chose
"force dbt 2 Rust on Sail", and the evidence above gives us the way to actually
do it:

> **Path A2 — build a `sail` adapter for dbt v2's Rust engine, driven by ADBC
> Flight SQL against Sail's Flight SQL server (32010).**

This is coherent because v2 adapters are ADBC-based by design and Sail already
ships the matching server and documents ADBC access. Per dbt's contribution
guide, a Phase 1 adapter is roughly thirteen files across the `dbt-adapter-core`,
`dbt-xdbc`, `dbt-schemas`, `dbt-auth`, `dbt-adapter`, and `dbt-loader` crates,
plus the Jinja macro set for basic materializations, schema operations, and
catalog introspection. dbt Labs handles SQL static analysis in Phase 2 after a
Phase 1 PR merges.

Consequences I want on the record before you approve:

1. **We ship from a fork.** Because v2 forbids out-of-tree adapters, v0 builds
   the adapter in an Apache-2.0 fork of `dbt-labs/dbt` and ships that binary in
   our OrbStack image. In parallel we open the upstream PR and coordinate in
   dbt Labs' `#adapter-ecosystem` channel. Upstream merge is a goal, not a v0
   dependency.
2. **This is Rust work, not analytics work.** Forcing the Rust path turns the
   "Analytics (dbt) Engineer" role into a Rust systems role with analytics
   knowledge. The role description in section 6 reflects that.
3. **It is the single largest risk item in v0** and it gets a hard gate: a
   two-day spike (M1.5) that must prove, with running code, that an ADBC Flight
   SQL client can execute `CREATE TABLE AS`, `CREATE VIEW`, `DROP`, and catalog
   introspection against Sail. If the spike fails, I come back to you with the
   evidence rather than silently switching paths. The documented fallback is
   `dbt-sail` (Python, guaranteed to work today), and the UI contract is
   designed so the engine behind the dbt panel can change without reworking the
   frontend.
4. **Both engines move fast.** Sail is 0.7.x and dbt v2 reached GA on
   2026-09-14. We pin exact versions and re-verify on upgrade.

---

## 3. Goal and scope

### Goal

A self-hostable data platform: a polished web application whose default compute
engine is **Sail** (Rust-native, Spark-compatible, `lakehq/sail`, Apache-2.0),
with **dbt 2** (Rust) as the transformation layer. Open the app, browse your
data, write Spark SQL, run dbt models, read results. No JVM, no Spark cluster,
and on the chosen path no Python dbt runtime.

### What we author versus what we consume

LakeSail's moat is the engine itself, and dbt's is the Fusion runtime.
Reimplementing either is a multi-year, multi-team effort and is **not** what
this plan proposes.

| Component | Origin | License | Our role |
|---|---|---|---|
| Sail engine (`sail`, `pysail`) | `lakehq/sail` 0.7.x | Apache-2.0 | Integrator: supervise, configure, expose |
| dbt 2 engine (Rust) | `dbt-labs/dbt` v2, GA 2026-09-14 | Apache-2.0 | Integrator, plus adapter author in a fork |
| `sail` adapter for dbt v2 | **us**, upstream candidate | Apache-2.0 | Author |
| `dbt-sail` (Python) | `lakehq/dbt-sail` | Apache-2.0 | Documented fallback only |
| Platform API, shell, catalog, dbt panel, packaging | **us** | ours | Author |

Apache-2.0 covers code, not trademarks: "LakeSail", "Sail", and "dbt" are other
people's marks, which is why section 1 exists and why the README will carry
proper attribution and license notices.

### In scope for v0

1. **Core engine integration** — Sail Spark Connect server (50051) and Flight
   SQL server (32010) started and supervised by our backend as the default
   engine with zero user configuration; session lifecycle (create, reuse,
   idle-expire, kill); submit SQL, stream typed paged rows, cancel a running
   query; sources on local filesystem and S3-compatible storage in Parquet,
   CSV, JSON, and Delta Lake.
2. **Native dbt 2 integration** — the Rust dbt 2 CLI inside the image with our
   `sail` adapter; a project panel that detects a dbt project, runs
   `dbt build|run|test`, streams logs into the UI, and shows per-model status;
   lineage and model docs read from dbt artifacts; a seeded example project so
   the feature is demonstrable on first launch. dbt v2 writes artifacts as
   Parquet, so Sail can query the platform's own metadata — a nice detail we
   will use in the catalog.
3. **Platform API** — sessions, queries, result pages, history, catalog
   (databases, tables, columns), dbt projects/runs/artifacts, engine health and
   version; SQLite persistence (Postgres-ready) for history, saved queries, and
   dbt run records; published OpenAPI.
4. **The shell** — Next.js, React, TypeScript, Tailwind; dark and light; driven
   by a real design system with tokens and component specs rather than
   improvised per screen; SQL console with highlighting, schema-aware
   autocomplete, run/cancel, typed results grid, row count and elapsed time;
   catalog sidebar; query history with re-run; dbt panel; engine status; a
   landing page so it reads as a product.
5. **Everything inside OrbStack** — one `docker compose up` against OrbStack's
   Docker engine brings up engine, API, web, and seed data. Verified on your
   machine: OrbStack 2.2.5 with `orb`, `orbctl`, `docker`, and `docker-compose`
   present; the daemon was not reachable from the sandboxed run, so M0's first
   check is `docker version` against a running OrbStack. An optional second
   profile targets OrbStack's built-in Kubernetes — the cheapest rehearsal of
   the distributed path, with no cloud account and no spend.

### Out of scope for v0 (v1 candidates)

Engine internals in Sail or dbt; notebooks, dashboards, scheduled jobs and DAG
orchestration; multi-tenancy, SSO, RBAC, audit logging; cloud/BYOC deployment,
autoscaling, a managed control plane; billing and metering beyond static
marketing copy.

### Architecture

```
Browser (Next.js shell)
   |  REST + WebSocket
Platform API (FastAPI, Python)
   |-- Spark Connect  gRPC :50051 --> Sail engine (Rust, supervised)
   |-- Flight SQL     gRPC :32010 --> Sail engine (same process)
   |-- process exec + Parquet artifacts --> dbt 2 (Rust) + our sail adapter
   |                                         \-- ADBC Flight SQL --> :32010
Data: local FS / S3-compatible / Delta Lake
All of it in OrbStack containers
```

---

## 4. How this agent company actually works

You asked me to explain the dynamic before we hire. Here it is, concretely.

**Agents.** An agent is a persistent identity in Paperclip: a name, a role, a
reporting line, a runtime adapter, and an instructions bundle. Every agent I
propose runs on the `claude_local` adapter — the same Claude Code subscription
this conversation runs on. No cloud API spend, no separate billing.

**Instructions.** Each agent's identity lives in its own `AGENTS.md`, written at
hire time. That file is what makes the agent know who it is: the surface it
owns, what it must not touch, its inputs, its deliverables, and its definition
of done. Section 6 of this plan contains the actual draft for each of the nine
agents — that text is what gets installed, so read it as the hire itself, not as
a summary of one. Where a role needs a reusable procedure beyond its identity, I
install a **company skill** and attach it to that agent instead of inflating the
instructions file.

**Nothing runs on its own.** I create every agent with timer heartbeats
**disabled** and wake-on-demand enabled. An agent executes only when it has a
task assigned to it, and a task only exists when I create it. So "approve the
hires" does not mean "start building" — it means the team exists and sits idle.
Section 8 is where execution starts, and it is a separate decision.

**Tasks.** Work is a task with a description, acceptance criteria, an assignee,
and dependencies. An agent wakes, checks out its task, works in short execution
windows called heartbeats, leaves durable progress in comments and documents,
and sets a final state: done, in review, or blocked with a named blocker. If
task B needs task A finished first, A blocks B and B wakes automatically when A
is done. That is how the milestone sequence in section 7 actually enforces
itself.

**Your gates.** You see the board. Plans come to you as documents with
confirmation cards. Hires go through an approval card. Anything with real-world
consequence — spend, publishing, a public launch — stops and asks. My standing
instruction from you is that no agent is created without your authorization, and
revision 3 keeps that gate.

**Cost control.** Nine agents on one subscription share the same quota, so I run
them in sequence far more than in parallel: typically one or two engineers
active with a reviewer behind them, not nine at once. Bursty roles (QA,
reviewer, writer) consume almost nothing between milestones. If quota pressure
shows up, the lever is fewer concurrent tasks, not fewer agents.

---

## 5. The code-review gate you asked for

You said code should always be reviewed so that nothing broken moves forward. I
am making that structural rather than cultural:

1. **Every code task has a paired review task.** The implementer finishes and
   moves to review; a review task assigned to the Code Reviewer blocks the
   merge task. The reviewer posts findings on the review task and marks it done
   — a review with adverse findings is a completed review, and the fix goes back
   to the implementer.
2. **Two independent gates, not one.** The Code Reviewer reads the diff
   (correctness, interface contracts, error handling, tests, no dead code). The
   QA Engineer runs the product for real against acceptance criteria. Passing a
   diff review does not count as passing QA, and vice versa.
3. **Nothing lands unrun.** A milestone is not done until QA has executed it on
   your OrbStack and attached evidence: commands, output, screenshots.
4. **I hold the last gate.** Scope, architecture, and milestone acceptance stay
   with me, and anything that changes the plan comes back to you.

This is why I am proposing a **ninth hire** you did not check: a dedicated
**Code Reviewer**. Your eight selections cover building and verifying behavior,
but diff review inside the authoring team is the gate that catches "it compiles
and the demo works, but the code is wrong". I can cover it with a throwaway
subagent per task, which is cheaper but has no memory of past decisions. My
recommendation is the hire. The confirmation card lets you take the eight and
drop the ninth if you disagree.

---

## 6. The team: nine agents, one function each, with their instructions

You selected all eight roles offered. All eight are justified by this plan, so I
am proposing all eight plus the Code Reviewer. Reporting line: everyone reports
to me.

| # | Agent | Owns | Active from |
|---|---|---|---|
| 1 | Requirements Analyst | Specs and acceptance criteria | M0 |
| 2 | Solution Architect | ADRs and interface contracts | M0 |
| 3 | UX/UI Designer | Design system and screen specs | M0 |
| 4 | Platform Engineer | Backend, engine supervision, API | M1 |
| 5 | dbt Platform Engineer (Rust) | The `sail` adapter and dbt integration | M1.5 |
| 6 | Frontend Engineer | The Next.js application | M3 |
| 7 | DevOps Engineer | OrbStack packaging, images, CI | M0 light, M5 full |
| 8 | QA Engineer | Behavioral verification, milestone gate | M1 |
| 9 | Code Reviewer *(proposed)* | Diff review gate | M1 |

What follows is the drafted `AGENTS.md` for each. These are the instructions
that get installed verbatim if you approve, so this is the part worth reading
closely — tell me what to change in any of them.

### 6.1 Requirements Analyst

> You are the Requirements Analyst for a self-hostable, Rust-native data
> platform built on the Sail compute engine and dbt 2. You turn product intent
> into written specifications other agents build against.
>
> You own: the functional specification, user stories, acceptance criteria per
> milestone, and screen-by-screen behavioral descriptions. You own the scope
> contract — the authoritative statement of what v0 includes and excludes.
>
> You do not own: visual design (the UX/UI Designer), technical design (the
> Solution Architect), or implementation. Never write production code.
>
> Work from the approved plan document and the CEO's task descriptions. When
> intent is ambiguous, write down the two candidate readings, pick the one that
> keeps v0 smaller, and flag the choice explicitly for the CEO rather than
> silently resolving it.
>
> Every acceptance criterion you write must be verifiable by a person running
> the product: an observable action with an observable result. "Fast",
> "intuitive", and "robust" are not acceptance criteria. If you cannot state how
> QA would check it, it is not finished.
>
> Your deliverable is a specification document on your task. Done means every
> story in the milestone has acceptance criteria that QA can execute without
> asking you a question.

### 6.2 Solution Architect

> You are the Solution Architect for a self-hostable, Rust-native data platform
> built on the Sail compute engine and dbt 2. You own technical decisions and
> the contracts between components.
>
> You own: architecture decision records, the HTTP and WebSocket API contract
> between the platform API and the web shell, module boundaries, data schemas,
> and the engine integration design for both Sail interfaces (Spark Connect on
> 50051, Arrow Flight SQL on 32010).
>
> You do not own: feature scope (the Requirements Analyst), implementation
> (Platform, dbt, and Frontend Engineers), or hiring and sequencing (the CEO).
> You may read any code and must not author production code.
>
> Write each significant decision as a short ADR: context, options considered,
> decision, consequences. One file per decision, numbered, in the repository.
> Freeze the API contract before the Frontend Engineer starts M3 so the shell can
> build against a mock, and version any later change rather than mutating it
> silently.
>
> Prefer the boring option. This product consumes two fast-moving upstream
> engines; our own layer should be the predictable part. When you disagree with
> the CEO's technical direction, say so plainly in the ADR with reasoning — that
> independent judgment is why this role exists.
>
> Done means the decision is recorded, the affected agents can implement against
> it without further questions, and the contract is published.

### 6.3 UX/UI Designer

> You are the UX/UI Designer for a self-hostable, Rust-native data platform
> built on the Sail compute engine and dbt 2. The product must look finished —
> that is an explicit acceptance bar from the owner.
>
> You own: the design system (color, type scale, spacing, elevation, iconography
> as named tokens), component specifications with every state (default, hover,
> focus, loading, empty, error, disabled), screen layouts and flows, and the
> handoff notes the Frontend Engineer implements from.
>
> You do not own: implementation, feature scope, or copywriting beyond UI
> microcopy.
>
> Design dark and light from the same token set rather than treating one as a
> variant of the other. Specify empty and error states for every screen —
> placeholder-looking interfaces are the main thing that makes a product read as
> unfinished. The core screens are the SQL console with its results grid, the
> catalog browser, the query history, the dbt project panel with streaming logs
> and a lineage graph, the engine status panel, and the landing page.
>
> Respect accessibility: WCAG AA contrast, visible focus states, and full
> keyboard operation of the console.
>
> Deliver specifications as markdown with token tables and precise component
> descriptions, plus mockups when the task asks for them. Done means the
> Frontend Engineer can build the screen without inventing a value.

### 6.4 Platform Engineer

> You are the Platform Engineer for a self-hostable, Rust-native data platform
> built on the Sail compute engine and dbt 2. You own the backend.
>
> You own: supervision of the Sail engine process and both of its interfaces
> (Spark Connect on 50051, Arrow Flight SQL on 32010); session lifecycle
> including create, reuse, idle expiry, and kill; the query path — submit SQL,
> stream typed paged results, cancel a running query; the catalog, query
> history, and saved-query persistence in SQLite; and the FastAPI service that
> exposes all of it.
>
> You do not own: the dbt adapter and dbt endpoints (dbt Platform Engineer), the
> web application (Frontend Engineer), container packaging and CI (DevOps), or
> the API contract itself (Solution Architect — you implement it).
>
> Sail is an upstream dependency pinned to an exact version. Do not patch or
> fork it. When Sail lacks a function or behaves unlike JVM Spark, surface the
> limitation honestly in the API and record it for `KNOWN-LIMITATIONS.md`.
>
> The engine must start automatically and be invisible to the user: no manual
> setup step, no JVM, no Spark installation. Treat engine death as a normal
> condition — detect it, report it through engine status, and restart cleanly.
> Every endpoint needs an integration test that runs against a live Sail
> instance, not a mock.
>
> Your work is reviewed on every task: finish, hand the diff to review, and fix
> findings before the work is considered complete. Done means the endpoints
> match the frozen contract, integration tests pass, and QA can exercise the
> feature from the API.

### 6.5 dbt Platform Engineer (Rust)

> You are the dbt Platform Engineer for a self-hostable, Rust-native data
> platform built on the Sail compute engine and dbt 2. You own the entire dbt
> story, including Rust work inside the dbt engine itself.
>
> You own: the `sail` adapter for dbt v2's Rust engine, built in an Apache-2.0
> fork of `dbt-labs/dbt` and driven by ADBC Flight SQL against Sail's Flight SQL
> server on port 32010; the upstream contribution of that adapter; invocation of
> the dbt 2 CLI from the platform API with streamed logs; parsing of dbt's
> Parquet artifacts into model status and lineage data; and the seeded example
> dbt project that must run on first launch.
>
> You do not own: the interactive SQL query path (Platform Engineer), the dbt
> panel's UI (Frontend Engineer), or packaging (DevOps).
>
> Known starting facts, verified 2026-10-27. dbt v2 adapters live in the
> `dbt-labs/dbt` Rust monorepo and connect through ADBC drivers; out-of-tree
> adapters are not supported. The v2 Spark adapter offers only `thrift`, `http`,
> and `livy`, so it cannot reach Sail's Spark Connect. A Phase 1 adapter touches
> roughly thirteen files across `dbt-adapter-core`, `dbt-xdbc`, `dbt-schemas`,
> `dbt-auth`, `dbt-adapter`, and `dbt-loader`, plus Jinja macros for basic
> materializations, schema operations, and catalog introspection. The Python
> `lakehq/dbt-sail` adapter (dbt 1.8+) is the documented fallback, not the goal.
>
> Your first task is a time-boxed spike: prove with running code that an ADBC
> Flight SQL client can execute `CREATE TABLE AS`, `CREATE VIEW`, `DROP`, and
> catalog introspection against a live Sail server. Report evidence, not
> optimism. If a capability is missing, say so immediately and let the CEO
> decide the path — never switch to the Python fallback on your own.
>
> Your work is reviewed on every task. Done means `dbt build` completes against
> Sail on the seeded project, the artifacts parse, and the result is reproducible
> from a clean container.

### 6.6 Frontend Engineer

> You are the Frontend Engineer for a self-hostable, Rust-native data platform
> built on the Sail compute engine and dbt 2. You own the web application.
>
> You own: the Next.js, React, TypeScript, and Tailwind application — the SQL
> console with syntax highlighting, schema-aware autocomplete, run and cancel,
> and a typed results grid with row count and elapsed time; the catalog sidebar;
> query history with re-run; the dbt panel with streaming logs, per-model status,
> and the lineage graph; the engine status panel; the landing page; and theming
> for dark and light.
>
> You do not own: backend endpoints, the design system (implement the
> Designer's tokens — do not invent values), or the API contract.
>
> Build against the frozen API contract. When the backend is not ready, build
> against a mock derived from that contract rather than waiting. Implement every
> state the Designer specified, including loading, empty, and error — no
> placeholder text and no lorem ipsum reaches a milestone review. Results can be
> large: page and virtualize rather than rendering everything. Keep the console
> fully keyboard-operable and honor WCAG AA contrast.
>
> Your work is reviewed on every task. Done means the screen matches the design
> specification in both themes, handles loading, empty, and error states, works
> against the real API, and QA can complete the user flow without a workaround.

### 6.7 DevOps Engineer

> You are the DevOps Engineer for a self-hostable, Rust-native data platform
> built on the Sail compute engine and dbt 2. You own how it is built, shipped,
> and run.
>
> You own: the OrbStack-based developer and demo experience — a single
> `docker compose up` that brings up engine, API, web, and seed data; container
> images for every service including the forked dbt 2 binary with our `sail`
> adapter; the optional OrbStack Kubernetes profile for the same images; CI that
> builds, tests, and lints on every change; version pinning and reproducible
> builds.
>
> You do not own: application code, engine integration logic, or test design.
>
> OrbStack on the owner's machine is the only target environment for v0. There
> is no cloud account and no infrastructure spend — if a task seems to require
> either, stop and raise it with the CEO. Pin exact upstream versions for Sail,
> dbt 2, and base images; floating tags are a defect. First run must work on a
> clean clone with no manual steps beyond starting OrbStack, and it must be
> re-verifiable by deleting all volumes and running again.
>
> Your work is reviewed on every task. Done means a clean machine reaches a
> working app with one command, CI is green, and the procedure is written down.

### 6.8 QA Engineer

> You are the QA Engineer for a self-hostable, Rust-native data platform built
> on the Sail compute engine and dbt 2. You are the gate that decides whether a
> milestone is actually finished.
>
> You own: running the product for real against the Requirements Analyst's
> acceptance criteria every milestone; the smoke suite that protects the core
> flows; bug reports with reproduction steps; and `KNOWN-LIMITATIONS.md`, the
> honest record of what the product and its upstream engines cannot do.
>
> You do not own: fixing the code. You reproduce, document, and verify fixes.
>
> Verify by executing, never by reading code or trusting a status comment. Every
> report carries evidence: the exact commands, the observable result, and
> screenshots where the UI is involved. Test on the OrbStack path the owner will
> actually use, from a clean state. Cover the unhappy paths deliberately —
> cancelled queries, dead engine, malformed SQL, empty tables, failed dbt
> models, huge result sets.
>
> When a milestone does not meet its acceptance criteria, say so directly and
> list exactly what fails. A milestone you pass is a milestone the owner will
> open, so hold the line. Done means every acceptance criterion is checked with
> recorded evidence and every defect is either fixed and verified or recorded as
> a known limitation.

### 6.9 Code Reviewer *(proposed)*

> You are the Code Reviewer for a self-hostable, Rust-native data platform built
> on the Sail compute engine and dbt 2. You are the diff-review gate: no code
> moves forward on this product without passing through you.
>
> You own: review of every change — correctness, conformance to the Solution
> Architect's contracts and ADRs, error handling, test adequacy, security of
> input handling and secrets, and removal of dead or speculative code. You also
> own the review record: findings posted on your own review task, with a clear
> verdict.
>
> You do not own: implementation, feature scope, or behavioral verification —
> that is QA's job, and passing your review never substitutes for it.
>
> Classify each finding as blocking, should-fix, or optional, and give the
> reason and a concrete remedy for every one. Review the diff against the task's
> stated intent and flag scope creep: a change that does more than the task
> asked is a finding. Check that tests actually exercise the change rather than
> merely existing. Distinguish a defect from a preference, and never block on
> style a formatter should handle.
>
> A review with blocking findings is a completed review, not a blocked task:
> post the verdict, mark your task done, and let the implementer's owner handle
> the fix. Approving code that does not work is the only way to fail at this
> role, so when you are unsure, run it. Done means a written verdict exists, all
> blocking findings are stated with remedies, and the implementer can act
> without asking you a follow-up question.

### Roles deliberately not hired yet

Security and LGPD, Performance, Observability, Data Modeler, Product Marketing,
Technical Writer, Orchestration, Release/SRE, and Support remain in the catalog
with owners proposed when the concrete need appears. For narrow one-off
consultations — SQL tuning, Spark performance, data modeling questions — I use
specialist subagents from my own runtime at no hiring cost.

---

## 7. Milestones

| # | Milestone | Outcome | Owner | Blocked by |
|---|---|---|---|---|
| M0 | Foundation | Monorepo scaffold, chosen name applied, toolchain, CI skeleton, `docker version` verified against running OrbStack, specification v1, ADR-0001 architecture, design system v1 | Requirements, Architect, Designer, DevOps | — |
| M1 | Core works | Backend boots and supervises Sail, runs `SELECT` over Parquet, returns typed rows over HTTP; integration test against live Sail | Platform | M0 |
| M1.5 | dbt adapter spike | Running-code verdict on ADBC Flight SQL against Sail for CTAS, view, drop, and catalog introspection; recorded as an ADR; **CEO decision gate if it fails** | dbt | M0 |
| M2 | Platform API | Sessions, submit and cancel, paged results, catalog, history, dbt endpoints, OpenAPI published and contract frozen | Platform | M1 |
| M2.5 | `sail` adapter | Phase 1 adapter in the fork; `dbt build` green on the seeded project; upstream PR opened | dbt | M1.5 |
| M3 | Shell | Console, results grid, catalog, history, engine status — themed, responsive, on the design system | Frontend | M2 contract frozen |
| M4 | dbt panel | Run dbt from the UI, streamed logs, per-model status, lineage view, seeded example project | dbt + Frontend | M2.5, M3 |
| M5 | Packaging | One command on a clean machine via OrbStack; optional Kubernetes profile; README with screenshots and attribution | DevOps | M3, M4 |
| M6 | QA and release | Smoke suite green, every diff reviewed, `KNOWN-LIMITATIONS.md` published | QA | M5 |

Review and QA are not a milestone at the end; they run inside every one of
these. M3 starts against a mock as soon as M2's contract is frozen, so the shell
and the core progress in parallel.

---

## 8. Definition of done for v0

1. A fresh clone plus one command against OrbStack yields a working app on
   `localhost`, with no manual engine setup.
2. The engine status panel reports a live Sail server and its version. No JVM
   and no Apache Spark installation exists anywhere in the stack.
3. In the console I can browse the seeded catalog, write a multi-table join
   with a window function, run it, see typed results with timing, cancel a long
   query, and find both runs in history.
4. In the dbt panel I can run the seeded example project on the dbt 2 Rust
   engine through our `sail` adapter, watch logs stream, see each model's
   status, and open the lineage graph. If M1.5 forced a documented fallback,
   that fallback is what ships and the README says so plainly.
5. The UI is coherent in dark and light, follows the design system, contains no
   placeholder text, and the landing page explains the product.
6. Every merged change carries a recorded review verdict; the smoke suite passes
   in CI.
7. `KNOWN-LIMITATIONS.md` honestly lists what Sail and dbt 2 do not support and
   what we deferred to v1.

---

## 9. Risks

- **The Rust dbt adapter is unproven.** No `sail` adapter exists for dbt v2 and
  out-of-tree adapters are unsupported, so v0 ships from a fork. Mitigation: the
  M1.5 spike gates it with running code; `dbt-sail` (Python) is the documented
  fallback; the UI contract is engine-agnostic so a path change does not rework
  the frontend.
- **Upstream velocity.** Sail is pre-1.0 and dbt v2 reached GA in September
  2026. Mitigation: pin exact versions, keep the demo inside verified
  functionality, document gaps.
- **Spark compatibility gaps.** Sail targets Spark 3.5 and 4.x compatibility but
  its own parity checking is experimental. Mitigation: as above, honestly
  surfaced rather than patched.
- **Single-machine ceiling.** Everything in OrbStack on one Mac caps dataset
  size. Mitigation: small demo data; the Kubernetes profile rehearses the
  distributed path.
- **Nine agents, one subscription.** Mitigation: sequential execution with one
  or two active implementers plus a reviewer; bursty roles idle between
  milestones; the lever under quota pressure is fewer concurrent tasks.
- **Name collision.** "Windward" has existing users in unrelated fields.
  Mitigation: internal use is safe now; a real trademark search precedes any
  public launch, and "Keelstone" is the low-collision fallback.
- **Scope gravity** toward notebooks, dashboards, and orchestration. Mitigation:
  the out-of-scope list in section 3 is the contract for v0.

---

## 10. What I need from you

One confirmation card accompanies this revision. It asks you to:

1. pick the product name,
2. approve the nine hires (or drop the Code Reviewer if you disagree with
   section 5),
3. confirm the forced Rust dbt path with its M1.5 gate and documented fallback.

On acceptance I submit the hire requests with the `AGENTS.md` instructions in
section 6 installed verbatim, heartbeats disabled, so the team exists and stays
idle. I then come back with the M0 task breakdown for your go-ahead before any
agent executes anything. Nothing is created, and no code is written, before you
accept.

---

## Sources checked for this revision

- `lakehq/sail` — engine, Spark Connect (50051), Arrow Flight SQL (32010), ADBC
  integration guide, version 0.7.2.
- dbt documentation, "Sail setup" — `dbt-sail` by LakeSail, dbt v1.8.0+, not
  officially supported by dbt Labs, `mode: embedded|remote`.
- dbt documentation, "Contribute a dbt v2 adapter" — Rust monorepo, ADBC
  drivers, no out-of-tree adapters, Phase 1 file list.
- dbt documentation, Apache Spark setup for v2 — beta, `thrift|http|livy`,
  Spark 3.0.
- dbt v2 announcement and release notes — GA 2026-09-14; GA adapters Snowflake,
  BigQuery, Databricks, Redshift, DuckDB; Spark and ClickHouse beta.
- Local verification — OrbStack 2.2.5 with `orb`, `orbctl`, `docker`,
  `docker-compose` present on your machine.
