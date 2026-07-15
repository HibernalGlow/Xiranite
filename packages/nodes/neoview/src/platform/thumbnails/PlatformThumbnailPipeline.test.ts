import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderBook } from "../../domain/book/book.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import { PlatformThumbnailPipeline, type LibraryThumbnailSource } from "./PlatformThumbnailPipeline.js"

describe("PlatformThumbnailPipeline", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("[neoview.thumbnail.library.describe] canonicalizes file and folder sources with stat fingerprints", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-thumbnail-library-"))
    roots.push(root)
    const folder = join(root, "folder")
    const file = join(folder, "cover.png")
    await mkdir(folder)
    await writeFile(file, Uint8Array.of(1, 2, 3))
    const pipeline = new PlatformThumbnailPipeline()
    const fileSource = await pipeline.describeLibrarySource(file, "file")
    const folderSource = await pipeline.describeLibrarySource(folder, "folder")
    expect(fileSource).toMatchObject({ kind: "file", sourceSize: 3 })
    expect(fileSource.path).toContain("cover.png")
    expect(folderSource).toMatchObject({ kind: "folder", sourceSize: undefined })
    expect(folderSource.representativeVersion).toContain("cover.png:3:")
    expect(fileSource.contentVersion).toContain("library-cover-v1")
    await writeFile(file, Uint8Array.of(1, 2, 3, 4, 5))
    const changedFolder = await pipeline.describeLibrarySource(folder, "folder")
    expect(changedFolder.contentVersion).not.toBe(folderSource.contentVersion)
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library.singleflight] shares file cover generation and persists one library WebP", async () => {
    const page = fixturePage("D:/library/book/cover.png")
    const closeBook = vi.fn(async () => undefined)
    const bookLoader = vi.fn(async () => fixtureBook(page, closeBook))
    const transform = vi.fn(async () => ({ contentType: "image/webp", stream: byteStream(fixtureWebp(7)) }))
    const put = vi.fn(async () => undefined)
    const store: ReaderThumbnailStore = { get: async () => undefined, put }
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader,
      thumbnailStore: store,
      loadImageTransformer: async () => ({ transform }),
    })
    const descriptor = librarySource("file", "D:/library/book.cbz", 100)
    const first = pipeline.acquireLibrary(descriptor, { contextId: "library:one", generation: 1 })
    const second = pipeline.acquireLibrary(descriptor, { contextId: "library:two", generation: 1 })
    const [left, right] = await Promise.all([first.ready, second.ready])
    expect(left.bytes).toEqual(right.bytes)
    expect(bookLoader).toHaveBeenCalledOnce()
    expect(transform).toHaveBeenCalledOnce()
    expect(transform.mock.calls[0]?.[3]).toMatchObject({ priority: "view", kind: "neoview.thumbnail.generate" })
    expect(put).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ key: descriptor.path, category: "file" }))
    first.release()
    second.release()
    await pipeline.dispose()
    expect(closeBook).toHaveBeenCalledOnce()
  })

  it("[neoview.thumbnail.library.prewarm] batches visible file and folder hits into L1 by category", async () => {
    const file = librarySource("file", "D:/library/book.cbz", 100)
    const folder = librarySource("folder", "D:/library/series")
    const fileBytes = fixtureWebp(4)
    const folderBytes = fixtureWebp(5)
    const get = vi.fn(async () => undefined)
    const getMany = vi.fn(async (keys: readonly string[], category: "file" | "folder") => new Map(keys.map((key) => [key, {
      bytes: category === "file" ? fileBytes : folderBytes,
      contentType: "image/webp",
      sourceSize: category === "file" ? 100 : undefined,
      date: "2024-01-01 00:00:00",
    }])))
    const pipeline = new PlatformThumbnailPipeline({ thumbnailStore: { get, getMany } })

    await expect(pipeline.prewarmLibrary([file, folder, file])).resolves.toEqual({
      requested: 3,
      databaseHits: 3,
      primed: 2,
    })
    expect(getMany).toHaveBeenCalledTimes(2)
    expect(getMany).toHaveBeenCalledWith([file.path], "file")
    expect(getMany).toHaveBeenCalledWith([folder.path], "folder")

    const fileLease = pipeline.acquireLibrary(file, { contextId: "library:prewarm" })
    const folderLease = pipeline.acquireLibrary(folder, { contextId: "library:prewarm" })
    await expect(fileLease.ready).resolves.toMatchObject({ bytes: fileBytes, cacheable: false })
    await expect(folderLease.ready).resolves.toMatchObject({ bytes: folderBytes, cacheable: false })
    expect(get).not.toHaveBeenCalled()
    fileLease.release()
    folderLease.release()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.folder.reuse] reuses the representative file WebP without another decode", async () => {
    const page = fixturePage("D:/library/folder/001.png")
    const representative = fixtureWebp(9)
    const get = vi.fn(async (key: string, category: "file" | "folder") => {
      if (key === page.thumbnailSource?.key && category === "file") {
        return { bytes: representative, contentType: "image/webp", sourceSize: page.byteLength }
      }
      return undefined
    })
    const put = vi.fn(async () => undefined)
    const transform = vi.fn()
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(page),
      thumbnailStore: { get, put },
      loadImageTransformer: async () => ({ transform }),
    })
    const descriptor = librarySource("folder", "D:/library/folder")
    const lease = pipeline.acquireLibrary(descriptor, { contextId: "folder:one" })
    await expect(lease.ready).resolves.toMatchObject({ bytes: representative, contentType: "image/webp" })
    expect(transform).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ key: descriptor.path, category: "folder", bytes: representative }))
    lease.release()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.windows.page] prefers a cached system thumbnail before image decoding", async () => {
    const page = fixturePage("D:/library/page.png")
    page.sourcePath = "D:/library/page.png"
    const cached = fixtureWebp(3)
    const getCached = vi.fn(async () => ({ bytes: cached, contentType: "image/webp" as const }))
    const transform = vi.fn()
    const put = vi.fn(async () => undefined)
    const pipeline = new PlatformThumbnailPipeline({
      thumbnailStore: { get: async () => undefined, put },
      loadSystemThumbnailProvider: async () => ({ getCached }),
      loadImageTransformer: async () => ({ transform }),
    })
    const lease = pipeline.acquirePage(page, { contextId: "reader:system-cache" })
    await expect(lease.ready).resolves.toMatchObject({ bytes: cached, contentType: "image/webp" })
    expect(getCached).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: "D:/library/page.png",
      maxEdge: 320,
      quality: 78,
      priority: "interactive",
    }), expect.any(AbortSignal))
    expect(transform).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ key: "D:/library/page.png", bytes: cached }))
    lease.release()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.windows.folder] uses a cached Explorer folder cover before opening the directory", async () => {
    const cached = fixtureWebp(2)
    const getCached = vi.fn(async () => ({ bytes: cached, contentType: "image/webp" as const }))
    const bookLoader = vi.fn()
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader,
      loadSystemThumbnailProvider: async () => ({ getCached }),
    })
    const descriptor = librarySource("folder", "D:/library/folder")
    const lease = pipeline.acquireLibrary(descriptor, { contextId: "library:folder" })
    await expect(lease.ready).resolves.toMatchObject({ bytes: cached, contentType: "image/webp" })
    expect(getCached).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: "D:/library/folder",
      maxEdge: 416,
      quality: 82,
      priority: "background",
    }), expect.any(AbortSignal))
    expect(bookLoader).not.toHaveBeenCalled()
    lease.release()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.video.page] generates and persists a video page through the shared coordinator", async () => {
    const page = fixtureVideoPage("D:/videos/clip.mp4")
    const generated = fixtureWebp(6)
    const generate = vi.fn(async () => ({ bytes: generated, contentType: "image/webp" as const }))
    const put = vi.fn(async () => undefined)
    const pipeline = new PlatformThumbnailPipeline({
      thumbnailStore: { get: async () => undefined, put },
      loadVideoThumbnailProvider: async () => ({ generate }),
    })
    const lease = pipeline.acquirePage(page, { contextId: "reader:video" })
    await expect(lease.ready).resolves.toMatchObject({ bytes: generated, contentType: "image/webp" })
    expect(generate).toHaveBeenCalledWith({
      sourcePath: "D:/videos/clip.mp4",
      maxEdge: 320,
      quality: 78,
      priority: "interactive",
      ownerId: "reader:video",
    }, expect.any(AbortSignal))
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ key: "D:/videos/clip.mp4", category: "file", bytes: generated }))
    lease.release()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.video.file-cover] uses the same provider for library video covers at view priority", async () => {
    const page = fixtureVideoPage("D:/videos/clip.mp4")
    const generated = fixtureWebp(4)
    const generate = vi.fn(async () => ({ bytes: generated, contentType: "image/webp" as const }))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(page),
      loadVideoThumbnailProvider: async () => ({ generate }),
    })
    const lease = pipeline.acquireLibrary(librarySource("file", "D:/videos/clip.mp4", 99), { contextId: "library:video" })
    await expect(lease.ready).resolves.toMatchObject({ bytes: generated })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ maxEdge: 416, priority: "view", ownerId: "library:video" }), expect.any(AbortSignal))
    lease.release()
    await pipeline.dispose()
  })
})

