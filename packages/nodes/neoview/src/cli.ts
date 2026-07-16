#!/usr/bin/env node
import { open, readFile, rm, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { CliUsageError, createCliHost, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type {
  HeadlessReaderPageSnapshot,
  HeadlessReaderSnapshot,
  ReaderCacheService,
  ReaderFileTreeHeadlessController,
  ReaderFileOperationService,
  ReaderSystemIntegrationService,
  ReaderFileMutation,
  ReaderLibraryHeadlessController,
  ReaderHeadlessController,
  ReaderDiagnosticsService,
} from "./core.js"
import type {
  ReaderThumbnailMaintenanceSnapshot,
} from "./ports/ReaderThumbnailStore.js"
import type { ReaderThumbnailDatabaseMaintenance } from "./ports/ReaderThumbnailDatabaseMaintenance.js"
import {
  ReaderThumbnailMaintenanceService,
  type ReaderThumbnailMaintenancePort,
} from "./application/thumbnails/ReaderThumbnailMaintenanceService.js"
import { help } from "./help.js"
import { createReaderFileTreeController, createReaderHeadlessController } from "./platform.js"
import type { LegacyReaderDataImporter } from "./migration/LegacyReaderDataImporter.js"
import type { LegacySearchHistoryImporter } from "./migration/LegacySearchHistoryImporter.js"
import type { ReaderCompositionOptions } from "./platform.js"

const CLI_NAME = "xneoview"
const COMMANDS = new Set([
  "inspect", "pages", "frame", "extract-page", "settings-inspect", "settings-import",
  "reader-data-inspect", "reader-data-import",
  "search-history-inspect", "search-history-import",
  "library-recents", "library-recent-delete", "library-recent-cleanup",
  "library-invalid-cleanup",
  "library-bookmarks", "library-bookmark-add", "library-bookmark-delete",
  "library-bookmark-lists", "library-bookmark-list-add", "library-bookmark-list-delete",
  "thumbnail-db-inspect", "thumbnail-db-stats", "thumbnail-db-cleanup", "thumbnail-db-clear-failures",
  "thumbnail-db-backup", "thumbnail-db-optimize", "thumbnail-db-recover",
  "presentation-cache-stats", "presentation-cache-cleanup", "presentation-cache-clear",
  "diagnostics",
  "folder-tree", "folder-search", "folder-exclude", "folder-include", "folder-tree-cache-clear",
  "folder-search-history", "folder-search-history-delete", "folder-search-history-clear",
  "file-copy", "file-move", "file-rename", "file-delete", "file-trash", "file-open", "file-reveal", "file-undo", "file-undo-discard", "file-undo-state", "directory-create",
])
const VALUE_FLAGS = new Set([
  "--entry",
  "--index",
  "--cursor",
  "--limit",
  "--output",
  "--from",
  "--password-env",
  "--archive-password-env",
  "--config",
  "--strategy",
  "--modules",
  "--kind",
  "--days",
  "--scan-limit",
  "--reason",
  "--database",
  "--query",
  "--mode",
  "--depth",
  "--exclude",
  "--node",
  "--scope",
  "--offset",
  "--id",
  "--name",
  "--list",
  "--before",
  "--concurrency",
])
const BOOLEAN_FLAGS = new Set(["--json", "--force", "--yes", "--offline", "--vacuum", "--case-sensitive", "--search-in-path", "--refresh", "--starred", "--favorite", "--overwrite"])
const MAX_SETTINGS_BYTES = 64 * 1024 * 1024
const MAX_READER_DATA_BYTES = 256 * 1024 * 1024

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "High-performance image and comic reader.",
  run: (args, host) => runProgram(args, host),
}

export interface NeoviewCliDependencies {
  createController: (options?: ReaderCompositionOptions) => Promise<ReaderHeadlessController>
  createFileTreeController?: (options?: ReaderCompositionOptions) => Promise<ReaderFileTreeHeadlessController>
  openThumbnailStore?: (path: string) => Promise<CliThumbnailMaintenanceStore>
  createDataImporter?: (databasePath?: string) => Promise<LegacyReaderDataImporter>
  createSearchHistoryImporter?: (databasePath?: string) => Promise<LegacySearchHistoryImporter>
  createLibraryController?: (databasePath?: string) => Promise<ReaderLibraryHeadlessController>
  createFileOperationService?: (databasePath?: string) => Promise<ReaderFileOperationService>
  createSystemIntegrationService?: () => Promise<ReaderSystemIntegrationService>
  createCacheService?: (options: ReaderCompositionOptions) => Promise<ReaderCacheService>
  createDiagnosticsService?: (options: ReaderCompositionOptions) => Promise<ReaderDiagnosticsService>
  createThumbnailDatabaseMaintenance?: () => Promise<ReaderThumbnailDatabaseMaintenance>
}

interface CliThumbnailMaintenanceStore extends ReaderThumbnailMaintenancePort, AsyncDisposable {}

const DEFAULT_DEPENDENCIES: NeoviewCliDependencies = {
  createController: createReaderHeadlessController,
  createFileTreeController: createReaderFileTreeController,
}

export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createCliHost(),
  dependencies: NeoviewCliDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const command = args[0]
  if (!command) {
    if (host.stdin.isTTY && host.stdout.isTTY) await runReaderUi([], host)
    else writeLine(host, formatCliHelp())
    return
  }
  if (command === "help" || command === "--help" || command === "-h") {
    writeLine(host, formatCliHelp())
    return
  }
  if (command === "ui") {
    await runReaderUi(args.slice(1), host)
    return
  }
  if (command === "folder-ui") {
    await runFolderUi(args.slice(1), host)
    return
  }
  if (command === "library-ui") {
    await runLibraryUi(args.slice(1), host)
    return
  }
  if (command === "file-ui") {
    await runFileOperationUi(args.slice(1), host)
    return
  }
  if (!COMMANDS.has(command)) throw usage(`Unknown NeoView command: ${command}`)

  const parsed = parseArguments(args.slice(1))
  validateCommandOptions(command, parsed)
  if (command === "thumbnail-db-inspect") {
    if (parsed.positionals.length > 1) throw usage("thumbnail-db-inspect accepts at most one database path.")
    await runThumbnailDatabaseInspect(parsed.positionals[0], parsed.booleans.has("--json"), host)
    return
  }
  if (command === "thumbnail-db-backup" || command === "thumbnail-db-optimize" || command === "thumbnail-db-recover") {
    if (parsed.positionals.length > 1) throw usage(`${command} accepts at most one database path.`)
    await runThumbnailDatabaseOfflineCommand(command, parsed.positionals[0], parsed, host, dependencies)
    return
  }
  if (command.startsWith("thumbnail-db-")) {
    if (parsed.positionals.length > 1) throw usage(`${command} accepts at most one database path.`)
    await runThumbnailMaintenanceCommand(command, parsed.positionals[0], parsed, host, dependencies)
    return
  }
  if (command.startsWith("presentation-cache-")) {
    if (parsed.positionals.length) throw usage(`${command} does not accept a path.`)
    await runPresentationCacheCommand(command, parsed, host, dependencies)
    return
  }
  if (command === "diagnostics") {
    if (parsed.positionals.length) throw usage("diagnostics does not accept a path.")
    await runDiagnostics(parsed, host, dependencies)
    return
  }
  if (command.startsWith("reader-data-")) {
    if (parsed.positionals.length !== 1) throw usage(`${command} requires exactly one legacy JSON path.`)
    await runReaderDataCommand(command, resolve(host.cwd, parsed.positionals[0]!), parsed, host, dependencies)
    return
  }
  if (command.startsWith("search-history-")) {
    if (parsed.positionals.length !== 1) throw usage(`${command} requires exactly one legacy settings JSON path.`)
    await runSearchHistoryImportCommand(command, resolve(host.cwd, parsed.positionals[0]!), parsed, host, dependencies)
    return
  }
  if (command.startsWith("library-")) {
    await runLibraryCommand(command, parsed, host, dependencies)
    return
  }
  if (command.startsWith("file-") || command === "directory-create") {
    await runFileOperationCommand(command, parsed, host, dependencies)
    return
  }
  if (command.startsWith("folder-search-history")) {
    if (parsed.positionals.length) throw usage(`${command} does not accept a directory path.`)
    await runFolderSearchHistoryCommand(command, parsed, host, dependencies)
    return
  }
  if (command.startsWith("folder-")) {
    if (parsed.positionals.length !== 1) throw usage(`${command} requires exactly one directory path.`)
    await runFolderCommand(command, resolve(host.cwd, parsed.positionals[0]!), parsed, host, dependencies)
    return
  }
  const path = parsed.positionals[0]
  if (!path || parsed.positionals.length !== 1) {
    const kind = command.startsWith("settings-") ? "settings JSON path" : "book path"
    throw usage(`${command} requires exactly one ${kind}.`)
  }
  if (command.startsWith("settings-")) {
    await runSettingsCommand(command, resolve(host.cwd, path), parsed, host)
    return
  }
  const index = integerOption(parsed, "--index", 0, Number.MAX_SAFE_INTEGER, 0)
  const credentials = credentialsFromEnvironment(parsed, host)
  let controller: ReaderHeadlessController | undefined
  try {
    controller = await dependencies.createController({
      configPath: oneValue(parsed, "--config"),
      cwd: host.cwd,
      env: host.env,
    })
    const snapshot = await controller.open({
      path: resolve(host.cwd, path),
      entryPaths: parsed.values.get("--entry"),
      archivePasswords: credentials.inputs,
      initialPage: index,
    })
    if (command === "inspect") return printInspect(snapshot, parsed.booleans.has("--json"), host)
    if (command === "frame") return printFrame(snapshot, parsed.booleans.has("--json"), host)
    if (command === "pages") {
      const cursor = integerOption(parsed, "--cursor", 0, snapshot.book.pageCount, 0)
      const limit = integerOption(parsed, "--limit", 1, 500, 100)
      return printPages(controller.listPages(cursor, limit), cursor, snapshot.book.pageCount, parsed.booleans.has("--json"), host)
    }
    if (parsed.booleans.has("--json")) throw usage("extract-page does not support --json because its output is binary.")
    const output = oneValue(parsed, "--output")
    if (!output) throw usage("extract-page requires --output <path|->.")
    await extractPage(controller, index, output, parsed.booleans.has("--force"), host)
  } finally {
    credentials.clear()
    await controller?.[Symbol.asyncDispose]()
  }
}

