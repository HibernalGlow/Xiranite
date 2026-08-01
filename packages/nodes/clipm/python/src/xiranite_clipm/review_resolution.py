from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from uuid import uuid4

from .archive_metadata import ArchiveMetadataWriter
from .contracts import (
    ApplyFeedbackCommand,
    FeedbackOrigin,
    ResolveReviewItemCommand,
    ReviewKind,
    ReviewResolution,
    ScoreOptions,
    WorkScoreResult,
)
from .feedback_repository import apply_feedback
from .filename import parse_cm_tag
from .locks import ClipmOperationLocks
from .metadata_repository import normalized_path_key, recover_work_from_document
from .score_repository import persist_scored_work, relocate_work
from .scoring import ScoringEngine
from .short_codes import decode_canonical_short_code
from .work_workflow import synchronize_work_artifacts
from .work_merge import merge_work_into_existing


class ReviewResolutionError(RuntimeError):
    pass


def resolve_review_item(
    connection: sqlite3.Connection,
    scoring: ScoringEngine,
    metadata: ArchiveMetadataWriter,
    command: ResolveReviewItemCommand,
    active_bundle_version: int | None,
    locks: ClipmOperationLocks | None = None,
) -> WorkScoreResult:
    review = _pending_review(connection, command)
    path = Path(str(review["path"])).resolve(strict=True)
    if locks is None:
        return _resolve_review_item_locked(
            connection,
            scoring,
            metadata,
            command,
            active_bundle_version,
            review,
            path,
        )
    work_id_hint = _resolution_work_id(connection, metadata, command, path)
    review_work_id = str(review["work_id"]) if review["work_id"] is not None else None
    new_work_id = (
        str(uuid4())
        if command.resolution is ReviewResolution.NEW_WORK
        and _persisted_candidate_work_id(review) is None
        else None
    )
    with locks.identity(path):
        path_work_id = _path_work_id(connection, path)
        locked_work_ids = {
            work_id
            for work_id in (work_id_hint, review_work_id, new_work_id, path_work_id)
            if work_id is not None
        }
        with locks.works(locked_work_ids):
            review = _pending_review(connection, command)
            path = Path(str(review["path"])).resolve(strict=True)
            current_target = _resolution_work_id(connection, metadata, command, path)
            current_path_work_id = _path_work_id(connection, path)
            current_review_work_id = str(review["work_id"]) if review["work_id"] is not None else None
            required_work_ids = {
                work_id
                for work_id in (
                    current_target,
                    current_review_work_id,
                    new_work_id,
                    current_path_work_id,
                )
                if work_id is not None
            }
            if not required_work_ids.issubset(locked_work_ids):
                raise ReviewResolutionError(
                    "ClipM review identity changed while waiting for its operation locks"
                )
            return _resolve_review_item_locked(
                connection,
                scoring,
                metadata,
                command,
                active_bundle_version,
                review,
                path,
                new_work_id=new_work_id,
            )


def _resolve_review_item_locked(
    connection: sqlite3.Connection,
    scoring: ScoringEngine,
    metadata: ArchiveMetadataWriter,
    command: ResolveReviewItemCommand,
    active_bundle_version: int | None,
    review: sqlite3.Row,
    path: Path,
    *,
    new_work_id: str | None = None,
) -> WorkScoreResult:
    persisted_candidate_work_id = _persisted_candidate_work_id(review)
    if command.resolution is ReviewResolution.LINK_EXISTING and persisted_candidate_work_id is not None:
        assert command.existing_work_id is not None
        work_id = str(command.existing_work_id)
        merge_work_into_existing(connection, persisted_candidate_work_id, work_id, path)
    elif command.resolution is ReviewResolution.NEW_WORK and persisted_candidate_work_id is not None:
        work_id = persisted_candidate_work_id
    elif command.resolution is ReviewResolution.USE_FILENAME:
        work_id = _resolve_from_filename(connection, path)
    elif command.resolution is ReviewResolution.USE_JSON:
        work_id = _resolve_from_json(connection, metadata, path)
    elif command.resolution is ReviewResolution.LINK_EXISTING:
        assert command.existing_work_id is not None
        work_id = _link_existing(connection, path, str(command.existing_work_id))
    elif command.resolution is ReviewResolution.NEW_WORK:
        scored = scoring.score_work(path)
        work_id = str(
            persist_scored_work(
                connection,
                scored,
                force_new=True,
                new_work_id=new_work_id,
            ).work_id
        )
    else:
        raise ReviewResolutionError(f"Unsupported ClipM review resolution: {command.resolution}")

    result = synchronize_work_artifacts(
        connection,
        metadata,
        work_id,
        path,
        ScoreOptions(),
        active_bundle_version,
    )
    _mark_resolved(connection, str(command.review_id), command.resolution, work_id)
    return result


def _pending_review(
    connection: sqlite3.Connection,
    command: ResolveReviewItemCommand,
) -> sqlite3.Row:
    review = connection.execute(
        "SELECT review_id, work_id, kind, path, status FROM review_queue WHERE review_id = ?",
        (str(command.review_id),),
    ).fetchone()
    if review is None:
        raise KeyError(f"Unknown ClipM review item: {command.review_id}")
    if str(review["status"]) != "pending":
        raise ReviewResolutionError(f"ClipM review item {command.review_id} is already resolved")
    return review


