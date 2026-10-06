from __future__ import annotations

from contextlib import nullcontext
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .model_bundle import SIGLIP2_REVISION


MODEL_ID = "google/siglip2-base-patch16-224"


class Siglip2Encoder:
    def __init__(self, cache_root: Path, device_name: str):
        self.cache_root = cache_root
        self.device_name = device_name
        self._processor: Any | None = None
        self._model: Any | None = None
        self._torch: Any | None = None
        self._device: Any | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def encode_pages(self, images: list[Image.Image], batch_size: int = 8) -> np.ndarray:
        if not images:
            raise ValueError("SigLIP2 requires at least one image")
        self._load()
        outputs: list[np.ndarray] = []
        for start in range(0, len(images), batch_size):
            batch = images[start : start + batch_size]
            inputs = self._processor(images=batch, return_tensors="pt")
            pixels = inputs["pixel_values"].to(self._device)
            autocast = (
                self._torch.autocast(device_type="cuda", dtype=self._torch.float16)
                if self._device.type == "cuda"
                else nullcontext()
            )
            with self._torch.inference_mode(), autocast:
                features = self._model.get_image_features(pixel_values=pixels)
            normalized = self._torch.nn.functional.normalize(features.float(), dim=-1)
            outputs.append(normalized.cpu().numpy().astype(np.float32))
        return np.concatenate(outputs, axis=0)

    def encode(self, images: list[Image.Image], batch_size: int = 8) -> np.ndarray:
        page_features = self.encode_pages(images, batch_size)
        pooled = page_features.mean(axis=0)
        pooled /= max(float(np.linalg.norm(pooled)), 1e-12)
        return np.asarray(pooled, dtype=np.float32)

    def unload(self) -> None:
        self._processor = None
        self._model = None
        self._device = None
        if self._torch is not None and self._torch.cuda.is_available():
            self._torch.cuda.empty_cache()
        self._torch = None

    def _load(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import AutoModel, AutoProcessor

        device = torch.device(self.device_name)
        if device.type == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested for ClipM but PyTorch reports that CUDA is unavailable.")
        cache_dir = self.cache_root / "hub"
        self._processor = AutoProcessor.from_pretrained(
            MODEL_ID,
            revision=SIGLIP2_REVISION,
            cache_dir=cache_dir,
            local_files_only=True,
        )
        self._model = AutoModel.from_pretrained(
            MODEL_ID,
            revision=SIGLIP2_REVISION,
            cache_dir=cache_dir,
            local_files_only=True,
        ).eval().to(device)
        self._torch = torch
        self._device = device