function validateCommandOptions(command: string, parsed: ParsedArguments): void {
  if (command === "settings-inspect") {
    rejectOptions(parsed, new Set(["--json", "--modules"]))
    return
  }
  if (command === "settings-import") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--config", "--strategy", "--modules"]))
    return
  }
  if (command === "reader-data-inspect") {
    rejectOptions(parsed, new Set(["--json"]))
    return
  }
  if (command === "reader-data-import") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--database", "--config", "--strategy"] ))
    return
  }
  if (command === "search-history-inspect") {
    rejectOptions(parsed, new Set(["--json"]))
    return
  }
  if (command === "search-history-import") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--database", "--strategy"]))
    return
  }
  if (command === "library-recents" || command === "library-bookmarks") {
    rejectOptions(parsed, new Set(["--json", "--database", "--limit", "--offset", "--list"]))
    return
  }
  if (command === "library-bookmark-lists") {
    rejectOptions(parsed, new Set(["--json", "--database"]))
    return
  }
  if (command === "library-bookmark-add") {
    rejectOptions(parsed, new Set(["--json", "--database", "--name", "--list", "--starred"]))
    return
  }
  if (command === "library-bookmark-list-add") {
    rejectOptions(parsed, new Set(["--json", "--database", "--id", "--name", "--favorite"]))
    return
  }
  if (command === "library-recent-delete" || command === "library-bookmark-delete" || command === "library-bookmark-list-delete") {
    rejectOptions(parsed, new Set(["--json", "--database", "--id", "--yes"]))
    return
  }
  if (command === "library-recent-cleanup") {
    rejectOptions(parsed, new Set(["--json", "--database", "--before", "--limit", "--yes"]))
    return
  }
  if (command === "library-invalid-cleanup") {
    rejectOptions(parsed, new Set(["--json", "--database", "--kind", "--scan-limit", "--limit", "--concurrency", "--yes"]))
    return
  }
  if (command === "file-copy" || command === "file-move" || command === "file-rename") {
    rejectOptions(parsed, new Set(["--json", "--concurrency", "--overwrite"]))
    return
  }
  if (command === "file-open" || command === "file-reveal") {
    rejectOptions(parsed, new Set(["--json"]))
    return
  }
  if (command === "file-delete" || command === "file-trash") {
    rejectOptions(parsed, new Set(["--json", "--concurrency", "--yes"]))
    return
  }
  if (command === "file-undo") {
    rejectOptions(parsed, new Set(["--json", "--database", "--yes"]))
    return
  }
  if (command === "file-undo-discard") {
    rejectOptions(parsed, new Set(["--json", "--database", "--yes"]))
    return
  }
  if (command === "file-undo-state") {
    rejectOptions(parsed, new Set(["--json", "--database"]))
    return
  }
  if (command === "directory-create") {
    rejectOptions(parsed, new Set(["--json", "--concurrency"]))
    return
  }
  if (command === "thumbnail-db-inspect") {
    rejectOptions(parsed, new Set(["--json"]))
    return
  }
  if (command === "thumbnail-db-stats") {
    rejectOptions(parsed, new Set(["--json"]))
    return
  }
  if (command === "thumbnail-db-cleanup") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--kind", "--days", "--limit", "--scan-limit"]))
    return
  }
  if (command === "thumbnail-db-clear-failures") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--reason", "--limit"]))
    return
  }
  if (command === "thumbnail-db-backup") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--output"] ))
    return
  }
  if (command === "thumbnail-db-optimize") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--offline", "--vacuum", "--output"] ))
    return
  }
  if (command === "thumbnail-db-recover") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--offline", "--from", "--output"] ))
    return
  }
  if (command === "presentation-cache-stats") {
    rejectOptions(parsed, new Set(["--json", "--config"]))
    return
  }
  if (command === "presentation-cache-cleanup") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--config", "--reason"]))
    return
  }
  if (command === "presentation-cache-clear") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--config"]))
    return
  }
  if (command === "folder-tree") {
    rejectOptions(parsed, new Set(["--json", "--config", "--node", "--refresh"]))
    return
  }
  if (command === "folder-search") {
    rejectOptions(parsed, new Set(["--json", "--config", "--query", "--mode", "--kind", "--depth", "--limit", "--exclude", "--case-sensitive", "--search-in-path"]))
    return
  }
  if (command === "folder-search-history") {
    rejectOptions(parsed, new Set(["--json", "--config", "--database", "--scope", "--limit"]))
    return
  }
  if (command === "folder-search-history-delete") {
    rejectOptions(parsed, new Set(["--json", "--config", "--database", "--scope", "--query", "--yes"]))
    return
  }
  if (command === "folder-search-history-clear") {
    rejectOptions(parsed, new Set(["--json", "--config", "--database", "--scope", "--yes"]))
    return
  }
  if (command === "folder-exclude" || command === "folder-include") {
    rejectOptions(parsed, new Set(["--json", "--config", "--yes"]))
    return
  }
  if (command === "folder-tree-cache-clear") {
    rejectOptions(parsed, new Set(["--json", "--config", "--node", "--yes"]))
    return
  }
  for (const option of ["--strategy", "--modules", "--yes"]) {
    if (parsed.values.has(option) || parsed.booleans.has(option)) throw usage(`${command} does not accept ${option}.`)
  }
}

async function runFolderCommand(
  command: string,
  path: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if ((command === "folder-exclude" || command === "folder-include" || command === "folder-tree-cache-clear") && !parsed.booleans.has("--yes")) {
    throw usage(`${command} requires --yes because it changes persistent settings or cache state.`)
  }
  const createController = dependencies.createFileTreeController ?? createReaderFileTreeController
  const controller = await createController({ configPath: oneValue(parsed, "--config"), cwd: host.cwd, env: host.env })
  try {
    const openPath = command === "folder-exclude" || command === "folder-include" ? dirname(path) : path
    await controller.open({ path: openPath })
    if (command === "folder-tree") {
      const node = oneValue(parsed, "--node")
      const result = await controller.tree(node ? resolve(host.cwd, node) : undefined, parsed.booleans.has("--refresh"))
      if (!result) throw new Error("Reader file tree session closed before the node was loaded.")
      if (parsed.booleans.has("--json")) writeJson(host, result)
      else {
        for (const entry of result.entries) writeLine(host, entry.path)
        writeLine(host, `${result.entries.length} child director${result.entries.length === 1 ? "y" : "ies"}; cache=${result.cacheHit ? "hit" : "miss"}`)
      }
      return
    }
    if (command === "folder-search") {
      await runFolderSearch(controller, parsed, host)
      return
    }
    if (command === "folder-tree-cache-clear") {
      const node = oneValue(parsed, "--node")
      const result = controller.clearCache(node ? resolve(host.cwd, node) : undefined)
      if (!result) throw new Error("Reader file tree session closed before the cache was cleared.")
      if (parsed.booleans.has("--json")) writeJson(host, result)
      else writeLine(host, `Tree cache cleared; remaining=${result.size} generation=${result.generation}`)
      return
    }
    const action = command === "folder-exclude" ? "exclude" : "include"
    const result = await controller.updateExclusion({ action, path })
    if (!result) throw new Error("Reader file tree session closed before exclusions were updated.")
    if (parsed.booleans.has("--json")) writeJson(host, result)
    else writeLine(host, `${action === "exclude" ? "Excluded" : "Included"}: ${path}`)
  } finally {
    await controller[Symbol.asyncDispose]()
  }
}

