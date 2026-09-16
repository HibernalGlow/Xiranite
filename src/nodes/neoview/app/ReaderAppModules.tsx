import { lazy, Suspense, useSyncExternalStore } from "react"
import { DEFAULT_READER_PRESENTATION } from "@xiranite/node-neoview/ui-core"
import type { SwimlaneWorkspaceSessionState } from "@xiranite/shared/swimlane"
import { DEFAULT_READER_HISTORY_AUTO_CLEANUP, READER_FOLDER_DETAIL_DEFAULT_WIDTHS, type ReaderActivationIdentityDto, type ReaderHttpClient, type ReaderBookmarkListPreferencesDto, type ReaderHistoryListPreferencesDto, type ReaderNavigationDto, type ReaderBookDefaultsDto, type ReaderRuntimeConfigDto, type ReaderPageListPreferencesDto, type ReaderSessionDto, type ReaderShellConfigDto, type ReaderFolderViewConfig, type ReaderSlideshowConfig, type ReaderShellEdge, type ReaderSwimlaneId } from "../adapters/reader-http-client"
import { neoviewDebug } from "../neoviewDebug"
import type { ReaderShellControlHydration, ReaderShellControlSnapshot } from "../features/shell/ReaderShellControlStore"
import type { ReaderShellControlPort } from "../features/shell/ReaderShellControlPort"
import { readerShellMaterialDraft, readerShellMaterialStyle } from "../features/material/ReaderShellMaterial"
import { readerWorkspaceConfig, type ReaderWorkspaceConfig, type ReaderWorkspacePatch } from "../features/workspace/ReaderWorkspaceLayout"

