import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderHttpController } from "../asset-route/ReaderHttpController.js"
import type { ReaderBookSettingsRecord, ReaderBookSettingsStore } from "../../ports/ReaderBookSettingsStore.js"
import type { ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderEmmOverrideRecord, ReaderEmmOverrideStore, ReaderEmmOverrides } from "../../ports/ReaderEmmOverrideStore.js"
import {
  cleanupRemoteReaderPresentationCache,
  clearRemoteReaderPresentationCache,
  cleanupRemoteReaderThumbnails,
  clearRemoteReaderThumbnailFailures,
  fetchRemoteReaderDiagnostics,
  fetchRemoteReaderPresentationCache,
  fetchRemoteReaderThumbnailMaintenance,
  RemoteReaderLibraryController,
  RemoteReaderHeadlessController,
} from "./RemoteReaderHeadlessController.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("RemoteReaderHeadlessController", () => {
  it("[neoview.presentation-cache.cli-connect] reads and maintains the authenticated running L3 cache", async () => {
    const requests: Request[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      if (request.method === "GET") return Response.json({ enabled: true, ...artifactCacheSnapshot() })
      if (request.method === "DELETE") return Response.json({ enabled: false })
      return Response.json({ enabled: true, ...artifactCacheSnapshot(), reason: "budget", removedEntries: 2, removedBytes: 20, durationMs: 1.5 })
    }) as typeof fetch
    const options = { baseUrl: "http://127.0.0.1:41000", token: "cache-token", fetch: fetchMock }
    await expect(fetchRemoteReaderPresentationCache(options)).resolves.toMatchObject({ enabled: true, entries: 3 })
    await expect(cleanupRemoteReaderPresentationCache(options, "budget")).resolves.toMatchObject({ enabled: true, reason: "budget", removedEntries: 2 })
    await expect(clearRemoteReaderPresentationCache(options)).resolves.toEqual({ enabled: false })
    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ["GET", "/reader/cache/presentation"],
      ["POST", "/reader/cache/presentation/cleanup"],
      ["DELETE", "/reader/cache/presentation"],
    ])
    expect(requests.every((request) => request.headers.get("x-xiranite-token") === "cache-token")).toBe(true)
    expect(await requests[1]?.json()).toEqual({ reason: "budget" })
  })

  it("[neoview.presentation-cache.remote-wire] rejects malformed cache responses", async () => {
    const fetchMock = vi.fn(async () => Response.json({ enabled: true, ...artifactCacheSnapshot(), entries: -1 })) as typeof fetch
    await expect(fetchRemoteReaderPresentationCache({
      baseUrl: "http://127.0.0.1:41000",
      token: "cache-token",
      fetch: fetchMock,
    })).rejects.toThrow("invalid presentation cache response")
  })

  it("[neoview.thumbnail.maintenance.cli-connect] reuses the running writer with authenticated, validated maintenance requests", async () => {
    const requests: Request[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      const url = new URL(request.url)
      if (request.method === "GET") return Response.json({ snapshot: thumbnailMaintenanceSnapshot() })
      if (url.pathname.endsWith("/failures/clear")) return Response.json({ deleted: 3 })
      if (url.pathname.endsWith("/cleanup")) {
        const body = await request.json() as { kind: string }
        if (body.kind === "invalid") return Response.json({ result: { scanned: 50, deleted: 2, unavailableVolumeRowsPreserved: 1, wrapped: false } })
        if (body.kind === "expired") return Response.json({ deleted: 4, cutoff: "2026-06-19 00:00:00" })
        return Response.json({ deleted: 1, prefix: "D:/library" })
      }
      return new Response(null, { status: 404 })
    }) as typeof fetch
    const options = { baseUrl: "http://127.0.0.1:41000", token: "remote-token", fetch: fetchMock }
    await expect(fetchRemoteReaderThumbnailMaintenance(options)).resolves.toMatchObject({ totalRows: 12, writer: { committedWrites: 12 } })
    await expect(cleanupRemoteReaderThumbnails(options, { kind: "expired", days: 30, limit: 10 })).resolves.toEqual({ kind: "expired", deleted: 4, cutoff: "2026-06-19 00:00:00" })
    await expect(cleanupRemoteReaderThumbnails(options, { kind: "invalid", scanLimit: 50, deleteLimit: 10 })).resolves.toEqual({ kind: "invalid", scanned: 50, deleted: 2, unavailableVolumeRowsPreserved: 1, wrapped: false })
    await expect(cleanupRemoteReaderThumbnails(options, { kind: "path-prefix", prefix: "D:/library", limit: 10 })).resolves.toEqual({ kind: "path-prefix", prefix: "D:/library", deleted: 1 })
    await expect(clearRemoteReaderThumbnailFailures(options, { reason: "decode-error", limit: 10 })).resolves.toBe(3)
    expect(requests.every((request) => request.headers.get("x-xiranite-token") === "remote-token")).toBe(true)
    expect(await requests[1]?.json()).toEqual({ kind: "expired", days: 30, limit: 10, preserveFolders: true })
    expect(await requests[2]?.json()).toEqual({ kind: "invalid", scanLimit: 50, limit: 10 })
  })

  it("[neoview.thumbnail.maintenance.remote-wire] rejects malformed maintenance results", async () => {
    const fetchMock = vi.fn(async () => Response.json({ snapshot: { totalRows: -1 } })) as typeof fetch
    await expect(fetchRemoteReaderThumbnailMaintenance({
      baseUrl: "http://127.0.0.1:41000",
      token: "remote-token",
      fetch: fetchMock,
    })).rejects.toThrow("invalid thumbnail maintenance response")
  })

  it("[neoview.library.playlist.cli-connect] reuses authenticated running-library routes with strict wire validation", async () => {
    const requests: Request[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      const path = new URL(request.url).pathname
      if (path === "/reader/library/statistics") return Response.json({ recentCount: 1, bookmarkCount: 2, bookmarkListCount: 3, mediaProgressCount: 4 })
      if (path === "/reader/library/playlists" && request.method === "GET") return Response.json({ items: [playlistRecord()] })
      if (path === "/reader/library/playlists" && request.method === "POST") return Response.json(playlistRecord())
      if (path.endsWith("/items") && request.method === "GET") return Response.json({ items: [playlistEntry()] })
      if (path.endsWith("/items") && request.method === "POST") return Response.json({ items: [playlistEntry()] })
      if (path.endsWith("/items") && request.method === "DELETE") return Response.json({ deleted: 1 })
      if (path.endsWith("/items/order") && request.method === "PUT") return new Response(null, { status: 204 })
      if (path.endsWith("/playlists/missing") && request.method === "DELETE") return new Response(null, { status: 404 })
      if (path.endsWith("/playlists/reading") && request.method === "DELETE") return new Response(null, { status: 204 })
      return new Response(null, { status: 404 })
    }) as typeof fetch
    const library = new RemoteReaderLibraryController({ baseUrl: "http://127.0.0.1:41000", token: "library-token", fetch: fetchMock })

    await expect(library.statistics()).resolves.toEqual({ recentCount: 1, bookmarkCount: 2, bookmarkListCount: 3, mediaProgressCount: 4 })
    await expect(library.listPlaylists()).resolves.toEqual([playlistRecord()])
    await expect(library.savePlaylist({ id: "reading", name: "Reading" })).resolves.toEqual(playlistRecord())
    await expect(library.listPlaylistEntries("reading")).resolves.toEqual([playlistEntry()])
    await expect(library.appendPlaylistEntries("reading", [{ id: "entry-1", name: "Demo", source: { kind: "archive", path: "D:/books/demo.cbz" } }])).resolves.toEqual([playlistEntry()])
    await expect(library.removePlaylistEntries("reading", ["entry-1"])).resolves.toBe(1)
    await expect(library.reorderPlaylistEntries("reading", ["entry-1"])).resolves.toBeUndefined()
    await expect(library.removePlaylist("reading")).resolves.toBe(true)
    await expect(library.removePlaylist("missing")).resolves.toBe(false)
    expect(requests.every((request) => request.headers.get("x-xiranite-token") === "library-token")).toBe(true)
    expect(await requests[2]?.json()).toEqual({ id: "reading", name: "Reading" })
    expect(await requests[4]?.json()).toEqual({ entries: [{ id: "entry-1", name: "Demo", source: { kind: "archive", path: "D:/books/demo.cbz" } }] })
    expect(await requests[6]?.json()).toEqual({ ids: ["entry-1"] })
    expect(await requests[7]?.json()).toEqual({ ids: ["entry-1"] })
  })

  it("[neoview.library.playlist.remote-wire] rejects malformed library responses before exposing them to CLI", async () => {
    const library = new RemoteReaderLibraryController({
      baseUrl: "http://127.0.0.1:41000",
      token: "library-token",
      fetch: vi.fn(async () => Response.json({ recentCount: -1 })) as typeof fetch,
    })
    await expect(library.statistics()).rejects.toThrow("invalid statistics response")
  })

  it("[neoview.cli.connect] reuses the running Reader controller for inspect, pages, navigation and original-byte streaming", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-remote-"))
    cleanup.push(directory)
    await writeFile(join(directory, "1.jpg"), Uint8Array.of(1, 2, 3))
    await writeFile(join(directory, "2.png"), Uint8Array.of(4, 5, 6, 7))
    const server = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "remote-token",
      progressStore: false,
    })
    const requests: Request[] = []
    const remote = new RemoteReaderHeadlessController({
      baseUrl: "http://127.0.0.1:41000",
      token: "remote-token",
      fetch: controllerFetch(server, requests),
    })
    try {
      const opened = await remote.open({ path: directory })
      expect(opened).toMatchObject({ book: { pageCount: 2 }, visiblePages: [{ index: 0, name: "1.jpg" }] })
      expect(remote.inspect()).toEqual(opened)
      await expect(remote.listPages(0, 2)).resolves.toMatchObject([{ index: 0 }, { index: 1 }])
      expect(requests.some((request) => new URL(request.url).searchParams.get("thumbnails") === "0")).toBe(true)
      await expect(remote.next()).resolves.toMatchObject({ frame: { anchorPageIndex: 1 }, visiblePages: [{ index: 1 }] })
      const page = await remote.openPageStream(1)
      try {
        expect(page.contentType).toBe("image/png")
        expect(page.byteLength).toBe(4)
        expect(new Uint8Array(await new Response(page.stream).arrayBuffer())).toEqual(Uint8Array.of(4, 5, 6, 7))
      } finally {
        await page.close()
      }
    } finally {
      await remote[Symbol.asyncDispose]()
      await server[Symbol.asyncDispose]()
    }
    expect(requests.at(-1)?.method).toBe("DELETE")
  })

  it("[neoview.page-order.cli-connect] preserves physical identity and stable random order across authenticated HTTP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-remote-page-order-"))
    cleanup.push(directory)
    await writeFile(join(directory, "1.jpg"), Uint8Array.of(1))
    await writeFile(join(directory, "2.jpg"), Uint8Array.of(2))
    await writeFile(join(directory, "10.jpg"), Uint8Array.of(10))
    const server = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "remote-token",
      progressStore: false,
    })
    const requests: Request[] = []
    const remote = new RemoteReaderHeadlessController({
      baseUrl: "http://127.0.0.1:41000",
      token: "remote-token",
      fetch: controllerFetch(server, requests),
    })
    try {
      await remote.open({ path: directory })
      const selected = await remote.goTo(2)
      const selectedId = selected.visiblePages[0]!.id
      const descending = await remote.updatePageOrder({ sortMode: "fileNameDescending" })
      expect(descending).toMatchObject({
        frame: { anchorPageIndex: 0 },
        visiblePages: [{ id: selectedId, name: "10.jpg", index: 0 }],
        pageOrder: { sortMode: "fileNameDescending", mediaPriority: "none" },
      })
      await expect(remote.next()).resolves.toMatchObject({ visiblePages: [{ name: "2.jpg", index: 1 }] })
      const firstRandom = await remote.updatePageOrder({ sortMode: "random", randomSeed: "stable-seed" })
      const firstNames = (await remote.listPages(0, 3)).map((page) => page.name)
      const secondRandom = await remote.updatePageOrder({ sortMode: "random", randomSeed: "stable-seed" })
      const secondNames = (await remote.listPages(0, 3)).map((page) => page.name)
      expect(secondNames).toEqual(firstNames)
      expect(secondRandom.pageOrder).toEqual(firstRandom.pageOrder)
      expect(requests.some((request) => request.method === "PATCH" && request.url.endsWith("/page-order"))).toBe(true)
    } finally {
      await remote[Symbol.asyncDispose]()
      await server[Symbol.asyncDispose]()
    }
  })

  it("[neoview.book-settings.cli-connect] reuses authenticated HTTP, wire validation and frame projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-remote-settings-"))
    cleanup.push(directory)
    await writeFile(join(directory, "1.jpg"), Uint8Array.of(1, 2, 3))
    const server = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "remote-token",
      progressStore: false,
      bookSettingsStore: memoryBookSettingsStore(),
    })
    const requests: Request[] = []
    const remote = new RemoteReaderHeadlessController({
      baseUrl: "http://127.0.0.1:41000",
      token: "remote-token",
      fetch: controllerFetch(server, requests),
    })
    try {
      await remote.open({ path: directory })
      await expect(remote.getBookSettings()).resolves.toMatchObject({ revision: 0, effective: { pageMode: "single" } })
      const updated = await remote.updateBookSettings(0, { direction: "right-to-left", pageMode: "double" })
      expect(updated).toMatchObject({
        settings: { revision: 1, overrides: { direction: "right-to-left", pageMode: "double" } },
        reader: { frame: { direction: "right-to-left", layout: { pageMode: "double" } } },
      })
      expect(requests.some((request) => request.method === "PATCH" && request.url.endsWith("/book-settings"))).toBe(true)
    } finally {
      await remote[Symbol.asyncDispose]()
      await server[Symbol.asyncDispose]()
    }
  })

  it("[neoview.emm.cli-connect] reuses authenticated GUI EMM updates and refreshed translated titles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-remote-emm-"))
    cleanup.push(directory)
    await writeFile(join(directory, "1.jpg"), Uint8Array.of(1, 2, 3))
    const store = memoryEmmStore("旧译名")
    const server = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "remote-token",
      progressStore: false,
      directoryEmmRecordStore: store,
      emmOverrideStore: store,
    })
    const requests: Request[] = []
    const remote = new RemoteReaderHeadlessController({
      baseUrl: "http://127.0.0.1:41000",
      token: "remote-token",
      fetch: controllerFetch(server, requests),
    })
    try {
      await remote.open({ path: directory })
      await expect(remote.getEmmMetadata()).resolves.toMatchObject({ revision: 0, overrides: {} })
      const updated = await remote.updateEmmMetadata(0, { rating: 5, translatedTitle: "新译名" })
      expect(updated).toMatchObject({
        metadata: { revision: 1, overrides: { rating: 5, translatedTitle: "新译名" } },
        reader: { book: { translatedTitle: "新译名" } },
      })
      await expect(remote.updateEmmMetadata(0, { rating: 4 })).rejects.toThrow("409")
      expect(requests.some((request) => request.method === "PATCH" && request.url.endsWith("/emm-metadata"))).toBe(true)
    } finally {
      await remote[Symbol.asyncDispose]()
      await server[Symbol.asyncDispose]()
    }
  })

  it("[neoview.headless.adjacent-book-connect] shares sibling switching with the authenticated GUI controller", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-remote-adjacent-"))
    cleanup.push(root)
    const first = join(root, "Book 1")
    const second = join(root, "Book 2")
    await Promise.all([mkdir(first), mkdir(second)])
    await Promise.all([
      writeFile(join(first, "1.jpg"), Uint8Array.of(1)),
      writeFile(join(second, "1.jpg"), Uint8Array.of(2)),
    ])
    const server = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "remote-token", progressStore: false })
    const requests: Request[] = []
    const remote = new RemoteReaderHeadlessController({
      baseUrl: "http://127.0.0.1:41000",
      token: "remote-token",
      fetch: controllerFetch(server, requests),
    })
    try {
      await remote.open({ path: first })
      await expect(remote.openAdjacent("next")).resolves.toMatchObject({ book: { displayName: "Book 2" } })
      await expect(remote.openAdjacent("next")).resolves.toBeUndefined()
      expect(requests.filter((request) => request.url.endsWith("/adjacent-book"))).toHaveLength(2)
    } finally {
      await remote[Symbol.asyncDispose]()
      await server[Symbol.asyncDispose]()
    }
  })

  it("[neoview.book-settings.wire-schema] rejects malformed settings without publishing them", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      if (request.url.endsWith("/book-settings")) {
        return Response.json({ settings: { schemaVersion: 1, bookId: "book-1", revision: -1, overrides: {}, effective: {}, inherited: [] } })
      }
      return Response.json(sessionDto("http://127.0.0.1:41000/reader/s/reader-1/page/page-1"), { status: 201 })
    }) as typeof fetch
    const remote = new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "token", fetch: fetchMock })
    try {
      await remote.open({ path: "D:/book.cbz" })
      await expect(remote.getBookSettings()).rejects.toThrow("invalid book-settings response")
    } finally {
      await remote[Symbol.asyncDispose]()
    }
  })

  it("[neoview.progressive-upscale.cli-connect] [neoview.super-resolution.cache-controls-remote] controls artifact, preload and cache routes through the authenticated session", async () => {
    const requests: Request[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      const url = new URL(request.url)
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      if (url.pathname.endsWith("/upscale-artifact")) {
        return Response.json({
          status: "generated",
          artifactUrl: "http://127.0.0.1:41000/reader/s/reader-1/upscale-artifact/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?version=sha256-test&token=token",
          contentType: "image/png",
          bytes: 123,
          version: "sha256-test",
          execution: { modelId: "anime", engine: "upscayl", scale: 2, width: 200, height: 300, elapsedMs: 12.5 },
        }, { status: 201 })
      }
      if (url.pathname.endsWith("/upscale-artifact-cache")) {
        const snapshot = artifactCacheSnapshot()
        return Response.json(request.method === "POST"
          ? { ...snapshot, reason: url.searchParams.get("kind") === "book" ? "book" : "explicit", removedEntries: 2, removedBytes: 20 }
          : snapshot)
      }
      if (url.pathname.includes("/upscale-preload")) return Response.json({ snapshots: [preloadSnapshot(url.searchParams.get("mode") ?? "nearby")] }, { status: request.method === "POST" ? 202 : 200 })
      return Response.json(sessionDto("http://127.0.0.1:41000/reader/s/reader-1/page/page-1"), { status: 201 })
    }) as typeof fetch
    const remote = new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "token", fetch: fetchMock })
    try {
      await remote.open({ path: "D:/book.cbz" })
      await expect(remote.generateUpscaleArtifact(0)).resolves.toMatchObject({ status: "generated", bytes: 123 })
      await expect(remote.getUpscalePreload()).resolves.toMatchObject([{ mode: "nearby" }])
      await expect(remote.startUpscalePreload("progressive")).resolves.toMatchObject([{ mode: "progressive" }])
      await expect(remote.pauseUpscalePreload()).resolves.toMatchObject([{ mode: "nearby" }])
      await expect(remote.retryUpscalePreload("nearby")).resolves.toMatchObject([{ mode: "nearby" }])
      await expect(remote.getUpscaleArtifactCache()).resolves.toMatchObject({ entries: 3, bytes: 300 })
      await expect(remote.cleanupUpscaleArtifactCache("book")).resolves.toMatchObject({ reason: "book", removedEntries: 2 })
    } finally {
      await remote[Symbol.asyncDispose]()
    }
    const controls = requests.filter((request) => request.url.includes("upscale-"))
    expect(controls.map((request) => [request.method, new URL(request.url).pathname, new URL(request.url).searchParams.get("mode")])).toEqual([
      ["POST", "/reader/s/reader-1/pages/page-1/upscale-artifact", null],
      ["GET", "/reader/s/reader-1/upscale-preload", null],
      ["POST", "/reader/s/reader-1/upscale-preload/start", "progressive"],
      ["POST", "/reader/s/reader-1/upscale-preload/pause", null],
      ["POST", "/reader/s/reader-1/upscale-preload/retry", "nearby"],
      ["GET", "/reader/s/reader-1/upscale-artifact-cache", null],
      ["POST", "/reader/s/reader-1/upscale-artifact-cache", null],
    ])
    expect(controls.every((request) => request.headers.get("x-xiranite-token") === "token")).toBe(true)
  })

  it("[neoview.progressive-upscale.wire-schema] rejects malformed responses and preserves caller cancellation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted()
      const request = new Request(input, init)
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      if (request.url.includes("upscale-artifact-cache")) return Response.json({ ...artifactCacheSnapshot(), bytes: -1 })
      if (request.url.includes("upscale-preload")) return Response.json({ snapshots: [{ ...preloadSnapshot("nearby"), progress: 2 }] })
      if (request.url.includes("upscale-artifact")) return Response.json({ status: "hit", artifactUrl: "https://example.com/not-local", contentType: "image/png", bytes: 1, version: "v1" })
      return Response.json(sessionDto("http://127.0.0.1:41000/reader/s/reader-1/page/page-1"), { status: 201 })
    }) as typeof fetch
    const remote = new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "token", fetch: fetchMock })
    try {
      await remote.open({ path: "D:/book.cbz" })
      await expect(remote.getUpscalePreload()).rejects.toThrow()
      await expect(remote.getUpscaleArtifactCache()).rejects.toThrow()
      await expect(remote.generateUpscaleArtifact(0)).rejects.toThrow("outside the connected backend")
      const controller = new AbortController()
      controller.abort(new Error("stop preload"))
      await expect(remote.startUpscalePreload("nearby", controller.signal)).rejects.toThrow("stop preload")
    } finally {
      await remote[Symbol.asyncDispose]()
    }
  })

  it("[neoview.subtitle.remote] lists and renders video subtitles through opaque backend assets", async () => {
    const requests: Request[] = []
    const assetUrl = "http://127.0.0.1:41000/reader/s/reader-1/subtitle/page-1/subtitle-1?version=subtitle-v1&token=token"
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      const url = new URL(request.url)
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      if (url.pathname.endsWith("/subtitles")) {
        return Response.json({ tracks: [{
          id: "subtitle-1",
          name: "clip.zh-CN.srt",
          format: "srt",
          contentVersion: "subtitle-v1",
          assetUrl,
        }] })
      }
      if (url.pathname.includes("/subtitle/")) {
        return new Response("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n", {
          headers: { "content-type": "text/vtt; charset=utf-8", etag: '"neoview-subtitle-v1"' },
        })
      }
      return Response.json(sessionDto("http://127.0.0.1:41000/reader/s/reader-1/page/page-1", {
        mediaKind: "video",
        name: "clip.mp4",
      }), { status: 201 })
    }) as typeof fetch
    const remote = new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "token", fetch: fetchMock })
    try {
      await remote.open({ path: "D:/private/clip.mp4" })
      await expect(remote.listSubtitles(0)).resolves.toEqual([{
        id: "subtitle-1",
        name: "clip.zh-CN.srt",
        format: "srt",
        contentVersion: "subtitle-v1",
      }])
      await expect(remote.renderSubtitle(0, "subtitle-1")).resolves.toEqual({
        bytes: new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n"),
        contentVersion: "subtitle-v1",
      })
    } finally {
      await remote[Symbol.asyncDispose]()
    }
    const listRequests = requests.filter((request) => new URL(request.url).pathname.endsWith("/subtitles"))
    expect(listRequests.length).toBeGreaterThanOrEqual(2)
    expect(new URL(listRequests[0]!.url).searchParams.get("pageId")).toBe("page-1")
    const assetRequest = requests.find((request) => new URL(request.url).pathname.includes("/subtitle/"))!
    expect(assetRequest.headers.get("x-xiranite-token")).toBe("token")
    expect(assetRequest.url).toBe(assetUrl)
    expect(assetRequest.url).not.toContain("D:/private")
  })

  it("[neoview.subtitle.remote-wire-security] bounds DTOs and rejects non-video, invalid-page and unsafe asset URLs", async () => {
    let videoSession = false
    let subtitlePayload: unknown = { tracks: [{
      id: "subtitle-1",
      name: "clip.srt",
      format: "srt",
      contentVersion: "v1",
      assetUrl: "http://127.0.0.1:41000/reader/s/reader-1/subtitle/page-1/subtitle-1?version=v1&token=token",
      unexpected: true,
    }] }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      if (url.pathname.endsWith("/subtitles")) return Response.json(subtitlePayload)
      return Response.json(sessionDto("http://127.0.0.1:41000/reader/s/reader-1/page/page-1", videoSession ? {
        mediaKind: "video",
        name: "clip.mp4",
      } : undefined), { status: 201 })
    }) as typeof fetch
    const remote = new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "token", fetch: fetchMock })
    try {
      await remote.open({ path: "D:/book.cbz" })
      await expect(remote.listSubtitles(-1)).rejects.toThrow("out of range")
      await expect(remote.listSubtitles(0)).rejects.toThrow("video page")

      const videoRemote = new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "token", fetch: fetchMock })
      try {
        videoSession = true
        await videoRemote.open({ path: "D:/clip.mp4" })
        await expect(videoRemote.listSubtitles(0)).rejects.toThrow("invalid subtitles response")
        subtitlePayload = { tracks: [{
          id: "subtitle-1",
          name: "clip.srt",
          format: "srt",
          contentVersion: "v1",
          assetUrl: "https://example.com/reader/s/reader-1/subtitle/page-1/subtitle-1?version=v1&token=token",
        }] }
        await expect(videoRemote.listSubtitles(0)).rejects.toThrow("outside the connected backend")
        subtitlePayload = { tracks: [{
          id: "subtitle-1",
          name: "clip.srt",
          format: "srt",
          contentVersion: "v1",
          assetUrl: "http://127.0.0.1:41000/reader/s/reader-1/subtitle/page-1/subtitle-1?version=stale&token=token",
        }] }
        await expect(videoRemote.listSubtitles(0)).rejects.toThrow("invalid subtitle asset URL")
      } finally {
        await videoRemote[Symbol.asyncDispose]()
      }
    } finally {
      await remote[Symbol.asyncDispose]()
    }
  })

  it("[neoview.subtitle.remote-cancellation] propagates abort through subtitle asset fetch", async () => {
    const assetUrl = "http://127.0.0.1:41000/reader/s/reader-1/subtitle/page-1/subtitle-1?version=v1&token=token"
    const requests: Request[] = []
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      const url = new URL(request.url)
      if (request.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }))
      if (url.pathname.endsWith("/subtitles")) {
        return Promise.resolve(Response.json({ tracks: [{
          id: "subtitle-1", name: "clip.srt", format: "srt", contentVersion: "v1", assetUrl,
        }] }))
      }
      if (url.pathname.includes("/subtitle/")) return pendingUntilAborted(init?.signal)
      return Promise.resolve(Response.json(sessionDto("http://127.0.0.1:41000/reader/s/reader-1/page/page-1", {
        mediaKind: "video",
        name: "clip.mp4",
      }), { status: 201 }))
    }) as typeof fetch
    const remote = new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "token", fetch: fetchMock })
    try {
      await remote.open({ path: "D:/clip.mp4" })
      const abort = new AbortController()
      const rendering = remote.renderSubtitle(0, "subtitle-1", abort.signal)
      await vi.waitFor(() => expect(requests.some((request) => new URL(request.url).pathname.includes("/subtitle/"))).toBe(true))
      abort.abort(new Error("cancel subtitle render"))
      await expect(rendering).rejects.toThrow("cancel subtitle render")
      expect(requests.find((request) => new URL(request.url).pathname.includes("/subtitle/"))?.url).toBe(assetUrl)
    } finally {
      await remote[Symbol.asyncDispose]()
    }
  })

  it("[neoview.media-progress.remote] validates and forwards media progress through the current remote session", async () => {
    const requests: Request[] = []
    const progress = { bookId: "video-book", position: 12.5, duration: 30, completed: false, updatedAt: 123 }
    let getPayload: unknown = { progress: null }
    let patchPayload: unknown = { progress, durable: true }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      const url = new URL(request.url)
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      if (url.pathname.endsWith("/media-progress")) {
        return Response.json(request.method === "GET" ? getPayload : patchPayload)
      }
      return Response.json(sessionDto("http://127.0.0.1:41000/reader/s/reader-1/page/page-1", {
        mediaKind: "video",
        name: "clip.mp4",
      }), { status: 201 })
    }) as typeof fetch
    const remote = new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "token", fetch: fetchMock })
    try {
      await remote.open({ path: "D:/clip.mp4" })
      await expect(remote.getMediaProgress()).resolves.toBeUndefined()
      await expect(remote.updateMediaProgress({ position: 12.5, duration: 30, completed: false }, { flush: true })).resolves.toEqual(progress)
      const updateRequest = requests.find((request) => request.method === "PATCH")!
      expect(updateRequest.headers.get("x-xiranite-token")).toBe("token")
      expect(await updateRequest.json()).toEqual({ position: 12.5, duration: 30, completed: false, flush: true })

      getPayload = { progress: { ...progress, position: 31 } }
      await expect(remote.getMediaProgress()).rejects.toThrow("invalid media progress response")
      patchPayload = { progress, durable: "yes" }
      await expect(remote.updateMediaProgress({ position: 1, duration: 30, completed: false })).rejects.toThrow("invalid media progress update response")
    } finally {
      await remote[Symbol.asyncDispose]()
    }
  })

  it("[neoview.media-progress.remote-errors] preserves HTTP failures and request cancellation", async () => {
    let mode: "open" | "conflict" | "pending" = "open"
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      if (request.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }))
      if (url.pathname.endsWith("/media-progress")) {
        if (mode === "conflict") return Promise.resolve(Response.json({ error: "Reader session does not contain video media" }, { status: 409 }))
        if (mode === "pending") return pendingUntilAborted(init?.signal)
      }
      return Promise.resolve(Response.json(sessionDto("http://127.0.0.1:41000/reader/s/reader-1/page/page-1", {
        mediaKind: "video",
        name: "clip.mp4",
      }), { status: 201 }))
    }) as typeof fetch
    const remote = new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "token", fetch: fetchMock })
    try {
      await remote.open({ path: "D:/clip.mp4" })
      mode = "conflict"
      await expect(remote.getMediaProgress()).rejects.toThrow("Reader session does not contain video media")
      mode = "pending"
      const abort = new AbortController()
      const pending = remote.updateMediaProgress({ position: 1, duration: 30, completed: false }, {}, abort.signal)
      abort.abort(new Error("cancel media progress"))
      await expect(pending).rejects.toThrow("cancel media progress")
    } finally {
      await remote[Symbol.asyncDispose]()
    }
  })

  it("[neoview.cli.connect-security] requires a token, loopback URL and valid authenticated responses", async () => {
    expect(() => new RemoteReaderHeadlessController({ baseUrl: "https://reader.example.com", token: "secret" })).toThrow("loopback")
    expect(() => new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "" })).toThrow("non-empty")
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }))
    const remote = new RemoteReaderHeadlessController({ baseUrl: "http://localhost:41000", token: "wrong", fetch: fetchMock })
    await expect(remote.open({ path: "D:/book.cbz" })).rejects.toThrow("Unauthorized")
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("wrong")
    await remote[Symbol.asyncDispose]()
  })

  it("[neoview.cli.connect-security] rejects an asset URL outside the authenticated backend and releases the created session", async () => {
    const requests: Request[] = []
    const session = sessionDto("https://example.com/reader/s/reader-1/page/page-1")
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      return request.method === "DELETE"
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(session), { status: 201, headers: { "content-type": "application/json" } })
    }) as typeof fetch
    const remote = new RemoteReaderHeadlessController({ baseUrl: "http://127.0.0.1:41000", token: "token", fetch: fetchMock })
    await expect(remote.open({ path: "D:/book.cbz" })).rejects.toThrow("outside the connected backend")
    expect(requests.at(-1)?.method).toBe("DELETE")
    await remote[Symbol.asyncDispose]()
  })

  it("[neoview.cli.connect-passwords] preserves string and UTF-8 raw credential scopes without putting secrets in URLs", async () => {
    const requests: Request[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      return request.method === "DELETE"
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(sessionDto("http://127.0.0.1:41000/reader/s/reader-1/page/page-1")), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
    }) as typeof fetch
    const remote = new RemoteReaderHeadlessController({
      baseUrl: "http://127.0.0.1:41000",
      token: "token",
      fetch: fetchMock,
    })
    try {
      await remote.open({ path: "D:/book.cb7", archivePasswords: [{ password: "文本-password" }] })
      const rawPassword = new TextEncoder().encode("nested-secret")
      await remote.open({
        path: "D:/book.cb7",
        archivePasswords: [{ entryPaths: ["inner.cb7"], rawPassword }],
      })
      expect(rawPassword).toEqual(new TextEncoder().encode("nested-secret"))
    } finally {
      await remote[Symbol.asyncDispose]()
    }
    const posts = requests.filter((request) => request.method === "POST")
    await expect(posts[0]!.json()).resolves.toMatchObject({ archivePasswords: [{ password: "文本-password" }] })
    await expect(posts[1]!.json()).resolves.toMatchObject({
      archivePasswords: [{ entryPaths: ["inner.cb7"], password: "nested-secret" }],
    })
    expect(requests.every((request) => !request.url.includes("password"))).toBe(true)
  })

  it("[neoview.cli.connect-passwords] rejects ambiguous, oversized and invalid UTF-8 credentials before fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const remote = new RemoteReaderHeadlessController({
      baseUrl: "http://127.0.0.1:41000",
      token: "token",
      fetch: fetchMock,
    })
    try {
      await expect(remote.open({
        path: "D:/book.cb7",
        archivePasswords: [{ password: "text", rawPassword: Uint8Array.of(1) }],
      })).rejects.toThrow("invalid")
      await expect(remote.open({
        path: "D:/book.cb7",
        archivePasswords: [{ password: "x".repeat(4097) }],
      })).rejects.toThrow("invalid")
      await expect(remote.open({
        path: "D:/book.cb7",
        archivePasswords: [{ rawPassword: Uint8Array.of(0xff) }],
      })).rejects.toThrow("valid UTF-8")
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      await remote[Symbol.asyncDispose]()
    }
  })

  it("[neoview.diagnostics.cli-connect] reads the authenticated running-backend snapshot without creating a Reader session", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(diagnosticsSnapshot()), {
      headers: { "content-type": "application/json" },
    }))
    const snapshot = await fetchRemoteReaderDiagnostics({
      baseUrl: "http://127.0.0.1:41000",
      token: "diagnostics-token",
      fetch: fetchMock,
    })
    expect(snapshot).toMatchObject({ reader: { activeSessions: 3 }, scheduler: { cpu: { active: 2 } }, future: { metric: 7 } })
    const request = new Request(fetchMock.mock.calls[0]![0], fetchMock.mock.calls[0]![1])
    expect(request.url).toBe("http://127.0.0.1:41000/reader/diagnostics")
    expect(request.headers.get("x-xiranite-token")).toBe("diagnostics-token")
  })

  it("[neoview.diagnostics.wire-schema] rejects malformed nested metrics without rejecting compatible optional fields", async () => {
    const malformed = diagnosticsSnapshot()
    malformed.process.rssBytes = -1
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(malformed), {
      headers: { "content-type": "application/json" },
    }))
    await expect(fetchRemoteReaderDiagnostics({
      baseUrl: "http://127.0.0.1:41000",
      token: "diagnostics-token",
      fetch: fetchMock,
    })).rejects.toThrow("invalid diagnostics response")
  })
})

