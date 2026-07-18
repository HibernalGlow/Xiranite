import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { VirtuosoGridMockContext, VirtuosoMockContext } from "react-virtuoso"
import { afterEach, describe, expect, it, vi } from "vitest"

import { READER_FOLDER_DETAIL_DEFAULT_WIDTHS, type ReaderDirectoryPageDto, type ReaderFolderViewConfig, type ReaderHttpClient } from "../../../adapters/reader-http-client"
import { ContextMenuProvider } from "@/components/context-menu"
import FolderMainCard, { mergeThumbnailUrls } from "./FolderMainCard"

function selectFolderViewMode(scope: ReturnType<typeof within> | typeof screen, label: string) {
  if (!scope.queryByRole("button", { name: label })) selectFolderHandleAction(scope, "视图")
  fireEvent.click(scope.getByRole("button", { name: label }))
}

function createFolderTab(scope: ReturnType<typeof within> | typeof screen) {
  if (!scope.queryByRole("button", { name: "新建文件夹标签" })) selectFolderHandleAction(scope, "更多操作")
  fireEvent.click(scope.getByRole("button", { name: "新建文件夹标签" }))
}

function selectFolderHandleAction(scope: ReturnType<typeof within> | typeof screen, label: string) {
  fireEvent.click(scope.getByRole("button", { name: "文件操作手柄" }))
  fireEvent.click(screen.getByRole("menuitem", { name: label }))
}

afterEach(cleanup)

