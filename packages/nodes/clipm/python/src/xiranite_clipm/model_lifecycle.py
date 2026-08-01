from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
from uuid import uuid4

from .contracts import ModelBundleManifest, ModelBundleStatus, ModelSummary, ModelsResult
from .locks import exclusive_file_lock
from .model_bundle import MANIFEST_FILE, WEIGHTS_FILE, ModelBundleStore


MODEL_DIRECTORY = re.compile(r"^v([1-9][0-9]*)$")


def next_bundle_version(connection: sqlite3.Connection, store: ModelBundleStore) -> int:
    database_max = int(connection.execute("SELECT COALESCE(MAX(bundle_version), 0) FROM model_bundles").fetchone()[0])
    directory_versions = [
        int(match.group(1))
        for child in store.models_root.iterdir()
        if child.is_dir() and (match := MODEL_DIRECTORY.fullmatch(child.name)) is not None
    ] if store.models_root.is_dir() else []
    return max([database_max, *directory_versions], default=0) + 1


def register_training_bundle(
    connection: sqlite3.Connection,
    store: ModelBundleStore,
    manifest: ModelBundleManifest,
    data_revision: int,
    status: ModelBundleStatus,
) -> None:
    if status not in {ModelBundleStatus.CANDIDATE, ModelBundleStatus.FAILED}:
        raise ValueError("A new training bundle must be registered as candidate or failed")
    if manifest.source.kind != "head-training" or manifest.source.training_run_id is None:
        raise ValueError("Only a head-training bundle can be registered by the training workflow")
    run = connection.execute(
        "SELECT data_revision FROM training_runs WHERE run_id = ?",
        (str(manifest.source.training_run_id),),
    ).fetchone()
    if run is None or int(run["data_revision"]) != data_revision:
        raise ValueError("Training bundle data revision differs from its training run")
    root = store.bundle_path(manifest.bundle_version)
    loaded = store.load_bundle(manifest.bundle_version)
    if loaded.manifest != manifest:
        raise ValueError("Training bundle manifest changed before database registration")
    metrics = {
        "classification": manifest.classification_head.metrics.model_dump(mode="json", by_alias=True),
        "classificationValidationStatus": manifest.classification_head.validation_status,
        "classificationValidationReasons": manifest.classification_head.validation_reasons,
        "ranking": (
            manifest.ranking_head.metrics.model_dump(mode="json", by_alias=True)
            if manifest.ranking_head is not None
            else None
        ),
        "rankingValidationStatus": (
            manifest.ranking_head.validation_status if manifest.ranking_head is not None else None
        ),
        "rankingValidationReasons": (
            manifest.ranking_head.validation_reasons if manifest.ranking_head is not None else []
        ),
    }
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute(
            """INSERT INTO model_bundles(
                bundle_version, status, manifest_path, weights_path, metrics_json,
                data_revision, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                manifest.bundle_version,
                status.value,
                str(root / MANIFEST_FILE),
                str(root / WEIGHTS_FILE),
                json.dumps(metrics, separators=(",", ":")),
                data_revision,
                manifest.created_at.isoformat(),
            ),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def activate_model_bundle(
    connection: sqlite3.Connection,
    store: ModelBundleStore,
    bundle_version: int,
    *,
    force: bool = False,
    activated_at: datetime | None = None,
) -> int | None:
    with exclusive_file_lock(store.models_root / ".model-activation.lock"):
        return _activate_model_bundle_locked(
            connection,
            store,
            bundle_version,
            force=force,
            activated_at=activated_at,
        )


def ensure_active_model_bundle(
    connection: sqlite3.Connection,
    store: ModelBundleStore,
    *,
    fallback_bundle_version: int,
) -> int:
    with exclusive_file_lock(store.models_root / ".model-activation.lock"):
        active_row = connection.execute(
            "SELECT bundle_version, manifest_path, weights_path FROM model_bundles WHERE status = 'active'"
        ).fetchone()
        if active_row is not None:
            active_version = int(active_row["bundle_version"])
            root = store.bundle_path(active_version)
            if (
                Path(active_row["manifest_path"]) != root / MANIFEST_FILE
                or Path(active_row["weights_path"]) != root / WEIGHTS_FILE
            ):
                raise ValueError(f"ClipM bundle v{active_version} database paths differ from its immutable files")
            store.load_bundle(active_version)
            try:
                pointer_version = store.active_version()
            except Exception:
                pointer_version = None
            if pointer_version != active_version:
                _quarantine_active_pointer(store)
                store.activate(active_version)
            return active_version

        _quarantine_active_pointer(store)
        _activate_model_bundle_locked(connection, store, fallback_bundle_version)
        return fallback_bundle_version


def _activate_model_bundle_locked(
    connection: sqlite3.Connection,
    store: ModelBundleStore,
    bundle_version: int,
    *,
    force: bool = False,
    activated_at: datetime | None = None,
) -> int | None:
    activated_at = activated_at or datetime.now(timezone.utc)
    bundle = store.load_bundle(bundle_version)
    row = connection.execute(
        "SELECT status, manifest_path, weights_path FROM model_bundles WHERE bundle_version = ?",
        (bundle_version,),
    ).fetchone()
    if row is None:
        raise KeyError(f"ClipM bundle v{bundle_version} is not registered")
    root = store.bundle_path(bundle_version)
    if Path(row["manifest_path"]) != root / MANIFEST_FILE or Path(row["weights_path"]) != root / WEIGHTS_FILE:
        raise ValueError(f"ClipM bundle v{bundle_version} database paths differ from its immutable files")
    status = ModelBundleStatus(str(row["status"]))
    if status is ModelBundleStatus.FAILED and not force:
        raise ValueError(f"ClipM bundle v{bundle_version} failed validation; force activation is required")
    if bundle.manifest.bundle_version != bundle_version:
        raise ValueError("ClipM bundle version changed during activation")

    previous_version = store.active_version()
    active_row = connection.execute(
        "SELECT bundle_version FROM model_bundles WHERE status = 'active'"
    ).fetchone()
    database_active_version = int(active_row[0]) if active_row is not None else None
    if database_active_version != previous_version:
        raise RuntimeError(
            "ClipM active model must be reconciled before activation: "
            f"database v{database_active_version}, pointer v{previous_version}"
        )
    previous_status = None
    if previous_version is not None and previous_version != bundle_version:
        previous_status = _deactivated_status(store.load_bundle(previous_version).manifest)
    store.activate(bundle_version, activated_at)
    try:
        connection.execute("BEGIN IMMEDIATE")
        if previous_version is not None and previous_version != bundle_version:
            connection.execute(
                "UPDATE model_bundles SET status = ? WHERE bundle_version = ?",
                (previous_status.value, previous_version),
            )
        connection.execute(
            "UPDATE model_bundles SET status = 'active', activated_at = ? WHERE bundle_version = ?",
            (activated_at.isoformat(), bundle_version),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        if previous_version is None:
            store.active_pointer_path.unlink(missing_ok=True)
        else:
            store.activate(previous_version)
        raise
    return previous_version


def _quarantine_active_pointer(store: ModelBundleStore) -> Path | None:
    pointer = store.active_pointer_path
    if not pointer.exists():
        return None
    recovery_root = store.models_root / "recovery"
    recovery_root.mkdir(parents=True, exist_ok=True)
    recovered = recovery_root / f"active-model-{uuid4().hex}.json"
    os.replace(pointer, recovered)
    return recovered


def active_bundle_version(connection: sqlite3.Connection, store: ModelBundleStore) -> int:
    database_row = connection.execute(
        "SELECT bundle_version FROM model_bundles WHERE status = 'active'"
    ).fetchone()
    database_version = int(database_row[0]) if database_row is not None else None
    pointer_version = store.active_version()
    if database_version is None or pointer_version is None:
        raise FileNotFoundError("No active ClipM model bundle is registered")
    if database_version != pointer_version:
        raise RuntimeError(
            f"ClipM active model mismatch: database v{database_version}, pointer v{pointer_version}"
        )
    return database_version


def list_model_bundles(
    connection: sqlite3.Connection,
    store: ModelBundleStore,
    *,
    include_failed: bool = True,
) -> ModelsResult:
    rows = connection.execute(
        """SELECT bundle_version, status, data_revision, created_at, pinned
           FROM model_bundles
           WHERE ? OR status != 'failed'
           ORDER BY bundle_version DESC""",
        (include_failed,),
    ).fetchall()
    models: list[ModelSummary] = []
    for row in rows:
        manifest = store.load_bundle(int(row["bundle_version"])).manifest
        classification_metrics = _numeric_metrics(
            manifest.classification_head.metrics.model_dump(mode="python", by_alias=True)
        )
        ranking_metrics = (
            _numeric_metrics(manifest.ranking_head.metrics.model_dump(mode="python", by_alias=True))
            if manifest.ranking_head is not None
            else {}
        )
        models.append(
            ModelSummary(
                bundle_version=manifest.bundle_version,
                status=ModelBundleStatus(str(row["status"])),
                classification_metrics=classification_metrics,
                ranking_metrics=ranking_metrics,
                data_revision=int(row["data_revision"]),
                created_at=manifest.created_at,
                pinned=bool(row["pinned"]),
                classification_validation_status=manifest.classification_head.validation_status,
                classification_validation_reasons=manifest.classification_head.validation_reasons,
                ranking_validation_status=(
                    manifest.ranking_head.validation_status if manifest.ranking_head is not None else None
                ),
                ranking_validation_reasons=(
                    manifest.ranking_head.validation_reasons if manifest.ranking_head is not None else []
                ),
            )
        )
    database_active_row = connection.execute(
        "SELECT bundle_version FROM model_bundles WHERE status = 'active'"
    ).fetchone()
    database_active_version = int(database_active_row[0]) if database_active_row is not None else None
    pointer_version = store.active_version()
    if database_active_version != pointer_version:
        raise RuntimeError(
            "ClipM active model must be reconciled before listing models: "
            f"database v{database_active_version}, pointer v{pointer_version}"
        )
    return ModelsResult(
        models=models,
        active_bundle_version=database_active_version,
    )


def _deactivated_status(manifest: ModelBundleManifest) -> ModelBundleStatus:
    if manifest.source.kind != "head-training" or manifest.source.trained_head is None:
        return ModelBundleStatus.INACTIVE
    validation_status = (
        manifest.classification_head.validation_status
        if manifest.source.trained_head == "classification"
        else manifest.ranking_head.validation_status if manifest.ranking_head is not None else "accepted"
    )
    return ModelBundleStatus.FAILED if validation_status == "rejected" else ModelBundleStatus.INACTIVE


def _numeric_metrics(metrics: dict[str, object]) -> dict[str, float]:
    return {
        key: float(value)
        for key, value in metrics.items()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    }
