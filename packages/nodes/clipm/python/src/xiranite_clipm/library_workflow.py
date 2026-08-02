from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sqlite3
from typing import Iterator

from .archive_metadata import ArchiveMetadataWriter
from .contracts import (
    CmLabel,
    FeedbackScanResult,
    ScoreLibraryResult,
    ScoreOptions,
    WorkScoreFailure,
    WorkScoreResult,
)
from .feedback_workflow import scan_filename_feedback
from .filename import ARCHIVE_EXTENSIONS
from .identity_reconciliation import IdentityAction, reconcile_work_identity
from .locks import ClipmOperationLocks
from .pages import IMAGE_EXTENSIONS
from .scoring import DIRECTORY_WORK_BATCH_SIZE, BatchScoringProgress, ScoredWork, ScoringEngine
from .work_workflow import process_score_work


@dataclass(frozen=True, slots=True)
class LibraryProgress:
    completed: int
    total: int
    path: str
    succeeded: bool
    progress: float = 0
    message: str = ""
    work: WorkScoreResult | None = None


def discover_library_works(root: Path) -> list[Path]:
    resolved = root.resolve(strict=True)
    if not resolved.is_dir():
        raise NotADirectoryError(resolved)
    works: set[Path] = set()
    unpacked_work_directories: set[Path] = set()
    has_root_images = False
    for entry in resolved.rglob("*"):
        if entry.is_symlink() or not entry.is_file():
            continue
        relative = entry.relative_to(resolved)
        suffix = entry.suffix.casefold()
        if suffix in ARCHIVE_EXTENSIONS:
            works.add(entry.resolve(strict=True))
        elif suffix in IMAGE_EXTENSIONS:
            if len(relative.parts) == 1:
                has_root_images = True
            else:
                unpacked_work_directories.add(entry.parent)
    if has_root_images:
        return [resolved]
    works.update(path.resolve(strict=True) for path in unpacked_work_directories)
    return sorted(works, key=lambda item: str(item).casefold())


def score_library_steps(
    connection: sqlite3.Connection,
    scoring: ScoringEngine,
    metadata: ArchiveMetadataWriter,
    root: Path,
    options: ScoreOptions,
    active_bundle_version: int | None,
    locks: ClipmOperationLocks | None = None,
) -> Iterator[LibraryProgress]:
    resolved = root.resolve(strict=True)
    feedback = (
        _empty_feedback_result(resolved)
        if options.dry_run
        else scan_filename_feedback(connection, metadata, resolved, active_bundle_version, locks)
    )
    candidates = discover_library_works(resolved)
    prepared = yield from _precompute_library_scores(
        connection,
        scoring,
        metadata,
        candidates,
        options,
        active_bundle_version,
        locks,
    )
    works = prepared.works
    failures = prepared.failures
    remaining = [candidate for candidate in candidates if candidate.resolve() not in prepared.processed_paths]
    progress_start = 95 if prepared.had_pending else 1
    for index, candidate in enumerate(remaining, start=1):
        result, failure, progress_path = _process_library_candidate(
            connection,
            prepared.scoring,
            metadata,
            candidate,
            options,
            active_bundle_version,
            locks,
        )
        if result is not None:
            works.append(result)
        if failure is not None:
            failures.append(failure)
        succeeded = result is not None
        yield LibraryProgress(
            completed=index,
            total=len(remaining),
            path=progress_path,
            succeeded=succeeded,
            progress=progress_start + (99 - progress_start) * index / max(1, len(remaining)),
            message=f"{'scored' if succeeded else 'failed'}: {progress_path}",
            work=result,
        )
    return ScoreLibraryResult(
        path=str(resolved),
        discovered_work_count=len(candidates),
        succeeded_work_count=len(works),
        failed_work_count=len(failures),
        feedback=feedback,
        works=sorted(works, key=_work_score_sort_key),
        failures=failures,
    )


