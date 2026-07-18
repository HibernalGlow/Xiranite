import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => vi.unstubAllGlobals())

describe("reader page action client", () => {
  it("[neoview.page-list.action-client] sends opaque page actions and releases materialization leases", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({ path: "D:/temp/cover.jpg", leaseToken: "lease/one" }, { status: 201 })
    ))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.pageAction!("reader/one", "page/one", "copy")).resolves.toEqual({
      path: "D:/temp/cover.jpg",
      leaseToken: "lease/one",
    })
    await client.releasePageActionLease!("reader/one", "lease/one")

    expect(String(fetchMock.mock.calls[0]?.[0]).endsWith("/reader/s/reader%2Fone/pages/page%2Fone/actions")).toBe(true)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ action: "copy" })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(String(fetchMock.mock.calls[1]?.[0]).endsWith("/reader/s/reader%2Fone/clipboard-materializations/lease%2Fone")).toBe(true)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE", keepalive: true })
  })
})
