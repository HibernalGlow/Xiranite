import { useState } from "react"
import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { VirtuosoMockContext } from "react-virtuoso"

import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../adapters/reader-http-client"
import FolderMainCard from "./FolderMainCard"

test("[neoview.folder.efu-gui] imports an EFU list from the File Card More menu", async () => {
  const directory = directoryPage()
  const efu = directoryPage({
    path: "C:/lists/results.efu",
    sourceKind: "efu",
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
  const navigateDirectoryBrowser = vi.fn(async () => efu)
  const filterDirectoryBrowser = vi.fn(async () => filteredEfu)
  const pickEfuFile = vi.fn(async () => "C:/lists/results.efu")
  const onFolderView = vi.fn()
  const client = {
    openDirectoryBrowser: vi.fn(async () => directory),
    navigateDirectoryBrowser,
    filterDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books"
          pickEfuFile={pickEfuFile}
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
  await expect.poll(() => navigateDirectoryBrowser).toHaveBeenCalledWith(
    "browser-1",
    { action: "path", path: "C:/lists/results.efu" },
    expect.any(AbortSignal),
    undefined,
  )
  await expect.poll(() => document.querySelector("[data-folder-source-kind='efu']")).not.toBeNull()
  await expect.element(page.getByText("found.cbz")).toBeVisible()
  await expect.element(page.getByText("missing.cbz")).toBeVisible()
  await expect.element(page.getByRole("button", { name: "上级" })).toBeDisabled()

  await expect.poll(() => document.querySelector("[data-folder-toolbar-menu='more']")).toBeNull()
  await page.getByRole("button", { name: "更多" }).click()
  await expect.poll(() => document.querySelector("[data-folder-toolbar-menu='more']")).not.toBeNull()
  await page.getByRole("menuitemcheckbox", { name: "隐藏不存在的文件" }).click()

  await expect.poll(() => filterDirectoryBrowser).toHaveBeenCalledWith(
    "browser-1",
    "all",
    undefined,
    expect.any(AbortSignal),
    false,
    true,
  )
  await expect.element(page.getByText("found.cbz")).toBeVisible()
  await expect.poll(() => document.body.textContent).not.toContain("missing.cbz")
  await expect.poll(() => onFolderView).toHaveBeenCalledWith({ hideMissingEfuEntries: true })
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
  const client = {
    openDirectoryBrowser: vi.fn(async () => opened),
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
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 34 }}>
        <FolderMainCard client={client} disabled={false} sourcePath="C:/books" onOpen={vi.fn()} onGoTo={vi.fn()} />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await page.getByRole("button", { name: "搜索" }).click()
  const input = page.getByRole("textbox", { name: "搜索文件" })
  await input.fill("deep")
  document.querySelector<HTMLInputElement>('input[aria-label="搜索文件"]')?.closest("form")?.requestSubmit()
  await expect.element(page.getByRole("listbox", { name: "搜索结果" })).toBeVisible()
  await expect.element(page.getByText("alpha.cbz")).toBeVisible()

  await page.getByRole("button", { name: "排序" }).click()
  await page.getByRole("menuitem", { name: "切换为降序" }).click()

  await expect.poll(() => document.querySelector("[data-folder-search-listing='true']")).not.toBeNull()
  expect(sortDirectoryBrowser).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toContain("physical.cbz")
  const names = [...document.querySelectorAll<HTMLElement>("[data-folder-name]")].map((element) => element.dataset.folderName)
  expect(names.indexOf("zeta.cbz")).toBeLessThan(names.indexOf("alpha.cbz"))
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
  })
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  expect(scroller!.scrollTop).toBe(scrollTopBeforeOpen)
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
