import { beforeEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import {
  DEFAULT_NEOVIEW_SHELL_CONFIG,
  DEFAULT_READER_COLOR_FILTER,
  DEFAULT_READER_INPUT_BINDINGS,
  DEFAULT_READER_PAGE_TRANSITION,
  DEFAULT_READER_RADIAL_MENU_CONFIG,
} from "@xiranite/node-neoview/ui-core"

import type { ReaderDirectoryPageDto, ReaderHttpClient, ReaderRuntimeConfigDto, ReaderSessionDto } from "../adapters/reader-http-client"
import { ReaderApp } from "./ReaderApp"
import { useReaderWorkspaceRestoreStore } from "./ReaderWorkspaceRestoreStore"

beforeEach(() => {
  localStorage.clear()
  useReaderWorkspaceRestoreStore.getState().resetRestore()
})

test("[neoview.workspace.startup-mode-gui] renders swimlane before runtime config resolves", async () => {
  const config = vi.fn(() => new Promise<ReaderRuntimeConfigDto>(() => undefined))
  const client = { config } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp sessionScopeId="browser-startup-swimlane" client={client} />
    </div>,
  )

  expect(config).toHaveBeenCalledOnce()
  await expect.poll(() => document.querySelector('[data-neoview-workspace-mode="swimlane"]')).not.toBeNull()
  await expect.poll(() => document.querySelector('[data-reader-workspace-loading="true"]')).toBeNull()
  await expect.element(page.getByRole("button", { name: "四边栏模式" })).toBeVisible()
})

test("[neoview.workspace.startup-mode-gui] keeps the fallback swimlane usable when runtime config hangs", async () => {
  const opened = readerSession()
  const open = vi.fn(async () => opened)
  const client = {
    config: vi.fn(() => new Promise<ReaderRuntimeConfigDto>(() => undefined)),
    open,
    close: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp sessionScopeId="browser-startup-swimlane-open" initialPath="D:/books/demo.cbz" client={client} />
    </div>,
  )

  await page.getByRole("button", { name: "打开书籍" }).click()

  await expect.poll(() => open).toHaveBeenCalledOnce()
  await expect.element(page.getByRole("img", { name: "001.jpg" })).toBeVisible()
  expect(document.querySelector('[data-neoview-workspace-mode="swimlane"]')).not.toBeNull()
  expect(document.querySelector('[data-reader-workspace-loading="true"]')).toBeNull()
})

test("[neoview.startup-restore.gui] opens the latest book without an explicit launch target", async () => {
  const open = vi.fn(async () => readerSession({
    displayName: "latest.cbz",
    readerSourcePath: "D:/books/latest.cbz",
  }))
  const startupState = vi.fn(async () => ({
    lastFolder: { path: "D:/books", updatedAt: 1 },
    lastBook: {
      bookId: "latest-book",
      source: { kind: "archive" as const, path: "D:/books/latest.cbz" },
      displayName: "latest.cbz",
      pageIndex: 3,
      pageCount: 12,
      updatedAt: 2,
    },
  }))
  const client = {
    config: vi.fn(async () => deleteNextRuntimeConfig()),
    startupState,
    open,
    close: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp sessionScopeId="browser-startup-restore" client={client} />
    </div>,
  )

  await expect.poll(() => startupState).toHaveBeenCalledWith(expect.any(AbortSignal))
  await expect.poll(() => open).toHaveBeenCalledWith("D:/books/latest.cbz", expect.any(AbortSignal), undefined)
  await expect.element(page.getByRole("img", { name: "001.jpg" })).toBeVisible()
})

test("[neoview.external-launch.gui] opens an external target and reports the accepted request only after Reader opens it", async () => {
  const open = vi.fn(async () => readerSession())
  const startupState = vi.fn(async () => ({ lastFolder: null, lastBook: null }))
  const onExternalOpenResult = vi.fn()
  const client = {
    config: vi.fn(async () => deleteNextRuntimeConfig()),
    startupState,
    open,
    close: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp
        sessionScopeId="browser-external-launch"
        client={client}
        externalOpenRequest={{ requestId: "launch-1", path: "D:/books/external.cbz", kind: "file" }}
        onExternalOpenResult={onExternalOpenResult}
      />
    </div>,
  )

  await expect.poll(() => open).toHaveBeenCalledWith("D:/books/external.cbz", expect.any(AbortSignal), undefined)
  await expect.element(page.getByRole("img", { name: "001.jpg" })).toBeVisible()
  await expect.poll(() => onExternalOpenResult).toHaveBeenCalledWith({ requestId: "launch-1", opened: true })
  expect(startupState).not.toHaveBeenCalled()
})

