"""Supervision of the Sail engine process tree.

Per ADR-0002 the platform API is the parent of the engine, so engine death is
observable without polling an orchestrator, and the user never starts anything
by hand. Death is treated as a normal condition: it is detected, reported
through engine status, and recovered from with a backoff.

Sail 0.7.2 serves one interface per process -- `sail spark server` and
`sail flight server` are separate commands with separate listeners -- so the
supervisor manages two children rather than the single process ADR-0002's
diagram assumes. See KNOWN-LIMITATIONS.md.
"""

from __future__ import annotations

import asyncio
import collections
import logging
import subprocess
import threading
from collections.abc import Sequence
from datetime import UTC, datetime

from ..config import Settings
from .types import EngineInterface, EngineState, EngineStatus, ProcessStatus

logger = logging.getLogger(__name__)

_SUBCOMMAND = {
    EngineInterface.SPARK_CONNECT: "spark",
    EngineInterface.FLIGHT_SQL: "flight",
}


def _now() -> datetime:
    return datetime.now(UTC)


class SupervisedListener:
    """One Sail listener, owned as a child process."""

    def __init__(
        self,
        *,
        interface: EngineInterface,
        binary: str,
        bind_host: str,
        connect_host: str,
        port: int,
        working_directory: str,
        log_tail_lines: int,
        backoff_seconds: Sequence[float],
        stable_after_seconds: float,
    ) -> None:
        self.interface = interface
        self.bind_host = bind_host
        self.connect_host = connect_host
        self.port = port
        self._argv = [
            binary,
            _SUBCOMMAND[interface],
            "server",
            "--ip",
            bind_host,
            "--port",
            str(port),
            "--directory",
            working_directory,
        ]
        self._backoff_seconds = list(backoff_seconds) or [1.0]
        self._stable_after_seconds = stable_after_seconds

        self._process: subprocess.Popen[str] | None = None
        self._log_tail: collections.deque[str] = collections.deque(maxlen=log_tail_lines)
        self._log_threads: list[threading.Thread] = []
        self._exit_recorded = False

        self.started_at: datetime | None = None
        self.restart_count = 0
        self.last_exit_code: int | None = None
        self.last_exit_at: datetime | None = None
        self.reachable = False
        #: Monotonic deadline before which a dead listener is not respawned.
        self.restart_not_before = 0.0
        self._backoff_index = 0

    # -- process lifecycle -------------------------------------------------

    @property
    def pid(self) -> int | None:
        return self._process.pid if self._process is not None else None

    def is_alive(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def start(self) -> None:
        if self.is_alive():
            return
        logger.info("starting Sail %s listener: %s", self.interface, " ".join(self._argv))
        self._process = subprocess.Popen(  # noqa: S603 - argv is built from settings
            self._argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.started_at = _now()
        self.reachable = False
        self._exit_recorded = False
        self._log_threads = [
            self._spawn_log_reader(self._process.stdout, "stdout"),
            self._spawn_log_reader(self._process.stderr, "stderr"),
        ]

    def _spawn_log_reader(self, stream, label: str) -> threading.Thread:
        def pump() -> None:
            if stream is None:
                return
            try:
                for line in stream:
                    text = line.rstrip("\n")
                    self._log_tail.append(text)
                    logger.debug("sail[%s/%s] %s", self.interface, label, text)
            finally:
                # The reader owns the pipe: closing it anywhere else would race
                # this loop. EOF arrives when the child exits.
                try:
                    stream.close()
                except OSError:  # pragma: no cover - already torn down
                    pass

        thread = threading.Thread(target=pump, name=f"sail-{self.interface}-{label}", daemon=True)
        thread.start()
        return thread

    def collect_exit(self) -> int | None:
        """Record an unexpected exit. Returns the exit code if it just died."""
        process = self._process
        if process is None or self._exit_recorded:
            return None
        code = process.poll()
        if code is None:
            return None
        self._exit_recorded = True
        self.last_exit_code = code
        self.last_exit_at = _now()
        self.reachable = False
        return code

    def schedule_restart(self, monotonic_now: float) -> float:
        """Arm the backoff for the next respawn and return the delay used."""
        uptime = 0.0
        if self.started_at is not None and self.last_exit_at is not None:
            uptime = (self.last_exit_at - self.started_at).total_seconds()
        if uptime >= self._stable_after_seconds:
            self._backoff_index = 0
        delay = self._backoff_seconds[min(self._backoff_index, len(self._backoff_seconds) - 1)]
        self._backoff_index = min(self._backoff_index + 1, len(self._backoff_seconds) - 1)
        self.restart_not_before = monotonic_now + delay
        self.restart_count += 1
        return delay

    def stop(self, timeout: float = 5.0) -> None:
        process = self._process
        if process is None:
            return
        if process.poll() is None:
            logger.info("stopping Sail %s listener (pid %s)", self.interface, process.pid)
            process.terminate()
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                logger.warning("Sail %s did not exit on SIGTERM; killing", self.interface)
                process.kill()
                process.wait(timeout=timeout)
        self._exit_recorded = True
        for thread in self._log_threads:
            thread.join(timeout=1.0)
        self._log_threads = []
        self._process = None
        self.reachable = False

    # -- health ------------------------------------------------------------

    async def probe(self, timeout: float) -> bool:
        """TCP-connect probe. For Flight SQL this is the only call we make
        into that port (ADR-0002, "Allowed edges")."""
        if not self.is_alive():
            self.reachable = False
            return False
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(self.connect_host, self.port), timeout
            )
        except (TimeoutError, OSError):
            self.reachable = False
            return False
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:  # pragma: no cover - peer closed first
            pass
        self.reachable = True
        return True

    def status(self) -> ProcessStatus:
        return ProcessStatus(
            interface=self.interface,
            host=self.bind_host,
            port=self.port,
            pid=self.pid,
            alive=self.is_alive(),
            reachable=self.reachable,
            started_at=self.started_at,
            restart_count=self.restart_count,
            last_exit_code=self.last_exit_code,
            last_exit_at=self.last_exit_at,
            log_tail=tuple(self._log_tail),
        )


class SailSupervisor:
    """Starts, watches, and restarts the Sail listeners."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._binary = settings.resolved_sail_binary()
        settings.data_dir.mkdir(parents=True, exist_ok=True)

        self._listeners: dict[EngineInterface, SupervisedListener] = {
            interface: SupervisedListener(
                interface=interface,
                binary=self._binary,
                bind_host=settings.sail_bind_host,
                connect_host=settings.sail_connect_host,
                port=port,
                working_directory=str(settings.data_dir),
                log_tail_lines=settings.engine_log_tail_lines,
                backoff_seconds=settings.engine_restart_backoff_seconds,
                stable_after_seconds=settings.engine_restart_stable_seconds,
            )
            for interface, port in (
                (EngineInterface.SPARK_CONNECT, settings.spark_connect_port),
                (EngineInterface.FLIGHT_SQL, settings.flight_sql_port),
            )
        }

        self._state = EngineState.STOPPED
        self._generation = 0
        self._started_at: datetime | None = None
        self._last_error: str | None = None
        self._sail_version: str | None = None
        self._watch_task: asyncio.Task[None] | None = None
        self._stopping = False
        self._ready = asyncio.Event()

    # -- public API --------------------------------------------------------

    @property
    def generation(self) -> int:
        """Bumped whenever the Spark Connect listener is (re)started.

        ``EngineClient`` compares its session's generation against this, which
        is how a session is reported lost rather than silently recreated
        against a different engine process (ADR-0002).
        """
        return self._generation

    @property
    def state(self) -> EngineState:
        return self._state

    @property
    def spark_connect_url(self) -> str:
        return self._settings.spark_connect_url

    def listener(self, interface: EngineInterface) -> SupervisedListener:
        return self._listeners[interface]

    async def start(self) -> None:
        self._stopping = False
        self._sail_version = self._read_sail_version()
        self._started_at = _now()
        for listener in self._listeners.values():
            listener.start()
            if listener.interface is EngineInterface.SPARK_CONNECT:
                self._generation += 1
        self._state = EngineState.STARTING
        self._watch_task = asyncio.create_task(self._watch(), name="sail-supervisor")

    async def wait_until_running(self, timeout: float) -> bool:
        try:
            await asyncio.wait_for(self._ready.wait(), timeout)
        except TimeoutError:
            return False
        return True

    async def stop(self) -> None:
        self._stopping = True
        task = self._watch_task
        self._watch_task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        for listener in self._listeners.values():
            listener.stop()
        self._state = EngineState.STOPPED
        self._ready.clear()

    def status(self, *, spark_version: str | None = None) -> EngineStatus:
        uptime = None
        if self._started_at is not None and self._state is not EngineState.STOPPED:
            uptime = (_now() - self._started_at).total_seconds()
        return EngineStatus(
            state=self._state,
            generation=self._generation,
            sail_version=self._sail_version,
            spark_version=spark_version,
            started_at=self._started_at,
            uptime_seconds=uptime,
            restart_count=sum(li.restart_count for li in self._listeners.values()),
            last_error=self._last_error,
            processes=tuple(li.status() for li in self._listeners.values()),
        )

    def is_query_path_ready(self) -> bool:
        listener = self._listeners[EngineInterface.SPARK_CONNECT]
        return listener.is_alive() and listener.reachable

    # -- internals ---------------------------------------------------------

    def _read_sail_version(self) -> str | None:
        """Sail's own version, which is not discoverable over Spark Connect:
        the engine reports the Spark version it emulates. See
        KNOWN-LIMITATIONS.md."""
        try:
            completed = subprocess.run(  # noqa: S603 - argv from settings
                [self._binary, "--version"],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            logger.warning("could not read Sail version: %s", exc)
            return None
        output = (completed.stdout or completed.stderr).strip()
        # `sail --version` prints "sail 0.7.2".
        return output.split()[-1] if output else None

    async def _watch(self) -> None:
        interval = self._settings.engine_health_interval_seconds
        probe_timeout = min(1.0, max(0.2, interval))
        while not self._stopping:
            try:
                await self._tick(probe_timeout)
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - the watchdog must not die
                logger.exception("supervisor tick failed")
            await asyncio.sleep(interval)

    async def _tick(self, probe_timeout: float) -> None:
        monotonic_now = asyncio.get_running_loop().time()

        for listener in self._listeners.values():
            exit_code = listener.collect_exit()
            if exit_code is not None:
                delay = listener.schedule_restart(monotonic_now)
                self._last_error = (
                    f"Sail {listener.interface} listener exited with code {exit_code}; "
                    f"restarting in {delay:.1f}s"
                )
                logger.warning("%s", self._last_error)

            if not listener.is_alive() and monotonic_now >= listener.restart_not_before:
                listener.start()
                if listener.interface is EngineInterface.SPARK_CONNECT:
                    self._generation += 1

        await asyncio.gather(
            *(listener.probe(probe_timeout) for listener in self._listeners.values())
        )
        self._state = self._compute_state(monotonic_now)
        if self._state is EngineState.RUNNING:
            self._ready.set()
        else:
            self._ready.clear()

    def _compute_state(self, monotonic_now: float) -> EngineState:
        listeners = list(self._listeners.values())
        if all(li.is_alive() and li.reachable for li in listeners):
            return EngineState.RUNNING
        if any(not li.is_alive() and monotonic_now < li.restart_not_before for li in listeners):
            return EngineState.RESTARTING
        if any(li.reachable for li in listeners):
            return EngineState.DEGRADED
        return EngineState.STARTING
