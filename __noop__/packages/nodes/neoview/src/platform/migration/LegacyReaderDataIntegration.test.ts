import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { LegacyReaderDataCodec } from "../../migration/LegacyReaderDataCodec.js"
import { createLegacyReaderDataImporter, createReaderHeadlessController, createReaderLibraryService } from "../../platform.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("legacy reader data integration", () => {
  it("[neoview.reader-data.e2e] imports into the original database and restores through the shared reader", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-reader-data-import-"))
    roots.push(root)
    const bookPath = join(root, "book")
    const databasePath = join(root, "thumbnails.db")
    await mkdir(bookPath)
    await writeFile(join(bookPath, "001.png"), pngHeader(20, 30))
    await writeFile(join(bookPath, "002.png"), pngHeader(30, 20))
    const decoded = new LegacyReaderDataCodec().decode({
      rawLocalStorage: {
        "neoview-unified-history": JSON.stringify([{
          id: "legacy-history",
          pathStack: [{ path: bookPath }],
          displayName: "Imported book",
          currentIndex: 1,
          totalItems: 2,
          contentType: "folder",
          timestamp: 100,
        }]),
        "neoview-bookmark-lists-v2": JSON.stringify([{ id: "reading", name: "Reading", createdAt: 50 }]),
        "neoview-bookmarks": JSON.stringify([{
          id: "legacy-bookmark", path: bookPath, name: "Book", type: "folder", listIds: ["reading"], createdAt: 60,
        }]),
      },
    })

    const importer = await createLegacyReaderDataImporter(databasePath)
    try {
      await expect(importer.import(decoded, "merge")).resolves.toMatchObject({
        applied: { progress: 1, bookmarks: 1, bookmarkLists: 1 },
        unresolvedSources: 0,
      })
    } finally {
      await importer[Symbol.asyncDispose]()
    }

    const library = await createReaderLibraryService(databasePath)
    try {
      await expect(library.listRecent()).resolves.toEqual([
        expect.objectContaining({ displayName: "Imported book", pageIndex: 1, pageCount: 2 }),
      ])
      await expect(library.listBookmarks({ listId: "reading" })).resolves.toEqual([
        expect.objectContaining({ id: "legacy-bookmark", kind: "folder", listIds: ["reading"] }),
      ])
    } finally {
      await library.close()
    }

    const reader = await createReaderHeadlessController({ legacyThumbnailDatabasePath: databasePath })
    try {
      await expect(reader.open({ path: bookPath })).resolves.toMatchObject({ frame: { anchorPageIndex: 1 } })
    } finally {
      await reader[Symbol.asyncDispose]()
    }
  })
})

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  bytes[24] = 8
  bytes[25] = 2
  return bytes
}