test("[neoview.external-launch.gui] routes an external directory to Folder without creating a Reader session", async () => {
  const open = vi.fn(async () => readerSession())
  const directory = deferred<ReaderDirectoryPageDto>()
  const openDirectoryBrowser = vi.fn(() => directory.promise)
  const onExternalOpenResult = vi.fn()
  const client = {
    config: vi.fn(async () => deleteNextRuntimeConfig()),
    open,
    openDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp
        sessionScopeId="browser-external-directory"
        client={client}
        externalOpenRequest={{ requestId: "launch-directory", path: "D:/books/library", kind: "directory" }}
        onExternalOpenResult={onExternalOpenResult}
      />
    </div>,
  )

  await expect.poll(() => openDirectoryBrowser).toHaveBeenCalledWith(
    "D:/books/library",
    expect.any(AbortSignal),
    undefined,
    true,
  )
  expect(onExternalOpenResult).not.toHaveBeenCalled()
  directory.resolve(directoryPage({ path: "D:/books/library" }))
  await expect.poll(() => onExternalOpenResult).toHaveBeenCalledWith({ requestId: "launch-directory", opened: true })
  expect(open).not.toHaveBeenCalled()
})

test("[neoview.external-launch.gui] mounts Folder for an external directory even when the left edge is disabled", async () => {
  const directory = deferred<ReaderDirectoryPageDto>()
  const openDirectoryBrowser = vi.fn(() => directory.promise)
  const onExternalOpenResult = vi.fn()
  const runtimeConfig = deleteNextRuntimeConfig()
  runtimeConfig.shell.edges.left.enabled = false
  runtimeConfig.shell.workspace.mode = "edges"
  const client = {
    config: vi.fn(async () => runtimeConfig),
    openDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp
        sessionScopeId="browser-external-directory-closed-left-edge"
        client={client}
        externalOpenRequest={{ requestId: "launch-directory-closed-left-edge", path: "D:/books/library", kind: "directory" }}
        onExternalOpenResult={onExternalOpenResult}
      />
    </div>,
  )

  await expect.poll(() => openDirectoryBrowser).toHaveBeenCalledWith(
    "D:/books/library",
    expect.any(AbortSignal),
    undefined,
    true,
  )
  directory.resolve(directoryPage({ path: "D:/books/library" }))
  await expect.poll(() => onExternalOpenResult).toHaveBeenCalledWith({ requestId: "launch-directory-closed-left-edge", opened: true })
})

test("[neoview.external-launch.gui] mounts Folder in swimlane mode before deferred sidebars become idle", async () => {
  const directory = deferred<ReaderDirectoryPageDto>()
  const openDirectoryBrowser = vi.fn(() => directory.promise)
  const onExternalOpenResult = vi.fn()
  const runtimeConfig = deleteNextRuntimeConfig()
  runtimeConfig.shell.workspace.mode = "swimlane"
  vi.stubGlobal("requestIdleCallback", vi.fn(() => 0))
  try {
    const client = {
      config: vi.fn(async () => runtimeConfig),
      openDirectoryBrowser,
      closeDirectoryBrowser: vi.fn(async () => undefined),
    } as unknown as ReaderHttpClient

    await render(
      <div style={{ width: 1200, height: 800 }}>
        <ReaderApp
          sessionScopeId="browser-external-directory-swimlane-deferred"
          client={client}
          externalOpenRequest={{ requestId: "launch-directory-swimlane-deferred", path: "D:/books/library", kind: "directory" }}
          onExternalOpenResult={onExternalOpenResult}
        />
      </div>,
    )

    await expect.poll(() => openDirectoryBrowser).toHaveBeenCalledWith(
      "D:/books/library",
      expect.any(AbortSignal),
      undefined,
      true,
    )
    directory.resolve(directoryPage({ path: "D:/books/library" }))
    await expect.poll(() => onExternalOpenResult).toHaveBeenCalledWith({ requestId: "launch-directory-swimlane-deferred", opened: true })
  } finally {
    vi.unstubAllGlobals()
  }
})

