import { CacachePresentationDiskCache } from "../../src/platform/cache/CacachePresentationDiskCache.js"

const root = process.env.NEOVIEW_CACHE_TEST_ROOT
if (!root) throw new Error("NEOVIEW_CACHE_TEST_ROOT is required")

const cache = new CacachePresentationDiskCache({
  root,
  maxBytes: 64,
  maxEntryBytes: 32,
  minFreeBytes: 0,
  minimumRetentionMs: 0,
})
try {
  process.stdout.write(JSON.stringify(await cache.clear()))
} finally {
  await cache.close()
}
