import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import type {
  HeadlessPageStream,
  HeadlessReaderPageSnapshot,
  HeadlessReaderSnapshot,
  OpenHeadlessReaderInput,
  ReaderHeadlessController,
  ReaderFileTreeHeadlessController,
} from "../core.js"
import { runProgram } from "../cli.js"
import { createReaderFileTreeController, createReaderHeadlessController } from "../platform.js"
import { ReaderCacheService } from "../application/cache/ReaderCacheService.js"
import type { ReaderPresentationDiskCache } from "../ports/ReaderPresentationDiskCache.js"

const testPlatformDependencies = {
  createController: (options = {}) => createReaderHeadlessController({ ...options, progressStore: false }),
  createFileTreeController: (options = {}) => createReaderFileTreeController({ ...options, legacyThumbnailDatabasePath: false }),
}

describe("NeoView CLI", () => {
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

  it("[neoview.folder.cli] reuses the lazy tree/search service and persists exclusions only after confirmation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-folder-cli-"))
    const privatePath = join(directory, "private")
    const visiblePath = join(directory, "visible")
    const configPath = join(directory, "xiranite.config.toml")
    await mkdir(privatePath)
    await mkdir(visiblePath)
    await writeFile(join(privatePath, "hidden.cbz"), "hidden")
    await writeFile(join(visiblePath, "shown.cbz"), "shown")
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

      await expect(runProgram(["folder-exclude", privatePath, "--config", configPath], host([]), testPlatformDependencies)).rejects.toThrow("requires --yes")
      await runProgram(["folder-exclude", privatePath, "--config", configPath, "--yes", "--json"], host([]), testPlatformDependencies)
      expect(await readFile(configPath, "utf8")).toContain("[nodes.neoview.folder.tree]")

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
        "neoview-bookmarks": JSON.stringify([{ path: "D:/private/book.cbz", name: "Book", listIds: ["default"] }]),
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
        configPatch: { history: { max_history_size: 250 } },
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
      expect(await readFile(configPath, "utf8")).toContain("max_history_size = 250")
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
      cleanup: vi.fn(async () => 0),
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
    expect(cleanupInvalid).toHaveBeenCalledWith({ scanLimit: 10, deleteLimit: 20 })
    await expect(runProgram([
      "thumbnail-db-cleanup", "private/thumbnails.db", "--kind", "invalid", "--limit", "501", "--yes",
    ], host([]), dependencies)).rejects.toThrow("from 1 to 500")

    const failureOutput: unknown[] = []
    await runProgram([
      "thumbnail-db-clear-failures", "private/thumbnails.db", "--reason", "decode-error", "--limit", "50", "--yes", "--json",
    ], host(failureOutput), dependencies)
    expect(JSON.parse(failureOutput.join(""))).toEqual({ operation: "clear-failures", deleted: 3 })
    expect(clearFailures).toHaveBeenCalledWith({ reason: "decode-error", limit: 50 })
    expect(dispose).toHaveBeenCalledTimes(3)
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
    closeBook: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: dispose,
  } as unknown as ReaderHeadlessController
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
