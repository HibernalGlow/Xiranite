from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import sqlite3
from typing import Literal
from uuid import UUID, uuid4

import numpy as np

from .contracts import (
    ClassificationHeadManifest,
    ModelBundleStatus,
    PilotMetrics,
    RankingHeadManifest,
    RankingHeadMetrics,
)
from .head_training import (
    CLASSIFICATION_REGULARIZATION_C,
    ClassificationHeadParameters,
    ClassificationTrainingResult,
    HeadTrainingStatus,
    RankingTrainingResult,
    train_classification_candidate,
    train_ranking_candidate,
)
from .locks import exclusive_file_lock
from .model_bundle import ModelBundleHeads, ModelBundleStore
from .model_lifecycle import (
    activate_model_bundle,
    active_bundle_version,
    next_bundle_version,
    register_training_bundle,
)
from .training_baseline import TrainingBaselineStore
from .training_dataset import TrainingDatasetSnapshot, build_training_dataset_snapshot


@dataclass(frozen=True, slots=True)
class HeadTrainingOutcome:
    status: str
    reasons: tuple[str, ...]
    bundle_version: int | None


@dataclass(frozen=True, slots=True)
class TrainingWorkflowResult:
    run_id: UUID
    data_revision: int
    classification: HeadTrainingOutcome
    ranking: HeadTrainingOutcome
    active_bundle_version: int


def train_heads(
    connection: sqlite3.Connection,
    baseline_store: TrainingBaselineStore,
    bundle_store: ModelBundleStore,
) -> TrainingWorkflowResult:
    snapshot = build_training_dataset_snapshot(connection, baseline_store)
    return train_snapshot(connection, bundle_store, snapshot)


def train_snapshot(
    connection: sqlite3.Connection,
    bundle_store: ModelBundleStore,
    snapshot: TrainingDatasetSnapshot,
    *,
    run_id: UUID | None = None,
    started_at: datetime | None = None,
) -> TrainingWorkflowResult:
    with exclusive_file_lock(bundle_store.models_root / ".training.lock"):
        return _train_snapshot_locked(
            connection,
            bundle_store,
            snapshot,
            run_id=run_id,
            started_at=started_at,
        )


def _train_snapshot_locked(
    connection: sqlite3.Connection,
    bundle_store: ModelBundleStore,
    snapshot: TrainingDatasetSnapshot,
    *,
    run_id: UUID | None,
    started_at: datetime | None,
) -> TrainingWorkflowResult:
    run_id = run_id or uuid4()
    started_at = started_at or datetime.now(timezone.utc)
    _start_training_run(connection, run_id, snapshot.data_revision, started_at)
    try:
        parent_version = active_bundle_version(connection, bundle_store)
        parent = bundle_store.load_bundle(parent_version)
        active_parameters = ClassificationHeadParameters(
            scaler_mean=parent.classification.mean,
            scaler_scale=parent.classification.scale,
            coefficients=parent.classification.coefficients,
            intercept=parent.classification.intercept,
            threshold=parent.manifest.classification_head.threshold,
        )
        classification_result = train_classification_candidate(
            snapshot.classification,
            snapshot.classification_feedback_count,
            active_parameters,
        )
        ranking_result = train_ranking_candidate(snapshot.ranking)

        classification_outcome, parent = _persist_classification(
            connection,
            bundle_store,
            snapshot,
            run_id,
            parent,
            classification_result,
        )
        ranking_outcome, parent = _persist_ranking(
            connection,
            bundle_store,
            snapshot,
            run_id,
            parent,
            ranking_result,
        )
        result = TrainingWorkflowResult(
            run_id=run_id,
            data_revision=snapshot.data_revision,
            classification=classification_outcome,
            ranking=ranking_outcome,
            active_bundle_version=active_bundle_version(connection, bundle_store),
        )
        _finish_training_run(connection, result)
        return result
    except Exception as error:
        _fail_training_run(connection, run_id, error)
        raise


def _persist_classification(
    connection: sqlite3.Connection,
    store: ModelBundleStore,
    snapshot: TrainingDatasetSnapshot,
    run_id: UUID,
    parent: ModelBundleHeads,
    result: ClassificationTrainingResult,
) -> tuple[HeadTrainingOutcome, ModelBundleHeads]:
    if result.parameters is None or result.metrics is None:
        return HeadTrainingOutcome(result.status.value, result.reasons, None), parent
    metrics = result.metrics
    validation_labels = np.asarray(snapshot.classification.validation_labels)
    manifest = ClassificationHeadManifest(
        kind="standard-scaler-logistic-regression",
        feature_dimension=768,
        regularization_c=CLASSIFICATION_REGULARIZATION_C,
        class_weight="balanced",
        threshold=result.parameters.threshold,
        metrics=PilotMetrics(
            samples=int(validation_labels.size),
            positive_samples=int(np.count_nonzero(validation_labels == 1)),
            negative_samples=int(np.count_nonzero(validation_labels == 0)),
            roc_auc=metrics.candidate_validation_roc_auc,
            macro_average_precision=metrics.candidate_validation_macro_average_precision,
            balanced_accuracy=metrics.candidate_validation_balanced_accuracy,
            correction_samples=metrics.correction_samples,
            oof_splits=metrics.oof_splits,
            active_correction_log_loss=metrics.active_correction_log_loss,
            candidate_correction_log_loss=metrics.candidate_correction_log_loss,
            active_validation_roc_auc=metrics.active_validation_roc_auc,
            active_validation_balanced_accuracy=metrics.active_validation_balanced_accuracy,
            active_validation_macro_average_precision=metrics.active_validation_macro_average_precision,
        ),
        validation_status=result.status.value,
        validation_reasons=list(result.reasons),
    )
    tensors = {**parent.tensors, **result.parameters.tensors()}
    bundle = _install_and_register(
        connection,
        store,
        snapshot.data_revision,
        run_id,
        parent,
        "classification",
        manifest,
        parent.manifest.ranking_head,
        tensors,
        result.status,
    )
    if result.status is HeadTrainingStatus.ACCEPTED:
        activate_model_bundle(connection, store, bundle.manifest.bundle_version)
        parent = store.load_bundle(bundle.manifest.bundle_version)
    return HeadTrainingOutcome(result.status.value, result.reasons, bundle.manifest.bundle_version), parent