class _PrecomputedScoringEngine:
    def __init__(self, target: ScoringEngine, outcomes: dict[Path, ScoredWork | Exception]):
        self._target = target
        self._outcomes = outcomes

    def score_work(self, path: Path) -> ScoredWork:
        resolved = path.resolve()
        outcome = self._outcomes.pop(resolved, None)
        if outcome is None:
            return self._target.score_work(resolved)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def score_works(self, paths: list[Path]) -> dict[Path, ScoredWork | Exception]:
        return self._target.score_works(paths)

    def score_works_steps(self, paths: list[Path]):
        return self._target.score_works_steps(paths)

    def encode_pages(self, images):
        return self._target.encode_pages(images)

    def unload(self) -> None:
        self._target.unload()


@dataclass(slots=True)
class _PreparedLibraryScoring:
    scoring: ScoringEngine
    processed_paths: set[Path]
    works: list[WorkScoreResult]
    failures: list[WorkScoreFailure]
    had_pending: bool


def _precompute_library_scores(
    connection: sqlite3.Connection,
    scoring: ScoringEngine,
    metadata: ArchiveMetadataWriter,
    candidates: list[Path],
    options: ScoreOptions,
    active_bundle_version: int | None,
    locks: ClipmOperationLocks | None,
) -> Iterator[LibraryProgress]:
    prepared = _PreparedLibraryScoring(scoring, set(), [], [], False)
    if options.dry_run:
        return prepared
    batch_steps = getattr(scoring, "score_works_steps", None)
    batch_score = getattr(scoring, "score_works", None)
    if not callable(batch_steps) and not callable(batch_score):
        return prepared
    pending: list[Path] = []
    for candidate in candidates:
        try:
            identity = reconcile_work_identity(connection, candidate, metadata)
        except Exception:
            continue
        if options.rescore or identity.action is IdentityAction.NEW_WORK:
            pending.append(identity.path)
    if not pending:
        return prepared
    prepared.had_pending = True
    try:
        if callable(batch_steps):
            steps = batch_steps(pending)
            last_progress = 5.0
            while True:
                try:
                    progress = next(steps)
                except StopIteration as completed:
                    outcomes = completed.value
                    break
                mapped = _batch_library_progress(progress)
                last_progress = mapped.progress
                yield mapped
                if progress.outcomes is not None:
                    yield from _persist_precomputed_batch(
                        connection,
                        scoring,
                        metadata,
                        progress.outcomes,
                        options,
                        active_bundle_version,
                        locks,
                        prepared,
                        progress.batch_index,
                        progress.batch_count,
                        last_progress,
                    )
            remaining_outcomes = {
                path: outcome
                for path, outcome in outcomes.items()
                if path.resolve() not in prepared.processed_paths
            }
            if remaining_outcomes:
                yield from _persist_precomputed_batch(
                    connection,
                    scoring,
                    metadata,
                    remaining_outcomes,
                    options,
                    active_bundle_version,
                    locks,
                    prepared,
                    1,
                    1,
                    last_progress,
                )
        else:
            batch_count = (len(pending) + DIRECTORY_WORK_BATCH_SIZE - 1) // DIRECTORY_WORK_BATCH_SIZE
            for batch_index, start in enumerate(range(0, len(pending), DIRECTORY_WORK_BATCH_SIZE), start=1):
                batch = pending[start : start + DIRECTORY_WORK_BATCH_SIZE]
                outcomes = batch_score(batch)
                progress = 5 + 90 * (start + len(batch)) / len(pending)
                yield from _persist_precomputed_batch(
                    connection,
                    scoring,
                    metadata,
                    outcomes,
                    options,
                    active_bundle_version,
                    locks,
                    prepared,
                    batch_index,
                    batch_count,
                    progress,
                )
    except Exception:
        return prepared
    return prepared


