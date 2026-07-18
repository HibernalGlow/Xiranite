import { describe, expect, it } from "vitest"

import {
  createSparsePageCatalog,
  mergeSparsePageBatch,
  mergeSparsePagePositions,
  sparseBatchLoaded,
  sparsePageAt,
  sparsePageMap,
  sparseRetainedPageCount,
} from "./SparsePageCatalog"

describe("SparsePageCatalog", () => {
  it("[neoview.page-list.sparse-100k] keeps a 100K catalog bounded by retained batches", () => {
    let catalog = createSparsePageCatalog<number>(100_000, 8)
    for (let cursor = 0; cursor < 100_000; cursor += 64) {
      catalog = mergeSparsePageBatch(catalog, cursor, Array.from({ length: Math.min(64, 100_000 - cursor) }, (_, offset) => cursor + offset), 100_000)
    }

    expect(catalog.batches.size).toBe(8)
    expect(sparseRetainedPageCount(catalog)).toBeLessThanOrEqual(8 * 64)
    expect(sparsePageAt(catalog, 99_999)).toBe(99_999)
    expect(sparsePageAt(catalog, 0)).toBeUndefined()
  })

  it("[neoview.page-list.sparse-protected] retains active, preview and focused batches while evicting old windows", () => {
    let catalog = createSparsePageCatalog<number>(1_000, 3)
    catalog = mergeSparsePageBatch(catalog, 0, [0, 1], 1_000)
    catalog = mergeSparsePageBatch(catalog, 64, [64, 65], 1_000)
    catalog = mergeSparsePageBatch(catalog, 128, [128, 129], 1_000)
    catalog = mergeSparsePageBatch(catalog, 192, [192, 193], 1_000, [64, 128])

    expect([...catalog.batches.keys()]).toEqual([64, 128, 192])
    expect(sparsePageAt(catalog, 64)).toBe(64)
    expect(sparsePageAt(catalog, 128)).toBe(128)
  })

  it("[neoview.page-list.ordering] maps result positions without rewriting original page identity", () => {
    const pages = [{ index: 40 }, { index: 7 }, { index: 99 }]
    const catalog = mergeSparsePageBatch(createSparsePageCatalog(3), 0, pages, 3)

    expect([...sparsePageMap(catalog)].map(([position, page]) => [position, page.index])).toEqual([
      [0, 40],
      [1, 7],
      [2, 99],
    ])
    expect(sparseBatchLoaded(catalog, 0, 64)).toBe(true)
  })

  it("[neoview.page-list.visible-overlay] updates a visible page without truncating its retained batch", () => {
    const loaded = mergeSparsePageBatch(createSparsePageCatalog<number>(100), 0, Array.from({ length: 64 }, (_, index) => index), 100)
    const updated = mergeSparsePagePositions(loaded, [{ position: 0, page: 999 }], 100, [0])

    expect(sparsePageAt(updated, 0)).toBe(999)
    expect(sparsePageAt(updated, 63)).toBe(63)
    expect(sparseRetainedPageCount(updated)).toBe(64)
  })
})
