import { describe, expect, test } from "vitest"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createLibsqlMelodeckRepository, type LibsqlMelodeckRepository } from "./melodeckLibsql.js"

const RUN_ROOT = join(process.cwd(), "artifacts", "test-runs", "repository")

describe("createLibsqlMelodeckRepository", () => {
  test("persists the ordered library, metadata, lyrics, and cover in the shared database", async () => {
    await mkdir(RUN_ROOT, { recursive: true })
    const directory = await mkdtemp(join(RUN_ROOT, "melodeck-"))
    const url = pathToFileURL(join(directory, "xiranite.db")).href
    const open: LibsqlMelodeckRepository[] = []
    try {
      const repository = await createLibsqlMelodeckRepository({ url })
      open.push(repository)
      await expect(repository.loadLibrary()).resolves.toEqual({ initialized: false, tracks: [] })
      await repository.replaceLibrary([
        { key: "d:/music/a.flac", path: "D:/Music/A.flac", title: "A", sortOrder: 0 },
        { key: "d:/music/b.flac", path: "D:/Music/B.flac", title: "B", sortOrder: 1 },
      ], 100)
      await repository.saveMetadata({
        key: "d:/music/b.flac",
        path: "D:/Music/B.flac",
        fileSize: 42,
        lastModified: 123,
        title: "Resolved B",
        artist: "Artist",
        lyrics: { lines: [{ startTime: 0, endTime: 1_000, fullText: "Line" }] },
        lyricsHydrated: true,
        coverMimeType: "image/png",
        coverData: new Uint8Array([1, 2, 3]),
        updatedAt: 200,
      })
      repository.client.close()
      open.pop()

      const reopened = await createLibsqlMelodeckRepository({ url })
      open.push(reopened)
      const library = await reopened.loadLibrary()
      expect(library.initialized).toBe(true)
      expect(library.tracks.map((track) => track.path)).toEqual(["D:/Music/A.flac", "D:/Music/B.flac"])
      expect(library.tracks[1]?.metadata).toMatchObject({ title: "Resolved B", artist: "Artist", hasCover: true, lyricsHydrated: true })
      await expect(reopened.getMetadata("d:/music/b.flac")).resolves.toMatchObject({
        title: "Resolved B",
        coverData: new Uint8Array([1, 2, 3]),
        lyrics: { lines: [{ fullText: "Line" }] },
      })

      await reopened.replaceLibrary([], 300)
      await expect(reopened.loadLibrary()).resolves.toEqual({ initialized: true, tracks: [] })
      await expect(reopened.getMetadata("d:/music/b.flac")).resolves.toBeUndefined()
    } finally {
      for (const repository of open) repository.client.close()
      await removeWithWindowsRetry(directory)
    }
  })
})

async function removeWithWindowsRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}
