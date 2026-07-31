from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pytest

from xiranite_clipm.encoder import Siglip2Encoder
from xiranite_clipm.model_bundle import ModelBundleStore
from xiranite_clipm.pages import load_sampled_work


REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
PILOT_ROOT = REPOSITORY_ROOT / "artifacts" / "doujin-preference" / "pilot-v2"


@pytest.mark.skipif(os.environ.get("CLIPM_RUN_LIVE_ENCODER") != "1", reason="live SigLIP2 validation is opt-in")
def test_live_encoder_reproduces_cached_pilot_embedding() -> None:
    with (PILOT_ROOT / "manifest.jsonl").open("r", encoding="utf-8") as source:
        record = json.loads(next(source))
    dataset = np.load(PILOT_ROOT / "embeddings" / "siglip2-letterbox.npz", allow_pickle=False)
    work_index = list(dataset["work_ids"]).index(record["work_id"])
    start, end = dataset["offsets"][work_index : work_index + 2]
    expected = dataset["features"][start:end].astype(np.float32).mean(axis=0)
    expected /= max(float(np.linalg.norm(expected)), 1e-12)

    cache_root = Path(os.environ["XIRANITE_CLIPM_HF_CACHE"])
    encoder = Siglip2Encoder(cache_root, os.environ.get("XIRANITE_CLIPM_DEVICE", "cuda"))
    try:
        sampled = load_sampled_work(PILOT_ROOT / "pages" / record["work_id"])
        actual = encoder.encode(sampled.images)
    finally:
        encoder.unload()

    cosine_similarity = float(np.dot(expected, actual))
    assert cosine_similarity > 0.9999
    store = ModelBundleStore(REPOSITORY_ROOT / "artifacts" / "clipm-runtime" / "models")
    head = store.load_active_head()
    assert abs(head.predict_probability(expected) - head.predict_probability(actual)) < 0.002
