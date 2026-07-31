from __future__ import annotations

import anyio
from mcp import Client
import numpy as np

from xiranite_clipm.contracts import CmLabel, DevicePreference, ModelResidency
from xiranite_clipm.server import mcp
from xiranite_clipm.scoring import ScoredWork
from xiranite_clipm.service import ClipmService
from xiranite_clipm.settings import ClipmSettings


def test_service_health_creates_isolated_database(tmp_path) -> None:
    settings = ClipmSettings.from_environment()
    service = ClipmService(
        ClipmSettings(
            runtime_root=tmp_path / "runtime",
            device=settings.device,
            model_residency=settings.model_residency,
            huggingface_cache=tmp_path / "runtime" / "huggingface-cache",
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


def test_service_composes_scoring_and_database_persistence(tmp_path) -> None:
    class FakeScoring:
        unloaded = False

        def score_work(self, path):
            return ScoredWork(
                path=path,
                label=CmLabel.POSITIVE,
                score=873,
                probability=0.873,
                bundle_version=1,
                embedding=np.zeros(768, dtype=np.float32),
                sampled_pages=["01.png", "04.png", "07.png", "10.png"],
                candidate_page_count=12,
                page_count=40,
            )

        def unload(self):
            self.unloaded = True

    scoring = FakeScoring()
    runtime_root = tmp_path / "scoring-runtime"
    settings = ClipmSettings(
        runtime_root=runtime_root,
        device=DevicePreference.CPU,
        model_residency=ModelResidency.IMMEDIATE,
        huggingface_cache=runtime_root / "huggingface-cache",
    )
    service = ClipmService(settings, scoring=scoring)  # type: ignore[arg-type]
    try:
        result = service.score_work(str(tmp_path / "book.zip"))
        assert result.score == 873
        assert result.short_code
        assert scoring.unloaded is True
    finally:
        service.close()
