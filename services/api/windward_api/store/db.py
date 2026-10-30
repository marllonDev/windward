"""SQLite persistence for saved queries and notebooks.

Single user, single process: one connection guarded by a lock is plenty, and it
keeps this module free of a migration framework. The notebook body (its cells and
their last outputs) is one JSON document, because the shell reads and writes a
notebook as a whole.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS saved_queries (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, sql TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, spec TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_runs (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, job_name TEXT NOT NULL, status TEXT NOT NULL,
    trigger_kind TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, tasks TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_runs_job ON job_runs (job_id, started_at DESC);
CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, cells TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.executescript(SCHEMA)
            self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # -- saved queries -----------------------------------------------------
    def list_queries(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM saved_queries ORDER BY updated_at DESC")
            return [dict(r) for r in rows]

    def save_query(self, name: str, sql: str, query_id: str | None = None) -> dict[str, Any]:
        now = _now()
        with self._lock:
            if (
                query_id
                and self._db.execute("SELECT 1 FROM saved_queries WHERE id = ?", (query_id,)).fetchone()
            ):
                self._db.execute(
                    "UPDATE saved_queries SET name = ?, sql = ?, updated_at = ? WHERE id = ?",
                    (name, sql, now, query_id),
                )
            else:
                query_id = str(uuid.uuid4())
                self._db.execute(
                    "INSERT INTO saved_queries VALUES (?, ?, ?, ?, ?)",
                    (query_id, name, sql, now, now),
                )
            self._db.commit()
            return dict(self._db.execute("SELECT * FROM saved_queries WHERE id = ?", (query_id,)).fetchone())

    def delete_query(self, query_id: str) -> bool:
        with self._lock:
            cur = self._db.execute("DELETE FROM saved_queries WHERE id = ?", (query_id,))
            self._db.commit()
            return cur.rowcount > 0

    # -- notebooks ---------------------------------------------------------
    @staticmethod
    def _notebook(row: sqlite3.Row, with_cells: bool) -> dict[str, Any]:
        cells = json.loads(row["cells"])
        out = {
            "id": row["id"],
            "name": row["name"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "cell_count": len(cells),
        }
        if with_cells:
            out["cells"] = cells
        return out

    def list_notebooks(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM notebooks ORDER BY updated_at DESC").fetchall()
        return [self._notebook(r, with_cells=False) for r in rows]

    def get_notebook(self, notebook_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM notebooks WHERE id = ?", (notebook_id,)).fetchone()
        return self._notebook(row, with_cells=True) if row else None

    def create_notebook(self, name: str, cells: list[dict[str, Any]]) -> dict[str, Any]:
        notebook_id, now = str(uuid.uuid4()), _now()
        with self._lock:
            self._db.execute(
                "INSERT INTO notebooks VALUES (?, ?, ?, ?, ?)",
                (notebook_id, name, json.dumps(cells), now, now),
            )
            self._db.commit()
        notebook = self.get_notebook(notebook_id)
        assert notebook is not None
        return notebook

    def update_notebook(
        self, notebook_id: str, name: str, cells: list[dict[str, Any]]
    ) -> dict[str, Any] | None:
        with self._lock:
            cur = self._db.execute(
                "UPDATE notebooks SET name = ?, cells = ?, updated_at = ? WHERE id = ?",
                (name, json.dumps(cells), _now(), notebook_id),
            )
            self._db.commit()
            if cur.rowcount == 0:
                return None
        return self.get_notebook(notebook_id)

    def delete_notebook(self, notebook_id: str) -> bool:
        with self._lock:
            cur = self._db.execute("DELETE FROM notebooks WHERE id = ?", (notebook_id,))
            self._db.commit()
            return cur.rowcount > 0

    # -- jobs ----------------------------------------------------------------
    @staticmethod
    def _job(row: sqlite3.Row) -> dict[str, Any]:
        spec = json.loads(row["spec"])
        return {
            "id": row["id"], "name": row["name"], "created_at": row["created_at"],
            "updated_at": row["updated_at"], **spec,
        }  # fmt: skip

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM jobs ORDER BY name").fetchall()
        return [self._job(r) for r in rows]

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._job(row) if row else None

    def save_job(self, job_id: str | None, name: str, spec: dict[str, Any]) -> dict[str, Any] | None:
        now = _now()
        with self._lock:
            if job_id is None:
                job_id = str(uuid.uuid4())
                self._db.execute(
                    "INSERT INTO jobs VALUES (?, ?, ?, ?, ?)",
                    (job_id, name, json.dumps(spec), now, now),
                )
            else:
                cur = self._db.execute(
                    "UPDATE jobs SET name = ?, spec = ?, updated_at = ? WHERE id = ?",
                    (name, json.dumps(spec), now, job_id),
                )
                if cur.rowcount == 0:
                    return None
            self._db.commit()
        return self.get_job(job_id)

    def delete_job(self, job_id: str) -> bool:
        with self._lock:
            cur = self._db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            self._db.execute("DELETE FROM job_runs WHERE job_id = ?", (job_id,))
            self._db.commit()
            return cur.rowcount > 0

    # -- job runs ------------------------------------------------------------
    @staticmethod
    def _run(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"], "job_id": row["job_id"], "job_name": row["job_name"],
            "status": row["status"], "trigger": row["trigger_kind"], "started_at": row["started_at"],
            "finished_at": row["finished_at"], "tasks": json.loads(row["tasks"]),
        }  # fmt: skip

    def insert_run(self, run: dict[str, Any]) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO job_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (run["id"], run["job_id"], run["job_name"], run["status"], run["trigger"],
                 run["started_at"], run["finished_at"], json.dumps(run["tasks"])),
            )  # fmt: skip
            self._db.commit()

    def update_run(self, run: dict[str, Any]) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE job_runs SET status = ?, finished_at = ?, tasks = ? WHERE id = ?",
                (run["status"], run["finished_at"], json.dumps(run["tasks"]), run["id"]),
            )
            self._db.commit()

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM job_runs WHERE id = ?", (run_id,)).fetchone()
        return self._run(row) if row else None

    def list_runs(self, job_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        query, args = "SELECT * FROM job_runs", []
        if job_id:
            query, args = query + " WHERE job_id = ?", [job_id]
        with self._lock:
            rows = self._db.execute(query + " ORDER BY started_at DESC LIMIT ?", (*args, limit))
            return [self._run(r) for r in rows.fetchall()]

    def interrupt_running_runs(self) -> int:
        """Runs left 'running' by a previous process can never finish."""
        with self._lock:
            rows = self._db.execute("SELECT * FROM job_runs WHERE status = 'running'").fetchall()
        for row in rows:
            run = self._run(row)
            for task in run["tasks"]:
                if task["status"] in ("running", "pending"):
                    task["status"] = "failed" if task["status"] == "running" else "skipped"
                    task["error"] = "Interrupted by an API restart."
            run["status"], run["finished_at"] = "failed", _now()
            self.update_run(run)
        return len(rows)
