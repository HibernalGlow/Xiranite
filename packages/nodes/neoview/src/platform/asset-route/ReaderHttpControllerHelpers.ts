import type { Stats } from "node:fs"
import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"
import { z } from "zod"

import { DEFAULT_READER_LAYOUT, type FrameSnapshot, type ReaderLayout } from "../../domain/frame/frame.js"
import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { ReaderMediaFormatRegistryRef } from "../../domain/page/media.js"
import { DEFAULT_READER_COLOR_FILTER, type ReaderColorFilterSettings } from "../../domain/color-filter/ReaderColorFilter.js"
import { DEFAULT_READER_PAGE_TRANSITION, type ReaderPageTransitionSettings } from "../../domain/page-transition/ReaderPageTransition.js"
import { DEFAULT_READER_SWITCH_TOAST, type ReaderSwitchToastSettings } from "../../application/switch-toast/ReaderSwitchToast.js"
import { DEFAULT_READER_INFO_OVERLAY, type ReaderInfoOverlaySettings } from "../../application/info-overlay/ReaderInfoOverlay.js"
import { DEFAULT_READER_IMAGE_TRIM, type ReaderImageTrimSettings } from "../../application/image-trim/ReaderImageTrim.js"
import { CoreReaderService } from "../../application/reader/ReaderService.js"
import { ReaderCacheService } from "../../application/cache/ReaderCacheService.js"
import type { ReaderSession, ReaderSessionId, ReaderSessionOptions } from "../../application/reader/contracts.js"
import type { ReaderPageOrder, ReaderPageOrderPatch } from "../../application/reader/ReaderPageOrder.js"
import {
  ReaderBookSettingsRevisionConflict,
  ReaderBookSettingsService,
  readerBookSettingsDefaults,
} from "../../application/reader/ReaderBookSettingsService.js"
import type { ArchivePasswordInput } from "../../ports/ReaderBookLoader.js"
import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import type { ReaderProgressStore } from "../../ports/ReaderProgressStore.js"
import type { ReaderMediaProgressStore } from "../../ports/ReaderMediaProgressStore.js"
import type { ReaderSearchHistoryStore } from "../../ports/ReaderSearchHistoryStore.js"
import type { ReaderFileUndoJournalStore } from "../../ports/ReaderFileUndoJournalStore.js"
import type { ReaderBookSettingsStore } from "../../ports/ReaderBookSettingsStore.js"
import type { ReaderEmmOverrideStore } from "../../ports/ReaderEmmOverrideStore.js"
import { ReaderSearchHistoryService } from "../../application/browser/ReaderSearchHistoryService.js"
import { ReaderHierarchicalBookTraversal, type ReaderBookTraversalCursor } from "../../application/reader/ReaderHierarchicalBookTraversal.js"
import { ReaderFolderPenetrationResolver } from "../../application/browser/ReaderFolderPenetrationResolver.js"
import { ReaderEmmMetadataRevisionConflict, ReaderEmmMetadataService } from "../../application/metadata/ReaderEmmMetadataService.js"
import { legacyEmmBookPathKey } from "../../application/metadata/LegacyEmmBookMetadataCodec.js"
import { isReaderDirectorySortField, type ReaderDirectorySortRule } from "../../application/browser/ReaderDirectorySort.js"
import { ReaderMediaProgressService, type ReaderMediaProgressUpdate } from "../../application/reader/ReaderMediaProgressService.js"
import { ReaderClipboardMaterializationService } from "../../application/reader/ReaderClipboardMaterializationService.js"
import { ReaderSeekableMediaCache } from "../../application/reader/ReaderSeekableMediaCache.js"
import { ReaderSubtitleService } from "../../application/reader/ReaderSubtitleService.js"
import {
  ReaderDiagnosticsService,
  type ReaderSchedulerPoolDiagnostics,
  type ReaderSharedSchedulerDiagnostics,
  type ReaderVideoProcessDiagnostics,
} from "../../application/diagnostics/ReaderDiagnosticsService.js"
import { exportReaderDiagnosticsHistory, type ReaderDiagnosticsHistoryExportFormat } from "../../application/diagnostics/ReaderDiagnosticsHistoryExport.js"
import { ReaderBookMetadataService, type ReaderBookStaticMetadata } from "../../application/metadata/ReaderBookMetadataService.js"
import { ReaderPageMediaInformationService } from "../../application/metadata/ReaderPageMediaInformationService.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type { ReaderPresentationDiskCache } from "../../ports/ReaderPresentationDiskCache.js"
import type { SuperResolutionArtifactPagePort } from "../../ports/SuperResolutionArtifactPagePort.js"
import type { SuperResolutionArtifactStore } from "../../ports/SuperResolutionArtifactStore.js"
import type { SuperResolutionPreloadControlPort } from "../../ports/SuperResolutionPreloadControlPort.js"
import type { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"
import type { ReaderDirectorySortPreferenceStore } from "../../application/browser/ReaderDirectorySortPreferences.js"
import type { ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderPreloadContext, ReaderPreloadCoordinatorOptions, ReaderPreloadPlan } from "../../application/preloading/PreloadCoordinator.js"
import type { ReaderPreloadOutcome, ReaderPreloadPerformanceMetrics } from "../../application/preloading/PreloadTelemetry.js"
import { deriveReaderPreloadResourceContext } from "../../application/preloading/PreloadResourceContext.js"
import type { SystemThumbnailProviderLoader } from "../../ports/SystemThumbnailProvider.js"
import type { VideoThumbnailProviderLoader } from "../../ports/VideoThumbnailProvider.js"
import type { ReaderPageMediaMetadataProviderLoader } from "../../ports/ReaderPageMediaMetadataProvider.js"
import type { ImageTransformExecution, ImageTransformer } from "../../ports/ImageTransformer.js"
import { createPlatformReaderBookLoader } from "../books/PlatformReaderBookLoader.js"
import type { PlatformReaderBookLoaderOptions } from "../books/PlatformReaderBookLoader.js"
import { StreamingImageMetadataProbe } from "../images/StreamingImageMetadataProbe.js"
import { PlatformDirectoryMediaMetadataProvider } from "../filesystem/PlatformDirectoryMediaMetadataProvider.js"
import { PlatformDirectoryListingProvider } from "../filesystem/PlatformDirectoryListingProvider.js"
import { PlatformDirectoryMetadataProvider } from "../filesystem/PlatformDirectoryMetadataProvider.js"
import { platformReaderBookCandidate } from "../filesystem/PlatformReaderBookCandidate.js"
import { WeightedLruPresentationCache } from "../cache/WeightedLruPresentationCache.js"
import { SolidArchiveCache } from "../archives/sevenzip/SolidArchiveCache.js"
import { VideoProcessScheduler, type VideoProcessSchedulerSnapshot } from "../video/VideoProcessScheduler.js"
import { ReaderArchivePreloadDemandBridge } from "../archives/ReaderArchivePreloadDemandBridge.js"
import { defaultImageTransformScheduler, type PriorityResourceSchedulerSnapshot } from "../scheduler/PriorityResourceScheduler.js"
import { ReaderAssetRoute, type ReaderAssetRouteOptions } from "./ReaderAssetRoute.js"
import { SuperResolutionArtifactRoute } from "./SuperResolutionArtifactRoute.js"
import { LibraryThumbnailRoute } from "./LibraryThumbnailRoute.js"
import { PlatformThumbnailPipeline, ThumbnailUnavailableError } from "../thumbnails/PlatformThumbnailPipeline.js"
import { ThumbnailMaintenanceRoute } from "./ThumbnailMaintenanceRoute.js"
import { ReaderDirectoryBrowserRoute } from "./ReaderDirectoryBrowserRoute.js"
import { ReaderLibraryHttpController } from "./ReaderLibraryHttpController.js"
import { ReaderAiHttpController } from "./ReaderAiHttpController.js"
import { ReaderOpdsHttpController, type ReaderOpdsCatalogReader } from "./ReaderOpdsHttpController.js"
import { ReaderFileOperationHttpController } from "./ReaderFileOperationHttpController.js"
import { ReaderSystemIntegrationHttpController } from "./ReaderSystemIntegrationHttpController.js"
import { ReaderSettingsMigrationHttpController } from "./ReaderSettingsMigrationHttpController.js"
import { ReaderBookSettingsMigrationHttpController } from "./ReaderBookSettingsMigrationHttpController.js"
import { ReaderSourceWatchService } from "../../application/reader/ReaderSourceWatchService.js"
import type { ReaderSourceWatcher } from "../../ports/ReaderSourceWatcher.js"
import type { ReaderExplorerContextMenuProvider } from "../../ports/ReaderExplorerContextMenuProvider.js"
import { PlatformReaderSourceWatcher } from "../filesystem/PlatformReaderSourceWatcher.js"
import type { ReaderSettingsMigrationService } from "../../application/migration/ReaderSettingsMigrationService.js"
import type { ReaderSettingsPortableService } from "../../application/migration/ReaderSettingsPortableService.js"
import type { ReaderBookSettingsMigrationService } from "../../application/migration/ReaderBookSettingsMigrationService.js"
import { ReaderLibraryCleanupService } from "../../application/library/ReaderLibraryCleanupService.js"
import { PlatformReaderPathStatusProvider } from "../filesystem/PlatformReaderPathStatusProvider.js"
import { PlatformReaderPageMaterializer } from "../content/PlatformReaderPageMaterializer.js"
import { PlatformEmmTranslationSource } from "../emm/PlatformEmmTranslationSource.js"
import { PlatformEmmCollectTagSource } from "../emm/PlatformEmmCollectTagSource.js"
import { WINDOWS_PRESENTATION_PRODUCER_VERSION } from "../cache/PresentationCacheKey.js"
import { NeoViewImageProcessingRuntimePolicy } from "../images/SharpRuntimePolicy.js"
import {
  DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG,
  parseNeoviewImageProcessingPatch,
  type NeoviewImageProcessingConfig,
  type NeoviewImageProcessingPatch,
} from "../../application/config/ReaderImageProcessingConfig.js"
import { ReaderMemoryPressureMonitor } from "../memory/ReaderMemoryPressureMonitor.js"
import { ReaderSystemMonitorService } from "../diagnostics/ReaderSystemMonitorService.js"
import {
  parseNeoviewFolderViewPatch,
  DEFAULT_NEOVIEW_BOOKMARK_LIST_CONFIG,
  DEFAULT_NEOVIEW_HISTORY_LIST_CONFIG,
  DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG,
  DEFAULT_NEOVIEW_SHELL_CONFIG,
  DEFAULT_NEOVIEW_SLIDESHOW_CONFIG,
  DEFAULT_NEOVIEW_MEDIA_CONFIG,
  DEFAULT_NEOVIEW_PAGE_LIST_CONFIG,
  DEFAULT_NEOVIEW_BOOK_CONFIG,
  DEFAULT_NEOVIEW_VIEW_DEFAULTS,
  DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG,
  DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG,
  parseNeoviewBoardLayoutPatch,
  parseNeoviewCardLayoutPatch,
  parseNeoviewShellControlPatch,
  parseNeoviewSidebarLayoutPatch,
  parseNeoviewSlideshowPatch,
  parseNeoviewMediaPatch,
  parseNeoviewColorFilterPatch,
  parseNeoviewPageTransitionPatch,
  parseNeoviewSwitchToastPatch,
  parseNeoviewInfoOverlayPatch,
  parseNeoviewSystemMonitorPatch,
  parseNeoviewEmmPatch,
  parseNeoviewAiTranslationPatch,
  DEFAULT_NEOVIEW_EMM_CONFIG,
  DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG,
  parseNeoviewImageTrimPatch,
  parseNeoviewSuperResolutionPreferencesPatch,
  parseNeoviewBookmarkListPatch,
  parseNeoviewHistoryListPatch,
  parseNeoviewPageListPatch,
  parseNeoviewBookPatch,
  parseNeoviewViewDefaultsPatch,
  type NeoviewSlideshowConfig,
  type NeoviewSlideshowPatch,
  type NeoviewMediaConfig,
  type NeoviewMediaPatch,
  type NeoviewColorFilterPatch,
  type NeoviewPageTransitionPatch,
  type NeoviewSwitchToastPatch,
  type NeoviewInfoOverlayPatch,
  type NeoviewSystemMonitorConfig,
  type NeoviewEmmConfig,
  type NeoviewEmmPatch,
  type NeoviewAiTranslationConfig,
  type NeoviewAiTranslationPatch,
  type NeoviewSystemMonitorPatch,
  type NeoviewImageTrimPatch,
  type NeoviewSuperResolutionConfig,
  type NeoviewSuperResolutionPatch,
  type NeoviewShellConfig,
  type NeoviewShellConfigPatch,
  type NeoviewViewDefaults,
  type NeoviewViewDefaultsPatch,
  type NeoviewBookmarkListConfig,
  type NeoviewBookmarkListPatch,
  type NeoviewHistoryListConfig,
  type NeoviewHistoryListPatch,
  type NeoviewPageListConfig,
  type NeoviewPageListPatch,
  type NeoviewBookConfig,
  type NeoviewBookPatch,
  type NeoviewFolderViewConfig,
  type NeoviewFolderViewPatch,
  type NeoviewFileTreeConfig,
} from "../../application/config/ReaderRuntimeConfig.js"
import { parseNeoviewInputBindingsPatch, type NeoviewInputBindingsPatch } from "../../application/config/ReaderInputBindingsConfig.js"
import {
  cloneReaderRadialMenuConfig,
  DEFAULT_READER_RADIAL_MENU_CONFIG,
  parseReaderRadialMenuPatch,
  type NeoviewRadialMenuPatch,
  type ReaderRadialMenuConfig,
} from "../../application/config/ReaderRadialMenuConfig.js"
import { DEFAULT_READER_INPUT_BINDINGS, cloneReaderInputBindings, type ReaderInputBindingsConfig } from "../../domain/input/ReaderInputBindings.js"

const SESSION_PATH = /^\/reader\/s\/([^/]+)$/
const PRELOAD_CONTEXT_FIELDS = new Set(["mode", "velocityPagesPerSecond", "stableForMs", "focused"])
const MAX_CONTROL_BODY_BYTES = 64 * 1024
import type {
  ReaderEmmConnectionProbeResult,
  ReaderEmmConnectionProbeSource,
  ReaderHttpControllerOptions,
  ReaderPageDto,
  ReaderSessionDto,
} from "./ReaderHttpControllerContracts.js"
export function waitForSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

export class ReaderShellRevisionConflict extends Error {
  constructor(expected: number, actual: number) {
    super(`Reader layout changed while editing (expected revision ${expected}, current revision ${actual}).`)
    this.name = "ReaderShellRevisionConflict"
  }
}

export class ReaderConfigPatchInvalid extends Error {}

export async function readControlJson(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > MAX_CONTROL_BODY_BYTES) return undefined
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
}

