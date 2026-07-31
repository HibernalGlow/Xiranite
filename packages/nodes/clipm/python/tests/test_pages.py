from __future__ import annotations

from pathlib import Path
import zipfile

from PIL import Image

from xiranite_clipm.pages import classify_page, load_sampled_work


def create_pages(root: Path) -> None:
    root.mkdir(parents=True)
    for index in range(12):
        color = (230, 20, 30) if index % 3 == 0 else (80, 80, 80)
        Image.new("RGB", (320, 480), color).save(root / f"{index:02d}.png")


def test_directory_sampling_keeps_color_and_monochrome_pages(tmp_path: Path) -> None:
    pages = tmp_path / "book"
    create_pages(pages)
    sampled = load_sampled_work(pages)
    selected_types = {classify_page(image) for image in sampled.images}
    assert len(sampled.images) == 4
    assert sampled.candidate_page_count == 12
    assert sampled.page_count == 12
    assert selected_types == {"color", "monochrome"}


def test_zip_sampling_uses_the_same_contract(tmp_path: Path) -> None:
    pages = tmp_path / "source"
    create_pages(pages)
    archive = tmp_path / "book.cbz"
    with zipfile.ZipFile(archive, "w") as target:
        for page in pages.iterdir():
            target.write(page, f"chapter/{page.name}")
    sampled = load_sampled_work(archive)
    assert len(sampled.images) == 4
    assert all(name.startswith("chapter/") for name in sampled.source_names)
