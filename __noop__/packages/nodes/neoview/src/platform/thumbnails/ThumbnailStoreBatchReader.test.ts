import { describe, expect, it, vi } from "vitest"

import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import { readThumbnailStoreBatch } from "./ThumbnailStoreBatchReader.js"

describe("readThumbnailStoreBatch", () => {
  it("[neoview.thumbnail.database-read-cooperative] chunks large reads through the host I/O pool and yields", async () => {
    const batches: string[][] = []
    const store: ReaderThumbnailStore = {
      get: async () => undefined,
      getMany: async (keys) => {
        batches.push([...keys])
        return new Map(keys.map((key) => [key, { bytes: Uint8Array.of(Number(key.slice(1)) & 0xff) }]))
      },
    }
    const requests: unknown[] = []
    const releases: Array<ReturnType<typeof vi.fn>> = []
    const yieldBetweenChunks = vi.fn(async () => undefined)
    const result = await readThumbnailStoreBatch(
      store,
      [...Array.from({ length: 130 }, (_, index) => `k${index}`), "k0"],
      "file",
      {
        chunkSize: 64,
        priority: "background",
        resourceScheduler: {
          acquire: async (request) => {
            requests.push(request)
            const release = vi.fn()
            releases.push(release)
            return { release }
          },
        },
        yieldBetweenChunks,
      },
    )
    expect(batches.map((batch) => batch.length)).toEqual([64, 64, 2])
    expect(requests).toEqual(Array.from({ length: 3 }, () => ({
      resource: "io",
      kind: "neoview.thumbnail.database-read",
      priority: "background",
    })))
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true)
    expect(yieldBetweenChunks).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(130)
  })

  it("[neoview.thumbnail.database-read-cancellation] stops before the next chunk after cancellation", async () => {
    const controller = new AbortController()
    const getMany = vi.fn(async (keys: readonly string[]) => new Map(keys.map((key) => [key, { bytes: Uint8Array.of(1) }])))
    const store: ReaderThumbnailStore = { get: async () => undefined, getMany }
    await expect(readThumbnailStoreBatch(store, ["a", "b", "c"], "file", {
      chunkSize: 2,
      signal: controller.signal,
      yieldBetweenChunks: async () => controller.abort(new DOMException("superseded", "AbortError")),
    })).rejects.toMatchObject({ name: "AbortError" })
    expect(getMany).toHaveBeenCalledOnce()
  })
})
