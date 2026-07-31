from __future__ import annotations

from pathlib import Path
from uuid import UUID

import numpy as np
import pytest

from xiranite_clipm.contracts import ApplyFeedbackCommand, CmLabel, FeedbackOrigin
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.feedback_repository import FeedbackError, apply_feedback, undo_feedback
from xiranite_clipm.score_repository import persist_scored_work
from xiranite_clipm.scoring import ScoredWork


def seed_work(connection, path: Path) -> UUID:
    result = persist_scored_work(
        connection,
        ScoredWork(
            path=path,
            label=CmLabel.POSITIVE,
            score=873,
            probability=0.873,
            bundle_version=1,
            embedding=np.zeros(768, dtype=np.float32),
            sampled_pages=["01.png"],
            candidate_page_count=1,
            page_count=1,
        ),
    )
    return result.work_id


def test_feedback_fields_are_independent_and_noop_is_not_an_event(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        work_id = seed_work(connection, tmp_path / "book.zip")
        classification = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work_id, classification=CmLabel.NEGATIVE, source=FeedbackOrigin.GUI),
        )
        ranking = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work_id, ranking=342, source=FeedbackOrigin.FILENAME),
        )
        noop = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work_id, ranking=342, source=FeedbackOrigin.NEOVIEW),
        )
        assert classification is not None and classification.ranking_after is None
        assert ranking is not None and ranking.classification_after is None
        assert noop is None
        row = connection.execute("SELECT current_label, current_score FROM works").fetchone()
        assert tuple(row) == ("N", 342)
        assert connection.execute("SELECT count(*) FROM feedback_events").fetchone()[0] == 2
        assert connection.execute("SELECT count(*) FROM data_revisions").fetchone()[0] == 2
    finally:
        connection.close()


def test_undo_appends_inverse_event_and_rejects_stale_or_duplicate_undo(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        work_id = seed_work(connection, tmp_path / "book.zip")
        original = apply_feedback(
            connection,
            ApplyFeedbackCommand(
                work_id=work_id,
                classification=CmLabel.NEGATIVE,
                ranking=342,
                source=FeedbackOrigin.GUI,
            ),
        )
        assert original is not None
        inverse = undo_feedback(connection, original.event_id, FeedbackOrigin.GUI)
        assert inverse.classification_before is CmLabel.NEGATIVE
        assert inverse.classification_after is CmLabel.POSITIVE
        assert inverse.ranking_before == 342 and inverse.ranking_after == 873
        row = connection.execute("SELECT current_label, current_score FROM works").fetchone()
        assert tuple(row) == ("P", 873)
        assert connection.execute("SELECT undone_by FROM feedback_events WHERE event_id = ?", (str(original.event_id),)).fetchone()[0] == str(inverse.event_id)
        with pytest.raises(FeedbackError, match="already undone"):
            undo_feedback(connection, original.event_id, FeedbackOrigin.GUI)
    finally:
        connection.close()


def test_undo_refuses_to_overwrite_later_field_feedback(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        work_id = seed_work(connection, tmp_path / "book.zip")
        first = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work_id, ranking=700, source=FeedbackOrigin.GUI),
        )
        apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work_id, ranking=600, source=FeedbackOrigin.GUI),
        )
        assert first is not None
        with pytest.raises(FeedbackError, match="no longer the current"):
            undo_feedback(connection, first.event_id, FeedbackOrigin.GUI)
        assert connection.execute("SELECT current_score FROM works").fetchone()[0] == 600
    finally:
        connection.close()
