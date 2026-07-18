export interface SparsePageBatch<T> {
  cursor: number
  pages: readonly T[]
}

export interface SparsePageCatalog<T> {
  total: number
  maxBatches: number
  batches: ReadonlyMap<number, SparsePageBatch<T>>
  accessOrder: readonly number[]
}

export function createSparsePageCatalog<T>(total: number, maxBatches = 8): SparsePageCatalog<T> {
  return {
    total: Math.max(0, total),
    maxBatches: Math.max(1, maxBatches),
    batches: new Map(),
    accessOrder: [],
  }
}

export function mergeSparsePageBatch<T>(
  catalog: SparsePageCatalog<T>,
  cursor: number,
  pages: readonly T[],
  total: number,
  protectedPositions: readonly number[] = [],
): SparsePageCatalog<T> {
  const normalizedCursor = Math.max(0, cursor)
  const batches = new Map(catalog.batches)
  batches.set(normalizedCursor, { cursor: normalizedCursor, pages: [...pages] })
  const accessOrder = [...catalog.accessOrder.filter((value) => value !== normalizedCursor), normalizedCursor]
  const protectedSet = new Set(protectedPositions.filter((position) => position >= 0))

  while (accessOrder.length > catalog.maxBatches) {
    const removableIndex = accessOrder.findIndex((batchCursor) => {
      if (batchCursor === normalizedCursor) return false
      const batch = batches.get(batchCursor)
      return !batch || ![...protectedSet].some((position) => batchContains(batch, position))
    })
    const evictionIndex = removableIndex >= 0 ? removableIndex : 0
    const [evictedCursor] = accessOrder.splice(evictionIndex, 1)
    if (evictedCursor !== undefined) batches.delete(evictedCursor)
  }

  return {
    total: Math.max(0, total),
    maxBatches: catalog.maxBatches,
    batches,
    accessOrder,
  }
}

export function mergeSparsePagePositions<T>(
  catalog: SparsePageCatalog<T>,
  entries: readonly { position: number; page: T }[],
  total: number,
  protectedPositions: readonly number[] = [],
): SparsePageCatalog<T> {
  let next = catalog
  for (const entry of entries) {
    const containingCursor = [...next.accessOrder].reverse().find((cursor) => {
      const batch = next.batches.get(cursor)
      return batch ? batchContains(batch, entry.position) : false
    })
    if (containingCursor === undefined) {
      next = mergeSparsePageBatch(next, entry.position, [entry.page], total, protectedPositions)
      continue
    }
    const batch = next.batches.get(containingCursor)!
    const pages = [...batch.pages]
    pages[entry.position - containingCursor] = entry.page
    const batches = new Map(next.batches)
    batches.set(containingCursor, { cursor: containingCursor, pages })
    next = { ...next, total: Math.max(0, total), batches }
  }
  return next
}

export function sparsePageAt<T>(catalog: SparsePageCatalog<T>, position: number): T | undefined {
  for (let orderIndex = catalog.accessOrder.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const cursor = catalog.accessOrder[orderIndex]!
    const batch = catalog.batches.get(cursor)
    if (batch && batchContains(batch, position)) return batch.pages[position - cursor]
  }
  return undefined
}

export function sparsePageMap<T>(catalog: SparsePageCatalog<T>): ReadonlyMap<number, T> {
  const pages = new Map<number, T>()
  for (const cursor of catalog.accessOrder) {
    const batch = catalog.batches.get(cursor)
    if (!batch) continue
    for (let offset = 0; offset < batch.pages.length; offset += 1) {
      const page = batch.pages[offset]
      if (page !== undefined) pages.set(cursor + offset, page)
    }
  }
  return pages
}

export function sparseBatchLoaded<T>(catalog: SparsePageCatalog<T>, cursor: number, limit: number): boolean {
  const batch = catalog.batches.get(cursor)
  if (!batch) return false
  const expected = Math.min(Math.max(0, limit), Math.max(0, catalog.total - cursor))
  return batch.pages.length >= expected
}

export function sparseRetainedPageCount<T>(catalog: SparsePageCatalog<T>): number {
  let count = 0
  for (const batch of catalog.batches.values()) count += batch.pages.length
  return count
}

function batchContains<T>(batch: SparsePageBatch<T>, position: number): boolean {
  return position >= batch.cursor && position < batch.cursor + batch.pages.length
}