def _persist_ranking(
    connection: sqlite3.Connection,
    store: ModelBundleStore,
    snapshot: TrainingDatasetSnapshot,
    run_id: UUID,
    parent: ModelBundleHeads,
    result: RankingTrainingResult,
) -> tuple[HeadTrainingOutcome, ModelBundleHeads]:
    if result.parameters is None or result.metrics is None:
        return HeadTrainingOutcome(result.status.value, result.reasons, None), parent
    metrics = result.metrics
    manifest = RankingHeadManifest(
        kind="standard-scaler-ridge-cv",
        feature_dimension=768,
        alpha=result.parameters.alpha,
        metrics=RankingHeadMetrics(
            correction_samples=metrics.correction_samples,
            oof_splits=metrics.oof_splits,
            baseline_weighted_mae=metrics.baseline_weighted_mae,
            candidate_weighted_mae=metrics.candidate_weighted_mae,
            baseline_spearman=metrics.baseline_spearman,
            candidate_spearman=metrics.candidate_spearman,
        ),
        validation_status=result.status.value,
        validation_reasons=list(result.reasons),
    )
    tensors = {**parent.tensors, **result.parameters.tensors()}
    bundle = _install_and_register(
        connection,
        store,
        snapshot.data_revision,
        run_id,
        parent,
        "ranking",
        parent.manifest.classification_head,
        manifest,
        tensors,
        result.status,
    )
    if result.status is HeadTrainingStatus.ACCEPTED:
        activate_model_bundle(connection, store, bundle.manifest.bundle_version)
        parent = store.load_bundle(bundle.manifest.bundle_version)
    return HeadTrainingOutcome(result.status.value, result.reasons, bundle.manifest.bundle_version), parent


def _install_and_register(
    connection: sqlite3.Connection,
    store: ModelBundleStore,
    data_revision: int,
    run_id: UUID,
    parent: ModelBundleHeads,
    trained_head: Literal["classification", "ranking"],
    classification_head: ClassificationHeadManifest,
    ranking_head: RankingHeadManifest | None,
    tensors: dict[str, np.ndarray],
    status: HeadTrainingStatus,
) -> ModelBundleHeads:
    bundle_version = next_bundle_version(connection, store)
    manifest = store.install_training_candidate(
        bundle_version=bundle_version,
        parent_bundle_version=parent.manifest.bundle_version,
        training_run_id=run_id,
        trained_head=trained_head,
        classification_head=classification_head,
        ranking_head=ranking_head,
        tensors=tensors,
    )
    register_training_bundle(
        connection,
        store,
        manifest,
        data_revision,
        ModelBundleStatus.CANDIDATE if status is HeadTrainingStatus.ACCEPTED else ModelBundleStatus.FAILED,
    )
    return store.load_bundle(bundle_version)


def _start_training_run(
    connection: sqlite3.Connection,
    run_id: UUID,
    data_revision: int,
    started_at: datetime,
) -> None:
    config = {
        "classification": {"C": CLASSIFICATION_REGULARIZATION_C, "classWeight": "balanced"},
        "ranking": {"kind": "RidgeCV", "minimumCorrections": 20},
        "validation": {"balancedAccuracyMaxDrop": 0.03, "rocAucMaxDrop": 0.02},
    }
    connection.execute(
        """INSERT INTO training_runs(
            run_id, data_revision, config_json, status, started_at
        ) VALUES (?, ?, ?, 'running', ?)""",
        (str(run_id), data_revision, json.dumps(config, separators=(",", ":")), started_at.isoformat()),
    )


def _finish_training_run(connection: sqlite3.Connection, result: TrainingWorkflowResult) -> None:
    payload = asdict(result)
    payload["run_id"] = str(result.run_id)
    connection.execute(
        """UPDATE training_runs SET status = 'succeeded', finished_at = ?, result_json = ?
           WHERE run_id = ?""",
        (
            datetime.now(timezone.utc).isoformat(),
            json.dumps(payload, separators=(",", ":")),
            str(result.run_id),
        ),
    )


def _fail_training_run(connection: sqlite3.Connection, run_id: UUID, error: Exception) -> None:
    connection.execute(
        """UPDATE training_runs SET status = 'failed', finished_at = ?, error_message = ?
           WHERE run_id = ?""",
        (datetime.now(timezone.utc).isoformat(), str(error), str(run_id)),
    )
