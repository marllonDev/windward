"""dbt 2 project files, runs, graph and warehouse browsing.

Each project lives under `<data>/dbt2/projects/<name>` and builds into its own
DuckDB file under `<data>/dbt2/warehouse`. dbt 2 has no Sail adapter, so this is an
independent engine on purpose: it shares nothing with Sail except being started by
the same API, and a Job can run both (ADR-0007).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb

from ..config import Settings
from ..errors import InvalidRequestError, WindwardError
from .templates import starter_files

logger = logging.getLogger(__name__)

NAME = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
SELECT = re.compile(r"^[\w.:+*@,\s-]{1,200}$")
COMMANDS = ("parse", "compile", "seed", "run", "test", "build", "clean")
EDITABLE = {".sql", ".yml", ".yaml", ".csv", ".md", ".py", ".json", ".txt", ".jinja"}
HIDDEN = {"target", "logs", "dbt_packages", ".git"}
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_LOG_LINES = 5000
MAX_RUNS_KEPT = 100
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


class NotFound(WindwardError):
    code = "NOT_FOUND"
    status_code = 404


class Busy(WindwardError):
    code = "DBT_RUN_IN_PROGRESS"
    status_code = 409


class Conflict(WindwardError):
    code = "ALREADY_EXISTS"
    status_code = 409


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Dbt2Run:
    run_id: str
    project: str
    command: str
    select: str | None
    status: str = "running"
    started_at: datetime = field(default_factory=_now)
    finished_at: datetime | None = None
    exit_code: int | None = None
    log: list[str] = field(default_factory=list)
    nodes: list[dict[str, Any]] = field(default_factory=list)


class Dbt2Service:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._root = settings.data_dir / "dbt2"
        self._runs: dict[str, Dbt2Run] = {}
        self._active: dict[str, asyncio.Task[None]] = {}

    # -- paths -------------------------------------------------------------
    def _project(self, name: str) -> Path:
        if not NAME.match(name):
            raise InvalidRequestError(
                "Project names are lowercase letters, digits and underscores, starting with a letter."
            )
        return self._root / "projects" / name

    def _existing(self, name: str) -> Path:
        path = self._project(name)
        if not path.is_dir():
            raise NotFound(f"No dbt 2 project named {name!r}.")
        return path

    def _file(self, name: str, rel: str) -> Path:
        base = self._existing(name).resolve()
        target = (base / rel).resolve()
        if target == base or base not in target.parents:
            raise InvalidRequestError("The path must stay inside the project.")
        if any(part in HIDDEN for part in target.relative_to(base).parts):
            raise InvalidRequestError("That folder is managed by dbt and is not editable.")
        return target

    def warehouse_path(self, name: str) -> Path:
        return self._root / "warehouse" / f"{name}.duckdb"

    # -- projects ----------------------------------------------------------
    def list_projects(self) -> list[dict[str, Any]]:
        base = self._root / "projects"
        if not base.is_dir():
            return []
        out = []
        for path in sorted(p for p in base.iterdir() if p.is_dir()):
            files = [f for f in self._walk(path)]
            out.append(
                {
                    "name": path.name,
                    "files": len(files),
                    "updated_at": datetime.fromtimestamp(
                        max((f.stat().st_mtime for f in files), default=path.stat().st_mtime), UTC
                    ).isoformat(),
                    "has_warehouse": self.warehouse_path(path.name).is_file(),
                }
            )
        return out

    def create_project(self, name: str) -> dict[str, Any]:
        path = self._project(name)
        if path.exists():
            raise Conflict(f"A dbt 2 project named {name!r} already exists.")
        for rel, content in starter_files(name).items():
            target = path / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
        return next(p for p in self.list_projects() if p["name"] == name)

    def delete_project(self, name: str) -> None:
        shutil.rmtree(self._existing(name))
        self.warehouse_path(name).unlink(missing_ok=True)
        for run_id in [k for k, r in self._runs.items() if r.project == name]:
            self._runs.pop(run_id)

    # -- files -------------------------------------------------------------
    @staticmethod
    def _walk(base: Path) -> list[Path]:
        found: list[Path] = []
        for current, dirs, files in os.walk(base):
            dirs[:] = sorted(d for d in dirs if d not in HIDDEN)
            found += [Path(current) / f for f in sorted(files)]
        return found

    def tree(self, name: str) -> list[dict[str, Any]]:
        base = self._existing(name)
        return [{"path": str(f.relative_to(base)), "size": f.stat().st_size} for f in self._walk(base)]

    def read_file(self, name: str, rel: str) -> str:
        target = self._file(name, rel)
        if not target.is_file():
            raise NotFound(f"No file {rel!r} in project {name!r}.")
        if target.stat().st_size > MAX_FILE_BYTES:
            raise InvalidRequestError("That file is too large to edit here.")
        return target.read_text(errors="replace")

    def write_file(self, name: str, rel: str, content: str) -> None:
        target = self._file(name, rel)
        if target.suffix.lower() not in EDITABLE:
            raise InvalidRequestError(f"Files of type {target.suffix or '(none)'} are not editable.")
        if len(content.encode()) > MAX_FILE_BYTES:
            raise InvalidRequestError("That file is too large.")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def delete_file(self, name: str, rel: str) -> None:
        target = self._file(name, rel)
        if not target.is_file():
            raise NotFound(f"No file {rel!r} in project {name!r}.")
        target.unlink()

    # -- runs --------------------------------------------------------------
    def _profile_dir(self, name: str) -> Path:
        project = self._existing(name)
        text = (project / "dbt_project.yml").read_text() if (project / "dbt_project.yml").is_file() else ""
        match = re.search(r"^profile:\s*['\"]?([\w-]+)", text, re.MULTILINE)
        profile = match.group(1) if match else name
        directory = self._root / "profiles" / name
        directory.mkdir(parents=True, exist_ok=True)
        warehouse = self.warehouse_path(name)
        warehouse.parent.mkdir(parents=True, exist_ok=True)
        (directory / "profiles.yml").write_text(
            f"{profile}:\n  target: dev\n  outputs:\n    dev:\n      type: duckdb\n"
            f"      path: {warehouse}\n      threads: 1\n"
        )
        return directory

    def _argv(self, name: str, command: str, select: str | None) -> list[str]:
        if command not in COMMANDS:
            raise InvalidRequestError(
                f"Unsupported dbt command {command!r}; use one of {', '.join(COMMANDS)}."
            )
        argv = [
            self._settings.dbt2_binary, command,
            "--project-dir", str(self._existing(name)),
            "--profiles-dir", str(self._profile_dir(name)),
            "--target-path", str(self._root / "target" / name),
        ]  # fmt: skip
        if select:
            if not SELECT.match(select):
                raise InvalidRequestError("`select` has characters dbt selectors do not use.")
            if command in {"run", "test", "build", "compile", "seed"}:
                argv += ["--select", select]
        return argv

    def start(self, name: str, command: str, select: str | None = None) -> Dbt2Run:
        argv = self._argv(name, command, select)
        active = self._active.get(name)
        if active is not None and not active.done():
            raise Busy(f"A dbt 2 run is already in progress for {name!r}.")
        run = Dbt2Run(str(uuid.uuid4()), name, command, select or None)
        self._runs[run.run_id] = run
        while len(self._runs) > MAX_RUNS_KEPT:
            self._runs.pop(next(iter(self._runs)))
        self._active[name] = asyncio.create_task(self._execute(run, argv))
        return run

    async def run_to_completion(
        self, name: str, command: str, select: str | None = None, *, wait_seconds: float = 600
    ) -> Dbt2Run:
        """Start a run, waiting for a busy project, and wait until it finishes (used by Jobs)."""
        deadline = asyncio.get_running_loop().time() + wait_seconds
        while True:
            try:
                run = self.start(name, command, select)
                break
            except Busy:
                if asyncio.get_running_loop().time() > deadline:
                    raise
                await asyncio.sleep(2)
        task = self._active[name]
        await asyncio.shield(task)
        return run

    def get(self, run_id: str) -> Dbt2Run:
        run = self._runs.get(run_id)
        if run is None:
            raise NotFound(f"No dbt 2 run with id {run_id}.")
        return run

    def runs(self, name: str) -> list[Dbt2Run]:
        return [r for r in reversed(self._runs.values()) if r.project == name]

    async def _execute(self, run: Dbt2Run, argv: list[str]) -> None:
        run.log.append(f"$ dbt2 {run.command}" + (f" --select {run.select}" if run.select else ""))
        env = dict(os.environ, DBT_SEND_ANONYMOUS_USAGE_STATS="false", NO_COLOR="1")
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=env,
                cwd=str(self._root),
            )  # fmt: skip
            assert proc.stdout is not None
            async for raw in proc.stdout:
                if len(run.log) < MAX_LOG_LINES:
                    run.log.append(_ANSI.sub("", raw.decode(errors="replace").rstrip()))
            run.exit_code = await proc.wait()
        except Exception as exc:
            logger.exception("dbt 2 run %s could not start", run.run_id)
            run.log.append(f"Could not start dbt 2: {exc}")
            run.exit_code = 127
        run.nodes = self._results(run.project)
        run.status = "succeeded" if run.exit_code == 0 else "failed"
        run.finished_at = _now()

    def _results(self, name: str) -> list[dict[str, Any]]:
        try:
            data = json.loads((self._root / "target" / name / "run_results.json").read_text())
        except (OSError, ValueError):
            return []
        return [
            {
                "unique_id": r.get("unique_id"),
                "status": r.get("status"),
                "execution_time": r.get("execution_time"),
                "message": r.get("message"),
            }
            for r in data.get("results", [])
        ]

    def compiled(self, name: str, rel: str) -> str:
        """The SQL dbt produced for a model, after Jinja. Needs a parse/compile/run first."""
        project = self._existing(name)
        target = self._root / "target" / name
        candidates = [
            target / "compiled" / project.name / rel,
            *target.glob(f"compiled/*/{rel}"),
            *target.glob(f"compiled/**/{Path(rel).name}"),
        ]
        for candidate in candidates:
            if candidate.is_file():
                return candidate.read_text(errors="replace")
        raise NotFound("No compiled SQL yet — run `dbt compile` or `dbt build` first.")

    def grep(self, name: str, needle: str) -> list[dict[str, Any]]:
        """Plain substring search across the project's text files."""
        term = needle.strip()
        if len(term) < 2:
            raise InvalidRequestError("Search for at least two characters.")
        base = self._existing(name)
        hits: list[dict[str, Any]] = []
        for path in self._walk(base):
            if path.suffix.lower() not in EDITABLE or path.stat().st_size > MAX_FILE_BYTES:
                continue
            try:
                for number, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
                    if term.lower() in line.lower():
                        hits.append({
                            "path": str(path.relative_to(base)), "line": number, "text": line.strip()[:200],
                        })  # fmt: skip
                        if len(hits) >= 100:
                            return hits
            except OSError:
                continue
        return hits

    # -- graph and warehouse ---------------------------------------------------
    def graph(self, name: str) -> dict[str, Any]:
        manifest = self._root / "target" / name / "manifest.json"
        try:
            data = json.loads(manifest.read_text())
        except (OSError, ValueError):
            return {"parsed": False, "nodes": []}
        nodes = []
        for uid, node in data.get("nodes", {}).items():
            if node.get("resource_type") not in ("model", "seed"):
                continue
            nodes.append(
                {
                    "unique_id": uid,
                    "name": node.get("name"),
                    "resource_type": node["resource_type"],
                    "materialized": (node.get("config") or {}).get("materialized"),
                    "depends_on": (node.get("depends_on") or {}).get("nodes", []),
                    "path": node.get("original_file_path"),
                }
            )
        return {"parsed": True, "nodes": nodes}

    def _connect(self, name: str) -> duckdb.DuckDBPyConnection:
        path = self.warehouse_path(name)
        if not path.is_file():
            raise NotFound("This project has no warehouse yet; run `build` first.")
        return duckdb.connect(str(path), read_only=True)

    def tables(self, name: str) -> list[dict[str, Any]]:
        self._existing(name)
        if not self.warehouse_path(name).is_file():
            return []
        con = self._connect(name)
        try:
            rows = con.execute(
                "select table_schema, table_name, table_type from information_schema.tables "
                "where table_schema not in ('information_schema', 'pg_catalog') order by 1, 2"
            ).fetchall()
        finally:
            con.close()
        return [{"schema": r[0], "name": r[1], "type": r[2]} for r in rows]

    def query(self, name: str, sql: str, limit: int = 500) -> dict[str, Any]:
        self._existing(name)
        statement = sql.strip().rstrip(";")
        if not statement:
            raise InvalidRequestError("`sql` must not be empty.")
        con = self._connect(name)
        try:
            cur = con.execute(f"select * from ({statement}) limit {int(limit) + 1}")
            columns = [d[0] for d in cur.description]
            fetched = cur.fetchall()
        except duckdb.Error as exc:
            raise InvalidRequestError(str(exc)) from exc
        finally:
            con.close()
        truncated = len(fetched) > limit
        return {
            "columns": columns,
            "rows": [list(r) for r in fetched[:limit]],
            "truncated": truncated,
        }