export function workspaceConfigEqual(left: ReaderShellConfigDto, right: ReaderShellConfigDto): boolean {
  // Compare normalized workspace views — shell object identity always changes on patch.
  try {
    return JSON.stringify(readerWorkspaceConfig(left)) === JSON.stringify(readerWorkspaceConfig(right))
  } catch {
    return false
  }
}
export function readerWorkspaceWithSession(shell: ReaderShellConfigDto, session: SwimlaneWorkspaceSessionState | undefined): ReaderWorkspaceConfig {
  const workspace = readerWorkspaceConfig(shell)
  const laneOrder = workspace.swimlane.laneOrder
  const configuredSoloLaneId = workspace.swimlane.soloLaneId ?? (workspace.swimlane.readerSolo ? "reader" : undefined)
  const activeLane = session?.activeLaneId && laneOrder.includes(session.activeLaneId)
    ? session.activeLaneId as ReaderSwimlaneId
    : workspace.swimlane.activeLane
  const sessionHasSoloLane = session !== undefined && Object.hasOwn(session, "soloLaneId")
  const requestedSoloLaneId = sessionHasSoloLane ? session.soloLaneId ?? undefined : configuredSoloLaneId
  const soloLaneId = requestedSoloLaneId && laneOrder.includes(requestedSoloLaneId)
    ? requestedSoloLaneId as ReaderSwimlaneId
    : undefined
  const { soloLaneId: _configuredSoloLaneId, ...configuredSwimlane } = workspace.swimlane
  return {
    ...workspace,
    swimlane: {
      ...configuredSwimlane,
      activeLane,
      readerSolo: soloLaneId === "reader",
      ...(soloLaneId ? { soloLaneId } : {}),
    },
  }
}
export function splitReaderWorkspacePatch(
  patch: ReaderWorkspacePatch,
  current: ReaderWorkspaceConfig,
): { sessionPatch?: SwimlaneWorkspaceSessionState; persistentPatch?: ReaderWorkspacePatch } {
  const { activeLane, readerSolo, soloLaneId, ...persistentPatch } = patch
  let nextSoloLaneId = current.swimlane.soloLaneId ?? (current.swimlane.readerSolo ? "reader" : null)
  if (soloLaneId !== undefined) nextSoloLaneId = soloLaneId
  if (readerSolo === true) nextSoloLaneId = "reader"
  if (readerSolo === false && nextSoloLaneId === "reader") nextSoloLaneId = null
  const sessionPatch = activeLane !== undefined || readerSolo !== undefined || soloLaneId !== undefined
    ? {
        ...(activeLane !== undefined ? { activeLaneId: activeLane } : {}),
        ...(readerSolo !== undefined || soloLaneId !== undefined ? { soloLaneId: nextSoloLaneId } : {}),
      }
    : undefined
  return {
    sessionPatch,
    ...(Object.keys(persistentPatch).length ? { persistentPatch } : {}),
  }
}
export type ReaderSidebarModule = typeof import("../features/panels/ReaderSidebar")
export const INITIAL_VIEW_DEFAULTS = {
  fitMode: DEFAULT_READER_PRESENTATION.fitMode,
  pageMode: "single",
  doublePageGap: 0,
  splitWidePages: false,
  hoverScrollEnabled: true,
  hoverScrollSpeed: 2,
  magnifierZoom: 2,
  magnifierSize: 200,
  background: {
    color: "#000000",
    mode: "solid",
    ambient: { style: "vibrant", speed: 8, blur: 80, opacity: 0.8 },
    aurora: { showRadialGradient: true },
    spotlight: { color: "white" },
  },
} satisfies ReaderRuntimeConfigDto["viewDefaults"]
export const INITIAL_HISTORY_LIST_PREFERENCES: ReaderHistoryListPreferencesDto = {
  viewMode: "compact",
  viewOverrides: {},
  autoCleanup: DEFAULT_READER_HISTORY_AUTO_CLEANUP,
}
export const INITIAL_BOOKMARK_LIST_PREFERENCES: ReaderBookmarkListPreferencesDto = {
  activeListId: "all",
  viewOverrides: {},
}
export const INITIAL_PAGE_LIST_PREFERENCES: ReaderPageListPreferencesDto = {
  viewMode: "list",
  followProgress: true,
}
export const INITIAL_BOOK_DEFAULTS: ReaderBookDefaultsDto = {
  lockedSortMode: null,
  lockedMediaPriority: null,
  lockedReadingDirection: null,
}
export const INITIAL_SLIDESHOW_CONFIG: ReaderSlideshowConfig = {
  intervalSeconds: 5,
  loop: false,
  random: false,
  fadeTransition: true,
}
export const INITIAL_PRELOAD_CONFIG = { maxCandidatePages: 4, browserPredecodeEnabled: true, browserPredecodePages: 3 } satisfies ReaderRuntimeConfigDto["preload"]
export const INITIAL_FOLDER_VIEW_CONFIG: ReaderFolderViewConfig = {
  homePath: "",
  viewMode: "compact",
  previewCount: 4,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
  hoverPreviewEnabled: true,
  hoverPreviewDelayMs: 500,
  titleWrap: { compact: false, "cover-list": false, "mosaic-list": false, details: false, "cover-grid": true, "mosaic-grid": false },
  typeFilter: "library",
  showHiddenFolders: false,
  hideMissingEfuEntries: false,
  confirmations: { trash: false, permanentDelete: true, batchTrash: false, batchPermanentDelete: true },
  penetration: { enabled: false, expandBranchesInline: false, inlineBranchLimitsEnabled: true, inlineBranchMaxDirectories: 4, inlineBranchMaxFiles: 4, inlineBranchMaxItems: 4, showInternalFiles: true, internalItemsMode: "single", maxDepth: 3, terminalTargets: ["archive", "document", "media-directory", "file"] },
  emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: false },
  details: {
    columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
    hiddenColumns: [],
    pinnedLeft: ["name"],
    pinnedRight: [],
    columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
  },
  search: {
    includeSubfolders: true,
    showHistoryOnFocus: true,
    searchInPath: false,
  },
  tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] },
  tabs: { pinned: [], layout: "top", width: 160, breadcrumbPosition: "top", toolbarPosition: "top" },
}
export let readerSidebarModule: Promise<ReaderSidebarModule> | undefined
export function loadReaderSidebar(): Promise<ReaderSidebarModule> {
  if (!readerSidebarModule) {
    const startedAt = performance.now()
    neoviewDebug("sidebar:chunk:load:begin")
    readerSidebarModule = import("../features/panels/ReaderSidebar").then((module) => {
      neoviewDebug("sidebar:chunk:load:end", {
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      })
      return module
    })
  }
  return readerSidebarModule
}
export const LazyReaderSidebar = lazy(async () => ({ default: (await loadReaderSidebar()).ReaderSidebar }))
export const LazyReaderGestureInputRuntime = lazy(async () => ({
  default: (await import("../features/input/ReaderGestureInputRuntime")).ReaderGestureInputRuntime,
}))
export const LazyReaderRadialMenuOverlay = lazy(async () => ({
  default: (await import("../features/input/ReaderRadialMenuOverlay")).ReaderRadialMenuOverlay,
}))
export type ReaderSettingsWindowModule = typeof import("../features/settings/ReaderSettingsWindow")
export let readerSettingsWindowModule: Promise<ReaderSettingsWindowModule> | undefined
export function loadReaderSettingsWindow(): Promise<ReaderSettingsWindowModule> {
  readerSettingsWindowModule ??= import("../features/settings/ReaderSettingsWindow")
  return readerSettingsWindowModule
}
export const LazyReaderSettingsWindow = lazy(async () => ({ default: (await loadReaderSettingsWindow()).ReaderSettingsWindow }))
export type ReaderFrameModule = typeof import("../features/reader/ReaderFrame")
export let readerFrameModule: Promise<ReaderFrameModule> | undefined
export function loadReaderFrame(): Promise<ReaderFrameModule> {
  if (!readerFrameModule) {
    const startedAt = performance.now()
    neoviewDebug("reader:frame-chunk:load:begin")
    readerFrameModule = import("../features/reader/ReaderFrame").then((module) => {
      neoviewDebug("reader:frame-chunk:load:end", {
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      })
      return module
    })
  }
  return readerFrameModule
}
export const LazyReaderFrame = lazy(async () => ({ default: (await loadReaderFrame()).ReaderFrame }))
export const LazyReaderBackgroundLayer = lazy(async () => ({ default: (await import("../features/reader/ReaderBackgroundLayer")).ReaderBackgroundLayer }))
export type ReaderViewToolbarModule = typeof import("../features/reader/ReaderViewToolbar")
export let readerViewToolbarModule: Promise<ReaderViewToolbarModule> | undefined
export function loadReaderViewToolbar(): Promise<ReaderViewToolbarModule> {
  readerViewToolbarModule ??= import("../features/reader/ReaderViewToolbar")
  return readerViewToolbarModule
}
export const LazyReaderViewToolbar = lazy(async () => ({ default: (await loadReaderViewToolbar()).ReaderViewToolbar }))
export const LazySidebarFloatingController = lazy(() => import("../features/shell/SidebarFloatingController"))
export const LazyReaderSwitchToastRuntime = lazy(async () => ({
  default: (await import("../features/switch-toast/ReaderSwitchToastRuntime")).ReaderSwitchToastRuntime,
}))
export const LazyReaderInfoOverlayRuntime = lazy(async () => ({
  default: (await import("../features/info-overlay/ReaderInfoOverlayRuntime")).ReaderInfoOverlayRuntime,
}))
export function loadReaderPresentation(): Promise<unknown> {
  return Promise.all([loadReaderFrame(), loadReaderViewToolbar()])
}
export interface ReaderAppProps {
  sessionScopeId?: string
  initialPath?: string
  initialActivationIdentity?: ReaderActivationIdentityDto
  /** Legacy Card state read compatibility. */
  initialBrowserOriginPath?: string
  externalOpenRequest?: ReaderExternalOpenRequest
  onExternalOpenResult?: (result: ReaderExternalOpenResult) => void
  initialSwimlaneSoloLaneId?: string | null
  initialReaderViewFullscreen?: boolean
  client?: ReaderHttpClient
  pickFile?: () => Promise<string | undefined>
  pickDirectory?: () => Promise<string | undefined>
  pickEfuFile?: () => Promise<string | undefined>
  copyText?: (text: string) => Promise<void>
  readFiles?: import("@xiranite/contract").NodeClipboardCapability["readFiles"]
  copyFiles?: import("@xiranite/contract").NodeClipboardCapability["writeFiles"]
  clearFiles?: import("@xiranite/contract").NodeClipboardCapability["clearFiles"]
  onActivationIdentityCommitted?: (identity: ReaderActivationIdentityDto | undefined) => void
  onSwimlaneSoloLaneIdCommitted?: (laneId: string | null) => void
  onReaderViewFullscreenCommitted?: (fullscreen: boolean) => void
}

