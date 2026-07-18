import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ResourceSchedulerService } from "@xiranite/services"

import { createZipFixture, type ZipFixture } from "../../../test/fixture-builders/create-zip-fixture.js"
import { ReaderAssetRoute } from "./ReaderAssetRoute.js"
import { ReaderHttpController, type ReaderSessionDto } from "./ReaderHttpController.js"
import type { ReaderPresentationDiskCache } from "../../ports/ReaderPresentationDiskCache.js"
import { DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG } from "../../application/config/ReaderRuntimeConfig.js"
import {
  DEFAULT_READER_COLOR_FILTER,
  normalizeReaderColorFilter,
} from "../../domain/color-filter/ReaderColorFilter.js"
import type { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"

const cleanupDirectories: string[] = []
const cleanupArchives: ZipFixture[] = []
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
)

afterEach(async () => {
  await Promise.all(cleanupArchives.splice(0).map((fixture) => fixture.cleanup()))
  await Promise.all(cleanupDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("ReaderHttpController", () => {
  it("[neoview.library.bookmark-update-auth] protects and wires bookmark PATCH through the root controller", async () => {
    const updateBookmark = vi.fn(async () => ({
      id: "bookmark-1",
      source: { kind: "archive" as const, path: "D:/demo.cbz" },
      name: "Demo",
      kind: "file" as const,
      starred: false,
      createdAt: 1,
      updatedAt: 2,
      listIds: ["default"],
    }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      libraryService: { updateBookmark } as unknown as ReaderLibraryService,
    })
    try {
      const unauthorized = new Request("http://127.0.0.1:41000/reader/library/bookmarks/bookmark-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ starred: false }),
      })
      expect((await controller.handle(unauthorized))?.status).toBe(401)
      expect(updateBookmark).not.toHaveBeenCalled()
      const response = (await controller.handle(authorizedRequest("/reader/library/bookmarks/bookmark-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ starred: false, listIds: ["default"] }),
      })))!
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ id: "bookmark-1", starred: false, listIds: ["default"] })
      expect(updateBookmark).toHaveBeenCalledWith("bookmark-1", { starred: false, listIds: ["default"] }, expect.any(AbortSignal))
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.diagnostics.http] exposes an authenticated, path-free runtime snapshot", async () => {
    const scheduler = new ResourceSchedulerService()
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      resourceScheduler: scheduler,
    })
    try {
      expect((await controller.handle(new Request("http://127.0.0.1:41000/reader/diagnostics")))?.status).toBe(401)
      const response = (await controller.handle(authorizedRequest("/reader/diagnostics")))!
      expect(response.status).toBe(200)
      const snapshot = await response.json()
      expect(snapshot).toMatchObject({
        schemaVersion: 1,
        reader: { activeSessions: 0 },
        assets: {
          activeTransformFlights: 0,
          presentation: { entries: 0, bytes: 0 },
          thumbnails: { activeFlights: 0, queuedFlights: 0, runningFlights: 0 },
        },
        presentationDiskCache: { enabled: false },
        solidArchiveCache: { entries: 0, retainedBytes: 0 },
        scheduler: { cpu: { active: 0, queued: 0 }, io: { active: 0, queued: 0 }, gpu: { active: 0, queued: 0 } },
      })
      expect(JSON.stringify(snapshot)).not.toContain("D:/")
      expect(JSON.stringify(snapshot)).not.toContain("reader-token")
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.cache.l3-maintenance-http] exposes authenticated stats, cleanup and clear operations", async () => {
    const base = {
      entries: 3, bytes: 30, maxBytes: 100, maxEntryBytes: 20, activeLeases: 0,
      hits: 4, misses: 2, writes: 3, rejectedWrites: 0, evictions: 1, integrityFailures: 0,
    }
    const cleanup = vi.fn(async (reason = "explicit") => ({
      ...base, reason, removedEntries: 1, removedBytes: 10, durationMs: 2,
    }))
    const clear = vi.fn(async () => ({
      ...base, entries: 0, bytes: 0, reason: "explicit" as const, removedEntries: 3, removedBytes: 30, durationMs: 3,
    }))
    const close = vi.fn(async () => undefined)
    const diskCache: ReaderPresentationDiskCache = {
      maxEntryBytes: 20,
      acquire: vi.fn(async () => undefined),
      put: vi.fn(async () => true),
      invalidate: vi.fn(async () => undefined),
      snapshot: vi.fn(async () => base),
      cleanup,
      clear,
      close,
      [Symbol.asyncDispose]: close,
    }
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      presentationDiskCache: diskCache,
      disposePresentationDiskCache: true,
    })
    expect((await controller.handle(new Request("http://127.0.0.1:41000/reader/cache/presentation")))?.status).toBe(401)
    expect(await (await controller.handle(authorizedRequest("/reader/cache/presentation")))!.json()).toEqual({ enabled: true, ...base })
    expect(await (await controller.handle(jsonRequest(
      "/reader/cache/presentation/cleanup",
      { reason: "age" },
    )))!.json()).toMatchObject({ reason: "age", removedEntries: 1 })
    expect(cleanup).toHaveBeenCalledWith("age")
    expect((await controller.handle(jsonRequest(
      "/reader/cache/presentation/cleanup",
      { reason: "destroy-everything" },
    )))?.status).toBe(400)
    expect(await (await controller.handle(authorizedRequest(
      "/reader/cache/presentation",
      { method: "DELETE" },
    )))!.json()).toMatchObject({ entries: 0, removedEntries: 3 })
    expect(clear).toHaveBeenCalledOnce()
    await controller[Symbol.asyncDispose]()
    expect(close).toHaveBeenCalledOnce()
  })

  it("[neoview.settings.shell-http] protects and returns only normalized shell settings", async () => {
    const updateViewDefaults = vi.fn(async (patch) => ({
      fitMode: patch.viewDefaults.fitMode ?? "fit-height" as const,
      pageMode: patch.viewDefaults.pageMode ?? "single" as const,
    }))
    const updateHistoryList = vi.fn(async (patch) => ({
      viewMode: patch.historyList.viewMode ?? "compact" as const,
    }))
    const updateBookmarkList = vi.fn(async (patch) => ({
      activeListId: patch.bookmarkList.activeListId ?? "all",
    }))
    const updatePageList = vi.fn(async (patch) => ({
      viewMode: patch.pageList.viewMode ?? "list" as const,
      followProgress: patch.pageList.followProgress ?? true,
    }))
    const updateSlideshow = vi.fn(async (patch) => ({
      intervalSeconds: patch.slideshow.intervalSeconds ?? 5,
      loop: patch.slideshow.loop ?? false,
      random: patch.slideshow.random ?? true,
      fadeTransition: patch.slideshow.fadeTransition ?? true,
    }))
    const updateFolderView = vi.fn(async (patch) => ({
      viewMode: patch.folderView.viewMode ?? "compact" as const,
      previewCount: patch.folderView.previewCount ?? 4 as const,
      details: {
        columnOrder: patch.folderView.details?.columnOrder ?? ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
        hiddenColumns: patch.folderView.details?.hiddenColumns ?? [],
        pinnedLeft: patch.folderView.details?.pinnedLeft ?? ["name"],
        pinnedRight: patch.folderView.details?.pinnedRight ?? [],
        columnWidths: {
          ...DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.details.columnWidths,
          ...patch.folderView.details?.columnWidths,
        },
      },
      search: {
        ...DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search,
        ...patch.folderView.search,
      },
      emptyArea: {
        ...DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea,
        ...patch.folderView.emptyArea,
      },
    }))
    const updateShellOptions = vi.fn(async (patch) => ({
      showDelayMs: 50,
      hideDelayMs: 200,
      opacity: { top: 80, bottom: 70, sidebar: 60 },
      blur: { top: 1, bottom: 2, sidebar: 3 },
      floatingControl: { enabled: true, position: { x: 100, y: 100 } },
      edges: {
        top: { enabled: true, initialVisible: false, pinned: false, triggerSize: 4, lockMode: "auto" as const },
        right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 5, lockMode: "auto" as const },
        bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 6, lockMode: "auto" as const },
        left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 7, lockMode: "auto" as const },
      },
      sidebars: {
        left: { width: "side" in patch && patch.side === "left" && patch.width ? patch.width : 333, height: "half" as const, customHeight: 100, verticalAlign: 50, horizontalPosition: 0 },
        right: { width: 277, height: "full" as const, customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      },
      panelLayout: {},
      cardLayout: {
        "page-navigation": { panelId: "pageList", visible: true, expanded: "cardId" in patch ? patch.expanded ?? true : true, order: 0 },
      },
    }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      shellOptions: {
        showDelayMs: 50,
        hideDelayMs: 200,
        opacity: { top: 80, bottom: 70, sidebar: 60 },
        blur: { top: 1, bottom: 2, sidebar: 3 },
        floatingControl: { enabled: true, position: { x: 100, y: 100 } },
        edges: {
          top: { enabled: true, initialVisible: false, pinned: false, triggerSize: 4, lockMode: "auto" },
          right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 5, lockMode: "auto" },
          bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 6, lockMode: "auto" },
          left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 7, lockMode: "auto" },
        },
        sidebars: {
          left: { width: 333, height: "half", customHeight: 100, verticalAlign: 50, horizontalPosition: 0 },
          right: { width: 277, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
        },
      },
      updateShellOptions,
      viewDefaults: { fitMode: "fit-height", pageMode: "single" },
      updateViewDefaults,
      pageList: { viewMode: "list", followProgress: true },
      updatePageList,
      bookmarkList: { activeListId: "all" },
      updateBookmarkList,
      historyList: { viewMode: "compact" },
      updateHistoryList,
      folderView: {
        viewMode: "compact",
        previewCount: 4,
        details: { ...DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.details },
        search: { ...DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search },
        emptyArea: { ...DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea },
      },
      updateFolderView,
      slideshow: { intervalSeconds: 8, loop: false, random: true, fadeTransition: true },
      updateSlideshow,
    })
    try {
      expect((await controller.handle(new Request("http://127.0.0.1:41000/reader/config")))?.status).toBe(401)
      const response = (await controller.handle(authorizedRequest("/reader/config")))!
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({
        schemaVersion: 1,
        shell: { revision: 0, showDelayMs: 50, sidebars: { left: { width: 333 } } },
        viewDefaults: { fitMode: "fit-height", pageMode: "single" },
        pageList: { viewMode: "list", followProgress: true },
        bookmarkList: { activeListId: "all" },
        historyList: { viewMode: "compact" },
        folderView: { viewMode: "compact", previewCount: 4, details: { pinnedLeft: ["name"] } },
        slideshow: { intervalSeconds: 8, loop: false, random: true, fadeTransition: true },
      })
      expect(body).not.toHaveProperty("token")
      expect(JSON.stringify(body)).not.toMatch(/password|sourcePath/i)
      const patched = (await controller.handle(jsonRequest("/reader/config", { side: "left", width: 401 }, true, "PATCH")))!
      expect(patched.status).toBe(200)
      expect(await patched.json()).toMatchObject({ shell: { sidebars: { left: { width: 401 } } } })
      expect(updateShellOptions).toHaveBeenCalledWith(
        { side: "left", width: 401 },
        { panels: { sidebars: { left: { width: 401 } } } },
      )
      expect((await controller.handle(jsonRequest("/reader/config", { side: "left", width: 999 }, true, "PATCH")))?.status).toBe(400)
      const cardPatched = (await controller.handle(jsonRequest("/reader/config", { cardId: "page-navigation", expanded: false }, true, "PATCH")))!
      expect(await cardPatched.json()).toMatchObject({ shell: { cardLayout: { "page-navigation": { expanded: false } } } })
      expect(updateShellOptions).toHaveBeenLastCalledWith(
        { cardId: "page-navigation", expanded: false },
        { panels: { card_state: { "page-navigation": { expanded: false } } } },
      )
      const shellControl = {
        expectedRevision: 2,
        shellControl: {
          floating: { enabled: false, position: { x: 220, y: 140 } },
          edges: { right: { pinned: true, triggerSize: 18, lockMode: "locked-open" } },
        },
      }
      const controlPatched = (await controller.handle(jsonRequest("/reader/config", shellControl, true, "PATCH")))!
      expect(controlPatched.status).toBe(200)
      expect(await controlPatched.json()).toMatchObject({ shell: { revision: 3 } })
      expect(updateShellOptions).toHaveBeenLastCalledWith(shellControl, { panels: {
        sidebar_control: { enabled: false, position: { x: 220, y: 140 } },
        edges: { right: { pinned: true, trigger_size: 18, lock_mode: "locked-open" } },
      } })
      const staleControl = (await controller.handle(jsonRequest("/reader/config", shellControl, true, "PATCH")))!
      expect(staleControl.status).toBe(409)
      expect(await staleControl.json()).toMatchObject({ shell: { revision: 3 } })
      expect(updateShellOptions).toHaveBeenCalledTimes(3)
      const board = {
        expectedRevision: 3,
        board: {
          panels: [{ id: "pageList", visible: true, order: 0, position: "left" }],
          cards: [{ cardId: "book-information", panelId: "pageList", visible: true, order: 0 }],
        },
      }
      expect((await controller.handle(jsonRequest("/reader/config", board, true, "PATCH")))?.status).toBe(200)
      expect(updateShellOptions).toHaveBeenLastCalledWith(board, {
        panels: {
          panel_state: { pageList: { visible: true, order: 0, position: "left" } },
          card_state: { "book-information": { visible: true, order: 0, panel_id: "pageList" } },
        },
      })
      const staleBoard = (await controller.handle(jsonRequest("/reader/config", board, true, "PATCH")))!
      expect(staleBoard.status).toBe(409)
      expect(await staleBoard.json()).toMatchObject({ shell: { revision: 4 } })
      expect(updateShellOptions).toHaveBeenCalledTimes(4)
      const viewPatched = (await controller.handle(jsonRequest("/reader/config", {
        viewDefaults: { fitMode: "original", pageMode: "double" },
      }, true, "PATCH")))!
      expect(await viewPatched.json()).toMatchObject({ viewDefaults: { fitMode: "original", pageMode: "double" } })
      expect(updateViewDefaults).toHaveBeenCalledWith(
        { viewDefaults: { fitMode: "original", pageMode: "double" } },
        { reader: { default_zoom_mode: "original", double_page_view: true } },
      )
      const historyListPatched = (await controller.handle(jsonRequest("/reader/config", {
        historyList: { viewMode: "thumbnail" },
      }, true, "PATCH")))!
      expect(await historyListPatched.json()).toMatchObject({ historyList: { viewMode: "thumbnail" } })
      expect(updateHistoryList).toHaveBeenCalledWith(
        { historyList: { viewMode: "thumbnail" } },
        { history_list: { view_mode: "thumbnail" } },
      )
      expect((await controller.handle(jsonRequest("/reader/config", { historyList: { viewMode: "grid" } }, true, "PATCH")))?.status).toBe(400)
      const bookmarkListPatched = (await controller.handle(jsonRequest("/reader/config", {
        bookmarkList: { activeListId: "reading" },
      }, true, "PATCH")))!
      expect(await bookmarkListPatched.json()).toMatchObject({ bookmarkList: { activeListId: "reading" } })
      expect(updateBookmarkList).toHaveBeenCalledWith(
        { bookmarkList: { activeListId: "reading" } },
        { bookmark_list: { active_list_id: "reading" } },
      )
      expect((await controller.handle(jsonRequest("/reader/config", { bookmarkList: { activeListId: "" } }, true, "PATCH")))?.status).toBe(400)
      const pageListPatched = (await controller.handle(jsonRequest("/reader/config", {
        pageList: { viewMode: "thumbnails", followProgress: false },
      }, true, "PATCH")))!
      expect(await pageListPatched.json()).toMatchObject({ pageList: { viewMode: "thumbnails", followProgress: false } })
      expect(updatePageList).toHaveBeenCalledWith(
        { pageList: { viewMode: "thumbnails", followProgress: false } },
        { page_list: { view_mode: "thumbnails", follow_progress: false } },
      )
      expect((await controller.handle(jsonRequest("/reader/config", { pageList: { viewMode: "tiles" } }, true, "PATCH")))?.status).toBe(400)
      const folderPatched = (await controller.handle(jsonRequest("/reader/config", {
        folderView: {
          viewMode: "details",
          previewCount: 9,
          details: { hiddenColumns: ["tags"], columnWidths: { name: 310 } },
          search: { includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true },
          emptyArea: { singleClickAction: "goBack", doubleClickAction: "none", showBackButton: true },
        },
      }, true, "PATCH")))!
      expect(await folderPatched.json()).toMatchObject({ folderView: {
        viewMode: "details",
        previewCount: 9,
        details: { hiddenColumns: ["tags"], columnWidths: { name: 310 } },
        search: { includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true },
        emptyArea: { singleClickAction: "goBack", doubleClickAction: "none", showBackButton: true },
      } })
      expect(updateFolderView).toHaveBeenCalledWith(
        { folderView: {
          viewMode: "details",
          previewCount: 9,
          details: { hiddenColumns: ["tags"], columnWidths: { name: 310 } },
          search: { includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true },
          emptyArea: { singleClickAction: "goBack", doubleClickAction: "none", showBackButton: true },
        } },
        { folder: {
          view_mode: "details",
          preview_count: 9,
          details: { hidden_columns: ["tags"], column_widths: { name: 310 } },
          search: { include_subfolders: false, show_history_on_focus: false, search_in_path: true },
          empty_area: { single_click_action: "goBack", double_click_action: "none", show_back_button: true },
        } },
      )
      const slideshowPatched = (await controller.handle(jsonRequest("/reader/config", {
        slideshow: { intervalSeconds: 11, loop: true },
      }, true, "PATCH")))!
      expect(await slideshowPatched.json()).toMatchObject({ slideshow: { intervalSeconds: 11, loop: true, random: true, fadeTransition: true } })
      expect(updateSlideshow).toHaveBeenCalledWith(
        { slideshow: { intervalSeconds: 11, loop: true } },
        { slideshow: { interval_seconds: 11, loop: true } },
      )
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.color-filter.config-http] exposes and serializes strict color filter config updates", async () => {
    let current = { ...DEFAULT_READER_COLOR_FILTER, contrast: 115 }
    const updateColorFilter = vi.fn(async (patch, tomlPatch) => {
      void tomlPatch
      current = "reset" in patch.colorFilter
        ? { ...DEFAULT_READER_COLOR_FILTER }
        : normalizeReaderColorFilter({ ...current, ...patch.colorFilter })
      return current
    })
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      colorFilter: { ...DEFAULT_READER_COLOR_FILTER, contrast: 115 },
      updateColorFilter,
    })
    const readOnly = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
    })
    const failing = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      updateColorFilter: async () => { throw new Error("config disk unavailable") },
    })
    try {
      expect(await (await controller.handle(authorizedRequest("/reader/config")))!.json()).toMatchObject({
        colorFilter: { colorizePreset: "redAndBlueGray", contrast: 115 },
      })
      const patched = (await controller.handle(jsonRequest("/reader/config", {
        colorFilter: { brightness: 120, onlyBlackAndWhite: true },
      }, true, "PATCH")))!
      expect(patched.status).toBe(200)
      expect(await patched.json()).toMatchObject({ colorFilter: { brightness: 120, onlyBlackAndWhite: true } })
      expect(updateColorFilter).toHaveBeenLastCalledWith(
        { colorFilter: { brightness: 120, onlyBlackAndWhite: true } },
        { image: { color_filter: { brightness: 120, only_black_and_white: true } } },
      )

      const reset = (await controller.handle(jsonRequest("/reader/config", {
        colorFilter: { reset: "defaults" },
      }, true, "PATCH")))!
      expect(reset.status).toBe(200)
      expect(await reset.json()).toMatchObject({ colorFilter: DEFAULT_READER_COLOR_FILTER })
      expect(updateColorFilter).toHaveBeenLastCalledWith(
        { colorFilter: { reset: "defaults" } },
        { image: { color_filter: {
          colorize_enabled: false,
          colorize_preset: "redAndBlueGray",
          custom_colors: [],
          only_black_and_white: false,
          brightness: 100,
          contrast: 100,
          saturation: 100,
          sepia: 0,
          hue_rotate: 0,
          invert: false,
          negative: false,
        } } },
      )
      expect((await controller.handle(jsonRequest("/reader/config", {
        colorFilter: { brightness: 151 },
      }, true, "PATCH")))?.status).toBe(400)
      expect((await readOnly.handle(jsonRequest("/reader/config", {
        colorFilter: { brightness: 120 },
      }, true, "PATCH")))?.status).toBe(405)
      const failed = (await failing.handle(jsonRequest("/reader/config", {
        colorFilter: { brightness: 120 },
      }, true, "PATCH")))!
      expect(failed.status).toBe(500)
      expect(await failed.json()).toEqual({ error: "config disk unavailable" })
    } finally {
      await controller[Symbol.asyncDispose]()
      await readOnly[Symbol.asyncDispose]()
      await failing[Symbol.asyncDispose]()
    }
  })

  it("[neoview.thumbnail.http] [neoview.thumbnail.batch-prewarm] publishes thumbnail DTOs and disposes its owned store", async () => {
    const directory = await createBookDirectory()
    const disposeThumbnailStore = vi.fn(async () => undefined)
    const get = vi.fn(async () => ({ bytes: Uint8Array.of(1, 2, 3), contentType: "image/webp" }))
    const getMany = vi.fn(async (keys: readonly string[]) => new Map(keys.map((key) => [key, { bytes: Uint8Array.of(1, 2, 3), contentType: "image/webp" }])))
    const maintenanceSnapshot = vi.fn(async () => ({
      totalRows: 1, fileRows: 1, folderRows: 0, blobBytes: 3, emptyBlobs: 0, failedRows: 0, failuresByReason: {},
      writer: { pendingWrites: 0, flushing: false, committedBatches: 0, committedWrites: 0, busyRetries: 0, failedBatches: 0 },
    }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      thumbnailStore: { get, getMany, maintenanceSnapshot },
      disposeThumbnailStore,
    })
    const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!
    const session = await opened.json() as ReaderSessionDto
    expect(JSON.stringify(session)).not.toContain("thumbnailSource")
    const thumbnailUrl = session.visiblePages[0]?.thumbnailUrl
    expect(thumbnailUrl).toContain(`/reader/s/${session.sessionId}/thumbnail/`)
    expect(thumbnailUrl).not.toContain(directory)
    expect((await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}/pages?cursor=0&limit=3`)))?.status).toBe(200)
    const thumbnail = (await controller.handle(new Request(thumbnailUrl!)))!
    expect(new Uint8Array(await thumbnail.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))
    await controller[Symbol.asyncDispose]()
    expect(getMany).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled()
    const maintenance = (await controller.handle(authorizedRequest("/reader/thumbnails/maintenance")))!
    expect((await maintenance.json() as { snapshot: { totalRows: number } }).snapshot.totalRows).toBe(1)
    expect(maintenanceSnapshot).toHaveBeenCalledOnce()
    expect(disposeThumbnailStore).toHaveBeenCalledOnce()
  })

  it("[neoview.session.hibernate] releases reader caches only after the last session closes", async () => {
    const directory = await createBookDirectory()
    const hibernate = vi.spyOn(ReaderAssetRoute.prototype, "hibernate")
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const first = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto
      const second = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto

      expect((await controller.handle(authorizedRequest(`/reader/s/${first.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
      expect(hibernate).not.toHaveBeenCalled()
      expect((await controller.handle(authorizedRequest(`/reader/s/${second.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
      expect(hibernate).toHaveBeenCalledOnce()
    } finally {
      await controller[Symbol.asyncDispose]()
      hibernate.mockRestore()
    }
  })

  it("[neoview.preload.action-http] strictly cancels speculative work and releases only session retention", async () => {
    const directory = await createBookDirectory()
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!
      const session = await opened.json() as ReaderSessionDto
      const candidate = session.preload!.candidates[0]!.pageIds[0]!
      expect((await controller.handle(jsonRequest(`/reader/s/${session.sessionId}/preload-events`, {
        generation: session.preload!.generation,
        events: [{ pageId: candidate, outcome: "started" }],
      })))?.status).toBe(202)

      const actionPath = `/reader/s/${session.sessionId}/preload-actions`
      expect((await controller.handle(authorizedRequest(actionPath)))?.status).toBe(405)
      expect((await controller.handle(jsonRequest(actionPath, { action: "cancel-speculative", confirmed: false })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest(actionPath, { action: "cancel-speculative", confirmed: true, extra: true })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest(actionPath, { action: "global-clear", confirmed: true })))?.status).toBe(400)

      const cancelled = (await controller.handle(jsonRequest(actionPath, {
        action: "cancel-speculative",
        confirmed: true,
      })))!
      expect(cancelled.status).toBe(200)
      const cancelledBody = await cancelled.json()
      expect(cancelledBody).toEqual({
        action: "cancel-speculative",
        generation: expect.any(Number),
        cancelled: 1,
        released: 0,
        visibleRetained: 1,
      })
      expect(JSON.stringify(cancelledBody)).not.toContain(directory)
      const paused = (await (await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`)))!.json()) as ReaderSessionDto
      expect(paused.preload).toMatchObject({ generation: cancelledBody.generation, admission: "paused", candidates: [] })

      const navigated = (await controller.handle(jsonRequest(`/reader/s/${session.sessionId}/navigate`, { action: "next" })))!
      await expect(navigated.json()).resolves.toMatchObject({ preload: { admission: "normal" } })
      const released = (await controller.handle(jsonRequest(actionPath, {
        action: "release-retained",
        confirmed: true,
      })))!
      expect(released.status).toBe(200)
      expect(await released.json()).toEqual({
        action: "release-retained",
        generation: expect.any(Number),
        cancelled: 0,
        released: 0,
        visibleRetained: 1,
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.session.hibernate-concurrent] coalesces concurrent last-session idle checks", async () => {
    const directory = await createBookDirectory()
    const hibernate = vi.spyOn(ReaderAssetRoute.prototype, "hibernate")
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const first = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto
      const second = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto

      const responses = await Promise.all([
        controller.handle(authorizedRequest(`/reader/s/${first.sessionId}`, { method: "DELETE" })),
        controller.handle(authorizedRequest(`/reader/s/${second.sessionId}`, { method: "DELETE" })),
      ])

      expect(responses.map((response) => response?.status)).toEqual([204, 204])
      expect(hibernate).toHaveBeenCalledOnce()
    } finally {
      await controller[Symbol.asyncDispose]()
      hibernate.mockRestore()
    }
  })

  it("[neoview.thumbnail.video.http] serves a video page thumbnail through the opaque session URL", async () => {
    const directory = await createBookDirectory()
    const videoPath = join(directory, "clip.mp4")
    await writeFile(videoPath, Uint8Array.of(0, 1, 2, 3))
    const generated = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 5])
    const generate = vi.fn(async () => ({ bytes: generated, contentType: "image/webp" as const }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      loadVideoThumbnailProvider: async () => ({ generate }),
    })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: videoPath })))!
      const session = await opened.json() as ReaderSessionDto
      const thumbnailUrl = session.visiblePages[0]?.thumbnailUrl
      expect(thumbnailUrl).toContain(`/reader/s/${session.sessionId}/thumbnail/`)
      expect(thumbnailUrl).not.toContain(videoPath)
      const thumbnail = (await controller.handle(new Request(thumbnailUrl!)))!
      expect(thumbnail.status).toBe(200)
      expect(thumbnail.headers.get("content-type")).toBe("image/webp")
      expect(new Uint8Array(await thumbnail.arrayBuffer())).toEqual(generated)
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: expect.stringContaining("clip.mp4"), maxEdge: 320 }), expect.any(AbortSignal))
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.image-information.image-http-zero-ffprobe] returns image identity without loading the media provider", async () => {
    const directory = await createBookDirectory()
    const loadPageMediaMetadataProvider = vi.fn(async () => ({ inspect: vi.fn(async () => ({})) }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      loadPageMediaMetadataProvider,
    })
    try {
      const session = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto
      const endpoint = `/reader/s/${session.sessionId}/page-media-information`
      expect((await controller.handle(new Request(new URL(endpoint, "http://127.0.0.1:41000"))))?.status).toBe(401)
      expect(await (await controller.handle(authorizedRequest(endpoint)))!.json()).toEqual({
        pageId: session.visiblePages[0]!.id,
        contentVersion: session.visiblePages[0]!.contentVersion,
        mediaKind: "image",
      })
      expect(loadPageMediaMetadataProvider).not.toHaveBeenCalled()
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.image-information.archive-video-http] probes an archive video stream once through the demand route", async () => {
    const archive = await createZipFixture({
      name: "video.cbz",
      entries: [{ path: "clips/clip.mp4", bytes: Uint8Array.of(4, 3, 2, 1), level: 0 }],
    })
    cleanupArchives.push(archive)
    const inspect = vi.fn(async (request: { sourceStream?: ReadableStream<Uint8Array> }) => {
      expect(request.sourceStream).toBeInstanceOf(ReadableStream)
      const reader = request.sourceStream!.getReader()
      const bytes: number[] = []
      try {
        while (true) {
          const result = await reader.read()
          if (result.done) break
          bytes.push(...result.value)
        }
      } finally {
        reader.releaseLock()
      }
      expect(bytes).toEqual([4, 3, 2, 1])
      return {
        durationSeconds: 10,
        frameRate: 24,
        bitRateBps: 800_000,
        videoCodec: "h264",
        audioCodec: "aac",
      }
    })
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      loadPageMediaMetadataProvider: async () => ({ inspect }),
    })
    try {
      const session = await (await controller.handle(jsonRequest("/reader/sessions", { path: archive.path })))!.json() as ReaderSessionDto
      const endpoint = `/reader/s/${session.sessionId}/page-media-information`
      const first = await (await controller.handle(authorizedRequest(endpoint)))!.json()
      const second = await (await controller.handle(authorizedRequest(endpoint)))!.json()
      expect(first).toMatchObject({
        pageId: session.visiblePages[0]!.id,
        mediaKind: "video",
        durationSeconds: 10,
        frameRate: 24,
        bitRateBps: 800_000,
        videoCodec: "h264",
        audioCodec: "aac",
      })
      expect(second).toEqual(first)
      expect(inspect).toHaveBeenCalledOnce()
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.image-information.video-http-session-close] aborts an active demand before closing the session", async () => {
    const directory = await createBookDirectory()
    const videoPath = join(directory, "clip.mp4")
    await writeFile(videoPath, Uint8Array.of(0, 1, 2, 3))
    const started = Promise.withResolvers<void>()
    const aborted = vi.fn()
    const inspect = vi.fn((_request: unknown, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      started.resolve()
      signal?.addEventListener("abort", () => {
        aborted()
        reject(signal.reason)
      }, { once: true })
    }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      loadPageMediaMetadataProvider: async () => ({ inspect }),
    })
    try {
      const session = await (await controller.handle(jsonRequest("/reader/sessions", { path: videoPath })))!.json() as ReaderSessionDto
      const pending = controller.handle(authorizedRequest(`/reader/s/${session.sessionId}/page-media-information`))
      await started.promise
      expect((await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
      expect((await pending)?.status).toBe(503)
      expect(aborted).toHaveBeenCalledOnce()
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.media-progress.http] restores, coalesces and durably flushes video playback state", async () => {
    const directory = await createBookDirectory()
    const videoPath = join(directory, "clip.mp4")
    await writeFile(videoPath, Uint8Array.of(0, 1, 2, 3))
    const getMediaProgress = vi.fn(async () => undefined)
    const saveMediaProgress = vi.fn(async () => undefined)
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      mediaProgressStore: { getMediaProgress, saveMediaProgress },
    })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: videoPath })))!
      const session = await opened.json() as ReaderSessionDto
      const endpoint = `/reader/s/${session.sessionId}/media-progress`
      expect(await (await controller.handle(authorizedRequest(endpoint)))!.json()).toEqual({ progress: null })
      expect((await controller.handle(jsonRequest(endpoint, {
        position: 11,
        duration: 10,
        completed: false,
      }, true, "PATCH")))?.status).toBe(400)

      const queued = (await controller.handle(jsonRequest(endpoint, {
        position: 4,
        duration: 10,
        completed: false,
      }, true, "PATCH")))!
      expect(queued.status).toBe(202)
      expect(await queued.json()).toMatchObject({
        durable: false,
        progress: { bookId: session.book.id, position: 4, duration: 10, completed: false },
      })
      expect(await (await controller.handle(authorizedRequest(endpoint)))!.json()).toMatchObject({
        progress: { position: 4, duration: 10, completed: false },
      })
      expect(saveMediaProgress).not.toHaveBeenCalled()

      const durable = (await controller.handle(jsonRequest(endpoint, {
        position: 10,
        duration: 10,
        completed: true,
        flush: true,
      }, true, "PATCH")))!
      expect(durable.status).toBe(200)
      expect(await durable.json()).toMatchObject({ durable: true, progress: { position: 10, completed: true } })
      expect(saveMediaProgress).toHaveBeenCalledOnce()
      expect(saveMediaProgress).toHaveBeenCalledWith(expect.objectContaining({
        bookId: session.book.id,
        position: 10,
        duration: 10,
        completed: true,
      }))
      expect((await controller.handle(authorizedRequest(endpoint, { method: "DELETE" })))?.status).toBe(404)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.session] [neoview.page-list.catalog] [neoview.metadata.http] opens, filters pages, navigates and closes without exposing local paths", async () => {
    const directory = await createBookDirectory()
    const readDirectoryEmmRecords = vi.fn(async (paths: readonly string[]) => new Map([
      [paths[0]!, { emmJson: JSON.stringify({ translated_title: "译名" }) }],
    ]))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      directoryEmmRecordStore: { directoryEmmAvailable: true, readDirectoryEmmRecords },
    })
    try {
      const unauthorized = await controller.handle(jsonRequest("/reader/sessions", { path: directory }, false))
      expect(unauthorized?.status).toBe(401)

      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory, initialPage: 1 })))!
      expect(opened.status).toBe(201)
      const session = await opened.json() as ReaderSessionDto
      expect(session.book).toMatchObject({ displayName: expect.any(String), pageCount: 3 })
      expect(session.frame.anchorPageIndex).toBe(1)
      expect(session.visiblePages[0]?.name).toBe("2.jpg")
      expect(session.preload).toMatchObject({
        generation: 1,
        direction: "forward",
        candidates: [
          { tier: "near", priority: "view", pageIndexes: [2] },
          { tier: "background", priority: "background", pageIndexes: [0] },
        ],
      })
      expect(JSON.stringify(session)).not.toContain(directory)

      const metadata = (await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}/metadata`)))!
      expect(await metadata.json()).toMatchObject({
        book: {
          bookId: session.book.id,
          displayName: expect.any(String),
          sourceKind: "directory",
          sourcePath: directory,
          pageCount: 3,
          currentPage: 2,
          emm: { translatedTitle: "译名" },
          createdAtMs: expect.any(Number),
          modifiedAtMs: expect.any(Number),
          accessedAtMs: expect.any(Number),
        },
        page: {
          index: 1,
          name: "2.jpg",
          byteLength: 1,
          timeSource: "filesystem",
          createdAtMs: expect.any(Number),
          modifiedAtMs: expect.any(Number),
          accessedAtMs: expect.any(Number),
        },
      })

      const options = (await controller.handle(jsonRequest(
        `/reader/s/${session.sessionId}/options`,
        { layout: { pageMode: "double" } },
        true,
        "PATCH",
      )))!
      expect(options.status).toBe(200)
      expect(await options.json()).toMatchObject({
        frame: { layout: { pageMode: "double" }, pages: [{ pageIndex: 1 }, { pageIndex: 2 }] },
        visiblePages: [{ index: 1 }, { index: 2 }],
        preload: { generation: 2, candidates: [{ tier: "background", pageIndexes: [0] }] },
      })
      const direction = (await controller.handle(jsonRequest(
        `/reader/s/${session.sessionId}/options`,
        { direction: "right-to-left" },
        true,
        "PATCH",
      )))!
      expect(direction.status).toBe(200)
      expect(await direction.json()).toMatchObject({ frame: { direction: "right-to-left", pages: [{ pageIndex: 2 }, { pageIndex: 1 }] } })
      expect((await controller.handle(jsonRequest(
        `/reader/s/${session.sessionId}/options`,
        { direction: "top-to-bottom" },
        true,
        "PATCH",
      )))?.status).toBe(400)
      expect((await controller.handle(jsonRequest(
        `/reader/s/${session.sessionId}/options`,
        { layout: { pageMode: "panorama" } },
        true,
        "PATCH",
      )))?.status).toBe(400)
      expect((await controller.handle(jsonRequest(
        `/reader/s/${session.sessionId}/options`,
        { layout: { pageMode: "single" } },
        true,
        "PATCH",
      )))?.status).toBe(200)

      const pagesResponse = (await controller.handle(authorizedRequest(
        `/reader/s/${session.sessionId}/pages?cursor=1&limit=1`,
      )))!
      const pageList = await pagesResponse.json() as { pages: Array<{ name: string; assetUrl: string }>; nextCursor: number }
      expect(pageList.pages.map((page) => page.name)).toEqual(["2.jpg"])
      expect(pageList.nextCursor).toBe(2)
      expect(pageList.pages[0]!.assetUrl).toContain("token=reader-token")

      const prewarmThumbnails = vi.spyOn(ReaderAssetRoute.prototype, "prewarmThumbnails")
      try {
        const filteredResponse = (await controller.handle(authorizedRequest(
          `/reader/s/${session.sessionId}/pages?cursor=0&limit=64&query=2&thumbnails=0`,
        )))!
        expect(await filteredResponse.json()).toMatchObject({
          pages: [{ index: 1, name: "2.jpg" }],
          total: 1,
        })
        expect(prewarmThumbnails).not.toHaveBeenCalled()
      } finally {
        prewarmThumbnails.mockRestore()
      }
      expect((await controller.handle(authorizedRequest(
        `/reader/s/${session.sessionId}/pages?query=${"x".repeat(129)}`,
      )))?.status).toBe(400)

      const asset = (await controller.handle(new Request(pageList.pages[0]!.assetUrl)))!
      expect(new Uint8Array(await asset.arrayBuffer())).toEqual(Uint8Array.of(2))

      const navigated = (await controller.handle(jsonRequest(
        `/reader/s/${session.sessionId}/navigate`,
        { action: "next" },
      )))!
      expect(await navigated.json()).toMatchObject({
        frame: { anchorPageIndex: 2 },
        preload: { generation: 5, direction: "forward", candidates: [{ tier: "background", pageIndexes: [1] }] },
      })
      const metadataAfterNavigation = await (await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}/metadata`)))!.json()
      expect(metadataAfterNavigation).toMatchObject({ book: { currentPage: 3, emm: { translatedTitle: "译名" } } })
      expect(readDirectoryEmmRecords).toHaveBeenCalledOnce()

      const closed = (await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" })))!
      expect(closed.status).toBe(204)
      expect((await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`)))?.status).toBe(404)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.validation] rejects malformed open and navigation payloads", async () => {
    const directory = await createBookDirectory()
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      expect((await controller.handle(jsonRequest("/reader/sessions", { path: "" })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest("/reader/sessions", { path: directory, initialPage: -1 })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest("/reader/sessions", { path: directory, entryPaths: [] })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest("/reader/sessions", {
        path: directory,
        entryPath: "inner.cbz",
        entryPaths: ["inner.cbz"],
      })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest("/reader/sessions", {
        path: directory,
        password: "a",
        archivePasswords: [{ password: "b" }],
      })))?.status).toBe(400)
      expect((await controller.handle(jsonRequest("/reader/sessions", {
        path: directory,
        archivePasswords: [{ password: "a" }, { password: "b" }],
      })))?.status).toBe(400)
      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!
      const { sessionId } = await opened.json() as ReaderSessionDto
      expect((await controller.handle(jsonRequest(`/reader/s/${sessionId}/navigate`, { action: "goTo" })))?.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.book-information.session-close] aborts a pending static EMM load when its session closes", async () => {
    const directory = await createBookDirectory()
    let emmSignal: AbortSignal | undefined
    const readDirectoryEmmRecords = vi.fn((_paths: readonly string[], signal?: AbortSignal) => {
      emmSignal = signal
      return new Promise<ReadonlyMap<string, never>>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    })
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      directoryEmmRecordStore: { directoryEmmAvailable: true, readDirectoryEmmRecords },
    })
    try {
      const session = await (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!.json() as ReaderSessionDto
      const metadata = controller.handle(authorizedRequest(`/reader/s/${session.sessionId}/metadata`))
      await vi.waitFor(() => expect(readDirectoryEmmRecords).toHaveBeenCalledOnce())
      expect((await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
      expect(emmSignal?.aborted).toBe(true)
      await expect(metadata).rejects.toMatchObject({ name: "AbortError" })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.nested-archive] [neoview.clipboard.materialization-http] opens and streams an inner archive without exposing materialized paths", async () => {
    const nestedPassword = "nested-session-secret"
    const inner = await createZipFixture({
      name: "inner.cbz",
      entries: [{ path: "pages/1.png", bytes: ONE_PIXEL_PNG, level: 0, password: nestedPassword }],
    })
    const outer = await createZipFixture({
      name: "outer.cbz",
      entries: [{ path: "nested/inner.cbz", bytes: inner.bytes, level: 6 }],
    })
    cleanupArchives.push(inner, outer)
    const tempDirectory = await mkdtemp(join(tmpdir(), "xiranite-neoview-control-nested-"))
    cleanupDirectories.push(tempDirectory)
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      archiveTempDirectory: tempDirectory,
    })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", {
        path: outer.path,
        entryPaths: ["nested/inner.cbz"],
        archivePasswords: [{ entryPaths: ["nested/inner.cbz"], password: nestedPassword }],
      })))!
      expect(opened.status).toBe(201)
      const session = await opened.json() as ReaderSessionDto
      expect(session.book).toMatchObject({ displayName: "inner.cbz", pageCount: 1 })
      expect(JSON.stringify(session)).not.toContain(tempDirectory)
      expect(JSON.stringify(session)).not.toContain(nestedPassword)
      expect(session.visiblePages[0]!.thumbnailUrl).toBeUndefined()
      expect(session.visiblePages[0]!.assetUrl).not.toContain(nestedPassword)
      const asset = (await controller.handle(new Request(session.visiblePages[0]!.assetUrl)))!
      expect(Buffer.from(await asset.arrayBuffer())).toEqual(ONE_PIXEL_PNG)
      const materializedResponse = (await controller.handle(jsonRequest(
        `/reader/s/${session.sessionId}/clipboard-materializations`,
        { pageId: session.visiblePages[0]!.id },
      )))!
      expect(materializedResponse.status).toBe(201)
      const materialized = await materializedResponse.json() as { token: string; path: string; byteLength: number }
      expect(materialized.path).toMatch(/1\.png$/)
      expect(materialized.byteLength).toBe(ONE_PIXEL_PNG.byteLength)
      expect(Buffer.from(await readFile(materialized.path))).toEqual(ONE_PIXEL_PNG)
      expect((await controller.handle(authorizedRequest(
        `/reader/s/${session.sessionId}/clipboard-materializations/${materialized.token}`,
        { method: "DELETE" },
      )))?.status).toBe(204)
      await expect(readFile(materialized.path)).rejects.toMatchObject({ code: "ENOENT" })
      await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" }))
      expect(await readdir(tempDirectory)).toEqual([])
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.control.encrypted-archive] keeps a root ZIP password session-scoped and out of asset URLs", async () => {
    const password = "root-session-secret"
    const archive = await createZipFixture({
      name: "encrypted.cbz",
      entries: [{ path: "pages/1.png", bytes: ONE_PIXEL_PNG, level: 6, password }],
    })
    cleanupArchives.push(archive)
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", {
        path: archive.path,
        password,
      })))!
      expect(opened.status).toBe(201)
      const session = await opened.json() as ReaderSessionDto
      const serialized = JSON.stringify(session)
      expect(serialized).not.toContain(password)
      expect(session.visiblePages[0]!.assetUrl).not.toContain(password)
      const metadata = await (await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}/metadata`)))!.json() as {
        page: { timeSource?: string; createdAtMs?: number; modifiedAtMs?: number; accessedAtMs?: number }
      }
      expect(metadata.page).toMatchObject({
        timeSource: "archive-entry",
        modifiedAtMs: Date.parse("2024-01-02T03:04:06.000Z"),
      })
      expect(metadata.page.createdAtMs).toBeUndefined()
      expect(metadata.page.accessedAtMs).toBeUndefined()
      const asset = (await controller.handle(new Request(session.visiblePages[0]!.assetUrl)))!
      expect(Buffer.from(await asset.arrayBuffer())).toEqual(ONE_PIXEL_PNG)
      await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" }))

      const wrongPassword = "wrong-password-must-not-leak"
      const wrongOpened = (await controller.handle(jsonRequest("/reader/sessions", {
        path: archive.path,
        password: wrongPassword,
      })))!
      const wrongSession = await wrongOpened.json() as ReaderSessionDto
      expect(JSON.stringify(wrongSession)).not.toContain(wrongPassword)
      const wrongAsset = (await controller.handle(new Request(wrongSession.visiblePages[0]!.assetUrl)))!
      await expect(wrongAsset.arrayBuffer()).rejects.not.toThrow(wrongPassword)
      await controller.handle(authorizedRequest(`/reader/s/${wrongSession.sessionId}`, { method: "DELETE" }))
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.image.transform-http] streams a native transform through the controller response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-transform-"))
    cleanupDirectories.push(directory)
    await Promise.all([1, 2, 3].map((index) => writeFile(join(directory, `page-${index}.png`), ONE_PIXEL_PNG)))
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token" })
    try {
      const opened = (await controller.handle(jsonRequest("/reader/sessions", { path: directory })))!
      const session = await opened.json() as ReaderSessionDto
      const url = new URL(session.visiblePages[0]!.assetUrl)
      url.searchParams.set("width", "1")
      url.searchParams.set("format", "webp")
      const response = (await controller.handle(new Request(url)))!
      const bytes = Buffer.from(await response.arrayBuffer())
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/webp")
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF")
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP")
      const cached = (await controller.handle(new Request(url)))!
      expect(Buffer.from(await cached.arrayBuffer())).toEqual(bytes)
      expect(cached.headers.get("content-length")).toBe(String(bytes.byteLength))
      await expect((await controller.handle(authorizedRequest("/reader/diagnostics")))!.json()).resolves.toMatchObject({
        assets: {
          presentation: { pinnedEntries: 1, activeLeases: 1 },
          presentationRetention: { sessions: 1, desiredPages: 2, retainedPresentations: 1 },
        },
        cache: {
          memory: { presentationBytes: bytes.byteLength, totalBytes: bytes.byteLength },
          disk: { totalBytes: 0 },
          leases: { presentationMemory: 1, presentationDisk: 0, solidArchive: 0, thumbnailDemands: 0, total: 1 },
        },
      })
      expect((await controller.handle(jsonRequest(`/reader/s/${session.sessionId}/navigate`, { action: "next" })))?.status).toBe(200)
      await expect((await controller.handle(authorizedRequest("/reader/diagnostics")))!.json()).resolves.toMatchObject({
        assets: {
          presentation: { pinnedEntries: 0, activeLeases: 0 },
          presentationRetention: { sessions: 1, retainedPresentations: 0 },
        },
        cache: { memory: { presentationBytes: bytes.byteLength }, leases: { total: 0 } },
      })
      expect((await controller.handle(authorizedRequest(`/reader/s/${session.sessionId}`, { method: "DELETE" })))?.status).toBe(204)
      await expect((await controller.handle(authorizedRequest("/reader/diagnostics")))!.json()).resolves.toMatchObject({
        assets: {
          presentation: { pinnedEntries: 0, activeLeases: 0 },
          presentationRetention: { sessions: 0, desiredPages: 0, retainedPresentations: 0 },
        },
        cache: { memory: { totalBytes: 0 }, disk: { totalBytes: 0 }, leases: { total: 0 } },
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

async function createBookDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-control-"))
  cleanupDirectories.push(directory)
  await Promise.all([
    writeFile(join(directory, "1.jpg"), Uint8Array.of(1)),
    writeFile(join(directory, "2.jpg"), Uint8Array.of(2)),
    writeFile(join(directory, "3.jpg"), Uint8Array.of(3)),
  ])
  return directory
}

function jsonRequest(path: string, body: unknown, authorized = true, method = "POST"): Request {
  return authorizedRequest(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, authorized)
}

function authorizedRequest(path: string, init: RequestInit = {}, authorized = true): Request {
  const headers = new Headers(init.headers)
  if (authorized) headers.set("x-xiranite-token", "reader-token")
  return new Request(new URL(path, "http://127.0.0.1:41000"), { ...init, headers })
}
