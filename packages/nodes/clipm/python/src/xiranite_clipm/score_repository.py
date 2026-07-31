from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

import numpy as np

from .contracts import WorkScoreResult
from .filename import strip_cm_tag
from .scoring import ScoredWork
from .short_codes import encode_record_number


def persist_scored_work(connection: sqlite3.Connection, scored: ScoredWork) -> WorkScoreResult:
    path = scored.path.resolve()
    path_text = str(path)
    path_key = os.path.normcase(path_text).casefold()
    base_name = strip_cm_tag(path.name)
    now = datetime.now(timezone.utc).isoformat()
    connection.execute("BEGIN IMMEDIATE")
    try:
        row = connection.execute(
            """SELECT works.work_id, works.record_number, works.short_code
               FROM work_locations
               JOIN works ON works.work_id = work_locations.work_id
               WHERE work_locations.path_key = ? AND work_locations.is_current = 1""",
            (path_key,),
        ).fetchone()
        if row is None:
            record_number = int(connection.execute("SELECT COALESCE(MAX(record_number), 0) + 1 FROM works").fetchone()[0])
            work_id = str(uuid4())
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
            connection.execute(
                """UPDATE works SET current_label = ?, current_score = ?, active_bundle_version = ?, updated_at = ?
                   WHERE work_id = ?""",
                (scored.label.value, scored.score, scored.bundle_version, now, work_id),
            )
            connection.execute(
                "UPDATE work_locations SET last_seen_at = ? WHERE work_id = ? AND path_key = ?",
                (now, work_id, path_key),
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
                work_id, bundle_version, predicted_label, predicted_score, probability, scored_at
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            (work_id, scored.bundle_version, scored.label.value, scored.score, scored.probability, now),
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
        probability=scored.probability,
        bundle_version=scored.bundle_version,
        short_code=short_code,
        sampled_pages=scored.sampled_pages,
        candidate_page_count=scored.candidate_page_count,
        page_count=scored.page_count,
        stale=False,
    )