async function runFolderSearch(
  controller: ReaderFileTreeHeadlessController,
  parsed: ParsedArguments,
  host: CliHost,
): Promise<void> {
  const query = oneValue(parsed, "--query")
  if (!query) throw usage("folder-search requires --query <text|glob>.")
  const mode = oneValue(parsed, "--mode") ?? "text"
  if (mode !== "text" && mode !== "glob") throw usage("--mode must be text or glob.")
  const kind = oneValue(parsed, "--kind") ?? "all"
  if (kind !== "all" && kind !== "file" && kind !== "directory") throw usage("--kind must be all, file or directory.")
  const depthValue = oneValue(parsed, "--depth")
  const maximumDepth = depthValue === undefined ? undefined : integerOption(parsed, "--depth", 0, 4_096, 0)
  const maximumResults = integerOption(parsed, "--limit", 1, 10_000, 512)
  const handle = controller.search(query, {
    mode,
    kind,
    caseSensitive: parsed.booleans.has("--case-sensitive"),
    searchInPath: parsed.booleans.has("--search-in-path"),
    maximumDepth,
    maximumResults,
    excludePatterns: parsed.values.get("--exclude"),
  })
  const json = parsed.booleans.has("--json")
  const output: Record<string, unknown> = { entries: [] }
  try {
    for await (const event of handle.events) {
      if (json) {
        if (event.type === "entry") (output.entries as unknown[]).push(event.entry)
        else output[event.type] = event
      } else if (event.type === "entry") writeLine(host, event.entry.path)
      else if (event.type === "complete") writeLine(host, `${event.matched} match(es); scanned=${event.scanned}; truncated=${event.truncated}`)
    }
  } finally {
    await handle.close()
  }
  if (json) writeJson(host, output)
  await controller.recordSearchHistory("folder", query).catch(() => undefined)
}

async function runFolderSearchHistoryCommand(
  command: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (command !== "folder-search-history" && !parsed.booleans.has("--yes")) {
    throw usage(`${command} requires --yes because it removes persisted search history.`)
  }
  const scope = searchHistoryScope(oneValue(parsed, "--scope"))
  const createController = dependencies.createFileTreeController ?? createReaderFileTreeController
  const controller = await createController({
    configPath: oneValue(parsed, "--config"),
    cwd: host.cwd,
    env: host.env,
    legacyThumbnailDatabasePath: oneValue(parsed, "--database"),
  })
  try {
    if (command === "folder-search-history") {
      const entries = await controller.listSearchHistory(scope, integerOption(parsed, "--limit", 1, 100, 20))
      if (parsed.booleans.has("--json")) writeJson(host, { scope, entries })
      else for (const entry of entries) writeLine(host, `${entry.query}\t${entry.usedAt}\t${entry.useCount}`)
      return
    }
    if (command === "folder-search-history-delete") {
      const query = oneValue(parsed, "--query")
      if (!query) throw usage("folder-search-history-delete requires --query <text>.")
      const removed = await controller.removeSearchHistory(scope, query)
      if (parsed.booleans.has("--json")) writeJson(host, { scope, query, removed })
      else writeLine(host, removed ? `Removed: ${query}` : `Not found: ${query}`)
      return
    }
    const cleared = await controller.clearSearchHistory(scope)
    if (parsed.booleans.has("--json")) writeJson(host, { scope, cleared })
    else writeLine(host, `Cleared ${cleared} ${scope} search history entr${cleared === 1 ? "y" : "ies"}.`)
  } finally {
    await controller[Symbol.asyncDispose]()
  }
}

function searchHistoryScope(value: string | undefined): "folder" | "file" | "bookmark" | "history" {
  const scope = value ?? "folder"
  if (scope === "folder" || scope === "file" || scope === "bookmark" || scope === "history") return scope
  throw usage("--scope must be folder, file, bookmark or history.")
}

async function runThumbnailDatabaseInspect(path: string | undefined, json: boolean, host: CliHost): Promise<void> {
  const databasePath = await resolveThumbnailDatabasePath(path, host)
  const { inspectLegacyThumbnailDatabase } = await import("./platform/thumbnails/LegacyThumbnailDatabaseInspector.js")
  const report = await inspectLegacyThumbnailDatabase(databasePath)
  if (json) {
    writeJson(host, report)
    return
  }
  writeLine(host, `NeoView thumbnail database: ${report.path}`)
  writeLine(host, `Compatibility: ${report.compatibility}${report.bytes === undefined ? "" : ` (${report.bytes} bytes)`}`)
  writeLine(host, `Version: metadata=${report.metadataVersion ?? "-"} user_version=${report.userVersion ?? "-"} journal=${report.journalMode ?? "-"}`)
  writeLine(host, `Sidecars: WAL=${report.sidecars.wal.exists ? report.sidecars.wal.bytes ?? 0 : "missing"} SHM=${report.sidecars.shm.exists ? report.sidecars.shm.bytes ?? 0 : "missing"}`)
  for (const issue of report.issues) writeLine(host, `- ${issue}`)
}

async function runPresentationCacheCommand(
  command: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (command !== "presentation-cache-stats" && !parsed.booleans.has("--yes")) {
    throw usage(`${command} requires --yes because it removes cache data.`)
  }
  const createService = dependencies.createCacheService ?? (async (options: ReaderCompositionOptions) => {
    const { createReaderCacheService } = await import("./platform.js")
    return createReaderCacheService(options)
  })
  const service = await createService({
    configPath: oneValue(parsed, "--config"),
    cwd: host.cwd,
    env: host.env,
  })
  try {
    const result = command === "presentation-cache-stats"
      ? await service.status()
      : command === "presentation-cache-clear"
        ? await service.clear()
        : await service.cleanup(cacheMaintenanceReason(oneValue(parsed, "--reason")))
    printPresentationCacheResult(result, parsed.booleans.has("--json"), host)
  } finally {
    await service[Symbol.asyncDispose]()
  }
}

async function runDiagnostics(
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const createService = dependencies.createDiagnosticsService ?? (async (options: ReaderCompositionOptions) => {
    const { createReaderDiagnosticsService } = await import("./platform.js")
    return createReaderDiagnosticsService(options)
  })
  const service = await createService({
    configPath: oneValue(parsed, "--config"),
    cwd: host.cwd,
    env: host.env,
  })
  try {
    const result = await service.snapshot()
    if (parsed.booleans.has("--json")) return writeJson(host, result)
    writeLine(host, `Reader diagnostics: sessions=${result.reader.activeSessions} uptime=${result.uptimeSeconds.toFixed(1)}s`)
    writeLine(host, `Process: rss=${result.process.rssBytes} heap=${result.process.heapUsedBytes}/${result.process.heapTotalBytes} external=${result.process.externalBytes}`)
    writeLine(host, `Assets: transforms=${result.assets.activeTransformFlights} L2=${result.assets.presentation?.bytes ?? 0} bytes thumbnails=${result.assets.thumbnails?.cachedBytes ?? 0} bytes`)
    writeLine(host, `Solid archive cache: entries=${result.solidArchiveCache.entries} bytes=${result.solidArchiveCache.retainedBytes}/${result.solidArchiveCache.maxBytes}`)
    writeLine(host, `Scheduler: ${result.scheduler ? `cpu=${result.scheduler.cpu.active}/${result.scheduler.cpu.queued} io=${result.scheduler.io.active}/${result.scheduler.io.queued} gpu=${result.scheduler.gpu.active}/${result.scheduler.gpu.queued}` : "unavailable in standalone CLI"}`)
  } finally {
    await service.close()
  }
}

function cacheMaintenanceReason(value: string | undefined): "age" | "budget" | "explicit" {
  const reason = value ?? "age"
  if (reason !== "age" && reason !== "budget" && reason !== "explicit") {
    throw usage("--reason must be age, budget or explicit for presentation-cache-cleanup.")
  }
  return reason
}

function printPresentationCacheResult(
  result: Awaited<ReturnType<ReaderCacheService["status"] | ReaderCacheService["cleanup"]>>,
  json: boolean,
  host: CliHost,
): void {
  if (json) return writeJson(host, result)
  if (!result.enabled) {
    writeLine(host, "Presentation cache: disabled")
    return
  }
  writeLine(host, `Presentation cache: entries=${result.entries} bytes=${result.bytes}/${result.maxBytes} active=${result.activeLeases}`)
  writeLine(host, `Activity: hits=${result.hits} misses=${result.misses} writes=${result.writes} rejected=${result.rejectedWrites} evictions=${result.evictions} integrityFailures=${result.integrityFailures}`)
  if ("removedEntries" in result) {
    writeLine(host, `Maintenance: reason=${result.reason} removed=${result.removedEntries} bytes=${result.removedBytes} durationMs=${result.durationMs}`)
  }
}

