from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import closing
from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
from typing import Callable, Literal

from .contracts import (
    EnvironmentMigrationResult,
    EnvironmentStatus,
    MigrateEnvironmentCommand,
)
from .model_bundle import MANIFEST_FILE, WEIGHTS_FILE
from .settings import ClipmSettings


MIGRATION_MARKER = ".clipm-migration.json"
CommandRunner = Callable[[list[str], Mapping[str, str]], subprocess.CompletedProcess[str]]
CopiedComponent = Literal["database", "models", "training", "huggingface-cache", "uv-cache"]


@dataclass(frozen=True, slots=True)
class EnvironmentMigrationProgress:
    progress: int
    message: str


class EnvironmentMigrator:
    def __init__(
        self,
        settings: ClipmSettings,
        *,
        python_project_root: Path | None = None,
        uv_command: str | None = None,
        command_runner: CommandRunner | None = None,
    ):
        self.settings = settings
        self.python_project_root = (
            python_project_root
            or _optional_path(os.environ.get("XIRANITE_CLIPM_PYTHON_PROJECT_ROOT"))
            or Path(__file__).resolve().parents[2]
        )
        self.uv_command = (
            uv_command
            or os.environ.get("XIRANITE_CLIPM_UV_COMMAND")
            or shutil.which("uv")
        )
        self.command_runner = command_runner or _run_command

    def migrate_steps(
        self,
        command: MigrateEnvironmentCommand,
        source_status: EnvironmentStatus,
    ) -> Iterator[EnvironmentMigrationProgress]:
        source_root = self.settings.runtime_root.resolve()
        target_root = Path(command.target_runtime_root).resolve()
        _validate_roots(source_root, target_root)
        if not self.uv_command:
            raise RuntimeError("UV is unavailable; configure a verified uv executable before migration.")

        marker = _prepare_target(source_root, target_root)
        copied_components: list[CopiedComponent] = []
        target_environment = _target_environment(self.settings, target_root)

        yield EnvironmentMigrationProgress(5, "Preparing the target ClipM runtime.")
        self.command_runner(
            [
                self.uv_command,
                "sync",
                "--project",
                str(self.python_project_root),
                "--frozen",
                "--no-dev",
                "--python",
                "3.11",
            ],
            target_environment,
        )
        yield EnvironmentMigrationProgress(35, "Recreated the Python environment from uv.lock.")

        if _copy_tree(self.settings.models_root, target_root / "models"):
            copied_components.append("models")
        if _copy_tree(self.settings.training_root, target_root / "data" / "training"):
            copied_components.append("training")
        if self.settings.database_path.is_file():
            _migrate_database(self.settings.database_path, target_root / "data" / "clipm.sqlite", target_root)
            copied_components.append("database")
        yield EnvironmentMigrationProgress(60, "Copied and verified ClipM data and model bundles.")

        if _copy_tree(self.settings.huggingface_cache, target_root / "huggingface-cache"):
            copied_components.append("huggingface-cache")
        if _copy_tree(self.settings.runtime_root / "uv-cache", target_root / "uv-cache"):
            copied_components.append("uv-cache")
        yield EnvironmentMigrationProgress(78, "Copied reusable model and package caches.")

        target_status = self._probe_target(target_root, target_environment)
        _validate_target_status(source_status, target_status)
        marker.unlink()
        yield EnvironmentMigrationProgress(95, "Validated the target Python, database, model, and device.")
        return EnvironmentMigrationResult(
            source_runtime_root=str(source_root),
            target_runtime_root=str(target_root),
            source_status=source_status,
            target_status=target_status,
            python_environment_recreated=True,
            copied_components=copied_components,
            warnings=list(target_status.warnings),
        )

    def _probe_target(
        self,
        target_root: Path,
        environment: Mapping[str, str],
    ) -> EnvironmentStatus:
        python_executable = _python_executable(target_root / "python")
        completed = self.command_runner(
            [str(python_executable), "-m", "xiranite_clipm.environment_probe"],
            environment,
        )
        payload = completed.stdout.strip().splitlines()
        if not payload:
            raise RuntimeError("The target ClipM health probe returned no status.")
        return EnvironmentStatus.model_validate_json(payload[-1])


