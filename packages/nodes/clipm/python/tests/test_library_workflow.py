from __future__ import annotations

from pathlib import Path

import numpy as np

from xiranite_clipm.archive_metadata import ArchiveMetadataWriter
from xiranite_clipm.contracts import CmLabel, ScoreOptions
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.library_workflow import (
    _batch_library_progress,
    consume_library_steps,
    discover_library_works,
    score_library_steps,
)
from xiranite_clipm.scoring import BatchScoringProgress, ScoredWork


class FakeScoring:
    def score_work(self, path: Path) -> ScoredWork:
        if path.name == "broken-book":
            raise RuntimeError("synthetic scoring failure")
        return ScoredWork(
            path=path,
            label=CmLabel.POSITIVE,
            score=800,
            probability=0.8,
            bundle_version=1,
            embedding=np.zeros(768, dtype=np.float32),
            sampled_pages=["01.png"],
            candidate_page_count=1,
            page_count=1,
            baseline_score=800,
        )


class RankedFakeScoring:
    def score_work(self, path: Path) -> ScoredWork:
        label, score = {
            "a-low-positive": (CmLabel.POSITIVE, 500),
            "b-high-negative": (CmLabel.NEGATIVE, 800),
            "c-high-positive": (CmLabel.POSITIVE, 900),
            "d-low-negative": (CmLabel.NEGATIVE, 200),
        }[path.name]
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
            baseline_score=score,
        )


class BatchFakeScoring(FakeScoring):
    def __init__(self):
        self.batch_paths: list[Path] = []

    def score_works(self, paths: list[Path]) -> dict[Path, ScoredWork | Exception]:
        self.batch_paths = paths
        return {path.resolve(): self.score_work(path) for path in paths}


def _image(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"test image placeholder")


def test_discovers_nested_archives_and_smallest_unpacked_works_with_one_walk(
    tmp_path: Path,
    monkeypatch,
) -> None:
    library = tmp_path / "library"
    _image(library / "author" / "book" / "01.png")
    (library / "archive.cbz").write_bytes(b"archive")
    (library / "category" / "nested").mkdir(parents=True)
    (library / "category" / "nested" / "inside.zip").write_bytes(b"archive")
    (library / "notes.txt").write_text("ignored", encoding="utf-8")

    walks: list[Path] = []
    original_rglob = Path.rglob

    def tracked_rglob(path: Path, pattern: str):
        walks.append(path)
        return original_rglob(path, pattern)

    monkeypatch.setattr(Path, "rglob", tracked_rglob)
    assert [path.name for path in discover_library_works(library)] == ["archive.cbz", "book", "inside.zip"]
    assert walks == [library.resolve()]


def test_discovers_each_directory_that_directly_contains_images(tmp_path: Path) -> None:
    library = tmp_path / "library"
    _image(library / "author" / "first-book" / "chapter-1" / "01.png")
    _image(library / "author" / "first-book" / "chapter-2" / "01.png")
    _image(library / "author" / "second-book" / "01.png")

    assert discover_library_works(library) == [
        (library / "author" / "first-book" / "chapter-1").resolve(),
        (library / "author" / "first-book" / "chapter-2").resolve(),
        (library / "author" / "second-book").resolve(),
    ]


def test_root_with_direct_images_is_treated_as_one_work(tmp_path: Path) -> None:
    _image(tmp_path / "01.jpg")
    _image(tmp_path / "chapter" / "02.jpg")
    assert discover_library_works(tmp_path) == [tmp_path.resolve()]


def test_batch_progress_identifies_current_work_and_bounded_gpu_batch() -> None:
    preparing = _batch_library_progress(
        BatchScoringProgress("preparing", 8, 20, "D:/library/current.cbz", 2, 3)
    )
    inference = _batch_library_progress(
        BatchScoringProgress("inference", 16, 20, "", 2, 3, 32)
    )

    assert preparing.message == "preparing pages 9/20: D:/library/current.cbz"
    assert inference.message == "running GPU batch 2/3 over 32 sampled page(s)"
    assert preparing.progress < inference.progress