async function runReaderDataCommand(
  command: string,
  inputPath: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const inputStat = await stat(inputPath)
  if (!inputStat.isFile()) throw usage(`Reader data input is not a file: ${inputPath}`)
  if (inputStat.size > MAX_READER_DATA_BYTES) throw usage(`Reader data input exceeds ${MAX_READER_DATA_BYTES} bytes.`)
  const { LegacyReaderDataCodec } = await import("./migration/LegacyReaderDataCodec.js")
  const decoded = new LegacyReaderDataCodec().decode(await readFile(inputPath, "utf8"))
  const preview = readerDataPreview(decoded)
  if (command === "reader-data-inspect") {
    if (parsed.booleans.has("--json")) writeJson(host, preview)
    else printReaderDataPreview(preview, host)
    return
  }
  if (!parsed.booleans.has("--yes")) throw usage("reader-data-import requires --yes after reviewing reader-data-inspect output.")
  const strategy = oneValue(parsed, "--strategy") ?? "merge"
  if (strategy !== "merge" && strategy !== "overwrite") throw usage("--strategy must be merge or overwrite.")
  const databasePath = oneValue(parsed, "--database")
    ? resolve(host.cwd, oneValue(parsed, "--database")!)
    : undefined
  const createImporter = dependencies.createDataImporter ?? (async (target?: string) => {
    const { createLegacyReaderDataImporter } = await import("./platform.js")
    return createLegacyReaderDataImporter(target)
  })
  const importer = await createImporter(databasePath)
  let imported
  try {
    imported = await importer.import(decoded, strategy)
  } finally {
    await importer[Symbol.asyncDispose]()
  }
  const configPatch = readerDataConfigPatch(decoded)
  let configChanged = false
  if (Object.keys(configPatch).length) {
    const { commitNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
    const committed = await commitNeoviewConfig(configPatch, {
      configPath: oneValue(parsed, "--config"),
      cwd: host.cwd,
      env: host.env,
      strategy: "merge",
    })
    configChanged = committed.changed
  }
  const result = { ...preview, strategy, imported, configChanged }
  if (parsed.booleans.has("--json")) writeJson(host, result)
  else {
    printReaderDataPreview(preview, host)
    writeLine(host, `Applied: history=${imported.applied.progress} bookmarks=${imported.applied.bookmarks} lists=${imported.applied.bookmarkLists}`)
    writeLine(host, `Migration metadata: pathStacks=${imported.applied.pathStacks} mediaProgress=${imported.applied.mediaProgress} unresolved=${imported.unresolvedSources}`)
  }
}

async function runSearchHistoryImportCommand(
  command: string,
  inputPath: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const inputStat = await stat(inputPath)
  if (!inputStat.isFile()) throw usage(`Search history input is not a file: ${inputPath}`)
  if (inputStat.size > MAX_SETTINGS_BYTES) throw usage(`Search history input exceeds ${MAX_SETTINGS_BYTES} bytes.`)
  const { LegacySearchHistoryCodec } = await import("./migration/LegacySearchHistoryCodec.js")
  const decoded = new LegacySearchHistoryCodec().decode(await readFile(inputPath, "utf8"))
  if (command === "search-history-inspect") {
    if (parsed.booleans.has("--json")) writeJson(host, decoded)
    else {
      writeLine(host, `${decoded.entries.length} valid entries across ${decoded.scopes.length} scope(s); issues=${decoded.issues.length}`)
      for (const issue of decoded.issues) writeLine(host, `- ${issue.sourcePath}: ${issue.message}`)
    }
    return
  }
  if (!parsed.booleans.has("--yes")) throw usage("search-history-import requires --yes because it writes Reader runtime data.")
  const strategy = oneValue(parsed, "--strategy") ?? "merge"
  if (strategy !== "merge" && strategy !== "overwrite") throw usage("--strategy must be merge or overwrite.")
  const databasePath = oneValue(parsed, "--database")
    ? resolve(host.cwd, oneValue(parsed, "--database")!)
    : undefined
  const createImporter = dependencies.createSearchHistoryImporter ?? (async (target?: string) => {
    const { createLegacySearchHistoryImporter } = await import("./platform.js")
    return createLegacySearchHistoryImporter(target)
  })
  const importer = await createImporter(databasePath)
  try {
    const imported = await importer.import(decoded, strategy)
    if (parsed.booleans.has("--json")) writeJson(host, { strategy, imported, issues: decoded.issues })
    else writeLine(host, `Applied: ${imported.applied}; cleared=${imported.cleared}; skipped-newer=${imported.skippedNewer}; issues=${decoded.issues.length}`)
  } finally {
    await importer[Symbol.asyncDispose]()
  }
}

async function runLibraryCommand(
  command: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const pathCommand = command === "library-bookmark-add"
  if (pathCommand ? parsed.positionals.length !== 1 : parsed.positionals.length !== 0) {
    throw usage(pathCommand ? `${command} requires exactly one reader path.` : `${command} does not accept a path.`)
  }
  const destructive = command === "library-recent-delete"
    || command === "library-recent-cleanup"
    || command === "library-invalid-cleanup"
    || command === "library-bookmark-delete"
    || command === "library-bookmark-list-delete"
  if (destructive && !parsed.booleans.has("--yes")) throw usage(`${command} requires --yes.`)
  const databasePath = oneValue(parsed, "--database")
    ? resolve(host.cwd, oneValue(parsed, "--database")!)
    : undefined
  const createController = dependencies.createLibraryController ?? (async (target?: string) => {
    const { createReaderLibraryHeadlessController } = await import("./platform.js")
    return createReaderLibraryHeadlessController(target)
  })
  const controller = await createController(databasePath)
  const json = parsed.booleans.has("--json")
  try {
    if (command === "library-recents") {
      const items = await controller.listRecent(
        integerOption(parsed, "--limit", 1, 500, 100),
        integerOption(parsed, "--offset", 0, Number.MAX_SAFE_INTEGER, 0),
      )
      return printLibraryItems("recents", items, json, host)
    }
    if (command === "library-recent-delete") {
      const id = requiredValue(parsed, "--id", command)
      return printLibraryMutation({ removed: await controller.removeRecent(id), id }, json, host)
    }
    if (command === "library-recent-cleanup") {
      if (!oneValue(parsed, "--before")) throw usage(`${command} requires --before <timestamp>.`)
      const before = integerOption(parsed, "--before", 0, Number.MAX_SAFE_INTEGER, 0)
      const deleted = await controller.clearRecentBefore(before, integerOption(parsed, "--limit", 1, 500, 500))
      return printLibraryMutation({ deleted, before }, json, host)
    }
    if (command === "library-invalid-cleanup") {
      const kind = oneValue(parsed, "--kind") ?? "both"
      if (kind !== "recents" && kind !== "bookmarks" && kind !== "both") throw usage("--kind must be recents, bookmarks or both.")
      const result = await controller.cleanupInvalid({
        kind,
        scanLimit: integerOption(parsed, "--scan-limit", 1, 500, 500),
        deleteLimit: integerOption(parsed, "--limit", 1, 500, 500),
        concurrency: integerOption(parsed, "--concurrency", 1, 16, 8),
      })
      return printLibraryMutation(result as unknown as Record<string, unknown>, json, host)
    }
    if (command === "library-bookmarks") {
      const items = await controller.listBookmarks(
        oneValue(parsed, "--list"),
        integerOption(parsed, "--limit", 1, 500, 100),
        integerOption(parsed, "--offset", 0, Number.MAX_SAFE_INTEGER, 0),
      )
      return printLibraryItems("bookmarks", items, json, host)
    }
    if (command === "library-bookmark-add") {
      const item = await controller.savePathBookmark({
        path: resolve(host.cwd, parsed.positionals[0]!),
        name: oneValue(parsed, "--name"),
        starred: parsed.booleans.has("--starred"),
        listIds: parsed.values.get("--list"),
      })
      return printLibraryMutation({ item }, json, host)
    }
    if (command === "library-bookmark-delete") {
      const id = requiredValue(parsed, "--id", command)
      return printLibraryMutation({ removed: await controller.removeBookmark(id), id }, json, host)
    }
    if (command === "library-bookmark-lists") {
      return printLibraryItems("bookmarkLists", await controller.listBookmarkLists(), json, host)
    }
    if (command === "library-bookmark-list-add") {
      const item = await controller.saveBookmarkList({
        id: oneValue(parsed, "--id"),
        name: requiredValue(parsed, "--name", command),
        isFavorite: parsed.booleans.has("--favorite"),
      })
      return printLibraryMutation({ item }, json, host)
    }
    const id = requiredValue(parsed, "--id", command)
    return printLibraryMutation({ removed: await controller.removeBookmarkList(id), id }, json, host)
  } finally {
    await controller[Symbol.asyncDispose]()
  }
}

async function runFileOperationCommand(
  command: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const pair = command === "file-copy" || command === "file-move" || command === "file-rename"
  if (command === "file-open" || command === "file-reveal") {
    if (parsed.positionals.length !== 1) throw usage(`${command} requires exactly one path.`)
    const createService = dependencies.createSystemIntegrationService ?? (async () => {
      const { createReaderSystemIntegrationService } = await import("./platform.js")
      return createReaderSystemIntegrationService()
    })
    const path = resolve(host.cwd, parsed.positionals[0]!)
    if (command === "file-open") await (await createService()).open(path)
    else await (await createService()).reveal(path)
    if (parsed.booleans.has("--json")) writeJson(host, { action: command.slice(5), path })
    return
  }
  const journalCommand = command === "file-undo" || command === "file-undo-discard" || command === "file-undo-state"
  if (pair && parsed.positionals.length !== 2) throw usage(`${command} requires source and destination paths.`)
  if (journalCommand && parsed.positionals.length !== 0) throw usage(`${command} does not accept a path.`)
  if (!pair && !journalCommand && parsed.positionals.length === 0) throw usage(`${command} requires at least one path.`)
  if ((command === "file-delete" || command === "file-trash" || command === "file-undo" || command === "file-undo-discard") && !parsed.booleans.has("--yes")) {
    throw usage(`${command} requires --yes.`)
  }
  const databasePath = oneValue(parsed, "--database") ? resolve(host.cwd, oneValue(parsed, "--database")!) : undefined
  const createService = dependencies.createFileOperationService ?? (async (target?: string) => {
    const { createReaderFileOperationService } = await import("./platform.js")
    return createReaderFileOperationService({ databasePath: target })
  })
  const service = await createService(databasePath)
  try {
    if (command === "file-undo-state") {
      await service.prepare()
      const state = service.undoState()
      if (parsed.booleans.has("--json")) writeJson(host, state)
      else writeLine(host, JSON.stringify(state))
      return
    }
    if (command === "file-undo") {
      const result = await service.undoLatest()
      if (parsed.booleans.has("--json")) writeJson(host, result)
      else writeLine(host, JSON.stringify(result))
      return
    }
    if (command === "file-undo-discard") {
      const result = await service.discardLatest()
      if (parsed.booleans.has("--json")) writeJson(host, result)
      else writeLine(host, JSON.stringify(result))
      return
    }
    const paths = parsed.positionals.map((path) => resolve(host.cwd, path))
    const overwrite = parsed.booleans.has("--overwrite")
    let operations: ReaderFileMutation[]
    if (command === "file-copy" || command === "file-move" || command === "file-rename") {
      operations = [{ kind: command.slice(5) as "copy" | "move" | "rename", sourcePath: paths[0]!, destinationPath: paths[1]!, overwrite }]
    } else if (command === "directory-create") {
      operations = paths.map((destinationPath) => ({ kind: "create-directory", destinationPath }))
    } else {
      const kind = command === "file-trash" ? "trash" : "delete"
      operations = paths.map((sourcePath) => ({ kind, sourcePath }))
    }
    const result = await service.execute({
      operations,
      concurrency: integerOption(parsed, "--concurrency", 1, 8, 4),
    })
    if (parsed.booleans.has("--json")) return writeJson(host, result)
    for (const item of result.results) {
      const source = "sourcePath" in item.operation ? item.operation.sourcePath : item.operation.destinationPath
      const destination = "destinationPath" in item.operation && "sourcePath" in item.operation ? ` -> ${item.operation.destinationPath}` : ""
      writeLine(host, `${item.status}: ${item.operation.kind} ${source}${destination}${item.error ? ` (${item.error})` : ""}`)
    }
    writeLine(host, `Completed: ${result.succeeded}; failed=${result.failed}; cancelled=${result.cancelled}`)
  } finally {
    await service.close()
  }
}

function requiredValue(parsed: ParsedArguments, option: string, command: string): string {
  const value = oneValue(parsed, option)
  if (!value?.trim()) throw usage(`${command} requires ${option} <value>.`)
  return value.trim()
}

function printLibraryItems(name: string, items: readonly unknown[], json: boolean, host: CliHost): void {
  if (json) writeJson(host, { items })
  else {
    for (const item of items) writeLine(host, JSON.stringify(item))
    writeLine(host, `${name}: ${items.length}`)
  }
}

function printLibraryMutation(result: Record<string, unknown>, json: boolean, host: CliHost): void {
  if (json) writeJson(host, result)
  else writeLine(host, JSON.stringify(result))
}

function readerDataPreview(decoded: import("./migration/LegacyReaderDataCodec.js").DecodedLegacyReaderData) {
  return {
    sourceKind: decoded.sourceKind,
    counts: {
      history: decoded.history.length,
      bookmarks: decoded.bookmarks.length,
      bookmarkLists: decoded.bookmarkLists.length,
      videoProgress: decoded.history.filter((entry) => entry.videoProgress).length,
      pathStacks: decoded.history.filter((entry) => entry.pathStack.length > 1 || entry.pathStack.some((ref) => ref.innerPath)).length,
    },
    report: decoded.report,
    configPatch: readerDataConfigPatch(decoded),
  }
}

function readerDataConfigPatch(decoded: import("./migration/LegacyReaderDataCodec.js").DecodedLegacyReaderData): Record<string, unknown> {
  const settings = decoded.historySettings
  const history = {
    ...(settings?.syncFileTreeOnHistorySelect !== undefined ? { sync_file_tree_on_history_select: settings.syncFileTreeOnHistorySelect } : {}),
    ...(settings?.syncFileTreeOnBookmarkSelect !== undefined ? { sync_file_tree_on_bookmark_select: settings.syncFileTreeOnBookmarkSelect } : {}),
    ...(settings?.maxHistorySize !== undefined ? { max_history_size: settings.maxHistorySize } : {}),
    ...(settings?.maxBookmarkSize !== undefined ? { max_bookmark_size: settings.maxBookmarkSize } : {}),
    ...(decoded.activeBookmarkListId ? { active_bookmark_list_id: decoded.activeBookmarkListId } : {}),
  }
  return Object.keys(history).length ? { history } : {}
}

function printReaderDataPreview(preview: ReturnType<typeof readerDataPreview>, host: CliHost): void {
  writeLine(host, `Legacy reader data: ${preview.sourceKind}`)
  writeLine(host, `Rows: history=${preview.counts.history} bookmarks=${preview.counts.bookmarks} lists=${preview.counts.bookmarkLists}`)
  writeLine(host, `Migration metadata: pathStacks=${preview.counts.pathStacks} videoProgress=${preview.counts.videoProgress}`)
  writeLine(host, Object.entries(preview.report.summary).map(([key, count]) => `${key}=${count}`).join(" "))
}

async function runThumbnailMaintenanceCommand(
  command: string,
  path: string | undefined,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (command !== "thumbnail-db-stats" && !parsed.booleans.has("--yes")) {
    throw usage(`${command} requires --yes because it modifies the thumbnail database.`)
  }
  const plan = thumbnailMaintenancePlan(command, parsed)
  const databasePath = await resolveThumbnailDatabasePath(path, host)
  const openStore = dependencies.openThumbnailStore ?? (async (target: string): Promise<CliThumbnailMaintenanceStore> => {
    const { createWritableLegacyThumbnailStore } = await import("./platform.js")
    return createWritableLegacyThumbnailStore(target)
  })
  const store = await openStore(databasePath)
  const service = new ReaderThumbnailMaintenanceService(store)
  try {
    if (plan.kind === "stats") {
      const result = await service.status()
      if (!result.enabled) throw new Error("Thumbnail maintenance statistics are unavailable.")
      printThumbnailStats(result.snapshot, parsed.booleans.has("--json"), host)
      return
    }
    if (plan.kind === "clear-failures") {
      const result = await service.clearFailures({ reason: plan.reason, limit: plan.limit })
      if (!result.enabled) throw new Error("Thumbnail failure maintenance is unavailable.")
      return printMaintenanceResult({ operation: plan.kind, deleted: result.deleted }, parsed.booleans.has("--json"), host)
    }
    if (plan.kind === "invalid") {
      const result = await service.cleanup({ kind: plan.kind, scanLimit: plan.scanLimit, deleteLimit: plan.limit })
      if (!result.enabled || result.kind !== "invalid") throw new Error("Invalid-path thumbnail cleanup is unavailable.")
      return printMaintenanceResult({ operation: plan.kind, ...result.result }, parsed.booleans.has("--json"), host)
    }
    if (plan.kind === "empty") {
      const result = await service.cleanup(plan)
      if (!result.enabled || result.kind !== "empty") throw new Error("Thumbnail cleanup is unavailable.")
      return printMaintenanceResult({ operation: plan.kind, deleted: result.deleted }, parsed.booleans.has("--json"), host)
    }
    const result = await service.cleanup(plan)
    if (!result.enabled || result.kind !== "expired") throw new Error("Thumbnail cleanup is unavailable.")
    printMaintenanceResult({
      operation: result.kind,
      deleted: result.deleted,
      cutoff: result.cutoff,
      foldersPreserved: true,
    }, parsed.booleans.has("--json"), host)
  } finally {
    await store[Symbol.asyncDispose]()
  }
}

async function runThumbnailDatabaseOfflineCommand(
  command: "thumbnail-db-backup" | "thumbnail-db-optimize" | "thumbnail-db-recover",
  path: string | undefined,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (!parsed.booleans.has("--yes")) throw usage(`${command} requires --yes because it creates or rewrites database files.`)
  if (command !== "thumbnail-db-backup" && !parsed.booleans.has("--offline")) {
    throw usage(`${command} requires --offline after closing NeoView and Xiranite database users.`)
  }
  const output = oneValue(parsed, "--output")
  if (!output) throw usage(`${command} requires --output <${command === "thumbnail-db-recover" ? "quarantine.db" : "backup.db"}>.`)
  const from = oneValue(parsed, "--from")
  if (command === "thumbnail-db-recover" && !from) throw usage("thumbnail-db-recover requires --from <verified-backup.db>.")
  const sourcePath = await resolveThumbnailDatabasePath(path, host)
  const maintenance = dependencies.createThumbnailDatabaseMaintenance
    ? await dependencies.createThumbnailDatabaseMaintenance()
    : await (await import("./platform.js")).createLegacyThumbnailDatabaseMaintenance()
  const destinationPath = resolve(host.cwd, output)
  const result = command === "thumbnail-db-backup"
    ? await maintenance.backup(sourcePath, destinationPath)
    : command === "thumbnail-db-optimize"
      ? await maintenance.optimize(sourcePath, { backupPath: destinationPath, vacuum: parsed.booleans.has("--vacuum") })
      : await maintenance.recover(sourcePath, { backupPath: resolve(host.cwd, from!), quarantinePath: destinationPath })
  if (parsed.booleans.has("--json")) {
    writeJson(host, result)
    return
  }
  if (command === "thumbnail-db-backup") {
    const backup = result as import("./ports/ReaderThumbnailDatabaseMaintenance.js").ReaderThumbnailDatabaseBackupResult
    writeLine(host, `Backup: ${backup.destinationPath} (${backup.bytes} bytes, quick_check=${backup.quickCheck})`)
    return
  }
  if (command === "thumbnail-db-recover") {
    const recovered = result as import("./ports/ReaderThumbnailDatabaseMaintenance.js").ReaderThumbnailDatabaseRecoveryResult
    writeLine(host, `Recovered: ${recovered.sourcePath} from ${recovered.backupPath} (quick_check=${recovered.quickCheck})`)
    writeLine(host, `Quarantined: ${recovered.quarantinedDatabasePath}`)
    return
  }
  const optimized = result as import("./ports/ReaderThumbnailDatabaseMaintenance.js").ReaderThumbnailDatabaseOptimizeResult
  writeLine(host, `Backup: ${optimized.backup.destinationPath} (${optimized.backup.bytes} bytes)`)
  writeLine(host, `Maintenance: optimized=true vacuumed=${optimized.vacuumed} journal=${optimized.journalModeAfter ?? "-"}`)
}

type ThumbnailMaintenancePlan =
  | { kind: "stats" }
  | { kind: "clear-failures"; reason?: string; limit: number }
  | { kind: "empty"; limit: number }
  | { kind: "expired"; limit: number; days: number }
  | { kind: "invalid"; limit: number; scanLimit: number }

function thumbnailMaintenancePlan(command: string, parsed: ParsedArguments): ThumbnailMaintenancePlan {
  if (command === "thumbnail-db-stats") return { kind: "stats" }
  if (command === "thumbnail-db-clear-failures") {
    const limit = integerOption(parsed, "--limit", 1, 1_000, 500)
    const reason = oneValue(parsed, "--reason")
    if (reason !== undefined && (!reason || reason.length > 128)) throw usage("--reason must be 1..128 characters.")
    return { kind: "clear-failures", reason, limit }
  }
  const kind = oneValue(parsed, "--kind")
  if (kind !== "empty" && kind !== "expired" && kind !== "invalid") {
    throw usage("thumbnail-db-cleanup requires --kind empty|expired|invalid.")
  }
  if (kind === "invalid") {
    if (parsed.values.has("--days")) throw usage("--days is only valid with --kind expired.")
    const limit = integerOption(parsed, "--limit", 1, 500, 500)
    return { kind, limit, scanLimit: integerOption(parsed, "--scan-limit", 1, 2_000, 500) }
  }
  const limit = integerOption(parsed, "--limit", 1, 1_000, 500)
  if (parsed.values.has("--scan-limit")) throw usage("--scan-limit is only valid with --kind invalid.")
  if (kind === "empty") {
    if (parsed.values.has("--days")) throw usage("--days is only valid with --kind expired.")
    return { kind, limit }
  }
  const days = integerOption(parsed, "--days", 1, 3_650, 30)
  return { kind, limit, days }
}

async function resolveThumbnailDatabasePath(path: string | undefined, host: CliHost): Promise<string> {
  if (path) return resolve(host.cwd, path)
  const { LegacyNeoViewDataLocator } = await import("./application/data/LegacyNeoViewDataLocator.js")
  return new LegacyNeoViewDataLocator().locate({ env: host.env }).thumbnailDatabasePath
}

function printThumbnailStats(snapshot: ReaderThumbnailMaintenanceSnapshot, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, snapshot)
  writeLine(host, `Thumbnails: total=${snapshot.totalRows} file=${snapshot.fileRows} folder=${snapshot.folderRows} empty=${snapshot.emptyBlobs}`)
  writeLine(host, `Storage: blobs=${snapshot.blobBytes} database=${snapshot.databaseBytes ?? 0} wal=${snapshot.walBytes ?? 0} shm=${snapshot.shmBytes ?? 0}`)
  writeLine(host, `Failures: total=${snapshot.failedRows} ${Object.entries(snapshot.failuresByReason).map(([reason, count]) => `${reason}=${count}`).join(" ")}`.trim())
  writeLine(host, `Writer: pending=${snapshot.writer.pendingWrites} retries=${snapshot.writer.busyRetries} failed=${snapshot.writer.failedBatches}`)
}

