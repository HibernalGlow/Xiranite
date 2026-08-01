from __future__ import annotations

from pathlib import Path

import numpy as np

from xiranite_clipm.contracts import ApplyFeedbackCommand, CmLabel, FeedbackOrigin
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.feedback_repository import apply_feedback, undo_feedback
from xiranite_clipm.score_repository import persist_scored_work
from xiranite_clipm.scoring import ScoredWork
from xiranite_clipm.training_dataset import build_training_dataset_snapshot


class FakeBaselineStore:
    def load_arrays(self) -> dict[str, np.ndarray]:
        return {
            "embeddings": np.eye(10, 768, dtype=np.float16),
            "labels": np.asarray([0, 1] * 5, dtype=np.int8),
            "groups": np.asarray([f"pilot-group-{index}" for index in range(10)]),
            "work_ids": np.asarray([f"pilot-{index}" for index in range(10)]),
            "validation_mask": np.asarray([True, True] + [False] * 8, dtype=np.bool_),
        }


def seed_work(connection, path: Path, score: int = 500):
    return persist_scored_work(
        connection,
        ScoredWork(
            path=path,
            label=CmLabel.POSITIVE,
            score=score,
            probability=score / 1000,
            bundle_version=1,
            embedding=np.full(768, 1 / np.sqrt(768), dtype=np.float32),
            sampled_pages=["01.png"],
            candidate_page_count=1,
            page_count=1,
        ),
    )


def test_snapshot_uses_latest_independent_feedback_and_fixed_baseline_split(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        first = seed_work(connection, tmp_path / "first", 500)
        second = seed_work(connection, tmp_path / "second", 700)
        apply_feedback(
            connection,
            ApplyFeedbackCommand(
                work_id=first.work_id,
                classification=CmLabel.NEGATIVE,
                source=FeedbackOrigin.GUI,
            ),
        )
        apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=first.work_id, ranking=650, source=FeedbackOrigin.GUI),
        )
        apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=first.work_id, ranking=625, source=FeedbackOrigin.NEOVIEW),
        )
        second_event = apply_feedback(
            connection,
            ApplyFeedbackCommand(
                work_id=second.work_id,
                classification=CmLabel.NEGATIVE,
                ranking=300,
                source=FeedbackOrigin.GUI,
            ),
        )
        assert second_event is not None
        undo_feedback(connection, second_event.event_id, FeedbackOrigin.GUI)

        snapshot = build_training_dataset_snapshot(connection, FakeBaselineStore())  # type: ignore[arg-type]
        assert snapshot.data_revision == 5
        assert snapshot.classification_feedback_count == 1
        assert snapshot.ranking_feedback_count == 1
        assert snapshot.classification.features.shape == (9, 768)
        assert snapshot.classification.labels.tolist() == [0, 1] * 4 + [0]
        assert snapshot.classification.sample_weights.tolist() == [1.0] * 8 + [3.0]
        assert snapshot.classification.sample_ids[-1] == str(first.work_id)
        assert snapshot.classification.validation_labels.tolist() == [0, 1]
        assert snapshot.ranking.features.shape == (1, 768)
        assert snapshot.ranking.baseline_scores.tolist() == [500.0]
        assert snapshot.ranking.target_scores.tolist() == [625.0]
        assert snapshot.ranking.residuals.tolist() == [125.0]
    finally:
        connection.close()


def test_undo_latest_feedback_reveals_previous_effective_value(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        work = seed_work(connection, tmp_path / "book", 500)
        first = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work.work_id, ranking=650, source=FeedbackOrigin.GUI),
        )
        second = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work.work_id, ranking=700, source=FeedbackOrigin.GUI),
        )
        assert first is not None and second is not None
        undo_feedback(connection, second.event_id, FeedbackOrigin.GUI)

        snapshot = build_training_dataset_snapshot(connection, FakeBaselineStore())  # type: ignore[arg-type]
        assert snapshot.ranking_feedback_count == 1
        assert snapshot.ranking.target_scores.tolist() == [650.0]
        assert snapshot.ranking.residuals.tolist() == [150.0]
    finally:
        connection.close()
