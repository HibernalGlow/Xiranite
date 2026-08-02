from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

import numpy as np

from .contracts import (
    PerceptualCalibrationResult,
    PerceptualRecoveryObservation,
    PerceptualRecoveryStatus,
    ReviewItem,
    ReviewKind,
    ReviewStatus,
)


ENCODER = "google/siglip2-base-patch16-224"
PREPROCESS = "white-letterbox-224/four-of-twelve/color-mono-v1"
MAX_OBSERVATIONS_PER_WORK = 5


@dataclass(frozen=True, slots=True)
class OrderedPageConsensus:
    mean_similarity: float
    pairings: tuple[tuple[int, int, float], ...]

    @property
    def matched_page_count(self) -> int:
        return len(self.pairings)


def ordered_page_consensus(query: np.ndarray, candidate: np.ndarray) -> OrderedPageConsensus | None:
    query = _normalized_page_matrix(query)
    candidate = _normalized_page_matrix(candidate)
    maximum_matches = min(len(query), len(candidate))
    if maximum_matches < 3:
        return None
    similarities = np.clip(query @ candidate.T, -1.0, 1.0)
    best: OrderedPageConsensus | None = None
    for match_count in range(3, maximum_matches + 1):
        for query_indices in combinations(range(len(query)), match_count):
            for candidate_indices in combinations(range(len(candidate)), match_count):
                pairings = tuple(
                    (query_index, candidate_index, float(similarities[query_index, candidate_index]))
                    for query_index, candidate_index in zip(query_indices, candidate_indices, strict=True)
                )
                consensus = OrderedPageConsensus(
                    mean_similarity=float(np.mean([pairing[2] for pairing in pairings])),
                    pairings=pairings,
                )
                if best is None or _consensus_key(consensus) > _consensus_key(best):
                    best = consensus
    return best


def record_perceptual_similarity_observations(
    connection: sqlite3.Connection,
    work_id: str,
    page_embeddings: np.ndarray,
    observed_at: str,
) -> None:
    candidates = connection.execute(
        """SELECT work_id, page_index, data FROM page_embeddings
           WHERE encoder = ? AND preprocess = ? AND work_id != ?
           ORDER BY work_id, page_index""",
        (ENCODER, PREPROCESS, work_id),
    ).fetchall()
    grouped: dict[str, list[np.ndarray]] = {}
    for row in candidates:
        grouped.setdefault(str(row["work_id"]), []).append(
            np.frombuffer(row["data"], dtype="<f2").astype(np.float32)
        )
    observations: list[tuple[str, OrderedPageConsensus, int]] = []
    for candidate_work_id, candidate_pages in grouped.items():
        candidate_matrix = np.stack(candidate_pages)
        consensus = ordered_page_consensus(page_embeddings, candidate_matrix)
        if consensus is not None:
            observations.append((candidate_work_id, consensus, len(candidate_pages)))
    observations.sort(key=lambda item: _consensus_key(item[1]), reverse=True)
    connection.execute(
        "DELETE FROM perceptual_similarity_observations WHERE work_id = ?",
        (work_id,),
    )
    for candidate_work_id, consensus, candidate_page_count in observations[:MAX_OBSERVATIONS_PER_WORK]:
        connection.execute(
            """INSERT INTO perceptual_similarity_observations(
                work_id, candidate_work_id, encoder, preprocess, mean_similarity,
                matched_page_count, query_page_count, candidate_page_count, pairings_json, observed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(work_id, candidate_work_id, encoder, preprocess) DO UPDATE SET
              mean_similarity = excluded.mean_similarity,
              matched_page_count = excluded.matched_page_count,
              query_page_count = excluded.query_page_count,
              candidate_page_count = excluded.candidate_page_count,
              pairings_json = excluded.pairings_json,
              observed_at = excluded.observed_at""",
            (
                work_id,
                candidate_work_id,
                ENCODER,
                PREPROCESS,
                consensus.mean_similarity,
                consensus.matched_page_count,
                len(page_embeddings),
                candidate_page_count,
                json.dumps(consensus.pairings, separators=(",", ":")),
                observed_at,
            ),
        )


