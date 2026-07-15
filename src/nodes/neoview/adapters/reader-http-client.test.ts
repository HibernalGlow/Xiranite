import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderHttpClient, ReaderHttpError } from "./reader-http-client"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("reader-http-client", () => {
  it("[neoview.react.control] sends token-authenticated open, navigation and close requests", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(request)
      if (url.endsWith("/reader/config")) return Response.json({
        shell: { showDelayMs: 0, panelLayout: {}, cardLayout: {} },
        viewDefaults: { fitMode: "fit", pageMode: "single" },
        slideshow: { intervalSeconds: 5, loop: false, random: false, fadeTransition: true },
      })
      if (url.endsWith("/reader/sessions")) return Response.json({ sessionId: "reader-1" })
      if (url.includes("/pages?")) return Response.json({ pages: [], total: 2 })
      if (url.endsWith("/navigate") || url.endsWith("/options")) return Response.json({ frame: {}, visiblePages: [] })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    expect(await client.config()).toEqual({
      shell: { showDelayMs: 0, panelLayout: {}, cardLayout: {} },
      viewDefaults: { fitMode: "fit", pageMode: "single" },
      slideshow: { intervalSeconds: 5, loop: false, random: false, fadeTransition: true },
    })
    expect(await client.updateSidebarLayout({ side: "left", pinned: false, width: 360 })).toEqual({ showDelayMs: 0, panelLayout: {}, cardLayout: {} })
    expect(await client.updateCardLayout({ cardId: "page-navigation", expanded: false })).toEqual({ showDelayMs: 0, panelLayout: {}, cardLayout: {} })
    expect(await client.updateBoardLayout({ expectedRevision: 4, board: { panels: [], cards: [] } })).toEqual({ showDelayMs: 0, panelLayout: {}, cardLayout: {} })
    expect(await client.updateViewDefaults({ viewDefaults: { fitMode: "fit-width" } })).toEqual({ fitMode: "fit", pageMode: "single" })
    expect(await client.updateSlideshow({ slideshow: { intervalSeconds: 8, loop: true } })).toEqual({ intervalSeconds: 5, loop: false, random: false, fadeTransition: true })
    await client.open("D:/books/demo.cbz")
    await client.listPages("reader-1", 64, 32)
    await client.listPageCatalog!("reader-1", 0, 64, { query: "cover", thumbnails: false })
    await client.navigate("reader-1", "next")
    await client.goTo("reader-1", 17)
    await client.updateSessionOptions("reader-1", { layout: { pageMode: "double" } })
    await client.close("reader-1")

    expect(fetchMock).toHaveBeenCalledTimes(13)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/config")
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ side: "left", pinned: false, width: 360 })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ cardId: "page-navigation", expanded: false })
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ expectedRevision: 4, board: { panels: [], cards: [] } })
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({ viewDefaults: { fitMode: "fit-width" } })
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({ slideshow: { intervalSeconds: 8, loop: true } })
    const [openUrl, openInit] = fetchMock.mock.calls[6]!
    expect(String(openUrl)).toBe("http://127.0.0.1:41000/reader/sessions")
    expect(openInit?.method).toBe("POST")
    expect(new Headers(openInit?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(openInit?.body))).toEqual({ path: "D:/books/demo.cbz" })
    expect(String(fetchMock.mock.calls[7]?.[0])).toContain("/reader/s/reader-1/pages?cursor=64&limit=32")
    expect(String(fetchMock.mock.calls[8]?.[0])).toContain("/reader/s/reader-1/pages?cursor=0&limit=64&query=cover&thumbnails=0")
    expect(String(fetchMock.mock.calls[9]?.[0])).toContain("/reader/s/reader-1/navigate")
    expect(JSON.parse(String(fetchMock.mock.calls[10]?.[1]?.body))).toEqual({ action: "goTo", pageIndex: 17 })
    expect(String(fetchMock.mock.calls[11]?.[0])).toContain("/reader/s/reader-1/options")
    expect(JSON.parse(String(fetchMock.mock.calls[11]?.[1]?.body))).toEqual({ layout: { pageMode: "double" } })
    expect(fetchMock.mock.calls[12]?.[1]).toMatchObject({ method: "DELETE", keepalive: true })
  })

  it("[neoview.react.control] surfaces structured backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unsupported reader path" }, { status: 400 })))
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000" }))
    const request = client.open("bad.file")
    await expect(request).rejects.toThrow("Unsupported reader path")
    await expect(request).rejects.toMatchObject({ status: 400, name: "ReaderHttpError" } satisfies Partial<ReaderHttpError>)
  })

  it("[neoview.metadata.client] loads metadata only through the authenticated session route", async () => {
    const fetchMock = vi.fn(async () => Response.json({ book: { displayName: "demo.cbz" } }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await client.metadata!("reader-1")
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/s/reader-1/metadata")
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })

  it("[neoview.library.client] keeps history and bookmark bytes on authenticated library routes", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request)
      if (url.includes("bookmark-lists")) return Response.json({ items: [] })
      return Response.json({ items: [] })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await client.listRecent!(40, 20)
    await client.listBookmarks!(0, 100, "favorites")
    await client.listBookmarkLists!()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/reader/library/recents?offset=40&limit=20")
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/reader/library/bookmarks?offset=0&limit=100&listId=favorites")
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/reader/library/bookmark-lists")
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    }
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

  it("[neoview.file-browser.sort-client] sends sort rules and focus identity to the browser session", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      sessionId: "browser-1",
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
})
