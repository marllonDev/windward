"""The interactive query path.

M1 scope is one synchronous statement at a time: submit SQL, get a page of
typed rows. Sessions as a first-class API resource (create, reuse, idle expiry,
kill), server-side cancel, and the result spool are M2; the engine session
itself is already reused across requests and reported lost across an engine
restart, because that is the supervisor's contract (ADR-0002).
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from ..config import Settings
from ..engine.client import EngineClient
from ..engine.types import QueryResult
from ..errors import InvalidRequestError, QueryTimeoutError

logger = logging.getLogger(__name__)


class SubmittedQuery:
    """A finished query and the id it is known by."""

    def __init__(self, query_id: str, result: QueryResult, max_rows: int) -> None:
        self.query_id = query_id
        self.result = result
        self.max_rows = max_rows


class QueryService:
    def __init__(self, settings: Settings, engine_client: EngineClient) -> None:
        self._settings = settings
        self._engine = engine_client

    async def submit(self, sql: str, *, max_rows: int | None = None) -> SubmittedQuery:
        statement = sql.strip()
        if not statement:
            raise InvalidRequestError("`sql` must not be empty.")

        limit = max_rows if max_rows is not None else self._settings.query_default_max_rows
        if limit < 1:
            raise InvalidRequestError("`max_rows` must be at least 1.")
        limit = min(limit, self._settings.query_max_rows_limit)

        query_id = str(uuid.uuid4())
        logger.info("query %s: %s", query_id, statement.replace("\n", " ")[:200])
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(self._engine.execute_sql, statement, max_rows=limit),
                timeout=self._settings.query_timeout_seconds,
            )
        except TimeoutError as exc:
            # The worker thread cannot be cancelled from here. Server-side
            # cancellation is M2's `DELETE /queries/{id}` -- until then the
            # orphaned statement runs to completion and its result is dropped.
            raise QueryTimeoutError(
                f"The query exceeded the {self._settings.query_timeout_seconds:.0f}s platform timeout.",
                detail={"query_id": query_id},
            ) from exc
        return SubmittedQuery(query_id=query_id, result=result, max_rows=limit)
