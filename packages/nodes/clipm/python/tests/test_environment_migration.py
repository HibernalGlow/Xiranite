from __future__ import annotations

from collections.abc import Iterator, Mapping
from pathlib import Path
import sqlite3
import subprocess

import pytest

from xiranite_clipm.contracts import (
    DevicePreference,
    EnvironmentMigrationResult,
    EnvironmentStatus,
    MigrateEnvironmentCommand,
    ModelResidency,
)
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.environment_migration import (
    EnvironmentMigrationProgress,
    EnvironmentMigrator,
    MIGRATION_MARKER,
)
from xiranite_clipm.model_bundle import MANIFEST_FILE, WEIGHTS_FILE
from xiranite_clipm.settings import ClipmSettings


def test_migration_recreates_environment_and_rewrites_model_paths(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    target_root = tmp_path / "target"
    settings = _settings(source_root)
    source_root.joinpath("models", "v1").mkdir(parents=True)
    source_root.joinpath("models", "v1", MANIFEST_FILE).write_text("{}", encoding="utf-8")
    source_root.joinpath("models", "v1", WEIGHTS_FILE).write_bytes(b"weights")
    source_root.joinpath("models", ".training.lock").write_text("", encoding="utf-8")
    source_root.joinpath("data", "training").mkdir(parents=True)
    source_root.joinpath("data", "training", "baseline.json").write_text("{}", encoding="utf-8")
    source_root.joinpath("huggingface-cache").mkdir()
    source_root.joinpath("huggingface-cache", "model.bin").write_bytes(b"model")
    source_root.joinpath("uv-cache").mkdir()
    source_root.joinpath("uv-cache", "wheel.bin").write_bytes(b"wheel")
    connection = open_clipm_database(settings.database_path)
    try:
        revision = connection.execute(
            "INSERT INTO data_revisions(reason, created_at) VALUES ('test', '2026-08-01T00:00:00Z') RETURNING revision"
        ).fetchone()[0]
        connection.execute(
            """INSERT INTO model_bundles(
                bundle_version, status, manifest_path, weights_path, metrics_json,
                data_revision, created_at
            ) VALUES (1, 'inactive', ?, ?, '{}', ?, '2026-08-01T00:00:00Z')""",
            (
                str(source_root / "models" / "v1" / MANIFEST_FILE),
                str(source_root / "models" / "v1" / WEIGHTS_FILE),
                revision,
            ),
        )
    finally:
        connection.close()

    calls: list[list[str]] = []

    def run(command: list[str], environment: Mapping[str, str]) -> subprocess.CompletedProcess[str]:
        calls.append(command)
        if command[1] == "sync":
            python = Path(environment["UV_PROJECT_ENVIRONMENT"]) / "Scripts" / "python.exe"
            python.parent.mkdir(parents=True)
            python.write_bytes(b"python")
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
        status = _status(Path(environment["XIRANITE_CLIPM_RUNTIME_ROOT"]))
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=status.model_dump_json(by_alias=True) + "\n",
            stderr="",
        )

    result, progress = _consume(EnvironmentMigrator(
        settings,
        python_project_root=tmp_path / "python-project",
        uv_command="verified-uv.exe",
        command_runner=run,
    ).migrate_steps(
        MigrateEnvironmentCommand(target_runtime_root=str(target_root)),
        _status(source_root),
    ))

    assert result.target_runtime_root == str(target_root.resolve())
    assert result.python_environment_recreated is True
    assert set(result.copied_components) == {
        "database", "models", "training", "huggingface-cache", "uv-cache"
    }
    assert [item.progress for item in progress] == [5, 35, 60, 78, 95]
    assert calls[0][:4] == ["verified-uv.exe", "sync", "--project", str(tmp_path / "python-project")]
    assert calls[1][-2:] == ["-m", "xiranite_clipm.environment_probe"]
    assert not target_root.joinpath(MIGRATION_MARKER).exists()
    assert not target_root.joinpath("models", ".training.lock").exists()

    migrated = sqlite3.connect(target_root / "data" / "clipm.sqlite")
    try:
        row = migrated.execute(
            "SELECT manifest_path, weights_path FROM model_bundles WHERE bundle_version = 1"
        ).fetchone()
        assert row == (
            str(target_root / "models" / "v1" / MANIFEST_FILE),
            str(target_root / "models" / "v1" / WEIGHTS_FILE),
        )
        assert migrated.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        migrated.close()


@pytest.mark.parametrize("relation", ["same", "child", "parent"])
def test_migration_rejects_overlapping_runtime_roots(tmp_path: Path, relation: str) -> None:
    source = tmp_path / "source"
    source.mkdir()
    target = source if relation == "same" else source / "child" if relation == "child" else tmp_path
    migrator = EnvironmentMigrator(_settings(source), uv_command="uv")
    with pytest.raises(ValueError, match="differ|contain"):
        next(migrator.migrate_steps(
            MigrateEnvironmentCommand(target_runtime_root=str(target)),
            _status(source),
        ))


def _consume(
    steps: Iterator[EnvironmentMigrationProgress],
) -> tuple[EnvironmentMigrationResult, list[EnvironmentMigrationProgress]]:
    progress: list[EnvironmentMigrationProgress] = []
    while True:
        try:
            progress.append(next(steps))
        except StopIteration as completed:
            return completed.value, progress


def _settings(root: Path) -> ClipmSettings:
    return ClipmSettings(
        runtime_root=root,
        device=DevicePreference.CPU,
        model_residency=ModelResidency.IDLE_10M,
        huggingface_cache=root / "huggingface-cache",
    )


def _status(root: Path) -> EnvironmentStatus:
    return EnvironmentStatus(
        healthy=True,
        service_version="0.1.0",
        runtime_root=str(root.resolve()),
        python_version="3.11.9",
        device=DevicePreference.CPU,
        cuda_available=False,
        model_available=False,
        model_residency=ModelResidency.IDLE_10M,
        database_ok=True,
        seven_zip_available=True,
        rar_available=True,
    )
