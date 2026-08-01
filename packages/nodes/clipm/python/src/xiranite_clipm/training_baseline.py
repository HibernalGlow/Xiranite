from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from typing import Literal

import numpy as np
from pydantic import Field
from sklearn.model_selection import StratifiedGroupKFold

from .contracts import ContractModel


TRUSTED_PILOT_EMBEDDINGS_SHA256 = "ef9301669dad18359a872eaa0f6452869e87b6e3baa246a1387d24652b24e882"
BASELINE_DATA_FILE = "pilot-v1.npz"
BASELINE_MANIFEST_FILE = "pilot-v1.manifest.json"
BASELINE_SPLIT_SEED = 20260731


class TrainingBaselineManifest(ContractModel):
    schema_version: Literal[1]
    encoder: Literal["google/siglip2-base-patch16-224"]
    preprocess: Literal["white-letterbox-224/four-of-twelve/color-mono-v1"]
    samples: int = Field(ge=1)
    positive_samples: int = Field(ge=1)
    negative_samples: int = Field(ge=1)
    validation_samples: int = Field(ge=1)
    split_seed: int
    source_file_name: str = Field(min_length=1)
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    data_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    created_at: datetime


class TrainingBaselineStore:
    def __init__(self, root: Path):
        self.root = root

    @property
    def bundle_root(self) -> Path:
        return self.root / "pilot-v1"

    @property
    def data_path(self) -> Path:
        return self.bundle_root / BASELINE_DATA_FILE

    @property
    def manifest_path(self) -> Path:
        return self.bundle_root / BASELINE_MANIFEST_FILE

    def install_trusted_pilot(
        self,
        source_path: Path,
        created_at: datetime | None = None,
    ) -> TrainingBaselineManifest:
        source_hash = _sha256(source_path)
        if source_hash != TRUSTED_PILOT_EMBEDDINGS_SHA256:
            raise ValueError(f"Trusted pilot embedding SHA-256 mismatch: {source_hash}")
        if self.bundle_root.exists():
            manifest = self.load_manifest()
            if manifest.source_sha256 != source_hash:
                raise FileExistsError(f"Immutable ClipM training baseline has another source: {self.root}")
            self.load_arrays()
            return manifest

        with np.load(source_path, allow_pickle=False) as source:
            arrays = build_training_baseline(source)
        self.root.mkdir(parents=True, exist_ok=True)
        temporary_root = Path(tempfile.mkdtemp(prefix=".pilot-v1-", dir=self.root))
        try:
            temporary_data = temporary_root / BASELINE_DATA_FILE
            np.savez_compressed(temporary_data, **arrays)
            data_hash = _sha256(temporary_data)
            labels = arrays["labels"]
            validation_mask = arrays["validation_mask"]
            manifest = TrainingBaselineManifest(
                schema_version=1,
                encoder="google/siglip2-base-patch16-224",
                preprocess="white-letterbox-224/four-of-twelve/color-mono-v1",
                samples=int(labels.size),
                positive_samples=int(np.count_nonzero(labels == 1)),
                negative_samples=int(np.count_nonzero(labels == 0)),
                validation_samples=int(np.count_nonzero(validation_mask)),
                split_seed=BASELINE_SPLIT_SEED,
                source_file_name=source_path.name,
                source_sha256=source_hash,
                data_sha256=data_hash,
                created_at=created_at or datetime.now(timezone.utc),
            )
            _write_json_atomic(
                temporary_root / BASELINE_MANIFEST_FILE,
                manifest.model_dump(mode="json", by_alias=True),
            )
            os.replace(temporary_root, self.bundle_root)
            return manifest
        finally:
            if temporary_root.exists():
                shutil.rmtree(temporary_root, ignore_errors=True)

    def load_manifest(self) -> TrainingBaselineManifest:
        manifest = TrainingBaselineManifest.model_validate_json(self.manifest_path.read_text(encoding="utf-8"))
        if _sha256(self.data_path) != manifest.data_sha256:
            raise ValueError("ClipM training baseline failed SHA-256 verification")
        return manifest

    def load_arrays(self) -> dict[str, np.ndarray]:
        manifest = self.load_manifest()
        with np.load(self.data_path, allow_pickle=False) as source:
            arrays = {name: source[name] for name in source.files}
        _validate_baseline_arrays(arrays, manifest.samples, manifest.validation_samples)
        return arrays


