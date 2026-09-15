import { describe, expect, it } from "vitest"
import { resolveConfiguredReaderService } from "./resolveReaderService.js"
import { NeoxideNativeReaderService } from "./NeoxideNativeReaderService.js"
import { isNeoxideNativeAvailable, type NeoxideNativeBinding } from "./neoxideNativeBinding.js"
import type { ReaderService } from "../../application/reader/contracts.js"

describe("NeoxideNativeReaderCore & Switchability", () => {
  it("[neoview.native.resolve] defaults to fallback when readerCore is original or unspecified", () => {
    let fallbackCalled = false
    const mockFallbackService = {} as ReaderService
    const fallback = () => {
      fallbackCalled = true
      return mockFallbackService
    }

    const res1 = resolveConfiguredReaderService({}, undefined, fallback)
    expect(res1).toBe(mockFallbackService)
    expect(fallbackCalled).toBe(true)

    fallbackCalled = false
    const res2 = resolveConfiguredReaderService({ readerCore: "original" }, "original", fallback)
    expect(res2).toBe(mockFallbackService)
    expect(fallbackCalled).toBe(true)
  })

  it("[neoview.native.resolve] returns explicit readerService override when provided", () => {
    const customService = {} as ReaderService
    let fallbackCalled = false
    const res = resolveConfiguredReaderService(
      { readerService: customService, readerCore: "node" },
      "node",
      () => {
        fallbackCalled = true
        return {} as ReaderService
      },
    )
    expect(res).toBe(customService)
    expect(fallbackCalled).toBe(false)
  })

  it("[neoview.native.resolve] resolves NeoxideNativeReaderService when readerCore is node and native binding exists", () => {
    if (!isNeoxideNativeAvailable()) {
      return
    }
    let fallbackCalled = false
    const res = resolveConfiguredReaderService(
      { readerCore: "node" },
      undefined,
      () => {
        fallbackCalled = true
        return {} as ReaderService
      },
    )
    expect(res).toBeInstanceOf(NeoxideNativeReaderService)
    expect(fallbackCalled).toBe(false)
  })

  it("[neoview.native.session] opens book, reads frame, loads page bytes, and closes cleanly", async () => {
    const mockBinding: NeoxideNativeBinding = {
      readerOpen: (_path: string) => ({
        sessionId: "sess-123",
        book: { id: "book-1", displayName: "Sample Book", pageCount: 2 },
        visiblePages: [
          { id: "sess-123:0", name: "001.png", mimeType: "image/png", contentVersion: "1" },
          { id: "sess-123:1", name: "002.png", mimeType: "image/png", contentVersion: "1" },
        ],
        frame: {
          anchorPageIndex: 0,
          pageIndices: [0],
          direction: "left-to-right",
          layout: "single",
          atStart: true,
          atEnd: false,
        },
      }),
      readerGetPageBytes: (_sessionId: string, pageIndex: number) => ({
        data: Buffer.from(`page-data-${pageIndex}`),
        mimeType: "image/png",
      }),
      readerNavigate: (_sessionId: string, action: string) => ({
        frame: {
          anchorPageIndex: action === "next" ? 1 : 0,
          pageIndices: [action === "next" ? 1 : 0],
          direction: "left-to-right",
          layout: "single",
          atStart: action !== "next",
          atEnd: action === "next",
        },
      }),
      readerGoto: (_sessionId: string, pageIndex: number) => ({
        frame: {
          anchorPageIndex: pageIndex,
          pageIndices: [pageIndex],
          direction: "left-to-right",
          layout: "single",
          atStart: pageIndex === 0,
          atEnd: pageIndex === 1,
        },
      }),
      readerFrameWindow: () => ({ frames: [] }),
      readerListPages: () => [],
      readerClose: () => {},
      readerOpenDirectoryBrowser: () => ({ entries: [] }),
      readerListRecent: () => [],
      readerRemoveRecent: () => {},
      readerListBookmarks: () => [],
      readerSaveBookmark: () => {},
      readerRemoveBookmark: () => {},
      readerGetConfig: () => ({}),
      readerUpdateConfig: () => ({}),
    }

    const service = new NeoxideNativeReaderService(mockBinding)
    expect(service.sessionCount).toBe(0)

    const session = await service.openViewSource({ kind: "path", path: "D:/test/book" })
    expect(service.sessionCount).toBe(1)
    expect(session.id).toBe("sess-123")
    expect(session.book.displayName).toBe("Sample Book")
    expect(session.pages.length).toBe(2)

    // Verify snapshot
    const initialFrame = session.snapshot()
    expect(initialFrame.anchorPageIndex).toBe(0)
    expect(initialFrame.pages[0]?.pageIndex).toBe(0)

    // Verify page byte loading
    const page0 = session.pages[0]
    expect(page0).toBeDefined()
    const source = await page0!.content.load()
    expect(source.byteLength).toBe("page-data-0".length)
    expect(source.contentType).toBe("image/png")

    const stream = await source.open()
    const reader = stream.getReader()
    const chunk = await reader.read()
    expect(chunk.done).toBe(false)
    expect(Buffer.from(chunk.value!).toString()).toBe("page-data-0")
    await source.close()

    // Navigation: next
    const nextFrame = await session.next()
    expect(nextFrame.anchorPageIndex).toBe(1)
    expect(nextFrame.atEnd).toBe(true)

    // Navigation: previous
    const prevFrame = await session.previous()
    expect(prevFrame.anchorPageIndex).toBe(0)

    // Navigation: goTo
    const gotoFrame = await session.goTo(1)
    expect(gotoFrame.anchorPageIndex).toBe(1)

    // Preload diagnostics
    const preloadDiag = service.preloadDiagnostics()
    expect(preloadDiag.sessions).toBe(1)

    // Close session
    await service.closeSession(session.id)
    expect(service.sessionCount).toBe(0)
  })

  it("[neoview.controller.headless] switches to original core when specified", async () => {
    const { createReaderHeadlessController } = await import("../../platform.js")
    const controller = await createReaderHeadlessController({
      readerCore: "original",
      legacyThumbnailDatabasePath: false,
      superResolution: false,
    })
    expect(controller).toBeDefined()
    expect(controller.isOpen).toBe(false)
    await controller[Symbol.asyncDispose]()
  })

  it("[neoview.native.real_binding] loads pages and metadata using the real compiled .node binding", async () => {
    const { getNeoxideNativeBinding } = await import("./neoxideNativeBinding.js")
    if (!isNeoxideNativeAvailable()) return
    const binding = getNeoxideNativeBinding()
    expect(binding).not.toBeNull()
    const assetsDir = "d:/1VSCODE/Projects/Xiranite/vendor/neoxide/vendor/mimageviewer/assets"
    const service = new NeoxideNativeReaderService(binding!)
    const session = await service.openViewSource({ kind: "path", path: assetsDir })
    try {
      expect(session.id).toBeDefined()
      expect(session.pages.length).toBeGreaterThan(0)
      const page0 = session.pages[0]
      expect(page0).toBeDefined()
      const source = await page0!.content.load()
      expect(source.byteLength).toBeGreaterThan(0)
      const stream = await source.open()
      const reader = stream.getReader()
      const { value, done } = await reader.read()
      expect(done).toBe(false)
      expect(value?.byteLength).toBe(source.byteLength)
      await source.close()
    } finally {
      await session.close()
    }
  })

  it("[neoview.controller.http] instantiates with readerCore switching between original and node", async () => {
    const { createReaderHttpController } = await import("../../platform.js")
    const controllerOriginal = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:43127",
      token: "test-token",
      readerCore: "original",
      legacyThumbnailDatabasePath: false,
      legacyEmmDatabasePaths: false,
    })
    expect(controllerOriginal).toBeDefined()
    await controllerOriginal[Symbol.asyncDispose]()

    if (isNeoxideNativeAvailable()) {
      const controllerNode = await createReaderHttpController({
        baseUrl: "http://127.0.0.1:43127",
        token: "test-token",
        readerCore: "node",
        legacyThumbnailDatabasePath: false,
        legacyEmmDatabasePaths: false,
      })
      expect(controllerNode).toBeDefined()
      await controllerNode[Symbol.asyncDispose]()
    }
  })
})
