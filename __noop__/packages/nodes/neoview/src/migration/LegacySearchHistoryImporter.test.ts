import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { SqliteReaderDataStore } from "../platform/persistence/SqliteReaderDataStore.js"
import { LegacySearchHistoryImporter } from "./LegacySearchHistoryImporter.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("LegacySearchHistoryImporter", () => {
  it("[neoview.folder.search-history-import] preserves newer rows on merge and replaces selected scopes on overwrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-search-history-import-"))
    roots.push(root)
    const path = join(root, "thumbnails.db")
    const store = await SqliteReaderDataStore.open(path)
    await store.recordSearchHistory({ scope: "folder", query: "same", usedAt: 500 }, 20)
    await store.recordSearchHistory({ scope: "folder", query: "existing", usedAt: 400 }, 20)
    const importer = new LegacySearchHistoryImporter(store)
    await expect(importer.import({
      scopes: ["folder"],
      entries: [
        { scope: "folder", query: "same", usedAt: 100 },
        { scope: "folder", query: "imported", usedAt: 300 },
      ],
      issues: [],
    }, "merge")).resolves.toEqual({ applied: 1, cleared: 0, skippedNewer: 1 })
    await expect(store.listSearchHistory("folder", 20)).resolves.toEqual([
      expect.objectContaining({ query: "same", usedAt: 500 }),
      expect.objectContaining({ query: "existing", usedAt: 400 }),
      expect.objectContaining({ query: "imported", usedAt: 300 }),
    ])
    await expect(importer.import({
      scopes: ["folder"],
      entries: [{ scope: "folder", query: "replacement", usedAt: 600 }],
      issues: [],
    }, "overwrite")).resolves.toEqual({ applied: 1, cleared: 3, skippedNewer: 0 })
    await expect(store.listSearchHistory("folder", 20)).resolves.toEqual([
      { scope: "folder", query: "replacement", usedAt: 600, useCount: 1 },
    ])
    await importer.close()
  })
})
