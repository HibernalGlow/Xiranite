from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from .archive_metadata import ArchiveMetadataError, ArchiveMetadataWriter
from .contracts import CmScoreDocument, ReviewItem, ReviewKind, ReviewStatus
from .filename import CmFilenameTag, has_cm_like_suffix, parse_cm_tag
from .metadata_repository import normalized_path_key
from .short_codes import decode_canonical_short_code, encode_record_number


class IdentityAction(StrEnum):
    NEW_WORK = "new_work"
    USE_EXISTING = "use_existing"
    REBUILD_METADATA = "rebuild_metadata"
    RECOVER_DATABASE = "recover_database"
    REVIEW = "review"


@dataclass(frozen=True, slots=True)
class IdentityReconciliation:
    action: IdentityAction
    path: Path
    work_id: str | None = None
    document: CmScoreDocument | None = None
    filename_tag: CmFilenameTag | None = None
    filename_changed: bool = False
    review: ReviewItem | None = None


def reconcile_work_identity(
    connection: sqlite3.Connection,
    path: Path,
    metadata: ArchiveMetadataWriter | None = None,
) -> IdentityReconciliation:
    resolved = path.resolve(strict=True)
    reader = metadata or ArchiveMetadataWriter()
    try:
        document = reader.read(resolved)
    except ArchiveMetadataError as error:
        review = enqueue_review(
            connection,
            ReviewKind.IDENTITY_CONFLICT,
            resolved,
            {"reason": "invalid_metadata", "error": str(error)},
        )
        return IdentityReconciliation(IdentityAction.REVIEW, resolved, review=review)

    filename_tag = parse_cm_tag(resolved.name)
    if filename_tag is None and has_cm_like_suffix(resolved.name):
        review = enqueue_review(
            connection,
            ReviewKind.INVALID_SUFFIX,
            resolved,
            {"reason": "invalid_cm_suffix", "name": resolved.name},
        )
        return IdentityReconciliation(IdentityAction.REVIEW, resolved, document=document, review=review)

    path_row = connection.execute(
        """SELECT works.* FROM work_locations
           JOIN works ON works.work_id = work_locations.work_id
           WHERE work_locations.path_key = ? AND work_locations.is_current = 1""",
        (normalized_path_key(resolved),),
    ).fetchone()
    suffix_row = None
    if filename_tag is not None and filename_tag.short_code is not None:
        record_number = decode_canonical_short_code(filename_tag.short_code)
        if record_number is None:
            review = enqueue_review(
                connection,
                ReviewKind.INVALID_SUFFIX,
                resolved,
                {"reason": "noncanonical_short_code", "shortCode": filename_tag.short_code},
            )
            return IdentityReconciliation(
                IdentityAction.REVIEW,
                resolved,
                document=document,
                filename_tag=filename_tag,
                review=review,
            )
        suffix_row = connection.execute("SELECT * FROM works WHERE record_number = ?", (record_number,)).fetchone()

    document_rows: list[sqlite3.Row] = []
    if document is not None:
        if not _document_identity_is_canonical(document):
            review = enqueue_review(
                connection,
                ReviewKind.SHORT_CODE_CONFLICT,
                resolved,
                {"reason": "json_record_short_code_mismatch", "work": document.work.model_dump(mode="json", by_alias=True)},
            )
            return IdentityReconciliation(
                IdentityAction.REVIEW,
                resolved,
                document=document,
                filename_tag=filename_tag,
                review=review,
            )
        document_rows = connection.execute(
            """SELECT * FROM works WHERE work_id = ? OR record_number = ? OR short_code = ?""",
            (str(document.work.work_id), document.work.record_number, document.work.short_code),
        ).fetchall()
        document_work_ids = {str(row["work_id"]) for row in document_rows}
        if len(document_work_ids) > 1:
            return _identity_conflict(connection, resolved, document, filename_tag, "json_fields_resolve_to_multiple_works")

    evidence_rows = [row for row in (path_row, suffix_row, *document_rows) if row is not None]
    evidence_work_ids = {str(row["work_id"]) for row in evidence_rows}
    if len(evidence_work_ids) > 1:
        return _identity_conflict(connection, resolved, document, filename_tag, "identity_evidence_disagrees")

    if evidence_rows:
        work = evidence_rows[0]
        if document is not None and not _document_matches_row(document, work):
            return _identity_conflict(connection, resolved, document, filename_tag, "json_identity_disagrees_with_database")
        if filename_tag is not None and filename_tag.short_code is not None:
            if filename_tag.short_code != str(work["short_code"]):
                return _short_code_conflict(connection, resolved, document, filename_tag, work)
        filename_changed = bool(
            filename_tag is not None
            and (filename_tag.label.value != work["current_label"] or filename_tag.score != work["current_score"])
        )
        action = IdentityAction.REBUILD_METADATA if document is None else IdentityAction.USE_EXISTING
        return IdentityReconciliation(
            action,
            resolved,
            work_id=str(work["work_id"]),
            document=document,
            filename_tag=filename_tag,
            filename_changed=filename_changed,
        )

    if document is not None:
        if filename_tag is not None and filename_tag.short_code not in {None, document.work.short_code}:
            return _identity_conflict(connection, resolved, document, filename_tag, "filename_and_json_short_codes_disagree")
        return IdentityReconciliation(
            IdentityAction.RECOVER_DATABASE,
            resolved,
            work_id=str(document.work.work_id),
            document=document,
            filename_tag=filename_tag,
            filename_changed=bool(
                filename_tag is not None
                and (
                    filename_tag.label != document.score.classification.current
                    or filename_tag.score != document.score.ranking.current
                )
            ),
        )

    if filename_tag is not None:
        review = enqueue_review(
            connection,
            ReviewKind.RECOVERY_CANDIDATE,
            resolved,
            {"reason": "short_code_has_no_database_or_json", "shortCode": filename_tag.short_code},
        )
        return IdentityReconciliation(
            IdentityAction.REVIEW,
            resolved,
            filename_tag=filename_tag,
            review=review,
        )
    return IdentityReconciliation(IdentityAction.NEW_WORK, resolved)


