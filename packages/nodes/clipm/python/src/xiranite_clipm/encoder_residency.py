from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from threading import RLock, Timer
from typing import Protocol

from .contracts import ModelResidency


IDLE_UNLOAD_SECONDS = 10 * 60


class Unloadable(Protocol):
    def unload(self) -> None: ...


class ScheduledCallback(Protocol):
    def cancel(self) -> None: ...


ScheduleCallback = Callable[[float, Callable[[], None]], ScheduledCallback]


class EncoderResidencyController:
    def __init__(
        self,
        target: Unloadable,
        policy: ModelResidency,
        *,
        idle_seconds: float = IDLE_UNLOAD_SECONDS,
        schedule: ScheduleCallback | None = None,
    ) -> None:
        if idle_seconds < 0:
            raise ValueError("Encoder idle unload delay cannot be negative")
        self._target = target
        self._policy = policy
        self._idle_seconds = idle_seconds
        self._schedule = schedule or _schedule_daemon_timer
        self._lock = RLock()
        self._active_operations = 0
        self._timer_generation = 0
        self._pending_unload: ScheduledCallback | None = None

    @contextmanager
    def scoring_operation(self) -> Iterator[None]:
        with self._lock:
            self._cancel_pending_unload()
            self._active_operations += 1
        try:
            yield
        finally:
            with self._lock:
                self._active_operations -= 1
                if self._active_operations == 0:
                    self._after_last_operation()

    def unload_now(self) -> None:
        with self._lock:
            self._cancel_pending_unload()
            self._target.unload()

    def _after_last_operation(self) -> None:
        if self._policy is ModelResidency.IMMEDIATE:
            self._target.unload()
            return
        if self._policy is ModelResidency.WORKER:
            return
        self._timer_generation += 1
        generation = self._timer_generation
        self._pending_unload = self._schedule(
            self._idle_seconds,
            lambda: self._unload_if_idle(generation),
        )

    def _unload_if_idle(self, generation: int) -> None:
        with self._lock:
            if generation != self._timer_generation or self._active_operations != 0:
                return
            self._pending_unload = None
            self._target.unload()

    def _cancel_pending_unload(self) -> None:
        self._timer_generation += 1
        pending = self._pending_unload
        self._pending_unload = None
        if pending is not None:
            pending.cancel()


def _schedule_daemon_timer(delay_seconds: float, callback: Callable[[], None]) -> Timer:
    timer = Timer(delay_seconds, callback)
    timer.daemon = True
    timer.start()
    return timer
