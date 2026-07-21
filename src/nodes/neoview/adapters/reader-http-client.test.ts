import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderHttpClient, READER_FOLDER_DETAIL_DEFAULT_WIDTHS, ReaderHttpError } from "./reader-http-client"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("reader-http-client", () => {
  it("[neoview.react.source-watch-client] reloads and long-polls one encoded session without caching", async () => {
    const reloaded = { sessionId: "reader-2" }
    const change = { revision: 4, state: "changed", kinds: ["update"], count: 2 }
    const fetchMock = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => (
      init?.method === "POST" ? Response.json(reloaded, { status: 201 }) : Response.json(change)
    ))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.waitForSourceChanges!("reader/1", 3)).resolves.toEqual(change)
    await expect(client.reload!("reader/1")).resolves.toEqual(reloaded)

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader%2F1/source-changes?after=3")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" })
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader%2F1/reload")
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: "{}" })
  })

  it("[neoview.super-resolution.current-page-client] requests an authenticated automatic artifact URL", async () => {
    const result = { status: "hit", artifactUrl: "http://127.0.0.1:41000/reader/s/reader-1/upscale-artifact/digest", contentType: "image/png", bytes: 42, version: "v2" } as const
    const fetchMock = vi.fn(async () => Response.json(result))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.upscalePage!("reader/1", "page 1")).resolves.toEqual(result)
    await expect(client.probeUpscalePage!("reader/1", "page 1")).resolves.toEqual(result)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("http://127.0.0.1:41000/reader/s/reader%2F1/pages/page%201/upscale-artifact?trigger=automatic-current")
    expect(init).toMatchObject({ method: "POST" })
    expect(new Headers(init?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader%2F1/pages/page%201/upscale-artifact?trigger=automatic-current&probe=true")
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBeUndefined()
  })

  it("[neoview.super-resolution.cards-client] reads capabilities/status/cache and confirms cleanup on the active session", async () => {
    const capability = { available: true, models: [], engines: [], probedAt: 1 } as const
    const preload = { snapshots: [] }
    const cache = { entries: 0, bytes: 0, maxBytes: 1, maxEntryBytes: 1, activeLeases: 0, hits: 0, misses: 0, writes: 0, rejectedWrites: 0, evictions: 0, integrityFailures: 0 }
    const cleanup = { ...cache, reason: "explicit", removedEntries: 0, removedBytes: 0 } as const
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request)
      if (url.includes("upscale-capabilities")) return Response.json(capability)
      if (url.includes("upscale-preload")) return Response.json(preload)
      if (init?.method === "POST") return Response.json(cleanup)
      return Response.json(cache)
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.upscaleCapabilities!("reader/1", true)).resolves.toEqual(capability)
    await expect(client.upscaleCapabilities!()).resolves.toEqual(capability)
    await expect(client.upscalePreloadSnapshots!("reader/1")).resolves.toEqual([])
    await expect(client.startUpscalePreload!("reader/1", "progressive")).resolves.toEqual([])
    await expect(client.upscaleCache!("reader/1")).resolves.toEqual(cache)
    await expect(client.cleanupUpscaleCache!("reader/1", "all")).resolves.toEqual(cleanup)

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:41000/reader/s/reader%2F1/upscale-capabilities?refresh=true",
      "http://127.0.0.1:41000/reader/upscale-capabilities",
      "http://127.0.0.1:41000/reader/s/reader%2F1/upscale-preload",
      "http://127.0.0.1:41000/reader/s/reader%2F1/upscale-preload/start?mode=progressive",
      "http://127.0.0.1:41000/reader/s/reader%2F1/upscale-artifact-cache",
      "http://127.0.0.1:41000/reader/s/reader%2F1/upscale-artifact-cache?kind=all&confirmed=true",
    ])
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: "POST" })
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({ method: "POST" })
    expect(fetchMock.mock.calls.every(([, init]) => new Headers(init?.headers).get("x-xiranite-token") === "reader-token")).toBe(true)
  })

  it("[neoview.color-filter.client] sends one authenticated aggregate config mutation", async () => {
    const colorFilter = {
      colorizeEnabled: false, colorizePreset: "redAndBlueGray", customColors: [], onlyBlackAndWhite: false,
      brightness: 125, contrast: 100, saturation: 100, sepia: 0, hueRotate: 0, invert: false, negative: false,
    } as const
    const fetchMock = vi.fn(async () => Response.json({ colorFilter }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.updateColorFilter!({ colorFilter: { brightness: 125 } })).resolves.toEqual(colorFilter)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ colorFilter: { brightness: 125 } })
  })

  it("[neoview.page-transition.client] sends one authenticated aggregate config mutation", async () => {
    const pageTransition = { enabled: true, type: "slide", duration: 240, easing: "easeOutQuad" } as const
    const fetchMock = vi.fn(async () => Response.json({ pageTransition }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.updatePageTransition!({ pageTransition: { type: "slide", duration: 240 } })).resolves.toEqual(pageTransition)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ pageTransition: { type: "slide", duration: 240 } })
  })

  it("[neoview.page-order.client] updates session ordering and canonical book locks through authenticated routes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/reader/config")
      ? Response.json({ book: { lockedSortMode: "fileSizeDescending", lockedMediaPriority: null, lockedReadingDirection: "left-to-right" } })
      : Response.json({
          frame: { anchorPageIndex: 1 },
          visiblePages: [{ id: "physical-page", index: 1, name: "2.jpg", mediaKind: "image", contentVersion: "v1" }],
          pageOrder: { sortMode: "random", mediaPriority: "imageFirst", randomSeed: "stable-seed" },
        }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.updatePageOrder!("reader/1", {
      sortMode: "random",
      mediaPriority: "imageFirst",
      randomSeed: "stable-seed",
    })).resolves.toMatchObject({ pageOrder: { sortMode: "random", randomSeed: "stable-seed" } })
    await expect(client.updateBookDefaults!({
      book: { lockedSortMode: "fileSizeDescending", lockedMediaPriority: null, lockedReadingDirection: "left-to-right" },
    })).resolves.toEqual({ lockedSortMode: "fileSizeDescending", lockedMediaPriority: null, lockedReadingDirection: "left-to-right" })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader%2F1/page-order")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      sortMode: "random", mediaPriority: "imageFirst", randomSeed: "stable-seed",
    })
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://127.0.0.1:41000/reader/config")
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      book: { lockedSortMode: "fileSizeDescending", lockedMediaPriority: null, lockedReadingDirection: "left-to-right" },
    })
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ method: "PATCH" })
      expect(new Headers(call[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    }
  })

  it("[neoview.react.control] sends token-authenticated open, navigation and close requests", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(request)
      if (url.endsWith("/reader/config")) return Response.json({
        shell: { showDelayMs: 0, panelLayout: {}, cardLayout: {} },
        viewDefaults: { fitMode: "fit", pageMode: "single" },
        folderView: { homePath: "D:/Books", viewMode: "compact", previewCount: 4, thumbnailWidthPercent: 20, bannerWidthPercent: 50, emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: false }, details: { columnOrder: ["name"], hiddenColumns: [], pinnedLeft: ["name"], pinnedRight: [], columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS }, search: { includeSubfolders: true, showHistoryOnFocus: true, searchInPath: false }, tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] } },
        slideshow: { intervalSeconds: 5, loop: false, random: false, fadeTransition: true },
      })
      if (url.endsWith("/reader/sessions")) return Response.json({ sessionId: "reader-1" })
      if (url.includes("/pages?")) return Response.json({ pages: [], total: 2 })
      if (url.includes("/frame-window?")) return Response.json({ frames: [], centerIndex: 17, radius: 4, visiblePages: [] })
      if (url.endsWith("/navigate") || url.endsWith("/options")) return Response.json({ frame: {}, visiblePages: [] })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    expect(await client.config()).toEqual({
      shell: { showDelayMs: 0, panelLayout: {}, cardLayout: {} },
      viewDefaults: { fitMode: "fit", pageMode: "single" },
      folderView: { homePath: "D:/Books", viewMode: "compact", previewCount: 4, thumbnailWidthPercent: 20, bannerWidthPercent: 50, emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: false }, details: { columnOrder: ["name"], hiddenColumns: [], pinnedLeft: ["name"], pinnedRight: [], columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS }, search: { includeSubfolders: true, showHistoryOnFocus: true, searchInPath: false }, tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] } },
      slideshow: { intervalSeconds: 5, loop: false, random: false, fadeTransition: true },
    })
    expect(await client.updateSidebarLayout({ side: "left", pinned: false, width: 360 })).toEqual({ showDelayMs: 0, panelLayout: {}, cardLayout: {} })
    expect(await client.updateCardLayout({ cardId: "page-navigation", expanded: false })).toEqual({ showDelayMs: 0, panelLayout: {}, cardLayout: {} })
    expect(await client.updateBoardLayout({ expectedRevision: 4, board: { panels: [], cards: [] } })).toEqual({ showDelayMs: 0, panelLayout: {}, cardLayout: {} })
    expect(await client.updateViewDefaults({ viewDefaults: { fitMode: "fit-width" } })).toEqual({ fitMode: "fit", pageMode: "single" })
    expect(await client.updateFolderView!({ folderView: { homePath: "D:/Books", viewMode: "details", previewCount: 9, emptyArea: { singleClickAction: "goBack", showBackButton: true }, details: { columnWidths: { name: 300 } }, search: { includeSubfolders: false, searchInPath: true }, tree: { visible: true, layout: "right", size: 240, pinnedPaths: ["D:/Pinned"] } } })).toMatchObject({ homePath: "D:/Books", viewMode: "compact", previewCount: 4 })
    expect(await client.updateSlideshow({ slideshow: { intervalSeconds: 8, loop: true } })).toEqual({ intervalSeconds: 5, loop: false, random: false, fadeTransition: true })
    await client.open("D:/books/demo.cbz")
    await client.listPages("reader-1", 64, 32)
    await client.frameWindow!("reader/1", 17, 4)
    await client.listPageCatalog!("reader-1", 0, 64, { query: "cover", thumbnails: false })
    await client.navigate("reader-1", "next")
    await client.goTo("reader-1", 17)
    await client.updateSessionOptions("reader-1", { layout: { pageMode: "double" } })
    await client.close("reader-1")

    expect(fetchMock).toHaveBeenCalledTimes(15)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/config")
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ side: "left", pinned: false, width: 360 })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ cardId: "page-navigation", expanded: false })
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ expectedRevision: 4, board: { panels: [], cards: [] } })
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({ viewDefaults: { fitMode: "fit-width" } })
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({ folderView: { homePath: "D:/Books", viewMode: "details", previewCount: 9, emptyArea: { singleClickAction: "goBack", showBackButton: true }, details: { columnWidths: { name: 300 } }, search: { includeSubfolders: false, searchInPath: true }, tree: { visible: true, layout: "right", size: 240, pinnedPaths: ["D:/Pinned"] } } })
    expect(JSON.parse(String(fetchMock.mock.calls[6]?.[1]?.body))).toEqual({ slideshow: { intervalSeconds: 8, loop: true } })
    const [openUrl, openInit] = fetchMock.mock.calls[7]!
    expect(String(openUrl)).toBe("http://127.0.0.1:41000/reader/sessions")
    expect(openInit?.method).toBe("POST")
    expect(new Headers(openInit?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(openInit?.body))).toEqual({ path: "D:/books/demo.cbz" })
    expect(String(fetchMock.mock.calls[8]?.[0])).toContain("/reader/s/reader-1/pages?cursor=64&limit=32")
    expect(String(fetchMock.mock.calls[9]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader%2F1/frame-window?center=17&radius=4")
    expect(String(fetchMock.mock.calls[10]?.[0])).toContain("/reader/s/reader-1/pages?cursor=0&limit=64&query=cover&thumbnails=0")
    expect(String(fetchMock.mock.calls[11]?.[0])).toContain("/reader/s/reader-1/navigate")
    expect(JSON.parse(String(fetchMock.mock.calls[12]?.[1]?.body))).toEqual({ action: "goTo", pageIndex: 17 })
    expect(String(fetchMock.mock.calls[13]?.[0])).toContain("/reader/s/reader-1/options")
    expect(JSON.parse(String(fetchMock.mock.calls[13]?.[1]?.body))).toEqual({ layout: { pageMode: "double" } })
    expect(fetchMock.mock.calls[14]?.[1]).toMatchObject({ method: "DELETE", keepalive: true })
  })

  it("[neoview.react.control] surfaces structured backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unsupported reader path" }, { status: 400 })))
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000" }))
    const request = client.open("bad.file")
    await expect(request).rejects.toThrow("Unsupported reader path")
    await expect(request).rejects.toMatchObject({ status: 400, name: "ReaderHttpError" } satisfies Partial<ReaderHttpError>)
  })

  it("[neoview.folder.tabs-duplicate-client] clones the encoded browser session through the dedicated endpoint", async () => {
    const fetchMock = vi.fn(async () => Response.json({ sessionId: "browser-clone", path: "D:/Books", entries: [], cursor: 0, total: 0 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.cloneDirectoryBrowser!("browser/source")).resolves.toMatchObject({ sessionId: "browser-clone", path: "D:/Books" })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/browser/s/browser%2Fsource/clone")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" })
  })

  it("[neoview.folder.tabs-reopen-client] marks explicit tab closes and restores the closed session", async () => {
    const fetchMock = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => init?.method === "DELETE"
      ? new Response(null, { status: 204 })
      : Response.json({ sessionId: "browser-restored", path: "D:/Books", entries: [], cursor: 0, total: 0 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000" }))

    await client.closeDirectoryBrowser!("browser/source", true)
    await client.reopenDirectoryBrowser!("browser/source")
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/browser%2Fsource?remember=1")
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/browser%2Fsource/reopen")
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" })
  })

  it("[neoview.metadata.client] [neoview.emm-tags.client] loads metadata only through the authenticated session route", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      book: {
        displayName: "demo.cbz",
        emm: { tags: [{ namespace: "artist", tag: "Alice", translatedLabel: "爱丽丝" }] },
      },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await expect(client.metadata!("reader-1")).resolves.toMatchObject({
      book: { emm: { tags: [{ namespace: "artist", tag: "Alice", translatedLabel: "爱丽丝" }] } },
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader-1/metadata")
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.image-information.client] requests demand-only page media information", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      pageId: "page-1",
      contentVersion: "v1",
      mediaKind: "video",
      durationSeconds: 10,
    }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.pageMediaInformation!("session/1")).resolves.toMatchObject({ durationSeconds: 10 })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/reader/s/session%2F1/page-media-information")
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.book-information.reveal-client] posts the canonical path to the authenticated system route", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await client.revealSystemPath!("D:/books/demo.cbz")

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/files/reveal")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ path: "D:/books/demo.cbz" })
  })

  it("[neoview.emm-raw-data.url-client] posts the URL to the authenticated system integration route", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await client.openExternalUrl!("https://example.com/source")

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/system/open-external-url")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ url: "https://example.com/source" })
  })

  it("[neoview.folder.system-open-client] posts a file or directory path to the authenticated default-open route", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await client.openSystemPath!("D:/books/demo.cbz")

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/files/open")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ path: "D:/books/demo.cbz" })
  })

  it("[neoview.folder.rename-client] posts a non-overwriting rename through the authenticated transaction route", async () => {
    const result = { results: [], succeeded: 1, failed: 0, cancelled: 0, undoable: 1 }
    const fetchMock = vi.fn(async () => Response.json(result))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    const operation = { kind: "rename" as const, sourcePath: "D:/books/old.cbz", destinationPath: "D:/books/new.cbz", overwrite: false }

    await expect(client.executeFileOperations!([operation])).resolves.toEqual(result)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/files/operations")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ operations: [operation] })
  })

  it("[neoview.file-operations.undo-client] exposes state, confirmed undo and discard transport", async () => {
    const state = {
      available: true,
      count: 1,
      latestId: "undo-1",
      latestCreatedAt: 123,
      supportedKinds: ["copy", "move", "rename", "create-directory"],
      trashRestore: false,
      persistent: true,
    }
    const undo = { undoId: "undo-1", results: [], succeeded: 1, failed: 0, remaining: 0, journalPersisted: true }
    const discard = { undoId: "undo-2", discarded: true, remaining: 0, journalPersisted: true }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith("/operations")) return Response.json(state)
      if (path.endsWith("/undo/discard")) return Response.json(discard)
      return Response.json(undo)
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.fileUndoState!()).resolves.toEqual(state)
    await expect(client.undoLatestFileOperations!(true)).resolves.toEqual(undo)
    await expect(client.discardFileUndo!(true)).resolves.toEqual(discard)

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/files/operations")
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://127.0.0.1:41000/reader/files/undo")
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ confirmed: true })
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe("http://127.0.0.1:41000/reader/files/undo/discard")
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ confirmed: true })
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.file.explorer-context-menu-client] exposes authenticated preview, status and confirmed toggle transport", async () => {
    const preview = { available: true, plan: [], registryFile: "preview.reg" }
    const status = { available: true, enabled: false }
    const enabled = { available: true, enabled: true }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith("/preview")) return Response.json(preview)
      if (path.endsWith("/status")) return Response.json(status)
      return Response.json(enabled)
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.explorerContextMenuPreview!()).resolves.toEqual(preview)
    await expect(client.explorerContextMenuStatus!()).resolves.toEqual(status)
    await expect(client.setExplorerContextMenuEnabled!(true, true)).resolves.toEqual(enabled)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/system/explorer-context-menu/preview")
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://127.0.0.1:41000/reader/system/explorer-context-menu/status")
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe("http://127.0.0.1:41000/reader/system/explorer-context-menu")
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ enabled: true, confirmed: true })
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.storage-information.diagnostics-client] [neoview.thumbnail-architecture-metrics.client] reads the authenticated shared diagnostics snapshot", async () => {
    const snapshot = {
      schemaVersion: 1,
      sampledAtMs: 123,
      assets: {
        presentation: null,
        thumbnails: {
          demands: 2, activeFlights: 1, queuedFlights: 0, runningFlights: 1, cachedEntries: 4, cachedBytes: 40,
          telemetry: {
            cacheHits: 3, cacheMisses: 2, completed: 1, failed: 0, cancelled: 0, evictions: 0,
            byLane: { "reader-visible": { demands: 5, cacheHits: 3, cacheMisses: 2, completed: 1, failed: 0, cancelled: 0 } },
          },
        },
      },
      presentationDiskCache: { enabled: false },
      solidArchiveCache: { retainedBytes: 0 },
    }
    const fetchMock = vi.fn(async () => Response.json(snapshot))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.diagnostics!()).resolves.toEqual(snapshot)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/diagnostics")
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.preload.cache-state-client] [neoview.preload-status.diagnostics-client] scopes preload diagnostics to the active Reader session", async () => {
    const snapshot = { schemaVersion: 1, reader: { sessionPreload: { generation: 4, pages: [] } }, assets: { presentation: null, thumbnails: null }, presentationDiskCache: { enabled: false }, solidArchiveCache: { retainedBytes: 0 } }
    const fetchMock = vi.fn(async () => Response.json(snapshot))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.preloadDiagnostics!("reader/one")).resolves.toEqual(snapshot)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/diagnostics?sessionId=reader%2Fone")
  })

  it("[neoview.system-monitor.client] samples and updates the dedicated monitor contract", async () => {
    const snapshot = { schemaVersion: 1, sampledAtMs: 1, uptimeSeconds: 2, loadAverage: [0, 0, 0], cpu: { averageUsagePercent: 0, cores: [] }, memory: { totalBytes: 1, usedBytes: 0, freeBytes: 1, cachedBytes: null }, network: { available: false, receiveBytesPerSecond: null, transmitBytesPerSecond: null }, disk: { available: false, totalBytes: null, usedBytes: null, freeBytes: null }, gpu: { available: false } }
    const config = { systemMonitor: { enabled: false, refreshIntervalMs: 2_000, maxSamples: 30 } }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/diagnostics/system")
      ? Response.json(snapshot)
      : Response.json(config))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.systemMonitorSnapshot!()).resolves.toEqual(snapshot)
    await expect(client.updateSystemMonitor!({ systemMonitor: config.systemMonitor })).resolves.toEqual(config.systemMonitor)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/diagnostics/system")
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ systemMonitor: config.systemMonitor }) })
  })

  it("[neoview.bindings.adjacent-book-client] opens an adjacent book through the encoded atomic endpoint", async () => {
    const replacement = { sessionId: "reader-2", book: { id: "book-2", displayName: "Book 2", pageCount: 1 }, frame: {}, visiblePages: [] }
    const fetchMock = vi.fn(async () => Response.json(replacement, { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.openAdjacentBook!("reader/source", "previous")).resolves.toEqual(replacement)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader%2Fsource/adjacent-book")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ direction: "previous" })
  })

  it("[neoview.folder.clipboard-client] prepares a sparse clipboard and pastes it into the current directory", async () => {
    const prepared = { available: true as const, mode: "copy" as const, generation: 4, total: 100_000, createdAt: 1 }
    const pasted = { id: "job-1", kind: "copy", status: "running", generation: 4, total: 100_000, processed: 0, succeeded: 0, failed: 0, cancelled: 0, failureSamples: [], failureSamplesTruncated: false, startedAt: 1 }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(prepared))
      .mockResolvedValueOnce(Response.json(pasted))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    const selection = { generation: 4, allSelected: true, ranges: [], explicit: [] }

    await expect(client.prepareDirectoryClipboard!("browser-1", selection, "copy")).resolves.toEqual(prepared)
    await expect(client.pasteDirectoryClipboard!("D:/target")).resolves.toEqual(pasted)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ sessionId: "browser-1", selection, mode: "copy" })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ destinationPath: "D:/target" })
  })

  it("[neoview.preload.action-client] confirms authenticated session-scoped preload actions", async () => {
    const result = { action: "cancel-speculative", generation: 8, cancelled: 2, released: 0, visibleRetained: 1 }
    const fetchMock = vi.fn(async () => Response.json(result))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.runPreloadAction!("reader/one", "cancel-speculative")).resolves.toEqual(result)

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader%2Fone/preload-actions")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ action: "cancel-speculative", confirmed: true })
  })

  it("[neoview.preload.react-client] updates viewport context and reports bounded lifecycle events", async () => {
    const preload = { generation: 8, candidates: [] }
    const report = { generation: 8, accepted: 1, rejected: 0, stale: 0 }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      init?.method === "PATCH" ? Response.json({ preload }) : Response.json(report, { status: 202 })
    ))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.updatePreloadContext!("reader/one", { mode: "paged", focused: true })).resolves.toEqual(preload)
    await expect(client.reportPreloadEvents!("reader/one", 8, [{ pageId: "page-2", outcome: "ready", metrics: { decodeMs: 4 } }])).resolves.toEqual(report)

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader%2Fone/preload-context")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ mode: "paged", focused: true })
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader%2Fone/preload-events")
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ generation: 8, events: [{ pageId: "page-2", outcome: "ready", metrics: { decodeMs: 4 } }] })
  })

  it("[neoview.thumbnail-maintenance.client] uses authenticated aggregate and bounded mutation routes", async () => {
    const snapshot = {
      totalRows: 10, fileRows: 7, folderRows: 3, blobBytes: 100, emptyBlobs: 1, failedRows: 2,
      failuresByReason: { decode: 2 }, writer: { pendingWrites: 0, flushing: false, committedBatches: 1, committedWrites: 2, busyRetries: 0, failedBatches: 0 },
    }
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request)
      if (url.endsWith("/reader/thumbnails/maintenance")) return Response.json({ snapshot })
      if (url.endsWith("/cleanup")) {
        const body = JSON.parse(String(init?.body)) as { kind: string }
        return body.kind === "path-prefix"
          ? Response.json({ deleted: 3, prefix: "D:/library" })
          : Response.json({ result: { scanned: 20, deleted: 2, unavailableVolumeRowsPreserved: 1, wrapped: false } })
      }
      return Response.json({ deleted: 2 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.thumbnailMaintenance!()).resolves.toEqual(snapshot)
    await expect(client.cleanupThumbnails!({ kind: "invalid", scanLimit: 50, limit: 10 })).resolves.toEqual({
      kind: "invalid", scanned: 20, deleted: 2, unavailableVolumeRowsPreserved: 1, wrapped: false,
    })
    await expect(client.cleanupThumbnails!({ kind: "path-prefix", prefix: " D:/library ", limit: 100 })).resolves.toEqual({
      kind: "path-prefix", prefix: "D:/library", deleted: 3,
    })
    await expect(client.clearThumbnailFolderManifests!("D:/library", 100)).resolves.toBe(2)
    await expect(client.clearThumbnailFailures!(10)).resolves.toBe(2)

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ kind: "invalid", scanLimit: 50, limit: 10 })
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" })
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ kind: "path-prefix", prefix: " D:/library ", limit: 100 })
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ prefix: "D:/library", limit: 100 })
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({ limit: 10 })
    expect(new Headers(fetchMock.mock.calls[4]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.library.client] keeps history and bookmark bytes on authenticated library routes", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request)
      if (url.endsWith("/reader/library/recents/batch")) return Response.json({ deleted: 2, missingIds: [] })
      if (url.endsWith("/reader/library/bookmarks/batch")) return Response.json({ items: [], missingIds: [], deleted: 2 })
      if (url.includes("bookmark-lists")) return Response.json({ items: [] })
      return Response.json({ items: [] })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await client.listRecent!(40, 20, undefined, { search: "cover", sort: { field: "name", order: "asc" } })
    await client.summarizeFolderProgress!("D:/books/series one")
    await client.listBookmarks!(0, 100, "favorites", undefined, { search: "book", sort: { field: "path", order: "desc" } })
    await client.listBookmarkLists!()
    await client.updateBookmark!("bookmark/1", { starred: false, listIds: ["default"] })
    await client.updateBookmarks!([{ id: "one", listIds: ["reading"] }, { id: "two", starred: true }])
    await client.removeBookmarks!(["one", "two"])
    await client.removeRecents!(["recent-one", "recent-two"])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/reader/library/recents?offset=40&limit=20&search=cover&sort=name&order=asc")
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/reader/library/progress/folder?path=D%3A%2Fbooks%2Fseries%20one")
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/reader/library/bookmarks?offset=0&limit=100&search=book&sort=path&order=desc&listId=favorites")
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("/reader/library/bookmark-lists")
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain("/reader/library/bookmarks/bookmark%2F1")
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: "PATCH" })
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({ starred: false, listIds: ["default"] })
    expect(String(fetchMock.mock.calls[5]?.[0])).toContain("/reader/library/bookmarks/batch")
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({ method: "PATCH" })
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({ updates: [{ id: "one", listIds: ["reading"] }, { id: "two", starred: true }] })
    expect(fetchMock.mock.calls[6]?.[1]).toMatchObject({ method: "DELETE" })
    expect(JSON.parse(String(fetchMock.mock.calls[6]?.[1]?.body))).toEqual({ ids: ["one", "two"] })
    expect(String(fetchMock.mock.calls[7]?.[0])).toContain("/reader/library/recents/batch")
    expect(fetchMock.mock.calls[7]?.[1]).toMatchObject({ method: "DELETE" })
    expect(JSON.parse(String(fetchMock.mock.calls[7]?.[1]?.body))).toEqual({ ids: ["recent-one", "recent-two"] })
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    }
  })

  it("[neoview.emm-config.connection-client] probes the draft through the authenticated backend", async () => {
    const probe = { enabled: true, automatic: false, connected: true, readOnly: true, sources: [{ path: "D:/EMM/database.sqlite", status: "compatible", readOnly: true }] }
    const fetchMock = vi.fn(async () => Response.json(probe))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    const patch = { emm: { enabled: true, databasePaths: ["D:/EMM/database.sqlite"] } }

    await expect(client.probeEmm!(patch)).resolves.toEqual(probe)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/emm/config/probe")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify(patch) })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.opds.client] encodes a remote catalog URL through the authenticated reader route", async () => {
    const fetchMock = vi.fn(async () => Response.json({ url: "https://catalog.example/feed", navigation: [], publications: [], links: [] }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.readOpdsCatalog!("https://catalog.example/feed?query=one two")).resolves.toMatchObject({
      url: "https://catalog.example/feed",
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/reader/opds/catalog?url=https%3A%2F%2Fcatalog.example%2Ffeed%3Fquery%3Done%20two")
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")

    await client.searchOpdsCatalog!("https://catalog.example/search{?query}", "space opera")
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/reader/opds/search?template=https%3A%2F%2Fcatalog.example%2Fsearch%7B%3Fquery%7D&query=space%20opera")
  })

  it("[neoview.file-browser.thumbnails] registers only opaque library thumbnail contexts and releases them", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => String(request).endsWith("/reader/library/thumbnails")
      ? Response.json({ contextId: "folder:browser-1", generation: 3, items: [] })
      : new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await client.registerLibraryThumbnails!("folder:browser-1", 3, [
      { id: "entry-7", path: "D:/books/demo.cbz", kind: "file" },
    ])
    await client.releaseLibraryThumbnailContext!("folder:browser-1")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      contextId: "folder:browser-1",
      generation: 3,
      items: [{ id: "entry-7", path: "D:/books/demo.cbz", kind: "file" }],
    })
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/reader/library/contexts/folder%3Abrowser-1")
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE", keepalive: true })
  })

  it("[neoview.file-browser.thumbnail-compile] consumes bounded authenticated warmup streams", async () => {
    const body = [
      JSON.stringify({ type: "start", total: 2 }),
      JSON.stringify({ type: "item", index: 0, id: "one", status: "completed" }),
      JSON.stringify({ type: "item", index: 1, id: "two", status: "failed", error: "unsupported" }),
      JSON.stringify({ type: "complete", total: 2, completed: 1, failed: 1 }),
    ].join("\n") + "\n"
    const fetchMock = vi.fn(async () => new Response(body, { headers: { "content-type": "application/x-ndjson" } }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.prewarmLibraryThumbnails!([
      { id: "one", path: "D:/books/one", kind: "folder", previewCount: 4 },
      { id: "two", path: "D:/books/two.cbz", kind: "file" },
    ], { concurrency: 2 })).resolves.toEqual({ total: 2, completed: 1, failed: 1 })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/library/thumbnails/prewarm")
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      items: [
        { id: "one", path: "D:/books/one", kind: "folder", previewCount: 4 },
        { id: "two", path: "D:/books/two.cbz", kind: "file" },
      ],
      mode: "ensure",
      concurrency: 2,
    })
  })

  it("[neoview.file-browser.sort-client] sends sort rules and focus identity to the browser session", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      sessionId: "browser-1",
      navigationEntryId: 1,
      path: "D:/books",
      entries: [],
      cursor: 0,
      total: 0,
      canGoBack: false,
      canGoForward: false,
      generation: 2,
      sort: { field: "date", order: "desc", directoriesFirst: true },
      sortFields: ["name", "date", "size", "type", "random", "path"],
      metadataFields: [],
      sortSource: "memory",
      sortTemporary: false,
      globalDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
      tabDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await client.sortDirectoryBrowser!(
      "browser-1",
      { field: "date", order: "desc", directoriesFirst: true },
      "D:/books/book.cbz",
    )
    await client.updateDirectorySortPreference!(
      "browser-1",
      { action: "set-default", scope: "tab" },
      "D:/books/book.cbz",
    )
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/reader/browser/s/browser-1/sort")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      field: "date",
      order: "desc",
      directoriesFirst: true,
      focusPath: "D:/books/book.cbz",
    })
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/reader/browser/s/browser-1/sort/preferences")
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      action: "set-default",
      scope: "tab",
      focusPath: "D:/books/book.cbz",
    })
  })

  it("[neoview.folder.emm-edit-client] resolves sparse targets, reads revisions and sends one bounded edit", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request)
      if (url.endsWith("/selection")) return Response.json({ sessionId: "browser-1", generation: 3, total: 2, selectedCount: 2, preview: ["D:/A.cbz", "D:/B.cbz"], truncated: false })
      if (url.endsWith("/emm-metadata/read")) return Response.json({ generation: 3, items: [{ path: "D:/A.cbz", metadata: { revision: 1, overrides: {}, inherited: ["rating", "manualTags", "translatedTitle"] } }] })
      if (url.endsWith("/emm-metadata") && init?.method === "PATCH") return Response.json({ generation: 4, refreshRequired: false, results: [{ index: 0, status: "succeeded", metadata: { revision: 2, overrides: { rating: 5 }, inherited: ["manualTags", "translatedTitle"] } }], succeeded: 1, conflicts: 0, failed: 0 })
      return Response.json({ tags: [{ category: "artist", tag: "Alice", favorite: true, translatedTag: "爱丽丝" }] })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    const selection = { generation: 3, allSelected: false, ranges: [{ start: 2, end: 3 }], explicit: [] }

    await expect(client.resolveDirectorySelection!("browser-1", selection, 64)).resolves.toMatchObject({ selectedCount: 2 })
    await expect(client.readDirectoryEmm!("browser-1", 3, ["D:/A.cbz"])).resolves.toMatchObject({ items: [{ metadata: { revision: 1 } }] })
    await expect(client.editDirectoryEmm!("browser-1", { generation: 3, updates: [{ path: "D:/A.cbz", expectedRevision: 1, patch: { rating: 5 } }] })).resolves.toMatchObject({ succeeded: 1 })
    await expect(client.suggestDirectoryEmmTags!(8)).resolves.toEqual([{ category: "artist", tag: "Alice", favorite: true, translatedTag: "爱丽丝" }])

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ selection, previewLimit: 64 })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ generation: 3, paths: ["D:/A.cbz"] })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ generation: 3, updates: [{ path: "D:/A.cbz", expectedRevision: 1, patch: { rating: 5 } }] })
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("/reader/browser/emm-tags/suggestions?count=8")
  })

  it("[neoview.folder.filter-client] sends the canonical type filter without reopening the browser session", async () => {
    const fetchMock = vi.fn(async () => Response.json({ filter: "archive", filterOptions: ["all", "archive", "directory", "video"] }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await client.filterDirectoryBrowser!("browser/source", "archive", "D:/books/book.cbz", undefined, true)

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/browser/s/browser%2Fsource/filter")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      filter: "archive",
      focusPath: "D:/books/book.cbz",
      showHiddenFolders: true,
    })
  })

  it("[neoview.folder.restore-focus-client] sends the current visit focus with navigation", async () => {
    const fetchMock = vi.fn(async () => Response.json({}))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await client.navigateDirectoryBrowser!(
      "browser-1",
      { action: "back" },
      undefined,
      "D:/books/focused.cbz",
    )

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/reader/browser/s/browser-1/navigate")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      action: "back",
      focusPath: "D:/books/focused.cbz",
    })
  })

  it("[neoview.file-browser.metadata-client] requests details metadata only on an explicit page call", async () => {
    const fetchMock = vi.fn(async () => Response.json({}))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await client.listDirectoryBrowser!("browser-1", 256, 128, undefined, ["date", "size", "dimensions", "pageCount", "tags"])
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(url.searchParams.get("cursor")).toBe("256")
    expect(url.searchParams.get("limit")).toBe("128")
    expect(url.searchParams.get("fields")).toBe("date,size,dimensions,pageCount,tags")
  })

  it("[neoview.folder.search-gui] parses authenticated NDJSON across UTF-8 and line chunk boundaries", async () => {
    const source = [
      JSON.stringify({ type: "meta", sessionId: "browser-1", rootPath: "D:/漫画", generation: 7, query: "封面", mode: "text" }),
      JSON.stringify({ type: "entry", index: 0, entry: { name: "封面.cbz", path: "D:/漫画/封面.cbz", relativePath: "封面.cbz", depth: 0, kind: "file" } }),
      JSON.stringify({ type: "complete", scanned: 12, matched: 1, truncated: false }),
    ].join("\n") + "\n"
    const bytes = new TextEncoder().encode(source)
    const split = bytes.findIndex((value) => value >= 0x80) + 1
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split))
        controller.enqueue(bytes.slice(split, split + 3))
        controller.enqueue(bytes.slice(split + 3))
        controller.close()
      },
    }), { headers: { "content-type": "application/x-ndjson" } }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    const result = await client.searchDirectoryBrowser!("browser-1", "封面", {
      kind: "file",
      caseSensitive: true,
      searchInPath: true,
      maximumDepth: 0,
      maximumResults: 512,
      excludePatterns: ["cache/**"],
      includeTags: ["artist:alice", "female:glasses"],
      excludeTags: ["language:chinese"],
      tagMode: "any",
    })

    expect(result).toEqual({
      sessionId: "browser-1",
      rootPath: "D:/漫画",
      generation: 7,
      query: "封面",
      mode: "text",
      entries: [{ name: "封面.cbz", path: "D:/漫画/封面.cbz", kind: "file", readerSupported: true }],
      scanned: 12,
      matched: 1,
      truncated: false,
    })
    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(String(url))
    expect(parsed.searchParams.get("depth")).toBe("0")
    expect(parsed.searchParams.get("path")).toBe("1")
    expect(parsed.searchParams.get("limit")).toBe("512")
    expect(parsed.searchParams.getAll("exclude")).toEqual(["cache/**"])
    expect(parsed.searchParams.getAll("tag")).toEqual(["artist:alice", "female:glasses"])
    expect(parsed.searchParams.getAll("excludeTag")).toEqual(["language:chinese"])
    expect(parsed.searchParams.get("tagMode")).toBe("any")
    expect(new Headers(init?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.folder.tree-client] requests an authenticated tree node with refresh semantics", async () => {
    const tree = {
      sessionId: "browser-1",
      path: "D:\\books",
      entries: [],
      generation: 3,
      cacheHit: false,
      excludedPaths: [],
    }
    const fetchMock = vi.fn(async () => Response.json(tree))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.treeDirectoryBrowser!("browser/1", "D:\\books", true)).resolves.toEqual(tree)

    const [input, init] = fetchMock.mock.calls[0]!
    const url = new URL(String(input))
    expect(url.pathname).toBe("/reader/browser/s/browser%2F1/tree")
    expect(url.searchParams.get("path")).toBe("D:\\books")
    expect(url.searchParams.get("refresh")).toBe("1")
    expect(new Headers(init?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.folder.tree-watch-client] waits on the authenticated independent tree revision route", async () => {
    const batch = { sessionId: "browser-1", revision: 4, generation: 8, paths: ["D:\\books"], reset: false }
    const fetchMock = vi.fn(async () => Response.json(batch))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.watchDirectoryTreeBrowser!("browser/1", 3)).resolves.toEqual(batch)
    const [input, init] = fetchMock.mock.calls[0]!
    const url = new URL(String(input))
    expect(url.pathname).toBe("/reader/browser/s/browser%2F1/tree/changes")
    expect(url.searchParams.get("after")).toBe("3")
    expect(new Headers(init?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.folder.size-client] posts a bounded generation-scoped directory size batch", async () => {
    const batch = {
      sessionId: "browser-1",
      generation: 7,
      results: [{ path: "D:/books/series", status: "ok", bytes: 1234, fileCount: 8 }],
    }
    const fetchMock = vi.fn(async () => Response.json(batch))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.directorySizes!("browser/1", 7, ["D:/books/series"])).resolves.toEqual(batch)

    const [input, init] = fetchMock.mock.calls[0]!
    const url = new URL(String(input))
    expect(url.pathname).toBe("/reader/browser/s/browser%2F1/directory-sizes")
    expect(init).toMatchObject({ method: "POST" })
    expect(JSON.parse(String(init?.body))).toEqual({ generation: 7, paths: ["D:/books/series"] })
    expect(new Headers(init?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.folder.tree-roots-client] requests authenticated platform roots independently of a session", async () => {
    const roots = [{ path: "D:\\", label: "Data (D:)", kind: "fixed", available: true }]
    const fetchMock = vi.fn(async () => Response.json({ roots }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.listDirectoryRoots!()).resolves.toEqual(roots)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/browser/roots")
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.folder.watch-client] opts into watching and waits on the authenticated generation route", async () => {
    const watched = { sessionId: "browser-1", generation: 2 }
    const fetchMock = vi.fn(async () => Response.json(watched))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await client.openDirectoryBrowser!("D:/books", undefined, "folder-main", true)
    await expect(client.watchDirectoryBrowser!("browser-1", 1, "D:/books/a.cbz")).resolves.toEqual(watched)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ path: "D:/books", scopeId: "folder-main", watch: true })
    const url = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(url.pathname).toBe("/reader/browser/s/browser-1/changes")
    expect(url.searchParams.get("after")).toBe("1")
    expect(url.searchParams.get("focus")).toBe("D:/books/a.cbz")
  })

  it("[neoview.folder.penetration-client] resolves a folder through the encoded browser session", async () => {
    const resolution = {
      status: "resolved",
      originPath: "D:/books/series",
      terminal: { kind: "archive", path: "D:/books/series/book.cbz" },
      chain: [],
      reason: "archive",
    }
    const fetchMock = vi.fn(async () => Response.json(resolution))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.resolveFolderPenetration!(
      "browser/source",
      "D:/books/series",
      { maxDepth: 5, terminalTargets: ["archive", "media-directory"] },
    )).resolves.toEqual(resolution)

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/browser/s/browser%2Fsource/penetration/resolve")
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init).toMatchObject({ method: "POST" })
    expect(JSON.parse(String(init?.body))).toEqual({
      path: "D:/books/series",
      policy: { maxDepth: 5, terminalTargets: ["archive", "media-directory"] },
    })
    expect(new Headers(init?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.folder.search-incremental] publishes bounded entry batches before the stream completes", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        const events = [
          { type: "meta", sessionId: "browser-1", rootPath: "D:/books", generation: 4, query: "book", mode: "text" },
          ...Array.from({ length: 16 }, (_, index) => ({
            type: "entry",
            index,
            entry: { name: `book-${index}.cbz`, path: `D:/books/book-${index}.cbz`, kind: "file" },
          })),
        ]
        controller.enqueue(encoder.encode(events.map((event) => JSON.stringify(event)).join("\n") + "\n"))
      },
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)))
    const onEntries = vi.fn()
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000" }))
    let completed = false
    const pending = client.searchDirectoryBrowser!("browser-1", "book", { onEntries })
      .finally(() => { completed = true })

    await vi.waitFor(() => expect(onEntries).toHaveBeenCalledTimes(1))
    expect(onEntries.mock.calls[0]?.[0]).toHaveLength(16)
    expect(completed).toBe(false)
    streamController.enqueue(encoder.encode(`${JSON.stringify({ type: "complete", scanned: 16, matched: 16, truncated: false })}\n`))
    streamController.close()
    await expect(pending).resolves.toMatchObject({ matched: 16, entries: expect.any(Array) })
  })

  it("[neoview.folder.search-cancel] cancels the NDJSON reader when a search is aborted", async () => {
    let cancelled = false
    const started = deferred<void>()
    const stream = new ReadableStream<Uint8Array>({
      pull() { started.resolve() },
      cancel() { cancelled = true },
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)))
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000" }))
    const controller = new AbortController()
    const pending = client.searchDirectoryBrowser!("browser-1", "book", {}, controller.signal)
    await started.promise
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(cancelled).toBe(true)
  })

  it("[neoview.folder.search-history-client] uses the shared authenticated history resource", async () => {
    const entry = { scope: "folder", query: "cover", usedAt: 123, useCount: 2 }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (init?.method === "POST") return Response.json(entry, { status: 201 })
      if (init?.method === "DELETE") {
        return Response.json(url.searchParams.has("query") ? { removed: true } : { cleared: 1 })
      }
      return Response.json({ scope: "folder", entries: [entry] })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.listSearchHistory!("folder", 20)).resolves.toEqual([entry])
    await expect(client.recordSearchHistory!("folder", "cover")).resolves.toEqual(entry)
    await expect(client.removeSearchHistory!("folder", "cover")).resolves.toBe(true)
    await expect(client.clearSearchHistory!("folder")).resolves.toBe(1)

    const [listUrl] = fetchMock.mock.calls[0]!
    expect(new URL(String(listUrl)).search).toBe("?scope=folder&limit=20")
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ scope: "folder", query: "cover" })
    expect(new URL(String(fetchMock.mock.calls[2]?.[0])).searchParams.get("query")).toBe("cover")
    expect(new URL(String(fetchMock.mock.calls[3]?.[0])).searchParams.has("query")).toBe(false)
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    }
  })

  it("[neoview.bindings.legacy-import-client] uses authenticated inspect and confirmed import endpoints", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/inspect")) return Response.json({ report: { codecVersion: 1, sourceKind: "app-settings", entries: [], summary: {}, fullyRecognized: true }, configPatch: {} })
      return Response.json({ report: { codecVersion: 1, sourceKind: "app-settings", entries: [], summary: {}, fullyRecognized: true }, configPatch: {}, strategy: "merge", changed: true, backupCreated: true })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await client.inspectLegacySettings!("{}", ["keybindings"])
    await client.importLegacySettings!("{}", "merge", ["keybindings"])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/settings/migration/inspect")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ content: "{}", modules: ["keybindings"] })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ content: "{}", strategy: "merge", confirmed: true, modules: ["keybindings"] })
    for (const call of fetchMock.mock.calls) expect(new Headers(call[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