test("[neoview.external-launch.gui] opens an external directory after Reader is already displaying a file", async () => {
  const directory = deferred<ReaderDirectoryPageDto>()
  const open = vi.fn(async () => readerSession())
  const openDirectoryBrowser = vi.fn(() => directory.promise)
  const onExternalOpenResult = vi.fn()
  const runtimeConfig = deleteNextRuntimeConfig()
  runtimeConfig.shell.workspace.swimlane.lanes.left.activePanelId = "pageList"
  const client = {
    config: vi.fn(async () => runtimeConfig),
    open,
    openDirectoryBrowser,
    closeDirectoryBrowser: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  const view = await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp
        sessionScopeId="browser-external-directory-after-reader"
        initialPath="D:/books/current.cbz"
        client={client}
        onExternalOpenResult={onExternalOpenResult}
      />
    </div>,
  )

  await page.getByRole("button", { name: "打开书籍" }).click()
  await expect.element(page.getByRole("img", { name: "001.jpg" })).toBeVisible()

  await view.rerender(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp
        sessionScopeId="browser-external-directory-after-reader"
        initialPath="D:/books/current.cbz"
        client={client}
        externalOpenRequest={{ requestId: "launch-directory-after-reader", path: "D:/books/next-library", kind: "directory" }}
        onExternalOpenResult={onExternalOpenResult}
      />
    </div>,
  )

  await expect.poll(() => openDirectoryBrowser).toHaveBeenCalledWith(
    "D:/books/next-library",
    expect.any(AbortSignal),
    undefined,
    true,
  )
  expect(onExternalOpenResult).not.toHaveBeenCalled()
  directory.resolve(directoryPage({ path: "D:/books/next-library" }))
  await expect.poll(() => onExternalOpenResult).toHaveBeenCalledWith({ requestId: "launch-directory-after-reader", opened: true })
  expect(open).toHaveBeenCalledOnce()
})

test("[neoview.viewer.cursor-auto-hide-config-gui] applies the configured keyboard wake behavior to the reader viewport", async () => {
  const runtimeConfig = deleteNextRuntimeConfig()
  runtimeConfig.viewDefaults = {
    ...runtimeConfig.viewDefaults,
    mouseCursor: {
      autoHide: true,
      hideDelay: 0,
      showMovementThreshold: 26,
      showOnButtonClick: false,
      showOnKeyDown: true,
      showOnWheel: false,
    },
  }
  const config = vi.fn(async () => runtimeConfig)
  const client = {
    config,
    open: vi.fn(async () => readerSession()),
    close: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp sessionScopeId="browser-cursor-auto-hide" initialPath="D:/books/demo.cbz" client={client} />
    </div>,
  )

  await expect.poll(() => config).toHaveBeenCalledOnce()
  await page.getByRole("button", { name: "打开书籍" }).click()
  await expect.element(page.getByRole("img", { name: "001.jpg" })).toBeVisible()
  const viewport = document.querySelector<HTMLElement>("[data-reader-frame-viewport]")!

  viewport.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, clientX: 10, clientY: 10 }))
  await expect.poll(() => viewport.dataset.readerCursorHidden).toBe("true")
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))
  expect(viewport.dataset.readerCursorHidden).toBeUndefined()
})

test("[neoview.workspace.startup-cache-gui] restores the cached layout before runtime config resolves", async () => {
  const cached = structuredClone(DEFAULT_NEOVIEW_SHELL_CONFIG)
  cached.workspace.mode = "edges"
  cached.sidebars.left.width = 417
  useReaderWorkspaceRestoreStore.getState().cacheShellSnapshot(cached)
  const client = { config: vi.fn(() => new Promise<ReaderRuntimeConfigDto>(() => undefined)) } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp sessionScopeId="browser-startup-cached-edges" client={client} />
    </div>,
  )

  await expect.poll(() => document.querySelector('[data-neoview-workspace-mode="edges"]')).not.toBeNull()
  expect(document.querySelector('[data-neoview-workspace-mode="swimlane"]')).toBeNull()
  expect(document.querySelector('[data-reader-workspace-loading="true"]')).toBeNull()
  await expect.element(page.getByRole("button", { name: "泳道模式" })).toBeVisible()
})

