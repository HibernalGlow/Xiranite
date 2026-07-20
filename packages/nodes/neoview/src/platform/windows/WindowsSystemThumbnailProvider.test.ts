import { describe, expect, it, vi } from "vitest"

import { WindowsSystemThumbnailProvider } from "./WindowsSystemThumbnailProvider.js"

const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1])

describe("WindowsSystemThumbnailProvider", () => {
  it("[neoview.thumbnail.windows-cache] gets an encoded WebP without crossing JS as RGBA", async () => {
    const release = vi.fn()
    const acquire = vi.fn(async () => ({ release }))
    const getCachedSystemThumbnailEncoded = vi.fn(async () => ({
      data: WEBP,
      width: 2,
      height: 1,
      mimeType: "image/webp",
    }))
    const provider = new WindowsSystemThumbnailProvider({
      resourceScheduler: { acquire },
      loadNative: async () => ({ getCachedSystemThumbnailEncoded }),
    })
    const result = await provider.getCached({
      sourcePath: "D:/library/video.mp4",
      maxEdge: 416,
      quality: 82,
      priority: "view",
      ownerId: "library:visible",
    })
    expect(result).toEqual({ bytes: WEBP, contentType: "image/webp" })
    expect(getCachedSystemThumbnailEncoded).toHaveBeenCalledWith({
      path: "D:/library/video.mp4",
      maxDimension: 416,
      format: "webp",
      lossless: false,
      quality: 82,
    })
    expect(acquire.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({ resource: "cpu", kind: "neoview.thumbnail.windows-shell-native-webp", priority: "view" }),
    ])
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.thumbnail.windows-miss] returns a cache miss without loading sharp or taking a CPU lease", async () => {
    const release = vi.fn()
    const acquire = vi.fn(async () => ({ release }))
    const provider = new WindowsSystemThumbnailProvider({
      resourceScheduler: { acquire },
      loadNative: async () => ({ getCachedSystemThumbnailEncoded: async () => undefined }),
    })
    await expect(provider.getCached({
      sourcePath: "D:/library/book.cbz",
      maxEdge: 416,
      quality: 82,
      priority: "view",
    })).resolves.toBeUndefined()
    expect(acquire).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.thumbnail.windows-bounds] rejects malformed native pixel buffers", async () => {
    const provider = new WindowsSystemThumbnailProvider({
      resourceScheduler: { acquire: async () => ({ release() {} }) },
      loadNative: async () => ({
        getCachedSystemThumbnailEncoded: async () => ({ data: Uint8Array.of(1), width: 64, height: 64, mimeType: "image/webp" }),
      }),
    })
    await expect(provider.getCached({
      sourcePath: "D:/bad.png",
      maxEdge: 64,
      quality: 80,
      priority: "interactive",
    })).rejects.toThrow("non-WebP")
  })
})
