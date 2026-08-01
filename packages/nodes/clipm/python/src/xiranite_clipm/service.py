from __future__ import annotations

import importlib.util
from pathlib import Path
import platform
import shutil
import sqlite3
from typing import Any

from .archive_metadata import ArchiveMetadataWriter
from .contracts import (
    EnvironmentStatus,
    ListReviewItemsCommand,
    ModelResidency,
    ResolveReviewItemCommand,
    ReviewItemsResult,
    ScoreOptions,
    WorkScoreResult,
)
from .database import open_clipm_database
from .encoder import Siglip2Encoder
from .identity_reconciliation import list_review_items
from .locks import exclusive_file_lock
from .model_bundle import ModelBundleStore
from .review_resolution import resolve_review_item
from .scoring import ClipmScoringEngine
from .settings import ClipmSettings
from .work_workflow import process_score_work


SERVICE_VERSION = "0.1.0"


class ClipmService:
    def __init__(
        self,
        settings: ClipmSettings,
        scoring: ClipmScoringEngine | None = None,
        metadata: ArchiveMetadataWriter | None = None,
    ):
        self.settings = settings
        self._database: sqlite3.Connection | None = None
        self._bundle_store = ModelBundleStore(settings.models_root)
        self._scoring = scoring or ClipmScoringEngine(
            self._bundle_store, Siglip2Encoder(settings.huggingface_cache, settings.device.value)
        )
        self._metadata = metadata or ArchiveMetadataWriter()

    def start(self) -> None:
        if self._database is not None:
            return
        self.settings.runtime_root.mkdir(parents=True, exist_ok=True)
        with exclusive_file_lock(self.settings.locks_root / "database-migration.lock"):
            self._database = open_clipm_database(self.settings.database_path)

    def close(self) -> None:
        self._scoring.unload()
        if self._database is None:
            return
        self._database.close()
        self._database = None

    def score_work(self, path: str, options: ScoreOptions | None = None) -> WorkScoreResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        try:
            return process_score_work(
                self._database,
                self._scoring,
                self._metadata,
                Path(path),
                options or ScoreOptions(),
                self._active_bundle_version(),
            )
        finally:
            if self.settings.model_residency is ModelResidency.IMMEDIATE:
                self._scoring.unload()

    def resolve_review_item(self, command: ResolveReviewItemCommand) -> WorkScoreResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        try:
            return resolve_review_item(
                self._database,
                self._scoring,
                self._metadata,
                command,
                self._active_bundle_version(),
            )
        finally:
            if self.settings.model_residency is ModelResidency.IMMEDIATE:
                self._scoring.unload()

    def list_review_items(self, command: ListReviewItemsCommand | None = None) -> ReviewItemsResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        query = command or ListReviewItemsCommand()
        return ReviewItemsResult(items=list_review_items(self._database, query.status, query.limit))

    def health(self) -> EnvironmentStatus:
        self.start()
        warnings: list[str] = []
        database_ok = self._database_quick_check()
        if not database_ok:
            warnings.append("ClipM SQLite quick_check failed.")

        cuda_available, cuda_warning = _cuda_status()
        if cuda_warning:
            warnings.append(cuda_warning)
        if self.settings.device.value == "cuda" and not cuda_available:
            warnings.append("CUDA was requested but is unavailable; CPU fallback requires explicit configuration.")

        active_bundle_version = self._active_bundle_version()
        model_available = active_bundle_version is not None
        if not model_available:
            warnings.append("No active ClipM model bundle is installed.")

        return EnvironmentStatus(
            healthy=database_ok,
            service_version=SERVICE_VERSION,
            runtime_root=str(self.settings.runtime_root),
            python_version=platform.python_version(),
            device=self.settings.device,
            cuda_available=cuda_available,
            model_available=model_available,
            model_residency=self.settings.model_residency,
            active_bundle_version=active_bundle_version,
            database_ok=database_ok,
            seven_zip_available=_has_executable(("7z", "7zz", "7za")),
            rar_available=_has_executable(("rar",)),
            warnings=warnings,
        )

    def _database_quick_check(self) -> bool:
        if self._database is None:
            return False
        row = self._database.execute("PRAGMA quick_check").fetchone()
        return bool(row and row[0] == "ok")

    def _active_bundle_version(self) -> int | None:
        if self._database is None:
            return None
        row = self._database.execute(
            "SELECT bundle_version FROM model_bundles WHERE status = 'active' LIMIT 1"
        ).fetchone()
        return int(row[0]) if row else None


def _has_executable(names: tuple[str, ...]) -> bool:
    return any(shutil.which(name) is not None for name in names)


def _cuda_status() -> tuple[bool, str | None]:
    if importlib.util.find_spec("torch") is None:
        return False, "PyTorch is not installed in the ClipM runtime yet."
    try:
        import torch

        return bool(torch.cuda.is_available()), None
    except Exception as error:
        return False, f"Unable to query PyTorch CUDA status: {_concise_error(error)}"


def _concise_error(error: Any) -> str:
    return str(error).strip() or type(error).__name__
