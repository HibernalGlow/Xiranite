import { describe, expect, it } from "vitest"
import { normalizeArchivePath } from "../../domain/archive/archive-path.js"
import { MemoryArchiveProvider } from "../MemoryArchiveProvider.js"
import { defineArchiveProviderConformance } from "./archive-provider.conformance.js"

defineArchiveProviderConformance("Memory", fixture)

describe("MemoryArchiveProvider", () => {
  it("[neoview.archive.conformance] emits bounded chunks and propagates active cancellation", async () => {
    const provider = fixture()
    const [entry] = await provider.list()
    const controller = new AbortController()
    const stream = await provider.openEntry(entry!.id, { signal: controller.signal })
    const reader = stream.getReader()
    expect((await reader.read()).value?.byteLength).toBe(2)
    controller.abort(new Error("cancelled"))
    await expect(reader.read()).rejects.toThrow("cancelled")
    await provider.close()
  })

  it("[neoview.archive.security] rejects traversal, absolute paths and duplicates", () => {
    expect(() => normalizeArchivePath("../escape.jpg")).toThrow("Unsafe")
    expect(() => normalizeArchivePath("/absolute.jpg")).toThrow("Unsafe")
    expect(() => new MemoryArchiveProvider([{ path: "a.jpg" }, { path: "./a.jpg" }])).toThrow("Duplicate")
  })
})

function fixture(): MemoryArchiveProvider {
  return new MemoryArchiveProvider([
    { path: "pages\\001.jpg", bytes: Uint8Array.of(1, 2, 3, 4, 5) },
    { path: "pages/002.jpg", bytes: Uint8Array.of(6, 7, 8) },
    { path: "empty", kind: "directory" },
  ], { chunkSize: 2 })
}
