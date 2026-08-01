from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
import logging
import sys
from typing import Annotated
from uuid import UUID

import anyio
from mcp.server import MCPServer
from mcp.server.mcpserver import Context
from pydantic import Field

from .contracts import (
    ApplyFeedbackCommand,
    ActivateModelCommand,
    AutoTrainingResult,
    CmLabel,
    EnvironmentStatus,
    EnvironmentMigrationResult,
    FeedbackApplyResult,
    FeedbackEventsResult,
    FeedbackOrigin,
    FeedbackScanResult,
    ListFeedbackEventsCommand,
    ListReviewItemsCommand,
    ListModelsCommand,
    ModelActivationResult,
    ModelsResult,
    MigrateEnvironmentCommand,
    NonEmptyPath,
    PerceptualRecoveryStatus,
    PerceptualRecoveryStatusCommand,
    RemoveWorkMetadataCommand,
    RemoveWorkMetadataResult,
    ResolveReviewItemCommand,
    RollbackModelCommand,
    ReviewItemsResult,
    ReviewResolution,
    ReviewStatus,
    ScoreOptions,
    ScoreLibraryResult,
    TrainingResult,
    WorkScoreLookupResult,
    UndoFeedbackCommand,
    WorkScoreResult,
)
from .service import ClipmService, SERVICE_VERSION
from .settings import ClipmSettings


@dataclass(slots=True)
class WorkerContext:
    service: ClipmService


@asynccontextmanager
async def worker_lifespan(_server: MCPServer[WorkerContext]) -> AsyncIterator[WorkerContext]:
    service = ClipmService(ClipmSettings.from_environment())
    service.start()
    try:
        yield WorkerContext(service=service)
    finally:
        service.close()


mcp = MCPServer[WorkerContext](
    name="xiranite-clipm",
    title="Xiranite CM",
    description="Personal comic preference scoring and feedback service.",
    version=SERVICE_VERSION,
    lifespan=worker_lifespan,
    log_level="WARNING",
)


def _service(context: Context[WorkerContext]) -> ClipmService:
    return context.request_context.lifespan_context.service


@mcp.tool(name="health", structured_output=True)
async def health(context: Context[WorkerContext]) -> EnvironmentStatus:
    """Check the ClipM worker, runtime, database, model, GPU, and archive tools."""
    return _service(context).health()


@mcp.tool(name="environment_status", structured_output=True)
async def environment_status(context: Context[WorkerContext]) -> EnvironmentStatus:
    """Return the current external ClipM runtime status."""
    return _service(context).health()


@mcp.tool(name="migrate_environment", structured_output=True)
async def migrate_environment(
    targetRuntimeRoot: NonEmptyPath,
    context: Context[WorkerContext],
) -> EnvironmentMigrationResult:
    """Recreate the external runtime, copy verified data, and validate the target environment."""
    steps = _service(context).migrate_environment_steps(
        MigrateEnvironmentCommand(target_runtime_root=targetRuntimeRoot)
    )
    try:
        while True:
            try:
                progress = next(steps)
            except StopIteration as completed:
                return completed.value
            await context.report_progress(progress.progress, 100, progress.message)
            await anyio.lowlevel.checkpoint()
    finally:
        steps.close()


@mcp.tool(name="score_work", structured_output=True)
async def score_work(
    path: NonEmptyPath,
    context: Context[WorkerContext],
    options: ScoreOptions | None = None,
) -> WorkScoreResult:
    """Score or synchronize one comic work, honoring cached results and explicit score options."""
    return _service(context).score_work(path, options)


@mcp.tool(name="get_work_score", structured_output=True)
async def get_work_score(
    path: NonEmptyPath,
    context: Context[WorkerContext],
) -> WorkScoreLookupResult:
    """Read one cached work score without opening or modifying the comic archive."""
    return _service(context).get_work_score(path)


@mcp.tool(name="score_library", structured_output=True)
async def score_library(
    path: NonEmptyPath,
    context: Context[WorkerContext],
    options: ScoreOptions | None = None,
) -> ScoreLibraryResult:
    """Scan and score a comic library, reporting progress at safe per-work checkpoints."""
    steps = _service(context).score_library_steps(path, options)
    try:
        while True:
            try:
                progress = next(steps)
            except StopIteration as completed:
                return completed.value
            await context.report_progress(
                progress.completed,
                progress.total,
                f"{'scored' if progress.succeeded else 'failed'}: {progress.path}",
            )
            await anyio.lowlevel.checkpoint()
    finally:
        steps.close()


@mcp.tool(name="list_review_items", structured_output=True)
async def list_review_items(
    context: Context[WorkerContext],
    status: ReviewStatus = ReviewStatus.PENDING,
    limit: Annotated[int, Field(ge=1, le=1000)] = 100,
) -> ReviewItemsResult:
    """List ClipM identity conflicts awaiting or recording an explicit decision."""
    return _service(context).list_review_items(ListReviewItemsCommand(status=status, limit=limit))


@mcp.tool(name="perceptual_recovery_status", structured_output=True)
async def perceptual_recovery_status(
    context: Context[WorkerContext],
    limit: Annotated[int, Field(ge=1, le=1000)] = 100,
) -> PerceptualRecoveryStatus:
    """Inspect page-level recovery telemetry without enabling uncalibrated candidates."""
    return _service(context).get_perceptual_recovery_status(
        PerceptualRecoveryStatusCommand(limit=limit)
    )


