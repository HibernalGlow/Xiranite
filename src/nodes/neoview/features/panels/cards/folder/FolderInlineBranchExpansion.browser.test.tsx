import { useState } from "react"
import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { VirtuosoMockContext } from "react-virtuoso"

import type { ReaderDirectoryPageDto, ReaderFolderViewMode, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderMainCard from "../FolderMainCard"
import { DEFAULT_FOLDER_VIEW } from "./FolderBrowserPane"
import { inlineBranchViewportHeight } from "./FolderInlineBranchPanel"

test("[neoview.folder.inline-branch-browser] opens a branch drawer directly below the clicked folder and releases its child session", async () => {
  const root = directoryPage({
    path: "C:/books",
    entries: [
      { name: "series", path: "C:/books/series", kind: "directory", readerSupported: true },
      { name: "later", path: "C:/books/later", kind: "directory", readerSupported: true },
    ],
    total: 2,
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
  const drawer = document.querySelector<HTMLElement>('[data-folder-inline-branch="true"]')
  const branchElement = document.querySelector<HTMLElement>('[data-folder-entry][data-folder-path="C:/books/series"]')
  const laterElement = document.querySelector<HTMLElement>('[data-folder-entry][data-folder-path="C:/books/later"]')
  expect(drawer?.parentElement).toBe(branchElement?.parentElement)
  expect(drawer?.compareDocumentPosition(laterElement!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  await expect.poll(() => document.body.textContent).toContain("chapter-one")
  await expect.poll(() => (document.querySelector('[data-folder-inline-branch="true"]') as HTMLElement | null)?.style.height).toBe("192px")
  await expect.poll(() => {
    const inlineDrawer = document.querySelector<HTMLElement>('[data-folder-inline-branch="true"]')
    const laterEntry = document.querySelector<HTMLElement>('[data-folder-entry][data-folder-path="C:/books/later"]')
    return Boolean(inlineDrawer && laterEntry && laterEntry.getBoundingClientRect().top >= inlineDrawer.getBoundingClientRect().bottom)
  }).toBe(true)
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
  const maximumDirectories = page.getByRole("spinbutton", { name: "直属子文件夹上限" })
  const maximumFiles = page.getByRole("spinbutton", { name: "直属文件上限" })
  const maximumItems = page.getByRole("spinbutton", { name: "直属条目合计上限" })
  await expect.element(maximumDirectories).toHaveValue(4)
  await maximumDirectories.fill("3")
  await expect.poll(() => onFolderView).toHaveBeenCalledWith({ penetration: { inlineBranchMaxDirectories: 3 } })
  await maximumFiles.fill("5")
  await expect.poll(() => onFolderView).toHaveBeenCalledWith({ penetration: { inlineBranchMaxFiles: 5 } })
  await maximumItems.fill("6")
  await expect.poll(() => onFolderView).toHaveBeenCalledWith({ penetration: { inlineBranchMaxItems: 6 } })
})

test("[neoview.folder.inline-branch-fallback-browser] enters the raw directory when branch expansion is disabled", async () => {
  const root = directoryPage({
    entries: [{ name: "series", path: "C:/books/series", kind: "directory", readerSupported: true }],
    total: 1,
  })
  const rawDirectory = directoryPage({ path: "C:/books/series", parentPath: "C:/books", navigationEntryId: 2, generation: 2 })
  const navigateDirectoryBrowser = vi.fn(async () => rawDirectory)
  const client = {
    openDirectoryBrowser: vi.fn(async () => root),
    closeDirectoryBrowser: vi.fn(async () => undefined),
    navigateDirectoryBrowser,
    resolveFolderPenetration: vi.fn(async () => ({
      status: "branch" as const,
      originPath: "C:/books/series",
      chain: [],
      reason: "multiple-primary-items" as const,
      directDirectoryCount: 2,
    })),
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
            penetration: { ...DEFAULT_FOLDER_VIEW.penetration, enabled: true, expandBranchesInline: false },
          }}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await view.getByTitle("C:/books/series").click()
  await expect.poll(() => navigateDirectoryBrowser).toHaveBeenCalledWith(
    "browser-root",
    { action: "path", path: "C:/books/series" },
    expect.any(AbortSignal),
    "C:/books/series",
  )
  expect(document.querySelector('[data-folder-inline-branch="true"]')).toBeNull()
})

test("[neoview.folder.inline-branch-raw-browser] treats a double-click as raw directory navigation even when branch expansion is enabled", async () => {
  const root = directoryPage({
    entries: [{ name: "series", path: "C:/books/series", kind: "directory", readerSupported: true }],
    total: 1,
  })
  const rawDirectory = directoryPage({ path: "C:/books/series", parentPath: "C:/books", navigationEntryId: 2, generation: 2 })
  const navigateDirectoryBrowser = vi.fn(async () => rawDirectory)
  const resolveFolderPenetration = vi.fn(async () => ({
    status: "branch" as const,
    originPath: "C:/books/series",
    chain: [],
    reason: "multiple-primary-items" as const,
    directDirectoryCount: 2,
  }))
  const client = {
    openDirectoryBrowser: vi.fn(async () => root),
    closeDirectoryBrowser: vi.fn(async () => undefined),
    navigateDirectoryBrowser,
    resolveFolderPenetration,
  } as unknown as ReaderHttpClient

  await render(
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
            penetration: { ...DEFAULT_FOLDER_VIEW.penetration, enabled: true, expandBranchesInline: true },
          }}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await expect.element(page.getByTitle("C:/books/series")).toBeVisible()
  document.querySelector<HTMLElement>('[title="C:/books/series"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }))
  await expect.poll(() => navigateDirectoryBrowser).toHaveBeenCalledWith(
    "browser-root",
    { action: "path", path: "C:/books/series" },
    expect.any(AbortSignal),
    "C:/books/series",
  )
  expect(resolveFolderPenetration).not.toHaveBeenCalled()
  expect(document.querySelector('[data-folder-inline-branch="true"]')).toBeNull()
})

test("[neoview.folder.inline-branch-limit-browser] enters the raw directory when the combined direct-entry limit is exceeded", async () => {
  const root = directoryPage({
    entries: [{ name: "series", path: "C:/books/series", kind: "directory", readerSupported: true }],
    total: 1,
  })
  const rawDirectory = directoryPage({ path: "C:/books/series", parentPath: "C:/books", navigationEntryId: 2, generation: 2 })
  const navigateDirectoryBrowser = vi.fn(async () => rawDirectory)
  const client = {
    openDirectoryBrowser: vi.fn(async () => root),
    closeDirectoryBrowser: vi.fn(async () => undefined),
    navigateDirectoryBrowser,
    resolveFolderPenetration: vi.fn(async () => ({
      status: "branch" as const,
      originPath: "C:/books/series",
      chain: [],
      reason: "multiple-primary-items" as const,
      directDirectoryCount: 2,
      directFileCount: 3,
    })),
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
            penetration: { ...DEFAULT_FOLDER_VIEW.penetration, enabled: true, expandBranchesInline: true },
          }}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await view.getByTitle("C:/books/series").click()
  await expect.poll(() => navigateDirectoryBrowser).toHaveBeenCalledWith(
    "browser-root",
    { action: "path", path: "C:/books/series" },
    expect.any(AbortSignal),
    "C:/books/series",
  )
  expect(document.querySelector('[data-folder-inline-branch="true"]')).toBeNull()
})

test("[neoview.folder.inline-branch-cover-grid] gives the drawer an entire cover-grid row", async () => {
  const view = await renderExpandedBranch("cover-grid", { width: 360, rootEntryCount: 7 })
  const drawer = document.querySelector<HTMLElement>('[data-folder-inline-branch="true"]')
  const drawerHost = drawer?.parentElement
  const branch = document.querySelector<HTMLElement>('[data-folder-entry][data-folder-path="C:/books/series"]')
  const downstream = document.querySelector<HTMLElement>('[data-folder-entry][data-folder-path="C:/books/later-6"]')

  await expect.poll(() => Number.parseFloat(drawerHost?.style.width ?? "0")).toBeGreaterThan(branch?.getBoundingClientRect().width ?? 0)
  await expect.poll(() => Boolean(drawer && downstream && downstream.getBoundingClientRect().top >= drawer.getBoundingClientRect().bottom)).toBe(true)
  expect(view.getByTitle("C:/books/later-6")).toBeTruthy()
})

test("[neoview.folder.inline-branch-banner] keeps the banner renderer inside the drawer", async () => {
  await renderExpandedBranch("mosaic-list")
  await expect.poll(() => document.querySelector('[data-folder-inline-branch="true"] [data-preview-mode="mosaic-list"]')).not.toBeNull()
})

test("[neoview.folder.inline-branch-mosaic] reserves a full mosaic row for the drawer", async () => {
  await renderExpandedBranch("mosaic-grid")
  await expect.poll(() => document.querySelector('[data-folder-inline-branch="true"]')?.parentElement?.getAttribute("data-folder-inline-mosaic-drawer")).toBe("true")
})

test("[neoview.folder.inline-branch-height] uses the content height for a small expanded folder", async () => {
  await renderExpandedBranch("details", { childEntryCount: 1 })
  await expect.poll(() => (document.querySelector('[data-folder-inline-branch="true"]') as HTMLElement | null)?.style.height).toBe("82px")
})

test("[neoview.folder.inline-branch-height] caps a large expanded folder to the current card listing area", async () => {
  await renderExpandedBranch("cover-list", { childEntryCount: 10 })
  await expect.poll(() => {
    const drawer = document.querySelector<HTMLElement>('[data-folder-inline-branch="true"]')
    const host = drawer?.closest<HTMLElement>("[data-neoview-folder-list]")
    const height = Number.parseFloat(drawer?.style.height ?? "0")
    return Boolean(host && height > 0 && height <= host.getBoundingClientRect().height && height < inlineBranchViewportHeight(10, "cover-list"))
  }).toBe(true)
})

async function renderExpandedBranch(
  viewMode: ReaderFolderViewMode,
  { width = 960, rootEntryCount = 2, childEntryCount = 2 }: { width?: number; rootEntryCount?: number; childEntryCount?: number } = {},
) {
  const rootEntries = [
    { name: "series", path: "C:/books/series", kind: "directory" as const, readerSupported: true },
    ...Array.from({ length: rootEntryCount - 1 }, (_, index) => ({
      name: index === 0 ? "later" : `later-${index + 1}`,
      path: index === 0 ? "C:/books/later" : `C:/books/later-${index + 1}`,
      kind: "directory" as const,
      readerSupported: true,
    })),
  ]
  const childEntries = Array.from({ length: childEntryCount }, (_, index) => ({
    name: index === 0 ? "chapter-one" : `chapter-${index + 1}`,
    path: index === 0 ? "C:/books/series/chapter-one" : `C:/books/series/chapter-${index + 1}`,
    kind: "directory" as const,
    readerSupported: true,
  }))
  const root = directoryPage({
    path: "C:/books",
    entries: rootEntries,
    total: rootEntries.length,
  })
  const child = directoryPage({
    sessionId: "browser-inline",
    navigationEntryId: 2,
    path: "C:/books/series",
    parentPath: "C:/books",
    entries: childEntries,
    total: childEntries.length,
  })
  const client = {
    openDirectoryBrowser: vi.fn(async (path: string) => path === root.path ? root : child),
    closeDirectoryBrowser: vi.fn(async () => undefined),
    resolveFolderPenetration: vi.fn(async () => ({
      status: "branch" as const,
      originPath: "C:/books/series",
      chain: [],
      reason: "multiple-primary-items" as const,
      directDirectoryCount: 2,
    })),
  } as unknown as ReaderHttpClient

  const view = await render(
    <div style={{ width, height: 720 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 480, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath="C:/books"
          onOpen={vi.fn()}
          onGoTo={vi.fn()}
          folderView={{
            ...DEFAULT_FOLDER_VIEW,
            viewMode,
            penetration: { ...DEFAULT_FOLDER_VIEW.penetration, enabled: true, expandBranchesInline: true },
          }}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await expect.poll(() => document.querySelector<HTMLElement>('[data-folder-entry][data-folder-path="C:/books/series"]')).not.toBeNull()
  document.querySelector<HTMLElement>('[data-folder-entry][data-folder-path="C:/books/series"]')?.click()
  await expect.poll(() => document.querySelector('[data-folder-inline-branch="true"]')?.getAttribute("data-folder-inline-branch-path")).toBe("C:/books/series")
  return view
}

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
