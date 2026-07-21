import { describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import { applyFolderPenetrationResolution, openLibraryEntry } from "./openLibraryEntry"

describe("openLibraryEntry", () => {
  it("opens files with full browser provenance on the parent folder", async () => {
    const onOpen = vi.fn()
    const onBrowsePath = vi.fn()
    await openLibraryEntry({
      client: {} as ReaderHttpClient,
      path: "D:/books/one.cbz",
      kind: "file",
      onOpen,
      onBrowsePath,
    })
    expect(onBrowsePath).toHaveBeenCalledWith("D:/books")
    expect(onOpen).toHaveBeenCalledWith("D:/books/one.cbz", {
      browserOriginPath: "D:/books",
      browserOriginEntryPath: "D:/books/one.cbz",
    })
  })

  it("reopens folder books against the parent origin when penetration is off", async () => {
    const onOpen = vi.fn()
    const onBrowsePath = vi.fn()
    await openLibraryEntry({
      client: {} as ReaderHttpClient,
      path: "D:/books/series",
      kind: "folder",
      onOpen,
      onBrowsePath,
      penetration: { enabled: false, maxDepth: 3, terminalTargets: ["archive", "media-directory"] },
    })
    expect(onBrowsePath).toHaveBeenCalledWith("D:/books")
    expect(onOpen).toHaveBeenCalledWith("D:/books/series", {
      browserOriginPath: "D:/books",
      browserOriginEntryPath: "D:/books/series",
    })
  })

  it("prefers same-origin File Card activation when penetration is enabled", async () => {
    const onActivateInFolderCard = vi.fn(() => true)
    const onOpen = vi.fn()
    const onBrowsePath = vi.fn()
    const resolveFolderPenetration = vi.fn()
    await openLibraryEntry({
      client: {
        resolveFolderPenetration,
        openDirectoryBrowser: vi.fn(),
      } as unknown as ReaderHttpClient,
      path: "D:/books/series",
      kind: "folder",
      onOpen,
      onBrowsePath,
      onActivateInFolderCard,
      penetration: { enabled: true, maxDepth: 3, terminalTargets: ["archive", "media-directory"] },
    })
    expect(onActivateInFolderCard).toHaveBeenCalledWith("D:/books/series")
    expect(onOpen).not.toHaveBeenCalled()
    expect(resolveFolderPenetration).not.toHaveBeenCalled()
  })

  it("falls back to temporary resolve when File Card activation is not handled", async () => {
    const onActivateInFolderCard = vi.fn(() => false)
    const onOpen = vi.fn()
    const onBrowsePath = vi.fn()
    const openDirectoryBrowser = vi.fn(async () => ({ sessionId: "browser-temp" }))
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const resolveFolderPenetration = vi.fn(async () => ({
      status: "resolved" as const,
      originPath: "D:/books/series",
      terminal: { kind: "media-directory" as const, path: "D:/books/series/nested" },
      chain: [],
      reason: "media-directory" as const,
    }))
    await openLibraryEntry({
      client: {
        openDirectoryBrowser,
        closeDirectoryBrowser,
        resolveFolderPenetration,
      } as unknown as ReaderHttpClient,
      path: "D:/books/series",
      kind: "folder",
      onOpen,
      onBrowsePath,
      onActivateInFolderCard,
      penetration: { enabled: true, maxDepth: 3, terminalTargets: ["archive", "media-directory"] },
    })
    expect(onActivateInFolderCard).toHaveBeenCalledWith("D:/books/series")
    expect(onOpen).toHaveBeenCalledWith("D:/books/series/nested", {
      browserOriginPath: "D:/books",
      browserOriginEntryPath: "D:/books/series",
    })
  })

  it("falls back to a temporary browser resolve when File Card activation is unavailable", async () => {
    const onOpen = vi.fn()
    const onBrowsePath = vi.fn()
    const openDirectoryBrowser = vi.fn(async () => ({ sessionId: "browser-temp" }))
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const resolveFolderPenetration = vi.fn(async () => ({
      status: "resolved" as const,
      originPath: "D:/books/series",
      terminal: { kind: "media-directory" as const, path: "D:/books/series/nested" },
      chain: [],
      reason: "media-directory" as const,
    }))
    await openLibraryEntry({
      client: {
        openDirectoryBrowser,
        closeDirectoryBrowser,
        resolveFolderPenetration,
      } as unknown as ReaderHttpClient,
      path: "D:/books/series",
      kind: "folder",
      onOpen,
      onBrowsePath,
      penetration: { enabled: true, maxDepth: 3, terminalTargets: ["archive", "media-directory"] },
    })
    expect(openDirectoryBrowser).toHaveBeenCalledWith("D:/books", undefined)
    expect(resolveFolderPenetration).toHaveBeenCalledWith(
      "browser-temp",
      "D:/books/series",
      { maxDepth: 3, terminalTargets: ["archive", "media-directory"] },
      undefined,
    )
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-temp")
    expect(onBrowsePath).toHaveBeenCalledWith("D:/books")
    expect(onOpen).toHaveBeenCalledWith("D:/books/series/nested", {
      browserOriginPath: "D:/books",
      browserOriginEntryPath: "D:/books/series",
    })
  })

  it("enters the original folder when resolve reports a branch", async () => {
    const onBrowsePath = vi.fn()
    const onOpen = vi.fn()
    await applyFolderPenetrationResolution({
      originPath: "D:/books/series",
      parentPath: "D:/books",
      resolution: {
        status: "branch",
        originPath: "D:/books/series",
        chain: [],
        reason: "multiple-primary-items",
      },
      onBrowsePath,
      onOpen,
    })
    expect(onBrowsePath).toHaveBeenCalledWith("D:/books/series")
    expect(onOpen).not.toHaveBeenCalled()
  })
})