test("[neoview.workspace.startup-cache-race-gui] keeps a startup edit when the initial config response arrives late", async () => {
  let resolveInitial!: (value: ReaderRuntimeConfigDto) => void
  const cached = structuredClone(DEFAULT_NEOVIEW_SHELL_CONFIG)
  cached.workspace.mode = "swimlane"
  useReaderWorkspaceRestoreStore.getState().cacheShellSnapshot(cached)
  const stale = { ...deleteNextRuntimeConfig(), shell: structuredClone(cached) }
  const updatedShell = structuredClone(cached)
  updatedShell.revision = 1
  updatedShell.workspace.mode = "edges"
  const config = vi.fn()
    .mockImplementationOnce(() => new Promise<ReaderRuntimeConfigDto>((resolve) => { resolveInitial = resolve }))
    .mockResolvedValue({ ...stale, shell: updatedShell })
  const updateShellControl = vi.fn(async () => updatedShell)
  const client = { config, updateShellControl } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp sessionScopeId="browser-startup-cache-race" client={client} />
    </div>,
  )

  await page.getByRole("button", { name: "四边栏模式" }).click()
  await expect.poll(() => document.querySelector('[data-neoview-workspace-mode="edges"]')).not.toBeNull()
  resolveInitial(stale)

  await expect.poll(() => config).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[data-neoview-workspace-mode="edges"]')).not.toBeNull()
  expect(useReaderWorkspaceRestoreStore.getState().shellSnapshot?.workspace?.mode).toBe("edges")
})

test("[neoview.bindings.file-delete-next-gui] uses each adjacent book's activation identity across repeated delete-next commands", async () => {
  const opened = readerSession({
    readerSourcePath: "D:/books/series-a/deep/001.jpg",
    activatedEntryPath: "D:/books/series-a",
  })
  const replacement = readerSession({
    sessionId: "reader-browser-2",
    bookId: "book-browser-2",
    displayName: "series-b",
    pageId: "page-browser-2",
    pageName: "002.jpg",
    readerSourcePath: "D:/books/series-b/deep/002.jpg",
    activatedEntryPath: "D:/books/series-b",
  })
  const trailing = readerSession({
    sessionId: "reader-browser-3",
    bookId: "book-browser-3",
    displayName: "series-c.cbz",
    pageId: "page-browser-3",
    pageName: "003.jpg",
  })
  const replacements = [replacement, trailing]
  const openAdjacentBook = vi.fn(async () => replacements.shift())
  let releaseFirstDelete!: () => void
  const firstDeleteGate = new Promise<void>((resolve) => { releaseFirstDelete = resolve })
  const executeFileOperations = vi.fn(async (operations: [{ kind: "trash"; sourcePath: string }]) => {
    if (operations[0].sourcePath === "D:/books/series-a") await firstDeleteGate
    return {
      results: [{ index: 0, operation: operations[0], status: "succeeded" as const }],
      succeeded: 1, failed: 0, cancelled: 0, undoable: 1, undoId: "browser-delete",
    }
  })
  const client = {
    config: vi.fn(async () => deleteNextRuntimeConfig()),
    open: vi.fn(async () => opened),
    openAdjacentBook,
    executeFileOperations,
    close: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp sessionScopeId="browser-delete-next" initialPath="D:/books/series-a/deep/001.jpg" client={client} />
    </div>,
  )

  await page.getByRole("button", { name: "打开书籍" }).click()
  await expect.element(page.getByRole("img", { name: "001.jpg" })).toBeVisible()

  document.querySelector<HTMLElement>("[data-reader-app]")!.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    code: "Delete",
    key: "Delete",
  }))

  await expect.poll(() => openAdjacentBook).toHaveBeenCalledWith("reader-browser-1", "next", expect.any(AbortSignal))
  await expect.poll(() => executeFileOperations).toHaveBeenCalledWith(
    [{ kind: "trash", sourcePath: "D:/books/series-a" }],
    true,
    expect.any(AbortSignal),
  )
  await expect.poll(() => document.querySelector('[data-reader-operation-busy="true"]')).not.toBeNull()
  releaseFirstDelete()
  await expect.element(page.getByRole("img", { name: "002.jpg" })).toBeVisible()

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  document.querySelector<HTMLElement>("[data-reader-app]")!.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    code: "Delete",
    key: "Delete",
  }))

  await expect.poll(() => openAdjacentBook).toHaveBeenNthCalledWith(2, "reader-browser-2", "next", expect.any(AbortSignal))
  await expect.poll(() => executeFileOperations).toHaveBeenNthCalledWith(
    2,
    [{ kind: "trash", sourcePath: "D:/books/series-b" }],
    true,
    expect.any(AbortSignal),
  )
  await expect.element(page.getByRole("img", { name: "003.jpg" })).toBeVisible()
})

