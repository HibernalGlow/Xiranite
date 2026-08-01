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
    RankingHeadManifest,
    RankingHeadMetrics,
)
from xiranite_clipm.model_bundle import ClassificationHead, ModelBundleStore


def manifest(weights_sha256: str) -> ModelBundleManifest:
    return ModelBundleManifest(
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
            threshold=0.48,
            metrics=PilotMetrics(
                samples=270,
                positive_samples=216,
                negative_samples=54,
                roc_auc=0.87,
                macro_average_precision=0.82,
                balanced_accuracy=0.80,
            ),
        ),
        ranking_head=None,
        weights_sha256=weights_sha256,
        source=ModelBundleSource(kind="trusted-joblib-import", file_name="pilot.joblib", sha256="0" * 64),
        created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
    )


def tensors() -> dict[str, np.ndarray]:
    return {
        "classification.scaler_mean": np.zeros(768, dtype=np.float32),
        "classification.scaler_scale": np.full(768, 2, dtype=np.float32),
        "classification.coefficients": np.ones(768, dtype=np.float32),
        "classification.intercept": np.array([-1], dtype=np.float32),
    }


def test_classification_head_applies_scaler_and_logistic_regression() -> None:
    head = ClassificationHead(manifest("0" * 64), tensors())
    assert head.predict_probability(np.zeros(768, dtype=np.float32)) == pytest.approx(0.268941421, abs=1e-8)
    assert head.predict_probability(np.full(768, 1 / 768, dtype=np.float32)) == pytest.approx(0.377540668, abs=1e-7)


def test_bundle_store_verifies_weights_and_atomic_active_pointer(tmp_path: Path) -> None:
    root = tmp_path / "models" / "v1"
    root.mkdir(parents=True)
    weights = root / "heads.safetensors"
    save_file(tensors(), weights)
    digest = hashlib.sha256(weights.read_bytes()).hexdigest()
    (root / "manifest.json").write_text(
        json.dumps(manifest(digest).model_dump(mode="json", by_alias=True)),
        encoding="utf-8",
    )
    store = ModelBundleStore(tmp_path / "models")
    pointer = store.activate(1, datetime(2026, 8, 1, tzinfo=timezone.utc))
    assert pointer.bundle_version == 1
    assert store.active_version() == 1
    assert store.load_active_head().manifest.weights_sha256 == digest

    weights.write_bytes(weights.read_bytes() + b"tampered")
    with pytest.raises(ValueError, match="SHA-256"):
        store.load_head(1)


def test_installs_immutable_training_candidate_with_ranking_head(tmp_path: Path) -> None:
    store = ModelBundleStore(tmp_path / "models")
    parent_root = store.bundle_path(1)
    parent_root.mkdir(parents=True)
    parent_weights = parent_root / "heads.safetensors"
    save_file(tensors(), parent_weights)
    parent_digest = hashlib.sha256(parent_weights.read_bytes()).hexdigest()
    parent_manifest = manifest(parent_digest)
    (parent_root / "manifest.json").write_text(
        json.dumps(parent_manifest.model_dump(mode="json", by_alias=True)),
        encoding="utf-8",
    )
    classification = parent_manifest.classification_head
    ranking = RankingHeadManifest(
        kind="standard-scaler-ridge-cv",
        feature_dimension=768,
        alpha=1.0,
        metrics=RankingHeadMetrics(
            correction_samples=25,
            oof_splits=5,
            baseline_weighted_mae=100.0,
            candidate_weighted_mae=20.0,
            baseline_spearman=0.1,
            candidate_spearman=0.8,
        ),
        validation_status="accepted",
        validation_reasons=["ranking_weighted_mae_improved"],
    )
    candidate_tensors = {
        **tensors(),
        "ranking.scaler_mean": np.zeros(768, dtype=np.float32),
        "ranking.scaler_scale": np.ones(768, dtype=np.float32),
        "ranking.coefficients": np.ones(768, dtype=np.float32),
        "ranking.intercept": np.array([5], dtype=np.float32),
    }
    run_id = UUID("018f0000-0000-7000-8000-000000000001")
    installed = store.install_training_candidate(
        bundle_version=2,
        parent_bundle_version=1,
        training_run_id=run_id,
        trained_head="ranking",
        classification_head=classification,
        ranking_head=ranking,
        tensors=candidate_tensors,
        created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
    )
    loaded = store.load_bundle(2)

    assert installed.source.training_run_id == run_id
    assert loaded.ranking is not None
    assert loaded.ranking.predict_score(np.zeros(768, dtype=np.float32), 500) == 505
    assert store.install_training_candidate(
        bundle_version=2,
        parent_bundle_version=1,
        training_run_id=run_id,
        trained_head="ranking",
        classification_head=classification,
        ranking_head=ranking,
        tensors=candidate_tensors,
    ) == installed
    with pytest.raises(FileExistsError, match="another source"):
        store.install_training_candidate(
            bundle_version=2,
            parent_bundle_version=1,
            training_run_id=UUID("018f0000-0000-7000-8000-000000000002"),
            trained_head="ranking",
            classification_head=classification,
            ranking_head=ranking,
            tensors=candidate_tensors,
        )
    changed_classification = dict(candidate_tensors)
    changed_classification["classification.intercept"] = np.array([99], dtype=np.float32)
    with pytest.raises(ValueError, match="preserve its parent classification tensors"):
        store.install_training_candidate(
            bundle_version=3,
            parent_bundle_version=1,
            training_run_id=run_id,
            trained_head="ranking",
            classification_head=classification,
            ranking_head=ranking,
            tensors=changed_classification,
        )