def _persisted_candidate_work_id(review: sqlite3.Row) -> str | None:
    if (
        str(review["kind"]) == ReviewKind.RECOVERY_CANDIDATE.value
        and review["work_id"] is not None
    ):
        return str(review["work_id"])
    return None


def _resolution_work_id(
    connection: sqlite3.Connection,
    metadata: ArchiveMetadataWriter,
    command: ResolveReviewItemCommand,
    path: Path,
) -> str | None:
    if command.resolution is ReviewResolution.LINK_EXISTING:
        assert command.existing_work_id is not None
        return str(command.existing_work_id)
    if command.resolution is ReviewResolution.USE_JSON:
        document = metadata.read(path)
        return str(document.work.work_id) if document is not None else None
    if command.resolution is not ReviewResolution.USE_FILENAME:
        return None
    tag = parse_cm_tag(path.name)
    record_number = (
        decode_canonical_short_code(tag.short_code)
        if tag is not None and tag.short_code is not None
        else None
    )
    if record_number is None:
        return None
    row = connection.execute(
        "SELECT work_id FROM works WHERE record_number = ?",
        (record_number,),
    ).fetchone()
    return str(row["work_id"]) if row is not None else None


def _path_work_id(connection: sqlite3.Connection, path: Path) -> str | None:
    row = connection.execute(
        "SELECT work_id FROM work_locations WHERE path_key = ? AND is_current = 1",
        (normalized_path_key(path),),
    ).fetchone()
    return str(row["work_id"]) if row is not None else None


def _resolve_from_filename(connection: sqlite3.Connection, path: Path) -> str:
    tag = parse_cm_tag(path.name)
    if tag is None or tag.short_code is None:
        raise ReviewResolutionError("use_filename requires a canonical ClipM filename with a short code")
    record_number = decode_canonical_short_code(tag.short_code)
    if record_number is None:
        raise ReviewResolutionError("use_filename requires a canonical ClipM short code")
    work = connection.execute(
        "SELECT work_id, short_code FROM works WHERE record_number = ?",
        (record_number,),
    ).fetchone()
    if work is None or str(work["short_code"]) != tag.short_code:
        raise ReviewResolutionError("use_filename cannot recover a short code that is absent from this database")
    work_id = str(work["work_id"])
    relocate_work(connection, work_id, path, allow_reassignment=True)
    apply_feedback(
        connection,
        ApplyFeedbackCommand(
            work_id=work_id,
            classification=tag.label,
            ranking=tag.score,
            source=FeedbackOrigin.FILENAME,
        ),
    )
    return work_id


def _resolve_from_json(
    connection: sqlite3.Connection,
    metadata: ArchiveMetadataWriter,
    path: Path,
) -> str:
    document = metadata.read(path)
    if document is None:
        raise ReviewResolutionError("use_json requires valid ClipM root metadata")
    work_id = str(document.work.work_id)
    identity_rows = connection.execute(
        "SELECT work_id, record_number, short_code FROM works WHERE work_id = ? OR record_number = ? OR short_code = ?",
        (work_id, document.work.record_number, document.work.short_code),
    ).fetchall()
    if not identity_rows:
        _detach_current_path(connection, path)
        return recover_work_from_document(connection, path, document)
    if len(identity_rows) != 1:
        raise ReviewResolutionError("use_json identity fields conflict with multiple database works")
    work = identity_rows[0]
    if (
        str(work["work_id"]) != work_id
        or int(work["record_number"]) != document.work.record_number
        or str(work["short_code"]) != document.work.short_code
    ):
        raise ReviewResolutionError("use_json requires UUID, record number, and short code to match one database work")
    relocate_work(connection, work_id, path, allow_reassignment=True)
    return work_id


def _link_existing(connection: sqlite3.Connection, path: Path, work_id: str) -> str:
    if connection.execute("SELECT 1 FROM works WHERE work_id = ?", (work_id,)).fetchone() is None:
        raise ReviewResolutionError(f"Unknown ClipM target work: {work_id}")
    relocate_work(connection, work_id, path, allow_reassignment=True)
    return work_id


def _detach_current_path(connection: sqlite3.Connection, path: Path) -> None:
    now = datetime.now(timezone.utc).isoformat()
    path_key = normalized_path_key(path)
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute(
            "UPDATE work_locations SET is_current = 0, removed_at = ? WHERE path_key = ? AND is_current = 1",
            (now, path_key),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _mark_resolved(
    connection: sqlite3.Connection,
    review_id: str,
    resolution: ReviewResolution,
    work_id: str,
) -> None:
    resolved_at = datetime.now(timezone.utc).isoformat()
    connection.execute("BEGIN IMMEDIATE")
    try:
        cursor = connection.execute(
            """UPDATE review_queue SET status = 'resolved', resolution = ?, work_id = ?, resolved_at = ?
               WHERE review_id = ? AND status = 'pending'""",
            (resolution.value, work_id, resolved_at, review_id),
        )
        if cursor.rowcount != 1:
            raise ReviewResolutionError(f"ClipM review item {review_id} is no longer pending")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
