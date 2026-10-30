"""Notebook kernel worker. Runs as `python -u -m windward_api.kernel.worker`.

Protocol: one JSON object per line on stdin (`{"code": "..."}`), one JSON object per
line on stdout. User output is captured, so it can never corrupt the protocol
stream. Variables persist between requests, like a notebook kernel. `spark` is a
Spark Connect session on the shared Sail session, so the tables dbt and the SQL
console create are visible here.

This is a convenience for a single trusted local user, not a sandbox.
"""

from __future__ import annotations

import ast
import contextlib
import io
import json
import os
import sys
import time
import traceback
from typing import Any

MAX_ROWS = 1000


def _table(columns: list[str], rows: list[list[Any]]) -> dict[str, Any]:
    return {"type": "table", "columns": columns, "rows": rows, "truncated": len(rows) >= MAX_ROWS}


def _display(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if hasattr(value, "toPandas") and hasattr(value, "limit"):  # Spark DataFrame
        value = value.limit(MAX_ROWS).toPandas()
    if hasattr(value, "columns") and hasattr(value, "values") and hasattr(value, "head"):  # pandas
        frame = value.head(MAX_ROWS)
        if type(frame.index).__name__ != "RangeIndex":  # e.g. df.describe(): keep its labels
            frame = frame.reset_index()
        return _table(
            [str(c) for c in frame.columns],
            frame.astype(object).where(frame.notna(), None).values.tolist(),
        )
    return {"type": "text", "text": repr(value)}


def _run(code: str, scope: dict[str, Any]) -> dict[str, Any] | None:
    tree = ast.parse(code, mode="exec")
    last: ast.Expr | None = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = tree.body.pop()  # type: ignore[assignment]
    exec(compile(tree, "<cell>", "exec"), scope)  # noqa: S102
    if last is not None:
        return _display(eval(compile(ast.Expression(last.value), "<cell>", "eval"), scope))  # noqa: S307
    return None


def main() -> None:
    protocol = sys.stdout
    scope: dict[str, Any] = {"__name__": "__main__"}
    boot_error: str | None = None
    try:
        from pyspark.sql import SparkSession

        url = os.environ["WINDWARD_KERNEL_REMOTE"]
        scope["spark"] = SparkSession.builder.remote(url).create()
    except Exception:  # the kernel still runs plain Python without an engine
        boot_error = traceback.format_exc(limit=3)

    print(json.dumps({"ready": True, "error": boot_error}), file=protocol, flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        out, err = io.StringIO(), io.StringIO()
        started = time.perf_counter()
        result, error = None, None
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                result = _run(request["code"], scope)
            except BaseException:  # noqa: BLE001 - everything a cell raises is shown
                error = traceback.format_exc(limit=6)
        reply = {
            "stdout": out.getvalue(),
            "stderr": err.getvalue(),
            "error": error,
            "result": result,
            "duration_ms": (time.perf_counter() - started) * 1000,
        }
        print(json.dumps(reply, default=str), file=protocol, flush=True)


if __name__ == "__main__":
    main()
