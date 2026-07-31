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


class ClassificationHeadManifest(ContractModel):
    kind: Literal["standard-scaler-logistic-regression"]
    feature_dimension: Literal[768]
    regularization_c: float = Field(gt=0)
    class_weight: Literal["balanced"]
    threshold: Probability
    metrics: PilotMetrics


class ModelBundleSource(ContractModel):
    kind: Literal["trusted-joblib-import"]
    file_name: str = Field(min_length=1)
    sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class ModelBundleManifest(ContractModel):
    schema_version: Literal[1]
    bundle_version: int = Field(ge=1)
    encoder: Literal["google/siglip2-base-patch16-224"]
    encoder_revision: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{40}$")]
    preprocess: Literal["white-letterbox-224/four-of-twelve/color-mono-v1"]
    pooling: Literal["page-l2/mean/work-l2"]
    classification_head: ClassificationHeadManifest
    ranking_head: None = None
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
    force_immediate: bool = False


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
    probability: Probability
    bundle_version: int = Field(ge=1)
    short_code: ShortCode
    sampled_pages: list[str]
    candidate_page_count: int = Field(ge=1)
    page_count: int = Field(ge=1)
    stale: bool = False


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


class ModelSummary(ContractModel):
    bundle_version: int = Field(ge=1)
    status: ModelBundleStatus
    classification_metrics: dict[str, float] = Field(default_factory=dict)
    ranking_metrics: dict[str, float] = Field(default_factory=dict)
    data_revision: int = Field(ge=0)
    created_at: datetime
    pinned: bool = False


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


CONTRACT_MODELS: tuple[type[ContractModel], ...] = (
    CmScoreDocument,
    ScoreLibraryCommand,
    ScoreWorkCommand,
    ScanFeedbackCommand,
    ApplyFeedbackCommand,
    ListReviewItemsCommand,
    ResolveReviewItemCommand,
    TrainHeadsCommand,
    ListModelsCommand,
    ActivateModelCommand,
    RollbackModelCommand,
    EnvironmentStatusCommand,
    MigrateEnvironmentCommand,
    WorkScoreResult,
    TaskReference,
    ReviewItem,
    ModelSummary,
    ModelBundleManifest,
    ActiveModelPointer,
    EnvironmentStatus,
)