def enqueue_review(
    connection: sqlite3.Connection,
    kind: ReviewKind,
    path: Path,
    details: dict[str, object],
    work_id: str | None = None,
) -> ReviewItem:
    path_text = str(path.resolve())
    payload_json = json.dumps(details, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    review_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute(
            """INSERT INTO review_queue(review_id, work_id, kind, path, payload_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(kind, path, payload_json) WHERE status = 'pending' DO NOTHING""",
            (review_id, work_id, kind.value, path_text, payload_json, created_at),
        )
        row = connection.execute(
            """SELECT review_id, work_id, kind, path, payload_json, status, created_at, resolution, resolved_at
               FROM review_queue
               WHERE kind = ? AND path = ? AND payload_json = ? AND status = 'pending'""",
            (kind.value, path_text, payload_json),
        ).fetchone()
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    assert row is not None
    return _review_item(row)


def list_review_items(connection: sqlite3.Connection, status: ReviewStatus = ReviewStatus.PENDING, limit: int = 100) -> list[ReviewItem]:
    if not 1 <= limit <= 1000:
        raise ValueError("review item limit must be between 1 and 1000")
    rows = connection.execute(
        """SELECT review_id, work_id, kind, path, payload_json, status, created_at, resolution, resolved_at
           FROM review_queue WHERE status = ? ORDER BY created_at, review_id LIMIT ?""",
        (status.value, limit),
    ).fetchall()
    return [_review_item(row) for row in rows]


def _identity_conflict(
    connection: sqlite3.Connection,
    path: Path,
    document: CmScoreDocument | None,
    filename_tag: CmFilenameTag | None,
    reason: str,
) -> IdentityReconciliation:
    review = enqueue_review(
        connection,
        ReviewKind.IDENTITY_CONFLICT,
        path,
        _evidence_payload(reason, document, filename_tag),
    )
    return IdentityReconciliation(
        IdentityAction.REVIEW,
        path,
        document=document,
        filename_tag=filename_tag,
        review=review,
    )


def _short_code_conflict(
    connection: sqlite3.Connection,
    path: Path,
    document: CmScoreDocument | None,
    filename_tag: CmFilenameTag,
    work: sqlite3.Row,
) -> IdentityReconciliation:
    payload = _evidence_payload("filename_short_code_disagrees_with_database", document, filename_tag)
    payload["databaseShortCode"] = str(work["short_code"])
    review = enqueue_review(connection, ReviewKind.SHORT_CODE_CONFLICT, path, payload, str(work["work_id"]))
    return IdentityReconciliation(
        IdentityAction.REVIEW,
        path,
        work_id=str(work["work_id"]),
        document=document,
        filename_tag=filename_tag,
        review=review,
    )


def _evidence_payload(
    reason: str,
    document: CmScoreDocument | None,
    filename_tag: CmFilenameTag | None,
) -> dict[str, object]:
    return {
        "reason": reason,
        "jsonWork": document.work.model_dump(mode="json", by_alias=True) if document else None,
        "filenameTag": {
            "bundleVersion": filename_tag.version,
            "label": filename_tag.label.value,
            "score": filename_tag.score,
            "shortCode": filename_tag.short_code,
        }
        if filename_tag
        else None,
    }


def _document_identity_is_canonical(document: CmScoreDocument) -> bool:
    return (
        decode_canonical_short_code(document.work.short_code) == document.work.record_number
        and encode_record_number(document.work.record_number) == document.work.short_code
    )


def _document_matches_row(document: CmScoreDocument, row: sqlite3.Row) -> bool:
    return (
        str(document.work.work_id) == str(row["work_id"])
        and document.work.record_number == int(row["record_number"])
        and document.work.short_code == str(row["short_code"])
    )


def _review_item(row: sqlite3.Row) -> ReviewItem:
    return ReviewItem(
        review_id=str(row["review_id"]),
        kind=ReviewKind(str(row["kind"])),
        status=ReviewStatus(str(row["status"])),
        work_id=str(row["work_id"]) if row["work_id"] is not None else None,
        path=str(row["path"]),
        details=json.loads(str(row["payload_json"])),
        created_at=str(row["created_at"]),
        resolution=str(row["resolution"]) if row["resolution"] is not None else None,
        resolved_at=str(row["resolved_at"]) if row["resolved_at"] is not None else None,
    )
