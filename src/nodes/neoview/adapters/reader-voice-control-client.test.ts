import { afterEach, describe, expect, it, vi } from "vitest"
import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => vi.unstubAllGlobals())

describe("reader voice control client", () => {
  it("sends an authenticated voice control patch", async () => {
    const voiceControl = { enabled: true, language: "zh-CN", minConfidence: 0.6, continuous: false, commands: {} }
    const fetchMock = vi.fn(async () => Response.json({ voiceControl }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    await expect(client.updateVoiceControl!({ voiceControl: { enabled: true } })).resolves.toEqual(voiceControl)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("http://127.0.0.1:41000/reader/config")
    expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify({ voiceControl: { enabled: true } }) })
    expect(new Headers(init?.headers).get("x-xiranite-token")).toBe("reader-token")
  })
})
