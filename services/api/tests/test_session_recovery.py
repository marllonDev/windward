"""The shell must recognise Sail's "session lost" error to rotate the shared session."""

from __future__ import annotations

from windward_api.engine.spark_connect import _is_session_lost


def test_lost_session_message_is_recognised() -> None:
    message = "invalid argument: session 5a11a11a-0000-4000-8000-000000000001 is not running"
    assert _is_session_lost(message)


def test_ordinary_sql_errors_are_not_treated_as_session_loss() -> None:
    assert not _is_session_lost("Table not found: [TABLE_OR_VIEW_NOT_FOUND] demo.nope")
    assert not _is_session_lost("the engine is not running")
