"""Spark Connect implementation of ``EngineClient``.

This module is the only place in the platform API that imports a Spark Connect
symbol (ADR-0002). The interactive query path uses Spark Connect on 50051
because the workload is session-shaped: a human keeps a session across several
queries and wants to cancel one in-flight statement (ADR-0003).
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

import grpc
from pyspark.errors import PySparkException
from pyspark.sql import SparkSession
from pyspark.sql.connect.client.retries import DefaultPolicy

from ..config import Settings
from ..errors import EngineUnavailableError, QueryFailedError
from .supervisor import SailSupervisor
from .types import Column, QueryResult

logger = logging.getLogger(__name__)

#: gRPC statuses that mean "the engine is not there", as opposed to "the engine
#: rejected your SQL". Verified against Sail 0.7.2 by killing the engine mid
#: session: the client raises SparkConnectGrpcException with UNAVAILABLE.
_TRANSPORT_STATUSES = frozenset(
    {
        grpc.StatusCode.UNAVAILABLE,
        grpc.StatusCode.DEADLINE_EXCEEDED,
        grpc.StatusCode.CANCELLED,
        grpc.StatusCode.UNIMPLEMENTED,
    }
)


class SparkConnectEngineClient:
    """Holds one Spark Connect session, recreated after an engine restart."""

    def __init__(self, settings: Settings, supervisor: SailSupervisor) -> None:
        self._settings = settings
        self._supervisor = supervisor
        # Reentrant: the error translation path invalidates the cached session
        # while session creation already holds the lock.
        self._lock = threading.RLock()
        self._session: SparkSession | None = None
        self._session_generation = 0
        self._engine_version: str | None = None
        #: Called (from a worker thread) after the session id changes, so the app can
        #: reset notebook kernels and rebuild what lived in the lost catalog.
        self.on_session_rotated: Callable[[], None] | None = None

    # -- EngineClient ------------------------------------------------------

    def execute_sql(self, sql: str, *, max_rows: int) -> QueryResult:
        try:
            return self._execute_sql(sql, max_rows=max_rows)
        except QueryFailedError as exc:
            if not _is_session_lost(str(exc)):
                raise
        # Sail removed our session (idle timeout, or the server dropped it). The same id
        # cannot be reopened, so move to a new one and retry once.
        self.rotate_session()
        return self._execute_sql(sql, max_rows=max_rows)

    def rotate_session(self) -> None:
        with self._lock:
            stale = self._session
            self._session = None
            self._engine_version = None
            self._settings.engine_session_id = str(uuid.uuid4())
        logger.warning(
            "Spark Connect session was lost; moved to %s", self._settings.engine_session_id
        )
        if stale is not None:
            _close_quietly(stale)
        if self.on_session_rotated is not None:
            self.on_session_rotated()

    def _execute_sql(self, sql: str, *, max_rows: int) -> QueryResult:
        session, generation = self._acquire_session()
        started = time.perf_counter()
        try:
            # Ask for one row more than the page so "there is more" is a fact
            # from the engine rather than a guess.
            frame = session.sql(sql).limit(max_rows + 1)
            schema = frame.schema
            table = frame.toArrow()
        except BaseException as exc:  # noqa: BLE001 - re-raised as a typed error
            raise self._translate(exc) from exc
        duration_ms = (time.perf_counter() - started) * 1000.0

        columns = tuple(
            Column(name=field.name, type=field.dataType.simpleString(), nullable=field.nullable)
            for field in schema.fields
        )
        truncated = table.num_rows > max_rows
        page = table.slice(0, max_rows) if truncated else table
        # Column-wise extraction, because a result set may carry duplicate
        # column names and a row dict would silently drop them.
        column_values = [page.column(index).to_pylist() for index in range(page.num_columns)]
        rows: tuple[tuple[Any, ...], ...] = (
            tuple(zip(*column_values, strict=True)) if column_values else ()
        )

        return QueryResult(
            columns=columns,
            rows=rows,
            truncated=truncated,
            engine_generation=generation,
            session_id=_session_id(session),
            duration_ms=duration_ms,
            warnings=_warnings_for(columns),
        )

    def engine_version(self) -> str | None:
        """The version string the engine reports over Spark Connect.

        Sail answers with the Spark version it emulates, not its own version,
        so engine status reports this separately from ``sail --version``.
        """
        if self._engine_version is not None:
            return self._engine_version
        try:
            session, _ = self._acquire_session()
            self._engine_version = session.version
        except Exception as exc:  # noqa: BLE001 - status must never fail
            logger.debug("could not read the engine version: %s", exc)
            return None
        return self._engine_version

    def invalidate(self, generation: int) -> None:
        with self._lock:
            session = self._session
            self._session = None
            self._session_generation = generation
            self._engine_version = None
        if session is not None:
            logger.info("dropping Spark Connect session after engine generation %s", generation)
            _close_quietly(session)

    def close(self) -> None:
        with self._lock:
            session = self._session
            self._session = None
        if session is not None:
            _close_quietly(session)

    # -- internals ---------------------------------------------------------

    def _acquire_session(self) -> tuple[SparkSession, int]:
        if not self._supervisor.is_query_path_ready():
            raise EngineUnavailableError(
                "The Sail engine is not accepting connections.",
                detail={"engine_state": str(self._supervisor.state)},
            )
        with self._lock:
            generation = self._supervisor.generation
            if self._session is not None and self._session_generation == generation:
                return self._session, generation
            stale = self._session
            self._session = None
            self._engine_version = None
            if stale is not None:
                logger.info(
                    "Spark Connect session %s is lost: engine generation moved to %s",
                    _session_id(stale),
                    generation,
                )
                _close_quietly(stale)
            try:
                session = self._new_session()
            except BaseException as exc:  # noqa: BLE001 - re-raised as a typed error
                raise self._translate(exc) from exc
            self._session = session
            self._session_generation = generation
            return session, generation

    def _new_session(self) -> SparkSession:
        session = SparkSession.builder.remote(self._settings.spark_connect_session_url).create()
        # Spark Connect's default policy retries an unreachable server for up
        # to ten minutes, which would turn engine death into a hang. We detect
        # death in the supervisor, so the client should fail fast and let the
        # API report ENGINE_UNAVAILABLE.
        session.client.set_retry_policies(
            [
                DefaultPolicy(
                    max_retries=self._settings.engine_client_max_retries,
                    initial_backoff=self._settings.engine_client_initial_backoff_ms,
                    max_backoff=self._settings.engine_client_max_backoff_ms,
                    max_server_retry_delay=self._settings.engine_client_max_backoff_ms,
                )
            ]
        )
        return session

    def _translate(self, exc: BaseException) -> Exception:
        """Map an engine-side failure onto the platform's typed errors.

        Sail sends no error class or SQL state over Spark Connect -- the
        condition is only embedded in the message text -- so there is one SQL
        error code and the engine's own message. See KNOWN-LIMITATIONS.md.
        """
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):  # pragma: no cover
            raise exc
        status = getattr(exc, "_grpc_status_code", None)
        if isinstance(exc, grpc.RpcError):
            status = exc.code()
        if status in _TRANSPORT_STATUSES:
            self.invalidate(self._supervisor.generation)
            return EngineUnavailableError(
                "The Sail engine became unreachable while running the statement.",
                detail={"engine_state": str(self._supervisor.state), "grpc_status": str(status)},
            )
        if isinstance(exc, PySparkException):
            return QueryFailedError(str(exc))
        return QueryFailedError(f"{type(exc).__name__}: {exc}")


#: Sail 0.7.2 resolves a Parquet path that does not exist to an empty relation
#: with an empty schema and answers with zero rows, where JVM Spark raises
#: "Path does not exist". A mistyped path therefore looks like an empty table.
#: We do not read the user's filesystem to second-guess the engine (ADR-0002
#: rejected that), so the divergence is reported on the result instead.
EMPTY_SCHEMA_WARNING = (
    "The engine returned a result with no columns. In Sail 0.7.2 a Parquet path that does not "
    "exist resolves to an empty relation instead of failing, so check the path before reading "
    "this as an empty table."
)


def _warnings_for(columns: tuple[Column, ...]) -> tuple[str, ...]:
    return () if columns else (EMPTY_SCHEMA_WARNING,)


def _is_session_lost(message: str) -> bool:
    return "is not running" in message and "session" in message.lower()


def _session_id(session: SparkSession) -> str:
    # pyspark-client 4.2.0 exposes the session id only on the client object.
    return str(getattr(session.client, "_session_id", ""))


def _close_quietly(session: SparkSession) -> None:
    try:
        session.client.close()
    except Exception as exc:  # noqa: BLE001 - teardown must not mask the cause
        logger.debug("closing Spark Connect session failed: %s", exc)
