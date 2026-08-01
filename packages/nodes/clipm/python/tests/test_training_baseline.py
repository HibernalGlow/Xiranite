from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from xiranite_clipm.training_baseline import build_training_baseline


def synthetic_pilot(path: Path, *, zero_first: bool = False) -> Path:
    samples = 20
    features = np.zeros((samples * 2, 768), dtype=np.float16)
    for index in range(samples):
        features[index * 2, index] = 1
        features[index * 2 + 1, index] = 0.5
    if zero_first:
        features[:2] = 0
    labels = np.repeat(np.array([0, 1], dtype=np.int8), 10)
    groups = np.array([f"group-{label}-{index // 2}" for label in range(2) for index in range(10)])
    np.savez_compressed(
        path,
        features=features,
        offsets=np.arange(0, samples * 2 + 1, 2, dtype=np.int32),
        work_ids=np.array([f"work-{index}" for index in range(samples)]),
        labels=labels,
        authors=groups,
        ai_generated=np.zeros(samples, dtype=np.bool_),
    )
    return path


def test_builds_group_isolated_fixed_validation_fold(tmp_path: Path) -> None:
    source_path = synthetic_pilot(tmp_path / "pilot.npz")
    with np.load(source_path, allow_pickle=False) as source:
        first = build_training_baseline(source)
    with np.load(source_path, allow_pickle=False) as source:
        second = build_training_baseline(source)

    assert first["embeddings"].shape == (20, 768)
    assert first["embeddings"].dtype == np.float16
    assert np.array_equal(first["validation_mask"], second["validation_mask"])
    validation = first["validation_mask"]
    assert set(first["labels"][validation]) == {0, 1}
    assert not set(first["groups"][validation]).intersection(first["groups"][~validation])
    norms = np.linalg.norm(first["embeddings"].astype(np.float32), axis=1)
    assert np.allclose(norms, 1, atol=0.001)


def test_rejects_zero_work_embedding(tmp_path: Path) -> None:
    source_path = synthetic_pilot(tmp_path / "invalid.npz", zero_first=True)
    with np.load(source_path, allow_pickle=False) as source:
        with pytest.raises(ValueError, match="zero pooled embedding"):
            build_training_baseline(source)
