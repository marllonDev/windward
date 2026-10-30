"""Application wiring.

The engine is invisible to the user: starting this service starts Sail, and
stopping it stops Sail. There is no manual setup step, no JVM, and no Spark
installation (ADR-0002).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import __version__
from .api import router
from .api.dbt_routes import router as dbt_router
from .config import Settings, get_settings
from .dbt import DbtRunner
from .engine.spark_connect import SparkConnectEngineClient
from .engine.supervisor import SailSupervisor
from .errors import install_exception_handlers
from .query.service import QueryService

logger = logging.getLogger(__name__)

DESCRIPTION = """
The Windward platform API. It supervises the Sail engine, owns the interactive
query path, and is the only component that talks to the engine.

M1 exposes engine status and a synchronous query endpoint; the dbt endpoints
(project graph, runs, streamed-by-polling logs) sit beside them. Sessions as a
resource, cancellation, paging, catalog, history, and the dbt endpoints arrive
in M2, when this contract is frozen.
""".strip()


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        supervisor = SailSupervisor(resolved)
        engine_client = SparkConnectEngineClient(resolved, supervisor)
        app.state.settings = resolved
        app.state.supervisor = supervisor
        app.state.engine_client = engine_client
        app.state.query_service = QueryService(resolved, engine_client)
        resolved.dbt_work_dir.mkdir(parents=True, exist_ok=True)
        app.state.dbt_runner = DbtRunner(resolved)

        await supervisor.start()
        if await supervisor.wait_until_running(resolved.engine_start_timeout_seconds):
            logger.info(
                "Sail is up: Spark Connect on %s, Flight SQL on %s",
                resolved.spark_connect_port,
                resolved.flight_sql_port,
            )
        else:
            # Not fatal. The service stays up and reports the engine state
            # honestly; the supervisor keeps retrying with backoff.
            logger.warning(
                "Sail did not reach a running state within %.0fs; see GET /api/v1/engine/status",
                resolved.engine_start_timeout_seconds,
            )
        try:
            yield
        finally:
            engine_client.close()
            await supervisor.stop()

    app = FastAPI(
        title="Windward Platform API",
        description=DESCRIPTION,
        version=__version__,
        lifespan=lifespan,
    )
    install_exception_handlers(app)
    app.include_router(router)
    app.include_router(dbt_router)
    return app


app = create_app()
