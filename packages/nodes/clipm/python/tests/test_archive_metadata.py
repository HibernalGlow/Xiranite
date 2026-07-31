from __future__ import annotations

import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

import pytest

from xiranite_clipm.archive_metadata import (
    ArchiveMetadataError,
    ArchiveMetadataWriter,
    ArchiveTools,
    CM_METADATA_NAME,
    UnsafeArchiveEntryError,
)
from xiranite_clipm.contracts import (
    ArchiveFormat,
    ArchiveSnapshot,
    ClassificationSnapshot,
    CmLabel,
    CmScoreDocument,
    EmbeddingPayload,
    MetadataWriteStatus,
    RankingSnapshot,
    ScoreSnapshot,
    ValueSource,
    WorkIdentity,
)


def document(archive_format: ArchiveFormat) -> CmScoreDocument:
    return CmScoreDocument(
        schema_version=1,
        work=WorkIdentity(
            work_id="018f0000-0000-7000-8000-000000000001",
            record_number=1,
            short_code="4K7Q",
            first_seen_name="original.zip",
            current_base_name="renamed.zip",
            name_revision=0,
        ),
        score=ScoreSnapshot(
            bundle_version=1,
            classification=ClassificationSnapshot(
                predicted=CmLabel.POSITIVE,
                current=CmLabel.POSITIVE,
                source=ValueSource.MODEL,
            ),
            ranking=RankingSnapshot(predicted=873, current=873, source=ValueSource.MODEL),
            probability=0.873,
            scored_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        ),
        embedding=EmbeddingPayload(
            encoder="google/siglip2-base-patch16-224",
            preprocess="white-letterbox-224/four-of-twelve/color-mono-v1",
            dtype="float16",
            shape=[768],
            encoding="base64",
            data=base64.b64encode(bytes(1536)).decode("ascii"),
        ),
        archive=ArchiveSnapshot(format=archive_format, metadata_write_status=MetadataWriteStatus.WRITTEN),
    )


def test_directory_metadata_is_atomic_and_wire_compatible(tmp_path: Path) -> None:
    work = tmp_path / "comic"
    work.mkdir()
    writer = ArchiveMetadataWriter(ArchiveTools(seven_zip=None, rar=None))
    assert writer.write(work, document(ArchiveFormat.DIRECTORY)) is MetadataWriteStatus.WRITTEN
    wire = json.loads((work / CM_METADATA_NAME).read_text(encoding="utf-8"))
    assert wire["work"]["shortCode"] == "4K7Q"
    assert wire["archive"] == {"format": "directory", "metadataWriteStatus": "written"}
    assert not list(work.glob(f".{CM_METADATA_NAME}-*.tmp"))


@pytest.mark.skipif(shutil.which("7z") is None, reason="7-Zip is required for archive transaction validation")
def test_zip_metadata_replaces_case_variant_and_preserves_all_content(tmp_path: Path) -> None:
    archive = tmp_path / "漫画.cbz"
    with zipfile.ZipFile(archive, "w") as target:
        target.writestr("pages/01.jpg", b"first-page")
        target.writestr("pages/02.jpg", b"second-page")
        target.writestr("XIRANITE.CM-SCORE.JSON", b"old")
    before = {
        key: value
        for key, value in _zip_content(archive).items()
        if key.casefold() != CM_METADATA_NAME
    }
    writer = ArchiveMetadataWriter()
    assert writer.write(archive, document(ArchiveFormat.CBZ)) is MetadataWriteStatus.WRITTEN
    after = _zip_content(archive)
    assert {key: value for key, value in after.items() if key.casefold() != CM_METADATA_NAME} == before
    assert list(name for name in after if name.casefold() == CM_METADATA_NAME) == [CM_METADATA_NAME]
    assert json.loads(after[CM_METADATA_NAME])["score"]["ranking"]["current"] == 873
    assert not list(tmp_path.glob(".*.xiranite-*.cbz"))


