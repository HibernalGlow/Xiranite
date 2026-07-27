import { expect, onTestFinished, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { VirtuosoMockContext } from "react-virtuoso"

import type {
  ReaderDirectoryPageDto,
  ReaderHttpClient,
  ReaderShellConfigDto,
} from "../../adapters/reader-http-client"
import { DEFAULT_FOLDER_VIEW } from "./cards/folder/FolderBrowserPane"
import { ReaderSidebar } from "./ReaderSidebar"
import type { ReaderPanelContext } from "./registry"

test("[neoview.folder.panel-thumbnail-keepalive-gui] keeps every File Card thumbnail across panel switches", async () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    name: `book-${index}.cbz`,
    path: `C:/books/book-${index}.cbz`,
    kind: "file" as const,
    readerSupported: true,
  }))
  const opened = directoryPage({ entries, total: entries.length })
  const thumbnails = createPixelThumbnailRegistration()
  onTestFinished(thumbnails.dispose)
  const probeThumbnail = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal("fetch", probeThumbnail)
  onTestFinished(() => vi.unstubAllGlobals())
  const openDirectoryBrowser = vi.fn(async () => opened)
  const releaseLibraryThumbnailContext = vi.fn(async () => undefined)
  const client = {
    openDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
    registerLibraryThumbnails: thumbnails.registerLibraryThumbnails,
    releaseLibraryThumbnailContext,
  } as unknown as ReaderHttpClient
  const context: ReaderPanelContext = {
    client,
    disabled: false,
    sourcePath: opened.path,
    folderView: { ...DEFAULT_FOLDER_VIEW, viewMode: "cover-list" },
    onGoTo: vi.fn(),
    onOpen: vi.fn(),
  }

  await render(
    <div style={{ height: 520, width: 420 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 420, itemHeight: 76 }}>
        <ReaderSidebar side="left" context={context} shell={shell()} />
      </VirtuosoMockContext.Provider>
    </div>,
  )

  await expect.poll(() => openDirectoryBrowser).toHaveBeenCalledOnce()
  await expect.poll(folderThumbnailCount).toBe(entries.length)
  await expect.poll(() => probeThumbnail).toHaveBeenCalledTimes(entries.length)
  const probesBeforePanelSwitch = probeThumbnail.mock.calls.length
  const folderCard = document.querySelector<HTMLElement>('[data-neoview-folder-card="true"]')
  expect(folderCard).toBeTruthy()

  await page.getByRole("button", { name: "页面列表", exact: true }).click()

  await expect.poll(() => document.querySelector('[data-reader-panel-cache="folder"]')?.getAttribute("data-reader-panel-active")).toBe("false")
  expect(folderCard?.isConnected).toBe(true)
  expect(folderThumbnailCount()).toBe(entries.length)
  expect(releaseLibraryThumbnailContext).not.toHaveBeenCalled()
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(probeThumbnail).toHaveBeenCalledTimes(probesBeforePanelSwitch)

  await page.getByRole("button", { name: "文件夹", exact: true }).click()

  await expect.poll(() => document.querySelector('[data-reader-panel-cache="folder"]')?.getAttribute("data-reader-panel-active")).toBe("true")
  await expect.poll(folderThumbnailCount).toBe(entries.length)
  expect(document.querySelector('[data-neoview-folder-card="true"]')).toBe(folderCard)
  expect(openDirectoryBrowser).toHaveBeenCalledOnce()
  expect(probeThumbnail).toHaveBeenCalledTimes(probesBeforePanelSwitch)
  expect(releaseLibraryThumbnailContext).not.toHaveBeenCalled()
})

function folderThumbnailCount(): number {
  return document.querySelectorAll('[data-reader-panel-cache="folder"] [data-folder-entry="true"] img[src^="blob:"]').length
}

function directoryPage(overrides: Partial<ReaderDirectoryPageDto> = {}): ReaderDirectoryPageDto {
  const sort = { field: "name" as const, order: "asc" as const, directoriesFirst: true }
  return {
    sessionId: "browser-panel-thumbnails",
    navigationEntryId: 1,
    path: "C:/books",
    parentPath: "C:/",
    entries: [],
    cursor: 0,
    total: 0,
    canGoBack: false,
    canGoForward: false,
    generation: 1,
    sort,
    sortFields: ["name"],
    metadataFields: [],
    metadataCapabilities: [],
    sortSource: "global-default",
    sortTemporary: false,
    globalDefaultSort: sort,
    tabDefaultSort: sort,
    watching: false,
    ...overrides,
  }
}

function shell(): ReaderShellConfigDto {
  return {
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height: "full", customHeight: 50, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    panelLayout: {
      pageList: { visible: true, order: 3, position: "left" },
      info: { visible: true, order: 0, position: "right" },
    },
    cardLayout: {
      "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
      "book-information": { panelId: "info", visible: true, expanded: true, order: 0 },
    },
  }
}

function createPixelThumbnailRegistration() {
  const urls = new Set<string>()
  return {
    registerLibraryThumbnails: vi.fn(async (contextId: string, generation: number, items: readonly { id: string; path: string }[]) => ({
      contextId,
      generation,
      items: items.map((item) => {
        const thumbnailUrl = URL.createObjectURL(new Blob([
          Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), (character) => character.charCodeAt(0)),
        ], { type: "image/gif" }))
        urls.add(thumbnailUrl)
        const managedUrl = `http://127.0.0.1:41000/reader/library/t/${item.id}?version=${encodeURIComponent(item.path)}&token=test`
        return { id: item.id, thumbnailUrl, thumbnailUrls: [managedUrl, thumbnailUrl], contentVersion: item.path }
      }),
    })),
    dispose: () => {
      for (const url of urls) URL.revokeObjectURL(url)
    },
  }
}