export function requirePageIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("pageIndex must be a non-negative integer")
  return value as number
}

export function parseEntryPaths(body: Record<string, unknown>): readonly string[] | undefined | "invalid" {
  if (body.entryPath !== undefined && body.entryPaths !== undefined) return "invalid"
  if (body.entryPath !== undefined) {
    return typeof body.entryPath === "string" && body.entryPath.trim() ? [body.entryPath] : "invalid"
  }
  if (body.entryPaths === undefined) return undefined
  if (!Array.isArray(body.entryPaths) || body.entryPaths.length === 0 || body.entryPaths.length > 16) return "invalid"
  return body.entryPaths.every((path) => typeof path === "string" && path.trim()) ? (body.entryPaths as string[]) : "invalid"
}

export function parseArchivePasswords(body: Record<string, unknown>): readonly ArchivePasswordInput[] | undefined | "invalid" {
  if (body.password !== undefined && body.archivePasswords !== undefined) return "invalid"
  if (body.password !== undefined) {
    return typeof body.password === "string" && body.password.length > 0 ? [{ password: body.password }] : "invalid"
  }
  if (body.archivePasswords === undefined) return undefined
  if (!Array.isArray(body.archivePasswords) || body.archivePasswords.length === 0 || body.archivePasswords.length > 16) {
    return "invalid"
  }
  const scopes = new Set<string>()
  const inputs: ArchivePasswordInput[] = []
  for (const value of body.archivePasswords) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid"
    const record = value as Record<string, unknown>
    if (typeof record.password !== "string" || record.password.length === 0) return "invalid"
    if (
      record.entryPaths !== undefined &&
      (!Array.isArray(record.entryPaths) || record.entryPaths.length > 16 || !record.entryPaths.every((path) => typeof path === "string" && path.trim()))
    )
      return "invalid"
    const entryPaths = record.entryPaths as string[] | undefined
    const key = entryPaths?.join("\0") ?? ""
    if (scopes.has(key)) return "invalid"
    scopes.add(key)
    inputs.push({ password: record.password, entryPaths })
  }
  return inputs
}

