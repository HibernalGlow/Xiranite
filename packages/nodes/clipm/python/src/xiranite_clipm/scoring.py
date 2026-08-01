from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .contracts import CmLabel
from .encoder import Siglip2Encoder
from .model_bundle import ModelBundleStore
from .pages import load_sampled_work


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


class ClipmScoringEngine:
    def __init__(self, bundle_store: ModelBundleStore, encoder: Siglip2Encoder):
        self.bundle_store = bundle_store
        self.encoder = encoder

    def score_work(self, path: Path) -> ScoredWork:
        version = self.bundle_store.active_version()
        if version is None:
            raise FileNotFoundError("No active ClipM model bundle is installed.")
        bundle = self.bundle_store.load_bundle(version)
        sampled = load_sampled_work(path)
        embedding = self.encoder.encode(sampled.images)
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
        )

    def unload(self) -> None:
        self.encoder.unload()
