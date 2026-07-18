import { describe, expect, it, vi } from "vitest"

import type { ReaderEmmOverrideRecord, ReaderEmmOverrideStore } from "../../ports/ReaderEmmOverrideStore.js"
import {
  ReaderDirectoryEmmEditService,
  type ReaderDirectoryEmmEditScope,
} from "./ReaderDirectoryEmmEditService.js"
import { ReaderEmmMetadataService } from "./ReaderEmmMetadataService.js"

describe("ReaderDirectoryEmmEditService", () => {
  it("[neoview.folder.emm-read-service] reads bounded revisions only for current listing members", async () => {
    const store = memoryStore()
    await store.saveEmmOverride("D:\\Books\\A.cbz", { rating: 4 }, 0, 1)
    const scope = memoryScope(["D:/Books/A.cbz", "D:/Books/B.cbz"])
    const service = new ReaderDirectoryEmmEditService(new ReaderEmmMetadataService(store), scope)

    await expect(service.read("browser-1", {
      generation: 7,
      paths: ["D:/Books/A.cbz", "D:/Books/B.cbz"],
    })).resolves.toMatchObject({
      generation: 7,
      items: [
        { path: "D:/Books/A.cbz", metadata: { revision: 1, overrides: { rating: 4 } } },
        { path: "D:/Books/B.cbz", metadata: { revision: 0, overrides: {} } },
      ],
    })
    await expect(service.read("browser-1", { generation: 7, paths: ["D:/Books/A.cbz", "d:\\books\\a.cbz"] }))
      .rejects.toThrow("duplicate path")
  })

  it("[neoview.folder.emm-edit-service] applies a bounded batch and refreshes the browser generation once", async () => {
    const store = memoryStore()
    const scope = memoryScope(["D:/Books/A.cbz", "D:/Books/B.cbz"])
    const service = new ReaderDirectoryEmmEditService(new ReaderEmmMetadataService(store), scope)
    const result = await service.update("browser-1", {
      generation: 7,
      updates: [
        { path: "D:/Books/A.cbz", expectedRevision: 0, patch: { rating: 5 } },
        { path: "D:/Books/B.cbz", expectedRevision: 0, patch: { manualTags: [{ namespace: "artist", tag: "Alice" }] } },
      ],
      concurrency: 2,
    })

    expect(result).toMatchObject({
      generation: 8,
      refreshRequired: false,
      entries: [{ path: "D:/Books/A.cbz" }, { path: "D:/Books/B.cbz" }],
      succeeded: 2,
      conflicts: 0,
      failed: 0,
    })
    expect(result.results).toMatchObject([
      { index: 0, status: "succeeded", metadata: { revision: 1, overrides: { rating: 5 } } },
      { index: 1, status: "succeeded", metadata: { revision: 1, overrides: { manualTags: [{ namespace: "artist", tag: "Alice" }] } } },
    ])
    expect(scope.refreshEntryMetadata).toHaveBeenCalledOnce()
    expect(scope.refreshEntryMetadata).toHaveBeenCalledWith(
      "browser-1",
      7,
      ["D:/Books/A.cbz", "D:/Books/B.cbz"],
      new Set(["rating", "collectTagCount", "tags"]),
      undefined,
    )
  })

  it("[neoview.folder.emm-edit-conflict] reports per-entry CAS conflicts without refreshing unchanged entries", async () => {
    const store = memoryStore()
    await store.saveEmmOverride("D:\\Books\\A.cbz", { rating: 4 }, 0, 1)
    const scope = memoryScope(["D:/Books/A.cbz"])
    const service = new ReaderDirectoryEmmEditService(new ReaderEmmMetadataService(store), scope)

    await expect(service.update("browser-1", {
      generation: 7,
      updates: [{ path: "D:/Books/A.cbz", expectedRevision: 0, patch: { rating: 5 } }],
    })).resolves.toEqual({
      generation: 7,
      refreshRequired: false,
      entries: [],
      results: [{ index: 0, status: "conflict", actualRevision: 1 }],
      succeeded: 0,
      conflicts: 1,
      failed: 0,
    })
    expect(scope.refreshEntryMetadata).not.toHaveBeenCalled()
  })

  it("[neoview.folder.emm-edit-validation] rejects the complete command before persistence", async () => {
    const store = memoryStore()
    const scope = memoryScope(["D:/Books/A.cbz"])
    const service = new ReaderDirectoryEmmEditService(new ReaderEmmMetadataService(store), scope)
    await expect(service.update("browser-1", {
      generation: 7,
      updates: [
        { path: "D:/Books/A.cbz", expectedRevision: 0, patch: { rating: 5 } },
        { path: "d:\\books\\a.cbz", expectedRevision: 0, patch: { rating: 4 } },
      ],
    })).rejects.toThrow("duplicate path")
    expect(store.saveEmmOverride).not.toHaveBeenCalled()
    await expect(service.update("browser-1", {
      generation: 7,
      updates: [{ path: "D:/Books/A.cbz", expectedRevision: 0, patch: {} }],
    })).rejects.toThrow("at least one field")
    expect(store.saveEmmOverride).not.toHaveBeenCalled()
  })
})

function memoryStore(): ReaderEmmOverrideStore & { saveEmmOverride: ReturnType<typeof vi.fn> } {
  const records = new Map<string, ReaderEmmOverrideRecord>()
  const getEmmOverride = vi.fn(async (path: string) => records.get(path))
  const saveEmmOverride = vi.fn(async (path: string, overrides: ReaderEmmOverrideRecord["overrides"], expectedRevision: number, updatedAt: number) => {
    const current = records.get(path)
    if ((current?.revision ?? 0) !== expectedRevision) return undefined
    const record = { path, overrides, revision: expectedRevision + 1, updatedAt }
    records.set(path, record)
    return record
  })
  return { getEmmOverride, saveEmmOverride }
}

function memoryScope(paths: readonly string[]): ReaderDirectoryEmmEditScope & {
  refreshEntryMetadata: ReturnType<typeof vi.fn>
} {
  return {
    resolveEntries: vi.fn(async (_sessionId, generation, requested) => {
      if (generation !== 7) throw new Error("stale")
      return requested.map((path) => {
        const actual = paths.find((candidate) => normalize(candidate) === normalize(path))
        if (!actual) throw new Error("not in listing")
        return { name: actual.split(/[\\/]/u).at(-1)!, path: actual, kind: "file" as const, readerSupported: true }
      })
    }),
    refreshEntryMetadata: vi.fn(async (_sessionId, _generation, requested) => ({
      generation: 8,
      entries: requested.map((path: string) => ({
        name: path.split(/[\\/]/u).at(-1)!,
        path,
        kind: "file" as const,
        readerSupported: true,
      })),
      orderChanged: false,
    })),
  }
}

function normalize(path: string): string {
  return path.replaceAll("\\", "/").toLocaleLowerCase("en-US")
}