export function reloadTargetPage(pages: readonly ReaderPage[], anchor: ReaderPage | undefined, previousIndex: number): number {
  if (!pages.length) return 0
  if (anchor) {
    const matched = pages.find(
      (page) =>
        (anchor.entryPath !== undefined && page.entryPath === anchor.entryPath) || (anchor.entryPath === undefined && page.sourcePath === anchor.sourcePath),
    )
    if (matched) return matched.index
  }
  return Math.min(previousIndex, pages.length - 1)
}

export function parseAdjacentBookRequest(body: Record<string, unknown> | undefined):
  | {
      direction: "next" | "previous"
      sort?: ReaderDirectorySortRule
    }
  | undefined {
  if (!body || Object.keys(body).some((key) => key !== "direction" && key !== "sort")) return undefined
  if (body.direction !== "next" && body.direction !== "previous") return undefined
  if (body.sort === undefined) return { direction: body.direction }
  if (!body.sort || typeof body.sort !== "object" || Array.isArray(body.sort)) return undefined
  const sort = body.sort as Record<string, unknown>
  if (Object.keys(sort).some((key) => key !== "field" && key !== "order" && key !== "directoriesFirst")) return undefined
  if (!isReaderDirectorySortField(sort.field)) return undefined
  if (sort.order !== "asc" && sort.order !== "desc") return undefined
  if (typeof sort.directoriesFirst !== "boolean") return undefined
  return {
    direction: body.direction,
    sort: {
      field: sort.field,
      order: sort.order,
      directoriesFirst: sort.directoriesFirst,
    },
  }
}

