from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from xiranite_clipm import directory_scores
from xiranite_clipm.contracts import CmLabel
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.directory_scores import get_directory_scores
from xiranite_clipm.score_repository import persist_scored_work
from xiranite_clipm.scoring import ScoredWork


def test_returns_highest_registered_descendant_for_multiple_directories(tmp_path: Path) -> None:
    database = open_clipm_database(tmp_path / "clipm.sqlite")
    first = tmp_path / "library" / "group" / "first.zip"
    second = tmp_path / "library" / "group" / "nested" / "second.zip"
    outside = tmp_path / "outside" / "third.zip"
    for path in (first, second, outside):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"archive")
    try:
        _persist(database, first, 700)
        _persist(database, second, 900)
        _persist(database, outside, 950)

        result = get_directory_scores(
            database,
            [str(tmp_path / "library"), str(tmp_path / "library" / "group"), str(tmp_path / "empty")],
            active_bundle_version=1,
        )

        assert [entry.work.score if entry.work else None for entry in result.directories] == [900, 900, None]
        assert result.directories[0].work is not None
        assert result.directories[0].work.path == str(second.resolve())
    finally:
        database.close()


def test_batch_reads_works_once_and_visits_each_work_once(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = open_clipm_database(tmp_path / "clipm.sqlite")
    works = [tmp_path / "library" / f"group-{index}" / "work.zip" for index in range(3)]
    for index, path in enumerate(works):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"archive")
        _persist(database, path, 700 + index)

    select_statements: list[str] = []
    database.set_trace_callback(
        lambda statement: select_statements.append(statement)
        if statement.lstrip().upper().startswith("SELECT")
        else None
    )
    visited_paths: list[Path] = []
    original = directory_scores._ancestor_directory_keys

    def tracked_ancestors(path: Path):
        visited_paths.append(path)
        return original(path)

    monkeypatch.setattr(directory_scores, "_ancestor_directory_keys", tracked_ancestors)
    directories = [str(tmp_path / "library" / f"group-{index}") for index in range(500)]
    try:
        result = get_directory_scores(database, directories, active_bundle_version=1)

        assert len(result.directories) == 500
        assert len(select_statements) == 1
        assert len(visited_paths) == len(works)
        assert set(visited_paths) == set(works)
    finally:
        database.set_trace_callback(None)
        database.close()


def _persist(database, path: Path, score: int) -> None:
    persist_scored_work(
        database,
        ScoredWork(
            path=path,
            label=CmLabel.POSITIVE if score >= 500 else CmLabel.NEGATIVE,
            score=score,
            probability=score / 1000,
            bundle_version=1,
            embedding=np.zeros(768, dtype=np.float32),
            sampled_pages=["01.png"],
            candidate_page_count=1,
            page_count=1,
        ),
    )
