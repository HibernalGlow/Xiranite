import { describe, expect, it, vi } from "vitest"

import { LazyReaderDirectoryMetadataProvider } from "./LazyReaderDirectoryMetadataProvider.js"

describe("LazyReaderDirectoryMetadataProvider", () => {
  it("[neoview.folder.metadata-lazy] stays idle, singleflights first hydration and filters runtime capabilities", async () => {
    const hydrate = vi.fn(async (entries) => entries.map((entry) => ({ ...entry, rating: 4.5 })))
    const load = vi.fn(async () => ({ supportedFields: new Set(["rating"] as const), hydrate }))
    const provider = new LazyReaderDirectoryMetadataProvider(new Set(["rating", "tags"]), load)
    const entries = [{ name: "book.cbz", path: "D:/book.cbz", kind: "file" as const, readerSupported: true }]

    expect(load).not.toHaveBeenCalled()
    await Promise.all([
      provider.hydrate(entries, new Set(["rating", "tags"])),
      provider.hydrate(entries, new Set(["rating"])),
    ])
    expect(load).toHaveBeenCalledOnce()
    expect(hydrate).toHaveBeenCalledTimes(2)
    expect(hydrate.mock.calls[0]?.[1]).toEqual(new Set(["rating"]))
    await expect(provider.hydrate(entries, new Set(["tags"]))).resolves.toBe(entries)
    expect(hydrate).toHaveBeenCalledTimes(2)
  })

  it("[neoview.folder.metadata-lazy-retry] retries a failed provider load", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("database busy"))
      .mockResolvedValue({ supportedFields: new Set(["tags"]), hydrate: async (entries: unknown[]) => entries })
    const provider = new LazyReaderDirectoryMetadataProvider(new Set(["tags"]), load)
    const entries = [{ name: "book.cbz", path: "D:/book.cbz", kind: "file" as const, readerSupported: true }]

    await expect(provider.hydrate(entries, new Set(["tags"]))).rejects.toThrow("database busy")
    await expect(provider.hydrate(entries, new Set(["tags"]))).resolves.toBe(entries)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
