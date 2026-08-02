from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Sequence
from uuid import uuid4

from .contracts import ArchiveFormat, CmScoreDocument, MetadataWriteStatus


CM_METADATA_NAME = "xiranite.cm-score.json"
MAX_METADATA_BYTES = 16 * 1024 * 1024
_ARCHIVE_FORMATS = {
    ".zip": ArchiveFormat.ZIP,
    ".cbz": ArchiveFormat.CBZ,
    ".7z": ArchiveFormat.SEVEN_ZIP,
    ".cb7": ArchiveFormat.CB7,
    ".rar": ArchiveFormat.RAR,
    ".cbr": ArchiveFormat.CBR,
}
_RAR_FORMATS = {ArchiveFormat.RAR, ArchiveFormat.CBR}
_SEPARATOR = re.compile(r"^-{10,}\s*$", re.MULTILINE)
_DRIVE_PATH = re.compile(r"^[A-Za-z]:")


class ArchiveMetadataError(RuntimeError):
    pass


class ArchiveToolUnavailableError(ArchiveMetadataError):
    pass


class UnsafeArchiveEntryError(ArchiveMetadataError):
    pass


class ArchiveVerificationError(ArchiveMetadataError):
    pass


class InvalidMetadataError(ArchiveMetadataError):
    pass


class MetadataConflictError(ArchiveMetadataError):
    pass


@dataclass(frozen=True, slots=True)
class ArchiveEntry:
    path: str
    size: int
    crc: str | None
    is_directory: bool


@dataclass(frozen=True, slots=True)
class ArchiveTools:
    seven_zip: str | None
    rar: str | None

    @classmethod
    def discover(cls) -> ArchiveTools:
        return cls(seven_zip=shutil.which("7z") or shutil.which("7zz") or shutil.which("7za"), rar=shutil.which("rar"))


