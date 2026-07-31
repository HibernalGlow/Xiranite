from __future__ import annotations

import base64
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import numpy as np
import pytest

from xiranite_clipm.archive_metadata import ArchiveMetadataWriter
from xiranite_clipm.contracts import (
    ArchiveFormat,
    ArchiveSnapshot,
    ClassificationSnapshot,
    CmLabel,
    CmScoreDocument,
    DevicePreference,
    EmbeddingPayload,
    MetadataWriteStatus,
    ModelResidency,
    RankingSnapshot,
    ResolveReviewItemCommand,
    ReviewResolution,
    ScoreSnapshot,
    ValueSource,
    WorkIdentity,
)
from xiranite_clipm.metadata_repository import recover_work_from_document
from xiranite_clipm.review_resolution import ReviewResolutionError
from xiranite_clipm.scoring import ScoredWork
from xiranite_clipm.service import ClipmService
from xiranite_clipm.settings import ClipmSettings
from xiranite_clipm.short_codes import encode_record_number
from xiranite_clipm.work_workflow import WorkNeedsReviewError


WORK_ID_21 = UUID("018f0000-0000-7000-8000-000000000021")
WORK_ID_22 = UUID("018f0000-0000-7000-8000-000000000022")


class FakeScoring:
    def __init__(self, label: CmLabel = CmLabel.NEGATIVE, score: int = 125):
        self.label = label
        self.score = score
        self.calls = 0

    def score_work(self, path: Path) -> ScoredWork:
        self.calls += 1
        return ScoredWork(
            path=path,
            label=self.label,
            score=self.score,
            probability=self.score / 1000,
            bundle_version=1,
            embedding=np.zeros(768, dtype=np.float32),
            sampled_pages=["01.png"],
            candidate_page_count=1,
            page_count=1,
        )

    def unload(self) -> None:
        pass


