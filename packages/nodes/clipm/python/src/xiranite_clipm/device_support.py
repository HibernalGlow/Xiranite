"""Which inference device this machine can actually run, and what to use when nothing was configured.

Kept separate from `settings` and `service` so both ask one question and get one answer: `service` reports
availability, `settings` resolves the default, and neither re-implements the probe.
"""

from __future__ import annotations

import importlib.util
from collections.abc import Callable

from .contracts import DevicePreference


def _probe(read: Callable[[], bool]) -> bool:
    if importlib.util.find_spec("torch") is None:
        return False
    try:
        return bool(read())
    except Exception:
        return False


def cuda_available() -> bool:
    def read() -> bool:
        import torch

        return torch.cuda.is_available()

    return _probe(read)


def mps_available() -> bool:
    def read() -> bool:
        import torch

        return torch.backends.mps.is_available()

    return _probe(read)


def default_device(*, cuda: bool, mps: bool) -> DevicePreference:
    """Discrete GPU first, then Apple Silicon's MPS, then CPU. Never a device the machine does not have."""
    if cuda:
        return DevicePreference.CUDA
    if mps:
        return DevicePreference.MPS
    return DevicePreference.CPU


def configured_device(env_value: str | None) -> DevicePreference:
    """The operator's choice, or this machine's best device when nothing was configured.

    An unrecognised value still fails instead of quietly switching devices: a typo in
    `XIRANITE_CLIPM_DEVICE` used to mean a worker that refuses to start, and it must stay that loud.
    """
    trimmed = env_value.strip() if env_value else ""
    if trimmed:
        return DevicePreference(trimmed)
    return default_device(cuda=cuda_available(), mps=mps_available())
