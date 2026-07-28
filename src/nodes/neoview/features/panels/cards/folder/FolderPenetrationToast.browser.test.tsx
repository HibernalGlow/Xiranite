import { expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { VirtuosoMockContext } from "react-virtuoso"

import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import { ReaderSwitchToastHost } from "../../../switch-toast/ReaderSwitchToastHost"
import { createReaderSwitchToastStore } from "../../../switch-toast/ReaderSwitchToastStore"
import FolderMainCard from "../FolderMainCard"
import { DEFAULT_FOLDER_VIEW } from "./FolderBrowserPane"

test("[neoview.folder.penetration-toast-browser] reports a current resolver failure without replacing the file list", async () => {
  const root = directoryPage({
    entries: [{ name: "series", path: "C:/books/series", kind: "directory", readerSupported: true }],
    total: 1,
  })
  const switchToast = createReaderSwitchToastStore({ persist: async (settings) => settings })
  const client = {
    openDirectoryBrowser: vi.fn(async () => root),
    closeDirectoryBrowser: vi.fn(async () => undefined),
    resolveFolderPenetration: vi.fn(async () => {
      throw new Error("目录不存在或已断开。")
    }),
  } as unknown as ReaderHttpClient
  const view = await renderFolder(root, client, switchToast)

  await view.getByTitle("C:/books/series").click()

  await expect.poll(() => switchToast.getMessages()).toEqual([expect.objectContaining({
    title: "穿透解析失败",
    description: "目录不存在或已断开。",
  })])
  await expect.poll(() => document.querySelector('[data-reader-switch-toast="true"]')?.textContent).toContain("穿透解析失败")
  expect(document.querySelector('[data-neoview-folder-pane] [role="alert"]')).toBeNull()
  expect(document.querySelector('[data-folder-entry][data-folder-path="C:/books/series"]')).not.toBeNull()

  await view.unmount()
  switchToast.dispose()
})

test("[neoview.folder.penetration-toast-browser] suppresses a late resolver failure after another file opens", async () => {
  const root = directoryPage({
    entries: [
      { name: "series", path: "C:/books/series", kind: "directory", readerSupported: true },
      { name: "standalone.cbz", path: "C:/books/standalone.cbz", kind: "file", readerSupported: true },
    ],
    total: 2,
  })
  let rejectPenetration: ((cause: unknown) => void) | undefined
  const resolveFolderPenetration = vi.fn((_sessionId: string, _path: string, _policy: unknown, signal: AbortSignal) => (
    new Promise<never>((_resolve, reject) => {
      rejectPenetration = reject
      signal.addEventListener("abort", () => undefined, { once: true })
    })
  ))
  const switchToast = createReaderSwitchToastStore({ persist: async (settings) => settings })
  const onOpen = vi.fn()
  const client = {
    openDirectoryBrowser: vi.fn(async () => root),
    closeDirectoryBrowser: vi.fn(async () => undefined),
    resolveFolderPenetration,
  } as unknown as ReaderHttpClient
  const view = await renderFolder(root, client, switchToast, onOpen)

  await view.getByTitle("C:/books/series").click()
  await expect.poll(() => resolveFolderPenetration).toHaveBeenCalledOnce()
  await view.getByTitle("C:/books/standalone.cbz").click()
  await expect.poll(() => onOpen.mock.calls.at(-1)?.[0]).toBe("C:/books/standalone.cbz")
  await expect.poll(() => resolveFolderPenetration.mock.calls[0]?.[3].aborted).toBe(true)

  rejectPenetration?.(new Error("目录不存在或已断开。"))
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  expect(switchToast.getMessages()).toEqual([])
  expect(document.querySelector('[data-neoview-folder-pane] [role="alert"]')).toBeNull()

  await view.unmount()
  switchToast.dispose()
})

async function renderFolder(
  root: ReaderDirectoryPageDto,
  client: ReaderHttpClient,
  switchToast: ReturnType<typeof createReaderSwitchToastStore>,
  onOpen = vi.fn(),
) {
  return await render(
    <div style={{ width: 960, height: 720 }}>
      <ReaderSwitchToastHost port={switchToast} />
      <VirtuosoMockContext.Provider value={{ viewportHeight: 480, itemHeight: 34 }}>
        <FolderMainCard
          client={client}
          disabled={false}
          sourcePath={root.path}
          switchToast={switchToast}
          onOpen={onOpen}
          onGoTo={vi.fn()}
          folderView={{
            ...DEFAULT_FOLDER_VIEW,
            viewMode: "cover-list",
            penetration: { ...DEFAULT_FOLDER_VIEW.penetration, enabled: true },
          }}
        />
      </VirtuosoMockContext.Provider>
    </div>,
  )
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
