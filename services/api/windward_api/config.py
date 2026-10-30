"""Runtime configuration for the platform API.

Every value is read once at startup and passed down. Per ADR-0002 no call site
hardcodes a port or a host: the engine ports are configuration whose defaults
come from ADR-0003 (Spark Connect 50051, Arrow Flight SQL 32010).
"""

from __future__ import annotations

import shutil
import sys
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WINDWARD_", extra="forbid")

    # --- HTTP service -----------------------------------------------------
    api_host: str = "127.0.0.1"
    api_port: int = 8000

    # --- Engine process ---------------------------------------------------
    # The name of, or path to, the Sail CLI. It lives in the same environment as
    # this service because `pysail` is a dependency of this package.
    sail_binary: str = "sail"
    # The address the engine's listeners bind to. The default is loopback, which
    # is what a local `uvicorn` run wants. In the container this is set to
    # 0.0.0.0 so the dbt container can reach Flight SQL over the compose
    # network -- the ports are still never published to the host (ADR-0002).
    sail_bind_host: str = "127.0.0.1"
    # The address this service dials. Always loopback: the engine is our child.
    sail_connect_host: str = "127.0.0.1"
    spark_connect_port: int = 50051
    # Sail's catalog is per Spark Connect session, and dbt runs in its own
    # process. Both the interactive query client and dbt open this same
    # session id, so tables dbt builds are visible in the SQL console.
    engine_session_id: str = "5a11a11a-0000-4000-8000-000000000001"
    flight_sql_port: int = 32010
    # Passed to `sail ... --directory`. Relative paths in user SQL resolve
    # against it, and it is where the seeded demo data lives.
    data_dir: Path = Path("./data")

    # --- Supervision ------------------------------------------------------
    engine_start_timeout_seconds: float = 60.0
    engine_health_interval_seconds: float = 0.5
    # A child that stays up this long is considered healthy, which resets its
    # restart backoff to the first step.
    engine_restart_stable_seconds: float = 60.0
    engine_restart_backoff_seconds: tuple[float, ...] = (0.5, 1.0, 2.0, 4.0, 8.0, 15.0, 30.0)
    # Bound on the per-child log tail kept in memory for engine status.
    engine_log_tail_lines: int = 200

    # --- dbt ----------------------------------------------------------------
    # `dbt_binary` is the runner that executes against Sail (the ADR-0002
    # Python fallback, `dbt-sail`); `dbt2_binary` is the pinned dbt 2 Rust CLI.
    dbt_binary: str = "dbt"
    dbt2_binary: str = "dbt2"
    dbt_project_dir: Path = Path("./dbt")
    dbt_profiles_dir: Path = Path("./dbt")
    dbt_work_dir: Path = Path("./data/dbt")
    # Sail's catalog is lost on an engine restart, so build the demo project once
    # the engine is up and the console always has data to query.
    dbt_auto_build: bool = True

    # --- Workspace ----------------------------------------------------------
    # SQLite file for saved queries and notebooks, and where uploads land.
    store_path: Path | None = None
    kernel_timeout_seconds: float = 120.0

    # --- Query path -------------------------------------------------------
    # Default page size for M1's synchronous query endpoint. The real result cap
    # is a frozen contract value set in M2; this is the M1 placeholder.
    query_default_max_rows: int = Field(default=1000, ge=1)
    query_max_rows_limit: int = Field(default=10_000, ge=1)
    # Wall clock budget for one query, enforced by this service, not the engine.
    query_timeout_seconds: float = 120.0
    # Spark Connect's default retry policy tolerates ten minutes of an
    # unreachable server, which would turn engine death into a hang. We detect
    # death ourselves, so the client should fail fast instead.
    engine_client_max_retries: int = 2
    engine_client_initial_backoff_ms: int = 50
    engine_client_max_backoff_ms: int = 500

    @field_validator("data_dir")
    @classmethod
    def _absolute_data_dir(cls, value: Path) -> Path:
        return value.expanduser().resolve()

    @property
    def spark_connect_url(self) -> str:
        return f"sc://{self.sail_connect_host}:{self.spark_connect_port}"

    @property
    def resolved_store_path(self) -> Path:
        return self.store_path or (self.data_dir / "windward.db")

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def spark_connect_session_url(self) -> str:
        return f"{self.spark_connect_url}/;session_id={self.engine_session_id}"

    def resolved_sail_binary(self) -> str:
        """Absolute path to the Sail CLI, or a clear error if it is missing.

        `pysail` installs the CLI beside the interpreter that imported it, so
        that directory is searched before PATH: the engine must come from the
        same environment as this service, not from whatever else is installed
        on the machine. A missing binary is a packaging defect and it should
        say so at startup rather than surfacing later as an unexplained
        connection failure.
        """
        candidate = Path(self.sail_binary)
        if candidate.is_absolute():
            if candidate.is_file():
                return str(candidate)
        else:
            beside_interpreter = Path(sys.executable).parent / self.sail_binary
            if beside_interpreter.is_file():
                return str(beside_interpreter)
            found = shutil.which(self.sail_binary)
            if found is not None:
                return found
        raise RuntimeError(
            f"Sail CLI {self.sail_binary!r} was not found beside {sys.executable} or on PATH. "
            "The platform API supervises the engine as a child process, so "
            "`pysail` must be installed in the same environment."
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
