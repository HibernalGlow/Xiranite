import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReaderService, ReaderSession } from "../../application/reader/contracts.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { SuperResolutionArtifactPagePort } from "../../ports/SuperResolutionArtifactPagePort.js"
import { createReaderHttpController } from "../../platform.js"
import { CacacheSuperResolutionArtifactStore } from "../super-resolution/CacacheSuperResolutionArtifactStore.js"
import { SuperResolutionArtifactRoute } from "./SuperResolutionArtifactRoute.js"
import { ReaderHttpController } from "./ReaderHttpController.js"

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])
const BASE_URL = "http://127.0.0.1:41000"
const TOKEN = "reader-token"

describe("SuperResolutionArtifactRoute", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "xr-upscale-http-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("[neoview.super-resolution.preload-http] generates an opaque artifact URL and streams authenticated GET/HEAD/304", async () => {
    const store = createStore()
    const page = readerPage()
    const service = readerService(page)
    const acquireOrGenerate = vi.fn(async (input, context) => {
      const decision = { kind: "run" as const, reason: "manual", modelId: "model", scale: 2, useCache: true }
      const descriptor = await input.artifactFor(decision)
      await store.publish(descriptor.key, descriptor.metadata, async (path, signal) => {
        expect(signal.aborted).toBe(false)
        await writeFile(path, PNG)
      }, context?.signal)
      const artifact = await store.acquire(descriptor.key, context?.signal)
      if (!artifact) throw new Error("fixture artifact missing")
      return {
        status: "generated" as const,
        artifact,
        execution: { modelId: "model", engine: "upscayl" as const, scale: 2, elapsedMs: 1 },
      }
    })
    const route = new SuperResolutionArtifactRoute(service, port(acquireOrGenerate), store, {
      baseUrl: BASE_URL,
      token: TOKEN,
    })
    const generated = await route.handle(authorized("/reader/s/session-1/pages/page-1/upscale-artifact", { method: "POST" }))
    expect(generated?.status).toBe(201)
    const body = await generated!.json() as { artifactUrl: string; version: string; bytes: number }
    expect(body.bytes).toBe(PNG.length)
    expect(body.artifactUrl).toContain("/reader/s/session-1/upscale-artifact/")
    expect(body.artifactUrl).not.toContain("D%3A")
    expect(body.artifactUrl).not.toContain("book")
    expect(acquireOrGenerate).toHaveBeenCalledWith(expect.objectContaining({
      page,
      bookPath: "D:/private/book.cbz",
      trigger: "manual",
      priority: "interactive",
    }), { signal: expect.any(AbortSignal) })

    const unauthorized = new URL(body.artifactUrl)
    unauthorized.searchParams.delete("token")
    expect((await route.handle(new Request(unauthorized)))?.status).toBe(401)

    const response = (await route.handle(new Request(body.artifactUrl)))!
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(response.headers.get("content-length")).toBe(String(PNG.length))
    expect(response.headers.get("cache-control")).toContain("immutable")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(PNG))
    await expect.poll(async () => (await store.snapshot()).activeLeases).toBe(0)

    const cancelled = (await route.handle(new Request(body.artifactUrl)))!
    await cancelled.body!.cancel("viewport changed")
    await expect.poll(async () => (await store.snapshot()).activeLeases).toBe(0)

    const head = (await route.handle(new Request(body.artifactUrl, { method: "HEAD" })))!
    expect(head.status).toBe(200)
    expect(head.headers.get("content-length")).toBe(String(PNG.length))
    const notModified = (await route.handle(new Request(body.artifactUrl, {
      headers: { "if-none-match": head.headers.get("etag")! },
    })))!
    expect(notModified.status).toBe(304)
    expect(await notModified.text()).toBe("")

    const stale = new URL(body.artifactUrl)
    stale.searchParams.set("version", "stale")
    expect((await route.handle(new Request(stale)))?.status).toBe(410)
    await store.close()
  })

  it("[neoview.super-resolution.preload-http-session] cancels generation and invalidates assets with the Reader session", async () => {
    const store = createStore()
    const page = readerPage()
    let active = true
    const service = readerService(page, () => active)
    const started = deferred()
    const stopped = deferred()
    const acquireOrGenerate = vi.fn(async (_input, context) => {
      started.resolve()
      await new Promise<never>((_resolve, reject) => {
        const abort = () => { stopped.resolve(); reject(context?.signal?.reason) }
        context?.signal?.addEventListener("abort", abort, { once: true })
      })
    })
    const route = new SuperResolutionArtifactRoute(service, port(acquireOrGenerate), store, {
      baseUrl: BASE_URL,
      token: TOKEN,
    })
    const request = route.handle(authorized("/reader/s/session-1/pages/page-1/upscale-artifact", { method: "POST" }))
    await started.promise
    route.releaseSession("session-1")
    await expect(request).rejects.toMatchObject({ name: "AbortError" })
    await stopped.promise

    active = false
    const digest = "a".repeat(43)
    expect((await route.handle(authorized(`/reader/s/session-1/upscale-artifact/${digest}?version=none`)))?.status).toBe(404)
    route.close()
    expect((await route.handle(authorized("/reader/s/session-1/pages/page-1/upscale-artifact", { method: "POST" })))?.status).toBe(410)
    await store.close()
  })

  it("[neoview.super-resolution.http-composition-lazy] creates no cache directory or runtime work before first demand", async () => {
    const configPath = join(root, "xiranite.config.toml")
    const cacheRoot = join(root, "artifacts")
    await writeFile(configPath, [
      "[nodes.neoview.super_resolution]",
      'provider = "disabled"',
      "",
    ].join("\n"), "utf8")
    const controller = await createReaderHttpController({
      baseUrl: BASE_URL,
      token: TOKEN,
      configPath,
      legacyThumbnailDatabasePath: false,
      superResolutionArtifactCacheRoot: cacheRoot,
    })
    await expect(stat(cacheRoot)).rejects.toMatchObject({ code: "ENOENT" })
    await controller[Symbol.asyncDispose]()
    await expect(stat(cacheRoot)).rejects.toMatchObject({ code: "ENOENT" })
    expect(() => new ReaderHttpController({
      baseUrl: BASE_URL,
      token: TOKEN,
      superResolutionArtifactPages: port(vi.fn()),
    })).toThrow("must be provided together")
  })

  function createStore() {
    return new CacacheSuperResolutionArtifactStore({
      root: join(root, "cache"),
      maxBytes: 1024,
      maxEntryBytes: 512,
      minFreeBytes: 0,
      minimumRetentionMs: 0,
    })
  }
})

