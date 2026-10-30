"""The scheduler fires a job once per due cron tick and never overlaps runs."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from windward_api.jobs.runner import JobRunner


class FakeStore:
    def __init__(self, jobs: list[dict]) -> None:
        self._jobs = jobs

    def list_jobs(self) -> list[dict]:
        return self._jobs


def runner(jobs: list[dict]) -> JobRunner:
    r = JobRunner.__new__(JobRunner)  # no engines needed to test the schedule
    r._store = FakeStore(jobs)  # type: ignore[attr-defined]
    r._last_check = {}  # type: ignore[attr-defined]
    r._active = {}  # type: ignore[attr-defined]
    r._job_of_run = {}  # type: ignore[attr-defined]
    return r


def job(cron: str, enabled: bool = True) -> dict:
    return {"id": "j1", "name": "n", "schedule": {"cron": cron, "enabled": enabled}, "tasks": []}


def test_fires_when_a_tick_passed_and_not_before() -> None:
    r = runner([job("*/5 * * * *")])
    t0 = datetime(2026, 1, 1, 10, 1, tzinfo=UTC)
    calls: list[str] = []
    r.fire_due(t0, start=lambda jid, trig: calls.append(jid))  # first look only records the time
    assert calls == []
    r.fire_due(t0 + timedelta(minutes=2), start=lambda jid, trig: calls.append(jid))  # 10:03: no tick yet
    assert calls == []
    r.fire_due(t0 + timedelta(minutes=5), start=lambda jid, trig: calls.append(jid))  # crossed 10:05
    assert calls == ["j1"]


def test_paused_jobs_never_fire() -> None:
    r = runner([job("* * * * *", enabled=False)])
    t0 = datetime(2026, 1, 1, 10, 0, tzinfo=UTC)
    calls: list[str] = []
    r.fire_due(t0, start=lambda jid, trig: calls.append(jid))
    r.fire_due(t0 + timedelta(minutes=3), start=lambda jid, trig: calls.append(jid))
    assert calls == []


def test_overlapping_run_is_skipped() -> None:
    r = runner([job("* * * * *")])
    r._active = {"run1": SimpleNamespace(done=lambda: False)}  # type: ignore[assignment]
    r._job_of_run = {"run1": "j1"}
    t0 = datetime(2026, 1, 1, 10, 0, tzinfo=UTC)
    calls: list[str] = []
    r.fire_due(t0, start=lambda jid, trig: calls.append(jid))
    r.fire_due(t0 + timedelta(minutes=2), start=lambda jid, trig: calls.append(jid))
    assert calls == []