function printMaintenanceResult(result: Record<string, unknown>, json: boolean, host: CliHost): void {
  if (json) writeJson(host, result)
  else writeLine(host, Object.entries(result).map(([key, value]) => `${key}=${String(value)}`).join(" "))
}

function rejectOptions(parsed: ParsedArguments, allowed: ReadonlySet<string>): void {
  for (const option of parsed.values.keys()) {
    if (!allowed.has(option)) throw usage(`Command does not accept ${option}.`)
  }
  for (const option of parsed.booleans) {
    if (!allowed.has(option)) throw usage(`Command does not accept ${option}.`)
  }
}

interface ParsedArguments {
  positionals: string[]
  values: Map<string, string[]>
  booleans: Set<string>
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = { positionals: [], values: new Map(), booleans: new Set() }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (!arg.startsWith("-")) {
      parsed.positionals.push(arg)
      continue
    }
    if (BOOLEAN_FLAGS.has(arg)) {
      if (parsed.booleans.has(arg)) throw usage(`Duplicate flag: ${arg}`)
      parsed.booleans.add(arg)
      continue
    }
    if (!VALUE_FLAGS.has(arg)) throw usage(`Unknown NeoView option: ${arg}`)
    const value = args[index + 1]
    if (!value || value.startsWith("--")) throw usage(`${arg} requires a value.`)
    const list = parsed.values.get(arg) ?? []
    list.push(value)
    parsed.values.set(arg, list)
    index += 1
  }
  return parsed
}

