from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from xiranite_clipm.contracts import (
    ApplyFeedbackCommand,
    ArchiveFormat,
    ArchiveSnapshot,
    CmLabel,
    FeedbackOrigin,
    MetadataWriteStatus,
)
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.feedback_repository import apply_feedback
from xiranite_clipm.metadata_repository import build_score_document
from xiranite_clipm.score_repository import persist_scored_work
from xiranite_clipm.scoring import ScoredWork
from xiranite_clipm.work_merge import merge_work_into_existing


def _persist(connection, path: Path, score: int, fill: float, digest: str):
    path.mkdir()
    return persist_scored_work(
        connection,
        ScoredWork(
            path=path,
            label=CmLabel.POSITIVE,
            score=score,
            probability=score / 1000,
            bundle_version=1,
            embedding=np.full(768, fill, dtype=np.float32),
            sampled_pages=["01.png", "02.png", "03.png", "04.png"],
            candidate_page_count=4,
            page_count=10,
            baseline_score=score,
            content_digest=digest,
            page_embeddings=np.full((4, 768), fill, dtype=np.float32),
        ),
    )


def test_merge_preserves_histories_and_latest_independent_feedback(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    target_path = tmp_path / "target"
    source_path = tmp_path / "source"
    try:
        target = _persist(connection, target_path, 800, 0.1, "aa" * 32)
        source = _persist(connection, source_path, 300, 0.2, "bb" * 32)
        apply_feedback(
            connection,
            ApplyFeedbackCommand(
                work_id=target.work_id,
                classification=CmLabel.NEGATIVE,
                source=FeedbackOrigin.GUI,
            ),
        )
        apply_feedback(
            connection,
            ApplyFeedbackCommand(
                work_id=source.work_id,
                ranking=950,
                source=FeedbackOrigin.NEOVIEW,
            ),
        )

        merge_work_into_existing(
            connection,
            str(source.work_id),
            str(target.work_id),
            source_path,
        )

        work = connection.execute(
            "SELECT first_seen_name, current_base_name, current_label, current_score FROM works"
        ).fetchone()
        assert tuple(work) == ("target", "source", "N", 950)
        assert connection.execute("SELECT count(*) FROM works").fetchone()[0] == 1
        assert connection.execute(
            "SELECT count(*) FROM feedback_events WHERE work_id = ?",
            (str(target.work_id),),
        ).fetchone()[0] == 2
        assert connection.execute(
            "SELECT count(*) FROM score_snapshots WHERE work_id = ?",
            (str(target.work_id),),
        ).fetchone()[0] == 2
        assert connection.execute(
            "SELECT digest FROM content_evidence WHERE work_id = ?",
            (str(target.work_id),),
        ).fetchone()[0] == "bb" * 32
        page_embedding = connection.execute(
            """SELECT data FROM page_embeddings
               WHERE work_id = ? ORDER BY page_index LIMIT 1""",
            (str(target.work_id),),
        ).fetchone()[0]
        assert np.frombuffer(page_embedding, dtype="<f2")[0] == np.float16(0.2)
        assert connection.execute(
            "SELECT count(*) FROM perceptual_similarity_observations"
        ).fetchone()[0] == 0
        locations = connection.execute(
            "SELECT path, is_current FROM work_locations WHERE work_id = ? ORDER BY is_current DESC, path",
            (str(target.work_id),),
        ).fetchall()
        assert [(Path(row["path"]).name, row["is_current"]) for row in locations] == [
            ("source", 1),
            ("target", 0),
        ]
        names = connection.execute(
            "SELECT revision, name FROM work_names WHERE work_id = ? ORDER BY revision",
            (str(target.work_id),),
        ).fetchall()
        assert [(row["revision"], row["name"]) for row in names] == [(0, "target"), (1, "source")]
        document = build_score_document(
            connection,
            str(target.work_id),
            ArchiveSnapshot(
                format=ArchiveFormat.DIRECTORY,
                metadata_write_status=MetadataWriteStatus.WRITTEN,
            ),
        )
        assert document.work.first_seen_name == "target"
        assert document.score.classification.current is CmLabel.NEGATIVE
        assert document.score.ranking.current == 950
        assert len(document.feedback_history) == 2
    finally:
        connection.close()


def test_merge_rolls_back_all_rows_when_source_delete_fails(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        target = _persist(connection, tmp_path / "target", 800, 0.1, "aa" * 32)
        source = _persist(connection, tmp_path / "source", 300, 0.2, "bb" * 32)
        connection.execute(
            f"""CREATE TRIGGER prevent_merge BEFORE DELETE ON works
                WHEN OLD.work_id = '{source.work_id}'
                BEGIN SELECT RAISE(ABORT, 'blocked merge'); END"""
        )
        with pytest.raises(Exception, match="blocked merge"):
            merge_work_into_existing(
                connection,
                str(source.work_id),
                str(target.work_id),
                tmp_path / "source",
            )
        assert connection.execute("SELECT count(*) FROM works").fetchone()[0] == 2
        evidence_work_ids = [
            row["work_id"]
            for row in connection.execute("SELECT work_id FROM content_evidence ORDER BY work_id")
        ]
        work_ids = [row["work_id"] for row in connection.execute("SELECT work_id FROM works ORDER BY work_id")]
        assert evidence_work_ids == work_ids
    finally:
        connection.close()
