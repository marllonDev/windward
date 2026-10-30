"""`/api/v1/dbt` endpoints: project graph, run submission, run records with logs."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field

from ..dbt import DbtRun, DbtRunner


def get_runner(request: Request) -> DbtRunner:
    return request.app.state.dbt_runner


RunnerDep = Annotated[DbtRunner, Depends(get_runner)]

router = APIRouter(prefix="/api/v1/dbt", tags=["dbt"])


class DbtRunRequest(BaseModel):
    command: str = Field(description="One of `seed`, `run`, `test`, `build`.")


class DbtRunResponse(BaseModel):
    run_id: str
    command: str
    status: str = Field(description="`running`, `succeeded` or `failed`.")
    started_at: str
    finished_at: str | None
    exit_code: int | None
    nodes: list[dict[str, Any]]
    log: list[str]
    log_total: int = Field(description="Total log lines so far; pass as `after` to poll.")


def _render(run: DbtRun, after: int = 0) -> DbtRunResponse:
    return DbtRunResponse(
        run_id=run.run_id,
        command=run.command,
        status=run.status,
        started_at=run.started_at.isoformat(),
        finished_at=run.finished_at.isoformat() if run.finished_at else None,
        exit_code=run.exit_code,
        nodes=run.nodes,
        log=run.log[after:],
        log_total=len(run.log),
    )


@router.get("/project")
async def project(runner: RunnerDep) -> dict[str, Any]:
    return await runner.project()


@router.post("/runs", response_model=DbtRunResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_run(payload: DbtRunRequest, runner: RunnerDep) -> DbtRunResponse:
    return _render(runner.start(payload.command))


@router.get("/runs", response_model=list[DbtRunResponse])
async def list_runs(runner: RunnerDep) -> list[DbtRunResponse]:
    return [_render(run, after=max(len(run.log), 0)) for run in runner.list()]


@router.get("/runs/{run_id}", response_model=DbtRunResponse)
async def get_run(
    run_id: str, runner: RunnerDep, after: Annotated[int, Query(ge=0)] = 0
) -> DbtRunResponse:
    return _render(runner.get(run_id), after=after)
