"""User-uploaded data files exposed as tables in the `uploads` database.

The file is the durable thing; the table is a catalog entry in the Sail session
(memory catalog, see KNOWN-LIMITATIONS). `sync` re-registers every file, which is
what brings the tables back after an engine restart.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from ..config import Settings
from ..errors import InvalidRequestError
from .service import QueryService

logger = logging.getLogger(__name__)

FORMATS = {".csv": "csv", ".tsv": "csv", ".json": "json", ".jsonl": "json", ".parquet": "parquet"}
MAX_BYTES = 200 * 1024 * 1024


def table_name(filename: str) -> str:
    stem = re.sub(r"[^0-9a-zA-Z_]+", "_", Path(filename).stem).strip("_").lower() or "data"
    return f"t_{stem}" if stem[0].isdigit() else stem


class UploadService:
    def __init__(self, settings: Settings, queries: QueryService) -> None:
        self._dir = settings.uploads_dir
        self._queries = queries

    def list(self) -> list[dict[str, object]]:
        if not self._dir.is_dir():
            return []
        return [
            {"file": f.name, "table": f"uploads.{table_name(f.name)}", "bytes": f.stat().st_size}
            for f in sorted(self._dir.iterdir())
            if f.suffix.lower() in FORMATS
        ]

    async def save(self, filename: str, data: bytes) -> dict[str, object]:
        raw = Path(filename)
        # Spaces and punctuation in a path make Sail's CSV reader return no columns.
        safe = re.sub(r"[^0-9a-zA-Z_.-]+", "_", raw.stem).strip("_") or "data"
        safe += raw.suffix.lower()
        suffix = Path(safe).suffix
        if suffix not in FORMATS:
            raise InvalidRequestError(
                f"Unsupported file type {suffix or '(none)'}; use one of {', '.join(FORMATS)}."
            )
        if not data:
            raise InvalidRequestError("The uploaded file is empty.")
        if len(data) > MAX_BYTES:
            raise InvalidRequestError(f"The file is larger than {MAX_BYTES // 1024 // 1024} MB.")
        self._dir.mkdir(parents=True, exist_ok=True)
        (self._dir / safe).write_bytes(data)
        await self._register(self._dir / safe)
        return {"file": safe, "table": f"uploads.{table_name(safe)}", "bytes": len(data)}

    async def sync(self) -> int:
        count = 0
        for item in self.list():
            try:
                await self._register(self._dir / str(item["file"]))
                count += 1
            except Exception:  # one bad file must not block the others
                logger.exception("could not register %s", item["file"])
        return count

    async def _register(self, path: Path) -> None:
        suffix = path.suffix.lower()
        fmt, name = FORMATS[suffix], table_name(path.name)
        options: list[str] = []
        if fmt == "csv":
            options += ["header 'true'", "inferSchema 'true'"]
            if suffix == ".tsv":
                options.append("delimiter '\\t'")
        await self._queries.submit("CREATE DATABASE IF NOT EXISTS uploads", max_rows=1)
        await self._queries.submit(f"DROP TABLE IF EXISTS uploads.{name}", max_rows=1)
        # LOCATION, not OPTIONS (path ...): Sail 0.7.2 ignores header/inferSchema and
        # returns an empty schema when the path is given as an option.
        clause = f" OPTIONS ({', '.join(options)})" if options else ""
        await self._queries.submit(
            f"CREATE TABLE uploads.{name} USING {fmt} LOCATION '{path}'{clause}", max_rows=1
        )