def perceptual_recovery_status(
    connection: sqlite3.Connection,
    limit: int = 100,
) -> PerceptualRecoveryStatus:
    counts = connection.execute(
        """SELECT
             (SELECT count(*) FROM works
              JOIN work_locations locations
                ON locations.work_id = works.work_id AND locations.is_current = 1
              WHERE (SELECT count(*) FROM page_embeddings pages
                     WHERE pages.work_id = works.work_id
                       AND pages.encoder = ? AND pages.preprocess = ?) >= 3) AS embedded_work_count,
             (SELECT count(*) FROM perceptual_similarity_observations) AS observation_count""",
        (ENCODER, PREPROCESS),
    ).fetchone()
    policy = connection.execute(
        """SELECT enabled, threshold FROM perceptual_recovery_policy
           WHERE singleton = 1"""
    ).fetchone()
    last_run = connection.execute(
        """SELECT * FROM perceptual_calibration_runs
           WHERE status != 'running' ORDER BY started_at DESC, run_id DESC LIMIT 1"""
    ).fetchone()
    rows = connection.execute(
        """SELECT observations.work_id, observations.candidate_work_id,
                  observations.mean_similarity, observations.matched_page_count,
                  observations.query_page_count, observations.candidate_page_count,
                  observations.observed_at, work_location.path AS work_path,
                  candidate_location.path AS candidate_path
           FROM perceptual_similarity_observations observations
           LEFT JOIN work_locations work_location
             ON work_location.work_id = observations.work_id AND work_location.is_current = 1
           LEFT JOIN work_locations candidate_location
             ON candidate_location.work_id = observations.candidate_work_id
            AND candidate_location.is_current = 1
           ORDER BY observations.mean_similarity DESC, observations.observed_at DESC,
                    observations.work_id, observations.candidate_work_id
           LIMIT ?""",
        (limit,),
    ).fetchall()
    return PerceptualRecoveryStatus(
        candidate_generation_enabled=bool(policy and policy["enabled"]),
        threshold=float(policy["threshold"]) if policy is not None else None,
        calibration_status="calibrated" if policy is not None and policy["enabled"] else "collecting_telemetry",
        embedded_work_count=int(counts["embedded_work_count"]),
        observation_count=int(counts["observation_count"]),
        last_calibration=_calibration_result(last_run, bool(policy and policy["enabled"])),
        observations=[
            PerceptualRecoveryObservation(
                work_id=row["work_id"],
                candidate_work_id=row["candidate_work_id"],
                work_path=row["work_path"],
                candidate_path=row["candidate_path"],
                mean_similarity=row["mean_similarity"],
                matched_page_count=row["matched_page_count"],
                query_page_count=row["query_page_count"],
                candidate_page_count=row["candidate_page_count"],
                observed_at=datetime.fromisoformat(row["observed_at"]),
            )
            for row in rows
        ],
    )


def enqueue_perceptual_content_review(
    connection: sqlite3.Connection,
    work_id: str,
    path: Path,
) -> ReviewItem | None:
    policy = connection.execute(
        """SELECT threshold FROM perceptual_recovery_policy
           WHERE singleton = 1 AND enabled = 1"""
    ).fetchone()
    if policy is None:
        return None
    rows = connection.execute(
        """SELECT observations.candidate_work_id, observations.mean_similarity,
                  observations.matched_page_count
           FROM perceptual_similarity_observations observations
           WHERE observations.work_id = ? AND observations.mean_similarity >= ?
             AND NOT EXISTS (
               SELECT 1 FROM content_evidence current_evidence
               JOIN content_evidence candidate_evidence
                 ON candidate_evidence.digest = current_evidence.digest
                AND candidate_evidence.evidence_kind = current_evidence.evidence_kind
               WHERE current_evidence.work_id = observations.work_id
                 AND candidate_evidence.work_id = observations.candidate_work_id
             )
           ORDER BY observations.mean_similarity DESC, observations.candidate_work_id""",
        (work_id, float(policy["threshold"])),
    ).fetchall()
    if not rows:
        return None
    details = {
        "reason": "perceptual_ordered_page_consensus",
        "evidenceKind": "siglip2_page_order_consensus",
        "threshold": float(policy["threshold"]),
        "candidateWorkIds": [str(row["candidate_work_id"]) for row in rows],
        "candidates": [
            {
                "workId": str(row["candidate_work_id"]),
                "meanSimilarity": float(row["mean_similarity"]),
                "matchedPageCount": int(row["matched_page_count"]),
            }
            for row in rows
        ],
    }
    return _enqueue_or_refresh_perceptual_review(connection, work_id, path, details)


