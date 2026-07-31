from __future__ import annotations

import anyio
from mcp import Client
import numpy as np
from pathlib import Path

from xiranite_clipm.archive_metadata import ArchiveMetadataWriter, CM_METADATA_NAME
from xiranite_clipm.contracts import CmLabel, DevicePreference, ModelResidency, ScoreOptions
from xiranite_clipm.filename import CmFilenameTag, scored_path
from xiranite_clipm.server import mcp
from xiranite_clipm.scoring import ScoredWork
from xiranite_clipm.service import ClipmService
from xiranite_clipm.settings import ClipmSettings


class FakeScoring:
    def __init__(self, outcomes: list[tuple[CmLabel, int]]):
        self.outcomes = outcomes
        self.calls = 0
        self.unloaded = False

    def score_work(self, path):
        label, score = self.outcomes[self.calls]
        self.calls += 1
        return ScoredWork(
            path=path,
            label=label,
            score=score,
            probability=score / 1000,
            bundle_version=1,
            embedding=np.zeros(768, dtype=np.float32),
            sampled_pages=["01.png"],
            candidate_page_count=1,
            page_count=1,
        )

    def unload(self):
        self.unloaded = True


def scoring_service(
    tmp_path: Path,
    runtime_name: str,
    scoring: FakeScoring,
    metadata: ArchiveMetadataWriter | None = None,
) -> ClipmService:
    runtime_root = tmp_path / runtime_name
    return ClipmService(
        ClipmSettings(
            runtime_root=runtime_root,
            device=DevicePreference.CPU,
            model_residency=ModelResidency.IMMEDIATE,
            huggingface_cache=runtime_root / "huggingface-cache",
        ),
        scoring=scoring,  # type: ignore[arg-type]
        metadata=metadata,
    )


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
    scoring = FakeScoring([(CmLabel.POSITIVE, 873)])
    service = scoring_service(tmp_path, "scoring-runtime", scoring)
    work = tmp_path / "book"
    work.mkdir()
    try:
        result = service.score_work(str(work))
        assert result.score == 873
        assert result.short_code
        assert result.renamed is True
        assert Path(result.path).is_dir()
        assert (Path(result.path) / CM_METADATA_NAME).is_file()
        assert scoring.unloaded is True

        corrected_path = Path(
            scored_path(
                result.path,
                CmFilenameTag(result.bundle_version, CmLabel.NEGATIVE, 342, result.short_code),
            )
        )
        Path(result.path).rename(corrected_path)
        corrected = service.score_work(str(corrected_path))
        assert corrected.label is CmLabel.NEGATIVE
        assert corrected.score == 342
        assert corrected.renamed is False
        assert scoring.calls == 1
        assert service._database is not None
        location = service._database.execute(
            "SELECT path FROM work_locations WHERE is_current = 1"
        ).fetchone()[0]
        assert Path(location) == corrected_path
        assert service._database.execute("SELECT count(*) FROM feedback_events").fetchone()[0] == 1
    finally:
        service.close()


def test_new_work_dry_run_only_returns_proposal(tmp_path) -> None:
    scoring = FakeScoring([(CmLabel.POSITIVE, 873)])
    service = scoring_service(tmp_path, "dry-run-runtime", scoring)
    work = tmp_path / "preview"
    work.mkdir()
    try:
        result = service.score_work(str(work), ScoreOptions(dry_run=True))
        assert scoring.calls == 1
        assert result.renamed is False
        assert result.metadata_write_status == "skipped"
        assert result.path != str(work)
        assert not Path(result.path).exists()
        assert work.is_dir()
        assert not (work / CM_METADATA_NAME).exists()
        assert service._database is not None
        for table in ("works", "work_locations", "score_snapshots", "embeddings", "feedback_events"):
            assert service._database.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    finally:
        service.close()


def test_existing_work_dry_run_does_not_import_filename_feedback_or_relocate(tmp_path) -> None:
    scoring = FakeScoring([(CmLabel.POSITIVE, 873)])
    service = scoring_service(tmp_path, "existing-dry-run-runtime", scoring)
    work = tmp_path / "book"
    work.mkdir()
    try:
        persisted = service.score_work(str(work))
        persisted_path = Path(persisted.path)
        corrected_path = Path(
            scored_path(
                persisted.path,
                CmFilenameTag(persisted.bundle_version, CmLabel.NEGATIVE, 342, persisted.short_code),
            )
        )
        persisted_path.rename(corrected_path)

        preview = service.score_work(str(corrected_path), ScoreOptions(dry_run=True))
        assert preview.label is CmLabel.NEGATIVE
        assert preview.score == 342
        assert preview.path == str(corrected_path)
        assert scoring.calls == 1
        assert corrected_path.is_dir()
        assert not persisted_path.exists()
        assert service._database is not None
        assert service._database.execute("SELECT count(*) FROM feedback_events").fetchone()[0] == 0
        location = service._database.execute(
            "SELECT path FROM work_locations WHERE is_current = 1"
        ).fetchone()[0]
        assert Path(location) == persisted_path
    finally:
        service.close()


def test_rescore_dry_run_returns_model_proposal_without_persistence(tmp_path) -> None:
    scoring = FakeScoring([(CmLabel.POSITIVE, 873), (CmLabel.NEGATIVE, 125)])
    service = scoring_service(tmp_path, "rescore-dry-run-runtime", scoring)
    work = tmp_path / "book"
    work.mkdir()
    try:
        persisted = service.score_work(str(work))
        preview = service.score_work(persisted.path, ScoreOptions(dry_run=True, rescore=True))
        assert preview.label is CmLabel.NEGATIVE
        assert preview.score == 125
        assert scoring.calls == 2
        assert not Path(preview.path).exists()
        assert Path(persisted.path).is_dir()
        assert service._database is not None
        assert service._database.execute("SELECT count(*) FROM score_snapshots").fetchone()[0] == 1
        assert service._database.execute("SELECT current_score FROM works").fetchone()[0] == 873
    finally:
        service.close()


def test_disabled_metadata_write_does_not_probe_archive_tools(tmp_path) -> None:
    class NoMetadataAccess:
        def read(self, path):
            return None

        def capability(self, path):
            raise AssertionError("metadata capability must not be queried")

        def write(self, path, document):
            raise AssertionError("metadata must not be written")

    scoring = FakeScoring([(CmLabel.POSITIVE, 873)])
    service = scoring_service(
        tmp_path,
        "no-metadata-runtime",
        scoring,
        NoMetadataAccess(),  # type: ignore[arg-type]
    )
    work = tmp_path / "book.zip"
    work.write_bytes(b"not-an-archive")
    try:
        result = service.score_work(str(work), ScoreOptions(rename=False, write_metadata=False))
        assert result.path == str(work)
        assert result.metadata_write_status == "skipped"
    finally:
        service.close()
