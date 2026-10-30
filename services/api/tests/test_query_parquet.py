"""A SELECT over Parquet comes back as typed rows over HTTP."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def run_sql(client: TestClient, sql: str, **body: object) -> dict:
    response = client.post("/api/v1/queries", json={"sql": sql, **body})
    assert response.status_code == 200, response.text
    return response.json()


def test_select_literal(client: TestClient) -> None:
    result = run_sql(client, "SELECT 1 AS one")
    assert result["columns"] == [{"name": "one", "type": "int", "nullable": False}]
    assert result["rows"] == [[1]]
    assert result["row_count"] == 1
    assert result["truncated"] is False
    assert result["state"] == "succeeded"
    assert result["duration_ms"] > 0
    assert result["session_id"]
    assert result["engine_generation"] == 1


def test_select_over_a_parquet_file_returns_typed_rows(
    client: TestClient, seed: dict[str, Path]
) -> None:
    result = run_sql(client, f"SELECT * FROM parquet.`{seed['trips']}` ORDER BY trip_id")

    assert [(c["name"], c["type"]) for c in result["columns"]] == [
        ("trip_id", "bigint"),
        ("route", "string"),
        ("fare", "decimal(10,2)"),
        ("distance_nm", "double"),
        ("completed", "boolean"),
        ("sailed_on", "date"),
    ]
    assert result["rows"] == [
        [1, "Harbour run", "128.40", 12.5, True, "2026-01-03"],
        [2, "Leeward loop", "9.05", 3.25, False, "2026-01-04"],
        [3, None, "0.00", 0.0, True, "2026-01-05"],
        [4, "Windward beat", "4211.99", 88.125, None, "2026-02-01"],
    ]
    assert result["row_count"] == 4
    assert result["truncated"] is False


def test_select_resolves_a_relative_path_against_the_engine_directory(
    client: TestClient,
) -> None:
    """The engine runs with `--directory` set to the configured data dir, so a
    relative path in user SQL resolves there."""
    result = run_sql(client, "SELECT COUNT(*) AS n FROM parquet.`trips.parquet`")
    assert result["rows"] == [[4]]


def test_select_over_a_directory_of_parquet_files(
    client: TestClient, seed: dict[str, Path]
) -> None:
    result = run_sql(
        client,
        f"SELECT COUNT(*) AS n, SUM(fare) AS total FROM parquet.`{seed['trip_parts']}`",
    )
    assert result["rows"] == [[4, "4349.44"]]


def test_aggregation_and_window_functions_over_parquet(
    client: TestClient, seed: dict[str, Path]
) -> None:
    result = run_sql(
        client,
        f"""
        SELECT trip_id,
               SUM(distance_nm) OVER (ORDER BY trip_id) AS cumulative_nm
        FROM parquet.`{seed["trips"]}`
        ORDER BY trip_id
        """,
    )
    assert result["rows"] == [[1, 12.5], [2, 15.75], [3, 15.75], [4, 103.875]]


def test_row_cap_truncates_and_says_so(client: TestClient, seed: dict[str, Path]) -> None:
    result = run_sql(client, f"SELECT n FROM parquet.`{seed['numbers']}`", max_rows=10)
    assert result["row_count"] == 10
    assert result["max_rows"] == 10
    assert result["truncated"] is True


def test_row_cap_is_not_reported_when_the_result_fits_exactly(
    client: TestClient, seed: dict[str, Path]
) -> None:
    result = run_sql(client, f"SELECT n FROM parquet.`{seed['numbers']}` LIMIT 4", max_rows=4)
    assert result["row_count"] == 4
    assert result["truncated"] is False


def test_empty_result_keeps_its_schema(client: TestClient, seed: dict[str, Path]) -> None:
    result = run_sql(client, f"SELECT * FROM parquet.`{seed['trips']}` WHERE trip_id < 0")
    assert result["rows"] == []
    assert result["row_count"] == 0
    assert [c["name"] for c in result["columns"]] == [
        "trip_id",
        "route",
        "fare",
        "distance_nm",
        "completed",
        "sailed_on",
    ]


def test_duplicate_column_names_are_preserved(client: TestClient) -> None:
    result = run_sql(client, "SELECT 1 AS n, 2 AS n")
    assert [c["name"] for c in result["columns"]] == ["n", "n"]
    assert result["rows"] == [[1, 2]]


def test_unknown_table_is_a_typed_sql_error_with_the_engine_message(client: TestClient) -> None:
    response = client.post("/api/v1/queries", json={"sql": "SELECT * FROM no_such_table"})
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "SQL_ERROR"
    assert "no_such_table" in error["message"]


def test_syntax_error_is_a_typed_sql_error(client: TestClient) -> None:
    response = client.post("/api/v1/queries", json={"sql": "SELEKT oops"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "SQL_ERROR"


def test_a_parquet_path_that_does_not_exist_is_reported_as_a_warning(client: TestClient) -> None:
    """Sail 0.7.2 does not fail on a missing path -- it resolves it to an empty
    relation, unlike JVM Spark. The API cannot turn that into an error without
    reading the user's filesystem itself, so it says so on the result."""
    result = run_sql(client, "SELECT * FROM parquet.`/nope/missing.parquet`")
    assert result["columns"] == []
    assert result["rows"] == []
    assert len(result["warnings"]) == 1
    assert "does not exist" in result["warnings"][0]


def test_a_file_that_is_not_parquet_is_a_typed_sql_error(
    client: TestClient, seed_dir: Path
) -> None:
    broken = seed_dir / "not-parquet.txt"
    broken.write_text("this is not a parquet file\n", encoding="utf-8")
    response = client.post("/api/v1/queries", json={"sql": f"SELECT * FROM parquet.`{broken}`"})
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "SQL_ERROR"
    assert "Parquet" in error["message"]


def test_a_successful_query_carries_no_warnings(client: TestClient, seed: dict[str, Path]) -> None:
    result = run_sql(client, f"SELECT trip_id FROM parquet.`{seed['trips']}`")
    assert result["warnings"] == []


def test_empty_sql_is_rejected_before_the_engine(client: TestClient) -> None:
    response = client.post("/api/v1/queries", json={"sql": "   "})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_unknown_request_field_is_rejected(client: TestClient) -> None:
    response = client.post("/api/v1/queries", json={"sql": "SELECT 1", "limit": 5})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