function credentialsFromEnvironment(parsed: ParsedArguments, host: CliHost): {
  inputs: { entryPaths?: readonly string[]; rawPassword: Uint8Array }[] | undefined
  clear: () => void
} {
  const inputs: { entryPaths?: readonly string[]; rawPassword: Uint8Array }[] = []
  const clear = () => {
    for (const input of inputs) input.rawPassword.fill(0)
  }
  try {
    const rootVariables = parsed.values.get("--password-env") ?? []
    if (rootVariables.length > 1) throw usage("--password-env can only be specified once.")
    if (rootVariables[0]) inputs.push({ rawPassword: passwordBytes(rootVariables[0], host) })
    for (const value of parsed.values.get("--archive-password-env") ?? []) {
      const separator = value.lastIndexOf("=")
      if (separator <= 0 || separator === value.length - 1) {
        throw usage("--archive-password-env requires entry.cbz::nested.cbz=ENV_NAME.")
      }
      const entryPaths = value.slice(0, separator).split("::")
      if (entryPaths.some((entry) => !entry.trim())) throw usage("Archive password scopes cannot contain empty entry paths.")
      inputs.push({ entryPaths, rawPassword: passwordBytes(value.slice(separator + 1), host) })
    }
  } catch (error) {
    clear()
    throw error
  }
  return {
    inputs: inputs.length ? inputs : undefined,
    clear,
  }
}

