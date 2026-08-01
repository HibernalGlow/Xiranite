from __future__ import annotations

from pathlib import Path

import numpy as np

from xiranite_clipm.archive_metadata import ArchiveMetadataWriter
from xiranite_clipm.contracts import CmLabel, ScoreOptions
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.library_workflow import (
    consume_library_steps,
    discover_library_works,
    score_library_steps,
)
from xiranite_clipm.scoring import ScoredWork


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


def _image(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"test image placeholder")


def test_discovers_immediate_archives_and_unpacked_works_without_symlinks(tmp_path: Path) -> None:
    library = tmp_path / "library"
    _image(library / "book" / "chapter" / "01.png")
    (library / "archive.cbz").write_bytes(b"archive")
    (library / "notes.txt").write_text("ignored", encoding="utf-8")

    assert [path.name for path in discover_library_works(library)] == ["archive.cbz", "book"]


def test_root_with_direct_images_is_treated_as_one_work(tmp_path: Path) -> None:
    _image(tmp_path / "01.jpg")
    _image(tmp_path / "chapter" / "02.jpg")
    assert discover_library_works(tmp_path) == [tmp_path.resolve()]


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
