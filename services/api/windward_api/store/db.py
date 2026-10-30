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
                and self._db.execute(
                    "SELECT 1 FROM saved_queries WHERE id = ?", (query_id,)
                ).fetchone()
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
            return dict(
                self._db.execute("SELECT * FROM saved_queries WHERE id = ?", (query_id,)).fetchone()
            )

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
            row = self._db.execute(
                "SELECT * FROM notebooks WHERE id = ?", (notebook_id,)
            ).fetchone()
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
