#!/usr/bin/env node
import { open, readFile, rm, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { readFileSync } from "node:fs"
import { CliUsageError, createCliHost, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type {
  HeadlessReaderPageSnapshot,
  HeadlessReaderSnapshot,
  HeadlessPageStream,
  OpenHeadlessReaderInput,
  ReaderCacheService,
  ReaderFileTreeHeadlessController,
  ReaderFileOperationService,
  ReaderSystemIntegrationService,
  ReaderFileMutation,
  ReaderLibraryHeadlessController,
  ReaderDiagnosticsService,
  ReaderDiagnosticsHistory,
  ReaderDiagnosticsSnapshot,
  ReaderSchedulerPoolDiagnostics,
  HeadlessReaderBookSettingsUpdate,
  ReaderBookSettingsPatch,
  ReaderBookSettingsSnapshot,
  ReaderMediaProgressRecord,
  ReaderMediaProgressUpdate,
  ReaderDirectoryFilter,
  ReaderDirectoryEmmEditCommand,
  HeadlessSuperResolutionPageInput,
  HeadlessSuperResolutionPageResult,
  HeadlessSuperResolutionCapabilitySnapshot,
  ReaderHeadlessController,
  LegacyBookSettingsImportResult,
  LegacyBookSettingsReport,
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
import { createReaderBackupBundleService, createReaderBookSettingsMigrationFileController, createReaderFileTreeController, createReaderHeadlessController, createReaderSettingsMigrationService, createReaderSettingsPortableService } from "./platform.js"
import type { LegacyReaderDataImporter } from "./migration/LegacyReaderDataImporter.js"
import type { LegacySearchHistoryImporter } from "./migration/LegacySearchHistoryImporter.js"
import type { ReaderCompositionOptions } from "./platform.js"
import type { ReaderBackupBundleResult, ReaderBackupInspection, ReaderBackupRestoreResult } from "./platform/backup/ReaderBackupBundleService.js"
import type { ReaderBookSettingsMigrationFilePort } from "./platform/migration/ReaderBookSettingsMigrationFileController.js"
import { projectReaderBookInformation } from "./domain/book/BookInformationProjection.js"
import { projectReaderTimeInformation } from "./domain/page/TimeInformationProjection.js"
import { commitNeoviewConfig } from "./platform/config/NeoviewConfigStore.js"
import { loadNeoviewRuntimeConfig } from "./platform/config/loadNeoviewRuntimeConfig.js"
import { loadReaderBackupScheduleConfig } from "./platform/backup/ReaderBackupScheduleConfig.js"
import { ReaderBackupScheduleRunner } from "./platform/backup/ReaderBackupScheduleRunner.js"
import { parseNeoviewBookmarkListPatch, parseNeoviewPageTransitionPatch, parseNeoviewRuntimeConfig } from "./application/config/ReaderRuntimeConfig.js"
import { formatReaderPageTransition, type ReaderPageTransitionPatch } from "./page-transition.js"
import type { ReaderInputBinding, ReaderInputContext, ReaderInputDescriptor } from "./domain/input/ReaderInputBindings.js"
import { READER_INPUT_ACTIONS, readerInputActionFromLegacyId, type ReaderInputAction } from "./domain/input/ReaderInputActions.js"
import { executeReaderHeadlessInputAction } from "./application/headless/ReaderHeadlessInputActionExecutor.js"
import { executeReaderHeadlessInputBinding } from "./application/headless/ReaderHeadlessInputBindingExecutor.js"
import {
  ReaderEmmMetadataPatchSchema,
  type ReaderEmmMetadataPatch,
  type ReaderEmmMetadataSnapshot,
} from "./application/metadata/ReaderEmmMetadataService.js"
import type {
  RemoteSuperResolutionArtifactResult,
  RemoteSuperResolutionArtifactCacheCleanupKind,
  RemoteSuperResolutionArtifactCacheCleanupResult,
  RemoteSuperResolutionArtifactCacheSnapshot,
  RemoteSuperResolutionPreloadMode,
  RemoteSuperResolutionPreloadSnapshot,
  RemoteReaderPresentationCacheMaintenanceResult,
  RemoteReaderPresentationCacheStatus,
  RemoteReaderThumbnailCleanupCommand,
  RemoteReaderThumbnailCleanupResult,
} from "./platform/remote/RemoteReaderHeadlessController.js"

const CLI_NAME = "xneoview"
const COMMANDS = new Set([
  "inspect", "pages", "frame", "extract-page", "subtitle-list", "subtitle-render", "media-progress-get", "media-progress-set", "emm-get", "emm-set", "upscale-page", "upscale-capabilities",
  "upscale-preload-status", "upscale-preload-start", "upscale-preload-pause", "upscale-preload-retry",
  "upscale-cache-stats", "upscale-cache-cleanup",
  "input-action-dispatch", "input-bindings-dispatch", "settings-inspect", "settings-import",
  "page-transition-get", "page-transition-set", "page-transition-reset",
  "input-bindings-list", "input-bindings-apply", "input-bindings-reset",
  "book-settings-get", "book-settings-set", "book-settings-legacy-inspect", "book-settings-legacy-import",
  "settings-export", "settings-portable-inspect", "settings-portable-import",
  "settings-backup", "settings-backup-scheduled",
  "settings-backup-inspect", "settings-backup-restore",
  "reader-data-inspect", "reader-data-import",
  "search-history-inspect", "search-history-import",
  "library-recents", "library-recent-delete", "library-recent-cleanup",
  "library-recent-cleanup-oldest", "library-recent-cleanup-folder", "library-recent-clear",
  "library-invalid-cleanup",
  "library-bookmarks", "library-bookmark-add", "library-bookmark-delete",
  "library-bookmark-batch-update", "library-bookmark-batch-delete",
  "library-bookmark-lists", "library-bookmark-list-add", "library-bookmark-list-delete",
  "thumbnail-db-inspect", "thumbnail-db-stats", "thumbnail-db-cleanup", "thumbnail-db-clear-failures",
  "thumbnail-db-backup", "thumbnail-db-optimize", "thumbnail-db-recover", "thumbnail-db-merge-plan", "thumbnail-db-merge-secondary",
  "presentation-cache-stats", "presentation-cache-cleanup", "presentation-cache-clear",
  "diagnostics", "diagnostics-history-export",
  "folder-tree", "folder-search", "folder-emm-tags", "folder-emm-edit", "folder-exclude", "folder-include", "folder-tree-cache-clear",
  "folder-search-history", "folder-search-history-delete", "folder-search-history-clear",
  "file-copy", "file-move", "file-rename", "file-delete", "file-trash", "file-open", "file-reveal", "file-undo", "file-undo-discard", "file-undo-state", "directory-create",
  "explorer-context-menu-preview", "explorer-context-menu-status", "explorer-context-menu-enable", "explorer-context-menu-disable",
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
  "--prefix",
  "--days",
  "--scan-limit",
  "--reason",
  "--source",
  "--backup",
  "--database",
  "--query",
  "--mode",
  "--filter",
  "--tag",
  "--exclude-tag",
  "--tag-mode",
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
  "--connect",
  "--token-env",
  "--format",
  "--since-ms",
  "--quarantine",
  "--expected-revision",
  "--favorite",
  "--rating",
  "--direction",
  "--page-mode",
  "--horizontal-book",
  "--input",
  "--input-json",
  "--contexts-json",
  "--action",
  "--enabled", "--type", "--duration", "--easing", "--subtitle-id", "--position", "--completed",
])
const BOOLEAN_FLAGS = new Set(["--json", "--force", "--yes", "--offline", "--vacuum", "--case-sensitive", "--search-in-path", "--refresh", "--starred", "--favorite", "--overwrite", "--flush"])
const MAX_SETTINGS_BYTES = 64 * 1024 * 1024
const MAX_READER_DATA_BYTES = 256 * 1024 * 1024
const MAX_EMM_EDIT_INPUT_BYTES = 1024 * 1024
const MAX_INPUT_BINDINGS_BYTES = 2 * 1024 * 1024

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "High-performance image and comic reader.",
  run: (args, host) => runProgram(args, host),
}

export interface NeoviewCliDependencies {
  createController: (options?: ReaderCompositionOptions) => Promise<CliReaderController>
  createRemoteController?: (options: { baseUrl: string; token: string }) => Promise<CliInteractiveReaderController>
  createFileTreeController?: (options?: ReaderCompositionOptions) => Promise<ReaderFileTreeHeadlessController>
  openThumbnailStore?: (path: string) => Promise<CliThumbnailMaintenanceStore>
  createDataImporter?: (databasePath?: string) => Promise<LegacyReaderDataImporter>
  createSearchHistoryImporter?: (databasePath?: string) => Promise<LegacySearchHistoryImporter>
  createBookSettingsMigrationFileController?: () => Promise<ReaderBookSettingsMigrationFilePort>
  createLibraryController?: (databasePath?: string) => Promise<ReaderLibraryHeadlessController>
  createFileOperationService?: (databasePath?: string) => Promise<ReaderFileOperationService>
  createSystemIntegrationService?: () => Promise<ReaderSystemIntegrationService>
  createCacheService?: (options: ReaderCompositionOptions) => Promise<ReaderCacheService>
  fetchRemotePresentationCache?: (options: { baseUrl: string; token: string }) => Promise<RemoteReaderPresentationCacheStatus>
  cleanupRemotePresentationCache?: (options: { baseUrl: string; token: string }, reason: "age" | "budget" | "explicit") => Promise<RemoteReaderPresentationCacheMaintenanceResult>
  clearRemotePresentationCache?: (options: { baseUrl: string; token: string }) => Promise<RemoteReaderPresentationCacheMaintenanceResult>
  createDiagnosticsService?: (options: ReaderCompositionOptions) => Promise<ReaderDiagnosticsService>
  fetchRemoteDiagnostics?: (options: { baseUrl: string; token: string }) => Promise<ReaderDiagnosticsSnapshot>
  fetchRemoteDiagnosticsHistory?: (options: { baseUrl: string; token: string; sinceMs?: number; limit?: number }) => Promise<ReaderDiagnosticsHistory>
  fetchRemoteThumbnailMaintenance?: (options: { baseUrl: string; token: string }) => Promise<ReaderThumbnailMaintenanceSnapshot>
  cleanupRemoteThumbnails?: (
    options: { baseUrl: string; token: string },
    command: RemoteReaderThumbnailCleanupCommand,
  ) => Promise<RemoteReaderThumbnailCleanupResult>
  clearRemoteThumbnailFailures?: (options: { baseUrl: string; token: string }, request: { reason?: string; limit: number }) => Promise<number>
  createThumbnailDatabaseMaintenance?: () => Promise<ReaderThumbnailDatabaseMaintenance>
  createBackupBundleService?: (options: ReaderCompositionOptions & { thumbnailDatabasePath?: string }) => Promise<{
    create(destinationPath: string, signal?: AbortSignal): Promise<ReaderBackupBundleResult>
    inspect(bundlePath: string, signal?: AbortSignal): Promise<ReaderBackupInspection>
    restore(bundlePath: string, options: { quarantinePath: string }, signal?: AbortSignal): Promise<ReaderBackupRestoreResult>
  }>
}

interface CliThumbnailMaintenanceStore extends ReaderThumbnailMaintenancePort, AsyncDisposable {}

export interface CliReaderController extends AsyncDisposable {
  open(input: OpenHeadlessReaderInput): Promise<HeadlessReaderSnapshot>
  inspect?(): HeadlessReaderSnapshot
  next?(signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  previous?(signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  goTo?(pageIndex: number, signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  openAdjacent?: ReaderHeadlessController["openAdjacent"]
  closeBook?(): Promise<void>
  listPages(cursor?: number, limit?: number): readonly HeadlessReaderPageSnapshot[] | Promise<readonly HeadlessReaderPageSnapshot[]>
  openPageStream(pageIndex: number, signal?: AbortSignal): Promise<HeadlessPageStream>
  listSubtitles?(pageIndex: number, signal?: AbortSignal): readonly import("./application/reader/ReaderSubtitleService.js").ReaderSubtitleTrack[] | Promise<readonly import("./application/reader/ReaderSubtitleService.js").ReaderSubtitleTrack[]>
  renderSubtitle?(pageIndex: number, assetId: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; contentVersion: string }>
  getMediaProgress?(): Promise<ReaderMediaProgressRecord | undefined>
  updateMediaProgress?(update: ReaderMediaProgressUpdate, options?: { flush?: boolean }): Promise<ReaderMediaProgressRecord>
  getEmmMetadata?(signal?: AbortSignal): Promise<ReaderEmmMetadataSnapshot>
  updateEmmMetadata?(expectedRevision: number, patch: ReaderEmmMetadataPatch, signal?: AbortSignal): Promise<{ metadata: ReaderEmmMetadataSnapshot; reader: HeadlessReaderSnapshot }>
  getBookSettings(signal?: AbortSignal): Promise<ReaderBookSettingsSnapshot>
  updateBookSettings(expectedRevision: number, patch: ReaderBookSettingsPatch, signal?: AbortSignal): Promise<HeadlessReaderBookSettingsUpdate>
  upscalePage?(input: HeadlessSuperResolutionPageInput): Promise<HeadlessSuperResolutionPageResult>
  inspectSuperResolution?(
    options?: { refresh?: boolean; signal?: AbortSignal },
  ): Promise<HeadlessSuperResolutionCapabilitySnapshot>
  generateUpscaleArtifact?(
    pageIndex: number,
    options?: { trigger?: "manual" | "automatic-current"; signal?: AbortSignal },
  ): Promise<RemoteSuperResolutionArtifactResult>
  getUpscalePreload?(signal?: AbortSignal): Promise<readonly RemoteSuperResolutionPreloadSnapshot[]>
  startUpscalePreload?(mode: RemoteSuperResolutionPreloadMode, signal?: AbortSignal): Promise<readonly RemoteSuperResolutionPreloadSnapshot[]>
  pauseUpscalePreload?(signal?: AbortSignal): Promise<readonly RemoteSuperResolutionPreloadSnapshot[]>
  retryUpscalePreload?(mode: RemoteSuperResolutionPreloadMode, signal?: AbortSignal): Promise<readonly RemoteSuperResolutionPreloadSnapshot[]>
  getUpscaleArtifactCache?(signal?: AbortSignal): Promise<RemoteSuperResolutionArtifactCacheSnapshot>
  cleanupUpscaleArtifactCache?(kind: RemoteSuperResolutionArtifactCacheCleanupKind, signal?: AbortSignal): Promise<RemoteSuperResolutionArtifactCacheCleanupResult>
}

export interface CliInteractiveReaderController extends CliReaderController {
  next(signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  previous(signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  goTo(pageIndex: number, signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  closeBook(): Promise<void>
}

const DEFAULT_DEPENDENCIES: NeoviewCliDependencies = {
  createController: createReaderHeadlessController,
  createRemoteController: async (options) => {
    const { RemoteReaderHeadlessController } = await import("./platform/remote/RemoteReaderHeadlessController.js")
    return new RemoteReaderHeadlessController(options)
  },
  createFileTreeController: createReaderFileTreeController,
}

export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createCliHost(),
  dependencies: NeoviewCliDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const command = args[0]
  if (!command) {
    if (host.stdin.isTTY && host.stdout.isTTY) await runReaderUi([], host, dependencies)
    else writeLine(host, formatCliHelp())
    return
  }
  if (command === "help" || command === "--help" || command === "-h") {
    writeLine(host, formatCliHelp())
    return
  }
  if (command === "ui") {
    await runReaderUi(args.slice(1), host, dependencies)
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
  if (command === "book-settings-ui") {
    await runBookSettingsUi(args.slice(1), host, dependencies)
    return
  }
  if (command === "media-progress-ui") {
    await runMediaProgressUi(args.slice(1), host, dependencies)
    return
  }
  if (command === "book-settings-migration-ui") {
    await runBookSettingsMigrationUi(args.slice(1), host)
    return
  }
  if (command === "input-bindings-ui") {
    await runInputBindingsUi(args.slice(1), host)
    return
  }
  if (command === "upscale-cache-ui") {
    await runUpscaleCacheUi(args.slice(1), host, dependencies)
    return
  }
  if (command === "diagnostics-history-ui") {
    await runDiagnosticsHistoryUi(args.slice(1), host, dependencies)
    return
  }
  if (!COMMANDS.has(command)) throw usage(`Unknown NeoView command: ${command}`)

  const parsed = parseArguments(args.slice(1), command)
  validateCommandOptions(command, parsed)
  if (command === "page-transition-get" || command === "page-transition-set" || command === "page-transition-reset") {
    await runPageTransitionCommand(command, parsed, host)
    return
  }
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
  if (command === "thumbnail-db-merge-plan") {
    if (parsed.positionals.length > 1) throw usage("thumbnail-db-merge-plan accepts at most one canonical database path.")
    await runThumbnailDatabaseMergePlan(parsed.positionals[0], parsed, host)
    return
  }
  if (command === "thumbnail-db-merge-secondary") {
    if (parsed.positionals.length > 1) throw usage("thumbnail-db-merge-secondary accepts at most one canonical database path.")
    await runThumbnailDatabaseMergeSecondary(parsed.positionals[0], parsed, host)
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
  if (command === "diagnostics-history-export") {
    if (parsed.positionals.length) throw usage("diagnostics-history-export does not accept a path.")
    await runDiagnosticsHistoryExport(parsed, host, dependencies)
    return
  }
  if (command.startsWith("input-bindings-")) {
    if (command === "input-bindings-dispatch") {
      await runInputBindingsDispatchCommand(parsed, host)
      return
    }
    await runInputBindingsCommand(command, parsed, host)
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
  if (command.startsWith("book-settings-legacy-")) {
    if (parsed.positionals.length !== 1) throw usage(`${command} requires exactly one legacy settings JSON path.`)
    await runLegacyBookSettingsMigrationCommand(command, resolve(host.cwd, parsed.positionals[0]!), parsed, host, dependencies)
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
  if (command === "folder-emm-tags") {
    if (parsed.positionals.length) throw usage("folder-emm-tags does not accept a directory path.")
    await runFolderEmmTags(parsed, host, dependencies)
    return
  }
  if (command.startsWith("folder-")) {
    if (parsed.positionals.length !== 1) throw usage(`${command} requires exactly one directory path.`)
    await runFolderCommand(command, resolve(host.cwd, parsed.positionals[0]!), parsed, host, dependencies)
    return
  }
  if (command === "upscale-capabilities") {
    if (parsed.positionals.length) throw usage("upscale-capabilities does not accept a book path.")
    await runSuperResolutionCapabilities(parsed, host, dependencies)
    return
  }
  if (command === "settings-export") {
    if (parsed.positionals.length) throw usage("settings-export does not accept an input path.")
    await runPortableSettingsExport(parsed, host)
    return
  }
  if (command === "settings-backup") {
    if (parsed.positionals.length !== 1) throw usage("settings-backup requires exactly one destination directory.")
    await runSettingsBackup(resolve(host.cwd, parsed.positionals[0]!), parsed, host, dependencies)
    return
  }
  if (command === "settings-backup-scheduled") {
    if (parsed.positionals.length) throw usage("settings-backup-scheduled does not accept a destination directory.")
    await runSettingsBackupScheduled(parsed, host, dependencies)
    return
  }
  if (command === "settings-backup-inspect" || command === "settings-backup-restore") {
    if (parsed.positionals.length !== 1) throw usage(`${command} requires exactly one backup bundle directory.`)
    await runSettingsBackupRead(command, resolve(host.cwd, parsed.positionals[0]!), parsed, host, dependencies)
    return
  }
  if (command.startsWith("explorer-context-menu-")) {
    await runExplorerContextMenuCommand(command, parsed, host, dependencies)
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
  const bookSettingsUpdate = command === "book-settings-set" ? {
    expectedRevision: requiredIntegerOption(parsed, "--expected-revision", 0, Number.MAX_SAFE_INTEGER),
    patch: bookSettingsPatch(parsed),
  } : undefined
  const emmUpdate = command === "emm-set" ? {
    expectedRevision: requiredIntegerOption(parsed, "--expected-revision", 0, Number.MAX_SAFE_INTEGER),
    patch: parseEmmMetadataPatchCli(oneValue(parsed, "--input"), host.cwd),
  } : undefined
  const mediaProgressUpdate = command === "media-progress-set" ? {
    position: requiredFiniteNumberOption(parsed, "--position"),
    duration: requiredFiniteNumberOption(parsed, "--duration"),
    completed: requiredBooleanOption(parsed, "--completed"),
  } satisfies ReaderMediaProgressUpdate : undefined
  if (command === "emm-set" && !parsed.booleans.has("--yes")) throw usage("emm-set requires --yes after reviewing the patch.")
  if (command === "upscale-cache-cleanup" && !parsed.booleans.has("--yes")) throw usage("upscale-cache-cleanup requires --yes.")
  const artifactCacheCleanupKind = command === "upscale-cache-cleanup"
    ? upscaleArtifactCacheCleanupKind(oneValue(parsed, "--kind"))
    : undefined
  const index = integerOption(parsed, "--index", 0, Number.MAX_SAFE_INTEGER, 0)
  const credentials = credentialsFromEnvironment(parsed, host)
  let controller: CliReaderController | undefined
  try {
    const connect = oneValue(parsed, "--connect")
    const tokenVariable = oneValue(parsed, "--token-env")
    if (!connect && tokenVariable) throw usage("--token-env requires --connect.")
    if (connect && command.startsWith("media-progress-")) throw usage(`${command} currently requires a local Reader composition; remote media-progress transport is not yet available.`)
    if (command.startsWith("upscale-cache-") && !connect) throw usage(`${command} requires --connect to the running Reader backend.`)
    if (connect && parsed.values.has("--config")) throw usage("--config cannot be combined with --connect because the running backend owns configuration.")
    controller = connect
      ? await (dependencies.createRemoteController ?? DEFAULT_DEPENDENCIES.createRemoteController!)({
          baseUrl: connect,
          token: connectionToken(tokenVariable, host),
        })
      : await dependencies.createController({
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
    if (command === "input-action-dispatch") {
      const action = inputActionOption(parsed)
      const result = controller.inspect
        ? await executeReaderHeadlessInputAction(action, controller as CliReaderController & { inspect(): HeadlessReaderSnapshot })
        : { handled: false as const, action, reason: "missing-controller-capability" as const }
      if (parsed.booleans.has("--json")) writeJson(host, result)
      else writeLine(host, result.handled
        ? `Input action handled: ${action}${result.boundary ? " (boundary)" : ""}`
        : `Input action unsupported: ${action} (${result.reason})`)
      return
    }
    if (command === "inspect") return printInspect(snapshot, parsed.booleans.has("--json"), host)
    if (command === "frame") return printFrame(snapshot, parsed.booleans.has("--json"), host)
    if (command === "pages") {
      const cursor = integerOption(parsed, "--cursor", 0, snapshot.book.pageCount, 0)
      const limit = integerOption(parsed, "--limit", 1, 500, 100)
      return printPages(await controller.listPages(cursor, limit), cursor, snapshot.book.pageCount, parsed.booleans.has("--json"), host)
    }
    if (command === "book-settings-get") {
      return printBookSettings(await controller.getBookSettings(), parsed.booleans.has("--json"), host)
    }
    if (command === "book-settings-set") {
      const updated = await controller.updateBookSettings(bookSettingsUpdate!.expectedRevision, bookSettingsUpdate!.patch)
      return printBookSettingsUpdate(updated, parsed.booleans.has("--json"), host)
    }
    if (command === "subtitle-list") {
      if (!controller.listSubtitles) throw new Error("Reader subtitles are unavailable for this transport.")
      return printSubtitleTracks(await controller.listSubtitles(index), parsed.booleans.has("--json"), host)
    }
    if (command === "subtitle-render") {
      if (!controller.renderSubtitle) throw new Error("Reader subtitles are unavailable for this transport.")
      if (parsed.booleans.has("--json")) throw usage("subtitle-render does not support --json because its output is WebVTT bytes.")
      const assetId = oneValue(parsed, "--subtitle-id")
      if (!assetId) throw usage("subtitle-render requires --subtitle-id <track-id>.")
      const output = oneValue(parsed, "--output")
      if (!output) throw usage("subtitle-render requires --output <path|->.")
      const rendered = await controller.renderSubtitle(index, assetId)
      await writeSubtitle(rendered.bytes, output, parsed.booleans.has("--force"), host)
      if (output !== "-") writeLine(host, `Reader subtitle rendered: ${resolve(host.cwd, output)} (${rendered.contentVersion})`)
      return
    }
    if (command === "media-progress-get") {
      if (!controller.getMediaProgress) throw new Error("Reader media progress is unavailable for this transport.")
      return printMediaProgress(await controller.getMediaProgress(), parsed.booleans.has("--json"), host)
    }
    if (command === "media-progress-set") {
      if (!controller.updateMediaProgress) throw new Error("Reader media progress is unavailable for this transport.")
      const progress = await controller.updateMediaProgress(mediaProgressUpdate!, { flush: parsed.booleans.has("--flush") })
      return printMediaProgress(progress, parsed.booleans.has("--json"), host)
    }
    if (command === "emm-get") {
      if (!controller.getEmmMetadata) throw new Error("Reader EMM metadata is unavailable for this transport.")
      return printEmmMetadata(await controller.getEmmMetadata(), parsed.booleans.has("--json"), host)
    }
    if (command === "emm-set") {
      if (!controller.updateEmmMetadata) throw new Error("Reader EMM metadata is unavailable for this transport.")
      const updated = await controller.updateEmmMetadata(emmUpdate!.expectedRevision, emmUpdate!.patch)
      if (parsed.booleans.has("--json")) writeJson(host, updated)
      else printEmmMetadata(updated.metadata, false, host)
      return
    }
    if (command.startsWith("upscale-preload-")) {
      const mode = command === "upscale-preload-start" || command === "upscale-preload-retry"
        ? upscalePreloadMode(oneValue(parsed, "--mode"))
        : undefined
      let snapshots: readonly RemoteSuperResolutionPreloadSnapshot[]
      if (command === "upscale-preload-status") {
        if (!controller.getUpscalePreload) throw missingUpscalePreloadCapability()
        snapshots = await controller.getUpscalePreload()
      } else if (command === "upscale-preload-start") {
        if (!controller.startUpscalePreload) throw missingUpscalePreloadCapability()
        snapshots = await controller.startUpscalePreload(mode!)
      } else if (command === "upscale-preload-pause") {
        if (!controller.pauseUpscalePreload) throw missingUpscalePreloadCapability()
        snapshots = await controller.pauseUpscalePreload()
      } else {
        if (!controller.retryUpscalePreload) throw missingUpscalePreloadCapability()
        snapshots = await controller.retryUpscalePreload(mode!)
      }
      return printUpscalePreloadSnapshots(snapshots, parsed.booleans.has("--json"), host)
    }
    if (command === "upscale-cache-stats") {
      if (!controller.getUpscaleArtifactCache) throw missingUpscaleArtifactCacheCapability()
      return printUpscaleArtifactCache(await controller.getUpscaleArtifactCache(), parsed.booleans.has("--json"), host)
    }
    if (command === "upscale-cache-cleanup") {
      if (!controller.cleanupUpscaleArtifactCache) throw missingUpscaleArtifactCacheCapability()
      return printUpscaleArtifactCache(await controller.cleanupUpscaleArtifactCache(artifactCacheCleanupKind!), parsed.booleans.has("--json"), host)
    }
    if (command === "upscale-page") {
      if (!controller.upscalePage) throw new Error("Reader super-resolution is unavailable for this transport.")
      const output = oneValue(parsed, "--output")
      if (!output) throw usage("upscale-page requires --output <path>.")
      const destinationPath = resolve(host.cwd, output)
      await assertOutputAvailable(destinationPath, parsed.booleans.has("--force"))
      const result = await controller.upscalePage({
        pageIndex: index,
        destinationPath,
        trigger: "manual",
      })
      return printSuperResolutionResult(result, parsed.booleans.has("--json"), host)
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

async function runPageTransitionCommand(
  command: "page-transition-get" | "page-transition-set" | "page-transition-reset",
  parsed: ParsedArguments,
  host: CliHost,
): Promise<void> {
  const options = { configPath: oneValue(parsed, "--config"), cwd: host.cwd, env: host.env }
  let settings = (await loadNeoviewRuntimeConfig(options)).pageTransition
  if (command !== "page-transition-get") {
    const pageTransition = command === "page-transition-reset"
      ? { reset: "defaults" as const }
      : pageTransitionCliPatch(parsed)
    const { tomlPatch } = parseNeoviewPageTransitionPatch({ pageTransition })
    const committed = await commitNeoviewConfig(tomlPatch, { ...options, strategy: "merge" })
    settings = parseNeoviewRuntimeConfig(committed.nodeConfig).pageTransition
  }
  if (parsed.booleans.has("--json")) writeJson(host, settings)
  else writeLine(host, `Page transition: ${formatReaderPageTransition(settings)}`)
}

function pageTransitionCliPatch(parsed: ParsedArguments): ReaderPageTransitionPatch {
  const patch: ReaderPageTransitionPatch = {}
  const enabled = oneValue(parsed, "--enabled")
  if (enabled !== undefined) {
    if (enabled !== "true" && enabled !== "false") throw usage("--enabled must be true or false.")
    patch.enabled = enabled === "true"
  }
  const type = oneValue(parsed, "--type")
  if (type !== undefined) patch.type = type as ReaderPageTransitionPatch["type"]
  const duration = oneValue(parsed, "--duration")
  if (duration !== undefined) patch.duration = Number(duration)
  const easing = oneValue(parsed, "--easing")
  if (easing !== undefined) patch.easing = easing as ReaderPageTransitionPatch["easing"]
  return patch
}

function validateCommandOptions(command: string, parsed: ParsedArguments): void {
  if (command === "input-action-dispatch") {
    rejectOptions(parsed, new Set(["--json", "--config", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index", "--action"]))
    return
  }
  if (command === "input-bindings-list") {
    rejectOptions(parsed, new Set(["--json", "--config"]))
    return
  }
  if (command === "input-bindings-apply" || command === "input-bindings-reset") {
    rejectOptions(parsed, new Set(["--json", "--config", "--yes"]))
    return
  }
  if (command === "upscale-capabilities") {
    rejectOptions(parsed, new Set(["--json", "--config", "--refresh"]))
    return
  }
  if (command === "upscale-page") {
    rejectOptions(parsed, new Set([
      "--json", "--config", "--entry", "--password-env", "--archive-password-env", "--index", "--output", "--force",
    ]))
    return
  }
  if (command === "subtitle-list") {
    rejectOptions(parsed, new Set(["--json", "--config", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index"]))
    return
  }
  if (command === "subtitle-render") {
    rejectOptions(parsed, new Set(["--config", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index", "--subtitle-id", "--output", "--force", "--json"]))
    return
  }
  if (command === "media-progress-get") {
    rejectOptions(parsed, new Set(["--json", "--config", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index"]))
    return
  }
  if (command === "media-progress-set") {
    rejectOptions(parsed, new Set(["--json", "--config", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index", "--position", "--duration", "--completed", "--flush"]))
    return
  }
  if (command === "emm-get") {
    rejectOptions(parsed, new Set(["--json", "--config", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index"]))
    return
  }
  if (command === "emm-set") {
    rejectOptions(parsed, new Set(["--json", "--config", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index", "--expected-revision", "--input", "--yes"]))
    return
  }
  if (command === "input-bindings-dispatch") {
    rejectOptions(parsed, new Set(["--json", "--config", "--input-json", "--contexts-json"]))
    return
  }
  if (command.startsWith("upscale-preload-")) {
    const allowed = new Set(["--json", "--config", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index"])
    if (command === "upscale-preload-start" || command === "upscale-preload-retry") allowed.add("--mode")
    rejectOptions(parsed, allowed)
    return
  }
  if (command === "upscale-cache-stats") {
    rejectOptions(parsed, new Set(["--json", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index"]))
    return
  }
  if (command === "upscale-cache-cleanup") {
    rejectOptions(parsed, new Set(["--json", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index", "--kind", "--yes"]))
    return
  }
  if (command === "book-settings-get") {
    rejectOptions(parsed, new Set(["--json", "--config", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index"]))
    return
  }
  if (command === "book-settings-set") {
    rejectOptions(parsed, new Set([
      "--json", "--config", "--connect", "--token-env", "--entry", "--password-env", "--archive-password-env", "--index",
      "--expected-revision", "--favorite", "--rating", "--direction", "--page-mode", "--horizontal-book",
    ]))
    return
  }
  if (command === "book-settings-legacy-inspect") {
    rejectOptions(parsed, new Set(["--json"]))
    return
  }
  if (command === "book-settings-legacy-import") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--strategy", "--database"]))
    return
  }
  if (command === "settings-export") {
    rejectOptions(parsed, new Set(["--output", "--config", "--force"]))
    return
  }
  if (command === "settings-backup") {
    rejectOptions(parsed, new Set(["--yes", "--config", "--database", "--json"]))
    return
  }
  if (command === "settings-backup-scheduled") {
    rejectOptions(parsed, new Set(["--yes", "--config", "--database", "--json"]))
    return
  }
  if (command === "settings-backup-inspect") {
    rejectOptions(parsed, new Set(["--config", "--database", "--json"]))
    return
  }
  if (command === "settings-backup-restore") {
    rejectOptions(parsed, new Set(["--yes", "--offline", "--config", "--database", "--quarantine", "--json"]))
    return
  }
  if (command === "settings-portable-inspect") {
    rejectOptions(parsed, new Set(["--json"]))
    return
  }
  if (command === "settings-portable-import") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--config", "--strategy"]))
    return
  }
  if (command === "settings-inspect") {
    rejectOptions(parsed, new Set(["--json", "--modules"]))
    return
  }
  if (command.startsWith("page-transition-")) {
    const allowed = command === "page-transition-set"
      ? new Set(["--json", "--config", "--enabled", "--type", "--duration", "--easing"])
      : new Set(["--json", "--config"])
    rejectOptions(parsed, allowed)
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
    rejectOptions(parsed, new Set(["--json", "--database", "--limit", "--offset", "--list", "--filter"]))
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
  if (command.startsWith("page-transition-")) {
    const allowed = command === "page-transition-get" ? new Set(["--json", "--config"])
      : command === "page-transition-reset" ? new Set(["--json", "--config"])
        : new Set(["--json", "--config", "--enabled", "--type", "--duration", "--easing"])
    rejectOptions(parsed, allowed)
    return
  }
  if (command === "library-bookmark-batch-update") {
    rejectOptions(parsed, new Set(["--json", "--database", "--id", "--list"]))
    return
  }
  if (command === "library-bookmark-batch-delete") {
    rejectOptions(parsed, new Set(["--json", "--database", "--id", "--yes"]))
    return
  }
  if (command === "library-recent-cleanup-oldest") {
    rejectOptions(parsed, new Set(["--json", "--database", "--limit", "--yes"]))
    return
  }
  if (command === "library-recent-cleanup-folder" || command === "library-recent-clear") {
    rejectOptions(parsed, new Set(["--json", "--database", "--yes"]))
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
  if (command === "explorer-context-menu-preview" || command === "explorer-context-menu-status") {
    rejectOptions(parsed, new Set(["--json"]))
    return
  }
  if (command === "explorer-context-menu-enable" || command === "explorer-context-menu-disable") {
    rejectOptions(parsed, new Set(["--json", "--yes"]))
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
    rejectOptions(parsed, new Set(["--json", "--connect", "--token-env"]))
    return
  }
  if (command === "thumbnail-db-cleanup") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--kind", "--prefix", "--days", "--limit", "--scan-limit", "--connect", "--token-env"]))
    return
  }
  if (command === "thumbnail-db-clear-failures") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--reason", "--limit", "--connect", "--token-env"]))
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
    rejectOptions(parsed, new Set(["--json", "--config", "--connect", "--token-env"]))
    return
  }
  if (command === "presentation-cache-cleanup") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--config", "--reason", "--connect", "--token-env"]))
    return
  }
  if (command === "presentation-cache-clear") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--config", "--connect", "--token-env"]))
    return
  }
  if (command === "diagnostics") {
    rejectOptions(parsed, new Set(["--json", "--config", "--connect", "--token-env"]))
    return
  }
  if (command === "thumbnail-db-merge-plan") {
    rejectOptions(parsed, new Set(["--json", "--source"]))
    return
  }
  if (command === "thumbnail-db-merge-secondary") {
    rejectOptions(parsed, new Set(["--json", "--source", "--backup", "--yes", "--offline"]))
    return
  }
  if (command === "diagnostics-history-export") {
    rejectOptions(parsed, new Set(["--connect", "--token-env", "--format", "--since-ms", "--limit", "--output", "--force"]))
    return
  }
  if (command === "folder-tree") {
    rejectOptions(parsed, new Set(["--json", "--config", "--node", "--refresh"]))
    return
  }
  if (command === "folder-search") {
    rejectOptions(parsed, new Set(["--json", "--config", "--query", "--mode", "--kind", "--filter", "--tag", "--exclude-tag", "--tag-mode", "--depth", "--limit", "--exclude", "--case-sensitive", "--search-in-path"]))
    return
  }
  if (command === "folder-emm-tags") {
    rejectOptions(parsed, new Set(["--json", "--config", "--database", "--limit"]))
    return
  }
  if (command === "folder-emm-edit") {
    rejectOptions(parsed, new Set(["--json", "--config", "--database", "--input", "--concurrency"]))
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
  const databasePath = oneValue(parsed, "--database")
  const controller = await createController({
    configPath: oneValue(parsed, "--config"),
    cwd: host.cwd,
    env: host.env,
    ...(databasePath ? { legacyThumbnailDatabasePath: resolve(host.cwd, databasePath) } : {}),
  })
  try {
    const openPath = command === "folder-exclude" || command === "folder-include" ? dirname(path) : path
    const opened = await controller.open({ path: openPath })
    if (command === "folder-emm-edit") {
      await runFolderEmmEdit(controller, opened.generation, parsed, host)
      return
    }
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
  const query = oneValue(parsed, "--query") ?? ""
  const includeTags = parsed.values.get("--tag")
  const excludeTags = parsed.values.get("--exclude-tag")
  if (!query && !includeTags?.length && !excludeTags?.length) {
    throw usage("folder-search requires --query <text|glob> or at least one --tag/--exclude-tag.")
  }
  const mode = oneValue(parsed, "--mode") ?? "text"
  if (mode !== "text" && mode !== "glob") throw usage("--mode must be text or glob.")
  const kind = oneValue(parsed, "--kind") ?? "all"
  if (kind !== "all" && kind !== "file" && kind !== "directory") throw usage("--kind must be all, file or directory.")
  const tagMode = oneValue(parsed, "--tag-mode") ?? "all"
  if (tagMode !== "all" && tagMode !== "any") throw usage("--tag-mode must be all or any.")
  const depthValue = oneValue(parsed, "--depth")
  const maximumDepth = depthValue === undefined ? undefined : integerOption(parsed, "--depth", 0, 4_096, 0)
  const maximumResults = integerOption(parsed, "--limit", 1, 10_000, 512)
  await controller.setFilter(readerDirectoryFilterOption(parsed))
  const handle = controller.search(query, {
    mode,
    kind,
    caseSensitive: parsed.booleans.has("--case-sensitive"),
    searchInPath: parsed.booleans.has("--search-in-path"),
    maximumDepth,
    maximumResults,
    excludePatterns: parsed.values.get("--exclude"),
    includeTags,
    excludeTags,
    tagMode,
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

async function runFolderEmmEdit(
  controller: ReaderFileTreeHeadlessController,
  generation: number,
  parsed: ParsedArguments,
  host: CliHost,
): Promise<void> {
  const inputPath = resolve(host.cwd, requiredValue(parsed, "--input", "folder-emm-edit"))
  const inputStat = await stat(inputPath)
  if (!inputStat.isFile()) throw usage(`folder-emm-edit input is not a file: ${inputPath}`)
  if (inputStat.size > MAX_EMM_EDIT_INPUT_BYTES) throw usage(`folder-emm-edit input exceeds ${MAX_EMM_EDIT_INPUT_BYTES} bytes.`)
  let decoded: unknown
  try {
    decoded = JSON.parse(await readFile(inputPath, "utf8"))
  } catch {
    throw usage("folder-emm-edit input must be valid JSON.")
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw usage("folder-emm-edit input must be an object containing updates.")
  }
  const record = decoded as Record<string, unknown>
  const concurrency = parsed.values.has("--concurrency")
    ? integerOption(parsed, "--concurrency", 1, 8, 4)
    : record.concurrency
  const command = {
    generation,
    updates: record.updates,
    ...(concurrency === undefined ? {} : { concurrency }),
  } as ReaderDirectoryEmmEditCommand
  const result = await controller.editEmm(command)
  if (parsed.booleans.has("--json")) writeJson(host, result)
  else writeLine(host, `EMM metadata: succeeded=${result.succeeded} conflicts=${result.conflicts} failed=${result.failed} generation=${result.generation ?? "refresh"}`)
}

async function runFolderEmmTags(
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const limit = integerOption(parsed, "--limit", 1, 32, 8)
  const createController = dependencies.createFileTreeController ?? createReaderFileTreeController
  const controller = await createController({
    configPath: oneValue(parsed, "--config"),
    cwd: host.cwd,
    env: host.env,
    legacyThumbnailDatabasePath: oneValue(parsed, "--database"),
  })
  try {
    const suggestions = await controller.suggestEmmTags(limit)
    if (parsed.booleans.has("--json")) writeJson(host, { suggestions })
    else {
      for (const suggestion of suggestions) {
        const translation = suggestion.translatedTag ? `\t${suggestion.translatedTag}` : ""
        writeLine(host, `${suggestion.category}:${suggestion.tag}\t${suggestion.favorite ? "favorite" : "catalog"}${translation}`)
      }
    }
  } finally {
    await controller[Symbol.asyncDispose]()
  }
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
  const connect = oneValue(parsed, "--connect")
  const tokenVariable = oneValue(parsed, "--token-env")
  if (!connect && tokenVariable) throw usage("--token-env requires --connect.")
  if (connect && parsed.values.has("--config")) {
    throw usage("--config cannot be combined with --connect because the running backend owns the presentation cache.")
  }
  if (connect) {
    const options = { baseUrl: connect, token: connectionToken(tokenVariable, host) }
    const result = command === "presentation-cache-stats"
      ? await (dependencies.fetchRemotePresentationCache ?? (async (remoteOptions: typeof options) => {
          const { fetchRemoteReaderPresentationCache } = await import("./platform/remote/RemoteReaderHeadlessController.js")
          return fetchRemoteReaderPresentationCache(remoteOptions)
        }))(options)
      : command === "presentation-cache-clear"
        ? await (dependencies.clearRemotePresentationCache ?? (async (remoteOptions: typeof options) => {
            const { clearRemoteReaderPresentationCache } = await import("./platform/remote/RemoteReaderHeadlessController.js")
            return clearRemoteReaderPresentationCache(remoteOptions)
          }))(options)
        : await (dependencies.cleanupRemotePresentationCache ?? (async (
            remoteOptions: typeof options,
            reason: "age" | "budget" | "explicit",
          ) => {
            const { cleanupRemoteReaderPresentationCache } = await import("./platform/remote/RemoteReaderHeadlessController.js")
            return cleanupRemoteReaderPresentationCache(remoteOptions, reason)
          }))(options, cacheMaintenanceReason(oneValue(parsed, "--reason")))
    printPresentationCacheResult(result, parsed.booleans.has("--json"), host)
    return
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
  const connect = oneValue(parsed, "--connect")
  const tokenVariable = oneValue(parsed, "--token-env")
  if (!connect && tokenVariable) throw usage("--token-env requires --connect.")
  if (connect && parsed.values.has("--config")) throw usage("--config cannot be combined with --connect because the running backend owns configuration.")
  if (connect) {
    const fetchDiagnostics = dependencies.fetchRemoteDiagnostics ?? (async (options: { baseUrl: string; token: string }) => {
      const { fetchRemoteReaderDiagnostics } = await import("./platform/remote/RemoteReaderHeadlessController.js")
      return fetchRemoteReaderDiagnostics(options)
    })
    return printDiagnostics(await fetchDiagnostics({ baseUrl: connect, token: connectionToken(tokenVariable, host) }), parsed, host)
  }
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
    printDiagnostics(await service.snapshot(), parsed, host)
  } finally {
    await service.close()
  }
}

async function runDiagnosticsHistoryExport(
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const connect = oneValue(parsed, "--connect")
  if (!connect) throw usage("diagnostics-history-export requires --connect because history belongs to the running backend.")
  const tokenVariable = oneValue(parsed, "--token-env")
  const format = diagnosticsHistoryFormat(oneValue(parsed, "--format"))
  const sinceMs = optionalIntegerOption(parsed, "--since-ms", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  const limit = optionalIntegerOption(parsed, "--limit", 1, 1_000)
  const fetchHistory = dependencies.fetchRemoteDiagnosticsHistory ?? (async (options: {
    baseUrl: string
    token: string
    sinceMs?: number
    limit?: number
  }) => {
    const { fetchRemoteReaderDiagnosticsHistory } = await import("./platform/remote/RemoteReaderHeadlessController.js")
    return fetchRemoteReaderDiagnosticsHistory(options)
  })
  const history = await fetchHistory({
    baseUrl: connect,
    token: connectionToken(tokenVariable, host),
    sinceMs,
    limit,
  })
  const { exportReaderDiagnosticsHistory } = await import("./application/diagnostics/ReaderDiagnosticsHistoryExport.js")
  const exported = exportReaderDiagnosticsHistory(history, format)
  const output = oneValue(parsed, "--output")
  if (!output || output === "-") {
    host.stdout.write(exported.body)
    return
  }
  const outputPath = resolve(host.cwd, output)
  await writeTextExclusive(outputPath, exported.body, parsed.booleans.has("--force"))
  writeLine(host, `Reader diagnostics history exported: ${outputPath}`)
}

function diagnosticsHistoryFormat(value: string | undefined): "json" | "csv" {
  const format = value ?? "json"
  if (format === "json" || format === "csv") return format
  throw usage("--format must be json or csv.")
}

function printDiagnostics(result: ReaderDiagnosticsSnapshot, parsed: ParsedArguments, host: CliHost): void {
  if (parsed.booleans.has("--json")) return writeJson(host, result)
  writeLine(host, `Reader diagnostics: sessions=${result.reader.activeSessions} uptime=${result.uptimeSeconds.toFixed(1)}s`)
  writeLine(host, `Process: rss=${result.process.rssBytes} heap=${result.process.heapUsedBytes}/${result.process.heapTotalBytes} external=${result.process.externalBytes}`)
  writeLine(host, `Assets: transforms=${result.assets.activeTransformFlights} L2=${result.assets.presentation?.bytes ?? 0} bytes thumbnails=${result.assets.thumbnails?.cachedBytes ?? 0} bytes`)
  const cache = result.cache
  writeLine(host, cache
    ? `Cache totals: memory=${cache.memory.totalBytes} disk=${cache.disk.totalBytes} leases=${cache.leases.total} (L2=${cache.leases.presentationMemory} L3=${cache.leases.presentationDisk} solid=${cache.leases.solidArchive} thumbnails=${cache.leases.thumbnailDemands})`
    : "Cache totals: unavailable")
  const pressure = result.assets.memoryPressure
  writeLine(host, pressure
    ? `Memory pressure: ${pressure.level} available=${pressure.availableBytes ?? "unknown"} reliefs=${pressure.elevatedReliefs}/${pressure.criticalReliefs} rejected=${pressure.admissionRejections}`
    : "Memory pressure: unavailable")
  const preload = result.reader.preload
  writeLine(host, preload
    ? `Preload: sessions=${preload.sessions} candidates=${preload.candidates.near}/${preload.candidates.ahead}/${preload.candidates.background} active=${preload.active} ready=${preload.ready} failed=${preload.failed} cancelled=${preload.cancelled} stale=${preload.staleReports}`
    : "Preload: unavailable")
  const preloadPerformance = preload?.performance
  writeLine(host, preloadPerformance && (preloadPerformance.ttfbSamples || preloadPerformance.decodeSamples)
    ? `Preload performance: ttfbAvg=${average(preloadPerformance.totalTtfbMs, preloadPerformance.ttfbSamples)}ms decodeAvg=${average(preloadPerformance.totalDecodeMs, preloadPerformance.decodeSamples)}ms retainedMax=${preloadPerformance.maxRetainedBytes} leaseMax=${preloadPerformance.maxActiveLeases}`
    : "Preload performance: unavailable")
  const resources = result.reader.runtimeResources
  writeLine(host, resources
    ? `Reader resources: archiveProviders=${resources.archiveProviders} indexEntries=${resources.archiveIndexEntries} indexBytes=${resources.archiveIndexPayloadBytes} activeExtractions=${resources.archiveActiveExtractions}`
    : "Reader resources: unavailable")
  writeLine(host, `Solid archive cache: entries=${result.solidArchiveCache.entries} bytes=${result.solidArchiveCache.retainedBytes}/${result.solidArchiveCache.maxBytes} memory=${result.solidArchiveCache.memoryBytes ?? 0}/${result.solidArchiveCache.maxMemoryBytes ?? 0} active=${result.solidArchiveCache.activeLeases ?? 0}`)
  writeLine(host, `Scheduler: ${result.scheduler ? `cpu=${schedulerPoolText(result.scheduler.cpu)} io=${schedulerPoolText(result.scheduler.io)} gpu=${schedulerPoolText(result.scheduler.gpu)}` : "unavailable in standalone CLI"}`)
}

function average(total: number, samples: number): string {
  return samples ? (total / samples).toFixed(1) : "n/a"
}

function schedulerPoolText(pool: ReaderSchedulerPoolDiagnostics): string {
  const wait = pool.queueWaitSamples && pool.totalQueueWaitMs !== undefined && pool.maxQueueWaitMs !== undefined
    ? ` waitAvg=${(pool.totalQueueWaitMs / pool.queueWaitSamples).toFixed(1)}ms waitMax=${pool.maxQueueWaitMs.toFixed(1)}ms`
    : ""
  const currentWait = pool.oldestQueuedWaitMs ? ` waitNow=${pool.oldestQueuedWaitMs.toFixed(1)}ms` : ""
  return `${pool.active}/${pool.queued}${wait}${currentWait}`
}

function cacheMaintenanceReason(value: string | undefined): "age" | "budget" | "explicit" {
  const reason = value ?? "age"
  if (reason !== "age" && reason !== "budget" && reason !== "explicit") {
    throw usage("--reason must be age, budget or explicit for presentation-cache-cleanup.")
  }
  return reason
}

function printPresentationCacheResult(
  result: Awaited<ReturnType<ReaderCacheService["status"]> | ReturnType<ReaderCacheService["cleanup"]>>
    | RemoteReaderPresentationCacheStatus
    | RemoteReaderPresentationCacheMaintenanceResult,
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
  const configPatch = readerDataConfigPatch(decoded)
  const preview = readerDataPreview(decoded, configPatch)
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
  let configChanged = false
  if (Object.keys(configPatch.configPatch).length) {
    try {
      const committed = await commitNeoviewConfig(configPatch.configPatch, {
        configPath: oneValue(parsed, "--config"),
        cwd: host.cwd,
        env: host.env,
        strategy: "merge",
      })
      configChanged = committed.changed
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Reader data was imported, but NeoView configuration was not migrated: ${detail}`, { cause: error })
    }
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

async function runLegacyBookSettingsMigrationCommand(
  command: string,
  inputPath: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const createController = dependencies.createBookSettingsMigrationFileController
    ?? createReaderBookSettingsMigrationFileController
  const controller = await createController()
  if (command === "book-settings-legacy-inspect") {
    const inspection = await controller.inspect(inputPath)
    printLegacyBookSettingsMigration(inspection.report, undefined, parsed.booleans.has("--json"), host)
    return
  }
  if (!parsed.booleans.has("--yes")) {
    throw usage("book-settings-legacy-import requires --yes after reviewing book-settings-legacy-inspect output.")
  }
  const strategy = oneValue(parsed, "--strategy") ?? "merge"
  if (strategy !== "merge" && strategy !== "overwrite") throw usage("--strategy must be merge or overwrite.")
  const databasePath = oneValue(parsed, "--database")
    ? resolve(host.cwd, oneValue(parsed, "--database")!)
    : undefined
  const imported = await controller.import(inputPath, databasePath, strategy, true)
  printLegacyBookSettingsMigration(imported.report, imported.result, parsed.booleans.has("--json"), host)
}

function printLegacyBookSettingsMigration(
  report: LegacyBookSettingsReport,
  result: LegacyBookSettingsImportResult | undefined,
  json: boolean,
  host: CliHost,
): void {
  if (json) {
    writeJson(host, result ? { report, result } : { report })
    return
  }
  writeLine(host, `Legacy book settings: valid=${report.validEntries}/${report.totalEntries} invalidEntries=${report.invalidEntries} invalidFields=${report.invalidFields} unknownFields=${report.unknownFields}`)
  if (result) {
    writeLine(host, `Imported: inserted=${result.applied.inserted} updated=${result.applied.updated} unchanged=${result.applied.unchanged} unresolved=${result.unresolvedSources} duplicateIdentities=${result.duplicateIdentities}`)
  }
}

async function runLibraryCommand(
  command: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const pathCommand = command === "library-bookmark-add" || command === "library-recent-cleanup-folder"
  if (pathCommand ? parsed.positionals.length !== 1 : parsed.positionals.length !== 0) {
    throw usage(pathCommand ? `${command} requires exactly one path.` : `${command} does not accept a path.`)
  }
  const destructive = command === "library-recent-delete"
    || command === "library-recent-cleanup"
    || command === "library-recent-cleanup-oldest"
    || command === "library-recent-cleanup-folder"
    || command === "library-recent-clear"
    || command === "library-invalid-cleanup"
    || command === "library-bookmark-delete"
    || command === "library-bookmark-batch-delete"
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
        readerDirectoryFilterOption(parsed),
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
    if (command === "library-recent-cleanup-oldest") {
      const limit = integerOption(parsed, "--limit", 1, 500, 100)
      const result = await controller.removeOldestRecents(limit)
      return printLibraryMutation({ ...result, limit }, json, host)
    }
    if (command === "library-recent-cleanup-folder") {
      const folderPath = resolve(host.cwd, parsed.positionals[0]!)
      const deleted = await controller.clearByFolder("recents", folderPath)
      return printLibraryMutation({ deleted, folderPath }, json, host)
    }
    if (command === "library-recent-clear") {
      const deleted = await controller.clearAll("recents")
      return printLibraryMutation({ deleted }, json, host)
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
        readerDirectoryFilterOption(parsed),
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
    if (command === "library-bookmark-batch-update") {
      const ids = requiredRepeatedValues(parsed, "--id", command, 500)
      const listIds = requiredRepeatedValues(parsed, "--list", command, 500)
      const result = await controller.updateBookmarks(ids.map((id) => ({ id, listIds })))
      return printLibraryMutation(result as unknown as Record<string, unknown>, json, host)
    }
    if (command === "library-bookmark-batch-delete") {
      const ids = requiredRepeatedValues(parsed, "--id", command, 500)
      const result = await controller.removeBookmarks(ids)
      return printLibraryMutation(result as unknown as Record<string, unknown>, json, host)
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

async function runExplorerContextMenuCommand(
  command: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (parsed.positionals.length) throw usage(`${command} does not accept paths.`)
  const mutating = command === "explorer-context-menu-enable" || command === "explorer-context-menu-disable"
  if (mutating && !parsed.booleans.has("--yes")) throw usage(`${command} requires --yes.`)
  const createService = dependencies.createSystemIntegrationService ?? (async () => {
    const { createReaderSystemIntegrationService } = await import("./platform.js")
    return createReaderSystemIntegrationService()
  })
  const service = await createService()
  const result = command === "explorer-context-menu-preview"
    ? await service.explorerContextMenuPreview()
    : command === "explorer-context-menu-status"
      ? await service.explorerContextMenuStatus()
      : await service.explorerContextMenuSetEnabled(command === "explorer-context-menu-enable")
  if (parsed.booleans.has("--json")) writeJson(host, result)
  else writeLine(host, JSON.stringify(result))
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

function readerDataPreview(
  decoded: import("./migration/LegacyReaderDataCodec.js").DecodedLegacyReaderData,
  config: ReturnType<typeof readerDataConfigPatch> = readerDataConfigPatch(decoded),
) {
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
    configPatch: config.configPatch,
    ...(config.activeBookmarkListOmitted ? { activeBookmarkListOmitted: true } : {}),
  }
}

function readerDataConfigPatch(decoded: import("./migration/LegacyReaderDataCodec.js").DecodedLegacyReaderData): {
  configPatch: Record<string, unknown>
  activeBookmarkListOmitted: boolean
} {
  const settings = decoded.historySettings
  const history = {
    ...(settings?.syncFileTreeOnHistorySelect !== undefined ? { sync_file_tree_on_history_select: settings.syncFileTreeOnHistorySelect } : {}),
    ...(settings?.syncFileTreeOnBookmarkSelect !== undefined ? { sync_file_tree_on_bookmark_select: settings.syncFileTreeOnBookmarkSelect } : {}),
    ...(settings?.maxHistorySize !== undefined ? { max_history_size: settings.maxHistorySize } : {}),
    ...(settings?.maxBookmarkSize !== undefined ? { max_bookmark_size: settings.maxBookmarkSize } : {}),
  }
  const activeList = resolvedActiveBookmarkListId(decoded)
  return {
    configPatch: {
      ...(Object.keys(history).length ? { history } : {}),
      ...(activeList.id ? activeList.tomlPatch : {}),
    },
    activeBookmarkListOmitted: activeList.omitted,
  }
}

function resolvedActiveBookmarkListId(decoded: import("./migration/LegacyReaderDataCodec.js").DecodedLegacyReaderData): {
  id?: string
  tomlPatch?: Record<string, unknown>
  omitted: boolean
} {
  if (!decoded.activeBookmarkListId) return { omitted: false }
  try {
    const parsed = parseNeoviewBookmarkListPatch({ bookmarkList: { activeListId: decoded.activeBookmarkListId } })
    const activeListId = parsed.patch.bookmarkList.activeListId
    const isSystem = activeListId === "all" || activeListId === "default" || activeListId === "favorites"
    if (!isSystem && !decoded.bookmarkLists.some((list) => list.id === activeListId)) return { omitted: true }
    return { id: activeListId, tomlPatch: parsed.tomlPatch, omitted: false }
  } catch {
    return { omitted: true }
  }
}

function printReaderDataPreview(preview: ReturnType<typeof readerDataPreview>, host: CliHost): void {
  writeLine(host, `Legacy reader data: ${preview.sourceKind}`)
  writeLine(host, `Rows: history=${preview.counts.history} bookmarks=${preview.counts.bookmarks} lists=${preview.counts.bookmarkLists}`)
  writeLine(host, `Migration metadata: pathStacks=${preview.counts.pathStacks} videoProgress=${preview.counts.videoProgress}`)
  if (preview.activeBookmarkListOmitted) writeLine(host, "Active bookmark-list selection was omitted because it is invalid or unavailable in imported data.")
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
  const connect = oneValue(parsed, "--connect")
  const tokenVariable = oneValue(parsed, "--token-env")
  if (!connect && tokenVariable) throw usage("--token-env requires --connect.")
  if (connect) {
    if (path) throw usage(`${command} does not accept a database path with --connect because the running backend owns its writer.`)
    return await runRemoteThumbnailMaintenanceCommand(plan, connect, tokenVariable, parsed, host, dependencies)
  }
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
    if (plan.kind === "path-prefix") {
      const result = await service.cleanup(plan)
      if (!result.enabled || result.kind !== "path-prefix") throw new Error("Path-prefix thumbnail cleanup is unavailable.")
      return printMaintenanceResult({ operation: result.kind, prefix: result.prefix, deleted: result.deleted }, parsed.booleans.has("--json"), host)
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

async function runRemoteThumbnailMaintenanceCommand(
  plan: ThumbnailMaintenancePlan,
  baseUrl: string,
  tokenVariable: string | undefined,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const options = { baseUrl, token: connectionToken(tokenVariable, host) }
  if (plan.kind === "stats") {
    const fetchStatus = dependencies.fetchRemoteThumbnailMaintenance ?? (async (remoteOptions: typeof options) => {
      const { fetchRemoteReaderThumbnailMaintenance } = await import("./platform/remote/RemoteReaderHeadlessController.js")
      return fetchRemoteReaderThumbnailMaintenance(remoteOptions)
    })
    printThumbnailStats(await fetchStatus(options), parsed.booleans.has("--json"), host)
    return
  }
  if (plan.kind === "clear-failures") {
    const clearFailures = dependencies.clearRemoteThumbnailFailures ?? (async (
      remoteOptions: typeof options,
      request: { reason?: string; limit: number },
    ) => {
      const { clearRemoteReaderThumbnailFailures } = await import("./platform/remote/RemoteReaderHeadlessController.js")
      return clearRemoteReaderThumbnailFailures(remoteOptions, request)
    })
    return printMaintenanceResult({
      operation: plan.kind,
      deleted: await clearFailures(options, { reason: plan.reason, limit: plan.limit }),
    }, parsed.booleans.has("--json"), host)
  }
  const cleanup = dependencies.cleanupRemoteThumbnails ?? (async (
    remoteOptions: typeof options,
    command: RemoteReaderThumbnailCleanupCommand,
  ) => {
    const { cleanupRemoteReaderThumbnails } = await import("./platform/remote/RemoteReaderHeadlessController.js")
    return cleanupRemoteReaderThumbnails(remoteOptions, command)
  })
  const command: RemoteReaderThumbnailCleanupCommand = plan.kind === "invalid"
    ? { kind: plan.kind, scanLimit: plan.scanLimit, deleteLimit: plan.limit }
    : plan
  const result = await cleanup(options, command)
  if (result.kind === "invalid") {
    return printMaintenanceResult({ operation: result.kind, scanned: result.scanned, deleted: result.deleted, unavailableVolumeRowsPreserved: result.unavailableVolumeRowsPreserved, wrapped: result.wrapped }, parsed.booleans.has("--json"), host)
  }
  if (result.kind === "path-prefix") {
    return printMaintenanceResult({ operation: result.kind, prefix: result.prefix, deleted: result.deleted }, parsed.booleans.has("--json"), host)
  }
  return printMaintenanceResult(
    result.kind === "expired"
      ? { operation: result.kind, deleted: result.deleted, cutoff: result.cutoff, foldersPreserved: true }
      : { operation: result.kind, deleted: result.deleted },
    parsed.booleans.has("--json"),
    host,
  )
}

async function runThumbnailDatabaseMergePlan(
  canonicalPath: string | undefined,
  parsed: ParsedArguments,
  host: CliHost,
): Promise<void> {
  const source = oneValue(parsed, "--source")
  if (!source) throw usage("thumbnail-db-merge-plan requires --source <secondary.db>.")
  const target = await resolveThumbnailDatabasePath(canonicalPath, host)
  const { LegacyThumbnailDatabaseMergePlanner } = await import("./platform/thumbnails/LegacyThumbnailDatabaseMergePlanner.js")
  const plan = await new LegacyThumbnailDatabaseMergePlanner().plan(target, resolve(host.cwd, source))
  if (parsed.booleans.has("--json")) {
    writeJson(host, plan)
    return
  }
  if (!plan.eligible || !plan.statistics) {
    writeLine(host, `Thumbnail database merge is not eligible: ${plan.reasons.join(" ")}`)
    return
  }
  const thumbnails = plan.statistics.thumbnails
  const failures = plan.statistics.failures
  writeLine(host, `Thumbnails: canonical=${thumbnails.canonicalRows} secondary=${thumbnails.secondaryRows} conflicts=${thumbnails.conflicts} secondary-only=${thumbnails.secondaryOnly}`)
  writeLine(host, `Conflict winners: secondary=${thumbnails.secondaryThumbnailWins} canonical=${thumbnails.canonicalThumbnailWins}; metadata fills=${Object.values(thumbnails.fieldsFilledFromSecondary).reduce((sum, value) => sum + value, 0)}`)
  writeLine(host, `Failures: canonical=${failures.canonicalRows} secondary=${failures.secondaryRows} conflicts=${failures.conflicts} secondary-only=${failures.secondaryOnly}`)
}

async function runThumbnailDatabaseMergeSecondary(
  canonicalPath: string | undefined,
  parsed: ParsedArguments,
  host: CliHost,
): Promise<void> {
  if (!parsed.booleans.has("--yes") || !parsed.booleans.has("--offline")) {
    throw usage("thumbnail-db-merge-secondary requires --offline and --yes after closing NeoView and Xiranite database users.")
  }
  const source = oneValue(parsed, "--source")
  const backup = oneValue(parsed, "--backup")
  if (!source) throw usage("thumbnail-db-merge-secondary requires --source <secondary.db>.")
  if (!backup) throw usage("thumbnail-db-merge-secondary requires --backup <canonical-backup.db>.")
  const target = await resolveThumbnailDatabasePath(canonicalPath, host)
  const { LegacyThumbnailDatabaseMergeService } = await import("./platform/thumbnails/LegacyThumbnailDatabaseMergeService.js")
  const result = await new LegacyThumbnailDatabaseMergeService().merge({
    canonicalPath: target,
    secondaryPath: resolve(host.cwd, source),
    backupPath: resolve(host.cwd, backup),
  })
  if (parsed.booleans.has("--json")) {
    writeJson(host, result)
    return
  }
  const thumbnails = result.plan.statistics?.thumbnails
  writeLine(host, `Thumbnail databases merged: ${thumbnails?.secondaryOnly ?? 0} secondary-only rows, ${thumbnails?.conflicts ?? 0} conflicts.`)
  writeLine(host, `Verified backup: ${result.backup.destinationPath} (${result.backup.bytes} bytes).`)
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
  | { kind: "path-prefix"; prefix: string; limit: number }

function thumbnailMaintenancePlan(command: string, parsed: ParsedArguments): ThumbnailMaintenancePlan {
  if (command === "thumbnail-db-stats") return { kind: "stats" }
  if (command === "thumbnail-db-clear-failures") {
    const limit = integerOption(parsed, "--limit", 1, 1_000, 500)
    const reason = oneValue(parsed, "--reason")
    if (reason !== undefined && (!reason || reason.length > 128)) throw usage("--reason must be 1..128 characters.")
    return { kind: "clear-failures", reason, limit }
  }
  const kind = oneValue(parsed, "--kind")
  if (kind !== "empty" && kind !== "expired" && kind !== "invalid" && kind !== "path-prefix") {
    throw usage("thumbnail-db-cleanup requires --kind empty|expired|invalid|path-prefix.")
  }
  if (kind === "invalid") {
    if (parsed.values.has("--days")) throw usage("--days is only valid with --kind expired.")
    if (parsed.values.has("--prefix")) throw usage("--prefix is only valid with --kind path-prefix.")
    const limit = integerOption(parsed, "--limit", 1, 500, 500)
    return { kind, limit, scanLimit: integerOption(parsed, "--scan-limit", 1, 2_000, 500) }
  }
  if (kind === "path-prefix") {
    if (parsed.values.has("--days") || parsed.values.has("--scan-limit")) {
      throw usage("--days and --scan-limit are only valid with their corresponding cleanup kinds.")
    }
    const prefix = oneValue(parsed, "--prefix")
    if (!prefix?.trim()) throw usage("thumbnail-db-cleanup --kind path-prefix requires --prefix <path>.")
    return { kind, prefix, limit: integerOption(parsed, "--limit", 1, 10_000, 500) }
  }
  const limit = integerOption(parsed, "--limit", 1, 1_000, 500)
  if (parsed.values.has("--scan-limit")) throw usage("--scan-limit is only valid with --kind invalid.")
  if (parsed.values.has("--prefix")) throw usage("--prefix is only valid with --kind path-prefix.")
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

function parseArguments(args: readonly string[], command?: string): ParsedArguments {
  const parsed: ParsedArguments = { positionals: [], values: new Map(), booleans: new Set() }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (!arg.startsWith("-")) {
      parsed.positionals.push(arg)
      continue
    }
    if (BOOLEAN_FLAGS.has(arg) && !(command === "book-settings-set" && arg === "--favorite")) {
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

function connectionToken(variable: string | undefined, host: CliHost): string {
  const name = variable ?? "XIRANITE_BACKEND_TOKEN"
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw usage(`Invalid backend token environment variable name: ${name}`)
  const token = host.env[name]?.trim()
  if (!token) throw usage(`Backend token environment variable is missing or empty: ${name}`)
  return token
}

function printInspect(snapshot: HeadlessReaderSnapshot, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, snapshot)
  const book = projectReaderBookInformation({
    ...snapshot.book,
    currentPage: snapshot.book.pageCount > 0 ? snapshot.frame.anchorPageIndex + 1 : 0,
  }, "en")
  writeLine(host, `Title: ${book.displayTitle}`)
  if (book.originalTitle) writeLine(host, `Original title: ${book.originalTitle}`)
  writeLine(host, `Type: ${book.typeLabel}`)
  writeLine(host, `Page: ${book.pageText}`)
  writeLine(host, `Progress: ${book.progressText}`)
  writeLine(host, frameLine(snapshot))
  for (const page of snapshot.visiblePages) {
    writeLine(host, pageLine(page))
    printPageTime(page, host)
  }
}

function printFrame(snapshot: HeadlessReaderSnapshot, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, { frame: snapshot.frame, visiblePages: snapshot.visiblePages })
  writeLine(host, frameLine(snapshot))
  for (const page of snapshot.visiblePages) {
    writeLine(host, pageLine(page))
    printPageTime(page, host)
  }
}

function printPages(pages: readonly HeadlessReaderPageSnapshot[], cursor: number, total: number, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, { pages, cursor, nextCursor: cursor + pages.length < total ? cursor + pages.length : undefined, total })
  for (const page of pages) writeLine(host, pageLine(page))
  writeLine(host, `${pages.length} of ${total} page(s)`)
}

function printBookSettings(settings: ReaderBookSettingsSnapshot, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, settings)
  writeLine(host, `Book settings revision ${settings.revision}`)
  for (const key of ["favorite", "rating", "direction", "pageMode", "horizontalBook"] as const) {
    const inherited = settings.inherited.includes(key)
    writeLine(host, `${key}: ${String(settings.effective[key])} (${inherited ? "inherited" : "override"})`)
  }
}

function printBookSettingsUpdate(result: HeadlessReaderBookSettingsUpdate, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, result)
  printBookSettings(result.settings, false, host)
  writeLine(host, frameLine(result.reader))
}

function printSuperResolutionResult(result: HeadlessSuperResolutionPageResult, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, result)
  if (!result.result) {
    writeLine(host, `Super-resolution ${result.decision.kind}: ${result.decision.reason}`)
    return
  }
  writeLine(host, `Super-resolution complete: ${result.result.destinationPath}`)
  writeLine(host, `Model: ${result.result.modelId} (${result.result.engine}, ${result.result.scale}x)`)
  if (result.result.width && result.result.height) writeLine(host, `Size: ${result.result.width}x${result.result.height}`)
  writeLine(host, `Elapsed: ${result.result.elapsedMs.toFixed(2)} ms`)
}

function requiredRepeatedValues(parsed: ParsedArguments, option: string, command: string, maximum: number): string[] {
  const values = (parsed.values.get(option) ?? []).map((value) => value.trim())
  if (!values.length || values.some((value) => !value)) throw usage(`${command} requires at least one ${option} <value>.`)
  if (values.length > maximum) throw usage(`${option} can be specified at most ${maximum} times.`)
  return values
}

function printUpscalePreloadSnapshots(
  snapshots: readonly RemoteSuperResolutionPreloadSnapshot[],
  json: boolean,
  host: CliHost,
): void {
  if (json) return writeJson(host, { snapshots })
  if (!snapshots.length) {
    writeLine(host, "No super-resolution preload activity.")
    return
  }
  for (const snapshot of snapshots) {
    writeLine(host, `${snapshot.mode}: ${snapshot.state} ${snapshot.settled}/${snapshot.planned} (${Math.round(snapshot.progress * 100)}%) failed=${snapshot.failed} cancelled=${snapshot.cancelled}`)
  }
}

function upscalePreloadMode(value: string | undefined): RemoteSuperResolutionPreloadMode {
  if (value === "nearby" || value === "progressive") return value
  throw usage("--mode must be nearby or progressive.")
}

function missingUpscalePreloadCapability(): Error {
  return new Error("Reader super-resolution preload control is unavailable for this transport.")
}

function upscaleArtifactCacheCleanupKind(value: string | undefined): RemoteSuperResolutionArtifactCacheCleanupKind {
  if (value === "age" || value === "book" || value === "all") return value
  throw usage("--kind must be age, book or all.")
}

function missingUpscaleArtifactCacheCapability(): Error {
  return new Error("Reader super-resolution artifact cache maintenance is unavailable for this transport.")
}

function printUpscaleArtifactCache(
  snapshot: RemoteSuperResolutionArtifactCacheSnapshot | RemoteSuperResolutionArtifactCacheCleanupResult,
  json: boolean,
  host: CliHost,
): void {
  if (json) return writeJson(host, snapshot)
  writeLine(host, `Upscale artifact cache: ${snapshot.entries} entries, ${snapshot.bytes}/${snapshot.maxBytes} bytes, active leases=${snapshot.activeLeases}`)
  if ("removedEntries" in snapshot) {
    writeLine(host, `Removed: ${snapshot.removedEntries} entries, ${snapshot.removedBytes} bytes (${snapshot.reason})`)
  }
}

async function runSuperResolutionCapabilities(
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const controller = await dependencies.createController({
    configPath: oneValue(parsed, "--config"),
    cwd: host.cwd,
    env: host.env,
    progressStore: false,
    legacyThumbnailDatabasePath: false,
  })
  try {
    if (!controller.inspectSuperResolution) throw new Error("Reader super-resolution inspection is unavailable.")
    const result = await controller.inspectSuperResolution({ refresh: parsed.booleans.has("--refresh") })
    if (parsed.booleans.has("--json")) return writeJson(host, result)
    if (!result.available) {
      writeLine(host, `Super-resolution unavailable: ${result.reason}`)
      return
    }
    for (const engine of result.engines) {
      writeLine(host, `${engine.engine}: ${engine.available ? engine.version ?? "available" : engine.reason ?? "unavailable"}`)
    }
    writeLine(host, `${result.models.length} model(s)`)
  } finally {
    await controller[Symbol.asyncDispose]()
  }
}

async function assertOutputAvailable(path: string, force: boolean): Promise<void> {
  if (force) return
  try {
    await stat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  throw usage(`Output already exists: ${path}. Use --force to replace it.`)
}

function bookSettingsPatch(parsed: ParsedArguments): ReaderBookSettingsPatch {
  const patch: ReaderBookSettingsPatch = {}
  const favorite = inheritedBooleanOption(parsed, "--favorite")
  const horizontalBook = inheritedBooleanOption(parsed, "--horizontal-book")
  const rating = inheritedRatingOption(parsed)
  const direction = inheritedEnumOption(parsed, "--direction", ["left-to-right", "right-to-left"] as const)
  const pageMode = inheritedEnumOption(parsed, "--page-mode", ["single", "double"] as const)
  if (favorite !== undefined) patch.favorite = favorite
  if (rating !== undefined) patch.rating = rating
  if (direction !== undefined) patch.direction = direction
  if (pageMode !== undefined) patch.pageMode = pageMode
  if (horizontalBook !== undefined) patch.horizontalBook = horizontalBook
  if (!Object.keys(patch).length) {
    throw usage("book-settings-set requires at least one setting option.")
  }
  return patch
}

function inheritedBooleanOption(parsed: ParsedArguments, flag: string): boolean | null | undefined {
  const value = oneValue(parsed, flag)
  if (value === undefined) return undefined
  if (value === "inherit") return null
  if (value === "true") return true
  if (value === "false") return false
  throw usage(`${flag} must be true, false or inherit.`)
}

function inheritedRatingOption(parsed: ParsedArguments): number | null | undefined {
  const value = oneValue(parsed, "--rating")
  if (value === undefined) return undefined
  if (value === "inherit") return null
  const rating = Number(value)
  if (!Number.isSafeInteger(rating) || rating < 1 || rating > 5) throw usage("--rating must be 1..5 or inherit.")
  return rating
}

function inheritedEnumOption<T extends string>(
  parsed: ParsedArguments,
  flag: string,
  allowed: readonly T[],
): T | null | undefined {
  const value = oneValue(parsed, flag)
  if (value === undefined) return undefined
  if (value === "inherit") return null
  if (allowed.includes(value as T)) return value as T
  throw usage(`${flag} must be ${allowed.join(", ")} or inherit.`)
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

function printPageTime(page: HeadlessReaderPageSnapshot, host: CliHost): void {
  const time = projectReaderTimeInformation(page.timestamps, "en")
  writeLine(host, `  Created: ${time.createdText}`)
  writeLine(host, `  Modified: ${time.modifiedText}`)
  writeLine(host, `  Accessed: ${time.accessedText}`)
  writeLine(host, `  Time source: ${time.sourceLabel}`)
}

async function extractPage(
  controller: Pick<CliReaderController, "openPageStream">,
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

async function writeSubtitle(bytes: Uint8Array, output: string, force: boolean, host: CliHost): Promise<void> {
  if (output === "-") {
    host.stdout.write(bytes as unknown as string)
    return
  }
  const outputPath = resolve(host.cwd, output)
  await assertOutputAvailable(outputPath, force)
  const handle = await open(outputPath, force ? "w" : "wx")
  let complete = false
  try {
    await handle.writeFile(bytes)
    complete = true
  } finally {
    await handle.close().catch(() => undefined)
    if (!complete) await rm(outputPath, { force: true }).catch(() => undefined)
  }
}

function printSubtitleTracks(
  tracks: readonly import("./application/reader/ReaderSubtitleService.js").ReaderSubtitleTrack[],
  json: boolean,
  host: CliHost,
): void {
  if (json) {
    writeJson(host, { tracks })
    return
  }
  if (!tracks.length) {
    writeLine(host, "No matching subtitle tracks.")
    return
  }
  for (const track of tracks) writeLine(host, `${track.id}\t${track.format}\t${track.name}\t${track.contentVersion}`)
}

function printMediaProgress(progress: ReaderMediaProgressRecord | undefined, json: boolean, host: CliHost): void {
  if (json) {
    writeJson(host, { progress: progress ?? null })
    return
  }
  if (!progress) {
    writeLine(host, "No saved media progress.")
    return
  }
  writeLine(host, `Media progress: ${progress.position}/${progress.duration} completed=${progress.completed} updatedAt=${progress.updatedAt}`)
}

function parseEmmMetadataPatchCli(value: string | undefined, cwd: string): ReaderEmmMetadataPatch {
  if (!value) throw usage("emm-set requires --input <patch.json|inline-json>.")
  const raw = value.trim().startsWith("{") ? value : requireCliJson(value, cwd)
  try {
    return ReaderEmmMetadataPatchSchema.parse(JSON.parse(raw))
  } catch (error) {
    throw usage(`Invalid EMM metadata patch: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function printEmmMetadata(metadata: ReaderEmmMetadataSnapshot, json: boolean, host: CliHost): void {
  if (json) {
    writeJson(host, metadata)
    return
  }
  writeLine(host, `EMM metadata revision ${metadata.revision}.`)
  writeLine(host, `rating=${metadata.overrides.rating ?? "inherited"} translatedTitle=${metadata.overrides.translatedTitle ?? "inherited"}`)
  writeLine(host, `manualTags=${metadata.overrides.manualTags?.map((tag) => `${tag.namespace}:${tag.tag}`).join(",") ?? "inherited"}`)
}

async function writeBinaryStdout(stream: ReadableStream<Uint8Array>, host: CliHost): Promise<void> {
  const output = host.stdout as CliHost["stdout"] & { once?: (event: "drain", listener: () => void) => unknown }
  for await (const chunk of stream) {
    const ready = output.write(chunk as unknown as string)
    if (ready === false && output.once) await new Promise<void>((resolveDrain) => output.once!("drain", resolveDrain))
  }
}

async function runInputBindingsCommand(
  command: string,
  parsed: ParsedArguments,
  host: CliHost,
): Promise<void> {
  const { ReaderInputBindingsConfigService } = await import("./platform/config/ReaderInputBindingsConfigService.js")
  const service = new ReaderInputBindingsConfigService({ configPath: oneValue(parsed, "--config"), cwd: host.cwd, env: host.env })
  if (command === "input-bindings-list") {
    if (parsed.positionals.length) throw usage("input-bindings-list does not accept a JSON path.")
    const config = await service.inspect()
    if (parsed.booleans.has("--json")) writeJson(host, config)
    else {
      writeLine(host, `${config.bindings.length} input binding(s).`)
      for (const binding of config.bindings) writeLine(host, JSON.stringify(binding))
    }
    return
  }
  if (!parsed.booleans.has("--yes")) throw usage(`${command} requires --yes after reviewing the current bindings.`)
  if (command === "input-bindings-reset") {
    if (parsed.positionals.length) throw usage("input-bindings-reset does not accept a JSON path.")
    const result = await service.reset(true)
    if (parsed.booleans.has("--json")) writeJson(host, result)
    else writeLine(host, result.changed ? `Input bindings reset: ${result.configPath}` : "Input bindings already use defaults.")
    return
  }
  if (parsed.positionals.length !== 1) throw usage("input-bindings-apply requires exactly one bindings JSON path.")
  const inputPath = resolve(host.cwd, parsed.positionals[0]!)
  const inputStat = await stat(inputPath)
  if (!inputStat.isFile()) throw usage(`Input bindings JSON is not a file: ${inputPath}`)
  if (inputStat.size > MAX_INPUT_BINDINGS_BYTES) throw usage(`Input bindings JSON exceeds ${MAX_INPUT_BINDINGS_BYTES} bytes.`)
  const bindings = inputBindingsPayload(JSON.parse(await readFile(inputPath, "utf8")) as unknown)
  const result = await service.apply(bindings, true)
  if (parsed.booleans.has("--json")) writeJson(host, result)
  else writeLine(host, result.changed ? `Input bindings updated: ${result.configPath}` : "Input bindings unchanged.")
}

function inputBindingsPayload(value: unknown): ReaderInputBinding[] {
  const bindings = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { bindings?: unknown }).bindings)
      ? (value as { bindings: unknown[] }).bindings
      : undefined
  if (!bindings) throw usage("Input bindings JSON must be an array or { bindings: [...] }.")
  return bindings as ReaderInputBinding[]
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
  if (command === "settings-portable-inspect" || command === "settings-portable-import") {
    await runPortableSettingsCommand(command, content, parsed, host)
    return
  }
  const moduleOption = oneValue(parsed, "--modules")
  const modules = moduleOption?.split(",").map((value) => value.trim()).filter(Boolean)
  if (modules?.length === 0) throw usage("--modules requires at least one module name.")
  const configPath = oneValue(parsed, "--config")
  const service = await createReaderSettingsMigrationService({ configPath, cwd: host.cwd, env: host.env })
  let decoded: import("./migration/LegacySettingsCodec.js").DecodedLegacySettings
  try {
    decoded = service.inspect({ content, modules })
  } catch (error) {
    throw usage(error instanceof Error ? error.message : String(error))
  }

  if (command === "settings-inspect") {
    printSettingsPreview(decoded, parsed.booleans.has("--json"), host)
    return
  }

  if (!parsed.booleans.has("--yes")) {
    throw usage("settings-import requires --yes after reviewing settings-inspect output.")
  }
  const strategy = oneValue(parsed, "--strategy") ?? "merge"
  if (strategy !== "merge" && strategy !== "overwrite") throw usage("--strategy must be merge or overwrite.")
  const committed = await service.commit(decoded, strategy, true)
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

async function runPortableSettingsExport(parsed: ParsedArguments, host: CliHost): Promise<void> {
  const output = oneValue(parsed, "--output")
  if (!output) throw usage("settings-export requires --output <path|->.")
  const service = await createReaderSettingsPortableService({
    configPath: oneValue(parsed, "--config"),
    cwd: host.cwd,
    env: host.env,
  })
  const content = `${JSON.stringify(await service.export(), null, 2)}\n`
  if (output === "-") {
    host.stdout.write(content)
    return
  }
  const outputPath = resolve(host.cwd, output)
  await writeTextExclusive(outputPath, content, parsed.booleans.has("--force"))
  writeLine(host, `NeoView settings exported: ${outputPath}`)
}

async function runSettingsBackup(
  destination: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (!parsed.booleans.has("--yes")) throw usage("settings-backup requires --yes after choosing a new destination directory.")
  const service = await (dependencies.createBackupBundleService ?? createReaderBackupBundleService)({
    configPath: oneValue(parsed, "--config"),
    thumbnailDatabasePath: oneValue(parsed, "--database"),
    cwd: host.cwd,
    env: host.env,
  })
  const result = await service.create(destination)
  const output = {
    created: true,
    format: result.manifest.format,
    version: result.manifest.version,
    createdAt: result.manifest.createdAt,
    settingsBytes: result.manifest.settings.bytes,
    databaseBytes: result.manifest.database.bytes,
    databaseQuickCheck: result.manifest.database.quickCheck,
  }
  if (parsed.booleans.has("--json")) writeJson(host, output)
  else writeLine(host, `NeoView backup created: ${destination} (${output.settingsBytes + output.databaseBytes} bytes)`)
}

async function runSettingsBackupScheduled(
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (!parsed.booleans.has("--yes")) throw usage("settings-backup-scheduled requires --yes because it creates and prunes automatic backup bundles.")
  const options = { configPath: oneValue(parsed, "--config"), cwd: host.cwd, env: host.env }
  const schedule = await loadReaderBackupScheduleConfig(options)
  if (!schedule.enabled) {
    const output = { status: "disabled" as const }
    if (parsed.booleans.has("--json")) writeJson(host, output)
    else writeLine(host, "Automatic NeoView backups are disabled.")
    return
  }
  const service = await (dependencies.createBackupBundleService ?? createReaderBackupBundleService)({
    ...options,
    thumbnailDatabasePath: oneValue(parsed, "--database"),
  })
  const result = await new ReaderBackupScheduleRunner(schedule, service).runIfDue()
  if (parsed.booleans.has("--json")) {
    writeJson(host, result)
    return
  }
  if (result.status === "created") {
    writeLine(host, `Automatic NeoView backup created (${result.pruned} old bundle(s) pruned).`)
    return
  }
  if (result.status === "not-due") {
    writeLine(host, `Automatic NeoView backup is not due until ${new Date(result.dueAt).toISOString()}.`)
    return
  }
  writeLine(host, "Automatic NeoView backup skipped because another scheduled run holds the lock.")
}

async function runSettingsBackupRead(
  command: string,
  bundle: string,
  parsed: ParsedArguments,
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  const service = await (dependencies.createBackupBundleService ?? createReaderBackupBundleService)({
    configPath: oneValue(parsed, "--config"),
    thumbnailDatabasePath: oneValue(parsed, "--database"),
    cwd: host.cwd,
    env: host.env,
  })
  if (command === "settings-backup-inspect") {
    const inspected = await service.inspect(bundle)
    const output = backupInspectionSummary(inspected)
    if (parsed.booleans.has("--json")) writeJson(host, output)
    else writeLine(host, `NeoView backup verified: ${output.settingsBytes + output.databaseBytes} bytes, quick_check=${output.databaseQuickCheck}`)
    return
  }
  if (!parsed.booleans.has("--offline") || !parsed.booleans.has("--yes")) {
    throw usage("settings-backup-restore requires --offline and --yes after stopping all NeoView/Xiranite database users.")
  }
  const quarantine = oneValue(parsed, "--quarantine")
  if (!quarantine) throw usage("settings-backup-restore requires --quarantine <path>.")
  const restored = await service.restore(bundle, { quarantinePath: resolve(host.cwd, quarantine) })
  const output = {
    restored: true,
    format: restored.manifest.format,
    version: restored.manifest.version,
    settingsChanged: restored.settingsChanged,
    databaseQuickCheck: restored.database.quickCheck,
    originalQuarantined: true,
  }
  if (parsed.booleans.has("--json")) writeJson(host, output)
  else writeLine(host, `NeoView backup restored; original database quarantined, quick_check=${output.databaseQuickCheck}.`)
}

function backupInspectionSummary(inspected: ReaderBackupInspection) {
  return {
    valid: true,
    format: inspected.manifest.format,
    version: inspected.manifest.version,
    createdAt: inspected.manifest.createdAt,
    settingsBytes: inspected.manifest.settings.bytes,
    databaseBytes: inspected.manifest.database.bytes,
    databaseCompatibility: inspected.database.compatibility,
    databaseQuickCheck: inspected.database.quickCheck,
    omittedSensitivePaths: inspected.settings.omittedSensitivePaths,
  }
}

async function runPortableSettingsCommand(
  command: string,
  content: string,
  parsed: ParsedArguments,
  host: CliHost,
): Promise<void> {
  const service = await createReaderSettingsPortableService({
    configPath: oneValue(parsed, "--config"),
    cwd: host.cwd,
    env: host.env,
  })
  const payload = service.inspect(content)
  if (command === "settings-portable-inspect") {
    if (parsed.booleans.has("--json")) writeJson(host, payload)
    else writeLine(host, `Portable NeoView settings v${payload.version}: ${Object.keys(payload.nodeConfig).length} root field(s), ${payload.omittedSensitivePaths.length} sensitive field(s) omitted.`)
    return
  }
  if (!parsed.booleans.has("--yes")) throw usage("settings-portable-import requires --yes after inspection.")
  const strategy = oneValue(parsed, "--strategy") ?? "merge"
  if (strategy !== "merge" && strategy !== "overwrite") throw usage("--strategy must be merge or overwrite.")
  const result = await service.import(content, strategy, true)
  const output = { format: payload.format, version: payload.version, strategy, changed: result.changed, backupCreated: result.backupCreated }
  if (parsed.booleans.has("--json")) writeJson(host, output)
  else writeLine(host, `Portable NeoView settings ${result.changed ? "imported" : "already up to date"}.`)
}

async function writeTextExclusive(path: string, content: string, force: boolean): Promise<void> {
  const handle = await open(path, force ? "w" : "wx")
  let complete = false
  try {
    await handle.writeFile(content, "utf8")
    complete = true
  } finally {
    await handle.close().catch(() => undefined)
    if (!complete) await rm(path, { force: true }).catch(() => undefined)
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

function optionalIntegerOption(parsed: ParsedArguments, flag: string, minimum: number, maximum: number): number | undefined {
  const value = oneValue(parsed, flag)
  if (value === undefined) return undefined
  const parsedValue = Number(value)
  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    throw usage(`${flag} must be an integer from ${minimum} to ${maximum}.`)
  }
  return parsedValue
}

function requiredIntegerOption(parsed: ParsedArguments, flag: string, minimum: number, maximum: number): number {
  if (!parsed.values.has(flag)) throw usage(`${flag} is required.`)
  return integerOption(parsed, flag, minimum, maximum, minimum)
}

function requiredFiniteNumberOption(parsed: ParsedArguments, flag: string): number {
  const value = oneValue(parsed, flag)
  if (value === undefined) throw usage(`${flag} is required.`)
  const parsedValue = Number(value)
  if (!Number.isFinite(parsedValue)) throw usage(`${flag} must be a finite number.`)
  return parsedValue
}

function requiredBooleanOption(parsed: ParsedArguments, flag: string): boolean {
  const value = oneValue(parsed, flag)
  if (value === undefined) throw usage(`${flag} is required.`)
  if (value === "true") return true
  if (value === "false") return false
  throw usage(`${flag} must be true or false.`)
}

function oneValue(parsed: ParsedArguments, flag: string): string | undefined {
  const values = parsed.values.get(flag)
  if (!values?.length) return undefined
  if (values.length > 1) throw usage(`${flag} can only be specified once.`)
  return values[0]
}

function inputActionOption(parsed: ParsedArguments): ReaderInputAction {
  const value = oneValue(parsed, "--action")
  if (!value) throw usage("input-action-dispatch requires --action <id>.")
  if (READER_INPUT_ACTIONS.includes(value as ReaderInputAction)) return value as ReaderInputAction
  const converted = readerInputActionFromLegacyId(value)
  if (converted) return converted
  throw usage(`Unknown Reader input action: ${value}`)
}

function readerDirectoryFilterOption(parsed: ParsedArguments): ReaderDirectoryFilter {
  const filter = oneValue(parsed, "--filter") ?? "all"
  if (filter !== "all" && filter !== "archive" && filter !== "directory" && filter !== "video") {
    throw usage("--filter must be all, archive, directory or video.")
  }
  return filter
}

async function runReaderUi(args: readonly string[], host: CliHost, dependencies: NeoviewCliDependencies): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView ui requires an interactive terminal.")
  const connection = parseReaderUiConnectionArgs(args)
  const credentials = credentialsFromEnvironment(parseArguments(connection.credentialArgs), host)
  try {
    const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
    const flags = resolveTerminalUiFlags(connection.terminalArgs, { language: "zh", renderer: "opentui", theme: "nord" })
    if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
      throw usage(flags.error ?? `Unknown ui argument: ${flags.args[0]}`)
    }
    const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
    if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
      throw usage(`Unknown terminal theme: ${flags.theme}.`)
    }
    const { createNeoviewTuiDefinition } = await import("./interaction.js")
    const remoteOptions = connection.baseUrl ? {
      baseUrl: connection.baseUrl,
      token: connectionToken(connection.tokenVariable, host),
    } : undefined
    await runTerminalUi(createNeoviewTuiDefinition(flags.language), {
      host,
      language: flags.language,
      renderer: flags.renderer,
      theme: flags.theme,
      loadScreen: async () => {
        const tui = await import("./Tui.js")
        if (!remoteOptions && !credentials.inputs) return tui.NeoviewTui
        const createRemote = dependencies.createRemoteController ?? DEFAULT_DEPENDENCIES.createRemoteController!
        return tui.createNeoviewTuiScreen(
          remoteOptions ? () => createRemote(remoteOptions) : undefined,
          credentials.inputs,
        )
      },
      reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["ui", ...args] } : undefined,
    })
  } finally {
    credentials.clear()
  }
}

export function parseReaderUiConnectionArgs(args: readonly string[]): {
  terminalArgs: string[]
  credentialArgs: string[]
  baseUrl?: string
  tokenVariable?: string
} {
  const terminalArgs: string[] = []
  const credentialArgs: string[] = []
  let baseUrl: string | undefined
  let tokenVariable: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument !== "--connect" && argument !== "--token-env" && argument !== "--password-env" && argument !== "--archive-password-env") {
      terminalArgs.push(argument)
      continue
    }
    const value = args[index + 1]
    if (!value || value.startsWith("--")) throw usage(`${argument} requires a value.`)
    if (argument === "--password-env" || argument === "--archive-password-env") {
      credentialArgs.push(argument, value)
    } else if (argument === "--connect") {
      if (baseUrl !== undefined) throw usage("--connect can only be specified once.")
      baseUrl = value
    } else {
      if (tokenVariable !== undefined) throw usage("--token-env can only be specified once.")
      tokenVariable = value
    }
    index += 1
  }
  if (!baseUrl && tokenVariable) throw usage("--token-env requires --connect.")
  return { terminalArgs, credentialArgs, baseUrl, tokenVariable }
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

async function runBookSettingsUi(
  args: readonly string[],
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView book-settings-ui requires an interactive terminal.")
  const connection = parseReaderUiConnectionArgs(args)
  const credentials = credentialsFromEnvironment(parseArguments(connection.credentialArgs), host)
  try {
    const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
    const flags = resolveTerminalUiFlags(connection.terminalArgs, { language: "zh", renderer: "opentui", theme: "nord" })
    if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
      throw usage(flags.error ?? `Unknown book-settings-ui argument: ${flags.args[0]}`)
    }
    const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
    if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
      throw usage(`Unknown terminal theme: ${flags.theme}.`)
    }
    const createController = connection.baseUrl
      ? () => (dependencies.createRemoteController ?? DEFAULT_DEPENDENCIES.createRemoteController!)({
          baseUrl: connection.baseUrl!,
          token: connectionToken(connection.tokenVariable, host),
        })
      : () => dependencies.createController({ cwd: host.cwd, env: host.env })
    const { createNeoviewBookSettingsTuiDefinition } = await import("./interaction.js")
    await runTerminalUi(createNeoviewBookSettingsTuiDefinition(flags.language, createController, credentials.inputs), {
      host,
      language: flags.language,
      renderer: flags.renderer,
      theme: flags.theme,
      reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["book-settings-ui", ...args] } : undefined,
    })
  } finally {
    credentials.clear()
  }
}

async function runMediaProgressUi(
  args: readonly string[],
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView media-progress-ui requires an interactive terminal.")
  const connection = parseReaderUiConnectionArgs(args)
  if (connection.baseUrl) throw usage("NeoView media-progress-ui currently requires a local Reader composition; remote media-progress transport is not yet available.")
  const credentials = credentialsFromEnvironment(parseArguments(connection.credentialArgs), host)
  try {
    const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
    const flags = resolveTerminalUiFlags(connection.terminalArgs, { language: "zh", renderer: "opentui", theme: "nord" })
    if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
      throw usage(flags.error ?? `Unknown media-progress-ui argument: ${flags.args[0]}`)
    }
    const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
    if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
      throw usage(`Unknown terminal theme: ${flags.theme}.`)
    }
    const { createNeoviewMediaProgressTuiDefinition } = await import("./interaction.js")
    await runTerminalUi(createNeoviewMediaProgressTuiDefinition(
      flags.language,
      async () => {
        const controller = await dependencies.createController({ cwd: host.cwd, env: host.env })
        if (!controller.getMediaProgress || !controller.updateMediaProgress) {
          await controller[Symbol.asyncDispose]()
          throw new Error("Reader media progress is unavailable for this local composition.")
        }
        return controller as import("./interaction.js").NeoviewMediaProgressTuiPort
      },
      credentials.inputs,
    ), {
      host,
      language: flags.language,
      renderer: flags.renderer,
      theme: flags.theme,
      reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["media-progress-ui", ...args] } : undefined,
    })
  } finally {
    credentials.clear()
  }
}

async function runInputBindingsDispatchCommand(parsed: ParsedArguments, host: CliHost): Promise<void> {
  if (parsed.positionals.length !== 1) throw usage("input-bindings-dispatch requires exactly one book path.")
  const inputJson = oneValue(parsed, "--input-json")
  if (!inputJson) throw usage("input-bindings-dispatch requires --input-json <descriptor.json|inline-json>.")
  const input = parseInputDescriptorCli(inputJson, host.cwd)
  const contexts = parseInputContextsCli(oneValue(parsed, "--contexts-json"), host.cwd)
  const { ReaderInputBindingsConfigService } = await import("./platform/config/ReaderInputBindingsConfigService.js")
  const service = new ReaderInputBindingsConfigService({ configPath: oneValue(parsed, "--config"), cwd: host.cwd, env: host.env })
  const controller = await createReaderHeadlessController({ configPath: oneValue(parsed, "--config"), cwd: host.cwd, env: host.env })
  try {
    await controller.open({ path: resolve(host.cwd, parsed.positionals[0]!) })
    const result = await executeReaderHeadlessInputBinding(await service.inspect(), input, contexts, controller)
    if (parsed.booleans.has("--json")) writeJson(host, result)
    else if (!result.matched) writeLine(host, `Input binding not found (${contexts.join(",")}).`)
    else writeLine(host, result.result.handled
      ? `Input binding handled: ${result.bindingId} -> ${result.action} (${result.context}).`
      : `Input binding unsupported: ${result.bindingId} -> ${result.action} (${result.result.reason}).`)
  } finally {
    await controller[Symbol.asyncDispose]()
  }
}

function parseInputDescriptorCli(value: string, cwd: string): ReaderInputDescriptor {
  const raw = value.trim().startsWith("{") ? value : requireCliJson(value, cwd)
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (error) { throw usage(`Invalid --input-json: ${error instanceof Error ? error.message : String(error)}`) }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { device?: unknown }).device !== "string") throw usage("--input-json must contain a Reader input descriptor.")
  return parsed as ReaderInputDescriptor
}

function parseInputContextsCli(value: string | undefined, cwd: string): ReaderInputContext[] {
  if (!value) return ["reader"]
  const raw = value.trim().startsWith("[") ? value : requireCliJson(value, cwd)
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (error) { throw usage(`Invalid --contexts-json: ${error instanceof Error ? error.message : String(error)}`) }
  if (!Array.isArray(parsed) || !parsed.length || parsed.some((entry) => !["global", "reader", "video", "panel", "editor", "modal"].includes(String(entry)))) {
    throw usage("--contexts-json must be a non-empty JSON array of Reader contexts.")
  }
  return parsed as ReaderInputContext[]
}

function requireCliJson(value: string, cwd: string): string {
  try { return readFileSync(resolve(cwd, value), "utf8") } catch (error) { throw usage(`Cannot read JSON input ${value}: ${error instanceof Error ? error.message : String(error)}`) }
}

async function runBookSettingsMigrationUi(args: readonly string[], host: CliHost): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView book-settings-migration-ui requires an interactive terminal.")
  const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
  const flags = resolveTerminalUiFlags(args, { language: "zh", renderer: "opentui", theme: "nord" })
  if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
    throw usage(flags.error ?? `Unknown book-settings-migration-ui argument: ${flags.args[0]}`)
  }
  const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
  if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
    throw usage(`Unknown terminal theme: ${flags.theme}.`)
  }
  const { createNeoviewBookSettingsMigrationTuiDefinition } = await import("./interaction.js")
  await runTerminalUi(createNeoviewBookSettingsMigrationTuiDefinition(flags.language), {
    host,
    language: flags.language,
    renderer: flags.renderer,
    theme: flags.theme,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["book-settings-migration-ui", ...args] } : undefined,
  })
}

async function runInputBindingsUi(args: readonly string[], host: CliHost): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView input-bindings-ui requires an interactive terminal.")
  const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
  const flags = resolveTerminalUiFlags(args, { language: "zh", renderer: "opentui", theme: "nord" })
  if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
    throw usage(flags.error ?? `Unknown input-bindings-ui argument: ${flags.args[0]}`)
  }
  const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
  if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
    throw usage(`Unknown terminal theme: ${flags.theme}.`)
  }
  const { createNeoviewInputBindingsTuiDefinition } = await import("./interaction.js")
  const { ReaderInputBindingsConfigService } = await import("./platform/config/ReaderInputBindingsConfigService.js")
  await runTerminalUi(createNeoviewInputBindingsTuiDefinition(
    flags.language,
    new ReaderInputBindingsConfigService({ cwd: host.cwd, env: host.env }),
  ), {
    host,
    language: flags.language,
    renderer: flags.renderer,
    theme: flags.theme,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["input-bindings-ui", ...args] } : undefined,
  })
}

async function runUpscaleCacheUi(
  args: readonly string[],
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView upscale-cache-ui requires an interactive terminal.")
  const connection = parseReaderUiConnectionArgs(args)
  if (!connection.baseUrl) throw usage("NeoView upscale-cache-ui requires --connect to the running Reader backend.")
  const credentials = credentialsFromEnvironment(parseArguments(connection.credentialArgs), host)
  try {
    const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
    const flags = resolveTerminalUiFlags(connection.terminalArgs, { language: "zh", renderer: "opentui", theme: "nord" })
    if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
      throw usage(flags.error ?? `Unknown upscale-cache-ui argument: ${flags.args[0]}`)
    }
    const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
    if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
      throw usage(`Unknown terminal theme: ${flags.theme}.`)
    }
    const createController = async () => {
      const controller = await (dependencies.createRemoteController ?? DEFAULT_DEPENDENCIES.createRemoteController!)({
        baseUrl: connection.baseUrl!,
        token: connectionToken(connection.tokenVariable, host),
      })
      if (!controller.getUpscaleArtifactCache || !controller.cleanupUpscaleArtifactCache) {
        await controller[Symbol.asyncDispose]()
        throw missingUpscaleArtifactCacheCapability()
      }
      return {
        open: (input: OpenHeadlessReaderInput) => controller.open(input),
        getUpscaleArtifactCache: (signal?: AbortSignal) => controller.getUpscaleArtifactCache!(signal),
        cleanupUpscaleArtifactCache: (kind: RemoteSuperResolutionArtifactCacheCleanupKind, signal?: AbortSignal) => controller.cleanupUpscaleArtifactCache!(kind, signal),
        [Symbol.asyncDispose]: () => controller[Symbol.asyncDispose](),
      }
    }
    const { createNeoviewUpscaleCacheTuiDefinition } = await import("./interaction.js")
    await runTerminalUi(createNeoviewUpscaleCacheTuiDefinition(flags.language, createController, credentials.inputs), {
      host,
      language: flags.language,
      renderer: flags.renderer,
      theme: flags.theme,
      reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["upscale-cache-ui", ...args] } : undefined,
    })
  } finally {
    credentials.clear()
  }
}

async function runDiagnosticsHistoryUi(
  args: readonly string[],
  host: CliHost,
  dependencies: NeoviewCliDependencies,
): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView diagnostics-history-ui requires an interactive terminal.")
  const connection = parseReaderUiConnectionArgs(args)
  if (!connection.baseUrl) throw usage("NeoView diagnostics-history-ui requires --connect to the running Reader backend.")
  const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
  const flags = resolveTerminalUiFlags(connection.terminalArgs, { language: "zh", renderer: "opentui", theme: "nord" })
  if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
    throw usage(flags.error ?? `Unknown diagnostics-history-ui argument: ${flags.args[0]}`)
  }
  const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
  if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
    throw usage(`Unknown terminal theme: ${flags.theme}.`)
  }
  const fetchHistory = dependencies.fetchRemoteDiagnosticsHistory ?? (async (options: {
    baseUrl: string
    token: string
    sinceMs?: number
    limit?: number
  }) => {
    const { fetchRemoteReaderDiagnosticsHistory } = await import("./platform/remote/RemoteReaderHeadlessController.js")
    return fetchRemoteReaderDiagnosticsHistory(options)
  })
  const { createNeoviewDiagnosticsHistoryTuiDefinition } = await import("./interaction.js")
  await runTerminalUi(createNeoviewDiagnosticsHistoryTuiDefinition(flags.language, {
    history: (options) => fetchHistory({
      baseUrl: connection.baseUrl!,
      token: connectionToken(connection.tokenVariable, host),
      ...options,
    }),
  }), {
    host,
    language: flags.language,
    renderer: flags.renderer,
    theme: flags.theme,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["diagnostics-history-ui", ...args] } : undefined,
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
    "  subtitle-list <path> List matching video subtitle tracks (--index)",
    "  subtitle-render <path> Render one subtitle track as WebVTT (--subtitle-id, --output)",
    "  media-progress-get <path> Read saved video progress",
    "  media-progress-set <path> Write video progress (--position, --duration, --completed)",
    "  emm-get <path>       Inspect current-book EMM overrides",
    "  emm-set <path>       Apply an EMM override patch (--expected-revision, --input, --yes)",
    "  upscale-page <path>  Upscale one page using the configured policy",
    "  upscale-capabilities Inspect registered models and system CLI capabilities",
    "  upscale-preload-status <path> Show live nearby/progressive preload state",
    "  upscale-preload-start <path>  Start one preload mode (--mode)",
    "  upscale-preload-pause <path>  Pause active preload work",
    "  upscale-preload-retry <path>  Retry one preload mode (--mode)",
    "  upscale-cache-stats <path>    Inspect the running artifact cache (--connect)",
    "  upscale-cache-cleanup <path>  Clean age/current-book/all artifacts (--kind, --yes, --connect)",
    "  upscale-cache-ui              Open remote artifact-cache maintenance UI (--connect)",
    "  input-action-dispatch <path> Dispatch one supported action (--action)",
    "  input-bindings-dispatch <path> Dispatch a configured input (--input-json, --contexts-json)",
    "  settings-inspect <json>  Preview a legacy settings migration",
    "  settings-import <json>   Import legacy settings into [nodes.neoview] TOML",
    "  page-transition-get       Show global page-transition settings",
    "  page-transition-set       Update page-transition settings",
    "  page-transition-reset     Restore page-transition defaults",
    "  input-bindings-list       Inspect canonical multi-device bindings",
    "  input-bindings-apply <json> Apply a complete binding array (--yes)",
    "  input-bindings-reset      Restore canonical defaults (--yes)",
    "  input-bindings-ui         Open terminal binding management",
    "  settings-export          Export current [nodes.neoview] as portable JSON",
    "  settings-portable-inspect <json>  Validate a portable Xiranite settings export",
    "  settings-portable-import <json>   Import a portable settings export",
    "  settings-backup <directory>        Create a verified settings + thumbnails.db bundle",
    "  settings-backup-scheduled          Run one configured automatic backup check (--yes)",
    "  settings-backup-inspect <directory> Verify a backup bundle without mutation",
    "  settings-backup-restore <directory> Restore offline with explicit quarantine",
    "  book-settings-get <book>            Read inherited/effective per-book settings",
    "  book-settings-set <book>            Update revisioned per-book settings",
    "  book-settings-legacy-inspect <json>  Inspect legacy per-book settings without opening SQLite",
    "  book-settings-legacy-import <json>   Import legacy per-book settings (--yes)",
    "  reader-data-inspect <json>  Preview legacy history/bookmark migration",
    "  reader-data-import <json>   Import legacy reader data into thumbnails.db",
    "  search-history-inspect <json>  Preview legacy search-history migration",
    "  search-history-import <json>   Import search history into thumbnails.db",
    "  library-recents                 List recent Reader entries",
    "  library-recent-delete           Delete one recent entry (--id, --yes)",
    "  library-recent-cleanup          Delete an old bounded batch (--before, --yes)",
    "  library-recent-cleanup-oldest   Delete the oldest bounded batch (--limit, --yes)",
    "  library-recent-cleanup-folder <path> Delete recents under one folder (--yes)",
    "  library-recent-clear            Delete all recent entries (--yes)",
    "  library-invalid-cleanup         Remove missing recent/bookmark paths (--yes)",
    "  library-bookmarks               List bookmarks, optionally by --list",
    "  library-bookmark-add <path>     Add or merge a bookmark",
    "  library-bookmark-delete         Delete one bookmark (--id, --yes)",
    "  library-bookmark-batch-update   Set list membership for selected bookmarks (--id, --list)",
    "  library-bookmark-batch-delete   Delete selected bookmarks (--id, --yes)",
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
    "  explorer-context-menu-preview    Preview the Windows Explorer registration",
    "  explorer-context-menu-status     Show Explorer registration status",
    "  explorer-context-menu-enable     Enable Explorer registration (--yes)",
    "  explorer-context-menu-disable    Disable Explorer registration (--yes)",
    "  thumbnail-db-inspect [path]  Inspect the original thumbnail DB without writing",
    "  thumbnail-db-stats [path]    Show aggregate DB/writer statistics (--connect uses the running backend)",
    "  thumbnail-db-cleanup [path]  Run one bounded cleanup batch (--connect uses the running backend)",
    "  thumbnail-db-clear-failures [path]  Clear a failure batch (--connect uses the running backend)",
    "  thumbnail-db-backup [path]   Create and verify a SQLite snapshot with VACUUM INTO",
    "  thumbnail-db-optimize [path] Backup, checkpoint and optimize an offline database",
    "  thumbnail-db-recover [path]  Restore a verified backup and quarantine the offline source",
    "  thumbnail-db-merge-plan [path] Inspect a secondary database merge without mutation (--source)",
    "  thumbnail-db-merge-secondary [path] Merge a verified secondary database offline (--source, --backup, --yes)",
    "  presentation-cache-stats       Show L3 content-cache statistics (--connect uses the running backend)",
    "  presentation-cache-cleanup     Run age/budget maintenance for L3 (--connect uses the running backend)",
    "  presentation-cache-clear       Clear unleased L3 entries (--connect uses the running backend)",
    "  diagnostics                    Show process, scheduler, cache and queue diagnostics",
    "  diagnostics-history-export     Export bounded diagnostics history from --connect",
    "  diagnostics-history-ui         Open remote diagnostics-history export UI (--connect)",
    "  folder-tree <path>              List one lazily loaded directory-tree node",
    "  folder-search <path>            Stream a bounded recursive directory search",
    "  folder-emm-tags                 Suggest EMM catalog and favorite tags",
    "  folder-emm-edit <path>          Apply a bounded EMM edit JSON batch to the current directory",
    "  folder-search-history            List persisted scoped search history",
    "  folder-search-history-delete     Delete one persisted search query (--yes)",
    "  folder-search-history-clear      Clear one persisted search scope (--yes)",
    "  folder-exclude <path>           Persist an excluded directory in node TOML",
    "  folder-include <path>           Remove a persisted directory exclusion",
    "  folder-tree-cache-clear <path>  Clear the bounded file-tree cache",
    "  folder-ui                        Open the shared file-tree terminal workbench",
    "  library-ui                       Open recent/bookmark terminal management",
    "  file-ui                          Open shared file-operation terminal controls",
    "  book-settings-ui                 Open shared per-book settings terminal controls",
    "  media-progress-ui                Open local video-progress terminal controls",
    "  book-settings-migration-ui       Inspect/import legacy per-book settings in OpenTUI",
    "  ui                   Open the persistent terminal reader",
    "",
    "Options:",
    "  --index N            Zero-based page index",
    "  --cursor N           Page-list cursor",
    "  --limit N            Page-list, history, or EMM suggestion limit",
    "  --entry PATH         Repeat for each nested archive entry",
    "  --password-env VAR   Read the root archive password from VAR",
    "  --archive-password-env SCOPE=VAR  Scoped nested password; join scope with ::",
    "  --connect URL        Use the running loopback XR Reader backend",
    "  --token-env VAR      Read its token from VAR (default XIRANITE_BACKEND_TOKEN)",
    "  --format FORMAT      Diagnostics history export format: json or csv",
    "  --since-ms N         First diagnostics history sample timestamp to include",
    "  --expected-revision N  Required CAS revision for book-settings-set",
    "  --enabled VALUE        Page transition enabled: true|false",
    "  --type VALUE           Page transition type",
    "  --duration N           Page transition duration in milliseconds (0..500)",
    "  --easing VALUE         Page transition easing",
    "  --favorite VALUE      true|false|inherit for book-settings-set",
    "  --rating VALUE        1..5|inherit for book-settings-set",
    "  --direction VALUE     left-to-right|right-to-left|inherit",
    "  --page-mode VALUE     single|double|inherit",
    "  --horizontal-book VALUE  true|false|inherit",
    "  --json               Structured metadata output",
    "  --force              Replace an existing extract output",
    "  --output PATH|-      Output path for extract-page, subtitle-render or upscale-page",
    "  --position N         Media position for media-progress-set",
    "  --completed BOOL     true|false media completion state for media-progress-set",
    "  --flush              Durably flush media progress before returning",
    "  --config PATH        Xiranite TOML path for settings/cache commands",
    "  --query QUERY        Folder search text or glob",
    "  --mode MODE          Folder search mode, or nearby|progressive for preload",
    "  --filter TYPE        Source type: all, archive, directory or video",
    "  --tag TAG            Repeatable required EMM tag; search text may be omitted",
    "  --exclude-tag TAG    Repeatable excluded EMM tag",
    "  --tag-mode MODE      Required-tag mode: all or any",
    "  --input PATH         JSON input for folder-emm-edit: { updates, concurrency? }",
    "                       or emm-set: { rating?, manualTags?, translatedTitle? }",
    "  --subtitle-id ID     Subtitle track ID for subtitle-render",
    "  --action ID          Stable XR or legacy action ID for input-action-dispatch",
    "  --input-json JSON|PATH  Input descriptor JSON for input-bindings-dispatch",
    "  --contexts-json JSON|PATH  Active context stack for input-bindings-dispatch",
    "  --node PATH          Explicit tree node for tree/cache commands",
    "  --depth N            Recursive search depth (0..4096)",
    "  --exclude PATTERN    Repeatable request-scoped gitignore pattern",
    "  --case-sensitive     Use case-sensitive folder search",
    "  --search-in-path     Match text queries against relative paths",
    "  --refresh            Bypass one cached tree node",
    "  --database PATH      Override the legacy NeoView thumbnails.db path",
    "  --quarantine PATH    Preserve the pre-restore thumbnails.db at PATH",
    "  --strategy MODE      Settings import mode: merge or overwrite",
    "  --modules LIST       Comma-separated settings modules:",
    "                       native-settings,keybindings,emm,file-browser,ui,panels,bookmarks,history,book-settings,",
    "                       search-history,upscale,performance,folder-ratings,voice-control",
    "  --yes                Confirm settings-import after preview",
    "                       Also required for thumbnail database mutations",
    "  --overwrite          Allow copy/move/rename to replace a destination",
    "  --concurrency N      File-operation concurrency (1..8)",
    "  --kind KIND          Thumbnail cleanup kind: empty, expired, invalid or path-prefix",
    "  --prefix PATH        Path prefix for thumbnail-db-cleanup --kind path-prefix",
    "  --days N             Expiration age in days (default 30)",
    "  --scan-limit N       Invalid-path scan batch (default 500)",
    "  --offline            Confirm all NeoView/Xiranite database users are closed",
    "  --vacuum             Rebuild the database after backup during offline optimize",
    "  --source PATH        Secondary thumbnails.db for thumbnail-db-merge-plan",
    "  --backup PATH        Canonical database backup for thumbnail-db-merge-secondary",
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
