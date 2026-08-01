from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
from uuid import UUID, uuid4

import numpy as np

from .contracts import CmLabel, WorkScoreResult
from .filename import parse_cm_tag, strip_cm_tag
from .scoring import ScoredWork
from .short_codes import decode_canonical_short_code, encode_record_number


def persist_scored_work(
    connection: sqlite3.Connection,
    scored: ScoredWork,
    *,
    work_id_hint: str | None = None,
    force_new: bool = False,
    new_work_id: str | None = None,
) -> WorkScoreResult:
    if force_new and work_id_hint is not None:
        raise ValueError("force_new cannot be combined with work_id_hint")
    if new_work_id is not None:
        new_work_id = str(UUID(new_work_id))
    path = scored.path.resolve()
    path_text = str(path)
    path_key = os.path.normcase(path_text).casefold()
    base_name = strip_cm_tag(path.name)
    now = datetime.now(timezone.utc).isoformat()
    connection.execute("BEGIN IMMEDIATE")
    try:
        path_row = connection.execute(
            """SELECT works.work_id, works.record_number, works.short_code
               FROM work_locations
               JOIN works ON works.work_id = work_locations.work_id
               WHERE work_locations.path_key = ? AND work_locations.is_current = 1""",
            (path_key,),
        ).fetchone()
        if force_new and path_row is not None:
            connection.execute(
                "UPDATE work_locations SET is_current = 0, removed_at = ? WHERE path_key = ? AND is_current = 1",
                (now, path_key),
            )
            path_row = None
        hinted_row = (
            connection.execute(
                "SELECT work_id, record_number, short_code FROM works WHERE work_id = ?",
                (work_id_hint,),
            ).fetchone()
            if work_id_hint is not None
            else None
        )
        if path_row is not None and hinted_row is not None and path_row["work_id"] != hinted_row["work_id"]:
            raise ValueError("ClipM score path belongs to another work")
        row = hinted_row or path_row
        if row is None:
            record_number = int(connection.execute("SELECT COALESCE(MAX(record_number), 0) + 1 FROM works").fetchone()[0])
            work_id = new_work_id or str(uuid4())
            short_code = encode_record_number(record_number)
            connection.execute(
                """INSERT INTO works(
                    record_number, work_id, short_code, first_seen_name, current_base_name,
                    current_label, current_score, active_bundle_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    record_number,
                    work_id,
                    short_code,
                    base_name,
                    base_name,
                    scored.label.value,
                    scored.score,
                    scored.bundle_version,
                    now,
                    now,
                ),
            )
            connection.execute(
                """INSERT INTO work_locations(
                    work_id, path, path_key, first_seen_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?)""",
                (work_id, path_text, path_key, now, now),
            )
            connection.execute(
                "INSERT INTO work_names(work_id, revision, name, source, changed_at) VALUES (?, 0, ?, 'model', ?)",
                (work_id, base_name, now),
            )
        else:
            work_id = str(row["work_id"])
            short_code = str(row["short_code"])
            _relocate_and_record_name(connection, work_id, path_text, path_key, base_name, now)
            has_classification_feedback = _has_active_feedback(connection, work_id, "classification_after")
            has_ranking_feedback = _has_active_feedback(connection, work_id, "ranking_after")
            connection.execute(
                """UPDATE works SET
                   current_label = CASE WHEN ? THEN current_label ELSE ? END,
                   current_score = CASE WHEN ? THEN current_score ELSE ? END,
                   active_bundle_version = ?, updated_at = ?
                   WHERE work_id = ?""",
                (
                    has_classification_feedback,
                    scored.label.value,
                    has_ranking_feedback,
                    scored.score,
                    scored.bundle_version,
                    now,
                    work_id,
                ),
            )
        embedding_bytes = np.asarray(scored.embedding, dtype="<f2").tobytes()
        connection.execute(
            """INSERT INTO embeddings(work_id, encoder, preprocess, dtype, dimension, data, created_at)
               VALUES (?, ?, ?, 'float16', 768, ?, ?)
               ON CONFLICT(work_id, encoder, preprocess) DO UPDATE SET data = excluded.data, created_at = excluded.created_at""",
            (
                work_id,
                "google/siglip2-base-patch16-224",
                "white-letterbox-224/four-of-twelve/color-mono-v1",
                embedding_bytes,
                now,
            ),
        )
        connection.execute(
            """INSERT INTO score_snapshots(
                work_id, bundle_version, predicted_label, predicted_score,
                probability, scored_at, baseline_score
            ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                work_id,
                scored.bundle_version,
                scored.label.value,
                scored.score,
                scored.probability,
                now,
                scored.baseline_score
                if scored.baseline_score is not None
                else min(1000, max(0, round(scored.probability * 1000))),
            ),
        )
        if scored.content_digest is not None:
            connection.execute(
                """INSERT INTO content_evidence(
                    work_id, evidence_kind, digest, page_count, sampled_page_count, created_at
                ) VALUES (?, 'sampled_pixel_sha256', ?, ?, ?, ?)
                ON CONFLICT(work_id, evidence_kind) DO UPDATE SET
                  digest = excluded.digest,
                  page_count = excluded.page_count,
                  sampled_page_count = excluded.sampled_page_count,
                  created_at = excluded.created_at""",
                (
                    work_id,
                    scored.content_digest,
                    scored.page_count,
                    len(scored.sampled_pages),
                    now,
                ),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return WorkScoreResult(
        work_id=work_id,
        path=path_text,
        label=scored.label,
        score=scored.score,
        predicted_label=scored.label,
        predicted_score=scored.score,
        probability=scored.probability,
        bundle_version=scored.bundle_version,
        short_code=short_code,
        sampled_pages=scored.sampled_pages,
        candidate_page_count=scored.candidate_page_count,
        page_count=scored.page_count,
        stale=False,
    )


def load_work_score_result(
    connection: sqlite3.Connection,
    work_id: str,
    path: Path,
    active_bundle_version: int | None,
) -> WorkScoreResult:
    row = connection.execute(
        """SELECT works.work_id, works.short_code, works.current_label, works.current_score,
                  score_snapshots.bundle_version, score_snapshots.predicted_label,
                  score_snapshots.predicted_score, score_snapshots.probability
           FROM works JOIN score_snapshots ON score_snapshots.snapshot_id = (
             SELECT snapshot_id FROM score_snapshots latest
             WHERE latest.work_id = works.work_id ORDER BY snapshot_id DESC LIMIT 1
           ) WHERE works.work_id = ?""",
        (work_id,),
    ).fetchone()
    if row is None or row["current_label"] is None or row["current_score"] is None:
        raise KeyError(f"Work {work_id} has no score snapshot")
    bundle_version = int(row["bundle_version"])
    return WorkScoreResult(
        work_id=str(row["work_id"]),
        path=str(path.resolve()),
        label=CmLabel(str(row["current_label"])),
        score=int(row["current_score"]),
        predicted_label=CmLabel(str(row["predicted_label"])),
        predicted_score=int(row["predicted_score"]),
        classification_corrected=_has_active_feedback(connection, work_id, "classification_after"),
        ranking_corrected=_has_active_feedback(connection, work_id, "ranking_after"),
        probability=float(row["probability"]) if row["probability"] is not None else None,
        bundle_version=bundle_version,
        short_code=str(row["short_code"]),
        stale=active_bundle_version is not None and bundle_version != active_bundle_version,
    )


def find_work_score_result(
    connection: sqlite3.Connection,
    path: Path,
    active_bundle_version: int | None,
) -> WorkScoreResult | None:
    resolved = path.resolve(strict=True)
    path_key = os.path.normcase(str(resolved)).casefold()
    row = connection.execute(
        """SELECT works.work_id FROM work_locations
           JOIN works ON works.work_id = work_locations.work_id
           WHERE work_locations.path_key = ? AND work_locations.is_current = 1""",
        (path_key,),
    ).fetchone()
    if row is None:
        tag = parse_cm_tag(resolved.name)
        record_number = (
            decode_canonical_short_code(tag.short_code)
            if tag is not None and tag.short_code is not None
            else None
        )
        if record_number is not None:
            row = connection.execute(
                "SELECT work_id FROM works WHERE record_number = ? AND short_code = ?",
                (record_number, tag.short_code),
            ).fetchone()
    if row is None:
        return None
    return load_work_score_result(connection, str(row["work_id"]), resolved, active_bundle_version)


def relocate_work(
    connection: sqlite3.Connection,
    work_id: str,
    path: Path,
    *,
    allow_reassignment: bool = False,
) -> None:
    resolved = path.resolve(strict=True)
    now = datetime.now(timezone.utc).isoformat()
    connection.execute("BEGIN IMMEDIATE")
    try:
        _relocate_and_record_name(
            connection,
            work_id,
            str(resolved),
            os.path.normcase(str(resolved)).casefold(),
            strip_cm_tag(resolved.name),
            now,
            allow_reassignment,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _relocate_and_record_name(
    connection: sqlite3.Connection,
    work_id: str,
    path_text: str,
    path_key: str,
    base_name: str,
    now: str,
    allow_reassignment: bool = False,
) -> None:
    occupied = connection.execute(
        "SELECT work_id FROM work_locations WHERE path_key = ? AND is_current = 1",
        (path_key,),
    ).fetchone()
    if occupied is not None and str(occupied["work_id"]) != work_id:
        if not allow_reassignment:
            raise ValueError(f"ClipM path already belongs to work {occupied['work_id']}")
        connection.execute(
            "UPDATE work_locations SET is_current = 0, removed_at = ? WHERE path_key = ? AND is_current = 1",
            (now, path_key),
        )
    current = connection.execute(
        "SELECT location_id, path_key FROM work_locations WHERE work_id = ? AND is_current = 1",
        (work_id,),
    ).fetchone()
    if current is None or str(current["path_key"]) != path_key:
        connection.execute(
            "UPDATE work_locations SET is_current = 0, removed_at = ? WHERE work_id = ? AND is_current = 1",
            (now, work_id),
        )
        connection.execute(
            """INSERT INTO work_locations(work_id, path, path_key, first_seen_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(work_id, path_key) DO UPDATE SET
                 path = excluded.path, is_current = 1, last_seen_at = excluded.last_seen_at, removed_at = NULL""",
            (work_id, path_text, path_key, now, now),
        )
    else:
        connection.execute(
            "UPDATE work_locations SET path = ?, last_seen_at = ? WHERE location_id = ?",
            (path_text, now, current["location_id"]),
        )
    work = connection.execute(
        "SELECT current_base_name, name_revision FROM works WHERE work_id = ?",
        (work_id,),
    ).fetchone()
    if work is None:
        raise KeyError(f"Unknown ClipM work: {work_id}")
    if str(work["current_base_name"]) != base_name:
        revision = int(work["name_revision"]) + 1
        connection.execute(
            "UPDATE works SET current_base_name = ?, name_revision = ?, updated_at = ? WHERE work_id = ?",
            (base_name, revision, now, work_id),
        )
        connection.execute(
            "INSERT INTO work_names(work_id, revision, name, source, changed_at) VALUES (?, ?, ?, 'filename', ?)",
            (work_id, revision, base_name, now),
        )


def _has_active_feedback(connection: sqlite3.Connection, work_id: str, field: str) -> bool:
    if field not in {"classification_after", "ranking_after"}:
        raise ValueError(field)
    return connection.execute(
        f"""SELECT 1 FROM feedback_events
            WHERE work_id = ? AND {field} IS NOT NULL AND undone_by IS NULL LIMIT 1""",
        (work_id,),
    ).fetchone() is not None
