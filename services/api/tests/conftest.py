"""Integration fixtures.

Nothing here is mocked. Each app fixture boots the real Sail engine as a child
process of the application under test, which is the same code path production
uses (ADR-0002).
"""

from __future__ import annotations

import socket
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from windward_api.config import Settings
from windward_api.main import create_app

from .seed import write_seed


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def build_settings(data_dir: Path) -> Settings:
    """Settings for a throwaway engine on ports nobody else is using.

    The configured defaults are 50051 and 32010 (ADR-0003); the suite must not
    depend on them being free, and must not collide with a running stack.
    """
    return Settings(
        sail_bind_host="127.0.0.1",
        spark_connect_port=_free_port(),
        flight_sql_port=_free_port(),
        data_dir=data_dir,
        engine_start_timeout_seconds=90.0,
        query_timeout_seconds=60.0,
    )


@pytest.fixture(scope="session")
def seed(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    data_dir = tmp_path_factory.mktemp("windward-data")
    paths = write_seed(data_dir)
    paths["root"] = data_dir
    return paths


@pytest.fixture(scope="session")
def seed_dir(seed: dict[str, Path]) -> Path:
    return seed["root"]


@pytest.fixture(scope="session")
def client(seed_dir: Path) -> Iterator[TestClient]:
    """A live app with a live engine, shared by the read-only tests."""
    app = create_app(build_settings(seed_dir))
    with TestClient(app) as test_client:
        yield test_client
