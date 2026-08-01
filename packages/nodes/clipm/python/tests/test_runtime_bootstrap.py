from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import threading

from xiranite_clipm.contracts import DevicePreference, ModelResidency
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.model_bundle import ModelBundleStore, register_model_bundle
from xiranite_clipm.model_lifecycle import activate_model_bundle
from xiranite_clipm.runtime_bootstrap import bootstrap_clipm_runtime
from xiranite_clipm.service import ClipmService
from xiranite_clipm.settings import ClipmSettings
from xiranite_clipm.training_baseline import TrainingBaselineStore


def _stores(tmp_path: Path):
    runtime_root = tmp_path / "runtime"
    connection = open_clipm_database(runtime_root / "data" / "clipm.sqlite")
    return (
        connection,
        ModelBundleStore(runtime_root / "models"),
        TrainingBaselineStore(runtime_root / "data" / "training"),
    )


def test_bootstrap_installs_registers_and_activates_packaged_seed(tmp_path: Path) -> None:
    connection, bundle_store, baseline_store = _stores(tmp_path)
    try:
        result = bootstrap_clipm_runtime(connection, bundle_store, baseline_store)

        assert result.model_installed is True
        assert result.baseline_installed is True
        assert result.active_bundle_version == 1
        assert result.recovered_paths == ()
        assert bundle_store.active_version() == 1
        assert bundle_store.load_bundle(1).manifest.classification_head.threshold == 0.48017321753783504
        assert baseline_store.load_manifest().samples == 270
        row = connection.execute(
            "SELECT bundle_version, status FROM model_bundles"
        ).fetchone()
        assert tuple(row) == (1, "active")
    finally:
        connection.close()


def test_bootstrap_is_idempotent_without_rewriting_assets_or_revisions(tmp_path: Path) -> None:
    connection, bundle_store, baseline_store = _stores(tmp_path)
    try:
        first = bootstrap_clipm_runtime(connection, bundle_store, baseline_store)
        model_manifest = bundle_store.bundle_path(1) / "manifest.json"
        baseline_data = baseline_store.data_path
        before = (model_manifest.read_bytes(), baseline_data.read_bytes(), bundle_store.active_pointer_path.read_bytes())

        second = bootstrap_clipm_runtime(connection, bundle_store, baseline_store)

        after = (model_manifest.read_bytes(), baseline_data.read_bytes(), bundle_store.active_pointer_path.read_bytes())
        assert first.model_installed is True
        assert second.model_installed is False
        assert second.baseline_installed is False
        assert second.recovered_paths == ()
        assert after == before
        assert connection.execute("SELECT count(*) FROM model_bundles").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM data_revisions").fetchone()[0] == 1
    finally:
        connection.close()


def test_bootstrap_quarantines_corrupt_model_and_partial_baseline_before_repair(tmp_path: Path) -> None:
    connection, bundle_store, baseline_store = _stores(tmp_path)
    try:
        bootstrap_clipm_runtime(connection, bundle_store, baseline_store)
        (bundle_store.bundle_path(1) / "heads.safetensors").write_bytes(b"corrupt")
        shutil.rmtree(baseline_store.bundle_root)
        baseline_store.bundle_root.mkdir(parents=True)
        baseline_store.manifest_path.write_text("{}", encoding="utf-8")

        result = bootstrap_clipm_runtime(connection, bundle_store, baseline_store)

        assert result.model_installed is True
        assert result.baseline_installed is True
        assert len(result.recovered_paths) == 2
        assert all(path.exists() for path in result.recovered_paths)
        assert bundle_store.load_bundle(1).manifest.bundle_version == 1
        assert baseline_store.load_manifest().samples == 270
        assert bundle_store.active_version() == 1
    finally:
        connection.close()


def test_bootstrap_preserves_an_existing_valid_v1_bundle(tmp_path: Path) -> None:
    connection, bundle_store, baseline_store = _stores(tmp_path)
    try:
        bootstrap_clipm_runtime(connection, bundle_store, baseline_store)
        root = bundle_store.bundle_path(1)
        manifest_path = root / "manifest.json"
        manifest = bundle_store.load_bundle(1).manifest.model_copy(
            update={
                "created_at": datetime(2026, 8, 1, 1, tzinfo=timezone.utc),
                "classification_head": bundle_store.load_bundle(1).manifest.classification_head.model_copy(
                    update={"threshold": 0.5}
                ),
            }
        )
        manifest_path.write_text(
            json.dumps(manifest.model_dump(mode="json", by_alias=True), separators=(",", ":")),
            encoding="utf-8",
        )
        before = manifest_path.read_bytes()

        result = bootstrap_clipm_runtime(connection, bundle_store, baseline_store)

        assert result.model_installed is False
        assert result.recovered_paths == ()
        assert manifest_path.read_bytes() == before
        assert bundle_store.load_bundle(1).manifest.classification_head.threshold == 0.5
    finally:
        connection.close()


def test_bootstrap_does_not_replace_an_existing_active_newer_model(tmp_path: Path) -> None:
    connection, bundle_store, baseline_store = _stores(tmp_path)
    try:
        bootstrap_clipm_runtime(connection, bundle_store, baseline_store)
        source_root = bundle_store.bundle_path(1)
        target_root = bundle_store.bundle_path(2)
        target_root.mkdir(parents=True)
        shutil.copyfile(source_root / "heads.safetensors", target_root / "heads.safetensors")
        model_v2 = bundle_store.load_bundle(1).manifest.model_copy(update={"bundle_version": 2})
        (target_root / "manifest.json").write_text(
            json.dumps(model_v2.model_dump(mode="json", by_alias=True), separators=(",", ":")),
            encoding="utf-8",
        )
        register_model_bundle(connection, bundle_store, model_v2, activate=False)
        activate_model_bundle(connection, bundle_store, 2)
        shutil.rmtree(source_root)

        result = bootstrap_clipm_runtime(connection, bundle_store, baseline_store)

        assert result.model_installed is True
        assert result.active_bundle_version == 2
        assert bundle_store.active_version() == 2
        statuses = connection.execute(
            "SELECT bundle_version, status FROM model_bundles ORDER BY bundle_version"
        ).fetchall()
        assert [tuple(row) for row in statuses] == [(1, "inactive"), (2, "active")]
    finally:
        connection.close()


def test_concurrent_service_starts_bootstrap_once(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    settings = ClipmSettings(
        runtime_root=runtime_root,
        device=DevicePreference.CPU,
        model_residency=ModelResidency.IMMEDIATE,
        huggingface_cache=runtime_root / "huggingface-cache",
    )
    barrier = threading.Barrier(4)

    def start_service() -> None:
        service = ClipmService(settings)
        try:
            barrier.wait()
            service.start()
        finally:
            service.close()

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(start_service) for _ in range(4)]
        for future in futures:
            future.result()

    connection = open_clipm_database(settings.database_path)
    try:
        assert connection.execute("SELECT count(*) FROM model_bundles").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM data_revisions").fetchone()[0] == 1
        assert connection.execute(
            "SELECT bundle_version FROM model_bundles WHERE status = 'active'"
        ).fetchone()[0] == 1
        assert ModelBundleStore(settings.models_root).active_version() == 1
    finally:
        connection.close()
