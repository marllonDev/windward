"""Owns the notebook worker processes: start on demand, restart, kill on timeout."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from typing import Any

from ..config import Settings

logger = logging.getLogger(__name__)


class _Worker:
    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self.proc = proc
        self.lock = asyncio.Lock()


class KernelManager:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._workers: dict[str, _Worker] = {}

    async def _start(self, notebook_id: str) -> _Worker:
        env = dict(os.environ)
        env["WINDWARD_KERNEL_REMOTE"] = self._settings.spark_connect_session_url
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-u", "-m", "windward_api.kernel.worker",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, env=env,
            cwd=str(self._settings.data_dir),
        )  # fmt: skip
        assert proc.stdout is not None
        await asyncio.wait_for(proc.stdout.readline(), timeout=60)  # the ready line
        worker = _Worker(proc)
        self._workers[notebook_id] = worker
        return worker

    async def _worker(self, notebook_id: str) -> _Worker:
        worker = self._workers.get(notebook_id)
        if worker is None or worker.proc.returncode is not None:
            worker = await self._start(notebook_id)
        return worker

    async def run(self, notebook_id: str, code: str) -> dict[str, Any]:
        worker = await self._worker(notebook_id)
        async with worker.lock:
            assert worker.proc.stdin is not None and worker.proc.stdout is not None
            worker.proc.stdin.write((json.dumps({"code": code}) + "\n").encode())
            await worker.proc.stdin.drain()
            try:
                line = await asyncio.wait_for(
                    worker.proc.stdout.readline(), timeout=self._settings.kernel_timeout_seconds
                )
            except TimeoutError:
                await self.reset(notebook_id)
                return {
                    "stdout": "", "stderr": "", "result": None, "duration_ms": None,
                    "error": f"Cell exceeded {self._settings.kernel_timeout_seconds:.0f}s; "
                    "the kernel was restarted and its variables were lost.",
                }  # fmt: skip
            if not line:
                self._workers.pop(notebook_id, None)
                return {
                    "stdout": "", "stderr": "", "result": None, "duration_ms": None,
                    "error": "The kernel process exited unexpectedly; the next run starts a new one.",  # noqa: E501
                }  # fmt: skip
            return json.loads(line)

    async def reset(self, notebook_id: str) -> None:
        worker = self._workers.pop(notebook_id, None)
        if worker and worker.proc.returncode is None:
            worker.proc.kill()
            await worker.proc.wait()

    async def close(self) -> None:
        for notebook_id in list(self._workers):
            await self.reset(notebook_id)
