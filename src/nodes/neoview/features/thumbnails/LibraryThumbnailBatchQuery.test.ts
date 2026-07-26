import { describe, expect, it, vi } from "vitest"

import { waitForLibraryThumbnailBatch } from "./LibraryThumbnailBatchQuery"

describe("waitForLibraryThumbnailBatch", () => {
  it("deduplicates one visible batch and retries deferred assets before publishing it", async () => {
    const attempts = new Map<string, number>()
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const attempt = (attempts.get(url) ?? 0) + 1
      attempts.set(url, attempt)
      return attempt === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "0" } })
        : new Response(null, { status: 200 })
    })
    const batch = {
      contextId: "folder:browser-1:1",
      generation: 1,
      items: [
        { id: "0", thumbnailUrl: "http://127.0.0.1:41000/reader/library/t/a?version=1", contentVersion: "1" },
        { id: "1", thumbnailUrl: "http://127.0.0.1:41000/reader/library/t/b?version=1", contentVersion: "1" },
      ],
    }

    await Promise.all([
      waitForLibraryThumbnailBatch(batch, undefined, request),
      waitForLibraryThumbnailBatch(batch, undefined, request),
    ])

    expect(request).toHaveBeenCalledTimes(4)
    expect([...attempts.values()]).toEqual([2, 2])
    expect(request.mock.calls.every(([, init]) => init?.method === "HEAD")).toBe(true)
  })

  it("does not probe unmanaged URLs used by local or embedded thumbnail surfaces", async () => {
    const request = vi.fn()
    await waitForLibraryThumbnailBatch({
      contextId: "folder:browser-1:1",
      generation: 1,
      items: [{ id: "0", thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", contentVersion: "1" }],
    }, undefined, request)
    expect(request).not.toHaveBeenCalled()
  })
})
