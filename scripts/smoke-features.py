#!/usr/bin/env python3
"""End-to-end check of every Windward feature against a running stack.

    docker compose up -d --build
    python3 scripts/smoke-features.py            # http://localhost:3000
    python3 scripts/smoke-features.py http://localhost:8000

It goes through the web origin by default, so it also proves the /api proxy works.
Exits non-zero if any check fails. Standard library only.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
results: list[tuple[str, bool, str]] = []


def call(method: str, path: str, body: Any = None, raw: bytes | None = None) -> tuple[int, Any]:
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"content-type": "application/octet-stream" if raw is not None else "application/json"}
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            text = response.read().decode()
            return response.status, (json.loads(text) if text.startswith(("{", "[")) else text)
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        return error.code, (json.loads(text) if text.startswith(("{", "[")) else text)


def sql(statement: str, max_rows: int | None = None) -> tuple[int, Any]:
    return call("POST", "/api/v1/queries", {"sql": statement, "max_rows": max_rows})


def check(name: str) -> Callable[[Callable[[], str]], Callable[[], str]]:
    def decorator(fn: Callable[[], str]) -> Callable[[], str]:
        try:
            detail = fn() or ""
            results.append((name, True, detail))
        except Exception as exc:  # noqa: BLE001 - every failure is a result, not a crash
            results.append((name, False, f"{type(exc).__name__}: {exc}"))
        return fn

    return decorator


def wait_engine() -> None:
    for _ in range(60):
        try:
            _, body = call("GET", "/api/v1/engine/status")
            if body["state"] == "running":
                return
        except Exception:  # noqa: BLE001 - the stack may still be starting
            pass
        time.sleep(2)
    raise RuntimeError("engine did not reach 'running'")


wait_engine()


@check("engine status")
def _() -> str:
    _, s = call("GET", "/api/v1/engine/status")
    assert s["state"] == "running" and all(p["reachable"] for p in s["processes"]), s
    return f"sail {s['sail_version']}, spark {s['spark_version']}"


@check("dbt project parsed (dbt 2 + runner versions)")
def _() -> str:
    _, p = call("GET", "/api/v1/dbt/project")
    assert p["parsed"] and len(p["nodes"]) >= 3, p
    return f"{p['dbt']['runner']}; {p['dbt']['dbt2']}"


@check("dbt build")
def _() -> str:
    for _ in range(40):  # an automatic build may already be running at start-up
        _, runs = call("GET", "/api/v1/dbt/runs")
        if not runs or runs[0]["status"] != "running":
            break
        time.sleep(3)
    status, run = call("POST", "/api/v1/dbt/runs", {"command": "build"})
    assert status == 202, run
    for _ in range(80):
        _, run = call("GET", f"/api/v1/dbt/runs/{run['run_id']}")
        if run["status"] != "running":
            break
        time.sleep(3)
    assert run["status"] == "succeeded", "\n".join(run["log"][-12:])
    return ", ".join(f"{n['unique_id'].split('.')[-1]}:{n['status']}" for n in run["nodes"][:4])


@check("SQL: simple query")
def _() -> str:
    status, r = sql("select 1 as one, 'a' as letter")
    assert status == 200 and r["rows"] == [[1, "a"]], r
    return f"{r['duration_ms']:.0f} ms"


@check("SQL: reads dbt-built table (shared session)")
def _() -> str:
    status, r = sql("select * from demo.route_summary order by route")
    assert status == 200 and len(r["rows"]) == 3, r
    return f"{r['row_count']} rows"


@check("SQL: bad SQL returns SQL_ERROR with the engine's message")
def _() -> str:
    status, r = sql("select * from no_such_table")
    assert status == 400 and r["error"]["code"] == "SQL_ERROR", (status, r)
    return r["error"]["message"][:70]


@check("SQL: max_rows truncates")
def _() -> str:
    _, r = sql("select * from range(50)", max_rows=10)
    assert r["truncated"] and r["row_count"] == 10, r
    return "truncated at 10"


@check("SQL: EXPLAIN")
def _() -> str:
    status, r = sql("EXPLAIN select * from demo.route_summary")
    assert status == 200 and "Plan" in r["rows"][0][0], r
    return "plan returned"


@check("catalog: databases and tables")
def _() -> str:
    _, dbs = sql("SHOW DATABASES")
    names = [row[0] for row in dbs["rows"]]
    assert "demo" in names, names
    _, tables = sql("SHOW TABLES IN demo")
    found = {row[1] for row in tables["rows"]}
    assert {"route_summary", "stg_trips", "trips"} <= found, found
    return f"databases {names}"


@check("catalog: DESCRIBE TABLE columns")
def _() -> str:
    _, r = sql("DESCRIBE TABLE demo.route_summary")
    cols = [row[0] for row in r["rows"]]
    assert "route" in cols and "total_fare" in cols, cols
    return f"{len(cols)} columns"


@check("catalog: table preview (SELECT * LIMIT 100)")
def _() -> str:
    _, r = sql("SELECT * FROM demo.stg_trips", max_rows=100)
    assert r["row_count"] == 6, r
    return "6 rows"


@check("upload: CSV becomes a typed table")
def _() -> str:
    csv = b"id,name,score\n1,ana,9.5\n2,bob,7\n"
    status, up = call("POST", "/api/v1/uploads?name=" + urllib.parse.quote("Smoke Scores.csv"), raw=csv)
    assert status == 201 and up["table"] == "uploads.smoke_scores", up
    _, r = sql("select * from uploads.smoke_scores order by id")
    assert [c["type"] for c in r["columns"]] == ["bigint", "string", "double"], r["columns"]
    assert r["rows"][0] == [1, "ana", 9.5], r["rows"]
    _, d = sql("SELECT * FROM uploads.smoke_scores LIMIT 0", max_rows=1)
    assert [c["name"] for c in d["columns"]] == ["id", "name", "score"], d["columns"]
    return "id:bigint, name:string, score:double"


@check("upload: JSON lines")
def _() -> str:
    body = b'{"k":"a","v":1}\n{"k":"b","v":2}\n'
    status, up = call("POST", "/api/v1/uploads?name=smoke_events.jsonl", raw=body)
    assert status == 201, up
    _, r = sql("select sum(v) as total from uploads.smoke_events")
    assert r["rows"] == [[3]], r
    return "sum=3"


@check("upload: unsupported type is rejected")
def _() -> str:
    status, r = call("POST", "/api/v1/uploads?name=x.exe", raw=b"MZ")
    assert status == 400 and r["error"]["code"] == "INVALID_REQUEST", (status, r)
    return "400 INVALID_REQUEST"


@check("saved queries: create, update, list, delete")
def _() -> str:
    status, q = call("POST", "/api/v1/saved-queries", {"name": "smoke", "sql": "select 1"})
    assert status == 201
    _, q2 = call("POST", "/api/v1/saved-queries", {"name": "smoke v2", "sql": "select 2", "id": q["id"]})
    assert q2["id"] == q["id"] and q2["sql"] == "select 2"
    _, listed = call("GET", "/api/v1/saved-queries")
    assert any(x["id"] == q["id"] for x in listed)
    status, _ = call("DELETE", f"/api/v1/saved-queries/{q['id']}")
    assert status == 204
    return "ok"


@check("notebooks: CRUD + autosave payload")
def _() -> str:
    cells = [{"id": "c1", "type": "sql", "source": "select 1", "output": {"stdout": "x"}}]
    status, nb = call("POST", "/api/v1/notebooks", {"name": "smoke", "cells": cells})
    assert status == 201
    _, got = call("GET", f"/api/v1/notebooks/{nb['id']}")
    assert got["cells"] == cells
    _, put = call("PUT", f"/api/v1/notebooks/{nb['id']}", {"name": "renamed", "cells": []})
    assert put["name"] == "renamed"
    status, _ = call("DELETE", f"/api/v1/notebooks/{nb['id']}")
    assert status == 204
    return "ok"


@check("notebooks: Python kernel keeps state, runs Spark, shows errors, restarts")
def _() -> str:
    _, nb = call("POST", "/api/v1/notebooks", {"name": "smoke-py", "cells": []})
    nid = nb["id"]

    def run(code: str) -> dict[str, Any]:
        status, r = call("POST", f"/api/v1/notebooks/{nid}/python", {"code": code})
        assert status == 200, r
        return r

    assert run("x = 21\nprint('hi')")["stdout"] == "hi\n"
    assert run("x * 2")["result"] == {"type": "text", "text": "42"}
    table = run("spark.sql('select route, total_fare from demo.route_summary')")["result"]
    assert table["type"] == "table" and len(table["rows"]) == 3, table
    described = run("spark.sql('select * from demo.route_summary').toPandas().describe()")["result"]
    assert described["columns"][0] == "index", described["columns"]
    assert "ZeroDivisionError" in run("1/0")["error"]
    call("POST", f"/api/v1/notebooks/{nid}/kernel/restart")
    assert "NameError" in run("x")["error"], "variables should be gone after restart"
    call("DELETE", f"/api/v1/notebooks/{nid}")
    return "state kept, spark ok, error shown, restart clears"


@check("web pages render through the proxy")
def _() -> str:
    if BASE.endswith(":8000"):
        return "skipped (API origin)"
    for page in ("/", "/console", "/catalog", "/notebooks", "/history", "/dbt", "/engine"):
        with urllib.request.urlopen(BASE + page, timeout=30) as response:
            assert response.status == 200, page
    return "7 pages"


width = max(len(name) for name, _, _ in results)
for name, ok, detail in results:
    print(f"{'PASS' if ok else 'FAIL'}  {name.ljust(width)}  {detail}")
failed = [name for name, ok, _ in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
