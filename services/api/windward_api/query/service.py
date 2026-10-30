"""The interactive query path: submit, track and cancel statements.

A statement runs in a worker thread (the Spark Connect client is blocking) and is
tagged with its query id, so `cancel` can interrupt that exact statement from the
event loop. Finished queries stay in a small ring buffer so the shell can show what
is running right now and what the last statements cost.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from ..config import Settings
from ..engine.client import EngineClient
from ..engine.spark_connect import is_cancellation
from ..engine.types import QueryResult
from ..errors import InvalidRequestError, QueryFailedError, QueryTimeoutError, WindwardError

logger = logging.getLogger(__name__)

HISTORY = 100


class QueryCancelledError(WindwardError):
    code = "QUERY_CANCELLED"
    status_code = 499


class SubmittedQuery:
    """A finished query and the id it is known by."""

    def __init__(self, query_id: str, result: QueryResult, max_rows: int) -> None:
        self.query_id = query_id
        self.result = result
        self.max_rows = max_rows


@dataclass
class QueryRecord:
    query_id: str
    sql: str
    state: str = "running"
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    finished_at: datetime | None = None
    duration_ms: float | None = None
    row_count: int | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "query_id": self.query_id,
            "sql": self.sql,
            "state": self.state,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "duration_ms": self.duration_ms,
            "row_count": self.row_count,
            "error": self.error,
        }


class QueryService:
    def __init__(self, settings: Settings, engine_client: EngineClient) -> None:
        self._settings = settings
        self._engine = engine_client
        self._running: dict[str, QueryRecord] = {}
        self._finished: deque[QueryRecord] = deque(maxlen=HISTORY)
        self._cancelled: set[str] = set()

    # -- introspection ------------------------------------------------------
    def running(self) -> list[dict[str, Any]]:
        return [r.as_dict() for r in self._running.values()]

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        return [r.as_dict() for r in list(self._finished)[-limit:][::-1]]

    def cancel(self, query_id: str) -> bool:
        record = self._running.get(query_id)
        if record is None:
            return False
        self._cancelled.add(query_id)
        self._engine.cancel(query_id)
        logger.info("cancel requested for query %s", query_id)
        return True

    # -- execution ----------------------------------------------------------
    async def submit(self, sql: str, *, max_rows: int | None = None) -> SubmittedQuery:
        statement = sql.strip()
        if not statement:
            raise InvalidRequestError("`sql` must not be empty.")

        limit = max_rows if max_rows is not None else self._settings.query_default_max_rows
        if limit < 1:
            raise InvalidRequestError("`max_rows` must be at least 1.")
        limit = min(limit, self._settings.query_max_rows_limit)

        query_id = str(uuid.uuid4())
        record = QueryRecord(query_id=query_id, sql=statement[:4000])
        self._running[query_id] = record
        logger.info("query %s: %s", query_id, statement.replace("\n", " ")[:200])
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(self._engine.execute_sql, statement, max_rows=limit, tag=query_id),
                timeout=self._settings.query_timeout_seconds,
            )
        except TimeoutError as exc:
            self._engine.cancel(query_id)
            self._finish(record, state="timeout", error="platform timeout")
            raise QueryTimeoutError(
                f"The query exceeded the {self._settings.query_timeout_seconds:.0f}s platform timeout.",
                detail={"query_id": query_id},
            ) from exc
        except QueryFailedError as exc:
            if query_id in self._cancelled or is_cancellation(str(exc)):
                self._finish(record, state="cancelled", error="cancelled")
                raise QueryCancelledError("The query was cancelled.", detail={"query_id": query_id}) from exc
            self._finish(record, state="failed", error=str(exc)[:2000])
            raise
        except BaseException:
            self._finish(record, state="failed", error="the statement did not complete")
            raise
        finally:
            self._cancelled.discard(query_id)
        self._finish(record, state="succeeded", duration_ms=result.duration_ms, rows=len(result.rows))
        return SubmittedQuery(query_id=query_id, result=result, max_rows=limit)

    def _finish(
        self,
        record: QueryRecord,
        *,
        state: str,
        error: str | None = None,
        duration_ms: float | None = None,
        rows: int | None = None,
    ) -> None:
        record.state = state
        record.error = error
        record.finished_at = datetime.now(UTC)
        record.duration_ms = (
            duration_ms
            if duration_ms is not None
            else ((record.finished_at - record.started_at).total_seconds() * 1000)
        )
        record.row_count = rows
        self._running.pop(record.query_id, None)
        self._finished.append(record)
