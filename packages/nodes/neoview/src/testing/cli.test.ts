import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import type {
  HeadlessPageStream,
  HeadlessReaderPageSnapshot,
  HeadlessReaderSnapshot,
  OpenHeadlessReaderInput,
  ReaderHeadlessController,
  ReaderFileTreeHeadlessController,
  ReaderFileOperationService,
  ReaderSystemIntegrationService,
  ReaderLibraryHeadlessController,
  ReaderBookSettingsSnapshot,
} from "../core.js"
import { runProgram } from "../cli.js"
import { createReaderFileTreeController, createReaderHeadlessController } from "../platform.js"
import { ReaderCacheService } from "../application/cache/ReaderCacheService.js"
import { ReaderDiagnosticsService } from "../application/diagnostics/ReaderDiagnosticsService.js"
import type { ReaderPresentationDiskCache } from "../ports/ReaderPresentationDiskCache.js"
import { loadNeoviewRuntimeConfig } from "../platform/config/loadNeoviewRuntimeConfig.js"

const testPlatformDependencies = {
  createController: (options = {}) => createReaderHeadlessController({ ...options, progressStore: false }),
  createFileTreeController: (options = {}) => createReaderFileTreeController({ ...options, legacyThumbnailDatabasePath: false }),
}

describe("NeoView CLI", () => {
  it("[neoview.file-operations.cli] adapts shared operations and confirms destructive commands", async () => {
    const execute = vi.fn(async ({ operations }: Parameters<ReaderFileOperationService["execute"]>[0]) => ({
      results: operations.map((operation, index) => ({ index, operation, status: "succeeded" as const })),
      succeeded: operations.length,
      failed: 0,
      cancelled: 0,
    }))
    const close = vi.fn(async () => undefined)
    const prepare = vi.fn(async () => undefined)
    const undoState = vi.fn(() => ({ available: true, count: 1, persistent: true, supportedKinds: [], trashRestore: false as const }))
    const undoLatest = vi.fn(async () => ({ results: [], succeeded: 1, failed: 0, remaining: 0, journalPersisted: true }))
    const discardLatest = vi.fn(async () => ({ discarded: true, remaining: 0, journalPersisted: true }))
    const service = { execute, close, prepare, undoState, undoLatest, discardLatest } as unknown as ReaderFileOperationService
    const createFileOperationService = vi.fn(async () => service)
    const openSystem = vi.fn(async () => undefined)
    const revealSystem = vi.fn(async () => undefined)
    const dependencies = {
      createController: async () => fakeReader(),
      createFileOperationService,
      createSystemIntegrationService: async () => ({ open: openSystem, reveal: revealSystem }) as unknown as ReaderSystemIntegrationService,
    }

    await runProgram(["file-copy", "source.jpg", "target.jpg", "--overwrite", "--concurrency", "1"], host([]), dependencies)
    expect(execute).toHaveBeenLastCalledWith({ operations: [{
      kind: "copy",
      sourcePath: resolve("source.jpg"),
      destinationPath: resolve("target.jpg"),
      overwrite: true,
    }], concurrency: 1 })
    await expect(runProgram(["file-delete", "source.jpg"], host([]), dependencies)).rejects.toThrow("requires --yes")
    await runProgram(["file-delete", "source.jpg", "target.jpg", "--yes"], host([]), dependencies)
    expect(execute).toHaveBeenLastCalledWith({ operations: [
      { kind: "delete", sourcePath: resolve("source.jpg") },
      { kind: "delete", sourcePath: resolve("target.jpg") },
    ], concurrency: 4 })
    await expect(runProgram(["file-undo"], host([]), dependencies)).rejects.toThrow("requires --yes")
    await runProgram(["file-undo", "--yes", "--database", "undo.db"], host([]), dependencies)
    expect(createFileOperationService).toHaveBeenLastCalledWith(resolve("undo.db"))
    expect(undoLatest).toHaveBeenCalledOnce()
    await expect(runProgram(["file-undo-discard"], host([]), dependencies)).rejects.toThrow("requires --yes")
    await runProgram(["file-undo-discard", "--yes"], host([]), dependencies)
    expect(discardLatest).toHaveBeenCalledOnce()
    const state: unknown[] = []
    await runProgram(["file-undo-state", "--json"], host(state), dependencies)
    expect(JSON.parse(state.join(""))).toMatchObject({ available: true, count: 1, persistent: true })
    expect(prepare).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledTimes(5)
    await runProgram(["file-open", "source.jpg"], host([]), dependencies)
    await runProgram(["file-reveal", "source.jpg"], host([]), dependencies)
    expect(openSystem).toHaveBeenCalledWith(resolve("source.jpg"))
    expect(revealSystem).toHaveBeenCalledWith(resolve("source.jpg"))
  })

  it("[neoview.file.explorer-context-menu.cli] previews and explicitly toggles the shared system capability", async () => {
    const preview = vi.fn(async () => ({ available: true, plan: [], registryFile: "registry" }))
    const status = vi.fn(async () => ({ available: true, enabled: false }))
    const setEnabled = vi.fn(async (enabled: boolean) => ({ available: true, enabled }))
    const dependencies = {
      createController: async () => fakeReader(),
      createSystemIntegrationService: async () => ({
        explorerContextMenuPreview: preview,
        explorerContextMenuStatus: status,
        explorerContextMenuSetEnabled: setEnabled,
      }) as unknown as ReaderSystemIntegrationService,
    }

    const previewOutput: unknown[] = []
    await runProgram(["explorer-context-menu-preview", "--json"], host(previewOutput), dependencies)
    expect(JSON.parse(previewOutput.join(""))).toEqual({ available: true, plan: [], registryFile: "registry" })
    await runProgram(["explorer-context-menu-status"], host([]), dependencies)
    await expect(runProgram(["explorer-context-menu-enable"], host([]), dependencies)).rejects.toThrow("requires --yes")
    await runProgram(["explorer-context-menu-enable", "--yes"], host([]), dependencies)
    expect(preview).toHaveBeenCalledOnce()
    expect(status).toHaveBeenCalledOnce()
    expect(setEnabled).toHaveBeenCalledWith(true)
  })

  it("[neoview.library.cli] [neoview.history.cleanup-cli] [neoview.bookmark.batch-cli] [neoview.folder.filter-library-cli] adapts shared library operations and confirms destructive commands", async () => {
    const dispose = vi.fn(async () => undefined)
    const controller = {
      listRecent: vi.fn(async () => [{ bookId: "book-1", displayName: "Book" }]),
      listBookmarks: vi.fn(async () => [{ id: "bookmark-1", name: "Demo" }]),
      savePathBookmark: vi.fn(async () => ({ id: "bookmark-1", name: "Demo" })),
      removeBookmark: vi.fn(async () => true),
      updateBookmarks: vi.fn(async () => ({ items: [{ id: "bookmark-1" }, { id: "bookmark-2" }], missingIds: [] })),
      removeBookmarks: vi.fn(async () => ({ deleted: 2, missingIds: [] })),
      removeOldestRecents: vi.fn(async () => ({ selectedIds: ["book-1"], deleted: 1 })),
      clearByFolder: vi.fn(async () => 2),
      clearAll: vi.fn(async () => 3),
      cleanupInvalid: vi.fn(async () => ({ kind: "both", scanned: 2, missing: 1, unknown: 0, deleted: 1, truncated: false })),
      [Symbol.asyncDispose]: dispose,
    } as unknown as ReaderLibraryHeadlessController
    const dependencies = { createController: async () => fakeReader(), createLibraryController: async () => controller }

    const recents: unknown[] = []
    await runProgram(["library-recents", "--limit", "20", "--filter", "video", "--json"], host(recents), dependencies)
    expect(JSON.parse(recents.join(""))).toEqual({ items: [{ bookId: "book-1", displayName: "Book" }] })
    expect(controller.listRecent).toHaveBeenCalledWith(20, 0, "video")
    const bookmarks: unknown[] = []
    await runProgram(["library-bookmarks", "--list", "reading", "--filter", "archive", "--json"], host(bookmarks), dependencies)
    expect(controller.listBookmarks).toHaveBeenCalledWith("reading", 100, 0, "archive")
    const bookmark: unknown[] = []
    await runProgram(["library-bookmark-add", "demo.cbz", "--list", "reading", "--starred", "--json"], host(bookmark), dependencies)
    expect(controller.savePathBookmark).toHaveBeenCalledWith(expect.objectContaining({ starred: true, listIds: ["reading"] }))
    await expect(runProgram(["library-bookmark-delete", "--id", "bookmark-1"], host([]), dependencies)).rejects.toThrow("requires --yes")
    await runProgram(["library-bookmark-delete", "--id", "bookmark-1", "--yes"], host([]), dependencies)
    expect(controller.removeBookmark).toHaveBeenCalledWith("bookmark-1")
    await runProgram(["library-bookmark-batch-update", "--id", "bookmark-1", "--id", "bookmark-2", "--list", "reading", "--list", "default"], host([]), dependencies)
    expect(controller.updateBookmarks).toHaveBeenCalledWith([
      { id: "bookmark-1", listIds: ["reading", "default"] },
      { id: "bookmark-2", listIds: ["reading", "default"] },
    ])
    await expect(runProgram(["library-bookmark-batch-delete", "--id", "bookmark-1"], host([]), dependencies)).rejects.toThrow("requires --yes")
    await runProgram(["library-bookmark-batch-delete", "--id", "bookmark-1", "--id", "bookmark-2", "--yes"], host([]), dependencies)
    expect(controller.removeBookmarks).toHaveBeenCalledWith(["bookmark-1", "bookmark-2"])
    await expect(runProgram(["library-invalid-cleanup"], host([]), dependencies)).rejects.toThrow("requires --yes")
    await runProgram(["library-invalid-cleanup", "--kind", "both", "--scan-limit", "20", "--limit", "10", "--concurrency", "2", "--yes"], host([]), dependencies)
    expect(controller.cleanupInvalid).toHaveBeenCalledWith({ kind: "both", scanLimit: 20, deleteLimit: 10, concurrency: 2 })
    await expect(runProgram(["library-recent-cleanup-oldest", "--limit", "2"], host([]), dependencies)).rejects.toThrow("requires --yes")
    await runProgram(["library-recent-cleanup-oldest", "--limit", "2", "--yes"], host([]), dependencies)
    expect(controller.removeOldestRecents).toHaveBeenCalledWith(2)
    await runProgram(["library-recent-cleanup-folder", "books", "--yes"], host([]), dependencies)
    expect(controller.clearByFolder).toHaveBeenCalledWith("recents", resolve("books"))
    await runProgram(["library-recent-clear", "--yes"], host([]), dependencies)
    expect(controller.clearAll).toHaveBeenCalledWith("recents")
    expect(dispose).toHaveBeenCalledTimes(10)
    await expect(runProgram(["library-recents", "--filter", "invalid"], host([]), dependencies)).rejects.toThrow("--filter must be")
  })

  it("[neoview.folder.search-history-cli] shares headless history operations and confirms destructive commands", async () => {
    const dispose = vi.fn(async () => undefined)
    const controller = {
      listSearchHistory: vi.fn(async () => [{ scope: "folder", query: "cover", usedAt: 100, useCount: 2 }]),
      removeSearchHistory: vi.fn(async () => true),
      clearSearchHistory: vi.fn(async () => 1),
      [Symbol.asyncDispose]: dispose,
    } as unknown as ReaderFileTreeHeadlessController
    const dependencies = {
      createController: async () => fakeReader(),
      createFileTreeController: async () => controller,
    }
    const output: unknown[] = []
    await runProgram(["folder-search-history", "--scope", "folder", "--json"], host(output), dependencies)
    expect(JSON.parse(output.join(""))).toEqual({
      scope: "folder",
      entries: [{ scope: "folder", query: "cover", usedAt: 100, useCount: 2 }],
    })
    await expect(runProgram(["folder-search-history-delete", "--query", "cover"], host([]), dependencies)).rejects.toThrow("requires --yes")
    await runProgram(["folder-search-history-delete", "--query", "cover", "--yes"], host([]), dependencies)
    expect(controller.removeSearchHistory).toHaveBeenCalledWith("folder", "cover")
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it("[neoview.folder.emm-tags-cli] reuses shared EMM suggestions with bounded output and disposal", async () => {
    const dispose = vi.fn(async () => undefined)
    const suggestEmmTags = vi.fn(async () => [
      { category: "artist", tag: "Alice", favorite: true, translatedTag: "爱丽丝" },
      { category: "genre", tag: "Comedy", favorite: false },
    ])
    const controller = {
      suggestEmmTags,
      [Symbol.asyncDispose]: dispose,
    } as unknown as ReaderFileTreeHeadlessController
    const dependencies = {
      createController: async () => fakeReader(),
      createFileTreeController: async () => controller,
    }

    const jsonOutput: unknown[] = []
    await runProgram(["folder-emm-tags", "--limit", "2", "--database", "private/thumbnails.db", "--json"], host(jsonOutput), dependencies)
    expect(JSON.parse(jsonOutput.join(""))).toEqual({ suggestions: [
      { category: "artist", tag: "Alice", favorite: true, translatedTag: "爱丽丝" },
      { category: "genre", tag: "Comedy", favorite: false },
    ] })
    expect(suggestEmmTags).toHaveBeenLastCalledWith(2)

    const textOutput: unknown[] = []
    await runProgram(["folder-emm-tags"], host(textOutput), dependencies)
    expect(textOutput.join("")).toContain("artist:Alice\tfavorite\t爱丽丝")
    expect(textOutput.join("")).toContain("genre:Comedy\tcatalog")
    expect(suggestEmmTags).toHaveBeenLastCalledWith(8)

    await expect(runProgram(["folder-emm-tags", "--limit", "33"], host([]), dependencies)).rejects.toThrow("1 to 32")
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it("[neoview.folder.emm-search-cli] forwards structured EMM tag filters through the shared search controller", async () => {
    const closeSearch = vi.fn(async () => undefined)
    const dispose = vi.fn(async () => undefined)
    const search = vi.fn(() => ({
      events: {
        async *[Symbol.asyncIterator]() {
          yield { type: "meta", sessionId: "browser-1", rootPath: "D:/library", generation: 1, query: "", mode: "text" }
          yield { type: "complete", scanned: 0, matched: 0, truncated: false }
        },
      },
      close: closeSearch,
      [Symbol.asyncDispose]: closeSearch,
    }))
    const controller = {
      open: vi.fn(async () => ({ sessionId: "browser-1" })),
      setFilter: vi.fn(async () => undefined),
      search,
      recordSearchHistory: vi.fn(async () => undefined),
      [Symbol.asyncDispose]: dispose,
    } as unknown as ReaderFileTreeHeadlessController
    const dependencies = { createController: async () => fakeReader(), createFileTreeController: async () => controller }

    await runProgram([
      "folder-search", "D:/library",
      "--tag", "artist:Alice", "--tag", "genre:Comedy",
      "--exclude-tag", "genre:Horror", "--tag-mode", "any", "--json",
    ], host([]), dependencies)
    expect(search).toHaveBeenCalledWith("", expect.objectContaining({
      includeTags: ["artist:Alice", "genre:Comedy"],
      excludeTags: ["genre:Horror"],
      tagMode: "any",
    }))
    expect(closeSearch).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    await expect(runProgram(["folder-search", "D:/library", "--tag", "artist:Alice", "--tag-mode", "invalid"], host([]), dependencies))
      .rejects.toThrow("--tag-mode must be all or any")
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it("[neoview.folder.emm-edit-cli] applies a JSON batch through the shared generation-bound editor", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-emm-edit-cli-"))
    const inputPath = join(root, "updates.json")
    const invalidPath = join(root, "invalid.json")
    const databasePath = join(root, "thumbnails.db")
    const targetPath = join(root, "A.cbz")
    await writeFile(inputPath, JSON.stringify({
      updates: [{ path: targetPath, expectedRevision: 0, patch: { rating: 5, translatedTitle: "Translated" } }],
      concurrency: 1,
    }))
    await writeFile(invalidPath, "{")
    const dispose = vi.fn(async () => undefined)
    const editEmm = vi.fn(async () => ({ generation: 8, refreshRequired: false, results: [], succeeded: 1, conflicts: 0, failed: 0 }))
    const controller = {
      open: vi.fn(async () => ({ sessionId: "browser-1", generation: 7 })),
      editEmm,
      [Symbol.asyncDispose]: dispose,
    } as unknown as ReaderFileTreeHeadlessController
    const createFileTreeController = vi.fn(async () => controller)
    const dependencies = { createController: async () => fakeReader(), createFileTreeController }
    try {
      const output: unknown[] = []
      await runProgram([
        "folder-emm-edit", root, "--input", inputPath, "--database", databasePath,
        "--concurrency", "2", "--json",
      ], host(output), dependencies)
      expect(editEmm).toHaveBeenCalledWith({
        generation: 7,
        updates: [{ path: targetPath, expectedRevision: 0, patch: { rating: 5, translatedTitle: "Translated" } }],
        concurrency: 2,
      })
      expect(JSON.parse(output.join(""))).toMatchObject({ succeeded: 1, conflicts: 0, failed: 0 })
      expect(createFileTreeController).toHaveBeenCalledWith(expect.objectContaining({ legacyThumbnailDatabasePath: databasePath }))
      await expect(runProgram(["folder-emm-edit", root, "--input", invalidPath], host([]), dependencies))
        .rejects.toThrow("must be valid JSON")
      expect(dispose).toHaveBeenCalledTimes(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("[neoview.folder.search-history-import-cli] inspects and imports legacy history through the dedicated importer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-search-history-cli-"))
    const inputPath = join(directory, "settings.json")
    await writeFile(inputPath, JSON.stringify({
      version: "1.0.0",
      extended: { searchHistory: { file: [{ query: "cover", timestamp: 100 }] } },
    }))
    const dispose = vi.fn(async () => undefined)
    const importHistory = vi.fn(async () => ({ applied: 1, cleared: 0, skippedNewer: 0 }))
    const dependencies = {
      createController: async () => fakeReader(),
      createSearchHistoryImporter: async () => ({ import: importHistory, close: dispose, [Symbol.asyncDispose]: dispose }) as never,
    }
    try {
      const previewOutput: unknown[] = []
      await runProgram(["search-history-inspect", inputPath, "--json"], host(previewOutput), dependencies)
      expect(JSON.parse(previewOutput.join(""))).toMatchObject({
        scopes: ["file"], entries: [{ scope: "file", query: "cover", usedAt: 100 }], issues: [],
      })
      await expect(runProgram(["search-history-import", inputPath], host([]), dependencies)).rejects.toThrow("requires --yes")
      const importOutput: unknown[] = []
      await runProgram(["search-history-import", inputPath, "--strategy", "merge", "--yes", "--json"], host(importOutput), dependencies)
      expect(JSON.parse(importOutput.join(""))).toMatchObject({ imported: { applied: 1 }, issues: [] })
      expect(importHistory).toHaveBeenCalledWith(expect.objectContaining({ scopes: ["file"] }), "merge")
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.folder.cli] [neoview.folder.filter-cli] [neoview.folder.search-path-cli] reuses shared search options and persists exclusions only after confirmation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-folder-cli-"))
    const privatePath = join(directory, "private")
    const visiblePath = join(directory, "visible")
    const configPath = join(directory, "xiranite.config.toml")
    await mkdir(privatePath)
    await mkdir(visiblePath)
    await writeFile(join(privatePath, "hidden.cbz"), "hidden")
    await writeFile(join(visiblePath, "shown.cbz"), "shown")
    await writeFile(join(visiblePath, "movie.mp4"), "movie")
    try {
      const treeOutput: unknown[] = []
      await runProgram(["folder-tree", directory, "--json"], host(treeOutput), testPlatformDependencies)
      expect(JSON.parse(treeOutput.join(""))).toMatchObject({
        cacheHit: false,
        entries: [{ name: "private" }, { name: "visible" }],
      })

      const searchOutput: unknown[] = []
      await runProgram(["folder-search", directory, "--query", "cbz", "--json"], host(searchOutput), testPlatformDependencies)
      const searched = JSON.parse(searchOutput.join("")) as { entries: Array<{ name: string }>; complete: { matched: number; truncated: boolean } }
      expect(searched.entries.map((entry) => entry.name).toSorted()).toEqual(["hidden.cbz", "shown.cbz"])
      expect(searched.complete).toMatchObject({ matched: 2, truncated: false })

      const archiveOutput: unknown[] = []
      await runProgram(["folder-search", directory, "--query", "o", "--filter", "archive", "--json"], host(archiveOutput), testPlatformDependencies)
      expect((JSON.parse(archiveOutput.join("")) as { entries: Array<{ name: string }> }).entries.map((entry) => entry.name)).toEqual(["shown.cbz"])
      const videoOutput: unknown[] = []
      await runProgram(["folder-search", directory, "--query", "o", "--filter", "video", "--json"], host(videoOutput), testPlatformDependencies)
      expect((JSON.parse(videoOutput.join("")) as { entries: Array<{ name: string }> }).entries.map((entry) => entry.name)).toEqual(["movie.mp4"])
      await expect(runProgram(["folder-search", directory, "--query", "*", "--filter", "invalid"], host([]), testPlatformDependencies)).rejects.toThrow("--filter must be")

      const nameOnlyOutput: unknown[] = []
      await runProgram(["folder-search", directory, "--query", "visible/shown", "--json"], host(nameOnlyOutput), testPlatformDependencies)
      expect((JSON.parse(nameOnlyOutput.join("")) as { entries: unknown[] }).entries).toHaveLength(0)
      const pathOutput: unknown[] = []
      await runProgram(["folder-search", directory, "--query", "visible/shown", "--search-in-path", "--json"], host(pathOutput), testPlatformDependencies)
      expect((JSON.parse(pathOutput.join("")) as { entries: Array<{ name: string }> }).entries).toEqual([
        expect.objectContaining({ name: "shown.cbz" }),
      ])

      await expect(runProgram(["folder-exclude", privatePath, "--config", configPath], host([]), testPlatformDependencies)).rejects.toThrow("requires --yes")
      await runProgram(["folder-exclude", privatePath, "--config", configPath, "--yes", "--json"], host([]), testPlatformDependencies)
      expect(await readFile(configPath, "utf8")).toContain("[nodes.neoview.folder]")

      const filteredOutput: unknown[] = []
      await runProgram(["folder-search", directory, "--query", "cbz", "--config", configPath, "--json"], host(filteredOutput), testPlatformDependencies)
      const filtered = JSON.parse(filteredOutput.join("")) as { entries: Array<{ name: string }> }
      expect(filtered.entries.map((entry) => entry.name)).toEqual(["shown.cbz"])

      await runProgram(["folder-include", privatePath, "--config", configPath, "--yes"], host([]), testPlatformDependencies)
      const restoredOutput: unknown[] = []
      await runProgram(["folder-search", directory, "--query", "cbz", "--config", configPath, "--json"], host(restoredOutput), testPlatformDependencies)
      expect((JSON.parse(restoredOutput.join("")) as { entries: unknown[] }).entries).toHaveLength(2)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.cli.inspect] prints sanitized JSON and clears environment password bytes", async () => {
    const output: unknown[] = []
    const opened: OpenHeadlessReaderInput[] = []
    let passwordReference: Uint8Array | undefined
    const reader = fakeReader({
      open: async (input) => {
        opened.push(input)
        passwordReference = input.archivePasswords?.[0]?.rawPassword
        return snapshot(0)
      },
    })
    await runProgram(
      ["inspect", "private/book.cbz", "--password-env", "BOOK_PASSWORD", "--json"],
      host(output, { BOOK_PASSWORD: "unique-secret-421" }),
      { createController: async () => reader },
    )
    const json = output.join("")
    expect(JSON.parse(json)).toMatchObject({ book: { displayName: "book.cbz", pageCount: 3 } })
    expect(json).not.toContain("private/book.cbz")
    expect(json).not.toContain("unique-secret-421")
    expect(opened[0]?.path.replace(/\\/g, "/")).toMatch(/private\/book\.cbz$/)
    expect([...passwordReference ?? []]).toEqual(new Array(17).fill(0))
    expect(reader[Symbol.asyncDispose]).toHaveBeenCalledTimes(1)
  })

  it("[neoview.book-information.cli-projection] prints the shared title, type, page and progress semantics", async () => {
    const output: unknown[] = []
    const reader = fakeReader({ open: async () => ({
      ...snapshot(1),
      book: { displayName: "Original.cbz", translatedTitle: "Translated", sourceKind: "archive", pageCount: 3 },
    }) })
    await runProgram(["inspect", "book.cbz"], host(output), { createController: async () => reader })

    expect(output.join("\n")).toContain("Title: Translated")
    expect(output.join("\n")).toContain("Original title: Original.cbz")
    expect(output.join("\n")).toContain("Type: Archive")
    expect(output.join("\n")).toContain("Page: 2 / 3")
    expect(output.join("\n")).toContain("Progress: 66.7%")
  })

  it("[neoview.time-information.cli-projection] prints captured page timestamps without additional filesystem work", async () => {
    const output: unknown[] = []
    const base = snapshot(0)
    const reader = fakeReader({ open: async () => ({
      ...base,
      visiblePages: [{ ...base.visiblePages[0]!, timestamps: { source: "archive-entry", createdAtMs: 1_700_000_000_000, modifiedAtMs: 1_700_000_100_000, accessedAtMs: 1_700_000_200_000 } }],
    }) })
    await runProgram(["inspect", "book.cbz"], host(output), { createController: async () => reader })

    const text = output.join("\n")
    expect(text).toContain("Created:")
    expect(text).toContain("Modified:")
    expect(text).toContain("Accessed:")
    expect(text).toContain("Time source: Archive entry")
    expect(text).not.toContain("Invalid Date")
  })

  it("[neoview.cli.pages] lists a bounded page window", async () => {
    const output: unknown[] = []
    const reader = fakeReader()
    await runProgram(
      ["pages", "book.cbz", "--cursor", "1", "--limit", "1", "--json"],
      host(output),
      { createController: async () => reader },
    )
    expect(JSON.parse(output.join(""))).toMatchObject({
      cursor: 1,
      nextCursor: 2,
      total: 3,
      pages: [{ index: 1, name: "002.png" }],
    })
    expect(reader.listPages).toHaveBeenCalledWith(1, 1)
  })

  it("[neoview.cli.frame] opens directly at the requested frame", async () => {
    const output: unknown[] = []
    const reader = fakeReader({ open: async () => snapshot(2) })
    await runProgram(["frame", "book.cbz", "--index", "2", "--json"], host(output), {
      createController: async () => reader,
    })
    expect(JSON.parse(output.join(""))).toMatchObject({ frame: { anchorPageIndex: 2 }, visiblePages: [{ index: 2 }] })
  })

  it("[neoview.book-settings.cli] projects inherited CLI values into the shared revisioned controller", async () => {
    const getBookSettings = vi.fn(async () => bookSettingsSnapshot())
    const updateBookSettings = vi.fn(async () => ({
      settings: {
        ...bookSettingsSnapshot(),
        revision: 4,
        overrides: { favorite: true, horizontalBook: false },
        effective: { ...bookSettingsSnapshot().effective, favorite: true, horizontalBook: false },
      },
      reader: snapshot(0),
    }))
    const reader = fakeReader({ getBookSettings, updateBookSettings })
    const getOutput: unknown[] = []
    await runProgram(["book-settings-get", "book.cbz", "--json"], host(getOutput), { createController: async () => reader })
    expect(JSON.parse(getOutput.join(""))).toMatchObject({ schemaVersion: 1, revision: 3, effective: { pageMode: "single" } })

    const setOutput: unknown[] = []
    await runProgram([
      "book-settings-set", "book.cbz", "--expected-revision", "3",
      "--favorite", "true", "--rating", "inherit", "--direction", "inherit",
      "--page-mode", "double", "--horizontal-book", "false", "--json",
    ], host(setOutput), { createController: async () => reader })
    expect(updateBookSettings).toHaveBeenCalledWith(3, {
      favorite: true,
      rating: null,
      direction: null,
      pageMode: "double",
      horizontalBook: false,
    })
    expect(JSON.parse(setOutput.join(""))).toMatchObject({ settings: { revision: 4 }, reader: { frame: { anchorPageIndex: 0 } } })
  })

  it("[neoview.book-settings.cli-validation] requires CAS and validates projected settings", async () => {
    const reader = fakeReader()
    await expect(runProgram(["book-settings-set", "book.cbz", "--favorite", "true"], host([]), { createController: async () => reader }))
      .rejects.toThrow("--expected-revision is required")
    await expect(runProgram(["book-settings-set", "book.cbz", "--expected-revision", "0", "--rating", "6"], host([]), { createController: async () => reader }))
      .rejects.toThrow("--rating must be 1..5 or inherit")
    await expect(runProgram(["book-settings-set", "book.cbz", "--expected-revision", "0"], host([]), { createController: async () => reader }))
      .rejects.toThrow("at least one setting option")
    expect(reader.open).not.toHaveBeenCalled()
  })

  it("[neoview.cli.extract-page] writes only original page bytes to stdout", async () => {
    const output: unknown[] = []
    const close = vi.fn(async () => undefined)
    const reader = fakeReader({
      openPageStream: async () => ({
        page: pages[1]!,
        byteLength: 4,
        contentType: "image/png",
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.of(0x89, 0x50))
            controller.enqueue(Uint8Array.of(0x4e, 0x47))
            controller.close()
          },
        }),
        close,
        [Symbol.asyncDispose]: close,
      }),
    })
    await runProgram(["extract-page", "book.cbz", "--index", "1", "--output", "-"], host(output), {
      createController: async () => reader,
    })
    expect(Buffer.concat(output.map((chunk) => Buffer.from(chunk as Uint8Array)))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("[neoview.subtitle.cli] reuses local and remote subtitle controllers without reimplementing conversion", async () => {
    const tracks = [{ id: "subtitle-clip.srt", name: "clip.srt", format: "srt" as const, contentVersion: "v1" }]
    const listSubtitles = vi.fn(async () => tracks)
    const renderSubtitle = vi.fn(async () => ({ bytes: new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n"), contentVersion: "v1" }))
    const reader = fakeReader({
      listSubtitles,
      renderSubtitle,
    })
    const listOutput: unknown[] = []
    await runProgram(["subtitle-list", "clip.mp4", "--index", "1", "--json"], host(listOutput), {
      createController: async () => reader,
    })
    expect(JSON.parse(listOutput.join(""))).toEqual({ tracks })
    expect(listSubtitles).toHaveBeenCalledWith(1)

    const renderOutput: unknown[] = []
    await runProgram(["subtitle-render", "clip.mp4", "--index", "1", "--subtitle-id", "subtitle-clip.srt", "--output", "-"], host(renderOutput), {
      createController: async () => reader,
    })
    expect(renderSubtitle).toHaveBeenCalledWith(1, "subtitle-clip.srt")
    expect(new TextDecoder().decode(renderOutput[0] as Uint8Array)).toContain("WEBVTT")
    await expect(runProgram(["subtitle-render", "clip.mp4", "--subtitle-id", "subtitle-clip.srt"], host([]), {
      createController: async () => reader,
    })).rejects.toThrow("requires --output")

    const remoteListSubtitles = vi.fn(async () => tracks)
    const remote = fakeReader({ listSubtitles: remoteListSubtitles })
    const remoteOutput: unknown[] = []
    await runProgram(["subtitle-list", "clip.mp4", "--connect", "http://127.0.0.1:41000", "--json"], host(remoteOutput, { XIRANITE_BACKEND_TOKEN: "subtitle-token" }), {
      createController: async () => { throw new Error("local controller must stay lazy") },
      createRemoteController: async () => remote,
    })
    expect(JSON.parse(remoteOutput.join(""))).toEqual({ tracks })
    expect(remoteListSubtitles).toHaveBeenCalledWith(0)
  })

  it("[neoview.emm.cli] reuses the current-book CAS metadata contract on local and remote controllers", async () => {
    const metadata = { revision: 3, overrides: { rating: 4, translatedTitle: "Title" }, inherited: ["manualTags"] as const, updatedAt: 10 }
    const getEmmMetadata = vi.fn(async () => metadata)
    const updateEmmMetadata = vi.fn(async () => ({ metadata: { ...metadata, revision: 4, overrides: { manualTags: [{ namespace: "artist", tag: "name" }] }, inherited: ["rating", "translatedTitle"] as const }, reader: snapshot(0) }))
    const reader = fakeReader({ getEmmMetadata, updateEmmMetadata })
    const getOutput: unknown[] = []
    await runProgram(["emm-get", "book.cbz", "--json"], host(getOutput), { createController: async () => reader })
    expect(JSON.parse(getOutput.join(""))).toMatchObject({ revision: 3, overrides: { rating: 4 } })

    const setOutput: unknown[] = []
    await runProgram([
      "emm-set", "book.cbz", "--expected-revision", "3", "--input", '{"manualTags":[{"namespace":"artist","tag":"name"}]}', "--yes", "--json",
    ], host(setOutput), { createController: async () => reader })
    expect(updateEmmMetadata).toHaveBeenCalledWith(3, { manualTags: [{ namespace: "artist", tag: "name" }] })
    expect(JSON.parse(setOutput.join(""))).toMatchObject({ metadata: { revision: 4, overrides: { manualTags: [{ namespace: "artist", tag: "name" }] } } })

    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-emm-cli-"))
    try {
      const inputPath = join(directory, "patch.json")
      await writeFile(inputPath, JSON.stringify({ rating: 5 }), "utf8")
      await runProgram([
        "emm-set", "book.cbz", "--expected-revision", "3", "--input", inputPath, "--yes",
      ], host([]), { createController: async () => reader })
      expect(updateEmmMetadata).toHaveBeenLastCalledWith(3, { rating: 5 })
      await expect(runProgram([
        "emm-set", "book.cbz", "--expected-revision", "3", "--input", '{"unknown":true}', "--yes",
      ], host([]), { createController: async () => reader })).rejects.toThrow("Invalid EMM metadata patch")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }

    await expect(runProgram([
      "emm-set", "book.cbz", "--expected-revision", "3", "--input", '{"rating":4}',
    ], host([]), { createController: async () => reader })).rejects.toThrow("requires --yes")

    const remoteGetEmmMetadata = vi.fn(async () => metadata)
    const remote = fakeReader({ getEmmMetadata: remoteGetEmmMetadata })
    const remoteOutput: unknown[] = []
    await runProgram(["emm-get", "book.cbz", "--connect", "http://127.0.0.1:41000", "--json"], host(remoteOutput, { XIRANITE_BACKEND_TOKEN: "emm-token" }), {
      createController: async () => { throw new Error("local controller must stay lazy") },
      createRemoteController: async () => remote,
    })
    expect(JSON.parse(remoteOutput.join(""))).toMatchObject({ revision: 3 })
    expect(remoteGetEmmMetadata).toHaveBeenCalledOnce()
  })

  it("[neoview.media-progress.cli] delegates video progress validation and durable flush to the current Reader controller", async () => {
    const getMediaProgress = vi.fn(async () => undefined)
    const updateMediaProgress = vi.fn(async (update, options) => ({ bookId: "video-book", ...update, updatedAt: 10, flush: options?.flush }))
    const reader = fakeReader({ getMediaProgress, updateMediaProgress })
    const getOutput: unknown[] = []
    await runProgram(["media-progress-get", "clip.mp4", "--json"], host(getOutput), { createController: async () => reader })
    expect(JSON.parse(getOutput.join(""))).toEqual({ progress: null })

    const setOutput: unknown[] = []
    await runProgram([
      "media-progress-set", "clip.mp4", "--position", "12.5", "--duration", "30", "--completed", "false", "--flush", "--json",
    ], host(setOutput), { createController: async () => reader })
    expect(updateMediaProgress).toHaveBeenCalledWith({ position: 12.5, duration: 30, completed: false }, { flush: true })
    expect(JSON.parse(setOutput.join(""))).toMatchObject({ progress: { bookId: "video-book", position: 12.5, completed: false } })
    await expect(runProgram([
      "media-progress-set", "clip.mp4", "--position", "12", "--duration", "30", "--completed", "invalid",
    ], host([]), { createController: async () => reader })).rejects.toThrow("--completed must be true or false")
    const remoteUpdateMediaProgress = vi.fn(async (update, options) => ({ bookId: "remote-video", ...update, updatedAt: 12, flush: options?.flush }))
    const remote = fakeReader({
      getMediaProgress: vi.fn(async () => undefined),
      updateMediaProgress: remoteUpdateMediaProgress,
    })
    const remoteOutput: unknown[] = []
    await runProgram([
      "media-progress-set", "clip.mp4", "--position", "12", "--duration", "30", "--completed", "false", "--flush", "--connect", "http://127.0.0.1:41000", "--json",
    ], host(remoteOutput, { XIRANITE_BACKEND_TOKEN: "media-progress-token" }), {
      createController: async () => { throw new Error("local controller must stay lazy") },
      createRemoteController: async () => remote,
    })
    expect(remoteUpdateMediaProgress).toHaveBeenCalledWith({ position: 12, duration: 30, completed: false }, { flush: true })
    expect(JSON.parse(remoteOutput.join(""))).toMatchObject({ progress: { bookId: "remote-video", position: 12 } })
    await expect(runProgram(["media-progress-ui"], {
      ...host([]),
      stdin: { isTTY: false },
      stdout: { isTTY: false, write: () => true },
    } as CliHost, { createController: async () => reader })).rejects.toThrow("requires an interactive terminal")
    await expect(runProgram(["settings-backup-ui"], {
      ...host([]),
      stdin: { isTTY: false },
      stdout: { isTTY: false, write: () => true },
    } as CliHost, { createController: async () => reader })).rejects.toThrow("requires an interactive terminal")
  })

  it("[neoview.super-resolution.cli] delegates one manual page to the shared headless workflow", async () => {
    const output: unknown[] = []
    const upscalePage = vi.fn(async () => ({
      decision: { kind: "run" as const, reason: "default-policy", modelId: "model", scale: 2, useCache: true },
      result: {
        destinationPath: resolve("upscaled.png"),
        modelId: "model",
        engine: "upscayl" as const,
        scale: 2,
        width: 200,
        height: 300,
        elapsedMs: 12,
      },
    }))
    const reader = fakeReader({ upscalePage })

    await runProgram(["upscale-page", "book.cbz", "--index", "1", "--output", "upscaled.png", "--json"], host(output), {
      createController: async () => reader,
    })

    expect(upscalePage).toHaveBeenCalledWith({
      pageIndex: 1,
      destinationPath: resolve("upscaled.png"),
      trigger: "manual",
    })
    expect(JSON.parse(output.join(""))).toMatchObject({ result: { modelId: "model", width: 200, height: 300 } })
    expect(reader.open).toHaveBeenCalledWith(expect.objectContaining({ initialPage: 1 }))
  })

  it("[neoview.super-resolution.capabilities-cli] probes without opening a book", async () => {
    const output: unknown[] = []
    const inspectSuperResolution = vi.fn(async () => ({
      available: true as const,
      models: [{ id: "model", displayName: "Model", engine: "upscayl" as const, scales: [2] }],
      engines: [{ engine: "upscayl" as const, available: true, version: "1.2.3" }],
      probedAt: 1,
    }))
    const reader = fakeReader({ inspectSuperResolution })
    const createController = vi.fn(async () => reader)

    await runProgram(["upscale-capabilities", "--refresh", "--json"], host(output), {
      createController,
    })

    expect(createController).toHaveBeenCalledWith(expect.objectContaining({
      progressStore: false,
      legacyThumbnailDatabasePath: false,
    }))
    expect(inspectSuperResolution).toHaveBeenCalledWith({ refresh: true })
    expect(reader.open).not.toHaveBeenCalled()
    expect(JSON.parse(output.join(""))).toMatchObject({ available: true, models: [{ id: "model" }] })
  })

  it("rejects plaintext password argv and malformed commands", async () => {
    const reader = fakeReader()
    await expect(runProgram(["inspect", "book.cbz", "--password", "secret"], host([]), {
      createController: async () => reader,
    })).rejects.toThrow("Unknown NeoView option")
    expect(reader.open).not.toHaveBeenCalled()
  })

  it("clears password bytes when controller creation fails", async () => {
    const originalEncode = TextEncoder.prototype.encode
    let encoded: Uint8Array | undefined
    const spy = vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (value?: string) {
      encoded = originalEncode.call(this, value)
      return encoded
    })
    try {
      await expect(runProgram(
        ["inspect", "book.cbz", "--password-env", "BOOK_PASSWORD"],
        host([], { BOOK_PASSWORD: "ephemeral-secret" }),
        { createController: async () => { throw new Error("platform unavailable") } },
      )).rejects.toThrow("platform unavailable")
      expect([...encoded ?? []]).toEqual(new Array(16).fill(0))
    } finally {
      spy.mockRestore()
    }
  })

  it("[neoview.cli.reader-e2e] opens, probes and streams a real image through platform composition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-cli-"))
    const path = join(directory, "page.png")
    const bytes = pngHeader(37, 53)
    await writeFile(path, bytes)
    try {
      const metadataOutput: unknown[] = []
      await runProgram(["inspect", path, "--json"], host(metadataOutput), testPlatformDependencies)
      expect(JSON.parse(metadataOutput.join(""))).toMatchObject({
        book: { displayName: "page.png", pageCount: 1 },
        visiblePages: [{ index: 0, dimensions: { width: 37, height: 53 } }],
      })

      const binaryOutput: unknown[] = []
      await runProgram(["extract-page", path, "--index", "0", "--output", "-"], host(binaryOutput), testPlatformDependencies)
      expect(Buffer.concat(binaryOutput.map((chunk) => Buffer.from(chunk as Uint8Array)))).toEqual(Buffer.from(bytes))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.settings.runtime-cli] applies the shared TOML defaults in the real headless composition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-cli-config-"))
    const bookPath = join(directory, "book")
    const configPath = join(directory, "xiranite.config.toml")
    await mkdir(bookPath)
    await Promise.all(Array.from({ length: 4 }, (_, index) => writeFile(
      join(bookPath, `${String(index + 1).padStart(3, "0")}.png`),
      pngHeader(40 + index, 60 + index),
    )))
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.reader]",
      "reading_direction = \"right-to-left\"",
      "double_page_view = true",
      "",
    ].join("\n"), "utf8")
    try {
      const output: unknown[] = []
      await runProgram(["inspect", bookPath, "--index", "1", "--config", configPath, "--json"], host(output), testPlatformDependencies)
      expect(JSON.parse(output.join(""))).toMatchObject({
        frame: { direction: "right-to-left", layout: { pageMode: "double" } },
        visiblePages: [{ index: 2 }, { index: 1 }],
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.page-transition.surfaces] exposes strict CLI get/set/reset values in canonical TOML", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-page-transition-cli-"))
    const configPath = join(directory, "xiranite.config.toml")
    try {
      const initial: unknown[] = []
      await runProgram(["page-transition-get", "--config", configPath, "--json"], host(initial))
      expect(JSON.parse(initial.join(""))).toEqual({ enabled: false, type: "none", duration: 0, easing: "easeOutQuad" })

      const updated: unknown[] = []
      await runProgram([
        "page-transition-set", "--config", configPath, "--enabled", "true", "--type", "flip",
        "--duration", "320", "--easing", "easeOutCubic", "--json",
      ], host(updated))
      expect(JSON.parse(updated.join(""))).toEqual({ enabled: true, type: "flip", duration: 320, easing: "easeOutCubic" })
      const toml = await readFile(configPath, "utf8")
      expect(toml).toContain("[nodes.neoview.image]")
      expect(toml).not.toContain("pageTransition")
      await expect(runProgram(["page-transition-set", "--config", configPath, "--duration", "501"], host([])))
        .rejects.toThrow("duration")

      await runProgram(["page-transition-reset", "--config", configPath], host([]))
      const reset: unknown[] = []
      await runProgram(["page-transition-get", "--config", configPath, "--json"], host(reset))
      expect(JSON.parse(reset.join(""))).toEqual({ enabled: false, type: "none", duration: 0, easing: "easeOutQuad" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.image-trim.cli] exposes strict linked get/set/reset values in canonical TOML", async () => {
    await expect(runProgram(["image-trim-ui"], host([]))).rejects.toThrow("interactive terminal")
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-image-trim-cli-"))
    const configPath = join(directory, "xiranite.config.toml")
    try {
      const initial: unknown[] = []
      await runProgram(["image-trim-get", "--config", configPath, "--json"], host(initial))
      expect(JSON.parse(initial.join(""))).toEqual({
        enabled: false,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        linkVertical: false,
        linkHorizontal: false,
        autoTrimThreshold: 30,
        autoTrimTarget: "auto",
      })

      await runProgram([
        "image-trim-set", "--config", configPath,
        "--enabled", "true", "--top", "10", "--bottom", "20", "--left", "5", "--right", "15",
        "--threshold", "45", "--target", "black", "--json",
      ], host([]))
      const linked: unknown[] = []
      await runProgram([
        "image-trim-set", "--config", configPath,
        "--link-vertical", "true", "--link-horizontal", "true", "--json",
      ], host(linked))
      expect(JSON.parse(linked.join(""))).toMatchObject({
        enabled: true,
        top: 20,
        bottom: 20,
        left: 15,
        right: 15,
        linkVertical: true,
        linkHorizontal: true,
        autoTrimThreshold: 45,
        autoTrimTarget: "black",
      })

      const edged: unknown[] = []
      await runProgram([
        "image-trim-set", "--config", configPath, "--top", "12.5", "--left", "8", "--json",
      ], host(edged))
      expect(JSON.parse(edged.join(""))).toMatchObject({ top: 12.5, bottom: 12.5, left: 8, right: 8 })
      const toml = await readFile(configPath, "utf8")
      expect(toml).toContain("[nodes.neoview.view]")
      expect(toml).toContain("link_vertical = true")
      expect(toml).not.toContain("linkVertical")

      await expect(runProgram(["image-trim-set", "--config", configPath, "--top", "46"], host([])))
        .rejects.toThrow("top")
      await expect(runProgram(["image-trim-set", "--config", configPath, "--threshold", "12"], host([])))
        .rejects.toThrow("step")
      await expect(runProgram(["image-trim-set", "--config", configPath, "--target", "gray"], host([])))
        .rejects.toThrow("autoTrimTarget")

      await runProgram(["image-trim-reset", "--config", configPath], host([]))
      const reset: unknown[] = []
      await runProgram(["image-trim-get", "--config", configPath, "--json"], host(reset))
      expect(JSON.parse(reset.join(""))).toEqual({
        enabled: false,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        linkVertical: false,
        linkHorizontal: false,
        autoTrimThreshold: 30,
        autoTrimTarget: "auto",
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.settings.inspect] previews legacy settings without writing TOML or exposing secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-settings-inspect-"))
    const inputPath = join(directory, "backup.json")
    await writeFile(inputPath, JSON.stringify({
      version: "2.0.0",
      backupType: "manual",
      nativeSettings: { system: { language: "zh-CN" }, view: { defaultZoomMode: "fit" } },
      rawLocalStorage: { "neoview-gist-sync": JSON.stringify({ token: "must-not-leak" }) },
    }))
    try {
      const output: unknown[] = []
      await runProgram(["settings-inspect", inputPath, "--json"], host(output))
      const text = output.join("")
      expect(text).not.toContain("must-not-leak")
      expect(JSON.parse(text)).toMatchObject({
        report: { sourceKind: "backup", summary: { "rejected-sensitive": 1 } },
        configPatch: { schema_version: 1, system: { language: "zh-CN" } },
      })
      await expect(readFile(join(directory, "xiranite.config.toml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.settings.inspect] flags deferred migration data for review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-settings-deferred-"))
    const inputPath = join(directory, "backup.json")
    try {
      await writeFile(inputPath, JSON.stringify({
        version: "2.0.0",
        backupType: "manual",
        rawLocalStorage: { "neoview-history": "[]" },
      }))
      const output: unknown[] = []
      await runProgram(["settings-inspect", inputPath], host(output))
      expect(output.join("")).toContain("Review unresolved settings before final migration acceptance.")
      expect(output.join("")).not.toContain("All supplied settings were recognized.")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.settings.import] requires confirmation and idempotently writes [nodes.neoview]", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-settings-import-"))
    const inputPath = join(directory, "settings.json")
    const configPath = join(directory, "xiranite.config.toml")
    await writeFile(inputPath, JSON.stringify({
      format: "NeoView/1.0",
      config: {
        system: { language: "en", thumbnailDirectory: "D:/thumbs" },
        view: { defaultZoomMode: "fitWidth" },
        book: { readingDirection: "right-to-left", doublePageView: true },
      },
    }))
    try {
      await expect(runProgram(["settings-import", inputPath, "--config", configPath], host([])))
        .rejects.toThrow("requires --yes")

      const firstOutput: unknown[] = []
      await runProgram([
        "settings-import", inputPath, "--config", configPath, "--strategy", "merge", "--modules", "native-settings", "--yes", "--json",
      ], host(firstOutput))
      expect(JSON.parse(firstOutput.join(""))).toMatchObject({ changed: true, strategy: "merge" })
      const toml = await readFile(configPath, "utf8")
      expect(toml).toContain("[nodes.neoview.reader]")
      expect(toml).toContain('reading_direction = "right-to-left"')

      const secondOutput: unknown[] = []
      await runProgram([
        "settings-import", inputPath, "--config", configPath, "--strategy", "merge", "--modules", "native-settings", "--yes", "--json",
      ], host(secondOutput))
      expect(JSON.parse(secondOutput.join(""))).toMatchObject({ changed: false })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.bindings.legacy-import-cli] atomically imports multiple bindings and radial menus into runtime TOML", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-bindings-import-"))
    const inputPath = join(directory, "settings.json")
    const configPath = join(directory, "xiranite.config.toml")
    await writeFile(inputPath, JSON.stringify({
      version: "1.0.0",
      keybindings: [{
        action: "nextPage",
        bindings: [{ type: "keyboard", key: "ArrowRight" }, { type: "keyboard", key: "Space" }],
        contextBindings: [{ context: "viewer", input: { type: "mouse", gesture: "click", button: "right" } }],
      }],
      radialMenus: {
        id: "default",
        name: "旧轮盘",
        items: [{ id: "next", label: "下一页", action: "nextPage" }],
      },
    }))
    try {
      const output: unknown[] = []
      await runProgram([
        "settings-import", inputPath, "--config", configPath, "--strategy", "merge", "--modules", "keybindings", "--yes", "--json",
      ], host(output))
      expect(JSON.parse(output.join(""))).toMatchObject({ changed: true, strategy: "merge" })

      const runtime = await loadNeoviewRuntimeConfig({ configPath })
      expect(runtime.inputBindings.bindings).toHaveLength(3)
      expect(runtime.inputBindings.bindings.filter((binding) => binding.action === "reader.next-page")).toHaveLength(3)
      expect(runtime.radialMenu.menus[0]?.layers[0]?.[0]).toMatchObject({ action: "reader.next-page" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.bindings.config-cli] lists, applies and resets a complete multi-binding configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-bindings-cli-"))
    const inputPath = join(directory, "bindings.json")
    const configPath = join(directory, "xiranite.config.toml")
    const bindings = [
      { id: "key-next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "keyboard", code: "ArrowRight" } },
      { id: "mouse-next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "mouse", button: 3, action: "click" } },
    ]
    await writeFile(inputPath, JSON.stringify({ bindings }))
    try {
      await expect(runProgram(["input-bindings-apply", inputPath, "--config", configPath], host([]))).rejects.toThrow("requires --yes")
      const applyOutput: unknown[] = []
      await runProgram(["input-bindings-apply", inputPath, "--config", configPath, "--yes", "--json"], host(applyOutput))
      expect(JSON.parse(applyOutput.join(""))).toMatchObject({ changed: true, config: { bindings } })

      const listOutput: unknown[] = []
      await runProgram(["input-bindings-list", "--config", configPath, "--json"], host(listOutput))
      expect(JSON.parse(listOutput.join(""))).toEqual({ bindings })

      const resetOutput: unknown[] = []
      await runProgram(["input-bindings-reset", "--config", configPath, "--yes", "--json"], host(resetOutput))
      expect(JSON.parse(resetOutput.join("")).config.bindings.length).toBeGreaterThan(bindings.length)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.bindings.action-dispatch-cli] maps legacy IDs and reports unsupported headless actions", async () => {
    const controller = fakeReader()
    const nextOutput: unknown[] = []
    await runProgram(["input-action-dispatch", "book.cbz", "--action", "nextPage", "--json"], host(nextOutput), {
      ...testPlatformDependencies,
      createController: async () => controller,
    })
    expect(JSON.parse(nextOutput.join(""))).toMatchObject({ handled: true, action: "reader.next-page", snapshot: { frame: { anchorPageIndex: 1 } } })
    expect(controller.next).toHaveBeenCalledOnce()

    const unsupportedOutput: unknown[] = []
    await runProgram(["input-action-dispatch", "book.cbz", "--action", "zoomIn", "--json"], host(unsupportedOutput), {
      ...testPlatformDependencies,
      createController: async () => fakeReader(),
    })
    expect(JSON.parse(unsupportedOutput.join(""))).toEqual({ handled: false, action: "reader.zoom-in", reason: "unsupported-on-headless-surface" })
  })

  it("[neoview.settings.portable-cli] exports and round-trips the current node config without sensitive values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-settings-portable-"))
    const configPath = join(directory, "xiranite.config.toml")
    const exportPath = join(directory, "portable.json")
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "secret = \"hidden\"",
      "",
      "[nodes.neoview.future]",
      "enabled = true",
      "",
    ].join("\n"), "utf8")
    try {
      await runProgram(["settings-export", "--config", configPath, "--output", exportPath], host([]))
      const content = await readFile(exportPath, "utf8")
      expect(content).not.toContain("hidden")
      expect(JSON.parse(content)).toMatchObject({
        format: "Xiranite/NeoViewConfig",
        version: 1,
        nodeConfig: { schema_version: 1, future: { enabled: true } },
        omittedSensitivePaths: ["secret"],
      })
      await expect(runProgram(["settings-export", "--config", configPath, "--output", exportPath], host([])))
        .rejects.toMatchObject({ code: "EEXIST" })

      const inspectOutput: unknown[] = []
      await runProgram(["settings-portable-inspect", exportPath, "--json"], host(inspectOutput))
      expect(JSON.parse(inspectOutput.join(""))).toMatchObject({ format: "Xiranite/NeoViewConfig", version: 1 })

      await writeFile(configPath, "[nodes.neoview]\nold = true\n", "utf8")
      const importOutput: unknown[] = []
      await runProgram([
        "settings-portable-import", exportPath, "--config", configPath, "--strategy", "overwrite", "--yes", "--json",
      ], host(importOutput))
      expect(JSON.parse(importOutput.join(""))).toMatchObject({ changed: true, backupCreated: true })
      const restored = await readFile(configPath, "utf8")
      expect(restored).toContain("[nodes.neoview.future]")
      expect(restored).not.toContain("old = true")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.settings.backup-cli] requires confirmation and reports a path-free verified bundle summary", async () => {
    const output: unknown[] = []
    const create = vi.fn(async () => ({
      destinationPath: "D:/private/backup",
      manifest: {
        format: "Xiranite/NeoViewBackup" as const,
        version: 1 as const,
        createdAt: 123,
        settings: { name: "settings.json", bytes: 40, sha256: "a".repeat(64), format: "Xiranite/NeoViewConfig" as const, version: 1 as const, omittedSensitivePaths: [] },
        database: { name: "thumbnails.db", bytes: 60, sha256: "b".repeat(64), compatibility: "current", quickCheck: "ok" as const },
      },
    }))
    const inspect = vi.fn(async () => ({
      bundlePath: "D:/private/backup",
      manifest: (await create()).manifest,
      settings: { format: "Xiranite/NeoViewConfig" as const, version: 1 as const, exportedAt: 1, nodeConfig: {}, omittedSensitivePaths: [] },
      database: { sourcePath: "D:/private/db", verifiedPath: "D:/private/db", bytes: 60, compatibility: "current" as const, quickCheck: "ok" as const },
    }))
    const restore = vi.fn(async () => ({
      manifest: (await create()).manifest,
      settingsChanged: true,
      database: { recovered: true as const, sourcePath: "private", backupPath: "private", quarantinedDatabasePath: "private", originalCompatibility: "current" as const, restoredBytes: 60, quickCheck: "ok" as const },
    }))
    const dependencies = { ...testPlatformDependencies, createBackupBundleService: async () => ({ create, inspect, restore }) }
    await expect(runProgram(["settings-backup", "backup"], host([]), dependencies)).rejects.toThrow("requires --yes")
    await runProgram(["settings-backup", "backup", "--yes", "--json"], host(output), dependencies)
    const text = output.join("")
    expect(text).not.toContain("D:/private")
    expect(JSON.parse(text)).toEqual({
      created: true,
      format: "Xiranite/NeoViewBackup",
      version: 1,
      createdAt: 123,
      settingsBytes: 40,
      databaseBytes: 60,
      databaseQuickCheck: "ok",
    })
    expect(create).toHaveBeenCalledWith(expect.stringContaining("backup"))
    output.length = 0
    await runProgram(["settings-backup-inspect", "backup", "--json"], host(output), dependencies)
    expect(JSON.parse(output.join(""))).toMatchObject({ valid: true, databaseQuickCheck: "ok" })
    await expect(runProgram(["settings-backup-restore", "backup", "--yes", "--quarantine", "old.db"], host([]), dependencies))
      .rejects.toThrow("requires --offline")
    output.length = 0
    await runProgram([
      "settings-backup-restore", "backup", "--offline", "--yes", "--quarantine", "old.db", "--json",
    ], host(output), dependencies)
    expect(JSON.parse(output.join(""))).toEqual({
      restored: true,
      format: "Xiranite/NeoViewBackup",
      version: 1,
      settingsChanged: true,
      databaseQuickCheck: "ok",
      originalQuarantined: true,
    })
  })

  it("[neoview.settings.backup-scheduled-cli] runs one due configured backup and requires confirmation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-scheduled-backup-cli-"))
    const configPath = join(directory, "xiranite.config.toml")
    const automaticRoot = join(directory, "automatic")
    const createdAt = new Map<string, number>()
    const create = vi.fn(async (destinationPath: string) => {
      await mkdir(destinationPath)
      createdAt.set(destinationPath, 123)
      return { destinationPath, manifest: {} }
    })
    const inspect = vi.fn(async (bundlePath: string) => ({
      bundlePath,
      manifest: {
        format: "Xiranite/NeoViewBackup" as const,
        version: 1 as const,
        createdAt: createdAt.get(bundlePath)!,
        settings: { name: "settings.json", bytes: 1, sha256: "a".repeat(64), format: "Xiranite/NeoViewConfig" as const, version: 1 as const, omittedSensitivePaths: [] },
        database: { name: "thumbnails.db", bytes: 1, sha256: "b".repeat(64), compatibility: "current", quickCheck: "ok" as const },
      },
      settings: { format: "Xiranite/NeoViewConfig" as const, version: 1 as const, exportedAt: 123, nodeConfig: {}, omittedSensitivePaths: [] },
      database: { sourcePath: bundlePath, verifiedPath: bundlePath, bytes: 1, compatibility: "current" as const, quickCheck: "ok" as const },
    }))
    const dependencies = { ...testPlatformDependencies, createBackupBundleService: async () => ({ create, inspect, restore: vi.fn() }) }
    try {
      await writeFile(configPath, [
        "[nodes.neoview.backup]",
        "enabled = true",
        'directory = "automatic"',
        "interval_hours = 6",
        "retain_count = 2",
        "",
      ].join("\n"), "utf8")
      await expect(runProgram(["settings-backup-scheduled", "--config", configPath], host([]), dependencies)).rejects.toThrow("requires --yes")
      const output: unknown[] = []
      await runProgram(["settings-backup-scheduled", "--config", configPath, "--yes", "--json"], host(output), dependencies)
      expect(JSON.parse(output.join(""))).toMatchObject({ status: "created", createdAt: 123, pruned: 0 })
      expect(create).toHaveBeenCalledOnce()
      expect(String(create.mock.calls[0]?.[0]).replace(/\\/g, "/")).toContain("/automatic/xiranite-neoview-auto-")
      const bundles = await readdir(automaticRoot)
      expect(bundles).toHaveLength(1)
      expect(await readFile(join(automaticRoot, bundles[0]!, ".xiranite-neoview-auto-backup.json"), "utf8")).toContain("Xiranite/NeoViewAutoBackup")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.reader-data.cli] previews safely and requires confirmation before shared-store import", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-reader-data-"))
    const inputPath = join(directory, "backup.json")
    const databasePath = join(directory, "thumbnails.db")
    const configPath = join(directory, "xiranite.config.toml")
    await writeFile(inputPath, JSON.stringify({
      version: "2.0.0",
      rawLocalStorage: {
        "neoview-unified-history": JSON.stringify([{
          pathStack: [{ path: "D:/private/book.cbz" }], displayName: "Book", currentIndex: 2, totalItems: 10, timestamp: 100,
        }]),
        "neoview-bookmarks": JSON.stringify([{ path: "D:/private/book.cbz", name: "Book", listIds: ["reading"] }]),
        "neoview-bookmark-lists-v2": JSON.stringify([{ id: "reading", name: "Reading", createdAt: 100 }]),
        "neoview-bookmark-active-list-v2": "reading",
        "neoview-history-settings": JSON.stringify({ maxHistorySize: 250 }),
      },
    }))
    const importData = vi.fn(async () => ({
      applied: { progress: 1, bookmarks: 1, bookmarkLists: 0, pathStacks: 0, mediaProgress: 0 },
      unresolvedSources: 0,
      reportEntries: [],
    }))
    const dispose = vi.fn(async () => undefined)
    const createDataImporter = vi.fn(async () => ({ import: importData, [Symbol.asyncDispose]: dispose }))
    const dependencies = { createController: async () => fakeReader(), createDataImporter } as unknown as Parameters<typeof runProgram>[2]
    try {
      const previewOutput: unknown[] = []
      await runProgram(["reader-data-inspect", inputPath, "--json"], host(previewOutput), dependencies)
      const previewText = previewOutput.join("")
      expect(previewText).not.toContain("D:/private")
      expect(JSON.parse(previewText)).toMatchObject({
        sourceKind: "backup",
        counts: { history: 1, bookmarks: 1 },
        configPatch: {
          history: { max_history_size: 250 },
          bookmark_list: { active_list_id: "reading" },
        },
      })

      await expect(runProgram(["reader-data-import", inputPath], host([]), dependencies)).rejects.toThrow("requires --yes")
      expect(createDataImporter).not.toHaveBeenCalled()

      const importOutput: unknown[] = []
      await runProgram([
        "reader-data-import", inputPath, "--database", databasePath, "--config", configPath, "--strategy", "merge", "--yes", "--json",
      ], host(importOutput), dependencies)
      expect(createDataImporter).toHaveBeenCalledWith(databasePath)
      expect(importData).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: "backup" }), "merge")
      expect(dispose).toHaveBeenCalledOnce()
      expect(JSON.parse(importOutput.join(""))).toMatchObject({ imported: { applied: { progress: 1, bookmarks: 1 } }, configChanged: true })
      const configText = await readFile(configPath, "utf8")
      expect(configText).toContain("max_history_size = 250")
      expect(configText).toContain("[nodes.neoview.bookmark_list]")
      expect(configText).toContain('active_list_id = "reading"')
      expect(configText).not.toContain("active_bookmark_list_id")
      await expect(loadNeoviewRuntimeConfig({ configPath })).resolves.toMatchObject({ bookmarkList: { activeListId: "reading" } })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.reader-data.active-list-validation] omits invalid or unavailable active-list selections without blocking data import", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-reader-data-active-list-"))
    const databasePath = join(directory, "thumbnails.db")
    const configPath = join(directory, "xiranite.config.toml")
    const importData = vi.fn(async () => ({
      applied: { progress: 0, bookmarks: 0, bookmarkLists: 0, pathStacks: 0, mediaProgress: 0 },
      unresolvedSources: 0,
      reportEntries: [],
    }))
    const dispose = vi.fn(async () => undefined)
    const dependencies = {
      createController: async () => fakeReader(),
      createDataImporter: async () => ({ import: importData, [Symbol.asyncDispose]: dispose }),
    } as unknown as Parameters<typeof runProgram>[2]
    try {
      const cases = [
        { name: "unknown", activeListId: "reading" },
        { name: "overlong", activeListId: "x".repeat(257) },
        { name: "nul", activeListId: "bad\0list" },
      ]
      for (const testCase of cases) {
        const inputPath = join(directory, `${testCase.name}.json`)
        await writeFile(inputPath, JSON.stringify({
          backupType: "manual",
          rawLocalStorage: { "neoview-bookmark-active-list-v2": testCase.activeListId },
        }))
        const previewOutput: unknown[] = []
        await runProgram(["reader-data-inspect", inputPath, "--json"], host(previewOutput), dependencies)
        expect(JSON.parse(previewOutput.join(""))).toMatchObject({ activeBookmarkListOmitted: true, configPatch: {} })
        await runProgram(["reader-data-import", inputPath, "--database", databasePath, "--config", configPath, "--yes", "--json"], host([]), dependencies)
      }
      expect(importData).toHaveBeenCalledTimes(cases.length)
      expect(dispose).toHaveBeenCalledTimes(cases.length)
      await expect(readFile(configPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })

      const systemInputPath = join(directory, "system.json")
      await writeFile(systemInputPath, JSON.stringify({
        backupType: "manual",
        rawLocalStorage: { "neoview-bookmark-active-list-v2": "all" },
      }))
      const systemPreview: unknown[] = []
      await runProgram(["reader-data-inspect", systemInputPath, "--json"], host(systemPreview), dependencies)
      expect(JSON.parse(systemPreview.join(""))).toMatchObject({ configPatch: { bookmark_list: { active_list_id: "all" } } })
      const systemConfigPath = join(directory, "system.config.toml")
      await runProgram(["reader-data-import", systemInputPath, "--database", databasePath, "--config", systemConfigPath, "--yes"], host([]), dependencies)
      expect(await readFile(systemConfigPath, "utf8")).toContain('active_list_id = "all"')

      await writeFile(configPath, "[nodes.neoview.bookmark_list]\nactive_list_id = \"reading\"\n")
      const emptyInputPath = join(directory, "empty.json")
      await writeFile(emptyInputPath, JSON.stringify({
        backupType: "manual",
        rawLocalStorage: { "neoview-bookmark-active-list-v2": "   " },
      }))
      await runProgram(["reader-data-import", emptyInputPath, "--database", databasePath, "--config", configPath, "--yes"], host([]), dependencies)
      expect(await readFile(configPath, "utf8")).toContain('active_list_id = "reading"')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.reader-data.cli] reports configuration commit failure after importing data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-reader-data-config-failure-"))
    const inputPath = join(directory, "backup.json")
    const configPath = join(directory, "xiranite.config.toml")
    const importData = vi.fn(async () => ({
      applied: { progress: 0, bookmarks: 0, bookmarkLists: 0, pathStacks: 0, mediaProgress: 0 },
      unresolvedSources: 0,
      reportEntries: [],
    }))
    const dependencies = {
      createController: async () => fakeReader(),
      createDataImporter: async () => ({ import: importData, [Symbol.asyncDispose]: async () => undefined }),
    } as unknown as Parameters<typeof runProgram>[2]
    try {
      await writeFile(inputPath, JSON.stringify({
        backupType: "manual",
        rawLocalStorage: { "neoview-history-settings": JSON.stringify({ maxHistorySize: 250 }) },
      }))
      await writeFile(configPath, "not = [valid")
      await expect(runProgram(["reader-data-import", inputPath, "--config", configPath, "--yes"], host([]), dependencies))
        .rejects.toThrow("Reader data was imported, but NeoView configuration was not migrated")
      expect(importData).toHaveBeenCalledOnce()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.book-settings.legacy-cli] inspects privately and imports through the shared migration service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-book-settings-cli-"))
    const inputPath = join(directory, "book-settings.json")
    const databasePath = join(directory, "thumbnails.db")
    const privateBookPath = "D:/private/Book.cbz"
    const content = JSON.stringify({
      [privateBookPath]: {
        favorite: true,
        rating: 5,
        readingDirection: "right-to-left",
        unknown: "ignored",
      },
    })
    await writeFile(inputPath, content)
    const report = { totalEntries: 1, validEntries: 1, invalidEntries: 0, invalidFields: 0, unknownFields: 1 }
    const inspectSettings = vi.fn(async () => ({ report }))
    const importSettings = vi.fn(async () => ({ report, result: {
      applied: { inserted: 1, updated: 0, unchanged: 0 }, unresolvedSources: 0, duplicateIdentities: 0,
    } }))
    const createBookSettingsMigrationFileController = vi.fn(async () => ({ inspect: inspectSettings, import: importSettings }))
    const dependencies = {
      createController: async () => fakeReader(),
      createBookSettingsMigrationFileController,
    } as unknown as Parameters<typeof runProgram>[2]
    try {
      const previewOutput: unknown[] = []
      await runProgram(["book-settings-legacy-inspect", inputPath, "--json"], host(previewOutput), dependencies)
      const previewText = previewOutput.join("")
      expect(previewText).not.toContain(privateBookPath)
      expect(JSON.parse(previewText)).toEqual({
        report: { totalEntries: 1, validEntries: 1, invalidEntries: 0, invalidFields: 0, unknownFields: 1 },
      })
      expect(inspectSettings).toHaveBeenCalledWith(inputPath)

      await expect(runProgram(["book-settings-legacy-import", inputPath], host([]), dependencies))
        .rejects.toThrow("requires --yes")
      expect(importSettings).not.toHaveBeenCalled()

      const importOutput: unknown[] = []
      await runProgram([
        "book-settings-legacy-import", inputPath, "--database", databasePath,
        "--strategy", "overwrite", "--yes", "--json",
      ], host(importOutput), dependencies)
      expect(importSettings).toHaveBeenCalledWith(inputPath, databasePath, "overwrite", true)
      const importText = importOutput.join("")
      expect(importText).not.toContain(privateBookPath)
      expect(JSON.parse(importText)).toMatchObject({
        report: { validEntries: 1 },
        result: { applied: { inserted: 1 }, unresolvedSources: 0, duplicateIdentities: 0 },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.thumbnail.inspect-cli] inspects the original app-data path without creating a database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-thumbnail-inspect-"))
    try {
      const output: unknown[] = []
      await runProgram(["thumbnail-db-inspect", "--json"], host(output, { APPDATA: directory }))
      const report = JSON.parse(output.join(""))
      expect(report).toMatchObject({ exists: false, compatibility: "missing" })
      expect(report.path.replace(/\\/g, "/")).toBe(`${directory.replace(/\\/g, "/")}/NeoView/thumbnails.db`)
      await expect(readFile(report.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.thumbnail.maintenance-cli] reuses the bounded store API and never prints database keys", async () => {
    const output: unknown[] = []
    const cleanupInvalid = vi.fn(async () => ({ scanned: 10, deleted: 2, unavailableVolumeRowsPreserved: 1, wrapped: false }))
    const cleanup = vi.fn(async () => 0)
    const clearFailures = vi.fn(async () => 3)
    const dispose = vi.fn(async () => undefined)
    const openThumbnailStore = vi.fn(async () => ({
      maintenanceSnapshot: async () => ({
        totalRows: 10,
        fileRows: 6,
        folderRows: 4,
        blobBytes: 1024,
        emptyBlobs: 0,
        failedRows: 1,
        failuresByReason: { "decode-error": 1 },
        writer: { pendingWrites: 0, flushing: false, committedBatches: 1, committedWrites: 2, busyRetries: 0, failedBatches: 0 },
      }),
      cleanup,
      cleanupInvalid,
      clearFailures,
      [Symbol.asyncDispose]: dispose,
    }))
    const dependencies = { createController: async () => fakeReader(), openThumbnailStore }

    await runProgram(["thumbnail-db-stats", "private/thumbnails.db", "--json"], host(output), dependencies)
    const statsText = output.join("")
    expect(JSON.parse(statsText)).toMatchObject({ totalRows: 10, failedRows: 1 })
    expect(statsText).not.toContain("private/thumbnails.db")
    expect(String(openThumbnailStore.mock.calls[0]?.[0]).replace(/\\/g, "/")).toMatch(/private\/thumbnails\.db$/)

    await expect(runProgram([
      "thumbnail-db-cleanup", "private/thumbnails.db", "--kind", "invalid", "--limit", "20", "--json",
    ], host([]), dependencies)).rejects.toThrow("requires --yes")
    expect(openThumbnailStore).toHaveBeenCalledTimes(1)

    const cleanupOutput: unknown[] = []
    await runProgram([
      "thumbnail-db-cleanup", "private/thumbnails.db", "--kind", "invalid", "--scan-limit", "10", "--limit", "20", "--yes", "--json",
    ], host(cleanupOutput), dependencies)
    expect(JSON.parse(cleanupOutput.join(""))).toEqual({
      operation: "invalid", scanned: 10, deleted: 2, unavailableVolumeRowsPreserved: 1, wrapped: false,
    })
    expect(cleanupInvalid).toHaveBeenCalledWith({ scanLimit: 10, deleteLimit: 20 }, undefined)
    await expect(runProgram([
      "thumbnail-db-cleanup", "private/thumbnails.db", "--kind", "invalid", "--limit", "501", "--yes",
    ], host([]), dependencies)).rejects.toThrow("from 1 to 500")

    const prefixOutput: unknown[] = []
    await runProgram([
      "thumbnail-db-cleanup", "private/thumbnails.db", "--kind", "path-prefix", "--prefix", " D:/library ", "--limit", "20", "--yes", "--json",
    ], host(prefixOutput), dependencies)
    expect(JSON.parse(prefixOutput.join(""))).toEqual({ operation: "path-prefix", prefix: "D:/library", deleted: 0 })
    expect(cleanup).toHaveBeenLastCalledWith({ kind: "path-prefix", prefix: "D:/library", limit: 20 }, undefined)
    await expect(runProgram([
      "thumbnail-db-cleanup", "private/thumbnails.db", "--kind", "path-prefix", "--limit", "20", "--yes",
    ], host([]), dependencies)).rejects.toThrow("requires --prefix")
    await expect(runProgram([
      "thumbnail-db-cleanup", "private/thumbnails.db", "--kind", "empty", "--prefix", "D:/library", "--yes",
    ], host([]), dependencies)).rejects.toThrow("--prefix is only valid")

    const failureOutput: unknown[] = []
    await runProgram([
      "thumbnail-db-clear-failures", "private/thumbnails.db", "--reason", "decode-error", "--limit", "50", "--yes", "--json",
    ], host(failureOutput), dependencies)
    expect(JSON.parse(failureOutput.join(""))).toEqual({ operation: "clear-failures", deleted: 3 })
    expect(clearFailures).toHaveBeenCalledWith({ reason: "decode-error", limit: 50 }, undefined)
    expect(dispose).toHaveBeenCalledTimes(4)
  })

  it("[neoview.thumbnail.maintenance-cli-connect] uses the running backend writer without opening a local database", async () => {
    const openThumbnailStore = vi.fn()
    const fetchRemoteThumbnailMaintenance = vi.fn(async () => ({
      totalRows: 12, fileRows: 7, folderRows: 5, blobBytes: 1024, emptyBlobs: 0, failedRows: 1,
      failuresByReason: { "decode-error": 1 },
      writer: { pendingWrites: 0, flushing: false, committedBatches: 2, committedWrites: 12, busyRetries: 0, failedBatches: 0 },
    }))
    const cleanupRemoteThumbnails = vi.fn(async (_options: { baseUrl: string; token: string }, command: { kind: string }) => command.kind === "invalid"
      ? { kind: "invalid" as const, scanned: 50, deleted: 2, unavailableVolumeRowsPreserved: 1, wrapped: false }
      : { kind: "empty" as const, deleted: 1 })
    const clearRemoteThumbnailFailures = vi.fn(async () => 3)
    const dependencies = {
      createController: async () => fakeReader(),
      openThumbnailStore,
      fetchRemoteThumbnailMaintenance,
      cleanupRemoteThumbnails,
      clearRemoteThumbnailFailures,
    }
    const env = { XIRANITE_BACKEND_TOKEN: "remote-token" }

    const statsOutput: unknown[] = []
    await runProgram(["thumbnail-db-stats", "--connect", "http://127.0.0.1:41000", "--token-env", "XIRANITE_BACKEND_TOKEN", "--json"], host(statsOutput, env), dependencies)
    expect(JSON.parse(statsOutput.join(""))).toMatchObject({ totalRows: 12, writer: { committedWrites: 12 } })
    expect(fetchRemoteThumbnailMaintenance).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:41000", token: "remote-token" })

    const cleanupOutput: unknown[] = []
    await runProgram(["thumbnail-db-cleanup", "--connect", "http://127.0.0.1:41000", "--kind", "invalid", "--scan-limit", "50", "--limit", "10", "--yes", "--json"], host(cleanupOutput, env), dependencies)
    expect(JSON.parse(cleanupOutput.join(""))).toEqual({ operation: "invalid", scanned: 50, deleted: 2, unavailableVolumeRowsPreserved: 1, wrapped: false })
    expect(cleanupRemoteThumbnails).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:41000", token: "remote-token" }, { kind: "invalid", scanLimit: 50, deleteLimit: 10 })

    await runProgram(["thumbnail-db-clear-failures", "--connect", "http://127.0.0.1:41000", "--reason", "decode-error", "--limit", "10", "--yes"], host([], env), dependencies)
    expect(clearRemoteThumbnailFailures).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:41000", token: "remote-token" }, { reason: "decode-error", limit: 10 })
    expect(openThumbnailStore).not.toHaveBeenCalled()
    await expect(runProgram(["thumbnail-db-stats", "private/thumbnails.db", "--connect", "http://127.0.0.1:41000"], host([], env), dependencies)).rejects.toThrow("does not accept a database path")
    await expect(runProgram(["thumbnail-db-stats", "--token-env", "XIRANITE_BACKEND_TOKEN"], host([], env), dependencies)).rejects.toThrow("requires --connect")
  })

  it("[neoview.thumbnail.database-maintenance-cli] requires confirmation and keeps offline work behind one shared adapter", async () => {
    const backup = vi.fn(async (sourcePath: string, destinationPath: string) => ({
      sourcePath,
      destinationPath,
      bytes: 1024,
      compatibility: "current" as const,
      metadataVersion: "2.4",
      userVersion: 7,
      journalMode: "delete",
      quickCheck: "ok" as const,
    }))
    const optimize = vi.fn(async (sourcePath: string, options: { backupPath: string; vacuum: boolean }) => ({
      backup: await backup(sourcePath, options.backupPath),
      checkpoint: { busy: 0, logFrames: 0, checkpointedFrames: 0 },
      optimized: true as const,
      vacuumed: options.vacuum,
      journalModeBefore: "wal",
      journalModeAfter: "wal",
    }))
    const recover = vi.fn(async (sourcePath: string, options: { backupPath: string; quarantinePath: string }) => ({
      recovered: true as const,
      sourcePath,
      backupPath: options.backupPath,
      quarantinedDatabasePath: options.quarantinePath,
      originalCompatibility: "incompatible" as const,
      restoredBytes: 1024,
      metadataVersion: "2.4",
      userVersion: 7,
      journalMode: "delete",
      quickCheck: "ok" as const,
    }))
    const createThumbnailDatabaseMaintenance = vi.fn(async () => ({ backup, optimize, recover }))
    const dependencies = { createController: async () => fakeReader(), createThumbnailDatabaseMaintenance }

    await expect(runProgram([
      "thumbnail-db-backup", "private/thumbnails.db", "--output", "private/backup.db",
    ], host([]), dependencies)).rejects.toThrow("requires --yes")
    expect(createThumbnailDatabaseMaintenance).not.toHaveBeenCalled()

    const backupOutput: unknown[] = []
    await runProgram([
      "thumbnail-db-backup", "private/thumbnails.db", "--output", "private/backup.db", "--yes", "--json",
    ], host(backupOutput), dependencies)
    expect(JSON.parse(backupOutput.join(""))).toMatchObject({ bytes: 1024, quickCheck: "ok" })
    expect(String(backup.mock.calls[0]?.[0]).replace(/\\/g, "/")).toMatch(/private\/thumbnails\.db$/)
    expect(String(backup.mock.calls[0]?.[1]).replace(/\\/g, "/")).toMatch(/private\/backup\.db$/)

    await expect(runProgram([
      "thumbnail-db-optimize", "private/thumbnails.db", "--output", "private/pre-optimize.db", "--yes",
    ], host([]), dependencies)).rejects.toThrow("requires --offline")
    expect(optimize).not.toHaveBeenCalled()

    const optimizeOutput: unknown[] = []
    await runProgram([
      "thumbnail-db-optimize", "private/thumbnails.db", "--output", "private/pre-optimize.db",
      "--yes", "--offline", "--vacuum", "--json",
    ], host(optimizeOutput), dependencies)
    expect(JSON.parse(optimizeOutput.join(""))).toMatchObject({ optimized: true, vacuumed: true, checkpoint: { busy: 0 } })
    expect(optimize).toHaveBeenCalledWith(expect.stringMatching(/thumbnails\.db$/), {
      backupPath: expect.stringMatching(/pre-optimize\.db$/),
      vacuum: true,
    })

    await expect(runProgram([
      "thumbnail-db-recover", "private/thumbnails.db", "--from", "private/verified.db",
      "--output", "private/corrupt.db", "--yes",
    ], host([]), dependencies)).rejects.toThrow("requires --offline")
    expect(recover).not.toHaveBeenCalled()
    await expect(runProgram([
      "thumbnail-db-recover", "private/thumbnails.db", "--output", "private/corrupt.db",
      "--yes", "--offline",
    ], host([]), dependencies)).rejects.toThrow("requires --from")
    expect(recover).not.toHaveBeenCalled()

    const recoverOutput: unknown[] = []
    await runProgram([
      "thumbnail-db-recover", "private/thumbnails.db", "--from", "private/verified.db",
      "--output", "private/corrupt.db", "--yes", "--offline", "--json",
    ], host(recoverOutput), dependencies)
    expect(JSON.parse(recoverOutput.join(""))).toMatchObject({ recovered: true, originalCompatibility: "incompatible", quickCheck: "ok" })
    expect(recover).toHaveBeenCalledWith(expect.stringMatching(/thumbnails\.db$/), {
      backupPath: expect.stringMatching(/verified\.db$/),
      quarantinePath: expect.stringMatching(/corrupt\.db$/),
    })
  })

  it("[neoview.thumbnail.secondary-merge-cli] keeps planning read-only and requires offline confirmation for mutation", async () => {
    await expect(runProgram(["thumbnail-db-merge-plan"], host([]), testPlatformDependencies))
      .rejects.toThrow("requires --source")
    await expect(runProgram([
      "thumbnail-db-merge-secondary", "canonical.db", "--source", "secondary.db", "--backup", "canonical.backup.db",
    ], host([]), testPlatformDependencies)).rejects.toThrow("requires --offline and --yes")
  })

  it("[neoview.cache.cli] reuses the shared cache service and gates destructive maintenance", async () => {
    const output: unknown[] = []
    const created: Array<{ cache: ReturnType<typeof fakePresentationCache>; options: unknown }> = []
    const createCacheService = vi.fn(async (options) => {
      const cache = fakePresentationCache()
      created.push({ cache, options })
      return new ReaderCacheService(cache.value, { ownsPresentationCache: true })
    })
    const dependencies = { createController: async () => fakeReader(), createCacheService }

    await runProgram([
      "presentation-cache-stats", "--config", "private/xiranite.config.toml", "--json",
    ], host(output), dependencies)
    const statsText = output.join("")
    expect(JSON.parse(statsText)).toMatchObject({ enabled: true, entries: 2, bytes: 20 })
    expect(statsText).not.toContain("private")
    expect(created[0]?.options).toMatchObject({ configPath: "private/xiranite.config.toml" })
    expect(created[0]?.cache.close).toHaveBeenCalledOnce()

    await expect(runProgram([
      "presentation-cache-cleanup", "--reason", "budget", "--json",
    ], host([]), dependencies)).rejects.toThrow("requires --yes")
    expect(createCacheService).toHaveBeenCalledTimes(1)

    const cleanupOutput: unknown[] = []
    await runProgram([
      "presentation-cache-cleanup", "--reason", "budget", "--yes", "--json",
    ], host(cleanupOutput), dependencies)
    expect(JSON.parse(cleanupOutput.join(""))).toMatchObject({ enabled: true, reason: "budget", removedEntries: 1 })
    expect(created[1]?.cache.cleanup).toHaveBeenCalledWith("budget")

    const clearOutput: unknown[] = []
    await runProgram(["presentation-cache-clear", "--yes", "--json"], host(clearOutput), dependencies)
    expect(JSON.parse(clearOutput.join(""))).toMatchObject({ enabled: true, entries: 0, removedEntries: 2 })
    expect(created[2]?.cache.clear).toHaveBeenCalledOnce()
    expect(created.every(({ cache }) => cache.close.mock.calls.length === 1)).toBe(true)
  })

  it("[neoview.cache.cli-connect] maintains the running L3 cache without creating a local owner", async () => {
    const createCacheService = vi.fn()
    const snapshot = {
      entries: 2, bytes: 20, maxBytes: 100, maxEntryBytes: 20, activeLeases: 0,
      hits: 3, misses: 1, writes: 2, rejectedWrites: 0, evictions: 0, integrityFailures: 0,
    }
    const fetchRemotePresentationCache = vi.fn(async () => ({ enabled: true as const, ...snapshot }))
    const cleanupRemotePresentationCache = vi.fn(async () => ({
      enabled: true as const,
      ...snapshot,
      reason: "budget" as const,
      removedEntries: 2,
      removedBytes: 20,
      durationMs: 1.5,
    }))
    const clearRemotePresentationCache = vi.fn(async () => ({ enabled: false as const }))
    const dependencies = {
      createController: async () => fakeReader(),
      createCacheService,
      fetchRemotePresentationCache,
      cleanupRemotePresentationCache,
      clearRemotePresentationCache,
    }
    const env = { XIRANITE_BACKEND_TOKEN: "cache-token" }

    const statsOutput: unknown[] = []
    await runProgram(["presentation-cache-stats", "--connect", "http://127.0.0.1:41000", "--json"], host(statsOutput, env), dependencies)
    expect(JSON.parse(statsOutput.join(""))).toMatchObject({ enabled: true, entries: 2 })
    expect(fetchRemotePresentationCache).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:41000", token: "cache-token" })

    const cleanupOutput: unknown[] = []
    await runProgram(["presentation-cache-cleanup", "--connect", "http://127.0.0.1:41000", "--reason", "budget", "--yes", "--json"], host(cleanupOutput, env), dependencies)
    expect(JSON.parse(cleanupOutput.join(""))).toMatchObject({ enabled: true, reason: "budget", removedEntries: 2 })
    expect(cleanupRemotePresentationCache).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:41000", token: "cache-token" }, "budget")

    const clearOutput: unknown[] = []
    await runProgram(["presentation-cache-clear", "--connect", "http://127.0.0.1:41000", "--yes", "--json"], host(clearOutput, env), dependencies)
    expect(JSON.parse(clearOutput.join(""))).toEqual({ enabled: false })
    expect(clearRemotePresentationCache).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:41000", token: "cache-token" })
    expect(createCacheService).not.toHaveBeenCalled()
    await expect(runProgram(["presentation-cache-stats", "--connect", "http://127.0.0.1:41000", "--config", "private/xiranite.config.toml"], host([], env), dependencies)).rejects.toThrow("cannot be combined")
    await expect(runProgram(["presentation-cache-cleanup", "--connect", "http://127.0.0.1:41000", "--reason", "age"], host([], env), dependencies)).rejects.toThrow("requires --yes")
  })

  it("[neoview.diagnostics.cli] prints the shared diagnostics DTO and closes owned resources", async () => {
    const output: unknown[] = []
    const close = vi.fn(async () => undefined)
    const service = new ReaderDiagnosticsService({
      activeSessions: () => 0,
      preload: () => ({
        sessions: 1,
        candidates: { near: 1, ahead: 1, background: 0 },
        active: 0,
        plannedCandidates: 2,
        started: 2,
        ready: 2,
        failed: 0,
        cancelled: 0,
        evicted: 0,
        staleReports: 0,
        rejectedReports: 0,
        duplicateReports: 0,
        performance: {
          ttfbSamples: 2, totalTtfbMs: 30, maxTtfbMs: 20,
          decodeSamples: 2, totalDecodeMs: 50, maxDecodeMs: 30,
          retainedByteSamples: 2, totalRetainedBytes: 400, maxRetainedBytes: 300,
          leaseSamples: 2, totalActiveLeases: 5, maxActiveLeases: 4,
        },
      }),
      runtimeResources: () => ({ archiveProviders: 2, archiveIndexEntries: 12, archiveIndexPayloadBytes: 640, archiveActiveExtractions: 1 }),
      assets: () => ({ activeTransformFlights: 0, presentation: null, thumbnails: null }),
      presentationDiskCache: async () => ({ enabled: false }),
      solidArchiveCache: () => ({ entries: 0, retainedBytes: 0, maxBytes: 0, activeEntries: 0, activeLeases: 0 }),
      now: () => 10,
      uptime: () => 1,
      memoryUsage: () => ({ rss: 8, heapTotal: 7, heapUsed: 6, external: 5, arrayBuffers: 4 }),
      cpuUsage: () => ({ user: 3, system: 2 }),
      close,
    })
    const createDiagnosticsService = vi.fn(async () => service)
    await runProgram(["diagnostics", "--config", "private/xiranite.config.toml", "--json"], host(output), {
      createController: async () => fakeReader(),
      createDiagnosticsService,
    })
    expect(JSON.parse(output.join(""))).toMatchObject({ schemaVersion: 1, process: { rssBytes: 8 }, reader: { activeSessions: 0 } })
    expect(output.join("")).not.toContain("private")
    expect(createDiagnosticsService).toHaveBeenCalledWith(expect.objectContaining({ configPath: "private/xiranite.config.toml" }))
    expect(close).toHaveBeenCalledOnce()
  })

  it("[neoview.diagnostics.scheduler-telemetry-cli] prints scheduler wait telemetry when the host provides it", async () => {
    const output: unknown[] = []
    const pool = {
      active: 1,
      queued: 2,
      queuedByPriority: { interactive: 0, view: 1, ahead: 0, background: 1 },
      granted: 4,
      released: 3,
      cancelled: 1,
      queueWaitSamples: 4,
      totalQueueWaitMs: 10,
      maxQueueWaitMs: 6,
      oldestQueuedWaitMs: 3,
    }
    const service = new ReaderDiagnosticsService({
      activeSessions: () => 0,
      preload: () => ({
        sessions: 1,
        candidates: { near: 1, ahead: 1, background: 0 },
        active: 0,
        plannedCandidates: 2,
        started: 2,
        ready: 2,
        failed: 0,
        cancelled: 0,
        evicted: 0,
        staleReports: 0,
        rejectedReports: 0,
        duplicateReports: 0,
        performance: {
          ttfbSamples: 2, totalTtfbMs: 30, maxTtfbMs: 20,
          decodeSamples: 2, totalDecodeMs: 50, maxDecodeMs: 30,
          retainedByteSamples: 2, totalRetainedBytes: 400, maxRetainedBytes: 300,
          leaseSamples: 2, totalActiveLeases: 5, maxActiveLeases: 4,
        },
      }),
      runtimeResources: () => ({ archiveProviders: 2, archiveIndexEntries: 12, archiveIndexPayloadBytes: 640, archiveActiveExtractions: 1 }),
      assets: () => ({ activeTransformFlights: 0, presentation: null, thumbnails: null }),
      presentationDiskCache: async () => ({ enabled: false }),
      solidArchiveCache: () => ({ entries: 0, retainedBytes: 0, maxBytes: 0, activeEntries: 0, activeLeases: 0 }),
      scheduler: () => ({ cpu: pool, io: pool, gpu: pool }),
    })
    await runProgram(["diagnostics"], host(output), {
      createController: async () => fakeReader(),
      createDiagnosticsService: async () => service,
    })
    expect(output.join("")).toContain("cpu=1/2 waitAvg=2.5ms waitMax=6.0ms waitNow=3.0ms")
    expect(output.join("")).toContain("ttfbAvg=15.0ms decodeAvg=25.0ms retainedMax=300 leaseMax=4")
    expect(output.join("")).toContain("archiveProviders=2 indexEntries=12 indexBytes=640 activeExtractions=1")
    expect(output.join("")).toContain("Cache totals: memory=0 disk=0 leases=0")
  })

  it("[neoview.diagnostics.history-export-cli] exports running-backend history without opening a local Reader", async () => {
    const output: unknown[] = []
    const fetchRemoteDiagnosticsHistory = vi.fn(async () => diagnosticsHistory())
    await runProgram([
      "diagnostics-history-export", "--connect", "http://127.0.0.1:41000", "--format", "csv", "--since-ms", "-10", "--limit", "2",
    ], host(output, { XIRANITE_BACKEND_TOKEN: "history-token" }), {
      createController: async () => fakeReader(),
      fetchRemoteDiagnosticsHistory,
    })
    expect(output.join("")).toContain("historyDroppedSamples")
    expect(output.join("")).toContain("3")
    expect(fetchRemoteDiagnosticsHistory).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:41000",
      token: "history-token",
      sinceMs: -10,
      limit: 2,
    })
    await expect(runProgram(["diagnostics-history-export"], host([]), {
      createController: async () => fakeReader(),
    })).rejects.toThrow("requires --connect")
  })
})

