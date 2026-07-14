import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CoreReaderService } from "../../application/reader/ReaderService.js"
import type { ReaderBook } from "../../domain/book/book.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { createZipFixture, type ZipFixture } from "../../../test/fixture-builders/create-zip-fixture.js"
import { createPlatformReaderBookLoader } from "../books/PlatformReaderBookLoader.js"
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
})

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
