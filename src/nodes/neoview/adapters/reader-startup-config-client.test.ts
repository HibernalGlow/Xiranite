import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Reader startup config client", () => {
  it("[neoview.startup-restore.client] writes the startup preference through the authenticated config route", async () => {
    const fetchMock = vi.fn(async () => Response.json({ startup: { restoreLastBook: false } }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.updateStartup!({ startup: { restoreLastBook: false } })).resolves.toEqual({ restoreLastBook: false })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/config")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ startup: { restoreLastBook: false } }),
    })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
  })
})
