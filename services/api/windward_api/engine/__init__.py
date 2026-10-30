"""Engine supervision and the single interface into Sail (ADR-0002)."""

from .client import EngineClient
from .spark_connect import SparkConnectEngineClient
from .supervisor import SailSupervisor
from .types import (
    Column,
    EngineInterface,
    EngineState,
    EngineStatus,
    ProcessStatus,
    QueryResult,
)

__all__ = [
    "Column",
    "EngineClient",
    "EngineInterface",
    "EngineState",
    "EngineStatus",
    "ProcessStatus",
    "QueryResult",
    "SailSupervisor",
    "SparkConnectEngineClient",
]
