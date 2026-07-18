import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReaderService, ReaderSession } from "../../application/reader/contracts.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { SuperResolutionArtifactPagePort } from "../../ports/SuperResolutionArtifactPagePort.js"
import type { SuperResolutionPreloadControlPort } from "../../ports/SuperResolutionPreloadControlPort.js"
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
    await route.releaseSession("session-1")
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

  it("[neoview.super-resolution.preload-progress-http] starts, observes, pauses and retries the session plan", async () => {
    const store = createStore()
    const page = readerPage()
    const service = readerService(page)
    const snapshot = liveSnapshot()
    const startPlan = vi.fn(async (input) => {
      const artifact = await input.artifactFor(input.pages[0]!, {
        contextId: input.contextId,
        generation: input.plan.generation,
        trigger: "preload",
        signal: new AbortController().signal,
        decision: { kind: "run", reason: "test", modelId: "model", scale: 2, useCache: true },
      })
      expect(artifact.key).toMatch(/^neoview:super-resolution:v1:/)
      return [snapshot]
    })
    const startProgressive = vi.fn(async () => [{ ...snapshot, mode: "progressive" as const, state: "countdown" as const }])
    const snapshots = vi.fn(async () => [snapshot])
    const pause = vi.fn(async () => [{ ...snapshot, state: "paused" as const }])
    const retry = vi.fn(async () => [{ ...snapshot, state: "queued" as const }])
    const releaseContext = vi.fn(async () => undefined)
    const preload: SuperResolutionPreloadControlPort = {
      startPlan,
      startProgressive,
      snapshots,
      pause,
      retry,
      releaseContext,
    }
    const route = new SuperResolutionArtifactRoute(service, port(vi.fn()), store, {
      baseUrl: BASE_URL,
      token: TOKEN,
    }, preload)

    const current = (await route.handle(authorized("/reader/s/session-1/upscale-preload")))!
    expect(await current.json()).toEqual({ snapshots: [snapshot] })
    expect(snapshots).toHaveBeenCalledWith("reader:session-1:super-resolution", expect.any(AbortSignal))

    const started = (await route.handle(authorized("/reader/s/session-1/upscale-preload/start?mode=nearby", { method: "POST" })))!
    expect(started.status).toBe(202)
    expect(startPlan).toHaveBeenCalledWith(expect.objectContaining({
      contextId: "reader:session-1:super-resolution",
      pages: [page],
      bookPath: "D:/private/book.cbz",
    }), expect.any(AbortSignal))

    expect((await route.handle(authorized("/reader/s/session-1/upscale-preload/start?mode=progressive", { method: "POST" })))?.status).toBe(202)
    expect(startProgressive).toHaveBeenCalledWith(expect.objectContaining({ currentPageIndex: 0 }), expect.any(AbortSignal))
    expect((await route.handle(authorized("/reader/s/session-1/upscale-preload/pause", { method: "POST" })))?.status).toBe(200)
    expect(pause).toHaveBeenCalledWith("reader:session-1:super-resolution", expect.any(AbortSignal))
    expect((await route.handle(authorized("/reader/s/session-1/upscale-preload/retry?mode=nearby", { method: "POST" })))?.status).toBe(202)
    expect(retry).toHaveBeenCalledWith("reader:session-1:super-resolution", "nearby", expect.any(AbortSignal))

    await route.releaseSession("session-1")
    expect(releaseContext).toHaveBeenCalledWith("reader:session-1:super-resolution")
    await store.close()
  })

  it("[neoview.super-resolution.cache-controls-http] reuses the owned store for authenticated session-scoped maintenance", async () => {
    const store = createStore()
    const service = readerService(readerPage())
    const snapshot = {
      entries: 3, bytes: 300, maxBytes: 1024, maxEntryBytes: 512, activeLeases: 0,
      hits: 2, misses: 1, writes: 3, rejectedWrites: 0, evictions: 0, integrityFailures: 0,
    }
    const snapshotCall = vi.spyOn(store, "snapshot").mockResolvedValue(snapshot)
    const cleanup = vi.spyOn(store, "cleanup").mockResolvedValue({ ...snapshot, reason: "age", removedEntries: 1, removedBytes: 100 })
    const clearBook = vi.spyOn(store, "clearBook").mockResolvedValue({ ...snapshot, reason: "book", removedEntries: 2, removedBytes: 200 })
    const clear = vi.spyOn(store, "clear").mockResolvedValue({ ...snapshot, reason: "explicit", removedEntries: 3, removedBytes: 300 })
    const route = new SuperResolutionArtifactRoute(service, port(vi.fn()), store, { baseUrl: BASE_URL, token: TOKEN })

    expect((await route.handle(new Request(new URL("/reader/s/session-1/upscale-artifact-cache", BASE_URL))))?.status).toBe(401)
    const stats = (await route.handle(authorized("/reader/s/session-1/upscale-artifact-cache")))!
    await expect(stats.json()).resolves.toEqual(snapshot)
    expect(snapshotCall).toHaveBeenCalledOnce()
    expect((await route.handle(authorized("/reader/s/session-1/upscale-artifact-cache?kind=all", { method: "POST" })))?.status).toBe(400)
    expect((await route.handle(authorized("/reader/s/session-1/upscale-artifact-cache?kind=age&kind=all&confirmed=true", { method: "POST" })))?.status).toBe(400)

    await expect((await route.handle(authorized("/reader/s/session-1/upscale-artifact-cache?kind=age&confirmed=true", { method: "POST" })))?.json()).resolves.toMatchObject({ reason: "age", removedEntries: 1 })
    expect(cleanup).toHaveBeenCalledWith("age")
    await expect((await route.handle(authorized("/reader/s/session-1/upscale-artifact-cache?kind=book&confirmed=true", { method: "POST" })))?.json()).resolves.toMatchObject({ reason: "book", removedEntries: 2 })
    expect(clearBook).toHaveBeenCalledWith("opaque-book")
    await expect((await route.handle(authorized("/reader/s/session-1/upscale-artifact-cache?kind=all&confirmed=true", { method: "POST" })))?.json()).resolves.toMatchObject({ reason: "explicit", removedEntries: 3 })
    expect(clear).toHaveBeenCalledOnce()
    await store.close()
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
    generation: 2,
    preloadPlan: () => preloadPlan(),
    snapshot: () => ({ anchorPageIndex: 0 }),
  } as unknown as ReaderSession
  return {
    openViewSource: vi.fn(),
    getSession: (sessionId) => active() && sessionId === session.id ? session : undefined,
    closeSession: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}

function preloadPlan() {
  return {
    generation: 2,
    frameGeneration: 2,
    direction: "forward" as const,
    directionConfidence: 1,
    mode: "paged" as const,
    admission: "normal" as const,
    velocityPagesPerSecond: 0,
    stableForMs: 1_000,
    focused: true,
    queueWaitMs: 0,
    memoryPressure: "normal" as const,
    currentPageIndexes: [0],
    candidates: [{
      tier: "ahead" as const,
      priority: "ahead" as const,
      anchorPageIndex: 0,
      pageIndexes: [0],
      pageIds: ["page-1"],
    }],
  }
}

function liveSnapshot() {
  return {
    contextId: "reader:session-1:super-resolution",
    generation: 2,
    mode: "nearby" as const,
    state: "running" as const,
    planned: 1,
    settled: 0,
    failed: 0,
    cancelled: 0,
    pending: 1,
    progress: 0,
    startedAt: 1,
    updatedAt: 1,
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
