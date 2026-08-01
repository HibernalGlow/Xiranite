from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

from .archive_metadata import ArchiveMetadataWriter, CM_METADATA_NAME
from .contracts import RemoveWorkMetadataCommand, RemoveWorkMetadataResult
from .filename import parse_cm_tag, strip_cm_tag
from .locks import ClipmOperationLocks
from .metadata_repository import normalized_path_key


def remove_work_metadata(
    connection: sqlite3.Connection,
    metadata: ArchiveMetadataWriter,
    command: RemoveWorkMetadataCommand,
    locks: ClipmOperationLocks | None = None,
) -> RemoveWorkMetadataResult:
    original = Path(command.path).resolve(strict=True)
    work_id = _find_work_id(connection, original)
    if locks is None:
        return _remove_work_metadata_locked(connection, metadata, original, work_id)
    scope = locks.work(work_id) if work_id is not None else locks.identity(original)
    with scope:
        if work_id is not None:
            row = connection.execute(
                "SELECT path FROM work_locations WHERE work_id = ? AND is_current = 1",
                (work_id,),
            ).fetchone()
            if row is not None:
                original = Path(str(row["path"])).resolve(strict=True)
        else:
            original = original.resolve(strict=True)
        return _remove_work_metadata_locked(connection, metadata, original, work_id)


def _remove_work_metadata_locked(
    connection: sqlite3.Connection,
    metadata: ArchiveMetadataWriter,
    original: Path,
    work_id: str | None,
) -> RemoveWorkMetadataResult:
    final_path = original.with_name(strip_cm_tag(original.name))
    if final_path != original and final_path.exists():
        raise FileExistsError(f"ClipM metadata-free target already exists: {final_path}")

    metadata_removed = False
    renamed = False
    database_removed = False
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute(
            "DELETE FROM review_queue WHERE path IN (?, ?)",
            (str(original), str(final_path)),
        )
        if work_id is not None:
            connection.execute("DELETE FROM review_queue WHERE work_id = ?", (work_id,))
            database_removed = connection.execute(
                "DELETE FROM works WHERE work_id = ?",
                (work_id,),
            ).rowcount == 1
            if database_removed:
                connection.execute(
                    "INSERT INTO data_revisions(reason, created_at) VALUES (?, ?)",
                    (f"work-remove:{work_id}", datetime.now(timezone.utc).isoformat()),
                )
        with tempfile.TemporaryDirectory(
            prefix=".xiranite-cm-remove-backup-",
            dir=original.parent,
            ignore_cleanup_errors=True,
        ) as backup_root:
            backup = _backup_work_metadata(original, Path(backup_root))
            try:
                metadata_removed = metadata.remove(original)
                if final_path != original:
                    original.rename(final_path)
                    final_path = final_path.resolve(strict=True)
                    renamed = True
                connection.commit()
            except Exception as error:
                connection.rollback()
                if renamed and final_path.exists() and not original.exists():
                    try:
                        final_path.rename(original)
                    except Exception as rollback_error:
                        error.add_note(f"Unable to restore original work path {original}: {rollback_error}")
                restore_path = original if original.exists() else final_path
                if restore_path.exists():
                    try:
                        _restore_work_metadata(restore_path, backup)
                    except Exception as rollback_error:
                        error.add_note(f"Unable to restore removed ClipM metadata: {rollback_error}")
                raise
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise

    return RemoveWorkMetadataResult(
        original_path=str(original),
        final_path=str(final_path),
        work_id=work_id,
        database_removed=database_removed,
        metadata_removed=metadata_removed,
        renamed=renamed,
    )


def _find_work_id(connection: sqlite3.Connection, path: Path) -> str | None:
    row = connection.execute(
        """SELECT work_id FROM work_locations
           WHERE path_key = ? AND is_current = 1""",
        (normalized_path_key(path),),
    ).fetchone()
    if row is not None:
        return str(row["work_id"])
    tag = parse_cm_tag(path.name)
    if tag is None or tag.short_code is None:
        return None
    row = connection.execute(
        """SELECT works.work_id, work_locations.path
           FROM works
           LEFT JOIN work_locations
             ON work_locations.work_id = works.work_id
            AND work_locations.is_current = 1
           WHERE works.short_code = ?""",
        (tag.short_code,),
    ).fetchone()
    if row is None:
        return None
    current_path = Path(str(row["path"])) if row["path"] is not None else None
    if current_path is not None:
        raise ValueError(
            f"ClipM short code {tag.short_code} belongs to a different current path: {current_path}"
        )
    return str(row["work_id"])


def _backup_work_metadata(path: Path, backup_root: Path) -> Path:
    backup = backup_root / "metadata"
    if path.is_file():
        shutil.copy2(path, backup)
        return backup
    backup.mkdir()
    for entry in path.iterdir():
        if entry.is_file() and entry.name.casefold() == CM_METADATA_NAME.casefold():
            shutil.copy2(entry, backup / entry.name)
    return backup


def _restore_work_metadata(path: Path, backup: Path) -> None:
    if path.is_file():
        _replace_from_backup(backup, path)
        return
    if not path.is_dir():
        raise FileNotFoundError(path)
    for entry in backup.iterdir():
        _replace_from_backup(entry, path / entry.name)


def _replace_from_backup(backup: Path, destination: Path) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.xiranite-restore-",
        suffix=".tmp",
        dir=destination.parent,
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        shutil.copy2(backup, temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