@pytest.mark.skipif(shutil.which("7z") is None, reason="7-Zip is required for archive transaction validation")
def test_unsafe_archive_entry_leaves_original_untouched(tmp_path: Path) -> None:
    archive = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(archive, "w") as target:
        target.writestr("../outside.jpg", b"unsafe")
    before = hashlib.sha256(archive.read_bytes()).digest()
    with pytest.raises(UnsafeArchiveEntryError):
        ArchiveMetadataWriter().write(archive, document(ArchiveFormat.ZIP))
    assert hashlib.sha256(archive.read_bytes()).digest() == before
    assert not list(tmp_path.glob(".*.xiranite-*.zip"))


@pytest.mark.skipif(shutil.which("7z") is None, reason="7-Zip is required for archive transaction validation")
def test_failed_integrity_check_leaves_original_untouched(tmp_path: Path) -> None:
    class FailingIntegrityWriter(ArchiveMetadataWriter):
        def _test_archive(self, path: Path, archive_format: ArchiveFormat) -> None:
            raise ArchiveMetadataError("simulated integrity failure")

    archive = tmp_path / "failure.zip"
    with zipfile.ZipFile(archive, "w") as target:
        target.writestr("01.jpg", b"original")
    before = hashlib.sha256(archive.read_bytes()).digest()
    with pytest.raises(ArchiveMetadataError, match="simulated integrity failure"):
        FailingIntegrityWriter().write(archive, document(ArchiveFormat.ZIP))
    assert hashlib.sha256(archive.read_bytes()).digest() == before
    assert not list(tmp_path.glob(".*.xiranite-*.zip"))


@pytest.mark.skipif(shutil.which("7z") is None, reason="7-Zip is required for 7Z validation")
def test_7z_metadata_transaction_uses_real_cli(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "01.jpg").write_bytes(b"page")
    archive = tmp_path / "book.cb7"
    _run([shutil.which("7z"), "a", "-y", str(archive), "01.jpg"], cwd=source)
    assert ArchiveMetadataWriter().write(archive, document(ArchiveFormat.CB7)) is MetadataWriteStatus.WRITTEN
    listing = _run([shutil.which("7z"), "l", "-ba", str(archive)]).stdout
    assert CM_METADATA_NAME in listing


@pytest.mark.skipif(shutil.which("7z") is None or shutil.which("rar") is None, reason="7-Zip and RAR are required")
def test_rar_metadata_transaction_uses_official_writer(tmp_path: Path) -> None:
    source = tmp_path / "rar-source"
    source.mkdir()
    (source / "01.jpg").write_bytes(b"page")
    archive = tmp_path / "book.cbr"
    _run([shutil.which("rar"), "a", "-cfg-", "-idq", "-y", "-ep", str(archive), "01.jpg"], cwd=source)
    assert ArchiveMetadataWriter().write(archive, document(ArchiveFormat.CBR)) is MetadataWriteStatus.WRITTEN
    listing = _run([shutil.which("7z"), "l", "-ba", str(archive)]).stdout
    assert CM_METADATA_NAME in listing


def test_rar_without_official_cli_is_reported_as_unsupported(tmp_path: Path) -> None:
    archive = tmp_path / "book.rar"
    archive.write_bytes(b"not opened because writing is unsupported")
    writer = ArchiveMetadataWriter(ArchiveTools(seven_zip="7z", rar=None))
    archive_format, status = writer.capability(archive)
    assert archive_format is ArchiveFormat.RAR
    assert status is MetadataWriteStatus.UNSUPPORTED
    assert writer.write(archive, document(ArchiveFormat.RAR)) is MetadataWriteStatus.UNSUPPORTED


def _zip_content(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as source:
        return {entry.filename: source.read(entry) for entry in source.infolist()}


def _run(command: list[str | None], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [value for value in command if value is not None],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
