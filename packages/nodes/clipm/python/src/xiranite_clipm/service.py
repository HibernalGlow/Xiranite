from __future__ import annotations

from collections.abc import Iterator
import importlib.util
from pathlib import Path
import platform
import shutil
import sqlite3
from typing import Any

from .archive_metadata import ArchiveMetadataWriter
from .auto_training import (
    claim_auto_training_batch,
    finish_auto_training_batch,
    pending_auto_training_work_count,
    record_manual_training_consumption,
)
from .contracts import (
    ApplyFeedbackCommand,
    ActivateModelCommand,
    AutoTrainingResult,
    EnvironmentStatus,
    FeedbackApplyResult,
    FeedbackEventsResult,
    FeedbackScanResult,
    ListFeedbackEventsCommand,
    ListReviewItemsCommand,
    ListModelsCommand,
    ModelActivationResult,
    ModelsResult,
    MigrateEnvironmentCommand,
    PerceptualRecoveryStatus,
    PerceptualRecoveryStatusCommand,
    ResolveReviewItemCommand,
    RemoveWorkMetadataCommand,
    RemoveWorkMetadataResult,
    RollbackModelCommand,
    ReviewItemsResult,
    ScoreOptions,
    ScoreLibraryResult,
    TrainingResult,
    WorkScoreLookupResult,
    UndoFeedbackCommand,
    WorkScoreResult,
)
from .database import open_clipm_database
from .encoder import Siglip2Encoder
from .encoder_residency import EncoderResidencyController
from .environment_migration import EnvironmentMigrationProgress, EnvironmentMigrator
from .feedback_repository import list_feedback_events
from .feedback_workflow import (
    apply_and_synchronize_feedback,
    scan_filename_feedback,
    undo_and_synchronize_feedback,
)
from .identity_reconciliation import list_review_items
from .locks import ClipmOperationLocks, exclusive_file_lock
from .library_workflow import LibraryProgress, consume_library_steps, score_library_steps
from .model_bundle import ModelBundleStore
from .model_lifecycle import activate_model_bundle, list_model_bundles
from .metadata_removal import remove_work_metadata
from .perceptual_recovery import perceptual_recovery_status
from .review_resolution import resolve_review_item
from .runtime_bootstrap import bootstrap_clipm_runtime
from .score_repository import find_work_score_result
from .scoring import ClipmScoringEngine, ScoringEngine, SerializedScoringEngine
from .settings import ClipmSettings
from .training_baseline import TrainingBaselineStore
from .training_workflow import (
    TrainingProgress,
    TrainingWorkflowResult,
    consume_training_steps,
    train_heads_steps,
)
from .work_workflow import process_score_work


SERVICE_VERSION = "0.1.0"


