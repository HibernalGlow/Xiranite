from __future__ import annotations

from collections.abc import Iterator
import importlib.util
from pathlib import Path
import platform
import shutil
import sqlite3
from typing import Any

from .archive_metadata import ArchiveMetadataWriter
from .contracts import (
    ApplyFeedbackCommand,
    ActivateModelCommand,
    EnvironmentStatus,
    FeedbackApplyResult,
    FeedbackScanResult,
    ListReviewItemsCommand,
    ListModelsCommand,
    ModelActivationResult,
    ModelsResult,
    MigrateEnvironmentCommand,
    ResolveReviewItemCommand,
    RollbackModelCommand,
    ReviewItemsResult,
    ScoreOptions,
    ScoreLibraryResult,
    TrainingResult,
    WorkScoreResult,
)
from .database import open_clipm_database
from .encoder import Siglip2Encoder
from .encoder_residency import EncoderResidencyController
from .environment_migration import EnvironmentMigrationProgress, EnvironmentMigrator
from .feedback_workflow import apply_and_synchronize_feedback, scan_filename_feedback
from .identity_reconciliation import list_review_items
from .locks import exclusive_file_lock
from .library_workflow import LibraryProgress, consume_library_steps, score_library_steps
from .model_bundle import ModelBundleStore
from .model_lifecycle import activate_model_bundle, list_model_bundles
from .review_resolution import resolve_review_item
from .scoring import ClipmScoringEngine
from .settings import ClipmSettings
from .training_baseline import TrainingBaselineStore
from .training_workflow import train_heads
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
        self._baseline_store = TrainingBaselineStore(settings.training_root)
        self._scoring = scoring or ClipmScoringEngine(
            self._bundle_store, Siglip2Encoder(settings.huggingface_cache, settings.device.value)
        )
        self._encoder_residency = EncoderResidencyController(
            self._scoring,
            settings.model_residency,
        )
        self._metadata = metadata or ArchiveMetadataWriter()

    def start(self) -> None:
        if self._database is not None:
            return
        self.settings.runtime_root.mkdir(parents=True, exist_ok=True)
        with exclusive_file_lock(self.settings.locks_root / "database-migration.lock"):
            self._database = open_clipm_database(self.settings.database_path)

    def close(self) -> None:
        self._encoder_residency.unload_now()
        if self._database is None:
            return
        self._database.close()
        self._database = None

    def score_work(self, path: str, options: ScoreOptions | None = None) -> WorkScoreResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        with self._encoder_residency.scoring_operation():
            return process_score_work(
                self._database,
                self._scoring,
                self._metadata,
                Path(path),
                options or ScoreOptions(),
                self._active_bundle_version(),
            )

    def score_library_steps(
        self,
        path: str,
        options: ScoreOptions | None = None,
    ) -> Iterator[LibraryProgress]:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        with self._encoder_residency.scoring_operation():
            return (yield from score_library_steps(
                self._database,
                self._scoring,
                self._metadata,
                Path(path),
                options or ScoreOptions(),
                self._active_bundle_version(),
            ))

    def score_library(self, path: str, options: ScoreOptions | None = None) -> ScoreLibraryResult:
        return consume_library_steps(self.score_library_steps(path, options))

    def resolve_review_item(self, command: ResolveReviewItemCommand) -> WorkScoreResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        with self._encoder_residency.scoring_operation():
            return resolve_review_item(
                self._database,
                self._scoring,
                self._metadata,
                command,
                self._active_bundle_version(),
            )

    def list_review_items(self, command: ListReviewItemsCommand | None = None) -> ReviewItemsResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        query = command or ListReviewItemsCommand()
        return ReviewItemsResult(items=list_review_items(self._database, query.status, query.limit))

    def apply_feedback(self, command: ApplyFeedbackCommand) -> FeedbackApplyResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        return apply_and_synchronize_feedback(
            self._database,
            self._metadata,
            command,
            self._active_bundle_version(),
        )

    def scan_feedback(self, path: str) -> FeedbackScanResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        return scan_filename_feedback(
            self._database,
            self._metadata,
            Path(path),
            self._active_bundle_version(),
        )

    def train_heads(self) -> TrainingResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        result = train_heads(self._database, self._baseline_store, self._bundle_store)
        return TrainingResult(
            run_id=result.run_id,
            data_revision=result.data_revision,
            classification={
                "status": result.classification.status,
                "reasons": list(result.classification.reasons),
                "bundleVersion": result.classification.bundle_version,
            },
            ranking={
                "status": result.ranking.status,
                "reasons": list(result.ranking.reasons),
                "bundleVersion": result.ranking.bundle_version,
            },
            active_bundle_version=result.active_bundle_version,
        )

    def list_models(self, command: ListModelsCommand | None = None) -> ModelsResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        query = command or ListModelsCommand()
        return list_model_bundles(
            self._database,
            self._bundle_store,
            include_failed=query.include_failed,
        )

    def activate_model(self, command: ActivateModelCommand) -> ModelActivationResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        previous = activate_model_bundle(
            self._database,
            self._bundle_store,
            command.bundle_version,
            force=command.force,
        )
        return ModelActivationResult(
            previous_bundle_version=previous,
            active_bundle_version=command.bundle_version,
            forced=command.force,
        )

    def rollback_model(self, command: RollbackModelCommand) -> ModelActivationResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        previous = activate_model_bundle(
            self._database,
            self._bundle_store,
            command.bundle_version,
        )
        return ModelActivationResult(
            previous_bundle_version=previous,
            active_bundle_version=command.bundle_version,
            forced=False,
        )

    def migrate_environment_steps(
        self,
        command: MigrateEnvironmentCommand,
    ) -> Iterator[EnvironmentMigrationProgress]:
        with exclusive_file_lock(self.settings.locks_root / "environment-migration.lock"):
            with exclusive_file_lock(self.settings.models_root / ".training.lock"):
                with exclusive_file_lock(self.settings.models_root / ".model-activation.lock"):
                    source_status = self.health()
                    self.close()
                    try:
                        return (yield from EnvironmentMigrator(self.settings).migrate_steps(command, source_status))
                    finally:
                        self.start()

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
        model_available, model_warning = self._model_status(active_bundle_version)
        if model_warning:
            warnings.append(model_warning)
        if active_bundle_version is None:
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

    def _model_status(self, active_bundle_version: int | None) -> tuple[bool, str | None]:
        if active_bundle_version is None:
            return False, None
        try:
            pointer_version = self._bundle_store.active_version()
            if pointer_version != active_bundle_version:
                return False, "The active model pointer does not match the ClipM database."
            self._bundle_store.load_bundle(active_bundle_version)
            return True, None
        except Exception as error:
            return False, f"Unable to validate active model bundle v{active_bundle_version}: {_concise_error(error)}"


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