export function parseReaderActivationProvenance(value: unknown):
  | {
      browserOriginPath: string
      browserOriginEntryPath: string
      browserOriginSelfTerminal?: boolean
    }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== "browserOriginPath" && key !== "browserOriginEntryPath" && key !== "browserOriginSelfTerminal"))
    return undefined
  if (typeof record.browserOriginPath !== "string" || !record.browserOriginPath.trim()) return undefined
  if (typeof record.browserOriginEntryPath !== "string" || !record.browserOriginEntryPath.trim()) return undefined
  if (record.browserOriginSelfTerminal !== undefined && typeof record.browserOriginSelfTerminal !== "boolean") return undefined
  return {
    browserOriginPath: record.browserOriginPath,
    browserOriginEntryPath: record.browserOriginEntryPath,
    ...(record.browserOriginSelfTerminal === true ? { browserOriginSelfTerminal: true } : {}),
  }
}

export function boundedInteger(value: string | null, minimum: number, maximum: number, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback
}

export function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function subtitleEtag(sessionId: string, pageId: string, assetId: string, version: string): string {
  const digest = createHash("sha256")
    .update(sessionId)
    .update("\0")
    .update(pageId)
    .update("\0")
    .update(assetId)
    .update("\0")
    .update(version)
    .digest("base64url")
  return `"${digest}"`
}

