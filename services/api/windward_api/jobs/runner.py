"""Executes Jobs: a DAG of tasks, run concurrently where independent.

A Job mixes engines on purpose. SQL, notebook and Python tasks run on Sail; `dbt_sail`
runs a dbt project against Sail; `dbt2` runs a dbt 2 project on DuckDB. A failed task
skips everything downstream of it and fails the run (the same contract as Databricks
Workflows). Run state is written to SQLite after every change so the UI can poll it
and a restart cannot lose history.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from croniter import croniter

from ..config import Settings
from ..dbt import DbtRunner
from ..dbt2 import Dbt2Service
from ..errors import InvalidRequestError, WindwardError
from ..kernel import KernelManager
from ..query.service import QueryService
from ..store import Store
from .spec import split_statements

logger = logging.getLogger(__name__)

MAX_LOG_LINES = 2000
OUTPUT_ROWS = 50
BAD = {"failed", "skipped", "cancelled"}


class TaskFailed(Exception):
    """A task finished unsuccessfully; the message is shown in the run."""


def _now() -> str:
    return datetime.now(UTC).isoformat()


class JobRunner:
    def __init__(
        self,
        settings: Settings,
        store: Store,
        queries: QueryService,
        kernels: KernelManager,
        dbt_sail: DbtRunner,
        dbt2: Dbt2Service,
    ) -> None:
        self._settings = settings
        self._store = store
        self._queries = queries
        self._kernels = kernels
        self._dbt_sail = dbt_sail
        self._dbt2 = dbt2
        self._active: dict[str, asyncio.Task[None]] = {}
        self._job_of_run: dict[str, str] = {}
        self._last_check: dict[str, datetime] = {}
        self._scheduler: asyncio.Task[None] | None = None

    # -- lifecycle -----------------------------------------------------------
    def recover(self) -> None:
        count = self._store.interrupt_running_runs()
        if count:
            logger.warning("marked %d job run(s) interrupted by the previous shutdown", count)

    def start_scheduler(self) -> None:
        self._scheduler = asyncio.create_task(self._schedule_loop())

    async def close(self) -> None:
        if self._scheduler:
            self._scheduler.cancel()
        for task in list(self._active.values()):
            task.cancel()
        await asyncio.gather(*self._active.values(), return_exceptions=True)

    # -- API -----------------------------------------------------------------
    def is_running(self, job_id: str) -> bool:
        return any(
            not self._active[r].done()
            for r, j in self._job_of_run.items()
            if j == job_id and r in self._active
        )

    def start(self, job_id: str, trigger: str = "manual") -> dict[str, Any]:
        job = self._store.get_job(job_id)
        if job is None:
            raise InvalidRequestError("No job with that id.")
        run = {
            "id": str(uuid4()), "job_id": job_id, "job_name": job["name"], "status": "running",
            "trigger": trigger, "started_at": _now(), "finished_at": None,
            "tasks": [
                {
                    "key": t["key"], "name": t.get("name") or t["key"], "type": t["type"],
                    "depends_on": t.get("depends_on", []), "status": "pending", "started_at": None,
                    "finished_at": None, "log": [], "output": None, "error": None,
                }
                for t in job["tasks"]
            ],
        }  # fmt: skip
        self._store.insert_run(run)
        self._job_of_run[run["id"]] = job_id
        self._active[run["id"]] = asyncio.create_task(self._execute(run, job))
        return run

    def cancel(self, run_id: str) -> bool:
        task = self._active.get(run_id)
        if task is None or task.done():
            return False
        task.cancel()
        return True

    # -- execution -----------------------------------------------------------
    def _save(self, run: dict[str, Any]) -> None:
        for task in run["tasks"]:
            del task["log"][:-MAX_LOG_LINES]
        self._store.update_run(run)

    async def _execute(self, run: dict[str, Any], job: dict[str, Any]) -> None:
        specs = {t["key"]: t for t in job["tasks"]}
        states = {t["key"]: t for t in run["tasks"]}
        pending, running = set(specs), {}
        try:
            while pending or running:
                for key in sorted(pending):
                    deps = specs[key].get("depends_on", [])
                    if any(states[d]["status"] in BAD for d in deps):
                        states[key].update(status="skipped", error="An upstream task did not succeed.")
                        pending.discard(key)
                    elif all(states[d]["status"] == "succeeded" for d in deps):
                        pending.discard(key)
                        running[key] = asyncio.create_task(self._run_task(run, specs[key], states[key]))
                self._save(run)
                if not running:
                    break
                done, _ = await asyncio.wait(running.values(), return_when=asyncio.FIRST_COMPLETED)
                for key in [k for k, t in running.items() if t in done]:
                    running.pop(key)
            failed = any(t["status"] == "failed" for t in run["tasks"])
            run["status"] = "failed" if failed else "succeeded"
        except asyncio.CancelledError:
            for task in running.values():
                task.cancel()
            await asyncio.gather(*running.values(), return_exceptions=True)
            for state in run["tasks"]:
                if state["status"] in ("running", "pending"):
                    state["status"] = "cancelled"
            run["status"] = "cancelled"
        except Exception:
            logger.exception("job run %s crashed", run["id"])
            run["status"] = "failed"
        run["finished_at"] = _now()
        self._save(run)

    async def _run_task(self, run: dict[str, Any], spec: dict[str, Any], state: dict[str, Any]) -> None:
        state.update(status="running", started_at=_now())
        self._save(run)
        log = state["log"]
        started = time.perf_counter()
        try:
            handler = getattr(self, f"_task_{spec['type']}")
            await asyncio.wait_for(
                handler(run["id"], spec, state, log), timeout=spec.get("timeout_seconds", 3600)
            )
            state["status"] = "succeeded"
        except asyncio.CancelledError:
            state["status"] = "cancelled"
            raise
        except TimeoutError:
            state.update(status="failed", error=f"Timed out after {spec.get('timeout_seconds', 3600)} s.")
        except TaskFailed as exc:
            state.update(status="failed", error=str(exc))
        except WindwardError as exc:
            state.update(status="failed", error=exc.message)
        except Exception as exc:
            logger.exception("task %s crashed", spec["key"])
            state.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        log.append(f"-- {state['status']} in {time.perf_counter() - started:.1f}s")
        state["finished_at"] = _now()
        self._save(run)

    # -- task types ----------------------------------------------------------
    async def _sql(self, statements: list[str], state: dict[str, Any], log: list[str]) -> None:
        for index, statement in enumerate(statements, 1):
            result = (await self._queries.submit(statement, max_rows=OUTPUT_ROWS)).result
            log.append(
                f"[{index}/{len(statements)}] {' '.join(statement.split())[:90]} "
                f"-> {len(result.rows)} rows, {result.duration_ms:.0f} ms"
            )
            if result.columns:
                state["output"] = {
                    "columns": [c.name for c in result.columns],
                    "rows": [[_plain(v) for v in row] for row in result.rows],
                }

    async def _task_sql(self, run_id: str, spec: dict, state: dict, log: list[str]) -> None:
        text = spec["config"].get("sql", "")
        saved = spec["config"].get("saved_query_id")
        if saved:
            row = next((q for q in self._store.list_queries() if q["id"] == saved), None)
            if row is None:
                raise TaskFailed("The saved query no longer exists.")
            text = row["sql"]
        statements = split_statements(text)
        if not statements:
            raise TaskFailed("The SQL is empty.")
        await self._sql(statements, state, log)

    async def _python(self, kernel_id: str, code: str, state: dict, log: list[str]) -> None:
        reply = await self._kernels.run(kernel_id, code)
        for line in (reply.get("stdout") or "").splitlines():
            log.append(line)
        if reply.get("error"):
            raise TaskFailed(reply["error"].strip().splitlines()[-1] if reply["error"].strip() else "error")
        result = reply.get("result")
        if result and result.get("type") == "table":
            state["output"] = {"columns": result["columns"], "rows": result["rows"][:OUTPUT_ROWS]}
        elif result:
            log.append(result.get("text", ""))

    async def _task_python(self, run_id: str, spec: dict, state: dict, log: list[str]) -> None:
        kernel = f"job-{run_id}-{spec['key']}"
        try:
            await self._python(kernel, spec["config"]["code"], state, log)
        finally:
            await self._kernels.reset(kernel)

    async def _task_notebook(self, run_id: str, spec: dict, state: dict, log: list[str]) -> None:
        notebook = self._store.get_notebook(spec["config"]["notebook_id"])
        if notebook is None:
            raise TaskFailed("The notebook no longer exists.")
        kernel = f"job-{run_id}-{spec['key']}"
        log.append(f"notebook: {notebook['name']}")
        try:
            for index, cell in enumerate(notebook["cells"], 1):
                source = (cell.get("source") or "").strip()
                if cell["type"] == "markdown" or not source:
                    continue
                log.append(f"-- cell {index} ({cell['type']})")
                if cell["type"] == "sql":
                    await self._sql(split_statements(source), state, log)
                else:
                    await self._python(kernel, source, state, log)
        finally:
            await self._kernels.reset(kernel)

    async def _task_dbt_sail(self, run_id: str, spec: dict, state: dict, log: list[str]) -> None:
        while True:
            try:
                dbt_run = self._dbt_sail.start(spec["config"]["command"])
                break
            except WindwardError as exc:
                if exc.code != "DBT_RUN_IN_PROGRESS":
                    raise
                await asyncio.sleep(2)
        seen = 0
        while dbt_run.status == "running":
            await asyncio.sleep(1)
            log.extend(dbt_run.log[seen:])
            seen = len(dbt_run.log)
        log.extend(dbt_run.log[seen:])
        if dbt_run.status != "succeeded":
            raise TaskFailed(f"dbt {dbt_run.command} failed with exit code {dbt_run.exit_code}.")

    async def _task_dbt2(self, run_id: str, spec: dict, state: dict, log: list[str]) -> None:
        config = spec["config"]
        result = await self._dbt2.run_to_completion(
            config["project"], config["command"], config.get("select") or None
        )
        log.extend(result.log)
        if result.status != "succeeded":
            raise TaskFailed(f"dbt 2 {result.command} failed with exit code {result.exit_code}.")

    # -- schedule ------------------------------------------------------------
    async def _schedule_loop(self) -> None:
        while True:
            await asyncio.sleep(15)
            try:
                self.fire_due(datetime.now(UTC))
            except Exception:
                logger.exception("scheduler tick failed")

    def fire_due(self, now: datetime, start: Callable[..., Any] | None = None) -> list[str]:
        fired: list[str] = []
        for job in self._store.list_jobs():
            schedule = job.get("schedule")
            if not schedule or not schedule.get("enabled", True):
                continue
            last = self._last_check.get(job["id"], now)
            self._last_check[job["id"]] = now
            try:
                due = croniter(schedule["cron"], last).get_next(datetime) <= now
            except (ValueError, KeyError):
                continue
            if not due:
                continue
            if self.is_running(job["id"]):
                logger.info("job %s is still running; skipping this schedule", job["name"])
                continue
            (start or self.start)(job["id"], "schedule")
            fired.append(job["id"])
        return fired


def _plain(value: Any) -> Any:
    return value if isinstance(value, (str, int, float, bool, type(None))) else str(value)