def _prepare_target(source_root: Path, target_root: Path) -> Path:
    target_root.mkdir(parents=True, exist_ok=True)
    marker = target_root / MIGRATION_MARKER
    existing = [entry for entry in target_root.iterdir() if entry != marker]
    if existing:
        raise ValueError("The target runtime directory must be empty.")
    marker.write_text(
        json.dumps({"sourceRuntimeRoot": str(source_root)}, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return marker


def _validate_roots(source_root: Path, target_root: Path) -> None:
    if source_root == target_root:
        raise ValueError("The target runtime directory must differ from the current runtime.")
    if target_root.is_relative_to(source_root) or source_root.is_relative_to(target_root):
        raise ValueError("Source and target runtime directories cannot contain one another.")


def _target_environment(settings: ClipmSettings, target_root: Path) -> dict[str, str]:
    return {
        **os.environ,
        "XIRANITE_CLIPM_RUNTIME_ROOT": str(target_root),
        "XIRANITE_CLIPM_DEVICE": settings.device.value,
        "XIRANITE_CLIPM_MODEL_RESIDENCY": settings.model_residency.value,
        "XIRANITE_CLIPM_HF_CACHE": str(target_root / "huggingface-cache"),
        "UV_CACHE_DIR": str(target_root / "uv-cache"),
        "UV_PYTHON_INSTALL_DIR": str(target_root / "python-installations"),
        "UV_PROJECT_ENVIRONMENT": str(target_root / "python"),
        "HF_HOME": str(target_root / "huggingface-cache"),
    }


def _copy_tree(source: Path, target: Path) -> bool:
    if not source.is_dir():
        return False
    shutil.copytree(
        source,
        target,
        dirs_exist_ok=True,
        copy_function=shutil.copy2,
        ignore=shutil.ignore_patterns("*.lock"),
    )
    return True


def _migrate_database(source: Path, target: Path, target_root: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".sqlite.migrating")
    with (
        closing(sqlite3.connect(source)) as source_connection,
        closing(sqlite3.connect(temporary)) as target_connection,
    ):
        source_connection.backup(target_connection)
        rows = target_connection.execute("SELECT bundle_version FROM model_bundles").fetchall()
        for (bundle_version,) in rows:
            bundle_root = target_root / "models" / f"v{int(bundle_version)}"
            target_connection.execute(
                "UPDATE model_bundles SET manifest_path = ?, weights_path = ? WHERE bundle_version = ?",
                (str(bundle_root / MANIFEST_FILE), str(bundle_root / WEIGHTS_FILE), bundle_version),
            )
        target_connection.commit()
        result = target_connection.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("The migrated ClipM database failed SQLite integrity_check.")
    temporary.replace(target)


def _python_executable(environment_root: Path) -> Path:
    candidates = (
        environment_root / "Scripts" / "python.exe",
        environment_root / "bin" / "python",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"The recreated ClipM Python environment is missing: {environment_root}")


def _validate_target_status(source: EnvironmentStatus, target: EnvironmentStatus) -> None:
    if not target.healthy or not target.database_ok:
        raise RuntimeError("The target ClipM environment failed its database health check.")
    if source.model_available and not target.model_available:
        raise RuntimeError("The active ClipM model bundle was not preserved in the target environment.")
    if target.device.value == "cuda" and not target.cuda_available:
        raise RuntimeError("CUDA is unavailable in the target environment; select explicit CPU mode to continue.")


def _run_command(command: list[str], environment: Mapping[str, str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            env=dict(environment),
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()
        raise RuntimeError(detail or f"Command failed with exit code {error.returncode}: {command[0]}") from error


def _optional_path(value: str | None) -> Path | None:
    return Path(value).resolve() if value and value.strip() else None
