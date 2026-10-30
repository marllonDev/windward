"""The dbt process runner.

dbt is a short-lived subprocess: argv in, exit code and log lines out. Only one
invocation runs at a time, because every invocation writes the same target
directory. A failed dbt run is a successful API call that returns a failed run
record (ADR-0002), so nothing here raises for a non-zero exit code.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..config import Settings
from ..errors import InvalidRequestError, WindwardError

logger = logging.getLogger(__name__)

ALLOWED_COMMANDS = ("seed", "run", "test", "build")
MAX_RUNS_KEPT = 50
MAX_LOG_LINES = 5000
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


class DbtBusyError(WindwardError):
    code = "DBT_RUN_IN_PROGRESS"
    status_code = 409


class DbtNotFoundError(WindwardError):
    code = "DBT_RUN_NOT_FOUND"
    status_code = 404


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class DbtRun:
    run_id: str
    command: str
    status: str = "running"  # running | succeeded | failed
    started_at: datetime = field(default_factory=_now)
    finished_at: datetime | None = None
    exit_code: int | None = None
    log: list[str] = field(default_factory=list)
    nodes: list[dict[str, Any]] = field(default_factory=list)


class DbtRunner:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._runs: dict[str, DbtRun] = {}
        self._active: asyncio.Task[None] | None = None
        self._versions: dict[str, str | None] | None = None

    # -- paths ---------------------------------------------------------------
    @property
    def _target_dir(self) -> Path:
        return self._settings.dbt_work_dir / "target"

    def _base_args(self) -> list[str]:
        s = self._settings
        return [
            "--project-dir", str(s.dbt_project_dir),
            "--profiles-dir", str(s.dbt_profiles_dir),
            "--target-path", str(self._target_dir),
            "--log-path", str(s.dbt_work_dir / "logs"),
        ]  # fmt: skip

    def _env(self) -> dict[str, str]:
        env = dict(os.environ)
        env["DBT_SEND_ANONYMOUS_USAGE_STATS"] = "false"
        env["NO_COLOR"] = "1"
        return env

    # -- runs ------------------------------------------------------------------
    def start(self, command: str) -> DbtRun:
        if command not in ALLOWED_COMMANDS:
            raise InvalidRequestError(
                f"Unsupported dbt command {command!r}; use one of {', '.join(ALLOWED_COMMANDS)}."
            )
        if self._active is not None and not self._active.done():
            raise DbtBusyError("A dbt run is already in progress; wait for it to finish.")
        run = DbtRun(run_id=str(uuid.uuid4()), command=command)
        self._runs[run.run_id] = run
        while len(self._runs) > MAX_RUNS_KEPT:
            self._runs.pop(next(iter(self._runs)))
        self._active = asyncio.create_task(self._execute(run))
        return run

    def get(self, run_id: str) -> DbtRun:
        run = self._runs.get(run_id)
        if run is None:
            raise DbtNotFoundError(f"No dbt run with id {run_id}.")
        return run

    def list(self) -> list[DbtRun]:
        return list(reversed(self._runs.values()))

    async def _execute(self, run: DbtRun) -> None:
        argv = [self._settings.dbt_binary, run.command, *self._base_args()]
        run.log.append(f"$ dbt {run.command}")
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=self._env(),
                cwd=str(self._settings.dbt_work_dir),
            )
            assert proc.stdout is not None
            async for raw in proc.stdout:
                if len(run.log) < MAX_LOG_LINES:
                    run.log.append(_ANSI.sub("", raw.decode(errors="replace").rstrip()))
            run.exit_code = await proc.wait()
        except Exception as exc:  # the dbt binary missing is a packaging defect
            logger.exception("dbt run %s could not start", run.run_id)
            run.log.append(f"Could not start dbt: {exc}")
            run.exit_code = 127
        run.nodes = self._read_results()
        run.status = "succeeded" if run.exit_code == 0 else "failed"
        run.finished_at = _now()

    def _read_results(self) -> list[dict[str, Any]]:
        path = self._target_dir / "run_results.json"
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            return []
        return [
            {
                "unique_id": item.get("unique_id"),
                "status": item.get("status"),
                "execution_time": item.get("execution_time"),
                "message": item.get("message"),
            }
            for item in data.get("results", [])
        ]

    # -- project ---------------------------------------------------------------
    async def project(self) -> dict[str, Any]:
        """Models, seeds and their dependencies, read from dbt's manifest."""
        manifest = self._target_dir / "manifest.json"
        if not manifest.is_file() and (self._active is None or self._active.done()):
            await self._parse()
        try:
            data = json.loads(manifest.read_text())
        except (OSError, ValueError):
            return {"name": None, "nodes": [], "parsed": False, "dbt": await self.versions()}
        nodes = []
        for uid, node in data.get("nodes", {}).items():
            if node.get("resource_type") not in ("model", "seed", "test"):
                continue
            nodes.append(
                {
                    "unique_id": uid,
                    "name": node.get("name"),
                    "resource_type": node["resource_type"],
                    "materialized": (node.get("config") or {}).get("materialized"),
                    "depends_on": (node.get("depends_on") or {}).get("nodes", []),
                }
            )
        name = (data.get("metadata") or {}).get("project_name")
        return {"name": name, "nodes": nodes, "parsed": True, "dbt": await self.versions()}

    async def _parse(self) -> None:
        proc = await asyncio.create_subprocess_exec(
            self._settings.dbt_binary, "parse", *self._base_args(),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            env=self._env(), cwd=str(self._settings.dbt_work_dir),
        )  # fmt: skip
        await proc.wait()

    async def versions(self) -> dict[str, str | None]:
        # Versions cannot change while the process runs, and `dbt --version` on the
        # Python runner makes a network call for "latest", so ask once.
        if self._versions is None:
            runner = await self._version(self._settings.dbt_binary)
            installed = re.search(r"installed:\s*(\S+)", runner or "")
            self._versions = {
                "runner": f"dbt-core {installed.group(1)} + dbt-sail" if installed else runner,
                "dbt2": await self._version(self._settings.dbt2_binary),
            }
        return self._versions

    async def _version(self, binary: str) -> str | None:
        try:
            proc = await asyncio.create_subprocess_exec(
                binary, "--version",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                env=self._env(),
            )  # fmt: skip
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
        except (OSError, TimeoutError):
            return None
        text = _ANSI.sub("", out.decode(errors="replace"))
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        return " | ".join(lines[:3]) or None