class ArchiveMetadataWriter:
    def __init__(self, tools: ArchiveTools | None = None):
        self.tools = tools or ArchiveTools.discover()

    def capability(self, path: Path) -> tuple[ArchiveFormat, MetadataWriteStatus]:
        archive_format = detect_archive_format(path)
        if archive_format in _RAR_FORMATS and self.tools.rar is None:
            return archive_format, MetadataWriteStatus.UNSUPPORTED
        if archive_format is not ArchiveFormat.DIRECTORY and self.tools.seven_zip is None:
            raise ArchiveToolUnavailableError("7-Zip is required for ClipM archive verification.")
        return archive_format, MetadataWriteStatus.WRITTEN

    def write(self, path: Path, document: CmScoreDocument) -> MetadataWriteStatus:
        resolved = path.resolve(strict=True)
        archive_format, status = self.capability(resolved)
        if status is MetadataWriteStatus.UNSUPPORTED:
            return status
        if document.archive.format is not archive_format:
            raise ValueError(
                f"ClipM metadata format {document.archive.format.value} does not match {archive_format.value} input"
            )
        if document.archive.metadata_write_status is not MetadataWriteStatus.WRITTEN:
            raise ValueError("Writable ClipM metadata must record metadataWriteStatus=written")
        payload = _serialize_document(document)
        if archive_format is ArchiveFormat.DIRECTORY:
            _write_directory_metadata(resolved, payload)
        else:
            self._write_archive_metadata(resolved, archive_format, payload)
        return MetadataWriteStatus.WRITTEN

    def read(self, path: Path) -> CmScoreDocument | None:
        resolved = path.resolve(strict=True)
        archive_format = detect_archive_format(resolved)
        if archive_format is ArchiveFormat.DIRECTORY:
            matches = [entry for entry in resolved.iterdir() if entry.is_file() and _is_metadata_entry(entry.name)]
            if not matches:
                return None
            if len(matches) != 1:
                raise MetadataConflictError(f"Directory contains multiple {CM_METADATA_NAME} variants: {resolved}")
            payload = _read_limited_file(matches[0])
        else:
            if self.tools.seven_zip is None:
                raise ArchiveToolUnavailableError("7-Zip is required to read ClipM archive metadata.")
            entries = self._list_entries(resolved)
            _validate_entries(entries)
            matches = [entry for entry in entries if _is_metadata_entry(entry.path)]
            if not matches:
                return None
            if len(matches) != 1:
                raise MetadataConflictError(f"Archive contains multiple root {CM_METADATA_NAME} variants: {resolved}")
            if matches[0].is_directory or matches[0].size > MAX_METADATA_BYTES:
                raise InvalidMetadataError(f"Archive {CM_METADATA_NAME} is not a bounded regular file")
            payload = _run_bytes(
                [
                    self.tools.seven_zip,
                    "x",
                    "-so",
                    "-sccUTF-8",
                    str(resolved),
                    "--",
                    matches[0].path,
                ],
                error_prefix=f"Unable to read {CM_METADATA_NAME} from {resolved}",
            ).stdout
            if len(payload) > MAX_METADATA_BYTES:
                raise InvalidMetadataError(f"Archive {CM_METADATA_NAME} exceeds {MAX_METADATA_BYTES} bytes")
        try:
            return CmScoreDocument.model_validate_json(payload)
        except (UnicodeDecodeError, ValueError) as error:
            raise InvalidMetadataError(f"Invalid {CM_METADATA_NAME} in {resolved}: {error}") from error

    def remove(self, path: Path) -> bool:
        resolved = path.resolve(strict=True)
        archive_format, status = self.capability(resolved)
        if status is MetadataWriteStatus.UNSUPPORTED:
            raise ArchiveToolUnavailableError(
                f"RAR is required to remove {CM_METADATA_NAME} from {resolved}."
            )
        if archive_format is ArchiveFormat.DIRECTORY:
            return _remove_directory_metadata(resolved)
        return self._remove_archive_metadata(resolved, archive_format)

    def list_archive_entries(self, path: Path) -> list[ArchiveEntry]:
        resolved = path.resolve(strict=True)
        if detect_archive_format(resolved) is ArchiveFormat.DIRECTORY:
            raise IsADirectoryError(resolved)
        if self.tools.seven_zip is None:
            raise ArchiveToolUnavailableError("7-Zip is required to inspect ClipM archives.")
        entries = self._list_entries(resolved)
        _validate_entries(entries)
        return entries

    def read_archive_entry(self, path: Path, entry_path: str) -> bytes:
        resolved = path.resolve(strict=True)
        if detect_archive_format(resolved) is ArchiveFormat.DIRECTORY:
            raise IsADirectoryError(resolved)
        if self.tools.seven_zip is None:
            raise ArchiveToolUnavailableError("7-Zip is required to read ClipM archives.")
        normalized = _normalize_entry_path(entry_path)
        return _run_bytes(
            [
                self.tools.seven_zip,
                "x",
                "-so",
                "-sccUTF-8",
                str(resolved),
                "--",
                normalized,
            ],
            error_prefix=f"Unable to read archive entry {normalized!r} from {resolved}",
        ).stdout

    def _write_archive_metadata(self, path: Path, archive_format: ArchiveFormat, payload: bytes) -> None:
        if self.tools.seven_zip is None:
            raise ArchiveToolUnavailableError("7-Zip is required for ClipM archive verification.")
        before = self._list_entries(path)
        _validate_entries(before)
        existing_metadata = sorted({entry.path for entry in before if _is_metadata_entry(entry.path)})
        if len(existing_metadata) == 1:
            current_payload = _run_bytes(
                [
                    self.tools.seven_zip,
                    "x",
                    "-so",
                    "-sccUTF-8",
                    str(path),
                    "--",
                    existing_metadata[0],
                ],
                error_prefix=f"Unable to read {CM_METADATA_NAME} from {path}",
            ).stdout
            if current_payload == payload:
                return
        temporary = _archive_transaction_path(path)
        try:
            shutil.copy2(path, temporary)
            with tempfile.TemporaryDirectory(prefix=".xiranite-cm-metadata-", dir=path.parent) as metadata_root:
                metadata_path = Path(metadata_root) / CM_METADATA_NAME
                _write_file(metadata_path, payload)
                if existing_metadata and existing_metadata != [CM_METADATA_NAME]:
                    self._delete_entries(temporary, archive_format, existing_metadata)
                self._add_metadata(temporary, archive_format, Path(metadata_root))
            after = self._list_entries(temporary)
            _validate_entries(after)
            _verify_preserved(before, after)
            self._test_archive(temporary, archive_format)
            _fsync_file(temporary)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def _remove_archive_metadata(self, path: Path, archive_format: ArchiveFormat) -> bool:
        if self.tools.seven_zip is None:
            raise ArchiveToolUnavailableError("7-Zip is required for ClipM archive verification.")
        before = self._list_entries(path)
        _validate_entries(before)
        existing_metadata = sorted({entry.path for entry in before if _is_metadata_entry(entry.path)})
        if not existing_metadata:
            return False
        temporary = _archive_transaction_path(path)
        try:
            shutil.copy2(path, temporary)
            self._delete_entries(temporary, archive_format, existing_metadata)
            after = self._list_entries(temporary)
            _validate_entries(after)
            _verify_removed(before, after)
            self._test_archive(temporary, archive_format)
            _fsync_file(temporary)
            os.replace(temporary, path)
            return True
        finally:
            temporary.unlink(missing_ok=True)

    def _list_entries(self, path: Path) -> list[ArchiveEntry]:
        assert self.tools.seven_zip is not None
        result = _run(
            [self.tools.seven_zip, "l", "-slt", "-ba", "-sccUTF-8", str(path)],
            error_prefix=f"Unable to inspect archive {path}",
        )
        return parse_7zip_listing(result.stdout)

    def _delete_entries(self, path: Path, archive_format: ArchiveFormat, entries: Sequence[str]) -> None:
        if archive_format in _RAR_FORMATS:
            assert self.tools.rar is not None
            command = [self.tools.rar, "d", "-cfg-", "-idq", "-y", str(path), *entries]
        else:
            assert self.tools.seven_zip is not None
            command = [
                self.tools.seven_zip,
                "d",
                "-y",
                "-bd",
                "-bso0",
                "-bsp0",
                "-sccUTF-8",
                str(path),
                "--",
                *entries,
            ]
        _run(command, error_prefix=f"Unable to remove old {CM_METADATA_NAME} entries")

    def _add_metadata(self, path: Path, archive_format: ArchiveFormat, metadata_root: Path) -> None:
        if archive_format in _RAR_FORMATS:
            assert self.tools.rar is not None
            command = [self.tools.rar, "a", "-cfg-", "-idq", "-y", "-ep", str(path), CM_METADATA_NAME]
        else:
            assert self.tools.seven_zip is not None
            command = [
                self.tools.seven_zip,
                "a",
                "-y",
                "-bd",
                "-bso0",
                "-bsp0",
                "-sccUTF-8",
                str(path),
                "--",
                CM_METADATA_NAME,
            ]
        _run(command, cwd=metadata_root, error_prefix=f"Unable to write {CM_METADATA_NAME}")

    def _test_archive(self, path: Path, archive_format: ArchiveFormat) -> None:
        if archive_format in _RAR_FORMATS:
            assert self.tools.rar is not None
            command = [self.tools.rar, "t", "-cfg-", "-idq", str(path)]
        else:
            assert self.tools.seven_zip is not None
            command = [self.tools.seven_zip, "t", "-bd", "-bso0", "-bsp0", "-sccUTF-8", str(path)]
        _run(command, error_prefix=f"Updated archive failed its integrity test: {path}")


