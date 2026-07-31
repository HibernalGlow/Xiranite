from __future__ import annotations

import anyio
from mcp import Client

from xiranite_clipm.server import mcp
from xiranite_clipm.service import ClipmService
from xiranite_clipm.settings import ClipmSettings


def test_service_health_creates_isolated_database(tmp_path) -> None:
    settings = ClipmSettings.from_environment()
    service = ClipmService(
        ClipmSettings(
            runtime_root=tmp_path / "runtime",
            device=settings.device,
            model_residency=settings.model_residency,
        )
    )
    try:
        status = service.health()
        assert status.healthy is True
        assert status.database_ok is True
        assert status.model_available is False
        assert (tmp_path / "runtime" / "data" / "clipm.sqlite").is_file()
    finally:
        service.close()


def test_official_mcp_client_calls_health_in_memory(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("XIRANITE_CLIPM_RUNTIME_ROOT", str(tmp_path / "mcp-runtime"))

    async def call_health() -> None:
        async with Client(mcp) as client:
            tools = await client.list_tools()
            by_name = {tool.name: tool for tool in tools.tools}
            assert set(by_name) == {"health", "environment_status"}
            assert by_name["health"].output_schema is not None
            assert "databaseOk" in by_name["health"].output_schema["properties"]
            result = await client.call_tool("health", {})
            assert result.is_error is False
            assert result.structured_content is not None
            assert result.structured_content["databaseOk"] is True
            assert result.structured_content["runtimeRoot"] == str(tmp_path / "mcp-runtime")

    anyio.run(call_health)
