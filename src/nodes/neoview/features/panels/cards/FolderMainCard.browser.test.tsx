import { useState } from "react"
import { expect, onTestFinished, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { VirtuosoMockContext } from "react-virtuoso"

import { ContextMenuProvider } from "@/components/context-menu"
import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../adapters/reader-http-client"
import FolderMainCard from "./FolderMainCard"
import FolderDeleteButton from "./folder/FolderDeleteButton"
import { DEFAULT_FOLDER_VIEW } from "./folder/FolderBrowserPane"
import { publishFolderEntryRemoved } from "./folder/FolderNavigationEvents"

test("[neoview.folder.legacy-tag-display-gui] renders a legacy folder config without tag display settings", async () => {
  const client = {
    openDirectoryBrowser: vi.fn(async () => directoryPage({ entries: [], total: 0 })),
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books"
          folderView={{ ...DEFAULT_FOLDER_VIEW, tagDisplay: undefined }}
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await expect.element(page.getByRole("button", { name: "更多" })).toBeVisible()
  expect(document.querySelector("[data-neoview-folder-list-shell='true']")).not.toBeNull()
})

test("[neoview.folder.error-indicator-gui] confines a retryable directory error to the File Card corner", async () => {
  const openDirectoryBrowser = vi.fn()
    .mockRejectedValueOnce(new Error("failed to read C:/books"))
    .mockResolvedValueOnce(directoryPage({
      entries: [{ name: "recovered.cbz", path: "C:/books/recovered.cbz", kind: "file", readerSupported: true }],
      total: 1,
    }))
  const client = {
    openDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  const indicator = page.getByRole("button", { name: "文件目录错误：无法读取当前目录，请重试。点击重试。" })
  await expect.element(indicator).toBeVisible()
  expect(document.querySelector("[data-folder-error-indicator='true']")?.className).toContain("absolute bottom-2 right-2")
  expect(document.querySelector("[data-neoview-folder-list-shell='true']")).not.toBeNull()

  await indicator.hover()
  await expect.element(page.getByText("无法读取当前目录，请重试。", { exact: true })).toBeVisible()

  await indicator.click()
  await expect.poll(() => openDirectoryBrowser).toHaveBeenCalledTimes(2)
  await expect.element(page.getByText("recovered.cbz", { exact: true })).toBeVisible()
  expect(document.querySelector("[data-folder-error-indicator='true']")).toBeNull()
})

test("[neoview.folder.keyboard-passthrough-gui] leaves file-card keys available to global bindings", async () => {
  const client = {
    openDirectoryBrowser: vi.fn(async () => directoryPage({
      entries: [
        { name: "first.cbz", path: "C:/books/first.cbz", kind: "file", readerSupported: true },
        { name: "second.cbz", path: "C:/books/second.cbz", kind: "file", readerSupported: true },
      ],
      total: 2,
    })),
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient
  const receivedByGlobalBinding = vi.fn()
  document.addEventListener("keydown", receivedByGlobalBinding)
  try {
    await render(
      <div style={{ width: 900, height: 600 }}>
        <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
          <FolderMainCard
            client={client}
            disabled={false}
            sourcePath="C:/books"
            folderView={{ ...DEFAULT_FOLDER_VIEW, viewMode: "cover-list" }}
            onOpen={vi.fn()}
            onGoTo={vi.fn()}
          />
        </VirtuosoMockContext.Provider>
      </div>,
    )

    await expect.element(page.getByText("first.cbz", { exact: true })).toBeVisible()
    const list = document.querySelector<HTMLElement>("[data-neoview-folder-list='true']")!
    const entry = list.querySelector<HTMLElement>("[data-folder-entry='true']")!
    const focusedIndexBefore = list.dataset.focusedIndex
    expect(list.getAttribute("role")).toBeNull()
    expect(list.tabIndex).toBe(-1)

    entry.focus()
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown", code: "ArrowDown" })
    entry.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(receivedByGlobalBinding).toHaveBeenCalledOnce()
    expect(receivedByGlobalBinding.mock.calls[0]?.[0]?.defaultPrevented).toBe(false)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(list.dataset.focusedIndex).toBe(focusedIndexBefore)
  } finally {
    document.removeEventListener("keydown", receivedByGlobalBinding)
  }
})

test("[neoview.folder.efu-gui] imports an EFU list from the File Card More menu", async () => {
  const directory = directoryPage({ filter: "library", filterOptions: ["all", "library"] })
  const efu = directoryPage({
    sessionId: "browser-efu",
    path: "C:/lists/results.efu",
    sourceKind: "efu",
    filter: "library",
    filterOptions: ["all", "library"],
    parentPath: undefined,
    generation: 2,
    entries: [
      { name: "found.cbz", path: "D:/results/found.cbz", kind: "file", readerSupported: true },
      { name: "missing.cbz", path: "D:/results/missing.cbz", kind: "file", readerSupported: true },
    ],
    total: 2,
  })
  const filteredEfu = directoryPage({
    ...efu,
    generation: 3,
    hideMissingEfuEntries: true,
    entries: [{ name: "found.cbz", path: "D:/results/found.cbz", kind: "file", readerSupported: true }],
    total: 1,
  })
  const historyDirectory = directoryPage({
    sessionId: "browser-history",
    path: "C:/history",
    filter: "library",
    filterOptions: ["all", "library"],
    entries: [{ name: "history.cbz", path: "C:/history/history.cbz", kind: "file", readerSupported: true }],
    total: 1,
  })
  const navigateDirectoryBrowser = vi.fn(async () => efu)
  const filterDirectoryBrowser = vi.fn(async () => filteredEfu)
  const thumbnails = createPixelThumbnailRegistration()
  onTestFinished(thumbnails.dispose)
  const registerLibraryThumbnails = thumbnails.registerLibraryThumbnails
  const pickEfuFile = vi.fn(async () => "C:/lists/results.efu")
  const onFolderView = vi.fn()
  const folderNavigationEvents = new EventTarget()
  const client = {
    openDirectoryBrowser: vi.fn(async (path: string) => {
      if (path === "C:/lists/results.efu") return efu
      if (path === "C:/history") return historyDirectory
      return directory
    }),
    navigateDirectoryBrowser,
    filterDirectoryBrowser,
    registerLibraryThumbnails,
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books"
          folderView={{ ...DEFAULT_FOLDER_VIEW, viewMode: "cover-list" }}
          pickEfuFile={pickEfuFile}
          folderNavigationEvents={folderNavigationEvents}
          onFolderView={onFolderView}
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await page.getByRole("button", { name: "更多" }).click()
  await page.getByRole("menuitem", { name: "导入 EFU 文件列表" }).click()

  await expect.poll(() => pickEfuFile).toHaveBeenCalledOnce()
  await expect.poll(() => client.openDirectoryBrowser).toHaveBeenCalledWith(
    "C:/lists/results.efu",
    expect.any(AbortSignal),
    undefined,
    true,
  )
  expect(navigateDirectoryBrowser).not.toHaveBeenCalled()
  await expect.poll(() => document.querySelector("[data-folder-tab-count='2']")).not.toBeNull()
  await expect.poll(() => document.querySelector("[data-folder-source-kind='efu']")).not.toBeNull()
  await expect.poll(() => document.querySelector("[data-folder-tab-kind='efu'] .lucide-lock")).not.toBeNull()
  await expect.element(page.getByText("found.cbz", { exact: true })).toBeVisible()
  await expect.element(page.getByText("missing.cbz", { exact: true })).toBeVisible()
  await expect.poll(() => registerLibraryThumbnails.mock.calls.find(([contextId]) => contextId.startsWith("folder:browser-efu:"))?.[2].map((item) => item.path)).toEqual([
    "D:/results/found.cbz",
    "D:/results/missing.cbz",
  ])
  await expect.poll(() => document.querySelectorAll('[data-folder-source-kind="efu"] img').length).toBe(2)
  await expect.element(page.getByRole("button", { name: "上级" })).toBeDisabled()

  await expect.poll(() => document.querySelector("[data-folder-toolbar-menu='more']")).toBeNull()
  await page.getByRole("button", { name: "更多" }).click()
  await expect.poll(() => document.querySelector("[data-folder-toolbar-menu='more']")).not.toBeNull()
  await page.getByRole("menuitemcheckbox", { name: "隐藏不存在的文件" }).click()

  await expect.poll(() => filterDirectoryBrowser).toHaveBeenCalledWith(
    "browser-efu",
    "library",
    undefined,
    expect.any(AbortSignal),
    false,
    true,
  )
  await expect.element(page.getByText("found.cbz", { exact: true })).toBeVisible()
  await expect.poll(() => document.body.textContent).not.toContain("missing.cbz")
  await expect.poll(() => onFolderView).toHaveBeenCalledWith({ hideMissingEfuEntries: true })

  const activationDetail = { path: "C:/books/series", handled: false }
  folderNavigationEvents.dispatchEvent(new CustomEvent("activate", { detail: activationDetail }))
  expect(activationDetail.handled).toBe(false)
  expect(navigateDirectoryBrowser).not.toHaveBeenCalled()

  folderNavigationEvents.dispatchEvent(new CustomEvent("browse", { detail: { path: "C:/history", newTab: false } }))
  await expect.poll(() => client.openDirectoryBrowser).toHaveBeenCalledWith(
    "C:/history",
    expect.any(AbortSignal),
    undefined,
    true,
  )
  await expect.poll(() => document.querySelector("[data-folder-tab-count='3']")).not.toBeNull()

  await page.getByRole("tab", { name: "results.efu" }).click()
  await expect.element(page.getByText("found.cbz", { exact: true })).toBeVisible()
  await expect.poll(() => document.querySelector("[data-folder-tab-kind='efu'][aria-selected='true']")).not.toBeNull()
})

test("[neoview.folder.title-wrap-gui] controls the cover-grid title policy from the File Card More menu", async () => {
  const onFolderView = vi.fn(async () => undefined)
  const client = {
    openDirectoryBrowser: vi.fn(async () => directoryPage({
      entries: [{ name: "a long cover-grid title that needs a second line.cbz", path: "C:/books/long-title.cbz", kind: "file", readerSupported: true }],
      total: 1,
    })),
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books"
          folderView={{ ...DEFAULT_FOLDER_VIEW, viewMode: "cover-grid" }}
          onFolderView={onFolderView}
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await expect.poll(() => document.querySelector('[data-folder-entry-title-wrap="true"]')?.className).toContain("line-clamp-2")
  await page.getByRole("button", { name: "更多" }).click()
  const titleWrapTrigger = page.getByRole("menuitem", { name: /标题换行/u })
  await expect.element(titleWrapTrigger).toBeVisible()
  await titleWrapTrigger.hover()
  const coverGridToggle = page.getByRole("menuitemcheckbox", { name: "封面网格", exact: true })
  await expect.element(coverGridToggle).toBeVisible()
  await coverGridToggle.click()

  await expect.poll(() => onFolderView).toHaveBeenCalledWith({ titleWrap: { "cover-grid": false } })
})

test("[neoview.folder.search-sort-gui] sorts the active search-result list without restoring the physical directory", async () => {
  const opened = directoryPage({
    entries: [{ name: "physical.cbz", path: "C:/books/physical.cbz", kind: "file", readerSupported: true }],
    total: 1,
  })
  const hits = [
    { name: "alpha.cbz", path: "C:/books/deep/alpha.cbz", kind: "file" as const, readerSupported: true },
    { name: "zeta.cbz", path: "C:/books/deep/zeta.cbz", kind: "file" as const, readerSupported: true },
  ]
  const sortDirectoryBrowser = vi.fn(async () => directoryPage({
    generation: 3,
    entries: [{ name: "physical.cbz", path: "C:/books/physical.cbz", kind: "file", readerSupported: true }],
    total: 1,
  }))
  const thumbnails = createPixelThumbnailRegistration()
  onTestFinished(thumbnails.dispose)
  const folderNavigationEvents = new EventTarget()
  const client = {
    openDirectoryBrowser: vi.fn(async (path: string) => path === "C:/history"
      ? directoryPage({
          sessionId: "browser-history",
          path,
          entries: [{ name: "history.cbz", path: `${path}/history.cbz`, kind: "file", readerSupported: true }],
          total: 1,
        })
      : opened),
    searchDirectoryBrowser: vi.fn(async () => ({
      sessionId: "browser-1",
      rootPath: "C:/books",
      generation: 1,
      query: "deep",
      mode: "text" as const,
      entries: hits,
      scanned: 3,
      matched: 2,
      truncated: false,
    })),
    sortDirectoryBrowser,
    registerLibraryThumbnails: thumbnails.registerLibraryThumbnails,
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books"
          folderView={{ ...DEFAULT_FOLDER_VIEW, viewMode: "cover-list" }}
          folderNavigationEvents={folderNavigationEvents}
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await page.getByRole("button", { name: "搜索" }).click()
  const input = page.getByRole("textbox", { name: "搜索文件" })
  await input.fill("deep")
  document.querySelector<HTMLInputElement>('input[aria-label="搜索文件"]')?.closest("form")?.requestSubmit()
  await expect.poll(() => document.querySelector<HTMLElement>("[data-neoview-folder-list-shell='true']")?.dataset.folderSearchListing).toBe("true")
  await expect.element(page.getByText("alpha.cbz", { exact: true })).toBeVisible()
  await expect.poll(() => thumbnails.registerLibraryThumbnails.mock.calls.some(([, , items]) => items.map((item) => item.path).join("|") === [
    "C:/books/deep/alpha.cbz",
    "C:/books/deep/zeta.cbz",
  ].join("|"))).toBe(true)
  await expect.poll(() => document.querySelectorAll('[data-folder-search-listing="true"] img').length).toBe(2)

  await page.getByRole("button", { name: "排序" }).click()
  await page.getByRole("menuitem", { name: "切换为降序" }).click()

  await expect.poll(() => document.querySelector("[data-folder-search-listing='true']")).not.toBeNull()
  expect(sortDirectoryBrowser).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toContain("physical.cbz")
  const names = [...document.querySelectorAll<HTMLElement>("[data-folder-name]")].map((element) => element.dataset.folderName)
  expect(names.indexOf("zeta.cbz")).toBeLessThan(names.indexOf("alpha.cbz"))

  folderNavigationEvents.dispatchEvent(new CustomEvent("browse", { detail: { path: "C:/history", newTab: false } }))
  await expect.poll(() => document.querySelector("[data-folder-tab-count='2']")).not.toBeNull()
  await expect.element(page.getByText("history.cbz", { exact: true })).toBeVisible()
  await expect.poll(() => document.querySelector("[data-folder-tab-kind='search'] .lucide-lock")).not.toBeNull()

  await page.getByRole("tab", { name: /搜索: deep/ }).click()
  await expect.element(page.getByText("zeta.cbz", { exact: true })).toBeVisible()
  expect(document.body.textContent).not.toContain("physical.cbz")
  const activationDetail = { path: "C:/books/series", handled: false }
  folderNavigationEvents.dispatchEvent(new CustomEvent("activate", { detail: activationDetail }))
  expect(activationDetail.handled).toBe(false)
  await expect.poll(() => document.querySelector("[data-folder-tab-kind='search'][aria-selected='true']")).not.toBeNull()
})

test("[neoview.folder.replaceable-tab-gui] reuses an ordinary directory tab for external browse", async () => {
  const folderNavigationEvents = new EventTarget()
  const client = {
    openDirectoryBrowser: vi.fn(async (path: string) => directoryPage({
      sessionId: path === "C:/history" ? "browser-history" : "browser-1",
      path,
      entries: path === "C:/history"
        ? [{ name: "history.cbz", path: `${path}/history.cbz`, kind: "file", readerSupported: true }]
        : [],
      total: path === "C:/history" ? 1 : 0,
    })),
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" folderNavigationEvents={folderNavigationEvents} onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  folderNavigationEvents.dispatchEvent(new CustomEvent("browse", { detail: { path: "C:/history", newTab: false } }))

  await expect.element(page.getByText("history.cbz")).toBeVisible()
  await expect.poll(() => document.querySelector("[data-folder-tab-count='1']")).not.toBeNull()
  expect(document.querySelector("[data-folder-tab-kind='search'], [data-folder-tab-kind='efu']")).toBeNull()
})

test("[neoview.folder.open-keeps-scroll-gui] keeps the File Card viewport when opening its focused book", async () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    name: `item-${index}.cbz`,
    path: `C:/books/item-${index}.cbz`,
    kind: "file" as const,
    readerSupported: true,
  }))
  const client = {
    openDirectoryBrowser: vi.fn(async () => directoryPage({ entries, total: entries.length })),
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient
  const onOpen = vi.fn()

  function Harness() {
    const [sourcePath, setSourcePath] = useState("C:/books")
    return (
      <FolderMainCard
        client={client}
        disabled={false}
        sourcePath={sourcePath}
        onOpen={(path, provenance) => {
          onOpen(path, provenance)
          setSourcePath(path)
        }}
        onGoTo={vi.fn()}
      />
    )
  }

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <Harness />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await expect.element(page.getByText("item-0.cbz")).toBeVisible()
  const scroller = document.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]')
  expect(scroller).not.toBeNull()
  scroller!.scrollTo({ top: 34 * 40 })
  await expect.poll(() => scroller!.scrollTop).toBeGreaterThan(1_000)
  await expect.element(page.getByText("item-40.cbz")).toBeVisible()
  const scrollTopBeforeOpen = scroller!.scrollTop

  await page.getByText("item-40.cbz").click()

  await expect.poll(() => onOpen).toHaveBeenCalledWith("C:/books/item-40.cbz", {
    browserOriginPath: "C:/books",
    browserOriginEntryPath: "C:/books/item-40.cbz",
    browserOriginTraversalFrames: [{
      directoryPath: "C:/books",
      currentEntryPath: "C:/books/item-40.cbz",
    }],
  })
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  expect(scroller!.scrollTop).toBe(scrollTopBeforeOpen)
})

test("[neoview.folder.reader-navigation-refresh-keeps-scroll-gui] keeps the File Card viewport when a watched deletion follows Reader navigation", async () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    name: `item-${index}.cbz`,
    path: `C:/books/item-${index}.cbz`,
    kind: "file" as const,
    readerSupported: true,
  }))
  const opened = directoryPage({ entries, total: entries.length, watching: true })
  const waits: Array<{ resolve(page: ReaderDirectoryPageDto): void; signal: AbortSignal }> = []
  const watchDirectoryBrowser = vi.fn((_sessionId: string, _generation: number, _focusPath?: string, signal?: AbortSignal) => (
    new Promise<ReaderDirectoryPageDto>((resolve) => waits.push({ resolve, signal: signal! }))
  ))
  const client = {
    openDirectoryBrowser: vi.fn(async () => opened),
    watchDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient
  let advanceReader!: () => void

  function Harness() {
    const [sourcePath, setSourcePath] = useState("C:/books")
    advanceReader = () => setSourcePath("C:/books/item-2.cbz")
    return (
      <FolderMainCard
        client={client}
        disabled={false}
        sourcePath={sourcePath}
        onOpen={vi.fn()}
        onGoTo={vi.fn()}
      />
    )
  }

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <Harness />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await expect.element(page.getByText("item-0.cbz", { exact: true })).toBeVisible()
  await expect.poll(() => waits).toHaveLength(1)
  advanceReader()
  await expect.poll(() => document.querySelector('[data-folder-path="C:/books/item-2.cbz"]')?.getAttribute("data-focused")).toBe("true")

  const scroller = document.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]')
  expect(scroller).not.toBeNull()
  scroller!.scrollTo({ top: 34 * 40 })
  await expect.poll(() => scroller!.scrollTop).toBeGreaterThan(1_000)
  const scrollTopBeforeRefresh = scroller!.scrollTop

  waits[0]!.resolve(directoryPage({
    entries: entries.slice(0, -1),
    total: entries.length - 1,
    generation: 2,
    watching: true,
    suggestedSelection: { path: "C:/books/item-2.cbz", index: 2 },
  }))

  await expect.poll(() => document.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-selection-total")).toBe("99")
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  expect(document.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]')).toBe(scroller)
  expect(scroller!.scrollTop).toBe(scrollTopBeforeRefresh)
})

test("[neoview.folder.delete-sibling-keeps-reader-gui] deleting an earlier sibling through bindings keeps the current reader file focused", async () => {
  const opened = directoryPage({
    entries: [
      { name: "earlier.cbz", path: "C:/books/earlier.cbz", kind: "file", readerSupported: true },
      { name: "current.cbz", path: "C:/books/current.cbz", kind: "file", readerSupported: true },
      { name: "later.cbz", path: "C:/books/later.cbz", kind: "file", readerSupported: true },
    ],
    total: 3,
    suggestedSelection: { path: "C:/books/current.cbz", index: 1 },
  })
  let resolveDeletion!: (value: ReturnType<typeof successfulDeleteSequence>) => void
  const onDeleteThroughBinding = vi.fn(() => new Promise<ReturnType<typeof successfulDeleteSequence>>((resolve) => {
    resolveDeletion = resolve
  }))
  const navigateDirectoryBrowser = vi.fn()
  const onOpen = vi.fn()
  const client = {
    openDirectoryBrowser: vi.fn(async () => opened),
    navigateDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <ContextMenuProvider>
      <div style={{ width: 900, height: 600 }}>
        <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
          <FolderMainCard
            client={client}
            disabled={false}
            sourcePath="C:/books/current.cbz"
            onDeleteThroughBinding={onDeleteThroughBinding}
            onOpen={onOpen}
            onGoTo={vi.fn()}
          />
          <FolderDeleteButton
            entry={{ index: 0, path: "C:/books/earlier.cbz", name: "earlier.cbz", kind: "file", readerSupported: true }}
            strategy="trash"
            confirm={false}
          />
        </VirtuosoMockContext.Provider>
      </div>
    </ContextMenuProvider>,
  )

  await expect.poll(() => document.querySelector('[data-folder-path="C:/books/current.cbz"]')?.getAttribute("data-focused")).toBe("true")
  document.querySelector<HTMLButtonElement>('[data-folder-delete-button="true"]')!.click()

  await expect.poll(() => onDeleteThroughBinding).toHaveBeenCalledWith("C:/books/earlier.cbz", "trash")
  await expect.poll(() => document.querySelector('[data-folder-path="C:/books/earlier.cbz"]')).toBeNull()
  expect(document.querySelector('[data-folder-path="C:/books/current.cbz"]')?.getAttribute("data-focused")).toBe("true")

  resolveDeletion(successfulDeleteSequence())
  await expect.poll(() => onDeleteThroughBinding).toHaveBeenCalledOnce()
  expect(navigateDirectoryBrowser).not.toHaveBeenCalled()
  expect(onOpen).not.toHaveBeenCalled()
})

test("[neoview.folder.delete-current-advances-gui] deleting the current reader file through bindings keeps the adjacent focus fallback", async () => {
  const opened = directoryPage({
    entries: [
      { name: "earlier.cbz", path: "C:/books/earlier.cbz", kind: "file", readerSupported: true },
      { name: "current.cbz", path: "C:/books/current.cbz", kind: "file", readerSupported: true },
      { name: "later.cbz", path: "C:/books/later.cbz", kind: "file", readerSupported: true },
    ],
    total: 3,
    suggestedSelection: { path: "C:/books/current.cbz", index: 1 },
  })
  const onDeleteThroughBinding = vi.fn(async () => successfulDeleteSequence())
  const client = {
    openDirectoryBrowser: vi.fn(async () => opened),
    navigateDirectoryBrowser: vi.fn(),
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <ContextMenuProvider>
      <div style={{ width: 900, height: 600 }}>
        <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
          <FolderMainCard
            client={client}
            disabled={false}
            sourcePath="C:/books/current.cbz"
            onDeleteThroughBinding={onDeleteThroughBinding}
            onOpen={vi.fn()}
            onGoTo={vi.fn()}
          />
          <FolderDeleteButton
            entry={{ index: 1, path: "C:/books/current.cbz", name: "current.cbz", kind: "file", readerSupported: true }}
            strategy="trash"
            confirm={false}
          />
        </VirtuosoMockContext.Provider>
      </div>
    </ContextMenuProvider>,
  )

  await expect.poll(() => document.querySelector('[data-folder-path="C:/books/current.cbz"]')?.getAttribute("data-focused")).toBe("true")
  document.querySelector<HTMLButtonElement>('[data-folder-delete-button="true"]')!.click()

  await expect.poll(() => onDeleteThroughBinding).toHaveBeenCalledWith("C:/books/current.cbz", "trash")
  await expect.poll(() => document.querySelector('[data-folder-path="C:/books/later.cbz"]')?.getAttribute("data-focused")).toBe("true")
  expect(document.querySelector('[data-folder-path="C:/books/earlier.cbz"]')?.getAttribute("data-focused")).not.toBe("true")
})

test("[neoview.folder.optimistic-delete-rollback-gui] restores the hidden entry when a binding deletion fails", async () => {
  const opened = directoryPage({
    entries: [
      { name: "earlier.cbz", path: "C:/books/earlier.cbz", kind: "file", readerSupported: true },
      { name: "current.cbz", path: "C:/books/current.cbz", kind: "file", readerSupported: true },
      { name: "later.cbz", path: "C:/books/later.cbz", kind: "file", readerSupported: true },
    ],
    total: 3,
    suggestedSelection: { path: "C:/books/current.cbz", index: 1 },
  })
  const refreshed = directoryPage({ ...opened, generation: 2 })
  let rejectDeletion!: () => void
  const onDeleteThroughBinding = vi.fn(() => new Promise<never>((_resolve, reject) => {
    rejectDeletion = () => reject(new Error("recycle bin unavailable"))
  }))
  const navigateDirectoryBrowser = vi.fn(async () => refreshed)
  const client = {
    openDirectoryBrowser: vi.fn(async () => opened),
    navigateDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <ContextMenuProvider>
      <div style={{ width: 900, height: 600 }}>
        <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
          <FolderMainCard
            client={client}
            disabled={false}
            sourcePath="C:/books/current.cbz"
            onDeleteThroughBinding={onDeleteThroughBinding}
            onOpen={vi.fn()}
            onGoTo={vi.fn()}
          />
          <FolderDeleteButton
            entry={{ index: 0, path: "C:/books/earlier.cbz", name: "earlier.cbz", kind: "file", readerSupported: true }}
            strategy="trash"
            confirm={false}
          />
        </VirtuosoMockContext.Provider>
      </div>
    </ContextMenuProvider>,
  )

  await expect.element(page.getByText("earlier.cbz", { exact: true })).toBeVisible()
  document.querySelector<HTMLButtonElement>('[data-folder-delete-button="true"]')!.click()

  await expect.poll(() => onDeleteThroughBinding).toHaveBeenCalledWith("C:/books/earlier.cbz", "trash")
  await expect.poll(() => document.querySelector('[data-folder-path="C:/books/earlier.cbz"]')).toBeNull()

  rejectDeletion()
  await expect.poll(() => navigateDirectoryBrowser).toHaveBeenCalledWith(
    "browser-1",
    { action: "refresh" },
    expect.any(AbortSignal),
    "C:/books/current.cbz",
  )
  await expect.element(page.getByText("earlier.cbz", { exact: true })).toBeVisible()
})

test("[neoview.folder.reader-delete-event-gui] removes the penetrated activation root after a Reader action and refreshes the File Card", async () => {
  const opened = directoryPage({
    entries: [
      { name: "series", path: "C:/books/series", kind: "directory", readerSupported: true },
      { name: "later.cbz", path: "C:/books/later.cbz", kind: "file", readerSupported: true },
    ],
    total: 2,
  })
  const refreshed = directoryPage({
    generation: 2,
    entries: [{ name: "later.cbz", path: "C:/books/later.cbz", kind: "file", readerSupported: true }],
    total: 1,
  })
  const navigateDirectoryBrowser = vi.fn(async () => refreshed)
  const folderNavigationEvents = new EventTarget()
  const client = {
    openDirectoryBrowser: vi.fn(async () => opened),
    navigateDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books/series/inside/001.jpg"
          browserOriginPath="C:/books"
          folderNavigationEvents={folderNavigationEvents}
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await expect.element(page.getByText("series", { exact: true })).toBeVisible()
  publishFolderEntryRemoved(folderNavigationEvents, "C:/books/series")

  await expect.poll(() => document.querySelector('[data-folder-path="C:/books/series"]')).toBeNull()
  await expect.poll(() => navigateDirectoryBrowser).toHaveBeenCalledWith(
    "browser-1",
    { action: "refresh" },
    expect.any(AbortSignal),
    "C:/books/later.cbz",
  )
  await expect.element(page.getByText("later.cbz", { exact: true })).toBeVisible()
})

function directoryPage(overrides: Partial<ReaderDirectoryPageDto> = {}): ReaderDirectoryPageDto {
  return {
    sessionId: "browser-1",
    navigationEntryId: 1,
    path: "C:/books",
    parentPath: "C:/",
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

function createPixelThumbnailRegistration() {
  const urls = new Map<string, string>()
  return {
    registerLibraryThumbnails: vi.fn(async (contextId: string, generation: number, items: readonly { id: string; path: string }[]) => ({
      contextId,
      generation,
      items: items.map((item) => {
        const key = `${contextId}:${generation}:${item.id}`
        const thumbnailUrl = urls.get(key) ?? URL.createObjectURL(new Blob([
          Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), (character) => character.charCodeAt(0)),
        ], { type: "image/gif" }))
        urls.set(key, thumbnailUrl)
        return { id: item.id, thumbnailUrl, contentVersion: item.path }
      }),
    })),
    dispose: () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
    },
  }
}


function successfulDeleteSequence() {
  return {
    bindingId: "system-file-card",
    status: "succeeded" as const,
    completedActions: 1,
    action: "file.delete-current" as const,
    outcome: { status: "succeeded" as const },
  }
}
