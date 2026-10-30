"""Engine death is a normal condition: detected, reported, recovered from.

These tests kill the real engine process out from under the running service,
which is why they get their own app instance rather than sharing the suite's.
"""

from __future__ import annotations

import os
import signal
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from windward_api.engine.types import EngineInterface
from windward_api.main import create_app

from .conftest import build_settings

pytestmark = pytest.mark.integration


def _status(client: TestClient) -> dict:
    response = client.get("/api/v1/engine/status")
    assert response.status_code == 200
    return response.json()


def _wait_for(client: TestClient, predicate, timeout: float = 90.0) -> dict:
    deadline = time.monotonic() + timeout
    body = _status(client)
    while time.monotonic() < deadline:
        body = _status(client)
        if predicate(body):
            return body
        time.sleep(0.2)
    raise AssertionError(f"engine status never satisfied the predicate; last was {body}")


def _kill_spark_connect(client: TestClient) -> int:
    listener = client.app.state.supervisor.listener(EngineInterface.SPARK_CONNECT)
    pid = listener.pid
    assert pid is not None
    os.kill(pid, signal.SIGKILL)
    return pid


@pytest.fixture
def own_client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(build_settings(tmp_path))
    with TestClient(app) as client:
        yield client


def test_a_killed_engine_is_detected_restarted_and_usable_again(own_client: TestClient) -> None:
    before = _status(own_client)
    assert before["state"] == "running"
    assert before["generation"] == 1
    assert own_client.post("/api/v1/queries", json={"sql": "SELECT 1 AS one"}).status_code == 200

    killed_pid = _kill_spark_connect(own_client)

    after = _wait_for(
        own_client,
        lambda body: body["state"] == "running" and body["generation"] > before["generation"],
    )
    assert after["generation"] == 2
    assert after["restart_count"] >= 1
    assert after["last_error"] is not None
    assert "exited with code" in after["last_error"]

    spark = next(p for p in after["processes"] if p["interface"] == "spark_connect")
    assert spark["pid"] != killed_pid
    assert spark["alive"] is True
    assert spark["reachable"] is True
    # SIGKILL is reported as a negative exit code by the supervisor.
    assert spark["last_exit_code"] == -signal.SIGKILL

    # The session from the previous generation is gone, not silently reused.
    response = own_client.post("/api/v1/queries", json={"sql": "SELECT 1 AS one"})
    assert response.status_code == 200, response.text
    assert response.json()["engine_generation"] == 2


def test_the_flight_sql_listener_is_restarted_too(own_client: TestClient) -> None:
    listener = own_client.app.state.supervisor.listener(EngineInterface.FLIGHT_SQL)
    first_pid = listener.pid
    assert first_pid is not None
    os.kill(first_pid, signal.SIGKILL)

    body = _wait_for(
        own_client,
        lambda status: (
            status["state"] == "running"
            and next(p for p in status["processes"] if p["interface"] == "flight_sql")["pid"]
            != first_pid
        ),
    )
    flight = next(p for p in body["processes"] if p["interface"] == "flight_sql")
    assert flight["reachable"] is True
    assert flight["restart_count"] == 1
    # Killing Flight SQL must not invalidate the query path's sessions.
    assert body["generation"] == 1


def test_a_query_against_a_dead_engine_fails_fast_with_a_typed_error(tmp_path: Path) -> None:
    settings = build_settings(tmp_path)
    # Hold the engine down long enough to observe the window, instead of
    # racing the supervisor's default half-second first backoff.
    settings = settings.model_copy(update={"engine_restart_backoff_seconds": (20.0,)})
    app = create_app(settings)
    with TestClient(app) as client:
        assert _status(client)["state"] == "running"
        _kill_spark_connect(client)
        _wait_for(client, lambda body: body["state"] != "running", timeout=30.0)

        started = time.monotonic()
        response = client.post("/api/v1/queries", json={"sql": "SELECT 1 AS one"})
        elapsed = time.monotonic() - started

        assert response.status_code == 503, response.text
        error = response.json()["error"]
        assert error["code"] == "ENGINE_UNAVAILABLE"
        # Spark Connect's default retry policy would have hung here for
        # minutes; the service overrides it so the shell gets an answer.
        assert elapsed < 10.0
