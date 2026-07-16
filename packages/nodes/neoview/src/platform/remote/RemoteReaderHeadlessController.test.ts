import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderHttpController } from "../asset-route/ReaderHttpController.js"
import { fetchRemoteReaderDiagnostics, RemoteReaderHeadlessController } from "./RemoteReaderHeadlessController.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("RemoteReaderHeadlessController", () => {
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

function sessionDto(assetUrl: string) {
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
      name: "1.jpg",
      mediaKind: "image",
      contentVersion: "v1",
      assetUrl,
    }],
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
