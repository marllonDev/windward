# engine/

The Sail pin and the facts about how Windward runs it. There is no Sail source
here: Sail is an upstream dependency consumed as released (ADR-0002). It is
never patched or forked.

## The pin

`sail.version` is the single source of truth for the Sail version, currently
**0.7.2**. Every place that installs Sail must agree with it:

- `services/api/pyproject.toml` — `pysail==0.7.2`, because the platform API is
  the parent of the engine process and therefore ships the `sail` CLI.
- `docker/sail/Dockerfile` — `pysail==0.7.2`.

`scripts/check-toolchain-pins.sh` fails the build when those drift apart or
when any of them uses a floating version.

## How the engine is started

The platform API supervises Sail; the user never starts it (ADR-0002). At
startup `windward_api.engine.supervisor.SailSupervisor` spawns the listeners as
child processes:

```
sail spark  server --ip $WINDWARD_SAIL_BIND_HOST --port 50051 --directory $WINDWARD_DATA_DIR
sail flight server --ip $WINDWARD_SAIL_BIND_HOST --port 32010 --directory $WINDWARD_DATA_DIR
```

**Two processes, not one.** ADR-0002's diagram describes "one process, two
listeners", but the Sail 0.7.2 CLI serves exactly one interface per process:
`sail spark server` and `sail flight server` are separate commands and neither
opens the other's port. The supervisor therefore owns two children and reports
each one separately in `GET /api/v1/engine/status`. Recorded in
`KNOWN-LIMITATIONS.md`.

Ports are configuration, with the defaults from ADR-0003. Neither engine port is
published to the host: only the platform API's port is (ADR-0002).

## Which interface is used for what

| Interface | Port | Used by | Used for |
| --- | --- | --- | --- |
| Spark Connect | 50051 | platform API (`EngineClient`) | the interactive query path |
| Arrow Flight SQL | 32010 | the dbt adapter | one statement per model |

The platform API never executes SQL over 32010. Its only business with that
port is the liveness probe behind engine status (ADR-0002, "Allowed edges").
