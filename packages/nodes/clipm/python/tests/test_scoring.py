from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image

import xiranite_clipm.scoring as scoring_module
from xiranite_clipm.contracts import CmLabel
from xiranite_clipm.scoring import ClipmScoringEngine
from xiranite_clipm.scoring_performance import ScoringPerformanceLimits


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
    def __init__(self):
        self.calls: list[int] = []
        self.batch_sizes: list[int] = []

    def encode_pages(self, images, batch_size: int = 8) -> np.ndarray:
        assert batch_size > 0
        self.calls.append(len(images))
        self.batch_sizes.append(batch_size)
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


def test_scores_multiple_works_in_one_encoder_call(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        scoring_module,
        "load_sampled_work",
        lambda path: SimpleNamespace(
            images=[Image.new("RGB", (224, 224), "white"), Image.new("RGB", (224, 224), "black")],
            source_names=[f"{path.name}-01.png", f"{path.name}-02.png"],
            candidate_page_count=2,
            page_count=2,
        ),
    )
    encoder = FakeEncoder()
    engine = ClipmScoringEngine(FakeBundleStore(), encoder)  # type: ignore[arg-type]

    results = engine.score_works([tmp_path / "first", tmp_path / "second"])

    assert encoder.calls == [4]
    assert encoder.batch_sizes == [32]
    assert set(path.name for path in results) == {"first", "second"}
    assert all(isinstance(result, scoring_module.ScoredWork) for result in results.values())


def test_scores_large_directories_in_bounded_batches_with_preparation_progress(tmp_path: Path, monkeypatch) -> None:
    loaded_paths: list[Path] = []

    def load_sampled(path: Path):
        loaded_paths.append(path)
        return SimpleNamespace(
            images=[Image.new("RGB", (224, 224), "white") for _ in range(4)],
            source_names=[f"{path.name}-{index}.png" for index in range(4)],
            candidate_page_count=4,
            page_count=4,
        )

    monkeypatch.setattr(scoring_module, "load_sampled_work", load_sampled)
    encoder = FakeEncoder()
    engine = ClipmScoringEngine(FakeBundleStore(), encoder)  # type: ignore[arg-type]
    paths = [tmp_path / f"work-{index}" for index in range(10)]
    steps = engine.score_works_steps(paths)

    first = next(steps)
    assert first.stage == "preparing"
    assert first.path == str(paths[0].resolve())
    assert loaded_paths == []

    progress = [first]
    while True:
        try:
            progress.append(next(steps))
        except StopIteration as completed:
            results = completed.value
            break

    assert encoder.calls == [32, 8]
    assert encoder.batch_sizes == [32, 32]
    assert [(item.batch_index, item.batch_count) for item in progress if item.stage == "inference"] == [
        (1, 2),
        (2, 2),
    ]
    assert len(results) == 10


def test_applies_configured_directory_limits_between_persistable_batches(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        scoring_module,
        "load_sampled_work",
        lambda path: SimpleNamespace(
            images=[Image.new("RGB", (224, 224), "white") for _ in range(4)],
            source_names=[f"{path.name}-{index}.png" for index in range(4)],
            candidate_page_count=4,
            page_count=4,
        ),
    )
    pauses: list[float] = []
    monkeypatch.setattr(scoring_module.time, "sleep", pauses.append)
    encoder = FakeEncoder()
    engine = ClipmScoringEngine(
        FakeBundleStore(),
        encoder,  # type: ignore[arg-type]
        work_batch_size=2,
        page_batch_size=4,
        batch_pause_ms=250,
    )

    progress = list(engine.score_works_steps([tmp_path / f"work-{index}" for index in range(5)]))

    assert encoder.calls == [8, 8, 4]
    assert encoder.batch_sizes == [4, 4, 4]
    assert pauses == [0.25, 0.25]
    assert [(item.batch_index, item.pause_ms) for item in progress if item.stage == "throttling"] == [
        (2, 250),
        (3, 250),
    ]


def test_reloads_performance_limits_between_batches(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        scoring_module,
        "load_sampled_work",
        lambda path: SimpleNamespace(
            images=[Image.new("RGB", (224, 224), "white") for _ in range(4)],
            source_names=[f"{path.name}-{index}.png" for index in range(4)],
            candidate_page_count=4,
            page_count=4,
        ),
    )
    pauses: list[float] = []
    monkeypatch.setattr(scoring_module.time, "sleep", pauses.append)
    configured_limits = iter([
        ScoringPerformanceLimits(2, 8, 0),
        ScoringPerformanceLimits(1, 4, 500),
    ])
    encoder = FakeEncoder()
    engine = ClipmScoringEngine(
        FakeBundleStore(),
        encoder,  # type: ignore[arg-type]
        performance_limits=lambda: next(configured_limits),
    )

    results = engine.score_works([tmp_path / f"work-{index}" for index in range(3)])

    assert len(results) == 3
    assert encoder.calls == [8, 4]
    assert encoder.batch_sizes == [8, 4]
    assert pauses == [0.5]
