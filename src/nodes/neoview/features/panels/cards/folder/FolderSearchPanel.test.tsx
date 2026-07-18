import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { VirtuosoMockContext } from "react-virtuoso"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderDirectorySearchOptionsDto, ReaderDirectorySearchResultDto, ReaderFolderSearchConfig, ReaderHttpClient, ReaderSearchHistoryDto } from "../../../../adapters/reader-http-client"
import FolderSearchPanel from "./FolderSearchPanel"

afterEach(cleanup)

describe("FolderSearchPanel", () => {
  it("[neoview.folder.search-current] [neoview.folder.search-recursive] [neoview.folder.search-path-gui] sends shared search options", async () => {
    const searchDirectoryBrowser = vi.fn(async (_sessionId: string, query: string) => result(query))
    const view = renderPanel({ searchDirectoryBrowser } as unknown as ReaderHttpClient)
    const current = within(view.container)
    const input = current.getByRole("textbox", { name: "搜索文件" })

    fireEvent.change(input, { target: { value: "cover" } })
    fireEvent.submit(input.closest("form")!)
    await waitFor(() => expect(searchDirectoryBrowser).toHaveBeenLastCalledWith(
      "browser-1",
      "cover",
      expect.objectContaining({ mode: "text", kind: "all", searchInPath: false, maximumDepth: undefined, maximumResults: 512 }),
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(current.getByText("未找到“cover”")).toBeTruthy())

    fireEvent.click(current.getByRole("button", { name: "子目录" }))
    fireEvent.submit(input.closest("form")!)
    await waitFor(() => expect(searchDirectoryBrowser).toHaveBeenLastCalledWith(
      "browser-1",
      "cover",
      expect.objectContaining({ maximumDepth: 0, maximumResults: 512 }),
      expect.any(AbortSignal),
    ))

    fireEvent.click(current.getByRole("checkbox", { name: "匹配路径" }))
    fireEvent.submit(input.closest("form")!)
    await waitFor(() => expect(searchDirectoryBrowser).toHaveBeenLastCalledWith(
      "browser-1",
      "cover",
      expect.objectContaining({ searchInPath: true }),
      expect.any(AbortSignal),
    ))
  })

  it("[neoview.folder.search-settings-gui] emits one minimal patch for each legacy search setting", () => {
    const onSettingsChange = vi.fn()
    const view = renderPanel({} as ReaderHttpClient, onSettingsChange)
    const current = within(view.container)

    fireEvent.click(current.getByRole("button", { pressed: true }))
    const [pathCheckbox, historyCheckbox] = current.getAllByRole("checkbox")
    fireEvent.click(pathCheckbox!)
    fireEvent.click(historyCheckbox!)

    expect(onSettingsChange.mock.calls).toEqual([
      [{ includeSubfolders: false }],
      [{ searchInPath: true }],
      [{ showHistoryOnFocus: false }],
    ])
  })

  it("[neoview.folder.search-single-click-open] opens a search result on one click", async () => {
    const entry = { name: "book.cbz", path: "D:/book.cbz", kind: "file" as const, readerSupported: true }
    const onActivate = vi.fn()
    const view = renderPanel({
      searchDirectoryBrowser: vi.fn(async () => result("book", [entry])),
    } as unknown as ReaderHttpClient, undefined, onActivate)
    const current = within(view.container)
    const input = current.getByRole("textbox", { name: "搜索文件" })
    fireEvent.change(input, { target: { value: "book" } })
    fireEvent.submit(input.closest("form")!)

    fireEvent.click(await current.findByTitle("D:/book.cbz"))
    expect(onActivate).toHaveBeenCalledOnce()
    expect(onActivate).toHaveBeenCalledWith(entry)
  })

  it("[neoview.folder.emm-tags-gui] searches structured favorite tags with legacy click modifiers", async () => {
    const searchDirectoryBrowser = vi.fn(async (_sessionId: string, query: string) => result(query))
    const view = renderPanel({
      suggestDirectoryEmmTags: vi.fn(async () => [
        { category: "artist", tag: "alice", favorite: true, translatedTag: "爱丽丝" },
        { category: "female", tag: "glasses", favorite: false },
        { category: "language", tag: "chinese", favorite: false },
      ]),
      searchDirectoryBrowser,
    } as unknown as ReaderHttpClient)
    const current = within(view.container)

    fireEvent.click(current.getByRole("button", { name: "收藏标签快选" }))
    const artist = await current.findByRole("button", { name: "选择标签 artist:alice" })
    fireEvent.click(artist)
    await waitFor(() => expect(searchDirectoryBrowser).toHaveBeenLastCalledWith(
      "browser-1",
      "",
      expect.objectContaining({ includeTags: ["artist:alice"], excludeTags: [], tagMode: "all" }),
      expect.any(AbortSignal),
    ))

    fireEvent.click(current.getByRole("button", { name: "选择标签 female:glasses" }), { ctrlKey: true })
    await waitFor(() => expect(searchDirectoryBrowser).toHaveBeenLastCalledWith(
      "browser-1",
      "",
      expect.objectContaining({ includeTags: ["artist:alice", "female:glasses"], excludeTags: [], tagMode: "all" }),
      expect.any(AbortSignal),
    ))

    fireEvent.click(current.getByRole("button", { name: "选择标签 language:chinese" }), { shiftKey: true })
    await waitFor(() => expect(searchDirectoryBrowser).toHaveBeenLastCalledWith(
      "browser-1",
      "",
      expect.objectContaining({ includeTags: ["artist:alice", "female:glasses"], excludeTags: ["language:chinese"], tagMode: "all" }),
      expect.any(AbortSignal),
    ))

    fireEvent.click(current.getByRole("button", { name: "标签匹配方式" }))
    await waitFor(() => expect(searchDirectoryBrowser).toHaveBeenLastCalledWith(
      "browser-1",
      "",
      expect.objectContaining({ tagMode: "any" }),
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

  it("[neoview.folder.search-incremental] virtualizes a settled batch while the NDJSON stream is still active", async () => {
    const finished = deferred<ReaderDirectorySearchResultDto>()
    let options: ReaderDirectorySearchOptionsDto | undefined
    const searchDirectoryBrowser = vi.fn((_sessionId, _query, nextOptions: ReaderDirectorySearchOptionsDto) => {
      options = nextOptions
      return finished.promise
    })
    const view = renderPanel({ searchDirectoryBrowser } as unknown as ReaderHttpClient)
    const current = within(view.container)
    const input = current.getByRole("textbox", { name: "搜索文件" })
    fireEvent.change(input, { target: { value: "batch" } })
    fireEvent.submit(input.closest("form")!)
    await waitFor(() => expect(options?.onEntries).toBeTypeOf("function"))
    const entries = Array.from({ length: 16 }, (_, index) => ({
      name: `batch-${index}.cbz`,
      path: `D:/batch-${index}.cbz`,
      kind: "file" as const,
      readerSupported: true,
    }))

    act(() => options!.onEntries!(entries))
    await waitFor(() => expect(current.getByText("batch-0.cbz")).toBeTruthy())
    expect(current.queryByText("batch-15.cbz")).toBeNull()
    expect(current.getByText("已找到 16 项，正在搜索")).toBeTruthy()
    await act(async () => finished.resolve(result("batch", entries)))
    await waitFor(() => expect(current.getByText("16 个结果 / 扫描 16 项")).toBeTruthy())
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

const DEFAULT_SEARCH_SETTINGS: ReaderFolderSearchConfig = {
  includeSubfolders: true,
  showHistoryOnFocus: true,
  searchInPath: false,
}

function SearchPanelHarness({ client, onSettingsChange, onActivate }: { client: ReaderHttpClient; onSettingsChange?: (patch: Partial<ReaderFolderSearchConfig>) => void; onActivate: (entry: ReaderDirectorySearchResultDto["entries"][number]) => void }) {
  const [settings, setSettings] = useState(DEFAULT_SEARCH_SETTINGS)
  function updateSettings(patch: Partial<ReaderFolderSearchConfig>) {
    setSettings((current) => ({ ...current, ...patch }))
    onSettingsChange?.(patch)
  }
  return <FolderSearchPanel client={client} sessionId="browser-1" disabled={false} settings={settings} onSettingsChange={updateSettings} onActivate={onActivate} onClose={vi.fn()} />
}

function renderPanel(client: ReaderHttpClient, onSettingsChange?: (patch: Partial<ReaderFolderSearchConfig>) => void, onActivate = vi.fn()) {
  return render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 240, itemHeight: 48 }}>
      <SearchPanelHarness client={client} onSettingsChange={onSettingsChange} onActivate={onActivate} />
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
