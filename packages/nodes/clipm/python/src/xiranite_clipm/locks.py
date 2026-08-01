from __future__ import annotations

from collections.abc import Iterable, Iterator
from contextlib import AbstractContextManager, ExitStack, contextmanager
from dataclasses import dataclass
from hashlib import sha256
import os
from pathlib import Path
from uuid import UUID

import portalocker


@contextmanager
def exclusive_file_lock(path: Path, timeout_seconds: float = 30.0) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with portalocker.Lock(path, mode="a", timeout=timeout_seconds, encoding="utf-8"):
        yield


@dataclass(frozen=True, slots=True)
class ClipmOperationLocks:
    root: Path
    timeout_seconds: float = 30.0

    def inference(self) -> AbstractContextManager[None]:
        return exclusive_file_lock(
            self.root / "gpu-inference.lock",
            self.timeout_seconds,
        )

    def work(self, work_id: str | UUID) -> AbstractContextManager[None]:
        canonical_work_id = str(UUID(str(work_id)))
        return exclusive_file_lock(
            self.root / "works" / f"{canonical_work_id}.lock",
            self.timeout_seconds,
        )

    @contextmanager
    def works(self, work_ids: Iterable[str | UUID]) -> Iterator[None]:
        canonical_work_ids = sorted({str(UUID(str(work_id))) for work_id in work_ids})
        with ExitStack() as stack:
            for work_id in canonical_work_ids:
                stack.enter_context(self.work(work_id))
            yield

    def identity(self, path: Path) -> AbstractContextManager[None]:
        normalized = os.path.normcase(str(path.resolve(strict=False))).casefold()
        identity_key = sha256(normalized.encode("utf-8")).hexdigest()
        return exclusive_file_lock(
            self.root / "identities" / f"{identity_key}.lock",
            self.timeout_seconds,
        )
