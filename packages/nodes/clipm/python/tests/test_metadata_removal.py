from __future__ import annotations

from pathlib import Path
import shutil
import sqlite3

import numpy as np
import pytest

from xiranite_clipm.archive_metadata import ArchiveMetadataWriter, ArchiveTools, CM_METADATA_NAME
from xiranite_clipm.contracts import CmLabel, RemoveWorkMetadataCommand, ScoreOptions
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.metadata_removal import remove_work_metadata
from xiranite_clipm.score_repository import persist_scored_work
from xiranite_clipm.scoring import ScoredWork
from xiranite_clipm.work_workflow import synchronize_work_artifacts


def _tracked_directory(connection, tmp_path: Path) -> tuple[ArchiveMetadataWriter, str, Path]:
    source = tmp_path / "book"
    source.mkdir()
    (source / "01.jpg").write_bytes(b"page")
    persisted = persist_scored_work(
        connection,
        ScoredWork(
            path=source,
            label=CmLabel.POSITIVE,
            score=873,
            probability=0.873,
            bundle_version=1,
            embedding=np.zeros(768, dtype=np.float32),
            sampled_pages=["01.jpg"],
            candidate_page_count=1,
            page_count=1,
        ),
    )
    metadata = ArchiveMetadataWriter(ArchiveTools(seven_zip=None, rar=None))
    synchronized = synchronize_work_artifacts(
        connection,
        metadata,
        str(persisted.work_id),
        source,
        ScoreOptions(),
        active_bundle_version=1,
    )
    return metadata, str(persisted.work_id), Path(synchronized.path)


def test_removes_database_identity_metadata_and_filename_suffix(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        metadata, work_id, scored_path = _tracked_directory(connection, tmp_path)

        result = remove_work_metadata(
            connection,
            metadata,
            RemoveWorkMetadataCommand(path=str(scored_path)),
        )

        assert result.work_id is not None and str(result.work_id) == work_id
        assert result.database_removed is True
        assert result.metadata_removed is True
        assert result.renamed is True
        final_path = Path(result.final_path)
        assert final_path.name == "book"
        assert final_path.is_dir()
        assert not (final_path / CM_METADATA_NAME).exists()
        assert connection.execute("SELECT count(*) FROM works").fetchone()[0] == 0
        assert connection.execute("SELECT reason FROM data_revisions ORDER BY revision DESC").fetchone()[0] == f"work-remove:{work_id}"
    finally:
        connection.close()


def test_database_failure_restores_filename_and_metadata(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        metadata, work_id, scored_path = _tracked_directory(connection, tmp_path)
        connection.execute(
            """CREATE TRIGGER prevent_work_removal BEFORE DELETE ON works
               BEGIN SELECT RAISE(ABORT, 'blocked removal'); END"""
        )

        with pytest.raises(sqlite3.IntegrityError, match="blocked removal"):
            remove_work_metadata(
                connection,
                metadata,
                RemoveWorkMetadataCommand(path=str(scored_path)),
            )

        assert scored_path.is_dir()
        assert metadata.read(scored_path) is not None
        assert connection.execute("SELECT work_id FROM works").fetchone()[0] == work_id
    finally:
        connection.close()


class FailCommitConnection:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    @property
    def in_transaction(self) -> bool:
        return self.connection.in_transaction

    def execute(self, *args, **kwargs):
        return self.connection.execute(*args, **kwargs)

    def commit(self) -> None:
        raise sqlite3.OperationalError("simulated commit failure")

    def rollback(self) -> None:
        self.connection.rollback()


def test_commit_failure_restores_invalid_metadata_bytes(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        metadata, work_id, scored_path = _tracked_directory(connection, tmp_path)
        raw_metadata = b"not valid ClipM JSON\n"
        (scored_path / CM_METADATA_NAME).write_bytes(raw_metadata)

        with pytest.raises(sqlite3.OperationalError, match="simulated commit failure"):
            remove_work_metadata(
                FailCommitConnection(connection),  # type: ignore[arg-type]
                metadata,
                RemoveWorkMetadataCommand(path=str(scored_path)),
            )

        assert scored_path.is_dir()
        assert (scored_path / CM_METADATA_NAME).read_bytes() == raw_metadata
        assert connection.execute("SELECT work_id FROM works").fetchone()[0] == work_id
    finally:
        connection.close()


def test_copy_with_same_short_code_cannot_delete_canonical_work(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        metadata, work_id, scored_path = _tracked_directory(connection, tmp_path)
        copied_path = tmp_path / f"copy {scored_path.name[scored_path.name.index('[CM'):]}"
        shutil.copytree(scored_path, copied_path)

        with pytest.raises(ValueError, match="belongs to a different current path"):
            remove_work_metadata(
                connection,
                metadata,
                RemoveWorkMetadataCommand(path=str(copied_path)),
            )

        assert copied_path.exists()
        assert (copied_path / CM_METADATA_NAME).exists()
        assert connection.execute("SELECT work_id FROM works").fetchone()[0] == work_id
    finally:
        connection.close()
