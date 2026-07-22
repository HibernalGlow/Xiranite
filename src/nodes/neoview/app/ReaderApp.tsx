import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEventHandler } from "react"
import { BookOpen, ChevronRight, LoaderCircle, Trash2, X } from "lucide-react"
import {
  DEFAULT_READER_PRESENTATION,
  DEFAULT_READER_INPUT_BINDINGS,
  DEFAULT_READER_RADIAL_MENU_CONFIG,
  READER_INPUT_ACTION_LABELS,
  ReaderSlideshow,
  type ReaderPresentation,
  type ReaderInputAction,
  type ReaderInputBindingsConfig,
  type ReaderRadialMenuConfig,
  type ReaderVoiceControlConfig,
} from "@xiranite/node-neoview/ui-core"

import { Button } from "@/components/ui/button"
import { useContextMenu } from "@/components/context-menu"
import { cn } from "@/lib/utils"
import { FloatingWindowCaptionControls, FloatingWindowTitlebarReservation, useFloatingWindowFrame } from "@/components/workspace/FloatingWindowFrame"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import {
  createReaderHttpClient,
  READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
  ReaderHttpError,
  type ReaderHttpClient,
  type ReaderBookmarkListPreferencesDto,
  type ReaderHistoryListPreferencesDto,
  type ReaderNavigationDto,
  type ReaderBookSettingsUpdateDto,
  type ReaderBookDefaultsDto,
  type ReaderPageOrderDto,
  type ReaderRuntimeConfigDto,
  type ReaderMediaConfigDto,
  type ReaderMediaPatchDto,
  type ReaderImageProcessingConfigDto,
  type ReaderSubtitleConfigDto,
  type ReaderPageListPreferencesDto,
  type ReaderSessionDto,
  type ReaderShellConfigDto,
  type ReaderSidebarLayoutPatch,
  type ReaderCardLayoutPatch,
  type ReaderBoardLayoutPatch,
  type ReaderViewDefaultsPatch,
  type ReaderFolderViewConfig,
  type ReaderFolderViewPatch,
  type ReaderSlideshowConfig,
  type ReaderSlideshowPatch,
  type ReaderShellControlPatch,
  type ReaderShellMaterialPatch,
  type ReaderShellEdge,
  type ReaderShellLockMode,
  type ReaderInputBindingsPatch,
  type ReaderRadialMenuPatch,
  type ReaderVoiceControlPatch,
  type ReaderSettingsMigrationImportResult,
  type ReaderSettingsMigrationInspection,
} from "../adapters/reader-http-client"
import { useReaderAdjacentPagePreloader } from "../features/reader/useReaderAdjacentPagePreloader"
import { useReaderImagePreloader } from "../features/reader/useReaderImagePreloader"
import { watchReaderSourceChanges } from "../features/reader/watchReaderSourceChanges"
import { ReaderControlledEdgeShell, type ReaderControlledEdgeSlot } from "../features/shell/ReaderControlledEdgeShell"
import { createReaderShellControlStore, type ReaderShellControlHydration, type ReaderShellControlSnapshot } from "../features/shell/ReaderShellControlStore"
import type { ReaderShellControlPort } from "../features/shell/ReaderShellControlPort"
import { ReaderWindowBar } from "../features/shell/ReaderWindowBar"
import { ThumbnailStrip } from "../features/thumbnails/ThumbnailStrip"
import { useReaderInputRouter } from "../features/input/ReaderInputRouter"
import { executeReaderInputAction } from "../features/input/ReaderInputActionExecutor"
import { createReaderColorFilterStore } from "../features/color-filter/ReaderColorFilterStore"
import { migrateLegacyReaderColorFilter } from "../features/color-filter/LegacyReaderColorFilterMigration"
import { createReaderPageTransitionStore } from "../features/page-transition/ReaderPageTransitionStore"
import { ReaderVideoController } from "../features/video/ReaderVideoController"
import { ReaderViewerToggleStore } from "../features/viewer/ReaderViewerToggleStore"
import { migrateLegacyReaderPageTransition } from "../features/page-transition/LegacyReaderPageTransitionMigration"
import { migrateLegacySidebarHeight } from "../features/panels/cards/LegacySidebarHeightMigration"
import { ReaderPanelDndProvider } from "../features/panels/ReaderPanelDnd"
import { readerShellMaterialDraft, readerShellMaterialStyle } from "../features/material/ReaderShellMaterial"
import { createReaderSwitchToastStore } from "../features/switch-toast/ReaderSwitchToastStore"
import { createReaderInfoOverlayStore } from "../features/info-overlay/ReaderInfoOverlayStore"
import { createReaderImageTrimStore } from "../features/image-trim/ReaderImageTrimStore"
import { useDeferredFinalCleanup } from "../features/settings/useDeferredFinalCleanup"
import { ReaderSwimlaneErrorBoundary, ReaderSwimlaneWorkspace } from "../features/workspace/ReaderSwimlaneWorkspace"
import { applyReaderWorkspacePatch, fitReaderSwimlanesToViewport, readerWorkspaceConfig, type ReaderWorkspacePatch } from "../features/workspace/ReaderWorkspaceLayout"

function workspaceConfigEqual(left: ReaderShellConfigDto, right: ReaderShellConfigDto): boolean {
  // Compare normalized workspace views — shell object identity always changes on patch.
  try {
    return JSON.stringify(readerWorkspaceConfig(left)) === JSON.stringify(readerWorkspaceConfig(right))
  } catch {
    return false
  }
}

