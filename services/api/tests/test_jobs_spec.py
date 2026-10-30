"""Job definition rules: statements, dependencies, cycles, cron."""

from __future__ import annotations

import pytest

from windward_api.errors import InvalidRequestError
from windward_api.jobs import JobIn, validate_job
from windward_api.jobs.spec import split_statements


def job(tasks: list[dict], schedule: dict | None = None) -> JobIn:
    return JobIn(name="j", tasks=tasks, schedule=schedule)


def sql(key: str, *deps: str) -> dict:
    return {"key": key, "type": "sql", "depends_on": list(deps), "config": {"sql": "select 1"}}


def test_valid_dag_passes() -> None:
    validate_job(job([sql("a"), sql("b", "a"), sql("c", "a"), sql("d", "b", "c")], {"cron": "*/5 * * * *"}))


def test_cycle_is_rejected() -> None:
    with pytest.raises(InvalidRequestError, match="cycle"):
        validate_job(job([sql("a", "b"), sql("b", "a")]))


def test_unknown_dependency_and_duplicates_are_rejected() -> None:
    with pytest.raises(InvalidRequestError, match="dependency"):
        validate_job(job([sql("a", "zzz")]))
    with pytest.raises(InvalidRequestError, match="unique"):
        validate_job(job([sql("a"), sql("a")]))


def test_missing_config_is_rejected_when_saved() -> None:
    with pytest.raises(InvalidRequestError, match="needs: project"):
        validate_job(job([{"key": "d", "type": "dbt2", "config": {"command": "build"}}]))


def test_bad_cron_is_rejected() -> None:
    with pytest.raises(InvalidRequestError, match="cron"):
        validate_job(job([sql("a")], {"cron": "every day"}))


def test_split_statements_respects_quotes_and_comments() -> None:
    text = "select ';' as a; -- note; hidden\n/* x; y */ select 2;\n  ;select \"b;\""
    assert split_statements(text) == ["select ';' as a", "select 2", 'select "b;"']
