import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderBook } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { PlatformThumbnailPipeline } from "../thumbnails/PlatformThumbnailPipeline.js"
import { LibraryThumbnailRoute } from "./LibraryThumbnailRoute.js"

describe("LibraryThumbnailRoute", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("[neoview.thumbnail.library.http] returns opaque capability URLs and preserves visited assets across context generations", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-thumbnail-route-"))
    roots.push(root)
    const sourcePath = join(root, "private-cover.png")
    await writeFile(sourcePath, Uint8Array.of(1, 2, 3))
    const generated = fixtureWebp(5)
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(sourcePath),
      loadImageTransformer: async () => ({
        transform: async () => ({ contentType: "image/webp", stream: byteStream(generated) }),
      }),
    })
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const prewarmLibrary = vi.spyOn(pipeline, "prewarmLibrary")

    expect((await route.handle(registerRequest(sourcePath, 1, false)))?.status).toBe(401)
    const registered = (await route.handle(registerRequest(sourcePath, 1, true)))!
    expect(registered.status).toBe(201)
    const body = await registered.json() as { items: Array<{ id: string; thumbnailUrl: string; contentVersion: string }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.id).toBe("cover")
    expect(body.items[0]?.thumbnailUrl).not.toContain(encodeURIComponent(sourcePath))
    expect(body.items[0]?.thumbnailUrl).not.toContain("private-cover")
    expect(prewarmLibrary).toHaveBeenCalledOnce()
    expect(prewarmLibrary.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ path: sourcePath, kind: "file" })])

    const thumbnail = (await route.handle(new Request(body.items[0]!.thumbnailUrl)))!
    expect(thumbnail.status).toBe(200)
    expect(thumbnail.headers.get("content-type")).toBe("image/webp")
    expect(new Uint8Array(await thumbnail.arrayBuffer())).toEqual(generated)

    const partiallyValid = await route.handle(registrationRequest([
      { id: "valid", path: sourcePath, kind: "file", previewCount: 1 },
      { id: "missing", path: join(root, "missing.png"), kind: "file", previewCount: 1 },
    ], 2, true))
    expect(partiallyValid?.status).toBe(201)
    expect(await partiallyValid?.json()).toEqual(expect.objectContaining({
      generation: 2,
      items: [expect.objectContaining({ id: "valid" })],
    }))
    expect((await route.handle(new Request(body.items[0]!.thumbnailUrl)))?.status).toBe(200)

    const replaced = (await route.handle(registerRequest(sourcePath, 2, true)))!
    expect(replaced.status).toBe(201)
    const replacedBody = await replaced.json() as { items: Array<{ thumbnailUrl: string }> }
    expect(replacedBody.items[0]?.thumbnailUrl).toBe(body.items[0]?.thumbnailUrl)
    expect((await route.handle(new Request(body.items[0]!.thumbnailUrl)))?.status).toBe(200)
    expect((await route.handle(registerRequest(sourcePath, 1, true)))?.status).toBe(409)

    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library.release] revokes every asset capability in the released context", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-thumbnail-release-"))
    roots.push(root)
    const sourcePath = join(root, "cover.png")
    await writeFile(sourcePath, Uint8Array.of(1))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(sourcePath),
      loadImageTransformer: async () => ({ transform: async () => ({ contentType: "image/webp", stream: byteStream(fixtureWebp(8)) }) }),
    })
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const registered = (await route.handle(registerRequest(sourcePath, 0, true)))!
    const body = await registered.json() as { items: Array<{ thumbnailUrl: string }> }
    const released = await route.handle(new Request("http://127.0.0.1:41000/reader/library/contexts/library%3Atest?token=secret", { method: "DELETE" }))
    expect(released?.status).toBe(204)
    expect((await route.handle(new Request(body.items[0]!.thumbnailUrl)))?.status).toBe(404)
    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-register-refresh] refreshes only the explicitly marked visible source", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-thumbnail-register-refresh-"))
    roots.push(root)
    const sourcePath = join(root, "cover.png")
    await writeFile(sourcePath, Uint8Array.of(1))
    const pipeline = new PlatformThumbnailPipeline()
    const refreshLibrary = vi.spyOn(pipeline, "refreshLibrary").mockResolvedValue({
      bytes: fixtureWebp(9),
      contentType: "image/webp",
      version: "refreshed",
    })
    const prewarmLibrary = vi.spyOn(pipeline, "prewarmLibrary")
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const initial = (await route.handle(registerRequest(sourcePath, 0, true)))!
    const initialUrl = ((await initial.json()) as { items: Array<{ thumbnailUrl: string }> }).items[0]!.thumbnailUrl
    prewarmLibrary.mockClear()

    const response = await route.handle(registerRequest(sourcePath, 1, true, "file", 1, true))
    const refreshUrl = ((await response!.clone().json()) as { items: Array<{ thumbnailUrl: string }> }).items[0]!.thumbnailUrl

    expect(response?.status).toBe(201)
    expect(refreshUrl).not.toBe(initialUrl)
    expect(refreshLibrary).toHaveBeenCalledOnce()
    expect(refreshLibrary.mock.calls[0]?.[0]).toMatchObject({ path: sourcePath, kind: "file" })
    expect(prewarmLibrary).toHaveBeenCalledWith([], { signal: expect.any(AbortSignal) })
    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library.prewarm-fallback] keeps registration available when batch cache lookup fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-thumbnail-prewarm-fallback-"))
    roots.push(root)
    const sourcePath = join(root, "cover.png")
    await writeFile(sourcePath, Uint8Array.of(1))
    const pipeline = new PlatformThumbnailPipeline({
      thumbnailStore: {
        get: async () => undefined,
        getMany: async () => { throw new Error("database is busy") },
      },
    })
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })

    const response = await route.handle(registerRequest(sourcePath, 0, true))

    expect(response?.status).toBe(201)
    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library.cancellation] preserves active asset demand across visible batches", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-thumbnail-cancel-"))
    roots.push(root)
    const sourcePath = join(root, "cover.png")
    await writeFile(sourcePath, Uint8Array.of(1))
    let transformSignal: AbortSignal | undefined
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(sourcePath),
      loadImageTransformer: async () => ({
        transform: async (_input, _request, signal) => {
          transformSignal = signal
          return {
            contentType: "image/webp",
            stream: new ReadableStream<Uint8Array>({
              start(controller) {
                signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true })
              },
            }),
          }
        },
      }),
    })
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const first = (await route.handle(registerRequest(sourcePath, 1, true)))!
    const firstBody = await first.json() as { items: Array<{ thumbnailUrl: string }> }
    const pending = route.handle(new Request(firstBody.items[0]!.thumbnailUrl))
    await vi.waitFor(() => expect(transformSignal).toBeInstanceOf(AbortSignal))
    const replacementRegistration = (await route.handle(registerRequest(sourcePath, 2, true)))!
    expect(replacementRegistration.status).toBe(201)
    const replacementBody = await replacementRegistration.json() as { items: Array<{ thumbnailUrl: string }> }
    const replacement = route.handle(new Request(replacementBody.items[0]!.thumbnailUrl))
    await vi.waitFor(() => expect(transformSignal?.aborted).toBe(false))
    expect(transformSignal?.aborted).toBe(false)
    route.close()
    expect((await pending)?.status).toBe(410)
    expect((await replacement)?.status).toBe(410)
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-register-latency] publishes asset URLs without awaiting batch prewarm", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-thumbnail-latency-"))
    roots.push(root)
    const sourcePath = join(root, "cover.png")
    await writeFile(sourcePath, Uint8Array.of(1))
    const pipeline = new PlatformThumbnailPipeline()
    let finishPrewarm: (() => void) | undefined
    vi.spyOn(pipeline, "prewarmLibrary").mockImplementation(() => new Promise((resolve) => {
      finishPrewarm = () => resolve({ requested: 1, databaseHits: 0, primed: 0 })
    }))
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })

    const response = await route.handle(registerRequest(sourcePath, 0, true))

    expect(response?.status).toBe(201)
    expect(((await response?.json()) as { items: unknown[] }).items).toHaveLength(1)
    finishPrewarm?.()
    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-stable-url] keeps a deterministic asset alive while another context retains it", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-thumbnail-shared-"))
    roots.push(root)
    const sourcePath = join(root, "cover.png")
    await writeFile(sourcePath, Uint8Array.of(1))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(sourcePath),
      loadImageTransformer: async () => ({ transform: async () => ({ contentType: "image/webp", stream: byteStream(fixtureWebp(8)) }) }),
    })
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const item = [{ id: "cover", path: sourcePath, kind: "file" as const, previewCount: 1 as const }]
    const first = (await route.handle(registrationRequest(item, 1, true, "library:first")))!
    const second = (await route.handle(registrationRequest(item, 1, true, "library:second")))!
    const firstUrl = ((await first.json()) as { items: Array<{ thumbnailUrl: string }> }).items[0]!.thumbnailUrl
    const secondUrl = ((await second.json()) as { items: Array<{ thumbnailUrl: string }> }).items[0]!.thumbnailUrl
    expect(secondUrl).toBe(firstUrl)

    await route.handle(new Request("http://127.0.0.1:41000/reader/library/contexts/library%3Afirst?token=secret", { method: "DELETE" }))
    expect((await route.handle(new Request(firstUrl)))?.status).toBe(200)
    await route.handle(new Request("http://127.0.0.1:41000/reader/library/contexts/library%3Asecond?token=secret", { method: "DELETE" }))
    expect((await route.handle(new Request(firstUrl)))?.status).toBe(404)
    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-visible-http] serves img requests through the interactive lane", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-thumbnail-visible-"))
    roots.push(root)
    const sourcePath = join(root, "cover.png")
    await writeFile(sourcePath, Uint8Array.of(1))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(sourcePath),
      loadImageTransformer: async () => ({ transform: async () => ({ contentType: "image/webp", stream: byteStream(fixtureWebp(8)) }) }),
    })
    const acquireLibrary = vi.spyOn(pipeline, "acquireLibrary")
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const registered = (await route.handle(registerRequest(sourcePath, 0, true)))!
    const body = await registered.json() as { items: Array<{ thumbnailUrl: string }> }

    expect((await route.handle(new Request(body.items[0]!.thumbnailUrl)))?.status).toBe(200)
    expect(acquireLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ path: sourcePath, kind: "file" }),
      expect.objectContaining({ lane: "reader-visible" }),
    )

    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-mosaic-http] returns independent opaque asset URLs for folder previews", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-mosaic-route-"))
    roots.push(root)
    const folder = join(root, "book")
    const cover = join(folder, "001.png")
    const cover2 = join(folder, "002.png")
    await mkdir(folder)
    await writeFile(cover, Uint8Array.of(1, 2, 3))
    await writeFile(cover2, Uint8Array.of(4, 5, 6))
    const compose = vi.fn(async () => ({ bytes: fixtureWebp(9), contentType: "image/webp" as const }))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(cover),
      loadImageTransformer: async () => ({
        transform: async () => ({ contentType: "image/webp", stream: byteStream(fixtureWebp(7)) }),
      }),
      loadMosaicImageComposer: async () => ({ compose }),
    })
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const registered = (await route.handle(registerRequest(folder, 1, true, "folder", 4)))!
    const body = await registered.json() as { items: Array<{ thumbnailUrl: string; thumbnailUrls?: string[] }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.thumbnailUrls).toHaveLength(2)
    for (const thumbnailUrl of body.items[0]!.thumbnailUrls!) {
      expect((await route.handle(new Request(thumbnailUrl)))?.status).toBe(200)
    }
    expect(compose).not.toHaveBeenCalled()
    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-warmup-independent] compiles folder mosaics as independent representative assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-warmup-independent-"))
    roots.push(root)
    const folder = join(root, "book")
    const cover = join(folder, "001.png")
    const cover2 = join(folder, "002.png")
    await mkdir(folder)
    await writeFile(cover, Uint8Array.of(1, 2, 3))
    await writeFile(cover2, Uint8Array.of(4, 5, 6))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async (source) => fixtureBook(source.path),
      loadImageTransformer: async () => ({
        transform: async () => ({ contentType: "image/webp", stream: byteStream(fixtureWebp(7)) }),
      }),
    })
    const acquireLibrary = vi.spyOn(pipeline, "acquireLibrary")
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const response = (await route.handle(warmupRequest([
      { id: "folder", path: folder, kind: "folder", previewCount: 4 },
    ], true)))!
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(events.at(-1)).toEqual({ type: "complete", total: 1, completed: 1, failed: 0 })
    expect(acquireLibrary).toHaveBeenCalledTimes(2)
    expect(acquireLibrary.mock.calls.map(([source]) => source)).toEqual([
      expect.objectContaining({ kind: "file", path: cover, previewCount: 1 }),
      expect.objectContaining({ kind: "file", path: cover2, previewCount: 1 }),
    ])
    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-warmup-http] streams GUI progress while generating valid items independently", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-warmup-route-"))
    roots.push(root)
    const sourcePath = join(root, "cover.png")
    await writeFile(sourcePath, Uint8Array.of(1, 2, 3))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(sourcePath),
      loadImageTransformer: async () => ({
        transform: async () => ({ contentType: "image/webp", stream: byteStream(fixtureWebp(7)) }),
      }),
    })
    const releaseContext = vi.spyOn(pipeline, "releaseContext")
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const response = (await route.handle(warmupRequest([
      { id: "ready", path: sourcePath, kind: "file", previewCount: 1 },
      { id: "missing", path: join(root, "missing.png"), kind: "file", previewCount: 1 },
    ], true)))!

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/x-ndjson")
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(events[0]).toEqual({ type: "start", total: 2 })
    expect(events).toContainEqual(expect.objectContaining({ type: "item", id: "ready", status: "completed" }))
    expect(events).toContainEqual(expect.objectContaining({ type: "item", id: "missing", status: "failed" }))
    expect(events.at(-1)).toEqual({ type: "complete", total: 2, completed: 1, failed: 1 })
    expect(releaseContext).toHaveBeenCalledWith(expect.stringMatching(/^library:warmup:/))

    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-warmup-http-validation] requires authorization and rejects invalid batches before streaming", async () => {
    const pipeline = new PlatformThumbnailPipeline({})
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const item = { id: "cover", path: "D:/cover.jpg", kind: "file" as const, previewCount: 1 as const }
    expect((await route.handle(warmupRequest([item], false)))?.status).toBe(401)
    expect((await route.handle(warmupRequest([{ ...item, previewCount: 4 }], true)))?.status).toBe(400)
    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-refresh-http] exposes non-destructive replacement through the same GUI progress stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-refresh-route-"))
    roots.push(root)
    const sourcePath = join(root, "cover.png")
    await writeFile(sourcePath, Uint8Array.of(1, 2, 3))
    const get = vi.fn(async () => ({ bytes: fixtureWebp(2), contentType: "image/webp", sourceSize: 3, date: "2099-01-01 00:00:00" }))
    const put = vi.fn(async () => undefined)
    const transform = vi.fn(async () => ({ contentType: "image/webp", stream: byteStream(fixtureWebp(8)) }))
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(sourcePath),
      thumbnailStore: { get, put },
      loadImageTransformer: async () => ({ transform }),
    })
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const response = (await route.handle(warmupRequest([
      { id: "cover", path: sourcePath, kind: "file", previewCount: 1 },
    ], true, "refresh")))!
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(events.at(-1)).toEqual({ type: "complete", total: 1, completed: 1, failed: 0 })
    expect(get).not.toHaveBeenCalled()
    expect(transform).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledOnce()
    route.close()
    await pipeline.dispose()
  })

  it("[neoview.thumbnail.library-warmup-http-cancel] cancels generation when the GUI route closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-warmup-cancel-"))
    roots.push(root)
    const sourcePath = join(root, "cover.png")
    await writeFile(sourcePath, Uint8Array.of(1, 2, 3))
    let transformSignal: AbortSignal | undefined
    const pipeline = new PlatformThumbnailPipeline({
      bookLoader: async () => fixtureBook(sourcePath),
      loadImageTransformer: async () => ({
        transform: async (_input, _request, signal) => {
          transformSignal = signal
          return {
            contentType: "image/webp",
            stream: new ReadableStream<Uint8Array>({
              start(controller) {
                signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true })
              },
            }),
          }
        },
      }),
    })
    const route = new LibraryThumbnailRoute(pipeline, { baseUrl: "http://127.0.0.1:41000", token: "secret" })
    const response = (await route.handle(warmupRequest([
      { id: "cover", path: sourcePath, kind: "file", previewCount: 1 },
    ], true)))!
    const body = response.text()
    await vi.waitFor(() => expect(transformSignal).toBeInstanceOf(AbortSignal))
    route.close()
    await expect(body).resolves.toContain('"type":"start"')
    expect(transformSignal?.aborted).toBe(true)
    await pipeline.dispose()
  })
})

