from __future__ import annotations

from contextlib import contextmanager
from collections.abc import Iterator
from pathlib import Path

import portalocker


@contextmanager
def exclusive_file_lock(path: Path, timeout_seconds: float = 30.0) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with portalocker.Lock(path, mode="a", timeout=timeout_seconds, encoding="utf-8"):
        yield