def detect_archive_format(path: Path) -> ArchiveFormat:
    if path.is_dir():
        return ArchiveFormat.DIRECTORY
    archive_format = _ARCHIVE_FORMATS.get(path.suffix.casefold())
    if archive_format is None:
        raise ValueError(f"Unsupported ClipM archive format: {path.suffix or '<none>'}")
    return archive_format


def parse_7zip_listing(output: str) -> list[ArchiveEntry]:
    marker = _SEPARATOR.search(output)
    body = output[marker.end() :] if marker is not None else output
    entries: list[ArchiveEntry] = []
    for block in re.split(r"\r?\n\r?\n", body.strip()):
        fields: dict[str, str] = {}
        for line in block.splitlines():
            if " = " in line:
                key, value = line.split(" = ", 1)
                fields[key] = value
        if "Path" not in fields or "Size" not in fields:
            continue
        try:
            size = int(fields["Size"])
        except ValueError as error:
            raise ArchiveMetadataError(f"7-Zip returned an invalid entry size for {fields['Path']!r}") from error
        entries.append(
            ArchiveEntry(
                path=_normalize_entry_path(fields["Path"]),
                size=size,
                crc=fields.get("CRC") or None,
                is_directory=fields.get("Folder") == "+",
            )
        )
    return entries


def _verify_preserved(before: Sequence[ArchiveEntry], after: Sequence[ArchiveEntry]) -> None:
    before_content = Counter(_entry_signature(entry) for entry in before if not _is_metadata_entry(entry.path))
    after_content = Counter(_entry_signature(entry) for entry in after if not _is_metadata_entry(entry.path))
    if before_content != after_content:
        missing = list((before_content - after_content).elements())
        added = list((after_content - before_content).elements())
        raise ArchiveVerificationError(f"Archive content changed while writing metadata; missing={missing}, added={added}")
    metadata = [entry for entry in after if _is_metadata_entry(entry.path)]
    if len(metadata) != 1 or metadata[0].path != CM_METADATA_NAME:
        raise ArchiveVerificationError(f"Updated archive must contain exactly one root {CM_METADATA_NAME} entry")