function registerRequest(
  path: string,
  generation: number,
  authorized: boolean,
  kind: "file" | "folder" = "file",
  previewCount: 1 | 4 | 9 | 16 = 1,
  refresh = false,
): Request {
  return registrationRequest([{ id: "cover", path, kind, previewCount, ...(refresh ? { refresh: true } : {}) }], generation, authorized)
}

function registrationRequest(
  items: Array<{ id: string; path: string; kind: "file" | "folder"; previewCount: 1 | 4 | 9 | 16; refresh?: boolean }>,
  generation: number,
  authorized: boolean,
  contextId = "library:test",
): Request {
  return new Request("http://127.0.0.1:41000/reader/library/thumbnails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { "x-xiranite-token": "secret" } : {}),
    },
    body: JSON.stringify({
      contextId,
      generation,
      items,
    }),
  })
}

function warmupRequest(
  items: Array<{ id: string; path: string; kind: "file" | "folder"; previewCount: 1 | 4 | 9 | 16 }>,
  authorized: boolean,
  mode: "ensure" | "refresh" = "ensure",
): Request {
  return new Request("http://127.0.0.1:41000/reader/library/thumbnails/prewarm", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { "x-xiranite-token": "secret" } : {}),
    },
    body: JSON.stringify({ items, mode, concurrency: 2 }),
  })
}

function fixtureBook(sourcePath: string): ReaderBook {
  const closeSource = vi.fn(async () => undefined)
  const page: ReaderPage = {
    id: "page-1",
    index: 0,
    name: "cover.png",
    sourcePath,
    thumbnailSource: { key: sourcePath, category: "file" },
    mediaKind: "image",
    mimeType: "image/png",
    byteLength: 3,
    contentVersion: "page-v1",
    content: {
      load: async () => ({
        rangeSupported: false,
        open: async () => byteStream(Uint8Array.of(1, 2, 3)),
        close: closeSource,
        [Symbol.asyncDispose]: closeSource,
      }),
    },
  }
  const close = vi.fn(async () => undefined)
  return { id: "book-1", source: { kind: "path", path: sourcePath }, displayName: "Book", pages: [page], close, [Symbol.asyncDispose]: close }
}

function fixtureWebp(fill: number): Uint8Array {
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, fill])
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } })
}
