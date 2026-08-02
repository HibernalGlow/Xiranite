from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import multiprocessing
from pathlib import Path
from threading import Barrier, Event, Lock
from typing import Any

import numpy as np
import pytest

from xiranite_clipm.archive_metadata import ArchiveMetadataWriter
from xiranite_clipm.contracts import (
    ApplyFeedbackCommand,
    CmLabel,
    DevicePreference,
    FeedbackOrigin,
    ModelResidency,
    ScoreOptions,
)
from xiranite_clipm.scoring import ScoredWork
from xiranite_clipm.service import ClipmService
from xiranite_clipm.settings import ClipmSettings


def _settings(runtime_root: Path) -> ClipmSettings:
    return ClipmSettings(
        runtime_root=runtime_root,
        device=DevicePreference.CPU,
        model_residency=ModelResidency.IMMEDIATE,
        huggingface_cache=runtime_root / "huggingface-cache",
    )


def _scored(path: Path, label: CmLabel = CmLabel.POSITIVE, score: int = 873) -> ScoredWork:
    return ScoredWork(
        path=path,
        label=label,
        score=score,
        probability=score / 1000,
        bundle_version=1,
        embedding=np.zeros(768, dtype=np.float32),
        sampled_pages=["01.png"],
        candidate_page_count=1,
        page_count=1,
    )


class FixedScoring:
    def __init__(self, outcomes: list[tuple[CmLabel, int]] | None = None) -> None:
        self._outcomes = outcomes or [(CmLabel.POSITIVE, 873)]
        self._calls = 0

    def score_work(self, path: Path) -> ScoredWork:
        outcome = self._outcomes[min(self._calls, len(self._outcomes) - 1)]
        self._calls += 1
        return _scored(path, *outcome)

    def unload(self) -> None:
        pass


class ProcessProbeScoring:
    def __init__(
        self,
        active: Any,
        maximum: Any,
        total_entries: Any,
        state_lock: Any,
        first_entered: Any,
        second_entered: Any,
        release: Any,
    ) -> None:
        self._active = active
        self._maximum = maximum
        self._total_entries = total_entries
        self._state_lock = state_lock
        self._first_entered = first_entered
        self._second_entered = second_entered
        self._release = release

    def score_work(self, path: Path) -> ScoredWork:
        with self._state_lock:
            self._active.value += 1
            self._maximum.value = max(self._maximum.value, self._active.value)
            self._total_entries.value += 1
            if self._total_entries.value == 1:
                self._first_entered.set()
            elif self._total_entries.value == 2:
                self._second_entered.set()
        try:
            if not self._release.wait(30):
                raise TimeoutError("test did not release the inference probe")
            return _scored(path)
        finally:
            with self._state_lock:
                self._active.value -= 1

    def unload(self) -> None:
        pass


def _score_in_process(
    runtime_root: str,
    work_path: str,
    active: Any,
    maximum: Any,
    total_entries: Any,
    ready_count: Any,
    state_lock: Any,
    first_entered: Any,
    second_entered: Any,
    both_ready: Any,
    release: Any,
    results: Any,
) -> None:
    scoring = ProcessProbeScoring(
        active,
        maximum,
        total_entries,
        state_lock,
        first_entered,
        second_entered,
        release,
    )
    service = ClipmService(_settings(Path(runtime_root)), scoring=scoring)
    try:
        with state_lock:
            ready_count.value += 1
            if ready_count.value == 2:
                both_ready.set()
        service.score_work(
            work_path,
            ScoreOptions(rename=False, write_metadata=False),
        )
        results.put(None)
    except BaseException as error:
        results.put(f"{type(error).__name__}: {error}")
    finally:
        service.close()


def test_two_worker_processes_serialize_inference(tmp_path: Path) -> None:
    context = multiprocessing.get_context("spawn")
    runtime_root = tmp_path / "runtime"
    first_work = tmp_path / "first"
    second_work = tmp_path / "second"
    first_work.mkdir()
    second_work.mkdir()
    active = context.Value("i", 0)
    maximum = context.Value("i", 0)
    total_entries = context.Value("i", 0)
    ready_count = context.Value("i", 0)
    state_lock = context.Lock()
    first_entered = context.Event()
    second_entered = context.Event()
    both_ready = context.Event()
    release = context.Event()
    results = context.Queue()
    args = (
        str(runtime_root),
        active,
        maximum,
        total_entries,
        ready_count,
        state_lock,
        first_entered,
        second_entered,
        both_ready,
        release,
        results,
    )
    first = context.Process(
        target=_score_in_process,
        args=(args[0], str(first_work), *args[1:]),
    )
    second = context.Process(
        target=_score_in_process,
        args=(args[0], str(second_work), *args[1:]),
    )
    first.start()
    assert first_entered.wait(30)
    second.start()
    try:
        assert both_ready.wait(30)
        assert second_entered.wait(0.5) is False
    finally:
        release.set()
        first.join(30)
        second.join(30)
        if first.is_alive():
            first.terminate()
        if second.is_alive():
            second.terminate()
    assert first.exitcode == 0
    assert second.exitcode == 0
    assert [results.get(timeout=5), results.get(timeout=5)] == [None, None]
    assert total_entries.value == 2
    assert maximum.value == 1


