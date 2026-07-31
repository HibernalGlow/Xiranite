from __future__ import annotations

from dataclasses import dataclass
import re

from .contracts import CmLabel


CM_WORK_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ARCHIVE_EXTENSIONS = (".cbz", ".cb7", ".cbr", ".zip", ".7z", ".rar")

_CANONICAL_SUFFIX = re.compile(
    rf"\s*\[CM(?P<version>\d+)(?P<label>[PN])(?P<score>\d{{4}})-"
    rf"(?P<short_code>[{CM_WORK_CODE_ALPHABET}]{{4,}})\]$"
)
_LEGACY_SUFFIX = re.compile(
    r"\s*\[CM-v(?P<version>\d+)-(?P<label>[PN])-S(?P<score>\d{4})\]$"
)


@dataclass(frozen=True, slots=True)
class CmFilenameTag:
    version: int
    label: CmLabel
    score: int
    short_code: str | None
    legacy: bool = False


def parse_cm_tag(value: str) -> CmFilenameTag | None:
    stem = _archive_stem(_base_name(value))
    match = _CANONICAL_SUFFIX.search(stem)
    legacy = False
    if match is None:
        match = _LEGACY_SUFFIX.search(stem)
        legacy = match is not None
    if match is None:
        return None
    version = int(match.group("version"))
    score = int(match.group("score"))
    if version < 1 or not 0 <= score <= 1000:
        return None
    return CmFilenameTag(
        version=version,
        label=CmLabel(match.group("label")),
        score=score,
        short_code=None if legacy else match.group("short_code"),
        legacy=legacy,
    )


def format_cm_suffix(version: int, label: CmLabel, score: int, short_code: str) -> str:
    if version < 1:
        raise ValueError("bundle version must be positive")
    if not 0 <= score <= 1000:
        raise ValueError("score must be between 0 and 1000")
    if re.fullmatch(rf"[{CM_WORK_CODE_ALPHABET}]{{4,}}", short_code) is None:
        raise ValueError("short code is not canonical Crockford Base32")
    return f"[CM{version}{label.value}{score:04d}-{short_code}]"


def strip_cm_tag(value: str) -> str:
    extension = _archive_extension(value)
    stem = value[: -len(extension)] if extension else value
    clean = _CANONICAL_SUFFIX.sub("", stem)
    clean = _LEGACY_SUFFIX.sub("", clean)
    return f"{clean.rstrip()}{extension}"


def scored_path(value: str, tag: CmFilenameTag) -> str:
    if tag.short_code is None:
        raise ValueError("canonical scored paths require a short code")
    slash = max(value.rfind("/"), value.rfind("\\"))
    parent = value[: slash + 1] if slash >= 0 else ""
    name = value[slash + 1 :]
    clean_name = strip_cm_tag(name)
    extension = _archive_extension(clean_name)
    stem = clean_name[: -len(extension)] if extension else clean_name
    suffix = format_cm_suffix(tag.version, tag.label, tag.score, tag.short_code)
    return f"{parent}{stem} {suffix}{extension}"


def _archive_extension(value: str) -> str:
    lower = value.lower()
    return next((value[-len(extension) :] for extension in ARCHIVE_EXTENSIONS if lower.endswith(extension)), "")


def _archive_stem(value: str) -> str:
    extension = _archive_extension(value)
    return value[: -len(extension)] if extension else value


def _base_name(value: str) -> str:
    slash = max(value.rfind("/"), value.rfind("\\"))
    return value[slash + 1 :]
