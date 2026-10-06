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
    scoring_work_batch_size: int = 8
    scoring_page_batch_size: int = 32
    scoring_batch_pause_ms: int = 0
    config_path: Path | None = None

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
            scoring_work_batch_size=_bounded_integer_environment(
                "XIRANITE_CLIPM_SCORING_WORK_BATCH_SIZE", 8, 1, 32
            ),
            scoring_page_batch_size=_bounded_integer_environment(
                "XIRANITE_CLIPM_SCORING_PAGE_BATCH_SIZE", 32, 1, 128
            ),
            scoring_batch_pause_ms=_bounded_integer_environment(
                "XIRANITE_CLIPM_SCORING_BATCH_PAUSE_MS", 0, 0, 10_000
            ),
            config_path=_optional_absolute_path_environment("XIRANITE_CONFIG_PATH"),
        )


def _bounded_integer_environment(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _optional_absolute_path_environment(name: str) -> Path | None:
    raw = os.environ.get(name)
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        raise ValueError(f"{name} must be an absolute path")
    return path