function passwordBytes(variable: string, host: CliHost): Uint8Array {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) throw usage(`Invalid password environment variable name: ${variable}`)
  const value = host.env[variable]
  if (!value) throw usage(`Password environment variable is missing or empty: ${variable}`)
  return new TextEncoder().encode(value)
}

function printInspect(snapshot: HeadlessReaderSnapshot, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, snapshot)
  writeLine(host, `${snapshot.book.displayName}: ${snapshot.book.pageCount} page(s)`)
  writeLine(host, frameLine(snapshot))
  for (const page of snapshot.visiblePages) writeLine(host, pageLine(page))
}

function printFrame(snapshot: HeadlessReaderSnapshot, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, { frame: snapshot.frame, visiblePages: snapshot.visiblePages })
  writeLine(host, frameLine(snapshot))
  for (const page of snapshot.visiblePages) writeLine(host, pageLine(page))
}

function printPages(pages: readonly HeadlessReaderPageSnapshot[], cursor: number, total: number, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, { pages, cursor, nextCursor: cursor + pages.length < total ? cursor + pages.length : undefined, total })
  for (const page of pages) writeLine(host, pageLine(page))
  writeLine(host, `${pages.length} of ${total} page(s)`)
}

function frameLine(snapshot: HeadlessReaderSnapshot): string {
  const indices = snapshot.visiblePages.map((page) => page.index + 1).join(", ") || "empty"
  return `Frame ${indices} / ${snapshot.book.pageCount}`
}

function pageLine(page: HeadlessReaderPageSnapshot): string {
  const size = page.dimensions ? ` ${page.dimensions.width}x${page.dimensions.height}` : ""
  const bytes = page.byteLength === undefined ? "" : ` ${page.byteLength} bytes`
  return `${String(page.index + 1).padStart(5)}  ${page.name}  ${page.mediaKind}${size}${bytes}`
}

async function extractPage(
  controller: ReaderHeadlessController,
  pageIndex: number,
  output: string,
  force: boolean,
  host: CliHost,
): Promise<void> {
  const page = await controller.openPageStream(pageIndex)
  try {
    if (output === "-") {
      await writeBinaryStdout(page.stream, host)
      return
    }
    const outputPath = resolve(host.cwd, output)
    const handle = await open(outputPath, force ? "w" : "wx")
    let complete = false
    try {
      const writable = handle.createWriteStream()
      for await (const chunk of page.stream) {
        if (!writable.write(chunk)) await new Promise<void>((resolveDrain) => writable.once("drain", resolveDrain))
      }
      await new Promise<void>((resolveEnd, rejectEnd) => writable.end((error?: Error | null) => error ? rejectEnd(error) : resolveEnd()))
      complete = true
    } finally {
      await handle.close().catch(() => undefined)
      if (!complete) await rm(outputPath, { force: true }).catch(() => undefined)
    }
  } finally {
    await page.close()
  }
}

async function writeBinaryStdout(stream: ReadableStream<Uint8Array>, host: CliHost): Promise<void> {
  const output = host.stdout as CliHost["stdout"] & { once?: (event: "drain", listener: () => void) => unknown }
  for await (const chunk of stream) {
    const ready = output.write(chunk as unknown as string)
    if (ready === false && output.once) await new Promise<void>((resolveDrain) => output.once!("drain", resolveDrain))
  }
}

async function runSettingsCommand(
  command: string,
  inputPath: string,
  parsed: ParsedArguments,
  host: CliHost,
): Promise<void> {
  const inputStat = await stat(inputPath)
  if (!inputStat.isFile()) throw usage(`Settings input is not a file: ${inputPath}`)
  if (inputStat.size > MAX_SETTINGS_BYTES) throw usage(`Settings input exceeds ${MAX_SETTINGS_BYTES} bytes.`)
  const content = await readFile(inputPath, "utf8")
  const { LegacySettingsCodec, LEGACY_SETTINGS_MODULES } = await import("./migration/LegacySettingsCodec.js")
  const moduleOption = oneValue(parsed, "--modules")
  const modules = moduleOption?.split(",").map((value) => value.trim()).filter(Boolean)
  if (modules?.length === 0) throw usage("--modules requires at least one module name.")
  const knownModules = new Set<string>(LEGACY_SETTINGS_MODULES)
  const invalidModules = modules?.filter((module) => !knownModules.has(module)) ?? []
  if (invalidModules.length) throw usage(`Unknown settings module(s): ${invalidModules.join(", ")}.`)
  const decoded = new LegacySettingsCodec().decode(content, {
    modules: modules as import("./migration/LegacySettingsCodec.js").LegacySettingsModule[] | undefined,
  })

  if (command === "settings-inspect") {
    printSettingsPreview(decoded, parsed.booleans.has("--json"), host)
    return
  }

  if (!parsed.booleans.has("--yes")) {
    throw usage("settings-import requires --yes after reviewing settings-inspect output.")
  }
  const strategy = oneValue(parsed, "--strategy") ?? "merge"
  if (strategy !== "merge" && strategy !== "overwrite") throw usage("--strategy must be merge or overwrite.")
  const configPath = oneValue(parsed, "--config")
  const { commitNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
  const committed = await commitNeoviewConfig(decoded.configPatch, {
    configPath,
    cwd: host.cwd,
    env: host.env,
    strategy,
  })
  const output = {
    ...decoded.report,
    configPath: committed.configPath,
    backupPath: committed.backupPath,
    changed: committed.changed,
    strategy,
  }
  if (parsed.booleans.has("--json")) writeJson(host, output)
  else {
    writeLine(host, `NeoView settings ${committed.changed ? "imported" : "already up to date"}: ${committed.configPath}`)
    if (committed.backupPath) writeLine(host, `Backup: ${committed.backupPath}`)
    printSettingsSummary(decoded.report.summary, decoded.report.fullyRecognized, host)
  }
}

function printSettingsPreview(
  decoded: import("./migration/LegacySettingsCodec.js").DecodedLegacySettings,
  json: boolean,
  host: CliHost,
): void {
  if (json) {
    writeJson(host, { report: decoded.report, configPatch: decoded.configPatch })
    return
  }
  writeLine(host, `NeoView settings source: ${decoded.report.sourceKind}${decoded.report.sourceVersion ? ` ${decoded.report.sourceVersion}` : ""}`)
  for (const entry of decoded.report.entries) {
    writeLine(host, `${entry.disposition.padEnd(18)} ${entry.sourcePath}${entry.targetPath ? ` -> ${entry.targetPath}` : ""}`)
  }
  printSettingsSummary(decoded.report.summary, decoded.report.fullyRecognized, host)
}

function printSettingsSummary(
  summary: import("./migration/LegacySettingsCodec.js").LegacySettingsMigrationReport["summary"],
  fullyRecognized: boolean,
  host: CliHost,
): void {
  writeLine(host, Object.entries(summary).map(([key, count]) => `${key}=${count}`).join(" "))
  writeLine(host, fullyRecognized ? "All supplied settings were recognized." : "Review unresolved settings before final migration acceptance.")
}

function integerOption(parsed: ParsedArguments, flag: string, minimum: number, maximum: number, fallback: number): number {
  const value = oneValue(parsed, flag)
  if (value === undefined) return fallback
  const parsedValue = Number(value)
  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    throw usage(`${flag} must be an integer from ${minimum} to ${maximum}.`)
  }
  return parsedValue
}

function oneValue(parsed: ParsedArguments, flag: string): string | undefined {
  const values = parsed.values.get(flag)
  if (!values?.length) return undefined
  if (values.length > 1) throw usage(`${flag} can only be specified once.`)
  return values[0]
}

async function runReaderUi(args: readonly string[], host: CliHost): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView ui requires an interactive terminal.")
  const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
  const flags = resolveTerminalUiFlags(args, { language: "zh", renderer: "opentui", theme: "nord" })
  if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
    throw usage(flags.error ?? `Unknown ui argument: ${flags.args[0]}`)
  }
  const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
  if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
    throw usage(`Unknown terminal theme: ${flags.theme}.`)
  }
  const { createNeoviewTuiDefinition } = await import("./interaction.js")
  await runTerminalUi(createNeoviewTuiDefinition(flags.language), {
    host,
    language: flags.language,
    renderer: flags.renderer,
    theme: flags.theme,
    loadScreen: async () => (await import("./Tui.js")).NeoviewTui,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["ui", ...args] } : undefined,
  })
}

