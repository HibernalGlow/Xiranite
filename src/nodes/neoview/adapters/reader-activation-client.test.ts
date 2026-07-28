import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("reader activation HTTP client", () => {
  it("preserves the full traversal frame stack when opening a selected child", async () => {
    const opened = {
      sessionId: "reader-expanded-child",
      activationIdentity: {
        readerSourcePath: "C:/books/series/Book 1",
        activatedEntryPath: "C:/books/series/Book 1",
        traversalRootPath: "C:/books",
      },
      book: { id: "book-1", displayName: "Book 1", pageCount: 1 },
      frame: {},
      visiblePages: [],
    }
    const fetchMock = vi.fn(async () => Response.json(opened, { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))
    const provenance = {
      browserOriginPath: "C:/books",
      browserOriginEntryPath: "C:/books/series/Book 1",
      browserOriginTraversalFrames: [
        { directoryPath: "C:/books", currentEntryPath: "C:/books/series" },
        { directoryPath: "C:/books/series", currentEntryPath: "C:/books/series/Book 1" },
      ],
    }

    await expect(client.open("C:/books/series/Book 1", undefined, provenance)).resolves.toEqual(opened)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      path: "C:/books/series/Book 1",
      provenance,
    })
  })
})
