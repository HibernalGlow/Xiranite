from __future__ import annotations

import base64
import binascii
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel


Score = Annotated[int, Field(ge=0, le=1000)]
Probability = Annotated[float, Field(ge=0.0, le=1.0)]
ShortCode = Annotated[str, StringConstraints(pattern=r"^[0-9A-HJKMNP-TV-Z]{4,}$")]
NonEmptyPath = Annotated[str, StringConstraints(min_length=1)]


class ContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
        serialize_by_alias=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class CmLabel(StrEnum):
    POSITIVE = "P"
    NEGATIVE = "N"


class ValueSource(StrEnum):
    MODEL = "model"
    FILENAME = "filename"
    GUI = "gui"
    NEOVIEW = "neoview"
    JSON = "json"


class ArchiveFormat(StrEnum):
    ZIP = "zip"
    CBZ = "cbz"
    SEVEN_ZIP = "7z"
    CB7 = "cb7"
    RAR = "rar"
    CBR = "cbr"
    DIRECTORY = "directory"


class MetadataWriteStatus(StrEnum):
    WRITTEN = "written"
    UNSUPPORTED = "unsupported"
    SKIPPED = "skipped"
    FAILED = "failed"


class FeedbackOrigin(StrEnum):
    FILENAME = "filename"
    GUI = "gui"
    NEOVIEW = "neoview"


class ReviewKind(StrEnum):
    INVALID_SUFFIX = "invalid_suffix"
    IDENTITY_CONFLICT = "identity_conflict"
    SHORT_CODE_CONFLICT = "short_code_conflict"
    RECOVERY_CANDIDATE = "recovery_candidate"


class ReviewStatus(StrEnum):
    PENDING = "pending"
    RESOLVED = "resolved"


class ReviewResolution(StrEnum):
    USE_FILENAME = "use_filename"
    USE_JSON = "use_json"
    LINK_EXISTING = "link_existing"
    NEW_WORK = "new_work"


class ModelBundleStatus(StrEnum):
    CANDIDATE = "candidate"
    ACTIVE = "active"
    INACTIVE = "inactive"
    FAILED = "failed"


class PilotMetrics(ContractModel):
    samples: int = Field(ge=1)
    positive_samples: int = Field(ge=1)
    negative_samples: int = Field(ge=1)
    roc_auc: Probability
    macro_average_precision: Probability
    balanced_accuracy: Probability
    correction_samples: int = Field(default=0, ge=0)
    oof_splits: int = Field(default=0, ge=0)
    active_correction_log_loss: float | None = Field(default=None, ge=0)
    candidate_correction_log_loss: float | None = Field(default=None, ge=0)
    active_validation_roc_auc: Probability | None = None
    active_validation_balanced_accuracy: Probability | None = None
    active_validation_macro_average_precision: Probability | None = None


class ClassificationHeadManifest(ContractModel):
    kind: Literal["standard-scaler-logistic-regression"]
    feature_dimension: Literal[768]
    regularization_c: float = Field(gt=0)
    class_weight: Literal["balanced"]
    threshold: Probability
    metrics: PilotMetrics
    validation_status: Literal["accepted", "rejected", "imported"] = "imported"
    validation_reasons: list[str] = Field(default_factory=list)


class RankingHeadMetrics(ContractModel):
    correction_samples: int = Field(ge=20)
    oof_splits: int = Field(ge=2)
    baseline_weighted_mae: float = Field(ge=0)
    candidate_weighted_mae: float = Field(ge=0)
    baseline_spearman: float = Field(ge=-1, le=1)
    candidate_spearman: float = Field(ge=-1, le=1)


class RankingHeadManifest(ContractModel):
    kind: Literal["standard-scaler-ridge-cv"]
    feature_dimension: Literal[768]
    alpha: float = Field(gt=0)
    metrics: RankingHeadMetrics
    validation_status: Literal["accepted", "rejected"]
    validation_reasons: list[str] = Field(default_factory=list)


