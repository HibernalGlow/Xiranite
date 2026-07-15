import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { VirtuosoGridMockContext } from "react-virtuoso"
import { describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../adapters/reader-http-client"
import FolderMainCard from "./FolderMainCard"

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
    expect(items).toEqual(expect.arrayContaining([{ id: "0", path: "C:/books/folder", kind: "folder" }]))
    view.unmount()
    expect(releaseLibraryThumbnailContext).toHaveBeenCalledWith(contextId)
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-1")
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
    const view = render(<FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />)
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
    sortSource: "global-default",
    sortTemporary: false,
    globalDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    tabDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    ...overrides,
  }
}
