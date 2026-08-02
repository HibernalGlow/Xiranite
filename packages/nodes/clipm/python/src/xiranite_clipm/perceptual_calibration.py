from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

import numpy as np
from PIL import Image, ImageDraw

from .contracts import PerceptualCalibrationResult
from .pages import load_sampled_work
from .perceptual_recovery import (
    ENCODER,
    PREPROCESS,
    enqueue_existing_perceptual_reviews,
    ordered_page_consensus,
)


CALIBRATION_METHOD = "synthetic-jpeg-crop-watermark/cross-work-nearest-v1"
MIN_CALIBRATION_WORKS = 12
MIN_POSITIVE_SAMPLES = MIN_CALIBRATION_WORKS * 3
MIN_NEGATIVE_SAMPLES = 50
MIN_POSITIVE_RECALL = 0.9
SAFETY_MARGIN = 0.01


@dataclass(frozen=True, slots=True)
class PerceptualCalibrationProgress:
    completed: int
    total: int
    path: str
    succeeded: bool


@dataclass(frozen=True, slots=True)
class ThresholdDecision:
    accepted: bool
    threshold: float | None
    positive_recall: float | None
    negative_ceiling: float | None
    reasons: tuple[str, ...]


def select_calibrated_threshold(
    positive_scores: list[float],
    negative_scores: list[float],
    evaluated_work_count: int,
) -> ThresholdDecision:
    reasons: list[str] = []
    if evaluated_work_count < MIN_CALIBRATION_WORKS:
        reasons.append(f"requires at least {MIN_CALIBRATION_WORKS} readable works")
    if len(positive_scores) < MIN_POSITIVE_SAMPLES:
        reasons.append(f"requires at least {MIN_POSITIVE_SAMPLES} transformed positive samples")
    if len(negative_scores) < MIN_NEGATIVE_SAMPLES:
        reasons.append(f"requires at least {MIN_NEGATIVE_SAMPLES} cross-work negative samples")
    if not positive_scores or not negative_scores:
        return ThresholdDecision(False, None, None, max(negative_scores, default=None), tuple(reasons))

    negative_ceiling = max(negative_scores)
    threshold = negative_ceiling + SAFETY_MARGIN
    positive_recall = sum(score >= threshold for score in positive_scores) / len(positive_scores)
    if threshold > 1:
        reasons.append("observed cross-work similarity leaves no safe threshold below 1.0")
    if positive_recall < MIN_POSITIVE_RECALL:
        reasons.append(
            f"transformed positive recall {positive_recall:.4f} is below {MIN_POSITIVE_RECALL:.2f}"
        )
    accepted = not reasons
    return ThresholdDecision(
        accepted,
        min(threshold, 1.0) if accepted else None,
        positive_recall,
        negative_ceiling,
        tuple(reasons),
    )


