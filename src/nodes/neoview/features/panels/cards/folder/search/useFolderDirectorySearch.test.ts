import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReaderDirectorySearchResultDto, ReaderHttpClient } from "../../../../../../adapters/reader-http-client"
import { createDefaultSearchCriteria } from "./folderSearchModel"
import { useFolderDirectorySearch } from "./useFolderDirectorySearch"

describe("useFolderDirectorySearch", () => {
  it("[neoview.folder.search-hook-stream] publishes streamed batches before the final result", async () => {
    const finished = deferred<ReaderDirectorySearchResultDto>()
    let options: { onEntries?: (entries: readonly { name: string; path: string; kind: "file"; readerSupported: boolean }[]) => void } | undefined
    const client = {
      searchDirectoryBrowser: vi.fn((_sessionId, _query, nextOptions) => {
        options = nextOptions
        return finished.promise
      }),
    } as unknown as ReaderHttpClient

    const { result } = renderHook(() => useFolderDirectorySearch({ client, sessionId: "browser-1" }))
    await act(async () => {
      void result.current.search(createDefaultSearchCriteria(
        { includeSubfolders: true, searchInPath: false },
        { query: "batch" },
      ))
    })
    await waitFor(() => expect(options?.onEntries).toBeTypeOf("function"))
    act(() => options!.onEntries!([{ name: "a.cbz", path: "D:/a.cbz", kind: "file", readerSupported: true }]))
    expect(result.current.streamedEntries).toHaveLength(1)
    expect(result.current.status).toBe("success")

    await act(async () => {
      finished.resolve({
        sessionId: "browser-1",
        rootPath: "D:/",
        generation: 1,
        query: "batch",
        mode: "text",
        entries: [{ name: "a.cbz", path: "D:/a.cbz", kind: "file", readerSupported: true }],
        scanned: 1,
        matched: 1,
        truncated: false,
      })
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.result?.matched).toBe(1)
    expect(result.current.streamedEntries).toEqual([])
  })

  it("[neoview.folder.search-hook-stale] ignores superseded responses and aborts on cancel", async () => {
    const first = deferred<ReaderDirectorySearchResultDto>()
    const second = deferred<ReaderDirectorySearchResultDto>()
    let firstSignal: AbortSignal | undefined
    const searchDirectoryBrowser = vi.fn()
      .mockImplementationOnce((_s, _q, _o, signal) => {
        firstSignal = signal
        return first.promise
      })
      .mockImplementationOnce(() => second.promise)
    const client = { searchDirectoryBrowser } as unknown as ReaderHttpClient
    const { result } = renderHook(() => useFolderDirectorySearch({ client, sessionId: "browser-1" }))

    await act(async () => {
      void result.current.search(createDefaultSearchCriteria({ includeSubfolders: true, searchInPath: false }, { query: "old" }))
      void result.current.search(createDefaultSearchCriteria({ includeSubfolders: true, searchInPath: false }, { query: "new" }))
    })
    expect(firstSignal?.aborted).toBe(true)

    await act(async () => {
      second.resolve(resultDto("new", [{ name: "new.cbz", path: "D:/new.cbz", kind: "file", readerSupported: true }]))
    })
    await waitFor(() => expect(result.current.result?.query).toBe("new"))

    await act(async () => {
      first.resolve(resultDto("old", [{ name: "old.cbz", path: "D:/old.cbz", kind: "file", readerSupported: true }]))
    })
    expect(result.current.result?.query).toBe("new")

    await act(async () => {
      void result.current.search(createDefaultSearchCriteria({ includeSubfolders: true, searchInPath: false }, { query: "cancel-me" }))
    })
    act(() => result.current.cancel())
    expect(result.current.loading).toBe(false)
  })

  it("[neoview.folder.search-hook-history] records successful text queries and supports remove/clear", async () => {
    const listSearchHistory = vi.fn(async () => [{ scope: "folder" as const, query: "cover", usedAt: 1, useCount: 1 }])
    const recordSearchHistory = vi.fn(async () => ({ scope: "folder" as const, query: "book", usedAt: 2, useCount: 1 }))
    const removeSearchHistory = vi.fn(async () => true)
    const clearSearchHistory = vi.fn(async () => 1)
    const client = {
      listSearchHistory,
      recordSearchHistory,
      removeSearchHistory,
      clearSearchHistory,
      searchDirectoryBrowser: vi.fn(async (_s, query) => resultDto(query)),
    } as unknown as ReaderHttpClient
    const { result } = renderHook(() => useFolderDirectorySearch({ client, sessionId: "browser-1" }))

    await act(async () => {
      await result.current.refreshHistory()
    })
    expect(result.current.history).toEqual([{ scope: "folder", query: "cover", usedAt: 1, useCount: 1 }])

    await act(async () => {
      await result.current.search(createDefaultSearchCriteria({ includeSubfolders: true, searchInPath: false }, { query: "book" }))
    })
    await waitFor(() => expect(recordSearchHistory).toHaveBeenCalledWith("folder", "book", expect.any(AbortSignal)))

    await act(async () => {
      await result.current.removeHistory("cover")
    })
    expect(result.current.history.every((entry) => entry.query !== "cover")).toBe(true)

    await act(async () => {
      await result.current.clearHistory()
    })
    expect(result.current.history).toEqual([])
  })
})

function resultDto(
  query: string,
  entries: ReaderDirectorySearchResultDto["entries"] = [],
): ReaderDirectorySearchResultDto {
  return {
    sessionId: "browser-1",
    rootPath: "D:/",
    generation: 1,
    query,
    mode: "text",
    entries,
    scanned: entries.length,
    matched: entries.length,
    truncated: false,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
