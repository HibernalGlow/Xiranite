import type { InteractionValues, TerminalInteractionDefinition, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import { dirname, resolve } from "node:path"
import type {
  HeadlessReaderBookSettingsUpdate,
  HeadlessReaderSnapshot,
  OpenHeadlessReaderInput,
  ReaderBookSettingsPatch,
  ReaderBookSettingsSnapshot,
  ReaderDirectoryFilter,
  ReaderDirectoryEmmEditCommand,
  ReaderHeadlessController,
} from "./core.js"
import type { ReaderFileTreeHeadlessController } from "./core.js"
import type { ReaderLibraryHeadlessController } from "./core.js"
import type { ReaderFileMutation, ReaderFileOperationService } from "./core.js"
import type { ReaderInputBinding, ReaderInputBindingsConfig, ReaderInputContext, ReaderInputDescriptor } from "./domain/input/ReaderInputBindings.js"
import { createReaderBookSettingsMigrationFileController, createReaderFileOperationService, createReaderFileTreeController, createReaderHeadlessController, createReaderLibraryHeadlessController } from "./platform.js"
import type {
  ReaderBookSettingsMigrationFileImportResult,
  ReaderBookSettingsMigrationFilePort,
} from "./platform/migration/ReaderBookSettingsMigrationFileController.js"
import type { ReaderBookSettingsMigrationInspection } from "./application/migration/ReaderBookSettingsMigrationService.js"
import { ReaderInputBindingsConfigService } from "./platform/config/ReaderInputBindingsConfigService.js"
import { READER_INPUT_ACTIONS, readerInputActionFromLegacyId, type ReaderInputAction } from "./domain/input/ReaderInputActions.js"
import { executeReaderHeadlessInputAction, type ReaderHeadlessInputActionResult } from "./application/headless/ReaderHeadlessInputActionExecutor.js"
import { executeReaderHeadlessInputBinding, type ReaderHeadlessInputBindingResult } from "./application/headless/ReaderHeadlessInputBindingExecutor.js"
import type {
  RemoteSuperResolutionArtifactCacheCleanupKind,
  RemoteSuperResolutionArtifactCacheCleanupResult,
  RemoteSuperResolutionArtifactCacheSnapshot,
} from "./platform/remote/RemoteReaderHeadlessController.js"
import type { ReaderDiagnosticsHistory } from "./application/diagnostics/ReaderDiagnosticsService.js"
import {
  exportReaderDiagnosticsHistory,
  type ReaderDiagnosticsHistoryExportFormat,
} from "./application/diagnostics/ReaderDiagnosticsHistoryExport.js"

export interface NeoviewTuiInput {
  path: string
}

export interface NeoviewTuiResult {
  success: boolean
  message: string
  snapshot?: HeadlessReaderSnapshot
}

export interface NeoviewBookSettingsTuiInput {
  action: "get" | "set"
  path: string
  patch?: ReaderBookSettingsPatch
}

export interface NeoviewBookSettingsTuiResult {
  success: boolean
  message: string
  settings?: ReaderBookSettingsSnapshot
  reader?: HeadlessReaderSnapshot
}

export interface NeoviewBookSettingsTuiPort extends AsyncDisposable {
  open(input: OpenHeadlessReaderInput): Promise<HeadlessReaderSnapshot>
  getBookSettings(signal?: AbortSignal): Promise<ReaderBookSettingsSnapshot>
  updateBookSettings(expectedRevision: number, patch: ReaderBookSettingsPatch, signal?: AbortSignal): Promise<HeadlessReaderBookSettingsUpdate>
}

export interface NeoviewUpscaleCacheTuiInput {
  action: "stats" | "cleanup-age" | "cleanup-book" | "clear-all"
  path: string
}

export interface NeoviewUpscaleCacheTuiResult {
  success: boolean
  message: string
  snapshot?: RemoteSuperResolutionArtifactCacheSnapshot | RemoteSuperResolutionArtifactCacheCleanupResult
}

export interface NeoviewUpscaleCacheTuiPort extends AsyncDisposable {
  open(input: OpenHeadlessReaderInput): Promise<HeadlessReaderSnapshot>
  getUpscaleArtifactCache(signal?: AbortSignal): Promise<RemoteSuperResolutionArtifactCacheSnapshot>
  cleanupUpscaleArtifactCache(
    kind: RemoteSuperResolutionArtifactCacheCleanupKind,
    signal?: AbortSignal,
  ): Promise<RemoteSuperResolutionArtifactCacheCleanupResult>
}

export interface NeoviewDiagnosticsHistoryTuiInput {
  format: ReaderDiagnosticsHistoryExportFormat
  sinceMs?: number
  limit?: number
}

export interface NeoviewDiagnosticsHistoryTuiResult {
  success: boolean
  message: string
  history?: ReaderDiagnosticsHistory
  body?: string
}

export interface NeoviewDiagnosticsHistoryTuiPort {
  history(options: { sinceMs?: number; limit?: number }): Promise<ReaderDiagnosticsHistory>
}

export interface NeoviewBookSettingsMigrationTuiInput {
  action: "inspect" | "import"
  inputPath: string
  databasePath?: string
  strategy: "merge" | "overwrite"
}

export interface NeoviewBookSettingsMigrationTuiResult {
  success: boolean
  message: string
  inspection?: ReaderBookSettingsMigrationInspection
  imported?: ReaderBookSettingsMigrationFileImportResult
}

export type NeoviewFileTreeTuiAction =
  | "tree" | "search" | "exclude" | "include" | "clear-cache"
  | "history" | "delete-history" | "clear-history" | "emm-tags" | "emm-edit"

export interface NeoviewFileTreeTuiInput {
  action: NeoviewFileTreeTuiAction
  path: string
  query?: string
  mode?: "text" | "glob"
  maximumDepth?: number
  maximumResults?: number
  caseSensitive?: boolean
  searchInPath?: boolean
  filter?: ReaderDirectoryFilter
  includeTags?: readonly string[]
  excludeTags?: readonly string[]
  tagMode?: "all" | "any"
  emmUpdatesJson?: string
  emmConcurrency?: number
  scope?: "folder" | "file" | "bookmark" | "history"
}

export interface NeoviewFileTreeTuiResult {
  success: boolean
  message: string
  paths?: readonly string[]
}

export type NeoviewLibraryTuiAction =
  | "list-recents" | "cleanup-recents" | "cleanup-recents-oldest" | "cleanup-recents-folder" | "clear-recents" | "delete-recent"
  | "cleanup-invalid"
  | "list-bookmarks" | "add-bookmark" | "delete-bookmark" | "update-bookmarks" | "delete-bookmarks"
  | "list-bookmark-lists" | "add-bookmark-list" | "delete-bookmark-list"

export interface NeoviewLibraryTuiInput {
  action: NeoviewLibraryTuiAction
  path?: string
  id?: string
  name?: string
  listId?: string
  batchIds?: string
  batchListIds?: string
  before?: number
  limit?: number
  starred?: boolean
  favorite?: boolean
  cleanupKind?: "recents" | "bookmarks" | "both"
  concurrency?: number
  filter?: ReaderDirectoryFilter
}

export interface NeoviewLibraryTuiResult {
  success: boolean
  message: string
  lines?: readonly string[]
}

export type NeoviewFileOperationTuiAction = "copy" | "move" | "rename" | "delete" | "trash" | "create-directory" | "undo" | "discard-undo"

export interface NeoviewFileOperationTuiInput {
  action: NeoviewFileOperationTuiAction
  sourcePath?: string
  destinationPath?: string
  overwrite?: boolean
}

export interface NeoviewFileOperationTuiResult {
  success: boolean
  message: string
  lines?: readonly string[]
}

export type NeoviewInputBindingsTuiAction = "inspect" | "apply" | "reset" | "dispatch" | "dispatch-binding"

export interface NeoviewInputBindingsTuiInput {
  action: NeoviewInputBindingsTuiAction
  bindings?: readonly ReaderInputBinding[]
  path?: string
  inputAction?: ReaderInputAction
  input?: ReaderInputDescriptor
  contexts?: readonly ReaderInputContext[]
}

export interface NeoviewInputBindingsTuiResult {
  success: boolean
  message: string
  config?: ReaderInputBindingsConfig
  dispatch?: ReaderHeadlessInputActionResult | ReaderHeadlessInputBindingResult
}

export interface NeoviewInputBindingsTuiPort {
  inspect(): Promise<ReaderInputBindingsConfig>
  apply(bindings: readonly ReaderInputBinding[], confirmed: boolean): Promise<{ config: ReaderInputBindingsConfig; changed: boolean }>
  reset(confirmed: boolean): Promise<{ config: ReaderInputBindingsConfig; changed: boolean }>
}

export function createNeoviewTuiDefinition(
  language: "zh" | "en" = "zh",
): TerminalInteractionDefinition<NeoviewTuiInput, NeoviewTuiResult> {
  return {
    schema: createNeoviewTuiSchema(language),
    async run(input) {
      const controller = await createReaderHeadlessController()
      try {
        const snapshot = await controller.open({ path: input.path })
        return { success: true, message: `Opened ${snapshot.book.displayName}.`, snapshot }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      } finally {
        await controller[Symbol.asyncDispose]()
      }
    },
  }
}

export function createNeoviewBookSettingsTuiDefinition(
  language: "zh" | "en" = "zh",
  createController: () => Promise<NeoviewBookSettingsTuiPort> = createReaderHeadlessController,
  archivePasswords?: OpenHeadlessReaderInput["archivePasswords"],
): TerminalInteractionDefinition<NeoviewBookSettingsTuiInput, NeoviewBookSettingsTuiResult> {
  return {
    schema: createNeoviewBookSettingsTuiSchema(language),
    async run(input) {
      const controller = await createController()
      try {
        await controller.open({ path: input.path, archivePasswords })
        const current = await controller.getBookSettings()
        if (input.action === "get") {
          return { success: true, message: `Book settings revision ${current.revision}.`, settings: current }
        }
        const updated = await controller.updateBookSettings(current.revision, input.patch ?? {})
        return {
          success: true,
          message: `Book settings updated to revision ${updated.settings.revision}.`,
          settings: updated.settings,
          reader: updated.reader,
        }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      } finally {
        await controller[Symbol.asyncDispose]()
      }
    },
  }
}

export function createNeoviewBookSettingsMigrationTuiDefinition(
  language: "zh" | "en" = "zh",
  createController: () => Promise<ReaderBookSettingsMigrationFilePort> = createReaderBookSettingsMigrationFileController,
): TerminalInteractionDefinition<NeoviewBookSettingsMigrationTuiInput, NeoviewBookSettingsMigrationTuiResult> {
  return {
    schema: createNeoviewBookSettingsMigrationTuiSchema(language),
    async run(input) {
      try {
        const controller = await createController()
        if (input.action === "inspect") {
          const inspection = await controller.inspect(input.inputPath)
          return { success: true, message: `${inspection.report.validEntries} valid legacy book setting(s).`, inspection }
        }
        const imported = await controller.import(input.inputPath, input.databasePath, input.strategy, true)
        return {
          success: true,
          message: `Imported ${imported.result.applied.inserted + imported.result.applied.updated} legacy book setting(s).`,
          imported,
        }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

export function createNeoviewUpscaleCacheTuiDefinition(
  language: "zh" | "en" = "zh",
  createController: () => Promise<NeoviewUpscaleCacheTuiPort>,
  archivePasswords?: OpenHeadlessReaderInput["archivePasswords"],
): TerminalInteractionDefinition<NeoviewUpscaleCacheTuiInput, NeoviewUpscaleCacheTuiResult> {
  let activeAbort: AbortController | undefined
  return {
    schema: createNeoviewUpscaleCacheTuiSchema(language),
    async run(input) {
      const abort = new AbortController()
      activeAbort = abort
      const controller = await createController()
      try {
        await controller.open({ path: input.path, archivePasswords, signal: abort.signal })
        const snapshot = input.action === "stats"
          ? await controller.getUpscaleArtifactCache(abort.signal)
          : await controller.cleanupUpscaleArtifactCache(upscaleCacheActionKind(input.action), abort.signal)
        const removed = isUpscaleCacheCleanupResult(snapshot)
          ? ` Removed ${snapshot.removedEntries} entries (${snapshot.removedBytes} bytes).`
          : ""
        return {
          success: true,
          message: `Upscale cache: ${snapshot.entries} entries, ${snapshot.bytes}/${snapshot.maxBytes} bytes.${removed}`,
          snapshot,
        }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      } finally {
        if (activeAbort === abort) activeAbort = undefined
        await controller[Symbol.asyncDispose]()
      }
    },
    cancel: () => activeAbort?.abort(),
  }
}

export function createNeoviewDiagnosticsHistoryTuiDefinition(
  language: "zh" | "en" = "zh",
  port: NeoviewDiagnosticsHistoryTuiPort,
): TerminalInteractionDefinition<NeoviewDiagnosticsHistoryTuiInput, NeoviewDiagnosticsHistoryTuiResult> {
  return {
    schema: createNeoviewDiagnosticsHistoryTuiSchema(language),
    async run(input) {
      try {
        const history = await port.history({ sinceMs: input.sinceMs, limit: input.limit })
        const exported = exportReaderDiagnosticsHistory(history, input.format)
        return {
          success: true,
          message: `Exported ${history.samples.length} diagnostics sample(s) as ${exported.format}.`,
          history,
          body: exported.body,
        }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

export function createNeoviewFileTreeTuiDefinition(
  language: "zh" | "en" = "zh",
  createController: () => Promise<ReaderFileTreeHeadlessController> = createReaderFileTreeController,
): TerminalInteractionDefinition<NeoviewFileTreeTuiInput, NeoviewFileTreeTuiResult> {
  let active: ReaderFileTreeHeadlessController | undefined
  return {
    schema: createNeoviewFileTreeTuiSchema(language),
    async run(input, onEvent) {
      const controller = await createController()
      active = controller
      try {
        const needsTreeSession = input.action !== "history" && input.action !== "delete-history" && input.action !== "clear-history" && input.action !== "emm-tags"
        const opened = needsTreeSession
          ? await controller.open({ path: input.action === "exclude" || input.action === "include" ? dirname(input.path) : input.path })
          : undefined
        if (input.action === "tree") {
          const page = await controller.tree()
          const paths = page?.entries.map((entry) => entry.path) ?? []
          return { success: true, message: `${paths.length} child directories.`, paths }
        }
        if (input.action === "emm-edit") {
          if (!opened) throw new Error("Reader file tree session did not open.")
          const result = await controller.editEmm(emmEditCommandFromInteraction(opened.generation, input))
          return {
            success: result.failed === 0 && result.conflicts === 0,
            message: `EMM metadata: ${result.succeeded} succeeded, ${result.conflicts} conflicts, ${result.failed} failed.`,
            paths: result.results.map((item) => JSON.stringify(item)),
          }
        }
        if (input.action === "search") {
          await controller.setFilter(input.filter ?? "all")
          const handle = controller.search(input.query ?? "", {
            mode: input.mode,
            caseSensitive: input.caseSensitive,
            searchInPath: input.searchInPath,
            maximumDepth: input.maximumDepth,
            maximumResults: input.maximumResults,
            includeTags: input.includeTags,
            excludeTags: input.excludeTags,
            tagMode: input.tagMode,
          })
          const paths: string[] = []
          try {
            for await (const event of handle.events) {
              if (event.type === "entry") {
                paths.push(event.entry.path)
                onEvent({ type: "progress", message: event.entry.path })
              }
            }
          } finally {
            await handle.close()
          }
          await controller.recordSearchHistory("folder", input.query ?? "")
          return { success: true, message: `${paths.length} matches.`, paths }
        }
        if (input.action === "emm-tags") {
          const suggestions = await controller.suggestEmmTags(Math.min(input.maximumResults ?? 8, 32))
          const paths = suggestions.map((item) => `${item.category}:${item.tag}${item.translatedTag ? `\t${item.translatedTag}` : ""}`)
          return { success: true, message: `${paths.length} EMM tag suggestions.`, paths }
        }
        if (input.action === "history") {
          const entries = await controller.listSearchHistory(input.scope ?? "folder", input.maximumResults ?? 20)
          return { success: true, message: `${entries.length} history entries.`, paths: entries.map((entry) => entry.query) }
        }
        if (input.action === "delete-history") {
          const removed = await controller.removeSearchHistory(input.scope ?? "folder", input.query ?? "")
          return { success: true, message: removed ? "Search history entry removed." : "Search history entry not found." }
        }
        if (input.action === "clear-history") {
          const cleared = await controller.clearSearchHistory(input.scope ?? "folder")
          return { success: true, message: `${cleared} search history entries cleared.` }
        }
        if (input.action === "clear-cache") {
          const snapshot = controller.clearCache()
          return { success: true, message: `Tree cache cleared; remaining=${snapshot?.size ?? 0}.` }
        }
        const action = input.action === "exclude" ? "exclude" : "include"
        const snapshot = await controller.updateExclusion({ action, path: input.path })
        return { success: true, message: `${action === "exclude" ? "Excluded" : "Included"}: ${input.path}`, paths: snapshot?.excludedPaths }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      } finally {
        if (active === controller) active = undefined
        await controller[Symbol.asyncDispose]()
      }
    },
    cancel: async () => {
      const controller = active
      active = undefined
      await controller?.[Symbol.asyncDispose]()
    },
  }
}

export function createNeoviewLibraryTuiDefinition(
  language: "zh" | "en" = "zh",
  createController: () => Promise<ReaderLibraryHeadlessController> = createReaderLibraryHeadlessController,
): TerminalInteractionDefinition<NeoviewLibraryTuiInput, NeoviewLibraryTuiResult> {
  let activeAbort: AbortController | undefined
  return {
    schema: createNeoviewLibraryTuiSchema(language),
    async run(input) {
      const abort = new AbortController()
      activeAbort = abort
      const controller = await createController()
      try {
        const limit = input.limit ?? 100
        if (input.action === "list-recents") return itemsResult(await controller.listRecent(limit, 0, input.filter ?? "all"), "recent entries")
        if (input.action === "cleanup-recents") {
          const deleted = await controller.clearRecentBefore(input.before ?? 0, Math.min(limit, 500))
          return { success: true, message: `${deleted} recent entries deleted.` }
        }
        if (input.action === "cleanup-recents-oldest") {
          const result = await controller.removeOldestRecents(Math.min(limit, 500), abort.signal)
          return { success: true, message: `${result.deleted} oldest recent entries deleted.`, lines: [JSON.stringify(result)] }
        }
        if (input.action === "cleanup-recents-folder") {
          const deleted = await controller.clearByFolder("recents", input.path ?? "")
          return { success: true, message: `${deleted} recent entries deleted from folder.` }
        }
        if (input.action === "clear-recents") {
          const deleted = await controller.clearAll("recents")
          return { success: true, message: `${deleted} recent entries deleted.` }
        }
        if (input.action === "cleanup-invalid") {
          const result = await controller.cleanupInvalid({
            kind: input.cleanupKind ?? "both",
            scanLimit: limit,
            deleteLimit: limit,
            concurrency: input.concurrency ?? 8,
          })
          return { success: true, message: `${result.deleted}/${result.missing} invalid entries deleted.`, lines: [JSON.stringify(result)] }
        }
        if (input.action === "delete-recent") return mutationResult(await controller.removeRecent(input.id ?? ""), "Recent entry")
        if (input.action === "list-bookmarks") return itemsResult(await controller.listBookmarks(input.listId, limit, 0, input.filter ?? "all"), "bookmarks")
        if (input.action === "add-bookmark") {
          const item = await controller.savePathBookmark({
            path: input.path ?? "",
            name: input.name,
            starred: input.starred,
            listIds: input.listId ? [input.listId] : undefined,
          })
          return { success: true, message: "Bookmark saved.", lines: [JSON.stringify(item)] }
        }
        if (input.action === "delete-bookmark") return mutationResult(await controller.removeBookmark(input.id ?? ""), "Bookmark")
        if (input.action === "update-bookmarks") {
          const ids = commaSeparatedValues(input.batchIds)
          const listIds = commaSeparatedValues(input.batchListIds)
          const result = await controller.updateBookmarks(ids.map((id) => ({ id, listIds })), abort.signal)
          return { success: true, message: `${result.items.length} bookmarks updated.`, lines: [JSON.stringify(result)] }
        }
        if (input.action === "delete-bookmarks") {
          const result = await controller.removeBookmarks(commaSeparatedValues(input.batchIds), abort.signal)
          return { success: true, message: `${result.deleted} bookmarks deleted.`, lines: [JSON.stringify(result)] }
        }
        if (input.action === "list-bookmark-lists") return itemsResult(await controller.listBookmarkLists(), "bookmark lists")
        if (input.action === "add-bookmark-list") {
          const item = await controller.saveBookmarkList({ id: input.id, name: input.name ?? "", isFavorite: input.favorite })
          return { success: true, message: "Bookmark list saved.", lines: [JSON.stringify(item)] }
        }
        return mutationResult(await controller.removeBookmarkList(input.id ?? ""), "Bookmark list")
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      } finally {
        if (activeAbort === abort) activeAbort = undefined
        await controller[Symbol.asyncDispose]()
      }
    },
    cancel: () => activeAbort?.abort(),
  }
}

export function createNeoviewFileOperationTuiDefinition(
  language: "zh" | "en" = "zh",
  createService: () => Promise<ReaderFileOperationService> = createReaderFileOperationService,
): TerminalInteractionDefinition<NeoviewFileOperationTuiInput, NeoviewFileOperationTuiResult> {
  let service: Promise<ReaderFileOperationService> | undefined
  const getService = () => service ??= createService()
  return {
    schema: createNeoviewFileOperationTuiSchema(language),
    async run(input) {
      try {
        if (input.action === "undo") {
          const result = await (await getService()).undoLatest()
          return {
            success: result.failed === 0 && result.succeeded > 0,
            message: result.succeeded > 0 ? `${result.succeeded} operation(s) undone.` : "No operation is available to undo.",
            lines: result.results.map((item) => JSON.stringify(item)),
          }
        }
        if (input.action === "discard-undo") {
          const result = await (await getService()).discardLatest()
          return {
            success: result.discarded,
            message: result.discarded ? "Latest undo transaction discarded." : "No undo transaction is available.",
            lines: [JSON.stringify(result)],
          }
        }
        const operation = fileOperationFromInput(input)
        const result = await (await getService()).execute({ operations: [operation], concurrency: 1 })
        const item = result.results[0]!
        return {
          success: item.status === "succeeded",
          message: item.status === "succeeded" ? `${operation.kind} completed.` : item.error ?? `${operation.kind} ${item.status}.`,
          lines: [JSON.stringify(item)],
        }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

export function createNeoviewInputBindingsTuiDefinition(
  language: "zh" | "en" = "zh",
  service: NeoviewInputBindingsTuiPort = new ReaderInputBindingsConfigService(),
  createController: () => Promise<ReaderHeadlessController> = createReaderHeadlessController,
): TerminalInteractionDefinition<NeoviewInputBindingsTuiInput, NeoviewInputBindingsTuiResult> {
  return {
    schema: createNeoviewInputBindingsTuiSchema(language),
    async run(input) {
      try {
        if (input.action === "dispatch" || input.action === "dispatch-binding") {
          const controller = await createController()
          try {
            await controller.open({ path: input.path ?? "" })
            const dispatch = input.action === "dispatch-binding"
              ? await executeReaderHeadlessInputBinding(await service.inspect(), input.input!, input.contexts ?? ["reader"], controller)
              : await executeReaderHeadlessInputAction(input.inputAction!, controller)
            const handled = "result" in dispatch ? dispatch.result.handled : "handled" in dispatch ? dispatch.handled : false
            const action = "result" in dispatch ? dispatch.result.action : "action" in dispatch ? dispatch.action : input.inputAction ?? "configured input"
            const reason = "result" in dispatch && !dispatch.result.handled
              ? dispatch.result.reason
              : !handled && "reason" in dispatch ? dispatch.reason : undefined
            return { success: handled, message: handled ? `Input action handled: ${action}.` : `Input action unsupported: ${action} (${reason}).`, dispatch }
          } finally {
            await controller[Symbol.asyncDispose]()
          }
        }
        if (input.action === "inspect") {
          const config = await service.inspect()
          return { success: true, message: `${config.bindings.length} input binding(s).`, config }
        }
        if (input.action === "reset") {
          const result = await service.reset(true)
          return { success: true, message: result.changed ? "Input bindings reset." : "Input bindings already use defaults.", config: result.config }
        }
        const result = await service.apply(input.bindings ?? [], true)
        return { success: true, message: result.changed ? "Input bindings updated." : "Input bindings unchanged.", config: result.config }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

function createNeoviewTuiSchema(language: "zh" | "en"): TerminalInteractionSchema<NeoviewTuiInput, NeoviewTuiResult> {
  const zh = language === "zh"
  return {
    id: "neoview",
    title: "NeoView",
    description: zh ? "图像与漫画阅读工作台" : "Image and comic reader workbench",
    initialValues: { path: "" },
    fields: [{
      id: "path",
      label: zh ? "书籍路径" : "Book path",
      kind: "text",
      placeholder: zh ? "图像、目录、CBZ、CBR 或 CB7" : "Image, directory, CBZ, CBR or CB7",
    }],
    toInput: (values: Readonly<InteractionValues>) => ({ path: String(values.path ?? "").trim() }),
    validate: (_values, input) => input.path ? null : zh ? "请输入书籍路径。" : "Enter a book path.",
    preview: (input) => [input.path],
    isDangerous: () => false,
    result: (result) => ({
      success: result.success,
      message: result.message,
      lines: result.snapshot ? [`${result.snapshot.book.pageCount} page(s)`] : [],
    }),
  }
}

function createNeoviewBookSettingsTuiSchema(
  language: "zh" | "en",
): TerminalInteractionSchema<NeoviewBookSettingsTuiInput, NeoviewBookSettingsTuiResult> {
  const zh = language === "zh"
  const setting = (values: Readonly<InteractionValues>) => values.action === "set"
  const keep = zh ? "保持不变" : "Keep unchanged"
  const inherit = zh ? "继承全局" : "Inherit global"
  return {
    id: "neoview-book-settings",
    title: zh ? "NeoView 本书设置" : "NeoView Book Settings",
    description: zh ? "读取或更新规范的本书覆盖" : "Read or update canonical per-book overrides",
    initialValues: {
      action: "get",
      path: "",
      favorite: "keep",
      rating: "keep",
      direction: "keep",
      pageMode: "keep",
      horizontalBook: "keep",
    },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: [
        { value: "get", label: zh ? "查看" : "Get" },
        { value: "set", label: zh ? "更新" : "Set" },
      ] },
      { id: "path", label: zh ? "书籍路径" : "Book path", kind: "text" },
      { id: "favorite", label: zh ? "收藏" : "Favorite", kind: "select", visibleWhen: setting, options: [
        { value: "keep", label: keep }, { value: "inherit", label: inherit },
        { value: "true", label: zh ? "收藏" : "Favorite" }, { value: "false", label: zh ? "不收藏" : "Not favorite" },
      ] },
      { id: "rating", label: zh ? "评分" : "Rating", kind: "select", visibleWhen: setting, options: [
        { value: "keep", label: keep }, { value: "inherit", label: inherit },
        ...[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} / 5` })),
      ] },
      { id: "direction", label: zh ? "阅读方向" : "Direction", kind: "select", visibleWhen: setting, options: [
        { value: "keep", label: keep }, { value: "inherit", label: inherit },
        { value: "left-to-right", label: zh ? "从左到右" : "Left to right" },
        { value: "right-to-left", label: zh ? "从右到左" : "Right to left" },
      ] },
      { id: "pageMode", label: zh ? "页面模式" : "Page mode", kind: "select", visibleWhen: setting, options: [
        { value: "keep", label: keep }, { value: "inherit", label: inherit },
        { value: "single", label: zh ? "单页" : "Single" }, { value: "double", label: zh ? "双页" : "Double" },
      ] },
      { id: "horizontalBook", label: zh ? "横版本子" : "Horizontal book", kind: "select", visibleWhen: setting, options: [
        { value: "keep", label: keep }, { value: "inherit", label: inherit },
        { value: "true", label: zh ? "启用" : "Enabled" }, { value: "false", label: zh ? "禁用" : "Disabled" },
      ] },
    ],
    toInput: (values) => ({
      action: values.action === "set" ? "set" : "get",
      path: String(values.path ?? "").trim(),
      patch: values.action === "set" ? bookSettingsPatchFromInteraction(values) : undefined,
    }),
    validate: (_values, input) => !input.path
      ? (zh ? "请输入书籍路径。" : "Enter a book path.")
      : input.action === "set" && !Object.keys(input.patch ?? {}).length
        ? (zh ? "至少选择一项要更新的设置。" : "Select at least one setting to update.")
        : null,
    preview: (input) => [input.path, input.action, ...Object.entries(input.patch ?? {}).map(([key, value]) => `${key}=${String(value)}`)],
    isDangerous: () => false,
    result: (result) => ({
      success: result.success,
      message: result.message,
      lines: result.settings ? bookSettingsResultLines(result.settings) : [],
    }),
  }
}

function createNeoviewBookSettingsMigrationTuiSchema(
  language: "zh" | "en",
): TerminalInteractionSchema<NeoviewBookSettingsMigrationTuiInput, NeoviewBookSettingsMigrationTuiResult> {
  const zh = language === "zh"
  const importing = (values: Readonly<InteractionValues>) => values.action === "import"
  return {
    id: "neoview-book-settings-migration",
    title: zh ? "NeoView 本书设置迁移" : "NeoView Book Settings Migration",
    description: zh ? "检查并导入旧 neoview-book-settings" : "Inspect and import legacy neoview-book-settings",
    initialValues: { action: "inspect", inputPath: "", databasePath: "", strategy: "merge" },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: [
        { value: "inspect", label: zh ? "检查" : "Inspect" },
        { value: "import", label: zh ? "导入" : "Import" },
      ] },
      { id: "inputPath", label: zh ? "旧设置 JSON" : "Legacy settings JSON", kind: "text" },
      { id: "databasePath", label: zh ? "thumbnails.db（可选）" : "thumbnails.db (optional)", kind: "text", visibleWhen: importing },
      { id: "strategy", label: zh ? "策略" : "Strategy", kind: "select", visibleWhen: importing, options: [
        { value: "merge", label: zh ? "合并" : "Merge" },
        { value: "overwrite", label: zh ? "覆盖" : "Overwrite" },
      ] },
    ],
    toInput: (values) => ({
      action: values.action === "import" ? "import" : "inspect",
      inputPath: String(values.inputPath ?? "").trim(),
      databasePath: String(values.databasePath ?? "").trim() || undefined,
      strategy: values.strategy === "overwrite" ? "overwrite" : "merge",
    }),
    validate: (_values, input) => input.inputPath ? null : zh ? "请输入旧设置 JSON 路径。" : "Enter the legacy settings JSON path.",
    preview: (input) => [input.inputPath, input.action, ...(input.databasePath ? [input.databasePath] : []), input.strategy],
    isDangerous: (input) => input.action === "import",
    dangerPrompt: (input) => ({
      title: zh ? "确认导入本书设置" : "Confirm book settings import",
      body: zh
        ? `将以${input.strategy === "merge" ? "合并" : "覆盖"}策略写入兼容 NeoView 数据库。`
        : `This writes the compatible NeoView database using ${input.strategy}.`,
      confirmLabel: zh ? "确认导入" : "Import",
    }),
    result: (result) => {
      const report = result.imported?.report ?? result.inspection?.report
      const applied = result.imported?.result.applied
      return {
        success: result.success,
        message: result.message,
        lines: report ? [
          `valid=${report.validEntries}/${report.totalEntries}`,
          `invalidEntries=${report.invalidEntries} invalidFields=${report.invalidFields} unknownFields=${report.unknownFields}`,
          ...(applied ? [`inserted=${applied.inserted} updated=${applied.updated} unchanged=${applied.unchanged}`] : []),
        ] : [],
      }
    },
  }
}

function createNeoviewUpscaleCacheTuiSchema(
  language: "zh" | "en",
): TerminalInteractionSchema<NeoviewUpscaleCacheTuiInput, NeoviewUpscaleCacheTuiResult> {
  const zh = language === "zh"
  return {
    id: "neoview-upscale-cache",
    title: zh ? "NeoView 超分缓存" : "NeoView Upscale Cache",
    description: zh ? "检查或清理运行中 Reader 的超分 artifact 缓存" : "Inspect or clean the running Reader upscale artifact cache",
    initialValues: { action: "stats", path: "" },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: [
        { value: "stats", label: zh ? "缓存统计" : "Cache stats" },
        { value: "cleanup-age", label: zh ? "清理过期缓存" : "Clean expired artifacts" },
        { value: "cleanup-book", label: zh ? "清理当前书籍" : "Clean current book" },
        { value: "clear-all", label: zh ? "清空全部缓存" : "Clear all artifacts" },
      ] },
      { id: "path", label: zh ? "书籍路径" : "Book path", kind: "text" },
    ],
    toInput: (values) => ({
      action: isUpscaleCacheTuiAction(values.action) ? values.action : "stats",
      path: String(values.path ?? "").trim(),
    }),
    validate: (_values, input) => input.path ? null : zh ? "请输入书籍路径。" : "Enter a book path.",
    preview: (input) => [input.path, input.action],
    isDangerous: (input) => input.action !== "stats",
    dangerPrompt: (input) => ({
      title: zh ? "确认清理超分缓存" : "Confirm upscale cache cleanup",
      body: input.action === "clear-all"
        ? (zh ? "将清空运行中 Reader 的全部超分 artifact。" : "This clears every upscale artifact owned by the running Reader.")
        : input.action === "cleanup-book"
          ? (zh ? "将清理当前书籍的超分 artifact。" : "This clears upscale artifacts for the selected book.")
          : (zh ? "将清理超过保留期限的超分 artifact。" : "This clears upscale artifacts older than the retention limit."),
      confirmLabel: zh ? "确认清理" : "Clean",
    }),
    result: (result) => ({
      success: result.success,
      message: result.message,
      lines: result.snapshot ? upscaleCacheResultLines(result.snapshot) : [],
    }),
  }
}

function createNeoviewDiagnosticsHistoryTuiSchema(
  language: "zh" | "en",
): TerminalInteractionSchema<NeoviewDiagnosticsHistoryTuiInput, NeoviewDiagnosticsHistoryTuiResult> {
  const zh = language === "zh"
  return {
    id: "neoview-diagnostics-history",
    title: zh ? "NeoView 诊断历史" : "NeoView Diagnostics History",
    description: zh ? "从运行中的 Reader 导出有界诊断历史" : "Export bounded diagnostics history from the running Reader",
    initialValues: { format: "json", sinceMs: "", limit: 100 },
    fields: [
      { id: "format", label: zh ? "格式" : "Format", kind: "select", options: [
        { value: "json", label: "JSON" },
        { value: "csv", label: "CSV" },
      ] },
      { id: "sinceMs", label: zh ? "起始时间戳（可选）" : "First timestamp (optional)", kind: "text" },
      { id: "limit", label: zh ? "样本上限" : "Sample limit", kind: "number", min: 1, max: 1000, step: 1 },
    ],
    toInput: (values) => ({
      format: values.format === "csv" ? "csv" : "json",
      sinceMs: optionalSafeInteger(values.sinceMs),
      limit: optionalSafeInteger(values.limit),
    }),
    validate: (values, input) => invalidOptionalSafeInteger(values.sinceMs)
      ? (zh ? "起始时间戳必须是安全整数。" : "First timestamp must be a safe integer.")
      : input.limit === undefined || input.limit < 1 || input.limit > 1000
        ? (zh ? "样本上限必须在 1 到 1000 之间。" : "Sample limit must be between 1 and 1000.")
        : null,
    preview: (input) => [input.format, `limit=${input.limit}`, ...(input.sinceMs === undefined ? [] : [`sinceMs=${input.sinceMs}`])],
    isDangerous: () => false,
    result: (result) => ({
      success: result.success,
      message: result.message,
      lines: result.history
        ? [`samples=${result.history.samples.length} droppedSamples=${result.history.droppedSamples}`, ...(result.body?.split("\n").filter(Boolean) ?? [])]
        : [],
    }),
  }
}

function optionalSafeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function invalidOptionalSafeInteger(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "" && !Number.isSafeInteger(Number(value))
}

function isUpscaleCacheTuiAction(value: unknown): value is NeoviewUpscaleCacheTuiInput["action"] {
  return value === "stats" || value === "cleanup-age" || value === "cleanup-book" || value === "clear-all"
}

function upscaleCacheActionKind(action: Exclude<NeoviewUpscaleCacheTuiInput["action"], "stats">): RemoteSuperResolutionArtifactCacheCleanupKind {
  if (action === "cleanup-age") return "age"
  if (action === "cleanup-book") return "book"
  return "all"
}

function upscaleCacheResultLines(
  snapshot: RemoteSuperResolutionArtifactCacheSnapshot | RemoteSuperResolutionArtifactCacheCleanupResult,
): string[] {
  return [
    `entries=${snapshot.entries} bytes=${snapshot.bytes}/${snapshot.maxBytes}`,
    `activeLeases=${snapshot.activeLeases} hits=${snapshot.hits} misses=${snapshot.misses} writes=${snapshot.writes}`,
    `rejectedWrites=${snapshot.rejectedWrites} evictions=${snapshot.evictions} integrityFailures=${snapshot.integrityFailures}`,
    ...(isUpscaleCacheCleanupResult(snapshot) ? [`removedEntries=${snapshot.removedEntries} removedBytes=${snapshot.removedBytes} reason=${snapshot.reason}`] : []),
  ]
}

function isUpscaleCacheCleanupResult(
  snapshot: RemoteSuperResolutionArtifactCacheSnapshot | RemoteSuperResolutionArtifactCacheCleanupResult,
): snapshot is RemoteSuperResolutionArtifactCacheCleanupResult {
  return "removedEntries" in snapshot && "removedBytes" in snapshot && "reason" in snapshot
}

function bookSettingsPatchFromInteraction(values: Readonly<InteractionValues>): ReaderBookSettingsPatch {
  const patch: ReaderBookSettingsPatch = {}
  const favorite = interactionBooleanOverride(values.favorite)
  const horizontalBook = interactionBooleanOverride(values.horizontalBook)
  const rating = values.rating === "inherit" ? null : /^[1-5]$/.test(String(values.rating ?? "")) ? Number(values.rating) : undefined
  const direction = values.direction === "inherit" ? null
    : values.direction === "left-to-right" || values.direction === "right-to-left" ? values.direction : undefined
  const pageMode = values.pageMode === "inherit" ? null
    : values.pageMode === "single" || values.pageMode === "double" ? values.pageMode : undefined
  if (favorite !== undefined) patch.favorite = favorite
  if (rating !== undefined) patch.rating = rating
  if (direction !== undefined) patch.direction = direction
  if (pageMode !== undefined) patch.pageMode = pageMode
  if (horizontalBook !== undefined) patch.horizontalBook = horizontalBook
  return patch
}

function interactionBooleanOverride(value: unknown): boolean | null | undefined {
  if (value === "inherit") return null
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

function bookSettingsResultLines(settings: ReaderBookSettingsSnapshot): string[] {
  return (["favorite", "rating", "direction", "pageMode", "horizontalBook"] as const).map((key) => (
    `${key}: ${String(settings.effective[key])} (${settings.inherited.includes(key) ? "inherited" : "override"})`
  ))
}

const READER_DIRECTORY_FILTER_OPTIONS: Array<{ value: ReaderDirectoryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "archive", label: "Archive" },
  { value: "directory", label: "Directory" },
  { value: "video", label: "Video" },
]

function readerDirectoryFilterValue(value: unknown): ReaderDirectoryFilter {
  return value === "archive" || value === "directory" || value === "video" ? value : "all"
}

function interactionTagList(value: unknown): string[] | undefined {
  const tags = String(value ?? "").split(/[\r\n,]+/).map((tag) => tag.trim()).filter(Boolean)
  return tags.length ? [...new Set(tags)] : undefined
}

function emmEditCommandFromInteraction(generation: number, input: NeoviewFileTreeTuiInput): ReaderDirectoryEmmEditCommand {
  let decoded: unknown
  try {
    decoded = JSON.parse(input.emmUpdatesJson ?? "")
  } catch {
    throw new Error("EMM updates must be valid JSON.")
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("EMM updates must be an object containing updates.")
  }
  const record = decoded as Record<string, unknown>
  return {
    generation,
    updates: record.updates as ReaderDirectoryEmmEditCommand["updates"],
    ...(input.emmConcurrency === undefined ? {} : { concurrency: input.emmConcurrency }),
  }
}

function createNeoviewFileTreeTuiSchema(language: "zh" | "en"): TerminalInteractionSchema<NeoviewFileTreeTuiInput, NeoviewFileTreeTuiResult> {
  const zh = language === "zh"
  const search = (values: Readonly<InteractionValues>) => values.action === "search"
  const searchOrSuggestions = (values: Readonly<InteractionValues>) => values.action === "search" || values.action === "emm-tags"
  const emmEdit = (values: Readonly<InteractionValues>) => values.action === "emm-edit"
  const query = (values: Readonly<InteractionValues>) => values.action === "search" || values.action === "delete-history"
  const history = (values: Readonly<InteractionValues>) => values.action === "history" || values.action === "delete-history" || values.action === "clear-history"
  const needsPath = (action: NeoviewFileTreeTuiAction) => action !== "history" && action !== "delete-history" && action !== "clear-history" && action !== "emm-tags"
  return {
    id: "neoview-file-tree",
    title: "NeoView File Tree",
    description: zh ? "目录树、递归搜索与排除规则" : "Directory tree, recursive search and exclusions",
    initialValues: { action: "tree", path: "", query: "", mode: "text", filter: "all", includeTags: "", excludeTags: "", tagMode: "all", emmUpdatesJson: "", emmConcurrency: 4, maximumDepth: 10, maximumResults: 512, caseSensitive: false, searchInPath: false },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: [
        { value: "tree", label: zh ? "展开树节点" : "Expand tree node" },
        { value: "search", label: zh ? "递归搜索" : "Recursive search" },
        { value: "exclude", label: zh ? "排除目录" : "Exclude directory" },
        { value: "include", label: zh ? "取消排除" : "Include directory" },
        { value: "clear-cache", label: zh ? "清理树缓存" : "Clear tree cache" },
        { value: "history", label: zh ? "搜索历史" : "Search history" },
        { value: "delete-history", label: zh ? "删除搜索记录" : "Delete search entry" },
        { value: "clear-history", label: zh ? "清空搜索历史" : "Clear search history" },
        { value: "emm-tags", label: zh ? "EMM 标签建议" : "EMM tag suggestions" },
        { value: "emm-edit", label: zh ? "编辑 EMM 元数据" : "Edit EMM metadata" },
      ] },
      { id: "path", label: zh ? "目录路径" : "Directory path", kind: "text" },
      { id: "query", label: zh ? "搜索内容" : "Query", kind: "text", visibleWhen: query },
      { id: "scope", label: zh ? "历史范围" : "History scope", kind: "select", options: [
        { value: "folder", label: zh ? "文件夹" : "Folder" },
        { value: "file", label: zh ? "文件" : "File" },
        { value: "bookmark", label: zh ? "书签" : "Bookmark" },
        { value: "history", label: zh ? "阅读历史" : "Reading history" },
      ], visibleWhen: history },
      { id: "mode", label: zh ? "匹配方式" : "Match mode", kind: "select", options: [{ value: "text", label: zh ? "文本" : "Text" }, { value: "glob", label: "Glob" }], visibleWhen: search },
      { id: "filter", label: zh ? "类型筛选" : "Type filter", kind: "select", options: READER_DIRECTORY_FILTER_OPTIONS, visibleWhen: search },
      { id: "includeTags", label: zh ? "包含 EMM 标签" : "Required EMM tags", kind: "text", visibleWhen: search },
      { id: "excludeTags", label: zh ? "排除 EMM 标签" : "Excluded EMM tags", kind: "text", visibleWhen: search },
      { id: "tagMode", label: zh ? "标签组合" : "Tag mode", kind: "select", options: [{ value: "all", label: zh ? "全部匹配" : "Match all" }, { value: "any", label: zh ? "任一匹配" : "Match any" }], visibleWhen: search },
      { id: "emmUpdatesJson", label: zh ? "EMM 更新 JSON" : "EMM updates JSON", kind: "text", visibleWhen: emmEdit },
      { id: "emmConcurrency", label: zh ? "EMM 更新并发" : "EMM edit concurrency", kind: "number", min: 1, max: 8, step: 1, visibleWhen: emmEdit },
      { id: "maximumDepth", label: zh ? "最大深度" : "Maximum depth", kind: "number", min: 0, max: 4096, step: 1, visibleWhen: search },
      { id: "maximumResults", label: zh ? "结果上限" : "Result limit", kind: "number", min: 1, max: 10000, step: 1, visibleWhen: searchOrSuggestions },
      { id: "caseSensitive", label: zh ? "区分大小写" : "Case sensitive", kind: "boolean", visibleWhen: search },
      { id: "searchInPath", label: zh ? "匹配相对路径" : "Match relative paths", kind: "boolean", visibleWhen: search },
    ],
    toInput: (values) => ({
      action: isFileTreeAction(values.action) ? values.action : "tree",
      path: String(values.path ?? "").trim(),
      query: String(values.query ?? "").trim(),
      mode: values.mode === "glob" ? "glob" : "text",
      filter: readerDirectoryFilterValue(values.filter),
      includeTags: interactionTagList(values.includeTags),
      excludeTags: interactionTagList(values.excludeTags),
      tagMode: values.tagMode === "any" ? "any" : "all",
      emmUpdatesJson: String(values.emmUpdatesJson ?? "").trim(),
      emmConcurrency: Number(values.emmConcurrency ?? 4),
      maximumDepth: Number(values.maximumDepth ?? 10),
      maximumResults: Number(values.maximumResults ?? 512),
      caseSensitive: values.caseSensitive === true,
      searchInPath: values.searchInPath === true,
      scope: isSearchHistoryScope(values.scope) ? values.scope : "folder",
    }),
    validate: (_values, input) => needsPath(input.action) && !input.path
      ? (zh ? "请输入目录路径。" : "Enter a directory path.")
      : input.action === "search" && !input.query && !input.includeTags?.length && !input.excludeTags?.length
        ? (zh ? "请输入搜索内容或 EMM 标签。" : "Enter a search query or EMM tags.")
        : input.action === "emm-edit" && !input.emmUpdatesJson
          ? (zh ? "请输入 EMM 更新 JSON。" : "Enter EMM updates JSON.")
        : input.action === "delete-history" && !input.query
        ? (zh ? "请输入搜索内容。" : "Enter a search query.")
        : null,
    preview: (input) => [input.path, input.action === "search" ? `${input.mode}: ${input.query}` : input.action],
    isDangerous: (input) => input.action === "exclude" || input.action === "include" || input.action === "clear-cache" || input.action === "delete-history" || input.action === "clear-history" || input.action === "emm-edit",
    dangerPrompt: (input) => ({
      title: zh ? "确认文件树操作" : "Confirm file-tree operation",
      body: input.action === "clear-cache"
        ? (zh ? "将清理当前有界树缓存。" : "The bounded file-tree cache will be cleared.")
        : input.action === "emm-edit"
          ? (zh ? "将非破坏性写入原 NeoView thumbnails.db 的 xr_ EMM 覆盖表。" : "This writes EMM overrides to the xr_ namespace in the original NeoView thumbnails.db.")
        : input.action === "delete-history" || input.action === "clear-history"
          ? (zh ? "将删除 NeoView 主数据库中的搜索历史。" : "This removes search history from the NeoView primary database.")
        : (zh ? "将修改 [nodes.neoview.folder.tree] 排除设置。" : "This changes [nodes.neoview.folder.tree] exclusions."),
      confirmLabel: zh ? "确认" : "Confirm",
    }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.paths }),
  }
}

function createNeoviewLibraryTuiSchema(language: "zh" | "en"): TerminalInteractionSchema<NeoviewLibraryTuiInput, NeoviewLibraryTuiResult> {
  const zh = language === "zh"
  const actionIs = (...actions: NeoviewLibraryTuiAction[]) => (values: Readonly<InteractionValues>) => actions.includes(values.action as NeoviewLibraryTuiAction)
  const destructive = new Set<NeoviewLibraryTuiAction>(["cleanup-recents", "cleanup-recents-oldest", "cleanup-recents-folder", "clear-recents", "cleanup-invalid", "delete-recent", "delete-bookmark", "delete-bookmarks", "delete-bookmark-list"])
  return {
    id: "neoview-library",
    title: "NeoView Library",
    description: zh ? "最近阅读、书签和书签列表" : "Recent reading, bookmarks and bookmark lists",
    initialValues: { action: "list-recents", path: "", id: "", name: "", listId: "", filter: "all", before: Date.now(), limit: 100, starred: false, favorite: false },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: LIBRARY_ACTIONS.map(([value, en, cn]) => ({ value, label: zh ? cn : en })) },
      { id: "path", label: zh ? "路径" : "Path", kind: "text", visibleWhen: actionIs("add-bookmark", "cleanup-recents-folder") },
      { id: "id", label: "ID", kind: "text", visibleWhen: actionIs("delete-recent", "delete-bookmark", "add-bookmark-list", "delete-bookmark-list") },
      { id: "name", label: zh ? "名称" : "Name", kind: "text", visibleWhen: actionIs("add-bookmark", "add-bookmark-list") },
      { id: "listId", label: zh ? "书签列表 ID" : "Bookmark list ID", kind: "text", visibleWhen: actionIs("list-bookmarks", "add-bookmark") },
      { id: "batchIds", label: zh ? "书签 ID（逗号分隔）" : "Bookmark IDs (comma-separated)", kind: "text", visibleWhen: actionIs("update-bookmarks", "delete-bookmarks") },
      { id: "batchListIds", label: zh ? "列表 ID（逗号分隔）" : "List IDs (comma-separated)", kind: "text", visibleWhen: actionIs("update-bookmarks") },
      { id: "filter", label: zh ? "类型筛选" : "Type filter", kind: "select", options: READER_DIRECTORY_FILTER_OPTIONS, visibleWhen: actionIs("list-recents", "list-bookmarks") },
      { id: "before", label: zh ? "早于时间戳" : "Before timestamp", kind: "number", min: 0, max: Number.MAX_SAFE_INTEGER, step: 1, visibleWhen: actionIs("cleanup-recents") },
      { id: "cleanupKind", label: zh ? "清理范围" : "Cleanup scope", kind: "select", options: [
        { value: "both", label: zh ? "历史与书签" : "Recents and bookmarks" },
        { value: "recents", label: zh ? "历史" : "Recents" },
        { value: "bookmarks", label: zh ? "书签" : "Bookmarks" },
      ], visibleWhen: actionIs("cleanup-invalid") },
      { id: "limit", label: zh ? "数量上限" : "Limit", kind: "number", min: 1, max: 500, step: 1, visibleWhen: actionIs("list-recents", "cleanup-recents", "cleanup-recents-oldest", "cleanup-invalid", "list-bookmarks") },
      { id: "concurrency", label: zh ? "检查并发" : "Check concurrency", kind: "number", min: 1, max: 16, step: 1, visibleWhen: actionIs("cleanup-invalid") },
      { id: "starred", label: zh ? "收藏" : "Starred", kind: "boolean", visibleWhen: actionIs("add-bookmark") },
      { id: "favorite", label: zh ? "收藏列表" : "Favorite list", kind: "boolean", visibleWhen: actionIs("add-bookmark-list") },
    ],
    toInput: (values) => ({
      action: isLibraryAction(values.action) ? values.action : "list-recents",
      path: String(values.path ?? "").trim(),
      id: String(values.id ?? "").trim(),
      name: String(values.name ?? "").trim(),
      listId: String(values.listId ?? "").trim() || undefined,
      batchIds: String(values.batchIds ?? "").trim(),
      batchListIds: String(values.batchListIds ?? "").trim(),
      filter: readerDirectoryFilterValue(values.filter),
      before: Number(values.before ?? 0),
      limit: Number(values.limit ?? 100),
      starred: values.starred === true,
      favorite: values.favorite === true,
      cleanupKind: values.cleanupKind === "recents" || values.cleanupKind === "bookmarks" ? values.cleanupKind : "both",
      concurrency: Number(values.concurrency ?? 8),
    }),
    validate: (_values, input) => (input.action === "add-bookmark" || input.action === "cleanup-recents-folder") && !input.path
      ? (zh ? "请输入书签路径。" : "Enter a bookmark path.")
      : input.action === "add-bookmark-list" && !input.name
        ? (zh ? "请输入列表名称。" : "Enter a list name.")
        : (input.action === "update-bookmarks" || input.action === "delete-bookmarks") && !input.batchIds
          ? (zh ? "请输入书签 ID。" : "Enter bookmark IDs.")
          : input.action === "update-bookmarks" && !input.batchListIds
            ? (zh ? "请输入列表 ID。" : "Enter list IDs.")
        : (input.action === "delete-recent" || input.action === "delete-bookmark" || input.action === "delete-bookmark-list") && !input.id
          ? (zh ? "请输入 ID。" : "Enter an ID.")
          : null,
    preview: (input) => [input.action, input.path || input.id || input.name || ""].filter(Boolean),
    isDangerous: (input) => destructive.has(input.action),
    dangerPrompt: () => ({ title: zh ? "确认删除" : "Confirm deletion", body: zh ? "该操作会修改 NeoView 主数据库。" : "This operation modifies the NeoView primary database.", confirmLabel: zh ? "确认" : "Confirm" }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.lines }),
  }
}

function createNeoviewFileOperationTuiSchema(language: "zh" | "en"): TerminalInteractionSchema<NeoviewFileOperationTuiInput, NeoviewFileOperationTuiResult> {
  const zh = language === "zh"
  const needsSource = (values: Readonly<InteractionValues>) => values.action !== "create-directory" && values.action !== "undo" && values.action !== "discard-undo"
  const needsDestination = (values: Readonly<InteractionValues>) => values.action === "copy" || values.action === "move" || values.action === "rename" || values.action === "create-directory"
  const supportsOverwrite = (values: Readonly<InteractionValues>) => values.action === "copy" || values.action === "move" || values.action === "rename"
  return {
    id: "neoview-file-operations",
    title: "NeoView File Operations",
    description: zh ? "复制、移动、重命名、删除与新建目录" : "Copy, move, rename, delete and create directories",
    initialValues: { action: "copy", sourcePath: "", destinationPath: "", overwrite: false },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: FILE_OPERATION_ACTIONS.map(([value, en, cn]) => ({ value, label: zh ? cn : en })) },
      { id: "sourcePath", label: zh ? "源路径" : "Source path", kind: "text", visibleWhen: needsSource },
      { id: "destinationPath", label: zh ? "目标路径" : "Destination path", kind: "text", visibleWhen: needsDestination },
      { id: "overwrite", label: zh ? "允许覆盖" : "Allow overwrite", kind: "boolean", visibleWhen: supportsOverwrite },
    ],
    toInput: (values) => ({
      action: isFileOperationAction(values.action) ? values.action : "copy",
      sourcePath: String(values.sourcePath ?? "").trim(),
      destinationPath: String(values.destinationPath ?? "").trim(),
      overwrite: values.overwrite === true,
    }),
    validate: (_values, input) => input.action !== "create-directory" && input.action !== "undo" && input.action !== "discard-undo" && !input.sourcePath
      ? (zh ? "请输入源路径。" : "Enter a source path.")
      : (input.action === "copy" || input.action === "move" || input.action === "rename" || input.action === "create-directory") && !input.destinationPath
        ? (zh ? "请输入目标路径。" : "Enter a destination path.")
        : null,
    preview: (input) => [input.action, input.sourcePath ?? "", input.destinationPath ?? ""].filter(Boolean),
    isDangerous: (input) => input.action === "delete" || input.action === "trash" || input.action === "undo" || input.action === "discard-undo",
    dangerPrompt: (input) => ({
      title: zh ? "确认文件操作" : "Confirm file operation",
      body: input.action === "delete"
        ? (zh ? "该路径将被永久删除。" : "The path will be permanently deleted.")
        : input.action === "trash"
          ? (zh ? "该路径将移动到系统回收站。" : "The path will be moved to the system trash.")
          : input.action === "undo"
            ? (zh ? "将撤销最近一批仍通过安全校验的文件操作。" : "The latest file-operation batch will be undone after safety checks.")
            : (zh ? "将丢弃最新的撤销记录，文件本身不会改变。" : "The latest undo record will be discarded without changing files."),
      confirmLabel: zh ? "确认" : "Confirm",
    }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.lines }),
  }
}

function createNeoviewInputBindingsTuiSchema(language: "zh" | "en"): TerminalInteractionSchema<NeoviewInputBindingsTuiInput, NeoviewInputBindingsTuiResult> {
  const zh = language === "zh"
  const applying = (values: Readonly<InteractionValues>) => values.action === "apply"
  const dispatching = (values: Readonly<InteractionValues>) => values.action === "dispatch" || values.action === "dispatch-binding"
  return {
    id: "neoview-input-bindings",
    title: zh ? "NeoView 操作绑定" : "NeoView Input Bindings",
    description: zh ? "查看、批量应用或恢复多设备操作绑定" : "Inspect, apply or reset multi-device operation bindings",
    initialValues: { action: "inspect", bindingsJson: "[]", path: "", inputAction: "reader.next-page" },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: [
        { value: "inspect", label: zh ? "查看绑定" : "Inspect bindings" },
        { value: "apply", label: zh ? "应用完整绑定 JSON" : "Apply complete bindings JSON" },
        { value: "reset", label: zh ? "恢复默认绑定" : "Reset defaults" },
        { value: "dispatch", label: zh ? "派发动作" : "Dispatch action" },
        { value: "dispatch-binding", label: zh ? "按绑定派发输入" : "Dispatch configured input" },
      ] },
      { id: "bindingsJson", label: zh ? "绑定数组 JSON" : "Bindings array JSON", kind: "multiline", lines: 14, visibleWhen: applying },
      { id: "path", label: zh ? "书籍路径" : "Book path", kind: "text", visibleWhen: dispatching },
      { id: "inputAction", label: zh ? "动作 ID" : "Action ID", kind: "text", visibleWhen: dispatching },
      { id: "inputJson", label: zh ? "输入 JSON" : "Input JSON", kind: "multiline", lines: 5, visibleWhen: (values) => values.action === "dispatch-binding" },
      { id: "contextsJson", label: zh ? "上下文 JSON" : "Contexts JSON", kind: "text", visibleWhen: (values) => values.action === "dispatch-binding" },
    ],
    toInput: (values) => ({
      action: values.action === "apply" || values.action === "reset" || values.action === "dispatch" || values.action === "dispatch-binding" ? values.action : "inspect",
      bindings: values.action === "apply" ? parseBindingsJson(values.bindingsJson) : undefined,
      path: values.action === "dispatch" || values.action === "dispatch-binding" ? String(values.path ?? "").trim() : undefined,
      inputAction: values.action === "dispatch" ? inputActionValue(values.inputAction) : undefined,
      input: values.action === "dispatch-binding" ? parseInputDescriptor(values.inputJson) : undefined,
      contexts: values.action === "dispatch-binding" ? parseInputContexts(values.contextsJson) : undefined,
    }),
    validate: (values, input) => input.action === "apply"
      ? bindingJsonError(values.bindingsJson, zh)
      : (input.action === "dispatch" || input.action === "dispatch-binding") && !input.path
        ? (zh ? "请输入书籍路径。" : "Enter a book path.")
        : input.action === "dispatch" && !input.inputAction
          ? (zh ? "请输入有效的 XR 或旧动作 ID。" : "Enter a valid XR or legacy action ID.")
          : input.action === "dispatch-binding" && !input.input
            ? (zh ? "请输入有效的输入 descriptor JSON。" : "Enter a valid input descriptor JSON.")
          : null,
    preview: (input) => input.action === "apply"
      ? [zh ? `绑定数：${input.bindings?.length ?? 0}` : `Bindings: ${input.bindings?.length ?? 0}`]
      : input.action === "dispatch" ? [input.path ?? "", input.inputAction ?? ""]
        : input.action === "dispatch-binding" ? [input.path ?? "", JSON.stringify(input.input), JSON.stringify(input.contexts)]
        : [input.action],
    isDangerous: (input) => input.action === "apply" || input.action === "reset",
    dangerPrompt: (input) => ({
      title: zh ? "确认修改操作绑定" : "Confirm input binding change",
      body: input.action === "reset"
        ? (zh ? "将用规范默认值替换全部操作绑定。" : "All input bindings will be replaced with canonical defaults.")
        : (zh ? `将原子替换为 ${input.bindings?.length ?? 0} 条绑定。` : `The configuration will be atomically replaced with ${input.bindings?.length ?? 0} binding(s).`),
      confirmLabel: zh ? "确认应用" : "Apply",
    }),
    result: (result) => ({
      success: result.success,
      message: result.message,
      lines: result.config
        ? JSON.stringify(result.config.bindings, null, 2).split("\n")
        : result.dispatch ? [JSON.stringify(result.dispatch)] : [],
    }),
  }
}

function parseBindingsJson(value: unknown): ReaderInputBinding[] {
  try {
    const parsed = JSON.parse(String(value ?? "")) as unknown
    const bindings = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.bindings) ? parsed.bindings : []
    return bindings as ReaderInputBinding[]
  } catch {
    return []
  }
}

function bindingJsonError(value: unknown, zh: boolean): string | null {
  try {
    const parsed = JSON.parse(String(value ?? "")) as unknown
    if (Array.isArray(parsed) || isRecord(parsed) && Array.isArray(parsed.bindings)) return null
    return zh ? "请输入绑定数组或 { bindings: [...] }。" : "Enter a bindings array or { bindings: [...] }."
  } catch (error) {
    return zh ? `绑定 JSON 无效：${error instanceof Error ? error.message : String(error)}` : `Invalid bindings JSON: ${error instanceof Error ? error.message : String(error)}`
  }
}

function inputActionValue(value: unknown): ReaderInputAction | undefined {
  if (typeof value !== "string") return undefined
  if (READER_INPUT_ACTIONS.includes(value as ReaderInputAction)) return value as ReaderInputAction
  return readerInputActionFromLegacyId(value)
}

const FILE_OPERATION_ACTIONS: ReadonlyArray<readonly [NeoviewFileOperationTuiAction, string, string]> = [
  ["copy", "Copy", "复制"], ["move", "Move", "移动"], ["rename", "Rename", "重命名"],
  ["trash", "Move to trash", "移到回收站"], ["delete", "Delete permanently", "永久删除"], ["create-directory", "Create directory", "新建目录"],
  ["undo", "Undo latest batch", "撤销最近操作"],
  ["discard-undo", "Discard latest undo", "丢弃最近撤销记录"],
]

function isFileOperationAction(value: unknown): value is NeoviewFileOperationTuiAction {
  return FILE_OPERATION_ACTIONS.some(([action]) => action === value)
}

function fileOperationFromInput(input: NeoviewFileOperationTuiInput): ReaderFileMutation {
  if (input.action === "undo" || input.action === "discard-undo") throw new Error("Undo actions do not create a file mutation.")
  if (input.action === "create-directory") return { kind: input.action, destinationPath: resolve(input.destinationPath ?? "") }
  if (input.action === "delete" || input.action === "trash") return { kind: input.action, sourcePath: resolve(input.sourcePath ?? "") }
  return {
    kind: input.action,
    sourcePath: resolve(input.sourcePath ?? ""),
    destinationPath: resolve(input.destinationPath ?? ""),
    overwrite: input.overwrite === true,
  }
}

const LIBRARY_ACTIONS: ReadonlyArray<readonly [NeoviewLibraryTuiAction, string, string]> = [
  ["list-recents", "List recents", "最近阅读"], ["cleanup-recents", "Cleanup before timestamp", "按时间清理历史"], ["cleanup-recents-oldest", "Cleanup oldest recents", "清理最旧历史"],
  ["cleanup-recents-folder", "Cleanup recents by folder", "按目录清理历史"], ["clear-recents", "Clear all recents", "清空全部历史"], ["cleanup-invalid", "Cleanup invalid paths", "清理无效路径"], ["delete-recent", "Delete recent", "删除历史项"],
  ["list-bookmarks", "List bookmarks", "书签"], ["add-bookmark", "Add bookmark", "添加书签"], ["delete-bookmark", "Delete bookmark", "删除书签"],
  ["update-bookmarks", "Set bookmark lists", "批量设置书签列表"], ["delete-bookmarks", "Delete bookmarks", "批量删除书签"],
  ["list-bookmark-lists", "List bookmark lists", "书签列表"], ["add-bookmark-list", "Add bookmark list", "创建书签列表"], ["delete-bookmark-list", "Delete bookmark list", "删除书签列表"],
]

function isLibraryAction(value: unknown): value is NeoviewLibraryTuiAction {
  return LIBRARY_ACTIONS.some(([action]) => action === value)
}

function itemsResult(items: readonly unknown[], name: string): NeoviewLibraryTuiResult {
  return { success: true, message: `${items.length} ${name}.`, lines: items.map((item) => JSON.stringify(item)) }
}

function mutationResult(changed: boolean, name: string): NeoviewLibraryTuiResult {
  return { success: true, message: changed ? `${name} removed.` : `${name} not found.` }
}

function parseInputDescriptor(value: unknown): ReaderInputDescriptor | undefined {
  try {
    const parsed = JSON.parse(String(value ?? "")) as unknown
    return isRecord(parsed) && typeof parsed.device === "string" ? parsed as ReaderInputDescriptor : undefined
  } catch {
    return undefined
  }
}

function parseInputContexts(value: unknown): ReaderInputContext[] {
  try {
    const parsed = JSON.parse(String(value ?? "[\"reader\"]")) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is ReaderInputContext => entry === "global" || entry === "reader" || entry === "video" || entry === "panel" || entry === "editor" || entry === "modal") : ["reader"]
  } catch {
    return ["reader"]
  }
}

function commaSeparatedValues(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean)
}

function isFileTreeAction(value: unknown): value is NeoviewFileTreeTuiAction {
  return value === "tree" || value === "search" || value === "exclude" || value === "include" || value === "clear-cache"
    || value === "history" || value === "delete-history" || value === "clear-history" || value === "emm-tags" || value === "emm-edit"
}

function isSearchHistoryScope(value: unknown): value is "folder" | "file" | "bookmark" | "history" {
  return value === "folder" || value === "file" || value === "bookmark" || value === "history"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
