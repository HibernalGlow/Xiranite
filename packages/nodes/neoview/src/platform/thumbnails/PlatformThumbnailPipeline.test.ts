import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createZipFixture } from "../../../test/fixture-builders/create-zip-fixture.js"
import type { ReaderBook } from "../../domain/book/book.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ResourceTaskRequest } from "../../ports/ResourceScheduler.js"
import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import { createPlatformReaderBookLoader } from "../books/PlatformReaderBookLoader.js"
import { FfmpegVideoThumbnailProvider } from "../video/FfmpegVideoThumbnailProvider.js"
import { PlatformThumbnailPipeline, type LibraryThumbnailSource } from "./PlatformThumbnailPipeline.js"

const ffmpegAvailable = spawnSync("ffmpeg", ["-hide_banner", "-version"], { windowsHide: true }).status === 0

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

  it("[neoview.thumbnail.library.describe-scheduler] routes source stat and folder scans through host I/O priorities", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-thumbnail-library-scheduler-"))
    roots.push(root)
    const folder = join(root, "folder")
    const file = join(folder, "cover.png")
    await mkdir(folder)
    await writeFile(file, Uint8Array.of(1, 2, 3))
    const requests: ResourceTaskRequest[] = []
    let activeLeases = 0
    const pipeline = new PlatformThumbnailPipeline({
      resourceScheduler: {
        acquire: async (request) => {
          requests.push({ ...request })
          activeLeases += 1
          let released = false
          return {
            release() {
              if (released) return
              released = true
              activeLeases -= 1
            },
          }
        },
      },
    })
    await pipeline.describeLibrarySource(file, "file")
    await pipeline.describeLibrarySource(folder, "folder", undefined, 4, "background")
    expect(requests).toEqual([
      { resource: "io", kind: "neoview.thumbnail.source-describe", priority: "view" },
      { resource: "io", kind: "neoview.thumbnail.source-describe", priority: "background" },
      { resource: "io", kind: "neoview.thumbnail.folder-representative", priority: "background" },
    ])
    expect(activeLeases).toBe(0)
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

  it("[neoview.thumbnail.library-refresh] bypasses every old cache source and waits for atomic persistence", async () => {
    const old = fixtureWebp(2)
    const refreshed = fixtureWebp(9)
    let commit!: () => void
    const committed = new Promise<void>((resolve) => { commit = resolve })
    const get = vi.fn(async () => ({
      bytes: old,
      contentType: "image/webp",
      sourceSize: 100,
      date: "2099-01-01 00:00:00",
    }))
    const getCached = vi.fn(async () => ({ bytes: old, contentType: "image/webp" as const }))
    const transform = vi.fn(async () => ({ contentType: "image/webp", stream: byteStream(refreshed) }))
    const put = vi.fn(async () => committed)
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(fixturePage("D:/library/book/cover.png")),
      thumbnailStore: { get, put },
      loadSystemThumbnailProvider: async () => ({ getCached }),
      loadImageTransformer: async () => ({ transform }),
    })
    const descriptor = librarySource("file", "D:/library/book.cbz", 100)
    let settled = false
    const refreshing = pipeline.refreshLibrary(descriptor, { contextId: "library:refresh" }).finally(() => { settled = true })
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    expect(get).not.toHaveBeenCalled()
    expect(getCached).not.toHaveBeenCalled()
    expect(transform).toHaveBeenCalledOnce()
    commit()
    await expect(refreshing).resolves.toMatchObject({ bytes: refreshed })

    const normal = pipeline.acquireLibrary(descriptor, { contextId: "library:after-refresh" })
    await expect(normal.ready).resolves.toMatchObject({ bytes: refreshed })
    expect(get).not.toHaveBeenCalled()
    normal.release()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-refresh-rollback] keeps the old database value addressable when replacement commit fails", async () => {
    const old = fixtureWebp(3)
    const refreshed = fixtureWebp(8)
    const get = vi.fn(async () => ({
      bytes: old,
      contentType: "image/webp",
      sourceSize: 100,
      date: "2099-01-01 00:00:00",
    }))
    const recordFailure = vi.fn(async () => undefined)
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(fixturePage("D:/library/book/cover.png")),
      thumbnailStore: { get, put: async () => { throw new Error("database is busy") }, recordFailure },
      loadImageTransformer: async () => ({
        transform: async () => ({ contentType: "image/webp", stream: byteStream(refreshed) }),
      }),
    })
    const descriptor = librarySource("file", "D:/library/book.cbz", 100)
    await expect(pipeline.refreshLibrary(descriptor, { contextId: "library:refresh-failed" }))
      .rejects.toThrow("replacement was not committed")
    expect(recordFailure).not.toHaveBeenCalled()

    const normal = pipeline.acquireLibrary(descriptor, { contextId: "library:old-remains" })
    await expect(normal.ready).resolves.toMatchObject({ bytes: old, cacheable: false })
    expect(get).toHaveBeenCalledOnce()
    normal.release()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-refresh-isolation] invalidates only the refreshed source L1", async () => {
    const transform = vi.fn(async () => ({ contentType: "image/webp", stream: byteStream(fixtureWebp(6)) }))
    const bookLoader = vi.fn(async () => fixtureBook(fixturePage("D:/library/page.png")))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader,
      thumbnailStore: { get: async () => undefined, put: async () => undefined },
      loadImageTransformer: async () => ({ transform }),
    })
    const leftSource = librarySource("file", "D:/library/left.cbz", 100)
    const rightSource = librarySource("file", "D:/library/right.cbz", 100)
    const left = pipeline.acquireLibrary(leftSource, { contextId: "library:left" })
    const right = pipeline.acquireLibrary(rightSource, { contextId: "library:right" })
    await Promise.all([left.ready, right.ready])
    left.release()
    right.release()

    await pipeline.refreshLibrary(leftSource, { contextId: "library:left-refresh" })
    const rightAgain = pipeline.acquireLibrary(rightSource, { contextId: "library:right-again" })
    await rightAgain.ready
    rightAgain.release()

    expect(bookLoader).toHaveBeenCalledTimes(3)
    expect(transform).toHaveBeenCalledTimes(3)
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library.external-epoch] bypasses a generated L1 entry after another database writer commits", async () => {
    const generated = fixtureWebp(7)
    const external = fixtureWebp(8)
    let revision = 0
    const get = vi.fn(async () => revision === 0 ? undefined : {
      bytes: external,
      contentType: "image/webp",
      sourceSize: 100,
      date: "2026-07-16 00:00:00",
    })
    const transform = vi.fn(async () => ({ contentType: "image/webp", stream: byteStream(generated) }))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(fixturePage("D:/library/book/cover.png")),
      thumbnailStore: { revision: () => revision, get, put: async () => undefined },
      loadImageTransformer: async () => ({ transform }),
    })
    const descriptor = librarySource("file", "D:/library/book.cbz", 100)
    const first = pipeline.acquireLibrary(descriptor, { contextId: "library:epoch-1" })
    await expect(first.ready).resolves.toMatchObject({ bytes: generated })
    first.release()

    revision = 1
    const second = pipeline.acquireLibrary(descriptor, { contextId: "library:epoch-2" })
    await expect(second.ready).resolves.toMatchObject({ bytes: external, cacheable: false })
    second.release()
    expect(transform).toHaveBeenCalledOnce()
    expect(get).toHaveBeenCalledTimes(3)
    await pipeline.dispose()
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

  it("[neoview.thumbnail.database-read-pipeline] cooperatively chunks a maximum-size visible prewarm", async () => {
    const sources = Array.from({ length: 130 }, (_, index) => librarySource("file", `D:/library/book-${index}.cbz`, 100))
    const getMany = vi.fn(async (keys: readonly string[]) => new Map(keys.map((key) => [key, {
      bytes: fixtureWebp(Number(key.match(/(\d+)\.cbz$/)?.[1]) & 0xff),
      contentType: "image/webp",
      sourceSize: 100,
      date: "2026-07-18 00:00:00",
    }])))
    const schedulerRequests: ResourceTaskRequest[] = []
    const pipeline = new PlatformThumbnailPipeline({
      thumbnailStore: { get: async () => undefined, getMany },
      resourceScheduler: {
        acquire: async (request) => {
          schedulerRequests.push({ ...request })
          return { release() {} }
        },
      },
    })
    await expect(pipeline.prewarmLibrary(sources)).resolves.toEqual({
      requested: 130,
      databaseHits: 130,
      primed: 130,
    })
    expect(getMany.mock.calls.map(([keys]) => keys.length)).toEqual([64, 64, 2])
    expect(schedulerRequests).toEqual(Array.from({ length: 3 }, () => ({
      resource: "io",
      kind: "neoview.thumbnail.database-read",
      priority: "view",
    })))
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

  it("[neoview.thumbnail.folder-mosaic] composes a folder preview without overwriting the legacy cover key", async () => {
    const page = fixturePage("D:/library/folder/001.png")
    const closeBook = vi.fn(async () => undefined)
    const compose = vi.fn(async () => ({ bytes: fixtureWebp(12), contentType: "image/webp" as const }))
    const put = vi.fn(async () => undefined)
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(page, closeBook),
      thumbnailStore: { get: async () => undefined, put },
      loadMosaicImageComposer: async () => ({ compose }),
    })
    const descriptor = { ...librarySource("folder", "D:/library/folder"), previewCount: 4 as const, contentVersion: "folder:mosaic:library-mosaic-4-v1" }
    const lease = pipeline.acquireLibrary(descriptor, { contextId: "folder:mosaic" })
    await expect(lease.ready).resolves.toMatchObject({ bytes: fixtureWebp(12), contentType: "image/webp" })
    expect(compose).toHaveBeenCalledWith(expect.any(Array), { count: 4, size: 416, quality: 82 }, expect.any(AbortSignal), expect.objectContaining({ kind: "neoview.thumbnail.folder-mosaic" }))
    expect(put).not.toHaveBeenCalled()
    lease.release()
    await pipeline.dispose()
    expect(closeBook).toHaveBeenCalledOnce()
  })

  it("[neoview.thumbnail.folder-mosaic-fallback] reuses a legacy folder cover when no direct images can form a mosaic", async () => {
    const legacyCover = fixtureWebp(8)
    const closeBook = vi.fn(async () => undefined)
    const compose = vi.fn()
    const get = vi.fn(async () => ({
      bytes: legacyCover,
      contentType: "image/webp" as const,
      date: "2099-01-01 00:00:00",
    }))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => ({ ...fixtureBook(fixturePage("D:/unused.png"), closeBook), pages: [] }),
      thumbnailStore: { get },
      loadMosaicImageComposer: async () => ({ compose }),
    })
    const descriptor = {
      ...librarySource("folder", "D:/library/archive-folder"),
      previewCount: 4 as const,
      contentVersion: "folder:directory:1700000000000:empty:library-mosaic-4-v1",
    }
    const lease = pipeline.acquireLibrary(descriptor, { contextId: "folder:mosaic-fallback" })

    await expect(lease.ready).resolves.toMatchObject({ bytes: legacyCover, contentType: "image/webp" })
    expect(get).toHaveBeenCalledWith(descriptor.path, "folder")
    expect(compose).not.toHaveBeenCalled()
    lease.release()
    await pipeline.dispose()
    expect(closeBook).toHaveBeenCalledOnce()
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

  it("[neoview.thumbnail.windows.folder-bypass] generates folder covers without querying Explorer", async () => {
    const page = fixturePage("D:/library/folder/cover.png")
    const generated = fixtureWebp(6)
    const getCached = vi.fn(async () => ({ bytes: fixtureWebp(2), contentType: "image/webp" as const }))
    const bookLoader = vi.fn(async () => fixtureBook(page))
    const transform = vi.fn(async () => ({ contentType: "image/webp" as const, stream: byteStream(generated) }))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader,
      loadSystemThumbnailProvider: async () => ({ getCached }),
      loadImageTransformer: async () => ({ transform }),
    })
    const descriptor = librarySource("folder", "D:/library/folder")
    const lease = pipeline.acquireLibrary(descriptor, { contextId: "library:folder" })
    await expect(lease.ready).resolves.toMatchObject({ bytes: generated, contentType: "image/webp" })
    expect(getCached).not.toHaveBeenCalled()
    expect(bookLoader).toHaveBeenCalledOnce()
    expect(transform).toHaveBeenCalledOnce()
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

  it("[neoview.thumbnail.video.archive-entry] streams an archive page into ffmpeg and closes its PageSource", async () => {
    const page = fixtureVideoPage("D:/books/videos.cbz")
    page.entryPath = "clips/clip.mp4"
    page.thumbnailSource = { key: "D:/books/videos.cbz::clips/clip.mp4#0", category: "file" }
    const generated = fixtureWebp(10)
    const generate = vi.fn(async (request: { sourceStream?: ReadableStream<Uint8Array> }) => {
      expect(request.sourceStream).toBeInstanceOf(ReadableStream)
      const reader = request.sourceStream!.getReader()
      await expect(reader.read()).resolves.toMatchObject({ value: Uint8Array.of(1, 2, 3), done: false })
      reader.releaseLock()
      return { bytes: generated, contentType: "image/webp" as const }
    })
    const put = vi.fn(async () => undefined)
    const pipeline = new PlatformThumbnailPipeline({
      thumbnailStore: { get: async () => undefined, put },
      loadVideoThumbnailProvider: async () => ({ generate }),
    })
    expect(pipeline.supportsPage(page)).toBe(true)
    const lease = pipeline.acquirePage(page, { contextId: "reader:archive-video" })
    await expect(lease.ready).resolves.toMatchObject({ bytes: generated, contentType: "image/webp" })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      sourceStream: expect.any(ReadableStream),
      maxEdge: 320,
      quality: 78,
      priority: "interactive",
      ownerId: "reader:archive-video",
    }), expect.any(AbortSignal))
    expect(pageContentClose(page)).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ key: page.thumbnailSource.key, bytes: generated }))
    lease.release()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.video.archive-cover] reuses the archive stream path for a library cover", async () => {
    const page = fixtureVideoPage("D:/books/videos.cbz")
    page.entryPath = "clips/clip.mp4"
    page.thumbnailSource = { key: "D:/books/videos.cbz::clips/clip.mp4#0", category: "file" }
    const closeBook = vi.fn(async () => undefined)
    const generate = vi.fn(async () => ({ bytes: fixtureWebp(11), contentType: "image/webp" as const }))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(page, closeBook),
      loadVideoThumbnailProvider: async () => ({ generate }),
    })
    const lease = pipeline.acquireLibrary(librarySource("file", "D:/books/videos.cbz", 1_024), { contextId: "library:archive-video" })
    await expect(lease.ready).resolves.toMatchObject({ bytes: fixtureWebp(11) })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      sourceStream: expect.any(ReadableStream),
      maxEdge: 416,
      priority: "view",
      ownerId: "library:archive-video",
    }), expect.any(AbortSignal))
    expect(pageContentClose(page)).toHaveBeenCalledOnce()
    expect(closeBook).toHaveBeenCalledOnce()
    lease.release()
    await pipeline.dispose()
  })

  it.skipIf(!ffmpegAvailable)("[neoview.thumbnail.video.archive-e2e] generates a real CBZ video cover without materializing the entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-thumbnail-archive-video-"))
    roots.push(root)
    const videoPath = join(root, "sample.mp4")
    const generated = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=15", "-t", "1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath,
    ], { windowsHide: true })
    expect(generated.status).toBe(0)
    const archive = await createZipFixture({
      name: "video.cbz",
      entries: [{ path: "clips/sample.mp4", bytes: await readFile(videoPath), level: 0 }],
    })
    roots.push(archive.directory)
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: createPlatformReaderBookLoader(),
      loadVideoThumbnailProvider: async () => new FfmpegVideoThumbnailProvider(),
    })
    const descriptor = librarySource("file", archive.path, archive.bytes.byteLength)
    const lease = pipeline.acquireLibrary(descriptor, { contextId: "library:archive-video-e2e" })
    const result = await lease.ready
    expect(result.bytes.subarray(0, 4)).toEqual(Uint8Array.from([0x52, 0x49, 0x46, 0x46]))
    expect(new TextDecoder().decode(result.bytes.subarray(8, 12))).toBe("WEBP")
    lease.release()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.video.archive-cancel] aborts active archive video generation and closes the source", async () => {
    const page = fixtureVideoPage("D:/books/videos.cbz")
    page.entryPath = "clips/clip.mp4"
    page.thumbnailSource = { key: "D:/books/videos.cbz::clips/clip.mp4#0", category: "file" }
    const generate = vi.fn((_request: unknown, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
    }))
    const pipeline = new PlatformThumbnailPipeline({
      loadVideoThumbnailProvider: async () => ({ generate }),
    })
    const lease = pipeline.acquirePage(page, { contextId: "reader:archive-video-cancel" })
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    lease.release()
    await expect(lease.ready).rejects.toMatchObject({ name: "AbortError" })
    await vi.waitFor(() => expect(pageContentClose(page)).toHaveBeenCalledOnce())
    await pipeline.dispose()
  })
})

function librarySource(kind: "file" | "folder", path: string, sourceSize?: number): LibraryThumbnailSource {
  return { kind, path, sourceSize, modifiedAtMs: 1_700_000_000_000, previewCount: 1, contentVersion: `${kind}:${sourceSize ?? "directory"}:1700000000000:library-cover-v1` }
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
  const content = {
    close,
    load: async () => ({
      rangeSupported: true,
      open: async () => byteStream(Uint8Array.of(1, 2, 3)),
      close,
      [Symbol.asyncDispose]: close,
    }),
  }
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
    content,
  }
}

function pageContentClose(page: ReaderPage) {
  return (page.content as PageContentFixture).close
}

interface PageContentFixture {
  close: ReturnType<typeof vi.fn>
}

function fixtureWebp(fill: number): Uint8Array {
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, fill])
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } })
}
