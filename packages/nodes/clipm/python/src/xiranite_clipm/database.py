from __future__ import annotations

from pathlib import Path
import sqlite3


LATEST_SCHEMA_VERSION = 2
MIGRATIONS = {1: "0001_initial.sql", 2: "0002_review_deduplication.sql"}


def open_clipm_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA foreign_keys = ON")
        journal_mode = connection.execute("PRAGMA journal_mode = WAL").fetchone()[0]
        if str(journal_mode).lower() != "wal":
            raise RuntimeError(f"ClipM database could not enable WAL mode: {journal_mode}")
        apply_migrations(connection)
    except Exception:
        connection.close()
        raise
    return connection


def apply_migrations(connection: sqlite3.Connection) -> None:
    current = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if current > LATEST_SCHEMA_VERSION:
        raise RuntimeError(
            f"ClipM database schema {current} is newer than supported schema {LATEST_SCHEMA_VERSION}"
        )
    migrations_root = Path(__file__).with_name("migrations")
    for version in range(current + 1, LATEST_SCHEMA_VERSION + 1):
        migration_path = migrations_root / MIGRATIONS[version]
        try:
            connection.executescript(migration_path.read_text(encoding="utf-8"))
        except Exception:
            if connection.in_transaction:
                connection.rollback()
            raise


def schema_version(connection: sqlite3.Connection) -> int:
    return int(connection.execute("PRAGMA user_version").fetchone()[0])
