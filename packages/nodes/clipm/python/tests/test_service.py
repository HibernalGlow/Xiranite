from __future__ import annotations

import anyio
from mcp import Client
import numpy as np
from pathlib import Path

from xiranite_clipm.archive_metadata import ArchiveMetadataWriter, CM_METADATA_NAME
from xiranite_clipm.contracts import (
    CmLabel,
    DevicePreference,
    FeedbackScanResult,
    ModelResidency,
    ScoreLibraryResult,
    ScoreOptions,
    WorkScoreFailure,
)
from xiranite_clipm.filename import CmFilenameTag, scored_path
from xiranite_clipm.library_workflow import LibraryProgress
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

    def fake_library_steps(_service, path: str, _options=None):
        yield LibraryProgress(completed=1, total=1, path=f"{path}/broken", succeeded=False)
        return ScoreLibraryResult(
            path=path,
            discovered_work_count=1,
            succeeded_work_count=0,
            failed_work_count=1,
            feedback=FeedbackScanResult(
                path=path,
                scanned_work_count=0,
                synchronized_work_count=0,
                imported_feedback_count=0,
            ),
            failures=[
                WorkScoreFailure(path=f"{path}/broken", error_type="RuntimeError", message="failed")
            ],
        )

    monkeypatch.setattr(ClipmService, "score_library_steps", fake_library_steps)

    async def call_health() -> None:
        async with Client(mcp) as client:
            tools = await client.list_tools()
            by_name = {tool.name: tool for tool in tools.tools}
            assert set(by_name) == {
                "activate_model",
                "health",
                "environment_status",
                "list_models",
                "score_library",
                "score_work",
                "apply_feedback",
                "scan_feedback",
                "list_review_items",
                "rollback_model",
                "resolve_review_item",
                "train_heads",
            }
            assert by_name["health"].output_schema is not None
            assert "databaseOk" in by_name["health"].output_schema["properties"]
            assert set(by_name["score_work"].input_schema["properties"]) == {"path", "options"}
            assert set(by_name["score_library"].input_schema["properties"]) == {"path", "options"}
            assert by_name["score_work"].input_schema["properties"]["path"]["minLength"] == 1
            assert "metadataWriteStatus" in by_name["score_work"].output_schema["properties"]
            assert by_name["list_review_items"].input_schema["properties"]["limit"]["maximum"] == 1000
            assert "existing_work_id" not in by_name["resolve_review_item"].input_schema["properties"]
            assert "existingWorkId" in by_name["resolve_review_item"].input_schema["properties"]
            assert "workId" in by_name["apply_feedback"].input_schema["properties"]
            assert by_name["apply_feedback"].input_schema["properties"]["ranking"]["anyOf"][0]["maximum"] == 1000
            assert "forceImmediate" in by_name["train_heads"].input_schema["properties"]
            assert "includeFailed" in by_name["list_models"].input_schema["properties"]
            assert by_name["activate_model"].input_schema["properties"]["bundleVersion"]["minimum"] == 1
            result = await client.call_tool("health", {})
            assert result.is_error is False
            assert result.structured_content is not None
            assert result.structured_content["databaseOk"] is True
            assert result.structured_content["runtimeRoot"] == str(tmp_path / "mcp-runtime")
            reviews = await client.call_tool("list_review_items", {})
            assert reviews.is_error is False
            assert reviews.structured_content == {"items": []}
            models = await client.call_tool("list_models", {})
            assert models.is_error is False
            assert models.structured_content is not None
            assert models.structured_content["models"] == []
            library = tmp_path / "empty-library"
            library.mkdir()
            progress_updates: list[tuple[float, float | None, str | None]] = []

            async def record_progress(progress: float, total: float | None, message: str | None) -> None:
                progress_updates.append((progress, total, message))

            scored_library = await client.call_tool(
                "score_library",
                {"path": str(library), "options": {"dryRun": True}},
                progress_callback=record_progress,
            )
            assert scored_library.is_error is False, scored_library.content
            assert scored_library.structured_content is not None
            assert scored_library.structured_content["discoveredWorkCount"] == 1
            assert progress_updates == [(1.0, 1.0, f"failed: {library}/broken")]
            scan = await client.call_tool("scan_feedback", {"path": str(library)})
            assert scan.is_error is False
            assert scan.structured_content["scannedWorkCount"] == 0
            assert scan.structured_content["works"] == []

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
