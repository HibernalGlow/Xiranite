import { useState } from "react"
import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { VirtuosoMockContext } from "react-virtuoso"

import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderMainCard from "../FolderMainCard"
import { DEFAULT_FOLDER_VIEW } from "./FolderBrowserPane"

test("[neoview.folder.inline-branch-browser] expands a multi-directory branch below the File Card and releases its child session", async () => {
  const root = directoryPage({
    path: "C:/books",
    entries: [{ name: "series", path: "C:/books/series", kind: "directory", readerSupported: true }],
    total: 1,
  })
  const child = directoryPage({
    sessionId: "browser-inline",
    navigationEntryId: 2,
    path: "C:/books/series",
    parentPath: "C:/books",
    entries: [
      { name: "chapter-one", path: "C:/books/series/chapter-one", kind: "directory", readerSupported: true },
      { name: "chapter-two", path: "C:/books/series/chapter-two", kind: "directory", readerSupported: true },
    ],
    total: 2,
  })
  const openDirectoryBrowser = vi.fn(async (path: string) => path === root.path ? root : child)
  const closeDirectoryBrowser = vi.fn(async () => undefined)
  const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number, items: readonly { id: string; path: string }[]) => ({
    contextId,
    generation,
    items: items.map((item) => ({
      id: item.id,
      thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      contentVersion: item.path,
    })),
  }))
  const releaseLibraryThumbnailContext = vi.fn(async () => undefined)
  const navigateDirectoryBrowser = vi.fn(async () => root)
  const resolveFolderPenetration = vi.fn(async () => ({
    status: "branch" as const,
    originPath: "C:/books/series",
    chain: [],
    reason: "multiple-primary-items" as const,
    directDirectoryCount: 2,
  }))
  const client = {
    openDirectoryBrowser,
    closeDirectoryBrowser,
    registerLibraryThumbnails,
    releaseLibraryThumbnailContext,
    navigateDirectoryBrowser,
    resolveFolderPenetration,
  } as unknown as ReaderHttpClient

  const view = await render(
    <div style={{ width: 960, height: 720 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 480, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books"
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
          folderView={{
            ...DEFAULT_FOLDER_VIEW,
            viewMode: "cover-list",
            penetration: { ...DEFAULT_FOLDER_VIEW.penetration, enabled: true, expandBranchesInline: true },
          }}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  const branch = view.getByTitle("C:/books/series")
  await branch.click()
  await expect.poll(() => resolveFolderPenetration).toHaveBeenCalledOnce()
  await expect.poll(() => document.querySelector('[data-folder-inline-branch="true"]')?.getAttribute("data-folder-inline-branch-path")).toBe("C:/books/series")
  expect(document.querySelector('[data-folder-inline-branch="true"]')?.getAttribute("data-folder-inline-view-mode")).toBe("cover-list")
  await expect.poll(() => document.body.textContent).toContain("chapter-one")
  await expect.poll(() => (document.querySelector('[data-folder-inline-branch="true"]') as HTMLElement | null)?.style.height).toBe("194px")
  expect(navigateDirectoryBrowser).not.toHaveBeenCalled()
  expect(openDirectoryBrowser).toHaveBeenCalledWith("C:/books/series", expect.any(AbortSignal), "folder-inline-branch:C:/books/series")
  await expect.poll(() => registerLibraryThumbnails.mock.calls.find(([contextId]) => contextId.startsWith("folder:browser-inline:"))?.[2].map((item) => item.path)).toEqual([
    "C:/books/series/chapter-one",
    "C:/books/series/chapter-two",
  ])

  await view.getByRole("button", { name: "收起文件夹" }).click()
  await expect.poll(() => closeDirectoryBrowser).toHaveBeenCalledWith("browser-inline")
  await expect.poll(() => releaseLibraryThumbnailContext).toHaveBeenCalledWith(expect.stringMatching(/^folder:browser-inline:/))
})

test("[neoview.folder.inline-branch-setting-browser] enables the optional branch-expansion setting from penetration controls", async () => {
  const onFolderView = vi.fn()
  const client = {
    openDirectoryBrowser: vi.fn(async () => directoryPage({
      entries: [{ name: "series", path: "C:/books/series", kind: "directory", readerSupported: true }],
      total: 1,
    })),
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  function Harness() {
    const [folderView, setFolderView] = useState(DEFAULT_FOLDER_VIEW)
    return (
      <FolderMainCard
        client={client}
        disabled={false}
        sourcePath="C:/books"
        folderView={folderView}
        onFolderView={(patch) => {
          onFolderView(patch)
          if (!patch.penetration) return
          setFolderView((current) => ({
            ...current,
            penetration: { ...current.penetration, ...patch.penetration },
          }))
        }}
        onOpen={vi.fn()}
        onGoTo={vi.fn()}
      />
    )
  }

  await render(
    <div style={{ width: 960, height: 720 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 480, itemHeight: 34 }}>
        <Harness />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await page.getByRole("button", { name: "开启穿透模式" }).click()
  await expect.poll(() => onFolderView).toHaveBeenCalledWith({ penetration: { enabled: true } })
  await page.getByRole("button", { name: "更多" }).click()
  await page.getByRole("menuitem", { name: /穿透设置/u }).click()
  const expandBranchesInline = page.getByRole("switch", { name: "分支文件夹就地展开" })
  await expect.element(expandBranchesInline).toBeEnabled()
  await expandBranchesInline.click()
  await expect.poll(() => onFolderView).toHaveBeenCalledWith({ penetration: { expandBranchesInline: true } })
  await expect.element(expandBranchesInline).toHaveAttribute("aria-checked", "true")
})

function directoryPage(overrides: Partial<ReaderDirectoryPageDto> = {}): ReaderDirectoryPageDto {
  return {
    sessionId: "browser-root",
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