type ReaderSidebarModule = typeof import("../features/panels/ReaderSidebar")
const INITIAL_VIEW_DEFAULTS = {
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
const INITIAL_HISTORY_LIST_PREFERENCES: ReaderHistoryListPreferencesDto = {
  viewMode: "compact",
}
const INITIAL_BOOKMARK_LIST_PREFERENCES: ReaderBookmarkListPreferencesDto = {
  activeListId: "all",
}
const INITIAL_PAGE_LIST_PREFERENCES: ReaderPageListPreferencesDto = {
  viewMode: "list",
  followProgress: true,
}
const INITIAL_BOOK_DEFAULTS: ReaderBookDefaultsDto = {
  lockedSortMode: null,
  lockedMediaPriority: null,
  lockedReadingDirection: null,
}
const INITIAL_SLIDESHOW_CONFIG: ReaderSlideshowConfig = {
  intervalSeconds: 5,
  loop: false,
  random: false,
  fadeTransition: true,
}
const INITIAL_PRELOAD_CONFIG = { maxCandidatePages: 4 } satisfies ReaderRuntimeConfigDto["preload"]
const INITIAL_FOLDER_VIEW_CONFIG: ReaderFolderViewConfig = {
  homePath: "",
  viewMode: "compact",
  previewCount: 4,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
  hoverPreviewEnabled: true,
  hoverPreviewDelayMs: 500,
  typeFilter: "library",
  showHiddenFolders: false,
  penetration: { enabled: false, showInternalFiles: true, internalItemsMode: "single", maxDepth: 3, terminalTargets: ["archive", "document", "media-directory", "file"] },
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
let readerSidebarModule: Promise<ReaderSidebarModule> | undefined
function loadReaderSidebar(): Promise<ReaderSidebarModule> {
  readerSidebarModule ??= import("../features/panels/ReaderSidebar")
  return readerSidebarModule
}
const LazyReaderSidebar = lazy(async () => ({ default: (await loadReaderSidebar()).ReaderSidebar }))
const LazyReaderGestureInputRuntime = lazy(async () => ({
  default: (await import("../features/input/ReaderGestureInputRuntime")).ReaderGestureInputRuntime,
}))
const LazyReaderRadialMenuOverlay = lazy(async () => ({
  default: (await import("../features/input/ReaderRadialMenuOverlay")).ReaderRadialMenuOverlay,
}))

type ReaderSettingsWindowModule = typeof import("../features/settings/ReaderSettingsWindow")
let readerSettingsWindowModule: Promise<ReaderSettingsWindowModule> | undefined
function loadReaderSettingsWindow(): Promise<ReaderSettingsWindowModule> {
  readerSettingsWindowModule ??= import("../features/settings/ReaderSettingsWindow")
  return readerSettingsWindowModule
}
const LazyReaderSettingsWindow = lazy(async () => ({ default: (await loadReaderSettingsWindow()).ReaderSettingsWindow }))

type ReaderFrameModule = typeof import("../features/reader/ReaderFrame")
let readerFrameModule: Promise<ReaderFrameModule> | undefined
function loadReaderFrame(): Promise<ReaderFrameModule> {
  readerFrameModule ??= import("../features/reader/ReaderFrame")
  return readerFrameModule
}
const LazyReaderFrame = lazy(async () => ({ default: (await loadReaderFrame()).ReaderFrame }))
const LazyReaderBackgroundLayer = lazy(async () => ({ default: (await import("../features/reader/ReaderBackgroundLayer")).ReaderBackgroundLayer }))

type ReaderViewToolbarModule = typeof import("../features/reader/ReaderViewToolbar")
let readerViewToolbarModule: Promise<ReaderViewToolbarModule> | undefined
function loadReaderViewToolbar(): Promise<ReaderViewToolbarModule> {
  readerViewToolbarModule ??= import("../features/reader/ReaderViewToolbar")
  return readerViewToolbarModule
}
const LazyReaderViewToolbar = lazy(async () => ({ default: (await loadReaderViewToolbar()).ReaderViewToolbar }))

const LazySidebarFloatingController = lazy(() => import("../features/shell/SidebarFloatingController"))
const LazyReaderSwitchToastRuntime = lazy(async () => ({
  default: (await import("../features/switch-toast/ReaderSwitchToastRuntime")).ReaderSwitchToastRuntime,
}))
const LazyReaderInfoOverlayRuntime = lazy(async () => ({
  default: (await import("../features/info-overlay/ReaderInfoOverlayRuntime")).ReaderInfoOverlayRuntime,
}))

function loadReaderPresentation(): Promise<unknown> {
  return Promise.all([loadReaderFrame(), loadReaderViewToolbar()])
}

export interface ReaderAppProps {
  initialPath?: string
  initialBrowserOriginPath?: string
  client?: ReaderHttpClient
  pickFile?: () => Promise<string | undefined>
  pickDirectory?: () => Promise<string | undefined>
  copyText?: (text: string) => Promise<void>
  copyFiles?: (paths: string[]) => Promise<void>
  onPathCommitted?: (path: string, browserOriginPath?: string) => void
}

export function ReaderApp({
  initialPath = "",
  initialBrowserOriginPath,
  client: injectedClient,
  pickFile,
  pickDirectory,
  copyText,
  copyFiles,
  onPathCommitted,
}: ReaderAppProps) {
  const surface = useNodeSurface()
  const floatingFrame = useFloatingWindowFrame()
  const contextMenu = useContextMenu()
  const [client] = useState<ReaderHttpClient>(() => injectedClient ?? createReaderHttpClient())
  const clientRef = useRef(client)
  const shellRef = useRef<ReaderShellConfigDto | undefined>(undefined)
  const readerInteractionRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<string | undefined>(undefined)
  const operationRef = useRef<AbortController | undefined>(undefined)
  const navigationPendingRef = useRef(false)
  const slideshowSessionRef = useRef<ReaderSessionDto | undefined>(undefined)
  const [slideshow] = useState(() => new ReaderSlideshow({
    readPosition: () => {
      const current = slideshowSessionRef.current
      return {
        pageCount: current?.book.pageCount ?? 0,
        currentPageIndex: current?.frame.anchorPageIndex ?? 0,
        atEnd: current?.frame.atEnd ?? true,
      }
    },
    nextPage: () => navigate("next", true),
    goToPage: (pageIndex) => goTo(pageIndex, true),
    onError: (cause) => setError(errorMessage(cause)),
  }))
  const viewDefaultsRef = useRef<ReaderRuntimeConfigDto["viewDefaults"]>({ ...INITIAL_VIEW_DEFAULTS })
  const confirmedViewDefaultsRef = useRef<ReaderRuntimeConfigDto["viewDefaults"]>({ ...INITIAL_VIEW_DEFAULTS })
  const tailOverflowRef = useRef<"do-nothing" | "stay-on-last-page" | "next-book" | "loop" | "seamless-loop">("stay-on-last-page")
  const viewDefaultsWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const viewDefaultsGenerationRef = useRef(0)
  const pageListPreferencesRef = useRef<ReaderPageListPreferencesDto>({ ...INITIAL_PAGE_LIST_PREFERENCES })
  const confirmedPageListPreferencesRef = useRef<ReaderPageListPreferencesDto>({ ...INITIAL_PAGE_LIST_PREFERENCES })
  const pageListPreferencesWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pageListPreferencesGenerationRef = useRef(0)
  const bookmarkListPreferencesGenerationRef = useRef(0)
  const historyListPreferencesGenerationRef = useRef(0)
  const slideshowConfigRef = useRef<ReaderSlideshowConfig>({ ...INITIAL_SLIDESHOW_CONFIG })
  const confirmedSlideshowConfigRef = useRef<ReaderSlideshowConfig>({ ...INITIAL_SLIDESHOW_CONFIG })
  const slideshowWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const slideshowGenerationRef = useRef(0)
  const folderViewRef = useRef<ReaderFolderViewConfig>(structuredClone(INITIAL_FOLDER_VIEW_CONFIG))
  const confirmedFolderViewRef = useRef<ReaderFolderViewConfig>(structuredClone(INITIAL_FOLDER_VIEW_CONFIG))
  const folderViewWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const folderViewGenerationRef = useRef(0)
  const inputBindingsRef = useRef<ReaderInputBindingsConfig>(structuredClone(DEFAULT_READER_INPUT_BINDINGS))
  const lastInputPointRef = useRef<{ x: number; y: number }>()
  const temporaryFitPresentationRef = useRef<ReaderPresentation>()
  const shellControlWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const shellControlGenerationRef = useRef(0)
  const pendingWorkspaceWritesRef = useRef<Array<{ generation: number; patch: ReaderWorkspacePatch; base: ReaderShellConfigDto }>>([])
  const presentationTouchedRef = useRef(false)
  const [path, setPath] = useState(initialPath)
  const [browserOriginPath, setBrowserOriginPath] = useState(initialBrowserOriginPath)
  const [session, setSession] = useState<ReaderSessionDto | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [colorFilter] = useState(() => createReaderColorFilterStore({
    async persist(settings, reset, signal) {
      if (!clientRef.current.updateColorFilter) return settings
      return await clientRef.current.updateColorFilter({ colorFilter: reset ? { reset: "defaults" } : settings }, signal)
    },
    onError: (cause) => setError(errorMessage(cause)),
  }))
  const [pageTransition] = useState(() => createReaderPageTransitionStore({
    async persist(settings, reset, signal) {
      if (!clientRef.current.updatePageTransition) return settings
      return await clientRef.current.updatePageTransition({ pageTransition: reset ? { reset: "defaults" } : settings }, signal)
    },
    onError: (cause) => setError(errorMessage(cause)),
  }))
  const [switchToast] = useState(() => createReaderSwitchToastStore({
    async persist(settings, reset, signal) {
      if (!clientRef.current.updateSwitchToast) return settings
      return await clientRef.current.updateSwitchToast({ switchToast: reset ? { reset: "defaults" } : settings }, signal)
    },
    onError: (cause) => setError(errorMessage(cause)),
  }))
  const [infoOverlay] = useState(() => createReaderInfoOverlayStore({
    async persist(settings, reset, signal) {
      if (!clientRef.current.updateInfoOverlay) return settings
      return await clientRef.current.updateInfoOverlay({ infoOverlay: reset ? { reset: "defaults" } : settings }, signal)
    },
    onError: (cause) => setError(errorMessage(cause)),
  }))
  const [imageTrim] = useState(() => createReaderImageTrimStore({
    async persist(settings, reset, signal) {
      if (!clientRef.current.updateImageTrim) return settings
      return await clientRef.current.updateImageTrim({ imageTrim: reset ? { reset: "defaults" } : settings }, signal)
    },
    onError: (cause) => setError(errorMessage(cause)),
  }))
  const [videoController] = useState(() => new ReaderVideoController())
  const [viewerToggles] = useState(() => new ReaderViewerToggleStore())
  const [shell, setShell] = useState<ReaderShellConfigDto | undefined>(undefined)
  const [shellControlStore] = useState(() => createReaderShellControlStore({
    edges: {
      top: { open: true },
      left: { open: true, pinned: true },
    },
  }))
  const [shellControl] = useState<ReaderShellControlPort>(() => ({
    store: shellControlStore,
    requestOpen: requestShellEdgeOpen,
    setPinned: setShellEdgePinned,
    cycleLock: cycleShellEdgeLock,
    setLock: setShellEdgeLock,
    setFloating: setShellFloatingControl,
    setTriggerSize: setShellEdgeTriggerSize,
    reset: resetShellControl,
    persist: persistShellControl,
  }))
  const [viewDefaults, setViewDefaults] = useState<ReaderRuntimeConfigDto["viewDefaults"]>(() => ({ ...INITIAL_VIEW_DEFAULTS }))
  const [bookDefaults, setBookDefaults] = useState<ReaderBookDefaultsDto>(() => ({ ...INITIAL_BOOK_DEFAULTS }))
  const [pageListPreferences, setPageListPreferences] = useState<ReaderPageListPreferencesDto>(() => ({ ...INITIAL_PAGE_LIST_PREFERENCES }))
  const [bookmarkListPreferences, setBookmarkListPreferences] = useState<ReaderBookmarkListPreferencesDto>(() => ({ ...INITIAL_BOOKMARK_LIST_PREFERENCES }))
  const [historyListPreferences, setHistoryListPreferences] = useState<ReaderHistoryListPreferencesDto>(() => ({ ...INITIAL_HISTORY_LIST_PREFERENCES }))
  const [folderView, setFolderView] = useState<ReaderFolderViewConfig>(() => structuredClone(INITIAL_FOLDER_VIEW_CONFIG))
  const [inputBindings, setInputBindings] = useState<ReaderInputBindingsConfig>(() => structuredClone(DEFAULT_READER_INPUT_BINDINGS))
  const [radialMenu, setRadialMenu] = useState<ReaderRadialMenuConfig>(() => structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG))
  const [voiceControl, setVoiceControl] = useState<ReaderVoiceControlConfig>()
  const [media, setMedia] = useState<ReaderMediaConfigDto>()
  const [imageProcessing, setImageProcessing] = useState<ReaderImageProcessingConfigDto>()
  const [slideshowConfig, setSlideshowConfig] = useState<ReaderSlideshowConfig>(() => ({ ...INITIAL_SLIDESHOW_CONFIG }))
  const [preloadConfig, setPreloadConfig] = useState<ReaderRuntimeConfigDto["preload"]>(() => ({ ...INITIAL_PRELOAD_CONFIG }))
  const [slideshowFadeFrame, setSlideshowFadeFrame] = useState<string>()
  const [superResolution, setSuperResolution] = useState<ReaderRuntimeConfigDto["superResolution"]>()
  const [radialMenuRequest, setRadialMenuRequest] = useState<{ id: number; x: number; y: number }>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [presentation, setPresentation] = useState<ReaderPresentation>(() => ({ ...DEFAULT_READER_PRESENTATION }))
  const [magnifierEnabled, setMagnifierEnabled] = useState(false)
  const prefetchController = useReaderImagePreloader(session?.sessionId, client.reportPreloadEvents
    ? (sessionId, generation, events) => void client.reportPreloadEvents!(sessionId, generation, events).catch(() => undefined)
    : undefined)
  const [cancelledPreloadFrame, setCancelledPreloadFrame] = useState<{ sessionId: string; generation: number }>()
  slideshowSessionRef.current = session
  shellRef.current = shell

  useDeferredFinalCleanup(() => {
    operationRef.current?.abort()
    slideshow.dispose()
    colorFilter.dispose()
    pageTransition.dispose()
    switchToast.dispose()
    infoOverlay.dispose()
    imageTrim.dispose()
    videoController.dispose()
    const sessionId = sessionRef.current
    if (sessionId) void clientRef.current.close(sessionId).catch(() => undefined)
  })

  useEffect(() => {
    const controller = new AbortController()
    void clientRef.current.config(controller.signal).then((config) => {
      setMedia(config.media)
      setImageProcessing(config.imageProcessing)
      setPreloadConfig(config.preload ?? INITIAL_PRELOAD_CONFIG)
      setBookDefaults(config.book ?? INITIAL_BOOK_DEFAULTS)
      setSuperResolution(config.superResolution)
      videoController.configure(config.media)
      tailOverflowRef.current = config.sessionOptions?.tailOverflow ?? "stay-on-last-page"
      if (viewDefaultsGenerationRef.current === 0) {
        const normalizedViewDefaults = { ...INITIAL_VIEW_DEFAULTS, ...config.viewDefaults }
        viewDefaultsRef.current = normalizedViewDefaults
        confirmedViewDefaultsRef.current = normalizedViewDefaults
        setViewDefaults(normalizedViewDefaults)
      }
      if (pageListPreferencesGenerationRef.current === 0) {
        pageListPreferencesRef.current = config.pageList
        confirmedPageListPreferencesRef.current = config.pageList
        setPageListPreferences(config.pageList)
      }
      if (bookmarkListPreferencesGenerationRef.current === 0) setBookmarkListPreferences(config.bookmarkList)
      if (historyListPreferencesGenerationRef.current === 0) setHistoryListPreferences(config.historyList)
      if (config.colorFilter) {
        colorFilter.hydrate(config.colorFilter)
        if (typeof localStorage !== "undefined") {
          void migrateLegacyReaderColorFilter({
            storage: localStorage,
            canonical: config.colorFilter,
            persist: async (settings) => colorFilter.update(settings),
          }).catch((cause) => setError(errorMessage(cause)))
        }
      }
      if (config.pageTransition) {
        pageTransition.hydrate(config.pageTransition)
        if (typeof localStorage !== "undefined") {
          void migrateLegacyReaderPageTransition({
            storage: localStorage,
            canonical: config.pageTransition,
            persist: async (settings) => pageTransition.update(settings),
          }).catch((cause) => setError(errorMessage(cause)))
        }
      }
      if (config.switchToast) switchToast.hydrate(config.switchToast)
      if (config.infoOverlay) infoOverlay.hydrate(config.infoOverlay)
      if (config.imageTrim) imageTrim.hydrate(config.imageTrim)
      setShell(config.shell)
      shellControlStore.hydrate(shellControlHydration(config.shell))
      if (typeof localStorage !== "undefined") {
        void migrateLegacySidebarHeight({
          storage: localStorage,
          canonical: config.shell,
          persist: async ({ left, right, interaction }) => {
            let updated = await clientRef.current.updateSidebarLayout(left)
            updated = await clientRef.current.updateSidebarLayout(right)
            if (clientRef.current.updateShellControl) {
              updated = await clientRef.current.updateShellControl({
                expectedRevision: updated.revision ?? 0,
                shellControl: { sidebarInteraction: interaction },
              })
            }
            shellRef.current = updated
            setShell(updated)
            shellControlStore.hydrate(shellControlHydration(updated))
          },
        }).catch((cause) => setError(errorMessage(cause)))
      }
      if (folderViewGenerationRef.current === 0) {
        folderViewRef.current = config.folderView
        confirmedFolderViewRef.current = config.folderView
        setFolderView(config.folderView)
      }
      if (slideshowGenerationRef.current === 0) {
        slideshowConfigRef.current = config.slideshow
        confirmedSlideshowConfigRef.current = config.slideshow
        setSlideshowConfig(config.slideshow)
        slideshow.configure(config.slideshow)
      }
      inputBindingsRef.current = config.inputBindings
      setInputBindings(config.inputBindings)
      setRadialMenu(config.radialMenu ?? structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG))
      setVoiceControl(config.voiceControl)
      if (!presentationTouchedRef.current) {
        setPresentation((current) => ({
          ...current,
          fitMode: config.viewDefaults.fitMode,
          orientation: config.viewDefaults.orientation ?? DEFAULT_READER_PRESENTATION.orientation,
          autoRotation: config.viewDefaults.autoRotation ?? DEFAULT_READER_PRESENTATION.autoRotation,
          widePageStretch: config.viewDefaults.widePageStretch ?? DEFAULT_READER_PRESENTATION.widePageStretch,
        }))
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const sessionId = session?.sessionId
    const waitForChanges = clientRef.current.waitForSourceChanges
    const reload = clientRef.current.reload
    if (!sessionId || !waitForChanges || !reload) return
    const controller = new AbortController()
    void watchReaderSourceChanges({
      sessionId,
      signal: controller.signal,
      waitForChanges,
      reload,
      async beforeReload(signal) {
        while (operationRef.current || navigationPendingRef.current) {
          await waitForReaderOperationIdle(signal)
        }
        if (sessionRef.current !== sessionId) {
          throw signal.reason ?? new DOMException("Reader session changed", "AbortError")
        }
      },
      onReloaded(replacement) {
        if (sessionRef.current !== sessionId) return
        slideshow.stop()
        sessionRef.current = replacement.sessionId
        setSlideshowFadeFrame(undefined)
        setSession(replacement)
        switchToast.show({ title: "源内容已更新", description: "已重新加载并保留阅读位置" })
      },
      onReloadFailed() {
        if (sessionRef.current === sessionId) {
          switchToast.show({ title: "源内容已变化", description: "重新加载失败，已保留当前阅读会话" })
        }
      },
      onWatchUnavailable() {
        if (sessionRef.current === sessionId) {
          switchToast.show({ title: "源内容监听暂不可用", description: "当前阅读会话不受影响" })
        }
      },
    })
    return () => controller.abort()
  }, [session?.sessionId])

  useEffect(() => {
    const sessionId = session?.sessionId
    if (!sessionId || !client.updatePreloadContext || typeof document === "undefined") return
    const panorama = session.frame?.layout?.panorama === true
    let request: AbortController | undefined
    const update = () => {
      request?.abort()
      request = new AbortController()
      const signal = request.signal
      const focused = document.visibilityState !== "hidden" && (typeof document.hasFocus !== "function" || document.hasFocus())
      const mode = panorama ? "continuous" : "paged"
      void client.updatePreloadContext!(sessionId, { mode, focused }, signal).then((preload) => {
        if (!signal.aborted && sessionRef.current === sessionId) {
          setSession((current) => current?.sessionId === sessionId ? { ...current, preload } : current)
        }
      }).catch(() => undefined)
    }
    update()
    window.addEventListener("focus", update)
    window.addEventListener("blur", update)
    document.addEventListener("visibilitychange", update)
    return () => {
      request?.abort()
      window.removeEventListener("focus", update)
      window.removeEventListener("blur", update)
      document.removeEventListener("visibilitychange", update)
    }
  }, [client, session?.frame?.layout?.panorama, session?.sessionId])

  async function openPath(nextPath = path, provenance?: import("../adapters/reader-http-client").ReaderActivationProvenanceDto) {
    const normalizedPath = nextPath.trim()
    if (!normalizedPath || busy) return
    slideshow.stop()
    operationRef.current?.abort()
    const controller = new AbortController()
    operationRef.current = controller
    setBusy(true)
    setError(undefined)
    try {
      const previousSession = sessionRef.current
      const presentationReady = loadReaderPresentation()
      const opened = await clientRef.current.open(normalizedPath, controller.signal, provenance)
      try {
        await presentationReady
      } catch (error) {
        await clientRef.current.close(opened.sessionId).catch(() => undefined)
        throw error
      }
      if (controller.signal.aborted) {
        void clientRef.current.close(opened.sessionId).catch(() => undefined)
        return
      }
      sessionRef.current = opened.sessionId
      setSlideshowFadeFrame(undefined)
      setSession(opened)
      setPresentation({ ...DEFAULT_READER_PRESENTATION, ...viewDefaultsRef.current })
      presentationTouchedRef.current = false
      setPath(normalizedPath)
      const nextBrowserOriginPath = provenance?.browserOriginPath ?? browserOriginPath
      setBrowserOriginPath(nextBrowserOriginPath)
      onPathCommitted?.(normalizedPath, nextBrowserOriginPath)
      if (previousSession && previousSession !== opened.sessionId) {
        void clientRef.current.close(previousSession).catch(() => undefined)
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (operationRef.current === controller) operationRef.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const folderNavigationEvents = useMemo(() => new EventTarget(), [])

  function browsePath(nextPath: string) {
    folderNavigationEvents.dispatchEvent(new CustomEvent("browse", { detail: { path: nextPath, newTab: false } }))
  }

  function activateInFolderCard(nextPath: string): boolean {
    const detail = { path: nextPath, handled: false }
    folderNavigationEvents.dispatchEvent(new CustomEvent("activate", { detail }))
    return detail.handled === true
  }

  function openFolderPathInNewTab(nextPath: string) {
    folderNavigationEvents.dispatchEvent(new CustomEvent("browse", { detail: { path: nextPath, newTab: true } }))
  }

  async function navigate(action: "next" | "previous", slideshowAction = false): Promise<boolean> {
    const current = slideshowSessionRef.current
    const atBoundary = action === "next" ? current?.frame.atEnd : current?.frame.atStart
    // Continuous-book overflow is resolved here, not on the hot page-turn path:
    // only a boundary pays the adjacent-book cost, while normal page turns stay
    // a single small JSON control call. It is intentionally symmetric so the
    // first page returns to the previous book's final page.
    if (atBoundary && tailOverflowRef.current === "next-book") {
      // Guard with the same pending ref as updateNavigation so a repeated key
      // cannot start a second switch while the first is still resolving.
      if (navigationPendingRef.current || busy) return false
      const switched = await switchAdjacentBook(action)
      if (switched) {
        if (!slideshowAction) slideshow.resetOnUserAction()
        return true
      }
      // Fall through to the boundary toast when no candidate is available.
    }
    if (atBoundary && !slideshowAction && switchToast.getSnapshot().enableBoundaryToast) {
      switchToast.show({ title: action === "next" ? "已是最后一页" : "已是第一页" })
    }
    const updated = await updateNavigation((sessionId, signal) => clientRef.current.navigate(sessionId, action, signal), slideshowAction)
    if (updated && !slideshowAction) slideshow.resetOnUserAction()
    return updated
  }

  async function goTo(pageIndex: number, slideshowAction = false): Promise<boolean> {
    if (pageIndex === slideshowSessionRef.current?.frame.anchorPageIndex) return false
    const updated = await updateNavigation((sessionId, signal) => clientRef.current.goTo(sessionId, pageIndex, signal), slideshowAction)
    if (updated && !slideshowAction) slideshow.resetOnUserAction()
    return updated
  }

  async function persistSubtitleConfig(patch: Partial<ReaderSubtitleConfigDto>): Promise<void> {
    if (!client.updateMedia) return
    const updated = await client.updateMedia({ media: { subtitle: patch } })
    setMedia(updated)
    videoController.configure(updated)
  }

  async function persistAnimatedVideoMode(patch: ReaderMediaPatchDto["media"]): Promise<ReaderMediaConfigDto> {
    if (!client.updateMedia) return media ?? {
      supportedImageFormats: [],
      videoFormats: [],
      mediaMimeTypes: {},
      autoPlayAnimatedImages: true,
      animatedVideoEnabled: false,
      animatedVideoKeywords: ["[#dyna]"],
      videoMinPlaybackRate: 0.25,
      videoMaxPlaybackRate: 16,
      videoPlaybackRateStep: 0.25,
      subtitle: { fontSize: 1, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
    }
    const updated = await client.updateMedia({ media: patch })
    setMedia(updated)
    videoController.configure(updated)
    return updated
  }

  async function persistSuperResolutionConfig(patch: Parameters<NonNullable<ReaderHttpClient["updateSuperResolution"]>>[0]["superResolution"]) {
    if (!client.updateSuperResolution) throw new Error("当前 Reader 不支持超分配置写入")
    const updated = await client.updateSuperResolution({ superResolution: patch })
    setSuperResolution(updated)
    return updated
  }

  function persistSuperResolution(patch: NonNullable<ReaderRuntimeConfigDto["superResolution"]>["preferences"]) {
    return persistSuperResolutionConfig({ preferences: patch })
  }

  async function runPreloadAction(action: "cancel-speculative" | "release-retained", signal?: AbortSignal) {
    const activeSession = session
    if (!activeSession || !client.runPreloadAction) throw new Error("当前后端不支持预加载控制")
    const result = await client.runPreloadAction(activeSession.sessionId, action, signal)
    if (sessionRef.current !== activeSession.sessionId) throw new Error("Reader 会话已切换")
    if (action === "cancel-speculative") {
      prefetchController.cancel()
      setCancelledPreloadFrame({ sessionId: activeSession.sessionId, generation: activeSession.frame.generation })
    } else {
      prefetchController.releaseRetained(new Set(activeSession.visiblePages.map((page) => page.assetUrl)))
    }
    return result
  }

  async function updateNavigation(
    request: (sessionId: string, signal: AbortSignal) => Promise<ReaderNavigationDto>,
    slideshowAction = false,
  ): Promise<boolean> {
    const sessionId = sessionRef.current
    if (!sessionId || busy || navigationPendingRef.current) return false
    const controller = new AbortController()
    operationRef.current?.abort()
    operationRef.current = controller
    navigationPendingRef.current = true
    setError(undefined)
    try {
      const result = await request(sessionId, controller.signal)
      if (!controller.signal.aborted) {
        setSlideshowFadeFrame(slideshowAction && slideshowConfigRef.current.fadeTransition
          ? `${sessionId}:${result.frame.generation}`
          : undefined)
        setSession((current) => current ? applyNavigation(current, result) : current)
      }
      return !controller.signal.aborted
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause))
      return false
    } finally {
      if (operationRef.current === controller) operationRef.current = undefined
      navigationPendingRef.current = false
    }
  }

  function applyBookSettingsUpdate(sessionId: string, update: ReaderBookSettingsUpdateDto) {
    if (sessionRef.current !== sessionId) return
    setSession((current) => current?.sessionId === sessionId ? applyNavigation(current, update) : current)
  }

  function updatePresentation(next: ReaderPresentation) {
    const defaultsPatch: ReaderViewDefaultsPatch["viewDefaults"] = {}
    if (next.fitMode !== presentation.fitMode) defaultsPatch.fitMode = next.fitMode
    if (next.orientation !== presentation.orientation) defaultsPatch.orientation = next.orientation
    if (next.autoRotation !== presentation.autoRotation) defaultsPatch.autoRotation = next.autoRotation
    if (next.widePageStretch !== presentation.widePageStretch) defaultsPatch.widePageStretch = next.widePageStretch
    presentationTouchedRef.current = true
    setPresentation(next)
    if (Object.keys(defaultsPatch).length) void persistViewDefaults(defaultsPatch)
  }

  async function updatePageMode(pageMode: "single" | "double") {
    if (pageMode === session?.frame.layout.pageMode) return
    const updated = await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
      sessionId,
      { layout: { pageMode } },
      signal,
    ))
    if (updated) void persistViewDefaults({ pageMode })
  }

  async function updateSessionLayout(layout: Partial<NonNullable<typeof session>["frame"]["layout"]>) {
    const current = session?.frame.layout
    if (!current || Object.entries(layout).every(([key, value]) => current[key as keyof typeof current] === value)) return
    const updated = await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
      sessionId,
      { layout },
      signal,
    ))
    if (updated && layout.pageMode) void persistViewDefaults({ pageMode: layout.pageMode })
    if (updated && layout.splitWidePages !== undefined) void persistViewDefaults({ splitWidePages: layout.splitWidePages })
  }

  async function updateReadingDirection(direction: "left-to-right" | "right-to-left") {
    if (direction === session?.frame.direction) return
    await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(sessionId, { direction }, signal))
  }

  async function updateReadingDirectionLock(direction: "left-to-right" | "right-to-left" | null) {
    if (!clientRef.current.updateBookDefaults) throw new Error("当前 Reader 不支持阅读方向锁定")
    setError(undefined)
    try {
      const updated = await clientRef.current.updateBookDefaults({
        book: { ...bookDefaults, lockedReadingDirection: direction },
      })
      setBookDefaults(updated)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function updateCurrentPageOrder(patch: Partial<ReaderPageOrderDto>) {
    if (!clientRef.current.updatePageOrder) throw new Error("当前 Reader 不支持页面排序")
    await updateNavigation((sessionId, signal) => clientRef.current.updatePageOrder!(sessionId, patch, signal))
  }

  async function updatePageOrderLocks(next: ReaderBookDefaultsDto) {
    if (!clientRef.current.updateBookDefaults) throw new Error("当前 Reader 不支持排序锁定")
    setError(undefined)
    try {
      const updated = await clientRef.current.updateBookDefaults({ book: next })
      setBookDefaults(updated)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function updateCurrentBookPageMode(pageMode: "single" | "double") {
    if (pageMode === session?.frame.layout.pageMode) return
    await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
      sessionId,
      { layout: { pageMode } },
      signal,
    ))
  }

  async function updateCurrentBookReadingDirection(direction: "left-to-right" | "right-to-left") {
    if (direction === session?.frame.direction) return
    await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
      sessionId,
      { direction },
      signal,
    ))
  }

  async function persistHistoryListPreferences(patch: Partial<ReaderHistoryListPreferencesDto>): Promise<ReaderHistoryListPreferencesDto> {
    const generation = ++historyListPreferencesGenerationRef.current
    const next = { ...historyListPreferences, ...patch }
    if (!clientRef.current.updateHistoryList) {
      setHistoryListPreferences(next)
      return next
    }
    const updated = await clientRef.current.updateHistoryList({ historyList: patch })
    if (generation === historyListPreferencesGenerationRef.current) setHistoryListPreferences(updated)
    return updated
  }

  async function persistBookmarkListPreferences(patch: Partial<ReaderBookmarkListPreferencesDto>): Promise<ReaderBookmarkListPreferencesDto> {
    const generation = ++bookmarkListPreferencesGenerationRef.current
    const next = { ...bookmarkListPreferences, ...patch }
    if (!clientRef.current.updateBookmarkList) {
      setBookmarkListPreferences(next)
      return next
    }
    const updated = await clientRef.current.updateBookmarkList({ bookmarkList: patch })
    if (generation === bookmarkListPreferencesGenerationRef.current) setBookmarkListPreferences(updated)
    return updated
  }

  async function persistPageListPreferences(patch: Partial<ReaderPageListPreferencesDto>) {
    const next = { ...pageListPreferencesRef.current, ...patch }
    pageListPreferencesRef.current = next
    setPageListPreferences(next)
    if (!clientRef.current.updatePageList) {
      confirmedPageListPreferencesRef.current = next
      return
    }
    const generation = ++pageListPreferencesGenerationRef.current
    const write = pageListPreferencesWriteQueueRef.current.then(async () => {
      try {
        const updated = await clientRef.current.updatePageList!({ pageList: patch })
        confirmedPageListPreferencesRef.current = updated
        if (generation === pageListPreferencesGenerationRef.current) {
          pageListPreferencesRef.current = updated
          setPageListPreferences(updated)
        }
      } catch (cause) {
        if (generation === pageListPreferencesGenerationRef.current) {
          const confirmed = confirmedPageListPreferencesRef.current
          pageListPreferencesRef.current = confirmed
          setPageListPreferences(confirmed)
        }
        throw cause
      }
    })
    pageListPreferencesWriteQueueRef.current = write.catch(() => undefined)
    await write
  }

  async function persistViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]) {
    const current = viewDefaultsRef.current
    const next = {
      ...current,
      ...patch,
      ...(patch.background ? {
        background: {
          ...(current.background ?? INITIAL_VIEW_DEFAULTS.background),
          ...patch.background,
          ...(patch.background.ambient ? { ambient: { ...(current.background ?? INITIAL_VIEW_DEFAULTS.background).ambient, ...patch.background.ambient } } : {}),
          ...(patch.background.aurora ? { aurora: { ...(current.background ?? INITIAL_VIEW_DEFAULTS.background).aurora, ...patch.background.aurora } } : {}),
          ...(patch.background.spotlight ? { spotlight: { ...(current.background ?? INITIAL_VIEW_DEFAULTS.background).spotlight, ...patch.background.spotlight } } : {}),
        },
      } : {}),
    }
    viewDefaultsRef.current = next
    setViewDefaults(next)
    const generation = ++viewDefaultsGenerationRef.current
    const write = viewDefaultsWriteQueueRef.current.then(async () => {
      try {
        const updated = await clientRef.current.updateViewDefaults({ viewDefaults: patch })
        confirmedViewDefaultsRef.current = updated
        if (generation === viewDefaultsGenerationRef.current) {
          viewDefaultsRef.current = updated
          setViewDefaults(updated)
        }
      } catch (cause) {
        if (generation === viewDefaultsGenerationRef.current) {
          const confirmed = confirmedViewDefaultsRef.current
          viewDefaultsRef.current = confirmed
          setViewDefaults(confirmed)
        }
        setError(errorMessage(cause))
      }
    })
    viewDefaultsWriteQueueRef.current = write
    await write
  }

  async function applyConfiguredViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]) {
    if (!Object.keys(patch).length) return
    const presentationPatch = {
      ...(patch.fitMode ? { fitMode: patch.fitMode, manualScale: 1 } : {}),
      ...(patch.orientation ? { orientation: patch.orientation } : {}),
      ...(patch.autoRotation ? { autoRotation: patch.autoRotation } : {}),
      ...(patch.widePageStretch ? { widePageStretch: patch.widePageStretch } : {}),
    }
    if (Object.keys(presentationPatch).length) {
      presentationTouchedRef.current = true
      setPresentation((current) => ({ ...current, ...presentationPatch }))
    }
    if (patch.pageMode && sessionRef.current && patch.pageMode !== session?.frame.layout.pageMode) {
      const updated = await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
        sessionId,
        { layout: { pageMode: patch.pageMode } },
        signal,
      ))
      if (!updated) return
    }
    await persistViewDefaults(patch)
  }

  async function persistInputBindings(patch: ReaderInputBindingsPatch["inputBindings"]): Promise<ReaderInputBindingsConfig> {
    if (!clientRef.current.updateInputBindings) throw new Error("当前 Reader 后端不支持操作绑定设置。")
    const updated = await clientRef.current.updateInputBindings({ inputBindings: patch })
    inputBindingsRef.current = updated
    setInputBindings(updated)
    return updated
  }

  async function persistRadialMenu(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRadialMenuConfig> {
    if (!clientRef.current.updateRadialMenu) throw new Error("当前 Reader 后端不支持轮盘设置。")
    const updated = await clientRef.current.updateRadialMenu({ radialMenu: patch })
    setRadialMenu(updated)
    return updated
  }

  async function persistVoiceControl(patch: ReaderVoiceControlPatch["voiceControl"]): Promise<ReaderVoiceControlConfig> {
    if (!clientRef.current.updateVoiceControl) throw new Error("当前 Reader 后端不支持语音控制设置。")
    const updated = await clientRef.current.updateVoiceControl({ voiceControl: patch })
    setVoiceControl(updated)
    return updated
  }

  async function inspectLegacySettings(content: string, modules?: readonly string[]): Promise<ReaderSettingsMigrationInspection> {
    if (!clientRef.current.inspectLegacySettings) throw new Error("褰撳墠 Reader 鍚庣涓嶆敮鎸佹棫璁剧疆瀵煎叆銆")
    return clientRef.current.inspectLegacySettings(content, modules)
  }

  async function importLegacySettings(content: string, strategy: "merge" | "overwrite" = "merge", modules?: readonly string[]): Promise<ReaderSettingsMigrationImportResult> {
    if (!clientRef.current.importLegacySettings) throw new Error("褰撳墠 Reader 鍚庣涓嶆敮鎸佹棫璁剧疆瀵煎叆銆")
    const result = await clientRef.current.importLegacySettings(content, strategy, modules)
    const config = await clientRef.current.config()
    inputBindingsRef.current = config.inputBindings
    setInputBindings(config.inputBindings)
    setRadialMenu(config.radialMenu ?? structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG))
    setVoiceControl(config.voiceControl)
    shellRef.current = config.shell
    setShell(config.shell)
    return result
  }

  function executeInputAction(action: ReaderInputAction): void {
    if (switchToast.getSnapshot().enableAction) {
      switchToast.show({ title: `操作：${READER_INPUT_ACTION_LABELS[action]}` })
    }
    executeReaderInputAction(action, {
      session: () => session ? {
        pageCount: session.book.pageCount,
        pageIndex: session.frame.anchorPageIndex,
        direction: session.frame.direction,
        pageMode: session.frame.layout.pageMode,
      } : undefined,
      presentation: () => presentation,
      setPresentation: applyInputPresentation,
      navigate,
      goTo,
      switchBook: switchAdjacentBook,
      updatePageMode,
      updateReadingDirection: updateCurrentBookReadingDirection,
      toggleTemporaryFit,
      toggleSinglePanorama,
      toggleFullscreen,
      toggleShellEdge,
      toggleShellPin,
      toggleSidebarControl,
      workspace: {
        toggleLayoutMode: toggleWorkspaceMode,
        focusReader: () => commitWorkspace({ mode: "swimlane", activeLane: "reader" }),
        focusAdjacent: focusAdjacentWorkspaceLane,
        toggleActiveLaneFullscreen: toggleActiveWorkspaceLaneFullscreen,
        fitLanes: fitWorkspaceLanes,
      },
      openFile: () => choose("file"),
      closeFile: closeSession,
      deleteCurrentFile: client.executeFileOperations ? requestDeleteCurrentFile : undefined,
      openSettings: () => setSettingsOpen(true),
      openRadialMenu,
      video: videoController,
      viewerToggles,
      switchToast,
      infoOverlay,
      hoverScroll: {
        getSnapshot: () => ({ enabled: viewDefaultsRef.current.hoverScrollEnabled ?? true }),
        update: ({ enabled }) => persistViewDefaults({ hoverScrollEnabled: enabled }),
      },
      slideshow: {
        toggle: () => slideshow.toggle(),
        stop: () => slideshow.stop(),
        skip: async () => { await navigate("next", true); slideshow.resetOnUserAction() },
      },
    })
  }

  function applyInputPresentation(next: ReaderPresentation): void {
    temporaryFitPresentationRef.current = undefined
    presentationTouchedRef.current = true
    setPresentation(next)
  }

  async function switchAdjacentBook(direction: "next" | "previous"): Promise<boolean> {
    const sessionId = sessionRef.current
    const openAdjacentBook = clientRef.current.openAdjacentBook
    // Prefer refs over React `busy` state so concurrent key handlers from the
    // same render cannot both enter the adjacent-book path.
    if (!sessionId || !openAdjacentBook || busy || navigationPendingRef.current) return false
    slideshow.stop()
    operationRef.current?.abort()
    const controller = new AbortController()
    operationRef.current = controller
    navigationPendingRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      const replacement = await openAdjacentBook(sessionId, direction, controller.signal)
      if (!replacement || controller.signal.aborted) return false
      sessionRef.current = replacement.sessionId
      setSlideshowFadeFrame(undefined)
      setSession(replacement)
      setPresentation({ ...DEFAULT_READER_PRESENTATION, ...viewDefaultsRef.current })
      presentationTouchedRef.current = false
      void clientRef.current.metadata?.(replacement.sessionId, controller.signal).then((metadata) => {
        if (sessionRef.current !== replacement.sessionId) return
        setPath(metadata.book.sourcePath)
        onPathCommitted?.(metadata.book.sourcePath, browserOriginPath)
      }).catch(() => undefined)
      // Book-switch toast is owned by ReaderSwitchToastRuntime via book.id change.
      return true
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause))
      return false
    } finally {
      if (operationRef.current === controller) operationRef.current = undefined
      navigationPendingRef.current = false
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function toggleTemporaryFit(): void {
    const previous = temporaryFitPresentationRef.current
    if (previous) {
      temporaryFitPresentationRef.current = undefined
      presentationTouchedRef.current = true
      setPresentation(previous)
      return
    }
    temporaryFitPresentationRef.current = presentation
    presentationTouchedRef.current = true
    setPresentation({ ...presentation, fitMode: "fit", manualScale: 1 })
  }

  function toggleSinglePanorama(): void {
    const current = session?.frame.layout
    if (!current) return
    void updateSessionLayout({ panorama: !current.panorama })
  }

  function syncPanoramaVisiblePage(pageIndex: number): void {
    setSession((current) => {
      if (!current || !current.frame.layout.panorama || current.frame.anchorPageIndex === pageIndex) return current
      const bounded = Math.max(0, Math.min(current.book.pageCount - 1, pageIndex))
      return { ...current, frame: { ...current.frame, anchorPageIndex: bounded, atStart: bounded === 0, atEnd: bounded >= current.book.pageCount - 1 } }
    })
  }

  async function toggleFullscreen(): Promise<void> {
    const element = surface.ref.current
    if (!element) return
    if (document.fullscreenElement) await document.exitFullscreen?.()
    else await element.requestFullscreen?.()
  }

  function toggleShellEdge(edge: "left" | "right"): void {
    const current = shellControlStore.getSnapshot().edges[edge]
    setShellEdgePinned(edge, !current.open)
  }

  function toggleShellPin(edge: "top" | "bottom"): void {
    const current = shellControlStore.getSnapshot().edges[edge]
    setShellEdgePinned(edge, !current.pinned)
  }

  function toggleSidebarControl(): void {
    const current = shellControlStore.getSnapshot().floating
    setShellFloatingControl({ enabled: !current.enabled })
  }

  function openRadialMenu(): void {
    if (!radialMenu.enabled || !radialMenu.menus.length) return
    const point = lastInputPointRef.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    setRadialMenuRequest((current) => ({ id: (current?.id ?? 0) + 1, ...point }))
  }

  const inputRouter = useReaderInputRouter({ config: inputBindings, disabled: busy, execute: executeInputAction })

  const handleInputPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    lastInputPointRef.current = { x: event.clientX, y: event.clientY }
    inputRouter.onPointerDown(event)
  }

  async function persistSlideshow(patch: ReaderSlideshowPatch["slideshow"]) {
    slideshow.configure(patch)
    const normalizedPatch = patch.intervalSeconds === undefined
      ? patch
      : { ...patch, intervalSeconds: slideshow.getSnapshot().intervalSeconds }
    const next = { ...slideshowConfigRef.current, ...normalizedPatch }
    slideshowConfigRef.current = next
    setSlideshowConfig(next)
    const generation = ++slideshowGenerationRef.current
    const write = slideshowWriteQueueRef.current.then(async () => {
      try {
        const updated = await clientRef.current.updateSlideshow({ slideshow: normalizedPatch })
        confirmedSlideshowConfigRef.current = updated
        if (generation === slideshowGenerationRef.current) {
          slideshowConfigRef.current = updated
          setSlideshowConfig(updated)
          slideshow.configure(updated)
        }
      } catch (cause) {
        if (generation === slideshowGenerationRef.current) {
          const confirmed = confirmedSlideshowConfigRef.current
          slideshowConfigRef.current = confirmed
          setSlideshowConfig(confirmed)
          slideshow.configure(confirmed)
        }
        setError(errorMessage(cause))
      }
    })
    slideshowWriteQueueRef.current = write
    await write
  }

  async function persistFolderView(patch: ReaderFolderViewPatch["folderView"]) {
    const next: ReaderFolderViewConfig = {
      ...folderViewRef.current,
      ...patch,
      details: {
        ...folderViewRef.current.details,
        ...patch.details,
        columnWidths: {
          ...folderViewRef.current.details.columnWidths,
          ...patch.details?.columnWidths,
        },
      },
      search: {
        ...folderViewRef.current.search,
        ...patch.search,
      },
      emptyArea: {
        ...folderViewRef.current.emptyArea,
        ...patch.emptyArea,
      },
      tree: {
        ...folderViewRef.current.tree,
        ...patch.tree,
      },
      tabs: {
        ...(folderViewRef.current.tabs ?? DEFAULT_FOLDER_VIEW.tabs),
        ...patch.tabs,
      },
    }
    folderViewRef.current = next
    setFolderView(next)
    if (!clientRef.current.updateFolderView) {
      confirmedFolderViewRef.current = next
      return
    }
    const generation = ++folderViewGenerationRef.current
    const write = folderViewWriteQueueRef.current.then(async () => {
      try {
        const updated = await clientRef.current.updateFolderView!({ folderView: patch })
        confirmedFolderViewRef.current = updated
        if (generation === folderViewGenerationRef.current) {
          folderViewRef.current = updated
          setFolderView(updated)
        }
      } catch (cause) {
        if (generation === folderViewGenerationRef.current) {
          const confirmed = confirmedFolderViewRef.current
          folderViewRef.current = confirmed
          setFolderView(confirmed)
        }
        setError(errorMessage(cause))
      }
    })
    folderViewWriteQueueRef.current = write
    await write
  }

  async function closeSession() {
    slideshow.stop()
    operationRef.current?.abort()
    operationRef.current = undefined
    const sessionId = sessionRef.current
    sessionRef.current = undefined
    setSession(undefined)
    setSlideshowFadeFrame(undefined)
    setMagnifierEnabled(false)
    setBusy(false)
    if (sessionId) await clientRef.current.close(sessionId).catch(() => undefined)
  }

  function requestDeleteCurrentFile() {
    const sessionId = sessionRef.current
    const sourcePath = path.trim()
    if (!sessionId || !sourcePath || operationRef.current || !clientRef.current.executeFileOperations) return
    const run = () => deleteCurrentFile(sessionId, sourcePath)
    if (folderViewRef.current.confirmDelete === false) {
      void run()
      return
    }
    if (!contextMenu) {
      setError("当前界面无法打开删除确认框，文件未删除。")
      return
    }
    const name = sourcePath.replaceAll("\\", "/").split("/").at(-1) ?? sourcePath
    contextMenu.confirm({
      id: "neoview-reader-delete-current-file",
      label: "删除当前文件",
      icon: <Trash2 />,
      destructive: true,
      confirm: {
        title: "移到回收站？",
        description: `“${name}”将移到系统回收站。`,
        confirmLabel: "移到回收站",
        cancelLabel: "取消",
      },
      onSelect: run,
    })
  }

  async function deleteCurrentFile(sessionId: string, sourcePath: string) {
    const execute = clientRef.current.executeFileOperations
    if (!execute || sessionRef.current !== sessionId || operationRef.current) return
    slideshow.stop()
    const controller = new AbortController()
    operationRef.current = controller
    setBusy(true)
    setError(undefined)
    let released = false
    try {
      await clientRef.current.close(sessionId)
      released = true
      controller.signal.throwIfAborted()
      if (sessionRef.current !== sessionId) return
      sessionRef.current = undefined
      setSession(undefined)
      setSlideshowFadeFrame(undefined)
      setMagnifierEnabled(false)

      const result = await execute([{ kind: "trash", sourcePath }], true, controller.signal)
      const failed = result.results.find((item) => item.status !== "succeeded")
      if (result.succeeded !== 1 || failed) {
        throw new Error(failed?.error ?? failed?.errorCode ?? "移动到回收站失败")
      }
      setPath("")
      switchToast.show({ title: "已移到回收站", description: sourcePath })
    } catch (cause) {
      if (controller.signal.aborted) return
      if (released && !sessionRef.current) {
        try {
          const reopened = await clientRef.current.open(sourcePath, controller.signal)
          sessionRef.current = reopened.sessionId
          setSession(reopened)
        } catch {
          // Preserve the original operation error; reopening is best-effort recovery.
        }
      }
      setError(errorMessage(cause))
    } finally {
      if (operationRef.current === controller) operationRef.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function requestShellEdgeOpen(edge: ReaderShellEdge, open: boolean) {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.requestOpen(edge, open)
    const next = shellControlStore.getSnapshot().edges[edge]
    if (previous.edges[edge].lockMode !== next.lockMode) {
      enqueueShellControl({ edges: { [edge]: { lockMode: next.lockMode, pinned: next.pinned } } }, previous)
    }
  }

  function setShellEdgePinned(edge: ReaderShellEdge, pinned: boolean) {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.setPinned(edge, pinned)
    const next = shellControlStore.getSnapshot().edges[edge]
    enqueueShellControl({ edges: { [edge]: { pinned: next.pinned, lockMode: next.lockMode } } }, previous)
  }

  function cycleShellEdgeLock(edge: ReaderShellEdge) {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.cycleLock(edge)
    const next = shellControlStore.getSnapshot().edges[edge]
    enqueueShellControl({ edges: { [edge]: { pinned: next.pinned, lockMode: next.lockMode } } }, previous)
  }

  function setShellEdgeLock(edge: ReaderShellEdge, lockMode: ReaderShellLockMode) {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.setLock(edge, lockMode)
    const next = shellControlStore.getSnapshot().edges[edge]
    enqueueShellControl({ edges: { [edge]: { pinned: next.pinned, lockMode: next.lockMode } } }, previous)
  }

  function setShellFloatingControl(patch: Partial<ReaderShellControlSnapshot["floating"]>) {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.setFloating(patch)
    enqueueShellControl({ floating: patch }, previous)
  }

  function setShellEdgeTriggerSize(edge: ReaderShellEdge, triggerSize: number) {
    enqueueShellControl({ edges: { [edge]: { triggerSize } } })
  }

  function resetShellControl() {
    const previous = shellControlStore.getSnapshot()
    shellControlStore.replace(defaultShellControlSnapshot())
    enqueueShellControl({ reset: "known-defaults" }, previous)
  }

  function persistShellControl(patch: ReaderShellControlPatch["shellControl"]) {
    enqueueShellControl(patch)
  }

  function toggleWorkspaceMode(): void {
    const current = shellRef.current
    if (!current) return
    const workspace = readerWorkspaceConfig(current)
    commitWorkspace({ mode: workspace.mode === "swimlane" ? "edges" : "swimlane" })
  }

  function focusAdjacentWorkspaceLane(direction: "previous" | "next"): void {
    const current = shellRef.current
    if (!current) return
    const workspace = readerWorkspaceConfig(current)
    const order = workspace.swimlane.laneOrder
    const index = Math.max(0, order.indexOf(workspace.swimlane.activeLane))
    const offset = direction === "previous" ? -1 : 1
    const activeLane = order[(index + offset + order.length) % order.length] ?? "reader"
    commitWorkspace({ mode: "swimlane", activeLane })
  }

  function toggleActiveWorkspaceLaneFullscreen(): void {
    const current = shellRef.current
    if (!current) return
    const workspace = readerWorkspaceConfig(current)
    commitWorkspace({ mode: "swimlane", readerSolo: !workspace.swimlane.readerSolo })
  }

  function fitWorkspaceLanes(): void {
    const current = shellRef.current
    if (!current) return
    const workspace = readerWorkspaceConfig(current)
    const viewportWidth = document.querySelector<HTMLElement>('[data-reader-swimlane-viewport="true"]')?.clientWidth ?? window.innerWidth
    commitWorkspace({ mode: "swimlane", ...fitReaderSwimlanesToViewport(viewportWidth, workspace.swimlane) })
  }

  function commitWorkspace(patch: ReaderWorkspacePatch): void {
    const current = shellRef.current
    if (!current) return
    const optimistic = applyReaderWorkspacePatch(current, patch)
    // Skip pure no-ops (e.g. auto-fit re-emitting the same widths). Otherwise
    // setShell every cycle thrashs the tree into Maximum update depth exceeded.
    if (workspaceConfigEqual(current, optimistic)) return
    shellRef.current = optimistic
    setShell(optimistic)
    enqueueShellControl({ workspace: patch }, undefined, current)
  }

  function enqueueShellControl(
    patch: ReaderShellControlPatch["shellControl"],
    rollback?: ReaderShellControlSnapshot,
    workspaceBase?: ReaderShellConfigDto,
  ) {
    const generation = ++shellControlGenerationRef.current
    if (patch.workspace && shellRef.current) {
      pendingWorkspaceWritesRef.current.push({ generation, patch: patch.workspace, base: workspaceBase ?? shellRef.current })
    }
    shellControlWriteQueueRef.current = shellControlWriteQueueRef.current.then(async () => {
      const update = clientRef.current.updateShellControl
      if (!update) return
      const reconcile = (confirmed: ReaderShellConfigDto) => {
        pendingWorkspaceWritesRef.current = pendingWorkspaceWritesRef.current.filter((entry) => entry.generation !== generation)
        const displayed = pendingWorkspaceWritesRef.current.reduce(
          (current, entry) => applyReaderWorkspacePatch(current, entry.patch),
          confirmed,
        )
        shellRef.current = displayed
        setShell(displayed)
        if (generation === shellControlGenerationRef.current) shellControlStore.replace(shellControlSnapshot(confirmed))
      }
      try {
        let updated: ReaderShellConfigDto
        try {
          updated = await update({ expectedRevision: shellRef.current?.revision ?? 0, shellControl: patch })
        } catch (cause) {
          if (!(cause instanceof ReaderHttpError) || cause.status !== 409) throw cause
          const latest = await clientRef.current.config()
          updated = await update({ expectedRevision: latest.shell.revision ?? 0, shellControl: patch })
        }
        reconcile(updated)
      } catch (cause) {
        if (generation === shellControlGenerationRef.current && rollback) shellControlStore.replace(rollback)
        const failed = pendingWorkspaceWritesRef.current.find((entry) => entry.generation === generation)
        const latest = await clientRef.current.config().catch(() => undefined)
        if (failed || latest) reconcile(latest?.shell ?? failed!.base)
        setError(errorMessage(cause))
      }
    })
  }

  async function commitSidebarLayout(patch: ReaderSidebarLayoutPatch) {
    const previousControl = shellControlStore.getSnapshot()
    if (patch.pinned !== undefined) shellControlStore.setPinned(patch.side, patch.pinned)
    await enqueueShellMutation(async () => {
      try {
        const updated = await clientRef.current.updateSidebarLayout(patch)
        shellRef.current = updated
        setShell(updated)
      } catch (cause) {
        if (patch.pinned !== undefined) shellControlStore.replace(previousControl)
        setShell((current) => current ? { ...current, sidebars: { ...current.sidebars } } : current)
        setError(errorMessage(cause))
      }
    })
  }

  async function commitCardLayout(patch: ReaderCardLayoutPatch) {
    const previous = shell
    const { cardId, ...changes } = patch
    if (previous) {
      const current = previous.cardLayout[cardId]
      if (current) {
        const next = { ...current, ...changes }
        if (changes.height === null) delete next.height
        setShell({
          ...previous,
          cardLayout: { ...previous.cardLayout, [cardId]: next },
        })
      }
    }
    await enqueueShellMutation(async () => {
      try {
        const updated = await clientRef.current.updateCardLayout(patch)
        shellRef.current = updated
        setShell(updated)
      } catch (cause) {
        setShell(previous)
        setError(errorMessage(cause))
      }
    })
  }

  async function commitBoardLayout(patch: ReaderBoardLayoutPatch) {
    await enqueueShellMutation(async () => {
      const request = { ...patch, expectedRevision: shellRef.current?.revision ?? patch.expectedRevision }
      try {
      const updated = await clientRef.current.updateBoardLayout(request)
      shellRef.current = updated
      setShell(updated)
    } catch (cause) {
      if (cause instanceof ReaderHttpError && cause.status === 409) {
        const latest = await refreshLatestShell()
        if (latest) {
          const updated = await clientRef.current.updateBoardLayout({ ...patch, expectedRevision: latest.revision ?? request.expectedRevision })
          shellRef.current = updated
          setShell(updated)
          return
        }
      }
      setError(errorMessage(cause))
      throw cause
      }
    })
  }

  async function commitDraggedPanelLayout(nextShell: ReaderShellConfigDto, patch: ReaderBoardLayoutPatch): Promise<void> {
    const previous = shellRef.current
    shellRef.current = nextShell
    setShell(nextShell)
    await enqueueShellMutation(async () => {
      const request = { ...patch, expectedRevision: shellRef.current?.revision ?? patch.expectedRevision }
      try {
      const updated = await clientRef.current.updateBoardLayout(request)
      shellRef.current = updated
      setShell(updated)
    } catch (cause) {
      if (cause instanceof ReaderHttpError && cause.status === 409) {
        const latest = await refreshLatestShell()
        if (latest) {
          const updated = await clientRef.current.updateBoardLayout({ ...patch, expectedRevision: latest.revision ?? request.expectedRevision })
          shellRef.current = updated
          setShell(updated)
          return
        } else if (shellRef.current === nextShell) {
          shellRef.current = previous
          setShell(previous)
        }
      } else if (shellRef.current === nextShell) {
        shellRef.current = previous
        setShell(previous)
      }
      setError(errorMessage(cause))
      throw cause
      }
    })
  }

  async function persistImageProcessing(patch: Partial<ReaderImageProcessingConfigDto>): Promise<ReaderImageProcessingConfigDto> {
    if (!client.updateImageProcessing) throw new Error("当前 Reader 不支持图像处理配置写入")
    const updated = await client.updateImageProcessing({ imageProcessing: patch })
    setImageProcessing(updated)
    return updated
  }

  async function persistPreload(patch: ReaderRuntimeConfigDto["preload"]): Promise<ReaderRuntimeConfigDto["preload"]> {
    if (!client.updatePreload) throw new Error("当前 Reader 不支持预读预算配置写入")
    const updated = await client.updatePreload({ preload: patch })
    setPreloadConfig(updated)
    return updated
  }

  function enqueueShellMutation(operation: () => Promise<void>): Promise<void> {
    const queued = shellControlWriteQueueRef.current.then(operation)
    shellControlWriteQueueRef.current = queued.then(() => undefined, () => undefined)
    return queued
  }

  async function refreshLatestShell(): Promise<ReaderShellConfigDto | undefined> {
    const latest = await clientRef.current.config().catch(() => undefined)
    if (!latest) return undefined
    shellRef.current = latest.shell
    setShell(latest.shell)
    return latest.shell
  }

  async function commitShellMaterial(material: ReaderShellMaterialPatch): Promise<ReaderShellConfigDto> {
    const update = clientRef.current.updateShellControl
    if (!update) throw new Error("Reader shell material config is read-only.")
    let resolveOperation!: (value: ReaderShellConfigDto) => void
    let rejectOperation!: (reason?: unknown) => void
    const result = new Promise<ReaderShellConfigDto>((resolve, reject) => {
      resolveOperation = resolve
      rejectOperation = reject
    })
    shellControlWriteQueueRef.current = shellControlWriteQueueRef.current.then(async () => {
      try {
        const updated = await update({
          expectedRevision: shellRef.current?.revision ?? 0,
          shellControl: { material },
        })
        shellRef.current = updated
        setShell(updated)
        resolveOperation(updated)
      } catch (cause) {
        if (cause instanceof ReaderHttpError && cause.status === 409) {
          const latest = await clientRef.current.config().catch(() => undefined)
          if (latest) {
            shellRef.current = latest.shell
            setShell(latest.shell)
          }
        }
        setError(errorMessage(cause))
        rejectOperation(cause)
      }
    })
    return result
  }

  async function choose(source: "file" | "directory") {
    const selected = source === "file" ? await pickFile?.() : await pickDirectory?.()
    if (selected) {
      setPath(selected)
      await openPath(selected)
    }
  }

  const compact = surface.mode === "collapsed" || surface.mode === "compact" || surface.mode === "portrait"
  const frame = session?.frame
  const pathSegments = readerPathSegments(path)
  const workspace = shell ? readerWorkspaceConfig(shell) : undefined
  const workspaceMode = workspace?.mode ?? "edges"
  const readerSolo = workspace?.swimlane.readerSolo ?? true
  const readerSoloActive = readerSolo && workspace?.swimlane.activeLane === "reader"
  const readerTopbarLeadingControls = (
    <ReaderWindowBar
      control={shellControl}
      disabled={!shell}
      mode={workspaceMode}
      readerSolo={readerSoloActive}
      onModeChange={(mode) => commitWorkspace({ mode })}
      onReaderSoloChange={(enabled) => commitWorkspace(enabled ? { activeLane: "reader", readerSolo: true } : { readerSolo: false })}
      onOpenSettings={() => setSettingsOpen(true)}
      part="leading"
    />
  )
  const readerTopbarTrailingControls = (
    <ReaderWindowBar
      control={shellControl}
      disabled={!shell}
      mode={workspaceMode}
      readerSolo={readerSoloActive}
      onModeChange={(mode) => commitWorkspace({ mode })}
      onReaderSoloChange={(enabled) => commitWorkspace(enabled ? { activeLane: "reader", readerSolo: true } : { readerSolo: false })}
      onOpenSettings={() => setSettingsOpen(true)}
      windowControls={workspaceMode === "edges" || readerSoloActive ? <FloatingWindowCaptionControls integrated /> : undefined}
      part="trailing"
    />
  )
  useReaderAdjacentPagePreloader({
    client,
    sessionId: session?.sessionId,
    activePageIndex: frame?.anchorPageIndex,
    totalPages: session?.book.pageCount,
    plan: session?.preload,
    enabled: !session || cancelledPreloadFrame?.sessionId !== session.sessionId || cancelledPreloadFrame.generation !== session.frame.generation,
    upscaleEnabled: superResolution?.provider !== "disabled" && superResolution?.preferences.autoUpscaleEnabled === true,
    preload: prefetchController.preload,
    cancel: prefetchController.cancel,
  })

  const topEdge: ReaderControlledEdgeSlot = {
    ariaLabel: "NeoView 顶部工具栏",
    triggerSize: shell?.edges.top.triggerSize,
    triggerRect: workspace?.swimlane.edgeRevealZones.top,
    showDelayMs: shell?.showDelayMs,
    hideDelayMs: shell?.hideDelayMs,
    render: () => (
      <div
        className="border-b border-border/55 bg-background/94 text-foreground shadow-[0_10px_30px_rgb(0_0_0/0.22)] backdrop-blur-xl"
        data-reader-edge-chrome="top"
        style={edgeSurfaceStyle(shell, "top")}
      >
        <div
          className={cn("xiranite-app-region-drag min-h-11 select-none border-b border-border/45", compact ? "pl-1" : "pl-2")}
          data-reader-breadcrumb-bar="true"
          onDoubleClick={floatingFrame?.handleTitlebarDoubleClick}
        >
          {/* Idle and reading share the same three-column chrome; only the
              session-specific affordances (close/reopen, page index) change. */}
          <div className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_minmax(0,auto)] items-center gap-1.5">
            <div className="xiranite-app-region-no-drag flex min-w-0 items-stretch justify-self-start">
              {session ? (
                <Button className="justify-self-start" aria-label="关闭书籍" type="button" size="icon-sm" variant="ghost" onClick={() => void closeSession()}><X /></Button>
              ) : path.trim() ? (
                <Button
                  className="justify-self-start"
                  aria-label="打开书籍"
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void openPath()}
                >
                  {busy ? <LoaderCircle className="animate-spin" /> : <BookOpen />}
                </Button>
              ) : null}
              {readerTopbarLeadingControls}
            </div>
            <nav
              className="flex min-w-0 items-center justify-center gap-1 overflow-hidden text-center"
              aria-label={session ? "当前书籍路径" : pathSegments.length ? "最近书籍路径" : "NeoView"}
              data-reader-breadcrumb-path="true"
            >
              {pathSegments.length ? pathSegments.map((segment, index) => (
                <span className="contents" key={`${segment}-${index}`}>
                  {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/65" aria-hidden="true" /> : null}
                  <span className={cn("truncate text-xs", index === pathSegments.length - 1 ? "font-medium text-foreground" : "text-muted-foreground")}>{segment}</span>
                </span>
              )) : (
                <span className="truncate text-xs text-muted-foreground">NeoView</span>
              )}
            </nav>
            <div className="xiranite-app-region-no-drag flex min-w-0 items-stretch justify-self-end">
              {session ? (
                <span className="hidden shrink-0 items-center px-1.5 text-[11px] tabular-nums text-muted-foreground lg:flex">{(frame?.anchorPageIndex ?? 0) + 1} / {session.book.pageCount}</span>
              ) : null}
              {readerTopbarTrailingControls}
            </div>
          </div>
        </div>
        {session ? (
          <Suspense fallback={null}>
            <LazyReaderViewToolbar
              disabled={busy}
              layout={frame?.layout ?? session.frame.layout}
              direction={frame?.direction ?? session.frame.direction}
              presentation={presentation}
              onChange={updatePresentation}
              onLayoutChange={(layout) => void updateSessionLayout(layout)}
              onDirectionChange={(direction) => void updateReadingDirection(direction)}
              lockedReadingDirection={bookDefaults.lockedReadingDirection}
              onDirectionLockChange={(direction) => void updateReadingDirectionLock(direction)}
              pageOrder={session.pageOrder ?? { sortMode: "fileName", mediaPriority: "none" }}
              lockedSortMode={bookDefaults.lockedSortMode}
              lockedMediaPriority={bookDefaults.lockedMediaPriority}
              onPageOrderChange={updateCurrentPageOrder}
              onPageOrderLockChange={updatePageOrderLocks}
              hoverScrollEnabled={viewDefaults.hoverScrollEnabled ?? true}
              hoverScrollSpeed={viewDefaults.hoverScrollSpeed ?? 2}
              onHoverScrollChange={(patch) => persistViewDefaults({
                ...(patch.enabled === undefined ? {} : { hoverScrollEnabled: patch.enabled }),
                ...(patch.speed === undefined ? {} : { hoverScrollSpeed: patch.speed }),
              })}
              magnifierEnabled={magnifierEnabled}
              magnifierZoom={viewDefaults.magnifierZoom ?? 2}
              magnifierSize={viewDefaults.magnifierSize ?? 200}
              onMagnifierEnabledChange={setMagnifierEnabled}
              onMagnifierConfigChange={(patch) => persistViewDefaults({
                ...(patch.zoom === undefined ? {} : { magnifierZoom: patch.zoom }),
                ...(patch.size === undefined ? {} : { magnifierSize: patch.size }),
              })}
              slideshow={slideshow}
              onSlideshowChange={persistSlideshow}
            
            />
          </Suspense>
        ) : null}
        {error ? <div role="alert" className="border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
      </div>
    ),
  }

  const bottomEdge: ReaderControlledEdgeSlot | undefined = session && (shell?.edges.bottom.enabled ?? true) ? {
    ariaLabel: "NeoView 底部缩略图与导航栏",
    triggerSize: shell?.edges.bottom.triggerSize,
    triggerRect: workspace?.swimlane.edgeRevealZones.bottom,
    showDelayMs: shell?.showDelayMs,
    hideDelayMs: shell?.hideDelayMs,
    render: () => (
      <div
        className="border-t border-border/55 bg-background/94 shadow-[0_-12px_30px_rgb(0_0_0/0.24)] backdrop-blur-xl"
        data-reader-edge-chrome="bottom"
        style={edgeSurfaceStyle(shell, "bottom")}
      >
        <ThumbnailStrip
          sessionId={session.sessionId}
          totalPages={session.book.pageCount}
          activePageIndex={session.frame.anchorPageIndex}
          currentPages={session.visiblePages}
          client={client}
          compact={compact}
          disabled={busy}
          pinned={shell?.edges.bottom.pinned ?? false}
          onPinnedChange={(pinned) => shellControl.setPinned("bottom", pinned)}
          viewerToggles={viewerToggles}
          onSelect={goTo}
        />
      </div>
    ),
  } : undefined

  const panelContext = {
    client,
    disabled: busy,
    onGoTo: goTo,
    onBookSettingsUpdated: applyBookSettingsUpdate,
    onInputAction: executeInputAction,
    bookmarkListPreferences,
    onBookmarkListPreferences: persistBookmarkListPreferences,
    historyListPreferences,
    onHistoryListPreferences: persistHistoryListPreferences,
    pageListPreferences,
    onPageListPreferences: persistPageListPreferences,
    onPageModeChange: updateCurrentBookPageMode,
    onReadingDirectionChange: updateCurrentBookReadingDirection,
    onPreloadAction: runPreloadAction,
    sourcePath: path,
    browserOriginPath,
    pickDirectory,
    systemActions: {
      copyText,
      copyFiles,
      revealPath: client.revealSystemPath,
    },
    onOpen: openPath,
    onBrowsePath: browsePath,
    onActivateInFolderCard: activateInFolderCard,
    onOpenInNewTab: openFolderPathInNewTab,
    folderNavigationEvents,
    shell,
    shellControl,
    colorFilter,
    pageTransition,
    switchToast,
    infoOverlay,
    imageTrim,
    media,
    onMediaChange: persistAnimatedVideoMode,
    imageProcessing,
    onImageProcessingChange: persistImageProcessing,
    preload: preloadConfig,
    onPreload: persistPreload,
    slideshow: slideshowConfig,
    onSlideshow: persistSlideshow,
    inputBindings,
    onInputBindings: persistInputBindings,
    radialMenu,
    onRadialMenu: persistRadialMenu,
    voiceControl,
    onVoiceControl: persistVoiceControl,
    onMaterial: commitShellMaterial,
    onLegacySettingsInspect: inspectLegacySettings,
    onLegacySettingsImport: importLegacySettings,
    superResolution,
    onSuperResolutionChange: persistSuperResolution,
    onSuperResolutionConfigChange: persistSuperResolutionConfig,
    onSidebarLayout: commitSidebarLayout,
    onBoardLayout: commitBoardLayout,
    viewDefaults,
    onViewDefaults: applyConfiguredViewDefaults,
    folderView,
    onFolderView: persistFolderView,
    presentation,
    ...(session ? { session } : {}),
  }
  const leftEdge: ReaderControlledEdgeSlot | undefined = shell && shell.edges.left.enabled ? {
    ariaLabel: "NeoView 左侧面板",
    showDelayMs: shell?.showDelayMs ?? 80,
    hideDelayMs: shell?.hideDelayMs,
    triggerSize: shell?.edges.left.triggerSize,
    preload: () => void loadReaderSidebar(),
    render: (active) => (
      <Suspense fallback={<div className="h-full w-80 animate-pulse border-r border-border/70 bg-background/85" aria-label="正在加载左侧面板" />}>
        <LazyReaderSidebar side="left" context={panelContext} shell={shell} active={active} onLayoutCommit={(patch) => void commitSidebarLayout(patch)} onCardLayoutCommit={(patch) => void commitCardLayout(patch)} />
      </Suspense>
    ),
  } : undefined
  const rightEdge: ReaderControlledEdgeSlot | undefined = shell && shell.edges.right.enabled ? {
    ariaLabel: "NeoView 右侧面板",
    showDelayMs: shell?.showDelayMs ?? 80,
    hideDelayMs: shell?.hideDelayMs,
    triggerSize: shell?.edges.right.triggerSize,
    preload: () => void loadReaderSidebar(),
    render: (active) => (
      <Suspense fallback={<div className="h-full w-80 animate-pulse border-l border-border/70 bg-background/85" aria-label="正在加载右侧面板" />}>
        <LazyReaderSidebar side="right" context={panelContext} shell={shell} active={active} onLayoutCommit={(patch) => void commitSidebarLayout(patch)} onCardLayoutCommit={(patch) => void commitCardLayout(patch)} />
      </Suspense>
    ),
  } : undefined
  const readerCanvas = (
    <div
      ref={readerInteractionRef}
      className="relative h-full min-h-0 overflow-hidden"
      style={{ backgroundColor: (viewDefaults.background ?? INITIAL_VIEW_DEFAULTS.background).mode === "solid" ? (viewDefaults.background ?? INITIAL_VIEW_DEFAULTS.background).color : "#000000" }}
      data-reader-interaction-scope="true"
      data-input-context="reader"
      onPointerDown={handleInputPointerDown}
      onPointerUp={inputRouter.onPointerUp}
      onContextMenu={(event) => { if (radialMenuRequest) event.preventDefault() }}
    >
      {(viewDefaults.background ?? INITIAL_VIEW_DEFAULTS.background).mode !== "solid" ? <Suspense fallback={null}><LazyReaderBackgroundLayer config={viewDefaults.background ?? INITIAL_VIEW_DEFAULTS.background} imageSrc={session?.visiblePages.find((page) => page.mediaKind === "image")?.assetUrl} /></Suspense> : null}
      {radialMenuRequest ? <Suspense fallback={null}><LazyReaderRadialMenuOverlay config={radialMenu} request={radialMenuRequest} onClose={() => setRadialMenuRequest(undefined)} onSelect={(action) => executeInputAction(action)} /></Suspense> : null}
      {!session ? (
        <div className="grid h-full place-items-center p-6 text-center text-sm text-white/55">
          <div>
            <BookOpen className="mx-auto mb-3 size-8 opacity-60" />
            <p>从文件夹、历史记录或播放列表打开漫画</p>
          </div>
        </div>
      ) : (
        <Suspense fallback={null}>
          <LazyReaderFrame
            pages={session.visiblePages}
            framePages={session.frame.pages}
            presentation={presentation}
            panorama={session.frame.layout.panorama}
            pageMode={session.frame.layout.pageMode}
            doublePageGap={viewDefaults.doublePageGap ?? 0}
            direction={session.frame.direction}
            totalPages={session.book.pageCount}
            anchorPageIndex={session.frame.anchorPageIndex}
            preloadGeneration={session.preload?.generation}
            hoverScrollEnabled={viewDefaults.hoverScrollEnabled ?? true}
            hoverScrollSpeed={viewDefaults.hoverScrollSpeed ?? 2}
            magnifierEnabled={magnifierEnabled}
            magnifierZoom={viewDefaults.magnifierZoom ?? 2}
            magnifierSize={viewDefaults.magnifierSize ?? 200}
            colorFilter={colorFilter}
            pageTransition={pageTransition}
            slideshowFade={slideshowFadeFrame === `${session.sessionId}:${session.frame.generation}`}
            videoController={videoController}
            sessionId={session.sessionId}
            client={client}
            media={media}
            superResolution={superResolution}
            viewerToggles={viewerToggles}
            onSubtitleConfigChange={persistSubtitleConfig}
            onVisiblePageChange={syncPanoramaVisiblePage}
            imageTrim={imageTrim}
            onVideoListEnded={() => void navigate("next")}
          />
        </Suspense>
      )}
      {busy && session ? <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 p-2 text-white"><LoaderCircle className="size-4 animate-spin" /></div> : null}
      {workspaceMode === "edges" && shell ? <DeferredSidebarFloatingController control={shellControl} shell={shell} disabled={busy} /> : null}
    </div>
  )

  return (
    <div
      ref={surface.ref}
      data-reader-app="true"
      data-input-context="reader"
      data-context-menu-stop=""
      className="relative flex h-full min-h-0 w-full touch-none flex-col overflow-hidden bg-background text-foreground"
      tabIndex={0}
    >
      <Suspense fallback={null}>
        <LazyReaderGestureInputRuntime config={inputBindings} disabled={busy} target={readerInteractionRef} claimPointer={inputRouter.claimPointer} dispatch={inputRouter.dispatch} />
      </Suspense>
      <Suspense fallback={null}>
        <LazyReaderSwitchToastRuntime port={switchToast} session={session} sourcePath={path} />
      </Suspense>
      <Suspense fallback={null}>
        <LazyReaderInfoOverlayRuntime port={infoOverlay} session={session} sourcePath={path} />
      </Suspense>
      <FloatingWindowTitlebarReservation />
      <div className="min-h-0 flex-1 overflow-hidden">
        <ReaderPanelDndProvider shell={shell} onMove={commitDraggedPanelLayout}>
          {workspaceMode === "swimlane" && shell && workspace ? (
            <ReaderSwimlaneErrorBoundary resetKey={`${workspaceMode}:${shell.revision ?? 0}`} onReturnToEdges={() => commitWorkspace({ mode: "edges" })}>
              <ReaderSwimlaneWorkspace
                shell={shell}
                workspace={workspace}
                disabled={!shell}
                windowChrome={floatingFrame && !readerSoloActive ? {
                  controls: <FloatingWindowCaptionControls integrated density="compact" />,
                  onTitlebarDoubleClick: floatingFrame.handleTitlebarDoubleClick,
                } : undefined}
                onWorkspaceChange={commitWorkspace}
                onOpenSettings={() => setSettingsOpen(true)}
                reader={(
                  <ReaderControlledEdgeShell store={shellControlStore} edges={{ top: topEdge, bottom: bottomEdge }}>
                    {readerCanvas}
                  </ReaderControlledEdgeShell>
                )}
                left={(
                  <Suspense fallback={<div className="h-full w-full animate-pulse bg-background/85" aria-label="正在加载左侧泳道" />}>
                    <LazyReaderSidebar
                      side="left"
                      presentation="lane"
                      context={panelContext}
                      shell={shell}
                      selectedPanelId={workspace.swimlane.lanes.left.activePanelId}
                      onSelectedPanelChange={(activePanelId) => commitWorkspace({ lanes: { left: { activePanelId } } })}
                      onPanelBarChange={(patch) => commitWorkspace({ lanes: { left: patch } })}
                      onCardLayoutCommit={(patch) => void commitCardLayout(patch)}
                    />
                  </Suspense>
                )}
                right={(
                  <Suspense fallback={<div className="h-full w-full animate-pulse bg-background/85" aria-label="正在加载右侧泳道" />}>
                    <LazyReaderSidebar
                      side="right"
                      presentation="lane"
                      context={panelContext}
                      shell={shell}
                      selectedPanelId={workspace.swimlane.lanes.right.activePanelId}
                      onSelectedPanelChange={(activePanelId) => commitWorkspace({ lanes: { right: { activePanelId } } })}
                      onPanelBarChange={(patch) => commitWorkspace({ lanes: { right: patch } })}
                      onCardLayoutCommit={(patch) => void commitCardLayout(patch)}
                    />
                  </Suspense>
                )}
              />
            </ReaderSwimlaneErrorBoundary>
          ) : (
            <ReaderControlledEdgeShell store={shellControlStore} edges={{ top: topEdge, right: rightEdge, bottom: bottomEdge, left: leftEdge }}>
              {readerCanvas}
            </ReaderControlledEdgeShell>
          )}
        </ReaderPanelDndProvider>
      </div>
      {settingsOpen && shell ? (
        <Suspense fallback={null}>
          <LazyReaderSettingsWindow
            portalContainer={surface.ref.current}
            shell={shell}
            viewDefaults={viewDefaults}
            slideshow={slideshowConfig}
            media={media}
            imageProcessing={imageProcessing}
            preload={preloadConfig}
            inputBindings={inputBindings}
            radialMenu={radialMenu}
            onClose={() => setSettingsOpen(false)}
            onBoardLayout={commitBoardLayout}
            onViewDefaults={applyConfiguredViewDefaults}
            onSlideshow={persistSlideshow}
            onMedia={persistAnimatedVideoMode}
            onImageProcessing={persistImageProcessing}
            onPreload={persistPreload}
            onInputBindings={persistInputBindings}
            onRadialMenu={persistRadialMenu}
            onLegacySettingsInspect={inspectLegacySettings}
            onLegacySettingsImport={importLegacySettings}
            onMaterial={commitShellMaterial}
            onWorkspace={commitWorkspace}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

function DeferredSidebarFloatingController({ control, shell, disabled }: { control: ReaderShellControlPort; shell: ReaderShellConfigDto; disabled: boolean }) {
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

function shellControlHydration(shell: ReaderShellConfigDto): ReaderShellControlHydration {
  return {
    edges: Object.fromEntries((Object.keys(shell.edges) as ReaderShellEdge[]).map((edge) => [edge, {
      open: shell.edges[edge].initialVisible,
      pinned: shell.edges[edge].pinned,
      lockMode: shell.edges[edge].lockMode ?? "auto",
    }])) as ReaderShellControlHydration["edges"],
    floating: shell.floatingControl ?? { enabled: true, position: { x: 100, y: 100 } },
  }
}

function shellControlSnapshot(shell: ReaderShellConfigDto): ReaderShellControlSnapshot {
  return shellControlHydration(shell) as ReaderShellControlSnapshot
}

function defaultShellControlSnapshot(): ReaderShellControlSnapshot {
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

function edgeSurfaceStyle(shell: ReaderShellConfigDto | undefined, edge: "top" | "bottom"): React.CSSProperties | undefined {
  if (!shell) return undefined
  return readerShellMaterialStyle(readerShellMaterialDraft(shell), edge)
}

function readerPathSegments(path: string): string[] {
  const segments = path.split(/[\\/]+/).filter(Boolean)
  return segments.length ? segments : ["未选择"]
}

function applyNavigation(session: ReaderSessionDto, navigation: ReaderNavigationDto): ReaderSessionDto {
  return {
    ...session,
    frame: navigation.frame,
    visiblePages: navigation.visiblePages,
    pageOrder: navigation.pageOrder ?? session.pageOrder,
    preload: navigation.preload ?? session.preload,
  }
}

function waitForReaderOperationIdle(signal: AbortSignal): Promise<void> {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