def build_training_baseline(source: np.lib.npyio.NpzFile) -> dict[str, np.ndarray]:
    required = {"features", "offsets", "work_ids", "labels", "authors"}
    if not required.issubset(source.files):
        raise ValueError(f"Pilot embeddings are missing arrays: {sorted(required - set(source.files))}")
    page_features = np.asarray(source["features"], dtype=np.float32)
    offsets = np.asarray(source["offsets"], dtype=np.int64)
    work_ids = np.asarray(source["work_ids"])
    labels = np.asarray(source["labels"], dtype=np.int8)
    groups = np.asarray(source["authors"]).astype(str)
    sample_count = labels.size
    if page_features.ndim != 2 or page_features.shape[1] != 768 or not np.all(np.isfinite(page_features)):
        raise ValueError("Pilot page features must be finite [pages, 768] data")
    if offsets.shape != (sample_count + 1,) or offsets[0] != 0 or offsets[-1] != page_features.shape[0]:
        raise ValueError("Pilot page offsets do not cover every work")
    if np.any(np.diff(offsets) <= 0):
        raise ValueError("Every pilot work must contain at least one page embedding")
    if work_ids.shape != (sample_count,) or groups.shape != (sample_count,):
        raise ValueError("Pilot identity and author arrays must align with labels")
    if len(set(work_ids.tolist())) != sample_count or any(not str(work_id) for work_id in work_ids):
        raise ValueError("Pilot work IDs must be non-empty and unique")
    groups = np.asarray(
        [group if group.strip() else str(work_id) for group, work_id in zip(groups, work_ids, strict=True)]
    )
    if set(np.unique(labels).tolist()) != {0, 1}:
        raise ValueError("Pilot labels must contain both binary classes")

    embeddings = np.empty((sample_count, 768), dtype=np.float32)
    for index, (start, end) in enumerate(zip(offsets[:-1], offsets[1:], strict=True)):
        pooled = page_features[start:end].mean(axis=0)
        norm = float(np.linalg.norm(pooled))
        if norm <= 1e-12:
            raise ValueError(f"Pilot work {work_ids[index]} has a zero pooled embedding")
        embeddings[index] = pooled / norm

    splitter = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=BASELINE_SPLIT_SEED)
    _, validation_indices = next(splitter.split(embeddings, labels, groups))
    validation_mask = np.zeros(sample_count, dtype=np.bool_)
    validation_mask[validation_indices] = True
    if set(labels[validation_mask].tolist()) != {0, 1} or set(labels[~validation_mask].tolist()) != {0, 1}:
        raise ValueError("Fixed pilot training and validation folds must both contain both labels")
    arrays = {
        "embeddings": embeddings.astype(np.float16),
        "labels": labels,
        "groups": groups,
        "work_ids": work_ids,
        "validation_mask": validation_mask,
    }
    _validate_baseline_arrays(arrays, sample_count, int(validation_mask.sum()))
    return arrays


def _validate_baseline_arrays(arrays: dict[str, np.ndarray], samples: int, validation_samples: int) -> None:
    required = {"embeddings", "labels", "groups", "work_ids", "validation_mask"}
    if set(arrays) != required:
        raise ValueError(f"ClipM training baseline arrays differ from the schema: {sorted(arrays)}")
    embeddings = np.asarray(arrays["embeddings"])
    labels = np.asarray(arrays["labels"])
    groups = np.asarray(arrays["groups"])
    work_ids = np.asarray(arrays["work_ids"])
    validation_mask = np.asarray(arrays["validation_mask"])
    if embeddings.shape != (samples, 768) or embeddings.dtype != np.float16 or not np.all(np.isfinite(embeddings)):
        raise ValueError("ClipM training baseline embeddings are invalid")
    if labels.shape != (samples,) or labels.dtype != np.int8 or set(np.unique(labels).tolist()) != {0, 1}:
        raise ValueError("ClipM training baseline labels are invalid")
    if groups.shape != (samples,) or work_ids.shape != (samples,):
        raise ValueError("ClipM training baseline identities are invalid")
    if len(set(work_ids.tolist())) != samples or any(not str(work_id) for work_id in work_ids):
        raise ValueError("ClipM training baseline work IDs are invalid")
    if validation_mask.shape != (samples,) or validation_mask.dtype != np.bool_:
        raise ValueError("ClipM training baseline validation mask is invalid")
    if int(validation_mask.sum()) != validation_samples:
        raise ValueError("ClipM training baseline validation count differs from its manifest")
    if set(labels[validation_mask].tolist()) != {0, 1} or set(labels[~validation_mask].tolist()) != {0, 1}:
        raise ValueError("ClipM training baseline split lost a label")
    if set(groups[validation_mask]).intersection(groups[~validation_mask]):
        raise ValueError("ClipM pilot groups cross the fixed training and validation split")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json_atomic(path: Path, value: dict[str, object]) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}-", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as target:
            json.dump(value, target, ensure_ascii=False, indent=2)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
