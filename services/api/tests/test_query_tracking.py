"""The query service's bookkeeping: running list, history and cancellation."""

from __future__ import annotations

import asyncio

import pytest

from windward_api.config import Settings
from windward_api.engine.types import Column, QueryResult
from windward_api.errors import QueryFailedError
from windward_api.query.service import QueryCancelledError, QueryService


class FakeEngine:
    """Blocks until released, and reports a cancellation the way Sail does."""

    def __init__(self) -> None:
        self.gate = __import__("threading").Event()
        self.cancelled: list[str] = []

    def execute_sql(self, sql: str, *, max_rows: int, tag: str | None = None) -> QueryResult:
        self.gate.wait(timeout=5)
        if tag in self.cancelled:
            raise QueryFailedError("[OPERATION_CANCELED] operation cancelled by user")
        return QueryResult(
            columns=(Column(name="a", type="int", nullable=False),), rows=((1,),), truncated=False,
            engine_generation=1, session_id="s", duration_ms=1.0, warnings=(),
        )  # fmt: skip

    def cancel(self, tag: str) -> None:
        self.cancelled.append(tag)
        self.gate.set()

    def engine_version(self) -> str | None:
        return "4.2.0"

    def invalidate(self, generation: int) -> None:
        pass

    def close(self) -> None:
        pass


@pytest.mark.asyncio
async def test_cancel_marks_the_query_cancelled_and_clears_the_running_list() -> None:
    engine = FakeEngine()
    service = QueryService(Settings(), engine)
    task = asyncio.create_task(service.submit("select 1"))
    await asyncio.sleep(0.05)
    assert len(service.running()) == 1
    query_id = service.running()[0]["query_id"]
    assert service.cancel(query_id) is True
    with pytest.raises(QueryCancelledError):
        await task
    assert service.running() == []
    assert service.recent()[0]["state"] == "cancelled"


@pytest.mark.asyncio
async def test_a_finished_query_lands_in_history_and_cancel_answers_false() -> None:
    engine = FakeEngine()
    engine.gate.set()
    service = QueryService(Settings(), engine)
    submitted = await service.submit("select 1")
    assert service.running() == []
    record = service.recent()[0]
    assert record["state"] == "succeeded" and record["row_count"] == 1
    assert service.cancel(submitted.query_id) is False
