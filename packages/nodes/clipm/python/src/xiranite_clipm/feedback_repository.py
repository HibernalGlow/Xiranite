from __future__ import annotations

from datetime import datetime, timezone
import sqlite3
from uuid import UUID, uuid4

from .contracts import ApplyFeedbackCommand, CmLabel, FeedbackHistoryEntry, FeedbackOrigin


class FeedbackError(RuntimeError):
    pass


def apply_feedback(
    connection: sqlite3.Connection,
    command: ApplyFeedbackCommand,
) -> FeedbackHistoryEntry | None:
    work_id = str(command.work_id)
    connection.execute("BEGIN IMMEDIATE")
    try:
        work = _work_row(connection, work_id)
        classification_before = CmLabel(str(work["current_label"])) if work["current_label"] is not None else None
        ranking_before = int(work["current_score"]) if work["current_score"] is not None else None
        classification_changed = command.classification is not None and command.classification != classification_before
        ranking_changed = command.ranking is not None and command.ranking != ranking_before
        if not classification_changed and not ranking_changed:
            connection.rollback()
            return None
        event = _insert_event(
            connection,
            work_id=work_id,
            source=command.source,
            classification_before=classification_before if classification_changed else None,
            classification_after=command.classification if classification_changed else None,
            ranking_before=ranking_before if ranking_changed else None,
            ranking_after=command.ranking if ranking_changed else None,
        )
        connection.execute(
            """UPDATE works SET
                current_label = COALESCE(?, current_label),
                current_score = COALESCE(?, current_score),
                updated_at = ?
               WHERE work_id = ?""",
            (
                command.classification.value if classification_changed and command.classification else None,
                command.ranking if ranking_changed else None,
                event.occurred_at.isoformat(),
                work_id,
            ),
        )
        _append_revision(connection, f"feedback:{event.event_id}", event.occurred_at.isoformat())
        connection.commit()
        return event
    except Exception:
        connection.rollback()
        raise


def undo_feedback(
    connection: sqlite3.Connection,
    event_id: str | UUID,
    source: FeedbackOrigin,
) -> FeedbackHistoryEntry:
    event_id_text = str(event_id)
    connection.execute("BEGIN IMMEDIATE")
    try:
        row = connection.execute("SELECT * FROM feedback_events WHERE event_id = ?", (event_id_text,)).fetchone()
        if row is None:
            raise KeyError(f"Unknown ClipM feedback event: {event_id_text}")
        if row["undone_by"] is not None:
            raise FeedbackError(f"Feedback event {event_id_text} is already undone")
        work_id = str(row["work_id"])
        work = _work_row(connection, work_id)
        classification_after = CmLabel(str(row["classification_after"])) if row["classification_after"] else None
        ranking_after = int(row["ranking_after"]) if row["ranking_after"] is not None else None
        if classification_after is not None and work["current_label"] != classification_after.value:
            raise FeedbackError("Classification feedback is no longer the current value")
        if ranking_after is not None and int(work["current_score"]) != ranking_after:
            raise FeedbackError("Ranking feedback is no longer the current value")
        inverse = _insert_event(
            connection,
            work_id=work_id,
            source=source,
            classification_before=classification_after,
            classification_after=CmLabel(str(row["classification_before"])) if row["classification_before"] else None,
            ranking_before=ranking_after,
            ranking_after=int(row["ranking_before"]) if row["ranking_before"] is not None else None,
        )
        connection.execute("UPDATE feedback_events SET undone_by = ? WHERE event_id = ?", (str(inverse.event_id), event_id_text))
        connection.execute(
            """UPDATE works SET
                current_label = COALESCE(?, current_label),
                current_score = COALESCE(?, current_score),
                updated_at = ?
               WHERE work_id = ?""",
            (
                inverse.classification_after.value if inverse.classification_after else None,
                inverse.ranking_after,
                inverse.occurred_at.isoformat(),
                work_id,
            ),
        )
        _append_revision(connection, f"feedback-undo:{inverse.event_id}", inverse.occurred_at.isoformat())
        connection.commit()
        return inverse
    except Exception:
        connection.rollback()
        raise


def _work_row(connection: sqlite3.Connection, work_id: str) -> sqlite3.Row:
    row = connection.execute("SELECT current_label, current_score FROM works WHERE work_id = ?", (work_id,)).fetchone()
    if row is None:
        raise KeyError(f"Unknown ClipM work: {work_id}")
    return row


def _insert_event(
    connection: sqlite3.Connection,
    *,
    work_id: str,
    source: FeedbackOrigin,
    classification_before: CmLabel | None,
    classification_after: CmLabel | None,
    ranking_before: int | None,
    ranking_after: int | None,
) -> FeedbackHistoryEntry:
    event = FeedbackHistoryEntry(
        event_id=uuid4(),
        occurred_at=datetime.now(timezone.utc),
        source=source,
        classification_before=classification_before,
        classification_after=classification_after,
        ranking_before=ranking_before,
        ranking_after=ranking_after,
    )
    connection.execute(
        """INSERT INTO feedback_events(
            event_id, work_id, source, classification_before, classification_after,
            ranking_before, ranking_after, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            str(event.event_id),
            work_id,
            event.source.value,
            event.classification_before.value if event.classification_before else None,
            event.classification_after.value if event.classification_after else None,
            event.ranking_before,
            event.ranking_after,
            event.occurred_at.isoformat(),
        ),
    )
    return event


def _append_revision(connection: sqlite3.Connection, reason: str, created_at: str) -> None:
    connection.execute("INSERT INTO data_revisions(reason, created_at) VALUES (?, ?)", (reason, created_at))