class OverlapMetadataWriter(ArchiveMetadataWriter):
    def __init__(self, barrier: Barrier) -> None:
        super().__init__()
        self._barrier = barrier
        self._state_lock = Lock()
        self.active = 0
        self.maximum = 0

    def write(self, path: Path, document: Any) -> None:
        with self._state_lock:
            self.active += 1
            self.maximum = max(self.maximum, self.active)
        try:
            self._barrier.wait(10)
            super().write(path, document)
        finally:
            with self._state_lock:
                self.active -= 1


class HoldingMetadataWriter(ArchiveMetadataWriter):
    def __init__(self) -> None:
        super().__init__()
        self._state_lock = Lock()
        self._writes = 0
        self.first_entered = Event()
        self.second_entered = Event()
        self.release = Event()

    def write(self, path: Path, document: Any) -> None:
        with self._state_lock:
            self._writes += 1
            write_number = self._writes
        if write_number == 1:
            self.first_entered.set()
            if not self.release.wait(10):
                raise TimeoutError("test did not release the metadata probe")
        elif write_number == 2:
            self.second_entered.set()
        super().write(path, document)


class FailOnceMetadataWriter(ArchiveMetadataWriter):
    def __init__(self) -> None:
        super().__init__()
        self._failed = False

    def write(self, path: Path, document: Any) -> None:
        if not self._failed:
            self._failed = True
            raise OSError("simulated concurrent metadata failure")
        super().write(path, document)


def _seed_works(runtime_root: Path, root: Path, count: int) -> list[tuple[str, str]]:
    service = ClipmService(_settings(runtime_root), scoring=FixedScoring())
    seeded: list[tuple[str, str]] = []
    try:
        for index in range(count):
            path = root / f"book-{index}"
            path.mkdir()
            result = service.score_work(str(path))
            seeded.append((str(result.work_id), result.path))
    finally:
        service.close()
    return seeded


def _apply_feedback(
    runtime_root: Path,
    metadata: ArchiveMetadataWriter,
    command: ApplyFeedbackCommand,
) -> None:
    service = ClipmService(
        _settings(runtime_root),
        scoring=FixedScoring(),
        metadata=metadata,
    )
    try:
        service.apply_feedback(command)
    finally:
        service.close()


def test_different_works_can_synchronize_metadata_concurrently(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    first, second = _seed_works(runtime_root, tmp_path, 2)
    metadata = OverlapMetadataWriter(Barrier(2))
    commands = [
        ApplyFeedbackCommand(
            work_id=work_id,
            classification=CmLabel.NEGATIVE,
            source=FeedbackOrigin.GUI,
        )
        for work_id, _path in (first, second)
    ]
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(_apply_feedback, runtime_root, metadata, command) for command in commands]
        for future in futures:
            future.result(timeout=30)
    assert metadata.maximum == 2


def test_same_work_serializes_metadata_and_rename_operations(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    (work_id, _path), = _seed_works(runtime_root, tmp_path, 1)
    metadata = HoldingMetadataWriter()
    first = ApplyFeedbackCommand(
        work_id=work_id,
        classification=CmLabel.NEGATIVE,
        source=FeedbackOrigin.GUI,
    )
    second = ApplyFeedbackCommand(
        work_id=work_id,
        ranking=342,
        source=FeedbackOrigin.NEOVIEW,
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        first_future = executor.submit(_apply_feedback, runtime_root, metadata, first)
        assert metadata.first_entered.wait(30)
        second_future = executor.submit(_apply_feedback, runtime_root, metadata, second)
        try:
            assert metadata.second_entered.wait(0.5) is False
        finally:
            metadata.release.set()
        first_future.result(timeout=30)
        second_future.result(timeout=30)
    assert metadata.second_entered.is_set()


def test_failed_operations_release_inference_and_work_locks(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    work = tmp_path / "inference-failure"
    work.mkdir()

    class FailingScoring(FixedScoring):
        def score_work(self, path: Path) -> ScoredWork:
            raise RuntimeError("simulated inference failure")

    failing_service = ClipmService(_settings(runtime_root), scoring=FailingScoring())
    try:
        with pytest.raises(RuntimeError, match="simulated inference failure"):
            failing_service.score_work(str(work), ScoreOptions(rename=False, write_metadata=False))
    finally:
        failing_service.close()
    succeeding_service = ClipmService(_settings(runtime_root), scoring=FixedScoring())
    try:
        succeeded = succeeding_service.score_work(str(work), ScoreOptions(rename=False, write_metadata=False))
        assert succeeded.score == 873
    finally:
        succeeding_service.close()

    (work_id, _path), = _seed_works(runtime_root, tmp_path, 1)
    metadata = FailOnceMetadataWriter()
    failed_command = ApplyFeedbackCommand(
        work_id=work_id,
        classification=CmLabel.NEGATIVE,
        source=FeedbackOrigin.GUI,
    )
    with pytest.raises(OSError, match="simulated concurrent metadata failure"):
        _apply_feedback(runtime_root, metadata, failed_command)
    _apply_feedback(runtime_root, metadata, failed_command)
