from __future__ import annotations

from pathlib import Path

import numpy as np

from xiranite_clipm.contracts import CmLabel
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.score_repository import load_work_score_result, persist_scored_work
from xiranite_clipm.scoring import ScoredWork
from xiranite_clipm.short_codes import decode_canonical_short_code


def scored(path: Path, probability: float = 0.8) -> ScoredWork:
    return ScoredWork(
        path=path,
        label=CmLabel.POSITIVE,
        score=round(probability * 1000),
        probability=probability,
        bundle_version=1,
        embedding=np.full(768, 1 / np.sqrt(768), dtype=np.float32),
        sampled_pages=["01.png", "04.png", "07.png", "10.png"],
        candidate_page_count=12,
        page_count=40,
    )


def test_persists_stable_identity_embedding_and_score_snapshots(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    try:
        path = tmp_path / "book [CM1P0800-4K7Q].zip"
        first = persist_scored_work(connection, scored(path))
        second = persist_scored_work(connection, scored(path, 0.9))
        assert second.work_id == first.work_id
        assert second.short_code == first.short_code
        assert decode_canonical_short_code(first.short_code) == 1
        assert connection.execute("SELECT count(*) FROM works").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM score_snapshots").fetchone()[0] == 2
        assert connection.execute("SELECT length(data) FROM embeddings").fetchone()[0] == 1536
        assert connection.execute("SELECT current_score FROM works").fetchone()[0] == 900
        assert connection.execute(
            "SELECT baseline_score FROM score_snapshots ORDER BY snapshot_id DESC LIMIT 1"
        ).fetchone()[0] == 900
        assert connection.execute("SELECT first_seen_name FROM works").fetchone()[0] == "book.zip"
    finally:
        connection.close()


def test_persists_ranking_score_separately_from_classification_baseline(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        value = scored(tmp_path / "ranked", probability=0.8)
        value.score = 910
        value.baseline_score = 800
        persist_scored_work(connection, value)
        row = connection.execute(
            "SELECT predicted_score, baseline_score FROM score_snapshots"
        ).fetchone()
        assert tuple(row) == (910, 800)
    finally:
        connection.close()


def test_cached_result_preserves_missing_historical_probability(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    path = tmp_path / "portable-book"
    try:
        persisted = persist_scored_work(connection, scored(path))
        connection.execute("UPDATE score_snapshots SET probability = NULL")
        cached = load_work_score_result(connection, str(persisted.work_id), path, active_bundle_version=1)
        assert cached.probability is None
    finally:
        connection.close()
