"""`/api/v1` routers. The only module the shell's contract depends on."""

from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from .. import __version__
from ..engine.client import EngineClient
from ..engine.supervisor import SailSupervisor
from ..query.service import QueryService
from .encoding import encode_rows
from .schemas import (
    ColumnSchema,
    EngineStatusResponse,
    ErrorResponse,
    HealthResponse,
    ProcessStatusResponse,
    QueryRequest,
    QueryResponse,
)


def get_supervisor(request: Request) -> SailSupervisor:
    return request.app.state.supervisor


def get_engine_client(request: Request) -> EngineClient:
    return request.app.state.engine_client


def get_query_service(request: Request) -> QueryService:
    return request.app.state.query_service


SupervisorDep = Annotated[SailSupervisor, Depends(get_supervisor)]
EngineClientDep = Annotated[EngineClient, Depends(get_engine_client)]
QueryServiceDep = Annotated[QueryService, Depends(get_query_service)]

ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    status.HTTP_400_BAD_REQUEST: {"model": ErrorResponse, "description": "Bad request or bad SQL"},
    status.HTTP_503_SERVICE_UNAVAILABLE: {
        "model": ErrorResponse,
        "description": "The engine is not reachable",
    },
    status.HTTP_504_GATEWAY_TIMEOUT: {
        "model": ErrorResponse,
        "description": "The query exceeded the platform timeout",
    },
}

router = APIRouter(prefix="/api/v1")


@router.get("/health", response_model=HealthResponse, tags=["service"])
async def health() -> HealthResponse:
    """Liveness of the platform API itself, independent of the engine."""
    return HealthResponse(status="ok", service="windward-api", version=__version__)


@router.get("/engine/status", response_model=EngineStatusResponse, tags=["engine"])
async def engine_status(
    supervisor: SupervisorDep, engine_client: EngineClientDep
) -> EngineStatusResponse:
    """What the engine is doing right now, including when it is not running.

    Engine death is a normal condition (ADR-0002): this endpoint answers 200
    with an honest state rather than failing.
    """
    spark_version = None
    if supervisor.is_query_path_ready():
        spark_version = await asyncio.to_thread(engine_client.engine_version)
    report = supervisor.status(spark_version=spark_version)
    return EngineStatusResponse(
        state=str(report.state),
        generation=report.generation,
        sail_version=report.sail_version,
        spark_version=report.spark_version,
        started_at=report.started_at,
        uptime_seconds=report.uptime_seconds,
        restart_count=report.restart_count,
        last_error=report.last_error,
        processes=[
            ProcessStatusResponse(
                interface=str(process.interface),
                host=process.host,
                port=process.port,
                pid=process.pid,
                alive=process.alive,
                reachable=process.reachable,
                started_at=process.started_at,
                restart_count=process.restart_count,
                last_exit_code=process.last_exit_code,
                last_exit_at=process.last_exit_at,
                log_tail=list(process.log_tail),
            )
            for process in report.processes
        ],
    )


@router.post(
    "/queries",
    response_model=QueryResponse,
    responses=ERROR_RESPONSES,
    tags=["query"],
)
async def submit_query(payload: QueryRequest, queries: QueryServiceDep) -> QueryResponse:
    """Run one statement on the engine and return a page of typed rows."""
    submitted = await queries.submit(payload.sql, max_rows=payload.max_rows)
    result = submitted.result
    return QueryResponse(
        query_id=submitted.query_id,
        state="succeeded",
        columns=[
            ColumnSchema(name=column.name, type=column.type, nullable=column.nullable)
            for column in result.columns
        ],
        rows=encode_rows(result.rows),
        row_count=len(result.rows),
        truncated=result.truncated,
        max_rows=submitted.max_rows,
        duration_ms=result.duration_ms,
        session_id=result.session_id,
        engine_generation=result.engine_generation,
        warnings=list(result.warnings),
    )
