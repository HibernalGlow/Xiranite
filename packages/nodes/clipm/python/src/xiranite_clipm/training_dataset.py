from __future__ import annotations

from dataclasses import dataclass
import sqlite3

import numpy as np

from .training_baseline import TrainingBaselineStore


@dataclass(frozen=True, slots=True)
class ClassificationTrainingData:
    features: np.ndarray
    labels: np.ndarray
    sample_weights: np.ndarray
    groups: np.ndarray
    sample_ids: np.ndarray
    validation_features: np.ndarray
    validation_labels: np.ndarray
    validation_groups: np.ndarray


@dataclass(frozen=True, slots=True)
class RankingTrainingData:
    features: np.ndarray
    residuals: np.ndarray
    sample_weights: np.ndarray
    groups: np.ndarray
    sample_ids: np.ndarray
    baseline_scores: np.ndarray
    target_scores: np.ndarray


@dataclass(frozen=True, slots=True)
class TrainingDatasetSnapshot:
    data_revision: int
    classification_feedback_count: int
    ranking_feedback_count: int
    classification: ClassificationTrainingData
    ranking: RankingTrainingData


def build_training_dataset_snapshot(
    connection: sqlite3.Connection,
    baseline_store: TrainingBaselineStore,
) -> TrainingDatasetSnapshot:
    baseline = baseline_store.load_arrays()
    connection.execute("BEGIN")
    try:
        data_revision = int(connection.execute("SELECT COALESCE(MAX(revision), 0) FROM data_revisions").fetchone()[0])
        classification_rows = _latest_feedback_rows(connection, "classification_after")
        ranking_rows = _latest_feedback_rows(connection, "ranking_after")
        connection.commit()
    except Exception:
        connection.rollback()
        raise

    validation_mask = np.asarray(baseline["validation_mask"], dtype=np.bool_)
    baseline_features = np.asarray(baseline["embeddings"], dtype=np.float32)
    baseline_labels = np.asarray(baseline["labels"], dtype=np.int8)
    baseline_groups = np.asarray(baseline["groups"]).astype(str)
    baseline_ids = np.asarray(baseline["work_ids"]).astype(str)
    training_mask = ~validation_mask

    correction_features = _row_features(classification_rows)
    correction_labels = np.asarray(
        [1 if str(row["feedback_value"]) == "P" else 0 for row in classification_rows],
        dtype=np.int8,
    )
    correction_ids = np.asarray([str(row["work_id"]) for row in classification_rows])
    correction_groups = np.asarray([f"work:{work_id}" for work_id in correction_ids])
    classification = ClassificationTrainingData(
        features=_append_features(baseline_features[training_mask], correction_features),
        labels=np.concatenate((baseline_labels[training_mask], correction_labels)),
        sample_weights=np.concatenate(
            (
                np.ones(int(training_mask.sum()), dtype=np.float64),
                np.full(len(classification_rows), 3.0, dtype=np.float64),
            )
        ),
        groups=np.concatenate((baseline_groups[training_mask], correction_groups)),
        sample_ids=np.concatenate((baseline_ids[training_mask], correction_ids)),
        validation_features=baseline_features[validation_mask],
        validation_labels=baseline_labels[validation_mask],
        validation_groups=baseline_groups[validation_mask],
    )

    ranking_features = _row_features(ranking_rows)
    baseline_scores = np.asarray([int(row["predicted_score"]) for row in ranking_rows], dtype=np.float64)
    target_scores = np.asarray([int(row["feedback_value"]) for row in ranking_rows], dtype=np.float64)
    ranking_ids = np.asarray([str(row["work_id"]) for row in ranking_rows])
    ranking = RankingTrainingData(
        features=ranking_features,
        residuals=target_scores - baseline_scores,
        sample_weights=np.full(len(ranking_rows), 3.0, dtype=np.float64),
        groups=np.asarray([f"work:{work_id}" for work_id in ranking_ids]),
        sample_ids=ranking_ids,
        baseline_scores=baseline_scores,
        target_scores=target_scores,
    )
    return TrainingDatasetSnapshot(
        data_revision=data_revision,
        classification_feedback_count=len(classification_rows),
        ranking_feedback_count=len(ranking_rows),
        classification=classification,
        ranking=ranking,
    )


def _latest_feedback_rows(connection: sqlite3.Connection, field: str) -> list[sqlite3.Row]:
    if field not in {"classification_after", "ranking_after"}:
        raise ValueError(f"Unsupported feedback field: {field}")
    return connection.execute(
        f"""WITH ranked AS (
              SELECT feedback_events.work_id, feedback_events.{field} AS feedback_value,
                     embeddings.data,
                     (SELECT predicted_score FROM score_snapshots
                      WHERE score_snapshots.work_id = feedback_events.work_id
                      ORDER BY snapshot_id DESC LIMIT 1) AS predicted_score,
                     ROW_NUMBER() OVER (
                       PARTITION BY feedback_events.work_id
                       ORDER BY feedback_events.occurred_at DESC, feedback_events.event_id DESC
                     ) AS row_number
              FROM feedback_events
              JOIN embeddings ON embeddings.work_id = feedback_events.work_id
                AND embeddings.encoder = 'google/siglip2-base-patch16-224'
                AND embeddings.preprocess = 'white-letterbox-224/four-of-twelve/color-mono-v1'
              WHERE feedback_events.{field} IS NOT NULL
                AND feedback_events.undone_by IS NULL
                AND feedback_events.event_id NOT IN (
                  SELECT undone_by FROM feedback_events WHERE undone_by IS NOT NULL
                )
            )
            SELECT work_id, feedback_value, data, predicted_score
            FROM ranked WHERE row_number = 1 ORDER BY work_id"""
    ).fetchall()


def _row_features(rows: list[sqlite3.Row]) -> np.ndarray:
    if not rows:
        return np.empty((0, 768), dtype=np.float32)
    features = np.asarray(
        [np.frombuffer(bytes(row["data"]), dtype="<f2").astype(np.float32) for row in rows],
        dtype=np.float32,
    )
    if features.shape != (len(rows), 768) or not np.all(np.isfinite(features)):
        raise ValueError("ClipM feedback embeddings are invalid")
    return features


def _append_features(baseline: np.ndarray, corrections: np.ndarray) -> np.ndarray:
    return np.concatenate((np.asarray(baseline, dtype=np.float32), corrections), axis=0)