function readerSession({
  sessionId = "reader-browser-1",
  bookId = "book-browser-1",
  displayName = "demo.cbz",
  pageId = "page-browser-1",
  pageName = "001.jpg",
  readerSourcePath = `D:/books/${displayName}`,
  activatedEntryPath = readerSourcePath,
  traversalRootPath = "D:/books",
}: {
  sessionId?: string
  bookId?: string
  displayName?: string
  pageId?: string
  pageName?: string
  readerSourcePath?: string
  activatedEntryPath?: string
  traversalRootPath?: string
} = {}): ReaderSessionDto {
  return {
    sessionId,
    activationIdentity: { readerSourcePath, activatedEntryPath, traversalRootPath },
    book: { id: bookId, displayName, pageCount: 1 },
    frame: {
      generation: 0,
      anchorPageIndex: 0,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId, pageIndex: 0, side: "single" }],
      pageCount: 1,
      atStart: true,
      atEnd: true,
    },
    visiblePages: [{
      id: pageId,
      index: 0,
      name: pageName,
      mediaKind: "image",
      mimeType: "image/gif",
      byteLength: 43,
      contentVersion: "browser-v1",
      assetUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    }],
  }
}

function directoryPage(overrides: Partial<ReaderDirectoryPageDto> = {}): ReaderDirectoryPageDto {
  return {
    sessionId: "browser-directory-1",
    navigationEntryId: 1,
    path: "D:/books/library",
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function deleteNextRuntimeConfig(): ReaderRuntimeConfigDto {
  const inputBindings = structuredClone(DEFAULT_READER_INPUT_BINDINGS)
  inputBindings.bindings.push({
    id: "delete-current-browser",
    action: "file.delete-current",
    followUpActions: ["reader.next-book"],
    context: "reader",
    enabled: true,
    input: { device: "keyboard", code: "Delete" },
  })
  return {
    shell: structuredClone(DEFAULT_NEOVIEW_SHELL_CONFIG),
    viewDefaults: { fitMode: "fit", pageMode: "single" },
    book: { lockedSortMode: null, lockedMediaPriority: null, lockedReadingDirection: null },
    sessionOptions: { tailOverflow: "stay-on-last-page" },
    pageList: { viewMode: "list", followProgress: true },
    bookmarkList: { activeListId: "all" },
    historyList: { viewMode: "compact" },
    folderView: {
      homePath: "",
      viewMode: "compact",
      previewCount: 4,
      titleWrap: { compact: false, "cover-list": false, "mosaic-list": false, details: false, "cover-grid": true, "mosaic-grid": false },
      showHiddenFolders: false,
      confirmations: { trash: false, permanentDelete: true, batchTrash: false, batchPermanentDelete: true },
      penetration: { enabled: false, showInternalFiles: true, internalItemsMode: "single", maxDepth: 3, terminalTargets: ["archive", "document", "media-directory", "file"] },
      details: {
        columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
        hiddenColumns: [],
        pinnedLeft: ["name"],
        pinnedRight: [],
        columnWidths: { name: 240, path: 320, type: 110, extension: 100, size: 120, modifiedAt: 180, dimensions: 120, pageCount: 100, rating: 100, tags: 220 },
      },
      search: { includeSubfolders: true, showHistoryOnFocus: true, searchInPath: false },
      tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] },
    },
    slideshow: { intervalSeconds: 5, loop: false, random: false, fadeTransition: true },
    colorFilter: structuredClone(DEFAULT_READER_COLOR_FILTER),
    pageTransition: structuredClone(DEFAULT_READER_PAGE_TRANSITION),
    inputBindings,
    radialMenu: structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG),
    media: {
      supportedImageFormats: [],
      videoFormats: [],
      mediaMimeTypes: {},
      autoPlayAnimatedImages: true,
      animatedVideoEnabled: false,
      animatedVideoKeywords: ["[#dyna]"],
      videoControlsPinned: false,
      videoMinPlaybackRate: 0.25,
      videoMaxPlaybackRate: 16,
      videoPlaybackRateStep: 0.25,
      subtitle: { fontSize: 1, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
    },
    systemMonitor: { enabled: false, pollIntervalMs: 1_000, historySeconds: 60 },
  }
}
