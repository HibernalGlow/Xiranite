import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlatformDirectoryMetadataProvider } from "./PlatformDirectoryMetadataProvider.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("PlatformDirectoryMetadataProvider", () => {
  it("[neoview.folder.metadata-batch] hydrates requested stat fields without recursively sizing folders", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-folder-metadata-"))
    directories.push(root)
    const file = join(root, "book.cbz")
    const folder = join(root, "nested")
    await writeFile(file, "12345")
    await mkdir(folder)
    const provider = new PlatformDirectoryMetadataProvider()
    const entries = await provider.hydrate([
      { name: "book.cbz", path: file, kind: "file", readerSupported: true },
      { name: "nested", path: folder, kind: "directory", readerSupported: true },
    ], new Set(["date", "size"]))
    expect(entries[0]).toMatchObject({ size: 5, modifiedAt: expect.any(Number) })
    expect(entries[1]).toMatchObject({ modifiedAt: expect.any(Number) })
    expect(entries[1]?.size).toBeUndefined()
  })

  it("[neoview.folder.emm-batch] merges rating fallback and favorite tag counts in one batch", async () => {
    const readDirectoryEmmRecords = vi.fn(async () => new Map([
      ["D:/one.cbz", { ratingData: JSON.stringify({ value: 4.8 }), emmJson: JSON.stringify({ tags: [{ namespace: "female", tag: "glasses" }] }) }],
      ["D:/two.cbz", { emmJson: JSON.stringify({ rating: 3.5, tags: [{ namespace: "male", tag: "glasses" }] }) }],
    ]))
    const provider = new PlatformDirectoryMetadataProvider(
      { directoryEmmAvailable: true, readDirectoryEmmRecords },
      { load: async () => ({ tags: [{ category: "female", tag: "glasses" }], mixedGender: true }) } as never,
    )
    const entries = await provider.hydrate([
      { name: "one.cbz", path: "D:/one.cbz", kind: "file", readerSupported: true },
      { name: "two.cbz", path: "D:/two.cbz", kind: "file", readerSupported: true },
      { name: "three.cbz", path: "D:/three.cbz", kind: "file", readerSupported: true },
    ], new Set(["rating", "collectTagCount"]))
    expect(readDirectoryEmmRecords).toHaveBeenCalledTimes(1)
    expect(entries).toEqual([
      expect.objectContaining({ rating: 4.8, collectTagCount: 1 }),
      expect.objectContaining({ rating: 3.5, collectTagCount: 1 }),
      expect.objectContaining({ rating: 4.2, collectTagCount: 0 }),
    ])
  })

  it("[neoview.folder.details-metadata] merges EMM page count and all tags before probing missing media fields", async () => {
    const mediaHydrate = vi.fn(async (entries: readonly Record<string, unknown>[]) => entries.map((entry) => ({
      ...entry,
      width: 1600,
      height: 2400,
      pageCount: entry.pageCount ?? 12,
    })))
    const provider = new PlatformDirectoryMetadataProvider(
      {
        directoryEmmAvailable: true,
        readDirectoryEmmRecords: async () => new Map([
          ["D:/book.cbz", {
            emmJson: JSON.stringify({ page_count: 42, tags: [{ namespace: "artist", tag: "alice" }] }),
            manualTags: JSON.stringify([{ namespace: "manual", tag: "favorite", timestamp: 1 }]),
          }],
        ]),
      },
      undefined,
      4.2,
      { supportedFields: new Set(["dimensions", "pageCount"]), hydrate: mediaHydrate } as never,
    )
    const entries = await provider.hydrate([
      { name: "book.cbz", path: "D:/book.cbz", kind: "file", readerSupported: true },
    ], new Set(["dimensions", "pageCount", "tags"]))
    expect(entries[0]).toMatchObject({
      width: 1600,
      height: 2400,
      pageCount: 42,
      tags: ["artist:alice", "manual:favorite"],
    })
    expect(mediaHydrate).toHaveBeenCalledTimes(1)
  })
})