class ModelBundleSource(ContractModel):
    kind: Literal["trusted-joblib-import", "head-training"]
    file_name: str | None = Field(default=None, min_length=1)
    sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")] | None = None
    training_run_id: UUID | None = None
    parent_bundle_version: int | None = Field(default=None, ge=1)
    trained_head: Literal["classification", "ranking"] | None = None

    @model_validator(mode="after")
    def validate_source_fields(self) -> ModelBundleSource:
        trusted_fields = self.file_name is not None and self.sha256 is not None
        any_trusted_fields = self.file_name is not None or self.sha256 is not None
        training_fields = (
            self.training_run_id is not None
            and self.parent_bundle_version is not None
            and self.trained_head is not None
        )
        any_training_fields = (
            self.training_run_id is not None
            or self.parent_bundle_version is not None
            or self.trained_head is not None
        )
        if self.kind == "trusted-joblib-import" and (not trusted_fields or any_training_fields):
            raise ValueError("trusted model sources require fileName and sha256 only")
        if self.kind == "head-training" and (not training_fields or any_trusted_fields):
            raise ValueError("trained model sources require run, parent bundle, and trained head only")
        return self


class ModelBundleManifest(ContractModel):
    schema_version: Literal[1]
    bundle_version: int = Field(ge=1)
    encoder: Literal["google/siglip2-base-patch16-224"]
    encoder_revision: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{40}$")]
    preprocess: Literal["white-letterbox-224/four-of-twelve/color-mono-v1"]
    pooling: Literal["page-l2/mean/work-l2"]
    classification_head: ClassificationHeadManifest
    ranking_head: RankingHeadManifest | None = None
    weights_sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    source: ModelBundleSource
    created_at: datetime


class ActiveModelPointer(ContractModel):
    schema_version: Literal[1]
    bundle_version: int = Field(ge=1)
    activated_at: datetime


class ModelResidency(StrEnum):
    IMMEDIATE = "immediate"
    IDLE_10M = "idle-10m"
    WORKER = "worker"


class DevicePreference(StrEnum):
    CUDA = "cuda"
    CPU = "cpu"


class WorkIdentity(ContractModel):
    work_id: UUID
    record_number: int = Field(ge=1)
    short_code: ShortCode
    first_seen_name: str = Field(min_length=1)
    current_base_name: str = Field(min_length=1)
    name_revision: int = Field(ge=0)


class ClassificationSnapshot(ContractModel):
    predicted: CmLabel
    current: CmLabel
    source: ValueSource


class RankingSnapshot(ContractModel):
    predicted: Score
    current: Score
    source: ValueSource


class ScoreSnapshot(ContractModel):
    bundle_version: int = Field(ge=1)
    classification: ClassificationSnapshot
    ranking: RankingSnapshot
    probability: Probability | None = None
    scored_at: datetime


class EmbeddingPayload(ContractModel):
    encoder: Literal["google/siglip2-base-patch16-224"]
    preprocess: Literal["white-letterbox-224/four-of-twelve/color-mono-v1"]
    dtype: Literal["float16"]
    shape: Annotated[list[Literal[768]], Field(min_length=1, max_length=1)]
    encoding: Literal["base64"]
    data: str

    @field_validator("data")
    @classmethod
    def validate_data(cls, value: str) -> str:
        try:
            decoded = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("embedding data must be canonical base64") from error
        if len(decoded) != 768 * 2:
            raise ValueError("float16 ClipM embeddings must contain exactly 1536 bytes")
        return value


class ArchiveSnapshot(ContractModel):
    format: ArchiveFormat
    metadata_write_status: MetadataWriteStatus


class NameHistoryEntry(ContractModel):
    revision: int = Field(ge=1)
    previous_name: str = Field(min_length=1)
    current_name: str = Field(min_length=1)
    changed_at: datetime
    source: ValueSource


class FeedbackHistoryEntry(ContractModel):
    event_id: UUID
    occurred_at: datetime
    source: FeedbackOrigin
    classification_before: CmLabel | None = None
    classification_after: CmLabel | None = None
    ranking_before: Score | None = None
    ranking_after: Score | None = None
    undone_by: UUID | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> FeedbackHistoryEntry:
        classification_pair = self.classification_before is not None and self.classification_after is not None
        ranking_pair = self.ranking_before is not None and self.ranking_after is not None
        if (self.classification_before is None) != (self.classification_after is None):
            raise ValueError("classification feedback requires before and after values")
        if (self.ranking_before is None) != (self.ranking_after is None):
            raise ValueError("ranking feedback requires before and after values")
        if not classification_pair and not ranking_pair:
            raise ValueError("feedback must change classification, ranking, or both")
        classification_changed = classification_pair and self.classification_before != self.classification_after
        ranking_changed = ranking_pair and self.ranking_before != self.ranking_after
        if not classification_changed and not ranking_changed:
            raise ValueError("feedback before and after values are identical")
        return self


