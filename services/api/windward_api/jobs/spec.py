"""The shape and validation of a Job definition."""

from __future__ import annotations

import re
from typing import Any, Literal

from croniter import croniter
from pydantic import BaseModel, Field

from ..errors import InvalidRequestError

TaskType = Literal["sql", "notebook", "python", "dbt_sail", "dbt2"]
KEY = re.compile(r"^[a-zA-Z][\w-]{0,39}$")
PARAM = re.compile(r"\{\{\s*([a-zA-Z_]\w*)\s*\}\}")

#: Config keys each task type needs, so a bad Job fails when saved, not at 3 a.m.
REQUIRED: dict[str, tuple[str, ...]] = {
    "sql": ("sql",),
    "notebook": ("notebook_id",),
    "python": ("code",),
    "dbt_sail": ("command",),
    "dbt2": ("project", "command"),
}


class TaskIn(BaseModel):
    key: str
    name: str = ""
    type: TaskType
    depends_on: list[str] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)
    timeout_seconds: int = Field(default=3600, ge=1, le=86400)
    retries: int = Field(default=0, ge=0, le=5)
    retry_delay_seconds: int = Field(default=30, ge=0, le=3600)
    #: Downstream tasks still run when this one fails (the run is still marked failed).
    continue_on_failure: bool = False


class ParameterIn(BaseModel):
    name: str
    default: str = ""
    description: str = ""


class ScheduleIn(BaseModel):
    cron: str
    enabled: bool = True


class JobIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    schedule: ScheduleIn | None = None
    parameters: list[ParameterIn] = Field(default_factory=list)
    tasks: list[TaskIn] = Field(min_length=1, max_length=50)


def render(text: str, params: dict[str, str]) -> str:
    """Replace `{{ name }}` with the parameter value. Unknown names are left alone."""

    def swap(match: re.Match[str]) -> str:
        return params.get(match.group(1), match.group(0))

    return PARAM.sub(swap, text)


def validate_job(job: JobIn) -> None:
    for parameter in job.parameters:
        if not KEY.match(parameter.name):
            raise InvalidRequestError(f"Parameter {parameter.name!r} must be a plain name.")
    keys = [t.key for t in job.tasks]
    for key in keys:
        if not KEY.match(key):
            raise InvalidRequestError(f"Task key {key!r} must start with a letter (letters, digits, _ or -).")
    if len(set(keys)) != len(keys):
        raise InvalidRequestError("Task keys must be unique.")
    for task in job.tasks:
        unknown = [d for d in task.depends_on if d not in keys]
        if unknown or task.key in task.depends_on:
            raise InvalidRequestError(f"Task {task.key!r} has an invalid dependency: {unknown or task.key}.")
        missing = [k for k in REQUIRED[task.type] if not str(task.config.get(k, "")).strip()]
        if missing:
            raise InvalidRequestError(f"Task {task.key!r} ({task.type}) needs: {', '.join(missing)}.")
    remaining = {t.key: set(t.depends_on) for t in job.tasks}
    while remaining:  # Kahn's algorithm: whatever cannot be peeled off is a cycle
        ready = [k for k, deps in remaining.items() if not deps]
        if not ready:
            raise InvalidRequestError("Task dependencies contain a cycle.")
        for key in ready:
            remaining.pop(key)
        for deps in remaining.values():
            deps.difference_update(ready)
    if job.schedule and not croniter.is_valid(job.schedule.cron):
        raise InvalidRequestError(f"{job.schedule.cron!r} is not a valid 5-field cron expression.")


def split_statements(text: str) -> list[str]:
    """Split on `;` outside quotes and comments."""
    out, buf, i, quote = [], [], 0, ""
    while i < len(text):
        ch, nxt = text[i], text[i : i + 2]
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = ""
        elif nxt == "--":
            end = text.find("\n", i)
            i = len(text) if end < 0 else end
            continue
        elif nxt == "/*":
            end = text.find("*/", i + 2)
            i = len(text) if end < 0 else end + 2
            continue
        elif ch in "'\"`":
            quote = ch
            buf.append(ch)
        elif ch == ";":
            out.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
        i += 1
    out.append("".join(buf).strip())
    return [s for s in out if s]
