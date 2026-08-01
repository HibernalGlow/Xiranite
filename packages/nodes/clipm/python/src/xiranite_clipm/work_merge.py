from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sqlite3

from .filename import strip_cm_tag


def merge_work_into_existing(
    connection: sqlite3.Connection,
    source_work_id: str,
    target_work_id: str,
    current_path: Path,
) -> None:
    if source_work_id == target_work_id:
        return
    now = datetime.now(timezone.utc).isoformat()
    connection.execute("BEGIN IMMEDIATE")
    try:
        _work(connection, source_work_id)
        target = _work(connection, target_work_id)
        current_label = _latest_feedback_value(
            connection,
            source_work_id,
            target_work_id,
            "classification_after",
        ) or str(target["current_label"])
        current_score_value = _latest_feedback_value(
            connection,
            source_work_id,
            target_work_id,
            "ranking_after",
        )
        current_score = int(current_score_value) if current_score_value is not None else int(target["current_score"])

        _merge_embeddings(connection, source_work_id, target_work_id)
        _merge_content_evidence(connection, source_work_id, target_work_id)
        connection.execute(
            "UPDATE score_snapshots SET work_id = ? WHERE work_id = ?",
            (target_work_id, source_work_id),
        )
        connection.execute(
            "UPDATE feedback_events SET work_id = ? WHERE work_id = ?",
            (target_work_id, source_work_id),
        )
        connection.execute(
            "UPDATE auto_training_batch_feedback SET work_id = ? WHERE work_id = ?",
            (target_work_id, source_work_id),
        )
        current_base_name = strip_cm_tag(current_path.name)
        _merge_names(connection, source_work_id, target_work_id, current_base_name, now)
        _merge_locations(connection, source_work_id, target_work_id, now)
        connection.execute(
            "UPDATE review_queue SET work_id = ? WHERE work_id = ?",
            (target_work_id, source_work_id),
        )
        latest_snapshot = connection.execute(
            """SELECT bundle_version FROM score_snapshots
               WHERE work_id = ? ORDER BY snapshot_id DESC LIMIT 1""",
            (target_work_id,),
        ).fetchone()
        name_revision = int(connection.execute(
            "SELECT MAX(revision) FROM work_names WHERE work_id = ?",
            (target_work_id,),
        ).fetchone()[0])
        connection.execute(
            """UPDATE works SET current_base_name = ?, name_revision = ?,
               current_label = ?, current_score = ?, active_bundle_version = ?, updated_at = ?
               WHERE work_id = ?""",
            (
                current_base_name,
                name_revision,
                current_label,
                current_score,
                int(latest_snapshot["bundle_version"]) if latest_snapshot is not None else target["active_bundle_version"],
                now,
                target_work_id,
            ),
        )
        connection.execute("DELETE FROM works WHERE work_id = ?", (source_work_id,))
        connection.execute(
            "INSERT INTO data_revisions(reason, created_at) VALUES (?, ?)",
            (f"work-merge:{source_work_id}:{target_work_id}", now),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _work(connection: sqlite3.Connection, work_id: str) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM works WHERE work_id = ?", (work_id,)).fetchone()
    if row is None:
        raise KeyError(f"Unknown ClipM work: {work_id}")
    if row["current_label"] is None or row["current_score"] is None:
        raise ValueError(f"ClipM work {work_id} has no current score")
    return row


def _latest_feedback_value(
    connection: sqlite3.Connection,
    source_work_id: str,
    target_work_id: str,
    field: str,
) -> str | int | None:
    if field not in {"classification_after", "ranking_after"}:
        raise ValueError(field)
    row = connection.execute(
        f"""SELECT {field} AS value FROM feedback_events
            WHERE work_id IN (?, ?) AND {field} IS NOT NULL AND undone_by IS NULL
            ORDER BY occurred_at DESC, event_id DESC LIMIT 1""",
        (source_work_id, target_work_id),
    ).fetchone()
    return row["value"] if row is not None else None


def _merge_embeddings(connection: sqlite3.Connection, source_work_id: str, target_work_id: str) -> None:
    rows = connection.execute("SELECT * FROM embeddings WHERE work_id = ?", (source_work_id,)).fetchall()
    for row in rows:
        target = connection.execute(
            "SELECT created_at FROM embeddings WHERE work_id = ? AND encoder = ? AND preprocess = ?",
            (target_work_id, row["encoder"], row["preprocess"]),
        ).fetchone()
        if target is None or str(row["created_at"]) >= str(target["created_at"]):
            connection.execute(
                """INSERT INTO embeddings(work_id, encoder, preprocess, dtype, dimension, data, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(work_id, encoder, preprocess) DO UPDATE SET
                     dtype = excluded.dtype, dimension = excluded.dimension,
                     data = excluded.data, created_at = excluded.created_at""",
                (
                    target_work_id,
                    row["encoder"],
                    row["preprocess"],
                    row["dtype"],
                    row["dimension"],
                    row["data"],
                    row["created_at"],
                ),
            )
    connection.execute("DELETE FROM embeddings WHERE work_id = ?", (source_work_id,))


def _merge_content_evidence(connection: sqlite3.Connection, source_work_id: str, target_work_id: str) -> None:
    rows = connection.execute("SELECT * FROM content_evidence WHERE work_id = ?", (source_work_id,)).fetchall()
    for row in rows:
        target = connection.execute(
            "SELECT created_at FROM content_evidence WHERE work_id = ? AND evidence_kind = ?",
            (target_work_id, row["evidence_kind"]),
        ).fetchone()
        if target is None or str(row["created_at"]) >= str(target["created_at"]):
            connection.execute(
                """INSERT INTO content_evidence(
                     work_id, evidence_kind, digest, page_count, sampled_page_count, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(work_id, evidence_kind) DO UPDATE SET
                     digest = excluded.digest, page_count = excluded.page_count,
                     sampled_page_count = excluded.sampled_page_count, created_at = excluded.created_at""",
                (
                    target_work_id,
                    row["evidence_kind"],
                    row["digest"],
                    row["page_count"],
                    row["sampled_page_count"],
                    row["created_at"],
                ),
            )
    connection.execute("DELETE FROM content_evidence WHERE work_id = ?", (source_work_id,))


def _merge_names(
    connection: sqlite3.Connection,
    source_work_id: str,
    target_work_id: str,
    current_base_name: str,
    now: str,
) -> None:
    last = connection.execute(
        "SELECT revision, name FROM work_names WHERE work_id = ? ORDER BY revision DESC LIMIT 1",
        (target_work_id,),
    ).fetchone()
    if last is None:
        raise ValueError(f"ClipM target work {target_work_id} has no name history")
    revision = int(last["revision"])
    last_name = str(last["name"])
    rows = connection.execute(
        "SELECT name, source, changed_at FROM work_names WHERE work_id = ? ORDER BY revision",
        (source_work_id,),
    ).fetchall()
    for row in rows:
        name = str(row["name"])
        if name == last_name:
            continue
        revision += 1
        connection.execute(
            """INSERT INTO work_names(work_id, revision, name, source, changed_at)
               VALUES (?, ?, ?, ?, ?)""",
            (target_work_id, revision, name, row["source"], row["changed_at"]),
        )
        last_name = name
    if current_base_name != last_name:
        revision += 1
        connection.execute(
            """INSERT INTO work_names(work_id, revision, name, source, changed_at)
               VALUES (?, ?, ?, 'filename', ?)""",
            (target_work_id, revision, current_base_name, now),
        )
    connection.execute("DELETE FROM work_names WHERE work_id = ?", (source_work_id,))


def _merge_locations(
    connection: sqlite3.Connection,
    source_work_id: str,
    target_work_id: str,
    now: str,
) -> None:
    connection.execute(
        "UPDATE work_locations SET is_current = 0, removed_at = ? WHERE work_id = ? AND is_current = 1",
        (now, target_work_id),
    )
    rows = connection.execute(
        "SELECT * FROM work_locations WHERE work_id = ? ORDER BY location_id",
        (source_work_id,),
    ).fetchall()
    for row in rows:
        existing = connection.execute(
            "SELECT location_id FROM work_locations WHERE work_id = ? AND path_key = ?",
            (target_work_id, row["path_key"]),
        ).fetchone()
        if existing is None:
            connection.execute(
                "UPDATE work_locations SET work_id = ? WHERE location_id = ?",
                (target_work_id, row["location_id"]),
            )
        else:
            connection.execute(
                """UPDATE work_locations SET path = ?, is_current = ?, last_seen_at = ?, removed_at = ?
                   WHERE location_id = ?""",
                (
                    row["path"],
                    row["is_current"],
                    max(str(row["last_seen_at"]), now),
                    row["removed_at"],
                    existing["location_id"],
                ),
            )
            connection.execute("DELETE FROM work_locations WHERE location_id = ?", (row["location_id"],))
