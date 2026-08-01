from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from uuid import UUID

import numpy as np
import pytest
from safetensors.numpy import save_file

from xiranite_clipm.contracts import (
    ClassificationHeadManifest,
    ModelBundleManifest,
    ModelBundleSource,
    PilotMetrics,
)
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.model_bundle import ModelBundleStore, register_model_bundle
from xiranite_clipm.model_lifecycle import (
    activate_model_bundle,
    active_bundle_version,
    list_model_bundles,
)
from xiranite_clipm.training_dataset import (
    ClassificationTrainingData,
    RankingTrainingData,
    TrainingDatasetSnapshot,
)
from xiranite_clipm.training_workflow import train_snapshot, train_snapshot_steps


def _install_active_pilot(
    connection,
    store: ModelBundleStore,
    *,
    inverted: bool = False,
) -> None:
    root = store.bundle_path(1)
    root.mkdir(parents=True)
    coefficients = np.zeros(768, dtype=np.float32)
    if inverted:
        coefficients[0] = -4.0
    tensors = {
        "classification.scaler_mean": np.zeros(768, dtype=np.float32),
        "classification.scaler_scale": np.ones(768, dtype=np.float32),
        "classification.coefficients": coefficients,
        "classification.intercept": np.zeros(1, dtype=np.float32),
    }
    weights = root / "heads.safetensors"
    save_file(tensors, weights)
    digest = hashlib.sha256(weights.read_bytes()).hexdigest()
    manifest = ModelBundleManifest(
        schema_version=1,
        bundle_version=1,
        encoder="google/siglip2-base-patch16-224",
        encoder_revision="75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
        preprocess="white-letterbox-224/four-of-twelve/color-mono-v1",
        pooling="page-l2/mean/work-l2",
        classification_head=ClassificationHeadManifest(
            kind="standard-scaler-logistic-regression",
            feature_dimension=768,
            regularization_c=0.01,
            class_weight="balanced",
            threshold=0.5,
            metrics=PilotMetrics(
                samples=50,
                positive_samples=25,
                negative_samples=25,
                roc_auc=0.5,
                macro_average_precision=0.5,
                balanced_accuracy=0.5,
            ),
        ),
        ranking_head=None,
        weights_sha256=digest,
        source=ModelBundleSource(
            kind="trusted-joblib-import",
            file_name="pilot.joblib",
            sha256="0" * 64,
        ),
        created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
    )
    (root / "manifest.json").write_text(
        json.dumps(manifest.model_dump(mode="json", by_alias=True)),
        encoding="utf-8",
    )
    register_model_bundle(connection, store, manifest, activate=True)


