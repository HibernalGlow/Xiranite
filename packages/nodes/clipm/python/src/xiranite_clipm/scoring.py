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


class ClipmScoringEngine:
    def __init__(self, bundle_store: ModelBundleStore, encoder: Siglip2Encoder):
        self.bundle_store = bundle_store
        self.encoder = encoder

    def score_work(self, path: Path) -> ScoredWork:
        head = self.bundle_store.load_active_head()
        sampled = load_sampled_work(path)
        embedding = self.encoder.encode(sampled.images)
        probability = head.predict_probability(embedding)
        threshold = head.manifest.classification_head.threshold
        return ScoredWork(
            path=path.resolve(),
            label=CmLabel.POSITIVE if probability >= threshold else CmLabel.NEGATIVE,
            score=min(1000, max(0, round(probability * 1000))),
            probability=probability,
            bundle_version=head.manifest.bundle_version,
            embedding=embedding,
            sampled_pages=sampled.source_names,
            candidate_page_count=sampled.candidate_page_count,
            page_count=sampled.page_count,
        )

    def unload(self) -> None:
        self.encoder.unload()
