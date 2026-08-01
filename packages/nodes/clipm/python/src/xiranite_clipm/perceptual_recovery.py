from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from itertools import combinations
import json
import sqlite3

import numpy as np

from .contracts import PerceptualRecoveryObservation, PerceptualRecoveryStatus


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
             (SELECT count(DISTINCT work_id) FROM page_embeddings) AS embedded_work_count,
             (SELECT count(*) FROM perceptual_similarity_observations) AS observation_count"""
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
        candidate_generation_enabled=False,
        threshold=None,
        calibration_status="collecting_telemetry",
        embedded_work_count=int(counts["embedded_work_count"]),
        observation_count=int(counts["observation_count"]),
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


def _normalized_page_matrix(value: np.ndarray) -> np.ndarray:
    matrix = np.asarray(value, dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[1] != 768:
        raise ValueError("page embeddings must have shape [pages, 768]")
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    if np.any(norms <= 1e-12):
        raise ValueError("page embeddings must be non-zero")
    return matrix / norms


def _consensus_key(consensus: OrderedPageConsensus) -> tuple[float, int]:
    return consensus.mean_similarity, consensus.matched_page_count
