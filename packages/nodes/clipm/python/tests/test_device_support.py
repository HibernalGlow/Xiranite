from __future__ import annotations

import pytest

from xiranite_clipm import device_support
from xiranite_clipm.contracts import DevicePreference
from xiranite_clipm.device_support import configured_device, default_device


def test_default_device_prefers_discrete_gpu_then_apple_mps_then_cpu() -> None:
    assert default_device(cuda=True, mps=True) is DevicePreference.CUDA
    assert default_device(cuda=True, mps=False) is DevicePreference.CUDA
    assert default_device(cuda=False, mps=True) is DevicePreference.MPS
    assert default_device(cuda=False, mps=False) is DevicePreference.CPU


def test_configured_device_keeps_an_explicit_choice_without_probing() -> None:
    assert configured_device("cuda") is DevicePreference.CUDA
    assert configured_device("mps") is DevicePreference.MPS
    assert configured_device("cpu") is DevicePreference.CPU
    assert configured_device(" mps ") is DevicePreference.MPS


def test_configured_device_rejects_an_unknown_word_instead_of_switching_quietly() -> None:
    with pytest.raises(ValueError):
        configured_device("tpu")


def test_blank_environment_falls_back_to_this_machine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(device_support, "cuda_available", lambda: False)
    monkeypatch.setattr(device_support, "mps_available", lambda: True)
    assert configured_device(None) is DevicePreference.MPS
    assert configured_device("") is DevicePreference.MPS
    assert configured_device("   ") is DevicePreference.MPS


def test_a_machine_without_pytorch_defaults_to_cpu(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(device_support, "cuda_available", lambda: False)
    monkeypatch.setattr(device_support, "mps_available", lambda: False)
    assert configured_device(None) is DevicePreference.CPU
