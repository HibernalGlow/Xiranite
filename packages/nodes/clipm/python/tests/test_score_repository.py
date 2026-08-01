from __future__ import annotations

from pathlib import Path

import numpy as np

from xiranite_clipm.contracts import CmLabel
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.score_repository import find_work_score_result, load_work_score_result, persist_scored_work
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
        content_digest="ab" * 32,
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
        evidence = connection.execute(
            "SELECT evidence_kind, digest, page_count, sampled_page_count FROM content_evidence"
        ).fetchone()
        assert tuple(evidence) == ("sampled_pixel_sha256", "ab" * 32, 40, 4)
        assert connection.execute("SELECT current_score FROM works").fetchone()[0] == 900
        assert connection.execute(
            "SELECT baseline_score FROM score_snapshots ORDER BY snapshot_id DESC LIMIT 1"
        ).fetchone()[0] == 900
        assert connection.execute("SELECT first_seen_name FROM works").fetchone()[0] == "book.zip"
        loaded = load_work_score_result(connection, str(first.work_id), path, active_bundle_version=1)
        assert loaded.predicted_label is CmLabel.POSITIVE
        assert loaded.predicted_score == 900
        assert loaded.classification_corrected is False
        assert loaded.ranking_corrected is False
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


def test_finds_cached_score_by_current_path_or_canonical_short_code(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    original = tmp_path / "book.zip"
    original.write_bytes(b"archive")
    try:
        persisted = persist_scored_work(connection, scored(original))
        exact = find_work_score_result(connection, original, active_bundle_version=1)
        assert exact is not None and exact.work_id == persisted.work_id

        portable = tmp_path / f"moved [CM1P0800-{persisted.short_code}].zip"
        original.rename(portable)
        relocated = find_work_score_result(connection, portable, active_bundle_version=1)
        assert relocated is not None and relocated.work_id == persisted.work_id
        assert relocated.path == str(portable.resolve())

        unknown = tmp_path / "unknown.zip"
        unknown.write_bytes(b"archive")
        assert find_work_score_result(connection, unknown, active_bundle_version=1) is None
    finally:
        connection.close()
