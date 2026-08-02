from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import tomllib


@dataclass(frozen=True, slots=True)
class ScoringPerformanceLimits:
    work_batch_size: int = 8
    page_batch_size: int = 32
    batch_pause_ms: int = 0


class ScoringPerformanceController:
    def __init__(self, defaults: ScoringPerformanceLimits, config_path: Path | None):
        self._defaults = defaults
        self._current = defaults
        self._config_path = config_path

    def current(self) -> ScoringPerformanceLimits:
        if self._config_path is None:
            return self._current
        try:
            with self._config_path.open("rb") as source:
                document = tomllib.load(source)
            clipm = document.get("nodes", {}).get("clipm", {})
            candidate = ScoringPerformanceLimits(
                work_batch_size=_bounded_integer(
                    clipm.get("scoring_work_batch_size"), self._defaults.work_batch_size, 1, 32
                ),
                page_batch_size=_bounded_integer(
                    clipm.get("scoring_page_batch_size"), self._defaults.page_batch_size, 1, 128
                ),
                batch_pause_ms=_bounded_integer(
                    clipm.get("scoring_batch_pause_ms"), self._defaults.batch_pause_ms, 0, 10_000
                ),
            )
        except (OSError, TypeError, ValueError, tomllib.TOMLDecodeError):
            return self._current
        self._current = candidate
        return candidate


def _bounded_integer(value: object, fallback: int, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return fallback
    return value if minimum <= value <= maximum else fallback
