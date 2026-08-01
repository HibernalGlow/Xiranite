from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from xiranite_clipm.archive_metadata import ArchiveMetadataWriter, CM_METADATA_NAME
from xiranite_clipm.contracts import (
    ApplyFeedbackCommand,
    CmLabel,
    FeedbackOrigin,
    ScoreOptions,
    UndoFeedbackCommand,
)
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.feedback_workflow import (
    apply_and_synchronize_feedback,
    scan_filename_feedback,
    undo_and_synchronize_feedback,
)
from xiranite_clipm.filename import CmFilenameTag, scored_path
from xiranite_clipm.score_repository import persist_scored_work
from xiranite_clipm.scoring import ScoredWork
from xiranite_clipm.work_workflow import synchronize_work_artifacts


def seed_work(connection, path: Path, score: int = 873):
    path.mkdir(parents=True)
    return persist_scored_work(
        connection,
        ScoredWork(
            path=path,
            label=CmLabel.POSITIVE,
            score=score,
            probability=score / 1000,
            bundle_version=1,
            embedding=np.zeros(768, dtype=np.float32),
            sampled_pages=["01.png"],
            candidate_page_count=1,
            page_count=1,
        ),
    )


def test_direct_feedback_updates_independent_field_metadata_and_filename(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    metadata = ArchiveMetadataWriter()
    seeded = seed_work(connection, tmp_path / "book")
    try:
        applied = apply_and_synchronize_feedback(
            connection,
            metadata,
            ApplyFeedbackCommand(
                work_id=seeded.work_id,
                classification=CmLabel.NEGATIVE,
                source=FeedbackOrigin.GUI,
            ),
            active_bundle_version=1,
        )
        assert applied.event is not None
        assert applied.event.classification_after is CmLabel.NEGATIVE
        assert applied.event.ranking_after is None
        assert applied.work.label is CmLabel.NEGATIVE
        assert applied.work.score == 873
        assert applied.work.predicted_label is CmLabel.POSITIVE
        assert applied.work.predicted_score == 873
        assert applied.work.classification_corrected is True
        assert applied.work.ranking_corrected is False
        assert applied.work.renamed is True
        assert "CM1N0873" in Path(applied.work.path).name
        document = metadata.read(Path(applied.work.path))
        assert document is not None
        assert document.score.classification.current is CmLabel.NEGATIVE
        assert document.score.ranking.current == 873
        assert len(document.feedback_history) == 1

        noop = apply_and_synchronize_feedback(
            connection,
            metadata,
            ApplyFeedbackCommand(
                work_id=seeded.work_id,
                classification=CmLabel.NEGATIVE,
                source=FeedbackOrigin.NEOVIEW,
            ),
            active_bundle_version=1,
        )
        assert noop.event is None
        assert connection.execute("SELECT count(*) FROM feedback_events").fetchone()[0] == 1
    finally:
        connection.close()


def test_scan_imports_nested_filename_feedback_and_queues_invalid_suffix(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    metadata = ArchiveMetadataWriter()
    library = tmp_path / "library"
    first = seed_work(connection, library / "nested" / "first")
    second = seed_work(connection, library / "second", score=700)
    try:
        first_synced = synchronize_work_artifacts(
            connection,
            metadata,
            str(first.work_id),
            Path(first.path),
            ScoreOptions(),
            active_bundle_version=1,
        )
        second_synced = synchronize_work_artifacts(
            connection,
            metadata,
            str(second.work_id),
            Path(second.path),
            ScoreOptions(),
            active_bundle_version=1,
        )
        first_path = Path(first_synced.path)
        corrected_path = Path(
            scored_path(
                str(first_path),
                CmFilenameTag(1, CmLabel.NEGATIVE, 342, first.short_code),
            )
        )
        first_path.rename(corrected_path)
        (corrected_path / "page [CM1P0001-4K7Q].jpg").write_bytes(b"image")
        invalid = library / "broken [CM1P9999-OILU]"
        invalid.mkdir()

        result = scan_filename_feedback(connection, metadata, library, active_bundle_version=1)
        assert result.scanned_work_count == 3
        assert result.synchronized_work_count == 2
        assert result.imported_feedback_count == 1
        assert len(result.imported_feedback) == 1
        assert result.imported_feedback[0].work.work_id == first.work_id
        assert result.imported_feedback[0].event is not None
        assert result.imported_feedback[0].event.classification_after is CmLabel.NEGATIVE
        assert result.imported_feedback[0].event.ranking_after == 342
        assert len(result.review_items) == 1
        assert {Path(work.path) for work in result.works} == {corrected_path, Path(second_synced.path)}
        assert (corrected_path / CM_METADATA_NAME).is_file()
        document = metadata.read(corrected_path)
        assert document is not None
        assert document.score.classification.current is CmLabel.NEGATIVE
        assert document.score.ranking.current == 342
        assert connection.execute("SELECT count(*) FROM feedback_events").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM review_queue").fetchone()[0] == 1
    finally:
        connection.close()


class FailNextMetadataWrite(ArchiveMetadataWriter):
    def __init__(self) -> None:
        super().__init__()
        self.fail_next_write = False

    def write(self, path, document):
        if self.fail_next_write:
            self.fail_next_write = False
            raise OSError("simulated metadata synchronization failure")
        return super().write(path, document)


def test_failed_feedback_sync_restores_database_and_artifacts(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    metadata = FailNextMetadataWrite()
    seeded = seed_work(connection, tmp_path / "book")
    initial = synchronize_work_artifacts(
        connection,
        metadata,
        str(seeded.work_id),
        Path(seeded.path),
        ScoreOptions(),
        active_bundle_version=1,
    )
    metadata.fail_next_write = True
    try:
        with pytest.raises(OSError, match="simulated metadata synchronization failure"):
            apply_and_synchronize_feedback(
                connection,
                metadata,
                ApplyFeedbackCommand(
                    work_id=seeded.work_id,
                    classification=CmLabel.NEGATIVE,
                    source=FeedbackOrigin.GUI,
                ),
                active_bundle_version=1,
            )

        row = connection.execute("SELECT current_label, current_score FROM works").fetchone()
        assert tuple(row) == ("P", 873)
        assert connection.execute("SELECT count(*) FROM feedback_events").fetchone()[0] == 0
        restored_path = Path(initial.path)
        assert restored_path.exists()
        assert "CM1P0873" in restored_path.name
        document = metadata.read(restored_path)
        assert document is not None and document.score.classification.current is CmLabel.POSITIVE
    finally:
        connection.close()


def test_failed_undo_sync_restores_original_event_and_artifacts(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "runtime" / "data" / "clipm.sqlite")
    metadata = FailNextMetadataWrite()
    seeded = seed_work(connection, tmp_path / "book")
    applied = apply_and_synchronize_feedback(
        connection,
        metadata,
        ApplyFeedbackCommand(
            work_id=seeded.work_id,
            classification=CmLabel.NEGATIVE,
            source=FeedbackOrigin.GUI,
        ),
        active_bundle_version=1,
    )
    assert applied.event is not None
    metadata.fail_next_write = True
    try:
        with pytest.raises(OSError, match="simulated metadata synchronization failure"):
            undo_and_synchronize_feedback(
                connection,
                metadata,
                UndoFeedbackCommand(event_id=applied.event.event_id, source=FeedbackOrigin.GUI),
                active_bundle_version=1,
            )

        row = connection.execute("SELECT current_label, current_score FROM works").fetchone()
        assert tuple(row) == ("N", 873)
        events = connection.execute("SELECT event_id, undone_by FROM feedback_events").fetchall()
        assert [(event["event_id"], event["undone_by"]) for event in events] == [
            (str(applied.event.event_id), None)
        ]
        restored_path = Path(applied.work.path)
        assert restored_path.exists()
        assert "CM1N0873" in restored_path.name
        document = metadata.read(restored_path)
        assert document is not None and document.score.classification.current is CmLabel.NEGATIVE
    finally:
        connection.close()
