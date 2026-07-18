import { describe, expect, it, vi } from "vitest"

import type { ReaderBook } from "../../domain/book/book.js"
import { PlatformDirectoryMediaMetadataProvider } from "./PlatformDirectoryMediaMetadataProvider.js"

describe("PlatformDirectoryMediaMetadataProvider", () => {
  it("[neoview.folder.media-metadata-batch] reuses the book loader and bounded image probe", async () => {
    const close = vi.fn(async () => undefined)
    const content = { load: vi.fn() }
    const book = {
      pages: [{ content, mimeType: "image/png" }],
      close,
    } as unknown as ReaderBook
    const bookLoader = vi.fn(async () => book)
    const probe = vi.fn(async () => ({ format: "png" as const, dimensions: { width: 1920, height: 1080 }, bytesRead: 24 }))
    const provider = new PlatformDirectoryMediaMetadataProvider(bookLoader, { probe })
    const [entry] = await provider.hydrate([
      { name: "cover.png", path: "D:/cover.png", kind: "file", readerSupported: true },
    ], new Set(["dimensions", "pageCount"]))
    expect(bookLoader).toHaveBeenCalledWith({ kind: "path", path: "D:/cover.png" }, { signal: undefined })
    expect(probe).toHaveBeenCalledWith(content, "image/png", undefined)
    expect(entry).toMatchObject({ width: 1920, height: 1080, pageCount: 1 })
    expect(close).toHaveBeenCalledOnce()
  })

  it("[neoview.folder.media-metadata-fallback] preserves rows when one source is unsupported", async () => {
    const provider = new PlatformDirectoryMediaMetadataProvider(
      vi.fn(async () => { throw new Error("unsupported") }),
      { probe: vi.fn() },
    )
    const entry = { name: "note.txt", path: "D:/note.txt", kind: "file" as const, readerSupported: true }
    await expect(provider.hydrate([entry], new Set(["dimensions", "pageCount"]))).resolves.toEqual([entry])
  })

  it("[neoview.folder.media-metadata-emm-hit] does not open an archive when EMM already supplied page count", async () => {
    const bookLoader = vi.fn()
    const provider = new PlatformDirectoryMediaMetadataProvider(bookLoader, { probe: vi.fn() })
    const entry = { name: "book.cbz", path: "D:/book.cbz", kind: "file" as const, readerSupported: true, pageCount: 42 }
    await expect(provider.hydrate([entry], new Set(["dimensions", "pageCount"]))).resolves.toEqual([entry])
    expect(bookLoader).not.toHaveBeenCalled()
  })
})
