from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path

from .contracts import DevicePreference, ModelResidency


DEFAULT_RUNTIME_ROOT = Path(r"D:\1VSCODE\Projects\Xiranite\artifacts\clipm-runtime")


@dataclass(frozen=True, slots=True)
class ClipmSettings:
    runtime_root: Path
    device: DevicePreference
    model_residency: ModelResidency
    huggingface_cache: Path

    @property
    def database_path(self) -> Path:
        return self.runtime_root / "data" / "clipm.sqlite"

    @property
    def locks_root(self) -> Path:
        return self.runtime_root / "data" / "locks"

    @property
    def models_root(self) -> Path:
        return self.runtime_root / "models"

    @property
    def training_root(self) -> Path:
        return self.runtime_root / "data" / "training"

    @classmethod
    def from_environment(cls) -> ClipmSettings:
        runtime_value = os.environ.get("XIRANITE_CLIPM_RUNTIME_ROOT")
        runtime_root = Path(runtime_value) if runtime_value else DEFAULT_RUNTIME_ROOT
        if not runtime_root.is_absolute():
            raise ValueError("XIRANITE_CLIPM_RUNTIME_ROOT must be an absolute path")
        return cls(
            runtime_root=runtime_root,
            device=DevicePreference(os.environ.get("XIRANITE_CLIPM_DEVICE", DevicePreference.CUDA.value)),
            model_residency=ModelResidency(
                os.environ.get("XIRANITE_CLIPM_MODEL_RESIDENCY", ModelResidency.IDLE_10M.value)
            ),
            huggingface_cache=Path(
                os.environ.get("XIRANITE_CLIPM_HF_CACHE", runtime_root / "huggingface-cache")
            ),
        )
