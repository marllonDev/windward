"""Parameter substitution and the "run from here" expansion."""

from __future__ import annotations

import pytest

from windward_api.errors import InvalidRequestError
from windward_api.jobs.runner import JobRunner
from windward_api.jobs.spec import render


def test_render_replaces_known_parameters_only() -> None:
    sql = "select * from t where day = '{{ day }}' and x = {{ missing }}"
    assert render(sql, {"day": "2026-01-01"}) == "select * from t where day = '2026-01-01' and x = {{ missing }}"


def test_render_tolerates_spacing_and_leaves_other_braces() -> None:
    assert render("{{day}} {{  day  }} {not_a_param}", {"day": "1"}) == "1 1 {not_a_param}"


def job(*edges: tuple[str, list[str]]) -> dict:
    return {"tasks": [{"key": k, "depends_on": d} for k, d in edges]}


def test_expand_selects_the_task_and_everything_downstream() -> None:
    graph = job(("a", []), ("b", ["a"]), ("c", ["a"]), ("d", ["b", "c"]))
    assert JobRunner._expand(graph, ["b"]) == {"b", "d"}
    assert JobRunner._expand(graph, ["a"]) == {"a", "b", "c", "d"}
    assert JobRunner._expand(graph, ["d"]) == {"d"}


def test_expand_without_a_selection_runs_everything() -> None:
    graph = job(("a", []), ("b", ["a"]))
    assert JobRunner._expand(graph, None) == {"a", "b"}
    assert JobRunner._expand(graph, []) == {"a", "b"}


def test_expand_rejects_an_unknown_task() -> None:
    with pytest.raises(InvalidRequestError, match="Unknown task"):
        JobRunner._expand(job(("a", [])), ["nope"])