def _persist_precomputed_batch(
    connection: sqlite3.Connection,
    scoring: ScoringEngine,
    metadata: ArchiveMetadataWriter,
    outcomes: dict[Path, ScoredWork | Exception],
    options: ScoreOptions,
    active_bundle_version: int | None,
    locks: ClipmOperationLocks | None,
    prepared: _PreparedLibraryScoring,
    batch_index: int,
    batch_count: int,
    progress: float,
) -> Iterator[LibraryProgress]:
    batch_scoring = _PrecomputedScoringEngine(scoring, dict(outcomes))
    for path in outcomes:
        source_path = path.resolve()
        prepared.processed_paths.add(source_path)
        result, failure, progress_path = _process_library_candidate(
            connection,
            batch_scoring,
            metadata,
            source_path,
            options,
            active_bundle_version,
            locks,
        )
        if result is not None:
            prepared.works.append(result)
        if failure is not None:
            prepared.failures.append(failure)
        succeeded = result is not None
        yield LibraryProgress(
            completed=len(prepared.processed_paths),
            total=len(outcomes),
            path=progress_path,
            succeeded=succeeded,
            progress=progress,
            message=(
                f"{'persisted' if succeeded else 'failed'} GPU batch "
                f"{batch_index}/{batch_count}: {progress_path}"
            ),
            work=result,
        )


def _process_library_candidate(
    connection: sqlite3.Connection,
    scoring: ScoringEngine,
    metadata: ArchiveMetadataWriter,
    candidate: Path,
    options: ScoreOptions,
    active_bundle_version: int | None,
    locks: ClipmOperationLocks | None,
) -> tuple[WorkScoreResult | None, WorkScoreFailure | None, str]:
    try:
        result = process_score_work(
            connection,
            scoring,
            metadata,
            candidate,
            options,
            active_bundle_version,
            locks,
        )
        return result, None, result.path
    except Exception as error:
        return None, WorkScoreFailure(
            path=str(candidate),
            error_type=type(error).__name__,
            message=str(error).strip() or type(error).__name__,
        ), str(candidate)


def _batch_library_progress(progress: BatchScoringProgress) -> LibraryProgress:
    percent = 5 + 90 * progress.completed / max(1, progress.total)
    if progress.stage == "throttling":
        message = (
            f"performance limit pause {progress.pause_ms} ms before GPU batch "
            f"{progress.batch_index}/{progress.batch_count}"
        )
    elif progress.stage == "preparing":
        message = f"preparing pages {progress.completed + 1}/{progress.total}: {progress.path}"
    elif progress.stage == "prepared":
        message = f"prepared pages {progress.completed}/{progress.total}: {progress.path}"
    elif progress.stage == "prepare-failed":
        message = f"page preparation failed {progress.completed}/{progress.total}: {progress.path}"
    elif progress.stage == "inference":
        message = (
            f"running GPU batch {progress.batch_index}/{progress.batch_count} "
            f"over {progress.page_count} sampled page(s)"
        )
    else:
        message = (
            f"GPU batch {progress.batch_index}/{progress.batch_count} complete "
            f"for {progress.page_count} sampled page(s)"
        )
    return LibraryProgress(0, progress.total, progress.path, True, percent, message)


def consume_library_steps(steps: Iterator[LibraryProgress]) -> ScoreLibraryResult:
    while True:
        try:
            next(steps)
        except StopIteration as completed:
            return completed.value


def _is_image_file(path: Path) -> bool:
    return path.is_file() and path.suffix.casefold() in IMAGE_EXTENSIONS


def _empty_feedback_result(path: Path) -> FeedbackScanResult:
    return FeedbackScanResult(
        path=str(path),
        scanned_work_count=0,
        synchronized_work_count=0,
        imported_feedback_count=0,
    )


def _work_score_sort_key(work: WorkScoreResult) -> tuple[int, int, str]:
    return (
        0 if work.label is CmLabel.POSITIVE else 1,
        -work.score,
        work.path.casefold(),
    )
