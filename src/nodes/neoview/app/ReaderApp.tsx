import { startTransition, useEffect, useMemo, useRef, useState, type PointerEventHandler } from "react"
import {
  DEFAULT_READER_PRESENTATION,
  DEFAULT_READER_INPUT_BINDINGS,
  DEFAULT_READER_RADIAL_MENU_CONFIG,
  ReaderSlideshow,
  type ReaderPresentation,
  type ReaderInputBindingsConfig,
  type ReaderRadialMenuConfig,
  type ReaderVoiceControlConfig,
} from "@xiranite/node-neoview/ui-core"

import { useContextMenu } from "@/components/context-menu"
import { useFloatingWindowFrame } from "@/components/workspace/FloatingWindowFrame"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { useSwimlaneSessionStore } from "@/store/swimlaneSessionStore"
import {
  createReaderHttpClient,
  type ReaderHttpClient,
  type ReaderBookmarkListPreferencesDto,
  type ReaderHistoryListPreferencesDto,
  type ReaderBookDefaultsDto,
  type ReaderRuntimeConfigDto,
  type ReaderMediaConfigDto,
  type ReaderImageProcessingConfigDto,
  type ReaderPageListPreferencesDto,
  type ReaderSessionDto,
  type ReaderShellConfigDto,
  type ReaderFolderViewConfig,
  type ReaderSlideshowConfig,
  type ReaderShellControlPatch,
  type ReaderShellEdge,
  type ReaderShellLockMode,
} from "../adapters/reader-http-client"
import { useReaderSpeculativePreloadGate } from "../features/reader/useReaderSpeculativePreloadGate"
import { useReaderAdjacentPagePreloader } from "../features/reader/useReaderAdjacentPagePreloader"
import { useReaderImagePreloader } from "../features/reader/useReaderImagePreloader"
import { watchReaderSourceChanges } from "../features/reader/watchReaderSourceChanges"
import { neoviewDebug, neoviewDebugAsync } from "../neoviewDebug"
import { createReaderShellControlStore, type ReaderShellControlSnapshot } from "../features/shell/ReaderShellControlStore"
import type { ReaderShellControlPort } from "../features/shell/ReaderShellControlPort"
import { useReaderInputRouter } from "../features/input/ReaderInputRouter"
import { createReaderColorFilterStore } from "../features/color-filter/ReaderColorFilterStore"
import { migrateLegacyReaderColorFilter } from "../features/color-filter/LegacyReaderColorFilterMigration"
import { createReaderPageTransitionStore } from "../features/page-transition/ReaderPageTransitionStore"
import { ReaderVideoController } from "../features/video/ReaderVideoController"
import { ReaderViewerToggleStore } from "../features/viewer/ReaderViewerToggleStore"
import { migrateLegacyReaderPageTransition } from "../features/page-transition/LegacyReaderPageTransitionMigration"
import { migrateLegacySidebarHeight } from "../features/panels/cards/LegacySidebarHeightMigration"
import { createReaderSwitchToastStore } from "../features/switch-toast/ReaderSwitchToastStore"
import { createReaderInfoOverlayStore } from "../features/info-overlay/ReaderInfoOverlayStore"
import { createReaderImageTrimStore } from "../features/image-trim/ReaderImageTrimStore"
import { useDeferredFinalCleanup } from "../features/settings/useDeferredFinalCleanup"
import { readerWorkspaceConfig, type ReaderWorkspacePatch } from "../features/workspace/ReaderWorkspaceLayout"
import { createInitialReaderShellConfig } from "./ReaderShellSnapshot"
import { useReaderWorkspaceRestoreStore } from "./ReaderWorkspaceRestoreStore"
import { workspaceConfigEqual, readerWorkspaceWithSession, splitReaderWorkspacePatch, INITIAL_VIEW_DEFAULTS, INITIAL_HISTORY_LIST_PREFERENCES, INITIAL_BOOKMARK_LIST_PREFERENCES, INITIAL_PAGE_LIST_PREFERENCES, INITIAL_BOOK_DEFAULTS, INITIAL_SLIDESHOW_CONFIG, INITIAL_PRELOAD_CONFIG, INITIAL_FOLDER_VIEW_CONFIG, loadReaderSidebar, LazyReaderSidebar, LazyReaderGestureInputRuntime, LazyReaderRadialMenuOverlay, LazyReaderSettingsWindow, loadReaderFrame, LazyReaderFrame, LazyReaderBackgroundLayer, LazyReaderViewToolbar, LazyReaderSwitchToastRuntime, LazyReaderInfoOverlayRuntime, loadReaderPresentation, DeferredSidebarFloatingController, shellControlHydration, shellControlSnapshot, defaultShellControlSnapshot, edgeSurfaceStyle, readerPathSegments, fileMutationContainsSource, applyNavigation, waitForReaderOperationIdle, errorMessage, type ReaderAppProps, type ReaderExternalOpenRequest } from "./ReaderAppModules"
import { createReaderAppSettingsActions } from "./ReaderAppSettingsActions"
import { attachReaderAppFileActions } from "./ReaderAppFileActions"
import { createReaderAppWorkspaceActions } from "./ReaderAppWorkspaceActions"
import { createReaderAppInputActions } from "./ReaderAppInputActions"
import { ReaderAppView } from "./ReaderAppView"
import { useReaderSwimlaneSidebarDeferral } from "./useReaderSwimlaneSidebarDeferral"
import { readerActivationIdentityMatchesProvenance, type ReaderAppActivationIdentityProps } from "./ReaderActivationIdentity"
import { useReaderActivationIdentity } from "./useReaderActivationIdentity"
import { dispatchReaderFileCardDeleteBinding } from "./ReaderFileCardDeleteBinding"
import { useReaderFolderNavigationEvents } from "./useReaderFolderNavigationEvents"
import { useReaderExternalOpenRequest } from "./useReaderExternalOpenRequest"
import { useReaderExternalFolderOpen } from "./useReaderExternalFolderOpen"
import { useReaderStartupRestore } from "./useReaderStartupRestore"
import { createReaderNavigationActions } from "./ReaderNavigationActions"
import { ReaderDeletionTransactionCoordinator } from "../features/files/ReaderDeletionTransactionCoordinator"
export { fileMutationContainsSource, type ReaderAppProps } from "./ReaderAppModules"
export function ReaderApp({
  sessionScopeId = "standalone",
  initialPath = "",
  initialActivationIdentity, initialBrowserOriginPath, externalOpenRequest, onExternalOpenResult,
  initialSwimlaneSoloLaneId,
  initialReaderViewFullscreen,
  client: injectedClient,
  pickFile,
  pickDirectory,
  pickEfuFile,
  copyText,
  copyFiles,
  onActivationIdentityCommitted,
  onSwimlaneSoloLaneIdCommitted,
  onReaderViewFullscreenCommitted,
}: Omit<ReaderAppProps, "onActivationIdentityCommitted"> & ReaderAppActivationIdentityProps) {
  const surface = useNodeSurface()
  const floatingFrame = useFloatingWindowFrame()
  const contextMenu = useContextMenu()
  const swimlaneSessionScopeId = `neoview:${sessionScopeId}`
  const swimlaneSession = useSwimlaneSessionStore((state) => state.sessions[swimlaneSessionScopeId])
  const patchSwimlaneSession = useSwimlaneSessionStore((state) => state.patchSession)
  const readerBootedAtRef = useRef(performance.now())
  const [client] = useState<ReaderHttpClient>(() => {
    const created = injectedClient ?? createReaderHttpClient()
    neoviewDebug("reader:client-created", {
      sessionScopeId,
      injected: Boolean(injectedClient),
      initialPath: initialPath || undefined,
    })
    return created
  })
  const clientRef = useRef(client)
  const startupRestoreHydrateRef = useRef<(config: ReaderRuntimeConfigDto["startup"]) => void>()
  const shellRef = useRef<ReaderShellConfigDto | undefined>(undefined)
  const readerInteractionRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<string | undefined>(undefined)
  const operationRef = useRef<AbortController | undefined>(undefined)
  const openOperationRef = useRef<AbortController | undefined>(undefined)
  const activeSourcePathRef = useRef(initialPath.trim())
  const readerActivation = useReaderActivationIdentity({
    initialPath,
    initialActivationIdentity,
    initialBrowserOriginPath,
    onActivationIdentityCommitted,
  })
  const navigationPendingRef = useRef(false)
  const adjacentBookPendingRef = useRef(false)
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
  const [deletionCoordinator] = useState(() => new ReaderDeletionTransactionCoordinator())
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
  const [browserOriginPath, setBrowserOriginPath] = useState(initialActivationIdentity?.traversalRootPath ?? initialBrowserOriginPath)
  const { externalFolderOpenRequest, beginExternalFolderOpen, completeExternalFolderOpen } = useReaderExternalFolderOpen()
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
  const [shell, setShell] = useState<ReaderShellConfigDto | undefined>(() => createInitialReaderShellConfig(
    useReaderWorkspaceRestoreStore.getState().shellSnapshot,
  ))
  const [readerChromeReady, setReaderChromeReady] = useState(false)
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
  const [readerViewFullscreen, setReaderViewFullscreen] = useState(
    () => initialReaderViewFullscreen ?? useReaderWorkspaceRestoreStore.getState().readerViewFullscreen,
  )
  /** Swimlane left/right sidebars are deferred until after the first shell paint. */
  const [swimlaneSidebarsReady, setSwimlaneSidebarsReady] = useState(false)
  /** Right rail mounts a beat after left so control-panel cards do not compete with history. */
  const [swimlaneRightSidebarReady, setSwimlaneRightSidebarReady] = useState(false)
  /**
   * After openPath commits, defer LazyReaderFrame by one paint+idle so chrome stays
   * interactive. Mounting frame+decode+adjacent preload on the same turn freezes the WebView.
   */
  const [readerFrameAllowed, setReaderFrameAllowed] = useState(false)
  const browserPredecodeEnabled = preloadConfig.browserPredecodeEnabled
  const prefetchController = useReaderImagePreloader(session?.sessionId, client.reportPreloadEvents
    ? (sessionId, generation, events) => void client.reportPreloadEvents!(sessionId, generation, events).catch(() => undefined)
    : undefined, browserPredecodeEnabled, preloadConfig.browserPredecodePages)
  const speculativePreloadAllowed = useReaderSpeculativePreloadGate({ sessionId: session?.sessionId, frameGeneration: session?.frame.generation, enabled: browserPredecodeEnabled && readerFrameAllowed })
  const [cancelledPreloadFrame, setCancelledPreloadFrame] = useState<{ sessionId: string; generation: number }>()
  slideshowSessionRef.current = session
  shellRef.current = shell
  useEffect(() => {
    if (!session?.sessionId) {
      setReaderFrameAllowed(false)
      return
    }
    setReaderFrameAllowed(false)
    let cancelled = false
    let outerRaf = 0
    let innerRaf = 0
    let idleHandle: number | undefined
    let timeoutHandle: number | undefined
    const startedAt = performance.now()
    neoviewDebug("reader:frame:defer", {
      sessionScopeId,
      sessionId: session.sessionId,
      pageCount: session.book.pageCount,
      visiblePages: session.visiblePages.length,
    })
    outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (cancelled) return
        const allow = () => {
          if (cancelled) return
          neoviewDebug("reader:frame:mount-allowed", {
            sessionScopeId,
            sessionId: session.sessionId,
            waitMs: Math.round((performance.now() - startedAt) * 10) / 10,
          })
          setReaderFrameAllowed(true)
        }
        // Prefer a short settle window so folder/history sidebars finish their
        // post-open re-render before the heavy PageImage/decode path starts.
        if (typeof requestIdleCallback === "function") {
          idleHandle = requestIdleCallback(allow, { timeout: 250 })
        } else {
          timeoutHandle = window.setTimeout(allow, 48)
        }
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(outerRaf)
      cancelAnimationFrame(innerRaf)
      if (idleHandle !== undefined && typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle)
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle)
    }
  }, [session?.book.pageCount, session?.sessionId, session?.visiblePages.length, sessionScopeId])
  useDeferredFinalCleanup(() => {
    neoviewDebug("reader:dispose", {
      sessionScopeId,
      livedMs: Math.round(performance.now() - readerBootedAtRef.current),
      hadSession: Boolean(sessionRef.current),
    })
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
    neoviewDebug("reader:mount", {
      sessionScopeId,
      initialPath: initialPath || undefined,
      surface: surface.mode,
    })
    // Warm the frame chunk before the user opens a book so open:committed does
    // not pay module-evaluation cost on the freeze-critical turn.
    void loadReaderFrame().catch(() => undefined)
    const controller = new AbortController()
    const chromeFallbackTimer = window.setTimeout(() => setReaderChromeReady(true), 0)
    const shellRequestGeneration = shellControlGenerationRef.current
    const configStartedAt = performance.now()
    neoviewDebug("reader:config:request", { sessionScopeId })
    void clientRef.current.config(controller.signal).then((config) => {
      window.clearTimeout(chromeFallbackTimer)
      setReaderChromeReady(true)
      const networkMs = Math.round((performance.now() - configStartedAt) * 10) / 10
      neoviewDebug("reader:config:response", {
        sessionScopeId,
        networkMs,
        workspaceMode: config.shell?.workspace?.mode,
        hasShell: Boolean(config.shell),
      })
      const applyStartedAt = performance.now()
      setMedia(config.media)
      setImageProcessing(config.imageProcessing)
      setPreloadConfig(config.preload ?? INITIAL_PRELOAD_CONFIG)
      startupRestoreHydrateRef.current?.(config.startup)
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
      const laneOrder = readerWorkspaceConfig(config.shell).swimlane.laneOrder
      const restore = useReaderWorkspaceRestoreStore.getState()
      const cachedSession = useSwimlaneSessionStore.getState().sessions[swimlaneSessionScopeId]
      const cachedSoloLaneId = cachedSession && Object.hasOwn(cachedSession, "soloLaneId")
        ? cachedSession.soloLaneId
        : restore.lastSoloLaneId
      const restoredReaderViewFullscreen = initialReaderViewFullscreen ?? restore.readerViewFullscreen
      const requestedSoloLaneId = restoredReaderViewFullscreen
        ? "reader"
        : initialSwimlaneSoloLaneId !== undefined
          ? initialSwimlaneSoloLaneId
          : cachedSoloLaneId ?? null
      const restoredSoloLaneId = requestedSoloLaneId !== null && laneOrder.includes(requestedSoloLaneId)
        ? requestedSoloLaneId
        : null
      setReaderViewFullscreen(restoredReaderViewFullscreen)
      patchSwimlaneSession(swimlaneSessionScopeId, {
        activeLaneId: "reader",
        soloLaneId: restoredSoloLaneId,
      })
      restore.patchRestore({
        lastSoloLaneId: restoredSoloLaneId,
        readerViewFullscreen: restoredReaderViewFullscreen,
      })
      if (initialSwimlaneSoloLaneId === undefined) onSwimlaneSoloLaneIdCommitted?.(restoredSoloLaneId)
      if (initialReaderViewFullscreen === undefined) onReaderViewFullscreenCommitted?.(restoredReaderViewFullscreen)
      if (shellControlGenerationRef.current === shellRequestGeneration) {
        applyConfirmedShell(config.shell)
        shellControlStore.hydrate(shellControlHydration(config.shell))
      } else {
        void enqueueShellMutation(async () => { await refreshLatestShell() })
      }
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
            applyConfirmedShell(updated)
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
      neoviewDebug("reader:config:applied", {
        sessionScopeId,
        applyMs: Math.round((performance.now() - applyStartedAt) * 10) / 10,
        totalMs: Math.round((performance.now() - configStartedAt) * 10) / 10,
        sinceBootMs: Math.round((performance.now() - readerBootedAtRef.current) * 10) / 10,
        workspaceMode: config.shell?.workspace?.mode,
      })
      requestAnimationFrame(() => {
        neoviewDebug("reader:config:frame-after-apply", {
          sessionScopeId,
          sinceBootMs: Math.round((performance.now() - readerBootedAtRef.current) * 10) / 10,
          workspaceMode: config.shell?.workspace?.mode,
        })
      })
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        window.clearTimeout(chromeFallbackTimer)
        setReaderChromeReady(true)
        neoviewDebug("reader:config:failed", {
          sessionScopeId,
          durationMs: Math.round((performance.now() - configStartedAt) * 10) / 10,
          error: cause instanceof Error ? cause.message : String(cause),
        })
      }
    })
    return () => {
      window.clearTimeout(chromeFallbackTimer)
      controller.abort()
    }
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
      void client.updatePreloadContext!(sessionId, {
        mode,
        focused,
        stableForMs: speculativePreloadAllowed ? 1_000 : 0,
      }, signal).then((preload) => {
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
  }, [client, session?.frame?.generation, session?.frame?.layout?.panorama, session?.sessionId, speculativePreloadAllowed])
  async function openPath(nextPath = path, provenance?: import("../adapters/reader-http-client").ReaderActivationProvenanceDto) {
    const normalizedPath = nextPath.trim()
    if (!normalizedPath || busy || openOperationRef.current) {
      neoviewDebug("reader:open:skipped", {
        sessionScopeId,
        path: normalizedPath || undefined,
        reason: !normalizedPath ? "empty" : openOperationRef.current ? "open-active" : "busy",
      })
      return { opened: false, message: !normalizedPath ? "Reader open target is empty." : "Reader is busy opening another target." }
    }
    const currentIdentity = readerActivation.activationIdentityRef.current
    if (sessionRef.current
      && activeSourcePathRef.current === normalizedPath
      && (!provenance || currentIdentity && readerActivationIdentityMatchesProvenance(currentIdentity, provenance))) {
      neoviewDebug("reader:open:skipped", {
        sessionScopeId,
        path: normalizedPath,
        reason: "same-active-source",
        sessionId: sessionRef.current,
      })
      return { opened: true }
    }
    slideshow.stop()
    operationRef.current?.abort()
    const controller = new AbortController()
    operationRef.current = controller
    openOperationRef.current = controller
    setBusy(true)
    setError(undefined)
    const openStartedAt = performance.now()
    neoviewDebug("reader:open:begin", {
      sessionScopeId,
      path: normalizedPath,
      provenance: provenance?.kind,
    })
    try {
      const previousSession = sessionRef.current
      const presentationReady = loadReaderPresentation()
      const openProvenance = readerActivation.provenanceForOpen(normalizedPath, provenance)
      const opened = await neoviewDebugAsync(
        "reader:open:http",
        () => clientRef.current.open(normalizedPath, controller.signal, openProvenance),
        { sessionScopeId, path: normalizedPath },
      )
      try {
        await presentationReady
      } catch (error) {
        await clientRef.current.close(opened.sessionId).catch(() => undefined)
        throw error
      }
      if (controller.signal.aborted) {
        void clientRef.current.close(opened.sessionId).catch(() => undefined)
        return { opened: false, message: "Reader open was aborted." }
      }
      sessionRef.current = opened.sessionId
      presentationTouchedRef.current = false
      const identity = opened.activationIdentity
      // Path chrome can update urgently; session/frame work is transitioned so the
      // main thread is not monopolized by LazyReaderFrame + decode in one turn.
      setPath(identity.readerSourcePath)
      activeSourcePathRef.current = identity.readerSourcePath
      setBrowserOriginPath(identity.traversalRootPath)
      readerActivation.commitOpenedSession(opened)
      startTransition(() => {
        setSlideshowFadeFrame(undefined)
        setSession(opened)
        setPresentation({ ...DEFAULT_READER_PRESENTATION, ...viewDefaultsRef.current })
      })
      if (previousSession && previousSession !== opened.sessionId) {
        void clientRef.current.close(previousSession).catch(() => undefined)
      }
      neoviewDebug("reader:open:committed", {
        sessionScopeId,
        path: normalizedPath,
        sessionId: opened.sessionId,
        pageCount: opened.book?.pageCount,
        durationMs: Math.round((performance.now() - openStartedAt) * 10) / 10,
      })
      requestAnimationFrame(() => {
        neoviewDebug("reader:open:frame-after-commit", {
          sessionScopeId,
          sessionId: opened.sessionId,
          pageCount: opened.book?.pageCount,
          sinceOpenMs: Math.round((performance.now() - openStartedAt) * 10) / 10,
        })
      })
      return { opened: true }
    } catch (cause) {
      if (!controller.signal.aborted) {
        const message = errorMessage(cause)
        neoviewDebug("reader:open:failed", {
          sessionScopeId,
          path: normalizedPath,
          durationMs: Math.round((performance.now() - openStartedAt) * 10) / 10,
          error: message,
        })
        setError(message)
        return { opened: false, message }
      }
      return { opened: false, message: "Reader open was aborted." }
    } finally {
      if (openOperationRef.current === controller) openOperationRef.current = undefined
      if (operationRef.current === controller) operationRef.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const startupRestore = useReaderStartupRestore({ client, initialPath, externalOpenRequest, open: openPath, onError: (cause) => setError(errorMessage(cause)) })
  startupRestoreHydrateRef.current = startupRestore.hydrate
  const { folderNavigationEvents, browsePath, activateInFolderCard, openFolderPathInNewTab } = useReaderFolderNavigationEvents()

  const { navigate, goTo } = createReaderNavigationActions({
    currentAnchorPage: () => slideshowSessionRef.current?.frame.anchorPageIndex,
    isAtBoundary: (action) => action === "next" ? Boolean(slideshowSessionRef.current?.frame.atEnd) : Boolean(slideshowSessionRef.current?.frame.atStart),
    tailOverflow: () => tailOverflowRef.current,
    isNavigationPending: () => navigationPendingRef.current,
    isBusy: () => busy,
    // The input action factory creates this function later in the render. Keep
    // the reference lazy so ReaderApp does not read a temporal-dead-zone value.
    switchAdjacentBook: (action) => switchAdjacentBook(action),
    boundaryToastEnabled: () => switchToast.getSnapshot().enableBoundaryToast,
    showBoundaryToast: (action) => switchToast.show({ title: action === "next" ? "已是最后一页" : "已是第一页" }),
    updateNavigation: (action, slideshowAction, presentEachPage) => updateNavigation((sessionId, signal) => clientRef.current.navigate(sessionId, action, signal), slideshowAction, presentEachPage),
    goToPage: (pageIndex, slideshowAction, presentEachPage) => updateNavigation((sessionId, signal) => clientRef.current.goTo(sessionId, pageIndex, signal), slideshowAction, presentEachPage),
    resetSlideshow: () => slideshow.resetOnUserAction(),
  })

  useReaderExternalOpenRequest(externalOpenRequest, async (request) => {
    if (request.kind === "file") return openPath(request.path)
    const directory = request.path.trim()
    if (!directory) return { opened: false, message: "Folder open target is empty." }
    requestShellEdgeOpen("left", true)
    setError(undefined)
    setPath(directory)
    activeSourcePathRef.current = directory
    setBrowserOriginPath(undefined)
    readerActivation.commitStandalonePath(directory, undefined, directory)
    return await beginExternalFolderOpen({ ...request, path: directory })
  }, onExternalOpenResult)
  const actionContext: any = {
    sessionScopeId, pickFile, pickDirectory, pickEfuFile, copyText, copyFiles, onActivationIdentityCommitted, onSwimlaneSoloLaneIdCommitted, onReaderViewFullscreenCommitted, surface, floatingFrame, contextMenu,
    swimlaneSessionScopeId, swimlaneSession, patchSwimlaneSession,
    readerBootedAtRef, client, clientRef,
    shellRef, readerInteractionRef, sessionRef,
    operationRef, openOperationRef, activeSourcePathRef,
    activationIdentityRef: readerActivation.activationIdentityRef,
    commitOpenedSession: readerActivation.commitOpenedSession,
    clearActivationIdentity: readerActivation.clear,
    navigationPendingRef, adjacentBookPendingRef, slideshowSessionRef, slideshow,
    viewDefaultsRef, confirmedViewDefaultsRef, tailOverflowRef,
    viewDefaultsWriteQueueRef, viewDefaultsGenerationRef, pageListPreferencesRef,
    confirmedPageListPreferencesRef, pageListPreferencesWriteQueueRef, pageListPreferencesGenerationRef,
    bookmarkListPreferencesGenerationRef, historyListPreferencesGenerationRef, slideshowConfigRef,
    confirmedSlideshowConfigRef, slideshowWriteQueueRef, slideshowGenerationRef,
    folderViewRef, confirmedFolderViewRef, folderViewWriteQueueRef,
    folderViewGenerationRef, inputBindingsRef, lastInputPointRef,
    temporaryFitPresentationRef, shellControlWriteQueueRef, shellControlGenerationRef,
    pendingWorkspaceWritesRef, presentationTouchedRef, path,
    setPath, browserOriginPath, setBrowserOriginPath,
    session, setSession, busy,
    setBusy, error, setError,
    colorFilter, pageTransition, switchToast,
    infoOverlay, imageTrim, videoController,
    viewerToggles, shell, setShell,
    readerChromeReady, setReaderChromeReady, shellControlStore,
    shellControl, viewDefaults, setViewDefaults,
    deletionCoordinator,
    bookDefaults, setBookDefaults, pageListPreferences,
    setPageListPreferences, bookmarkListPreferences, setBookmarkListPreferences,
    historyListPreferences, setHistoryListPreferences, folderView,
    setFolderView, inputBindings, setInputBindings,
    radialMenu, setRadialMenu, voiceControl,
    setVoiceControl, media, setMedia,
    imageProcessing, setImageProcessing, slideshowConfig,
    setSlideshowConfig, preloadConfig, setPreloadConfig,
    slideshowFadeFrame, setSlideshowFadeFrame, superResolution,
    setSuperResolution, radialMenuRequest, setRadialMenuRequest,
    settingsOpen, setSettingsOpen, presentation,
    setPresentation, magnifierEnabled, setMagnifierEnabled,
    readerViewFullscreen, setReaderViewFullscreen, swimlaneSidebarsReady,
    setSwimlaneSidebarsReady, swimlaneRightSidebarReady, setSwimlaneRightSidebarReady,
    readerFrameAllowed, setReaderFrameAllowed, browserPredecodeEnabled,
    prefetchController, speculativePreloadAllowed, cancelledPreloadFrame,
    setCancelledPreloadFrame, openPath, folderNavigationEvents,
    browsePath, activateInFolderCard, openFolderPathInNewTab,
    externalFolderOpenRequest,
    onExternalFolderOpenResult: completeExternalFolderOpen,
    navigate, goTo, requestShellEdgeOpen,
    setShellEdgePinned, cycleShellEdgeLock, setShellEdgeLock,
    setShellFloatingControl, setShellEdgeTriggerSize, resetShellControl,
    persistShellControl,
  }

  const {
    persistSubtitleConfig,
    persistVideoControlsPinned,
    persistAnimatedVideoMode,
    explorerContextMenuPreview,
    explorerContextMenuStatus,
    setExplorerContextMenuEnabled,
    repairExplorerContextMenu,
    persistSuperResolutionConfig,
    persistSuperResolution,
    runPreloadAction,
    updateNavigation,
    applyBookSettingsUpdate,
    updatePresentation,
    updatePageMode,
    updateSessionLayout,
    updateReadingDirection,
    updateReadingDirectionLock,
    updateCurrentPageOrder,
    updatePageOrderLocks,
    updateCurrentBookPageMode,
    updateCurrentBookReadingDirection,
    persistHistoryListPreferences,
    persistBookmarkListPreferences,
    persistPageListPreferences,
    persistViewDefaults,
    applyConfiguredViewDefaults,
    persistInputBindings,
    persistRadialMenu,
    persistVoiceControl,
    inspectLegacySettings,
    importLegacySettings,
  } = createReaderAppSettingsActions(actionContext)

  Object.assign(actionContext, {
    persistSubtitleConfig,
    persistVideoControlsPinned,
    persistAnimatedVideoMode,
    explorerContextMenuPreview,
    explorerContextMenuStatus,
    setExplorerContextMenuEnabled,
    repairExplorerContextMenu,
    persistSuperResolutionConfig,
    persistSuperResolution,
    runPreloadAction,
    updateNavigation,
    applyBookSettingsUpdate,
    updatePresentation,
    updatePageMode,
    updateSessionLayout,
    updateReadingDirection,
    updateReadingDirectionLock,
    updateCurrentPageOrder,
    updatePageOrderLocks,
    updateCurrentBookPageMode,
    updateCurrentBookReadingDirection,
    persistHistoryListPreferences,
    persistBookmarkListPreferences,
    persistPageListPreferences,
    persistViewDefaults,
    applyConfiguredViewDefaults,
    persistInputBindings,
    persistRadialMenu,
    persistVoiceControl,
    inspectLegacySettings,
    importLegacySettings,
  })

  const { undoFileDeletion } = attachReaderAppFileActions(actionContext)

  const {
    toggleWorkspaceMode,
    focusAdjacentWorkspaceLane,
    toggleActiveWorkspaceLaneFullscreen,
    fitWorkspaceLanes,
    commitWorkspace,
    currentReaderWorkspace,
    commitSwimlaneSessionPatch,
    applyConfirmedShell,
    enqueueShellControl,
    commitSidebarLayout,
    commitCardLayout,
    commitBoardLayout,
    commitDraggedPanelLayout,
    persistImageProcessing,
    persistPreload,
    enqueueShellMutation,
    refreshLatestShell,
    commitShellMaterial,
  } = createReaderAppWorkspaceActions(actionContext)

  Object.assign(actionContext, {
    toggleWorkspaceMode,
    focusAdjacentWorkspaceLane,
    toggleActiveWorkspaceLaneFullscreen,
    fitWorkspaceLanes,
    commitWorkspace,
    currentReaderWorkspace,
    commitSwimlaneSessionPatch,
    applyConfirmedShell,
    enqueueShellControl,
    commitSidebarLayout,
    commitCardLayout,
    commitBoardLayout,
    commitDraggedPanelLayout,
    persistImageProcessing,
    persistPreload,
    enqueueShellMutation,
    refreshLatestShell,
    commitShellMaterial,
  })

  const {
    executeInputAction,
    applyInputPresentation,
    switchAdjacentBook,
    toggleTemporaryFit,
    toggleSinglePanorama,
    syncPanoramaVisiblePage,
    toggleFullscreen,
    toggleShellEdge,
    toggleShellPin,
    toggleSidebarControl,
    openRadialMenu,
  } = createReaderAppInputActions(actionContext)

  Object.assign(actionContext, {
    executeInputAction,
    applyInputPresentation,
    switchAdjacentBook,
    toggleTemporaryFit,
    toggleSinglePanorama,
    syncPanoramaVisiblePage,
    toggleFullscreen,
    toggleShellEdge,
    toggleShellPin,
    toggleSidebarControl,
    openRadialMenu,
  })

  const inputRouter = useReaderInputRouter({ config: inputBindings, disabled: busy, execute: executeInputAction })
  const deleteThroughInputBinding = (sourcePath: string, strategy: "trash" | "delete") =>
    dispatchReaderFileCardDeleteBinding(sourcePath, strategy, inputRouter.dispatchAndWait)
  const runtimeWorkspace = shell ? readerWorkspaceWithSession(shell, swimlaneSession) : undefined
  const runtimeWorkspaceMode = runtimeWorkspace?.mode
  const shellPresent = Boolean(shell)
  useReaderSwimlaneSidebarDeferral({
    readerChromeReady,
    sessionScopeId,
    shellPresent,
    workspaceMode: runtimeWorkspaceMode,
    setLeftReady: setSwimlaneSidebarsReady,
    setRightReady: setSwimlaneRightSidebarReady,
  })

  useReaderAdjacentPagePreloader({
    client,
    sessionId: session?.sessionId,
    activePageIndex: session?.frame.anchorPageIndex,
    totalPages: session?.book.pageCount,
    plan: session?.preload,
    enabled: browserPredecodeEnabled && readerFrameAllowed && speculativePreloadAllowed && (
      !session
      || cancelledPreloadFrame?.sessionId !== session.sessionId
      || cancelledPreloadFrame.generation !== session.frame.generation
    ),
    preload: prefetchController.preload,
    cancel: prefetchController.cancel,
  })

  const handleInputPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    lastInputPointRef.current = { x: event.clientX, y: event.clientY }
    inputRouter.onPointerDown(event)
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
    commitSwimlaneSessionPatch({ activeLaneId: "reader", soloLaneId: "reader" })
    enqueueShellControl({ reset: "known-defaults" }, previous)
  }

  function persistShellControl(patch: ReaderShellControlPatch["shellControl"]) {
    const { workspace, ...persistent } = patch
    if (workspace) commitWorkspace(workspace)
    if (Object.keys(persistent).length > 0) enqueueShellControl(persistent)
  }
  Object.assign(actionContext, { inputRouter, handleInputPointerDown, deleteThroughInputBinding, startupRestore })
  return <ReaderAppView context={actionContext} />
}
