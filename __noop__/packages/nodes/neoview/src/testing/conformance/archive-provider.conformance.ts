import { describe, expect, it } from "vitest"
import type { ArchiveProvider } from "../../ports/ArchiveProvider.js"

export type ArchiveProviderConformanceFactory = () => ArchiveProvider | Promise<ArchiveProvider>

export function defineArchiveProviderConformance(name: string, createProvider: ArchiveProviderConformanceFactory): void {
  describe(`${name} ArchiveProvider conformance`, () => {
    it("[neoview.archive.conformance] lists stable descriptors and streams entry bytes", async () => {
      const provider = await createProvider()
      try {
        const entries = await provider.list()
        expect(entries.map((entry) => [entry.path, entry.kind, entry.uncompressedSize])).toEqual([
          ["pages/001.jpg", "file", 5],
          ["pages/002.jpg", "file", 3],
          ["empty", "directory", 0],
        ])
        expect([...await collect(await provider.openEntry(entries[0]!.id))]).toEqual([1, 2, 3, 4, 5])
      } finally {
        await provider.close()
      }
    })

    it("[neoview.archive.conformance] implements the declared range capability", async () => {
      const provider = await createProvider()
      try {
        const [entry] = await provider.list()
        const ranged = provider.openEntry(entry!.id, { range: { start: 1, endExclusive: 4 } })
        if (provider.capabilities.entryRange) {
          expect([...await collect(await ranged)]).toEqual([2, 3, 4])
          await expect(provider.openEntry(entry!.id, { range: { start: -1 } })).rejects.toThrow()
        } else {
          await expect(ranged).rejects.toThrow()
        }
      } finally {
        await provider.close()
      }
    })

    it("[neoview.archive.conformance] rejects pre-cancelled work and use after dispose", async () => {
      const provider = await createProvider()
      const [entry] = await provider.list()
      const controller = new AbortController()
      controller.abort(new Error("cancelled"))
      await expect(provider.openEntry(entry!.id, { signal: controller.signal })).rejects.toThrow("cancelled")
      await provider.close()
      await provider.close()
      await expect(provider.list()).rejects.toThrow("closed")
    })

    it("[neoview.archive.conformance] rejects directories and unknown entry ids", async () => {
      const provider = await createProvider()
      try {
        const entries = await provider.list()
        await expect(provider.openEntry(entries[2]!.id)).rejects.toThrow("not a file")
        await expect(provider.openEntry("missing")).rejects.toThrow("not found")
      } finally {
        await provider.close()
      }
    })
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let byteLength = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    chunks.push(result.value)
    byteLength += result.value.byteLength
  }
  const output = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
