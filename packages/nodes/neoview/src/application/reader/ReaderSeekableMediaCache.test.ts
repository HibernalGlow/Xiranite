import { describe, expect, it, vi } from "vitest"

import type { ReaderPage } from "../../domain/page/page.js"
import type { ReaderPageMaterializationLease, ReaderPageMaterializer } from "../../ports/ReaderPageMaterializer.js"
import { ReaderSeekableMediaCache } from "./ReaderSeekableMediaCache.js"

describe("ReaderSeekableMediaCache", () => {
  it("[neoview.media.archive-singleflight] shares one materialization until the Reader session closes", async () => {
    const release = vi.fn(async () => undefined)
    const materialize = vi.fn(async (): Promise<ReaderPageMaterializationLease> => ({
      path: "C:/temp/clip.mp4",
      byteLength: 32,
      release,
      [Symbol.asyncDispose]: release,
    }))
    const cache = new ReaderSeekableMediaCache({ materialize })
    const [first, second] = await Promise.all([
      cache.acquire("session-1", archiveVideo()),
      cache.acquire("session-1", archiveVideo()),
    ])

    expect(materialize).toHaveBeenCalledOnce()
    expect(cache.snapshot()).toEqual({ entries: 1, reservedBytes: 32, activeReferences: 2, pending: 0 })
    await first.release()
    await second.release()
    expect(release).not.toHaveBeenCalled()

    await cache.releaseSession("session-1")
    expect(release).toHaveBeenCalledOnce()
    expect(cache.snapshot()).toEqual({ entries: 0, reservedBytes: 0, activeReferences: 0, pending: 0 })
    await cache.close()
  })

  it("[neoview.media.archive-cancellation] aborts materialization only after every waiter leaves", async () => {
    let materializerSignal: AbortSignal | undefined
    const materializer: ReaderPageMaterializer = {
      materialize(_page, options) {
        materializerSignal = options?.signal
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })
        })
      },
    }
    const cache = new ReaderSeekableMediaCache(materializer)
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = cache.acquire("session-1", archiveVideo(), firstController.signal)
    const second = cache.acquire("session-1", archiveVideo(), secondController.signal)

    firstController.abort(new DOMException("first left", "AbortError"))
    await expect(first).rejects.toMatchObject({ name: "AbortError" })
    expect(materializerSignal?.aborted).toBe(false)

    secondController.abort(new DOMException("second left", "AbortError"))
    await expect(second).rejects.toMatchObject({ name: "AbortError" })
    await vi.waitFor(() => expect(materializerSignal?.aborted).toBe(true))
    await vi.waitFor(() => expect(cache.snapshot()).toEqual({ entries: 0, reservedBytes: 0, activeReferences: 0, pending: 0 }))
    await cache.close()
  })

  it("[neoview.media.archive-frame-retention] releases an inactive page but revives an active lease when the frame returns", async () => {
    const releases: Array<ReturnType<typeof vi.fn>> = []
    const cache = new ReaderSeekableMediaCache({
      async materialize(page) {
        const release = vi.fn(async () => undefined)
        releases.push(release)
        return {
          path: `C:/temp/${page.id}.mp4`,
          byteLength: page.byteLength!,
          release,
          [Symbol.asyncDispose]: release,
        }
      },
    })
    const first = await cache.acquire("session-1", archiveVideo())
    await cache.retainSessionPages("session-1", new Set())
    expect(releases[0]).not.toHaveBeenCalled()
    await cache.retainSessionPages("session-1", new Set(["page-video"]))
    await first.release()
    expect(releases[0]).not.toHaveBeenCalled()

    const second = await cache.acquire("session-1", archiveVideo())
    await second.release()
    await cache.retainSessionPages("session-1", new Set())
    expect(releases[0]).toHaveBeenCalledOnce()
    expect(cache.snapshot()).toMatchObject({ entries: 0, reservedBytes: 0 })
    await cache.close()
  })

  it("[neoview.media.archive-close-retention] does not revive a release-requested page after close", async () => {
    const release = vi.fn(async () => undefined)
    const cache = new ReaderSeekableMediaCache({
      async materialize(): Promise<ReaderPageMaterializationLease> {
        return {
          path: "C:/temp/clip.mp4",
          byteLength: 32,
          release,
          [Symbol.asyncDispose]: release,
        }
      },
    })
    const lease = await cache.acquire("session-1", archiveVideo())

    await cache.close()
    await cache.retainSessionPages("session-1", new Set(["page-video"]))
    await lease.release()

    expect(release).toHaveBeenCalledOnce()
    expect(cache.snapshot()).toEqual({ entries: 0, reservedBytes: 0, activeReferences: 0, pending: 0 })
  })

  it("[neoview.media.archive-release-retry] retains the record and retries failed lease cleanup", async () => {
    const cleanupError = new Error("temporary cleanup failure")
    const release = vi.fn()
      .mockRejectedValueOnce(cleanupError)
      .mockResolvedValueOnce(undefined)
    const cache = new ReaderSeekableMediaCache({
      async materialize(): Promise<ReaderPageMaterializationLease> {
        return {
          path: "C:/temp/clip.mp4",
          byteLength: 32,
          release,
          [Symbol.asyncDispose]: release,
        }
      },
    })
    const lease = await cache.acquire("session-1", archiveVideo())
    await lease.release()

    await expect(cache.close()).rejects.toBe(cleanupError)
    expect(cache.snapshot()).toEqual({ entries: 1, reservedBytes: 32, activeReferences: 0, pending: 0 })

    await expect(cache.close()).resolves.toBeUndefined()
    expect(release).toHaveBeenCalledTimes(2)
    expect(cache.snapshot()).toEqual({ entries: 0, reservedBytes: 0, activeReferences: 0, pending: 0 })
  })
})

function archiveVideo(): ReaderPage {
  return {
    id: "page-video",
    index: 0,
    name: "clip.mp4",
    sourcePath: "C:/book.cbz",
    entryPath: "media/clip.mp4",
    mediaKind: "video",
    mimeType: "video/mp4",
    byteLength: 32,
    contentVersion: "v1",
    content: { async load() { throw new Error("not used") } },
  }
}
