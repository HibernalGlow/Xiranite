from __future__ import annotations

import numpy as np

from xiranite_clipm.perceptual_recovery import ordered_page_consensus


def _page(index: int) -> np.ndarray:
    value = np.zeros(768, dtype=np.float32)
    value[index] = 1
    return value


def test_ordered_page_consensus_requires_three_pages_and_preserves_order() -> None:
    query = np.stack([_page(0), _page(1), _page(2), _page(3)])
    same_order = np.stack([_page(0), _page(1), _page(2), _page(3)])
    reversed_order = np.stack([_page(3), _page(2), _page(1), _page(0)])

    same = ordered_page_consensus(query, same_order)
    reversed_result = ordered_page_consensus(query, reversed_order)

    assert same is not None
    assert same.mean_similarity == 1
    assert same.matched_page_count == 4
    assert reversed_result is not None
    assert reversed_result.mean_similarity < same.mean_similarity
    assert ordered_page_consensus(query[:2], same_order[:2]) is None


def test_ordered_page_consensus_rejects_invalid_page_embeddings() -> None:
    with np.testing.assert_raises_regex(ValueError, "shape"):
        ordered_page_consensus(np.ones((4, 32)), np.ones((4, 32)))
    invalid = np.stack([_page(0), _page(1), _page(2)])
    invalid[1] = 0
    with np.testing.assert_raises_regex(ValueError, "non-zero"):
        ordered_page_consensus(invalid, np.stack([_page(0), _page(1), _page(2)]))