function authorized(path: string, init: RequestInit = {}): Request {
  return new Request(new URL(path, BASE_URL), {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers)), "x-xiranite-token": TOKEN },
  })
}

function port(acquireOrGenerate: SuperResolutionArtifactPagePort["acquireOrGenerate"]): SuperResolutionArtifactPagePort {
  return { acquireOrGenerate, [Symbol.asyncDispose]: async () => undefined }
}

function readerService(page: ReaderPage, active: () => boolean = () => true): ReaderService {
  const session = {
    id: "session-1",
    book: {
      id: "opaque-book",
      displayName: "Book",
      source: { kind: "archive" as const, path: "D:/private/book.cbz", entryPaths: ["page.png"] },
      pages: [page],
    },
    getPage: (pageId: string) => pageId === page.id ? page : undefined,
  } as unknown as ReaderSession
  return {
    openViewSource: vi.fn(),
    getSession: (sessionId) => active() && sessionId === session.id ? session : undefined,
    closeSession: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}

function readerPage(): ReaderPage {
  return {
    id: "page-1",
    index: 0,
    name: "page.png",
    sourcePath: "D:/private/book.cbz",
    entryPath: "page.png",
    mediaKind: "image",
    dimensions: { width: 100, height: 200 },
    contentVersion: "archive:size:1:mtime:2:entry:0:crc:3",
    content: { load: vi.fn() },
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((current) => { resolve = current })
  return { promise, resolve }
}
