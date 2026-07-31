from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
import logging
import sys

from mcp.server import MCPServer
from mcp.server.mcpserver import Context

from .contracts import EnvironmentStatus
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


def main() -> None:
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
