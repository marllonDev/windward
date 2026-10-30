# services/api — the Windward platform API

FastAPI service that supervises the Sail engine and owns the HTTP contract. It
is the only component that talks to the engine (ADR-0002).

## What M1 ships

- **Engine supervision.** Starting this service starts Sail; stopping it stops
  Sail. No manual setup step, no JVM, no Spark installation. A dead engine is
  detected, reported, and restarted with a backoff.
- **The query path, synchronously.** `POST /api/v1/queries` runs one statement
  and returns a page of typed rows.
- **Engine status.** `GET /api/v1/engine/status` answers honestly while the
  engine is down.

Sessions as an API resource, cancellation, the result spool and paging, the
catalog, history, saved queries, and the dbt endpoints are M2, which is also
when this contract is frozen.

## Layout

One module per boundary, per ADR-0002:

| Module | Owns |
| --- | --- |
| `windward_api/engine/` | Process supervision and `EngineClient`. The only place a Spark Connect symbol is imported. |
| `windward_api/query/` | The interactive query path. |
| `windward_api/api/` | Routers, request/response schemas, value encoding, OpenAPI. |
| `windward_api/config.py` | Settings, read once at startup. No call site hardcodes a port. |
| `windward_api/errors.py` | Typed errors and their HTTP mapping. |

`catalog/`, `store/`, `dbt/`, and `ws/` arrive with the milestones that need
them.

## Running it

```bash
scripts/api-venv.sh                 # build the pinned environment, prints the interpreter
.venv/bin/python -m windward_api    # http://127.0.0.1:8000/api/v1/health
```

Or the whole stack on OrbStack, which is how it is meant to be run:

```bash
docker compose up --build
```

`http://127.0.0.1:8000/docs` serves the OpenAPI UI.

## Configuration

Every setting is an environment variable with the `WINDWARD_` prefix; the
defaults are in `windward_api/config.py`. The ones that matter most:

| Variable | Default | Meaning |
| --- | --- | --- |
| `WINDWARD_API_HOST` / `WINDWARD_API_PORT` | `127.0.0.1` / `8000` | Where the service listens. |
| `WINDWARD_SPARK_CONNECT_PORT` | `50051` | Engine's Spark Connect listener (ADR-0003). |
| `WINDWARD_FLIGHT_SQL_PORT` | `32010` | Engine's Arrow Flight SQL listener (ADR-0003). |
| `WINDWARD_SAIL_BIND_HOST` | `127.0.0.1` | What the engine binds to. `0.0.0.0` in the container, where the ports are still not published to the host. |
| `WINDWARD_DATA_DIR` | `./data` | The engine's working directory, so relative paths in SQL resolve there. |
| `WINDWARD_QUERY_DEFAULT_MAX_ROWS` | `1000` | M1 page size. The real cap is a frozen contract value in M2. |
| `WINDWARD_QUERY_TIMEOUT_SECONDS` | `120` | Platform-side wall clock budget for one query. |

Unknown `WINDWARD_*` variables are rejected at startup, so a typo in a
deployment is loud rather than silently ignored.

## Tests

```bash
scripts/ci-test.sh          # scaffold checks plus this suite
cd services/api && ../../.venv/bin/python -m pytest
```

Nothing is mocked. Every test boots a real Sail engine as a child of the app
under test, on ports chosen at runtime so the suite never collides with a
running stack. `scripts/smoke-m1.sh` does the same thing from the outside,
against the composed stack on OrbStack.

## Error contract

Failures answer with `{"error": {"code", "message", "detail?}}`:

| Code | Status | When |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 | The request body is wrong. |
| `SQL_ERROR` | 400 | The engine rejected or failed the statement. `message` is the engine's own, verbatim. |
| `QUERY_TIMEOUT` | 504 | The statement outlived `WINDWARD_QUERY_TIMEOUT_SECONDS`. |
| `ENGINE_UNAVAILABLE` | 503 | The engine is dead, restarting, or not up yet. |

Sail sends no error class or SQL state over Spark Connect, so there is one SQL
error code rather than a taxonomy. See `KNOWN-LIMITATIONS.md`.

Value encoding for result rows (decimals as strings, non-finite doubles as
`"NaN"`/`"Infinity"`/`"-Infinity"`, and so on) is documented in
`windward_api/api/encoding.py`.
