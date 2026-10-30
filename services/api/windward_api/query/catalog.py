"""Catalog reads: objects, column profiles and table statistics.

Everything here is SQL against the engine; the API never touches the user's data
files directly (ADR-0002). Profiling runs one aggregate per table rather than one
query per column, because the whole point is to be cheap enough to open by default.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from ..errors import InvalidRequestError
from .service import QueryService

logger = logging.getLogger(__name__)

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
NUMERIC = re.compile(
    r"^(tinyint|smallint|int|integer|bigint|float|double|decimal|numeric|real|long|short|byte)"
)
TEMPORAL = re.compile(r"^(date|timestamp)")
PROFILE_COLUMN_LIMIT = 40


def qualify(database: str, table: str) -> str:
    for part in (database, table):
        if not IDENT.match(part):
            raise InvalidRequestError(f"{part!r} is not a plain identifier.")
    return f"{database}.{table}"


class CatalogService:
    def __init__(self, queries: QueryService) -> None:
        self._queries = queries

    async def _rows(self, sql: str, max_rows: int = 5000) -> tuple[list[str], list[tuple[Any, ...]]]:
        result = (await self._queries.submit(sql, max_rows=max_rows)).result
        return [c.name for c in result.columns], list(result.rows)

    async def databases(self) -> list[str]:
        _, rows = await self._rows("SHOW DATABASES")
        return [str(r[0]) for r in rows]

    async def tables(self, database: str) -> list[dict[str, str]]:
        if not IDENT.match(database):
            raise InvalidRequestError(f"{database!r} is not a plain identifier.")
        names, rows = await self._rows(f"SHOW TABLES IN {database}")
        index = next((i for i, n in enumerate(names) if n.lower() in ("tablename", "name")), 1)
        return [{"database": database, "name": str(r[index])} for r in rows]

    async def columns(self, database: str, table: str) -> list[dict[str, Any]]:
        name = qualify(database, table)
        names, rows = await self._rows(f"DESCRIBE TABLE {name}")
        col = next((i for i, n in enumerate(names) if n.lower() == "col_name"), 0)
        typ = next((i for i, n in enumerate(names) if n.lower() == "data_type"), 1)
        described = [
            {"name": str(r[col]), "type": str(r[typ] or "")}
            for r in rows
            if r[col] and not str(r[col]).startswith("#")
        ]
        if described:
            return described
        # Sail returns no rows for file-backed tables; the query schema is the truth.
        result = (await self._queries.submit(f"SELECT * FROM {name} LIMIT 0", max_rows=1)).result
        return [{"name": c.name, "type": c.type} for c in result.columns]

    async def search(self, needle: str, limit: int = 50) -> list[dict[str, str]]:
        """Find tables and columns whose name contains `needle`, across all databases."""
        term = needle.strip().lower()
        if len(term) < 2:
            raise InvalidRequestError("Search for at least two characters.")
        out: list[dict[str, str]] = []
        for database in await self.databases():
            for table in await self.tables(database):
                full = f"{database}.{table['name']}"
                if term in table["name"].lower() or term in database.lower():
                    out.append({"kind": "table", "database": database, "table": table["name"], "label": full})
                if len(out) >= limit:
                    return out
                try:
                    for column in await self.columns(database, table["name"]):
                        if term in column["name"].lower():
                            out.append({
                                "kind": "column", "database": database, "table": table["name"],
                                "label": f"{full}.{column['name']}", "type": column["type"],
                            })  # fmt: skip
                            if len(out) >= limit:
                                return out
                except Exception:  # noqa: BLE001 - an unreadable table just contributes nothing
                    continue
        return out

    async def profile(self, database: str, table: str) -> dict[str, Any]:
        """Row count plus per-column null/distinct counts and ranges, in one query."""
        name = qualify(database, table)
        columns = (await self.columns(database, table))[:PROFILE_COLUMN_LIMIT]
        if not columns:
            return {"table": name, "row_count": 0, "columns": []}
        parts = ["count(*) as `__rows`"]
        for index, column in enumerate(columns):
            ref = f"`{column['name']}`"
            parts.append(f"sum(case when {ref} is null then 1 else 0 end) as `n{index}`")
            # Sail 0.7.3 has no approx_distinct for floats, and casting to string makes
            # the estimate work for every type at the cost of exactness on numbers.
            parts.append(f"approx_count_distinct(cast({ref} as string)) as `d{index}`")
            kind = column["type"].lower()
            if NUMERIC.match(kind) or TEMPORAL.match(kind):
                parts.append(f"cast(min({ref}) as string) as `lo{index}`")
                parts.append(f"cast(max({ref}) as string) as `hi{index}`")
        names, rows = await self._rows(f"SELECT {', '.join(parts)} FROM {name}", max_rows=1)
        if not rows:
            return {"table": name, "row_count": 0, "columns": []}
        values = dict(zip(names, rows[0], strict=False))
        total = int(values.get("__rows") or 0)
        profiled = []
        for index, column in enumerate(columns):
            nulls = int(values.get(f"n{index}") or 0)
            profiled.append({
                "name": column["name"], "type": column["type"], "nulls": nulls,
                "null_pct": round(nulls * 100 / total, 1) if total else 0.0,
                "distinct": int(values.get(f"d{index}") or 0),
                "min": values.get(f"lo{index}"), "max": values.get(f"hi{index}"),
            })  # fmt: skip
        return {"table": name, "row_count": total, "columns": profiled}

    async def ddl(self, database: str, table: str) -> str:
        """`SHOW CREATE TABLE`, falling back to a CREATE assembled from the schema."""
        name = qualify(database, table)
        try:
            _, rows = await self._rows(f"SHOW CREATE TABLE {name}")
            if rows and rows[0][0]:
                return str(rows[0][0])
        except Exception:  # noqa: BLE001 - Sail does not implement it for every table
            logger.debug("SHOW CREATE TABLE failed for %s", name)
        columns = await self.columns(database, table)
        body = ",\n".join(f"  `{c['name']}` {c['type']}" for c in columns)
        return f"-- reconstructed from the table schema\nCREATE TABLE {name} (\n{body}\n);"
