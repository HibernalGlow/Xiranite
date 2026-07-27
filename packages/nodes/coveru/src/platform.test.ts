import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js/index-native.js"
import { describe, expect, test } from "vitest"
import { createNodeCoveruRuntime } from "./platform.js"

describe("CoverU ZIP platform", () => {
  test("uses zip.js to list and extract a deflated Unicode entry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-coveru-"))
    const archivePath = join(directory, "book.cbz")
    const outputPath = join(directory, "cover.jpg")
    const bytes = Uint8Array.from({ length: 512 }, (_, index) => index % 17)

    try {
      const writer = new ZipWriter(new Uint8ArrayWriter(), { useCompressionStream: true, useWebWorkers: false })
      await writer.add("pages/001.jpg", new Uint8ArrayReader(bytes), { level: 6, useCompressionStream: true, useWebWorkers: false })
      await writer.add("封面/cover.webp", new Uint8ArrayReader(Uint8Array.of(1, 2, 3)), { level: 0, useCompressionStream: true, useWebWorkers: false })
      await writeFile(archivePath, await writer.close())

      const runtime = createNodeCoveruRuntime()
      await expect(runtime.listArchiveEntries(archivePath)).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "pages/001.jpg", method: 8, size: bytes.byteLength }),
        expect.objectContaining({ path: "封面/cover.webp", method: 0 }),
      ]))
      await runtime.extractArchiveEntry(archivePath, "pages/001.jpg", outputPath)
      await expect(readFile(outputPath)).resolves.toEqual(Buffer.from(bytes))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
