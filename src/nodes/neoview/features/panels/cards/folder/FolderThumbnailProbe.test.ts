import { describe, expect, it, vi } from "vitest"

import {
  FolderThumbnailProbeError,
  folderThumbnailProbeRetryDelay,
  probeFolderThumbnailUrls,
  retryFolderThumbnailProbe,
} from "./FolderThumbnailProbe"

const URL = "http://127.0.0.1:41000/reader/library/t/first?token=test"

describe("FolderThumbnailProbe", () => {
  it("returns all URLs after successful HEAD responses", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }))

    await expect(probeFolderThumbnailUrls([URL], new AbortController().signal, fetch)).resolves.toEqual([URL])
    expect(fetch).toHaveBeenCalledWith(URL, expect.objectContaining({ method: "HEAD", cache: "no-store" }))
  })

  it("maps backend cooldowns to a bounded generating retry", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "2" } }))

    const error = await probeFolderThumbnailUrls([URL], new AbortController().signal, fetch).catch((cause) => cause)

    expect(error).toMatchObject({ kind: "generating", retryAfterMs: 2_000 })
    expect(retryFolderThumbnailProbe(2, error)).toBe(true)
    expect(retryFolderThumbnailProbe(3, error)).toBe(false)
    expect(folderThumbnailProbeRetryDelay(0, error)).toBe(2_000)
    expect(folderThumbnailProbeRetryDelay(0, new FolderThumbnailProbeError("generating", 60_000))).toBe(10_000)
  })

  it.each([
    [404, "unavailable"],
    [410, "stale"],
  ] as const)("does not query-retry HTTP %s before the store re-registers it", async (status, kind) => {
    const fetch = vi.fn(async () => new Response(null, { status }))

    const error = await probeFolderThumbnailUrls([URL], new AbortController().signal, fetch).catch((cause) => cause)

    expect(error).toMatchObject({ kind })
    expect(retryFolderThumbnailProbe(0, error)).toBe(false)
  })

  it("limits generic failures to TanStack Query's bounded retry policy", () => {
    const error = new FolderThumbnailProbeError("failed")
    expect(retryFolderThumbnailProbe(0, error)).toBe(true)
    expect(retryFolderThumbnailProbe(2, error)).toBe(false)
  })
})
