import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createZipFixture, deterministicBytes, type ZipFixture } from "../../../test/fixture-builders/create-zip-fixture.js"
import { createPlatformReaderBookLoader } from "./PlatformReaderBookLoader.js"

const cleanupDirectories: string[] = []
const cleanupArchives: ZipFixture[] = []

afterEach(async () => {
  await Promise.all(cleanupArchives.splice(0).map((fixture) => fixture.cleanup()))
  await Promise.all(cleanupDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("PlatformReaderBookLoader", () => {
  it("[neoview.book.directory] indexes supported direct children with stable natural ordering", async () => {
    const directory = await createDirectoryFixture()
    const loader = createPlatformReaderBookLoader()
    const first = await loader({ kind: "directory", path: directory })
    const second = await loader({ kind: "directory", path: directory })
    try {
      expect(first.pages.map((page) => page.name)).toEqual(["1.avif", "2.jpg", "10.jpg", "clip.mp4"])
      expect(first.pages.map((page) => page.index)).toEqual([0, 1, 2, 3])
      expect(first.pages.map((page) => page.id)).toEqual(second.pages.map((page) => page.id))
      expect(first.pages.map((page) => page.mimeType)).toEqual([
        "image/avif",
        "image/jpeg",
        "image/jpeg",
        "video/mp4",
      ])
      expect(first.pages.some((page) => page.name === "nested.png" || page.name === "notes.txt")).toBe(false)
    } finally {
      await first.close()
      await second.close()
    }
  })

  it("[neoview.book.streaming] opens directory pages as bounded file streams without eager buffering", async () => {
    const directory = await createDirectoryFixture()
    const bytes = deterministicBytes(256 * 1024)
    await writeFile(join(directory, "20.jxl"), bytes)
    const book = await createPlatformReaderBookLoader()({ kind: "directory", path: directory })
    const page = book.pages.find((candidate) => candidate.name === "20.jxl")!
    const source = await page.content.load()
    try {
      const reader = (await source.open()).getReader()
      const first = await reader.read()
      expect(first.done).toBe(false)
      expect(first.value?.byteLength).toBeLessThanOrEqual(64 * 1024)
      expect(first.value).toEqual(bytes.subarray(0, first.value?.byteLength))
      await source.close()
      await expect(reader.read()).rejects.toThrow("closed")
    } finally {
      await source.close()
      await book.close()
    }
  })

  it("[neoview.book.archive] builds naturally ordered pages over the shared ZIP provider", async () => {
    const fixture = await createZipFixture({
      entries: [
        { path: "pages/10.jpg", bytes: Uint8Array.of(10), level: 0 },
        { path: "pages/2.jpg", bytes: Uint8Array.of(2), level: 6 },
        { path: "pages/readme.txt", bytes: Uint8Array.of(99), level: 0 },
        { path: "cover.avif", bytes: Uint8Array.of(1, 2), level: 0 },
      ],
    })
    cleanupArchives.push(fixture)
    const book = await createPlatformReaderBookLoader()({ kind: "archive", path: fixture.path })
    expect(book.pages.map((page) => page.entryPath)).toEqual(["cover.avif", "pages/2.jpg", "pages/10.jpg"])
    const page = book.pages[1]!
    const source = await page.content.load()
    expect(new Uint8Array(await new Response(await source.open()).arrayBuffer())).toEqual(Uint8Array.of(2))
    await source.close()
    const unopened = await page.content.load()
    await book.close()
    await expect(unopened.open()).rejects.toThrow("closed")
  })

  it("[neoview.book.single-image] loads AVIF/JXL metadata and bytes through the same page contract", async () => {
    const directory = await createDirectoryFixture()
    const path = join(directory, "standalone.jxl")
    await writeFile(path, Uint8Array.of(4, 5, 6))
    const book = await createPlatformReaderBookLoader()({ kind: "image", path })
    try {
      expect(book.pages).toHaveLength(1)
      expect(book.pages[0]).toMatchObject({ name: "standalone.jxl", mimeType: "image/jxl", byteLength: 3 })
      const source = await book.pages[0]!.content.load()
      expect(new Uint8Array(await new Response(await source.open()).arrayBuffer())).toEqual(Uint8Array.of(4, 5, 6))
      await source.close()
    } finally {
      await book.close()
    }
  })

  it("[neoview.book.detect] detects directories, archives, images and standalone video from one path entry", async () => {
    const directory = await createDirectoryFixture()
    const loader = createPlatformReaderBookLoader()
    const directoryBook = await loader({ kind: "path", path: directory })
    const imageBook = await loader({ kind: "path", path: join(directory, "1.avif") })
    const mediaBook = await loader({ kind: "path", path: join(directory, "clip.mp4") })
    const archive = await createZipFixture()
    cleanupArchives.push(archive)
    const archiveBook = await loader({ kind: "path", path: archive.path })
    try {
      expect(directoryBook.source.kind).toBe("directory")
      expect(imageBook.source.kind).toBe("image")
      expect(mediaBook.source.kind).toBe("media")
      expect(mediaBook.pages[0]?.mediaKind).toBe("video")
      expect(archiveBook.source.kind).toBe("archive")
    } finally {
      await Promise.all([directoryBook.close(), imageBook.close(), mediaBook.close(), archiveBook.close()])
    }
  })

  it("[neoview.book.cancellation] rejects cancelled and unavailable source kinds without opening providers", async () => {
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))
    const loader = createPlatformReaderBookLoader()
    await expect(loader({ kind: "directory", path: "missing" }, controller.signal)).rejects.toThrow("cancelled")
    await expect(loader({ kind: "document", path: "book.pdf", format: "pdf" })).rejects.toThrow("not available")
    await expect(loader({ kind: "archive", path: "book.rar" })).rejects.toThrow()
  })
})

async function createDirectoryFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-directory-"))
  cleanupDirectories.push(directory)
  await Promise.all([
    writeFile(join(directory, "10.jpg"), Uint8Array.of(10)),
    writeFile(join(directory, "2.jpg"), Uint8Array.of(2)),
    writeFile(join(directory, "1.avif"), Uint8Array.of(1)),
    writeFile(join(directory, "clip.mp4"), Uint8Array.of(3)),
    writeFile(join(directory, "notes.txt"), Uint8Array.of(4)),
    mkdir(join(directory, "subfolder")),
  ])
  await writeFile(join(directory, "subfolder", "nested.png"), Uint8Array.of(5))
  return directory
}
