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
    entries: [{ name: "found.cbz", path: "D:/results/found.cbz", kind: "file", readerSupported: true }],
    total: 1,
  })
  const navigateDirectoryBrowser = vi.fn(async () => efu)
  const pickEfuFile = vi.fn(async () => "C:/lists/results.efu")
  const client = {
    openDirectoryBrowser: vi.fn(async () => directory),
    navigateDirectoryBrowser,
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
  await expect.element(page.getByRole("button", { name: "上级" })).toBeDisabled()
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
