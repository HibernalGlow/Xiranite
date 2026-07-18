import { scheduler as timersScheduler } from "node:timers/promises"

import type {
  ReaderThumbnailAsset,
  ReaderThumbnailCategory,
  ReaderThumbnailStore,
} from "../../ports/ReaderThumbnailStore.js"
import type { ResourcePriority, ResourceScheduler } from "../../ports/ResourceScheduler.js"

const DEFAULT_CHUNK_SIZE = 64
const MAX_BATCH_SIZE = 512

export interface ThumbnailStoreBatchReadOptions {
  chunkSize?: number
  priority?: ResourcePriority
  resourceScheduler?: ResourceScheduler
  signal?: AbortSignal
  yieldBetweenChunks?: () => Promise<void>
}

export async function readThumbnailStoreBatch(
  store: ReaderThumbnailStore,
  keys: readonly string[],
  category: ReaderThumbnailCategory,
  options: ThumbnailStoreBatchReadOptions = {},
): Promise<ReadonlyMap<string, ReaderThumbnailAsset>> {
  if (!store.getMany || !keys.length) return new Map()
  if (keys.length > MAX_BATCH_SIZE) throw new RangeError(`Thumbnail store batch cannot exceed ${MAX_BATCH_SIZE} keys.`)
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_BATCH_SIZE) {
    throw new RangeError(`Thumbnail store chunkSize must be an integer from 1 to ${MAX_BATCH_SIZE}.`)
  }
  const unique = [...new Set(keys)]
  const output = new Map<string, ReaderThumbnailAsset>()
  const yieldBetweenChunks = options.yieldBetweenChunks ?? (() => timersScheduler.yield())
  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    options.signal?.throwIfAborted()
    const chunk = unique.slice(offset, offset + chunkSize)
    const lease = await options.resourceScheduler?.acquire({
      resource: "io",
      kind: "neoview.thumbnail.database-read",
      priority: options.priority ?? "view",
    }, options.signal)
    try {
      const records = await store.getMany(chunk, category)
      for (const [key, record] of records) output.set(key, record)
    } finally {
      lease?.release()
    }
    if (offset + chunkSize < unique.length) await yieldBetweenChunks()
  }
  options.signal?.throwIfAborted()
  return output
}
