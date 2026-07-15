import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("reader-http-client", () => {
  it("[neoview.react.control] sends token-authenticated open, navigation and close requests", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(request)
      if (url.endsWith("/reader/config")) return Response.json({ shell: { showDelayMs: 0 } })
      if (url.endsWith("/reader/sessions")) return Response.json({ sessionId: "reader-1" })
      if (url.includes("/pages?")) return Response.json({ pages: [], total: 2 })
      if (url.endsWith("/navigate")) return Response.json({ frame: {}, visiblePages: [] })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    expect(await client.config()).toEqual({ showDelayMs: 0 })
    await client.open("D:/books/demo.cbz")
    await client.listPages("reader-1", 64, 32)
    await client.navigate("reader-1", "next")
    await client.goTo("reader-1", 17)
    await client.close("reader-1")

    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/config")
    const [openUrl, openInit] = fetchMock.mock.calls[1]!
    expect(String(openUrl)).toBe("http://127.0.0.1:41000/reader/sessions")
    expect(openInit?.method).toBe("POST")
    expect(new Headers(openInit?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(openInit?.body))).toEqual({ path: "D:/books/demo.cbz" })
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/reader/s/reader-1/pages?cursor=64&limit=32")
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("/reader/s/reader-1/navigate")
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({ action: "goTo", pageIndex: 17 })
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({ method: "DELETE", keepalive: true })
  })

  it("[neoview.react.control] surfaces structured backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unsupported reader path" }, { status: 400 })))
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000" }))
    await expect(client.open("bad.file")).rejects.toThrow("Unsupported reader path")
  })
})
