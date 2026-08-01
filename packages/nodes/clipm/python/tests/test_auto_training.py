from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
from uuid import uuid4

from xiranite_clipm.auto_training import (
    claim_auto_training_batch,
    finish_auto_training_batch,
    pending_auto_training_work_count,
    record_manual_training_consumption,
)
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.short_codes import encode_record_number


def test_automatic_batches_claim_distinct_latest_feedback_once(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        work_ids = [_seed_feedback_work(connection, index) for index in range(1, 4)]
        assert pending_auto_training_work_count(connection) == 3

        first = claim_auto_training_batch(connection, 2)
        assert first is not None and first.work_count == 2
        finish_auto_training_batch(connection, first.batch_id, "failed", error_message="validation failed")
        assert pending_auto_training_work_count(connection) == 1
        assert claim_auto_training_batch(connection, 2) is None

        _append_feedback(connection, work_ids[0], 10, ranking_before=501, ranking_after=701)
        second = claim_auto_training_batch(connection, 2)
        assert second is not None and second.batch_id != first.batch_id
        assert pending_auto_training_work_count(connection) == 0
        rows = connection.execute(
            "SELECT status, feedback_work_count FROM auto_training_batches ORDER BY created_at, batch_id"
        ).fetchall()
        assert [tuple(row) for row in rows] == [("failed", 2), ("running", 2)]
    finally:
        connection.close()


def test_manual_training_consumes_all_current_pending_feedback(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        _seed_feedback_work(connection, 1)
        _seed_feedback_work(connection, 2)
        revision = connection.execute(
            "INSERT INTO data_revisions(reason, created_at) VALUES ('manual-test', ?) RETURNING revision",
            (_timestamp(20),),
        ).fetchone()[0]
        run_id = uuid4()
        connection.execute(
            """INSERT INTO training_runs(run_id, data_revision, config_json, status, started_at, finished_at)
               VALUES (?, ?, '{}', 'succeeded', ?, ?)""",
            (str(run_id), revision, _timestamp(21), _timestamp(22)),
        )

        batch = record_manual_training_consumption(connection, run_id)

        assert batch is not None and batch.work_count == 2
        assert pending_auto_training_work_count(connection) == 0
        row = connection.execute(
            "SELECT mode, status, training_run_id FROM auto_training_batches WHERE batch_id = ?",
            (str(batch.batch_id),),
        ).fetchone()
        assert tuple(row) == ("manual", "succeeded", str(run_id))
    finally:
        connection.close()


def _seed_feedback_work(connection: sqlite3.Connection, index: int) -> str:
    work_id = str(uuid4())
    now = _timestamp(index)
    connection.execute(
        """INSERT INTO works(
            work_id, short_code, first_seen_name, current_base_name,
            current_label, current_score, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'P', 500, ?, ?)""",
        (work_id, encode_record_number(index), f"book-{index}.zip", f"book-{index}.zip", now, now),
    )
    connection.execute(
        """INSERT INTO embeddings(
            work_id, encoder, preprocess, dtype, dimension, data, created_at
        ) VALUES (?, 'google/siglip2-base-patch16-224',
                  'white-letterbox-224/four-of-twelve/color-mono-v1',
                  'float16', 768, ?, ?)""",
        (work_id, bytes(1536), now),
    )
    _append_feedback(connection, work_id, index, ranking_before=500, ranking_after=500 + index)
    return work_id


def _append_feedback(
    connection: sqlite3.Connection,
    work_id: str,
    order: int,
    *,
    ranking_before: int,
    ranking_after: int,
) -> None:
    connection.execute(
        """INSERT INTO feedback_events(
            event_id, work_id, source, ranking_before, ranking_after, occurred_at
        ) VALUES (?, ?, 'gui', ?, ?, ?)""",
        (str(uuid4()), work_id, ranking_before, ranking_after, _timestamp(order)),
    )


def _timestamp(order: int) -> str:
    return (datetime(2026, 8, 1, tzinfo=timezone.utc) + timedelta(seconds=order)).isoformat()
