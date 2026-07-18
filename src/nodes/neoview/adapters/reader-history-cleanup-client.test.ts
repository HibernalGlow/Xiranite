import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => vi.unstubAllGlobals())

describe("reader history cleanup client", () => {
  it("[neoview.history.cleanup-client] sends strict recent cleanup and invalid-path requests", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return Response.json(String(input).endsWith("cleanup-invalid")
        ? { kind: "recents", scanned: 4, missing: 1, unknown: 0, deleted: 1, truncated: false }
        : { deleted: 1 })
    }))
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await client.cleanupRecents!({ kind: "oldest", limit: 7 })
    await client.cleanupRecents!({ kind: "before", before: 123_456, limit: 99 })
    await client.cleanupRecents!({ kind: "folder", path: "D:/Books" })
    await client.cleanupRecents!({ kind: "all", confirmed: true })
    await client.cleanupInvalidLibrary!("recents")

    expect(requests.map(({ url }) => url)).toEqual([
      "http://127.0.0.1:41000/reader/library/recents/cleanup",
      "http://127.0.0.1:41000/reader/library/recents/cleanup",
      "http://127.0.0.1:41000/reader/library/recents/cleanup",
      "http://127.0.0.1:41000/reader/library/recents/cleanup",
      "http://127.0.0.1:41000/reader/library/cleanup-invalid",
    ])
    expect(requests.map(({ init }) => JSON.parse(String(init?.body)))).toEqual([
      { kind: "oldest", limit: 7 },
      { before: 123_456, limit: 99 },
      { kind: "folder", path: "D:/Books" },
      { kind: "all", confirmed: true },
      { kind: "recents" },
    ])
    for (const request of requests) {
      expect(request.init?.method).toBe("POST")
      expect(new Headers(request.init?.headers).get("x-xiranite-token")).toBe("reader-token")
    }
  })
})
