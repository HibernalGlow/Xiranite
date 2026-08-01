from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from xiranite_clipm.archive_metadata import ArchiveMetadataWriter
from xiranite_clipm.contracts import (
    ApplyFeedbackCommand,
    CmLabel,
    DevicePreference,
    FeedbackOrigin,
    ModelResidency,
    ResolveReviewItemCommand,
    ReviewKind,
    ReviewResolution,
)
from xiranite_clipm.scoring import ScoredWork
from xiranite_clipm.service import ClipmService
from xiranite_clipm.settings import ClipmSettings


class ExactMatchScoring:
    def __init__(self) -> None:
        self.calls = 0

    def score_work(self, path: Path) -> ScoredWork:
        self.calls += 1
        return ScoredWork(
            path=path,
            label=CmLabel.POSITIVE,
            score=800 + self.calls,
            probability=0.8,
            bundle_version=1,
            embedding=np.full(768, self.calls / 100, dtype=np.float32),
            sampled_pages=["01.png", "02.png", "03.png", "04.png"],
            candidate_page_count=4,
            page_count=10,
            baseline_score=800,
            content_digest="ab" * 32,
        )

    def unload(self) -> None:
        pass


class FailOnceMetadataWriter(ArchiveMetadataWriter):
    def __init__(self) -> None:
        super().__init__()
        self.fail_next_write = False

    def write(self, path, document):
        if self.fail_next_write:
            self.fail_next_write = False
            raise OSError("simulated merged projection failure")
        return super().write(path, document)


def _service(
    tmp_path: Path,
    scoring: ExactMatchScoring,
    metadata: ArchiveMetadataWriter | None = None,
) -> ClipmService:
    runtime_root = tmp_path / "runtime"
    return ClipmService(
        ClipmSettings(
            runtime_root=runtime_root,
            device=DevicePreference.CPU,
            model_residency=ModelResidency.IMMEDIATE,
            huggingface_cache=runtime_root / "huggingface-cache",
        ),
        scoring=scoring,
        metadata=metadata,
    )


def test_exact_matches_queue_review_and_support_keep_or_merge(tmp_path: Path) -> None:
    scoring = ExactMatchScoring()
    service = _service(tmp_path, scoring)
    first_path = tmp_path / "first"
    second_path = tmp_path / "second"
    third_path = tmp_path / "third"
    first_path.mkdir()
    second_path.mkdir()
    third_path.mkdir()
    try:
        first = service.score_work(str(first_path))
        second = service.score_work(str(second_path))
        pending = service.list_review_items().items
        assert len(pending) == 1
        assert pending[0].kind is ReviewKind.RECOVERY_CANDIDATE
        assert pending[0].work_id == second.work_id
        assert pending[0].details["reason"] == "exact_sampled_pixel_match"
        assert pending[0].details["candidateWorkIds"] == [str(first.work_id)]

        kept = service.resolve_review_item(
            ResolveReviewItemCommand(
                review_id=pending[0].review_id,
                resolution=ReviewResolution.NEW_WORK,
            )
        )
        assert kept.work_id == second.work_id
        assert scoring.calls == 2

        third = service.score_work(str(third_path))
        pending = service.list_review_items().items
        assert len(pending) == 1 and pending[0].work_id == third.work_id
        corrected = service.apply_feedback(
            ApplyFeedbackCommand(
                work_id=third.work_id,
                ranking=901,
                source=FeedbackOrigin.NEOVIEW,
            )
        )
        assert corrected.work.renamed is True
        refreshed = service.list_review_items().items[0]
        assert refreshed.path == corrected.work.path

        merged = service.resolve_review_item(
            ResolveReviewItemCommand(
                review_id=refreshed.review_id,
                resolution=ReviewResolution.LINK_EXISTING,
                existing_work_id=first.work_id,
            )
        )
        assert merged.work_id == first.work_id
        assert merged.score == 901
        assert scoring.calls == 3
        assert Path(first.path).exists()
        assert service._database is not None
        assert service._database.execute("SELECT count(*) FROM works").fetchone()[0] == 2
        assert service._database.execute(
            "SELECT count(*) FROM feedback_events WHERE work_id = ?",
            (str(first.work_id),),
        ).fetchone()[0] == 1
        document = ArchiveMetadataWriter().read(Path(merged.path))
        assert document is not None and document.work.work_id == first.work_id
        assert document.score.ranking.current == 901
    finally:
        service.close()


def test_failed_merge_projection_remains_pending_and_retries_safely(tmp_path: Path) -> None:
    scoring = ExactMatchScoring()
    metadata = FailOnceMetadataWriter()
    service = _service(tmp_path, scoring, metadata)
    first_path = tmp_path / "first"
    duplicate_path = tmp_path / "duplicate"
    first_path.mkdir()
    duplicate_path.mkdir()
    try:
        first = service.score_work(str(first_path))
        service.score_work(str(duplicate_path))
        review = service.list_review_items().items[0]
        command = ResolveReviewItemCommand(
            review_id=review.review_id,
            resolution=ReviewResolution.LINK_EXISTING,
            existing_work_id=first.work_id,
        )
        metadata.fail_next_write = True
        with pytest.raises(OSError, match="simulated merged projection failure"):
            service.resolve_review_item(command)

        assert service._database is not None
        assert service._database.execute("SELECT count(*) FROM works").fetchone()[0] == 1
        pending = service.list_review_items().items
        assert len(pending) == 1 and pending[0].work_id == first.work_id
        repaired = service.resolve_review_item(command)
        assert repaired.work_id == first.work_id
        assert service.list_review_items().items == []
        document = ArchiveMetadataWriter().read(Path(repaired.path))
        assert document is not None and document.work.work_id == first.work_id
    finally:
        service.close()
