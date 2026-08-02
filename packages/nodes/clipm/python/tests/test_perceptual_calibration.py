from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image
import pytest

import xiranite_clipm.perceptual_calibration as calibration_module
from xiranite_clipm.database import open_clipm_database
from xiranite_clipm.perceptual_calibration import (
    calibration_variants,
    calibrate_perceptual_recovery_steps,
    select_calibrated_threshold,
)
from xiranite_clipm.perceptual_recovery import enqueue_perceptual_content_review
from xiranite_clipm.short_codes import encode_record_number


def test_threshold_requires_separation_and_positive_recall() -> None:
    accepted = select_calibrated_threshold([0.95] * 36, [0.8] * 50, 12)
    assert accepted.accepted is True
    assert accepted.threshold == 0.81
    assert accepted.positive_recall == 1

    rejected = select_calibrated_threshold([0.9] * 36, [0.91] * 50, 12)
    assert rejected.accepted is False
    assert rejected.threshold is None
    assert any("positive recall" in reason for reason in rejected.reasons)


def test_calibration_variants_are_in_memory_and_preserve_geometry() -> None:
    source = Image.new("RGB", (224, 224), "white")
    variants = calibration_variants([source])
    assert [name for name, _ in variants] == ["jpeg-q68", "crop-4pct", "watermark-band"]
    assert all(images[0].size == source.size for _, images in variants)
    assert source.getpixel((112, 112)) == (255, 255, 255)


