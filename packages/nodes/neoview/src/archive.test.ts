import { describe, expect, it } from "vitest"
import { MemoryArchiveProvider, normalizeArchivePath, type ArchiveProvider } from "./archive.js"

describe("ArchiveProvider conformance", () => {
  it("[neoview.archive.conformance] lists stable descriptors and streams bounded chunks", async () => {
    const provider = fixture()
    const entries = await provider.list()
    expect(entries.map((entry) => [entry.path, entry.kind, entry.uncompressedSize])).toEqual([
      ["pages/001.jpg", "file", 5],
      ["pages/002.jpg", "file", 3],
      ["empty", "directory", 0],
    ])
    const chunks = await collectChunks(await provider.openEntry(entries[0]!.id))
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([2, 2, 1])
    expect([...concat(chunks)]).toEqual([1, 2, 3, 4, 5])
  })

  it("[neoview.archive.conformance] supports valid ranges and rejects invalid ranges", async () => {
    const provider = fixture()
    const [entry] = await provider.list()
    expect([...await collect(await provider.openEntry(entry!.id, { range: { start: 1, endExclusive: 4 } }))]).toEqual([2, 3, 4])
    await expect(provider.openEntry(entry!.id, { range: { start: -1 } })).rejects.toThrow("Invalid archive byte range")
  })

  it("[neoview.archive.conformance] propagates cancellation and rejects use after dispose", async () => {
    const provider = fixture()
    const [entry] = await provider.list()
    const controller = new AbortController()
    const stream = await provider.openEntry(entry!.id, { signal: controller.signal })
    const reader = stream.getReader()
    expect((await reader.read()).done).toBe(false)
    controller.abort(new Error("cancelled"))
    await expect(reader.read()).rejects.toThrow("cancelled")
    await provider.close()
    await provider.close()
    await expect(provider.list()).rejects.toThrow("closed")
  })

  it("[neoview.archive.security] rejects traversal, absolute paths and duplicates", () => {
    expect(() => normalizeArchivePath("../escape.jpg")).toThrow("Unsafe")
    expect(() => normalizeArchivePath("/absolute.jpg")).toThrow("Unsafe")
    expect(() => new MemoryArchiveProvider([{ path: "a.jpg" }, { path: "./a.jpg" }])).toThrow("Duplicate")
  })

  it("[neoview.archive.conformance] rejects directories and unknown entry ids", async () => {
    const provider = fixture()
    const entries = await provider.list()
    await expect(provider.openEntry(entries[2]!.id)).rejects.toThrow("not a file")
    await expect(provider.openEntry("missing")).rejects.toThrow("not found")
  })
})

function fixture(): ArchiveProvider {
  return new MemoryArchiveProvider([
    { path: "pages\\001.jpg", bytes: Uint8Array.of(1, 2, 3, 4, 5) },
    { path: "pages/002.jpg", bytes: Uint8Array.of(6, 7, 8) },
    { path: "empty", kind: "directory" },
  ], { chunkSize: 2 })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return concat(await collectChunks(stream))
}

async function collectChunks(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const result = await reader.read()
    if (result.done) return chunks
    chunks.push(result.value)
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
