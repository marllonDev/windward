"""Sessions, submit, cancel, result paging. M1 implements submit only."""

from .service import QueryService, SubmittedQuery

__all__ = ["QueryService", "SubmittedQuery"]