export interface ReaderExternalOpenRequest {
  requestId: string
  path: string
  kind: "file" | "directory"
}

export interface ReaderExternalOpenResult {
  requestId?: string
  opened: boolean
  message?: string
}
export function DeferredSidebarFloatingController({ control, shell, disabled }: { control: ReaderShellControlPort; shell: ReaderShellConfigDto; disabled: boolean }) {
  const enabled = useSyncExternalStore(
    control.store.subscribe,
    () => control.store.getSnapshot().floating.enabled,
    () => control.store.getSnapshot().floating.enabled,
  )
  return enabled ? (
    <Suspense fallback={null}>
      <LazySidebarFloatingController control={control} disabled={disabled} materialStyle={readerShellMaterialStyle(readerShellMaterialDraft(shell), "sidebar")} />
    </Suspense>
  ) : null
}
export function shellControlHydration(shell: ReaderShellConfigDto): ReaderShellControlHydration {
  return {
    edges: Object.fromEntries((Object.keys(shell.edges) as ReaderShellEdge[]).map((edge) => [edge, {
      open: shell.edges[edge].initialVisible,
      pinned: shell.edges[edge].pinned,
      lockMode: shell.edges[edge].lockMode ?? "auto",
    }])) as ReaderShellControlHydration["edges"],
    floating: shell.floatingControl ?? { enabled: true, position: { x: 100, y: 100 } },
  }
}
export function shellControlSnapshot(shell: ReaderShellConfigDto): ReaderShellControlSnapshot {
  return shellControlHydration(shell) as ReaderShellControlSnapshot
}
export function defaultShellControlSnapshot(): ReaderShellControlSnapshot {
  return {
    edges: {
      top: { open: true, pinned: false, lockMode: "auto" },
      right: { open: false, pinned: false, lockMode: "auto" },
      bottom: { open: false, pinned: false, lockMode: "auto" },
      left: { open: true, pinned: true, lockMode: "auto" },
    },
    floating: { enabled: true, position: { x: 100, y: 100 } },
  }
}
export function edgeSurfaceStyle(shell: ReaderShellConfigDto | undefined, edge: "top" | "bottom"): React.CSSProperties | undefined {
  if (!shell) return undefined
  return readerShellMaterialStyle(readerShellMaterialDraft(shell), edge)
}
export function readerPathSegments(path: string): string[] {
  const segments = path.split(/[\\/]+/).filter(Boolean)
  return segments.length ? segments : ["未选择"]
}
export function fileMutationContainsSource(targetPath: string, sourcePath: string): boolean {
  const target = normalizeFileMutationPath(targetPath)
  const source = normalizeFileMutationPath(sourcePath)
  return Boolean(target && source && (target === source || source.startsWith(`${target}/`)))
}
export function normalizeFileMutationPath(path: string): string {
  const normalized = path.trim().replaceAll("\\", "/").replace(/\/+$/u, "")
  return /^[a-z]:\//iu.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase()
    : normalized
}
export function applyNavigation(session: ReaderSessionDto, navigation: ReaderNavigationDto): ReaderSessionDto {
  return {
    ...session,
    frame: navigation.frame,
    visiblePages: navigation.visiblePages,
    pageOrder: navigation.pageOrder ?? session.pageOrder,
    preload: navigation.preload ?? session.preload,
  }
}
export function waitForReaderOperationIdle(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort)
      resolve()
    }
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
    }
    const timer = setTimeout(finish, 25)
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
