"""Request and response shapes for `/api/v1`.

The contract is frozen in M2 (ADR-0002, "Contract rules"); these are the M1
shapes the freeze will start from.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ErrorBody(BaseModel):
    code: str = Field(description="Stable machine-readable error code.")
    message: str = Field(description="Human-readable message; engine errors are verbatim.")
    detail: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class ColumnSchema(BaseModel):
    name: str
    type: str = Field(description="The engine's own type name, e.g. `decimal(10,2)`.")
    nullable: bool


class QueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sql: str = Field(min_length=1, description="One SQL statement to run on the engine.")
    max_rows: int | None = Field(
        default=None,
        ge=1,
        description="Maximum rows to return. Clamped to the service limit.",
    )


class QueryResponse(BaseModel):
    query_id: str
    state: str = Field(description="`succeeded` for every response M1 returns.")
    columns: list[ColumnSchema]
    rows: list[list[Any]] = Field(description="Row-major values, in `columns` order.")
    row_count: int
    truncated: bool = Field(description="True when the engine had more rows than `max_rows`.")
    max_rows: int
    duration_ms: float
    session_id: str
    engine_generation: int = Field(
        description="Engine process generation the query ran on. It changes when Sail restarts."
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Known engine behaviour worth telling the user about on an otherwise "
        "successful query. See KNOWN-LIMITATIONS.md.",
    )


class ProcessStatusResponse(BaseModel):
    interface: str
    host: str
    port: int
    pid: int | None
    alive: bool
    reachable: bool
    started_at: datetime | None
    restart_count: int
    last_exit_code: int | None
    last_exit_at: datetime | None
    log_tail: list[str]


class EngineStatusResponse(BaseModel):
    state: str
    generation: int
    sail_version: str | None = Field(description="Sail's own version, from the supervised binary.")
    spark_version: str | None = Field(
        description="The Spark version Sail reports over Spark Connect, i.e. the protocol "
        "it emulates -- not Sail's version."
    )
    started_at: datetime | None
    uptime_seconds: float | None
    restart_count: int
    last_error: str | None
    processes: list[ProcessStatusResponse]
