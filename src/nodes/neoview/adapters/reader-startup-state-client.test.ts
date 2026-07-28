import { afterEach, expect, it, vi } from "vitest"

import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => vi.unstubAllGlobals())

it("[neoview.startup-state.client] reads authenticated state from the backend base path", async () => {
  const state = {
    lastFolder: { path: "D:/books", updatedAt: 1 },
    lastBook: { bookId: "latest-book", source: { kind: "archive", path: "D:/books/latest.cbz" } },
  }
  const fetchMock = vi.fn(async () => Response.json(state))
  vi.stubGlobal("fetch", fetchMock)
  const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000/_xiranite/backend", token: "reader-token" }))

  await expect(client.startupState!()).resolves.toEqual(state)
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/_xiranite/backend/reader/startup-state")
  expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
})