class ClipmService:
    def __init__(
        self,
        settings: ClipmSettings,
        scoring: ScoringEngine | None = None,
        metadata: ArchiveMetadataWriter | None = None,
    ):
        self.settings = settings
        self._database: sqlite3.Connection | None = None
        self._bundle_store = ModelBundleStore(settings.models_root)
        self._baseline_store = TrainingBaselineStore(settings.training_root)
        self._locks = ClipmOperationLocks(settings.locks_root)
        raw_scoring = scoring or ClipmScoringEngine(
            self._bundle_store, Siglip2Encoder(settings.huggingface_cache, settings.device.value)
        )
        self._scoring = SerializedScoringEngine(raw_scoring, self._locks)
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
            database = open_clipm_database(self.settings.database_path)
        try:
            bootstrap_clipm_runtime(database, self._bundle_store, self._baseline_store)
        except Exception:
            database.close()
            raise
        self._database = database

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
                self._locks,
            )

    def get_work_score(self, path: str) -> WorkScoreLookupResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        resolved = Path(path).resolve(strict=True)
        return WorkScoreLookupResult(
            path=str(resolved),
            work=find_work_score_result(
                self._database,
                resolved,
                self._active_bundle_version(),
            ),
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
                self._locks,
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
                self._locks,
            )

    def list_review_items(self, command: ListReviewItemsCommand | None = None) -> ReviewItemsResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        query = command or ListReviewItemsCommand()
        return ReviewItemsResult(items=list_review_items(self._database, query.status, query.limit))

    def get_perceptual_recovery_status(
        self,
        command: PerceptualRecoveryStatusCommand | None = None,
    ) -> PerceptualRecoveryStatus:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        query = command or PerceptualRecoveryStatusCommand()
        return perceptual_recovery_status(self._database, query.limit)

    def apply_feedback(self, command: ApplyFeedbackCommand) -> FeedbackApplyResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        with self._locks.work(command.work_id):
            return apply_and_synchronize_feedback(
                self._database,
                self._metadata,
                command,
                self._active_bundle_version(),
            )

    def list_feedback_events(
        self,
        command: ListFeedbackEventsCommand | None = None,
    ) -> FeedbackEventsResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        return list_feedback_events(self._database, command or ListFeedbackEventsCommand())

    def undo_feedback(self, command: UndoFeedbackCommand) -> FeedbackApplyResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        row = self._database.execute(
            "SELECT work_id FROM feedback_events WHERE event_id = ?",
            (str(command.event_id),),
        ).fetchone()
        if row is None:
            raise KeyError(f"Unknown ClipM feedback event: {command.event_id}")
        with self._locks.work(str(row["work_id"])):
            return undo_and_synchronize_feedback(
                self._database,
                self._metadata,
                command,
                self._active_bundle_version(),
            )

    def remove_work_metadata(self, command: RemoveWorkMetadataCommand) -> RemoveWorkMetadataResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        return remove_work_metadata(self._database, self._metadata, command, self._locks)

    def scan_feedback(self, path: str) -> FeedbackScanResult:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        return scan_filename_feedback(
            self._database,
            self._metadata,
            Path(path),
            self._active_bundle_version(),
            self._locks,
        )

    def train_heads(self) -> TrainingResult:
        return consume_training_steps(self.train_heads_steps())

    def train_heads_steps(self) -> Iterator[TrainingProgress]:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        result = yield from train_heads_steps(
            self._database,
            self._baseline_store,
            self._bundle_store,
        )
        record_manual_training_consumption(self._database, result.run_id)
        return _training_result(result)

    def run_auto_training_steps(
        self,
        batch_size: int,
    ) -> Iterator[TrainingProgress]:
        self.start()
        if self._database is None:
            raise RuntimeError("ClipM database is not open")
        batch = claim_auto_training_batch(self._database, batch_size)
        if batch is None:
            return AutoTrainingResult(
                status="not_ready",
                batch_size=batch_size,
                pending_work_count=pending_auto_training_work_count(self._database),
            )
        try:
            result = yield from train_heads_steps(
                self._database,
                self._baseline_store,
                self._bundle_store,
            )
        except GeneratorExit:
            finish_auto_training_batch(
                self._database,
                batch.batch_id,
                "cancelled",
                error_message="Automatic training cancelled at a safe checkpoint.",
            )
            raise
        except Exception as error:
            finish_auto_training_batch(
                self._database,
                batch.batch_id,
                "failed",
                error_message=str(error),
            )
            raise
        finish_auto_training_batch(
            self._database,
            batch.batch_id,
            "succeeded",
            training_run_id=result.run_id,
        )
        return AutoTrainingResult(
            status="attempted",
            batch_size=batch_size,
            pending_work_count=pending_auto_training_work_count(self._database),
            batch_id=batch.batch_id,
            training=_training_result(result),
        )

    def run_auto_training(self, batch_size: int) -> AutoTrainingResult:
        return consume_training_steps(self.run_auto_training_steps(batch_size))

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


def _training_result(result: TrainingWorkflowResult) -> TrainingResult:
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
