"""Saved queries, notebooks and upload naming: pure logic, no engine needed."""

from __future__ import annotations

from pathlib import Path

from windward_api.query.uploads import table_name
from windward_api.store import Store


def test_saved_query_roundtrip(tmp_path: Path) -> None:
    store = Store(tmp_path / "w.db")
    saved = store.save_query("Trips", "select 1")
    assert [q["name"] for q in store.list_queries()] == ["Trips"]
    updated = store.save_query("Trips v2", "select 2", saved["id"])
    assert updated["id"] == saved["id"] and updated["sql"] == "select 2"
    assert store.delete_query(saved["id"]) is True
    assert store.delete_query(saved["id"]) is False


def test_notebook_roundtrip_keeps_cells_and_outputs(tmp_path: Path) -> None:
    store = Store(tmp_path / "w.db")
    cells = [{"id": "a", "type": "sql", "source": "select 1", "output": {"stdout": "hi"}}]
    created = store.create_notebook("nb", cells)
    assert store.get_notebook(created["id"])["cells"] == cells
    assert store.list_notebooks()[0]["cell_count"] == 1
    assert store.update_notebook(created["id"], "renamed", [])["name"] == "renamed"
    assert store.update_notebook("missing", "x", []) is None
    assert store.delete_notebook(created["id"]) is True


def test_notebooks_survive_reopening_the_database(tmp_path: Path) -> None:
    path = tmp_path / "w.db"
    Store(path).create_notebook("persisted", [])
    assert [n["name"] for n in Store(path).list_notebooks()] == ["persisted"]


def test_upload_table_names_are_sql_safe() -> None:
    assert table_name("My Scores.csv") == "my_scores"
    assert table_name("2026-sales.parquet") == "t_2026_sales"
    assert table_name("!!!.json") == "data"