const pages: readonly HeadlessReaderPageSnapshot[] = [0, 1, 2].map((index) => ({
  id: `p${index}`,
  index,
  name: `${String(index + 1).padStart(3, "0")}.png`,
  mediaKind: "image",
  mimeType: "image/png",
  byteLength: 4,
  contentVersion: `v${index}`,
}))

function snapshot(index: number): HeadlessReaderSnapshot {
  return {
    book: { displayName: "book.cbz", pageCount: 3 },
    frame: {
      generation: index,
      anchorPageIndex: index,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: `p${index}`, pageIndex: index, side: "single" }],
      pageCount: 3,
      atStart: index === 0,
      atEnd: index === 2,
    },
    visiblePages: [pages[index]!],
  }
}

function diagnosticsHistory() {
  return {
    schemaVersion: 1,
    droppedSamples: 3,
    samples: [{
      schemaVersion: 1,
      sampledAtMs: 10,
      uptimeSeconds: 1,
      process: { rssBytes: 8, heapTotalBytes: 7, heapUsedBytes: 6, externalBytes: 5, arrayBuffersBytes: 4, cpuUserMicros: 3, cpuSystemMicros: 2 },
      reader: { activeSessions: 0 },
      assets: { activeTransformFlights: 0, presentation: null, thumbnails: null },
      presentationDiskCache: { enabled: false },
      solidArchiveCache: { entries: 0, retainedBytes: 0, maxBytes: 0, activeEntries: 0, activeLeases: 0 },
      scheduler: null,
    }],
  }
}

