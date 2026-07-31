from __future__ import annotations

import base64
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from xiranite_clipm.archive_metadata import ArchiveMetadataWriter, CM_METADATA_NAME
from xiranite_clipm.contracts import (
    ArchiveFormat,
    ArchiveSnapshot,
    ClassificationSnapshot,
    CmLabel,
    CmScoreDocument,
    EmbeddingPayload,
    MetadataWriteStatus,
    RankingSnapshot,
    ReviewKind,
    ScoreSnapshot,
    ValueSource,
    WorkIdentity,
)
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.identity_reconciliation import (
    IdentityAction,
    list_review_items,
    reconcile_work_identity,
)
from xiranite_clipm.metadata_repository import recover_work_from_document
from xiranite_clipm.short_codes import encode_record_number


WORK_ID = UUID("018f0000-0000-7000-8000-000000000021")


def document(record_number: int = 21) -> CmScoreDocument:
    short_code = encode_record_number(record_number)
    return CmScoreDocument(
        schema_version=1,
        work=WorkIdentity(
            work_id=WORK_ID,
            record_number=record_number,
            short_code=short_code,
            first_seen_name="book",
            current_base_name="book",
            name_revision=0,
        ),
        score=ScoreSnapshot(
            bundle_version=1,
            classification=ClassificationSnapshot(
                predicted=CmLabel.POSITIVE,
                current=CmLabel.POSITIVE,
                source=ValueSource.MODEL,
            ),
            ranking=RankingSnapshot(predicted=873, current=873, source=ValueSource.MODEL),
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
        archive=ArchiveSnapshot(format=ArchiveFormat.DIRECTORY, metadata_write_status=MetadataWriteStatus.WRITTEN),
    )


def test_new_work_and_complete_json_recovery_are_distinct(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    plain = tmp_path / "plain"
    plain.mkdir()
    portable = tmp_path / f"book [CM1P0873-{encode_record_number(21)}]"
    portable.mkdir()
    ArchiveMetadataWriter().write(portable, document())
    try:
        assert reconcile_work_identity(connection, plain).action is IdentityAction.NEW_WORK
        recovered = reconcile_work_identity(connection, portable)
        assert recovered.action is IdentityAction.RECOVER_DATABASE
        assert recovered.work_id == str(WORK_ID)
        assert recovered.document == document()
    finally:
        connection.close()


def test_orphan_short_code_and_invalid_suffix_are_deduplicated_reviews(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    orphan = tmp_path / f"orphan [CM1P0873-{encode_record_number(999)}]"
    orphan.mkdir()
    invalid = tmp_path / "broken [CM1P9999-OILU]"
    invalid.mkdir()
    try:
        first = reconcile_work_identity(connection, orphan)
        second = reconcile_work_identity(connection, orphan)
        bad = reconcile_work_identity(connection, invalid)
        assert first.action is IdentityAction.REVIEW
        assert first.review is not None and first.review.kind is ReviewKind.RECOVERY_CANDIDATE
        assert second.review is not None and second.review.review_id == first.review.review_id
        assert bad.review is not None and bad.review.kind is ReviewKind.INVALID_SUFFIX
        assert len(list_review_items(connection)) == 2
    finally:
        connection.close()


def test_existing_identity_rebuilds_missing_json_and_detects_filename_feedback(tmp_path: Path) -> None:
    short_code = encode_record_number(21)
    original = tmp_path / f"book [CM1P0873-{short_code}]"
    original.mkdir()
    metadata = document()
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    try:
        recover_work_from_document(connection, original, metadata)
        same = reconcile_work_identity(connection, original)
        assert same.action is IdentityAction.REBUILD_METADATA
        assert same.work_id == str(WORK_ID)
        assert same.filename_changed is False

        corrected = tmp_path / f"renamed [CM1N0342-{short_code}]"
        corrected.mkdir()
        correction = reconcile_work_identity(connection, corrected)
        assert correction.action is IdentityAction.REBUILD_METADATA
        assert correction.work_id == str(WORK_ID)
        assert correction.filename_changed is True
    finally:
        connection.close()


def test_filename_and_json_identity_conflict_never_auto_merges(tmp_path: Path) -> None:
    first = document()
    original = tmp_path / f"book [CM1P0873-{first.work.short_code}]"
    original.mkdir()
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    try:
        recover_work_from_document(connection, original, first)
        conflicting = tmp_path / f"conflict [CM1P0873-{encode_record_number(22)}]"
        conflicting.mkdir()
        ArchiveMetadataWriter().write(conflicting, first)
        result = reconcile_work_identity(connection, conflicting)
        assert result.action is IdentityAction.REVIEW
        assert result.review is not None and result.review.kind is ReviewKind.SHORT_CODE_CONFLICT
        assert (conflicting / CM_METADATA_NAME).is_file()
        assert connection.execute("SELECT count(*) FROM works").fetchone()[0] == 1
    finally:
        connection.close()
