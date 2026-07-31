from __future__ import annotations

import pytest

from xiranite_clipm.contracts import CmLabel
from xiranite_clipm.filename import CmFilenameTag, format_cm_suffix, parse_cm_tag, scored_path, strip_cm_tag


def test_parses_canonical_archive_and_directory_suffixes() -> None:
    assert parse_cm_tag("book [CM1P0873-4K7Q].zip") == CmFilenameTag(1, CmLabel.POSITIVE, 873, "4K7Q")
    assert parse_cm_tag("folder [CM12N0042-9X2M]") == CmFilenameTag(12, CmLabel.NEGATIVE, 42, "9X2M")


def test_parses_legacy_suffix_for_migration_only() -> None:
    assert parse_cm_tag("book [CM-v1-P-S0873].cbz") == CmFilenameTag(1, CmLabel.POSITIVE, 873, None, True)


def test_replaces_legacy_or_canonical_suffix_without_restoring_old_title() -> None:
    tag = CmFilenameTag(2, CmLabel.POSITIVE, 999, "4K7Q")
    assert scored_path("D:/books/renamed [CM-v1-N-S0021].cbz", tag) == "D:/books/renamed [CM2P0999-4K7Q].cbz"
    assert scored_path(r"D:\books\new title [CM1N0021-4K7Q].zip", tag) == r"D:\books\new title [CM2P0999-4K7Q].zip"
    assert strip_cm_tag("book [CM1P0873-4K7Q].rar") == "book.rar"


@pytest.mark.parametrize("value", ["[CM0P0873-4K7Q]", "[CM1P1001-4K7Q]", "[CM1P0873-OILU]"])
def test_rejects_invalid_suffixes(value: str) -> None:
    assert parse_cm_tag(value) is None


def test_formats_fixed_width_scores() -> None:
    assert format_cm_suffix(1, CmLabel.NEGATIVE, 7, "9X2M") == "[CM1N0007-9X2M]"
    with pytest.raises(ValueError):
        format_cm_suffix(1, CmLabel.POSITIVE, 1001, "9X2M")
