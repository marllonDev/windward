#!/usr/bin/env bash
# M1 smoke test against the composed stack on OrbStack.
#
# Proves the acceptance criteria from the outside, the way QA would: one
# command brings the stack up, the engine is supervised by the API rather than
# started by hand, a SELECT over a Parquet file returns typed rows over HTTP,
# and the engine's own ports are not published to the host.
#
# Leaves nothing running: the stack is torn down on exit, pass or fail.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# shellcheck source=scripts/lib-compose.sh
source scripts/lib-compose.sh

BASE_URL="http://127.0.0.1:8000/api/v1"
DATA_DIR="/var/lib/windward/data"
PARQUET="$DATA_DIR/smoke_trips.parquet"

cleanup() {
  echo "== compose down =="
  "${COMPOSE[@]}" down --remove-orphans --volumes >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "SMOKE FAILED: $1" >&2
  exit 1
}

echo "== compose up =="
"${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
"${COMPOSE[@]}" up --build --detach

echo "== waiting for the platform API =="
for _ in $(seq 1 120); do
  if curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "$BASE_URL/health" >/dev/null || fail "the platform API never answered /health"

echo "== engine status =="
status_json="$(curl -fsS "$BASE_URL/engine/status")"
echo "$status_json"
python3 - "$status_json" <<'PY' || fail "engine status is not a supervised, running engine"
import json, sys
status = json.loads(sys.argv[1])
assert status["state"] == "running", status["state"]
assert status["sail_version"], "no Sail version reported"
processes = {p["interface"]: p for p in status["processes"]}
assert set(processes) == {"spark_connect", "flight_sql"}, sorted(processes)
for name, process in processes.items():
    assert process["alive"], f"{name} is not alive"
    assert process["reachable"], f"{name} is not reachable"
    assert process["pid"], f"{name} has no pid"
print(f"engine OK: sail {status['sail_version']}, spark {status['spark_version']}")
PY

echo "== the engine ports must not be published to the host =="
for port in 50051 32010; do
  published="$("${COMPOSE[@]}" port api "$port" 2>/dev/null || true)"
  if [[ -n "$published" ]]; then
    fail "engine port $port is published to the host as '$published' (ADR-0002 forbids it)"
  fi
done
echo "engine ports are internal only"

echo "== seeding a Parquet file inside the container =="
"${COMPOSE[@]}" exec -T api python - <<PY
import datetime as dt
from decimal import Decimal

import pyarrow as pa
import pyarrow.parquet as pq

table = pa.table(
    {
        "trip_id": pa.array([1, 2, 3], pa.int64()),
        "route": pa.array(["Harbour run", "Leeward loop", None], pa.string()),
        "fare": pa.array(
            [Decimal("128.40"), Decimal("9.05"), Decimal("0.00")], pa.decimal128(10, 2)
        ),
        "sailed_on": pa.array([dt.date(2026, 1, 3)] * 3, pa.date32()),
    }
)
pq.write_table(table, "$PARQUET")
print("wrote $PARQUET")
PY

echo "== SELECT over Parquet =="
query_json="$(curl -fsS -X POST "$BASE_URL/queries" \
  -H 'Content-Type: application/json' \
  -d "{\"sql\": \"SELECT * FROM parquet.\\\`$PARQUET\\\` ORDER BY trip_id\"}")"
echo "$query_json"
python3 - "$query_json" <<'PY' || fail "the SELECT did not return the expected typed rows"
import json, sys
result = json.loads(sys.argv[1])
assert result["state"] == "succeeded", result["state"]
assert [(c["name"], c["type"]) for c in result["columns"]] == [
    ("trip_id", "bigint"),
    ("route", "string"),
    ("fare", "decimal(10,2)"),
    ("sailed_on", "date"),
], result["columns"]
assert result["rows"] == [
    [1, "Harbour run", "128.40", "2026-01-03"],
    [2, "Leeward loop", "9.05", "2026-01-03"],
    [3, None, "0.00", "2026-01-03"],
], result["rows"]
assert result["row_count"] == 3
assert result["truncated"] is False
assert result["warnings"] == [], result["warnings"]
print("query OK:", result["row_count"], "typed rows in", round(result["duration_ms"], 1), "ms")
PY

echo "== bad SQL is a typed error =="
error_file="$(mktemp)"
code="$(curl -s -o "$error_file" -w '%{http_code}' -X POST "$BASE_URL/queries" \
  -H 'Content-Type: application/json' -d '{"sql": "SELECT * FROM nope"}')"
[[ "$code" == "400" ]] || fail "bad SQL answered $code, expected 400"
grep -q '"SQL_ERROR"' "$error_file" || fail "bad SQL did not return SQL_ERROR"
rm -f "$error_file"
echo "error path OK"

echo "== engine death is detected and recovered from =="
# The image carries no process tools, so the engine pid comes from the status
# endpoint and Python does the killing.
spark_pid="$(curl -fsS "$BASE_URL/engine/status" | python3 -c \
  'import json,sys; print(next(p["pid"] for p in json.load(sys.stdin)["processes"] if p["interface"]=="spark_connect"))')"
"${COMPOSE[@]}" exec -T api python -c \
  "import os, signal; os.kill($spark_pid, signal.SIGKILL)" || fail "could not kill the engine"
generation=0
for _ in $(seq 1 60); do
  generation="$(curl -fsS "$BASE_URL/engine/status" |
    python3 -c 'import json,sys; s=json.load(sys.stdin); print(s["generation"] if s["state"]=="running" else 0)')"
  if [[ "$generation" -gt 1 ]]; then
    break
  fi
  sleep 1
done
[[ "$generation" -gt 1 ]] || fail "the engine did not come back after being killed"
curl -fsS -X POST "$BASE_URL/queries" -H 'Content-Type: application/json' \
  -d '{"sql": "SELECT 1 AS one"}' >/dev/null || fail "the engine is not usable after a restart"
echo "engine restart OK (generation $generation)"

echo "smoke-m1: OK"
