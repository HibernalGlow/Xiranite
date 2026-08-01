import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => vi.unstubAllGlobals())

describe("reader source relocation client", () => {
  it("sends a committed path change through the authenticated library route", async () => {
    const result = { progress: 1, bookmarks: 2, playlistEntries: 3, pathStacks: 4, folderSortRules: 5, emmOverrides: 6, folderRatings: 7 }
    const fetchMock = vi.fn(async () => Response.json(result))
    vi.stubGlobal("fetch", fetchMock)
    const client = createReaderHttpClient(() => ({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" }))

    await expect(client.relocateLibrarySourcePath!("D:/old.cbz", "D:/new.cbz")).resolves.toEqual(result)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:41000/reader/library/source-path")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-xiranite-token")).toBe("reader-token")
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ sourcePath: "D:/old.cbz", destinationPath: "D:/new.cbz" })
  })
})