def _snapshot(*, inverted_validation: bool = False, ranking_samples: int = 25) -> TrainingDatasetSnapshot:
    classification_samples = 48
    labels = np.tile(np.array([0, 1], dtype=np.int8), classification_samples // 2)
    features = np.zeros((classification_samples, 768), dtype=np.float32)
    features[:, 0] = np.where(labels == 1, 2.0, -2.0)
    validation_labels = np.tile(np.array([0, 1], dtype=np.int8), 8)
    validation_features = np.zeros((validation_labels.size, 768), dtype=np.float32)
    direction = -1.0 if inverted_validation else 1.0
    validation_features[:, 0] = direction * np.where(validation_labels == 1, 2.0, -2.0)

    signal = np.linspace(-1.0, 1.0, ranking_samples)
    ranking_features = np.zeros((ranking_samples, 768), dtype=np.float32)
    ranking_features[:, 0] = signal
    baseline_scores = np.full(ranking_samples, 500.0)
    target_scores = baseline_scores + signal * 180.0
    return TrainingDatasetSnapshot(
        data_revision=1,
        classification_feedback_count=20,
        ranking_feedback_count=ranking_samples,
        classification=ClassificationTrainingData(
            features=features,
            labels=labels,
            sample_weights=np.concatenate((np.ones(28), np.full(20, 3.0))),
            groups=np.array([f"classification-{index}" for index in range(classification_samples)]),
            sample_ids=np.array([f"classification-{index}" for index in range(classification_samples)]),
            validation_features=validation_features,
            validation_labels=validation_labels,
            validation_groups=np.array([f"validation-{index}" for index in range(validation_labels.size)]),
        ),
        ranking=RankingTrainingData(
            features=ranking_features,
            residuals=target_scores - baseline_scores,
            sample_weights=np.full(ranking_samples, 3.0),
            groups=np.array([f"ranking-{index}" for index in range(ranking_samples)]),
            sample_ids=np.array([f"ranking-{index}" for index in range(ranking_samples)]),
            baseline_scores=baseline_scores,
            target_scores=target_scores,
        ),
    )


def test_training_activates_each_passing_head_as_an_independent_bundle(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    store = ModelBundleStore(tmp_path / "models")
    try:
        _install_active_pilot(connection, store)
        result = train_snapshot(
            connection,
            store,
            _snapshot(),
            run_id=UUID("018f0000-0000-7000-8000-000000000010"),
        )

        assert result.classification.status == "accepted"
        assert result.classification.bundle_version == 2
        assert result.ranking.status == "accepted"
        assert result.ranking.bundle_version == 3
        assert result.active_bundle_version == 3
        assert active_bundle_version(connection, store) == 3
        statuses = connection.execute(
            "SELECT bundle_version, status FROM model_bundles ORDER BY bundle_version"
        ).fetchall()
        assert [tuple(row) for row in statuses] == [(1, "inactive"), (2, "inactive"), (3, "active")]
        assert store.load_bundle(2).manifest.source.trained_head == "classification"
        final = store.load_bundle(3)
        assert final.manifest.source.parent_bundle_version == 2
        assert final.manifest.source.trained_head == "ranking"
        assert final.ranking is not None
        listed = list_model_bundles(connection, store)
        assert listed.active_bundle_version == 3
        assert [model.bundle_version for model in listed.models] == [3, 2, 1]
        assert listed.models[0].ranking_validation_status == "accepted"
        run = connection.execute("SELECT status, result_json FROM training_runs").fetchone()
        assert run["status"] == "succeeded"
        assert json.loads(run["result_json"])["active_bundle_version"] == 3
    finally:
        connection.close()


def test_rejected_head_stays_failed_until_force_activation_and_can_rollback(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    store = ModelBundleStore(tmp_path / "models")
    try:
        _install_active_pilot(connection, store, inverted=True)
        result = train_snapshot(
            connection,
            store,
            _snapshot(inverted_validation=True, ranking_samples=19),
            run_id=UUID("018f0000-0000-7000-8000-000000000020"),
        )

        assert result.classification.status == "rejected"
        assert result.classification.bundle_version == 2
        assert result.ranking.status == "skipped"
        assert result.ranking.bundle_version is None
        assert active_bundle_version(connection, store) == 1
        assert connection.execute(
            "SELECT status FROM model_bundles WHERE bundle_version = 2"
        ).fetchone()[0] == "failed"
        assert store.load_bundle(2).manifest.classification_head.validation_status == "rejected"
        assert [model.bundle_version for model in list_model_bundles(
            connection, store, include_failed=False
        ).models] == [1]
        with pytest.raises(ValueError, match="force activation"):
            activate_model_bundle(connection, store, 2)
        activate_model_bundle(connection, store, 2, force=True)
        assert active_bundle_version(connection, store) == 2
        activate_model_bundle(connection, store, 1)
        assert active_bundle_version(connection, store) == 1
        assert connection.execute(
            "SELECT status FROM model_bundles WHERE bundle_version = 2"
        ).fetchone()[0] == "failed"
    finally:
        connection.close()


def test_training_steps_report_safe_persistence_boundaries(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    store = ModelBundleStore(tmp_path / "models")
    try:
        _install_active_pilot(connection, store)
        steps = train_snapshot_steps(
            connection,
            store,
            _snapshot(),
            run_id=UUID("018f0000-0000-7000-8000-000000000030"),
        )
        progress = []
        while True:
            try:
                progress.append(next(steps))
            except StopIteration as completed:
                result = completed.value
                break

        assert [item.progress for item in progress] == [20, 45, 60, 80, 95]
        assert result.active_bundle_version == 3
        assert connection.execute(
            "SELECT status FROM training_runs WHERE run_id = ?",
            (str(result.run_id),),
        ).fetchone()[0] == "succeeded"
    finally:
        connection.close()


def test_closing_training_steps_marks_the_run_cancelled_at_a_safe_checkpoint(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    store = ModelBundleStore(tmp_path / "models")
    run_id = UUID("018f0000-0000-7000-8000-000000000040")
    try:
        _install_active_pilot(connection, store)
        steps = train_snapshot_steps(connection, store, _snapshot(), run_id=run_id)
        assert next(steps).progress == 20
        assert next(steps).progress == 45
        assert next(steps).progress == 60

        steps.close()

        run = connection.execute(
            "SELECT status, error_message FROM training_runs WHERE run_id = ?",
            (str(run_id),),
        ).fetchone()
        assert tuple(run) == ("cancelled", "Training cancelled at a safe checkpoint.")
        assert active_bundle_version(connection, store) == 2
        assert store.load_bundle(2).manifest.source.trained_head == "classification"
        assert connection.execute("SELECT count(*) FROM model_bundles").fetchone()[0] == 2
    finally:
        connection.close()