def test_scores_library_with_per_work_failure_isolation(tmp_path: Path) -> None:
    library = tmp_path / "library"
    _image(library / "good-book" / "01.jpg")
    _image(library / "broken-book" / "01.jpg")
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        steps = score_library_steps(
            connection,
            FakeScoring(),  # type: ignore[arg-type]
            ArchiveMetadataWriter(),
            library,
            ScoreOptions(rename=False, write_metadata=False),
            active_bundle_version=1,
        )
        result = consume_library_steps(steps)
        assert result.discovered_work_count == 2
        assert result.succeeded_work_count == 1
        assert result.failed_work_count == 1
        assert result.works[0].path == str((library / "good-book").resolve())
        assert result.failures[0].path == str((library / "broken-book").resolve())
        assert result.failures[0].error_type == "RuntimeError"
        assert connection.execute("SELECT count(*) FROM works").fetchone()[0] == 1
    finally:
        connection.close()


def test_batch_scoring_filters_out_works_already_registered_in_sqlite(tmp_path: Path) -> None:
    library = tmp_path / "library"
    _image(library / "existing" / "01.jpg")
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    metadata = ArchiveMetadataWriter()
    try:
        consume_library_steps(
            score_library_steps(
                connection,
                FakeScoring(),  # type: ignore[arg-type]
                metadata,
                library,
                ScoreOptions(rename=False, write_metadata=False),
                active_bundle_version=1,
            )
        )
        _image(library / "new" / "01.jpg")
        scoring = BatchFakeScoring()

        result = consume_library_steps(
            score_library_steps(
                connection,
                scoring,  # type: ignore[arg-type]
                metadata,
                library,
                ScoreOptions(rename=False, write_metadata=False),
                active_bundle_version=1,
            )
        )

        assert [path.name for path in scoring.batch_paths] == ["new"]
        assert result.succeeded_work_count == 2
    finally:
        connection.close()


def test_library_result_groups_preference_and_sorts_each_group_by_score(tmp_path: Path) -> None:
    library = tmp_path / "library"
    for name in ("a-low-positive", "b-high-negative", "c-high-positive", "d-low-negative"):
        _image(library / name / "01.jpg")
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        result = consume_library_steps(
            score_library_steps(
                connection,
                RankedFakeScoring(),  # type: ignore[arg-type]
                ArchiveMetadataWriter(),
                library,
                ScoreOptions(rename=False, write_metadata=False),
                active_bundle_version=1,
            )
        )
        assert [(work.label, work.score) for work in result.works] == [
            (CmLabel.POSITIVE, 900),
            (CmLabel.POSITIVE, 500),
            (CmLabel.NEGATIVE, 800),
            (CmLabel.NEGATIVE, 200),
        ]
    finally:
        connection.close()


def test_library_dry_run_uses_simulated_scores_without_gpu_or_writes(tmp_path: Path) -> None:
    library = tmp_path / "library"
    _image(library / "author" / "book" / "01.jpg")
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    scoring = BatchFakeScoring()
    try:
        result = consume_library_steps(
            score_library_steps(
                connection,
                scoring,  # type: ignore[arg-type]
                ArchiveMetadataWriter(),
                library,
                ScoreOptions(dry_run=True),
                active_bundle_version=3,
            )
        )

        assert scoring.batch_paths == []
        assert result.succeeded_work_count == 1
        preview = result.works[0]
        source = (library / "author" / "book").resolve()
        assert preview.simulated is True
        assert preview.source_path == str(source)
        assert preview.path != str(source)
        assert preview.short_code == "PREV"
        assert preview.bundle_version == 3
        assert preview.planned_rename is True
        assert preview.planned_metadata_write is True
        assert source.is_dir()
        assert not Path(preview.path).exists()
        for table in (
            "works",
            "work_locations",
            "score_snapshots",
            "embeddings",
            "feedback_events",
            "review_queue",
        ):
            assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    finally:
        connection.close()