function controllerFetch(controller: ReaderHttpController, requests: Request[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request.clone())
    return await controller.handle(request) ?? new Response(JSON.stringify({ error: "Not found" }), { status: 404 })
  }) as typeof fetch
}

function sessionDto(assetUrl: string, pageOptions: {
  mediaKind?: "image" | "animated-image" | "video"
  name?: string
  contentVersion?: string
} = {}) {
  return {
    sessionId: "reader-1",
    book: { id: "book-1", displayName: "book.cbz", pageCount: 1 },
    frame: {
      generation: 0,
      anchorPageIndex: 0,
      direction: "left-to-right",
      layout: { pageMode: "single", widePageMode: "single", firstPageMode: "normal" },
      pages: [{ pageId: "page-1", pageIndex: 0, role: "primary" }],
      atStart: true,
      atEnd: true,
    },
    visiblePages: [{
      id: "page-1",
      index: 0,
      name: pageOptions.name ?? "1.jpg",
      mediaKind: pageOptions.mediaKind ?? "image",
      contentVersion: pageOptions.contentVersion ?? "v1",
      assetUrl,
    }],
  }
}

function pendingUntilAborted(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    const abort = () => reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"))
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener("abort", abort, { once: true })
  })
}

function preloadSnapshot(mode: string) {
  return {
    contextId: "reader:reader-1:upscale",
    generation: 1,
    mode,
    state: "running",
    planned: 4,
    settled: 1,
    failed: 0,
    cancelled: 0,
    pending: 3,
    progress: 0.25,
    startedAt: 10,
    updatedAt: 20,
  }
}