function fakePresentationCache() {
  const snapshot = {
    entries: 2, bytes: 20, maxBytes: 100, maxEntryBytes: 20, activeLeases: 0,
    hits: 3, misses: 1, writes: 2, rejectedWrites: 0, evictions: 0, integrityFailures: 0,
  }
  const cleanup = vi.fn(async (reason = "age" as const) => ({
    ...snapshot, reason, removedEntries: 1, removedBytes: 10, durationMs: 1,
  }))
  const clear = vi.fn(async () => ({
    ...snapshot, entries: 0, bytes: 0, reason: "explicit" as const, removedEntries: 2, removedBytes: 20, durationMs: 1,
  }))
  const close = vi.fn(async () => undefined)
  const value: ReaderPresentationDiskCache = {
    maxEntryBytes: 20,
    acquire: vi.fn(async () => undefined),
    put: vi.fn(async () => true),
    invalidate: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => snapshot),
    cleanup,
    clear,
    close,
    [Symbol.asyncDispose]: close,
  }
  return { value, cleanup, clear, close }
}

function fakeReader(overrides: Partial<{
  open: (input: OpenHeadlessReaderInput) => Promise<HeadlessReaderSnapshot>
  openPageStream: (index: number) => Promise<HeadlessPageStream>
  getBookSettings: ReaderHeadlessController["getBookSettings"]
  updateBookSettings: ReaderHeadlessController["updateBookSettings"]
  upscalePage: ReaderHeadlessController["upscalePage"]
  inspectSuperResolution: ReaderHeadlessController["inspectSuperResolution"]
  listSubtitles: ReaderHeadlessController["listSubtitles"]
  renderSubtitle: ReaderHeadlessController["renderSubtitle"]
  getMediaProgress: ReaderHeadlessController["getMediaProgress"]
  updateMediaProgress: ReaderHeadlessController["updateMediaProgress"]
  getEmmMetadata: ReaderHeadlessController["getEmmMetadata"]
  updateEmmMetadata: ReaderHeadlessController["updateEmmMetadata"]
}> = {}): ReaderHeadlessController {
  let current = 0
  const dispose = vi.fn(async () => undefined)
  return {
    isOpen: true,
    open: vi.fn(overrides.open ?? (async (input) => {
      current = input.initialPage ?? 0
      return snapshot(current)
    })),
    inspect: vi.fn(() => snapshot(current)),
    listPages: vi.fn((cursor = 0, limit = 100) => pages.slice(cursor, cursor + limit)),
    next: vi.fn(async () => snapshot(current = Math.min(2, current + 1))),
    previous: vi.fn(async () => snapshot(current = Math.max(0, current - 1))),
    goTo: vi.fn(async (index: number) => snapshot(current = index)),
    openPageStream: vi.fn(overrides.openPageStream ?? (async () => { throw new Error("not configured") })),
    getBookSettings: vi.fn(overrides.getBookSettings ?? (async () => bookSettingsSnapshot())),
    updateBookSettings: vi.fn(overrides.updateBookSettings ?? (async () => ({ settings: bookSettingsSnapshot(), reader: snapshot(current) }))),
    upscalePage: vi.fn(overrides.upscalePage ?? (async () => { throw new Error("not configured") })),
    inspectSuperResolution: vi.fn(overrides.inspectSuperResolution ?? (async () => ({
      available: false as const,
      reason: "not-configured",
      models: [],
      engines: [],
    }))),
    listSubtitles: vi.fn(overrides.listSubtitles ?? (() => [])),
    renderSubtitle: vi.fn(overrides.renderSubtitle ?? (async () => { throw new Error("not configured") })),
    getMediaProgress: vi.fn(overrides.getMediaProgress ?? (async () => undefined)),
    updateMediaProgress: vi.fn(overrides.updateMediaProgress ?? (async () => { throw new Error("not configured") })),
    getEmmMetadata: vi.fn(overrides.getEmmMetadata ?? (async () => ({ revision: 0, overrides: {}, inherited: ["rating", "manualTags", "translatedTitle"] }))),
    updateEmmMetadata: vi.fn(overrides.updateEmmMetadata ?? (async () => { throw new Error("not configured") })),
    closeBook: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: dispose,
  } as unknown as ReaderHeadlessController
}

function bookSettingsSnapshot(): ReaderBookSettingsSnapshot {
  return {
    schemaVersion: 1,
    bookId: "opaque-book",
    revision: 3,
    overrides: {},
    effective: { favorite: false, rating: 0, direction: "left-to-right", pageMode: "single", horizontalBook: true },
    inherited: ["favorite", "rating", "direction", "pageMode", "horizontalBook"],
  }
}

function host(stdout: unknown[], env: Record<string, string | undefined> = {}): CliHost {
  return {
    cwd: process.cwd(),
    env,
    stdin: { isTTY: true },
    stdout: { isTTY: false, write: (chunk: unknown) => { stdout.push(chunk); return true } },
    stderr: { isTTY: false, write: () => true },
  } as unknown as CliHost
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  for (let offset = 0; offset < 4; offset += 1) {
    bytes[16 + offset] = (width >>> ((3 - offset) * 8)) & 0xff
    bytes[20 + offset] = (height >>> ((3 - offset) * 8)) & 0xff
  }
  return bytes
}
