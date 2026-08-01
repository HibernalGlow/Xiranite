from __future__ import annotations

from pathlib import Path
from uuid import UUID

import numpy as np
import pytest

from xiranite_clipm.contracts import (
    ApplyFeedbackCommand,
    CmLabel,
    FeedbackOrigin,
    ListFeedbackEventsCommand,
)
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.feedback_repository import (
    FeedbackError,
    apply_feedback,
    list_feedback_events,
    undo_feedback,
)
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


def test_lists_feedback_for_agent_audit_with_undo_state_and_current_path(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        path = tmp_path / "book.zip"
        work_id = seed_work(connection, path)
        original = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work_id, ranking=700, source=FeedbackOrigin.GUI),
        )
        assert original is not None
        inverse = undo_feedback(connection, original.event_id, FeedbackOrigin.NEOVIEW)

        page = list_feedback_events(
            connection,
            ListFeedbackEventsCommand(work_id=work_id, include_undone=True),
        )
        events = page.events
        assert [event.event_id for event in events] == [inverse.event_id, original.event_id]
        assert events[1].undone_by == inverse.event_id
        assert events[1].undo_applicable is False
        assert events[0].current_path == str(path.resolve())
        assert events[0].undo_applicable is True

        active = list_feedback_events(
            connection,
            ListFeedbackEventsCommand(work_id=work_id, include_undone=False),
        ).events
        assert [event.event_id for event in active] == [inverse.event_id]
    finally:
        connection.close()


def test_marks_superseded_feedback_as_not_applicable(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        work_id = seed_work(connection, tmp_path / "book.zip")
        first = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work_id, ranking=700, source=FeedbackOrigin.GUI),
        )
        second = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work_id, ranking=600, source=FeedbackOrigin.GUI),
        )
        assert first is not None and second is not None

        events = list_feedback_events(connection, ListFeedbackEventsCommand(work_id=work_id)).events
        assert [event.undo_applicable for event in events] == [True, False]
    finally:
        connection.close()


def test_feedback_history_uses_stable_keyset_pagination(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        work_id = seed_work(connection, tmp_path / "book.zip")
        first = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work_id, ranking=700, source=FeedbackOrigin.GUI),
        )
        second = apply_feedback(
            connection,
            ApplyFeedbackCommand(work_id=work_id, ranking=600, source=FeedbackOrigin.GUI),
        )
        assert first is not None and second is not None

        first_page = list_feedback_events(
            connection,
            ListFeedbackEventsCommand(work_id=work_id, limit=1),
        )
        assert [event.event_id for event in first_page.events] == [second.event_id]
        assert first_page.has_more is True
        assert first_page.next_before_occurred_at == second.occurred_at
        assert first_page.next_before_event_id == second.event_id

        second_page = list_feedback_events(
            connection,
            ListFeedbackEventsCommand(
                work_id=work_id,
                limit=1,
                before_occurred_at=first_page.next_before_occurred_at,
                before_event_id=first_page.next_before_event_id,
            ),
        )
        assert [event.event_id for event in second_page.events] == [first.event_id]
        assert second_page.has_more is False
        assert second_page.next_before_occurred_at is None
        assert second_page.next_before_event_id is None
    finally:
        connection.close()
