from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image

import xiranite_clipm.scoring as scoring_module
from xiranite_clipm.contracts import CmLabel
from xiranite_clipm.scoring import ClipmScoringEngine


class FakeClassificationHead:
    def predict_probability(self, _embedding: np.ndarray) -> float:
        return 0.8


class FakeRankingHead:
    def predict_score(self, _embedding: np.ndarray, baseline_score: float) -> float:
        assert baseline_score == 800
        return 910.4


class FakeBundleStore:
    def active_version(self) -> int:
        return 2

    def load_bundle(self, bundle_version: int):
        assert bundle_version == 2
        return SimpleNamespace(
            classification=FakeClassificationHead(),
            ranking=FakeRankingHead(),
            manifest=SimpleNamespace(
                bundle_version=2,
                classification_head=SimpleNamespace(threshold=0.48),
            ),
        )


class FakeEncoder:
    def encode_pages(self, images) -> np.ndarray:
        return np.repeat(np.eye(1, 768, dtype=np.float32), len(images), axis=0)

    def unload(self) -> None:
        return None


def test_ranking_head_adjusts_stable_classification_baseline(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        scoring_module,
        "load_sampled_work",
        lambda _path: SimpleNamespace(
            images=[Image.new("RGB", (224, 224), "white")],
            source_names=["01.png"],
            candidate_page_count=1,
            page_count=1,
        ),
    )
    engine = ClipmScoringEngine(FakeBundleStore(), FakeEncoder())  # type: ignore[arg-type]
    result = engine.score_work(tmp_path / "book")

    assert result.label is CmLabel.POSITIVE
    assert result.probability == 0.8
    assert result.baseline_score == 800
    assert result.score == 910
    assert result.bundle_version == 2
    assert result.page_embeddings is not None and result.page_embeddings.shape == (1, 768)
    assert result.content_digest is not None and len(result.content_digest) == 64
