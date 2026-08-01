from __future__ import annotations

from pathlib import Path
import sqlite3

from .contracts import ReviewItem, ReviewKind
from .identity_reconciliation import enqueue_review


def enqueue_exact_content_review(
    connection: sqlite3.Connection,
    work_id: str,
    path: Path,
    digest: str,
) -> ReviewItem | None:
    matches = connection.execute(
        """SELECT work_id FROM content_evidence
           WHERE evidence_kind = 'sampled_pixel_sha256'
             AND digest = ? AND work_id != ?
           ORDER BY work_id""",
        (digest, work_id),
    ).fetchall()
    candidate_work_ids = [str(row["work_id"]) for row in matches]
    if not candidate_work_ids:
        return None
    return enqueue_review(
        connection,
        ReviewKind.RECOVERY_CANDIDATE,
        path,
        {
            "reason": "exact_sampled_pixel_match",
            "evidenceKind": "sampled_pixel_sha256",
            "digest": digest,
            "candidateWorkIds": candidate_work_ids,
        },
        work_id,
    )
