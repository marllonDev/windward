"""`/api/v1/jobs`, `/api/v1/job-runs`, `/api/v1/dbt2`: Jobs and dbt 2 projects."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field

from ..dbt2 import Dbt2Run, Dbt2Service
from ..errors import InvalidRequestError, WindwardError
from ..jobs import JobIn, JobRunner, validate_job
from ..store import Store

router = APIRouter(prefix="/api/v1", tags=["jobs"])


class NotFound(WindwardError):
    code = "NOT_FOUND"
    status_code = 404


def _store(request: Request) -> Store:
    return request.app.state.store


def _jobs(request: Request) -> JobRunner:
    return request.app.state.jobs


def _dbt2(request: Request) -> Dbt2Service:
    return request.app.state.dbt2


StoreDep = Annotated[Store, Depends(_store)]
JobsDep = Annotated[JobRunner, Depends(_jobs)]
Dbt2Dep = Annotated[Dbt2Service, Depends(_dbt2)]


def _spec(job: JobIn) -> dict[str, Any]:
    return {
        "description": job.description,
        "schedule": job.schedule.model_dump() if job.schedule else None,
        "parameters": [p.model_dump() for p in job.parameters],
        "tasks": [t.model_dump() for t in job.tasks],
    }


def _summary(run: dict[str, Any]) -> dict[str, Any]:
    slim = [{k: v for k, v in t.items() if k not in ("log", "output")} for t in run["tasks"]]
    return {**run, "tasks": slim}


# -- jobs ----------------------------------------------------------------------
@router.get("/jobs")
async def list_jobs(store: StoreDep, jobs: JobsDep) -> list[dict[str, Any]]:
    out = []
    for job in store.list_jobs():
        last = store.list_runs(job["id"], limit=1)
        out.append(
            {
                **job,
                "last_run": _summary(last[0]) if last else None,
                "running": jobs.is_running(job["id"]),
            }
        )
    return out


@router.post("/jobs", status_code=status.HTTP_201_CREATED)
async def create_job(payload: JobIn, store: StoreDep) -> dict[str, Any]:
    validate_job(payload)
    job = store.save_job(None, payload.name, _spec(payload))
    assert job is not None
    return job


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, store: StoreDep) -> dict[str, Any]:
    job = store.get_job(job_id)
    if job is None:
        raise NotFound("No job with that id.")
    return job


@router.put("/jobs/{job_id}")
async def update_job(job_id: str, payload: JobIn, store: StoreDep) -> dict[str, Any]:
    validate_job(payload)
    job = store.save_job(job_id, payload.name, _spec(payload))
    if job is None:
        raise NotFound("No job with that id.")
    return job


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(job_id: str, store: StoreDep, jobs: JobsDep) -> None:
    if not store.delete_job(job_id):
        raise NotFound("No job with that id.")
    del jobs


class RunIn(BaseModel):
    parameters: dict[str, str] = Field(default_factory=dict)
    #: Run only these tasks and everything downstream of them ("run from here").
    only: list[str] = Field(default_factory=list)


@router.post("/jobs/{job_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_job(
    job_id: str, store: StoreDep, jobs: JobsDep, payload: RunIn | None = None
) -> dict[str, Any]:
    if store.get_job(job_id) is None:
        raise NotFound("No job with that id.")
    body = payload or RunIn()
    return _summary(jobs.start(job_id, "manual", body.parameters, body.only or None))


@router.get("/jobs/{job_id}/runs")
async def job_runs(job_id: str, store: StoreDep, limit: Annotated[int, Query(ge=1, le=200)] = 30):
    return [_summary(r) for r in store.list_runs(job_id, limit)]


@router.get("/job-runs")
async def recent_runs(store: StoreDep, limit: Annotated[int, Query(ge=1, le=200)] = 30):
    return [_summary(r) for r in store.list_runs(None, limit)]


@router.get("/job-runs/{run_id}")
async def get_run(run_id: str, store: StoreDep) -> dict[str, Any]:
    run = store.get_run(run_id)
    if run is None:
        raise NotFound("No job run with that id.")
    return run


@router.post("/job-runs/{run_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
async def cancel_run(run_id: str, jobs: JobsDep) -> dict[str, bool]:
    return {"cancelled": jobs.cancel(run_id)}


# -- dbt 2 projects ---------------------------------------------------------------
class ProjectIn(BaseModel):
    name: str


class FileIn(BaseModel):
    content: str


class Dbt2RunIn(BaseModel):
    command: str
    select: str | None = None


class SqlIn(BaseModel):
    sql: str = Field(min_length=1)
    limit: int = Field(default=500, ge=1, le=5000)


def _render(run: Dbt2Run, after: int = 0) -> dict[str, Any]:
    return {
        "run_id": run.run_id, "project": run.project, "command": run.command, "select": run.select,
        "status": run.status, "started_at": run.started_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "exit_code": run.exit_code, "nodes": run.nodes, "log": run.log[after:], "log_total": len(run.log),
    }  # fmt: skip


@router.get("/dbt2/projects")
async def dbt2_projects(svc: Dbt2Dep) -> list[dict[str, Any]]:
    return svc.list_projects()


@router.post("/dbt2/projects", status_code=status.HTTP_201_CREATED)
async def dbt2_create(payload: ProjectIn, svc: Dbt2Dep) -> dict[str, Any]:
    return svc.create_project(payload.name)


@router.delete("/dbt2/projects/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def dbt2_delete(name: str, svc: Dbt2Dep) -> None:
    svc.delete_project(name)


@router.get("/dbt2/projects/{name}/files")
async def dbt2_files(name: str, svc: Dbt2Dep) -> list[dict[str, Any]]:
    return svc.tree(name)


@router.get("/dbt2/projects/{name}/file")
async def dbt2_read(name: str, svc: Dbt2Dep, path: Annotated[str, Query(min_length=1)]) -> dict[str, str]:
    return {"path": path, "content": svc.read_file(name, path)}


@router.put("/dbt2/projects/{name}/file")
async def dbt2_write(
    name: str, payload: FileIn, svc: Dbt2Dep, path: Annotated[str, Query(min_length=1)]
) -> dict[str, str]:
    svc.write_file(name, path, payload.content)
    return {"path": path}


@router.delete("/dbt2/projects/{name}/file", status_code=status.HTTP_204_NO_CONTENT)
async def dbt2_delete_file(name: str, svc: Dbt2Dep, path: Annotated[str, Query(min_length=1)]) -> None:
    svc.delete_file(name, path)


@router.post("/dbt2/projects/{name}/runs", status_code=status.HTTP_202_ACCEPTED)
async def dbt2_start(name: str, payload: Dbt2RunIn, svc: Dbt2Dep) -> dict[str, Any]:
    return _render(svc.start(name, payload.command, payload.select))


@router.get("/dbt2/projects/{name}/runs")
async def dbt2_runs(name: str, svc: Dbt2Dep) -> list[dict[str, Any]]:
    return [_render(r, after=len(r.log)) for r in svc.runs(name)]


@router.get("/dbt2/runs/{run_id}")
async def dbt2_run(run_id: str, svc: Dbt2Dep, after: Annotated[int, Query(ge=0)] = 0) -> dict[str, Any]:
    return _render(svc.get(run_id), after)


@router.get("/dbt2/projects/{name}/compiled")
async def dbt2_compiled(name: str, svc: Dbt2Dep, path: Annotated[str, Query(min_length=1)]) -> dict[str, str]:
    return {"path": path, "content": svc.compiled(name, path)}


@router.get("/dbt2/projects/{name}/search")
async def dbt2_search(name: str, svc: Dbt2Dep, q: Annotated[str, Query(min_length=2)]):
    return svc.grep(name, q)


@router.get("/dbt2/projects/{name}/graph")
async def dbt2_graph(name: str, svc: Dbt2Dep) -> dict[str, Any]:
    return svc.graph(name)


@router.get("/dbt2/projects/{name}/tables")
async def dbt2_tables(name: str, svc: Dbt2Dep) -> list[dict[str, Any]]:
    return svc.tables(name)


@router.post("/dbt2/projects/{name}/query")
async def dbt2_query(name: str, payload: SqlIn, svc: Dbt2Dep) -> dict[str, Any]:
    if not payload.sql.strip():
        raise InvalidRequestError("`sql` must not be empty.")
    return svc.query(name, payload.sql, payload.limit)
