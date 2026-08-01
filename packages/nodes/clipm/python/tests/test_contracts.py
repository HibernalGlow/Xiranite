from __future__ import annotations

import base64
from datetime import datetime, timezone
from uuid import UUID

import pytest
from pydantic import ValidationError

from xiranite_clipm.contracts import (
    ApplyFeedbackCommand,
    CmScoreDocument,
    FeedbackHistoryEntry,
    ModelBundleSource,
    ResolveReviewItemCommand,
)


def metadata_payload() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "work": {
            "workId": "018f0000-0000-7000-8000-000000000001",
            "recordNumber": 1234,
            "shortCode": "4K7Q",
            "firstSeenName": "original.zip",
            "currentBaseName": "renamed title.zip",
            "nameRevision": 3,
        },
        "score": {
            "bundleVersion": 1,
            "classification": {"predicted": "P", "current": "P", "source": "model"},
            "ranking": {"predicted": 873, "current": 873, "source": "model"},
            "probability": 0.873,
            "scoredAt": "2026-08-01T00:00:00Z",
        },
        "embedding": {
            "encoder": "google/siglip2-base-patch16-224",
            "preprocess": "white-letterbox-224/four-of-twelve/color-mono-v1",
            "dtype": "float16",
            "shape": [768],
            "encoding": "base64",
            "data": base64.b64encode(bytes(1536)).decode("ascii"),
        },
        "archive": {"format": "zip", "metadataWriteStatus": "written"},
        "nameHistory": [
            {
                "revision": 1,
                "previousName": "original.zip",
                "currentName": "first rename.zip",
                "changedAt": "2026-07-29T00:00:00Z",
                "source": "filename",
            },
            {
                "revision": 2,
                "previousName": "first rename.zip",
                "currentName": "second rename.zip",
                "changedAt": "2026-07-30T00:00:00Z",
                "source": "gui",
            },
            {
                "revision": 3,
                "previousName": "second rename.zip",
                "currentName": "renamed title.zip",
                "changedAt": "2026-07-31T00:00:00Z",
                "source": "neoview",
            },
        ],
        "feedbackHistory": [],
    }


def test_metadata_round_trip_uses_wire_aliases() -> None:
    document = CmScoreDocument.model_validate(metadata_payload())
    wire = document.model_dump(mode="json", by_alias=True)
    assert wire["work"]["shortCode"] == "4K7Q"
    assert wire["score"]["ranking"]["current"] == 873
    assert document.work.work_id == UUID("018f0000-0000-7000-8000-000000000001")
    assert document.score.scored_at == datetime(2026, 8, 1, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("field", "value"),
    [("shape", [767]), ("data", base64.b64encode(bytes(1534)).decode("ascii"))],
)
def test_metadata_rejects_incompatible_embedding(field: str, value: object) -> None:
    payload = metadata_payload()
    payload["embedding"][field] = value  # type: ignore[index]
    with pytest.raises(ValidationError):
        CmScoreDocument.model_validate(payload)


def test_metadata_forbids_unknown_fields() -> None:
    payload = metadata_payload()
    payload["mtime"] = 123
    with pytest.raises(ValidationError):
        CmScoreDocument.model_validate(payload)


def test_metadata_requires_schema_version_and_timezone() -> None:
    missing_version = metadata_payload()
    del missing_version["schemaVersion"]
    with pytest.raises(ValidationError):
        CmScoreDocument.model_validate(missing_version)

    naive_time = metadata_payload()
    naive_time["score"]["scoredAt"] = "2026-08-01T00:00:00"  # type: ignore[index]
    with pytest.raises(ValidationError):
        CmScoreDocument.model_validate(naive_time)


def test_metadata_requires_complete_name_and_feedback_history_chains() -> None:
    missing_name_revision = metadata_payload()
    missing_name_revision["nameHistory"] = []
    with pytest.raises(ValidationError, match="every revision"):
        CmScoreDocument.model_validate(missing_name_revision)

    invalid_undo = metadata_payload()
    invalid_undo["feedbackHistory"] = [
        {
            "eventId": "018f0000-0000-7000-8000-000000000010",
            "occurredAt": "2026-08-01T00:00:00Z",
            "source": "gui",
            "rankingBefore": 500,
            "rankingAfter": 600,
            "undoneBy": "018f0000-0000-7000-8000-000000000099",
        }
    ]
    with pytest.raises(ValidationError, match="undoneBy"):
        CmScoreDocument.model_validate(invalid_undo)


def test_feedback_fields_remain_independent() -> None:
    classification_only = ApplyFeedbackCommand.model_validate(
        {
            "workId": "018f0000-0000-7000-8000-000000000001",
            "classification": "N",
            "source": "gui",
        }
    )
    assert classification_only.classification == "N"
    assert classification_only.ranking is None

    ranking_only = FeedbackHistoryEntry.model_validate(
        {
            "eventId": "018f0000-0000-7000-8000-000000000002",
            "occurredAt": "2026-08-01T00:00:00Z",
            "source": "filename",
            "rankingBefore": 342,
            "rankingAfter": 873,
        }
    )
    assert ranking_only.classification_after is None
    with pytest.raises(ValidationError):
        FeedbackHistoryEntry.model_validate(
            {
                "eventId": "018f0000-0000-7000-8000-000000000003",
                "occurredAt": "2026-08-01T00:00:00Z",
                "source": "gui",
                "rankingBefore": 500,
                "rankingAfter": 500,
            }
        )


def test_link_existing_review_requires_target_work() -> None:
    with pytest.raises(ValidationError):
        ResolveReviewItemCommand.model_validate(
            {
                "reviewId": "018f0000-0000-7000-8000-000000000004",
                "resolution": "link_existing",
            }
        )


def test_model_bundle_source_requires_one_complete_source_kind() -> None:
    with pytest.raises(ValidationError, match="trained model sources"):
        ModelBundleSource(
            kind="head-training",
            training_run_id=UUID("018f0000-0000-7000-8000-000000000001"),
        )
    with pytest.raises(ValidationError, match="trusted model sources"):
        ModelBundleSource(
            kind="trusted-joblib-import",
            file_name="pilot.joblib",
            sha256="0" * 64,
            parent_bundle_version=1,
        )
