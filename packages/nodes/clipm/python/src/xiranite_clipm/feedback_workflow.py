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
    UndoFeedbackCommand,
)
from .feedback_repository import (
    apply_feedback,
    rollback_feedback_application,
    rollback_feedback_undo,
    undo_feedback,
)
from .filename import ARCHIVE_EXTENSIONS, CmFilenameTag, has_cm_like_suffix, scored_path
from .identity_reconciliation import IdentityAction, reconcile_work_identity
from .metadata_repository import recover_work_from_document
from .score_repository import load_work_score_result, relocate_work
from .work_workflow import synchronize_work_artifacts


def apply_and_synchronize_feedback(
    connection: sqlite3.Connection,
    metadata: ArchiveMetadataWriter,
    command: ApplyFeedbackCommand,
    active_bundle_version: int | None,
) -> FeedbackApplyResult:
    work_id = str(command.work_id)
    path = _current_work_path(connection, work_id)
    previous_updated_at = _work_updated_at(connection, work_id)
    event = apply_feedback(connection, command)
    projected_path = _projected_path(connection, work_id, path, active_bundle_version)
    try:
        work = synchronize_work_artifacts(
            connection,
            metadata,
            work_id,
            path,
            ScoreOptions(),
            active_bundle_version,
        )
    except Exception as error:
        rolled_back = event is None
        if event is not None:
            try:
                rollback_feedback_application(connection, event, previous_updated_at)
                rolled_back = True
            except Exception as rollback_error:
                error.add_note(f"Unable to roll back feedback event {event.event_id}: {rollback_error}")
        if rolled_back:
            _restore_feedback_projection(
                connection,
                metadata,
                work_id,
                path,
                projected_path,
                active_bundle_version,
                error,
            )
        raise
    return FeedbackApplyResult(work=work, event=event)


def undo_and_synchronize_feedback(
    connection: sqlite3.Connection,
    metadata: ArchiveMetadataWriter,
    command: UndoFeedbackCommand,
    active_bundle_version: int | None,
) -> FeedbackApplyResult:
    row = connection.execute(
        "SELECT work_id FROM feedback_events WHERE event_id = ?",
        (str(command.event_id),),
    ).fetchone()
    if row is None:
        raise KeyError(f"Unknown ClipM feedback event: {command.event_id}")
    work_id = str(row["work_id"])
    path = _current_work_path(connection, work_id)
    previous_updated_at = _work_updated_at(connection, work_id)
    event = undo_feedback(connection, command.event_id, command.source)
    projected_path = _projected_path(connection, work_id, path, active_bundle_version)
    try:
        work = synchronize_work_artifacts(
            connection,
            metadata,
            work_id,
            path,
            ScoreOptions(),
            active_bundle_version,
        )
    except Exception as error:
        rolled_back = False
        try:
            rollback_feedback_undo(
                connection,
                command.event_id,
                event,
                previous_updated_at,
            )
            rolled_back = True
        except Exception as rollback_error:
            error.add_note(f"Unable to roll back feedback undo {event.event_id}: {rollback_error}")
        if rolled_back:
            _restore_feedback_projection(
                connection,
                metadata,
                work_id,
                path,
                projected_path,
                active_bundle_version,
                error,
            )
        raise
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


def _work_updated_at(connection: sqlite3.Connection, work_id: str) -> str:
    row = connection.execute("SELECT updated_at FROM works WHERE work_id = ?", (work_id,)).fetchone()
    if row is None:
        raise KeyError(f"Unknown ClipM work: {work_id}")
    return str(row["updated_at"])


def _projected_path(
    connection: sqlite3.Connection,
    work_id: str,
    path: Path,
    active_bundle_version: int | None,
) -> Path:
    work = load_work_score_result(connection, work_id, path, active_bundle_version)
    return Path(
        scored_path(
            str(path),
            CmFilenameTag(work.bundle_version, work.label, work.score, work.short_code),
        )
    )


def _restore_feedback_projection(
    connection: sqlite3.Connection,
    metadata: ArchiveMetadataWriter,
    work_id: str,
    original_path: Path,
    projected_path: Path,
    active_bundle_version: int | None,
    original_error: Exception,
) -> None:
    source = original_path if original_path.exists() else projected_path
    if not source.exists():
        original_error.add_note(
            f"Unable to restore ClipM artifacts because neither {original_path} nor {projected_path} exists"
        )
        return
    try:
        synchronize_work_artifacts(
            connection,
            metadata,
            work_id,
            source,
            ScoreOptions(),
            active_bundle_version,
        )
    except Exception as rollback_error:
        original_error.add_note(f"Unable to restore ClipM artifacts: {rollback_error}")
