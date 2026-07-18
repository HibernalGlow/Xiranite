import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_RADIAL_MENU_CONFIG } from "@xiranite/node-neoview/ui-core"
import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => vi.unstubAllGlobals())

describe("reader radial menu client", () => {
  it("[neoview.bindings.radial-client] sends an authenticated independent radial menu patch", async () => {
    const config = structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG)
    const fetchMock = vi.fn(async () => Response.json({ radialMenu: config }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.updateRadialMenu!({ radialMenu: { config } })).resolves.toEqual(config)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("http://127.0.0.1:41000/reader/config")
    expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify({ radialMenu: { config } }) })
    expect(new Headers(init?.headers).get("x-xiranite-token")).toBe("reader-token")
  })
})
