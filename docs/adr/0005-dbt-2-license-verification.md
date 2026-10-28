# ADR-0005 — dbt 2 license verification

- **Status:** Accepted
- **Date:** 2026-10-28
- **Decider:** Solution Architect
- **Informs:** dbt Platform Engineer, QA Engineer
- **Related:** [ADR-0002 — Overall architecture](0002-overall-architecture.md)

## Context

`NOTICE` and `README.md` attributed the dbt dependency to
`dbt-labs/dbt-core` (the Python implementation, Apache-2.0), while
ADR-0002 names the actual dependency as dbt 2, a separate Rust rewrite.
The two projects are not interchangeable, and the Apache-2.0 claim had
never been checked against dbt 2's own license. `dbt-labs/dbt-fusion`,
the public-beta predecessor to dbt 2, shipped most of its code under the
Elastic License 2.0 (ELv2) with a handful of crates (including the
adapter crate) carved out under Apache-2.0 — so the Apache-2.0 premise in
ADR-0002 and in Windward's own Apache-2.0 `LICENSE` was not a safe
assumption. This was tracked as blocking finding B1 on TES-7 and as an
open item in `KNOWN-LIMITATIONS.md`.

No exact dbt 2 commit or tag is pinned anywhere in the repository yet —
M0 is scaffold-only and `dbt/` is a placeholder. The verification below
therefore reads the dependency's current public state, not a pin that
exists in our dependency manifests, because none exists yet.

## What was verified

- Repository: `dbt-labs/dbt` (not `dbt-labs/dbt-core`, which is the
  archived, Python-only predecessor; also not `dbt-labs/dbt-fusion`,
  which was the Rust rewrite's public-beta repository and is now
  archived, with issue tracking and further development folded into
  `dbt-labs/dbt`).
- Root `LICENSE` file in `dbt-labs/dbt`: Apache License, Version 2.0,
  copyright dbt Labs, Inc. Checked at `main` and against the GA tag
  `v2.0.0` (2026-09-14, the date ADR-0002 cites).
- dbt Labs separately sells a proprietary product, also marketed as
  "dbt," under its own Product Licensing Agreement. That proprietary
  distribution is built from the same Apache-2.0 source in this
  repository plus additional components whose source is not published
  in this repository. The public repository content — including
  adapter functionality — is Apache-2.0; the closed-source additions are
  not in this repository at all, so forking or vendoring from
  `dbt-labs/dbt` does not pull them in by construction.

## Decision

Treat `dbt-labs/dbt`, Apache License 2.0, as the verified license for
the dbt 2 dependency. Correct `NOTICE` and `README.md` to name that
repository (not `dbt-core`) and to record this verification, including
the caveat that Windward depends only on the public Apache-2.0 contents
of the repository and not on dbt Labs' proprietary distribution of the
same product name.

This does not close the license question permanently — it closes it for
the current, unpinned state of the dependency:

- When M1 pins an exact commit or tag to fork the `sail` adapter from,
  re-read that commit's `LICENSE` (and any `LICENSES.md`-style
  per-directory carve-out file, if one exists at that commit) before
  vendoring anything. The predecessor repository changed its licensing
  model once already (ELv2 default with Apache-2.0 carve-outs, later
  folded into an all-Apache-2.0 public repository); a fast-moving
  upstream can change it again.
- The `sail` adapter fork must be taken from `dbt-labs/dbt` itself, not
  from any build or redistribution of dbt Labs' proprietary "dbt"
  product. The two share a name in marketing; they are not the same
  artifact, and only the former is covered by the verification above.

## Consequences

- `NOTICE` and `README.md` now name the correct repository and a
  license identifier verified against that repository's own file, not
  carried over by assumption from the unrelated `dbt-core` project.
- The dbt Platform Engineer has a concrete instruction for M1: re-verify
  the license at the exact pinned commit, and source the fork from
  `dbt-labs/dbt`, not from the proprietary distribution.
- QA (TES-8) can close the B1 finding by re-reading `NOTICE` and
  `README.md`; no new clean-clone cycle is needed for this fix alone.
- This ADR does not certify that the license will still be Apache-2.0 at
  whatever commit M1 actually pins — that check is still required then,
  and is called out above so it is not skipped a second time.