function artifactCacheSnapshot() {
  return {
    entries: 3, bytes: 300, maxBytes: 1_024, maxEntryBytes: 512, activeLeases: 0,
    hits: 2, misses: 1, writes: 3, rejectedWrites: 0, evictions: 0, integrityFailures: 0,
  }
}

function thumbnailMaintenanceSnapshot() {
  return {
    totalRows: 12,
    fileRows: 7,
    folderRows: 5,
    blobBytes: 1024,
    emptyBlobs: 0,
    failedRows: 1,
    failuresByReason: { "decode-error": 1 },
    databaseBytes: 4096,
    walBytes: 128,
    writer: {
      pendingWrites: 0,
      flushing: false,
      committedBatches: 2,
      committedWrites: 12,
      busyRetries: 0,
      failedBatches: 0,
    },
  }
}

function diagnosticsSnapshot() {
  const pool = { active: 2, queued: 1, queuedByPriority: { interactive: 0, view: 0, ahead: 1, background: 0 } }
  return {
    schemaVersion: 1,
    sampledAtMs: 10,
    uptimeSeconds: 5,
    process: { rssBytes: 8, heapTotalBytes: 7, heapUsedBytes: 6, externalBytes: 5, arrayBuffersBytes: 4, cpuUserMicros: 3, cpuSystemMicros: 2 },
    reader: { activeSessions: 3 },
    assets: { activeTransformFlights: 0, presentation: null, thumbnails: null },
    presentationDiskCache: { enabled: false },
    solidArchiveCache: { entries: 0, retainedBytes: 0, maxBytes: 0 },
    scheduler: { cpu: pool, io: pool, gpu: pool },
    future: { metric: 7 },
  }
}

