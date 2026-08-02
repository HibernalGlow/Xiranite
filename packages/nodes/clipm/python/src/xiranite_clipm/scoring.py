from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import time
from typing import Callable, Iterator, Protocol

import numpy as np
from PIL import Image

from .contracts import CmLabel
from .encoder import Siglip2Encoder
from .locks import ClipmOperationLocks
from .model_bundle import ModelBundleStore
from .pages import SampledWork, load_sampled_work, sampled_pixel_digest
from .scoring_performance import ScoringPerformanceLimits


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
    outcomes: dict[Path, ScoredWork | Exception] | None = None
    pause_ms: int = 0


class ScoringEngine(Protocol):
    def score_work(self, path: Path) -> ScoredWork: ...

    def score_works(self, paths: list[Path]) -> dict[Path, ScoredWork | Exception]: ...

    def score_works_steps(self, paths: list[Path]) -> Iterator[BatchScoringProgress]: ...

    def encode_pages(self, images: list[Image.Image]) -> np.ndarray: ...

    def unload(self) -> None: ...


class ClipmScoringEngine:
    def __init__(
        self,
        bundle_store: ModelBundleStore,
        encoder: Siglip2Encoder,
        *,
        work_batch_size: int = DIRECTORY_WORK_BATCH_SIZE,
        page_batch_size: int = DIRECTORY_PAGE_BATCH_SIZE,
        batch_pause_ms: int = 0,
        performance_limits: Callable[[], ScoringPerformanceLimits] | None = None,
    ):
        self.bundle_store = bundle_store
        self.encoder = encoder
        self.work_batch_size = work_batch_size
        self.page_batch_size = page_batch_size
        self.batch_pause_ms = batch_pause_ms
        self.performance_limits = performance_limits or (lambda: ScoringPerformanceLimits(
            work_batch_size=self.work_batch_size,
            page_batch_size=self.page_batch_size,
            batch_pause_ms=self.batch_pause_ms,
        ))

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
        batch_index = 0
        start = 0
        while start < len(paths):
            limits = self.performance_limits()
            batch_index += 1
            remaining_batch_count = (
                len(paths) - start + limits.work_batch_size - 1
            ) // limits.work_batch_size
            batch_count = batch_index + remaining_batch_count - 1
            if batch_index > 1 and limits.batch_pause_ms > 0:
                yield BatchScoringProgress(
                    "throttling",
                    start,
                    len(paths),
                    "",
                    batch_index,
                    batch_count,
                    pause_ms=limits.batch_pause_ms,
                )
                time.sleep(limits.batch_pause_ms / 1000)
            batch_paths = paths[start : start + limits.work_batch_size]
            batch_outcomes: dict[Path, ScoredWork | Exception] = {}
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
                    batch_outcomes[resolved] = error
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
                yield BatchScoringProgress(
                    "inference-complete",
                    start + len(batch_paths),
                    len(paths),
                    "",
                    batch_index,
                    batch_count,
                    0,
                    dict(batch_outcomes),
                )
                start += len(batch_paths)
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
                embeddings = self.encoder.encode_pages(flattened_images, batch_size=limits.page_batch_size)
                embedding_offset = 0
                for path, sampled in sampled_works:
                    end = embedding_offset + len(sampled.images)
                    scored = self._score_sampled(
                        path,
                        sampled,
                        embeddings[embedding_offset:end],
                        bundle,
                    )
                    outcomes[path] = scored
                    batch_outcomes[path] = scored
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
                dict(batch_outcomes),
            )
            start += len(batch_paths)
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
