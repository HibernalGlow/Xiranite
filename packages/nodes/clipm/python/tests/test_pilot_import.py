from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pytest

from xiranite_clipm.model_bundle import ModelBundleStore, load_trusted_pilot


REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
PILOT_ROOT = REPOSITORY_ROOT / "artifacts" / "doujin-preference" / "pilot-v2"


def test_untrusted_pilot_is_rejected_before_joblib_load(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "substituted.joblib"
    source.write_bytes(b"not the trusted pilot")
    called = False

    def unsafe_loader(_source) -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(joblib, "load", unsafe_loader)
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        load_trusted_pilot(source)
    assert called is False


def test_trusted_pilot_import_reproduces_joblib_probabilities(tmp_path: Path) -> None:
    source = PILOT_ROOT / "evaluation" / "best_preference_model.joblib"
    evaluation_path = PILOT_ROOT / "evaluation" / "evaluation.json"
    embeddings_path = PILOT_ROOT / "embeddings" / "siglip2-letterbox.npz"
    bundle = load_trusted_pilot(source)
    import json

    evaluation = json.loads(evaluation_path.read_text(encoding="utf-8"))
    store = ModelBundleStore(tmp_path / "models")
    manifest = store.install_trusted_pilot(
        bundle,
        evaluation,
        source,
        created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
    )
    head = store.load_head(1)
    dataset = np.load(embeddings_path, allow_pickle=False)
    page_features = dataset["features"].astype(np.float32)
    offsets = dataset["offsets"]
    pooled = []
    for start, end in zip(offsets[:-1], offsets[1:], strict=True):
        feature = page_features[start:end].mean(axis=0)
        feature /= max(float(np.linalg.norm(feature)), 1e-12)
        pooled.append(feature)
    work_features = np.asarray(pooled, dtype=np.float32)
    expected = bundle["model"].predict_proba(work_features)[:, 1]
    actual = np.asarray([head.predict_probability(feature) for feature in work_features])
    assert np.max(np.abs(expected - actual)) < 1e-6
    assert manifest.classification_head.threshold == 0.48017321753783504
    assert manifest.classification_head.metrics.roc_auc == 0.8713991769547326
    assert manifest.classification_head.metrics.balanced_accuracy == 0.8032407407407407
