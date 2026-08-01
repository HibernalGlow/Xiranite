from __future__ import annotations

from dataclasses import dataclass
import hashlib
import io
import itertools
from pathlib import Path
import re
from typing import Callable
import zipfile

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .archive_metadata import ArchiveMetadataWriter


IMAGE_EXTENSIONS = {".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".jxl", ".png", ".webp"}
EXTERNAL_ARCHIVE_EXTENSIONS = {".7z", ".cb7", ".rar", ".cbr"}
TARGET_POSITIONS = (0.0625, 0.3125, 0.6875, 0.9375)


@dataclass(slots=True)
class SampledWork:
    images: list[Image.Image]
    source_names: list[str]
    candidate_page_count: int
    page_count: int


def sampled_pixel_digest(sampled: SampledWork) -> str:
    digest = hashlib.sha256()
    digest.update(b"clipm-sampled-pixel-sha256-v1\0")
    digest.update(sampled.page_count.to_bytes(8, byteorder="big", signed=False))
    digest.update(len(sampled.images).to_bytes(4, byteorder="big", signed=False))
    for image in sampled.images:
        pixels = image.convert("RGB")
        digest.update(pixels.width.to_bytes(4, byteorder="big", signed=False))
        digest.update(pixels.height.to_bytes(4, byteorder="big", signed=False))
        digest.update(pixels.tobytes())
    return digest.hexdigest()


def load_sampled_work(
    path: Path,
    candidate_count: int = 12,
    selected_count: int = 4,
    archive_reader: ArchiveMetadataWriter | None = None,
) -> SampledWork:
    resolved = path.resolve()
    if resolved.is_dir():
        entries = sorted(
            (entry for entry in resolved.rglob("*") if entry.is_file() and _is_image(entry.name)),
            key=lambda entry: _natural_key(str(entry.relative_to(resolved))),
        )
        return _sample_entries(
            [str(entry.relative_to(resolved)).replace("\\", "/") for entry in entries],
            lambda index: _decode_image(entries[index].read_bytes()),
            candidate_count,
            selected_count,
        )
    if resolved.suffix.casefold() in EXTERNAL_ARCHIVE_EXTENSIONS:
        reader = archive_reader or ArchiveMetadataWriter()
        entries = sorted(
            (
                entry
                for entry in reader.list_archive_entries(resolved)
                if not entry.is_directory and _is_image(entry.path)
            ),
            key=lambda entry: _natural_key(entry.path),
        )
        return _sample_entries(
            [entry.path for entry in entries],
            lambda index: _decode_image(reader.read_archive_entry(resolved, entries[index].path)),
            candidate_count,
            selected_count,
        )
    if resolved.suffix.casefold() not in {".zip", ".cbz"}:
        raise ValueError(f"Unsupported ClipM archive format: {resolved.suffix or '<none>'}")
    with zipfile.ZipFile(resolved) as archive:
        entries = sorted(
            (entry for entry in archive.infolist() if not entry.is_dir() and _is_image(entry.filename)),
            key=lambda entry: _natural_key(entry.filename),
        )
        return _sample_entries(
            [entry.filename.replace("\\", "/") for entry in entries],
            lambda index: _decode_image(archive.read(entries[index])),
            candidate_count,
            selected_count,
        )


def choose_page_indices(page_types: list[str], count: int = 4) -> list[int]:
    readable = [index for index, page_type in enumerate(page_types) if page_type != "unreadable"]
    if len(readable) <= count:
        return readable
    readable_types = [page_types[index] for index in readable]
    color_count = readable_types.count("color")
    monochrome_count = len(readable_types) - color_count
    if color_count == 0:
        desired_color = 0
    elif monochrome_count == 0:
        desired_color = count
    else:
        desired_color = min(count - 1, max(1, round(count * color_count / len(readable_types))))
    denominator = max(1, len(page_types) - 1)
    return list(
        min(
            itertools.combinations(readable, count),
            key=lambda indices: (
                abs(sum(page_types[index] == "color" for index in indices) - desired_color),
                sum(abs(index / denominator - target) for index, target in zip(indices, TARGET_POSITIONS, strict=True)),
                indices,
            ),
        )
    )


def classify_page(image: Image.Image) -> str:
    preview = image.copy()
    preview.thumbnail((256, 256), Image.Resampling.BILINEAR)
    pixels = np.asarray(preview.convert("RGB"), dtype=np.float32)
    maximum = pixels.max(axis=2)
    minimum = pixels.min(axis=2)
    chroma = maximum - minimum
    saturation = chroma / np.maximum(maximum, 1.0)
    visible = maximum < 250
    if np.count_nonzero(visible) < max(32, visible.size // 100):
        visible = np.ones_like(visible, dtype=np.bool_)
    visible_chroma = chroma[visible]
    colorful_ratio = float(np.mean((visible_chroma >= 18.0) & (saturation[visible] >= 0.12)))
    chroma_p90 = float(np.percentile(visible_chroma, 90))
    return "color" if colorful_ratio >= 0.08 and chroma_p90 >= 20.0 else "monochrome"


def white_letterbox(image: Image.Image, size: int = 224) -> Image.Image:
    contained = ImageOps.contain(image.convert("RGB"), (size, size), Image.Resampling.BICUBIC)
    canvas = Image.new("RGB", (size, size), "white")
    canvas.paste(contained, ((size - contained.width) // 2, (size - contained.height) // 2))
    return canvas


def _sample_entries(
    names: list[str],
    read: Callable[[int], Image.Image],
    candidate_count: int,
    selected_count: int,
) -> SampledWork:
    if not names:
        raise ValueError("Comic work contains no supported image pages.")
    candidate_indices = _uniform_indices(len(names), candidate_count)
    candidates: list[Image.Image | None] = []
    page_types: list[str] = []
    for index in candidate_indices:
        try:
            image = read(index)
            candidates.append(image)
            page_types.append(classify_page(image))
        except (OSError, RuntimeError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
            candidates.append(None)
            page_types.append("unreadable")
    selected_indices = choose_page_indices(page_types, selected_count)
    if not selected_indices:
        raise ValueError("Comic work has no readable candidate pages.")
    images = [white_letterbox(candidates[index]) for index in selected_indices if candidates[index] is not None]
    source_names = [names[candidate_indices[index]] for index in selected_indices]
    return SampledWork(
        images=images,
        source_names=source_names,
        candidate_page_count=len(candidate_indices),
        page_count=len(names),
    )


def _uniform_indices(length: int, count: int) -> list[int]:
    if length <= count:
        return list(range(length))
    start = 0.1 * (length - 1)
    end = 0.9 * (length - 1)
    return list(dict.fromkeys(round(start + (end - start) * index / (count - 1)) for index in range(count)))


def _decode_image(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as source:
        source.seek(0)
        return source.convert("RGB")


def _is_image(value: str) -> bool:
    return Path(value).suffix.casefold() in IMAGE_EXTENSIONS


def _natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]