@mcp.tool(name="resolve_review_item", structured_output=True)
async def resolve_review_item(
    reviewId: UUID,
    resolution: ReviewResolution,
    context: Context[WorkerContext],
    existingWorkId: UUID | None = None,
) -> WorkScoreResult:
    """Resolve one identity conflict using filename, JSON, an existing work, or a fresh identity."""
    command = ResolveReviewItemCommand(
        review_id=reviewId,
        resolution=resolution,
        existing_work_id=existingWorkId,
    )
    return _service(context).resolve_review_item(command)


@mcp.tool(name="apply_feedback", structured_output=True)
async def apply_feedback(
    workId: UUID,
    source: FeedbackOrigin,
    context: Context[WorkerContext],
    classification: CmLabel | None = None,
    ranking: Annotated[int, Field(ge=0, le=1000)] | None = None,
) -> FeedbackApplyResult:
    """Apply an immediate GUI or NeoView correction and synchronize all work artifacts."""
    command = ApplyFeedbackCommand(
        work_id=workId,
        classification=classification,
        ranking=ranking,
        source=source,
    )
    return _service(context).apply_feedback(command)


@mcp.tool(name="list_feedback_events", structured_output=True)
async def list_feedback_events(
    context: Context[WorkerContext],
    workId: UUID | None = None,
    includeUndone: bool = True,
    limit: Annotated[int, Field(ge=1, le=1000)] = 100,
    beforeOccurredAt: datetime | None = None,
    beforeEventId: UUID | None = None,
) -> FeedbackEventsResult:
    """List feedback event IDs and current work paths so corrections can be audited or undone."""
    return _service(context).list_feedback_events(
        ListFeedbackEventsCommand(
            work_id=workId,
            include_undone=includeUndone,
            limit=limit,
            before_occurred_at=beforeOccurredAt,
            before_event_id=beforeEventId,
        )
    )


@mcp.tool(name="undo_feedback", structured_output=True)
async def undo_feedback(
    eventId: UUID,
    context: Context[WorkerContext],
    source: FeedbackOrigin = FeedbackOrigin.GUI,
) -> FeedbackApplyResult:
    """Append a safe inverse event for the latest applicable correction and synchronize projections."""
    return _service(context).undo_feedback(UndoFeedbackCommand(event_id=eventId, source=source))


@mcp.tool(name="scan_feedback", structured_output=True)
async def scan_feedback(
    path: NonEmptyPath,
    context: Context[WorkerContext],
) -> FeedbackScanResult:
    """Scan a library or work path for external ClipM filename corrections and identity conflicts."""
    return _service(context).scan_feedback(path)


@mcp.tool(name="remove_work_metadata", structured_output=True)
async def remove_work_metadata(
    path: NonEmptyPath,
    context: Context[WorkerContext],
) -> RemoveWorkMetadataResult:
    """Explicitly remove one work's CM identity, root metadata, and filename suffix."""
    return _service(context).remove_work_metadata(RemoveWorkMetadataCommand(path=path))


@mcp.tool(name="train_heads", structured_output=True)
async def train_heads(
    context: Context[WorkerContext],
) -> TrainingResult:
    """Immediately train and independently validate classification and ranking head candidates."""
    steps = _service(context).train_heads_steps()
    try:
        while True:
            try:
                progress = next(steps)
            except StopIteration as completed:
                return completed.value
            await context.report_progress(progress.progress, 100, progress.message)
            await anyio.lowlevel.checkpoint()
    finally:
        steps.close()


@mcp.tool(name="run_auto_training", structured_output=True)
async def run_auto_training(
    context: Context[WorkerContext],
    batchSize: Annotated[int, Field(ge=1, le=1000)] = 20,
) -> AutoTrainingResult:
    """Claim at most one ready feedback batch and attempt automatic head training once."""
    steps = _service(context).run_auto_training_steps(batchSize)
    try:
        while True:
            try:
                progress = next(steps)
            except StopIteration as completed:
                return completed.value
            await context.report_progress(progress.progress, 100, progress.message)
            await anyio.lowlevel.checkpoint()
    finally:
        steps.close()


@mcp.tool(name="list_models", structured_output=True)
async def list_models(
    context: Context[WorkerContext],
    includeFailed: bool = True,
) -> ModelsResult:
    """List active, historical, candidate, and optionally failed model bundles."""
    return _service(context).list_models(ListModelsCommand(include_failed=includeFailed))


@mcp.tool(name="activate_model", structured_output=True)
async def activate_model(
    bundleVersion: Annotated[int, Field(ge=1)],
    context: Context[WorkerContext],
    force: bool = False,
) -> ModelActivationResult:
    """Activate a validated model, or explicitly force a rejected candidate."""
    return _service(context).activate_model(
        ActivateModelCommand(bundle_version=bundleVersion, force=force)
    )


@mcp.tool(name="rollback_model", structured_output=True)
async def rollback_model(
    bundleVersion: Annotated[int, Field(ge=1)],
    context: Context[WorkerContext],
) -> ModelActivationResult:
    """Roll back to any registered historical model that did not fail validation."""
    return _service(context).rollback_model(RollbackModelCommand(bundle_version=bundleVersion))


def main() -> None:
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
