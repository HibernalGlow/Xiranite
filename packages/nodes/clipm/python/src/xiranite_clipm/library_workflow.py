from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sqlite3
from typing import Iterator

from .archive_metadata import ArchiveMetadataWriter
from .contracts import (
    FeedbackScanResult,
    ScoreLibraryResult,
    ScoreOptions,
    WorkScoreFailure,
    WorkScoreResult,
)
from .feedback_workflow import scan_filename_feedback
from .filename import ARCHIVE_EXTENSIONS
from .locks import ClipmOperationLocks
from .pages import IMAGE_EXTENSIONS
from .scoring import ScoringEngine
from .work_workflow import process_score_work


@dataclass(frozen=True, slots=True)
class LibraryProgress:
    completed: int
    total: int
    path: str
    succeeded: bool


def discover_library_works(root: Path) -> list[Path]:
    resolved = root.resolve(strict=True)
    if not resolved.is_dir():
        raise NotADirectoryError(resolved)
    if any(_is_image_file(entry) for entry in resolved.iterdir()):
        return [resolved]
    works = [entry.resolve(strict=True) for entry in resolved.iterdir() if _is_work_entry(entry)]
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
    works: list[WorkScoreResult] = []
    failures: list[WorkScoreFailure] = []
    for index, candidate in enumerate(candidates, start=1):
        succeeded = False
        progress_path = str(candidate)
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
        )
    return ScoreLibraryResult(
        path=str(resolved),
        discovered_work_count=len(candidates),
        succeeded_work_count=len(works),
        failed_work_count=len(failures),
        feedback=feedback,
        works=works,
        failures=failures,
    )


def consume_library_steps(steps: Iterator[LibraryProgress]) -> ScoreLibraryResult:
    while True:
        try:
            next(steps)
        except StopIteration as completed:
            return completed.value


def _is_work_entry(path: Path) -> bool:
    if path.is_symlink():
        return False
    if path.is_file():
        return path.suffix.casefold() in ARCHIVE_EXTENSIONS
    if not path.is_dir():
        return False
    return any(_is_image_file(entry) for entry in path.rglob("*"))


def _is_image_file(path: Path) -> bool:
    return path.is_file() and path.suffix.casefold() in IMAGE_EXTENSIONS


def _empty_feedback_result(path: Path) -> FeedbackScanResult:
    return FeedbackScanResult(
        path=str(path),
        scanned_work_count=0,
        synchronized_work_count=0,
        imported_feedback_count=0,
    )
