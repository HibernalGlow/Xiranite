from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import sqlite3
from typing import Literal
from uuid import UUID, uuid4


@dataclass(frozen=True, slots=True)
class AutoTrainingBatch:
    batch_id: UUID
    work_count: int


BatchStatus = Literal["succeeded", "failed", "cancelled"]


def pending_auto_training_work_count(connection: sqlite3.Connection) -> int:
    return len(_pending_feedback(connection))


def claim_auto_training_batch(
    connection: sqlite3.Connection,
    batch_size: int,
) -> AutoTrainingBatch | None:
    if batch_size < 1:
        raise ValueError("Automatic training threshold must be at least one")
    connection.execute("BEGIN IMMEDIATE")
    try:
        feedback = _pending_feedback(connection)
        if len(feedback) < batch_size:
            connection.commit()
            return None
        batch = _insert_batch(connection, "automatic", batch_size, feedback)
        connection.commit()
        return batch
    except Exception:
        connection.rollback()
        raise


def finish_auto_training_batch(
    connection: sqlite3.Connection,
    batch_id: UUID,
    status: BatchStatus,
    *,
    training_run_id: UUID | None = None,
    error_message: str | None = None,
) -> None:
    connection.execute(
        """UPDATE auto_training_batches
           SET status = ?, training_run_id = ?, finished_at = ?, error_message = ?
           WHERE batch_id = ? AND status = 'running'""",
        (
            status,
            str(training_run_id) if training_run_id else None,
            datetime.now(timezone.utc).isoformat(),
            error_message,
            str(batch_id),
        ),
    )


def record_manual_training_consumption(
    connection: sqlite3.Connection,
    training_run_id: UUID,
) -> AutoTrainingBatch | None:
    connection.execute("BEGIN IMMEDIATE")
    try:
        feedback = _pending_feedback(connection)
        if not feedback:
            connection.commit()
            return None
        batch = _insert_batch(connection, "manual", len(feedback), feedback)
        finish_auto_training_batch(
            connection,
            batch.batch_id,
            "succeeded",
            training_run_id=training_run_id,
        )
        connection.commit()
        return batch
    except Exception:
        connection.rollback()
        raise


def _insert_batch(
    connection: sqlite3.Connection,
    mode: Literal["automatic", "manual"],
    requested_batch_size: int,
    feedback: list[sqlite3.Row],
) -> AutoTrainingBatch:
    batch_id = uuid4()
    connection.execute(
        """INSERT INTO auto_training_batches(
            batch_id, mode, status, requested_batch_size, feedback_work_count, created_at
        ) VALUES (?, ?, 'running', ?, ?, ?)""",
        (
            str(batch_id),
            mode,
            requested_batch_size,
            len(feedback),
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    connection.executemany(
        """INSERT INTO auto_training_batch_feedback(batch_id, event_id, work_id)
           VALUES (?, ?, ?)""",
        ((str(batch_id), str(row["event_id"]), str(row["work_id"])) for row in feedback),
    )
    return AutoTrainingBatch(batch_id=batch_id, work_count=len(feedback))


def _pending_feedback(
    connection: sqlite3.Connection,
) -> list[sqlite3.Row]:
    return connection.execute(
        """WITH latest AS (
              SELECT feedback_events.event_id, feedback_events.work_id,
                     feedback_events.occurred_at,
                     ROW_NUMBER() OVER (
                       PARTITION BY feedback_events.work_id
                       ORDER BY feedback_events.occurred_at DESC, feedback_events.event_id DESC
                     ) AS row_number
              FROM feedback_events
              JOIN embeddings ON embeddings.work_id = feedback_events.work_id
                AND embeddings.encoder = 'google/siglip2-base-patch16-224'
                AND embeddings.preprocess = 'white-letterbox-224/four-of-twelve/color-mono-v1'
              WHERE feedback_events.undone_by IS NULL
                AND feedback_events.event_id NOT IN (
                  SELECT undone_by FROM feedback_events WHERE undone_by IS NOT NULL
                )
            )
            SELECT latest.event_id, latest.work_id
            FROM latest
            WHERE latest.row_number = 1
              AND NOT EXISTS (
                SELECT 1 FROM auto_training_batch_feedback
                WHERE auto_training_batch_feedback.event_id = latest.event_id
            )
            ORDER BY latest.occurred_at, latest.event_id""",
    ).fetchall()
