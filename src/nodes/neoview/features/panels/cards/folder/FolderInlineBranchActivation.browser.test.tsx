import { expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { VirtuosoMockContext } from "react-virtuoso"

import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderMainCard from "../FolderMainCard"
import { DEFAULT_FOLDER_VIEW } from "./FolderBrowserPane"

test("[neoview.folder.inline-branch-activation-browser] penetrates drawer folders and keeps nested branches on the root anchor", async () => {
  const root = directoryPage({
    entries: [
      { name: "series", path: "C:/books/series", kind: "directory", readerSupported: true },
      { name: "later", path: "C:/books/later", kind: "directory", readerSupported: true },
    ],
    total: 2,
  })
  const series = directoryPage({
    sessionId: "browser-inline-series",
    navigationEntryId: 2,
    path: "C:/books/series",
    parentPath: root.path,
    entries: [
      { name: "arc", path: "C:/books/series/arc", kind: "directory", readerSupported: true },
      { name: "bonus", path: "C:/books/series/bonus", kind: "directory", readerSupported: true },
    ],
    total: 2,
  })
  const arc = directoryPage({
    sessionId: "browser-inline-arc",
    navigationEntryId: 3,
    path: "C:/books/series/arc",
    parentPath: series.path,
    entries: [
      { name: "volume", path: "C:/books/series/arc/volume", kind: "directory", readerSupported: true },
      { name: "extras", path: "C:/books/series/arc/extras", kind: "directory", readerSupported: true },
    ],
    total: 2,
  })
  const terminalPath = "C:/books/series/arc/volume.cbz"
  const navigateDirectoryBrowser = vi.fn(async () => root)
  const resolveFolderPenetration = vi.fn(async (_sessionId: string, path: string) => {
    if (path === "C:/books/series/arc/volume") {
      return {
        status: "resolved" as const,
        originPath: path,
        terminal: { kind: "archive" as const, path: terminalPath },
        chain: [],
        reason: "archive" as const,
      }
    }
    return {
      status: "branch" as const,
      originPath: path,
      chain: [],
      reason: "multiple-primary-items" as const,
      directDirectoryCount: 2,
      directFileCount: 0,
    }
  })
  const openDirectoryBrowser = vi.fn(async (path: string) => {
    if (path === root.path) return root
    if (path === series.path) return series
    return arc
  })
  const onOpen = vi.fn()
  const client = {
    openDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
    navigateDirectoryBrowser,
    resolveFolderPenetration,
  } as unknown as ReaderHttpClient

  const view = await render(
    <div style={{ width: 960, height: 720 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 480, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath={root.path}
          onOpen={onOpen}
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

  await view.getByTitle(series.path).click()
  await expect.poll(() => document.body.textContent).toContain("arc")
  const rootAnchor = document.querySelector<HTMLElement>(`[data-folder-entry][data-folder-path="${series.path}"]`)
  if (!rootAnchor) throw new Error("Expected the root branch anchor")

  await view.getByTitle(arc.path).click()
  await expect.poll(() => document.querySelector('[data-folder-inline-branch="true"]')?.getAttribute("data-folder-inline-branch-path")).toBe(arc.path)
  await expect.poll(() => document.body.textContent).toContain("volume")
  const nestedDrawer = document.querySelector<HTMLElement>('[data-folder-inline-branch="true"]')
  expect(nestedDrawer?.parentElement).toBe(rootAnchor.parentElement)
  expect(openDirectoryBrowser).toHaveBeenCalledWith(arc.path, expect.any(AbortSignal), `folder-inline-branch:${arc.path}`)
  expect(navigateDirectoryBrowser).not.toHaveBeenCalled()

  await view.getByTitle("C:/books/series/arc/volume").click()
  await expect.poll(() => onOpen).toHaveBeenCalledWith(
    terminalPath,
    {
      browserOriginPath: root.path,
      browserOriginEntryPath: "C:/books/series/arc/volume",
      browserOriginTraversalFrames: [
        { directoryPath: root.path, currentEntryPath: series.path },
        { directoryPath: series.path, currentEntryPath: arc.path },
        { directoryPath: arc.path, currentEntryPath: "C:/books/series/arc/volume" },
      ],
    },
  )
  expect(resolveFolderPenetration.mock.calls.map((call) => call[1])).toEqual([
    series.path,
    arc.path,
    "C:/books/series/arc/volume",
  ])
  expect(navigateDirectoryBrowser).not.toHaveBeenCalled()
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