def _verify_removed(before: Sequence[ArchiveEntry], after: Sequence[ArchiveEntry]) -> None:
    before_content = Counter(_entry_signature(entry) for entry in before if not _is_metadata_entry(entry.path))
    after_content = Counter(_entry_signature(entry) for entry in after if not _is_metadata_entry(entry.path))
    if before_content != after_content:
        missing = list((before_content - after_content).elements())
        added = list((after_content - before_content).elements())
        raise ArchiveVerificationError(f"Archive content changed while removing metadata; missing={missing}, added={added}")
    if any(_is_metadata_entry(entry.path) for entry in after):
        raise ArchiveVerificationError(f"Updated archive still contains {CM_METADATA_NAME}")


def _validate_entries(entries: Sequence[ArchiveEntry]) -> None:
    for entry in entries:
        _normalize_entry_path(entry.path)


def _entry_signature(entry: ArchiveEntry) -> tuple[str, int, str | None, bool]:
    return entry.path, entry.size, entry.crc, entry.is_directory


def _normalize_entry_path(value: str) -> str:
    normalized = value.replace("\\", "/").rstrip("/")
    if not normalized or normalized.startswith("/") or _DRIVE_PATH.match(normalized):
        raise UnsafeArchiveEntryError(f"Unsafe absolute archive entry: {value!r}")
    parts = normalized.split("/")
    if any(part in {"", ".."} for part in parts):
        raise UnsafeArchiveEntryError(f"Unsafe traversal archive entry: {value!r}")
    canonical = "/".join(part for part in parts if part != ".")
    if not canonical:
        raise UnsafeArchiveEntryError(f"Unsafe empty archive entry: {value!r}")
    return canonical


def _is_metadata_entry(value: str) -> bool:
    return "/" not in value and value.casefold() == CM_METADATA_NAME.casefold()


def _serialize_document(document: CmScoreDocument) -> bytes:
    wire = document.model_dump(mode="json", by_alias=True)
    return (json.dumps(wire, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _archive_transaction_path(path: Path) -> Path:
    return path.with_name(f".xiranite-{uuid4().hex}{path.suffix}")


def _write_directory_metadata(root: Path, payload: bytes) -> None:
    if not root.is_dir():
        raise NotADirectoryError(root)
    destination = root / CM_METADATA_NAME
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{CM_METADATA_NAME}-", suffix=".tmp", dir=root)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _remove_directory_metadata(root: Path) -> bool:
    if not root.is_dir():
        raise NotADirectoryError(root)
    matches = [entry for entry in root.iterdir() if entry.is_file() and _is_metadata_entry(entry.name)]
    if not matches:
        return False
    moved = [
        (source, root / f".{source.name}.xiranite-remove-{uuid4().hex}.tmp", _read_limited_file(source))
        for source in matches
    ]
    try:
        for source, temporary, _ in moved:
            source.rename(temporary)
        for _, temporary, _ in moved:
            temporary.unlink()
        return True
    except Exception as error:
        for source, temporary, payload in reversed(moved):
            try:
                if source.exists():
                    continue
                if temporary.exists():
                    temporary.rename(source)
                else:
                    _write_file(source, payload)
            except Exception as rollback_error:
                error.add_note(f"Unable to restore {source}: {rollback_error}")
        raise


def _write_file(path: Path, payload: bytes) -> None:
    with path.open("wb") as target:
        target.write(payload)
        target.flush()
        os.fsync(target.fileno())


def _read_limited_file(path: Path) -> bytes:
    if path.stat().st_size > MAX_METADATA_BYTES:
        raise InvalidMetadataError(f"{path} exceeds {MAX_METADATA_BYTES} bytes")
    return path.read_bytes()


def _fsync_file(path: Path) -> None:
    with path.open("r+b") as source:
        os.fsync(source.fileno())


def _run(
    command: Sequence[str],
    *,
    cwd: Path | None = None,
    error_prefix: str,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            list(command),
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdin=subprocess.DEVNULL,
        )
    except FileNotFoundError as error:
        raise ArchiveToolUnavailableError(f"{error_prefix}: executable not found") from error
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or "").strip()
        raise ArchiveMetadataError(f"{error_prefix}: {details or f'exit code {error.returncode}'}") from error


def _run_bytes(command: Sequence[str], *, error_prefix: str) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(
            list(command),
            check=True,
            capture_output=True,
            stdin=subprocess.DEVNULL,
        )
    except FileNotFoundError as error:
        raise ArchiveToolUnavailableError(f"{error_prefix}: executable not found") from error
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or b"").decode("utf-8", errors="replace").strip()
        raise ArchiveMetadataError(f"{error_prefix}: {details or f'exit code {error.returncode}'}") from error
