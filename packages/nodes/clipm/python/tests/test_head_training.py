from __future__ import annotations

import numpy as np

from xiranite_clipm.head_training import (
    ClassificationHeadParameters,
    HeadTrainingStatus,
    train_classification_candidate,
    train_ranking_candidate,
)
from xiranite_clipm.training_dataset import ClassificationTrainingData, RankingTrainingData


def _classification_data(*, inverted_validation: bool = False) -> ClassificationTrainingData:
    samples = 48
    labels = np.tile(np.array([0, 1], dtype=np.int8), samples // 2)
    features = np.zeros((samples, 6), dtype=np.float64)
    features[:, 0] = np.where(labels == 1, 2.0, -2.0)
    features[:, 1] = np.linspace(-0.25, 0.25, samples)
    validation_labels = np.tile(np.array([0, 1], dtype=np.int8), 8)
    validation_features = np.zeros((validation_labels.size, 6), dtype=np.float64)
    direction = -1.0 if inverted_validation else 1.0
    validation_features[:, 0] = direction * np.where(validation_labels == 1, 2.0, -2.0)
    return ClassificationTrainingData(
        features=features,
        labels=labels,
        sample_weights=np.concatenate((np.ones(28), np.full(20, 3.0))),
        groups=np.array([f"group-{index}" for index in range(samples)]),
        sample_ids=np.array([f"sample-{index}" for index in range(samples)]),
        validation_features=validation_features,
        validation_labels=validation_labels,
        validation_groups=np.array([f"validation-{index}" for index in range(validation_labels.size)]),
    )


def _active_classifier(*, inverted: bool = False) -> ClassificationHeadParameters:
    coefficients = np.zeros(6, dtype=np.float64)
    if inverted:
        coefficients[0] = -4.0
    return ClassificationHeadParameters(
        scaler_mean=np.zeros(6, dtype=np.float64),
        scaler_scale=np.ones(6, dtype=np.float64),
        coefficients=coefficients,
        intercept=0.0,
        threshold=0.5,
    )


def _ranking_data(samples: int) -> RankingTrainingData:
    signal = np.linspace(-1.0, 1.0, samples)
    features = np.zeros((samples, 6), dtype=np.float64)
    features[:, 0] = signal
    features[:, 1] = signal**2
    baseline_scores = np.full(samples, 500.0)
    target_scores = baseline_scores + signal * 180.0
    return RankingTrainingData(
        features=features,
        residuals=target_scores - baseline_scores,
        sample_weights=np.full(samples, 3.0),
        groups=np.array([f"work-{index}" for index in range(samples)]),
        sample_ids=np.array([f"work-{index}" for index in range(samples)]),
        baseline_scores=baseline_scores,
        target_scores=target_scores,
    )


def test_accepts_classification_candidate_that_improves_corrections() -> None:
    data = _classification_data()
    first = train_classification_candidate(data, correction_count=20, active=_active_classifier())
    second = train_classification_candidate(data, correction_count=20, active=_active_classifier())

    assert first.status is HeadTrainingStatus.ACCEPTED
    assert first.parameters is not None
    assert first.metrics is not None
    assert first.metrics.candidate_correction_log_loss < first.metrics.active_correction_log_loss
    assert first.metrics.candidate_validation_roc_auc == 1.0
    assert np.array_equal(first.parameters.coefficients, second.parameters.coefficients)
    assert first.metrics == second.metrics
    assert set(first.parameters.tensors()) == {
        "classification.scaler_mean",
        "classification.scaler_scale",
        "classification.coefficients",
        "classification.intercept",
    }


def test_rejects_classification_candidate_when_fixed_validation_degrades() -> None:
    result = train_classification_candidate(
        _classification_data(inverted_validation=True),
        correction_count=20,
        active=_active_classifier(inverted=True),
    )

    assert result.status is HeadTrainingStatus.REJECTED
    assert "classification_validation_balanced_accuracy_drop_exceeded" in result.reasons
    assert "classification_validation_roc_auc_drop_exceeded" in result.reasons
    assert result.metrics is not None
    assert result.metrics.candidate_correction_log_loss < result.metrics.active_correction_log_loss


def test_skips_ranking_candidate_with_19_numeric_corrections() -> None:
    result = train_ranking_candidate(_ranking_data(19))

    assert result.status is HeadTrainingStatus.SKIPPED
    assert result.reasons == ("ranking_requires_20_numeric_corrections",)
    assert result.parameters is None


def test_accepts_deterministic_ranking_candidate_with_20_or_more_corrections() -> None:
    data = _ranking_data(25)
    first = train_ranking_candidate(data)
    second = train_ranking_candidate(data)

    assert first.status is HeadTrainingStatus.ACCEPTED
    assert first.parameters is not None
    assert first.metrics is not None
    assert first.metrics.candidate_weighted_mae < first.metrics.baseline_weighted_mae
    assert first.metrics.candidate_spearman >= first.metrics.baseline_spearman
    assert np.array_equal(first.parameters.coefficients, second.parameters.coefficients)
    assert first.metrics == second.metrics
    assert set(first.parameters.tensors()) == {
        "ranking.scaler_mean",
        "ranking.scaler_scale",
        "ranking.coefficients",
        "ranking.intercept",
    }