def calibrate_perceptual_recovery_steps(
    connection: sqlite3.Connection,
    encode_pages: Callable[[list[Image.Image]], np.ndarray],
    max_works: int,
) -> Iterator[PerceptualCalibrationProgress]:
    if not MIN_CALIBRATION_WORKS <= max_works <= 500:
        raise ValueError("perceptual calibration max works must be between 12 and 500")
    run_id = str(uuid4())
    started_at = datetime.now(timezone.utc).isoformat()
    evidence_work_count = _eligible_work_count(connection)
    connection.execute(
        """INSERT INTO perceptual_calibration_runs(
             run_id, status, requested_max_works, evidence_work_count, safety_margin, started_at
           ) VALUES (?, 'running', ?, ?, ?, ?)""",
        (run_id, max_works, evidence_work_count, SAFETY_MARGIN, started_at),
    )
    try:
        rows = _eligible_works(connection, max_works)
        matrices = _page_matrices(connection, [str(row["work_id"]) for row in rows])
        positive_scores: list[float] = []
        evaluated_work_ids: list[str] = []
        failures: list[dict[str, str]] = []
        for index, row in enumerate(rows, start=1):
            work_id = str(row["work_id"])
            path = str(row["path"])
            try:
                sampled = load_sampled_work(Path(path))
                original = matrices[work_id]
                if len(sampled.images) < 3 or len(original) < 3:
                    raise ValueError("fewer than three readable sampled pages")
                for _, variant_images in calibration_variants(sampled.images):
                    transformed = encode_pages(variant_images)
                    consensus = ordered_page_consensus(transformed, original)
                    if consensus is None:
                        raise ValueError("unable to form a three-page ordered consensus")
                    positive_scores.append(consensus.mean_similarity)
                evaluated_work_ids.append(work_id)
                yield PerceptualCalibrationProgress(index, len(rows), path, True)
            except (OSError, RuntimeError, ValueError) as error:
                failures.append({"workId": work_id, "path": path, "message": str(error)})
                yield PerceptualCalibrationProgress(index, len(rows), path, False)

        negative_scores = _cross_work_negative_scores(connection, matrices, evaluated_work_ids)
        decision = select_calibrated_threshold(
            positive_scores,
            negative_scores,
            len(evaluated_work_ids),
        )
        completed_at = datetime.now(timezone.utc).isoformat()
        status = "accepted" if decision.accepted else "rejected"
        metrics = {
            "method": CALIBRATION_METHOD,
            "minimumPositiveRecall": MIN_POSITIVE_RECALL,
            "failures": failures,
            "reasons": list(decision.reasons),
        }
        review_item_count = 0
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """UPDATE perceptual_calibration_runs SET
                 status = ?, evaluated_work_count = ?, positive_sample_count = ?,
                 negative_sample_count = ?, positive_recall = ?, negative_ceiling = ?,
                 threshold = ?, metrics_json = ?, completed_at = ?
               WHERE run_id = ?""",
            (
                status,
                len(evaluated_work_ids),
                len(positive_scores),
                len(negative_scores),
                decision.positive_recall,
                decision.negative_ceiling,
                decision.threshold,
                json.dumps(metrics, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                completed_at,
                run_id,
            ),
        )
        if decision.accepted:
            connection.execute(
                """INSERT INTO perceptual_recovery_policy(
                     singleton, calibration_run_id, enabled, threshold, method, calibrated_at
                   ) VALUES (1, ?, 1, ?, ?, ?)
                   ON CONFLICT(singleton) DO UPDATE SET
                     calibration_run_id = excluded.calibration_run_id,
                     enabled = 1,
                     threshold = excluded.threshold,
                     method = excluded.method,
                     calibrated_at = excluded.calibrated_at""",
                (run_id, decision.threshold, CALIBRATION_METHOD, completed_at),
            )
            review_item_count = enqueue_existing_perceptual_reviews(connection)
        else:
            connection.execute("DELETE FROM perceptual_recovery_policy WHERE singleton = 1")
        connection.commit()
        return PerceptualCalibrationResult(
            run_id=run_id,
            status=status,
            candidate_generation_enabled=decision.accepted,
            threshold=decision.threshold,
            evidence_work_count=evidence_work_count,
            evaluated_work_count=len(evaluated_work_ids),
            positive_sample_count=len(positive_scores),
            negative_sample_count=len(negative_scores),
            positive_recall=decision.positive_recall,
            negative_ceiling=decision.negative_ceiling,
            safety_margin=SAFETY_MARGIN,
            reasons=list(decision.reasons),
            review_item_count=review_item_count,
        )
    except GeneratorExit:
        if connection.in_transaction:
            connection.rollback()
        _mark_interrupted_run(connection, run_id, "cancelled", "Calibration cancelled at a work boundary.")
        raise
    except Exception as error:
        if connection.in_transaction:
            connection.rollback()
        _mark_interrupted_run(connection, run_id, "failed", str(error) or type(error).__name__)
        raise


def calibration_variants(images: list[Image.Image]) -> list[tuple[str, list[Image.Image]]]:
    return [
        ("jpeg-q68", [_jpeg_recompress(image) for image in images]),
        ("crop-4pct", [_crop_and_restore(image) for image in images]),
        ("watermark-band", [_watermark_band(image) for image in images]),
    ]


