import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { VirtuosoGridMockContext, VirtuosoMockContext } from "react-virtuoso"
import { afterEach, describe, expect, it, vi } from "vitest"

import { READER_FOLDER_DETAIL_DEFAULT_WIDTHS, type ReaderDirectoryPageDto, type ReaderHttpClient } from "../../../adapters/reader-http-client"
import FolderMainCard from "./FolderMainCard"

afterEach(cleanup)

describe("FolderMainCard", () => {
  it("[neoview.browser.card] lazily opens, navigates, and disposes its shared browser session", async () => {
    const opened = page({ path: "C:/books", parentPath: "C:/" })
    const parent = page({ path: "C:/", parentPath: undefined, generation: 2 })
    const openDirectoryBrowser = vi.fn(async () => opened)
    const navigateDirectoryBrowser = vi.fn(async () => parent)
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const client = { openDirectoryBrowser, navigateDirectoryBrowser, closeDirectoryBrowser } as ReaderHttpClient
    const view = render(
      <FolderMainCard client={client} disabled={false} sourcePath="C:/books/page1.png" onOpen={vi.fn()} onGoTo={vi.fn()} />,
    )
    await waitFor(() => expect(openDirectoryBrowser).toHaveBeenCalledWith("C:/books/page1.png", expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByDisplayValue("C:/books")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "上级" }))
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith("browser-1", { action: "up" }, expect.any(AbortSignal)))
    view.unmount()
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-1")
  })

  it("[neoview.browser.restore-index] requests the sparse page containing the parent selection", async () => {
    const opened = page({ path: "C:/books", parentPath: "C:/" })
    const parent = page({
      path: "C:/",
      parentPath: undefined,
      generation: 2,
      total: 1_000,
      suggestedSelection: { path: "C:/books", index: 900 },
    })
    const listDirectoryBrowser = vi.fn(async () => page({ ...parent, cursor: 896 }))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser: vi.fn(async () => parent),
      listDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    render(<FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole("button", { name: "上级" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole("button", { name: "上级" }))
    await waitFor(() => expect(listDirectoryBrowser).toHaveBeenCalledWith("browser-1", 896, 128, expect.any(AbortSignal)))
  })

  it("[neoview.browser.visible-thumbnails] registers grid entries and releases the bounded context", async () => {
    const opened = page({
      total: 2,
      entries: [
        { name: "folder", path: "C:/books/folder", kind: "directory", readerSupported: true },
        { name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true },
      ],
    })
    const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number) => ({
      contextId,
      generation,
      items: [
        { id: "0", thumbnailUrl: "http://127.0.0.1/folder.webp", contentVersion: "folder-v1" },
        { id: "1", thumbnailUrl: "http://127.0.0.1/book.webp", contentVersion: "book-v1" },
      ],
    }))
    const releaseLibraryThumbnailContext = vi.fn(async () => undefined)
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      registerLibraryThumbnails,
      releaseLibraryThumbnailContext,
      closeDirectoryBrowser,
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoGridMockContext.Provider value={{ viewportHeight: 288, viewportWidth: 400, itemHeight: 144, itemWidth: 112 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoGridMockContext.Provider>,
    )
    const currentView = within(view.container)
    await waitFor(() => expect(currentView.getByLabelText("封面网格")).toBeTruthy())
    fireEvent.click(currentView.getByLabelText("封面网格"))
    await waitFor(() => expect(registerLibraryThumbnails).toHaveBeenCalled())
    const [contextId, generation, items] = registerLibraryThumbnails.mock.calls.at(-1)!
    expect(contextId).toMatch(/^folder:browser-1:\d+$/)
    expect(generation).toBeGreaterThan(0)
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(64)
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "0", path: "C:/books/folder", kind: "folder", previewCount: 1 })]))
    fireEvent.click(currentView.getByLabelText("多图网格"))
    await waitFor(() => expect(registerLibraryThumbnails.mock.calls.at(-1)?.[2]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "0", kind: "folder", previewCount: 4 }),
      expect.objectContaining({ id: "1", kind: "file", previewCount: 1 }),
    ])))
    expect(currentView.getByLabelText("多图数量")).toBeTruthy()
    await waitFor(() => expect(view.container.querySelectorAll('[data-preview-mode="mosaic-grid"] img')).toHaveLength(2))
    view.unmount()
    expect(releaseLibraryThumbnailContext).toHaveBeenCalledWith(contextId)
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-1")
  })

  it("[neoview.folder.selection-range-ui] [neoview.folder.selection-bulk-ui] [neoview.folder.selection-chain-ui] [neoview.folder.selection-click-behavior] shares selection controls across list and grid renderers", async () => {
    const opened = page({
      total: 4,
      entries: Array.from({ length: 4 }, (_, index) => ({
        name: `item-${index}.cbz`,
        path: `C:/books/item-${index}.cbz`,
        kind: "file" as const,
        readerSupported: true,
      })),
    })
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const onOpen = vi.fn()
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <VirtuosoGridMockContext.Provider value={{ viewportHeight: 288, viewportWidth: 400, itemHeight: 144, itemWidth: 112 }}>
          <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={onOpen} onGoTo={vi.fn()} />
        </VirtuosoGridMockContext.Provider>
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    const item = (index: number) => currentView.getByTitle(`C:/books/item-${index}.cbz`)

    await waitFor(() => expect(item(1)).toBeTruthy())
    fireEvent.click(item(1))
    fireEvent.click(item(3), { shiftKey: true })
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("3")
    expect(item(0).getAttribute("aria-selected")).toBe("false")
    for (const index of [1, 2, 3]) expect(item(index).getAttribute("aria-selected")).toBe("true")

    fireEvent.click(item(2), { ctrlKey: true })
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("2")
    expect(item(2).getAttribute("aria-selected")).toBe("false")

    fireEvent.click(currentView.getByLabelText("封面网格"))
    await waitFor(() => expect(item(1).getAttribute("data-preview-mode")).toBe("cover-grid"))
    expect(item(1).getAttribute("aria-selected")).toBe("true")
    expect(item(2).getAttribute("aria-selected")).toBe("false")
    expect(item(3).getAttribute("aria-selected")).toBe("true")

    fireEvent.click(currentView.getByLabelText("多选模式"))
    expect(currentView.getByText("2").closest('[data-neoview-folder-selection-bar="true"]')).toBeTruthy()
    fireEvent.click(currentView.getByLabelText("选择全部项目"))
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("4")
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-all")).toBe("true")

    fireEvent.click(item(2))
    expect(onOpen).toHaveBeenCalledWith("C:/books/item-2.cbz")
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("4")
    fireEvent.click(currentView.getByLabelText("点击行为：点开"))
    fireEvent.click(item(2))
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("3")
    expect(item(2).getAttribute("aria-selected")).toBe("false")
    fireEvent.click(currentView.getByLabelText("反转选择状态"))
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1")
    expect(item(2).getAttribute("aria-selected")).toBe("true")

    fireEvent.click(currentView.getByLabelText("取消全部选择"))
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("0")
    fireEvent.click(currentView.getByLabelText("链接选中模式"))
    fireEvent.click(item(0))
    fireEvent.click(item(3))
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("4")
    fireEvent.click(currentView.getByLabelText("关闭多选模式"))
    expect(view.container.querySelector('[data-neoview-folder-selection-bar="true"]')).toBeNull()

    view.unmount()
  })

  it("[neoview.folder.keyboard-navigation] moves a sparse global focus without depending on mounted rows", async () => {
    const opened = page({
      total: 4,
      entries: Array.from({ length: 4 }, (_, index) => ({
        name: `item-${index}.cbz`,
        path: `C:/books/item-${index}.cbz`,
        kind: "file" as const,
        readerSupported: true,
      })),
    })
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const onOpen = vi.fn()
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <VirtuosoGridMockContext.Provider value={{ viewportHeight: 288, viewportWidth: 400, itemHeight: 144, itemWidth: 112 }}>
          <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={onOpen} onGoTo={vi.fn()} />
        </VirtuosoGridMockContext.Provider>
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    const host = await currentView.findByRole("listbox", { name: "文件项目" })
    const item = (index: number) => currentView.getByTitle(`C:/books/item-${index}.cbz`)

    fireEvent.keyDown(host, { key: "End" })
    expect(host.getAttribute("data-focused-index")).toBe("3")
    expect(item(3).getAttribute("aria-selected")).toBe("true")
    fireEvent.keyDown(host, { key: "ArrowUp" })
    expect(host.getAttribute("data-focused-index")).toBe("2")
    fireEvent.keyDown(host, { key: "Home", shiftKey: true })
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("3")
    fireEvent.keyDown(host, { key: "PageDown" })
    expect(host.getAttribute("data-focused-index")).toBe("3")
    fireEvent.keyDown(host, { key: "PageUp" })
    expect(host.getAttribute("data-focused-index")).toBe("0")

    onOpen.mockClear()
    fireEvent.keyDown(host, { key: "Enter" })
    expect(onOpen).toHaveBeenCalledWith("C:/books/item-0.cbz")
    fireEvent.keyDown(host, { key: "a", ctrlKey: true })
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("4")
    expect(currentView.getByText("4").closest('[data-neoview-folder-selection-bar="true"]')).toBeTruthy()
    fireEvent.keyDown(host, { key: "Escape" })
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("0")
    expect(view.container.querySelector('[data-neoview-folder-selection-bar="true"]')).toBeNull()

    view.unmount()
  })

  it("[neoview.folder.sort-ui] reorders the backend snapshot and preserves the focused path", async () => {
    const opened = page({
      total: 1,
      entries: [{ name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true }],
      suggestedSelection: { path: "C:/books/book.cbz", index: 0 },
    })
    const sorted = page({
      ...opened,
      generation: 2,
      sort: { field: "name", order: "desc", directoriesFirst: true },
      sortSource: "memory",
      suggestedSelection: { path: "C:/books/book.cbz", index: 0 },
    })
    const sortDirectoryBrowser = vi.fn(async () => sorted)
    const updateDirectorySortPreference = vi.fn(async () => page({
      ...sorted,
      generation: 3,
      sortSource: "temporary",
      sortTemporary: true,
    }))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      sortDirectoryBrowser,
      updateDirectorySortPreference,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    await waitFor(() => expect(currentView.getByRole("button", { name: "升序" })).toBeTruthy())
    fireEvent.click(currentView.getByRole("button", { name: "升序" }))
    await waitFor(() => expect(sortDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1",
      { field: "name", order: "desc", directoriesFirst: true },
      "C:/books/book.cbz",
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(currentView.getByRole("button", { name: "降序" })).toBeTruthy())
    fireEvent.click(currentView.getByRole("button", { name: "锁定当前目录排序" }))
    await waitFor(() => expect(updateDirectorySortPreference).toHaveBeenCalledWith(
      "browser-1",
      { action: "temporary", enabled: true },
      "C:/books/book.cbz",
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(currentView.getByRole("button", { name: "取消临时排序" })).toBeTruthy())
  })

  it("[neoview.folder.emm-display] shows hydrated rating and favorite-tag counts without per-row requests", async () => {
    const opened = page({
      total: 1,
      metadataFields: ["rating", "collectTagCount"],
      sortFields: ["name", "rating", "collectTagCount"],
      entries: [{
        name: "book.cbz",
        path: "C:/books/book.cbz",
        kind: "file",
        readerSupported: true,
        rating: 4.8,
        collectTagCount: 3,
      }],
    })
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    await waitFor(() => expect(currentView.getByTitle("评分 4.8")).toBeTruthy())
    expect(currentView.getByTitle("收藏标签 3")).toBeTruthy()
  })

  it("[neoview.folder.details-lazy] loads the sparse Niko view only after explicit activation", async () => {
    const opened = page({
      total: 1,
      metadataCapabilities: ["date", "size", "dimensions", "pageCount", "tags"],
      entries: [{ name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true, size: 1024 }],
    })
    const listDirectoryBrowser = vi.fn(async () => page({
      ...opened,
      metadataFields: ["date", "size", "dimensions", "pageCount", "tags"],
      entries: [{
        name: "book.cbz",
        path: "C:/books/book.cbz",
        kind: "file",
        readerSupported: true,
        size: 1024,
        width: 1200,
        height: 1800,
        pageCount: 24,
        tags: ["artist:alice"],
      }],
    }))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      listDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    await waitFor(() => expect(currentView.getByLabelText("详细信息")).toBeTruthy())
    expect(view.container.querySelector('[data-table-engine="niko-sparse"]')).toBeNull()
    fireEvent.click(currentView.getByLabelText("详细信息"))
    await waitFor(() => expect(view.container.querySelector('[data-table-engine="niko-sparse"]')).toBeTruthy())
    await waitFor(() => expect(listDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1",
      0,
      128,
      expect.any(AbortSignal),
      ["date", "size", "dimensions", "pageCount", "tags"],
    ))
    expect(currentView.getByText("扩展名")).toBeTruthy()
  })

  it("[neoview.folder.settings-persistence] restores the configured renderer and persists one settled view change", async () => {
    const onFolderView = vi.fn(async () => undefined)
    const client = {
      openDirectoryBrowser: vi.fn(async () => page({ total: 0 })),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books"
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
          folderView={{
            viewMode: "details",
            previewCount: 9,
            details: {
              columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
              hiddenColumns: ["tags"],
              pinnedLeft: ["name"],
              pinnedRight: ["rating"],
              columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
            },
          }}
          onFolderView={onFolderView}
        />
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    await waitFor(() => expect(currentView.getByLabelText("详细信息").getAttribute("data-state")).toBe("on"))
    fireEvent.click(currentView.getByLabelText("封面列表"))
    await waitFor(() => expect(onFolderView).toHaveBeenCalledTimes(1))
    expect(onFolderView).toHaveBeenCalledWith({ viewMode: "cover-list" })
  })
})

function page(overrides: Partial<ReaderDirectoryPageDto>): ReaderDirectoryPageDto {
  return {
    sessionId: "browser-1",
    path: "C:/books",
    entries: [],
    cursor: 0,
    total: 0,
    canGoBack: false,
    canGoForward: false,
    generation: 1,
    sort: { field: "name", order: "asc", directoriesFirst: true },
    sortFields: ["name", "date", "size", "type", "random", "path"],
    metadataFields: [],
    sortSource: "global-default",
    sortTemporary: false,
    globalDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    tabDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    ...overrides,
  }
}
