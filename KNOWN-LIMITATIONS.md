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

### dbt 2 license identifier is unverified

`NOTICE` and `README.md` currently attribute the product's dbt dependency to
`dbt-labs/dbt-core` (Python dbt, Apache-2.0). The architecture (ADR-0002)
names the actual dependency as dbt 2 / dbt Fusion, a different, Rust-based
project. Windward's own Apache-2.0 licensing premise for anything vendored
from dbt 2 has not been checked against that project's actual `LICENSE` file
— there are indications parts of the dbt Fusion distribution ship under the
Elastic License 2.0, not Apache-2.0. Until the Solution Architect or
implementer opens the exact pinned dbt 2 repository/version and reads its
license file, this is an open legal/compliance unknown, not a confirmed fact
in either direction. Tracked as blocking finding `B1` on `TES-7`; unresolved
as of this entry.

### Sail and dbt 2 are not yet pinned to exact versions or vendored

M0 is scaffold-only: there is no Dockerfile, no `docker-compose.yml`, and no
actual Sail or dbt 2 dependency manifest yet. `scripts/check-toolchain-pins.sh`
enforces exact pins for Rust/Python/Node today but has nothing to enforce for
Sail/dbt base images until `docker/` gains real content in a later milestone
(noted as optional item `O4` on `TES-7`). Not a defect at M0 — scope as
designed — but recorded here so it is not mistaken for an oversight later.

## Product behavior

Not yet applicable: M0 ships no application code (`apps/web`, `services/api`,
`engine/`, `dbt/` are all placeholder directories). Engine integration,
unhappy-path behavior (cancelled query, dead engine, malformed SQL, empty
table, failed dbt model, large result set), and UI states are specified in
the design system and functional specification but have no running code to
exercise yet. This section will gain real entries starting at M1.
