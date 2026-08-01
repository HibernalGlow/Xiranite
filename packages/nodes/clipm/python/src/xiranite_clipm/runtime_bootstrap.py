from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from uuid import uuid4

from .contracts import ModelBundleManifest
from .locks import exclusive_file_lock
from .model_bundle import ModelBundleStore, register_model_bundle
from .model_lifecycle import ensure_active_model_bundle
from .training_baseline import TrainingBaselineManifest, TrainingBaselineStore


PACKAGED_MODEL_MANIFEST_SHA256 = "bf54af3150049c0e9347132dc3445f035cfd8a32f62f907e20d9edf780dff292"
PACKAGED_MODEL_WEIGHTS_SHA256 = "3dfe32839407269a646a199a324ea8cc49a806eca54fe5d766c22b88683fd6cd"
PACKAGED_BASELINE_MANIFEST_SHA256 = "11ed02d4e7d989a7436caf95f6ebfd7da53101abf9dfdf8f71b614e01748ff8b"
PACKAGED_BASELINE_DATA_SHA256 = "f0dbb5b8732e5c9a6b3e73487d560fedb6f64920d36f162b8896a8d581fb7633"
PACKAGED_SEED_ROOT = Path(__file__).with_name("seed_assets")


@dataclass(frozen=True, slots=True)
class RuntimeBootstrapResult:
    model_installed: bool
    baseline_installed: bool
    active_bundle_version: int
    recovered_paths: tuple[Path, ...]


def bootstrap_clipm_runtime(
    connection: sqlite3.Connection,
    bundle_store: ModelBundleStore,
    baseline_store: TrainingBaselineStore,
    *,
    seed_root: Path = PACKAGED_SEED_ROOT,
) -> RuntimeBootstrapResult:
    seed_bundle_store = ModelBundleStore(seed_root / "models")
    seed_baseline_store = TrainingBaselineStore(seed_root / "training")
    seed_model, seed_baseline = _validate_packaged_seed(seed_bundle_store, seed_baseline_store)
    recovered_paths: list[Path] = []

    with exclusive_file_lock(bundle_store.models_root / ".model-activation.lock"):
        model, model_installed = _ensure_model_bundle(
            bundle_store,
            seed_bundle_store,
            seed_model,
            recovered_paths,
        )
        baseline_installed = _ensure_training_baseline(
            baseline_store,
            seed_baseline_store,
            seed_baseline,
            recovered_paths,
        )
        register_model_bundle(connection, bundle_store, model, activate=False)

    active_bundle_version = ensure_active_model_bundle(connection, bundle_store, fallback_bundle_version=1)
    return RuntimeBootstrapResult(
        model_installed=model_installed,
        baseline_installed=baseline_installed,
        active_bundle_version=active_bundle_version,
        recovered_paths=tuple(recovered_paths),
    )


def _validate_packaged_seed(
    bundle_store: ModelBundleStore,
    baseline_store: TrainingBaselineStore,
) -> tuple[ModelBundleManifest, TrainingBaselineManifest]:
    model_root = bundle_store.bundle_path(1)
    _require_hash(model_root / "manifest.json", PACKAGED_MODEL_MANIFEST_SHA256)
    _require_hash(model_root / "heads.safetensors", PACKAGED_MODEL_WEIGHTS_SHA256)
    model = bundle_store.load_bundle(1).manifest
    if model.weights_sha256 != PACKAGED_MODEL_WEIGHTS_SHA256:
        raise ValueError("Packaged ClipM v1 manifest does not reference the trusted seed weights")

    _require_hash(baseline_store.manifest_path, PACKAGED_BASELINE_MANIFEST_SHA256)
    _require_hash(baseline_store.data_path, PACKAGED_BASELINE_DATA_SHA256)
    baseline = baseline_store.load_manifest()
    baseline_store.load_arrays()
    if baseline.data_sha256 != PACKAGED_BASELINE_DATA_SHA256:
        raise ValueError("Packaged ClipM baseline manifest does not reference the trusted seed data")
    return model, baseline


def _ensure_model_bundle(
    destination_store: ModelBundleStore,
    seed_store: ModelBundleStore,
    seed_manifest: ModelBundleManifest,
    recovered_paths: list[Path],
) -> tuple[ModelBundleManifest, bool]:
    destination = destination_store.bundle_path(1)
    if destination.exists():
        try:
            return destination_store.load_bundle(1).manifest, False
        except Exception:
            recovered_paths.append(_quarantine_directory(destination))

    _copy_directory_atomically(seed_store.bundle_path(1), destination, ("manifest.json", "heads.safetensors"))
    installed = destination_store.load_bundle(1).manifest
    if installed != seed_manifest:
        raise ValueError("Installed ClipM v1 seed model differs from its packaged manifest")
    return installed, True


def _ensure_training_baseline(
    destination_store: TrainingBaselineStore,
    seed_store: TrainingBaselineStore,
    seed_manifest: TrainingBaselineManifest,
    recovered_paths: list[Path],
) -> bool:
    destination = destination_store.bundle_root
    if destination.exists():
        try:
            existing = destination_store.load_manifest()
            destination_store.load_arrays()
            if existing == seed_manifest and existing.data_sha256 == PACKAGED_BASELINE_DATA_SHA256:
                return False
        except Exception:
            pass
        recovered_paths.append(_quarantine_directory(destination))

    _copy_directory_atomically(
        seed_store.bundle_root,
        destination,
        ("pilot-v1.manifest.json", "pilot-v1.npz"),
    )
    installed = destination_store.load_manifest()
    destination_store.load_arrays()
    if installed != seed_manifest:
        raise ValueError("Installed ClipM training baseline differs from its packaged manifest")
    return True


def _copy_directory_atomically(source: Path, destination: Path, file_names: tuple[str, ...]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{destination.name}-", dir=destination.parent))
    try:
        for file_name in file_names:
            shutil.copyfile(source / file_name, temporary / file_name)
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)


def _quarantine_directory(path: Path) -> Path:
    recovery_root = path.parent / "recovery"
    recovery_root.mkdir(parents=True, exist_ok=True)
    recovered = recovery_root / f"{path.name}-{uuid4().hex}"
    os.replace(path, recovered)
    return recovered


def _require_hash(path: Path, expected: str) -> None:
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError(f"Packaged ClipM seed asset failed SHA-256 verification: {path.name} ({actual})")