def test_calibration_persists_policy_without_modifying_work_paths(tmp_path: Path, monkeypatch) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    work_ids: list[str] = []
    paths: list[str] = []
    now = "2026-08-02T00:00:00+00:00"
    for work_index in range(12):
        work_id = f"018f0000-0000-7000-8000-{work_index + 1:012d}"
        path = tmp_path / f"work-{work_index}"
        path.mkdir()
        work_ids.append(work_id)
        paths.append(str(path.resolve()))
        connection.execute(
            """INSERT INTO works(
                 record_number, work_id, short_code, first_seen_name, current_base_name,
                 created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (work_index + 1, work_id, encode_record_number(work_index + 1), path.name, path.name, now, now),
        )
        connection.execute(
            """INSERT INTO work_locations(work_id, path, path_key, first_seen_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?)""",
            (work_id, str(path.resolve()), str(path.resolve()).casefold(), now, now),
        )
        for page_index in range(4):
            embedding = np.zeros(768, dtype="<f2")
            embedding[work_index * 4 + page_index] = 1
            connection.execute(
                """INSERT INTO page_embeddings(
                     work_id, encoder, preprocess, page_index, source_name,
                     dtype, dimension, data, created_at
                   ) VALUES (?, 'google/siglip2-base-patch16-224',
                     'white-letterbox-224/four-of-twelve/color-mono-v1', ?, ?,
                     'float16', 768, ?, ?)""",
                (work_id, page_index, f"{page_index}.png", embedding.tobytes(), now),
            )

    monkeypatch.setattr(
        calibration_module,
        "load_sampled_work",
        lambda _path: SimpleNamespace(images=[Image.new("RGB", (224, 224)) for _ in range(4)]),
    )
    call_count = 0

    def encode_pages(_images):
        nonlocal call_count
        work_index = call_count // 3
        call_count += 1
        matrix = np.zeros((4, 768), dtype=np.float32)
        for page_index in range(4):
            matrix[page_index, work_index * 4 + page_index] = 1
        return matrix

    steps = calibrate_perceptual_recovery_steps(connection, encode_pages, 12)
    progress = []
    while True:
        try:
            progress.append(next(steps))
        except StopIteration as completed:
            result = completed.value
            break

    assert len(progress) == 12 and all(item.succeeded for item in progress)
    assert result.status == "accepted"
    assert result.candidate_generation_enabled is True
    assert result.threshold == 0.01
    assert result.evidence_work_count == 12
    assert result.positive_sample_count == 36
    assert result.negative_sample_count == 66
    assert [str(row["path"]) for row in connection.execute(
        "SELECT path FROM work_locations WHERE is_current = 1 ORDER BY path"
    )] == sorted(paths)
    assert connection.execute(
        "SELECT enabled, threshold FROM perceptual_recovery_policy WHERE singleton = 1"
    ).fetchone()["enabled"] == 1

    active_run_id = connection.execute(
        "SELECT calibration_run_id FROM perceptual_recovery_policy WHERE singleton = 1"
    ).fetchone()["calibration_run_id"]
    call_count = 0
    monkeypatch.setattr(
        calibration_module,
        "enqueue_existing_perceptual_reviews",
        lambda _connection: (_ for _ in ()).throw(RuntimeError("review queue unavailable")),
    )
    with pytest.raises(RuntimeError, match="review queue unavailable"):
        list(calibrate_perceptual_recovery_steps(connection, encode_pages, 12))
    assert connection.execute(
        "SELECT status FROM perceptual_calibration_runs ORDER BY started_at DESC, run_id DESC LIMIT 1"
    ).fetchone()["status"] == "failed"
    assert connection.execute(
        "SELECT calibration_run_id FROM perceptual_recovery_policy WHERE singleton = 1"
    ).fetchone()["calibration_run_id"] == active_run_id
    monkeypatch.setattr(
        calibration_module,
        "enqueue_existing_perceptual_reviews",
        lambda _connection: 0,
    )

    call_count = 0
    cancelled_steps = calibrate_perceptual_recovery_steps(connection, encode_pages, 12)
    next(cancelled_steps)
    cancelled_steps.close()
    assert connection.execute(
        "SELECT status FROM perceptual_calibration_runs ORDER BY started_at DESC, run_id DESC LIMIT 1"
    ).fetchone()["status"] == "cancelled"
    assert connection.execute(
        "SELECT enabled FROM perceptual_recovery_policy WHERE singleton = 1"
    ).fetchone()["enabled"] == 1

    failed_steps = calibrate_perceptual_recovery_steps(
        connection,
        lambda _images: (_ for _ in ()).throw(TypeError("unexpected encoder failure")),
        12,
    )
    with pytest.raises(TypeError, match="unexpected encoder failure"):
        next(failed_steps)
    assert connection.execute(
        "SELECT status FROM perceptual_calibration_runs ORDER BY started_at DESC, run_id DESC LIMIT 1"
    ).fetchone()["status"] == "failed"

    monkeypatch.setattr(
        calibration_module,
        "_eligible_works",
        lambda *_args: (_ for _ in ()).throw(LookupError("eligible query failed")),
    )
    setup_steps = calibrate_perceptual_recovery_steps(connection, encode_pages, 12)
    with pytest.raises(LookupError, match="eligible query failed"):
        next(setup_steps)
    assert connection.execute(
        "SELECT status FROM perceptual_calibration_runs ORDER BY started_at DESC, run_id DESC LIMIT 1"
    ).fetchone()["status"] == "failed"
    connection.close()


def test_enabled_policy_queues_review_but_excludes_exact_pixel_match(tmp_path: Path) -> None:
    connection = open_clipm_database(tmp_path / "clipm.sqlite")
    now = "2026-08-02T00:00:00+00:00"
    left = "018f0000-0000-7000-8000-000000000001"
    right = "018f0000-0000-7000-8000-000000000002"
    for record, work_id in enumerate((left, right), start=1):
        connection.execute(
            """INSERT INTO works(
                 record_number, work_id, short_code, first_seen_name, current_base_name,
                 created_at, updated_at
               ) VALUES (?, ?, ?, 'work', 'work', ?, ?)""",
            (record, work_id, encode_record_number(record), now, now),
        )
    run_id = "018f0000-0000-7000-8000-000000000099"
    connection.execute(
        """INSERT INTO perceptual_calibration_runs(
             run_id, status, requested_max_works, evaluated_work_count,
             positive_sample_count, negative_sample_count, positive_recall,
             negative_ceiling, threshold, safety_margin, started_at, completed_at
           ) VALUES (?, 'accepted', 12, 12, 36, 66, 1, 0.89, 0.9, 0.01, ?, ?)""",
        (run_id, now, now),
    )
    connection.execute(
        """INSERT INTO perceptual_recovery_policy(
             singleton, calibration_run_id, enabled, threshold, method, calibrated_at
           ) VALUES (1, ?, 1, 0.9, 'test', ?)""",
        (run_id, now),
    )
    connection.execute(
        """INSERT INTO perceptual_similarity_observations(
             work_id, candidate_work_id, encoder, preprocess, mean_similarity,
             matched_page_count, query_page_count, candidate_page_count, pairings_json, observed_at
           ) VALUES (?, ?, 'google/siglip2-base-patch16-224',
             'white-letterbox-224/four-of-twelve/color-mono-v1', 0.95, 4, 4, 4, '[]', ?)""",
        (left, right, now),
    )
    work_path = tmp_path / "work"
    work_path.mkdir()
    review = enqueue_perceptual_content_review(connection, left, work_path)
    assert review is not None
    assert review.details["reason"] == "perceptual_ordered_page_consensus"

    connection.execute(
        "UPDATE perceptual_recovery_policy SET threshold = 0.92 WHERE singleton = 1"
    )
    refreshed = enqueue_perceptual_content_review(connection, left, work_path)
    assert refreshed is not None
    assert refreshed.review_id == review.review_id
    assert refreshed.details["threshold"] == 0.92
    assert connection.execute(
        "SELECT count(*) FROM review_queue WHERE kind = 'recovery_candidate' AND status = 'pending'"
    ).fetchone()[0] == 1

    connection.execute("DELETE FROM review_queue")
    for work_id in (left, right):
        connection.execute(
            """INSERT INTO content_evidence(
                 work_id, evidence_kind, digest, page_count, sampled_page_count, created_at
               ) VALUES (?, 'sampled_pixel_sha256', ?, 10, 4, ?)""",
            (work_id, "ab" * 32, now),
        )
    assert enqueue_perceptual_content_review(connection, left, work_path) is None
    connection.close()