describe("FolderMainCard", () => {
  it("[neoview.folder.thumbnail-visit-cache] keeps recent URLs in a bounded visit cache", () => {
    const current = new Map([["A", "url-a"], ["B", "url-b"]])
    const merged = mergeThumbnailUrls(current, [["A", "url-a-2"], ["C", "url-c"]], 2)

    expect([...merged]).toEqual([["A", "url-a-2"], ["C", "url-c"]])
    expect(current.get("A")).toBe("url-a")
  })

  it("[neoview.folder.single-click-open] opens files and folders by default while modified clicks select", async () => {
    const opened = page({
      entries: [
        { name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true },
        { name: "notes.txt", path: "C:/books/notes.txt", kind: "file", readerSupported: false },
        { name: "series", path: "C:/books/series", kind: "directory", readerSupported: true },
      ],
      total: 3,
    })
    const nested = page({ navigationEntryId: 2, path: "C:/books/series", parentPath: "C:/books", generation: 2 })
    const onOpen = vi.fn()
    const openSystemPath = vi.fn(async () => undefined)
    const navigateDirectoryBrowser = vi.fn(async () => nested)
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      openSystemPath,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={onOpen} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)

    fireEvent.click(await ui.findByTitle("C:/books/book.cbz"))
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledWith("C:/books/book.cbz")
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("0")

    fireEvent.click(ui.getByTitle("C:/books/notes.txt"))
    expect(openSystemPath).toHaveBeenCalledWith("C:/books/notes.txt")
    fireEvent.click(ui.getByTitle("C:/books/book.cbz"), { ctrlKey: true })
    expect(onOpen).toHaveBeenCalledOnce()
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1")

    fireEvent.click(ui.getByTitle("C:/books/series"))
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1",
      { action: "path", path: "C:/books/series" },
      expect.any(AbortSignal),
      "C:/books/series",
    ))
  })

  it("[neoview.browser.card] lazily opens, navigates, and disposes its shared browser session", async () => {
    const opened = page({ path: "C:/books", parentPath: "C:/" })
    const parent = page({ navigationEntryId: 2, path: "C:/", parentPath: undefined, generation: 2 })
    const openDirectoryBrowser = vi.fn(async () => opened)
    const navigateDirectoryBrowser = vi.fn(async () => parent)
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const client = { openDirectoryBrowser, navigateDirectoryBrowser, closeDirectoryBrowser } as ReaderHttpClient
    const view = render(
      <FolderMainCard client={client} disabled={false} sourcePath="C:/books/page1.png" onOpen={vi.fn()} onGoTo={vi.fn()} />,
    )
    await waitFor(() => expect(openDirectoryBrowser).toHaveBeenCalledWith("C:/books/page1.png", expect.any(AbortSignal), undefined, true))
    await waitFor(() => expect(screen.getByRole("button", { name: "books" }).getAttribute("aria-current")).toBe("page"))
    fireEvent.click(screen.getByRole("button", { name: "上级" }))
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith("browser-1", { action: "up" }, expect.any(AbortSignal), undefined))
    view.unmount()
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-1")
  })

  it("[neoview.folder.panel-resident] keeps the browser session and card DOM resident while the panel is inactive", async () => {
    const opened = page({ entries: [{ name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true }], total: 1 })
    const openDirectoryBrowser = vi.fn(async () => opened)
    const client = {
      openDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const renderCard = (panelActive: boolean) => (
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} panelActive={panelActive} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>
    )
    const view = render(renderCard(true))
    const card = await within(view.container).findByTitle("C:/books/book.cbz")
    const pane = view.container.querySelector('[data-neoview-folder-pane="true"]')
    expect(pane).toBeTruthy()
    view.rerender(renderCard(false))
    expect(view.container.querySelector('[data-neoview-folder-pane="true"]')).toBe(pane)
    view.rerender(renderCard(true))
    expect(view.container.querySelector('[data-neoview-folder-pane="true"]')).toBe(pane)
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')).toBeTruthy()
    expect(await within(view.container).findByTitle("C:/books/book.cbz")).toBe(card)
    expect(openDirectoryBrowser).toHaveBeenCalledOnce()
    view.unmount()
  })

  it("[neoview.folder.rename-focus] refreshes the same browser session and selects the renamed path", async () => {
    const opened = page({
      path: "C:/books",
      entries: [{ name: "old.cbz", path: "C:/books/old.cbz", kind: "file", readerSupported: true }],
      total: 1,
    })
    const renamed = page({
      path: "C:/books",
      generation: 2,
      entries: [{ name: "new.cbz", path: "C:/books/new.cbz", kind: "file", readerSupported: true }],
      total: 1,
      suggestedSelection: { path: "C:/books/new.cbz", index: 0 },
    })
    const executeFileOperations = vi.fn(async () => ({
      results: [{ index: 0, operation: { kind: "rename" as const, sourcePath: "C:/books/old.cbz", destinationPath: "C:/books/new.cbz" }, status: "succeeded" as const }],
      succeeded: 1, failed: 0, cancelled: 0, undoable: 1,
    }))
    const navigateDirectoryBrowser = vi.fn(async () => renamed)
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      executeFileOperations,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const user = userEvent.setup()
    const view = render(
      <ContextMenuProvider>
        <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
          <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
        </VirtuosoMockContext.Provider>
      </ContextMenuProvider>,
    )
    const ui = within(view.container)
    const oldEntry = await ui.findByTitle("C:/books/old.cbz")
    fireEvent.contextMenu(oldEntry, { clientX: 20, clientY: 30 })
    await user.click(await screen.findByRole("menuitem", { name: "重命名" }))
    const input = await screen.findByRole("textbox", { name: "新名称" })
    await user.clear(input)
    await user.type(input, "new.cbz")
    await user.click(screen.getByRole("button", { name: "重命名", exact: true }))

    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1",
      { action: "refresh" },
      expect.any(AbortSignal),
      "C:/books/new.cbz",
    ))
    const newEntry = await ui.findByTitle("C:/books/new.cbz")
    expect(newEntry.getAttribute("aria-selected")).toBe("true")
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1")
  })

  it("[neoview.folder.trash-refresh] confirms trash and refreshes the existing browser session", async () => {
    const opened = page({
      path: "C:/books",
      entries: [
        { name: "old.cbz", path: "C:/books/old.cbz", kind: "file", readerSupported: true },
        { name: "next.cbz", path: "C:/books/next.cbz", kind: "file", readerSupported: true },
      ],
      total: 2,
    })
    const refreshed = page({
      path: "C:/books",
      generation: 2,
      entries: [{ name: "next.cbz", path: "C:/books/next.cbz", kind: "file", readerSupported: true }],
      total: 1,
      suggestedSelection: { path: "C:/books/next.cbz", index: 0 },
    })
    const executeFileOperations = vi.fn(async () => ({
      results: [{ index: 0, operation: { kind: "trash" as const, sourcePath: "C:/books/old.cbz" }, status: "succeeded" as const }],
      succeeded: 1, failed: 0, cancelled: 0, undoable: 0,
    }))
    const navigateDirectoryBrowser = vi.fn(async () => refreshed)
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      executeFileOperations,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const user = userEvent.setup()
    const view = render(
      <ContextMenuProvider>
        <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
          <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
        </VirtuosoMockContext.Provider>
      </ContextMenuProvider>,
    )
    const ui = within(view.container)
    fireEvent.contextMenu(await ui.findByTitle("C:/books/old.cbz"), { clientX: 20, clientY: 30 })
    await user.click(await screen.findByRole("menuitem", { name: "移到回收站" }))
    await user.click(screen.getByRole("button", { name: "移到回收站" }))

    await waitFor(() => expect(executeFileOperations).toHaveBeenCalledWith(
      [{ kind: "trash", sourcePath: "C:/books/old.cbz" }],
      true,
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1",
      { action: "refresh" },
      expect.any(AbortSignal),
      "C:/books/old.cbz",
    ))
    expect(ui.queryByTitle("C:/books/old.cbz")).toBeNull()
    expect(await ui.findByTitle("C:/books/next.cbz")).toBeTruthy()
  })

  it("[neoview.folder.tabs-lifecycle] [neoview.folder.tabs-navigation-history] creates, switches and closes isolated Explorer-style folder tabs", async () => {
    const pages = new Map([
      ["C:/A", page({ sessionId: "browser-a", path: "C:/A", entries: [{ name: "a.cbz", path: "C:/A/a.cbz", kind: "file", readerSupported: true }], total: 1 })],
      ["C:/B", page({ sessionId: "browser-b", path: "C:/B", entries: [{ name: "b.cbz", path: "C:/B/b.cbz", kind: "file", readerSupported: true }], total: 1 })],
      ["C:/C", page({ sessionId: "browser-c", path: "C:/C", entries: [{ name: "c.cbz", path: "C:/C/c.cbz", kind: "file", readerSupported: true }], total: 1 })],
    ])
    const openDirectoryBrowser = vi.fn(async (path: string) => pages.get(path)!)
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const client = { openDirectoryBrowser, closeDirectoryBrowser } as unknown as ReaderHttpClient
    const renderCard = (homePath: string) => (
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/A"
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
          folderView={folderViewConfig({ homePath })}
          onFolderView={vi.fn(async () => undefined)}
        />
      </VirtuosoMockContext.Provider>
    )
    const view = render(renderCard("C:/B"))
    const ui = within(view.container)
    const activeCard = () => within(view.container.querySelector('[data-neoview-folder-card="true"]') as HTMLElement)
    const activeViewMode = () => view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-folder-view-mode")

    await waitFor(() => expect(openDirectoryBrowser).toHaveBeenCalledWith("C:/A", expect.any(AbortSignal), undefined, true))
    await activeCard().findByTitle("C:/A/a.cbz")
    fireEvent.click(activeCard().getByTitle("C:/A/a.cbz"), { ctrlKey: true })
    selectFolderViewMode(activeCard(), "详细信息")
    await waitFor(() => expect(activeViewMode()).toBe("details"))

    createFolderTab(ui)
    await waitFor(() => expect(openDirectoryBrowser).toHaveBeenCalledWith("C:/B", expect.any(AbortSignal), undefined, true))
    await activeCard().findByTitle("C:/B/b.cbz")
    expect((await ui.findByRole("tab", { name: "B" })).getAttribute("aria-selected")).toBe("true")
    expect(activeViewMode()).toBe("compact")

    view.rerender(renderCard("C:/C"))
    createFolderTab(ui)
    await waitFor(() => expect(openDirectoryBrowser).toHaveBeenCalledWith("C:/C", expect.any(AbortSignal), undefined, true))
    await activeCard().findByTitle("C:/C/c.cbz")
    expect(ui.getByRole("tab", { name: "C" }).getAttribute("aria-selected")).toBe("true")

    fireEvent.click(ui.getByRole("tab", { name: "A" }))
    await waitFor(() => expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1"))
    expect(view.container.querySelector('[data-neoview-folder-card="true"] [data-neoview-folder-breadcrumb="true"] [aria-current="page"]')?.getAttribute("title")?.replaceAll("\\", "/")).toBe("C:/A")
    expect(activeViewMode()).toBe("details")

    fireEvent.click(ui.getByRole("tab", { name: "B" }))
    fireEvent.click(ui.getByRole("button", { name: "关闭标签 B" }))
    await waitFor(() => expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-b", true))
    expect(ui.getByRole("tab", { name: "A" }).getAttribute("aria-selected")).toBe("true")
    expect(ui.getByRole("tab", { name: "C" }).getAttribute("aria-selected")).toBe("false")
    expect(view.container.querySelector('[data-folder-tab-count="2"]')).toBeTruthy()
    expect(openDirectoryBrowser).toHaveBeenCalledTimes(3)

    view.unmount()
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-a")
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-c")
  })

  it("[neoview.folder.tabs-bulk-close] protects pinned tabs and disposes every bulk-closed browser pane", async () => {
    const paths = ["A", "B", "C", "D", "E", "F"]
    const pages = new Map(paths.map((name) => [
      `C:/${name}`,
      page({ sessionId: `browser-${name.toLowerCase()}`, path: `C:/${name}`, entries: [{ name: `${name.toLowerCase()}.cbz`, path: `C:/${name}/${name.toLowerCase()}.cbz`, kind: "file", readerSupported: true }], total: 1 }),
    ]))
    const openDirectoryBrowser = vi.fn(async (path: string) => pages.get(path)!)
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const client = { openDirectoryBrowser, closeDirectoryBrowser } as unknown as ReaderHttpClient
    const renderCard = (homePath: string) => (
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/A" onOpen={vi.fn()} onGoTo={vi.fn()} folderView={folderViewConfig({ homePath })} onFolderView={vi.fn(async () => undefined)} />
      </VirtuosoMockContext.Provider>
    )
    const view = render(renderCard("C:/B"))
    const ui = within(view.container)
    const createTab = async (path: string) => {
      view.rerender(renderCard(path))
      createFolderTab(ui)
      await waitFor(() => expect(ui.getByRole("tab", { name: path.at(-1)! }).getAttribute("aria-selected")).toBe("true"))
    }
    const selectMenuItem = async (tab: string, item: string) => {
      fireEvent.pointerDown(ui.getByRole("button", { name: `标签操作 ${tab}` }), { button: 0, ctrlKey: false, pointerType: "mouse" })
      fireEvent.click(await screen.findByRole("menuitem", { name: item }))
    }

    await waitFor(() => expect(openDirectoryBrowser).toHaveBeenCalledWith("C:/A", expect.any(AbortSignal), undefined, true))
    await createTab("C:/B")
    await createTab("C:/C")
    await createTab("C:/D")
    await selectMenuItem("B", "固定标签")
    expect(ui.getByRole("tab", { name: "B" }).closest('[data-pinned="true"]')).toBeTruthy()

    await selectMenuItem("C", "关闭左侧标签")
    await waitFor(() => expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-a", true))
    expect(ui.queryByRole("tab", { name: "A" })).toBeNull()
    expect(ui.getByRole("tab", { name: "B" })).toBeTruthy()

    await selectMenuItem("C", "关闭右侧标签")
    await waitFor(() => expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-d", true))
    expect(ui.getByRole("tab", { name: "C" }).getAttribute("aria-selected")).toBe("true")

    await createTab("C:/E")
    await createTab("C:/F")
    await selectMenuItem("E", "关闭其他标签")
    await waitFor(() => expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-c", true))
    await waitFor(() => expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-f", true))
    expect(ui.getByRole("tab", { name: "B" })).toBeTruthy()
    expect(ui.getByRole("tab", { name: "E" }).getAttribute("aria-selected")).toBe("true")
    expect(view.container.querySelector('[data-folder-tab-count="2"]')).toBeTruthy()

    view.unmount()
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-b")
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-e")
  })

  it("[neoview.folder.tabs-pin-duplicate] persists pins, rolls back failures, and clones pane state into an independent session", async () => {
    const source = page({
      sessionId: "browser-source",
      path: "C:/A",
      entries: [{ name: "a.cbz", path: "C:/A/a.cbz", kind: "file", readerSupported: true }],
      total: 1,
    })
    const cloned = page({ ...source, sessionId: "browser-clone" })
    const updateFolderView = vi.fn(async () => undefined)
    const client = {
      openDirectoryBrowser: vi.fn(async () => source),
      cloneDirectoryBrowser: vi.fn(async () => cloned),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/A" onOpen={vi.fn()} onGoTo={vi.fn()} folderView={folderViewConfig()} onFolderView={updateFolderView} />
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)
    const openMenu = async (tab: string, item: string) => {
      fireEvent.pointerDown(ui.getByRole("button", { name: `标签操作 ${tab}` }), { button: 0, pointerType: "mouse" })
      fireEvent.click(await screen.findByRole("menuitem", { name: item }))
    }

    await ui.findByTitle("C:/A/a.cbz")
    fireEvent.click(ui.getByTitle("C:/A/a.cbz"), { ctrlKey: true })
    selectFolderViewMode(ui, "详细信息")
    selectFolderHandleAction(ui, "更多操作")
    fireEvent.click(ui.getByRole("button", { name: "复制当前标签" }))

    await waitFor(() => expect(client.cloneDirectoryBrowser).toHaveBeenCalledWith("browser-source", expect.any(AbortSignal)))
    await waitFor(() => expect(view.container.querySelector('[data-folder-tab-count="2"]')).toBeTruthy())
    expect(client.openDirectoryBrowser).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1")
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-folder-view-mode")).toBe("details")

    await openMenu("A", "固定标签")
    await waitFor(() => expect(updateFolderView).toHaveBeenCalledWith({ tabs: { pinned: [{ path: "C:/A", title: "A" }] } }))

    updateFolderView.mockRejectedValueOnce(new Error("disk full"))
    await openMenu("A", "取消固定")
    await waitFor(() => expect(ui.getAllByRole("tab", { name: "A" }).some((tab) => tab.closest('[data-pinned="true"]'))).toBe(true))

    view.unmount()
    expect(client.closeDirectoryBrowser).toHaveBeenCalledWith("browser-source")
    expect(client.closeDirectoryBrowser).toHaveBeenCalledWith("browser-clone")
  })

  it("[neoview.folder.tabs-reopen-ui] restores a closed tab snapshot and retains failed reopen entries", async () => {
    const first = page({ sessionId: "browser-a", path: "C:/A", entries: [], total: 0 })
    const second = page({
      sessionId: "browser-b",
      path: "C:/B",
      entries: [{ name: "b.cbz", path: "C:/B/b.cbz", kind: "file", readerSupported: true }],
      total: 1,
    })
    const restored = page({ ...second, sessionId: "browser-restored" })
    const openDirectoryBrowser = vi.fn(async (path: string) => path === "C:/A" ? first : second)
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const reopenDirectoryBrowser = vi.fn()
      .mockRejectedValueOnce(new Error("offline volume"))
      .mockResolvedValueOnce(restored)
    const client = { openDirectoryBrowser, closeDirectoryBrowser, reopenDirectoryBrowser } as unknown as ReaderHttpClient
    const configured = folderViewConfig({ homePath: "C:/B" })
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/A" onOpen={vi.fn()} onGoTo={vi.fn()} folderView={configured} onFolderView={vi.fn(async () => undefined)} />
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)

    await waitFor(() => expect(openDirectoryBrowser).toHaveBeenCalledTimes(1))
    createFolderTab(ui)
    await ui.findByTitle("C:/B/b.cbz")
    fireEvent.click(ui.getByTitle("C:/B/b.cbz"), { ctrlKey: true })
    selectFolderViewMode(ui, "详细信息")
    fireEvent.click(ui.getByRole("button", { name: "关闭标签 B" }))

    await waitFor(() => expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-b", true))
    expect(ui.queryByRole("tab", { name: "B" })).toBeNull()
    if (!ui.queryByRole("button", { name: "重新打开关闭的标签" })) selectFolderHandleAction(ui, "更多操作")
    await waitFor(() => expect(ui.getByRole("button", { name: "重新打开关闭的标签" }).getAttribute("disabled")).toBeNull())
    fireEvent.click(ui.getByRole("button", { name: "重新打开关闭的标签" }))
    await waitFor(() => expect(reopenDirectoryBrowser).toHaveBeenCalledTimes(1))
    expect(ui.getByRole("button", { name: "重新打开关闭的标签" }).getAttribute("disabled")).toBeNull()

    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(ui.getByRole("tab", { name: "B" }).getAttribute("aria-selected")).toBe("true"))
    expect(reopenDirectoryBrowser).toHaveBeenLastCalledWith("browser-b", expect.any(AbortSignal))
    expect(openDirectoryBrowser).toHaveBeenCalledTimes(2)
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1")
    expect(view.container.querySelector('[data-table-engine="niko-sparse"]')).toBeTruthy()
    expect(ui.getByRole("button", { name: "重新打开关闭的页签" }).getAttribute("disabled")).not.toBeNull()
    view.unmount()
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-restored")
  })

  it("[neoview.folder.tabs-layout-ui] persists five-way nested layout and commits vertical width once", async () => {
    const opened = page({ entries: [{ name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true }], total: 1 })
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const onFolderView = vi.fn(async () => undefined)
    const layout = (overrides: Partial<NonNullable<ReaderFolderViewConfig["tabs"]>> = {}) => ({
      pinned: [], layout: "top" as const, width: 160, breadcrumbPosition: "top" as const, toolbarPosition: "top" as const, ...overrides,
    })
    const renderCard = (tabs: NonNullable<ReaderFolderViewConfig["tabs"]>) => (
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} folderView={folderViewConfig({ tabs })} onFolderView={onFolderView} />
      </VirtuosoMockContext.Provider>
    )
    const view = render(renderCard(layout()))
    const ui = within(view.container)
    await ui.findByTitle("C:/books/book.cbz")
    expect(view.container.querySelector('[data-folder-tab-bar="true"]')).toBeNull()
    expect(view.container.querySelector('[data-folder-tab-count="1"]')).toBeTruthy()

    createFolderTab(ui)
    await waitFor(() => expect(view.container.querySelector('[data-folder-tab-count="2"]')).toBeTruthy())
    const breadcrumb = view.container.querySelector('[data-folder-layout-region="breadcrumb"]')!
    const tabRegion = view.container.querySelector('[data-folder-layout-region="tabs"]')!
    expect(breadcrumb.compareDocumentPosition(tabRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.pointerDown(ui.getByRole("button", { name: "标签栏布局设置" }), { button: 0, pointerType: "mouse" })
    fireEvent.click(await screen.findByRole("button", { name: "标签栏位置：左侧" }))
    await waitFor(() => expect(onFolderView).toHaveBeenCalledWith({ tabs: { layout: "left" } }))
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())

    view.rerender(renderCard(layout({ layout: "left" })))
    await waitFor(() => expect(view.container.querySelector('[data-folder-tab-layout="left"]')).toBeTruthy())
    expect(view.container.querySelector('[data-folder-tab-position="left"]')).toBeTruthy()
    const separator = ui.getByRole("separator", { name: "调整标签栏宽度" })
    onFolderView.mockClear()
    fireEvent.pointerDown(separator, { pointerId: 7, clientX: 100 })
    fireEvent.pointerMove(separator, { pointerId: 7, clientX: 180 })
    expect(view.container.querySelector<HTMLElement>('[data-folder-tab-layout="left"]')?.style.width).toBe("240px")
    expect(onFolderView).not.toHaveBeenCalled()
    fireEvent.pointerUp(separator, { pointerId: 7, clientX: 180 })
    await waitFor(() => expect(onFolderView).toHaveBeenCalledTimes(1))
    expect(onFolderView).toHaveBeenCalledWith({ tabs: { width: 240 } })

    view.rerender(renderCard(layout({ layout: "none", width: 240, breadcrumbPosition: "right", toolbarPosition: "bottom" })))
    await waitFor(() => expect(view.container.querySelector('[data-folder-tab-layout="top"]')).toBeTruthy())
    expect(ui.getAllByRole("tab")).toHaveLength(2)
    expect(ui.getByRole("button", { name: "标签栏布局设置" })).toBeTruthy()
    expect(view.container.querySelector('[data-neoview-folder-breadcrumb="true"]')?.getAttribute("data-orientation")).toBe("vertical")
    expect((view.container.querySelector('[data-folder-layout-region="toolbar"]') as HTMLElement).style.order).toBe("2")
  })

  it("[neoview.folder.tabs-pinned-restore] restores persisted pins beside one unpinned working tab", async () => {
    const client = {
      openDirectoryBrowser: vi.fn(async (path: string) => page({ sessionId: `browser-${path.at(-1)}`, path })),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const configured = folderViewConfig()
    configured.tabs = { pinned: [{ path: "C:/Pinned", title: "Pinned" }] }
    const view = render(<FolderMainCard client={client} disabled={false} sourcePath="C:/Work" onOpen={vi.fn()} onGoTo={vi.fn()} folderView={configured} onFolderView={vi.fn(async () => undefined)} />)

    await waitFor(() => expect(client.openDirectoryBrowser).toHaveBeenCalledTimes(2))
    expect(within(view.container).getByRole("tab", { name: "Pinned" }).closest('[data-pinned="true"]')).toBeTruthy()
    expect(within(view.container).getByRole("tab", { name: "Work" }).getAttribute("aria-selected")).toBe("true")
    expect(view.container.querySelector('[data-folder-tab-count="2"]')).toBeTruthy()
    view.unmount()
  })

  it("[neoview.folder.home-refresh-ui] keeps Home navigation separate from the tree and preserves selection on refresh", async () => {
    const entries = [
      { name: "folder", path: "C:/current/folder", kind: "directory" as const, readerSupported: false },
      { name: "book.cbz", path: "C:/current/book.cbz", kind: "file" as const, readerSupported: true },
    ]
    const opened = page({ path: "C:/current", entries, total: entries.length })
    const refreshed = page({ path: "C:/current", entries, total: entries.length, generation: 2 })
    const home = page({ navigationEntryId: 2, path: "C:/home", canGoBack: true, generation: 3 })
    const navigateDirectoryBrowser = vi.fn(async (_sessionId: string, navigation: { action: string }) => (
      navigation.action === "refresh" ? refreshed : home
    ))
    const onFolderView = vi.fn(async () => undefined)
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const renderCard = (folderView: ReaderFolderViewConfig) => (
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/current" onOpen={vi.fn()} onGoTo={vi.fn()} folderView={folderView} onFolderView={onFolderView} />
      </VirtuosoMockContext.Provider>
    )
    const view = render(renderCard(folderViewConfig({ homePath: "C:/home" })))
    const ui = within(view.container)
    const homeButton = await ui.findByRole("button", { name: "主页（单击返回主页，右键设置当前路径为主页）" })

    fireEvent.contextMenu(homeButton)
    await waitFor(() => expect(onFolderView).toHaveBeenCalledWith({ homePath: "C:/current" }))
    view.rerender(renderCard(folderViewConfig({ homePath: "C:/current" })))
    onFolderView.mockClear()
    fireEvent.contextMenu(ui.getByRole("button", { name: "主页（单击返回主页，右键设置当前路径为主页）" }))
    expect(onFolderView).not.toHaveBeenCalled()

    view.rerender(renderCard(folderViewConfig({ homePath: "C:/home" })))
    fireEvent.click(ui.getByTitle("C:/current/book.cbz"), { ctrlKey: true })
    fireEvent.click(ui.getByRole("button", { name: "刷新" }))
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith("browser-1", { action: "refresh" }, expect.any(AbortSignal), "C:/current/book.cbz"))
    await waitFor(() => expect(ui.getByTitle("C:/current/book.cbz").getAttribute("aria-selected")).toBe("true"))

    fireEvent.click(ui.getByRole("button", { name: "主页（单击返回主页，右键设置当前路径为主页）" }))
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith("browser-1", { action: "path", path: "C:/home" }, expect.any(AbortSignal), "C:/current/book.cbz"))
    expect(ui.queryByRole("tree")).toBeNull()
  })

  it("[neoview.browser.restore-index] requests the sparse page containing the parent selection", async () => {
    const opened = page({ path: "C:/books", parentPath: "C:/" })
    const parent = page({
      navigationEntryId: 2,
      path: "C:/",
      parentPath: undefined,
      generation: 2,
      total: 1_000,
      suggestedSelection: { path: "C:/books", index: 900 },
    })
    const listDirectoryBrowser = vi.fn(async () => page({
      ...parent,
      cursor: 896,
      entries: [
        ...Array.from({ length: 4 }, (_, index) => ({
          name: `before-${index}`,
          path: `C:/before-${index}`,
          kind: "directory" as const,
          readerSupported: true,
        })),
        { name: "books", path: "C:/books", kind: "directory", readerSupported: true },
      ],
    }))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser: vi.fn(async () => parent),
      listDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    await waitFor(() => expect((screen.getByRole("button", { name: "上级" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole("button", { name: "上级" }))
    await waitFor(() => expect(listDirectoryBrowser).toHaveBeenCalledWith("browser-1", 896, 128, expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByRole("listbox", { name: "文件项目" }).getAttribute("data-focused-index")).toBe("900"))
    expect(document.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1")
  })

  it("[neoview.folder.nav-history-ui] [neoview.folder.restore-focus-ui] restores state by visit and relocates moved focus", async () => {
    const entries = (path: string) => Array.from({ length: 4 }, (_, index) => ({
      name: `item-${index}.cbz`,
      path: `${path}/item-${index}.cbz`,
      kind: "file" as const,
      readerSupported: true,
    }))
    const firstA = page({ navigationEntryId: 1, path: "C:/A", entries: entries("C:/A"), total: 4 })
    const b = page({ navigationEntryId: 2, path: "C:/B", entries: entries("C:/B"), total: 4, generation: 2, canGoBack: true })
    const secondA = page({ navigationEntryId: 3, path: "C:/A", entries: entries("C:/A"), total: 4, generation: 3, canGoBack: true })
    let backCount = 0
    const navigateDirectoryBrowser = vi.fn(async (_sessionId: string, navigation: { action: string; path?: string }) => {
      const normalizedPath = navigation.path?.replaceAll("\\", "/")
      if (navigation.action === "path" && normalizedPath === "C:/B") return b
      if (navigation.action === "path" && normalizedPath === "C:/A") return secondA
      if (navigation.action === "back") {
        backCount += 1
        return backCount === 1
          ? { ...b, generation: 4, canGoForward: true }
          : {
              ...firstA,
              entries: [
                { name: "item-before.cbz", path: "C:/A/item-before.cbz", kind: "file" as const, readerSupported: true },
                ...firstA.entries,
              ],
              total: 5,
              generation: 5,
              canGoForward: true,
              suggestedSelection: { path: "C:/A/item-1.cbz", index: 2 },
            }
      }
      throw new Error(`unexpected navigation ${JSON.stringify(navigation)}`)
    })
    const client = {
      openDirectoryBrowser: vi.fn(async () => firstA),
      navigateDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <VirtuosoGridMockContext.Provider value={{ viewportHeight: 288, viewportWidth: 400, itemHeight: 144, itemWidth: 112 }}>
          <FolderMainCard client={client} disabled={false} sourcePath="C:/A" onOpen={vi.fn()} onGoTo={vi.fn()} />
        </VirtuosoGridMockContext.Provider>
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)
    const currentItem = (path: string, index: number) => ui.getByTitle(`${path}/item-${index}.cbz`)
    const currentPath = () => view.container
      .querySelector('[data-neoview-folder-breadcrumb="true"] [aria-current="page"]')
      ?.getAttribute("title")
      ?.replaceAll("\\", "/")
    const navigatePath = async (path: string) => {
      const breadcrumb = view.container.querySelector('[data-neoview-folder-breadcrumb="true"]')!
      fireEvent.click(breadcrumb.querySelector("button[aria-label]")!)
      const input = await within(breadcrumb as HTMLElement).findByRole("textbox")
      fireEvent.change(input, { target: { value: path } })
      fireEvent.submit(input.closest("form")!)
      await waitFor(() => expect(currentPath()).toBe(path))
    }

    await waitFor(() => expect(currentItem("C:/A", 1)).toBeTruthy())
    fireEvent.click(currentItem("C:/A", 1), { ctrlKey: true })
    selectFolderViewMode(ui, "封面网格")
    await waitFor(() => expect(currentItem("C:/A", 1).getAttribute("data-preview-mode")).toBe("cover-grid"))

    await navigatePath("C:/B")
    await navigatePath("C:/A")
    selectFolderViewMode(ui, "紧凑列表")
    fireEvent.click(currentItem("C:/A", 3), { ctrlKey: true })
    expect(currentItem("C:/A", 3).getAttribute("aria-selected")).toBe("true")

    fireEvent.click(view.container.querySelector("svg.lucide-arrow-left")!.closest("button")!)
    await waitFor(() => expect(currentPath()).toBe("C:/B"))
    fireEvent.click(view.container.querySelector("svg.lucide-arrow-left")!.closest("button")!)
    await waitFor(() => expect(currentPath()).toBe("C:/A"))
    await waitFor(() => expect(currentItem("C:/A", 1).getAttribute("data-preview-mode")).toBe("cover-grid"))
    expect(currentItem("C:/A", 1).getAttribute("aria-selected")).toBe("true")
    expect(currentItem("C:/A", 3).getAttribute("aria-selected")).toBe("false")
    expect(ui.getByRole("listbox", { name: "文件项目" }).getAttribute("data-focused-index")).toBe("2")
    expect(navigateDirectoryBrowser.mock.calls.some((call) => call[3] === "C:/A/item-1.cbz")).toBe(true)
  })

  it("[neoview.folder.watch-gui] applies external changes without losing path selection and aborts the next wait on unmount", async () => {
    const opened = page({
      watching: true,
      total: 1,
      entries: [{ name: "a.cbz", path: "C:/books/a.cbz", kind: "file", readerSupported: true }],
    })
    const waits: Array<{ resolve(page: ReaderDirectoryPageDto): void; signal: AbortSignal }> = []
    const watchDirectoryBrowser = vi.fn((_sessionId: string, _generation: number, _focusPath?: string, signal?: AbortSignal) => (
      new Promise<ReaderDirectoryPageDto>((resolve) => waits.push({ resolve, signal: signal! }))
    ))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      watchDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)
    await waitFor(() => expect(ui.getByTitle("C:/books/a.cbz")).toBeTruthy())
    fireEvent.click(ui.getByTitle("C:/books/a.cbz"), { ctrlKey: true })
    await waitFor(() => expect(waits).toHaveLength(1))

    await act(async () => waits[0]!.resolve(page({
      watching: true,
      generation: 2,
      total: 2,
      entries: [
        { name: "a.cbz", path: "C:/books/a.cbz", kind: "file", readerSupported: true },
        { name: "b.cbz", path: "C:/books/b.cbz", kind: "file", readerSupported: true },
      ],
      suggestedSelection: { path: "C:/books/a.cbz", index: 0 },
    })))
    await waitFor(() => expect(ui.getByTitle("C:/books/b.cbz")).toBeTruthy())
    expect(ui.getByTitle("C:/books/a.cbz").getAttribute("aria-selected")).toBe("true")
    await waitFor(() => expect(waits).toHaveLength(2))
    view.unmount()
    expect(waits[1]!.signal.aborted).toBe(true)
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
    await waitFor(() => expect(currentView.getByRole("button", { name: "文件操作手柄" })).toBeTruthy())
    selectFolderViewMode(currentView, "封面网格")
    await waitFor(() => expect(registerLibraryThumbnails).toHaveBeenCalled())
    const [contextId, generation, items] = registerLibraryThumbnails.mock.calls.at(-1)!
    expect(contextId).toMatch(/^folder:browser-1:\d+$/)
    expect(generation).toBeGreaterThan(0)
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(64)
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "0", path: "C:/books/folder", kind: "folder", previewCount: 1 })]))
    selectFolderViewMode(currentView, "多图网格")
    await waitFor(() => expect(registerLibraryThumbnails.mock.calls.at(-1)?.[2]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "0", kind: "folder", previewCount: 4 }),
      expect.objectContaining({ id: "1", kind: "file", previewCount: 1 }),
    ])))
    expect(currentView.getByLabelText("多图数量")).toBeTruthy()
    await waitFor(() => expect(view.container.querySelectorAll('[data-preview-mode="mosaic-grid"] img')).toHaveLength(2))
    const registeredBeforeLeavingThumbnailView = registerLibraryThumbnails.mock.calls.length
    selectFolderViewMode(currentView, "紧凑列表")
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-thumbnail-cache-size")).toBe("2")
    expect(releaseLibraryThumbnailContext).not.toHaveBeenCalled()
    registerLibraryThumbnails.mockImplementationOnce(() => new Promise(() => undefined))
    selectFolderViewMode(currentView, "多图网格")
    await waitFor(() => expect(view.container.querySelectorAll('[data-preview-mode="mosaic-grid"] img')).toHaveLength(2))
    expect(registerLibraryThumbnails).toHaveBeenCalledTimes(registeredBeforeLeavingThumbnailView)
    view.unmount()
    expect(releaseLibraryThumbnailContext).toHaveBeenCalledOnce()
    expect(releaseLibraryThumbnailContext).toHaveBeenCalledWith(contextId)
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-1")
  })

  it("[neoview.folder.nav-thumbnail-identity] restores back/forward thumbnails without a second registration", async () => {
    const entries = (path: string) => [
      { name: "folder", path: `${path}/folder`, kind: "directory" as const, readerSupported: true },
      { name: "book.cbz", path: `${path}/book.cbz`, kind: "file" as const, readerSupported: true },
    ]
    const opened = page({ path: "C:/A", entries: entries("C:/A"), total: 2 })
    const second = page({ path: "C:/B", entries: entries("C:/B"), total: 2, navigationEntryId: 2, generation: 2, canGoBack: true })
    const returned = page({ path: "C:/A", entries: entries("C:/A"), total: 2, navigationEntryId: 1, generation: 3, canGoForward: true })
    const navigateDirectoryBrowser = vi.fn(async (_sessionId: string, navigation: { action: string; path?: string }) => {
      if (navigation.action === "path") return second
      if (navigation.action === "back") return returned
      throw new Error(`unexpected navigation ${JSON.stringify(navigation)}`)
    })
    const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number, items: readonly { id: string; path: string }[]) => ({
      contextId,
      generation,
      items: items.map((item) => ({ id: item.id, thumbnailUrl: `http://thumb.test/${encodeURIComponent(item.path)}`, contentVersion: item.path })),
    }))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      registerLibraryThumbnails,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <VirtuosoGridMockContext.Provider value={{ viewportHeight: 288, viewportWidth: 400, itemHeight: 144, itemWidth: 112 }}>
          <FolderMainCard client={client} disabled={false} sourcePath="C:/A" onOpen={vi.fn()} onGoTo={vi.fn()} />
        </VirtuosoGridMockContext.Provider>
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)
    await ui.findByTitle("C:/A/folder")
    selectFolderViewMode(ui, "封面网格")
    await waitFor(() => expect(ui.getByTitle("C:/A/folder").querySelector("img")?.getAttribute("src")).toBe("http://thumb.test/C%3A%2FA%2Ffolder"))
    const registrationsBeforeNavigation = registerLibraryThumbnails.mock.calls.length

    const breadcrumb = view.container.querySelector('[data-neoview-folder-breadcrumb="true"]')!
    fireEvent.click(breadcrumb.querySelector("button[aria-label]")!)
    const input = await within(breadcrumb as HTMLElement).findByRole("textbox")
    fireEvent.change(input, { target: { value: "C:/B" } })
    fireEvent.submit(input.closest("form")!)
    await waitFor(() => expect(view.container.querySelector('[data-neoview-folder-breadcrumb="true"] [aria-current="page"]')?.getAttribute("title")).toBe("C:\\B"))

    fireEvent.click(view.container.querySelector("svg.lucide-arrow-left")!.closest("button")!)
    await waitFor(() => expect(view.container.querySelector('[data-neoview-folder-breadcrumb="true"] [aria-current="page"]')?.getAttribute("title")).toBe("C:\\A"))
    await waitFor(() => expect(ui.getByTitle("C:/A/folder").querySelector("img")?.getAttribute("src")).toBe("http://thumb.test/C%3A%2FA%2Ffolder"))
    expect(registerLibraryThumbnails).toHaveBeenCalledTimes(registrationsBeforeNavigation + 1)
    view.unmount()
  })

  it("[neoview.folder.thumbnail-refresh-ui] refreshes only visible thumbnails through the action handle", async () => {
    const opened = page({
      entries: [
        { name: "folder", path: "C:/books/folder", kind: "directory", readerSupported: true },
        { name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true },
      ],
      total: 2,
    })
    const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number, items: readonly { id: string; path: string }[]) => ({
      contextId,
      generation,
      items: items.map((item) => ({ id: item.id, thumbnailUrl: `http://thumb.test/${encodeURIComponent(item.path)}`, contentVersion: item.path })),
    }))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      registerLibraryThumbnails,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <VirtuosoGridMockContext.Provider value={{ viewportHeight: 288, viewportWidth: 400, itemHeight: 144, itemWidth: 112 }}>
          <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
        </VirtuosoGridMockContext.Provider>
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)
    await ui.findByTitle("C:/books/folder")
    selectFolderViewMode(ui, "\u5c01\u9762\u7f51\u683c")
    await waitFor(() => expect(registerLibraryThumbnails).toHaveBeenCalledOnce())
    const before = registerLibraryThumbnails.mock.calls.length

    selectFolderHandleAction(ui, "\u91cd\u8f7d\u7f29\u7565\u56fe")
    await waitFor(() => expect(registerLibraryThumbnails.mock.calls.length).toBe(before + 1))
    expect(registerLibraryThumbnails.mock.calls.at(-1)?.[2]).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "C:/books/folder", refresh: true }),
      expect.objectContaining({ path: "C:/books/book.cbz", refresh: true }),
    ]))
    view.unmount()
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

    selectFolderViewMode(currentView, "封面网格")
    await waitFor(() => expect(item(1).getAttribute("data-preview-mode")).toBe("cover-grid"))
    expect(item(1).getAttribute("aria-selected")).toBe("true")
    expect(item(2).getAttribute("aria-selected")).toBe("false")
    expect(item(3).getAttribute("aria-selected")).toBe("true")

    selectFolderHandleAction(currentView, "多选模式")
    await waitFor(() => expect(view.container.querySelector('[data-neoview-folder-selection-bar="true"]')).toBeTruthy())
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
    expect(currentView.getByLabelText("链接选中模式").getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(item(0))
    fireEvent.click(item(3))
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("4")
    fireEvent.click(currentView.getByLabelText("关闭多选模式"))
    expect(view.container.querySelector('[data-neoview-folder-selection-bar="true"]')).toBeNull()

    view.unmount()
  })

  it("[neoview.folder.keyboard-trash] confirms Delete for the focused loaded item only", async () => {
    const opened = page({
      total: 2,
      entries: [
        { name: "first.cbz", path: "C:/books/first.cbz", kind: "file", readerSupported: true },
        { name: "second.cbz", path: "C:/books/second.cbz", kind: "file", readerSupported: true },
      ],
    })
    const refreshed = page({
      generation: 2,
      total: 1,
      entries: [{ name: "first.cbz", path: "C:/books/first.cbz", kind: "file", readerSupported: true }],
    })
    const executeFileOperations = vi.fn(async () => ({
      results: [{ index: 0, operation: { kind: "trash" as const, sourcePath: "C:/books/second.cbz" }, status: "succeeded" as const }],
      succeeded: 1, failed: 0, cancelled: 0, undoable: 0,
    }))
    const navigateDirectoryBrowser = vi.fn(async () => refreshed)
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      executeFileOperations,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const user = userEvent.setup()
    const view = render(
      <ContextMenuProvider>
        <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
          <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
        </VirtuosoMockContext.Provider>
      </ContextMenuProvider>,
    )
    const ui = within(view.container)
    const host = await ui.findByRole("listbox", { name: "文件项目" })
    fireEvent.keyDown(host, { key: "ArrowDown" })
    expect(host.getAttribute("data-focused-index")).toBe("1")
    fireEvent.keyDown(host, { key: "Delete" })

    const confirmation = await screen.findByRole("alertdialog")
    expect(confirmation.textContent).toContain("second.cbz")
    expect(executeFileOperations).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole("button", { name: "移到回收站" }))
    await waitFor(() => expect(executeFileOperations).toHaveBeenCalledWith(
      [{ kind: "trash", sourcePath: "C:/books/second.cbz" }],
      true,
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1",
      { action: "refresh" },
      expect.any(AbortSignal),
      "C:/books/second.cbz",
    ))
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

  it("[neoview.folder.selection-focus-identity] keeps selection separate while hydrating a sparse focused path", async () => {
    const total = 100_000
    const entriesAt = (cursor: number, count: number) => Array.from({ length: Math.min(count, total - cursor) }, (_, offset) => {
      const index = cursor + offset
      return {
        name: `item-${index}.cbz`,
        path: `C:/books/item-${index}.cbz`,
        kind: "file" as const,
        readerSupported: true,
      }
    })
    const opened = page({ total, entries: entriesAt(0, 128) })
    const listDirectoryBrowser = vi.fn(async (_sessionId: string, cursor: number, limit: number) => page({
      ...opened,
      cursor,
      entries: entriesAt(cursor, limit),
    }))
    const sortDirectoryBrowser = vi.fn(async () => opened)
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      listDirectoryBrowser,
      sortDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    const host = await currentView.findByRole("listbox", { name: "文件项目" })
    const first = await currentView.findByTitle("C:/books/item-0.cbz")

    fireEvent.click(first, { ctrlKey: true })
    fireEvent.keyDown(host, { key: "End", ctrlKey: true })
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1")
    expect(host.getAttribute("data-focused-index")).toBe("99999")
    fireEvent.keyDown(host, { key: "Delete" })
    expect(screen.queryByRole("alertdialog")).toBeNull()

    await waitFor(() => expect(listDirectoryBrowser.mock.calls.some((call) => call[1] > 99_000)).toBe(true))

    fireEvent.keyDown(host, { key: "Home", ctrlKey: true })
    const restoredFirst = await currentView.findByTitle("C:/books/item-0.cbz")
    expect(restoredFirst.getAttribute("aria-selected")).toBe("true")
    expect(restoredFirst.getAttribute("data-focused")).toBe("true")
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1")

    fireEvent.keyDown(host, { key: "End", shiftKey: true })
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("100000")
    selectFolderHandleAction(currentView, "排序")
    fireEvent.click(currentView.getByRole("button", { name: "升序" }))
    await waitFor(() => expect(sortDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1",
      { field: "name", order: "desc", directoriesFirst: true },
      "C:/books/item-99999.cbz",
      expect.any(AbortSignal),
    ))
    view.unmount()
  })

  it("[neoview.folder.search-shortcut] opens and focuses shared search without leaking directory shortcuts into its input", async () => {
    const opened = page({
      total: 1,
      entries: [{ name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true }],
    })
    const navigateDirectoryBrowser = vi.fn(async () => opened)
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      searchDirectoryBrowser: vi.fn(async () => ({
        sessionId: "browser-1",
        rootPath: "C:/books",
        generation: 1,
        query: "book",
        mode: "text" as const,
        entries: [],
        scanned: 1,
        matched: 0,
        truncated: false,
      })),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    const host = await currentView.findByRole("listbox", { name: "文件项目" })

    fireEvent.keyDown(host, { key: "f", ctrlKey: true })
    const searchInput = await currentView.findByRole("textbox", { name: "搜索文件" })
    await waitFor(() => expect(document.activeElement).toBe(searchInput))
    fireEvent.keyDown(searchInput, { key: "Backspace" })
    fireEvent.keyDown(searchInput, { key: "Delete" })
    fireEvent.keyDown(searchInput, { key: "F5" })
    expect(navigateDirectoryBrowser).not.toHaveBeenCalled()
    expect(screen.queryByRole("alertdialog")).toBeNull()

    fireEvent.change(searchInput, { target: { value: "book" } })
    fireEvent.submit(searchInput.closest("form")!)
    await waitFor(() => expect(client.searchDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1",
      "book",
      expect.objectContaining({ maximumDepth: undefined, maximumResults: 512 }),
      expect.any(AbortSignal),
    ))
  })

  it("[neoview.folder.path-navigation] keeps the current directory on failure and routes Explorer shortcuts outside editors", async () => {
    const opened = page({ path: "C:\\books\\series", parentPath: "C:\\books", canGoBack: true, canGoForward: true })
    const navigateDirectoryBrowser = vi.fn(async (_sessionId: string, navigation: { action: string }) => {
      if (navigation.action === "path") throw new Error("目录不存在")
      return opened
    })
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:\\books\\series" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)
    await waitFor(() => expect(ui.getByRole("button", { name: "series" }).getAttribute("aria-current")).toBe("page"))

    fireEvent.click(ui.getByRole("button", { name: "编辑路径" }))
    const input = ui.getByRole("textbox", { name: "浏览路径" })
    fireEvent.change(input, { target: { value: "Z:\\missing" } })
    fireEvent.submit(input.closest("form")!)
    await waitFor(() => expect(ui.getByRole("alert").textContent).toContain("目录不存在"))
    expect(ui.getByRole("button", { name: "series" }).getAttribute("aria-current")).toBe("page")

    navigateDirectoryBrowser.mockClear()
    const breadcrumb = view.container.querySelector('[data-neoview-folder-breadcrumb="true"]')!
    const editButton = () => ui.getByRole("button", { name: "编辑路径" }) as HTMLButtonElement
    async function pressShortcut(key: string, altKey: boolean, expectedCalls: number) {
      fireEvent.keyDown(breadcrumb, { key, altKey })
      await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledTimes(expectedCalls))
      await waitFor(() => expect(editButton().disabled).toBe(false))
    }
    await pressShortcut("ArrowLeft", true, 1)
    await pressShortcut("ArrowRight", true, 2)
    await pressShortcut("ArrowUp", true, 3)
    await pressShortcut("F5", false, 4)
    expect(navigateDirectoryBrowser.mock.calls.map((call) => call[1])).toEqual([
      { action: "back" }, { action: "forward" }, { action: "up" }, { action: "refresh" },
    ])

    navigateDirectoryBrowser.mockClear()
    fireEvent.click(ui.getByRole("button", { name: "编辑路径" }))
    const editingInput = ui.getByRole("textbox", { name: "浏览路径" })
    fireEvent.keyDown(editingInput, { key: "ArrowLeft", altKey: true })
    fireEvent.keyDown(editingInput, { key: "F5" })
    expect(navigateDirectoryBrowser).not.toHaveBeenCalled()
  })

  it("[neoview.folder.tree-card] keeps the tree independent from the current-directory list and search", async () => {
    const opened = page({
      path: "C:\\books",
      total: 2,
      entries: [
        { name: "series", path: "C:\\books\\series", kind: "directory", readerSupported: false },
        { name: "book.cbz", path: "C:\\books\\book.cbz", kind: "file", readerSupported: true },
      ],
    })
    const navigated = page({ ...opened, path: "C:\\books\\series", generation: 2, entries: [], total: 0 })
    const navigateDirectoryBrowser = vi.fn(async () => navigated)
    const treeDirectoryBrowser = vi.fn(async (_sessionId: string, path?: string) => ({
      sessionId: "browser-1",
      path: path ?? "C:\\books",
      entries: path === "C:\\" ? [{ name: "books", path: "C:\\books", kind: "directory" as const, readerSupported: false }] : path === "C:\\books" ? opened.entries : [],
      generation: 1,
      cacheHit: false,
      excludedPaths: [],
    }))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      treeDirectoryBrowser,
      searchDirectoryBrowser: vi.fn(async () => ({
        sessionId: "browser-1", rootPath: "C:\\books", generation: 1, query: "", mode: "text" as const,
        entries: [], scanned: 0, matched: 0, truncated: false,
      })),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 30 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:\\books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    const list = await currentView.findByRole("listbox", { name: "文件项目" })
    fireEvent.click(await currentView.findByTitle("C:\\books\\book.cbz"), { ctrlKey: true })
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1")
    await currentView.findByRole("button", { name: "文件操作手柄" })
    selectFolderHandleAction(currentView, "文件树")
    await waitFor(() => expect(view.container.querySelector('[data-neoview-folder-tree="true"]')).toBeTruthy())
    expect(list.isConnected).toBe(true)
    expect(within(list).getByTitle("C:\\books\\book.cbz")).toBeTruthy()
    const tree = currentView.getByRole("tree", { name: "文件树" })
    fireEvent.focus(tree)
    fireEvent.keyDown(tree, { key: "ArrowDown" })
    expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-count")).toBe("1")
    fireEvent.click(await within(tree).findByTitle("C:\\books\\series"))
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1", { action: "path", path: "C:\\books\\series" }, expect.any(AbortSignal), "C:\\books\\book.cbz",
    ))
    expect(view.container.querySelector('[data-neoview-folder-tree="true"]')).toBeTruthy()

    fireEvent.keyDown(currentView.getByRole("tree", { name: "文件树" }), { key: "f", ctrlKey: true })
    await waitFor(() => expect(currentView.getByRole("textbox", { name: "搜索文件" })).toBeTruthy())
    expect(view.container.querySelector('[data-neoview-folder-tree="true"]')).toBeTruthy()
  })

  it("[neoview.folder.tree-layout] persists visibility, direction and one settled tree size", async () => {
    const opened = page({ path: "C:\\books", total: 0, entries: [] })
    const onFolderView = vi.fn(async () => undefined)
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      treeDirectoryBrowser: vi.fn(async (_sessionId: string, path?: string) => ({
        sessionId: "browser-1", path: path ?? "C:\\", entries: [], generation: 1, cacheHit: false, excludedPaths: [],
      })),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 30 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:\\books" onOpen={vi.fn()} onGoTo={vi.fn()} onFolderView={onFolderView} />
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)

    await ui.findByRole("button", { name: "文件操作手柄" })
    selectFolderHandleAction(ui, "文件树")
    await waitFor(() => expect(onFolderView).toHaveBeenLastCalledWith({ tree: { visible: true } }))
    for (const [name, layout] of [["文件树位于右侧", "right"], ["文件树位于底部", "bottom"], ["文件树位于左侧", "left"], ["文件树位于顶部", "top"]] as const) {
      fireEvent.click(ui.getByRole("radio", { name }))
      await waitFor(() => expect(onFolderView).toHaveBeenLastCalledWith({ tree: { layout } }))
    }
    const browser = view.container.querySelector('[data-neoview-folder-tree-pane="true"]')?.parentElement as HTMLElement
    expect(browser.getAttribute("data-tree-layout")).toBe("top")

    onFolderView.mockClear()
    const handle = ui.getByRole("separator", { name: "调整文件树大小" })
    fireEvent.pointerDown(handle, { pointerId: 9, clientY: 100 })
    for (let offset = 1; offset <= 40; offset += 1) fireEvent.pointerMove(handle, { pointerId: 9, clientY: 100 + offset })
    expect(onFolderView).not.toHaveBeenCalled()
    fireEvent.pointerUp(handle, { pointerId: 9, clientY: 140 })
    await waitFor(() => expect(onFolderView).toHaveBeenCalledTimes(1))
    expect(onFolderView).toHaveBeenCalledWith({ tree: { size: 240 } })

    onFolderView.mockClear()
    fireEvent.pointerDown(handle, { pointerId: 10, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 10, clientY: 180 })
    fireEvent.pointerCancel(handle, { pointerId: 10 })
    expect(onFolderView).not.toHaveBeenCalled()
    expect(browser.style.getPropertyValue("--folder-tree-size")).toBe("240px")

    fireEvent.keyDown(handle, { key: "ArrowDown" })
    await waitFor(() => expect(onFolderView).toHaveBeenCalledWith({ tree: { size: 250 } }))
    expect(handle.getAttribute("aria-valuenow")).toBe("250")
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
    await currentView.findByRole("button", { name: "文件操作手柄" })
    selectFolderHandleAction(currentView, "排序")
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

  it("[neoview.folder.sort-folder-size-ui] hydrates visible directory sizes and reissues the same sort without reopening the card", async () => {
    const folderA = { name: "large", path: "C:/books/large", kind: "directory" as const, readerSupported: true }
    const folderB = { name: "small", path: "C:/books/small", kind: "directory" as const, readerSupported: true }
    const file = { name: "book.cbz", path: "C:/books/book.cbz", kind: "file" as const, readerSupported: true }
    const opened = page({ entries: [folderA, folderB, file], total: 3 })
    const firstSort = page({ ...opened, generation: 2, sort: { field: "size", order: "asc", directoriesFirst: true }, entries: [folderA, folderB, file], total: 3 })
    const hydratedSort = page({ ...firstSort, generation: 3, entries: [folderB, folderA, file] })
    const sortDirectoryBrowser = vi.fn()
      .mockResolvedValueOnce(firstSort)
      .mockResolvedValueOnce(hydratedSort)
    const directorySizes = vi.fn(async () => ({
      sessionId: "browser-1",
      generation: 2,
      results: [
        { path: folderA.path, status: "ok" as const, bytes: 900, fileCount: 9 },
        { path: folderB.path, status: "ok" as const, bytes: 10, fileCount: 1 },
      ],
    }))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      sortDirectoryBrowser,
      directorySizes,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    await currentView.findByTitle("C:/books/large")
    selectFolderHandleAction(currentView, "\u6392\u5e8f")
    fireEvent.click(await currentView.findByRole("combobox", { name: "\u6392\u5e8f\u5b57\u6bb5" }))
    fireEvent.click(await screen.findByRole("option", { name: "\u5927\u5c0f" }))

    await waitFor(() => expect(directorySizes).toHaveBeenCalledWith(
      "browser-1",
      2,
      [folderA.path, folderB.path],
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(sortDirectoryBrowser).toHaveBeenCalledTimes(2))
    expect(sortDirectoryBrowser.mock.calls[1]).toEqual([
      "browser-1",
      { field: "size", order: "asc", directoriesFirst: true },
      undefined,
      expect.any(AbortSignal),
    ])
    await waitFor(() => expect(currentView.getByTitle("C:/books/small")).toBeTruthy())
    view.unmount()
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
    await waitFor(() => expect(currentView.getByRole("button", { name: "文件操作手柄" })).toBeTruthy())
    expect(view.container.querySelector('[data-table-engine="niko-sparse"]')).toBeNull()
    selectFolderViewMode(currentView, "详细信息")
    await waitFor(() => expect(view.container.querySelector('[data-table-engine="niko-sparse"]')).toBeTruthy(), { timeout: 5_000 })
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
            homePath: "",
            viewMode: "details",
            previewCount: 9,
            thumbnailWidthPercent: 20,
            bannerWidthPercent: 50,
            details: {
              columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
              hiddenColumns: ["tags"],
              pinnedLeft: ["name"],
              pinnedRight: ["rating"],
              columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
            },
            search: { includeSubfolders: true, showHistoryOnFocus: true, searchInPath: false },
            tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] },
          }}
          onFolderView={onFolderView}
        />
      </VirtuosoMockContext.Provider>,
    )
    const currentView = within(view.container)
    await waitFor(() => expect(currentView.getByRole("button", { name: "文件操作手柄" })).toBeTruthy())
    expect(view.container.querySelector('[data-table-engine="niko-sparse"]')).toBeTruthy()
    selectFolderViewMode(currentView, "封面列表")
    await waitFor(() => expect(onFolderView).toHaveBeenCalledTimes(1))
    expect(onFolderView).toHaveBeenCalledWith({ viewMode: "cover-list" })
  })

  it("[neoview.folder.view-size] reflows thumbnail and banner grids while committing only settled widths", async () => {
    const onFolderView = vi.fn(async () => undefined)
    const opened = page({
      total: 1,
      entries: [{ name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true }],
    })
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 144 }}>
        <VirtuosoGridMockContext.Provider value={{ viewportHeight: 288, viewportWidth: 400, itemHeight: 144, itemWidth: 112 }}>
          <FolderMainCard
            client={client}
            disabled={false}
            sourcePath="C:/books"
            onOpen={vi.fn()}
            onGoTo={vi.fn()}
            folderView={{
              homePath: "",
              viewMode: "cover-grid",
              previewCount: 4,
              thumbnailWidthPercent: 20,
              bannerWidthPercent: 50,
              details: {
                columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
                hiddenColumns: [], pinnedLeft: ["name"], pinnedRight: [], columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
              },
              search: { includeSubfolders: true, showHistoryOnFocus: true, searchInPath: false },
              tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] },
            }}
            onFolderView={onFolderView}
          />
        </VirtuosoGridMockContext.Provider>
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)
    const host = await ui.findByRole("listbox", { name: "文件项目" })
    selectFolderHandleAction(ui, "项目尺寸")
    const thumbnailSlider = ui.getByRole("slider", { name: "缩略图宽度" })
    expect(thumbnailSlider.getAttribute("aria-valuenow")).toBe("20")
    expect((host as HTMLElement).style.getPropertyValue("--folder-grid-width")).toBe("20%")

    fireEvent.keyDown(thumbnailSlider, { key: "ArrowRight" })
    expect((host as HTMLElement).style.getPropertyValue("--folder-grid-width")).toBe("21%")
    await waitFor(() => expect(onFolderView).toHaveBeenCalledWith({ thumbnailWidthPercent: 21 }))
    fireEvent.keyUp(thumbnailSlider, { key: "ArrowRight" })
    expect(onFolderView).toHaveBeenCalledTimes(1)

    onFolderView.mockClear()
    selectFolderViewMode(ui, "多图列表")
    selectFolderHandleAction(ui, "项目尺寸")
    await waitFor(() => expect(ui.getByRole("slider", { name: "横幅宽度" }).getAttribute("aria-valuenow")).toBe("50"))
    expect((host as HTMLElement).style.getPropertyValue("--folder-grid-width")).toBe("50%")
    expect(view.container.querySelector('[data-preview-mode="mosaic-list"]')).toBeTruthy()
  })

  it("[neoview.folder.filter-ui] filters the current directory through the existing browser session", async () => {
    const opened = page({
      total: 3,
      filter: "all",
      filterOptions: ["all", "archive", "directory", "video"],
      entries: [
        { name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true },
        { name: "folder", path: "C:/books/folder", kind: "directory", readerSupported: true },
        { name: "clip.mp4", path: "C:/books/clip.mp4", kind: "file", readerSupported: true },
      ],
    })
    const filtered = page({
      generation: 2,
      total: 1,
      filter: "archive",
      filterOptions: ["all", "archive", "directory", "video"],
      entries: [{ name: "book.cbz", path: "C:/books/book.cbz", kind: "file", readerSupported: true }],
    })
    const openDirectoryBrowser = vi.fn(async () => opened)
    const filterDirectoryBrowser = vi.fn(async () => filtered)
    const client = {
      openDirectoryBrowser,
      filterDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)

    await ui.findByTitle("C:/books/clip.mp4")
    selectFolderHandleAction(ui, "类型筛选")
    fireEvent.click(await ui.findByRole("button", { name: "压缩包" }))

    await waitFor(() => expect(filterDirectoryBrowser).toHaveBeenCalledWith(
      "browser-1",
      "archive",
      undefined,
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(view.container.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-total")).toBe("1"))
    expect(ui.getByRole("button", { name: "压缩包" }).getAttribute("aria-pressed")).toBe("true")
    expect(ui.getByTitle("C:/books/book.cbz")).toBeTruthy()
    expect(ui.queryByTitle("C:/books/clip.mp4")).toBeNull()
    expect(openDirectoryBrowser).toHaveBeenCalledTimes(1)
  })

  it("[neoview.folder.blank-action-ui] gives a double-click precedence over the pending single-click action", async () => {
    const opened = page({
      path: "C:/books/child",
      parentPath: "C:/books",
      canGoBack: true,
      total: 1,
      entries: [{ name: "book.cbz", path: "C:/books/child/book.cbz", kind: "file", readerSupported: true }],
    })
    const navigateDirectoryBrowser = vi.fn(async (_sessionId, navigation) => page({
      navigationEntryId: 2,
      generation: 2,
      path: navigation.action === "up" ? "C:/books" : "C:/previous",
      parentPath: "C:/",
    }))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books/child"
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
          folderView={folderViewConfig({ emptyArea: { singleClickAction: "goBack", doubleClickAction: "goUp", showBackButton: false } })}
        />
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)
    const host = await ui.findByRole("listbox", { name: "文件项目" })

    selectFolderHandleAction(ui, "更多操作")
    fireEvent.pointerDown(ui.getByRole("button", { name: "空白区域操作" }))
    expect(await screen.findByText("显示底部返回按钮")).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })

    fireEvent.click(host)
    fireEvent.doubleClick(host)
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith("browser-1", { action: "up" }, expect.any(AbortSignal), undefined))
    await act(() => new Promise((resolve) => setTimeout(resolve, 260)))
    expect(navigateDirectoryBrowser).toHaveBeenCalledTimes(1)
  })

  it("[neoview.folder.bottom-return-ui] renders a footer outside entry indexes in list and details views", async () => {
    const opened = page({
      path: "C:/books/child",
      parentPath: "C:/books",
      canGoBack: true,
      total: 1,
      entries: [{ name: "book.cbz", path: "C:/books/child/book.cbz", kind: "file", readerSupported: true }],
    })
    const navigateDirectoryBrowser = vi.fn(async () => page({ navigationEntryId: 2, generation: 2, path: "C:/books", parentPath: "C:/" }))
    const client = {
      openDirectoryBrowser: vi.fn(async () => opened),
      navigateDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books/child"
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
          folderView={folderViewConfig({ emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: true } })}
        />
      </VirtuosoMockContext.Provider>,
    )
    const ui = within(view.container)
    const folderCard = view.container.querySelector('[data-neoview-folder-card="true"]')
    await ui.findByRole("button", { name: "返回上级目录" })
    expect(folderCard?.getAttribute("data-selection-total")).toBe("1")
    expect(ui.getAllByTitle("C:/books/child/book.cbz")).toHaveLength(1)

    selectFolderViewMode(ui, "详细信息")
    await waitFor(() => expect(view.container.querySelector('[data-neoview-folder-details="true"] [data-folder-return-footer="true"]')).toBeTruthy())
    expect(folderCard?.getAttribute("data-selection-total")).toBe("1")

    fireEvent.click(ui.getByRole("button", { name: "返回上级目录" }))
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith("browser-1", { action: "back" }, expect.any(AbortSignal), undefined))
  })
})

function page(overrides: Partial<ReaderDirectoryPageDto>): ReaderDirectoryPageDto {
  return {
    sessionId: "browser-1",
    navigationEntryId: 1,
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
    watching: false,
    ...overrides,
  }
}

function folderViewConfig(overrides: Partial<ReaderFolderViewConfig> = {}): ReaderFolderViewConfig {
  return {
    homePath: "",
    viewMode: "compact",
    previewCount: 4,
    thumbnailWidthPercent: 20,
    bannerWidthPercent: 50,
    emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: false },
    details: {
      columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
      hiddenColumns: [],
      pinnedLeft: ["name"],
      pinnedRight: [],
      columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
    },
    search: { includeSubfolders: true, showHistoryOnFocus: true, searchInPath: false },
    tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] },
    ...overrides,
  }
}
