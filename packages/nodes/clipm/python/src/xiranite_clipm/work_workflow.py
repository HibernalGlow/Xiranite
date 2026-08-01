from __future__ import annotations

from pathlib import Path
import sqlite3
from uuid import uuid4

from .archive_metadata import ArchiveMetadataWriter
from .contracts import (
    ApplyFeedbackCommand,
    ArchiveSnapshot,
    FeedbackOrigin,
    MetadataWriteStatus,
    ScoreOptions,
    ValueSource,
    WorkScoreResult,
)
from .feedback_repository import apply_feedback
from .filename import CmFilenameTag, scored_path
from .identity_reconciliation import IdentityAction, IdentityReconciliation, reconcile_work_identity
from .metadata_repository import build_score_document, recover_work_from_document
from .score_repository import load_work_score_result, persist_scored_work, relocate_work
from .scoring import ClipmScoringEngine
from .short_codes import encode_record_number


class WorkNeedsReviewError(RuntimeError):
    def __init__(self, reconciliation: IdentityReconciliation):
        self.reconciliation = reconciliation
        review_id = reconciliation.review.review_id if reconciliation.review else "unknown"
        super().__init__(f"ClipM work requires explicit review: {review_id}")


def process_score_work(
    connection: sqlite3.Connection,
    scoring: ClipmScoringEngine,
    metadata: ArchiveMetadataWriter,
    path: Path,
    options: ScoreOptions,
    active_bundle_version: int | None,
) -> WorkScoreResult:
    reconciliation = reconcile_work_identity(connection, path, metadata)
    if reconciliation.action is IdentityAction.REVIEW:
        raise WorkNeedsReviewError(reconciliation)
    if options.dry_run:
        return _preview_score_work(
            connection,
            scoring,
            reconciliation,
            options,
            active_bundle_version,
        )
    work_id = reconciliation.work_id
    if reconciliation.action is IdentityAction.RECOVER_DATABASE:
        assert reconciliation.document is not None
        work_id = recover_work_from_document(connection, reconciliation.path, reconciliation.document)
    elif work_id is not None:
        relocate_work(connection, work_id, reconciliation.path)
    if work_id is not None and reconciliation.filename_changed and reconciliation.filename_tag is not None:
        apply_feedback(
            connection,
            ApplyFeedbackCommand(
                work_id=work_id,
                classification=reconciliation.filename_tag.label,
                ranking=reconciliation.filename_tag.score,
                source=FeedbackOrigin.FILENAME,
            ),
        )

    should_score = reconciliation.action is IdentityAction.NEW_WORK or options.rescore
    if should_score:
        scored = scoring.score_work(reconciliation.path)
        persisted = persist_scored_work(connection, scored, work_id_hint=work_id)
        work_id = str(persisted.work_id)
    if work_id is None:
        raise RuntimeError("ClipM identity reconciliation produced no work identity")
    return synchronize_work_artifacts(
        connection,
        metadata,
        work_id,
        reconciliation.path,
        options,
        active_bundle_version,
    )


def synchronize_work_artifacts(
    connection: sqlite3.Connection,
    metadata: ArchiveMetadataWriter,
    work_id: str,
    path: Path,
    options: ScoreOptions,
    active_bundle_version: int | None,
) -> WorkScoreResult:
    result = load_work_score_result(connection, work_id, path, active_bundle_version)
    target = path
    if options.rename:
        target = Path(
            scored_path(
                str(path),
                CmFilenameTag(result.bundle_version, result.label, result.score, result.short_code),
            )
        )
        if target != path and target.exists():
            raise FileExistsError(f"ClipM scored target already exists: {target}")

    write_status = MetadataWriteStatus.SKIPPED
    if options.write_metadata:
        archive_format, capability = metadata.capability(path)
        write_status = capability
        document = build_score_document(
            connection,
            work_id,
            ArchiveSnapshot(format=archive_format, metadata_write_status=write_status),
        )
        if write_status is MetadataWriteStatus.WRITTEN:
            metadata.write(path, document)

    final_path = path
    renamed = False
    if target != path:
        path.rename(target)
        final_path = target.resolve(strict=True)
        relocate_work(connection, work_id, final_path)
        renamed = True
    return result.model_copy(
        update={
            "path": str(final_path),
            "metadata_write_status": write_status,
            "renamed": renamed,
        }
    )


def _preview_score_work(
    connection: sqlite3.Connection,
    scoring: ClipmScoringEngine,
    reconciliation: IdentityReconciliation,
    options: ScoreOptions,
    active_bundle_version: int | None,
) -> WorkScoreResult:
    if reconciliation.action is IdentityAction.NEW_WORK:
        record_number = int(connection.execute("SELECT COALESCE(MAX(record_number), 0) + 1 FROM works").fetchone()[0])
        work_id = str(uuid4())
        short_code = encode_record_number(record_number)
        cached = None
    elif reconciliation.action is IdentityAction.RECOVER_DATABASE:
        assert reconciliation.document is not None
        document = reconciliation.document
        work_id = str(document.work.work_id)
        short_code = document.work.short_code
        cached = WorkScoreResult(
            work_id=work_id,
            path=str(reconciliation.path),
            label=document.score.classification.current,
            score=document.score.ranking.current,
            predicted_label=document.score.classification.predicted,
            predicted_score=document.score.ranking.predicted,
            classification_corrected=document.score.classification.source is not ValueSource.MODEL,
            ranking_corrected=document.score.ranking.source is not ValueSource.MODEL,
            probability=document.score.probability,
            bundle_version=document.score.bundle_version,
            short_code=short_code,
            stale=active_bundle_version is not None and document.score.bundle_version != active_bundle_version,
        )
    else:
        assert reconciliation.work_id is not None
        work_id = reconciliation.work_id
        cached = load_work_score_result(connection, work_id, reconciliation.path, active_bundle_version)
        short_code = cached.short_code

    if options.rescore or cached is None:
        scored = scoring.score_work(reconciliation.path)
        result = WorkScoreResult(
            work_id=work_id,
            path=str(reconciliation.path),
            label=scored.label,
            score=scored.score,
            predicted_label=scored.label,
            predicted_score=scored.score,
            probability=scored.probability,
            bundle_version=scored.bundle_version,
            short_code=short_code,
            sampled_pages=scored.sampled_pages,
            candidate_page_count=scored.candidate_page_count,
            page_count=scored.page_count,
            stale=False,
        )
    else:
        result = cached
    if reconciliation.filename_changed and reconciliation.filename_tag is not None and not options.rescore:
        result = result.model_copy(
            update={"label": reconciliation.filename_tag.label, "score": reconciliation.filename_tag.score}
        )
    if options.rename:
        proposed_path = scored_path(
            str(reconciliation.path),
            CmFilenameTag(result.bundle_version, result.label, result.score, result.short_code),
        )
        result = result.model_copy(update={"path": proposed_path})
    return result
