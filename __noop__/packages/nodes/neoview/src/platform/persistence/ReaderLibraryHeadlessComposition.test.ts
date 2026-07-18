import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createReaderLibraryHeadlessController } from "../../platform.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Reader library headless composition", () => {
  it("[neoview.library.headless-composition] resolves, deduplicates and reopens the original Reader database", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-headless-"))
    roots.push(root)
    const imagePath = join(root, "cover.png")
    const databasePath = join(root, "thumbnails.db")
    await writeFile(imagePath, Uint8Array.of(0x89, 0x50, 0x4e, 0x47))

    const first = await createReaderLibraryHeadlessController(databasePath)
    await first.saveBookmarkList({ id: "reading", name: "Reading" })
    const created = await first.savePathBookmark({ path: imagePath, listIds: ["default"] })
    const repeated = await first.savePathBookmark({ path: imagePath, name: "Cover", listIds: ["reading"], starred: true })
    expect(repeated).toMatchObject({ id: created.id, name: "Cover", starred: true, listIds: ["default", "reading"] })
    await first.close()

    const reopened = await createReaderLibraryHeadlessController(databasePath)
    await expect(reopened.listBookmarks(undefined, 10)).resolves.toEqual([
      expect.objectContaining({ id: created.id, name: "Cover", listIds: ["default", "reading"] }),
    ])
    await unlink(imagePath)
    await expect(reopened.cleanupInvalid({ kind: "bookmarks", scanLimit: 10, deleteLimit: 10 })).resolves.toMatchObject({
      scanned: 1, missing: 1, deleted: 1,
    })
    await expect(reopened.listBookmarks(undefined, 10)).resolves.toEqual([])
    await reopened.close()
  })
})
