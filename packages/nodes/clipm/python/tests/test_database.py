from __future__ import annotations

from pathlib import Path
import sqlite3

import pytest

import xiranite_clipm.database as database_module
from xiranite_clipm.database import open_clipm_database, schema_version
from xiranite_clipm.short_codes import encode_record_number


EXPECTED_TABLES = {
    "auto_training_batch_feedback",
    "auto_training_batches",
    "content_evidence",
    "data_revisions",
    "embeddings",
    "feedback_events",
    "model_bundles",
    "page_embeddings",
    "perceptual_similarity_observations",
    "review_queue",
    "schema_migrations",
    "score_snapshots",
    "training_runs",
    "work_locations",
    "work_names",
    "works",
}


def test_initial_migration_enables_wal_foreign_keys_and_expected_tables(tmp_path: Path) -> None:
    database_path = tmp_path / "data" / "clipm.sqlite"
    connection = open_clipm_database(database_path)
    try:
        tables = {
            row["name"]
            for row in connection.execute("SELECT name FROM sqlite_schema WHERE type = 'table'")
            if not row["name"].startswith("sqlite_")
        }
        assert schema_version(connection) == 6
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert tables == EXPECTED_TABLES
    finally:
        connection.close()

    reopened = open_clipm_database(database_path)
    try:
        assert schema_version(reopened) == 6
        assert reopened.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == 6
    finally:
        reopened.close()


def test_schema_enforces_identity_embedding_and_feedback_invariants(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    try:
        work_id = "018f0000-0000-7000-8000-000000000001"
        connection.execute(
            """INSERT INTO works(
                work_id, short_code, first_seen_name, current_base_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            (work_id, encode_record_number(1), "original.zip", "original.zip", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"),
        )
        connection.execute(
            """INSERT INTO embeddings(
                work_id, encoder, preprocess, dtype, dimension, data, created_at
            ) VALUES (?, ?, ?, 'float16', 768, ?, ?)""",
            (work_id, "google/siglip2-base-patch16-224", "white-letterbox-224/four-of-twelve/color-mono-v1", bytes(1536), "2026-08-01T00:00:00Z"),
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """INSERT INTO page_embeddings(
                    work_id, encoder, preprocess, page_index, source_name,
                    dtype, dimension, data, created_at
                ) VALUES (?, 'encoder', 'preprocess', 0, '01.png', 'float16', 768, ?, ?)""",
                (work_id, bytes(32), "2026-08-01T00:00:00Z"),
            )
        with pytest.raises(sqlite3.IntegrityError, match="baseline_score is required"):
            connection.execute(
                """INSERT INTO score_snapshots(
                    work_id, bundle_version, predicted_label, predicted_score, probability, scored_at
                ) VALUES (?, 1, 'P', 873, 0.873, ?)""",
                (work_id, "2026-08-01T00:00:00Z"),
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """INSERT INTO feedback_events(
                    event_id, work_id, source, occurred_at
                ) VALUES (?, ?, 'gui', ?)""",
                ("018f0000-0000-7000-8000-000000000002", work_id, "2026-08-01T00:00:00Z"),
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """INSERT INTO work_locations(
                    work_id, path, path_key, first_seen_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?)""",
                ("missing", "D:/book.zip", "d:/book.zip", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"),
            )
    finally:
        connection.close()


def test_score_baseline_migration_backfills_v2_snapshots(tmp_path: Path) -> None:
    database_path = tmp_path / "clipm.sqlite"
    migrations_root = Path(database_module.__file__).with_name("migrations")
    raw = sqlite3.connect(database_path, isolation_level=None)
    try:
        raw.executescript((migrations_root / "0001_initial.sql").read_text(encoding="utf-8"))
        raw.executescript((migrations_root / "0002_review_deduplication.sql").read_text(encoding="utf-8"))
        work_id = "018f0000-0000-7000-8000-000000000001"
        raw.execute(
            """INSERT INTO works(
                work_id, short_code, first_seen_name, current_base_name, created_at, updated_at
            ) VALUES (?, ?, 'book.zip', 'book.zip', ?, ?)""",
            (work_id, encode_record_number(1), "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"),
        )
        raw.execute(
            """INSERT INTO score_snapshots(
                work_id, bundle_version, predicted_label, predicted_score, probability, scored_at
            ) VALUES (?, 1, 'P', 910, 0.8, ?)""",
            (work_id, "2026-08-01T00:00:00Z"),
        )
    finally:
        raw.close()

    migrated = open_clipm_database(database_path)
    try:
        row = migrated.execute("SELECT predicted_score, baseline_score FROM score_snapshots").fetchone()
        assert schema_version(migrated) == 6
        assert tuple(row) == (910, 800)
    finally:
        migrated.close()
