"""The one interface the rest of the platform API uses to reach Sail.

Per ADR-0002 every call into the engine goes through ``EngineClient``, and no
call site outside this package imports a Spark Connect or Arrow Flight symbol.
That is what keeps the transport decision in ADR-0003 reversible.

Implementations are blocking: the Spark Connect client is synchronous gRPC. The
query layer is responsible for running them off the event loop.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .types import QueryResult


@runtime_checkable
class EngineClient(Protocol):
    def execute_sql(self, sql: str, *, max_rows: int, tag: str | None = None) -> QueryResult:
        """Run one statement and return at most ``max_rows`` rows.

        Raises
        ------
        windward_api.errors.EngineUnavailableError
            The engine could not be reached.
        windward_api.errors.QueryFailedError
            The engine rejected or failed the statement.
        """

    def cancel(self, tag: str) -> None:
        """Interrupt whatever is running under ``tag``. Never raises."""

    def engine_version(self) -> str | None:
        """The version the engine reports over its own protocol, or None."""

    def invalidate(self, generation: int) -> None:
        """Drop cached state because the engine was restarted.

        Sessions do not survive an engine restart (ADR-0002); after this call
        the next statement opens a fresh session.
        """

    def close(self) -> None:
        """Release client-side resources. Must be safe with a dead engine."""
