import { expect, onTestFinished, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { VirtuosoMockContext } from "react-virtuoso"
import { useRef, useState } from "react"

import type {
  ReaderDirectoryPageDto,
  ReaderHttpClient,
  ReaderLibraryThumbnailBatchDto,
} from "../../../../adapters/reader-http-client"
import FolderMainCard from "../FolderMainCard"
import { createDirectoryCatalog, type DirectoryCatalog } from "./DirectoryCatalog"
import { DEFAULT_FOLDER_VIEW } from "./FolderBrowserPane"
import { FolderThumbnailStore } from "./FolderThumbnailStore"
import { useFolderThumbnail } from "./useFolderThumbnail"
import { useFolderThumbnailPipeline } from "./useFolderThumbnailPipeline"

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

test("[neoview.folder.thumbnail-self-check-gui] retries a generating visible asset through TanStack Query", async () => {
  const path = "C:/books/generating.cbz"
  const thumbnailUrl = "http://127.0.0.1:41000/reader/library/t/generating?token=test"
  let finishGeneration: (() => void) | undefined
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "0" } }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => {
      finishGeneration = () => resolve(new Response(null, { status: 200 }))
    }))
  vi.stubGlobal("fetch", fetch)
  onTestFinished(() => vi.unstubAllGlobals())
  const store = new FolderThumbnailStore()
  store.replace(thumbnailSnapshot(path, thumbnailUrl))

  await render(<ThumbnailAvailability store={store} path={path} />)

  await expect.poll(() => fetch).toHaveBeenCalledTimes(2)
  await expect.poll(() => document.querySelector("[data-thumbnail-availability]")?.textContent).toBe("generating")
  expect(document.querySelector("[data-thumbnail-availability]")?.getAttribute("data-thumbnail-url")).toBe(thumbnailUrl)
  finishGeneration?.()

  await expect.poll(() => document.querySelector("[data-thumbnail-availability]")?.textContent).toBe("ready")
})

test("[neoview.folder.thumbnail-self-check-cancel-gui] cancels the query when the visible item unmounts", async () => {
  const path = "C:/books/leaving.cbz"
  const thumbnailUrl = "http://127.0.0.1:41000/reader/library/t/leaving?token=test"
  let probeSignal: AbortSignal | undefined
  const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    probeSignal = init?.signal as AbortSignal
    return new Promise<Response>((_resolve, reject) => {
      probeSignal?.addEventListener("abort", () => reject(probeSignal?.reason), { once: true })
    })
  })
  vi.stubGlobal("fetch", fetch)
  onTestFinished(() => vi.unstubAllGlobals())
  const store = new FolderThumbnailStore()
  store.replace(thumbnailSnapshot(path, thumbnailUrl))
  const rendered = await render(<ThumbnailAvailability store={store} path={path} />)
  await expect.poll(() => probeSignal).toBeInstanceOf(AbortSignal)

  rendered.unmount()

  expect(probeSignal?.aborted).toBe(true)
})

test("[neoview.folder.thumbnail-self-check-batch-gui] drains more than one backend registration batch", async () => {
  const entries = Array.from({ length: 30 }, (_, index) => ({
    name: `book-${index}.cbz`,
    path: `C:/books/book-${index}.cbz`,
    kind: "file" as const,
    readerSupported: true,
  }))
  const page = directoryPage({ entries, total: entries.length })
  const thumbnails = createPixelThumbnailRegistration()
  onTestFinished(thumbnails.dispose)
  const client = { registerLibraryThumbnails: thumbnails.registerLibraryThumbnails } as unknown as ReaderHttpClient

  await render(<ThumbnailDemandHarness client={client} page={page} />)

  await expect.poll(() => thumbnails.registerLibraryThumbnails).toHaveBeenCalledTimes(2)
  expect(thumbnails.registerLibraryThumbnails.mock.calls.map((call) => call[2].length)).toEqual([24, 6])
  expect(thumbnails.registerLibraryThumbnails.mock.calls.flatMap((call) => call[2].map((item) => item.path))).toEqual(
    entries.map((entry) => entry.path),
  )
  await expect.poll(() => document.querySelectorAll('[data-thumbnail-availability="ready"]').length).toBe(entries.length)
})

