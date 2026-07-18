import { describe, expect, it } from "vitest"

import type { ReaderEmmOverrideRecord, ReaderEmmOverrideStore } from "../../ports/ReaderEmmOverrideStore.js"
import { ReaderEmmMetadataRevisionConflict, ReaderEmmMetadataService } from "./ReaderEmmMetadataService.js"

describe("ReaderEmmMetadataService", () => {
  it("[neoview.emm.override-service] applies normalized overrides and nullable inheritance with monotonic revisions", async () => {
    const service = new ReaderEmmMetadataService(memoryStore())
    const first = await service.update("D:/Books/demo.cbz", 0, {
      rating: 5,
      translatedTitle: "  译名  ",
      manualTags: [{ namespace: "artist", tag: "Alice" }, { namespace: "ARTIST", tag: "alice" }],
    })
    expect(first).toMatchObject({
      revision: 1,
      overrides: { rating: 5, translatedTitle: "译名", manualTags: [{ namespace: "ARTIST", tag: "alice" }] },
      inherited: [],
    })
    await expect(service.update("D:/Books/demo.cbz", 1, { rating: null, manualTags: null })).resolves.toMatchObject({
      revision: 2,
      overrides: { translatedTitle: "译名" },
      inherited: ["rating", "manualTags"],
    })
  })

  it("[neoview.emm.override-cas] serializes same-path writes and reports the actual revision", async () => {
    const service = new ReaderEmmMetadataService(memoryStore())
    const [first, second] = await Promise.allSettled([
      service.update("D:/Books/demo.cbz", 0, { rating: 4 }),
      service.update("D:/Books/demo.cbz", 0, { rating: 5 }),
    ])
    expect(first.status).toBe("fulfilled")
    expect(second.status).toBe("rejected")
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(ReaderEmmMetadataRevisionConflict)
    expect((second as PromiseRejectedResult).reason.actualRevision).toBe(1)
  })

  it("rejects invalid ratings, tags, titles and empty patches before persistence", async () => {
    const service = new ReaderEmmMetadataService(memoryStore())
    expect(() => service.update("D:/book", 0, { rating: 6 })).toThrow()
    expect(() => service.update("D:/book", 0, { manualTags: [{ namespace: "", tag: "x" }] })).toThrow()
    expect(() => service.update("D:/book", 0, { translatedTitle: "" })).toThrow()
    expect(() => service.update("D:/book", 0, {})).toThrow("at least one")
  })
})

function memoryStore(): ReaderEmmOverrideStore {
  const records = new Map<string, ReaderEmmOverrideRecord>()
  return {
    getEmmOverride: async (path) => records.get(path),
    saveEmmOverride: async (path, overrides, expectedRevision, updatedAt) => {
      const current = records.get(path)
      if ((current?.revision ?? 0) !== expectedRevision) return undefined
      const record = { path, overrides, revision: expectedRevision + 1, updatedAt }
      records.set(path, record)
      return record
    },
  }
}
