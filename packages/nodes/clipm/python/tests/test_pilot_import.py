from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pytest
from sklearn.metrics import average_precision_score, balanced_accuracy_score, roc_auc_score

from xiranite_clipm.model_bundle import ModelBundleStore, load_trusted_pilot
from xiranite_clipm.training_baseline import TrainingBaselineStore


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
    oof_scores_path = PILOT_ROOT / "evaluation" / "winner_oof_scores.csv"
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
    with oof_scores_path.open(encoding="utf-8", newline="") as source_file:
        oof_rows = list(csv.DictReader(source_file))
    labels = np.asarray([int(row["label"]) for row in oof_rows], dtype=np.int64)
    oof_scores = np.asarray([float(row["oof_score"]) for row in oof_rows], dtype=np.float64)
    oof_predictions = np.asarray([int(row["oof_prediction"]) for row in oof_rows], dtype=np.int64)
    macro_average_precision = (
        average_precision_score(labels, oof_scores)
        + average_precision_score(1 - labels, 1.0 - oof_scores)
    ) / 2
    assert len(oof_rows) == 270
    assert manifest.classification_head.threshold == 0.48017321753783504
    assert roc_auc_score(labels, oof_scores) == pytest.approx(0.8713991769547326)
    assert macro_average_precision == pytest.approx(0.8266456011673671)
    assert balanced_accuracy_score(labels, oof_predictions) == pytest.approx(0.8032407407407407)
    assert manifest.classification_head.metrics.roc_auc == pytest.approx(roc_auc_score(labels, oof_scores))
    assert manifest.classification_head.metrics.macro_average_precision == pytest.approx(macro_average_precision)
    assert manifest.classification_head.metrics.balanced_accuracy == pytest.approx(
        balanced_accuracy_score(labels, oof_predictions)
    )

    baseline_store = TrainingBaselineStore(tmp_path / "training")
    baseline = baseline_store.install_trusted_pilot(
        embeddings_path,
        created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
    )
    arrays = baseline_store.load_arrays()
    assert baseline.samples == 270
    assert baseline.positive_samples == 216
    assert baseline.negative_samples == 54
    assert int(arrays["validation_mask"].sum()) == baseline.validation_samples
    assert not set(arrays["groups"][arrays["validation_mask"]]).intersection(
        arrays["groups"][~arrays["validation_mask"]]
    )
    assert baseline_store.install_trusted_pilot(embeddings_path) == baseline