test("[neoview.folder.thumbnail-context-release-gui] replaces released managed URLs without probing them again", async () => {
  const path = "C:/books/released.cbz"
  const opened = directoryPage({
    entries: [{ name: "released.cbz", path, kind: "file", readerSupported: true }],
    total: 1,
  })
  const managedUrls = [
    "http://127.0.0.1:41000/reader/library/t/context-one?token=test",
    "http://127.0.0.1:41000/reader/library/t/context-two?token=test",
  ]
  let registration = 0
  const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number, items: readonly { id: string }[]) => {
    const thumbnailUrl = managedUrls[Math.min(registration, managedUrls.length - 1)]!
    registration += 1
    return { contextId, generation, items: items.map((item) => ({ id: item.id, thumbnailUrl })) }
  })
  const releaseLibraryThumbnailContext = vi.fn(async () => undefined)
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
  onTestFinished(() => vi.unstubAllGlobals())
  const client = { registerLibraryThumbnails, releaseLibraryThumbnailContext } as unknown as ReaderHttpClient

  await render(<ThumbnailContextReleaseHarness client={client} page={opened} />)

  await expect.poll(() => registerLibraryThumbnails).toHaveBeenCalledTimes(1)
  await expect.poll(() => document.querySelector("[data-thumbnail-availability]")?.getAttribute("data-thumbnail-url")).toBe(managedUrls[0])
  await expect.poll(() => fetchMock).toHaveBeenCalledTimes(1)

  document.querySelector<HTMLButtonElement>('button[aria-label="释放缩略图上下文"]')!.click()

  await expect.poll(() => releaseLibraryThumbnailContext).toHaveBeenCalledTimes(1)
  await expect.poll(() => registerLibraryThumbnails).toHaveBeenCalledTimes(2)
  await expect.poll(() => document.querySelector("[data-thumbnail-availability]")?.getAttribute("data-thumbnail-url")).toBe(managedUrls[1])
  await expect.poll(() => fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(managedUrls)
  expect(registerLibraryThumbnails.mock.calls.map(([contextId]) => contextId)).toEqual([
    "folder:browser-1:1",
    "folder:browser-1:2",
  ])
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

function ThumbnailAvailability({ store, path }: { store: FolderThumbnailStore; path: string }) {
  const thumbnail = useFolderThumbnail(store, path)
  return <span data-thumbnail-availability={thumbnail.availability} data-thumbnail-url={thumbnail.thumbnailUrl}>{thumbnail.availability}</span>
}

function ThumbnailDemandHarness({ client, page }: { client: ReaderHttpClient; page: ReaderDirectoryPageDto }) {
  const [catalog] = useState(() => createDirectoryCatalog(page))
  const catalogRef = useRef<DirectoryCatalog | undefined>(catalog)
  const visibleRangeRef = useRef({ startIndex: 0, endIndex: page.entries.length - 1 })
  const pipeline = useFolderThumbnailPipeline({
    client,
    catalog,
    catalogRef,
    thumbnailsVisible: true,
    viewMode: "cover-list",
    previewGridEnabled: false,
    previewCount: 4,
    visibleRangeRef,
    selectedPaths: new Set(),
  })
  return <>{page.entries.map((entry) => (
    <ThumbnailAvailability key={entry.path} store={pipeline.thumbnailStore} path={entry.path} />
  ))}</>
}

function ThumbnailContextReleaseHarness({ client, page }: { client: ReaderHttpClient; page: ReaderDirectoryPageDto }) {
  const [catalog] = useState(() => createDirectoryCatalog(page))
  const catalogRef = useRef<DirectoryCatalog | undefined>(catalog)
  const visibleRangeRef = useRef({ startIndex: 0, endIndex: 0 })
  const pipeline = useFolderThumbnailPipeline({
    client,
    catalog,
    catalogRef,
    thumbnailsVisible: true,
    viewMode: "cover-list",
    previewGridEnabled: false,
    previewCount: 4,
    visibleRangeRef,
    selectedPaths: new Set(),
  })
  return <>
    <button type="button" aria-label="释放缩略图上下文" onClick={pipeline.releaseContext} />
    <ThumbnailAvailability store={pipeline.thumbnailStore} path={page.entries[0]?.path} />
  </>
}

function thumbnailSnapshot(path: string, thumbnailUrl: string) {
  return {
    thumbnailUrls: new Map([[path, thumbnailUrl]]),
    thumbnailUrlSets: new Map([[path, [thumbnailUrl]]]),
    thumbnailProfiles: new Map(),
  }
}
