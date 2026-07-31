from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from safetensors.numpy import save_file

from xiranite_clipm.contracts import (
    ClassificationHeadManifest,
    ModelBundleManifest,
    ModelBundleSource,
    PilotMetrics,
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
