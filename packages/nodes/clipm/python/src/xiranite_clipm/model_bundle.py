from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from typing import Any, Mapping

import numpy as np
from safetensors.numpy import load_file, save_file

from .contracts import (
    ActiveModelPointer,
    ClassificationHeadManifest,
    ModelBundleManifest,
    ModelBundleSource,
    PilotMetrics,
)


TRUSTED_PILOT_SHA256 = "797c8af006925ee38df3167d1059ab05ea5214312ccdc702b9abe08da479649a"
SIGLIP2_REVISION = "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2"
WEIGHTS_FILE = "heads.safetensors"
MANIFEST_FILE = "manifest.json"
ACTIVE_MODEL_FILE = "active-model.json"


class ClassificationHead:
    def __init__(self, manifest: ModelBundleManifest, tensors: Mapping[str, np.ndarray]):
        self.manifest = manifest
        self.mean = _vector(tensors, "classification.scaler_mean")
        self.scale = _vector(tensors, "classification.scaler_scale")
        self.coefficients = _vector(tensors, "classification.coefficients")
        intercept = np.asarray(tensors.get("classification.intercept"), dtype=np.float32)
        if intercept.shape != (1,) or not np.all(np.isfinite(intercept)):
            raise ValueError("classification.intercept must be one finite float")
        if np.any(self.scale <= 0):
            raise ValueError("classification scaler contains a non-positive scale")
        self.intercept = float(intercept[0])

    def predict_probability(self, embedding: np.ndarray) -> float:
        features = np.asarray(embedding, dtype=np.float32)
        if features.shape != (768,) or not np.all(np.isfinite(features)):
            raise ValueError("ClipM classification requires one finite 768-dimensional embedding")
        logit = float(np.dot((features - self.mean) / self.scale, self.coefficients) + self.intercept)
        if logit >= 0:
            return 1.0 / (1.0 + math.exp(-logit))
        exponential = math.exp(logit)
        return exponential / (1.0 + exponential)


class ModelBundleStore:
    def __init__(self, models_root: Path):
        self.models_root = models_root

    @property
    def active_pointer_path(self) -> Path:
        return self.models_root / ACTIVE_MODEL_FILE

    def bundle_path(self, bundle_version: int) -> Path:
        return self.models_root / f"v{bundle_version}"

    def active_version(self) -> int | None:
        if not self.active_pointer_path.is_file():
            return None
        pointer = ActiveModelPointer.model_validate_json(self.active_pointer_path.read_text(encoding="utf-8"))
        return pointer.bundle_version

    def load_active_head(self) -> ClassificationHead:
        version = self.active_version()
        if version is None:
            raise FileNotFoundError("No active ClipM model bundle is installed.")
        return self.load_head(version)

    def load_head(self, bundle_version: int) -> ClassificationHead:
        root = self.bundle_path(bundle_version)
        manifest = ModelBundleManifest.model_validate_json((root / MANIFEST_FILE).read_text(encoding="utf-8"))
        if manifest.bundle_version != bundle_version:
            raise ValueError(f"ClipM bundle directory v{bundle_version} contains manifest v{manifest.bundle_version}")
        weights_path = root / WEIGHTS_FILE
        if _sha256(weights_path) != manifest.weights_sha256:
            raise ValueError(f"ClipM bundle v{bundle_version} weights failed SHA-256 verification")
        return ClassificationHead(manifest, load_file(weights_path))

    def install_trusted_pilot(
        self,
        bundle: Mapping[str, Any],
        evaluation: Mapping[str, Any],
        source_path: Path,
        bundle_version: int = 1,
        created_at: datetime | None = None,
    ) -> ModelBundleManifest:
        source_hash = _sha256(source_path)
        if source_hash != TRUSTED_PILOT_SHA256:
            raise ValueError(f"Trusted pilot SHA-256 mismatch: {source_hash}")
        destination = self.bundle_path(bundle_version)
        if destination.exists():
            existing = self.load_head(bundle_version).manifest
            if existing.source.sha256 != source_hash:
                raise FileExistsError(f"Immutable ClipM bundle already exists with another source: {destination}")
            return existing
        tensors = _extract_classification_tensors(bundle)
        metrics = _extract_pilot_metrics(evaluation)
        self.models_root.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix=f".v{bundle_version}-", dir=self.models_root))
        try:
            weights_path = temporary / WEIGHTS_FILE
            save_file(tensors, weights_path, metadata={"format": "xiranite.clipm-heads", "schemaVersion": "1"})
            manifest = ModelBundleManifest(
                schema_version=1,
                bundle_version=bundle_version,
                encoder="google/siglip2-base-patch16-224",
                encoder_revision=SIGLIP2_REVISION,
                preprocess="white-letterbox-224/four-of-twelve/color-mono-v1",
                pooling="page-l2/mean/work-l2",
                classification_head=ClassificationHeadManifest(
                    kind="standard-scaler-logistic-regression",
                    feature_dimension=768,
                    regularization_c=0.01,
                    class_weight="balanced",
                    threshold=float(bundle["threshold"]),
                    metrics=metrics,
                ),
                ranking_head=None,
                weights_sha256=_sha256(weights_path),
                source=ModelBundleSource(
                    kind="trusted-joblib-import",
                    file_name=source_path.name,
                    sha256=source_hash,
                ),
                created_at=created_at or datetime.now(timezone.utc),
            )
            _write_json(temporary / MANIFEST_FILE, manifest.model_dump(mode="json", by_alias=True))
            os.replace(temporary, destination)
            return manifest
        finally:
            if temporary.exists():
                shutil.rmtree(temporary, ignore_errors=True)

    def activate(self, bundle_version: int, activated_at: datetime | None = None) -> ActiveModelPointer:
        self.load_head(bundle_version)
        pointer = ActiveModelPointer(
            schema_version=1,
            bundle_version=bundle_version,
            activated_at=activated_at or datetime.now(timezone.utc),
        )
        self.models_root.mkdir(parents=True, exist_ok=True)
        _write_json_atomic(self.active_pointer_path, pointer.model_dump(mode="json", by_alias=True))
        return pointer