export function isPreloadOutcome(value: unknown): value is ReaderPreloadOutcome {
  return value === "started" || value === "ready" || value === "failed" || value === "cancelled" || value === "evicted"
}

export function parsePreloadViewportContext(body: Record<string, unknown>): ReaderPreloadContext | "invalid" {
  if (body.mode !== undefined && body.mode !== "paged" && body.mode !== "continuous" && body.mode !== "scrub") return "invalid"
  if (
    body.velocityPagesPerSecond !== undefined &&
    (typeof body.velocityPagesPerSecond !== "number" || !Number.isFinite(body.velocityPagesPerSecond) || Math.abs(body.velocityPagesPerSecond) > 10_000)
  )
    return "invalid"
  if (body.stableForMs !== undefined && (!Number.isSafeInteger(body.stableForMs) || (body.stableForMs as number) < 0)) return "invalid"
  if (body.focused !== undefined && typeof body.focused !== "boolean") return "invalid"
  return {
    mode: body.mode as ReaderPreloadContext["mode"],
    velocityPagesPerSecond: body.velocityPagesPerSecond as number | undefined,
    stableForMs: body.stableForMs as number | undefined,
    focused: body.focused as boolean | undefined,
  }
}

export function parsePreloadPerformanceMetrics(value: unknown): ReaderPreloadPerformanceMetrics | undefined | "invalid" {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid"
  const metrics = value as Record<string, unknown>
  if (Object.keys(metrics).some((key) => !PRELOAD_METRIC_FIELDS.has(key))) return "invalid"
  if (!validPreloadDuration(metrics.ttfbMs) || !validPreloadDuration(metrics.decodeMs)) return "invalid"
  if (!validPreloadCount(metrics.retainedBytes, Number.MAX_SAFE_INTEGER) || !validPreloadCount(metrics.activeLeases, 1_000_000)) return "invalid"
  return {
    ttfbMs: metrics.ttfbMs as number | undefined,
    decodeMs: metrics.decodeMs as number | undefined,
    retainedBytes: metrics.retainedBytes as number | undefined,
    activeLeases: metrics.activeLeases as number | undefined,
  }
}