function memoryBookSettingsStore(): ReaderBookSettingsStore {
  let record: ReaderBookSettingsRecord | undefined
  return {
    getBookSettings: vi.fn(async () => record),
    saveBookSettings: vi.fn(async (bookId, overrides, expectedRevision, updatedAt) => {
      if ((record?.revision ?? 0) !== expectedRevision) return undefined
      record = { bookId, overrides, revision: expectedRevision + 1, updatedAt }
      return record
    }),
    importBookSettings: vi.fn(async () => ({ inserted: 0, updated: 0, unchanged: 0 })),
  }
}

function memoryEmmStore(legacyTitle: string): ReaderEmmOverrideStore & ReaderDirectoryEmmRecordStore {
  const records = new Map<string, ReaderEmmOverrideRecord>()
  return {
    directoryEmmAvailable: true,
    getEmmOverride: vi.fn(async (path) => records.get(path)),
    saveEmmOverride: vi.fn(async (path, overrides: ReaderEmmOverrides, expectedRevision, updatedAt) => {
      const current = records.get(path)
      if ((current?.revision ?? 0) !== expectedRevision) return undefined
      const record = { path, overrides, revision: expectedRevision + 1, updatedAt }
      records.set(path, record)
      return record
    }),
    readDirectoryEmmRecords: vi.fn(async (paths: readonly string[]) => new Map(paths.map((path) => [
      path,
      { emmJson: JSON.stringify({ translated_title: records.get(path)?.overrides.translatedTitle ?? legacyTitle }) },
    ]))),
  }
}
