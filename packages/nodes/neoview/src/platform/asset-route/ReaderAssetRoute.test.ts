import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CoreReaderService } from "../../application/reader/ReaderService.js"
import type { ReaderBook } from "../../domain/book/book.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ImageTransformer, ImageTransformerLoader } from "../../ports/ImageTransformer.js"
import { createZipFixture, type ZipFixture } from "../../../test/fixture-builders/create-zip-fixture.js"
import { createPlatformReaderBookLoader } from "../books/PlatformReaderBookLoader.js"
import { WeightedLruPresentationCache } from "../cache/WeightedLruPresentationCache.js"
import { ReaderAssetRoute } from "./ReaderAssetRoute.js"

const cleanupDirectories: string[] = []
const cleanupArchives: ZipFixture[] = []

afterEach(async () => {
  await Promise.all(cleanupArchives.splice(0).map((fixture) => fixture.cleanup()))
  await Promise.all(cleanupDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("ReaderAssetRoute", () => {
  it("[neoview.asset.security] publishes opaque tokenized URLs and rejects unauthorized or stale requests", async () => {
    const { service, session, route } = await openDirectoryRoute(Uint8Array.of(1, 2, 3))
    const page = session.book.pages[0]!
    const url = route.pageUrl(session.id, page.id)
    expect(url).not.toContain(encodeURIComponent(page.sourcePath))
    expect(new URL(url).searchParams.get("token")).toBe("route-token")
    expect((await route.handle(new Request(url.replace("route-token", "wrong"))))?.status).toBe(401)
    const stale = new URL(url)
    stale.searchParams.set("version", "stale")
    expect((await route.handle(new Request(stale)))?.status).toBe(410)
    expect(await route.handle(new Request(new URL("/unrelated", url)))).toBeUndefined()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.asset.range] streams file pages with HEAD, byte ranges, ETag and 304 semantics", async () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index)
    const { service, session, route } = await openDirectoryRoute(bytes)
    const url = route.pageUrl(session.id, session.book.pages[0]!.id)
    const response = (await route.handle(new Request(url)))!
    expect(response.status).toBe(200)
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(response.headers.get("content-length")).toBe("32")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)

    const ranged = (await route.handle(new Request(url, { headers: { range: "bytes=5-9" } })))!
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get("content-range")).toBe("bytes 5-9/32")
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(bytes.subarray(5, 10))

    const head = (await route.handle(new Request(url, { method: "HEAD", headers: { range: "bytes=-4" } })))!
    expect(head.status).toBe(206)
    expect(head.headers.get("content-length")).toBe("4")
    expect(head.body).toBeNull()

    const notModified = (await route.handle(new Request(url, {
      headers: { "if-none-match": response.headers.get("etag")! },
    })))!
    expect(notModified.status).toBe(304)
    expect(notModified.body).toBeNull()

    const invalid = (await route.handle(new Request(url, { headers: { range: "bytes=99-100" } })))!
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get("content-range")).toBe("bytes */32")
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.thumbnail.asset-route] serves opaque authenticated thumbnail URLs with HEAD and ETag", async () => {
    const openSource = vi.fn(async () => { throw new Error("thumbnail route must not open original page bytes") })
    const closeSource = vi.fn(async () => undefined)
    const service = new CoreReaderService(async () => fixtureBook({
      rangeSupported: false,
      open: openSource,
      close: closeSource,
      [Symbol.asyncDispose]: closeSource,
    }))
    const session = await service.openViewSource({ kind: "path", path: "opaque" })
    const get = vi.fn(async (key: string, category: "file" | "folder") => {
      expect({ key, category }).toEqual({ key: "D:/private/page.jpg", category: "file" })
      return { bytes: Uint8Array.of(0x52, 0x49, 0x46, 0x46), contentType: "image/webp", date: "2026-01-01", generationHash: 9 }
    })
    const route = new ReaderAssetRoute(
      service,
      { baseUrl: "http://127.0.0.1:41000", token: "route-token" },
      { thumbnailStore: { get } },
    )
    const url = route.thumbnailUrl(session.id, "page-1")!
    expect(url).not.toContain("private")
    expect(url).not.toContain(encodeURIComponent("D:/private/page.jpg"))
    expect((await route.handle(new Request(url.replace("route-token", "wrong"))))?.status).toBe(401)
    const stale = new URL(url)
    stale.searchParams.set("version", "old")
    expect((await route.handle(new Request(stale)))?.status).toBe(410)

    const response = (await route.handle(new Request(url)))!
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-cache")
    expect(response.headers.get("content-type")).toBe("image/webp")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(0x52, 0x49, 0x46, 0x46))
    const head = (await route.handle(new Request(url, { method: "HEAD" })))!
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    const cached = (await route.handle(new Request(url, { headers: { "if-none-match": response.headers.get("etag")! } })))!
    expect(cached.status).toBe(304)
    get.mockResolvedValue({ bytes: Uint8Array.of(0x52, 0x49, 0x46, 0x47), contentType: "image/webp" })
    const replaced = (await route.handle(new Request(url, { headers: { "if-none-match": response.headers.get("etag")! } })))!
    expect(replaced.status).toBe(200)
    expect(replaced.headers.get("etag")).not.toBe(response.headers.get("etag"))
    expect(openSource).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledTimes(4)
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.thumbnail.generate.singleflight] generates one WebP for concurrent misses and reuses the byte-budget cache", async () => {
    const gate = deferred<void>()
    const openSource = vi.fn(async () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2, 3, 4))
        controller.close()
      },
    }))
    const closeSource = vi.fn(async () => undefined)
    const service = new CoreReaderService(async () => fixtureBook({
      rangeSupported: false,
      open: openSource,
      close: closeSource,
      [Symbol.asyncDispose]: closeSource,
    }))
    const session = await service.openViewSource({ kind: "path", path: "generated" })
    const transform = vi.fn(async () => {
      await gate.promise
      return {
        contentType: "image/webp",
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.of(0x52, 0x49, 0x46, 0x46, 9, 8, 7))
            controller.close()
          },
        }),
      }
    })
    const route = new ReaderAssetRoute(
      service,
      { baseUrl: "http://127.0.0.1:41000", token: "route-token" },
      { loadImageTransformer: async () => ({ transform }) },
    )
    const url = route.thumbnailUrl(session.id, "page-1")!
    const firstPending = route.handle(new Request(url))
    const secondPending = route.handle(new Request(url))
    await vi.waitFor(() => expect(transform).toHaveBeenCalledTimes(1))
    gate.resolve()
    const [first, second] = await Promise.all([firstPending, secondPending])
    expect(first?.status).toBe(200)
    expect(second?.status).toBe(200)
    expect(first?.headers.get("cache-control")).toContain("immutable")
    expect(new Uint8Array(await first!.arrayBuffer())).toEqual(Uint8Array.of(0x52, 0x49, 0x46, 0x46, 9, 8, 7))
    expect(new Uint8Array(await second!.arrayBuffer())).toEqual(Uint8Array.of(0x52, 0x49, 0x46, 0x46, 9, 8, 7))

    const cached = (await route.handle(new Request(url)))!
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(Uint8Array.of(0x52, 0x49, 0x46, 0x46, 9, 8, 7))
    expect(transform).toHaveBeenCalledTimes(1)
    expect(openSource).toHaveBeenCalledTimes(1)
    route.close()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.asset.archive-stream] sends ZIP entries without advertising decompressed ranges", async () => {
    const fixture = await createZipFixture()
    cleanupArchives.push(fixture)
    const service = new CoreReaderService(createPlatformReaderBookLoader())
    const session = await service.openViewSource({ kind: "archive", path: fixture.path })
    const route = new ReaderAssetRoute(service, { baseUrl: "http://127.0.0.1:41000", token: "route-token" })
    const response = (await route.handle(new Request(route.pageUrl(session.id, session.book.pages[0]!.id), {
      headers: { range: "bytes=1-2" },
    })))!
    expect(response.status).toBe(200)
    expect(response.headers.has("accept-ranges")).toBe(false)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.asset.cancellation] propagates response cancellation and closes the page source", async () => {
    const cancelled = vi.fn()
    const sourceClosed = vi.fn(async () => undefined)
    let emitted = false
    const source: PageSource = {
      byteLength: 2,
      contentType: "image/jpeg",
      rangeSupported: false,
      async open() {
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!emitted) {
              emitted = true
              controller.enqueue(Uint8Array.of(1))
            }
          },
          cancel: cancelled,
        })
      },
      close: sourceClosed,
      [Symbol.asyncDispose]: sourceClosed,
    }
    const service = new CoreReaderService(async () => fixtureBook(source))
    const session = await service.openViewSource({ kind: "path", path: "opaque" })
    const route = new ReaderAssetRoute(service, { baseUrl: "http://127.0.0.1:41000", token: "route-token" })
    const response = (await route.handle(new Request(route.pageUrl(session.id, "page-1"))))!
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel("client disconnected")
    expect(cancelled).toHaveBeenCalledWith("client disconnected")
    expect(sourceClosed).toHaveBeenCalledOnce()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.image.transform-route] loads the transformer only for normalized transform requests", async () => {
    const { service, session } = await openDirectoryRoute(Uint8Array.of(1, 2, 3, 4))
    const transform = vi.fn<ImageTransformer["transform"]>(async (input, request) => {
      await input.cancel("fake transform consumed")
      expect(request).toEqual({ width: 320, height: undefined, dpr: 2, fit: "inside", format: "webp", quality: 70 })
      return {
        stream: new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(9, 8, 7)); controller.close() } }),
        contentType: "image/webp",
      }
    })
    const loadImageTransformer = vi.fn(async (): Promise<ImageTransformer> => ({ transform }))
    const route = new ReaderAssetRoute(
      service,
      { baseUrl: "http://127.0.0.1:41000", token: "route-token" },
      { loadImageTransformer },
    )
    const originalUrl = route.pageUrl(session.id, session.book.pages[0]!.id)
    const originalHead = (await route.handle(new Request(originalUrl, { method: "HEAD" })))!
    expect(originalHead.headers.get("content-type")).toBe("image/jpeg")
    expect(loadImageTransformer).not.toHaveBeenCalled()

    const transformedUrl = new URL(originalUrl)
    transformedUrl.searchParams.set("width", "320")
    transformedUrl.searchParams.set("dpr", "2")
    transformedUrl.searchParams.set("quality", "70")
    const transformedHead = (await route.handle(new Request(transformedUrl, { method: "HEAD" })))!
    expect(transformedHead.status).toBe(200)
    expect(transformedHead.headers.get("content-type")).toBe("image/webp")
    expect(transformedHead.headers.has("content-length")).toBe(false)
    expect(transformedHead.headers.has("accept-ranges")).toBe(false)
    expect(transformedHead.headers.get("etag")).not.toBe(originalHead.headers.get("etag"))
    expect(loadImageTransformer).not.toHaveBeenCalled()

    const response = (await route.handle(new Request(transformedUrl, { headers: { range: "bytes=0-1" } })))!
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(9, 8, 7))
    expect(loadImageTransformer).toHaveBeenCalledOnce()
    expect(transform).toHaveBeenCalledOnce()

    const notModified = (await route.handle(new Request(transformedUrl, {
      headers: { "if-none-match": response.headers.get("etag")! },
    })))!
    expect(notModified.status).toBe(304)
    expect(transform).toHaveBeenCalledOnce()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.image.transform-validation] rejects invalid transforms before loading native code", async () => {
    const { service, session } = await openDirectoryRoute(Uint8Array.of(1, 2, 3))
    const loadImageTransformer = vi.fn<ImageTransformerLoader>()
    const route = new ReaderAssetRoute(
      service,
      { baseUrl: "http://127.0.0.1:41000", token: "route-token" },
      { loadImageTransformer },
    )
    const url = new URL(route.pageUrl(session.id, session.book.pages[0]!.id))
    url.searchParams.set("width", "999999")
    expect((await route.handle(new Request(url)))?.status).toBe(400)
    expect(loadImageTransformer).not.toHaveBeenCalled()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.cache.singleflight] shares an active transform and serves later requests from the byte cache", async () => {
    const { service, session } = await openDirectoryRoute(Uint8Array.of(1, 2, 3))
    let output!: ReadableStreamDefaultController<Uint8Array>
    const transform = vi.fn<ImageTransformer["transform"]>(async (input) => {
      await input.cancel("fixture transformed")
      return {
        stream: new ReadableStream({ start(controller) { output = controller } }),
        contentType: "image/webp",
      }
    })
    const cache = new WeightedLruPresentationCache({ maxBytes: 32, maxEntryBytes: 16 })
    const route = new ReaderAssetRoute(
      service,
      { baseUrl: "http://127.0.0.1:41000", token: "route-token" },
      { presentationCache: cache, loadImageTransformer: async () => ({ transform }) },
    )
    const url = new URL(route.pageUrl(session.id, session.book.pages[0]!.id))
    url.searchParams.set("width", "100")
    const first = (await route.handle(new Request(url)))!
    let secondResolved = false
    const secondPending = route.handle(new Request(url)).then((response) => {
      secondResolved = true
      return response!
    })
    await Promise.resolve()
    expect(secondResolved).toBe(false)
    expect(transform).toHaveBeenCalledOnce()

    output.enqueue(Uint8Array.of(4, 5, 6, 7))
    output.close()
    const second = await secondPending
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(Uint8Array.of(4, 5, 6, 7))
    expect(second.headers.get("content-length")).toBe("4")
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(Uint8Array.of(4, 5, 6, 7))

    const third = (await route.handle(new Request(url)))!
    expect(new Uint8Array(await third.arrayBuffer())).toEqual(Uint8Array.of(4, 5, 6, 7))
    expect(transform).toHaveBeenCalledOnce()
    expect(cache.snapshot()).toMatchObject({ entries: 1, bytes: 4, hits: 1 })
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.cache.oversized-bypass] drains but does not retain transformed output above the entry budget", async () => {
    const { service, session } = await openDirectoryRoute(Uint8Array.of(1, 2, 3))
    const transform = vi.fn<ImageTransformer["transform"]>(async (input) => {
      await input.cancel("fixture transformed")
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.of(1, 2, 3))
            controller.close()
          },
        }),
        contentType: "image/webp",
      }
    })
    const cache = new WeightedLruPresentationCache({ maxBytes: 8, maxEntryBytes: 2 })
    const route = new ReaderAssetRoute(
      service,
      { baseUrl: "http://127.0.0.1:41000", token: "route-token" },
      { presentationCache: cache, loadImageTransformer: async () => ({ transform }) },
    )
    const url = new URL(route.pageUrl(session.id, session.book.pages[0]!.id))
    url.searchParams.set("width", "100")
    await (await route.handle(new Request(url)))!.arrayBuffer()
    await expect.poll(() => cache.snapshot().entries).toBe(0)
    await (await route.handle(new Request(url)))!.arrayBuffer()
    expect(transform).toHaveBeenCalledTimes(2)
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.cache.waiter-cancellation] cancels a waiter without aborting the shared transform", async () => {
    const { service, session } = await openDirectoryRoute(Uint8Array.of(1, 2, 3))
    let output!: ReadableStreamDefaultController<Uint8Array>
    const transform = vi.fn<ImageTransformer["transform"]>(async (input) => {
      await input.cancel("fixture transformed")
      return {
        stream: new ReadableStream({ start(controller) { output = controller } }),
        contentType: "image/webp",
      }
    })
    const cache = new WeightedLruPresentationCache({ maxBytes: 16, maxEntryBytes: 8 })
    const route = new ReaderAssetRoute(
      service,
      { baseUrl: "http://127.0.0.1:41000", token: "route-token" },
      { presentationCache: cache, loadImageTransformer: async () => ({ transform }) },
    )
    const url = new URL(route.pageUrl(session.id, session.book.pages[0]!.id))
    url.searchParams.set("width", "100")
    const first = (await route.handle(new Request(url)))!
    const abort = new AbortController()
    const waiting = route.handle(new Request(url, { signal: abort.signal }))
    abort.abort(new Error("waiter navigated away"))
    await expect(waiting).rejects.toThrow("waiter navigated away")

    output.enqueue(Uint8Array.of(8, 9))
    output.close()
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(Uint8Array.of(8, 9))
    await expect.poll(() => cache.snapshot().entries).toBe(1)
    expect(transform).toHaveBeenCalledOnce()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.cache.failure-retry] removes a failed flight so a waiter can regenerate the artifact", async () => {
    const { service, session } = await openDirectoryRoute(Uint8Array.of(1, 2, 3))
    let failedOutput!: ReadableStreamDefaultController<Uint8Array>
    const transform = vi.fn<ImageTransformer["transform"]>(async (input) => {
      await input.cancel("fixture transformed")
      if (transform.mock.calls.length === 1) {
        return {
          stream: new ReadableStream({ start(controller) { failedOutput = controller } }),
          contentType: "image/webp",
        }
      }
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.of(6, 7))
            controller.close()
          },
        }),
        contentType: "image/webp",
      }
    })
    const route = new ReaderAssetRoute(
      service,
      { baseUrl: "http://127.0.0.1:41000", token: "route-token" },
      {
        presentationCache: new WeightedLruPresentationCache({ maxBytes: 16, maxEntryBytes: 8 }),
        loadImageTransformer: async () => ({ transform }),
      },
    )
    const url = new URL(route.pageUrl(session.id, session.book.pages[0]!.id))
    url.searchParams.set("width", "100")
    const first = (await route.handle(new Request(url)))!
    const waiting = route.handle(new Request(url))
    failedOutput.error(new Error("fixture transform failed"))
    await expect(first.arrayBuffer()).rejects.toThrow("fixture transform failed")
    const recovered = (await waiting)!
    expect(new Uint8Array(await recovered.arrayBuffer())).toEqual(Uint8Array.of(6, 7))
    expect(transform).toHaveBeenCalledTimes(2)
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.cache.lifecycle] prevents an active flight from refilling cache after route close", async () => {
    const { service, session } = await openDirectoryRoute(Uint8Array.of(1, 2, 3))
    let output!: ReadableStreamDefaultController<Uint8Array>
    const cache = new WeightedLruPresentationCache({ maxBytes: 16, maxEntryBytes: 8 })
    const route = new ReaderAssetRoute(
      service,
      { baseUrl: "http://127.0.0.1:41000", token: "route-token" },
      {
        presentationCache: cache,
        loadImageTransformer: async () => ({
          async transform(input) {
            await input.cancel("fixture transformed")
            return {
              stream: new ReadableStream({ start(controller) { output = controller } }),
              contentType: "image/webp",
            }
          },
        }),
      },
    )
    const url = new URL(route.pageUrl(session.id, session.book.pages[0]!.id))
    url.searchParams.set("width", "100")
    const response = (await route.handle(new Request(url)))!
    route.close()
    output.enqueue(Uint8Array.of(1, 2))
    output.close()
    await response.arrayBuffer()
    expect(cache.snapshot()).toMatchObject({ entries: 0, bytes: 0 })
    expect((await route.handle(new Request(url)))?.status).toBe(410)
    await service[Symbol.asyncDispose]()
  })
})

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((current) => { resolve = current })
  return { promise, resolve }
}

async function openDirectoryRoute(bytes: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-asset-"))
  cleanupDirectories.push(directory)
  await writeFile(join(directory, "page.jpg"), bytes)
  const service = new CoreReaderService(createPlatformReaderBookLoader())
  const session = await service.openViewSource({ kind: "directory", path: directory })
  const route = new ReaderAssetRoute(service, { baseUrl: "http://127.0.0.1:41000", token: "route-token" })
  return { service, session, route }
}

function fixtureBook(source: PageSource): ReaderBook {
  const page: ReaderPage = {
    id: "page-1",
    index: 0,
    name: "page.jpg",
    sourcePath: "not-exposed",
    thumbnailSource: { key: "D:/private/page.jpg", category: "file" },
    mediaKind: "image",
    mimeType: "image/jpeg",
    byteLength: 2,
    contentVersion: "v1",
    content: { load: async () => source },
  }
  const close = vi.fn(async () => undefined)
  return {
    id: "book-1",
    source: { kind: "path", path: "not-exposed" },
    displayName: "Fixture",
    pages: [page],
    close,
    [Symbol.asyncDispose]: close,
  }
}