def load_trusted_pilot(source_path: Path) -> Mapping[str, Any]:
    payload = source_path.read_bytes()
    source_hash = hashlib.sha256(payload).hexdigest()
    if source_hash != TRUSTED_PILOT_SHA256:
        raise ValueError(f"Trusted pilot SHA-256 mismatch: {source_hash}")

    import joblib

    return joblib.load(io.BytesIO(payload))


def register_model_bundle(
    connection: sqlite3.Connection,
    store: ModelBundleStore,
    manifest: ModelBundleManifest,
    activate: bool,
) -> None:
    root = store.bundle_path(manifest.bundle_version)
    metrics = manifest.classification_head.metrics.model_dump(mode="json", by_alias=True)
    connection.execute("BEGIN IMMEDIATE")
    try:
        existing = connection.execute(
            "SELECT manifest_path, weights_path FROM model_bundles WHERE bundle_version = ?",
            (manifest.bundle_version,),
        ).fetchone()
        if existing is not None:
            if Path(existing["manifest_path"]) != root / MANIFEST_FILE or Path(existing["weights_path"]) != root / WEIGHTS_FILE:
                raise ValueError(f"Database bundle v{manifest.bundle_version} points to different files")
            if activate:
                connection.execute("UPDATE model_bundles SET status = 'inactive' WHERE status = 'active'")
                connection.execute(
                    "UPDATE model_bundles SET status = 'active', activated_at = ? WHERE bundle_version = ?",
                    (datetime.now(timezone.utc).isoformat(), manifest.bundle_version),
                )
            connection.commit()
            if activate:
                store.activate(manifest.bundle_version)
            return
        revision = connection.execute(
            "INSERT INTO data_revisions(reason, created_at) VALUES (?, ?) RETURNING revision",
            (f"model-bundle-v{manifest.bundle_version}", manifest.created_at.isoformat()),
        ).fetchone()[0]
        if activate:
            connection.execute("UPDATE model_bundles SET status = 'inactive' WHERE status = 'active'")
        connection.execute(
            """INSERT INTO model_bundles(
                bundle_version, status, manifest_path, weights_path, metrics_json,
                data_revision, created_at, activated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                manifest.bundle_version,
                "active" if activate else "inactive",
                str(root / MANIFEST_FILE),
                str(root / WEIGHTS_FILE),
                json.dumps(metrics, separators=(",", ":")),
                revision,
                manifest.created_at.isoformat(),
                datetime.now(timezone.utc).isoformat() if activate else None,
            ),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    if activate:
        store.activate(manifest.bundle_version)


def _extract_classification_tensors(bundle: Mapping[str, Any]) -> dict[str, np.ndarray]:
    expected = {
        "format_version": 1,
        "embedding": "siglip2-letterbox",
        "pooling": "mean",
        "classifier": "logistic",
        "feature_dimension": 768,
    }
    for key, value in expected.items():
        if bundle.get(key) != value:
            raise ValueError(f"Trusted pilot field {key} is incompatible: {bundle.get(key)!r}")
    if bundle.get("parameters") != {"C": 0.01}:
        raise ValueError("Trusted pilot logistic regression parameters changed")
    model = bundle["model"]
    scaler = model.named_steps["scale"]
    classifier = model.named_steps["classifier"]
    if list(classifier.classes_) != [0, 1] or classifier.class_weight != "balanced" or classifier.C != 0.01:
        raise ValueError("Trusted pilot classifier configuration changed")
    tensors = {
        "classification.scaler_mean": np.ascontiguousarray(scaler.mean_, dtype=np.float32),
        "classification.scaler_scale": np.ascontiguousarray(scaler.scale_, dtype=np.float32),
        "classification.coefficients": np.ascontiguousarray(classifier.coef_[0], dtype=np.float32),
        "classification.intercept": np.ascontiguousarray(classifier.intercept_, dtype=np.float32),
    }
    _vector(tensors, "classification.scaler_mean")
    _vector(tensors, "classification.scaler_scale")
    _vector(tensors, "classification.coefficients")
    return tensors


def _extract_pilot_metrics(evaluation: Mapping[str, Any]) -> PilotMetrics:
    metrics = evaluation["winner"]["evaluation"]["metrics"]["all"]
    return PilotMetrics.model_validate(
        {
            key: metrics[key]
            for key in (
                "samples",
                "positive_samples",
                "negative_samples",
                "roc_auc",
                "macro_average_precision",
                "balanced_accuracy",
            )
        }
    )


def _vector(tensors: Mapping[str, np.ndarray], name: str) -> np.ndarray:
    value = np.asarray(tensors.get(name), dtype=np.float32)
    if value.shape != (768,) or not np.all(np.isfinite(value)):
        raise ValueError(f"{name} must be 768 finite floats")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as target:
        json.dump(value, target, ensure_ascii=False, indent=2)
        target.write("\n")
        target.flush()
        os.fsync(target.fileno())


def _write_json_atomic(path: Path, value: Mapping[str, Any]) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}-", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as target:
            json.dump(value, target, ensure_ascii=False, indent=2)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