export const PRELOAD_METRIC_FIELDS = new Set(["ttfbMs", "decodeMs", "retainedBytes", "activeLeases"])

export function validPreloadDuration(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10 * 60_000)
}

export function validPreloadCount(value: unknown, maximum: number): boolean {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum)
}

export function parseNonNegativeInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function parseOptionalDiagnosticsInteger(value: string | null): number | undefined | "invalid" {
  if (value === null) return undefined
  if (!/^\d+$/.test(value)) return "invalid"
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : "invalid"
}

export function diagnosticsHistoryExportFormat(value: string | null): ReaderDiagnosticsHistoryExportFormat | undefined {
  if (value === null || value === "json") return "json"
  if (value === "csv") return "csv"
  return undefined
}

export async function safeStat(path: string, signal?: AbortSignal): Promise<Stats | undefined> {
  signal?.throwIfAborted()
  try {
    const result = await stat(path)
    signal?.throwIfAborted()
    return result
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}

export function pageMetadata(page: ReaderPage, fallbackStats?: Stats): Record<string, unknown> {
  const timestamps = page.timestamps
  return {
    index: page.index,
    name: page.name,
    displayPath: page.entryPath ?? page.sourcePath,
    mediaKind: page.mediaKind,
    mimeType: page.mimeType,
    byteLength: page.byteLength ?? (fallbackStats?.isFile() ? fallbackStats.size : undefined),
    dimensions: page.dimensions,
    timeSource: timestamps?.source ?? (fallbackStats ? "book-source" : undefined),
    createdAtMs: timestamps?.createdAtMs ?? validTime(fallbackStats?.birthtimeMs),
    modifiedAtMs: timestamps?.modifiedAtMs ?? validTime(fallbackStats?.mtimeMs),
    accessedAtMs: timestamps?.accessedAtMs ?? validTime(fallbackStats?.atimeMs),
  }
}

export function validTime(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

export function lockedPageOrder(config: NeoviewBookConfig | undefined): ReaderPageOrderPatch | undefined {
  if (!config || (config.lockedSortMode === null && config.lockedMediaPriority === null)) return undefined
  return {
    sortMode: config.lockedSortMode ?? "fileName",
    mediaPriority: config.lockedMediaPriority ?? "none",
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}

export function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: { allow },
  })
}

