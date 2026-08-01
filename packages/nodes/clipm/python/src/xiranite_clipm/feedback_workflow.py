from __future__ import annotations

from pathlib import Path
import sqlite3

from .archive_metadata import ArchiveMetadataWriter
from .contracts import (
    ApplyFeedbackCommand,
    FeedbackApplyResult,
    FeedbackOrigin,
    FeedbackScanResult,
    ScoreOptions,
)
from .feedback_repository import apply_feedback
from .filename import ARCHIVE_EXTENSIONS, has_cm_like_suffix
from .identity_reconciliation import IdentityAction, reconcile_work_identity
from .metadata_repository import recover_work_from_document
from .score_repository import relocate_work
from .work_workflow import synchronize_work_artifacts


def apply_and_synchronize_feedback(
    connection: sqlite3.Connection,
    metadata: ArchiveMetadataWriter,
    command: ApplyFeedbackCommand,
    active_bundle_version: int | None,
) -> FeedbackApplyResult:
    work_id = str(command.work_id)
    path = _current_work_path(connection, work_id)
    event = apply_feedback(connection, command)
    work = synchronize_work_artifacts(
        connection,
        metadata,
        work_id,
        path,
        ScoreOptions(),
        active_bundle_version,
    )
    return FeedbackApplyResult(work=work, event=event)


def scan_filename_feedback(
    connection: sqlite3.Connection,
    metadata: ArchiveMetadataWriter,
    root: Path,
    active_bundle_version: int | None,
) -> FeedbackScanResult:
    resolved_root = root.resolve(strict=True)
    candidates = discover_feedback_candidates(resolved_root)
    imported_feedback: list[FeedbackApplyResult] = []
    reviews = []
    works = []
    for candidate in candidates:
        reconciliation = reconcile_work_identity(connection, candidate, metadata)
        if reconciliation.action is IdentityAction.REVIEW:
            if reconciliation.review is not None:
                reviews.append(reconciliation.review)
            continue
        work_id = reconciliation.work_id
        if reconciliation.action is IdentityAction.RECOVER_DATABASE:
            assert reconciliation.document is not None
            work_id = recover_work_from_document(connection, candidate, reconciliation.document)
        elif work_id is not None:
            relocate_work(connection, work_id, candidate)
        if work_id is None:
            continue
        event = None
        if reconciliation.filename_changed and reconciliation.filename_tag is not None:
            event = apply_feedback(
                connection,
                ApplyFeedbackCommand(
                    work_id=work_id,
                    classification=reconciliation.filename_tag.label,
                    ranking=reconciliation.filename_tag.score,
                    source=FeedbackOrigin.FILENAME,
                ),
            )
        work = synchronize_work_artifacts(
            connection,
            metadata,
            work_id,
            candidate,
            ScoreOptions(),
            active_bundle_version,
        )
        works.append(work)
        if event is not None:
            imported_feedback.append(FeedbackApplyResult(work=work, event=event))
    return FeedbackScanResult(
        path=str(resolved_root),
        scanned_work_count=len(candidates),
        synchronized_work_count=len(works),
        imported_feedback_count=len(imported_feedback),
        imported_feedback=imported_feedback,
        review_items=reviews,
        works=works,
    )


def discover_feedback_candidates(root: Path) -> list[Path]:
    if _is_feedback_candidate(root):
        return [root]
    if not root.is_dir():
        return []
    candidates: list[Path] = []
    pending = [root]
    while pending:
        directory = pending.pop()
        for entry in sorted(directory.iterdir(), key=lambda item: item.name.casefold(), reverse=True):
            if entry.is_symlink():
                continue
            if _is_feedback_candidate(entry):
                candidates.append(entry.resolve(strict=True))
            elif entry.is_dir():
                pending.append(entry)
    return sorted(candidates, key=lambda item: str(item).casefold())


def _is_feedback_candidate(path: Path) -> bool:
    if not has_cm_like_suffix(path.name):
        return False
    return path.is_dir() or path.suffix.casefold() in ARCHIVE_EXTENSIONS


def _current_work_path(connection: sqlite3.Connection, work_id: str) -> Path:
    row = connection.execute(
        "SELECT path FROM work_locations WHERE work_id = ? AND is_current = 1",
        (work_id,),
    ).fetchone()
    if row is None:
        raise KeyError(f"ClipM work {work_id} has no current location")
    return Path(str(row["path"])).resolve(strict=True)
