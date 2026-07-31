from __future__ import annotations

import base64
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import pytest

from xiranite_clipm.contracts import (
    ArchiveFormat,
    ArchiveSnapshot,
    ClassificationSnapshot,
    CmLabel,
    CmScoreDocument,
    EmbeddingPayload,
    FeedbackHistoryEntry,
    FeedbackOrigin,
    MetadataWriteStatus,
    NameHistoryEntry,
    RankingSnapshot,
    ScoreSnapshot,
    ValueSource,
    WorkIdentity,
)
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.metadata_repository import (
    IdentityConflictError,
    build_score_document,
    recover_work_from_document,
)
from xiranite_clipm.short_codes import encode_record_number


WORK_ID = UUID("018f0000-0000-7000-8000-000000000001")
UNDO_EVENT = UUID("018f0000-0000-7000-8000-000000000011")
RESTORE_EVENT = UUID("018f0000-0000-7000-8000-000000000012")


def portable_document(record_number: int = 42) -> CmScoreDocument:
    return CmScoreDocument(
        schema_version=1,
        work=WorkIdentity(
            work_id=WORK_ID,
            record_number=record_number,
            short_code=encode_record_number(record_number),
            first_seen_name="original.zip",
            current_base_name="renamed.zip",
            name_revision=1,
        ),
        score=ScoreSnapshot(
            bundle_version=1,
            classification=ClassificationSnapshot(
                predicted=CmLabel.POSITIVE,
                current=CmLabel.POSITIVE,
                source=ValueSource.MODEL,
            ),
            ranking=RankingSnapshot(predicted=873, current=873, source=ValueSource.GUI),
            probability=0.873,
            scored_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        ),
        embedding=EmbeddingPayload(
            encoder="google/siglip2-base-patch16-224",
            preprocess="white-letterbox-224/four-of-twelve/color-mono-v1",
            dtype="float16",
            shape=[768],
            encoding="base64",
            data=base64.b64encode(bytes(1536)).decode("ascii"),
        ),
        archive=ArchiveSnapshot(format=ArchiveFormat.ZIP, metadata_write_status=MetadataWriteStatus.WRITTEN),
        name_history=[
            NameHistoryEntry(
                revision=1,
                previous_name="original.zip",
                current_name="renamed.zip",
                changed_at=datetime(2026, 7, 31, tzinfo=timezone.utc),
                source=ValueSource.GUI,
            )
        ],
        feedback_history=[
            FeedbackHistoryEntry(
                event_id=UNDO_EVENT,
                occurred_at=datetime(2026, 7, 31, 12, tzinfo=timezone.utc),
                source=FeedbackOrigin.GUI,
                ranking_before=873,
                ranking_after=700,
                undone_by=RESTORE_EVENT,
            ),
            FeedbackHistoryEntry(
                event_id=RESTORE_EVENT,
                occurred_at=datetime(2026, 7, 31, 13, tzinfo=timezone.utc),
                source=FeedbackOrigin.GUI,
                ranking_before=700,
                ranking_after=873,
            ),
        ],
    )


def test_recovers_complete_json_and_projects_it_back_from_sqlite(tmp_path: Path) -> None:
    path = tmp_path / f"moved [CM1P0873-{encode_record_number(42)}].zip"
    path.write_bytes(b"archive placeholder")
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    try:
        assert recover_work_from_document(connection, path, portable_document()) == str(WORK_ID)
        projected = build_score_document(
            connection,
            WORK_ID,
            ArchiveSnapshot(format=ArchiveFormat.ZIP, metadata_write_status=MetadataWriteStatus.WRITTEN),
        )
        assert projected.work.current_base_name == "moved.zip"
        assert projected.work.name_revision == 2
        assert [entry.current_name for entry in projected.name_history] == ["renamed.zip", "moved.zip"]
        assert projected.score.ranking.current == 873
        assert projected.score.ranking.source is ValueSource.GUI
        assert projected.embedding.data == portable_document().embedding.data
        assert projected.feedback_history[0].undone_by == RESTORE_EVENT
        assert connection.execute("SELECT count(*) FROM works").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM data_revisions").fetchone()[0] == 1
    finally:
        connection.close()


def test_recovery_rejects_any_existing_identity_or_path_without_merging(tmp_path: Path) -> None:
    path = tmp_path / "book.zip"
    path.write_bytes(b"archive placeholder")
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    try:
        recover_work_from_document(connection, path, portable_document())
        with pytest.raises(IdentityConflictError, match="already present"):
            recover_work_from_document(connection, path, portable_document())
        assert connection.execute("SELECT count(*) FROM works").fetchone()[0] == 1
    finally:
        connection.close()


def test_recovery_rejects_noncanonical_record_and_short_code_pair(tmp_path: Path) -> None:
    path = tmp_path / "book.zip"
    path.write_bytes(b"archive placeholder")
    invalid = portable_document().model_copy(deep=True)
    invalid.work.record_number = 43
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    try:
        with pytest.raises(IdentityConflictError, match="canonical pair"):
            recover_work_from_document(connection, path, invalid)
        assert connection.execute("SELECT count(*) FROM works").fetchone()[0] == 0
    finally:
        connection.close()