export function videoProcessSnapshot(scheduler: ResourceScheduler | undefined): (() => ReaderVideoProcessDiagnostics) | undefined {
  const source = scheduler as
    | (ResourceScheduler & {
        snapshot?: () => Readonly<VideoProcessSchedulerSnapshot>
      })
    | undefined
  if (typeof source?.snapshot !== "function") return undefined
  return () => {
    const snapshot = source.snapshot!()
    return {
      active: snapshot.active,
      queued: snapshot.queued,
      maxConcurrent: snapshot.maxConcurrent,
    }
  }
}

export function schedulerSnapshot(
  scheduler: ResourceScheduler | undefined,
): (() => Readonly<Record<"cpu" | "io" | "gpu", ReaderSchedulerPoolDiagnostics>> | undefined) | undefined {
  const source = scheduler as
    | (ResourceScheduler & {
        snapshot?: () => Readonly<Record<"cpu" | "io" | "gpu", ReaderSchedulerPoolDiagnostics>>
      })
    | undefined
  if (typeof source?.snapshot !== "function") return undefined
  return () => {
    const snapshot = source.snapshot!()
    return isSchedulerPoolSnapshot(snapshot) ? snapshot : undefined
  }
}

export function sharedSchedulerSnapshot(scheduler: ResourceScheduler | undefined): (() => ReaderSharedSchedulerDiagnostics | undefined) | undefined {
  const source = scheduler as (ResourceScheduler & { snapshot?: () => unknown }) | undefined
  if (typeof source?.snapshot !== "function") return undefined
  return () => {
    const snapshot = source.snapshot!()
    return isSharedSchedulerSnapshot(snapshot) ? snapshot : undefined
  }
}

export function isSchedulerPoolSnapshot(value: unknown): value is Readonly<Record<"cpu" | "io" | "gpu", ReaderSchedulerPoolDiagnostics>> {
  if (!value || typeof value !== "object" || "topology" in value) return false
  return ["cpu", "io", "gpu"].every((resource) => {
    const pool = (value as Record<string, unknown>)[resource]
    return (
      Boolean(pool) &&
      typeof pool === "object" &&
      typeof (pool as { active?: unknown }).active === "number" &&
      typeof (pool as { queued?: unknown }).queued === "number"
    )
  })
}

export function isSharedSchedulerSnapshot(value: unknown): value is PriorityResourceSchedulerSnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<PriorityResourceSchedulerSnapshot>
  return (
    snapshot.topology === "shared-queue" && typeof snapshot.active === "number" && typeof snapshot.queued === "number" && Boolean(snapshot.queuedByPriority)
  )
}