async function runFolderUi(args: readonly string[], host: CliHost): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView folder-ui requires an interactive terminal.")
  const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
  const flags = resolveTerminalUiFlags(args, { language: "zh", renderer: "opentui", theme: "nord" })
  if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
    throw usage(flags.error ?? `Unknown folder-ui argument: ${flags.args[0]}`)
  }
  const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
  if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
    throw usage(`Unknown terminal theme: ${flags.theme}.`)
  }
  const { createNeoviewFileTreeTuiDefinition } = await import("./interaction.js")
  await runTerminalUi(createNeoviewFileTreeTuiDefinition(flags.language), {
    host,
    language: flags.language,
    renderer: flags.renderer,
    theme: flags.theme,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["folder-ui", ...args] } : undefined,
  })
}

async function runLibraryUi(args: readonly string[], host: CliHost): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView library-ui requires an interactive terminal.")
  const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
  const flags = resolveTerminalUiFlags(args, { language: "zh", renderer: "opentui", theme: "nord" })
  if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
    throw usage(flags.error ?? `Unknown library-ui argument: ${flags.args[0]}`)
  }
  const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
  if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
    throw usage(`Unknown terminal theme: ${flags.theme}.`)
  }
  const { createNeoviewLibraryTuiDefinition } = await import("./interaction.js")
  await runTerminalUi(createNeoviewLibraryTuiDefinition(flags.language), {
    host,
    language: flags.language,
    renderer: flags.renderer,
    theme: flags.theme,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["library-ui", ...args] } : undefined,
  })
}

async function runFileOperationUi(args: readonly string[], host: CliHost): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView file-ui requires an interactive terminal.")
  const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
  const flags = resolveTerminalUiFlags(args, { language: "zh", renderer: "opentui", theme: "nord" })
  if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
    throw usage(flags.error ?? `Unknown file-ui argument: ${flags.args[0]}`)
  }
  const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
  if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
    throw usage(`Unknown terminal theme: ${flags.theme}.`)
  }
  const { createNeoviewFileOperationTuiDefinition } = await import("./interaction.js")
  await runTerminalUi(createNeoviewFileOperationTuiDefinition(flags.language), {
    host,
    language: flags.language,
    renderer: flags.renderer,
    theme: flags.theme,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["file-ui", ...args] } : undefined,
  })
}

function usage(message: string): CliUsageError {
  return new CliUsageError(`${message}\n\n${formatCliHelp()}`)
}

function formatCliHelp(): string {
  return [
    "xneoview <command> <path> [options]",
    "",
    "Commands:",
    "  inspect <path>       Show book and current-frame metadata",
    "  pages <path>         List a bounded page window",
    "  frame <path>         Show the frame at --index",
    "  extract-page <path>  Stream the original page to --output <path|->",
    "  settings-inspect <json>  Preview a legacy settings migration",
    "  settings-import <json>   Import legacy settings into [nodes.neoview] TOML",
    "  reader-data-inspect <json>  Preview legacy history/bookmark migration",
    "  reader-data-import <json>   Import legacy reader data into thumbnails.db",
    "  search-history-inspect <json>  Preview legacy search-history migration",
    "  search-history-import <json>   Import search history into thumbnails.db",
    "  library-recents                 List recent Reader entries",
    "  library-recent-delete           Delete one recent entry (--id, --yes)",
    "  library-recent-cleanup          Delete an old bounded batch (--before, --yes)",
    "  library-invalid-cleanup         Remove missing recent/bookmark paths (--yes)",
    "  library-bookmarks               List bookmarks, optionally by --list",
    "  library-bookmark-add <path>     Add or merge a bookmark",
    "  library-bookmark-delete         Delete one bookmark (--id, --yes)",
    "  library-bookmark-lists          List system and custom bookmark lists",
    "  library-bookmark-list-add       Create a custom bookmark list (--name)",
    "  library-bookmark-list-delete    Delete a custom list (--id, --yes)",
    "  file-copy <source> <destination> Copy a file or directory",
    "  file-move <source> <destination> Move across directories or volumes",
    "  file-rename <source> <destination> Rename within one directory",
    "  file-trash <path...>             Move paths to system trash (--yes)",
    "  file-delete <path...>            Permanently delete paths (--yes)",
    "  file-open <path>                 Open with the system default application",
    "  file-reveal <path>               Reveal in the system file manager",
    "  file-undo                        Undo the latest guarded transaction (--yes)",
    "  file-undo-discard                Discard a stale latest undo transaction (--yes)",
    "  file-undo-state                  Show persistent undo capability and state",
    "  directory-create <path...>       Create directories",
    "  thumbnail-db-inspect [path]  Inspect the original thumbnail DB without writing",
    "  thumbnail-db-stats [path]    Show aggregate DB/writer statistics",
    "  thumbnail-db-cleanup [path]  Run one bounded empty/expired/invalid cleanup batch",
    "  thumbnail-db-clear-failures [path]  Clear a bounded failure batch",
    "  thumbnail-db-backup [path]   Create and verify a SQLite snapshot with VACUUM INTO",
    "  thumbnail-db-optimize [path] Backup, checkpoint and optimize an offline database",
    "  thumbnail-db-recover [path]  Restore a verified backup and quarantine the offline source",
    "  presentation-cache-stats       Show L3 content-cache statistics",
    "  presentation-cache-cleanup     Run age/budget maintenance for L3",
    "  presentation-cache-clear       Clear unleased L3 entries",
    "  diagnostics                    Show process, scheduler, cache and queue diagnostics",
    "  folder-tree <path>              List one lazily loaded directory-tree node",
    "  folder-search <path>            Stream a bounded recursive directory search",
    "  folder-search-history            List persisted scoped search history",
    "  folder-search-history-delete     Delete one persisted search query (--yes)",
    "  folder-search-history-clear      Clear one persisted search scope (--yes)",
    "  folder-exclude <path>           Persist an excluded directory in node TOML",
    "  folder-include <path>           Remove a persisted directory exclusion",
    "  folder-tree-cache-clear <path>  Clear the bounded file-tree cache",
    "  folder-ui                        Open the shared file-tree terminal workbench",
    "  library-ui                       Open recent/bookmark terminal management",
    "  file-ui                          Open shared file-operation terminal controls",
    "  ui                   Open the persistent terminal reader",
    "",
    "Options:",
    "  --index N            Zero-based page index",
    "  --cursor N           Page-list cursor",
    "  --limit N            Page-list limit (1..500)",
    "  --entry PATH         Repeat for each nested archive entry",
    "  --password-env VAR   Read the root archive password from VAR",
    "  --archive-password-env SCOPE=VAR  Scoped nested password; join scope with ::",
    "  --json               Structured metadata output",
    "  --force              Replace an existing extract output",
    "  --config PATH        Xiranite TOML path for settings/cache commands",
    "  --query QUERY        Folder search text or glob",
    "  --mode MODE          Folder search mode: text or glob",
    "  --node PATH          Explicit tree node for tree/cache commands",
    "  --depth N            Recursive search depth (0..4096)",
    "  --exclude PATTERN    Repeatable request-scoped gitignore pattern",
    "  --case-sensitive     Use case-sensitive folder search",
    "  --search-in-path     Match text queries against relative paths",
    "  --refresh            Bypass one cached tree node",
    "  --database PATH      Override the legacy NeoView thumbnails.db path",
    "  --strategy MODE      Settings import mode: merge or overwrite",
    "  --modules LIST       Comma-separated settings modules:",
    "                       native-settings,keybindings,emm,file-browser,ui,panels,bookmarks,history,",
    "                       search-history,upscale,performance,folder-ratings,voice-control",
    "  --yes                Confirm settings-import after preview",
    "                       Also required for thumbnail database mutations",
    "  --overwrite          Allow copy/move/rename to replace a destination",
    "  --concurrency N      File-operation concurrency (1..8)",
    "  --kind KIND          Thumbnail cleanup kind: empty, expired or invalid",
    "  --days N             Expiration age in days (default 30)",
    "  --scan-limit N       Invalid-path scan batch (default 500)",
    "  --offline            Confirm all NeoView/Xiranite database users are closed",
    "  --vacuum             Rebuild the database after backup during offline optimize",
    "  --reason REASON      Failure reason, or L3 cleanup reason: age|budget|explicit",
  ].join("\n")
}

if (process.argv[1] && /\bcli\.[cm]?[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const host = createCliHost()
  try {
    await runProgram(process.argv.slice(2), host)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = error instanceof CliUsageError ? error.exitCode : 1
  }
}

export { help }
