import { describe, expect, it, vi } from "vitest"

import { WindowsSystemThumbnailProvider } from "./WindowsSystemThumbnailProvider.js"

const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1])

describe("WindowsSystemThumbnailProvider", () => {
  it("[neoview.thumbnail.windows-cache] schedules native cache read and WebP encoding separately", async () => {
    const releases = [vi.fn(), vi.fn()]
    const acquire = vi.fn(async () => ({ release: releases[acquire.mock.calls.length - 1]! }))
    const getCachedSystemThumbnail = vi.fn(async () => ({
      rgba: Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 128),
      width: 2,
      height: 1,
      premultiplied: true,
    }))
    const encodeWebp = vi.fn(async () => WEBP)
    const provider = new WindowsSystemThumbnailProvider({
      resourceScheduler: { acquire },
      loadNative: async () => ({ getCachedSystemThumbnail }),
      encodeWebp,
    })
    const result = await provider.getCached({
      sourcePath: "D:/library/video.mp4",
      maxEdge: 416,
      quality: 82,
      priority: "view",
      ownerId: "library:visible",
    })
    expect(result).toEqual({ bytes: WEBP, contentType: "image/webp" })
    expect(getCachedSystemThumbnail).toHaveBeenCalledWith({ path: "D:/library/video.mp4", maxDimension: 416 })
    expect(encodeWebp).toHaveBeenCalledWith(expect.objectContaining({ width: 2, height: 1 }), 82, undefined)
    expect(acquire.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({ resource: "io", kind: "neoview.thumbnail.windows-shell-cache", priority: "view" }),
      expect.objectContaining({ resource: "cpu", kind: "neoview.thumbnail.windows-shell-webp", priority: "view" }),
    ])
    expect(releases[0]).toHaveBeenCalledOnce()
    expect(releases[1]).toHaveBeenCalledOnce()
  })

  it("[neoview.thumbnail.windows-miss] returns a cache miss without loading sharp or taking a CPU lease", async () => {
    const release = vi.fn()
    const acquire = vi.fn(async () => ({ release }))
    const encodeWebp = vi.fn()
    const provider = new WindowsSystemThumbnailProvider({
      resourceScheduler: { acquire },
      loadNative: async () => ({ getCachedSystemThumbnail: async () => undefined }),
      encodeWebp,
    })
    await expect(provider.getCached({
      sourcePath: "D:/library/book.cbz",
      maxEdge: 416,
      quality: 82,
      priority: "view",
    })).resolves.toBeUndefined()
    expect(acquire).toHaveBeenCalledOnce()
    expect(encodeWebp).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.thumbnail.windows-bounds] rejects malformed native pixel buffers", async () => {
    const provider = new WindowsSystemThumbnailProvider({
      resourceScheduler: { acquire: async () => ({ release() {} }) },
      loadNative: async () => ({
        getCachedSystemThumbnail: async () => ({ rgba: Uint8Array.of(1), width: 64, height: 64, premultiplied: true }),
      }),
      encodeWebp: async () => WEBP,
    })
    await expect(provider.getCached({
      sourcePath: "D:/bad.png",
      maxEdge: 64,
      quality: 80,
      priority: "interactive",
    })).rejects.toThrow("byte length")
  })
})
