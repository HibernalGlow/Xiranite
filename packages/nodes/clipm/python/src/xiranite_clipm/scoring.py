from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Protocol

import numpy as np
from PIL import Image

from .contracts import CmLabel
from .encoder import Siglip2Encoder
from .locks import ClipmOperationLocks
from .model_bundle import ModelBundleStore
from .pages import SampledWork, load_sampled_work, sampled_pixel_digest


DIRECTORY_PAGE_BATCH_SIZE = 32
DIRECTORY_WORK_BATCH_SIZE = 8


@dataclass(slots=True)
class ScoredWork:
    path: Path
    label: CmLabel
    score: int
    probability: float
    bundle_version: int
    embedding: np.ndarray
    sampled_pages: list[str]
    candidate_page_count: int
    page_count: int
    baseline_score: int | None = None
    content_digest: str | None = None
    page_embeddings: np.ndarray | None = None


@dataclass(frozen=True, slots=True)
class BatchScoringProgress:
    stage: str
    completed: int
    total: int
    path: str
    batch_index: int = 0
    batch_count: int = 0
    page_count: int = 0


class ScoringEngine(Protocol):
    def score_work(self, path: Path) -> ScoredWork: ...

    def score_works(self, paths: list[Path]) -> dict[Path, ScoredWork | Exception]: ...

    def score_works_steps(self, paths: list[Path]) -> Iterator[BatchScoringProgress]: ...

    def encode_pages(self, images: list[Image.Image]) -> np.ndarray: ...

    def unload(self) -> None: ...


class ClipmScoringEngine:
    def __init__(self, bundle_store: ModelBundleStore, encoder: Siglip2Encoder):
        self.bundle_store = bundle_store
        self.encoder = encoder

    def score_work(self, path: Path) -> ScoredWork:
        bundle = self._active_bundle()
        sampled = load_sampled_work(path)
        page_embeddings = self.encode_pages(sampled.images)
        return self._score_sampled(path, sampled, page_embeddings, bundle)

    def score_works(self, paths: list[Path]) -> dict[Path, ScoredWork | Exception]:
        return _consume_batch_steps(self.score_works_steps(paths))

    def score_works_steps(self, paths: list[Path]) -> Iterator[BatchScoringProgress]:
        bundle = self._active_bundle()
        outcomes: dict[Path, ScoredWork | Exception] = {}
        batch_count = (len(paths) + DIRECTORY_WORK_BATCH_SIZE - 1) // DIRECTORY_WORK_BATCH_SIZE
        for batch_index, start in enumerate(range(0, len(paths), DIRECTORY_WORK_BATCH_SIZE), start=1):
            batch_paths = paths[start : start + DIRECTORY_WORK_BATCH_SIZE]
            sampled_works: list[tuple[Path, SampledWork]] = []
            flattened_images: list[Image.Image] = []
            for offset, path in enumerate(batch_paths, start=1):
                index = start + offset
                resolved = path.resolve()
                yield BatchScoringProgress(
                    "preparing",
                    index - 1,
                    len(paths),
                    str(resolved),
                    batch_index,
                    batch_count,
                )
                try:
                    sampled = load_sampled_work(resolved)
                except Exception as error:
                    outcomes[resolved] = error
                    yield BatchScoringProgress(
                        "prepare-failed",
                        index,
                        len(paths),
                        str(resolved),
                        batch_index,
                        batch_count,
                    )
                    continue
                sampled_works.append((resolved, sampled))
                flattened_images.extend(sampled.images)
                yield BatchScoringProgress(
                    "prepared",
                    index,
                    len(paths),
                    str(resolved),
                    batch_index,
                    batch_count,
                )

            if not flattened_images:
                continue
            completed = start + len(batch_paths)
            yield BatchScoringProgress(
                "inference",
                completed,
                len(paths),
                "",
                batch_index,
                batch_count,
                len(flattened_images),
            )
            try:
                embeddings = self.encoder.encode_pages(flattened_images, batch_size=DIRECTORY_PAGE_BATCH_SIZE)
                embedding_offset = 0
                for path, sampled in sampled_works:
                    end = embedding_offset + len(sampled.images)
                    outcomes[path] = self._score_sampled(
                        path,
                        sampled,
                        embeddings[embedding_offset:end],
                        bundle,
                    )
                    embedding_offset = end
            finally:
                for image in flattened_images:
                    image.close()
            yield BatchScoringProgress(
                "inference-complete",
                completed,
                len(paths),
                "",
                batch_index,
                batch_count,
                len(flattened_images),
            )
        return outcomes

    def _active_bundle(self):
        version = self.bundle_store.active_version()
        if version is None:
            raise FileNotFoundError("No active ClipM model bundle is installed.")
        return self.bundle_store.load_bundle(version)

    @staticmethod
    def _score_sampled(path: Path, sampled: SampledWork, page_embeddings: np.ndarray, bundle) -> ScoredWork:
        embedding = page_embeddings.mean(axis=0)
        embedding /= max(float(np.linalg.norm(embedding)), 1e-12)
        embedding = np.asarray(embedding, dtype=np.float32)
        probability = bundle.classification.predict_probability(embedding)
        threshold = bundle.manifest.classification_head.threshold
        baseline_score = min(1000, max(0, round(probability * 1000)))
        score = (
            min(1000, max(0, round(bundle.ranking.predict_score(embedding, baseline_score))))
            if bundle.ranking is not None
            else baseline_score
        )
        return ScoredWork(
            path=path.resolve(),
            label=CmLabel.POSITIVE if probability >= threshold else CmLabel.NEGATIVE,
            score=score,
            probability=probability,
            bundle_version=bundle.manifest.bundle_version,
            embedding=embedding,
            sampled_pages=sampled.source_names,
            candidate_page_count=sampled.candidate_page_count,
            page_count=sampled.page_count,
            baseline_score=baseline_score,
            content_digest=sampled_pixel_digest(sampled),
            page_embeddings=page_embeddings,
        )

    def encode_pages(self, images: list[Image.Image]) -> np.ndarray:
        return self.encoder.encode_pages(images)

    def unload(self) -> None:
        self.encoder.unload()


class SerializedScoringEngine:
    def __init__(self, target: ScoringEngine, locks: ClipmOperationLocks):
        self._target = target
        self._locks = locks

    def score_work(self, path: Path) -> ScoredWork:
        with self._locks.inference():
            return self._target.score_work(path)

    def score_works(self, paths: list[Path]) -> dict[Path, ScoredWork | Exception]:
        return _consume_batch_steps(self.score_works_steps(paths))

    def score_works_steps(self, paths: list[Path]) -> Iterator[BatchScoringProgress]:
        with self._locks.inference():
            return (yield from self._target.score_works_steps(paths))

    def encode_pages(self, images: list[Image.Image]) -> np.ndarray:
        with self._locks.inference():
            return self._target.encode_pages(images)

    def unload(self) -> None:
        self._target.unload()


def _consume_batch_steps(steps: Iterator[BatchScoringProgress]) -> dict[Path, ScoredWork | Exception]:
    while True:
        try:
            next(steps)
        except StopIteration as completed:
            return completed.value
