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
from .scoring import BatchScoringProgress, ScoredWork, ScoringEngine
from .work_workflow import process_score_work


@dataclass(frozen=True, slots=True)
class LibraryProgress:
    completed: int
    total: int
    path: str
    succeeded: bool
    progress: float = 0
    message: str = ""


def discover_library_works(root: Path) -> list[Path]:
    resolved = root.resolve(strict=True)
    if not resolved.is_dir():
        raise NotADirectoryError(resolved)
    if any(_is_image_file(entry) for entry in resolved.iterdir()):
        return [resolved]
    works = {
        entry.resolve(strict=True)
        for entry in resolved.rglob("*")
        if entry.is_file() and not entry.is_symlink() and entry.suffix.casefold() in ARCHIVE_EXTENSIONS
    }
    works.update(
        entry.resolve(strict=True)
        for entry in resolved.iterdir()
        if entry.is_dir() and not entry.is_symlink() and any(_is_image_file(child) for child in entry.rglob("*"))
    )
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
    prepared_scoring = yield from _precompute_library_scores(
        connection,
        scoring,
        metadata,
        candidates,
        options,
    )
    works: list[WorkScoreResult] = []
    failures: list[WorkScoreFailure] = []
    for index, candidate in enumerate(candidates, start=1):
        succeeded = False
        progress_path = str(candidate)
        try:
            result = process_score_work(
                connection,
                prepared_scoring,
                metadata,
                candidate,
                options,
                active_bundle_version,
                locks,
            )
            works.append(result)
            progress_path = result.path
            succeeded = True
        except Exception as error:
            failures.append(
                WorkScoreFailure(
                    path=str(candidate),
                    error_type=type(error).__name__,
                    message=str(error).strip() or type(error).__name__,
                )
            )
        yield LibraryProgress(
            completed=index,
            total=len(candidates),
            path=progress_path,
            succeeded=succeeded,
            progress=50 + 50 * index / max(1, len(candidates)),
            message=f"{'scored' if succeeded else 'failed'}: {progress_path}",
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


def _precompute_library_scores(
    connection: sqlite3.Connection,
    scoring: ScoringEngine,
    metadata: ArchiveMetadataWriter,
    candidates: list[Path],
    options: ScoreOptions,
) -> Iterator[LibraryProgress]:
    batch_steps = getattr(scoring, "score_works_steps", None)
    batch_score = getattr(scoring, "score_works", None)
    if not callable(batch_steps) and not callable(batch_score):
        return scoring
    pending: list[Path] = []
    for candidate in candidates:
        try:
            identity = reconcile_work_identity(connection, candidate, metadata)
        except Exception:
            continue
        if options.rescore or identity.action is IdentityAction.NEW_WORK:
            pending.append(identity.path)
    if not pending:
        return scoring
    try:
        if callable(batch_steps):
            steps = batch_steps(pending)
            while True:
                try:
                    progress = next(steps)
                except StopIteration as completed:
                    outcomes = completed.value
                    break
                yield _batch_library_progress(progress)
        else:
            outcomes = batch_score(pending)
    except Exception:
        return scoring
    return _PrecomputedScoringEngine(scoring, outcomes)


def _batch_library_progress(progress: BatchScoringProgress) -> LibraryProgress:
    if progress.stage == "prepared":
        percent = 5 + 30 * progress.completed / max(1, progress.total)
        message = f"prepared pages {progress.completed}/{progress.total}: {progress.path}"
    elif progress.stage == "inference":
        percent = 40
        message = f"running one GPU batch over {progress.total} sampled page(s)"
    else:
        percent = 50
        message = f"GPU batch complete for {progress.total} sampled page(s)"
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