def enqueue_existing_perceptual_reviews(connection: sqlite3.Connection) -> int:
    rows = connection.execute(
        """SELECT DISTINCT observations.work_id, locations.path
           FROM perceptual_similarity_observations observations
           JOIN perceptual_recovery_policy policy
             ON policy.singleton = 1 AND policy.enabled = 1
            AND observations.mean_similarity >= policy.threshold
           JOIN work_locations locations
             ON locations.work_id = observations.work_id AND locations.is_current = 1
           ORDER BY observations.work_id"""
    ).fetchall()
    review_count = 0
    for row in rows:
        review = enqueue_perceptual_content_review(
            connection,
            str(row["work_id"]),
            Path(str(row["path"])),
        )
        if review is not None:
            review_count += 1
    return review_count


def _normalized_page_matrix(value: np.ndarray) -> np.ndarray:
    matrix = np.asarray(value, dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[1] != 768:
        raise ValueError("page embeddings must have shape [pages, 768]")
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    if np.any(norms <= 1e-12):
        raise ValueError("page embeddings must be non-zero")
    return matrix / norms


def _enqueue_or_refresh_perceptual_review(
    connection: sqlite3.Connection,
    work_id: str,
    path: Path,
    details: dict[str, object],
) -> ReviewItem:
    path_text = str(path.resolve())
    payload_json = json.dumps(details, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    review_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    owns_transaction = not connection.in_transaction
    if owns_transaction:
        connection.execute("BEGIN IMMEDIATE")
    try:
        existing = connection.execute(
            """SELECT review_id FROM review_queue
               WHERE kind = 'recovery_candidate' AND work_id = ? AND status = 'pending'
               ORDER BY created_at, review_id LIMIT 1""",
            (work_id,),
        ).fetchone()
        if existing is None:
            connection.execute(
                """INSERT INTO review_queue(review_id, work_id, kind, path, payload_json, created_at)
                   VALUES (?, ?, 'recovery_candidate', ?, ?, ?)""",
                (review_id, work_id, path_text, payload_json, created_at),
            )
        else:
            review_id = str(existing["review_id"])
            connection.execute(
                "UPDATE review_queue SET path = ?, payload_json = ? WHERE review_id = ?",
                (path_text, payload_json, review_id),
            )
        row = connection.execute(
            """SELECT review_id, work_id, kind, path, payload_json, status, created_at,
                      resolution, resolved_at
               FROM review_queue
               WHERE kind = 'recovery_candidate' AND work_id = ? AND status = 'pending'""",
            (work_id,),
        ).fetchone()
        if owns_transaction:
            connection.commit()
    except Exception:
        if owns_transaction:
            connection.rollback()
        raise
    assert row is not None
    return ReviewItem(
        review_id=row["review_id"],
        kind=ReviewKind(row["kind"]),
        status=ReviewStatus(row["status"]),
        work_id=row["work_id"],
        path=row["path"],
        details=json.loads(str(row["payload_json"])),
        created_at=row["created_at"],
        resolution=row["resolution"],
        resolved_at=row["resolved_at"],
    )


def _consensus_key(consensus: OrderedPageConsensus) -> tuple[float, int]:
    return consensus.mean_similarity, consensus.matched_page_count


def _calibration_result(row: sqlite3.Row | None, enabled: bool) -> PerceptualCalibrationResult | None:
    if row is None:
        return None
    metrics = json.loads(str(row["metrics_json"]))
    reasons = [] if row["status"] == "accepted" else [
        str(reason) for reason in metrics.get("reasons", [])
    ]
    if row["error_message"]:
        reasons.append(str(row["error_message"]))
    return PerceptualCalibrationResult(
        run_id=row["run_id"],
        status=row["status"],
        candidate_generation_enabled=enabled and row["status"] == "accepted",
        threshold=row["threshold"],
        evidence_work_count=row["evidence_work_count"],
        evaluated_work_count=row["evaluated_work_count"],
        positive_sample_count=row["positive_sample_count"],
        negative_sample_count=row["negative_sample_count"],
        positive_recall=row["positive_recall"],
        negative_ceiling=row["negative_ceiling"],
        safety_margin=row["safety_margin"],
        reasons=reasons,
    )
