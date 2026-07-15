import { mkdtemp, rm, writeFile } from "node:fs/promises"
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

  it("[neoview.thumbnail.library.http] returns opaque capability URLs and invalidates an old context generation", async () => {
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

    const invalid = await route.handle(registerRequest(join(root, "missing.png"), 2, true))
    expect(invalid?.status).toBe(400)
    expect((await route.handle(new Request(body.items[0]!.thumbnailUrl)))?.status).toBe(200)

    const replaced = (await route.handle(registerRequest(sourcePath, 2, true)))!
    expect(replaced.status).toBe(201)
    expect((await route.handle(new Request(body.items[0]!.thumbnailUrl)))?.status).toBe(404)
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

  it("[neoview.thumbnail.library.cancellation] cancels active generation when a newer context generation replaces it", async () => {
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
    expect((await route.handle(registerRequest(sourcePath, 2, true)))?.status).toBe(201)
    expect((await pending)?.status).toBe(410)
    expect(transformSignal?.aborted).toBe(true)
    route.close()
    await pipeline.dispose()
  })
})

function registerRequest(path: string, generation: number, authorized: boolean): Request {
  return new Request("http://127.0.0.1:41000/reader/library/thumbnails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { "x-xiranite-token": "secret" } : {}),
    },
    body: JSON.stringify({
      contextId: "library:test",
      generation,
      items: [{ id: "cover", path, kind: "file" }],
    }),
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
