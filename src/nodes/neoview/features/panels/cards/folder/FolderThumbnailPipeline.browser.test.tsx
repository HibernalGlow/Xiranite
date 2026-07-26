import { expect, onTestFinished, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { VirtuosoMockContext } from "react-virtuoso"

import type {
  ReaderDirectoryPageDto,
  ReaderHttpClient,
  ReaderLibraryThumbnailBatchDto,
} from "../../../../adapters/reader-http-client"
import FolderMainCard from "../FolderMainCard"
import { DEFAULT_FOLDER_VIEW } from "./FolderBrowserPane"

test("[neoview.folder.thumbnail-response-gui] publishes every visible thumbnail when the backend registration returns without refreshing the directory", async () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    name: `book-${index}.cbz`,
    path: `C:/books/book-${index}.cbz`,
    kind: "file" as const,
    readerSupported: true,
  }))
  const opened = directoryPage({ entries, total: entries.length })
  const thumbnails = createPixelThumbnailRegistration()
  onTestFinished(thumbnails.dispose)
  let finishRegistration: (() => void) | undefined
  const registerLibraryThumbnails = vi.fn((contextId: string, generation: number, items: readonly { id: string; path: string }[]) => (
    new Promise<ReaderLibraryThumbnailBatchDto>((resolve, reject) => {
      finishRegistration = () => {
        void thumbnails.registerLibraryThumbnails(contextId, generation, items).then(resolve, reject)
      }
    })
  ))
  const navigateDirectoryBrowser = vi.fn()
  const client = {
    openDirectoryBrowser: vi.fn(async () => opened),
    navigateDirectoryBrowser,
    registerLibraryThumbnails,
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 900, height: 600 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 456, itemHeight: 76 }}>
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

  await expect.poll(() => registerLibraryThumbnails).toHaveBeenCalledOnce()
  expect(document.querySelectorAll('[data-folder-entry="true"] img')).toHaveLength(0)
  const renderer = document.querySelector('[data-folder-navigation-entry-id="1"]')

  finishRegistration?.()

  await expect.poll(() => document.querySelectorAll('[data-folder-entry="true"] img').length).toBe(entries.length)
  expect(registerLibraryThumbnails.mock.calls[0]?.[2].map((item) => item.path)).toEqual(entries.map((entry) => entry.path))
  expect(document.querySelector('[data-folder-navigation-entry-id="1"]')).toBe(renderer)
  expect(navigateDirectoryBrowser).not.toHaveBeenCalled()
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
        return { id: item.id, thumbnailUrl, contentVersion: item.path }
      }),
    })),
    dispose: () => {
      for (const url of urls) URL.revokeObjectURL(url)
    },
  }
}
