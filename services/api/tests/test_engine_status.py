"""The backend boots and supervises Sail, and says so honestly."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_health_is_independent_of_the_engine(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_engine_status_reports_a_running_supervised_engine(client: TestClient) -> None:
    response = client.get("/api/v1/engine/status")
    assert response.status_code == 200
    body = response.json()

    assert body["state"] == "running"
    assert body["generation"] == 1
    assert body["restart_count"] == 0
    assert body["uptime_seconds"] > 0
    # Sail's own version comes from the supervised binary, because the engine
    # reports the Spark version it emulates over the wire.
    assert body["sail_version"] == "0.7.2"
    assert body["spark_version"] is not None
    assert body["spark_version"] != body["sail_version"]


def test_engine_status_lists_both_interfaces_as_live_children(client: TestClient) -> None:
    settings = client.app.state.settings
    processes = {p["interface"]: p for p in client.get("/api/v1/engine/status").json()["processes"]}

    assert set(processes) == {"spark_connect", "flight_sql"}
    assert processes["spark_connect"]["port"] == settings.spark_connect_port
    assert processes["flight_sql"]["port"] == settings.flight_sql_port

    for process in processes.values():
        assert process["alive"] is True
        # Flight SQL is only probed for liveness by this service (ADR-0002).
        assert process["reachable"] is True
        assert process["pid"] is not None
        assert process["last_exit_code"] is None