function librarySource(kind: "file" | "folder", path: string, sourceSize?: number): LibraryThumbnailSource {
  return { kind, path, sourceSize, modifiedAtMs: 1_700_000_000_000, contentVersion: `${kind}:${sourceSize ?? "directory"}:1700000000000:library-cover-v1` }
}

function fixtureBook(page: ReaderPage, close = vi.fn(async () => undefined)): ReaderBook {
  return {
    id: "book-1",
    source: { kind: "path", path: "opaque" },
    displayName: "Fixture",
    pages: [page],
    close,
    [Symbol.asyncDispose]: close,
  }
}

function fixturePage(key: string): ReaderPage {
  const close = vi.fn(async () => undefined)
  const source: PageSource = {
    rangeSupported: false,
    open: async () => byteStream(Uint8Array.of(1, 2, 3)),
    close,
    [Symbol.asyncDispose]: close,
  }
  return {
    id: "page-1",
    index: 0,
    name: "cover.png",
    sourcePath: "opaque",
    thumbnailSource: { key, category: "file" },
    mediaKind: "image",
    mimeType: "image/png",
    byteLength: 3,
    contentVersion: "page-v1",
    content: { load: async () => source },
  }
}

function fixtureVideoPage(path: string): ReaderPage {
  const close = vi.fn(async () => undefined)
  return {
    id: "video-1",
    index: 0,
    name: "clip.mp4",
    sourcePath: path,
    thumbnailSource: { key: path, category: "file" },
    mediaKind: "video",
    mimeType: "video/mp4",
    byteLength: 99,
    contentVersion: "video-v1",
    content: {
      load: async () => ({
        rangeSupported: true,
        open: async () => byteStream(Uint8Array.of(1, 2, 3)),
        close,
        [Symbol.asyncDispose]: close,
      }),
    },
  }
}

function fixtureWebp(fill: number): Uint8Array {
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, fill])
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } })
}
