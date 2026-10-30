"""Engine-facing value types.

These are deliberately free of any Spark Connect or Arrow Flight symbol: they
are what the rest of the platform API sees, which is what makes the transport
decision in ADR-0003 reversible.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any


class EngineInterface(StrEnum):
    """The two listeners Sail exposes, one supervised process each."""

    SPARK_CONNECT = "spark_connect"
    FLIGHT_SQL = "flight_sql"


class EngineState(StrEnum):
    """Lifecycle of the engine as a whole, as reported to the shell."""

    #: Not started yet, or deliberately stopped.
    STOPPED = "stopped"
    #: A child process is up but has not accepted a connection yet.
    STARTING = "starting"
    #: Both listeners are alive and accepting connections.
    RUNNING = "running"
    #: At least one listener is up and at least one is not.
    DEGRADED = "degraded"
    #: A child died and the supervisor is waiting out its backoff.
    RESTARTING = "restarting"


@dataclass(frozen=True)
class ProcessStatus:
    interface: EngineInterface
    host: str
    port: int
    pid: int | None
    alive: bool
    reachable: bool
    started_at: datetime | None
    restart_count: int
    last_exit_code: int | None
    last_exit_at: datetime | None
    log_tail: tuple[str, ...] = ()


@dataclass(frozen=True)
class EngineStatus:
    state: EngineState
    #: Incremented every time the Spark Connect listener is (re)started.
    #: Sessions created in an older generation are lost (ADR-0002).
    generation: int
    #: Sail's own version, read from the supervised binary.
    sail_version: str | None
    #: The Spark version Sail reports over Spark Connect, which is the protocol
    #: it emulates -- not Sail's version. See KNOWN-LIMITATIONS.md.
    spark_version: str | None
    started_at: datetime | None
    uptime_seconds: float | None
    restart_count: int
    last_error: str | None
    processes: tuple[ProcessStatus, ...]


@dataclass(frozen=True)
class Column:
    """One result column, with the engine's own type name."""

    name: str
    #: Engine type name, e.g. `bigint`, `decimal(10,2)`, `timestamp_ntz`.
    type: str
    nullable: bool


@dataclass(frozen=True)
class QueryResult:
    columns: tuple[Column, ...]
    #: Native Python values (``Decimal``, ``date``, ``datetime``, ``bytes``,
    #: ``None``, ...). JSON encoding happens in the API layer.
    rows: tuple[tuple[Any, ...], ...]
    #: True when the engine had more rows than the requested page.
    truncated: bool
    engine_generation: int
    session_id: str
    duration_ms: float
    #: Engine behaviour the caller should know about but that is not an error,
    #: e.g. a known Sail divergence from JVM Spark. Surfaced in the response
    #: rather than hidden, per KNOWN-LIMITATIONS.md.
    warnings: tuple[str, ...] = ()