def _eligible_works(connection: sqlite3.Connection, limit: int) -> list[sqlite3.Row]:
    return connection.execute(
        """SELECT works.work_id, locations.path
           FROM works
           JOIN work_locations locations
             ON locations.work_id = works.work_id AND locations.is_current = 1
           WHERE (SELECT count(*) FROM page_embeddings pages
                  WHERE pages.work_id = works.work_id
                    AND pages.encoder = ? AND pages.preprocess = ?) >= 3
           ORDER BY works.work_id LIMIT ?""",
        (ENCODER, PREPROCESS, limit),
    ).fetchall()


def _eligible_work_count(connection: sqlite3.Connection) -> int:
    return int(connection.execute(
        """SELECT count(*) FROM works
           JOIN work_locations locations
             ON locations.work_id = works.work_id AND locations.is_current = 1
           WHERE (SELECT count(*) FROM page_embeddings pages
                  WHERE pages.work_id = works.work_id
                    AND pages.encoder = ? AND pages.preprocess = ?) >= 3""",
        (ENCODER, PREPROCESS),
    ).fetchone()[0])


def _page_matrices(connection: sqlite3.Connection, work_ids: list[str]) -> dict[str, np.ndarray]:
    matrices: dict[str, np.ndarray] = {}
    for work_id in work_ids:
        rows = connection.execute(
            """SELECT data FROM page_embeddings
               WHERE work_id = ? AND encoder = ? AND preprocess = ? ORDER BY page_index""",
            (work_id, ENCODER, PREPROCESS),
        ).fetchall()
        matrices[work_id] = np.stack(
            [np.frombuffer(row["data"], dtype="<f2").astype(np.float32) for row in rows]
        )
    return matrices


def _cross_work_negative_scores(
    connection: sqlite3.Connection,
    matrices: dict[str, np.ndarray],
    work_ids: list[str],
) -> list[float]:
    digests = {
        str(row["work_id"]): str(row["digest"])
        for row in connection.execute(
            """SELECT work_id, digest FROM content_evidence
               WHERE evidence_kind = 'sampled_pixel_sha256'"""
        )
    }
    scores: list[float] = []
    for left_index, left_work_id in enumerate(work_ids):
        for right_work_id in work_ids[left_index + 1 :]:
            if digests.get(left_work_id) is not None and digests.get(left_work_id) == digests.get(right_work_id):
                continue
            consensus = ordered_page_consensus(matrices[left_work_id], matrices[right_work_id])
            if consensus is not None:
                scores.append(consensus.mean_similarity)
    return scores


def _jpeg_recompress(image: Image.Image) -> Image.Image:
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=68, optimize=False)
    buffer.seek(0)
    with Image.open(buffer) as source:
        return source.convert("RGB")


def _crop_and_restore(image: Image.Image) -> Image.Image:
    source = image.convert("RGB")
    inset_x = max(1, round(source.width * 0.04))
    inset_y = max(1, round(source.height * 0.04))
    cropped = source.crop((inset_x, inset_y, source.width - inset_x, source.height - inset_y))
    return cropped.resize(source.size, Image.Resampling.BICUBIC)


def _watermark_band(image: Image.Image) -> Image.Image:
    source = image.convert("RGBA")
    overlay = Image.new("RGBA", source.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    center = source.height // 2
    draw.rectangle((0, center - 12, source.width, center + 12), fill=(255, 255, 255, 72))
    draw.text((source.width // 3, center - 6), "SAMPLE", fill=(80, 80, 80, 120))
    return Image.alpha_composite(source, overlay).convert("RGB")


def _mark_interrupted_run(
    connection: sqlite3.Connection,
    run_id: str,
    status: str,
    message: str,
) -> None:
    connection.execute(
        """UPDATE perceptual_calibration_runs SET
             status = ?, completed_at = ?, error_message = ? WHERE run_id = ? AND status = 'running'""",
        (status, datetime.now(timezone.utc).isoformat(), message, run_id),
    )
