from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
import logging
import sys
from typing import Annotated
from uuid import UUID

from mcp.server import MCPServer
from mcp.server.mcpserver import Context
from pydantic import Field

from .contracts import (
    ApplyFeedbackCommand,
    CmLabel,
    EnvironmentStatus,
    FeedbackApplyResult,
    FeedbackOrigin,
    FeedbackScanResult,
    ListReviewItemsCommand,
    NonEmptyPath,
    ResolveReviewItemCommand,
    ReviewItemsResult,
    ReviewResolution,
    ReviewStatus,
    ScoreOptions,
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


@mcp.tool(name="score_work", structured_output=True)
async def score_work(
    path: NonEmptyPath,
    context: Context[WorkerContext],
    options: ScoreOptions | None = None,
) -> WorkScoreResult:
    """Score or synchronize one comic work, honoring cached results and explicit score options."""
    return _service(context).score_work(path, options)


@mcp.tool(name="list_review_items", structured_output=True)
async def list_review_items(
    context: Context[WorkerContext],
    status: ReviewStatus = ReviewStatus.PENDING,
    limit: Annotated[int, Field(ge=1, le=1000)] = 100,
) -> ReviewItemsResult:
    """List ClipM identity conflicts awaiting or recording an explicit decision."""
    return _service(context).list_review_items(ListReviewItemsCommand(status=status, limit=limit))


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


@mcp.tool(name="scan_feedback", structured_output=True)
async def scan_feedback(
    path: NonEmptyPath,
    context: Context[WorkerContext],
) -> FeedbackScanResult:
    """Scan a library or work path for external ClipM filename corrections and identity conflicts."""
    return _service(context).scan_feedback(path)


def main() -> None:
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
