import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { VirtuosoMockContext } from "react-virtuoso"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderDirectorySearchResultDto, ReaderHttpClient, ReaderSearchHistoryDto } from "../../../../adapters/reader-http-client"
import FolderSearchPanel from "./FolderSearchPanel"

afterEach(cleanup)

describe("FolderSearchPanel", () => {
  it("[neoview.folder.search-current] [neoview.folder.search-recursive] sends bounded shared search options", async () => {
    const searchDirectoryBrowser = vi.fn(async (_sessionId: string, query: string) => result(query))
    const view = renderPanel({ searchDirectoryBrowser } as unknown as ReaderHttpClient)
    const current = within(view.container)
    const input = current.getByRole("textbox", { name: "搜索文件" })

    fireEvent.change(input, { target: { value: "cover" } })
    fireEvent.submit(input.closest("form")!)
    await waitFor(() => expect(searchDirectoryBrowser).toHaveBeenLastCalledWith(
      "browser-1",
      "cover",
      expect.objectContaining({ mode: "text", kind: "all", maximumDepth: 0, maximumResults: 512 }),
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(current.getByText("未找到“cover”")).toBeTruthy())

    fireEvent.click(current.getByRole("button", { name: "子目录" }))
    fireEvent.submit(input.closest("form")!)
    await waitFor(() => expect(searchDirectoryBrowser).toHaveBeenLastCalledWith(
      "browser-1",
      "cover",
      expect.objectContaining({ maximumDepth: undefined, maximumResults: 512 }),
      expect.any(AbortSignal),
    ))
  })

  it("[neoview.folder.search-stale] ignores a superseded search and renders error and truncated states", async () => {
    const first = deferred<ReaderDirectorySearchResultDto>()
    const second = deferred<ReaderDirectorySearchResultDto>()
    const searchDirectoryBrowser = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockRejectedValueOnce(new Error("搜索服务不可用"))
    const view = renderPanel({ searchDirectoryBrowser } as unknown as ReaderHttpClient)
    const current = within(view.container)
    const input = current.getByRole("textbox", { name: "搜索文件" })

    fireEvent.change(input, { target: { value: "old" } })
    fireEvent.submit(input.closest("form")!)
    fireEvent.change(input, { target: { value: "new" } })
    fireEvent.submit(input.closest("form")!)
    second.resolve(result("new", [{ name: "new.cbz", path: "D:/new.cbz", kind: "file", readerSupported: true }], true))
    await waitFor(() => expect(current.getByText("new.cbz")).toBeTruthy())
    expect(current.getByText("已截断至 512 项")).toBeTruthy()
    first.resolve(result("old", [{ name: "old.cbz", path: "D:/old.cbz", kind: "file", readerSupported: true }]))
    await Promise.resolve()
    expect(current.queryByText("old.cbz")).toBeNull()

    fireEvent.change(input, { target: { value: "failure" } })
    fireEvent.submit(input.closest("form")!)
    await waitFor(() => expect(current.getByRole("alert").textContent).toContain("搜索服务不可用"))
  })

  it("[neoview.folder.search-history-gui] loads, selects, records, removes and clears shared history", async () => {
    const initialHistory = [historyEntry("cover", 100)]
    const listSearchHistory = vi.fn(async () => initialHistory)
    const recordSearchHistory = vi.fn(async (_scope: "folder", query: string) => historyEntry(query, 200))
    const removeSearchHistory = vi.fn(async () => true)
    const clearSearchHistory = vi.fn(async () => 1)
    const searchDirectoryBrowser = vi.fn(async (_sessionId: string, query: string) => result(query))
    const view = renderPanel({
      listSearchHistory,
      recordSearchHistory,
      removeSearchHistory,
      clearSearchHistory,
      searchDirectoryBrowser,
    } as unknown as ReaderHttpClient)
    const current = within(view.container)

    await waitFor(() => expect(listSearchHistory).toHaveBeenCalledWith("folder", 20, expect.any(AbortSignal)))
    const historyButton = current.getByRole("button", { name: "搜索历史" })
    if (historyButton.getAttribute("aria-expanded") !== "true") fireEvent.click(historyButton)
    fireEvent.click(current.getByRole("button", { name: "使用搜索历史：cover" }))
    await waitFor(() => expect(searchDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1",
      "cover",
      expect.any(Object),
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(recordSearchHistory).toHaveBeenCalledWith("folder", "cover", expect.any(AbortSignal)))

    fireEvent.click(current.getByRole("button", { name: "搜索历史" }))
    fireEvent.click(current.getByRole("button", { name: "删除搜索历史：cover" }))
    await waitFor(() => expect(removeSearchHistory).toHaveBeenCalledWith("folder", "cover", expect.any(AbortSignal)))
    expect(current.queryByRole("button", { name: "cover" })).toBeNull()

    view.unmount()
    const clearView = renderPanel({ listSearchHistory, clearSearchHistory } as unknown as ReaderHttpClient)
    const clearPanel = within(clearView.container)
    const clearHistoryButton = clearPanel.getByRole("button", { name: "搜索历史" })
    await waitFor(() => expect((clearHistoryButton as HTMLButtonElement).disabled).toBe(false))
    await waitFor(() => expect(clearHistoryButton.getAttribute("aria-expanded")).toBe("true"))
    fireEvent.click(clearPanel.getByRole("button", { name: "清空搜索历史" }))
    await waitFor(() => expect(clearSearchHistory).toHaveBeenCalledWith("folder", expect.any(AbortSignal)))
  })

  it("[neoview.folder.search-cancel-gui] aborts active search and history requests when unmounted", async () => {
    let searchSignal: AbortSignal | undefined
    let historySignal: AbortSignal | undefined
    const client = {
      listSearchHistory: vi.fn((_scope, _limit, signal) => {
        historySignal = signal
        return new Promise(() => undefined)
      }),
      searchDirectoryBrowser: vi.fn((_sessionId, _query, _options, signal) => {
        searchSignal = signal
        return new Promise(() => undefined)
      }),
    } as unknown as ReaderHttpClient
    const view = renderPanel(client)
    const input = within(view.container).getByRole("textbox", { name: "搜索文件" })
    fireEvent.change(input, { target: { value: "pending" } })
    fireEvent.submit(input.closest("form")!)

    view.unmount()

    expect(searchSignal?.aborted).toBe(true)
    expect(historySignal?.aborted).toBe(true)
  })
})

function renderPanel(client: ReaderHttpClient) {
  return render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 240, itemHeight: 48 }}>
      <FolderSearchPanel client={client} sessionId="browser-1" disabled={false} onActivate={vi.fn()} onClose={vi.fn()} />
    </VirtuosoMockContext.Provider>,
  )
}

function result(
  query: string,
  entries: ReaderDirectorySearchResultDto["entries"] = [],
  truncated = false,
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
    truncated,
  }
}

function historyEntry(query: string, usedAt: number): ReaderSearchHistoryDto {
  return { scope: "folder", query, usedAt, useCount: 1 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
