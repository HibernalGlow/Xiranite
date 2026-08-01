from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import pytest

from xiranite_clipm.contracts import ModelResidency
from xiranite_clipm.encoder_residency import EncoderResidencyController, IDLE_UNLOAD_SECONDS


class FakeTarget:
    def __init__(self) -> None:
        self.unload_count = 0

    def unload(self) -> None:
        self.unload_count += 1


@dataclass
class FakeScheduledCallback:
    delay_seconds: float
    callback: Callable[[], None]
    cancelled: bool = False

    def cancel(self) -> None:
        self.cancelled = True

    def fire(self) -> None:
        self.callback()


class FakeScheduler:
    def __init__(self) -> None:
        self.callbacks: list[FakeScheduledCallback] = []

    def __call__(self, delay_seconds: float, callback: Callable[[], None]) -> FakeScheduledCallback:
        scheduled = FakeScheduledCallback(delay_seconds, callback)
        self.callbacks.append(scheduled)
        return scheduled


def test_immediate_policy_unloads_after_the_outermost_scoring_operation() -> None:
    target = FakeTarget()
    controller = EncoderResidencyController(target, ModelResidency.IMMEDIATE)

    with controller.scoring_operation():
        with controller.scoring_operation():
            assert target.unload_count == 0
        assert target.unload_count == 0

    assert target.unload_count == 1


def test_idle_policy_restarts_the_timer_and_ignores_a_stale_callback() -> None:
    target = FakeTarget()
    scheduler = FakeScheduler()
    controller = EncoderResidencyController(
        target,
        ModelResidency.IDLE_10M,
        schedule=scheduler,
    )

    with controller.scoring_operation():
        pass
    first = scheduler.callbacks[0]
    assert first.delay_seconds == IDLE_UNLOAD_SECONDS

    with controller.scoring_operation():
        assert first.cancelled is True
        first.fire()
        assert target.unload_count == 0
    second = scheduler.callbacks[1]

    second.fire()
    assert target.unload_count == 1


def test_worker_policy_keeps_the_encoder_until_explicit_shutdown() -> None:
    target = FakeTarget()
    scheduler = FakeScheduler()
    controller = EncoderResidencyController(
        target,
        ModelResidency.WORKER,
        schedule=scheduler,
    )

    with controller.scoring_operation():
        pass

    assert scheduler.callbacks == []
    assert target.unload_count == 0
    controller.unload_now()
    assert target.unload_count == 1


def test_failed_scoring_still_applies_the_residency_policy() -> None:
    target = FakeTarget()
    controller = EncoderResidencyController(target, ModelResidency.IMMEDIATE)

    with pytest.raises(RuntimeError, match="scoring failed"):
        with controller.scoring_operation():
            raise RuntimeError("scoring failed")

    assert target.unload_count == 1
