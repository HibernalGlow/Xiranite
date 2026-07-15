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
    })
    expect(await client.updateSidebarLayout({ side: "left", width: 360 })).toEqual({ showDelayMs: 0, panelLayout: {}, cardLayout: {} })
    expect(await client.updateCardLayout({ cardId: "page-navigation", expanded: false })).toEqual({ showDelayMs: 0, panelLayout: {}, cardLayout: {} })
    expect(await client.updateBoardLayout({ expectedRevision: 4, board: { panels: [], cards: [] } })).toEqual({ showDelayMs: 0, panelLayout: {}, cardLayout: {} })
    expect(await client.updateViewDefaults({ viewDefaults: { fitMode: "fit-width" } })).toEqual({ fitMode: "fit", pageMode: "single" })
    await client.open("D:/books/demo.cbz")
    await client.listPages("reader-1", 64, 32)
    await client.navigate("reader-1", "next")
    await client.goTo("reader-1", 17)
    await client.updateSessionOptions("reader-1", { layout: { pageMode: "double" } })
    await client.close("reader-1")

    expect(fetchMock).toHaveBeenCalledTimes(11)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/config")
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ side: "left", width: 360 })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ cardId: "page-navigation", expanded: false })
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ expectedRevision: 4, board: { panels: [], cards: [] } })
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({ viewDefaults: { fitMode: "fit-width" } })
    const [openUrl, openInit] = fetchMock.mock.calls[5]!
    expect(String(openUrl)).toBe("http://127.0.0.1:41000/reader/sessions")
    expect(openInit?.method).toBe("POST")
    expect(new Headers(openInit?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(openInit?.body))).toEqual({ path: "D:/books/demo.cbz" })
    expect(String(fetchMock.mock.calls[6]?.[0])).toContain("/reader/s/reader-1/pages?cursor=64&limit=32")
    expect(String(fetchMock.mock.calls[7]?.[0])).toContain("/reader/s/reader-1/navigate")
    expect(JSON.parse(String(fetchMock.mock.calls[8]?.[1]?.body))).toEqual({ action: "goTo", pageIndex: 17 })
    expect(String(fetchMock.mock.calls[9]?.[0])).toContain("/reader/s/reader-1/options")
    expect(JSON.parse(String(fetchMock.mock.calls[9]?.[1]?.body))).toEqual({ layout: { pageMode: "double" } })
    expect(fetchMock.mock.calls[10]?.[1]).toMatchObject({ method: "DELETE", keepalive: true })
  })

  it("[neoview.react.control] surfaces structured backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unsupported reader path" }, { status: 400 })))
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000" }))
    const request = client.open("bad.file")
    await expect(request).rejects.toThrow("Unsupported reader path")
    await expect(request).rejects.toMatchObject({ status: 400, name: "ReaderHttpError" } satisfies Partial<ReaderHttpError>)
  })
})
