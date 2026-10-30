"""dbt 2 (Rust CLI) projects, run on DuckDB and independent from the Sail engine."""

from .service import Dbt2Run, Dbt2Service

__all__ = ["Dbt2Run", "Dbt2Service"]
