from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Mapping

import numpy as np
from scipy.stats import spearmanr
from sklearn.linear_model import LogisticRegression, RidgeCV
from sklearn.metrics import (
    average_precision_score,
    balanced_accuracy_score,
    log_loss,
    mean_absolute_error,
    roc_auc_score,
)
from sklearn.model_selection import GroupKFold, StratifiedGroupKFold
from sklearn.preprocessing import StandardScaler

from .training_dataset import ClassificationTrainingData, RankingTrainingData


CLASSIFICATION_REGULARIZATION_C = 0.01
RANKING_MINIMUM_CORRECTIONS = 20
RANKING_ALPHAS = (0.01, 0.1, 1.0, 10.0, 100.0, 1000.0)
MAX_OOF_SPLITS = 5


class HeadTrainingStatus(StrEnum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    SKIPPED = "skipped"


@dataclass(frozen=True, slots=True)
class ClassificationHeadParameters:
    scaler_mean: np.ndarray
    scaler_scale: np.ndarray
    coefficients: np.ndarray
    intercept: float
    threshold: float

    def __post_init__(self) -> None:
        mean = _finite_vector(self.scaler_mean, "classification scaler_mean")
        scale = _finite_vector(self.scaler_scale, "classification scaler_scale")
        coefficients = _finite_vector(self.coefficients, "classification coefficients")
        if mean.size == 0 or scale.shape != mean.shape or coefficients.shape != mean.shape:
            raise ValueError("classification head vectors must have one shared non-zero dimension")
        if np.any(scale <= 0):
            raise ValueError("classification scaler_scale must be positive")
        if not np.isfinite(self.intercept):
            raise ValueError("classification intercept must be finite")
        if not np.isfinite(self.threshold) or not 0.0 < self.threshold < 1.0:
            raise ValueError("classification threshold must be between zero and one")

    def predict_probabilities(self, features: np.ndarray) -> np.ndarray:
        matrix = _feature_matrix(features, self.scaler_mean.size, "classification features")
        logits = ((matrix - self.scaler_mean) / self.scaler_scale) @ self.coefficients + self.intercept
        probabilities = np.empty_like(logits, dtype=np.float64)
        positive = logits >= 0
        probabilities[positive] = 1.0 / (1.0 + np.exp(-logits[positive]))
        exponential = np.exp(logits[~positive])
        probabilities[~positive] = exponential / (1.0 + exponential)
        return probabilities

    def tensors(self) -> Mapping[str, np.ndarray]:
        return {
            "classification.scaler_mean": np.ascontiguousarray(self.scaler_mean, dtype=np.float32),
            "classification.scaler_scale": np.ascontiguousarray(self.scaler_scale, dtype=np.float32),
            "classification.coefficients": np.ascontiguousarray(self.coefficients, dtype=np.float32),
            "classification.intercept": np.asarray([self.intercept], dtype=np.float32),
        }


@dataclass(frozen=True, slots=True)
class ClassificationCandidateMetrics:
    correction_samples: int
    oof_splits: int
    active_correction_log_loss: float
    candidate_correction_log_loss: float
    active_validation_balanced_accuracy: float
    candidate_validation_balanced_accuracy: float
    active_validation_roc_auc: float
    candidate_validation_roc_auc: float
    active_validation_macro_average_precision: float
    candidate_validation_macro_average_precision: float


@dataclass(frozen=True, slots=True)
class ClassificationTrainingResult:
    status: HeadTrainingStatus
    reasons: tuple[str, ...]
    parameters: ClassificationHeadParameters | None
    metrics: ClassificationCandidateMetrics | None


@dataclass(frozen=True, slots=True)
class RankingHeadParameters:
    scaler_mean: np.ndarray
    scaler_scale: np.ndarray
    coefficients: np.ndarray
    intercept: float
    alpha: float

    def __post_init__(self) -> None:
        mean = _finite_vector(self.scaler_mean, "ranking scaler_mean")
        scale = _finite_vector(self.scaler_scale, "ranking scaler_scale")
        coefficients = _finite_vector(self.coefficients, "ranking coefficients")
        if mean.size == 0 or scale.shape != mean.shape or coefficients.shape != mean.shape:
            raise ValueError("ranking head vectors must have one shared non-zero dimension")
        if np.any(scale <= 0):
            raise ValueError("ranking scaler_scale must be positive")
        if not np.isfinite(self.intercept):
            raise ValueError("ranking intercept must be finite")
        if not np.isfinite(self.alpha) or self.alpha <= 0:
            raise ValueError("ranking alpha must be positive")

    def predict_residuals(self, features: np.ndarray) -> np.ndarray:
        matrix = _feature_matrix(features, self.scaler_mean.size, "ranking features")
        return ((matrix - self.scaler_mean) / self.scaler_scale) @ self.coefficients + self.intercept

    def tensors(self) -> Mapping[str, np.ndarray]:
        return {
            "ranking.scaler_mean": np.ascontiguousarray(self.scaler_mean, dtype=np.float32),
            "ranking.scaler_scale": np.ascontiguousarray(self.scaler_scale, dtype=np.float32),
            "ranking.coefficients": np.ascontiguousarray(self.coefficients, dtype=np.float32),
            "ranking.intercept": np.asarray([self.intercept], dtype=np.float32),
        }


@dataclass(frozen=True, slots=True)
class RankingCandidateMetrics:
    correction_samples: int
    oof_splits: int
    baseline_weighted_mae: float
    candidate_weighted_mae: float
    baseline_spearman: float
    candidate_spearman: float
    selected_alpha: float


@dataclass(frozen=True, slots=True)
class RankingTrainingResult:
    status: HeadTrainingStatus
    reasons: tuple[str, ...]
    parameters: RankingHeadParameters | None
    metrics: RankingCandidateMetrics | None


def train_classification_candidate(
    data: ClassificationTrainingData,
    correction_count: int,
    active: ClassificationHeadParameters,
    *,
    random_state: int = 0,
) -> ClassificationTrainingResult:
    features, labels, weights, groups = _validated_classification_data(data)
    if correction_count < 0 or correction_count > labels.size:
        raise ValueError("classification correction_count is outside the dataset")
    if correction_count == 0:
        return ClassificationTrainingResult(
            status=HeadTrainingStatus.SKIPPED,
            reasons=("classification_no_corrections",),
            parameters=None,
            metrics=None,
        )

    split_count = _classification_split_count(labels, groups)
    splitter = StratifiedGroupKFold(n_splits=split_count, shuffle=True, random_state=random_state)
    oof_probabilities = np.empty(labels.size, dtype=np.float64)
    for train_indices, test_indices in splitter.split(features, labels, groups):
        scaler, classifier = _fit_classifier(
            features[train_indices],
            labels[train_indices],
            weights[train_indices],
        )
        oof_probabilities[test_indices] = classifier.predict_proba(scaler.transform(features[test_indices]))[:, 1]

    correction = slice(labels.size - correction_count, labels.size)
    active_correction_probabilities = active.predict_probabilities(features[correction])
    active_correction_loss = _weighted_binary_log_loss(
        labels[correction], active_correction_probabilities, weights[correction]
    )
    candidate_correction_loss = _weighted_binary_log_loss(
        labels[correction], oof_probabilities[correction], weights[correction]
    )

    scaler, classifier = _fit_classifier(features, labels, weights)
    parameters = ClassificationHeadParameters(
        scaler_mean=np.asarray(scaler.mean_, dtype=np.float64),
        scaler_scale=np.asarray(scaler.scale_, dtype=np.float64),
        coefficients=np.asarray(classifier.coef_[0], dtype=np.float64),
        intercept=float(classifier.intercept_[0]),
        threshold=active.threshold,
    )
    validation_features = _feature_matrix(
        data.validation_features,
        features.shape[1],
        "classification validation_features",
    )
    validation_labels = _binary_labels(data.validation_labels, "classification validation_labels")
    if validation_labels.size != validation_features.shape[0] or np.unique(validation_labels).size != 2:
        raise ValueError("classification validation data must contain aligned samples from both classes")
    active_validation_probabilities = active.predict_probabilities(validation_features)
    candidate_validation_probabilities = parameters.predict_probabilities(validation_features)
    active_validation = _classification_validation_metrics(
        validation_labels,
        active_validation_probabilities,
        active.threshold,
    )
    candidate_validation = _classification_validation_metrics(
        validation_labels,
        candidate_validation_probabilities,
        active.threshold,
    )
    metrics = ClassificationCandidateMetrics(
        correction_samples=correction_count,
        oof_splits=split_count,
        active_correction_log_loss=active_correction_loss,
        candidate_correction_log_loss=candidate_correction_loss,
        active_validation_balanced_accuracy=active_validation[0],
        candidate_validation_balanced_accuracy=candidate_validation[0],
        active_validation_roc_auc=active_validation[1],
        candidate_validation_roc_auc=candidate_validation[1],
        active_validation_macro_average_precision=active_validation[2],
        candidate_validation_macro_average_precision=candidate_validation[2],
    )

    failures: list[str] = []
    if candidate_correction_loss >= active_correction_loss:
        failures.append("classification_correction_log_loss_not_improved")
    if candidate_validation[0] < active_validation[0] - 0.03:
        failures.append("classification_validation_balanced_accuracy_drop_exceeded")
    if candidate_validation[1] < active_validation[1] - 0.02:
        failures.append("classification_validation_roc_auc_drop_exceeded")
    if failures:
        return ClassificationTrainingResult(
            status=HeadTrainingStatus.REJECTED,
            reasons=tuple(failures),
            parameters=parameters,
            metrics=metrics,
        )
    return ClassificationTrainingResult(
        status=HeadTrainingStatus.ACCEPTED,
        reasons=(
            "classification_correction_log_loss_improved",
            "classification_fixed_validation_within_gates",
        ),
        parameters=parameters,
        metrics=metrics,
    )


def train_ranking_candidate(data: RankingTrainingData) -> RankingTrainingResult:
    features, residuals, weights, groups, baseline_scores, target_scores = _validated_ranking_data(data)
    if residuals.size < RANKING_MINIMUM_CORRECTIONS:
        return RankingTrainingResult(
            status=HeadTrainingStatus.SKIPPED,
            reasons=("ranking_requires_20_numeric_corrections",),
            parameters=None,
            metrics=None,
        )

    split_count = min(MAX_OOF_SPLITS, np.unique(groups).size)
    if split_count < 2:
        raise ValueError("ranking grouped OOF requires at least two distinct groups")
    splitter = GroupKFold(n_splits=split_count)
    oof_residuals = np.empty(residuals.size, dtype=np.float64)
    for train_indices, test_indices in splitter.split(features, residuals, groups):
        scaler, regressor = _fit_ranker(
            features[train_indices],
            residuals[train_indices],
            weights[train_indices],
        )
        oof_residuals[test_indices] = regressor.predict(scaler.transform(features[test_indices]))

    baseline_final_scores = np.clip(baseline_scores, 0.0, 1000.0)
    candidate_final_scores = np.clip(baseline_scores + oof_residuals, 0.0, 1000.0)
    baseline_mae = float(mean_absolute_error(target_scores, baseline_final_scores, sample_weight=weights))
    candidate_mae = float(mean_absolute_error(target_scores, candidate_final_scores, sample_weight=weights))
    baseline_correlation = _spearman(baseline_final_scores, target_scores)
    candidate_correlation = _spearman(candidate_final_scores, target_scores)

    scaler, regressor = _fit_ranker(features, residuals, weights)
    parameters = RankingHeadParameters(
        scaler_mean=np.asarray(scaler.mean_, dtype=np.float64),
        scaler_scale=np.asarray(scaler.scale_, dtype=np.float64),
        coefficients=np.asarray(regressor.coef_, dtype=np.float64),
        intercept=float(regressor.intercept_),
        alpha=float(regressor.alpha_),
    )
    metrics = RankingCandidateMetrics(
        correction_samples=residuals.size,
        oof_splits=split_count,
        baseline_weighted_mae=baseline_mae,
        candidate_weighted_mae=candidate_mae,
        baseline_spearman=baseline_correlation,
        candidate_spearman=candidate_correlation,
        selected_alpha=float(regressor.alpha_),
    )
    failures: list[str] = []
    if candidate_mae >= baseline_mae:
        failures.append("ranking_weighted_mae_not_improved")
    if candidate_correlation < baseline_correlation:
        failures.append("ranking_spearman_declined")
    if failures:
        return RankingTrainingResult(
            status=HeadTrainingStatus.REJECTED,
            reasons=tuple(failures),
            parameters=parameters,
            metrics=metrics,
        )
    return RankingTrainingResult(
        status=HeadTrainingStatus.ACCEPTED,
        reasons=("ranking_weighted_mae_improved", "ranking_spearman_preserved"),
        parameters=parameters,
        metrics=metrics,
    )


def _fit_classifier(
    features: np.ndarray,
    labels: np.ndarray,
    weights: np.ndarray,
) -> tuple[StandardScaler, LogisticRegression]:
    scaler = StandardScaler().fit(features, sample_weight=weights)
    classifier = LogisticRegression(
        C=CLASSIFICATION_REGULARIZATION_C,
        class_weight="balanced",
        max_iter=2000,
        solver="lbfgs",
    ).fit(scaler.transform(features), labels, sample_weight=weights)
    return scaler, classifier


def _fit_ranker(
    features: np.ndarray,
    residuals: np.ndarray,
    weights: np.ndarray,
) -> tuple[StandardScaler, RidgeCV]:
    scaler = StandardScaler().fit(features, sample_weight=weights)
    regressor = RidgeCV(alphas=RANKING_ALPHAS, scoring="neg_mean_absolute_error").fit(
        scaler.transform(features),
        residuals,
        sample_weight=weights,
    )
    return scaler, regressor


def _validated_classification_data(
    data: ClassificationTrainingData,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    features = _feature_matrix(data.features, None, "classification features")
    labels = _binary_labels(data.labels, "classification labels")
    weights = _sample_weights(data.sample_weights, labels.size, "classification sample_weights")
    groups = _groups(data.groups, labels.size, "classification groups")
    if features.shape[0] != labels.size or np.unique(labels).size != 2:
        raise ValueError("classification training data must contain aligned samples from both classes")
    active_dimension = data.validation_features.shape[1] if data.validation_features.ndim == 2 else -1
    if active_dimension != features.shape[1]:
        raise ValueError("classification training and validation feature dimensions differ")
    return features, labels, weights, groups


def _validated_ranking_data(
    data: RankingTrainingData,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    features = _feature_matrix(data.features, None, "ranking features")
    residuals = _finite_vector(data.residuals, "ranking residuals")
    weights = _sample_weights(data.sample_weights, residuals.size, "ranking sample_weights")
    groups = _groups(data.groups, residuals.size, "ranking groups")
    baseline_scores = _finite_vector(data.baseline_scores, "ranking baseline_scores")
    target_scores = _finite_vector(data.target_scores, "ranking target_scores")
    expected = residuals.size
    if features.shape[0] != expected or baseline_scores.size != expected or target_scores.size != expected:
        raise ValueError("ranking training arrays must have the same sample count")
    if not np.allclose(target_scores - baseline_scores, residuals):
        raise ValueError("ranking residuals must equal target_scores - baseline_scores")
    return features, residuals, weights, groups, baseline_scores, target_scores


def _classification_split_count(labels: np.ndarray, groups: np.ndarray) -> int:
    groups_per_class = [np.unique(groups[labels == label]).size for label in (0, 1)]
    split_count = min(MAX_OOF_SPLITS, *groups_per_class)
    if split_count < 2:
        raise ValueError("classification grouped OOF requires at least two groups in each class")
    return split_count


def _classification_validation_metrics(
    labels: np.ndarray,
    probabilities: np.ndarray,
    threshold: float,
) -> tuple[float, float, float]:
    predictions = (probabilities >= threshold).astype(np.int8)
    positive_ap = average_precision_score(labels, probabilities)
    negative_ap = average_precision_score(1 - labels, 1.0 - probabilities)
    return (
        float(balanced_accuracy_score(labels, predictions)),
        float(roc_auc_score(labels, probabilities)),
        float((positive_ap + negative_ap) / 2.0),
    )


def _weighted_binary_log_loss(labels: np.ndarray, probabilities: np.ndarray, weights: np.ndarray) -> float:
    return float(log_loss(labels, probabilities, sample_weight=weights, labels=[0, 1]))


def _spearman(predicted: np.ndarray, target: np.ndarray) -> float:
    if np.unique(predicted).size < 2 or np.unique(target).size < 2:
        return 0.0
    correlation = float(spearmanr(predicted, target).statistic)
    return correlation if np.isfinite(correlation) else 0.0


def _feature_matrix(value: np.ndarray, dimension: int | None, name: str) -> np.ndarray:
    matrix = np.asarray(value, dtype=np.float64)
    if matrix.ndim != 2 or matrix.shape[0] == 0 or matrix.shape[1] == 0 or not np.all(np.isfinite(matrix)):
        raise ValueError(f"{name} must be a non-empty finite matrix")
    if dimension is not None and matrix.shape[1] != dimension:
        raise ValueError(f"{name} must have {dimension} columns")
    return matrix


def _binary_labels(value: np.ndarray, name: str) -> np.ndarray:
    labels = np.asarray(value, dtype=np.int8)
    if labels.ndim != 1 or not np.all(np.isin(labels, (0, 1))):
        raise ValueError(f"{name} must be a one-dimensional binary vector")
    return labels


def _sample_weights(value: np.ndarray, size: int, name: str) -> np.ndarray:
    weights = _finite_vector(value, name)
    if weights.size != size or np.any(weights <= 0):
        raise ValueError(f"{name} must contain one positive value per sample")
    return weights


def _groups(value: np.ndarray, size: int, name: str) -> np.ndarray:
    groups = np.asarray(value).astype(str)
    if groups.ndim != 1 or groups.size != size or np.any(groups == ""):
        raise ValueError(f"{name} must contain one non-empty value per sample")
    return groups


def _finite_vector(value: np.ndarray, name: str) -> np.ndarray:
    vector = np.asarray(value, dtype=np.float64)
    if vector.ndim != 1 or not np.all(np.isfinite(vector)):
        raise ValueError(f"{name} must be a one-dimensional finite vector")
    return vector