def score_document(record_number: int, work_id: UUID) -> CmScoreDocument:
    return CmScoreDocument(
        schema_version=1,
        work=WorkIdentity(
            work_id=work_id,
            record_number=record_number,
            short_code=encode_record_number(record_number),
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
        archive=ArchiveSnapshot(
            format=ArchiveFormat.DIRECTORY,
            metadata_write_status=MetadataWriteStatus.WRITTEN,
        ),
    )


def create_service(tmp_path: Path, scoring: FakeScoring | None = None) -> ClipmService:
    runtime_root = tmp_path / "runtime"
    return ClipmService(
        ClipmSettings(
            runtime_root=runtime_root,
            device=DevicePreference.CPU,
            model_residency=ModelResidency.IMMEDIATE,
            huggingface_cache=runtime_root / "huggingface-cache",
        ),
        scoring=scoring or FakeScoring(),  # type: ignore[arg-type]
    )


def seed_work(service: ClipmService, path: Path, document: CmScoreDocument) -> None:
    service.start()
    assert service._database is not None
    recover_work_from_document(service._database, path, document)


def pending_review_id(service: ClipmService, path: Path) -> UUID:
    with pytest.raises(WorkNeedsReviewError) as caught:
        service.score_work(str(path))
    assert caught.value.reconciliation.review is not None
    return caught.value.reconciliation.review.review_id


def assert_review_resolved(service: ClipmService, review_id: UUID, resolution: ReviewResolution) -> None:
    assert service._database is not None
    row = service._database.execute(
        "SELECT status, resolution, resolved_at FROM review_queue WHERE review_id = ?",
        (str(review_id),),
    ).fetchone()
    assert tuple(row)[:2] == ("resolved", resolution.value)
    assert row["resolved_at"] is not None


def test_use_filename_links_short_code_and_imports_feedback(tmp_path: Path) -> None:
    service = create_service(tmp_path)
    original = tmp_path / "original"
    original.mkdir()
    seed_work(service, original, score_document(21, WORK_ID_21))
    conflict = tmp_path / f"filename-wins [CM1N0342-{encode_record_number(21)}]"
    conflict.mkdir()
    ArchiveMetadataWriter().write(conflict, score_document(22, WORK_ID_22))
    try:
        review_id = pending_review_id(service, conflict)
        result = service.resolve_review_item(
            ResolveReviewItemCommand(review_id=review_id, resolution=ReviewResolution.USE_FILENAME)
        )
        assert result.work_id == WORK_ID_21
        assert result.label is CmLabel.NEGATIVE
        assert result.score == 342
        assert result.renamed is False
        rewritten = ArchiveMetadataWriter().read(Path(result.path))
        assert rewritten is not None and rewritten.work.work_id == WORK_ID_21
        assert rewritten.score.ranking.current == 342
        assert service._database is not None
        assert service._database.execute("SELECT count(*) FROM feedback_events").fetchone()[0] == 1
        assert_review_resolved(service, review_id, ReviewResolution.USE_FILENAME)
    finally:
        service.close()


def test_use_json_ignores_conflicting_filename_identity(tmp_path: Path) -> None:
    service = create_service(tmp_path)
    original = tmp_path / "original"
    original.mkdir()
    document = score_document(21, WORK_ID_21)
    seed_work(service, original, document)
    conflict = tmp_path / f"json-wins [CM1N0342-{encode_record_number(22)}]"
    conflict.mkdir()
    ArchiveMetadataWriter().write(conflict, document)
    try:
        review_id = pending_review_id(service, conflict)
        result = service.resolve_review_item(
            ResolveReviewItemCommand(review_id=review_id, resolution=ReviewResolution.USE_JSON)
        )
        assert result.work_id == WORK_ID_21
        assert result.label is CmLabel.POSITIVE
        assert result.score == 873
        assert result.renamed is True
        assert encode_record_number(21) in Path(result.path).name
        assert not conflict.exists()
        assert_review_resolved(service, review_id, ReviewResolution.USE_JSON)
    finally:
        service.close()


def test_use_json_recovers_identity_missing_from_database(tmp_path: Path) -> None:
    service = create_service(tmp_path)
    portable = tmp_path / "portable [CM1P9999-OILU]"
    portable.mkdir()
    ArchiveMetadataWriter().write(portable, score_document(21, WORK_ID_21))
    try:
        review_id = pending_review_id(service, portable)
        result = service.resolve_review_item(
            ResolveReviewItemCommand(review_id=review_id, resolution=ReviewResolution.USE_JSON)
        )
        assert result.work_id == WORK_ID_21
        assert result.renamed is True
        assert service._database is not None
        assert service._database.execute("SELECT count(*) FROM works").fetchone()[0] == 1
        assert_review_resolved(service, review_id, ReviewResolution.USE_JSON)
    finally:
        service.close()


def test_link_existing_replaces_invalid_suffix_and_metadata(tmp_path: Path) -> None:
    service = create_service(tmp_path)
    original = tmp_path / "original"
    original.mkdir()
    seed_work(service, original, score_document(21, WORK_ID_21))
    conflict = tmp_path / "linked [CM1P9999-OILU]"
    conflict.mkdir()
    try:
        review_id = pending_review_id(service, conflict)
        result = service.resolve_review_item(
            ResolveReviewItemCommand(
                review_id=review_id,
                resolution=ReviewResolution.LINK_EXISTING,
                existing_work_id=WORK_ID_21,
            )
        )
        assert result.work_id == WORK_ID_21
        assert result.renamed is True
        assert "OILU" not in Path(result.path).name
        rewritten = ArchiveMetadataWriter().read(Path(result.path))
        assert rewritten is not None and rewritten.work.work_id == WORK_ID_21
        assert_review_resolved(service, review_id, ReviewResolution.LINK_EXISTING)
    finally:
        service.close()


def test_new_work_replaces_conflicting_identity_with_fresh_score(tmp_path: Path) -> None:
    scoring = FakeScoring(CmLabel.NEGATIVE, 125)
    service = create_service(tmp_path, scoring)
    document = score_document(21, WORK_ID_21)
    conflict = tmp_path / "fresh [CM1P9999-OILU]"
    conflict.mkdir()
    ArchiveMetadataWriter().write(conflict, document)
    seed_work(service, conflict, document)
    try:
        review_id = pending_review_id(service, conflict)
        result = service.resolve_review_item(
            ResolveReviewItemCommand(review_id=review_id, resolution=ReviewResolution.NEW_WORK)
        )
        assert scoring.calls == 1
        assert result.work_id != WORK_ID_21
        assert result.label is CmLabel.NEGATIVE
        assert result.score == 125
        assert "OILU" not in Path(result.path).name
        rewritten = ArchiveMetadataWriter().read(Path(result.path))
        assert rewritten is not None and rewritten.work.work_id == result.work_id
        assert service._database is not None
        assert service._database.execute("SELECT count(*) FROM works").fetchone()[0] == 2
        assert service._database.execute(
            "SELECT count(*) FROM work_locations WHERE work_id = ? AND is_current = 1",
            (str(WORK_ID_21),),
        ).fetchone()[0] == 0
        assert_review_resolved(service, review_id, ReviewResolution.NEW_WORK)
    finally:
        service.close()


def test_failed_resolution_leaves_review_pending_and_files_unchanged(tmp_path: Path) -> None:
    service = create_service(tmp_path)
    conflict = tmp_path / "broken [CM1P9999-OILU]"
    conflict.mkdir()
    try:
        review_id = pending_review_id(service, conflict)
        with pytest.raises(ReviewResolutionError, match="canonical ClipM filename"):
            service.resolve_review_item(
                ResolveReviewItemCommand(review_id=review_id, resolution=ReviewResolution.USE_FILENAME)
            )
        assert conflict.is_dir()
        assert service._database is not None
        row = service._database.execute(
            "SELECT status, resolution FROM review_queue WHERE review_id = ?",
            (str(review_id),),
        ).fetchone()
        assert tuple(row) == ("pending", None)
    finally:
        service.close()
