"""Platform state in SQLite: saved queries and notebooks (ADR-0002: API-owned)."""

from .db import Store

__all__ = ["Store"]
