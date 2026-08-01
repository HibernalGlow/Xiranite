import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { readerBookIdForSource } from "../books/ReaderSourceIdentity.js"
import { stableOpaqueId } from "../books/book-utils.js"
import { openWritableSqlite } from "../sqlite/openWritableSqlite.js"
import { SqliteReaderDataStore } from "./SqliteReaderDataStore.js"

const directories: string[] = []
const oldPath = "D:/Books/Title [CM1P0873-4K7Q].cbz"
const newerPath = "D:/Books/Title [CM9N0342-4K7Q].cbz"

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("Reader source persistence", () => {
  it("migrates legacy score-dependent book ids and keeps the newest conflicting records", async () => {
    const path = await databasePath()
    await (await SqliteReaderDataStore.open(path)).close()
    const database = await openWritableSqlite(path)
    const olderSource = { kind: "archive" as const, path: oldPath }
    const newerSource = { kind: "archive" as const, path: newerPath }
    const olderId = stableOpaqueId("book", "archive", oldPath)
    const newerId = stableOpaqueId("book", "archive", newerPath)
    database.run(
      "INSERT INTO xr_reader_progress VALUES (?1, ?2, ?3, 1, 10, 100)",
      olderId, JSON.stringify(olderSource), "Older",
    )
    database.run(
      "INSERT INTO xr_reader_progress VALUES (?1, ?2, ?3, 7, 10, 200)",
      newerId, JSON.stringify(newerSource), "Newer",
    )
    database.run(
      "INSERT INTO xr_reader_book_settings VALUES (?1, 1, 3, NULL, NULL, NULL, 2, 300)",
      olderId,
    )
    database.run(
      "INSERT INTO xr_reader_book_settings VALUES (?1, 0, 5, NULL, NULL, NULL, 9, 250)",
      newerId,
    )
    database.run("INSERT INTO xr_reader_media_progress VALUES (?1, 2, 10, 0, 100)", olderId)
    database.run("INSERT INTO xr_reader_media_progress VALUES (?1, 8, 10, 0, 200)", newerId)
    database.close()

    const store = await SqliteReaderDataStore.open(path)
    const stableId = readerBookIdForSource(newerSource)
    await expect(store.listRecent({ limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ bookId: stableId, source: newerSource, pageIndex: 7 }),
    ])
    await expect(store.getBookSettings(stableId)).resolves.toMatchObject({
      overrides: { favorite: true, rating: 3 },
      revision: 2,
      updatedAt: 300,
    })
    await expect(store.getMediaProgress(stableId)).resolves.toMatchObject({ position: 8, updatedAt: 200 })
    await store.close()

    const verified = await openWritableSqlite(path)
    expect(verified.get("SELECT COUNT(*) AS count FROM xr_reader_progress")?.count).toBe(1)
    expect(verified.get("SELECT COUNT(*) AS count FROM xr_reader_book_settings")?.count).toBe(1)
    expect(verified.get("SELECT COUNT(*) AS count FROM xr_reader_media_progress")?.count).toBe(1)
    verified.close()
  })

  it("relocates every XR path projection in one store operation without changing identity", async () => {
    const path = await databasePath()
    const store = await SqliteReaderDataStore.open(path, { platform: "win32" })
    const source = { kind: "archive" as const, path: oldPath }
    const stableId = readerBookIdForSource(source)
    await store.save({ bookId: stableId, source, displayName: "Old", pageIndex: 3, pageCount: 10, updatedAt: 100 })
    await store.saveBookSettings(stableId, { favorite: true, rating: 4 }, 0, 100)
    await store.saveMediaProgress({ bookId: stableId, position: 3, duration: 10, completed: false, updatedAt: 100 })
    await store.upsertBookmark({ id: "bookmark", source, name: "Old", kind: "file", starred: true, createdAt: 1, updatedAt: 1, listIds: ["default"] })
    await store.upsertPlaylist({ id: "playlist", name: "Playlist", createdAt: 1, updatedAt: 1 })
    await store.appendPlaylistEntries("playlist", [{ id: "entry", playlistId: "playlist", source, name: "Old", position: 0, createdAt: 1 }], 2)
    await store.importData({
      progress: [], bookmarks: [], bookmarkLists: [], mediaProgress: [],
      pathStacks: [{ bookId: stableId, pathStack: [{ path: oldPath }, { path: "D:/Books" }], updatedAt: 100 }],
    }, "merge")
    const sort = { field: "name" as const, order: "desc" as const, directoriesFirst: false }
    await store.setFolderRule(oldPath.toLocaleLowerCase("en-US"), oldPath, sort, 100)
    await store.saveEmmOverride(oldPath, { rating: 5 }, 0, 100)
    await store.replaceFolderRatingCache([{ path: oldPath, averageRating: 4.5, count: 2, direct: true }], 100)

    await expect(store.relocateSourcePath(oldPath.toLocaleLowerCase("en-US"), newerPath)).resolves.toEqual({
      progress: 1,
      bookmarks: 1,
      playlistEntries: 1,
      pathStacks: 1,
      folderSortRules: 1,
      emmOverrides: 1,
      folderRatings: 1,
    })
    await expect(store.get(stableId)).resolves.toMatchObject({ source: { path: newerPath }, displayName: "Title [CM9N0342-4K7Q].cbz" })
    await expect(store.getBookSettings(stableId)).resolves.toMatchObject({ overrides: { favorite: true, rating: 4 } })
    await expect(store.getMediaProgress(stableId)).resolves.toMatchObject({ position: 3 })
    await expect(store.findBookmarkByPath(newerPath)).resolves.toMatchObject({ source: { path: newerPath }, name: "Title [CM9N0342-4K7Q].cbz" })
    await expect(store.listPlaylistEntries("playlist")).resolves.toEqual([
      expect.objectContaining({ source: expect.objectContaining({ path: newerPath }), name: "Title [CM9N0342-4K7Q].cbz" }),
    ])
    await expect(store.getFolderRule(newerPath.toLocaleLowerCase("en-US"))).resolves.toEqual(sort)
    await expect(store.getEmmOverride(newerPath)).resolves.toMatchObject({ path: newerPath, overrides: { rating: 5 } })
    await expect(store.loadFolderRatingCache()).resolves.toMatchObject({ entries: [{ path: newerPath }] })
    await store.close()

    const verified = await openWritableSqlite(path)
    expect(JSON.parse(String(verified.get("SELECT path_stack_json FROM xr_reader_path_stacks")?.path_stack_json))).toEqual([
      { path: newerPath },
      { path: "D:/Books" },
    ])
    verified.close()
  })
})

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-source-"))
  directories.push(directory)
  return join(directory, "thumbnails.db")
}