class CmScoreDocument(ContractModel):
    schema_version: Literal[1]
    work: WorkIdentity
    score: ScoreSnapshot
    embedding: EmbeddingPayload
    archive: ArchiveSnapshot
    name_history: list[NameHistoryEntry] = Field(default_factory=list)
    feedback_history: list[FeedbackHistoryEntry] = Field(default_factory=list)

    @field_validator("score")
    @classmethod
    def require_aware_scored_at(cls, value: ScoreSnapshot) -> ScoreSnapshot:
        if value.scored_at.tzinfo is None or value.scored_at.utcoffset() is None:
            raise ValueError("scoredAt must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_history_chains(self) -> CmScoreDocument:
        current_name = self.work.first_seen_name
        if len(self.name_history) != self.work.name_revision:
            raise ValueError("nameHistory must contain every revision")
        for revision, entry in enumerate(self.name_history, start=1):
            if entry.revision != revision:
                raise ValueError("nameHistory revisions must be contiguous and start at 1")
            if entry.previous_name != current_name:
                raise ValueError("nameHistory previousName does not match the preceding revision")
            current_name = entry.current_name
        if current_name != self.work.current_base_name:
            raise ValueError("nameHistory does not end at currentBaseName")

        event_ids = [entry.event_id for entry in self.feedback_history]
        if len(event_ids) != len(set(event_ids)):
            raise ValueError("feedbackHistory eventId values must be unique")
        known_ids = set(event_ids)
        for entry in self.feedback_history:
            if entry.undone_by is not None and (entry.undone_by == entry.event_id or entry.undone_by not in known_ids):
                raise ValueError("feedbackHistory undoneBy must reference another event in the document")
        return self


class ScoreOptions(ContractModel):
    rescore: bool = False
    rename: bool = True
    write_metadata: bool = True
    dry_run: bool = False


class ScoreLibraryCommand(ContractModel):
    path: NonEmptyPath
    options: ScoreOptions = Field(default_factory=ScoreOptions)


class ScoreWorkCommand(ContractModel):
    path: NonEmptyPath
    options: ScoreOptions = Field(default_factory=ScoreOptions)


class GetWorkScoreCommand(ContractModel):
    path: NonEmptyPath


class ScanFeedbackCommand(ContractModel):
    path: NonEmptyPath


class ApplyFeedbackCommand(ContractModel):
    work_id: UUID
    classification: CmLabel | None = None
    ranking: Score | None = None
    source: FeedbackOrigin

    @model_validator(mode="after")
    def require_value(self) -> ApplyFeedbackCommand:
        if self.classification is None and self.ranking is None:
            raise ValueError("classification or ranking is required")
        return self


class ListFeedbackEventsCommand(ContractModel):
    work_id: UUID | None = None
    include_undone: bool = True
    limit: int = Field(default=100, ge=1, le=1000)
    before_occurred_at: datetime | None = None
    before_event_id: UUID | None = None

    @model_validator(mode="after")
    def validate_cursor(self) -> ListFeedbackEventsCommand:
        if (self.before_occurred_at is None) != (self.before_event_id is None):
            raise ValueError("beforeOccurredAt and beforeEventId must be provided together")
        return self


class UndoFeedbackCommand(ContractModel):
    event_id: UUID
    source: FeedbackOrigin = FeedbackOrigin.GUI


class RemoveWorkMetadataCommand(ContractModel):
    path: NonEmptyPath


class ListReviewItemsCommand(ContractModel):
    status: ReviewStatus = ReviewStatus.PENDING
    limit: int = Field(default=100, ge=1, le=1000)


class ResolveReviewItemCommand(ContractModel):
    review_id: UUID
    resolution: ReviewResolution
    existing_work_id: UUID | None = None

    @model_validator(mode="after")
    def validate_existing_work(self) -> ResolveReviewItemCommand:
        if self.resolution is ReviewResolution.LINK_EXISTING and self.existing_work_id is None:
            raise ValueError("link_existing requires existingWorkId")
        if self.resolution is not ReviewResolution.LINK_EXISTING and self.existing_work_id is not None:
            raise ValueError("existingWorkId is only valid for link_existing")
        return self


class TrainHeadsCommand(ContractModel):
    pass


class RunAutoTrainingCommand(ContractModel):
    batch_size: int = Field(default=20, ge=1, le=1000)


class ListModelsCommand(ContractModel):
    include_failed: bool = True


class ActivateModelCommand(ContractModel):
    bundle_version: int = Field(ge=1)
    force: bool = False


class RollbackModelCommand(ContractModel):
    bundle_version: int = Field(ge=1)


class EnvironmentStatusCommand(ContractModel):
    include_archive_tools: bool = True


class MigrateEnvironmentCommand(ContractModel):
    target_runtime_root: NonEmptyPath

    @field_validator("target_runtime_root")
    @classmethod
    def require_absolute_path(cls, value: str) -> str:
        if not Path(value).is_absolute():
            raise ValueError("targetRuntimeRoot must be absolute")
        return value


class WorkScoreResult(ContractModel):
    work_id: UUID
    path: NonEmptyPath
    label: CmLabel
    score: Score
    predicted_label: CmLabel | None = None
    predicted_score: Score | None = None
    classification_corrected: bool = False
    ranking_corrected: bool = False
    probability: Probability | None = None
    bundle_version: int = Field(ge=1)
    short_code: ShortCode
    sampled_pages: list[str] = Field(default_factory=list)
    candidate_page_count: int = Field(default=0, ge=0)
    page_count: int = Field(default=0, ge=0)
    metadata_write_status: MetadataWriteStatus = MetadataWriteStatus.SKIPPED
    renamed: bool = False
    stale: bool = False


class WorkScoreLookupResult(ContractModel):
    path: NonEmptyPath
    work: WorkScoreResult | None = None


class WorkScoreFailure(ContractModel):
    path: NonEmptyPath
    error_type: str = Field(min_length=1)
    message: str = Field(min_length=1)


class ScoreLibraryResult(ContractModel):
    path: NonEmptyPath
    discovered_work_count: int = Field(ge=0)
    succeeded_work_count: int = Field(ge=0)
    failed_work_count: int = Field(ge=0)
    feedback: FeedbackScanResult
    works: list[WorkScoreResult] = Field(default_factory=list)
    failures: list[WorkScoreFailure] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_counts(self) -> ScoreLibraryResult:
        if self.succeeded_work_count != len(self.works):
            raise ValueError("succeededWorkCount must match works")
        if self.failed_work_count != len(self.failures):
            raise ValueError("failedWorkCount must match failures")
        if self.discovered_work_count != self.succeeded_work_count + self.failed_work_count:
            raise ValueError("discoveredWorkCount must equal succeeded and failed work counts")
        return self


class TaskReference(ContractModel):
    task_id: UUID
    accepted_at: datetime


class ReviewItem(ContractModel):
    review_id: UUID
    kind: ReviewKind
    status: ReviewStatus
    work_id: UUID | None = None
    path: NonEmptyPath
    details: dict[str, object]
    created_at: datetime
    resolution: ReviewResolution | None = None
    resolved_at: datetime | None = None


class ReviewItemsResult(ContractModel):
    items: list[ReviewItem]


class FeedbackApplyResult(ContractModel):
    work: WorkScoreResult
    event: FeedbackHistoryEntry | None = None


class FeedbackEventRecord(FeedbackHistoryEntry):
    work_id: UUID
    current_path: NonEmptyPath | None = None
    undo_applicable: bool


class FeedbackEventsResult(ContractModel):
    events: list[FeedbackEventRecord] = Field(default_factory=list)
    has_more: bool = False
    next_before_occurred_at: datetime | None = None
    next_before_event_id: UUID | None = None


class FeedbackScanResult(ContractModel):
    path: NonEmptyPath
    scanned_work_count: int = Field(ge=0)
    synchronized_work_count: int = Field(ge=0)
    imported_feedback_count: int = Field(ge=0)
    imported_feedback: list[FeedbackApplyResult] = Field(default_factory=list)
    review_items: list[ReviewItem] = Field(default_factory=list)
    works: list[WorkScoreResult] = Field(default_factory=list)


class ModelSummary(ContractModel):
    bundle_version: int = Field(ge=1)
    status: ModelBundleStatus
    classification_metrics: dict[str, float] = Field(default_factory=dict)
    ranking_metrics: dict[str, float] = Field(default_factory=dict)
    data_revision: int = Field(ge=0)
    created_at: datetime
    pinned: bool = False
    classification_validation_status: Literal["accepted", "rejected", "imported"]
    classification_validation_reasons: list[str] = Field(default_factory=list)
    ranking_validation_status: Literal["accepted", "rejected"] | None = None
    ranking_validation_reasons: list[str] = Field(default_factory=list)


class ModelsResult(ContractModel):
    models: list[ModelSummary]
    active_bundle_version: int | None = Field(default=None, ge=1)


class HeadTrainingResult(ContractModel):
    status: Literal["accepted", "rejected", "skipped"]
    reasons: list[str] = Field(default_factory=list)
    bundle_version: int | None = Field(default=None, ge=1)


class TrainingResult(ContractModel):
    run_id: UUID
    data_revision: int = Field(ge=0)
    classification: HeadTrainingResult
    ranking: HeadTrainingResult
    active_bundle_version: int = Field(ge=1)


class AutoTrainingResult(ContractModel):
    status: Literal["not_ready", "attempted"]
    batch_size: int = Field(ge=1)
    pending_work_count: int = Field(ge=0)
    batch_id: UUID | None = None
    training: TrainingResult | None = None


class RemoveWorkMetadataResult(ContractModel):
    original_path: NonEmptyPath
    final_path: NonEmptyPath
    work_id: UUID | None = None
    database_removed: bool
    metadata_removed: bool
    renamed: bool


class ModelActivationResult(ContractModel):
    previous_bundle_version: int | None = Field(default=None, ge=1)
    active_bundle_version: int = Field(ge=1)
    forced: bool = False


class EnvironmentStatus(ContractModel):
    healthy: bool
    service_version: str
    runtime_root: NonEmptyPath
    python_version: str
    device: DevicePreference
    cuda_available: bool
    model_available: bool
    model_residency: ModelResidency
    active_bundle_version: int | None = Field(default=None, ge=1)
    database_ok: bool
    seven_zip_available: bool
    rar_available: bool
    warnings: list[str] = Field(default_factory=list)


class EnvironmentMigrationResult(ContractModel):
    source_runtime_root: NonEmptyPath
    target_runtime_root: NonEmptyPath
    source_status: EnvironmentStatus
    target_status: EnvironmentStatus
    python_environment_recreated: bool
    copied_components: list[
        Literal["database", "models", "training", "huggingface-cache", "uv-cache"]
    ] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


CONTRACT_MODELS: tuple[type[ContractModel], ...] = (
    CmScoreDocument,
    ScoreLibraryCommand,
    ScoreWorkCommand,
    GetWorkScoreCommand,
    ScanFeedbackCommand,
    ApplyFeedbackCommand,
    ListFeedbackEventsCommand,
    UndoFeedbackCommand,
    RemoveWorkMetadataCommand,
    ListReviewItemsCommand,
    ResolveReviewItemCommand,
    TrainHeadsCommand,
    RunAutoTrainingCommand,
    ListModelsCommand,
    ActivateModelCommand,
    RollbackModelCommand,
    EnvironmentStatusCommand,
    MigrateEnvironmentCommand,
    WorkScoreResult,
    WorkScoreLookupResult,
    WorkScoreFailure,
    ScoreLibraryResult,
    TaskReference,
    ReviewItem,
    ReviewItemsResult,
    FeedbackApplyResult,
    FeedbackEventRecord,
    FeedbackEventsResult,
    FeedbackScanResult,
    ModelSummary,
    ModelsResult,
    TrainingResult,
    AutoTrainingResult,
    RemoveWorkMetadataResult,
    ModelActivationResult,
    ModelBundleManifest,
    ActiveModelPointer,
    EnvironmentStatus,
    EnvironmentMigrationResult,
)
